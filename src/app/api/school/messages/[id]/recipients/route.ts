import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type RecipientStatus = "sent" | "delivered" | "viewed" | "pending";

type RecipientRow = {
  id: string;
  message_id: string;
  school_id: string | null;
  recipient_type: string | null;
  recipient_id: string | null;
  user_id: string | null;
  delivered_at: string | null;
  viewed_at: string | null;
  created_at: string | null;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizeType(value: unknown) {
  const raw = clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    raw === "parent" ||
    raw === "parents" ||
    raw === "responsavel" ||
    raw === "responsaveis"
  ) {
    return "parent";
  }

  if (raw === "teacher" || raw === "professor" || raw === "professores") {
    return "teacher";
  }

  if (
    raw === "staff" ||
    raw === "equipe" ||
    raw === "secretaria" ||
    raw === "secretary" ||
    raw === "coordenador" ||
    raw === "coordinator" ||
    raw === "diretor" ||
    raw === "director" ||
    raw === "admin"
  ) {
    return "staff";
  }

  if (raw === "student" || raw === "aluno" || raw === "alunos") {
    return "student";
  }

  return raw || "recipient";
}

function getStatus(row: RecipientRow): RecipientStatus {
  if (row.viewed_at) return "viewed";
  if (row.delivered_at) return "delivered";
  if (row.created_at) return "sent";
  return "pending";
}

function statusMatchesFilter(row: RecipientRow, filter: string) {
  const normalizedFilter = clean(filter).toLowerCase();

  if (!normalizedFilter || normalizedFilter === "all" || normalizedFilter === "todos") {
    return true;
  }

  const status = getStatus(row);

  if (normalizedFilter === "sent" || normalizedFilter === "enviado") {
    return true;
  }

  if (
    normalizedFilter === "delivered" ||
    normalizedFilter === "entregue" ||
    normalizedFilter === "entregues"
  ) {
    return Boolean(row.delivered_at) && !row.viewed_at;
  }

  if (
    normalizedFilter === "viewed" ||
    normalizedFilter === "visualizado" ||
    normalizedFilter === "visualizados"
  ) {
    return status === "viewed";
  }

  if (
    normalizedFilter === "pending" ||
    normalizedFilter === "pendente" ||
    normalizedFilter === "pendentes"
  ) {
    return !row.delivered_at && !row.viewed_at;
  }

  return true;
}

function isUuidLike(value: unknown) {
  const s = clean(value);

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

function pickName(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);

    if (text && !isUuidLike(text)) {
      return text;
    }
  }

  return "";
}

function initials(name: string) {
  const safe = clean(name);
  if (!safe) return "DT";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

async function loadRecipients(messageId: string, schoolId: string): Promise<RecipientRow[]> {
  const attempts = [
    supabaseAdmin
      .from("school_message_recipients")
      .select(
        `
          id,
          message_id,
          school_id,
          recipient_type,
          recipient_id,
          user_id,
          delivered_at,
          viewed_at,
          created_at
        `
      )
      .eq("message_id", messageId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("message_recipients")
      .select(
        `
          id,
          message_id,
          school_id,
          recipient_type,
          recipient_id,
          user_id,
          delivered_at,
          viewed_at,
          created_at
        `
      )
      .eq("message_id", messageId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true }),
  ];

  let lastError: any = null;

  for (const query of attempts) {
    const { data, error } = await query;

    if (!error) {
      return (data || []) as RecipientRow[];
    }

    lastError = error;
  }

  throw new Error(lastError?.message || "Não foi possível carregar destinatários.");
}

async function resolveParents(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "parent")
        .flatMap((row) => [clean(row.recipient_id), clean(row.user_id)])
        .filter(Boolean)
    )
  );

  const map = new Map<
    string,
    {
      name: string;
      phone: string | null;
      photoUrl: string | null;
      userId: string | null;
    }
  >();

  if (ids.length === 0) return map;

  const byId = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name, phone, photo_url")
    .eq("school_id", schoolId)
    .in("id", ids);

  if (!byId.error) {
    for (const item of byId.data || []) {
      const id = clean((item as any).id);
      const userId = clean((item as any).user_id);
      const name = pickName((item as any).full_name) || "Responsável";
      const phone = clean((item as any).phone) || null;
      const photoUrl = clean((item as any).photo_url) || null;

      if (id) {
        map.set(id, { name, phone, photoUrl, userId: userId || null });
      }

      if (userId) {
        map.set(userId, { name, phone, photoUrl, userId });
      }
    }
  }

  const unresolvedUserIds = ids.filter((id) => !map.has(id));

  if (unresolvedUserIds.length > 0) {
    const byUserId = await supabaseAdmin
      .from("parents")
      .select("id, school_id, user_id, full_name, phone, photo_url")
      .eq("school_id", schoolId)
      .in("user_id", unresolvedUserIds);

    if (!byUserId.error) {
      for (const item of byUserId.data || []) {
        const id = clean((item as any).id);
        const userId = clean((item as any).user_id);
        const name = pickName((item as any).full_name) || "Responsável";
        const phone = clean((item as any).phone) || null;
        const photoUrl = clean((item as any).photo_url) || null;

        if (id) {
          map.set(id, { name, phone, photoUrl, userId: userId || null });
        }

        if (userId) {
          map.set(userId, { name, phone, photoUrl, userId });
        }
      }
    }
  }

  return map;
}

async function resolveTeachers(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "teacher")
        .flatMap((row) => [clean(row.recipient_id), clean(row.user_id)])
        .filter(Boolean)
    )
  );

  const map = new Map<
    string,
    {
      name: string;
      phone: string | null;
      photoUrl: string | null;
      userId: string | null;
    }
  >();

  if (ids.length === 0) return map;

  const byId = await supabaseAdmin
    .from("teachers")
    .select("id, school_id, user_id, full_name, phone, photo_url")
    .eq("school_id", schoolId)
    .in("id", ids);

  if (!byId.error) {
    for (const item of byId.data || []) {
      const id = clean((item as any).id);
      const userId = clean((item as any).user_id);
      const name = pickName((item as any).full_name) || "Professor(a)";
      const phone = clean((item as any).phone) || null;
      const photoUrl = clean((item as any).photo_url) || null;

      if (id) {
        map.set(id, { name, phone, photoUrl, userId: userId || null });
      }

      if (userId) {
        map.set(userId, { name, phone, photoUrl, userId });
      }
    }
  }

  const unresolvedUserIds = ids.filter((id) => !map.has(id));

  if (unresolvedUserIds.length > 0) {
    const byUserId = await supabaseAdmin
      .from("teachers")
      .select("id, school_id, user_id, full_name, phone, photo_url")
      .eq("school_id", schoolId)
      .in("user_id", unresolvedUserIds);

    if (!byUserId.error) {
      for (const item of byUserId.data || []) {
        const id = clean((item as any).id);
        const userId = clean((item as any).user_id);
        const name = pickName((item as any).full_name) || "Professor(a)";
        const phone = clean((item as any).phone) || null;
        const photoUrl = clean((item as any).photo_url) || null;

        if (id) {
          map.set(id, { name, phone, photoUrl, userId: userId || null });
        }

        if (userId) {
          map.set(userId, { name, phone, photoUrl, userId });
        }
      }
    }
  }

  return map;
}

async function resolveStaff(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "staff")
        .flatMap((row) => [clean(row.recipient_id), clean(row.user_id)])
        .filter(Boolean)
    )
  );

  const map = new Map<
    string,
    {
      name: string;
      phone: string | null;
      photoUrl: string | null;
      userId: string | null;
    }
  >();

  if (ids.length === 0) return map;

  const byUserId = await supabaseAdmin
    .from("school_users")
    .select("id, school_id, user_id, role")
    .eq("school_id", schoolId)
    .in("user_id", ids);

  if (!byUserId.error) {
    for (const item of byUserId.data || []) {
      const id = clean((item as any).id);
      const userId = clean((item as any).user_id);
      const role = clean((item as any).role);
      const name =
        role === "diretor"
          ? "Diretor(a)"
          : role === "coordenador"
            ? "Coordenador(a)"
            : role === "secretaria"
              ? "Secretaria"
              : role === "admin"
                ? "Administrador"
                : "Equipe escolar";

      if (id) {
        map.set(id, { name, phone: null, photoUrl: null, userId: userId || null });
      }

      if (userId) {
        map.set(userId, { name, phone: null, photoUrl: null, userId });
      }
    }
  }

  return map;
}

async function resolveStudents(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "student")
        .map((row) => clean(row.recipient_id))
        .filter(Boolean)
    )
  );

  const map = new Map<
    string,
    {
      name: string;
      phone: string | null;
      photoUrl: string | null;
      userId: string | null;
    }
  >();

  if (ids.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("students")
    .select("id, school_id, full_name, student_photo_url")
    .eq("school_id", schoolId)
    .in("id", ids);

  if (!error) {
    for (const item of data || []) {
      const id = clean((item as any).id);
      const name = pickName((item as any).full_name) || "Aluno(a)";
      const photoUrl = clean((item as any).student_photo_url) || null;

      if (id) {
        map.set(id, { name, phone: null, photoUrl, userId: null });
      }
    }
  }

  return map;
}

async function resolveEmails(rows: RecipientRow[]) {
  const ids = Array.from(
    new Set(rows.map((row) => clean(row.user_id)).filter(Boolean))
  );

  const map = new Map<string, string>();

  for (const userId of ids) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = clean(data?.user?.email);

      if (email) {
        map.set(userId, email);
      }
    } catch {
      // Mantém silencioso para não quebrar o modal.
    }
  }

  return map;
}

export async function GET(req: Request, context: RouteContext) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "secretaria",
    "secretary",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const messageId = clean(params?.id);
    const schoolId = clean((guard as any).schoolId);

    if (!messageId) {
      return jsonError("ID do comunicado é obrigatório.", 400);
    }

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    const url = new URL(req.url);
    const filter = clean(url.searchParams.get("filter"));

    const allRecipients = await loadRecipients(messageId, schoolId);
    const filteredRecipients = allRecipients.filter((row) =>
      statusMatchesFilter(row, filter)
    );

    const [parentsMap, teachersMap, staffMap, studentsMap, emailsMap] =
      await Promise.all([
        resolveParents(filteredRecipients, schoolId),
        resolveTeachers(filteredRecipients, schoolId),
        resolveStaff(filteredRecipients, schoolId),
        resolveStudents(filteredRecipients, schoolId),
        resolveEmails(filteredRecipients),
      ]);

    const recipients = filteredRecipients.map((row) => {
      const type = normalizeType(row.recipient_type);
      const recipientId = clean(row.recipient_id);
      const userId = clean(row.user_id);
      const lookupKeys = [recipientId, userId].filter(Boolean);

      let found:
        | {
            name: string;
            phone: string | null;
            photoUrl: string | null;
            userId: string | null;
          }
        | undefined;

      for (const key of lookupKeys) {
        if (type === "parent") found = found || parentsMap.get(key);
        if (type === "teacher") found = found || teachersMap.get(key);
        if (type === "staff") found = found || staffMap.get(key);
        if (type === "student") found = found || studentsMap.get(key);
      }

      const email = userId ? emailsMap.get(userId) || null : null;

      const fallbackName =
        type === "parent"
          ? "Responsável"
          : type === "teacher"
            ? "Professor(a)"
            : type === "staff"
              ? "Equipe escolar"
              : type === "student"
                ? "Aluno(a)"
                : "Destinatário";

      const recipientName = pickName(found?.name, email) || fallbackName;

      return {
        ...row,
        recipient_type: type,
        recipientName,
        recipientEmail: email,
        recipientPhone: found?.phone || null,
        recipientPhotoUrl: found?.photoUrl || null,
        recipientInitials: initials(recipientName),
        status: getStatus(row),
      };
    });

    const statsBase = allRecipients;
    const sentCount = statsBase.length;
    const deliveredCount = statsBase.filter((item) => item.delivered_at && !item.viewed_at).length;
    const viewedCount = statsBase.filter((item) => item.viewed_at).length;
    const pendingCount = statsBase.filter((item) => !item.delivered_at && !item.viewed_at).length;

    return NextResponse.json({
      ok: true,
      recipients,
      stats: {
        sent: sentCount,
        delivered: deliveredCount,
        viewed: viewedCount,
        pending: pendingCount,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/school/messages/[id]/recipients]", e);

    return jsonError(e?.message || "Erro interno ao carregar destinatários.", 500);
  }
}