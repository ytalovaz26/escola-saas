// src/app/api/school/enrollments/route.ts
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

function buildClassLabel(classRow: any) {
  if (!classRow) return null;

  const parts = [
    classRow.name,
    classRow.grade,
    classRow.shift,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return parts.join(" • ") || null;
}

async function ensureStudentBelongsToSchool(studentId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("id, school_id, full_name, registration_number, birth_date, student_photo_url")
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

async function deactivateOtherActiveStudentClassLinks({
  schoolId,
  studentId,
}: {
  schoolId: string;
  studentId: string;
}) {
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("student_classes")
    .update({
      is_active: false,
      ended_at: now,
    })
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("is_active", true);

  if (error) {
    return {
      ok: false as const,
      error: "Erro ao encerrar vínculo ativo anterior do aluno: " + error.message,
    };
  }

  return { ok: true as const };
}

async function createActiveStudentClassLink({
  schoolId,
  studentId,
  classId,
  startedAt,
}: {
  schoolId: string;
  studentId: string;
  classId: string;
  startedAt: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("student_classes")
    .insert({
      school_id: schoolId,
      student_id: studentId,
      class_id: classId,
      is_active: true,
      started_at: startedAt,
      ended_at: null,
    })
    .select("id, school_id, student_id, class_id, is_active, started_at, ended_at, created_at")
    .single();

  if (error) {
    return {
      ok: false as const,
      error: "Erro ao criar vínculo ativo aluno/turma: " + error.message,
    };
  }

  return { ok: true as const, link: data };
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
  enrollmentDate: string;
}) {
  if (!classId) {
    return { ok: true as const, link: null };
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
    return { ok: true as const, link: currentActive };
  }

  const deactivate = await deactivateOtherActiveStudentClassLinks({ schoolId, studentId });

  if (!deactivate.ok) {
    return deactivate;
  }

  return await createActiveStudentClassLink({
    schoolId,
    studentId,
    classId,
    startedAt: enrollmentDate,
  });
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    const url = new URL(req.url);

    const studentId = normalizeText(url.searchParams.get("studentId"));
    const classId = normalizeText(url.searchParams.get("classId"));
    const status = normalizeText(url.searchParams.get("status"));
    const yearRaw = normalizeText(url.searchParams.get("academicYear"));
    const q = normalizeText(url.searchParams.get("q"));
    const academicYear = yearRaw ? normalizeYear(yearRaw) : null;

    let enrollmentsQuery = supabaseAdmin
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
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (studentId) {
      enrollmentsQuery = enrollmentsQuery.eq("student_id", studentId);
    }

    if (classId) {
      enrollmentsQuery = enrollmentsQuery.eq("class_id", classId);
    }

    if (status) {
      enrollmentsQuery = enrollmentsQuery.eq("status", status);
    }

    if (academicYear) {
      enrollmentsQuery = enrollmentsQuery.eq("academic_year", academicYear);
    }

    const { data: enrollments, error: enrollmentsErr } = await enrollmentsQuery;

    if (enrollmentsErr) {
      return jsonError("Erro ao buscar matrículas: " + enrollmentsErr.message, 500);
    }

    let linksQuery = supabaseAdmin
      .from("student_classes")
      .select(
        `
        id,
        school_id,
        student_id,
        class_id,
        is_active,
        started_at,
        ended_at,
        created_at
      `
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (studentId) {
      linksQuery = linksQuery.eq("student_id", studentId);
    }

    if (classId) {
      linksQuery = linksQuery.eq("class_id", classId);
    }

    if (!status || status === "active") {
      linksQuery = linksQuery.eq("is_active", true);
    }

    const { data: studentClassLinks, error: linksErr } = await linksQuery;

    if (linksErr) {
      return jsonError("Erro ao buscar vínculos de alunos com turmas: " + linksErr.message, 500);
    }

    const enrollmentStudentClassPairs = new Set(
      (enrollments || []).map((row: any) => `${String(row.student_id)}::${String(row.class_id || "")}`)
    );

    const syntheticEnrollments = (studentClassLinks || [])
      .filter((link: any) => {
        const pair = `${String(link.student_id)}::${String(link.class_id || "")}`;
        return !enrollmentStudentClassPairs.has(pair);
      })
      .map((link: any) => ({
        id: `student_class:${link.id}`,
        school_id: link.school_id,
        student_id: link.student_id,
        class_id: link.class_id,
        academic_year: academicYear || normalizeYear(link.started_at || new Date().getFullYear()),
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
      }));

    const allRows = [
      ...(enrollments || []).map((row: any) => ({
        ...row,
        source: "enrollments",
      })),
      ...syntheticEnrollments,
    ];

    const studentIds = Array.from(
      new Set(allRows.map((row: any) => String(row.student_id)).filter(Boolean))
    );

    const classIds = Array.from(
      new Set(allRows.map((row: any) => String(row.class_id || "")).filter(Boolean))
    );

    const parentIds = Array.from(
      new Set(
        allRows
          .flatMap((row: any) => [
            row.financial_responsible_parent_id,
            row.pedagogical_responsible_parent_id,
          ])
          .map((id: any) => String(id || ""))
          .filter(Boolean)
      )
    );

    let studentsById = new Map<string, any>();
    let classesById = new Map<string, any>();
    let parentsById = new Map<string, any>();

    if (studentIds.length > 0) {
      const { data: students, error: studentsErr } = await supabaseAdmin
        .from("students")
        .select("id, full_name, registration_number, birth_date, student_photo_url")
        .eq("school_id", schoolId)
        .in("id", studentIds);

      if (studentsErr) {
        return jsonError("Erro ao buscar alunos das matrículas: " + studentsErr.message, 500);
      }

      studentsById = new Map((students || []).map((student: any) => [String(student.id), student]));
    }

    if (classIds.length > 0) {
      const { data: classes, error: classesErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("school_id", schoolId)
        .in("id", classIds);

      if (classesErr) {
        return jsonError("Erro ao buscar turmas das matrículas: " + classesErr.message, 500);
      }

      classesById = new Map((classes || []).map((classRow: any) => [String(classRow.id), classRow]));
    }

    if (parentIds.length > 0) {
      const { data: parents, error: parentsErr } = await supabaseAdmin
        .from("parents")
        .select("id, full_name, phone, cpf, photo_url")
        .eq("school_id", schoolId)
        .in("id", parentIds);

      if (parentsErr) {
        return jsonError("Erro ao buscar responsáveis das matrículas: " + parentsErr.message, 500);
      }

      parentsById = new Map((parents || []).map((parent: any) => [String(parent.id), parent]));
    }

    let rows = allRows.map((enrollment: any) => {
      const student = studentsById.get(String(enrollment.student_id)) || null;
      const classRow = enrollment.class_id
        ? classesById.get(String(enrollment.class_id)) || null
        : null;

      const financialResponsible = enrollment.financial_responsible_parent_id
        ? parentsById.get(String(enrollment.financial_responsible_parent_id)) || null
        : null;

      const pedagogicalResponsible = enrollment.pedagogical_responsible_parent_id
        ? parentsById.get(String(enrollment.pedagogical_responsible_parent_id)) || null
        : null;

      return {
        ...enrollment,
        student,
        class: classRow,
        classLabel: buildClassLabel(classRow),
        financialResponsible,
        pedagogicalResponsible,
      };
    });

    if (q) {
      const needle = q.toLowerCase();

      rows = rows.filter((row: any) => {
        const studentName = String(row.student?.full_name || "").toLowerCase();
        const registrationNumber = String(row.student?.registration_number || "").toLowerCase();
        const enrollmentNumber = String(row.enrollment_number || "").toLowerCase();

        return (
          studentName.includes(needle) ||
          registrationNumber.includes(needle) ||
          enrollmentNumber.includes(needle)
        );
      });
    }

    rows.sort((a: any, b: any) => {
      const aName = String(a.student?.full_name || "");
      const bName = String(b.student?.full_name || "");
      return aName.localeCompare(bName);
    });

    return jsonOk({
      enrollments: rows,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar matrículas.", 500);
  }
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    const body = await readJson(req);

    const studentId = normalizeText(body.student_id || body.studentId);
    const classId = normalizeText(body.class_id || body.classId);
    const academicYear = normalizeYear(body.academic_year || body.academicYear);
    const enrollmentNumber = normalizeText(body.enrollment_number || body.enrollmentNumber);
    const status = normalizeStatus(body.status);
    const enrollmentDate =
      normalizeDate(body.enrollment_date || body.enrollmentDate) ||
      new Date().toISOString().slice(0, 10);
    const cancellationDate = normalizeDate(body.cancellation_date || body.cancellationDate);
    const transferDate = normalizeDate(body.transfer_date || body.transferDate);
    const financialResponsibleParentId = normalizeText(
      body.financial_responsible_parent_id || body.financialResponsibleParentId
    );
    const pedagogicalResponsibleParentId = normalizeText(
      body.pedagogical_responsible_parent_id || body.pedagogicalResponsibleParentId
    );
    const notes = normalizeText(body.notes);

    if (!studentId) {
      return jsonError("student_id é obrigatório.", 422);
    }

    if (!classId) {
      return jsonError("class_id é obrigatório.", 422);
    }

    const studentCheck = await ensureStudentBelongsToSchool(studentId, schoolId);

    if (!studentCheck.ok) {
      return jsonError(studentCheck.error, 422);
    }

    const classCheck = await ensureClassBelongsToSchool(classId, schoolId);

    if (!classCheck.ok) {
      return jsonError(classCheck.error, 422);
    }

    const financialCheck = await ensureParentBelongsToSchool(financialResponsibleParentId, schoolId);

    if (!financialCheck.ok) {
      return jsonError(financialCheck.error, 422);
    }

    const pedagogicalCheck = await ensureParentBelongsToSchool(pedagogicalResponsibleParentId, schoolId);

    if (!pedagogicalCheck.ok) {
      return jsonError(pedagogicalCheck.error, 422);
    }

    const { data: existingActiveEnrollment, error: existingErr } = await supabaseAdmin
      .from("enrollments")
      .select("id, status, academic_year")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .eq("academic_year", academicYear)
      .eq("status", "active")
      .maybeSingle();

    if (existingErr) {
      return jsonError("Erro ao verificar matrícula ativa: " + existingErr.message, 500);
    }

    let enrollment: any = null;

    if (existingActiveEnrollment?.id && status === "active") {
      const { data: updatedEnrollment, error: updateEnrollmentErr } = await supabaseAdmin
        .from("enrollments")
        .update({
          class_id: classId,
          enrollment_number: enrollmentNumber,
          enrollment_date: enrollmentDate,
          cancellation_date: cancellationDate,
          transfer_date: transferDate,
          financial_responsible_parent_id: financialResponsibleParentId,
          pedagogical_responsible_parent_id: pedagogicalResponsibleParentId,
          notes,
        })
        .eq("id", existingActiveEnrollment.id)
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

      if (updateEnrollmentErr) {
        return jsonError("Erro ao atualizar matrícula ativa: " + updateEnrollmentErr.message, 500);
      }

      enrollment = updatedEnrollment;
    } else {
      const { data: createdEnrollment, error } = await supabaseAdmin
        .from("enrollments")
        .insert({
          school_id: schoolId,
          student_id: studentId,
          class_id: classId,
          academic_year: academicYear,
          enrollment_number: enrollmentNumber,
          status,
          enrollment_date: enrollmentDate,
          cancellation_date: cancellationDate,
          transfer_date: transferDate,
          financial_responsible_parent_id: financialResponsibleParentId,
          pedagogical_responsible_parent_id: pedagogicalResponsibleParentId,
          notes,
        })
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
        .single();

      if (error) {
        return jsonError("Erro ao criar matrícula: " + error.message, 500);
      }

      enrollment = createdEnrollment;
    }

    if (status === "active") {
      const sync = await syncActiveClassLink({
        schoolId,
        studentId,
        classId,
        enrollmentDate,
      });

      if (!sync.ok) {
        return jsonError(sync.error, 500, {
          enrollment,
          warning: "A matrícula foi salva, mas o vínculo aluno/turma não foi sincronizado.",
        });
      }
    }

    return jsonOk({ enrollment }, existingActiveEnrollment?.id ? 200 : 201);
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao criar matrícula.", 500);
  }
}