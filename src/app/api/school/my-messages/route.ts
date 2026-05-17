import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaffCheckOk = {
  ok: true;
  userId: string;
  schoolId: string;
  role: string;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(role?: string | null) {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (r === "professor" || r === "teacher" || r === "professora") return "professor";
  if (r === "diretor" || r === "director" || r === "diretora") return "diretor";
  if (r === "coordenador" || r === "coordinator" || r === "coordenadora") return "coordenador";
  if (r === "secretaria" || r === "secretary" || r === "secretario") return "secretaria";
  if (r === "admin" || r === "administrador") return "admin";

  return r;
}

function roleLabel(role?: string | null) {
  const r = normalizeRole(role);

  if (r === "professor") return "Professor";
  if (r === "diretor") return "Diretor";
  if (r === "coordenador") return "Coordenador";
  if (r === "secretaria") return "Secretaria";
  if (r === "admin") return "Administrador";

  return "Equipe escolar";
}

function possibleRecipientTypesForRole(role: string) {
  const r = normalizeRole(role);

  const base = ["staff", "school_user", "user"];

  if (r === "professor") return ["professor", "teacher", ...base];
  if (r === "diretor") return ["diretor", "director", ...base];
  if (r === "coordenador") return ["coordenador", "coordinator", ...base];
  if (r === "secretaria") return ["secretaria", "secretary", ...base];
  if (r === "admin") return ["admin", ...base];

  return base;
}

async function getStaffFromToken(token: string): Promise<StaffCheckOk | any> {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (staffErr) {
    return {
      ok: false as const,
      status: 500,
      error: "Erro ao validar usuário escolar: " + staffErr.message,
    };
  }

  if (!staff?.school_id) {
    return {
      ok: false as const,
      status: 403,
      error: "Usuário sem escola ativa.",
    };
  }

  const role = normalizeRole(staff.role);

  const allowed = ["diretor", "coordenador", "secretaria", "professor", "admin"];

  if (!allowed.includes(role)) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para acessar comunicados da equipe.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

function audienceLabel(message: any) {
  const type = String(message?.audience_type || "").trim().toLowerCase();

  if (type === "school") return "Toda escola";
  if (type === "teachers") return "Todos os professores";
  if (type === "teacher_individual") return "Professor individual";
  if (type === "teachers_class" || type === "teacher_class") return "Professores da turma";
  if (type === "staff") return "Equipe escolar";
  if (type === "coordinators") return "Coordenadores";
  if (type === "secretaria") return "Secretaria";
  if (type === "all_parents") return "Responsáveis";
  if (type === "class") return "Responsáveis da turma";
  if (type === "parent_individual") return "Responsável individual";

  return "Comunicado escolar";
}

async function loadRecipients(params: {
  schoolId: string;
  userId: string;
  role: string;
}) {
  const { schoolId, userId, role } = params;

  const recipientTypes = possibleRecipientTypesForRole(role);

  const { data, error } = await supabaseAdmin
    .from("message_recipients")
    .select("id, message_id, recipient_type, recipient_id, delivered_at, read_at, created_at")
    .eq("school_id", schoolId)
    .eq("recipient_id", userId)
    .in("recipient_type", recipientTypes)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Erro ao carregar comunicados recebidos: " + error.message);
  }

  return data || [];
}

async function markDeliveredIfMissing(params: {
  schoolId: string;
  userId: string;
  recipientIds: string[];
}) {
  const { schoolId, userId, recipientIds } = params;

  const ids = recipientIds.map(cleanText).filter(Boolean);

  if (ids.length === 0) return;

  await supabaseAdmin
    .from("message_recipients")
    .update({ delivered_at: new Date().toISOString() })
    .eq("school_id", schoolId)
    .eq("recipient_id", userId)
    .in("id", ids);
}

async function getMessageRows(params: {
  schoolId: string;
  messageIds: string[];
}) {
  const { schoolId, messageIds } = params;

  if (messageIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select(
      `
      id,
      school_id,
      created_by,
      title,
      body,
      status,
      audience_type,
      target_class_id,
      target_role,
      published_at,
      created_at
    `
    )
    .eq("school_id", schoolId)
    .eq("status", "published")
    .in("id", messageIds);

  if (error) {
    throw new Error("Erro ao carregar comunicados: " + error.message);
  }

  return data || [];
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);

    if (!staffCheck.ok) {
      return jsonError(staffCheck.error, staffCheck.status);
    }

    const { userId, schoolId, role } = staffCheck;

    const recipients = await loadRecipients({
      schoolId,
      userId,
      role,
    });

    const notDelivered = recipients
      .filter((row: any) => !row.delivered_at)
      .map((row: any) => String(row.id))
      .filter(Boolean);

    if (notDelivered.length > 0) {
      await markDeliveredIfMissing({
        schoolId,
        userId,
        recipientIds: notDelivered,
      });
    }

    const messageIds = Array.from(
      new Set((recipients || []).map((row: any) => String(row.message_id)).filter(Boolean))
    );

    if (messageIds.length === 0) {
      return jsonOk({
        schoolId,
        userId,
        role,
        roleLabel: roleLabel(role),
        messages: [],
        summary: {
          total: 0,
          unread: 0,
          read: 0,
        },
      });
    }

    const messages = await getMessageRows({
      schoolId,
      messageIds,
    });

    const recipientByMessageId = new Map<string, any>();

    for (const rec of recipients || []) {
      const messageId = String((rec as any).message_id);
      const current = recipientByMessageId.get(messageId);

      if (!current) {
        recipientByMessageId.set(messageId, rec);
        continue;
      }

      const currentRead = current?.read_at ? new Date(current.read_at).getTime() : 0;
      const recRead = (rec as any)?.read_at ? new Date((rec as any).read_at).getTime() : 0;
      const currentDelivered = current?.delivered_at ? new Date(current.delivered_at).getTime() : 0;
      const recDelivered = (rec as any)?.delivered_at
        ? new Date((rec as any).delivered_at).getTime()
        : 0;

      if (recRead > currentRead || recDelivered > currentDelivered) {
        recipientByMessageId.set(messageId, rec);
      }
    }

    const now = new Date().toISOString();

    const rows = (messages || [])
      .map((message: any) => {
        const rec = recipientByMessageId.get(String(message.id)) || null;

        return {
          id: String(message.id),
          title: message.title,
          body: message.body,
          status: message.status,
          audienceType: message.audience_type || "staff",
          audienceLabel: audienceLabel(message),
          publishedAt: message.published_at || message.created_at,
          createdAt: message.created_at,
          recipient: rec
            ? {
                id: String(rec.id),
                recipientType: rec.recipient_type || role,
                deliveredAt: rec.delivered_at || now,
                readAt: rec.read_at || null,
              }
            : null,
        };
      })
      .sort(
        (a: any, b: any) =>
          new Date(b.publishedAt || b.createdAt).getTime() -
          new Date(a.publishedAt || a.createdAt).getTime()
      );

    const unread = rows.filter((row: any) => !row.recipient?.readAt).length;
    const read = rows.filter((row: any) => !!row.recipient?.readAt).length;

    return jsonOk({
      schoolId,
      userId,
      role,
      roleLabel: roleLabel(role),
      messages: rows,
      summary: {
        total: rows.length,
        unread,
        read,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar comunicados da equipe.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);

    if (!staffCheck.ok) {
      return jsonError(staffCheck.error, staffCheck.status);
    }

    const body = await req.json().catch(() => ({}));
    const messageId = cleanText(body?.messageId || body?.message_id);

    if (!messageId) return jsonError("messageId é obrigatório.", 422);

    const now = new Date().toISOString();

    const { data: existing, error: findErr } = await supabaseAdmin
      .from("message_recipients")
      .select("id, message_id, recipient_type, recipient_id, delivered_at, read_at")
      .eq("school_id", staffCheck.schoolId)
      .eq("message_id", messageId)
      .eq("recipient_id", staffCheck.userId)
      .in("recipient_type", possibleRecipientTypesForRole(staffCheck.role))
      .limit(1)
      .maybeSingle();

    if (findErr) {
      return jsonError("Erro ao localizar comunicado: " + findErr.message, 500);
    }

    if (!existing?.id) {
      return jsonError("Comunicado não encontrado para este usuário.", 404);
    }

    const updatePayload = {
      delivered_at: existing.delivered_at || now,
      read_at: existing.read_at || now,
    };

    const { data, error } = await supabaseAdmin
      .from("message_recipients")
      .update(updatePayload)
      .eq("school_id", staffCheck.schoolId)
      .eq("id", existing.id)
      .select("id, message_id, recipient_type, recipient_id, delivered_at, read_at")
      .maybeSingle();

    if (error) {
      return jsonError("Erro ao marcar comunicado como visualizado: " + error.message, 500);
    }

    if (!data?.id) {
      return jsonError("Comunicado não encontrado para este usuário.", 404);
    }

    return jsonOk({ recipient: data });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao marcar leitura.", 500);
  }
}