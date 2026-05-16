import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

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

type StaffRecipientRow = {
  user_id: string | null;
  role: string | null;
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

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin" || r === "administrador") return "admin";

  return r;
}

function recipientTypeFromRole(role?: string | null) {
  const r = normalizeRole(role);

  if (r === "diretor") return "diretor";
  if (r === "coordenador") return "coordenador";
  if (r === "secretaria") return "secretaria";
  if (r === "professor") return "professor";
  if (r === "admin") return "admin";

  return "staff";
}

function normalizeAudienceType(type?: string | null): AudienceType {
  const safe = String(type || "school").trim().toLowerCase();

  if (safe === "teacher_class") return "teachers_class";

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

async function getStaffFromToken(token: string) {
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
    return { ok: false as const, status: 403, error: "Usuário sem escola ativa." };
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

async function getParentRecipients(params: {
  schoolId: string;
  audienceType: AudienceType;
  targetClassId: string;
  targetParentId: string;
}): Promise<RecipientRow[]> {
  const { schoolId, audienceType, targetClassId, targetParentId } = params;

  if (audienceType === "parent_individual") {
    if (!targetParentId) {
      throw new Error("Selecione o responsável individual.");
    }

    const { data, error } = await supabaseAdmin
      .from("parents")
      .select("id")
      .eq("school_id", schoolId)
      .eq("id", targetParentId)
      .maybeSingle();

    if (error) {
      throw new Error("Erro ao validar responsável: " + error.message);
    }

    if (!data?.id) {
      throw new Error("Responsável não encontrado nesta escola.");
    }

    return [
      {
        recipient_type: "parent",
        recipient_id: String(data.id),
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

async function getSchoolUserByUserId(params: {
  schoolId: string;
  userId: string;
  allowedRoles?: string[];
}) {
  const { schoolId, userId, allowedRoles } = params;

  let query = supabaseAdmin
    .from("school_users")
    .select("user_id, role")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (allowedRoles && allowedRoles.length > 0) {
    query = query.in("role", allowedRoles);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error("Erro ao validar destinatário da equipe: " + error.message);
  }

  return data as StaffRecipientRow | null;
}

async function getStaffRecipients(params: {
  schoolId: string;
  audienceType: AudienceType;
  targetClassId: string;
  targetTeacherUserId: string;
}): Promise<RecipientRow[]> {
  const { schoolId, audienceType, targetClassId, targetTeacherUserId } = params;

  if (audienceType === "teacher_individual") {
    if (!targetTeacherUserId) {
      throw new Error("Selecione o professor individual.");
    }

    const staff = await getSchoolUserByUserId({
      schoolId,
      userId: targetTeacherUserId,
      allowedRoles: ["professor", "teacher"],
    });

    if (!staff?.user_id) {
      throw new Error("Professor não encontrado nesta escola.");
    }

    return [
      {
        recipient_type: "professor",
        recipient_id: String(staff.user_id),
      },
    ];
  }

  if (audienceType === "teachers_class") {
    if (!targetClassId) {
      throw new Error("Selecione a turma.");
    }

    const { data: teacherLinks, error } = await supabaseAdmin
      .from("teacher_classes")
      .select("teacher_user_id")
      .eq("school_id", schoolId)
      .eq("class_id", targetClassId);

    if (error) {
      throw new Error("Erro ao buscar professores da turma: " + error.message);
    }

    const teacherUserIds = Array.from(
      new Set(
        (teacherLinks || [])
          .map((row: any) => String(row.teacher_user_id || "").trim())
          .filter(Boolean)
      )
    );

    if (teacherUserIds.length === 0) {
      return [];
    }

    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("user_id, role")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .in("user_id", teacherUserIds);

    if (staffErr) {
      throw new Error("Erro ao validar professores da turma: " + staffErr.message);
    }

    return (staffRows || [])
      .filter((row: any) => String(row.user_id || "").trim())
      .map((row: any) => ({
        recipient_type: recipientTypeFromRole(row.role || "professor"),
        recipient_id: String(row.user_id),
      }));
  }

  let roles: string[] = [];

  if (audienceType === "teachers") {
    roles = ["professor", "teacher"];
  } else if (audienceType === "coordinators") {
    roles = ["coordenador", "coordinator"];
  } else if (audienceType === "secretaria") {
    roles = ["secretaria", "secretary"];
  } else {
    roles = [
      "diretor",
      "director",
      "coordenador",
      "coordinator",
      "secretaria",
      "secretary",
      "professor",
      "teacher",
      "admin",
    ];
  }

  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("user_id, role")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .in("role", roles);

  if (error) {
    throw new Error("Erro ao buscar equipe escolar: " + error.message);
  }

  return (data || [])
    .filter((row: any) => String(row.user_id || "").trim())
    .map((row: any) => ({
      recipient_type: recipientTypeFromRole(row.role),
      recipient_id: String(row.user_id),
    }));
}

function isParentAudience(type: AudienceType) {
  return (
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

function getTargetRoleForMessage(params: {
  audienceType: AudienceType;
  isDisciplinary: boolean;
}) {
  const { audienceType, isDisciplinary } = params;

  if (isDisciplinary) return "advertencia_suspensao";
  if (audienceType === "teachers") return "professor";
  if (audienceType === "coordinators") return "coordenador";
  if (audienceType === "secretaria") return "secretaria";
  if (audienceType === "staff") return "equipe_escolar";
  if (audienceType === "teacher_individual") return "professor";
  if (audienceType === "teachers_class") return "professor";
  if (audienceType === "school") return "toda_escola";

  return null;
}

export async function POST(req: Request) {
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

    const targetClassId = cleanText(body?.targetClassId || body?.target_class_id);

    const targetTeacherUserId = cleanText(
      body?.targetTeacherUserId ||
        body?.target_teacher_user_id ||
        body?.targetUserId ||
        body?.target_user_id ||
        body?.targetStaffId ||
        body?.target_staff_id
    );

    const targetParentId = cleanText(
      body?.targetParentId ||
        body?.target_parent_id ||
        body?.targetParentUserId ||
        body?.target_parent_user_id
    );

    const category = cleanText(body?.category || body?.messageCategory || body?.message_category);

    const isDisciplinary =
      category === "disciplinary" ||
      category === "advertencia_suspensao" ||
      category === "advertencia" ||
      category === "suspensao";

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
        target_role: getTargetRoleForMessage({
          audienceType,
          isDisciplinary,
        }),
        published_at: now,
      })
      .select(
        "id, school_id, title, body, status, audience_type, target_class_id, target_role, published_at, created_at"
      )
      .single();

    if (msgErr) {
      return jsonError("Erro ao criar comunicado: " + msgErr.message, 500);
    }

    let recipients: RecipientRow[] = [];

    if (audienceType === "school") {
      const [parentRecipients, staffRecipients] = await Promise.all([
        getParentRecipients({
          schoolId,
          audienceType: "all_parents",
          targetClassId,
          targetParentId,
        }),
        getStaffRecipients({
          schoolId,
          audienceType: "staff",
          targetClassId,
          targetTeacherUserId,
        }),
      ]);

      recipients = [...parentRecipients, ...staffRecipients];
    } else if (isParentAudience(audienceType)) {
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

    const unique = new Map<string, RecipientRow>();

    for (const rec of recipients) {
      const recipientId = cleanText(rec.recipient_id);
      const recipientType = cleanText(rec.recipient_type);

      if (!recipientId || !recipientType) continue;

      unique.set(`${recipientType}:${recipientId}`, {
        recipient_type: recipientType,
        recipient_id: recipientId,
      });
    }

    const rows = Array.from(unique.values()).map((rec) => ({
      school_id: schoolId,
      message_id: message.id,
      recipient_type: rec.recipient_type,
      recipient_id: rec.recipient_id,
      delivered_at: now,
      read_at: null,
    }));

    if (rows.length > 0) {
      const { error: recErr } = await supabaseAdmin.from("message_recipients").insert(rows);

      if (recErr) {
        await supabaseAdmin
          .from("messages")
          .delete()
          .eq("id", message.id)
          .eq("school_id", schoolId);

        return jsonError("Erro ao registrar destinatários: " + recErr.message, 500);
      }
    }

    return jsonOk(
      {
        message,
        recipientsCreated: rows.length,
      },
      201
    );
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao publicar comunicado.", 500);
  }
}