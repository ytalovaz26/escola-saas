import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Recipient = {
  recipient_type: "parent" | "staff";
  recipient_id: string;
};

type AudienceType =
  | "school"
  | "all_parents"
  | "class"
  | "teachers"
  | "teachers_class"
  | "teacher_individual"
  | "coordinators"
  | "secretaria"
  | "staff";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function normalizeText(value: any) {
  const safe = String(value ?? "").trim();
  return safe || null;
}

function normalizeAudienceType(value: any): AudienceType {
  const safe = String(value ?? "school").trim().toLowerCase();

  const allowed = new Set([
    "school",
    "all_parents",
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

function normalizeStatus(value: any) {
  const safe = String(value ?? "published").trim().toLowerCase();
  return safe === "draft" ? "draft" : "published";
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

  const canCreate =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canCreate) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para criar comunicados.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

async function getAllParentRecipients(schoolId: string): Promise<Recipient[]> {
  const { data, error } = await supabaseAdmin
    .from("parents")
    .select("id")
    .eq("school_id", schoolId);

  if (error) throw new Error("Erro ao buscar responsáveis: " + error.message);

  return Array.from(
    new Set((data || []).map((row: any) => String(row.id)).filter(Boolean))
  ).map((id) => ({
    recipient_type: "parent",
    recipient_id: id,
  }));
}

async function getClassParentRecipients(
  schoolId: string,
  classId: string
): Promise<Recipient[]> {
  const { data: activeStudents, error: studentsErr } = await supabaseAdmin
    .from("student_classes")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (studentsErr) {
    throw new Error("Erro ao buscar alunos da turma: " + studentsErr.message);
  }

  const studentIds = Array.from(
    new Set((activeStudents || []).map((row: any) => String(row.student_id)).filter(Boolean))
  );

  if (studentIds.length === 0) return [];

  const { data: links, error: linksErr } = await supabaseAdmin
    .from("student_parents")
    .select("parent_id")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .in("student_id", studentIds);

  if (linksErr) {
    throw new Error("Erro ao buscar responsáveis da turma: " + linksErr.message);
  }

  return Array.from(
    new Set((links || []).map((row: any) => String(row.parent_id)).filter(Boolean))
  ).map((id) => ({
    recipient_type: "parent",
    recipient_id: id,
  }));
}

async function getStaffRecipients(
  schoolId: string,
  roles: string[]
): Promise<Recipient[]> {
  const normalizedRoles = roles.map(normalizeRole).filter(Boolean);

  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("user_id, role")
    .eq("school_id", schoolId)
    .eq("is_active", true);

  if (error) throw new Error("Erro ao buscar equipe escolar: " + error.message);

  return Array.from(
    new Set(
      (data || [])
        .filter((row: any) => normalizedRoles.includes(normalizeRole(row.role)))
        .map((row: any) => String(row.user_id))
        .filter(Boolean)
    )
  ).map((id) => ({
    recipient_type: "staff",
    recipient_id: id,
  }));
}

async function getTeacherClassRecipients(
  schoolId: string,
  classId: string
): Promise<Recipient[]> {
  const { data: classRow, error: classErr } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (classErr) throw new Error("Erro ao validar turma: " + classErr.message);
  if (!classRow?.id) throw new Error("Turma não encontrada nesta escola.");

  const { data, error } = await supabaseAdmin
    .from("teacher_classes")
    .select("teacher_user_id, teacher_id, is_active")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (error) {
    throw new Error("Erro ao buscar professores da turma: " + error.message);
  }

  const userIds = Array.from(
    new Set(
      (data || [])
        .map((row: any) => String(row.teacher_user_id || row.teacher_id || ""))
        .filter(Boolean)
    )
  );

  if (userIds.length === 0) return [];

  const { data: schoolUsers, error: schoolUsersErr } = await supabaseAdmin
    .from("school_users")
    .select("user_id, role, is_active")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .in("user_id", userIds);

  if (schoolUsersErr) {
    throw new Error("Erro ao validar professores da turma: " + schoolUsersErr.message);
  }

  return Array.from(
    new Set(
      (schoolUsers || [])
        .filter((row: any) => normalizeRole(row.role) === "professor")
        .map((row: any) => String(row.user_id))
        .filter(Boolean)
    )
  ).map((id) => ({
    recipient_type: "staff",
    recipient_id: id,
  }));
}

async function getSingleStaffRecipient({
  schoolId,
  targetStaffId,
  allowedRoles,
  errorPrefix,
}: {
  schoolId: string;
  targetStaffId: string | null;
  allowedRoles: string[];
  errorPrefix: string;
}): Promise<Recipient[]> {
  if (!targetStaffId) {
    throw new Error(errorPrefix);
  }

  const normalizedAllowedRoles = allowedRoles.map(normalizeRole).filter(Boolean);

  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("user_id, role, is_active")
    .eq("school_id", schoolId)
    .eq("user_id", targetStaffId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error("Erro ao validar destinatário: " + error.message);
  }

  if (!data?.user_id) {
    throw new Error("Destinatário não encontrado ou inativo nesta escola.");
  }

  const role = normalizeRole(data.role);

  if (!normalizedAllowedRoles.includes(role)) {
    throw new Error("O destinatário selecionado não pertence ao perfil esperado.");
  }

  return [
    {
      recipient_type: "staff",
      recipient_id: String(data.user_id),
    },
  ];
}

async function buildRecipients({
  schoolId,
  audienceType,
  targetClassId,
  targetStaffId,
}: {
  schoolId: string;
  audienceType: AudienceType;
  targetClassId: string | null;
  targetStaffId: string | null;
}) {
  if (audienceType === "class") {
    if (!targetClassId) {
      throw new Error("Selecione uma turma para enviar comunicado por turma.");
    }

    const { data: classRow, error: classErr } = await supabaseAdmin
      .from("classes")
      .select("id")
      .eq("id", targetClassId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (classErr) throw new Error("Erro ao validar turma: " + classErr.message);
    if (!classRow?.id) throw new Error("Turma não encontrada nesta escola.");

    return getClassParentRecipients(schoolId, targetClassId);
  }

  if (audienceType === "teachers_class") {
    if (!targetClassId) {
      throw new Error("Selecione uma turma para enviar comunicado aos professores da turma.");
    }

    return getTeacherClassRecipients(schoolId, targetClassId);
  }

  if (audienceType === "teacher_individual") {
    return getSingleStaffRecipient({
      schoolId,
      targetStaffId,
      allowedRoles: ["professor"],
      errorPrefix: "Selecione um professor para enviar o comunicado individual.",
    });
  }

  if (audienceType === "teachers") {
    return getStaffRecipients(schoolId, ["professor"]);
  }

  if (audienceType === "coordinators") {
    return getStaffRecipients(schoolId, ["coordenador"]);
  }

  if (audienceType === "secretaria") {
    return getStaffRecipients(schoolId, ["secretaria"]);
  }

  if (audienceType === "staff") {
    return getStaffRecipients(schoolId, [
      "diretor",
      "coordenador",
      "secretaria",
      "professor",
      "admin",
    ]);
  }

  return getAllParentRecipients(schoolId);
}

function targetRoleForAudience(audienceType: AudienceType) {
  if (audienceType === "teachers") return "professor";
  if (audienceType === "teachers_class") return "professor";
  if (audienceType === "teacher_individual") return "professor";
  if (audienceType === "coordinators") return "coordenador";
  if (audienceType === "secretaria") return "secretaria";
  if (audienceType === "staff") return "staff";

  return null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);
    if (!staffCheck.ok) return jsonError(staffCheck.error, staffCheck.status);

    const body = await req.json().catch(() => ({}));

    const title = normalizeText(body.title);
    const messageBody = normalizeText(body.body);
    const status = normalizeStatus(body.status);
    const audienceType = normalizeAudienceType(body.audienceType || body.audience_type);
    const targetClassId = normalizeText(body.targetClassId || body.target_class_id);
    const targetStaffId = normalizeText(
      body.targetStaffId ||
        body.target_staff_id ||
        body.targetTeacherId ||
        body.target_teacher_id ||
        body.teacherUserId ||
        body.teacher_user_id
    );

    if (!title) return jsonError("Informe o título do comunicado.", 422);
    if (!messageBody) return jsonError("Informe o conteúdo do comunicado.", 422);

    const schoolId = staffCheck.schoolId;
    const userId = staffCheck.userId;

    let recipients: Recipient[] = [];

    if (status === "published") {
      recipients = await buildRecipients({
        schoolId,
        audienceType,
        targetClassId,
        targetStaffId,
      });

      if (recipients.length === 0) {
        return jsonError(
          "Nenhum destinatário encontrado para este público. Revise a turma, professor ou vínculos cadastrados.",
          422
        );
      }
    }

    const { data: created, error: insErr } = await supabaseAdmin
      .from("messages")
      .insert({
        school_id: schoolId,
        created_by: userId,
        title,
        body: messageBody,
        status,
        audience_type: audienceType,
        target_class_id:
          audienceType === "class" || audienceType === "teachers_class"
            ? targetClassId
            : null,
        target_role: targetRoleForAudience(audienceType),
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select(
        "id, school_id, created_by, title, body, status, audience_type, target_class_id, target_role, published_at, created_at"
      )
      .single();

    if (insErr) {
      return jsonError("Erro ao criar comunicado: " + insErr.message, 500);
    }

    if (status === "published" && recipients.length > 0) {
      const now = new Date().toISOString();

      const rows = recipients.map((recipient) => ({
        school_id: schoolId,
        message_id: created.id,
        recipient_type: recipient.recipient_type,
        recipient_id: recipient.recipient_id,
        delivered_at: now,
      }));

      const { error: recErr } = await supabaseAdmin
        .from("message_recipients")
        .upsert(rows, {
          onConflict: "message_id,recipient_type,recipient_id",
        });

      if (recErr) {
        return jsonError(
          "Comunicado criado, mas houve erro ao registrar destinatários: " + recErr.message,
          500,
          { message: created }
        );
      }
    }

    return jsonOk({
      message: created,
      recipientsCreated: recipients.length,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao criar comunicado.", 500);
  }
}