import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AudienceType =
  | "school"
  | "all_parents"
  | "parent_individual"
  | "class"
  | "teachers"
  | "teachers_class"
  | "teacher_class"
  | "teacher_individual"
  | "coordinators"
  | "secretaria"
  | "staff";

type RecipientRow = {
  recipient_type: string;
  recipient_id: string;
};

type SchoolUserRow = {
  user_id: string | null;
  role: string | null;
  is_active?: boolean | null;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      ...extra,
    },
    { status }
  );
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      ...body,
    },
    { status }
  );
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

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin" || r === "administrador") return "admin";

  return r;
}

function normalizeAudienceType(type?: string | null): AudienceType {
  const safe = String(type || "school")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (safe === "teacher_class") return "teachers_class";
  if (safe === "parents") return "all_parents";
  if (safe === "parent") return "parent_individual";
  if (safe === "pais") return "all_parents";
  if (safe === "responsaveis") return "all_parents";
  if (safe === "responsavel_individual") return "parent_individual";
  if (safe === "professores") return "teachers";
  if (safe === "professor_individual") return "teacher_individual";
  if (safe === "professores_turma") return "teachers_class";
  if (safe === "coordenadores") return "coordinators";
  if (safe === "coordenador") return "coordinators";
  if (safe === "secretarias") return "secretaria";
  if (safe === "equipe") return "staff";
  if (safe === "equipe_escolar") return "staff";

  const allowed = new Set([
    "school",
    "all_parents",
    "parent_individual",
    "class",
    "teachers",
    "teachers_class",
    "teacher_individual",
    "coordinators",
    "secretaria",
    "staff",
  ]);

  return allowed.has(safe) ? (safe as AudienceType) : "school";
}

function isParentAudience(type: AudienceType) {
  return (
    type === "school" ||
    type === "all_parents" ||
    type === "parent_individual" ||
    type === "class"
  );
}

function isStaffAudience(type: AudienceType) {
  return (
    type === "teachers" ||
    type === "teachers_class" ||
    type === "teacher_individual" ||
    type === "coordinators" ||
    type === "secretaria" ||
    type === "staff"
  );
}

function dedupeRecipients(recipients: RecipientRow[]) {
  const map = new Map<string, RecipientRow>();

  for (const rec of recipients) {
    const type = cleanText(rec.recipient_type);
    const id = cleanText(rec.recipient_id);

    if (!type || !id) continue;

    map.set(`${type}:${id}`, {
      recipient_type: type,
      recipient_id: id,
    });
  }

  return Array.from(map.values());
}

async function getStaffFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      status: 401,
      error: "Sessão inválida.",
    };
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

  const canCreate =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canCreate) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para publicar comunicados.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

async function getActiveSchoolUsers(schoolId: string): Promise<SchoolUserRow[]> {
  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("user_id, role, is_active")
    .eq("school_id", schoolId)
    .eq("is_active", true);

  if (error) {
    throw new Error("Erro ao buscar equipe escolar: " + error.message);
  }

  return (data || []) as SchoolUserRow[];
}

async function resolveParentId(params: {
  schoolId: string;
  targetParentId: string;
}) {
  const { schoolId, targetParentId } = params;

  if (!targetParentId) return "";

  const target = cleanText(targetParentId);

  const byParentId = await supabaseAdmin
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("id", target)
    .maybeSingle();

  if (!byParentId.error && byParentId.data?.id) {
    return String(byParentId.data.id);
  }

  const byUserId = await supabaseAdmin
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", target)
    .maybeSingle();

  if (!byUserId.error && byUserId.data?.id) {
    return String(byUserId.data.id);
  }

  const byProfileId = await supabaseAdmin
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("profile_id", target)
    .maybeSingle();

  if (!byProfileId.error && byProfileId.data?.id) {
    return String(byProfileId.data.id);
  }

  return "";
}

async function resolveTeacherUserId(params: {
  schoolId: string;
  targetTeacherUserId: string;
}) {
  const { schoolId, targetTeacherUserId } = params;

  const target = cleanText(targetTeacherUserId);

  if (!target) return "";

  const schoolUsers = await getActiveSchoolUsers(schoolId);

  const direct = schoolUsers.find((row) => {
    return String(row.user_id || "") === target && normalizeRole(row.role) === "professor";
  });

  if (direct?.user_id) {
    return String(direct.user_id);
  }

  const activeUser = schoolUsers.find((row) => String(row.user_id || "") === target);

  if (activeUser?.user_id && normalizeRole(activeUser.role) === "professor") {
    return String(activeUser.user_id);
  }

  try {
    const { data: teacherById } = await supabaseAdmin
      .from("teachers")
      .select("id, user_id, teacher_user_id, school_id")
      .eq("school_id", schoolId)
      .eq("id", target)
      .maybeSingle();

    const found =
      cleanText((teacherById as any)?.user_id) ||
      cleanText((teacherById as any)?.teacher_user_id);

    if (found) {
      const matched = schoolUsers.find((row) => {
        return String(row.user_id || "") === found && normalizeRole(row.role) === "professor";
      });

      if (matched?.user_id) return String(matched.user_id);
    }
  } catch {
    // Algumas bases não têm tabela teachers. Segue para os próximos fallbacks.
  }

  try {
    const { data: teacherByUserId } = await supabaseAdmin
      .from("teachers")
      .select("id, user_id, teacher_user_id, school_id")
      .eq("school_id", schoolId)
      .or(`user_id.eq.${target},teacher_user_id.eq.${target}`)
      .maybeSingle();

    const found =
      cleanText((teacherByUserId as any)?.user_id) ||
      cleanText((teacherByUserId as any)?.teacher_user_id);

    if (found) {
      const matched = schoolUsers.find((row) => {
        return String(row.user_id || "") === found && normalizeRole(row.role) === "professor";
      });

      if (matched?.user_id) return String(matched.user_id);
    }
  } catch {
    // Ignora fallback caso a tabela/colunas não existam.
  }

  return "";
}

async function getParentRecipients(params: {
  schoolId: string;
  audienceType: AudienceType;
  targetClassId: string;
  targetParentId: string;
}): Promise<RecipientRow[]> {
  const { schoolId, audienceType, targetClassId, targetParentId } = params;

  if (audienceType === "parent_individual") {
    const parentId = await resolveParentId({
      schoolId,
      targetParentId,
    });

    if (!parentId) {
      throw new Error("Responsável individual não encontrado nesta escola.");
    }

    return [
      {
        recipient_type: "parent",
        recipient_id: parentId,
      },
    ];
  }

  if (audienceType === "class") {
    if (!targetClassId) {
      throw new Error("Selecione a turma.");
    }

    const { data: studentLinks, error: studentLinksErr } = await supabaseAdmin
      .from("student_classes")
      .select("student_id")
      .eq("school_id", schoolId)
      .eq("class_id", targetClassId)
      .eq("is_active", true);

    if (studentLinksErr) {
      throw new Error("Erro ao buscar alunos da turma: " + studentLinksErr.message);
    }

    const studentIds = Array.from(
      new Set((studentLinks || []).map((row: any) => String(row.student_id)).filter(Boolean))
    );

    if (studentIds.length === 0) {
      return [];
    }

    const { data: parentLinks, error: parentLinksErr } = await supabaseAdmin
      .from("student_parents")
      .select("parent_id")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .in("student_id", studentIds);

    if (parentLinksErr) {
      throw new Error("Erro ao buscar responsáveis da turma: " + parentLinksErr.message);
    }

    const parentIds = Array.from(
      new Set((parentLinks || []).map((row: any) => String(row.parent_id)).filter(Boolean))
    );

    return parentIds.map((id) => ({
      recipient_type: "parent",
      recipient_id: id,
    }));
  }

  const { data: parents, error } = await supabaseAdmin
    .from("parents")
    .select("id")
    .eq("school_id", schoolId);

  if (error) {
    throw new Error("Erro ao buscar responsáveis: " + error.message);
  }

  return (parents || []).map((parent: any) => ({
    recipient_type: "parent",
    recipient_id: String(parent.id),
  }));
}

async function getStaffRecipients(params: {
  schoolId: string;
  audienceType: AudienceType;
  targetClassId: string;
  targetTeacherUserId: string;
}): Promise<RecipientRow[]> {
  const { schoolId, audienceType, targetClassId, targetTeacherUserId } = params;

  const schoolUsers = await getActiveSchoolUsers(schoolId);

  if (audienceType === "teacher_individual") {
    const teacherUserId = await resolveTeacherUserId({
      schoolId,
      targetTeacherUserId,
    });

    if (!teacherUserId) {
      throw new Error("Professor individual não encontrado nesta escola.");
    }

    return [
      {
        recipient_type: "staff",
        recipient_id: teacherUserId,
      },
    ];
  }

  if (audienceType === "teachers_class") {
    if (!targetClassId) {
      throw new Error("Selecione a turma.");
    }

    const { data, error } = await supabaseAdmin
      .from("teacher_classes")
      .select("teacher_user_id")
      .eq("school_id", schoolId)
      .eq("class_id", targetClassId);

    if (error) {
      throw new Error("Erro ao buscar professores da turma: " + error.message);
    }

    const ids = Array.from(
      new Set((data || []).map((row: any) => String(row.teacher_user_id)).filter(Boolean))
    );

    const activeProfessorIds = ids.filter((id) => {
      return schoolUsers.some((row) => {
        return String(row.user_id || "") === id && normalizeRole(row.role) === "professor";
      });
    });

    return activeProfessorIds.map((id) => ({
      recipient_type: "staff",
      recipient_id: id,
    }));
  }

  let acceptedRoles: string[] = [];

  if (audienceType === "teachers") {
    acceptedRoles = ["professor"];
  } else if (audienceType === "coordinators") {
    acceptedRoles = ["coordenador"];
  } else if (audienceType === "secretaria") {
    acceptedRoles = ["secretaria"];
  } else {
    acceptedRoles = ["diretor", "coordenador", "secretaria", "professor", "admin"];
  }

  const ids = Array.from(
    new Set(
      schoolUsers
        .filter((row) => {
          const role = normalizeRole(row.role);
          return acceptedRoles.includes(role);
        })
        .map((row) => String(row.user_id || ""))
        .filter(Boolean)
    )
  );

  return ids.map((id) => ({
    recipient_type: "staff",
    recipient_id: id,
  }));
}

function getTargetRole(params: {
  audienceType: AudienceType;
}) {
  const { audienceType } = params;

  if (audienceType === "teachers" || audienceType === "teacher_individual") {
    return "professor";
  }

  if (audienceType === "coordinators") {
    return "coordenador";
  }

  if (audienceType === "secretaria") {
    return "secretaria";
  }

  return null;
}

export async function POST(req: Request) {
  let createdMessageId: string | null = null;
  let createdSchoolId: string | null = null;

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return jsonError("Sessão não enviada.", 401);
    }

    const staffCheck = await getStaffFromToken(token);

    if (!staffCheck.ok) {
      return jsonError(staffCheck.error, staffCheck.status);
    }

    const body = await req.json().catch(() => null);

    const title = cleanText(body?.title);
    const rawBody = cleanText(body?.body);
    const audienceType = normalizeAudienceType(body?.audienceType || body?.audience_type);

    const targetClassId = cleanText(
      body?.targetClassId ||
        body?.target_class_id ||
        body?.classId ||
        body?.class_id
    );

    const targetTeacherUserId = cleanText(
      body?.targetTeacherUserId ||
        body?.target_teacher_user_id ||
        body?.targetUserId ||
        body?.target_user_id ||
        body?.targetStaffId ||
        body?.target_staff_id ||
        body?.teacherId ||
        body?.teacher_id ||
        body?.teacherUserId ||
        body?.teacher_user_id
    );

    const targetParentId = cleanText(
      body?.targetParentId ||
        body?.target_parent_id ||
        body?.targetParentUserId ||
        body?.target_parent_user_id ||
        body?.parentId ||
        body?.parent_id ||
        body?.parentUserId ||
        body?.parent_user_id
    );

    const category = cleanText(body?.category || body?.messageCategory || body?.message_category);
    const type = cleanText(body?.type || body?.messageType || body?.message_type);

    const isDisciplinary =
      category === "disciplinary" ||
      category === "advertencia_suspensao" ||
      category === "advertencia" ||
      category === "suspensao" ||
      type === "disciplinary" ||
      type === "advertencia_suspensao" ||
      type === "advertencia" ||
      type === "suspensao";

    if (!title) {
      return jsonError("Informe o título do comunicado.", 422);
    }

    if (!rawBody) {
      return jsonError("Informe o conteúdo do comunicado.", 422);
    }

    if ((audienceType === "class" || audienceType === "teachers_class") && !targetClassId) {
      return jsonError("Selecione a turma.", 422);
    }

    if (audienceType === "teacher_individual" && !targetTeacherUserId) {
      return jsonError("Selecione o professor.", 422);
    }

    if (audienceType === "parent_individual" && !targetParentId) {
      return jsonError("Selecione o responsável.", 422);
    }

    const finalTitle = isDisciplinary ? `[Advertência/Suspensão] ${title}` : title;

    const finalBody = isDisciplinary
      ? `ADVERTÊNCIA / SUSPENSÃO\n\n${rawBody}`
      : rawBody;

    const schoolId = staffCheck.schoolId;
    const now = new Date().toISOString();

    let recipients: RecipientRow[] = [];

    if (isParentAudience(audienceType)) {
      recipients = await getParentRecipients({
        schoolId,
        audienceType,
        targetClassId,
        targetParentId,
      });
    } else if (isStaffAudience(audienceType)) {
      recipients = await getStaffRecipients({
        schoolId,
        audienceType,
        targetClassId,
        targetTeacherUserId,
      });
    }

    const uniqueRecipients = dedupeRecipients(recipients);

    if (uniqueRecipients.length === 0) {
      return jsonError(
        "Nenhum destinatário encontrado para este público. Verifique se existem responsáveis/professores/equipe vinculados à escola ou turma selecionada.",
        422,
        {
          audienceType,
          targetClassId: targetClassId || null,
          targetTeacherUserId: targetTeacherUserId || null,
          targetParentId: targetParentId || null,
        }
      );
    }

    const { data: message, error: msgErr } = await supabaseAdmin
      .from("messages")
      .insert({
        school_id: schoolId,
        created_by: staffCheck.userId,
        title: finalTitle,
        body: finalBody,
        status: "published",
        audience_type: audienceType,
        target_class_id:
          audienceType === "class" || audienceType === "teachers_class" ? targetClassId : null,
        target_role: getTargetRole({ audienceType }),
        published_at: now,
      })
      .select(
        "id, school_id, title, body, status, audience_type, target_class_id, target_role, published_at, created_at"
      )
      .single();

    if (msgErr) {
      return jsonError("Erro ao criar comunicado: " + msgErr.message, 500);
    }

    createdMessageId = String(message.id);
    createdSchoolId = schoolId;

    const rows = uniqueRecipients.map((rec) => ({
      school_id: schoolId,
      message_id: message.id,
      recipient_type: rec.recipient_type,
      recipient_id: rec.recipient_id,
      delivered_at: now,
      read_at: null,
    }));

    const { error: recErr } = await supabaseAdmin.from("message_recipients").insert(rows);

    if (recErr) {
      await supabaseAdmin
        .from("messages")
        .delete()
        .eq("id", message.id)
        .eq("school_id", schoolId);

      return jsonError("Erro ao registrar destinatários: " + recErr.message, 500, {
        audienceType,
        recipientsAttempted: rows.length,
      });
    }

    return jsonOk(
      {
        message,
        recipientsCreated: rows.length,
      },
      201
    );
  } catch (e: any) {
    if (createdMessageId && createdSchoolId) {
      await supabaseAdmin
        .from("messages")
        .delete()
        .eq("id", createdMessageId)
        .eq("school_id", createdSchoolId);
    }

    return jsonError(e?.message || "Erro interno ao publicar comunicado.", 500);
  }
}