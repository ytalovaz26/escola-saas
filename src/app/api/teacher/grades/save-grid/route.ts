import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type GradeCellMap = Record<string, string | number | null | undefined>;

type PayloadItem = {
  student_id?: string;
  studentId?: string;
  grades?: GradeCellMap;
};

type Payload = {
  classId?: string;
  term?: string;
  items?: PayloadItem[];
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeScore(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;

  const text = String(raw).trim();
  if (!text) return null;

  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n)) return null;

  return n;
}

async function loadAllowedStudentIds(schoolId: string, classId: string) {
  const ids = new Set<string>();

  const { data: activeLinks, error: linksErr } = await supabaseAdmin
    .from("student_classes")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (!linksErr && Array.isArray(activeLinks)) {
    for (const row of activeLinks) {
      const studentId = String((row as any)?.student_id || "").trim();
      if (studentId) ids.add(studentId);
    }
  }

  if (ids.size === 0) {
    const { data: legacyStudents, error: legacyErr } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId);

    if (!legacyErr && Array.isArray(legacyStudents)) {
      for (const row of legacyStudents) {
        const studentId = String((row as any)?.id || "").trim();
        if (studentId) ids.add(studentId);
      }
    }
  }

  return Array.from(ids);
}

export async function POST(req: Request) {
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

  if (!teacherUserId) {
    return jsonError("Professor não identificado no token.", 401);
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const classId = normalizeText(body?.classId);
  const term = normalizeText(body?.term);
  const items = Array.isArray(body?.items) ? body.items : [];

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

  const subjects = (classSubjectsRows || [])
    .map((row: any) => ({
      id: String(row?.subject_id || row?.subjects?.id || "").trim(),
      name: String(row?.subjects?.name || "").trim(),
    }))
    .filter((row) => row.id && row.name);

  const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));
  const allowedSubjectIds = Array.from(subjectMap.keys());

  if (allowedSubjectIds.length === 0) {
    return jsonError("Esta turma não possui disciplinas vinculadas.", 400);
  }

  const allowedStudentIds = await loadAllowedStudentIds(schoolId, classId);

  if (allowedStudentIds.length === 0) {
    return jsonError("Nenhum aluno ativo encontrado para esta turma.", 400);
  }

  const upsertRows: Array<{
    school_id: string;
    class_id: string;
    student_id: string;
    teacher_user_id: string;
    subject_id: string;
    subject: string;
    term: string;
    score: number;
    updated_at: string;
  }> = [];

  const deleteRows: Array<{
    student_id: string;
    subject_id: string;
    subject: string;
  }> = [];

  for (const item of items) {
    const studentId = normalizeText(item?.student_id || item?.studentId);
    if (!studentId) continue;

    if (!allowedStudentIds.includes(studentId)) {
      return jsonError("Existe aluno inválido na grade.", 400, { studentId });
    }

    const gradeMap = item?.grades || {};

    for (const subjectIdRaw of Object.keys(gradeMap)) {
      const subjectId = normalizeText(subjectIdRaw);
      if (!subjectId) continue;

      if (!allowedSubjectIds.includes(subjectId)) {
        return jsonError("Existe disciplina inválida na grade.", 400, { subjectId });
      }

      const subjectName = subjectMap.get(subjectId);
      if (!subjectName) {
        return jsonError("Disciplina sem nome válido.", 400, { subjectId });
      }

      const rawValue = gradeMap[subjectId];
      const rawText = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();

      if (!rawText) {
        deleteRows.push({
          student_id: studentId,
          subject_id: subjectId,
          subject: subjectName,
        });
        continue;
      }

      const score = normalizeScore(rawValue);
      if (score === null) {
        return jsonError("Existe nota inválida na grade.", 400, {
          studentId,
          subjectId,
          rawValue,
        });
      }

      upsertRows.push({
        school_id: schoolId,
        class_id: classId,
        student_id: studentId,
        teacher_user_id: teacherUserId,
        subject_id: subjectId,
        subject: subjectName,
        term,
        score,
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const row of deleteRows) {
    const { error: deleteErr } = await supabaseAdmin
      .from("grades")
      .delete()
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("student_id", row.student_id)
      .eq("term", term)
      .eq("subject", row.subject);

    if (deleteErr) {
      return jsonError("Falha ao remover nota vazia.", 500, {
        details: deleteErr.message,
        row,
      });
    }
  }

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await supabaseAdmin
      .from("grades")
      .upsert(upsertRows, {
        onConflict: "school_id,class_id,student_id,subject,term",
      });

    if (upsertErr) {
      return jsonError("Falha ao salvar grade de notas.", 500, {
        details: upsertErr.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    classId,
    term,
    totalUpserts: upsertRows.length,
    totalDeletes: deleteRows.length,
  });
}