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

    let query = supabaseAdmin
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
      query = query.eq("student_id", studentId);
    }

    if (classId) {
      query = query.eq("class_id", classId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (yearRaw) {
      query = query.eq("academic_year", normalizeYear(yearRaw));
    }

    const { data: enrollments, error } = await query;

    if (error) {
      return jsonError("Erro ao buscar matrículas: " + error.message, 500);
    }

    const studentIds = Array.from(
      new Set((enrollments || []).map((row: any) => String(row.student_id)).filter(Boolean))
    );

    const classIds = Array.from(
      new Set((enrollments || []).map((row: any) => String(row.class_id || "")).filter(Boolean))
    );

    const parentIds = Array.from(
      new Set(
        (enrollments || [])
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

    let rows = (enrollments || []).map((enrollment: any) => {
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
    const enrollmentDate = normalizeDate(body.enrollment_date || body.enrollmentDate) || new Date().toISOString().slice(0, 10);
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

    const { data: existingActive, error: existingErr } = await supabaseAdmin
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

    if (existingActive?.id && status === "active") {
      return jsonError(
        "Este aluno já possui matrícula ativa para este ano letivo.",
        409,
        { enrollmentId: existingActive.id }
      );
    }

    const { data: enrollment, error } = await supabaseAdmin
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

    return jsonOk({ enrollment }, 201);
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao criar matrícula.", 500);
  }
}