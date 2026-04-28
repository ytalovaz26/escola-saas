import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type Payload = {
  classId?: string;
  subjectIds?: string[];
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "admin",
    "secretaria",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const classId = normalizeText(body?.classId);
  const subjectIds = Array.isArray(body?.subjectIds)
    ? body!.subjectIds.map((id) => normalizeText(id)).filter(Boolean)
    : [];

  if (!classId) {
    return jsonError("classId é obrigatório.", 400);
  }

  const { data: classRow, error: classErr } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .limit(1);

  if (classErr) {
    return jsonError("Falha ao validar turma.", 500, {
      details: classErr.message,
    });
  }

  if (!classRow || classRow.length === 0) {
    return jsonError("Turma não encontrada para esta escola.", 404);
  }

  const { error: deleteErr } = await supabaseAdmin
    .from("class_subjects")
    .delete()
    .eq("school_id", schoolId)
    .eq("class_id", classId);

  if (deleteErr) {
    return jsonError("Falha ao limpar disciplinas da turma.", 500, {
      details: deleteErr.message,
    });
  }

  if (subjectIds.length === 0) {
    return NextResponse.json({
      ok: true,
      classId,
      savedSubjectIds: [],
      totalSaved: 0,
    });
  }

  const { data: validSubjects, error: validSubjectsErr } = await supabaseAdmin
    .from("subjects")
    .select("id")
    .eq("school_id", schoolId)
    .in("id", subjectIds);

  if (validSubjectsErr) {
    return jsonError("Falha ao validar disciplinas.", 500, {
      details: validSubjectsErr.message,
    });
  }

  const validIds = (validSubjects || []).map((row: any) => String(row.id));
  const invalidIds = subjectIds.filter((id) => !validIds.includes(id));

  if (invalidIds.length > 0) {
    return jsonError("Existem disciplinas inválidas para esta escola.", 400, {
      invalidIds,
    });
  }

  const rows = validIds.map((subjectId) => ({
    school_id: schoolId,
    class_id: classId,
    subject_id: subjectId,
  }));

  const { error: insertErr } = await supabaseAdmin
    .from("class_subjects")
    .insert(rows);

  if (insertErr) {
    return jsonError("Falha ao vincular disciplinas à turma.", 500, {
      details: insertErr.message,
    });
  }

  return NextResponse.json({
    ok: true,
    classId,
    savedSubjectIds: validIds,
    totalSaved: validIds.length,
  });
}