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

type AnyRow = Record<string, any>;

type ResolvedPerson = {
  name: string;
  phone: string | null;
  photoUrl: string | null;
  email: string | null;
  typeLabel: string;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function isUuidLike(value: unknown) {
  const s = clean(value);

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

function pickFirst(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }

  return "";
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

function normalizeType(value: unknown) {
  const raw = clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    raw === "parent" ||
    raw === "parents" ||
    raw === "responsavel" ||
    raw === "responsaveis" ||
    raw === "guardian" ||
    raw === "guardians"
  ) {
    return "parent";
  }

  if (
    raw === "teacher" ||
    raw === "teachers" ||
    raw === "professor" ||
    raw === "professores"
  ) {
    return "teacher";
  }

  if (
    raw === "staff" ||
    raw === "equipe" ||
    raw === "team" ||
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

  if (
    raw === "student" ||
    raw === "students" ||
    raw === "aluno" ||
    raw === "alunos"
  ) {
    return "student";
  }

  return raw || "recipient";
}

function getRecipientType(row: AnyRow) {
  return normalizeType(
    row.recipient_type ??
      row.recipientType ??
      row.type ??
      row.target_type ??
      row.targetType ??
      row.audience_type ??
      row.audienceType ??
      row.receiver_type ??
      row.receiverType ??
      row.destination_type ??
      row.destinationType
  );
}

function getDeliveredAt(row: AnyRow) {
  return (
    clean(row.delivered_at) ||
    clean(row.deliveredAt) ||
    clean(row.sent_at) ||
    clean(row.sentAt) ||
    clean(row.created_at) ||
    clean(row.createdAt) ||
    null
  );
}

function getViewedAt(row: AnyRow) {
  return (
    clean(row.viewed_at) ||
    clean(row.viewedAt) ||
    clean(row.read_at) ||
    clean(row.readAt) ||
    clean(row.opened_at) ||
    clean(row.openedAt) ||
    null
  );
}

function getCreatedAt(row: AnyRow) {
  return clean(row.created_at) || clean(row.createdAt) || null;
}

function getStatus(row: AnyRow): RecipientStatus {
  const viewedAt = getViewedAt(row);
  const deliveredAt = getDeliveredAt(row);
  const createdAt = getCreatedAt(row);

  if (viewedAt) return "viewed";
  if (deliveredAt) return "delivered";
  if (createdAt) return "sent";

  return "pending";
}

function statusMatchesFilter(row: AnyRow, filter: string) {
  const normalizedFilter = clean(filter).toLowerCase();

  if (!normalizedFilter || normalizedFilter === "all" || normalizedFilter === "todos") {
    return true;
  }

  const viewedAt = getViewedAt(row);
  const deliveredAt = getDeliveredAt(row);

  if (normalizedFilter === "sent" || normalizedFilter === "enviado") {
    return true;
  }

  if (
    normalizedFilter === "delivered" ||
    normalizedFilter === "entregue" ||
    normalizedFilter === "entregues"
  ) {
    return Boolean(deliveredAt) && !viewedAt;
  }

  if (
    normalizedFilter === "viewed" ||
    normalizedFilter === "visualizado" ||
    normalizedFilter === "visualizados"
  ) {
    return Boolean(viewedAt);
  }

  if (
    normalizedFilter === "pending" ||
    normalizedFilter === "pendente" ||
    normalizedFilter === "pendentes"
  ) {
    return !deliveredAt && !viewedAt;
  }

  return true;
}

function getCandidateIds(row: AnyRow) {
  const ids = [
    row.recipient_id,
    row.recipientId,
    row.target_id,
    row.targetId,
    row.receiver_id,
    row.receiverId,
    row.destination_id,
    row.destinationId,
    row.parent_id,
    row.parentId,
    row.responsible_id,
    row.responsibleId,
    row.guardian_id,
    row.guardianId,
    row.teacher_id,
    row.teacherId,
    row.student_id,
    row.studentId,
    row.profile_id,
    row.profileId,
    row.person_id,
    row.personId,
    row.user_id,
    row.userId,
    row.auth_user_id,
    row.authUserId,
    row.recipient_user_id,
    row.recipientUserId,
    row.target_user_id,
    row.targetUserId,
  ]
    .map(clean)
    .filter(Boolean);

  return Array.from(new Set(ids));
}

function getPrimaryRecipientId(row: AnyRow) {
  return pickFirst(
    row.recipient_id,
    row.recipientId,
    row.target_id,
    row.targetId,
    row.receiver_id,
    row.receiverId,
    row.destination_id,
    row.destinationId,
    row.parent_id,
    row.parentId,
    row.responsible_id,
    row.responsibleId,
    row.guardian_id,
    row.guardianId,
    row.teacher_id,
    row.teacherId,
    row.student_id,
    row.studentId,
    row.profile_id,
    row.profileId,
    row.person_id,
    row.personId,
    row.user_id,
    row.userId,
    row.auth_user_id,
    row.authUserId,
    row.recipient_user_id,
    row.recipientUserId,
    row.target_user_id,
    row.targetUserId
  );
}

function getPossibleUserIds(row: AnyRow) {
  const ids = [
    row.user_id,
    row.userId,
    row.auth_user_id,
    row.authUserId,
    row.recipient_user_id,
    row.recipientUserId,
    row.target_user_id,
    row.targetUserId,
  ]
    .map(clean)
    .filter(Boolean);

  return Array.from(new Set(ids));
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

function fallbackLabelForType(type: string) {
  if (type === "parent") return "Responsável não identificado";
  if (type === "teacher") return "Professor(a) não identificado";
  if (type === "staff") return "Equipe escolar não identificada";
  if (type === "student") return "Aluno(a) não identificado";

  return "Destinatário não identificado";
}

async function loadMessageTitle(messageId: string, schoolId: string) {
  const attempts = [
    supabaseAdmin
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .eq("school_id", schoolId)
      .maybeSingle(),

    supabaseAdmin
      .from("school_messages")
      .select("*")
      .eq("id", messageId)
      .eq("school_id", schoolId)
      .maybeSingle(),

    supabaseAdmin
      .from("public_school_messages")
      .select("*")
      .eq("id", messageId)
      .eq("school_id", schoolId)
      .maybeSingle(),
  ];

  for (const query of attempts) {
    const { data, error } = await query;

    if (!error && data) {
      return pickName(
        (data as AnyRow).title,
        (data as AnyRow).subject,
        (data as AnyRow).message_title,
        (data as AnyRow).content
      );
    }
  }

  return "";
}

async function loadRecipients(messageId: string, schoolId: string) {
  const attempts = [
    supabaseAdmin
      .from("message_recipients")
      .select("*")
      .eq("message_id", messageId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("school_message_recipients")
      .select("*")
      .eq("message_id", messageId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("message_deliveries")
      .select("*")
      .eq("message_id", messageId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("school_message_deliveries")
      .select("*")
      .eq("message_id", messageId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true }),
  ];

  let lastError: any = null;

  for (const query of attempts) {
    const { data, error } = await query;

    if (!error) {
      return (data || []) as AnyRow[];
    }

    lastError = error;
  }

  throw new Error(lastError?.message || "Não foi possível carregar destinatários.");
}

async function safeSelectById(params: {
  table: string;
  schoolId: string;
  ids: string[];
}) {
  const { table, schoolId, ids } = params;

  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("school_id", schoolId)
    .in("id", ids);

  if (error) return [];

  return (data || []) as AnyRow[];
}

async function safeSelectByUserId(params: {
  table: string;
  schoolId: string;
  ids: string[];
}) {
  const { table, schoolId, ids } = params;

  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("school_id", schoolId)
    .in("user_id", ids);

  if (error) return [];

  return (data || []) as AnyRow[];
}

async function loadAllParentsFallback(schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("parents")
    .select("*")
    .eq("school_id", schoolId)
    .limit(2000);

  if (error) return [];

  return (data || []) as AnyRow[];
}

async function resolveParents(rows: AnyRow[], schoolId: string) {
  const parentRows = rows.filter((row) => getRecipientType(row) === "parent");

  const ids = Array.from(
    new Set(parentRows.flatMap(getCandidateIds).filter(Boolean))
  );

  const map = new Map<string, ResolvedPerson>();

  const [byId, byUserId, allParents] = await Promise.all([
    safeSelectById({ table: "parents", schoolId, ids }),
    safeSelectByUserId({ table: "parents", schoolId, ids }),
    loadAllParentsFallback(schoolId),
  ]);

  for (const item of [...byId, ...byUserId, ...allParents]) {
    const id = clean(item.id);
    const userId = clean(item.user_id);
    const authUserId = clean(item.auth_user_id);
    const profileId = clean(item.profile_id);

    const name =
      pickName(
        item.full_name,
        item.fullName,
        item.name,
        item.nome,
        item.parent_name,
        item.parentName,
        item.responsible_name,
        item.responsibleName,
        item.guardian_name,
        item.guardianName,
        item.display_name,
        item.displayName
      ) || "Responsável";

    const phone = clean(item.phone || item.telefone || item.whatsapp) || null;
    const photoUrl =
      clean(item.photo_url || item.photoUrl || item.avatar_url || item.profile_photo_url) ||
      null;
    const email = clean(item.email) || null;

    const payload: ResolvedPerson = {
      name,
      phone,
      photoUrl,
      email,
      typeLabel: "Responsável",
    };

    if (id) map.set(id, payload);
    if (userId) map.set(userId, payload);
    if (authUserId) map.set(authUserId, payload);
    if (profileId) map.set(profileId, payload);
  }

  return map;
}

async function resolveTeachers(rows: AnyRow[], schoolId: string) {
  const teacherRows = rows.filter((row) => getRecipientType(row) === "teacher");

  const ids = Array.from(
    new Set(teacherRows.flatMap(getCandidateIds).filter(Boolean))
  );

  const map = new Map<string, ResolvedPerson>();

  if (ids.length === 0) return map;

  const [byId, byUserId] = await Promise.all([
    safeSelectById({ table: "teachers", schoolId, ids }),
    safeSelectByUserId({ table: "teachers", schoolId, ids }),
  ]);

  for (const item of [...byId, ...byUserId]) {
    const id = clean(item.id);
    const userId = clean(item.user_id);
    const authUserId = clean(item.auth_user_id);

    const name =
      pickName(
        item.full_name,
        item.fullName,
        item.name,
        item.nome,
        item.teacher_name,
        item.teacherName,
        item.display_name,
        item.displayName
      ) || "Professor(a)";

    const phone = clean(item.phone || item.telefone || item.whatsapp) || null;
    const photoUrl =
      clean(item.photo_url || item.photoUrl || item.avatar_url || item.profile_photo_url) ||
      null;
    const email = clean(item.email) || null;

    const payload: ResolvedPerson = {
      name,
      phone,
      photoUrl,
      email,
      typeLabel: "Professor(a)",
    };

    if (id) map.set(id, payload);
    if (userId) map.set(userId, payload);
    if (authUserId) map.set(authUserId, payload);
  }

  return map;
}

async function resolveStudents(rows: AnyRow[], schoolId: string) {
  const studentRows = rows.filter((row) => getRecipientType(row) === "student");

  const ids = Array.from(
    new Set(studentRows.flatMap(getCandidateIds).filter(Boolean))
  );

  const map = new Map<string, ResolvedPerson>();

  if (ids.length === 0) return map;

  const byId = await safeSelectById({ table: "students", schoolId, ids });

  for (const item of byId) {
    const id = clean(item.id);

    const name =
      pickName(
        item.full_name,
        item.fullName,
        item.name,
        item.nome,
        item.student_name,
        item.studentName
      ) || "Aluno(a)";

    const photoUrl =
      clean(item.student_photo_url || item.studentPhotoUrl || item.photo_url || item.avatar_url) ||
      null;

    const payload: ResolvedPerson = {
      name,
      phone: null,
      photoUrl,
      email: null,
      typeLabel: "Aluno(a)",
    };

    if (id) map.set(id, payload);
  }

  return map;
}

async function resolveStaff(rows: AnyRow[], schoolId: string) {
  const staffRows = rows.filter((row) => getRecipientType(row) === "staff");

  const ids = Array.from(
    new Set(staffRows.flatMap(getCandidateIds).filter(Boolean))
  );

  const map = new Map<string, ResolvedPerson>();

  if (ids.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("*")
    .eq("school_id", schoolId)
    .in("user_id", ids);

  if (!error) {
    for (const item of data || []) {
      const row = item as AnyRow;

      const id = clean(row.id);
      const userId = clean(row.user_id);
      const role = clean(row.role).toLowerCase();

      const name =
        pickName(row.full_name, row.fullName, row.name, row.display_name, row.displayName) ||
        (role === "diretor"
          ? "Diretor(a)"
          : role === "coordenador"
            ? "Coordenador(a)"
            : role === "secretaria"
              ? "Secretaria"
              : role === "admin"
                ? "Administrador"
                : "Equipe escolar");

      const payload: ResolvedPerson = {
        name,
        phone: null,
        photoUrl: null,
        email: null,
        typeLabel: "Equipe escolar",
      };

      if (id) map.set(id, payload);
      if (userId) map.set(userId, payload);
    }
  }

  return map;
}

async function resolveAuthEmails(rows: AnyRow[]) {
  const ids = Array.from(new Set(rows.flatMap(getPossibleUserIds).filter(Boolean)));

  const map = new Map<string, string>();

  for (const userId of ids) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = clean(data?.user?.email);

      if (email) {
        map.set(userId, email);
      }
    } catch {
      // não quebra a listagem por causa de e-mail
    }
  }

  return map;
}

function findResolved(
  row: AnyRow,
  maps: Array<Map<string, ResolvedPerson>>
) {
  const keys = getCandidateIds(row);

  for (const key of keys) {
    for (const map of maps) {
      const found = map.get(key);
      if (found) return found;
    }
  }

  return null;
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

    const [messageTitle, allRecipients] = await Promise.all([
      loadMessageTitle(messageId, schoolId),
      loadRecipients(messageId, schoolId),
    ]);

    const filteredRecipients = allRecipients.filter((row) =>
      statusMatchesFilter(row, filter)
    );

    const [parentsMap, teachersMap, studentsMap, staffMap, emailsMap] =
      await Promise.all([
        resolveParents(filteredRecipients, schoolId),
        resolveTeachers(filteredRecipients, schoolId),
        resolveStudents(filteredRecipients, schoolId),
        resolveStaff(filteredRecipients, schoolId),
        resolveAuthEmails(filteredRecipients),
      ]);

    const recipients = filteredRecipients.map((row) => {
      const type = getRecipientType(row);
      const resolved = findResolved(row, [parentsMap, teachersMap, studentsMap, staffMap]);

      const userIds = getPossibleUserIds(row);
      const emailFromAuth =
        userIds.map((id) => emailsMap.get(id)).find(Boolean) || null;

      const explicitName = pickName(
        row.recipient_name,
        row.recipientName,
        row.name,
        row.full_name,
        row.fullName,
        row.display_name,
        row.displayName
      );

      const fallbackName = fallbackLabelForType(type);

      const name =
        pickName(explicitName, resolved?.name, resolved?.email, emailFromAuth) ||
        fallbackName;

      const deliveredAt = getDeliveredAt(row);
      const viewedAt = getViewedAt(row);
      const createdAt = getCreatedAt(row);
      const recipientId = getPrimaryRecipientId(row);
      const avatarInitials = initials(name);

      return {
        id: clean(row.id) || recipientId,
        message_id: clean(row.message_id || row.messageId) || messageId,
        messageId,
        school_id: clean(row.school_id || row.schoolId) || schoolId,
        schoolId,

        recipient_type: type,
        recipientType: type,

        recipient_id: recipientId,
        recipientId,

        recipient_name: name,
        recipientName: name,

        name,
        full_name: name,
        fullName: name,
        display_name: name,
        displayName: name,
        label: name,
        title: name,

        recipient_email: resolved?.email || emailFromAuth,
        recipientEmail: resolved?.email || emailFromAuth,
        email: resolved?.email || emailFromAuth,

        recipient_phone: resolved?.phone || null,
        recipientPhone: resolved?.phone || null,
        phone: resolved?.phone || null,

        recipient_photo_url: resolved?.photoUrl || null,
        recipientPhotoUrl: resolved?.photoUrl || null,
        photo_url: resolved?.photoUrl || null,
        photoUrl: resolved?.photoUrl || null,

        recipient_initials: avatarInitials,
        recipientInitials: avatarInitials,
        initials: avatarInitials,

        type_label: resolved?.typeLabel || fallbackName,
        typeLabel: resolved?.typeLabel || fallbackName,

        delivered_at: deliveredAt,
        deliveredAt,

        viewed_at: viewedAt,
        viewedAt,

        created_at: createdAt,
        createdAt,

        status: getStatus(row),

        raw: row,
      };
    });

    const sentCount = allRecipients.length;

    const deliveredCount = allRecipients.filter((item) => {
      const deliveredAt = getDeliveredAt(item);
      const viewedAt = getViewedAt(item);

      return Boolean(deliveredAt) && !viewedAt;
    }).length;

    const viewedCount = allRecipients.filter((item) => Boolean(getViewedAt(item))).length;

    const pendingCount = allRecipients.filter((item) => {
      const deliveredAt = getDeliveredAt(item);
      const viewedAt = getViewedAt(item);

      return !deliveredAt && !viewedAt;
    }).length;

    return NextResponse.json({
      ok: true,
      message: {
        id: messageId,
        title: messageTitle,
      },
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