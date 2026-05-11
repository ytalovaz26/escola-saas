import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function normalizeRole(role?: string | null) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "professor" || r === "teacher") return "professor";
  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "admin") return "admin";

  return r;
}

async function getTeacherFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (staffErr) {
    return {
      ok: false as const,
      status: 500,
      error: "Erro ao validar professor: " + staffErr.message,
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

  if (role !== "professor") {
    return {
      ok: false as const,
      status: 403,
      error: "Esta área é exclusiva para professores.",
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
  const type = String(message.audience_type || "staff");

  if (type === "teachers") return "Professores";
  if (type === "staff") return "Equipe escolar";
  if (type === "school") return "Escola toda";

  return "Comunicado escolar";
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const teacherCheck = await getTeacherFromToken(token);
    if (!teacherCheck.ok) return jsonError(teacherCheck.error, teacherCheck.status);

    const { userId, schoolId } = teacherCheck;

    const { data: recipients, error: recErr } = await supabaseAdmin
      .from("message_recipients")
      .select("id, message_id, delivered_at, read_at, created_at")
      .eq("school_id", schoolId)
      .eq("recipient_type", "staff")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false });

    if (recErr) {
      return jsonError("Erro ao carregar comunicados recebidos: " + recErr.message, 500);
    }

    const notDelivered = (recipients || [])
      .filter((row: any) => !row.delivered_at)
      .map((row: any) => String(row.id))
      .filter(Boolean);

    if (notDelivered.length > 0) {
      await supabaseAdmin
        .from("message_recipients")
        .update({ delivered_at: new Date().toISOString() })
        .in("id", notDelivered)
        .eq("school_id", schoolId)
        .eq("recipient_type", "staff")
        .eq("recipient_id", userId);
    }

    const messageIds = Array.from(
      new Set((recipients || []).map((row: any) => String(row.message_id)).filter(Boolean))
    );

    if (messageIds.length === 0) {
      return jsonOk({
        schoolId,
        teacherUserId: userId,
        messages: [],
        summary: {
          total: 0,
          unread: 0,
          read: 0,
        },
      });
    }

    const { data: messages, error: msgErr } = await supabaseAdmin
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

    if (msgErr) {
      return jsonError("Erro ao carregar comunicados: " + msgErr.message, 500);
    }

    const recipientByMessageId = new Map<string, any>();

    for (const rec of recipients || []) {
      recipientByMessageId.set(String((rec as any).message_id), rec);
    }

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
                deliveredAt: rec.delivered_at || new Date().toISOString(),
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
      teacherUserId: userId,
      messages: rows,
      summary: {
        total: rows.length,
        unread,
        read,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar comunicados do professor.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const teacherCheck = await getTeacherFromToken(token);
    if (!teacherCheck.ok) return jsonError(teacherCheck.error, teacherCheck.status);

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.messageId || body?.message_id || "").trim();

    if (!messageId) return jsonError("messageId é obrigatório.", 422);

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("message_recipients")
      .update({
        delivered_at: now,
        read_at: now,
      })
      .eq("school_id", teacherCheck.schoolId)
      .eq("message_id", messageId)
      .eq("recipient_type", "staff")
      .eq("recipient_id", teacherCheck.userId)
      .select("id, message_id, delivered_at, read_at")
      .maybeSingle();

    if (error) {
      return jsonError("Erro ao marcar comunicado como visualizado: " + error.message, 500);
    }

    if (!data?.id) {
      return jsonError("Comunicado não encontrado para este professor.", 404);
    }

    return jsonOk({ recipient: data });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao marcar leitura do professor.", 500);
  }
}