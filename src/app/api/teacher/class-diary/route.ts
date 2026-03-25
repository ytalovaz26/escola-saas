import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

type SavePayload = {
  classId: string;
  entryId?: string | null;
  subjectName: string;
  termLabel?: string | null;
  referenceMonth: string;
  lessonDate: string;
  contentTaught: string;
  methodology?: string | null;
  activities?: string | null;
  notes?: string | null;
  homework?: string | null;
};

type DeletePayload = {
  classId: string;
  entryId: string;
};

async function validateTeacherClassAccess(params: {
  schoolId: string;
  teacherUserId: string;
  classId: string;
}) {
  const { schoolId, teacherUserId, classId } = params;

  const { data, error } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .limit(1);

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  if (!data || data.length === 0) {
    return { ok: false, error: "Professor não está vinculado a esta turma.", status: 403 };
  }

  return { ok: true as const };
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

  if (!teacherUserId) return jsonError("Professor não identificado.", 401);

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const referenceMonth = (url.searchParams.get("referenceMonth") || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!referenceMonth) return jsonError("referenceMonth é obrigatório.", 400);

  const access = await validateTeacherClassAccess({ schoolId, teacherUserId, classId });
  if (!access.ok) return jsonError(access.error, access.status);

  const { data: diary, error: diaryErr } = await supabaseAdmin
    .from("class_diaries")
    .select("id, subject_name, term_label, reference_month")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .eq("reference_month", referenceMonth)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (diaryErr) {
    return jsonError("Falha ao buscar diário.", 500, { details: diaryErr.message });
  }

  const { data: classData } = await supabaseAdmin
    .from("classes")
    .select("name")
    .eq("id", classId)
    .maybeSingle();

  let entries: any[] = [];

  if (diary?.id) {
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("class_diary_entries")
      .select("id, lesson_date, content_taught, methodology, activities, notes, homework")
      .eq("diary_id", diary.id)
      .order("lesson_date", { ascending: true });

    if (rowsErr) {
      return jsonError("Falha ao buscar lançamentos do diário.", 500, {
        details: rowsErr.message,
      });
    }

    entries = rows || [];
  }

  return NextResponse.json({
    ok: true,
    diary: diary
      ? {
          ...diary,
          class_name: classData?.name || null,
        }
      : null,
    entries,
  });
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

  if (!teacherUserId) return jsonError("Professor não identificado.", 401);

  let body: SavePayload;
  try {
    body = (await req.json()) as SavePayload;
  } catch {
    return jsonError("Body inválido.", 400);
  }

  const classId = String(body.classId || "").trim();
  const subjectName = String(body.subjectName || "").trim();
  const termLabel = String(body.termLabel || "").trim();
  const referenceMonth = String(body.referenceMonth || "").trim();
  const lessonDate = String(body.lessonDate || "").trim();
  const contentTaught = String(body.contentTaught || "").trim();
  const methodology = String(body.methodology || "").trim();
  const activities = String(body.activities || "").trim();
  const notes = String(body.notes || "").trim();
  const homework = String(body.homework || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!subjectName) return jsonError("subjectName é obrigatório.", 400);
  if (!referenceMonth) return jsonError("referenceMonth é obrigatório.", 400);
  if (!lessonDate) return jsonError("lessonDate é obrigatório.", 400);
  if (!contentTaught) return jsonError("contentTaught é obrigatório.", 400);

  const access = await validateTeacherClassAccess({ schoolId, teacherUserId, classId });
  if (!access.ok) return jsonError(access.error, access.status);

  let diaryId: string | null = null;

  const { data: existingDiary, error: existingDiaryErr } = await supabaseAdmin
    .from("class_diaries")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .eq("reference_month", referenceMonth)
    .eq("subject_name", subjectName)
    .limit(1)
    .maybeSingle();

  if (existingDiaryErr) {
    return jsonError("Falha ao localizar diário.", 500, { details: existingDiaryErr.message });
  }

  if (existingDiary?.id) {
    diaryId = existingDiary.id;

    const { error: updDiaryErr } = await supabaseAdmin
      .from("class_diaries")
      .update({
        term_label: termLabel || null,
      })
      .eq("id", diaryId);

    if (updDiaryErr) {
      return jsonError("Falha ao atualizar cabeçalho do diário.", 500, {
        details: updDiaryErr.message,
      });
    }
  } else {
    const { data: newDiary, error: newDiaryErr } = await supabaseAdmin
      .from("class_diaries")
      .insert({
        school_id: schoolId,
        class_id: classId,
        teacher_user_id: teacherUserId,
        subject_name: subjectName,
        term_label: termLabel || null,
        reference_month: referenceMonth,
      })
      .select("id")
      .single();

    if (newDiaryErr || !newDiary?.id) {
      return jsonError("Falha ao criar diário.", 500, {
        details: newDiaryErr?.message || "Não foi possível criar o diário.",
      });
    }

    diaryId = newDiary.id;
  }

  const { error: entryErr } = await supabaseAdmin.from("class_diary_entries").insert({
    diary_id: diaryId,
    school_id: schoolId,
    class_id: classId,
    teacher_user_id: teacherUserId,
    lesson_date: lessonDate,
    content_taught: contentTaught,
    methodology: methodology || null,
    activities: activities || null,
    notes: notes || null,
    homework: homework || null,
  });

  if (entryErr) {
    return jsonError("Falha ao salvar lançamento do diário.", 500, {
      details: entryErr.message,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
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

  if (!teacherUserId) return jsonError("Professor não identificado.", 401);

  let body: SavePayload;
  try {
    body = (await req.json()) as SavePayload;
  } catch {
    return jsonError("Body inválido.", 400);
  }

  const classId = String(body.classId || "").trim();
  const entryId = String(body.entryId || "").trim();
  const subjectName = String(body.subjectName || "").trim();
  const termLabel = String(body.termLabel || "").trim();
  const referenceMonth = String(body.referenceMonth || "").trim();
  const lessonDate = String(body.lessonDate || "").trim();
  const contentTaught = String(body.contentTaught || "").trim();
  const methodology = String(body.methodology || "").trim();
  const activities = String(body.activities || "").trim();
  const notes = String(body.notes || "").trim();
  const homework = String(body.homework || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!entryId) return jsonError("entryId é obrigatório.", 400);
  if (!subjectName) return jsonError("subjectName é obrigatório.", 400);
  if (!referenceMonth) return jsonError("referenceMonth é obrigatório.", 400);
  if (!lessonDate) return jsonError("lessonDate é obrigatório.", 400);
  if (!contentTaught) return jsonError("contentTaught é obrigatório.", 400);

  const access = await validateTeacherClassAccess({ schoolId, teacherUserId, classId });
  if (!access.ok) return jsonError(access.error, access.status);

  const { data: diary, error: diaryErr } = await supabaseAdmin
    .from("class_diaries")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .eq("reference_month", referenceMonth)
    .eq("subject_name", subjectName)
    .limit(1)
    .maybeSingle();

  if (diaryErr || !diary?.id) {
    return jsonError("Diário não encontrado para alteração.", 404, {
      details: diaryErr?.message,
    });
  }

  const { error: updDiaryErr } = await supabaseAdmin
    .from("class_diaries")
    .update({
      term_label: termLabel || null,
    })
    .eq("id", diary.id);

  if (updDiaryErr) {
    return jsonError("Falha ao atualizar cabeçalho do diário.", 500, {
      details: updDiaryErr.message,
    });
  }

  const { error: updEntryErr } = await supabaseAdmin
    .from("class_diary_entries")
    .update({
      lesson_date: lessonDate,
      content_taught: contentTaught,
      methodology: methodology || null,
      activities: activities || null,
      notes: notes || null,
      homework: homework || null,
    })
    .eq("id", entryId)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId);

  if (updEntryErr) {
    return jsonError("Falha ao alterar lançamento do diário.", 500, {
      details: updEntryErr.message,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
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

  if (!teacherUserId) return jsonError("Professor não identificado.", 401);

  let body: DeletePayload;
  try {
    body = (await req.json()) as DeletePayload;
  } catch {
    return jsonError("Body inválido.", 400);
  }

  const classId = String(body.classId || "").trim();
  const entryId = String(body.entryId || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!entryId) return jsonError("entryId é obrigatório.", 400);

  const access = await validateTeacherClassAccess({ schoolId, teacherUserId, classId });
  if (!access.ok) return jsonError(access.error, access.status);

  const { error: delEntryErr } = await supabaseAdmin
    .from("class_diary_entries")
    .delete()
    .eq("id", entryId)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId);

  if (delEntryErr) {
    return jsonError("Falha ao excluir lançamento do diário.", 500, {
      details: delEntryErr.message,
    });
  }

  return NextResponse.json({ ok: true });
}