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

type ResolvedRecipient = RecipientRow & {
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  recipientPhotoUrl: string | null;
  status: RecipientStatus;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizeType(value: unknown) {
  const raw = clean(value).toLowerCase();

  if (raw === "parent" || raw === "parents" || raw === "responsavel" || raw === "responsável") {
    return "parent";
  }

  if (raw === "teacher" || raw === "professor" || raw === "professores") {
    return "teacher";
  }

  if (
    raw === "staff" ||
    raw === "equipe" ||
    raw === "secretaria" ||
    raw === "coordenador" ||
    raw === "diretor" ||
    raw === "admin"
  ) {
    return "staff";
  }

  if (raw === "student" || raw === "aluno") {
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

function isUuidLike(value: unknown) {
  const s = clean(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function pickName(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text && !isUuidLike(text)) return text;
  }

  return "";
}

async function getMessageSchoolId(messageId: string, guardSchoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("school_messages")
    .select("id, school_id")
    .eq("id", messageId)
    .eq("school_id", guardSchoolId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    return null;
  }

  return String(data.school_id || guardSchoolId);
}

async function loadRecipients(messageId: string, schoolId: string): Promise<RecipientRow[]> {
  const primary = await supabaseAdmin
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
    .order("created_at", { ascending: true });

  if (!primary.error) {
    return (primary.data || []) as RecipientRow[];
  }

  const fallback = await supabaseAdmin
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
    .order("created_at", { ascending: true });

  if (fallback.error) {
    throw new Error(fallback.error.message || primary.error.message);
  }

  return (fallback.data || []) as RecipientRow[];
}

async function resolveParentNames(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "parent")
        .map((row) => clean(row.recipient_id || row.user_id))
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

  const { data } = await supabaseAdmin
    .from("parents")
    .select("id, user_id, full_name, name, phone, photo_url")
    .eq("school_id", schoolId)
    .or(`id.in.(${ids.join(",")}),user_id.in.(${ids.join(",")})`);

  for (const item of data || []) {
    const name = pickName((item as any).full_name, (item as any).name);
    const phone = clean((item as any).phone) || null;
    const photoUrl = clean((item as any).photo_url) || null;
    const userId = clean((item as any).user_id) || null;

    if ((item as any).id) {
      map.set(String((item as any).id), {
        name,
        phone,
        photoUrl,
        userId,
      });
    }

    if (userId) {
      map.set(userId, {
        name,
        phone,
        photoUrl,
        userId,
      });
    }
  }

  return map;
}

async function resolveTeacherNames(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "teacher")
        .map((row) => clean(row.recipient_id || row.user_id))
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

  const { data } = await supabaseAdmin
    .from("teachers")
    .select("id, user_id, full_name, name, phone, photo_url")
    .eq("school_id", schoolId)
    .or(`id.in.(${ids.join(",")}),user_id.in.(${ids.join(",")})`);

  for (const item of data || []) {
    const name = pickName((item as any).full_name, (item as any).name);
    const phone = clean((item as any).phone) || null;
    const photoUrl = clean((item as any).photo_url) || null;
    const userId = clean((item as any).user_id) || null;

    if ((item as any).id) {
      map.set(String((item as any).id), {
        name,
        phone,
        photoUrl,
        userId,
      });
    }

    if (userId) {
      map.set(userId, {
        name,
        phone,
        photoUrl,
        userId,
      });
    }
  }

  return map;
}

async function resolveStaffNames(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "staff")
        .map((row) => clean(row.recipient_id || row.user_id))
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

  const { data } = await supabaseAdmin
    .from("school_users")
    .select("id, user_id, full_name, name, role")
    .eq("school_id", schoolId)
    .or(`id.in.(${ids.join(",")}),user_id.in.(${ids.join(",")})`);

  for (const item of data || []) {
    const role = clean((item as any).role);
    const name = pickName((item as any).full_name, (item as any).name) || role || "Equipe escolar";
    const userId = clean((item as any).user_id) || null;

    if ((item as any).id) {
      map.set(String((item as any).id), {
        name,
        phone: null,
        photoUrl: null,
        userId,
      });
    }

    if (userId) {
      map.set(userId, {
        name,
        phone: null,
        photoUrl: null,
        userId,
      });
    }
  }

  return map;
}

async function resolveStudentNames(rows: RecipientRow[], schoolId: string) {
  const ids = Array.from(
    new Set(
      rows
        .filter((row) => normalizeType(row.recipient_type) === "student")
        .map((row) => clean(row.recipient_id || row.user_id))
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

  const { data } = await supabaseAdmin
    .from("students")
    .select("id, full_name, name, student_photo_url")
    .eq("school_id", schoolId)
    .in("id", ids);

  for (const item of data || []) {
    const name = pickName((item as any).full_name, (item as any).name);
    const photoUrl = clean((item as any).student_photo_url) || null;

    if ((item as any).id) {
      map.set(String((item as any).id), {
        name,
        phone: null,
        photoUrl,
        userId: null,
      });
    }
  }

  return map;
}

async function resolveAuthEmails(rows: RecipientRow[]) {
  const userIds = Array.from(
    new Set(
      rows
        .map((row) => clean(row.user_id))
        .filter(Boolean)
    )
  );

  const map = new Map<string, string>();

  for (const userId of userIds) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);

      const email = clean(data?.user?.email);
      if (email) {
        map.set(userId, email);
      }
    } catch {
      // Não quebra a rota se não conseguir buscar e-mail.
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

    if (!messageId) {
      return jsonError("ID do comunicado é obrigatório.", 400);
    }

    const schoolId = clean((guard as any).schoolId);

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    const messageSchoolId = await getMessageSchoolId(messageId, schoolId);

    if (!messageSchoolId) {
      return jsonError("Comunicado não encontrado.", 404);
    }

    const recipients = await loadRecipients(messageId, messageSchoolId);

    const [parentsMap, teachersMap, staffMap, studentsMap, emailsMap] = await Promise.all([
      resolveParentNames(recipients, messageSchoolId),
      resolveTeacherNames(recipients, messageSchoolId),
      resolveStaffNames(recipients, messageSchoolId),
      resolveStudentNames(recipients, messageSchoolId),
      resolveAuthEmails(recipients),
    ]);

    const resolved: ResolvedRecipient[] = recipients.map((row) => {
      const type = normalizeType(row.recipient_type);
      const mainId = clean(row.recipient_id);
      const userId = clean(row.user_id);
      const lookupKey = mainId || userId;

      let found:
        | {
            name: string;
            phone: string | null;
            photoUrl: string | null;
            userId: string | null;
          }
        | undefined;

      if (type === "parent") {
        found = parentsMap.get(lookupKey) || parentsMap.get(userId) || parentsMap.get(mainId);
      } else if (type === "teacher") {
        found = teachersMap.get(lookupKey) || teachersMap.get(userId) || teachersMap.get(mainId);
      } else if (type === "staff") {
        found = staffMap.get(lookupKey) || staffMap.get(userId) || staffMap.get(mainId);
      } else if (type === "student") {
        found = studentsMap.get(lookupKey) || studentsMap.get(mainId);
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

      return {
        ...row,
        recipient_type: type,
        recipientName: pickName(found?.name) || email || fallbackName,
        recipientEmail: email,
        recipientPhone: found?.phone || null,
        recipientPhotoUrl: found?.photoUrl || null,
        status: getStatus(row),
      };
    });

    const sentCount = resolved.length;
    const deliveredCount = resolved.filter((item) => item.delivered_at).length;
    const viewedCount = resolved.filter((item) => item.viewed_at).length;
    const pendingCount = resolved.filter((item) => !item.delivered_at && !item.viewed_at).length;

    return NextResponse.json({
      ok: true,
      recipients: resolved,
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