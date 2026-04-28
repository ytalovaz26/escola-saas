import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { getTeacherDisplayName } from "@/lib/getTeacherDisplayName";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function isValidDateYMD(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function monthStart(referenceMonth: string) {
  const [y, m] = String(referenceMonth || "").split("-").map(Number);
  if (!y || !m) return "";

  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function monthEnd(referenceMonth: string) {
  const [y, m] = String(referenceMonth || "").split("-").map(Number);
  if (!y || !m) return "";

  const end = new Date(y, m, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate()
  ).padStart(2, "0")}`;
}

function monthFromDateYMD(value: string) {
  if (!isValidDateYMD(value)) return "";
  return value.slice(0, 7);
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
  const startDateParam = (url.searchParams.get("startDate") || "").trim();
  const endDateParam = (url.searchParams.get("endDate") || "").trim();

  let startDate = startDateParam;
  let endDate = endDateParam;

  if (!startDate && referenceMonth) {
    startDate = monthStart(referenceMonth);
  }

  if (!endDate && referenceMonth) {
    endDate = monthEnd(referenceMonth);
  }

  if (startDate && !isValidDateYMD(startDate)) {
    return jsonError("startDate inválida. Use o formato YYYY-MM-DD.", 400);
  }

  if (endDate && !isValidDateYMD(endDate)) {
    return jsonError("endDate inválida. Use o formato YYYY-MM-DD.", 400);
  }

  if (startDate && endDate && startDate > endDate) {
    return jsonError("A data inicial não pode ser maior que a data final.", 400);
  }

  let diariesQuery = supabaseAdmin
    .from("class_diaries")
    .select(
      `
      id,
      school_id,
      class_id,
      teacher_user_id,
      subject_name,
      term_label,
      reference_month,
      created_at
    `
    )
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (referenceMonth && !startDateParam && !endDateParam) {
    diariesQuery = diariesQuery.eq("reference_month", referenceMonth);
  }

  if (startDate && endDate) {
    const startMonth = monthFromDateYMD(startDate);
    const endMonth = monthFromDateYMD(endDate);

    if (startMonth && endMonth) {
      diariesQuery = diariesQuery.gte("reference_month", startMonth).lte("reference_month", endMonth);
    }
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
    const { data: classesData, error: classesErr } = await supabaseAdmin
      .from("classes")
      .select("id, name")
      .in("id", classIds);

    if (classesErr) {
      return jsonError("Falha ao carregar turmas.", 500, { details: classesErr.message });
    }

    for (const c of classesData || []) {
      classesMap.set(String((c as any).id), String((c as any).name || "").trim());
    }
  }

  const groups = [];

  for (const diary of diaries || []) {
    let entriesQuery = supabaseAdmin
      .from("class_diary_entries")
      .select(
        `
        id,
        lesson_date,
        content_taught,
        methodology,
        activities,
        notes,
        homework
      `
      )
      .eq("diary_id", diary.id)
      .order("lesson_date", { ascending: true });

    if (startDate) {
      entriesQuery = entriesQuery.gte("lesson_date", startDate);
    }

    if (endDate) {
      entriesQuery = entriesQuery.lte("lesson_date", endDate);
    }

    const { data: entries, error: entriesErr } = await entriesQuery;

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
    filters: {
      referenceMonth,
      startDate,
      endDate,
    },
    groups,
  });
}