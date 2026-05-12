import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RecipientStatus = "sent" | "delivered" | "read" | "pending";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function normalizeRole(role?: string | null) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin") return "admin";

  return r;
}

function roleLabel(role?: string | null) {
  const r = normalizeRole(role);

  if (r === "diretor") return "Diretor";
  if (r === "coordenador") return "Coordenador";
  if (r === "secretaria") return "Secretaria";
  if (r === "professor") return "Professor";
  if (r === "admin") return "Administrador";

  return "Equipe escolar";
}

function recipientComputedStatus(row: any): RecipientStatus {
  if (row?.read_at) return "read";
  if (row?.delivered_at) return "delivered";
  return "pending";
}

function staffNameFromUser(user: any) {
  const meta = user?.raw_user_meta_data || user?.user_metadata || {};

  const name =
    meta.full_name ||
    meta.fullName ||
    meta.name ||
    meta.nome ||
    user?.email ||
    "Usuário escolar";

  return String(name);
}

function parentDisplayName(parent: any) {
  return (
    parent?.full_name ||
    parent?.name ||
    parent?.responsible_name ||
    parent?.email ||
    "Responsável"
  );
}

async function getStaffFromToken(token: string) {
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
      error: "Erro ao validar usuário escolar: " + staffErr.message,
    };
  }

  if (!staff?.school_id) {
    return { ok: false as const, status: 403, error: "Usuário sem escola ativa." };
  }

  const role = normalizeRole(staff.role);

  const canRead =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canRead) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para visualizar destinatários dos comunicados.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

async function loadAuthUsersById(userIds: string[]) {
  const ids = Array.from(new Set(userIds.map(String).filter(Boolean)));

  if (ids.length === 0) return new Map<string, any>();

  const result = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (result.error) return new Map<string, any>();

  return new Map(
    (result.data.users || [])
      .filter((user: any) => ids.includes(String(user.id)))
      .map((user: any) => [String(user.id), user])
  );
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const messageId = String(params?.id || "").trim();

    if (!messageId) return jsonError("ID do comunicado não informado.", 422);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);
    if (!staffCheck.ok) return jsonError(staffCheck.error, staffCheck.status);

    const schoolId = staffCheck.schoolId;

    const { data: message, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select(
        `
        id,
        school_id,
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
      .eq("id", messageId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (msgErr) {
      return jsonError("Erro ao carregar comunicado: " + msgErr.message, 500);
    }

    if (!message?.id) {
      return jsonError("Comunicado não encontrado nesta escola.", 404);
    }

    const url = new URL(req.url);
    const statusParam = String(url.searchParams.get("status") || "sent")
      .trim()
      .toLowerCase();

    const allowedStatus = new Set(["sent", "delivered", "read", "pending"]);
    const requestedStatus: RecipientStatus = allowedStatus.has(statusParam)
      ? (statusParam as RecipientStatus)
      : "sent";

    const { data: recipients, error: recErr } = await supabaseAdmin
      .from("message_recipients")
      .select(
        `
        id,
        school_id,
        message_id,
        recipient_type,
        recipient_id,
        delivered_at,
        read_at,
        created_at
      `
      )
      .eq("school_id", schoolId)
      .eq("message_id", messageId)
      .order("created_at", { ascending: true });

    if (recErr) {
      return jsonError("Erro ao carregar destinatários: " + recErr.message, 500);
    }

    const allRecipients = recipients || [];

    const parentIds = Array.from(
      new Set(
        allRecipients
          .filter((row: any) => String(row.recipient_type) === "parent")
          .map((row: any) => String(row.recipient_id))
          .filter(Boolean)
      )
    );

    const staffUserIds = Array.from(
      new Set(
        allRecipients
          .filter((row: any) => String(row.recipient_type) === "staff")
          .map((row: any) => String(row.recipient_id))
          .filter(Boolean)
      )
    );

    let parentsById = new Map<string, any>();

    if (parentIds.length > 0) {
      const { data: parents, error: parentErr } = await supabaseAdmin
        .from("parents")
        .select("id, full_name, name, email, phone, whatsapp, user_id")
        .eq("school_id", schoolId)
        .in("id", parentIds);

      if (!parentErr) {
        parentsById = new Map((parents || []).map((parent: any) => [String(parent.id), parent]));
      }
    }

    let schoolUsersByUserId = new Map<string, any>();

    if (staffUserIds.length > 0) {
      const { data: staffRows, error: staffErr } = await supabaseAdmin
        .from("school_users")
        .select("user_id, role")
        .eq("school_id", schoolId)
        .in("user_id", staffUserIds);

      if (!staffErr) {
        schoolUsersByUserId = new Map(
          (staffRows || []).map((staffRow: any) => [String(staffRow.user_id), staffRow])
        );
      }
    }

    const authUsersById = await loadAuthUsersById(staffUserIds);

    const rows = allRecipients.map((row: any) => {
      const type = String(row.recipient_type || "");
      const recipientId = String(row.recipient_id || "");
      const computedStatus = recipientComputedStatus(row);

      if (type === "parent") {
        const parent = parentsById.get(recipientId) || null;

        return {
          id: String(row.id),
          recipientType: "parent",
          recipientId,
          name: parentDisplayName(parent),
          email: parent?.email || null,
          phone: parent?.phone || parent?.whatsapp || null,
          role: "responsavel",
          roleLabel: "Responsável",
          deliveredAt: row.delivered_at || null,
          readAt: row.read_at || null,
          createdAt: row.created_at || null,
          status: computedStatus,
        };
      }

      const authUser = authUsersById.get(recipientId) || null;
      const staffRow = schoolUsersByUserId.get(recipientId) || null;
      const role = normalizeRole(staffRow?.role);

      return {
        id: String(row.id),
        recipientType: "staff",
        recipientId,
        name: staffNameFromUser(authUser),
        email: authUser?.email || null,
        phone: null,
        role,
        roleLabel: roleLabel(role),
        deliveredAt: row.delivered_at || null,
        readAt: row.read_at || null,
        createdAt: row.created_at || null,
        status: computedStatus,
      };
    });

    const filteredRows =
      requestedStatus === "sent"
        ? rows
        : rows.filter((row: any) => row.status === requestedStatus);

    const summary = {
      sent: rows.length,
      delivered: rows.filter((row: any) => row.status === "delivered").length,
      read: rows.filter((row: any) => row.status === "read").length,
      pending: rows.filter((row: any) => row.status === "pending").length,
    };

    return jsonOk({
      message,
      status: requestedStatus,
      recipients: filteredRows,
      summary,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar destinatários.", 500);
  }
}