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

type RecipientFilter = "sent" | "delivered" | "read" | "pending" | "all";

type PersonResolved = {
  id: string;
  name: string;
  subtitle: string | null;
  type: string | null;
  source: string;
};

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function jsonError(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function lowerText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isUuidLike(value: unknown) {
  const raw = cleanText(value);

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
}

function normalizeFilter(value: unknown): RecipientFilter {
  const raw = lowerText(value);

  if (raw === "sent") return "sent";
  if (raw === "delivered") return "delivered";
  if (raw === "read" || raw === "visualized" || raw === "viewed") return "read";
  if (raw === "pending") return "pending";

  return "all";
}

function roleLabel(value: unknown) {
  const raw = lowerText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (raw === "diretor" || raw === "director" || raw === "diretora") return "Diretor";
  if (raw === "coordenador" || raw === "coordinator" || raw === "coordenadora") return "Coordenador";
  if (raw === "secretaria" || raw === "secretary" || raw === "secretario") return "Secretaria";
  if (raw === "professor" || raw === "teacher" || raw === "professora") return "Professor";
  if (raw === "responsavel" || raw === "parent" || raw === "guardian") return "Responsável";
  if (raw === "parents" || raw === "guardians") return "Responsável";
  if (raw === "teachers") return "Professor";
  if (raw === "coordinators") return "Coordenador";
  if (raw === "secretaries") return "Secretaria";
  if (raw === "staff" || raw === "school_staff" || raw === "school_user" || raw === "team") return "Equipe escolar";
  if (raw === "admin") return "Administrador";

  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Destinatário";
}

function normalizeRecipientType(value: unknown) {
  const raw = lowerText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (raw.includes("parent") || raw.includes("responsavel") || raw.includes("guardian")) {
    return "Responsável";
  }

  if (raw.includes("teacher") || raw.includes("professor")) {
    return "Professor";
  }

  if (raw.includes("coordenador") || raw.includes("coordinator")) {
    return "Coordenador";
  }

  if (raw.includes("secretaria") || raw.includes("secretary") || raw.includes("secretario")) {
    return "Secretaria";
  }

  if (raw.includes("diretor") || raw.includes("director")) {
    return "Diretor";
  }

  if (raw.includes("admin") || raw.includes("administrador")) {
    return "Administrador";
  }

  if (
    raw.includes("staff") ||
    raw.includes("school_user") ||
    raw.includes("school staff") ||
    raw.includes("equipe")
  ) {
    return "Equipe escolar";
  }

  if (raw) return roleLabel(raw);

  return "Destinatário";
}

function isGenericTypeLabel(value: unknown) {
  const raw = lowerText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return (
    raw === "usuario" ||
    raw === "user" ||
    raw === "destinatario" ||
    raw === "recipient" ||
    raw === "pessoa" ||
    raw === "person" ||
    raw === "staff" ||
    raw === "school_staff" ||
    raw === "school user" ||
    raw === "school_user" ||
    raw === "equipe" ||
    raw === "equipe escolar"
  );
}

function isUsefulName(value: unknown) {
  const raw = cleanText(value);

  if (!raw) return false;
  if (isUuidLike(raw)) return false;

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const blocked = new Set([
    "parent",
    "parents",
    "responsavel",
    "responsaveis",
    "guardian",
    "guardians",
    "teacher",
    "teachers",
    "professor",
    "professora",
    "professores",
    "staff",
    "school_staff",
    "school user",
    "school_user",
    "equipe",
    "equipe escolar",
    "coordenador",
    "coordenadora",
    "coordinator",
    "coordinators",
    "secretaria",
    "secretario",
    "secretary",
    "diretor",
    "diretora",
    "director",
    "usuario",
    "usuário",
    "user",
  ]);

  return !blocked.has(normalized);
}

function getFirstExisting(row: any, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];

    if (value !== undefined && value !== null && cleanText(value)) {
      return value;
    }
  }

  return null;
}

function getRecipientId(row: any) {
  return cleanText(
    getFirstExisting(row, [
      "recipient_id",
      "target_id",
      "person_id",
      "profile_id",
      "parent_id",
      "teacher_id",
      "staff_id",
      "school_user_id",
      "member_id",
      "user_id",
      "auth_user_id",
      "recipient_user_id",
      "to_user_id",
      "receiver_id",
      "target_user_id",
    ])
  );
}

function getRecipientUserId(row: any) {
  return cleanText(
    getFirstExisting(row, [
      "recipient_user_id",
      "user_id",
      "auth_user_id",
      "to_user_id",
      "receiver_id",
      "target_user_id",
    ])
  );
}

function getRecipientStoredName(row: any) {
  return cleanText(
    getFirstExisting(row, [
      "recipient_name",
      "name",
      "full_name",
      "display_name",
      "target_name",
      "person_name",
    ])
  );
}

function getRecipientStoredSubtitle(row: any) {
  return cleanText(
    getFirstExisting(row, [
      "recipient_email",
      "email",
      "phone",
      "recipient_phone",
      "subtitle",
      "description",
    ])
  );
}

function getRecipientTypeFromRow(row: any) {
  return normalizeRecipientType(
    getFirstExisting(row, [
      "recipient_type",
      "target_type",
      "type",
      "person_type",
      "role",
      "audience",
      "target_audience",
    ])
  );
}

function getDeliveredAt(row: any) {
  return (
    cleanText(
      getFirstExisting(row, [
        "delivered_at",
        "sent_at",
        "created_at",
        "deliveredAt",
        "sentAt",
      ])
    ) || null
  );
}

function getReadAt(row: any) {
  return (
    cleanText(
      getFirstExisting(row, [
        "read_at",
        "viewed_at",
        "visualized_at",
        "opened_at",
        "readAt",
        "viewedAt",
        "visualizedAt",
      ])
    ) || null
  );
}

function getCreatedAt(row: any) {
  return cleanText(getFirstExisting(row, ["created_at", "createdAt"])) || null;
}

function inferStatus(row: any) {
  const readAt = getReadAt(row);
  const deliveredAt = getDeliveredAt(row);
  const rawStatus = lowerText(row?.status);

  if (readAt) return "read";
  if (rawStatus === "read" || rawStatus === "visualized" || rawStatus === "viewed") return "read";

  if (deliveredAt) return "delivered";
  if (rawStatus === "delivered" || rawStatus === "sent") return "delivered";

  return "pending";
}

function shouldIncludeByFilter(row: any, filter: RecipientFilter) {
  if (filter === "all") return true;

  const status = inferStatus(row);
  const readAt = getReadAt(row);
  const deliveredAt = getDeliveredAt(row);

  if (filter === "read") return Boolean(readAt) || status === "read";
  if (filter === "delivered") return Boolean(deliveredAt) && !readAt;
  if (filter === "sent") return Boolean(deliveredAt) || status === "delivered" || status === "read";
  if (filter === "pending") return !deliveredAt && !readAt && status === "pending";

  return true;
}

function initials(name: string) {
  const safe = cleanText(name);

  if (!safe) return "DE";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function addResolved(
  map: Map<string, PersonResolved>,
  keys: Array<string | null | undefined>,
  person: PersonResolved
) {
  for (const key of keys) {
    const safeKey = cleanText(key);

    if (!safeKey) continue;

    const current = map.get(safeKey);

    if (current && isUsefulName(current.name) && !isUsefulName(person.name)) {
      continue;
    }

    if (current && isUsefulName(current.name) && isGenericTypeLabel(person.type)) {
      continue;
    }

    map.set(safeKey, person);
  }
}

function personFromRow(params: {
  row: any;
  source: string;
  fallbackType: string;
}) {
  const { row, source, fallbackType } = params;

  const id = cleanText(
    getFirstExisting(row, [
      "id",
      "user_id",
      "auth_user_id",
      "parent_id",
      "teacher_id",
      "school_user_id",
    ])
  );

  const name =
    cleanText(
      getFirstExisting(row, [
        "full_name",
        "name",
        "display_name",
        "nome",
        "title",
        "email",
        "phone",
      ])
    ) || id;

  const subtitle =
    cleanText(
      getFirstExisting(row, [
        "phone",
        "email",
        "cpf",
        "role",
        "registration_number",
      ])
    ) || null;

  const type =
    cleanText(
      getFirstExisting(row, [
        "role",
        "type",
        "recipient_type",
      ])
    ) || fallbackType;

  return {
    id,
    name,
    subtitle,
    type: roleLabel(type || fallbackType),
    source,
  };
}

async function trySelectAllByColumn(params: {
  table: string;
  column: string;
  values: string[];
  schoolId?: string;
}) {
  const { table, column, values, schoolId } = params;

  const cleanValues = Array.from(new Set(values.map(cleanText).filter(Boolean)));

  if (cleanValues.length === 0) return [];

  try {
    let query = supabaseAdmin
      .from(table as any)
      .select("*")
      .in(column, cleanValues);

    if (schoolId) {
      query = query.eq("school_id", schoolId);
    }

    const { data, error } = await query;

    if (error) return [];

    return data || [];
  } catch {
    return [];
  }
}

function getNameFromAuthUser(user: any) {
  const metadata = user?.user_metadata || {};
  const appMetadata = user?.app_metadata || {};

  const candidates = [
    metadata.full_name,
    metadata.fullName,
    metadata.name,
    metadata.display_name,
    metadata.displayName,
    metadata.nome,
    appMetadata.full_name,
    appMetadata.fullName,
    appMetadata.name,
    user?.email,
    user?.phone,
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate);

    if (isUsefulName(value)) {
      return value;
    }
  }

  return cleanText(user?.email) || "";
}

async function resolveAuthUsersByIds(userIds: string[]) {
  const cleanIds = Array.from(new Set(userIds.map(cleanText).filter(Boolean)));
  const map = new Map<string, any>();

  for (const userId of cleanIds) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

      if (!error && data?.user?.id) {
        map.set(data.user.id, data.user);
      }
    } catch {}
  }

  return map;
}

async function getSchoolUserRows(params: {
  ids: string[];
  userIds: string[];
  schoolId: string;
}) {
  const { ids, userIds, schoolId } = params;

  const byId = await trySelectAllByColumn({
    table: "school_users",
    column: "id",
    values: ids,
    schoolId,
  });

  const byUserId = await trySelectAllByColumn({
    table: "school_users",
    column: "user_id",
    values: userIds,
    schoolId,
  });

  const map = new Map<string, any>();

  for (const row of [...byId, ...byUserId]) {
    const key = cleanText(row?.id || row?.user_id || Math.random());
    map.set(key, row);
  }

  return Array.from(map.values());
}

async function resolvePeople(params: {
  rows: any[];
  schoolId: string;
}) {
  const { rows, schoolId } = params;

  const ids = new Set<string>();
  const directUserIds = new Set<string>();

  for (const row of rows) {
    const recipientId = getRecipientId(row);
    const recipientUserId = getRecipientUserId(row);

    if (recipientId) ids.add(recipientId);
    if (recipientUserId) directUserIds.add(recipientUserId);

    const possibleIds = [
      row?.id,
      row?.recipient_id,
      row?.target_id,
      row?.person_id,
      row?.profile_id,
      row?.parent_id,
      row?.teacher_id,
      row?.staff_id,
      row?.school_user_id,
      row?.member_id,
      row?.user_id,
      row?.auth_user_id,
      row?.recipient_user_id,
      row?.to_user_id,
      row?.receiver_id,
      row?.target_user_id,
    ];

    for (const value of possibleIds) {
      const safe = cleanText(value);
      if (safe) ids.add(safe);
    }
  }

  const allIds = Array.from(ids);
  const initialUserIds = Array.from(new Set([...Array.from(directUserIds), ...allIds]));

  const resolved = new Map<string, PersonResolved>();

  const schoolUserRows = await getSchoolUserRows({
    ids: allIds,
    userIds: initialUserIds,
    schoolId,
  });

  const schoolUserIds = schoolUserRows
    .map((row) => cleanText(row?.user_id || row?.auth_user_id))
    .filter(Boolean);

  const allUserIds = Array.from(new Set([...initialUserIds, ...schoolUserIds]));

  const parentRows = [
    ...(await trySelectAllByColumn({ table: "parents", column: "id", values: allIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "parents", column: "user_id", values: allUserIds, schoolId })),
  ];

  for (const row of parentRows) {
    const person = personFromRow({ row, source: "parents", fallbackType: "Responsável" });

    addResolved(
      resolved,
      [row?.id, row?.user_id, row?.auth_user_id],
      {
        ...person,
        type: "Responsável",
      }
    );
  }

  const teacherRows = [
    ...(await trySelectAllByColumn({ table: "teachers", column: "id", values: allIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "teachers", column: "user_id", values: allUserIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "teacher_profiles", column: "id", values: allIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "teacher_profiles", column: "user_id", values: allUserIds, schoolId })),
  ];

  for (const row of teacherRows) {
    const person = personFromRow({ row, source: "teachers", fallbackType: "Professor" });

    addResolved(
      resolved,
      [row?.id, row?.user_id, row?.auth_user_id, row?.teacher_user_id],
      {
        ...person,
        type: "Professor",
      }
    );
  }

  const staffRows = [
    ...(await trySelectAllByColumn({ table: "staff", column: "id", values: allIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "staff", column: "user_id", values: allUserIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "school_staff", column: "id", values: allIds, schoolId })),
    ...(await trySelectAllByColumn({ table: "school_staff", column: "user_id", values: allUserIds, schoolId })),
  ];

  for (const row of staffRows) {
    const role = roleLabel(row?.role);
    const person = personFromRow({ row, source: "staff", fallbackType: role });

    addResolved(
      resolved,
      [row?.id, row?.user_id, row?.auth_user_id],
      {
        ...person,
        type: role,
      }
    );
  }

  const profileRows = [
    ...(await trySelectAllByColumn({ table: "profiles", column: "id", values: allIds })),
    ...(await trySelectAllByColumn({ table: "profiles", column: "id", values: allUserIds })),
    ...(await trySelectAllByColumn({ table: "profiles", column: "user_id", values: allUserIds })),
    ...(await trySelectAllByColumn({ table: "user_profiles", column: "id", values: allIds })),
    ...(await trySelectAllByColumn({ table: "user_profiles", column: "id", values: allUserIds })),
    ...(await trySelectAllByColumn({ table: "user_profiles", column: "user_id", values: allUserIds })),
  ];

  for (const row of profileRows) {
    const person = personFromRow({ row, source: "profiles", fallbackType: "Usuário" });

    addResolved(
      resolved,
      [row?.id, row?.user_id, row?.auth_user_id],
      {
        ...person,
        type: isGenericTypeLabel(person.type) ? "Usuário" : person.type,
      }
    );
  }

  const authUsersMap = await resolveAuthUsersByIds(allUserIds);

  for (const row of schoolUserRows) {
    const role = roleLabel(row?.role);
    const schoolUserId = cleanText(row?.id);
    const userId = cleanText(row?.user_id || row?.auth_user_id);
    const authUser = userId ? authUsersMap.get(userId) : null;

    const existingFromProfiles = userId ? resolved.get(userId) : null;

    const nameFromRow = cleanText(
      getFirstExisting(row, [
        "full_name",
        "name",
        "display_name",
        "email",
      ])
    );

    const nameFromProfile =
      existingFromProfiles && isUsefulName(existingFromProfiles.name)
        ? existingFromProfiles.name
        : "";

    const nameFromAuth = getNameFromAuthUser(authUser);

    const finalName =
      (isUsefulName(nameFromProfile) ? nameFromProfile : "") ||
      (isUsefulName(nameFromRow) ? nameFromRow : "") ||
      (isUsefulName(nameFromAuth) ? nameFromAuth : "") ||
      cleanText(authUser?.email) ||
      role;

    const subtitle =
      existingFromProfiles?.subtitle ||
      cleanText(row?.email) ||
      cleanText(authUser?.email) ||
      role;

    const person: PersonResolved = {
      id: schoolUserId || userId,
      name: finalName,
      subtitle,
      type: role,
      source: "school_users",
    };

    addResolved(
      resolved,
      [schoolUserId, userId, row?.auth_user_id],
      person
    );
  }

  for (const [userId, authUser] of authUsersMap.entries()) {
    const authName = getNameFromAuthUser(authUser);

    if (!authName) continue;

    addResolved(
      resolved,
      [userId],
      {
        id: userId,
        name: authName,
        subtitle: cleanText(authUser?.email) || null,
        type: "Usuário",
        source: "auth.users",
      }
    );
  }

  return resolved;
}

async function getMessage(messageId: string, schoolId: string) {
  const tables = ["school_messages", "messages", "public_school_messages"];

  for (const table of tables) {
    try {
      const { data, error } = await supabaseAdmin
        .from(table as any)
        .select("*")
        .eq("id", messageId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (!error && data?.id) {
        return {
          table,
          message: data,
        };
      }
    } catch {}
  }

  return null;
}

async function getRecipientRows(messageId: string, schoolId: string) {
  const tables = [
    "message_recipients",
    "school_message_recipients",
    "communication_recipients",
  ];

  for (const table of tables) {
    try {
      let query = supabaseAdmin
        .from(table as any)
        .select("*");

      try {
        query = query.eq("message_id", messageId);
      } catch {
        query = query.eq("school_message_id", messageId);
      }

      try {
        query = query.eq("school_id", schoolId);
      } catch {}

      const { data, error } = await query;

      if (!error && Array.isArray(data)) {
        return {
          table,
          rows: data,
        };
      }
    } catch {}
  }

  return {
    table: null,
    rows: [],
  };
}

function chooseDisplayType(params: {
  rowType: string;
  resolvedType?: string | null;
}) {
  const { rowType, resolvedType } = params;

  const safeResolved = cleanText(resolvedType);
  const safeRow = cleanText(rowType);

  if (safeResolved && !isGenericTypeLabel(safeResolved)) {
    return safeResolved;
  }

  if (safeRow && !isGenericTypeLabel(safeRow) && safeRow !== "Destinatário") {
    return safeRow;
  }

  if (safeResolved) return safeResolved;

  return safeRow || "Destinatário";
}

function buildRecipientOutput(params: {
  row: any;
  resolvedPeople: Map<string, PersonResolved>;
}) {
  const { row, resolvedPeople } = params;

  const recipientId = getRecipientId(row);
  const recipientUserId = getRecipientUserId(row);
  const storedName = getRecipientStoredName(row);
  const storedSubtitle = getRecipientStoredSubtitle(row);
  const rowType = getRecipientTypeFromRow(row);

  const lookupKeys = [
    recipientId,
    recipientUserId,
    row?.id,
    row?.recipient_id,
    row?.target_id,
    row?.person_id,
    row?.profile_id,
    row?.parent_id,
    row?.teacher_id,
    row?.staff_id,
    row?.school_user_id,
    row?.member_id,
    row?.user_id,
    row?.auth_user_id,
    row?.recipient_user_id,
    row?.to_user_id,
    row?.receiver_id,
    row?.target_user_id,
  ]
    .map(cleanText)
    .filter(Boolean);

  let resolved: PersonResolved | null = null;

  for (const key of lookupKeys) {
    const found = resolvedPeople.get(key);

    if (found?.name && isUsefulName(found.name)) {
      resolved = found;
      break;
    }
  }

  const displayName =
    (resolved?.name && isUsefulName(resolved.name) ? resolved.name : "") ||
    (isUsefulName(storedName) ? storedName : "") ||
    (recipientId && !isUuidLike(recipientId) && isUsefulName(recipientId) ? recipientId : "") ||
    rowType ||
    "Destinatário";

  const displayType = chooseDisplayType({
    rowType,
    resolvedType: resolved?.type,
  });

  const subtitle =
    resolved?.subtitle ||
    storedSubtitle ||
    (recipientId && isUuidLike(recipientId) ? recipientId : null);

  const deliveredAt = getDeliveredAt(row);
  const readAt = getReadAt(row);
  const createdAt = getCreatedAt(row);
  const status = inferStatus(row);

  return {
    id: cleanText(row?.id) || `${recipientId || recipientUserId || displayName}-${createdAt || ""}`,
    recipientId: recipientId || null,
    recipientUserId: recipientUserId || null,

    name: displayName,
    displayName,
    fullName: displayName,
    recipientName: displayName,

    initials: initials(displayName),

    type: displayType,
    recipientType: displayType,

    subtitle,
    phone: cleanText(row?.phone) || null,
    email: cleanText(row?.email) || null,

    status,
    deliveredAt,
    readAt,
    createdAt,

    delivered_at: deliveredAt,
    read_at: readAt,
    created_at: createdAt,

    rawType: rowType,
    source: resolved?.source || "message_recipients",
  };
}

export async function GET(req: Request, context: RouteContext) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "secretaria",
    "secretary",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const { id } = await context.params;
    const messageId = cleanText(id);
    const schoolId = guard.schoolId;

    if (!messageId) {
      return jsonError("ID do comunicado é obrigatório.", 400);
    }

    const url = new URL(req.url);
    const filter = normalizeFilter(url.searchParams.get("filter"));

    const foundMessage = await getMessage(messageId, schoolId);

    if (!foundMessage?.message?.id) {
      return jsonError("Comunicado não encontrado.", 404);
    }

    const { rows, table } = await getRecipientRows(messageId, schoolId);

    const filteredRows = rows.filter((row) => shouldIncludeByFilter(row, filter));

    const resolvedPeople = await resolvePeople({
      rows: filteredRows,
      schoolId,
    });

    const recipients = filteredRows.map((row) =>
      buildRecipientOutput({
        row,
        resolvedPeople,
      })
    );

    const sentCount = rows.filter((row) => {
      const deliveredAt = getDeliveredAt(row);
      const readAt = getReadAt(row);
      const status = inferStatus(row);

      return Boolean(deliveredAt) || Boolean(readAt) || status === "delivered" || status === "read";
    }).length;

    const deliveredCount = rows.filter((row) => {
      const deliveredAt = getDeliveredAt(row);
      const readAt = getReadAt(row);

      return Boolean(deliveredAt) && !readAt;
    }).length;

    const readCount = rows.filter((row) => Boolean(getReadAt(row))).length;

    const pendingCount = rows.filter((row) => {
      const deliveredAt = getDeliveredAt(row);
      const readAt = getReadAt(row);
      const status = inferStatus(row);

      return !deliveredAt && !readAt && status === "pending";
    }).length;

    return jsonOk({
      filter,
      message: {
        id: foundMessage.message.id,
        title:
          cleanText(foundMessage.message.title) ||
          cleanText(foundMessage.message.subject) ||
          "Comunicado",
        content:
          cleanText(foundMessage.message.content) ||
          cleanText(foundMessage.message.body) ||
          cleanText(foundMessage.message.message) ||
          "",
        createdAt:
          cleanText(foundMessage.message.created_at) ||
          cleanText(foundMessage.message.createdAt) ||
          null,
      },
      counts: {
        total: rows.length,
        sent: sentCount,
        delivered: deliveredCount,
        read: readCount,
        pending: pendingCount,
      },
      recipients,
      debug: {
        messageTable: foundMessage.table,
        recipientsTable: table,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/school/messages/[id]/recipients]", e);

    return jsonError(e?.message || "Erro interno ao carregar destinatários.", 500);
  }
}