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

class HttpError extends Error {
  status: number;
  extra?: any;

  constructor(message: string, status = 400, extra?: any) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

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

function getSafeDbAudienceType(audienceType: AudienceType) {
  if (audienceType === "teacher_individual") return "teachers";
  if (audienceType === "teachers_class") return "teachers";
  if (audienceType === "coordinators") return "staff";

  return audienceType;
}

function getSafeTargetRole(audienceType: AudienceType) {
  if (
    audienceType === "teachers" ||
    audienceType === "teachers_class" ||
    audienceType === "teacher_individual"
  ) {
    return "professor";
  }

  if (audienceType === "secretaria") return "secretaria";

  if (audienceType === "coordinators" || audienceType === "staff") return "staff";

  return null;
}

async function getStaffFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("school_users")
    .select("id, school_id, user_id, role, is_active")
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

  if (error) throw new HttpError("Erro ao buscar responsáveis: " + error.message, 500);

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
  const { data: classRow, error: classErr } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (classErr) throw new HttpError("Erro ao validar turma: " + classErr.message, 500);
  if (!classRow?.id) throw new HttpError("Turma não encontrada nesta escola.", 422);

  const { data: activeStudents, error: studentsErr } = await supabaseAdmin
    .from("student_classes")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (studentsErr) {
    throw new HttpError("Erro ao buscar alunos da turma: " + studentsErr.message, 500);
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
    throw new HttpError("Erro ao buscar responsáveis da turma: " + linksErr.message, 500);
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

  if (error) throw new HttpError("Erro ao buscar equipe escolar: " + error.message, 500);

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

async function findSchoolUserByUserId({
  schoolId,
  userId,
}: {
  schoolId: string;
  userId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("id, school_id, user_id, role, is_active")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new HttpError("Erro ao validar usuário por user_id: " + error.message, 500);
  }

  return data || null;
}

async function findSchoolUserBySchoolUserId({
  schoolId,
  schoolUserId,
}: {
  schoolId: string;
  schoolUserId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("id, school_id, user_id, role, is_active")
    .eq("school_id", schoolId)
    .eq("id", schoolUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new HttpError("Erro ao validar usuário por school_users.id: " + error.message, 500);
  }

  return data || null;
}

async function findSchoolUserByTeacherClassId({
  schoolId,
  teacherId,
}: {
  schoolId: string;
  teacherId: string;
}) {
  const { data: teacherClass, error: teacherClassErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("teacher_user_id, teacher_id")
    .eq("school_id", schoolId)
    .eq("teacher_id", teacherId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (teacherClassErr) {
    throw new HttpError(
      "Erro ao procurar professor por teacher_classes.teacher_id: " + teacherClassErr.message,
      500
    );
  }

  const teacherUserId = String((teacherClass as any)?.teacher_user_id || "").trim();

  if (!teacherUserId) return null;

  return findSchoolUserByUserId({
    schoolId,
    userId: teacherUserId,
  });
}

async function resolveStaffUserId({
  schoolId,
  rawTargetId,
  allowedRoles,
}: {
  schoolId: string;
  rawTargetId: string;
  allowedRoles: string[];
}) {
  const normalizedAllowedRoles = allowedRoles.map(normalizeRole).filter(Boolean);

  let staff: any = null;

  staff = await findSchoolUserByUserId({
    schoolId,
    userId: rawTargetId,
  });

  if (!staff?.user_id) {
    staff = await findSchoolUserBySchoolUserId({
      schoolId,
      schoolUserId: rawTargetId,
    });
  }

  if (!staff?.user_id) {
    staff = await findSchoolUserByTeacherClassId({
      schoolId,
      teacherId: rawTargetId,
    });
  }

  if (!staff?.user_id) {
    throw new HttpError(
      "Destinatário individual não encontrado ou inativo nesta escola.",
      422,
      {
        debug: {
          stage: "resolve_staff_user_id_not_found",
          rawTargetId,
          schoolId,
        },
      }
    );
  }

  const role = normalizeRole(staff.role);

  if (!normalizedAllowedRoles.includes(role)) {
    throw new HttpError("O destinatário selecionado não pertence ao perfil esperado.", 422, {
      debug: {
        stage: "resolve_staff_user_id_invalid_role",
        rawTargetId,
        resolvedUserId: staff.user_id,
        role,
        allowedRoles: normalizedAllowedRoles,
      },
    });
  }

  return String(staff.user_id);
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

  if (classErr) throw new HttpError("Erro ao validar turma: " + classErr.message, 500);
  if (!classRow?.id) throw new HttpError("Turma não encontrada nesta escola.", 422);

  const { data, error } = await supabaseAdmin
    .from("teacher_classes")
    .select("teacher_user_id, teacher_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (error) {
    throw new HttpError("Erro ao buscar professores da turma: " + error.message, 500);
  }

  const candidateIds = Array.from(
    new Set(
      (data || [])
        .flatMap((row: any) => [row.teacher_user_id, row.teacher_id])
        .map((value: any) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const recipients: Recipient[] = [];

  for (const id of candidateIds) {
    try {
      const resolvedUserId = await resolveStaffUserId({
        schoolId,
        rawTargetId: id,
        allowedRoles: ["professor"],
      });

      recipients.push({
        recipient_type: "staff",
        recipient_id: resolvedUserId,
      });
    } catch {
      // Ignora vínculos antigos/quebrados sem derrubar o envio da turma.
    }
  }

  return Array.from(
    new Map(recipients.map((item) => [item.recipient_id, item])).values()
  );
}

async function getSingleStaffRecipient({
  schoolId,
  targetStaffId,
  allowedRoles,
  missingMessage,
}: {
  schoolId: string;
  targetStaffId: string | null;
  allowedRoles: string[];
  missingMessage: string;
}): Promise<Recipient[]> {
  if (!targetStaffId) {
    throw new HttpError(missingMessage, 422);
  }

  const resolvedUserId = await resolveStaffUserId({
    schoolId,
    rawTargetId: targetStaffId,
    allowedRoles,
  });

  return [
    {
      recipient_type: "staff",
      recipient_id: resolvedUserId,
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
}): Promise<Recipient[]> {
  if (audienceType === "class") {
    if (!targetClassId) {
      throw new HttpError("Selecione uma turma para enviar comunicado aos responsáveis.", 422);
    }

    return getClassParentRecipients(schoolId, targetClassId);
  }

  if (audienceType === "teachers_class") {
    if (!targetClassId) {
      throw new HttpError("Selecione uma turma para enviar comunicado aos professores da turma.", 422);
    }

    return getTeacherClassRecipients(schoolId, targetClassId);
  }

  if (audienceType === "teacher_individual") {
    return getSingleStaffRecipient({
      schoolId,
      targetStaffId,
      allowedRoles: ["professor"],
      missingMessage: "Selecione um professor para enviar o comunicado individual.",
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

async function insertMessageRecipients({
  schoolId,
  messageId,
  recipients,
}: {
  schoolId: string;
  messageId: string;
  recipients: Recipient[];
}) {
  const now = new Date().toISOString();

  const rows = recipients.map((recipient) => ({
    school_id: schoolId,
    message_id: messageId,
    recipient_type: recipient.recipient_type,
    recipient_id: recipient.recipient_id,
    delivered_at: now,
  }));

  const { error: insertErr } = await supabaseAdmin
    .from("message_recipients")
    .insert(rows);

  if (!insertErr) return;

  const { error: upsertErr } = await supabaseAdmin
    .from("message_recipients")
    .upsert(rows, {
      onConflict: "message_id,recipient_type,recipient_id",
    });

  if (upsertErr) {
    throw new HttpError(
      "Comunicado criado, mas houve erro ao registrar destinatários: " + upsertErr.message,
      500,
      {
        debug: {
          stage: "insert_or_upsert_message_recipients",
          insertError: {
            message: insertErr.message,
            code: insertErr.code,
            details: insertErr.details,
            hint: insertErr.hint,
          },
          upsertError: {
            message: upsertErr.message,
            code: upsertErr.code,
            details: upsertErr.details,
            hint: upsertErr.hint,
          },
          recipientsCount: rows.length,
          recipientsPreview: rows.slice(0, 3),
        },
      }
    );
  }
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
        body.teacher_user_id ||
        body.staffId ||
        body.staff_id ||
        body.userId ||
        body.user_id
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

      recipients = Array.from(
        new Map(
          recipients.map((recipient) => [
            `${recipient.recipient_type}:${recipient.recipient_id}`,
            recipient,
          ])
        ).values()
      );

      if (recipients.length === 0) {
        return jsonError(
          "Nenhum destinatário encontrado para este público. Revise turma, professor ou vínculos cadastrados.",
          422
        );
      }
    }

    const safeAudienceType = getSafeDbAudienceType(audienceType);
    const safeTargetRole = getSafeTargetRole(audienceType);
    const safeTargetClassId =
      audienceType === "class" || audienceType === "teachers_class" ? targetClassId : null;

    const { data: created, error: insErr } = await supabaseAdmin
      .from("messages")
      .insert({
        school_id: schoolId,
        created_by: userId,
        title,
        body: messageBody,
        status,
        audience_type: safeAudienceType,
        target_class_id: safeTargetClassId,
        target_role: safeTargetRole,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select(
        "id, school_id, created_by, title, body, status, audience_type, target_class_id, target_role, published_at, created_at"
      )
      .single();

    if (insErr) {
      return jsonError("Erro ao criar comunicado: " + insErr.message, 500, {
        debug: {
          stage: "insert_messages",
          code: insErr.code,
          details: insErr.details,
          hint: insErr.hint,
          audienceType,
          safeAudienceType,
          targetRole: safeTargetRole,
          targetClassId: safeTargetClassId,
          targetStaffId,
          recipients,
        },
      });
    }

    if (status === "published" && recipients.length > 0) {
      await insertMessageRecipients({
        schoolId,
        messageId: String(created.id),
        recipients,
      });
    }

    return jsonOk({
      message: created,
      recipientsCreated: recipients.length,
      debug: {
        audienceType,
        safeAudienceType,
        targetRole: safeTargetRole,
        targetClassId: safeTargetClassId,
        targetStaffId,
        recipients,
      },
    });
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;

    return jsonError(e?.message || "Erro interno ao criar comunicado.", status, {
      debug: {
        stage: e?.extra?.debug?.stage || "catch",
        name: e?.name || null,
        extra: e?.extra || null,
      },
    });
  }
}