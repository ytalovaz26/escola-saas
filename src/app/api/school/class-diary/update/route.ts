import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function isValidDateYMD(value: string) {
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(value);
}

type UpdatePayload = {
  diaryId: string;
  entryId: string;
  classId: string;
  teacherUserId: string;
  lessonDate: string;
  contentTaught: string;
  methodology?: string | null;
  activities?: string | null;
  notes?: string | null;
  homework?: string | null;
};

export async function PUT(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;

  let body: UpdatePayload;

  try {
    body = (await req.json()) as UpdatePayload;
  } catch {
    return jsonError("Body inválido.", 400);
  }

  const diaryId = String(body.diaryId || "").trim();
  const entryId = String(body.entryId || "").trim();
  const classId = String(body.classId || "").trim();
  const teacherUserId = String(body.teacherUserId || "").trim();
  const lessonDate = String(body.lessonDate || "").trim();
  const contentTaught = String(body.contentTaught || "").trim();
  const methodology = String(body.methodology || "").trim();
  const activities = String(body.activities || "").trim();
  const notes = String(body.notes || "").trim();
  const homework = String(body.homework || "").trim();

  if (!schoolId) return jsonError("Escola não identificada.", 401);
  if (!diaryId) return jsonError("diaryId é obrigatório.", 400);
  if (!entryId) return jsonError("entryId é obrigatório.", 400);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!teacherUserId) return jsonError("teacherUserId é obrigatório.", 400);
  if (!lessonDate || !isValidDateYMD(lessonDate)) {
    return jsonError("lessonDate inválida. Use o formato YYYY-MM-DD.", 400);
  }
  if (!contentTaught) return jsonError("Conteúdo ministrado é obrigatório.", 400);

  const { data: diary, error: diaryErr } = await supabaseAdmin
    .from("class_diaries")
    .select("id")
    .eq("id", diaryId)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .maybeSingle();

  if (diaryErr) {
    return jsonError("Falha ao validar o diário.", 500, { details: diaryErr.message });
  }

  if (!diary?.id) {
    return jsonError("Diário não encontrado nesta escola.", 404);
  }

  const { data: entry, error: entryErr } = await supabaseAdmin
    .from("class_diary_entries")
    .select("id")
    .eq("id", entryId)
    .eq("diary_id", diaryId)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .maybeSingle();

  if (entryErr) {
    return jsonError("Falha ao validar o lançamento do diário.", 500, {
      details: entryErr.message,
    });
  }

  if (!entry?.id) {
    return jsonError("Lançamento não encontrado neste diário.", 404);
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("class_diary_entries")
    .update({
      lesson_date: lessonDate,
      content_taught: contentTaught,
      methodology: methodology || null,
      activities: activities || null,
      notes: notes || null,
      homework: homework || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId)
    .eq("diary_id", diaryId)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .select("id, lesson_date, content_taught, methodology, activities, notes, homework")
    .maybeSingle();

  if (updateErr) {
    return jsonError("Falha ao alterar lançamento do diário.", 500, {
      details: updateErr.message,
    });
  }

  if (!updated?.id) {
    return jsonError("Nenhum lançamento foi alterado.", 404);
  }

  return NextResponse.json({
    ok: true,
    message: "Lançamento do diário alterado com sucesso.",
    entry: updated,
  });
}
