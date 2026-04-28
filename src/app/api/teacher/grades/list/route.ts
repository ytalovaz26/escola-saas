import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

type StudentItem = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

async function getRosterFromActiveLinks(schoolId: string, classId: string) {
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

  const rosterMap = new Map<string, StudentItem>();

  for (const row of data || []) {
    const studentId = String((row as any)?.student_id ?? (row as any)?.students?.id ?? "").trim();
    if (!studentId) continue;

    if (!rosterMap.has(studentId)) {
      rosterMap.set(studentId, {
        student_id: studentId,
        full_name: (row as any)?.students?.full_name ?? null,
        registration_number: (row as any)?.students?.registration_number ?? null,
      });
    }
  }

  return {
    ok: true as const,
    data: Array.from(rosterMap.values()).sort((a, b) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
    ),
  };
}

async function getRosterFromLegacyStudents(schoolId: string, classId: string) {
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("id, full_name, registration_number")
    .eq("school_id", schoolId)
    .eq("class_id", classId);

  if (error) {
    return { ok: false as const, error: error.message, data: [] as StudentItem[] };
  }

  const rows = (data || []).map((row: any) => ({
    student_id: String(row?.id || ""),
    full_name: row?.full_name ?? null,
    registration_number: row?.registration_number ?? null,
  }));

  return {
    ok: true as const,
    data: rows
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
  const subject = normalizeText(url.searchParams.get("subject"));
  const term = normalizeText(url.searchParams.get("term"));

  if (!teacherUserId) return jsonError("Professor não identificado (token).", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!subject) return jsonError("subject é obrigatório.", 400);
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

  const activeRoster = await getRosterFromActiveLinks(schoolId, classId);

  let finalRoster: StudentItem[] = [];

  if (activeRoster.ok && activeRoster.data.length > 0) {
    finalRoster = activeRoster.data;
  } else {
    const legacyRoster = await getRosterFromLegacyStudents(schoolId, classId);

    if (!legacyRoster.ok) {
      return jsonError("Falha ao buscar alunos da turma.", 500, {
        details: activeRoster.ok ? legacyRoster.error : `${activeRoster.error} | ${legacyRoster.error}`,
      });
    }

    finalRoster = legacyRoster.data;
  }

  const studentIds = finalRoster.map((item) => item.student_id);

  let gradesMap = new Map<
    string,
    {
      student_id: string;
      score: number;
    }
  >();

  if (studentIds.length > 0) {
    const { data: gradesRows, error: gradesErr } = await supabaseAdmin
      .from("grades")
      .select("student_id, score")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("subject", subject)
      .eq("term", term)
      .in("student_id", studentIds);

    if (gradesErr) {
      return jsonError("Falha ao buscar notas existentes.", 500, {
        details: gradesErr.message,
      });
    }

    gradesMap = new Map(
      (gradesRows || []).map((row: any) => [
        String(row?.student_id || "").trim(),
        {
          student_id: String(row?.student_id || "").trim(),
          score: Number(row?.score),
        },
      ])
    );
  }

  return NextResponse.json({
    ok: true,
    classId,
    subject,
    term,
    roster: finalRoster,
    grades: Array.from(gradesMap.values()),
  });
}