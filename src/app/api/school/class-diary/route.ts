import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { getTeacherDisplayName } from "@/lib/getTeacherDisplayName";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;

  const url = new URL(req.url);
  const referenceMonth = (url.searchParams.get("referenceMonth") || "").trim();

  let diariesQuery = supabaseAdmin
    .from("class_diaries")
    .select(`
      id,
      school_id,
      class_id,
      teacher_user_id,
      subject_name,
      term_label,
      reference_month,
      created_at
    `)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (referenceMonth) {
    diariesQuery = diariesQuery.eq("reference_month", referenceMonth);
  }

  const { data: diaries, error: diariesErr } = await diariesQuery;

  if (diariesErr) {
    return jsonError("Falha ao carregar diários.", 500, { details: diariesErr.message });
  }

  const classIds = Array.from(
    new Set((diaries || []).map((d: any) => String(d.class_id || "").trim()).filter(Boolean))
  );

  const classesMap = new Map<string, string>();

  if (classIds.length > 0) {
    const { data: classesData } = await supabaseAdmin
      .from("classes")
      .select("id, name")
      .in("id", classIds);

    for (const c of classesData || []) {
      classesMap.set(String((c as any).id), String((c as any).name || "").trim());
    }
  }

  const groups = [];

  for (const diary of diaries || []) {
    const { data: entries, error: entriesErr } = await supabaseAdmin
      .from("class_diary_entries")
      .select(`
        id,
        lesson_date,
        content_taught,
        methodology,
        activities,
        notes,
        homework
      `)
      .eq("diary_id", diary.id)
      .order("lesson_date", { ascending: true });

    if (entriesErr) {
      return jsonError("Falha ao carregar lançamentos do diário.", 500, {
        details: entriesErr.message,
      });
    }

    const teacherName = await getTeacherDisplayName({
      teacherUserId: String((diary as any).teacher_user_id || ""),
      schoolId,
    });

    groups.push({
      diary: {
        id: diary.id,
        class_id: diary.class_id,
        class_name: classesMap.get(String(diary.class_id)) || null,
        subject_name: diary.subject_name,
        term_label: diary.term_label,
        reference_month: diary.reference_month,
        teacher_user_id: diary.teacher_user_id,
        teacher_name: teacherName,
      },
      entries: entries || [],
    });
  }

  return NextResponse.json({
    ok: true,
    groups,
  });
}