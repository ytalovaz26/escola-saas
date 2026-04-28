import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type SubjectItem = {
  id: string;
  name: string;
};

type StudentItem = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

async function loadRosterFromActiveLinks(schoolId: string, classId: string) {
  const { data, error } = await supabaseAdmin
    .from("student_classes")
    .select(`
      student_id,
      students!inner (
        id,
        full_name,
        registration_number
      )
    `)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (error) {
    return { ok: false as const, error: error.message, data: [] as StudentItem[] };
  }

  const map = new Map<string, StudentItem>();

  for (const row of data || []) {
    const studentId = String((row as any)?.student_id ?? (row as any)?.students?.id ?? "").trim();
    if (!studentId) continue;

    if (!map.has(studentId)) {
      map.set(studentId, {
        student_id: studentId,
        full_name: (row as any)?.students?.full_name ?? null,
        registration_number: (row as any)?.students?.registration_number ?? null,
      });
    }
  }

  return {
    ok: true as const,
    data: Array.from(map.values()).sort((a, b) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
    ),
  };
}

async function loadRosterFromLegacyStudents(schoolId: string, classId: string) {
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("id, full_name, registration_number")
    .eq("school_id", schoolId)
    .eq("class_id", classId);

  if (error) {
    return { ok: false as const, error: error.message, data: [] as StudentItem[] };
  }

  return {
    ok: true as const,
    data: (data || [])
      .map((row: any) => ({
        student_id: String(row?.id || "").trim(),
        full_name: row?.full_name ?? null,
        registration_number: row?.registration_number ?? null,
      }))
      .filter((row) => row.student_id)
      .sort((a, b) =>
        String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
      ),
  };
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "professor",
    "teacher",
    "coordenador",
    "coordinator",
    "diretor",
    "director",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;
  const teacherUserId =
    (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

  const url = new URL(req.url);
  const classId = normalizeText(url.searchParams.get("classId"));
  const term = normalizeText(url.searchParams.get("term"));

  if (!teacherUserId) return jsonError("Professor não identificado.", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!term) return jsonError("term é obrigatório.", 400);

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .eq("is_active", true)
    .limit(1);

  if (linkErr) {
    return jsonError("Erro ao validar vínculo professor-turma.", 500, {
      details: linkErr.message,
    });
  }

  if (!link || link.length === 0) {
    return jsonError("Professor não está vinculado a esta turma.", 403);
  }

  const { data: classSubjectsRows, error: classSubjectsErr } = await supabaseAdmin
    .from("class_subjects")
    .select(`
      subject_id,
      subjects!inner (
        id,
        name
      )
    `)
    .eq("school_id", schoolId)
    .eq("class_id", classId);

  if (classSubjectsErr) {
    return jsonError("Falha ao buscar disciplinas da turma.", 500, {
      details: classSubjectsErr.message,
    });
  }

  const subjects: SubjectItem[] = (classSubjectsRows || [])
    .map((row: any) => ({
      id: String(row?.subject_id || row?.subjects?.id || "").trim(),
      name: String(row?.subjects?.name || "").trim(),
    }))
    .filter((row) => row.id && row.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const activeRoster = await loadRosterFromActiveLinks(schoolId, classId);
  let roster: StudentItem[] = [];

  if (activeRoster.ok && activeRoster.data.length > 0) {
    roster = activeRoster.data;
  } else {
    const legacyRoster = await loadRosterFromLegacyStudents(schoolId, classId);

    if (!legacyRoster.ok) {
      return jsonError("Falha ao buscar alunos da turma.", 500, {
        details: activeRoster.ok ? legacyRoster.error : `${activeRoster.error} | ${legacyRoster.error}`,
      });
    }

    roster = legacyRoster.data;
  }

  const studentIds = roster.map((item) => item.student_id);

  if (studentIds.length === 0) {
    return NextResponse.json({
      ok: true,
      classId,
      term,
      subjects,
      roster: [],
      gradesMatrix: {},
    });
  }

  const { data: gradesRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("student_id, subject_id, subject, score")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("term", term)
    .in("student_id", studentIds);

  if (gradesErr) {
    return jsonError("Falha ao buscar notas da turma.", 500, {
      details: gradesErr.message,
    });
  }

  const subjectNameToId = new Map<string, string>();
  for (const subject of subjects) {
    subjectNameToId.set(subject.name.trim().toLowerCase(), subject.id);
  }

  const gradesMatrix: Record<string, Record<string, number>> = {};

  for (const row of gradesRows || []) {
    const studentId = String((row as any)?.student_id || "").trim();
    if (!studentId) continue;

    let subjectId = String((row as any)?.subject_id || "").trim();

    if (!subjectId) {
      const subjectName = String((row as any)?.subject || "").trim().toLowerCase();
      subjectId = subjectNameToId.get(subjectName) || "";
    }

    if (!subjectId) continue;

    const score = Number((row as any)?.score);
    if (!Number.isFinite(score)) continue;

    if (!gradesMatrix[studentId]) {
      gradesMatrix[studentId] = {};
    }

    gradesMatrix[studentId][subjectId] = score;
  }

  return NextResponse.json({
    ok: true,
    classId,
    term,
    subjects,
    roster,
    gradesMatrix,
  });
}