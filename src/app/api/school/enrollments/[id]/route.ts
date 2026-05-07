// src/app/api/school/enrollments/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function normalizeText(value: any) {
  const safe = String(value ?? "").trim();
  return safe || null;
}

function normalizeDate(value: any) {
  const safe = String(value ?? "").trim();
  return safe || null;
}

function normalizeStatus(value: any) {
  const safe = String(value ?? "active").trim().toLowerCase();

  const allowed = new Set([
    "active",
    "inactive",
    "cancelled",
    "transferred",
    "completed",
  ]);

  return allowed.has(safe) ? safe : "active";
}

function normalizeYear(value: any) {
  const currentYear = new Date().getFullYear();
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return currentYear;

  const year = Math.trunc(parsed);

  if (year < 2000 || year > 2100) return currentYear;

  return year;
}

function isStudentClassSyntheticId(value: string) {
  return String(value || "").startsWith("student_class:");
}

function getStudentClassIdFromSyntheticId(value: string) {
  return String(value || "").replace(/^student_class:/, "").trim();
}

async function ensureEnrollment(enrollmentId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("enrollments")
    .select(
      `
      id,
      school_id,
      student_id,
      class_id,
      academic_year,
      enrollment_number,
      status,
      enrollment_date,
      cancellation_date,
      transfer_date,
      financial_responsible_parent_id,
      pedagogical_responsible_parent_id,
      notes,
      created_at,
      updated_at
    `
    )
    .eq("id", enrollmentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, status: 500, error: "Erro ao buscar matrícula: " + error.message };
  }

  if (!data?.id) {
    return { ok: false as const, status: 404, error: "Matrícula não encontrada." };
  }

  return { ok: true as const, enrollment: data };
}

async function ensureStudentClassLink(studentClassId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("student_classes")
    .select("id, school_id, student_id, class_id, is_active, started_at, ended_at, created_at")
    .eq("id", studentClassId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: "Erro ao buscar vínculo aluno/turma: " + error.message,
    };
  }

  if (!data?.id) {
    return {
      ok: false as const,
      status: 404,
      error: "Vínculo aluno/turma não encontrado.",
    };
  }

  return { ok: true as const, link: data };
}

async function ensureStudentBelongsToSchool(studentId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("id, school_id, full_name, registration_number")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: "Erro ao validar aluno: " + error.message };
  }

  if (!data?.id) {
    return { ok: false as const, error: "Aluno não encontrado nesta escola." };
  }

  return { ok: true as const, student: data };
}

async function ensureClassBelongsToSchool(classId: string | null, schoolId: string) {
  if (!classId) return { ok: true as const, classRow: null };

  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, school_id, name, grade, shift")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: "Erro ao validar turma: " + error.message };
  }

  if (!data?.id) {
    return { ok: false as const, error: "Turma não encontrada nesta escola." };
  }

  return { ok: true as const, classRow: data };
}

async function ensureParentBelongsToSchool(parentId: string | null, schoolId: string) {
  if (!parentId) return { ok: true as const, parent: null };

  const { data, error } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, full_name, phone, cpf")
    .eq("id", parentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: "Erro ao validar responsável: " + error.message };
  }

  if (!data?.id) {
    return { ok: false as const, error: "Responsável não encontrado nesta escola." };
  }

  return { ok: true as const, parent: data };
}

async function syncActiveClassLink({
  schoolId,
  studentId,
  classId,
  enrollmentDate,
}: {
  schoolId: string;
  studentId: string;
  classId: string | null;
  enrollmentDate: string | null;
}) {
  if (!classId) {
    return { ok: true as const };
  }

  const { data: currentActive, error: currentErr } = await supabaseAdmin
    .from("student_classes")
    .select("id, school_id, student_id, class_id, is_active, started_at, ended_at, created_at")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentErr) {
    return {
      ok: false as const,
      error: "Erro ao verificar vínculo ativo aluno/turma: " + currentErr.message,
    };
  }

  if (currentActive?.id && String(currentActive.class_id) === String(classId)) {
    return { ok: true as const };
  }

  const now = new Date().toISOString();

  const { error: deactivateErr } = await supabaseAdmin
    .from("student_classes")
    .update({
      is_active: false,
      ended_at: now,
    })
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("is_active", true);

  if (deactivateErr) {
    return {
      ok: false as const,
      error: "Erro ao encerrar vínculo ativo anterior do aluno: " + deactivateErr.message,
    };
  }

  const { error: insertErr } = await supabaseAdmin
    .from("student_classes")
    .insert({
      school_id: schoolId,
      student_id: studentId,
      class_id: classId,
      is_active: true,
      started_at: enrollmentDate || now.slice(0, 10),
      ended_at: null,
    });

  if (insertErr) {
    return {
      ok: false as const,
      error: "Erro ao criar vínculo ativo aluno/turma: " + insertErr.message,
    };
  }

  return { ok: true as const };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const enrollmentId = String(params?.id || "").trim();
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    if (!enrollmentId) {
      return jsonError("ID da matrícula é obrigatório.", 400);
    }

    if (isStudentClassSyntheticId(enrollmentId)) {
      const studentClassId = getStudentClassIdFromSyntheticId(enrollmentId);
      const linkCheck = await ensureStudentClassLink(studentClassId, schoolId);

      if (!linkCheck.ok) {
        return jsonError(linkCheck.error, linkCheck.status);
      }

      const link = linkCheck.link;

      const { data: student, error: studentErr } = await supabaseAdmin
        .from("students")
        .select("id, full_name, registration_number, birth_date, student_photo_url")
        .eq("id", link.student_id)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (studentErr) {
        return jsonError("Erro ao buscar aluno do vínculo: " + studentErr.message, 500);
      }

      const { data: classRow, error: classErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("id", link.class_id)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (classErr) {
        return jsonError("Erro ao buscar turma do vínculo: " + classErr.message, 500);
      }

      return jsonOk({
        enrollment: {
          id: `student_class:${link.id}`,
          school_id: link.school_id,
          student_id: link.student_id,
          class_id: link.class_id,
          academic_year: normalizeYear(link.started_at || new Date().getFullYear()),
          enrollment_number: null,
          status: link.is_active ? "active" : "inactive",
          enrollment_date: String(link.started_at || link.created_at || new Date().toISOString()).slice(0, 10),
          cancellation_date: link.ended_at ? String(link.ended_at).slice(0, 10) : null,
          transfer_date: null,
          financial_responsible_parent_id: null,
          pedagogical_responsible_parent_id: null,
          notes: "Registro exibido a partir do vínculo ativo aluno/turma.",
          created_at: link.created_at,
          updated_at: link.created_at,
          studentClassLinkId: link.id,
          source: "student_classes",
          student: student || null,
          class: classRow || null,
          financialResponsible: null,
          pedagogicalResponsible: null,
        },
      });
    }

    const enrollmentCheck = await ensureEnrollment(enrollmentId, schoolId);

    if (!enrollmentCheck.ok) {
      return jsonError(enrollmentCheck.error, enrollmentCheck.status);
    }

    const enrollment = enrollmentCheck.enrollment;

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number, birth_date, student_photo_url")
      .eq("id", enrollment.student_id)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao buscar aluno da matrícula: " + studentErr.message, 500);
    }

    let classRow: any = null;

    if (enrollment.class_id) {
      const { data: cls, error: classErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("id", enrollment.class_id)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (classErr) {
        return jsonError("Erro ao buscar turma da matrícula: " + classErr.message, 500);
      }

      classRow = cls || null;
    }

    const parentIds = [
      enrollment.financial_responsible_parent_id,
      enrollment.pedagogical_responsible_parent_id,
    ]
      .map((id: any) => String(id || ""))
      .filter(Boolean);

    let parentsById = new Map<string, any>();

    if (parentIds.length > 0) {
      const { data: parents, error: parentsErr } = await supabaseAdmin
        .from("parents")
        .select("id, full_name, phone, cpf, photo_url")
        .eq("school_id", schoolId)
        .in("id", parentIds);

      if (parentsErr) {
        return jsonError("Erro ao buscar responsáveis da matrícula: " + parentsErr.message, 500);
      }

      parentsById = new Map((parents || []).map((parent: any) => [String(parent.id), parent]));
    }

    return jsonOk({
      enrollment: {
        ...enrollment,
        source: "enrollments",
        student: student || null,
        class: classRow,
        financialResponsible: enrollment.financial_responsible_parent_id
          ? parentsById.get(String(enrollment.financial_responsible_parent_id)) || null
          : null,
        pedagogicalResponsible: enrollment.pedagogical_responsible_parent_id
          ? parentsById.get(String(enrollment.pedagogical_responsible_parent_id)) || null
          : null,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar matrícula.", 500);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const enrollmentId = String(params?.id || "").trim();
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    if (!enrollmentId) {
      return jsonError("ID da matrícula é obrigatório.", 400);
    }

    if (isStudentClassSyntheticId(enrollmentId)) {
      return jsonError(
        "Este registro foi criado a partir do vínculo aluno/turma. Para editar os detalhes completos, crie uma matrícula oficial para o aluno.",
        409
      );
    }

    const currentCheck = await ensureEnrollment(enrollmentId, schoolId);

    if (!currentCheck.ok) {
      return jsonError(currentCheck.error, currentCheck.status);
    }

    const current = currentCheck.enrollment;
    const body = await readJson(req);

    const nextStudentId = normalizeText(body.student_id || body.studentId) || current.student_id;
    const nextClassId =
      body.class_id === null || body.classId === null
        ? null
        : normalizeText(body.class_id || body.classId) ?? current.class_id;

    const nextAcademicYear =
      body.academic_year != null || body.academicYear != null
        ? normalizeYear(body.academic_year || body.academicYear)
        : current.academic_year;

    const nextStatus =
      body.status != null
        ? normalizeStatus(body.status)
        : current.status;

    const nextEnrollmentNumber =
      body.enrollment_number !== undefined || body.enrollmentNumber !== undefined
        ? normalizeText(body.enrollment_number || body.enrollmentNumber)
        : current.enrollment_number;

    const nextEnrollmentDate =
      body.enrollment_date !== undefined || body.enrollmentDate !== undefined
        ? normalizeDate(body.enrollment_date || body.enrollmentDate)
        : current.enrollment_date;

    const nextCancellationDate =
      body.cancellation_date !== undefined || body.cancellationDate !== undefined
        ? normalizeDate(body.cancellation_date || body.cancellationDate)
        : current.cancellation_date;

    const nextTransferDate =
      body.transfer_date !== undefined || body.transferDate !== undefined
        ? normalizeDate(body.transfer_date || body.transferDate)
        : current.transfer_date;

    const nextFinancialResponsibleParentId =
      body.financial_responsible_parent_id !== undefined ||
      body.financialResponsibleParentId !== undefined
        ? normalizeText(body.financial_responsible_parent_id || body.financialResponsibleParentId)
        : current.financial_responsible_parent_id;

    const nextPedagogicalResponsibleParentId =
      body.pedagogical_responsible_parent_id !== undefined ||
      body.pedagogicalResponsibleParentId !== undefined
        ? normalizeText(body.pedagogical_responsible_parent_id || body.pedagogicalResponsibleParentId)
        : current.pedagogical_responsible_parent_id;

    const nextNotes =
      body.notes !== undefined
        ? normalizeText(body.notes)
        : current.notes;

    if (!nextStudentId) {
      return jsonError("student_id é obrigatório.", 422);
    }

    const studentCheck = await ensureStudentBelongsToSchool(nextStudentId, schoolId);

    if (!studentCheck.ok) {
      return jsonError(studentCheck.error, 422);
    }

    const classCheck = await ensureClassBelongsToSchool(nextClassId, schoolId);

    if (!classCheck.ok) {
      return jsonError(classCheck.error, 422);
    }

    const financialCheck = await ensureParentBelongsToSchool(nextFinancialResponsibleParentId, schoolId);

    if (!financialCheck.ok) {
      return jsonError(financialCheck.error, 422);
    }

    const pedagogicalCheck = await ensureParentBelongsToSchool(nextPedagogicalResponsibleParentId, schoolId);

    if (!pedagogicalCheck.ok) {
      return jsonError(pedagogicalCheck.error, 422);
    }

    if (nextStatus === "active") {
      const { data: duplicate, error: duplicateErr } = await supabaseAdmin
        .from("enrollments")
        .select("id")
        .eq("school_id", schoolId)
        .eq("student_id", nextStudentId)
        .eq("academic_year", nextAcademicYear)
        .eq("status", "active")
        .neq("id", enrollmentId)
        .maybeSingle();

      if (duplicateErr) {
        return jsonError("Erro ao verificar matrícula ativa: " + duplicateErr.message, 500);
      }

      if (duplicate?.id) {
        return jsonError("Este aluno já possui outra matrícula ativa para este ano letivo.", 409, {
          enrollmentId: duplicate.id,
        });
      }
    }

    const updatePayload = {
      student_id: nextStudentId,
      class_id: nextClassId,
      academic_year: nextAcademicYear,
      enrollment_number: nextEnrollmentNumber,
      status: nextStatus,
      enrollment_date: nextEnrollmentDate,
      cancellation_date: nextCancellationDate,
      transfer_date: nextTransferDate,
      financial_responsible_parent_id: nextFinancialResponsibleParentId,
      pedagogical_responsible_parent_id: nextPedagogicalResponsibleParentId,
      notes: nextNotes,
    };

    const { data: enrollment, error } = await supabaseAdmin
      .from("enrollments")
      .update(updatePayload)
      .eq("id", enrollmentId)
      .eq("school_id", schoolId)
      .select(
        `
        id,
        school_id,
        student_id,
        class_id,
        academic_year,
        enrollment_number,
        status,
        enrollment_date,
        cancellation_date,
        transfer_date,
        financial_responsible_parent_id,
        pedagogical_responsible_parent_id,
        notes,
        created_at,
        updated_at
      `
      )
      .maybeSingle();

    if (error) {
      return jsonError("Erro ao atualizar matrícula: " + error.message, 500);
    }

    if (!enrollment?.id) {
      return jsonError("Matrícula não encontrada após atualização.", 404);
    }

    if (nextStatus === "active") {
      const sync = await syncActiveClassLink({
        schoolId,
        studentId: nextStudentId,
        classId: nextClassId,
        enrollmentDate: nextEnrollmentDate,
      });

      if (!sync.ok) {
        return jsonError(sync.error, 500, {
          enrollment,
          warning: "A matrícula foi atualizada, mas o vínculo aluno/turma não foi sincronizado.",
        });
      }
    }

    if (nextStatus !== "active") {
      const now = new Date().toISOString();

      const { error: deactivateErr } = await supabaseAdmin
        .from("student_classes")
        .update({
          is_active: false,
          ended_at: nextCancellationDate || nextTransferDate || now,
        })
        .eq("school_id", schoolId)
        .eq("student_id", nextStudentId)
        .eq("class_id", nextClassId)
        .eq("is_active", true);

      if (deactivateErr) {
        return jsonError("Matrícula atualizada, mas houve erro ao encerrar vínculo aluno/turma: " + deactivateErr.message, 500, {
          enrollment,
        });
      }
    }

    return jsonOk({ enrollment });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar matrícula.", 500);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const enrollmentId = String(params?.id || "").trim();
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    if (!enrollmentId) {
      return jsonError("ID da matrícula é obrigatório.", 400);
    }

    if (isStudentClassSyntheticId(enrollmentId)) {
      const studentClassId = getStudentClassIdFromSyntheticId(enrollmentId);

      const linkCheck = await ensureStudentClassLink(studentClassId, schoolId);

      if (!linkCheck.ok) {
        return jsonError(linkCheck.error, linkCheck.status);
      }

      const now = new Date().toISOString();

      const { error } = await supabaseAdmin
        .from("student_classes")
        .update({
          is_active: false,
          ended_at: now,
        })
        .eq("id", studentClassId)
        .eq("school_id", schoolId);

      if (error) {
        return jsonError("Erro ao remover aluno da turma: " + error.message, 500);
      }

      return jsonOk({
        deleted: true,
        enrollmentId,
        studentClassLinkId: studentClassId,
        source: "student_classes",
      });
    }

    const currentCheck = await ensureEnrollment(enrollmentId, schoolId);

    if (!currentCheck.ok) {
      return jsonError(currentCheck.error, currentCheck.status);
    }

    const current = currentCheck.enrollment;

    const { error } = await supabaseAdmin
      .from("enrollments")
      .delete()
      .eq("id", enrollmentId)
      .eq("school_id", schoolId);

    if (error) {
      return jsonError("Erro ao excluir matrícula: " + error.message, 500);
    }

    if (current.student_id && current.class_id) {
      const now = new Date().toISOString();

      await supabaseAdmin
        .from("student_classes")
        .update({
          is_active: false,
          ended_at: now,
        })
        .eq("school_id", schoolId)
        .eq("student_id", current.student_id)
        .eq("class_id", current.class_id)
        .eq("is_active", true);
    }

    return jsonOk({
      deleted: true,
      enrollmentId,
      source: "enrollments",
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao excluir matrícula.", 500);
  }
}