import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireParent } from "@/lib/requireParent";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type CalendarBlock = {
  id: string;
  block_date: string;
  type: string;
  title: string;
  description: string | null;
  target_scope: string | null;
  class_id: string | null;
  shift: string | null;
  affects_all_classes: boolean | null;
};

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function jsonOk(body: Record<string, any> = {}) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeStatus(raw: any): AttendanceStatus | null {
  const value = String(raw || "").trim().toLowerCase();

  if (!value) return null;
  if (value === "present" || value === "presente" || value === "p") return "present";
  if (value === "absent" || value === "ausente" || value === "f" || value === "falta") return "absent";
  if (value === "late" || value === "tarde" || value === "atraso" || value === "t") return "late";

  return null;
}

function statusLabel(status: AttendanceStatus | null) {
  if (status === "present") return "Presente";
  if (status === "absent") return "Falta";
  if (status === "late") return "Atraso";

  return "Sem registro";
}

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAllSchoolScope(value: unknown) {
  const scope = normalizeComparable(value);

  return (
    !scope ||
    scope === "all" ||
    scope === "school" ||
    scope === "all_school" ||
    scope === "allschool" ||
    scope === "all_classes" ||
    scope === "allclasses" ||
    scope === "toda_escola" ||
    scope === "todaescola"
  );
}

function isClassScope(value: unknown) {
  const scope = normalizeComparable(value);
  return scope === "class" || scope === "turma";
}

function isShiftScope(value: unknown) {
  const scope = normalizeComparable(value);
  return scope === "shift" || scope === "period" || scope === "periodo" || scope === "turno";
}

function blockTypeLabel(type: string) {
  const safe = cleanText(type);

  if (safe === "holiday") return "Feriado";
  if (safe === "recess") return "Recesso escolar";
  if (safe === "no_class") return "Dia sem aula";
  if (safe === "pedagogical_day") return "Dia pedagógico";
  if (safe === "exam_day") return "Dia de avaliação";
  if (safe === "event") return "Evento escolar";

  return "Calendário escolar";
}

async function getStudentForParent(params: {
  schoolId: string;
  parentId: string;
  studentId: string;
}) {
  const { data: link, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("id, student_id")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("student_id", params.studentId)
    .eq("is_active", true)
    .maybeSingle();

  if (linkErr) {
    return {
      ok: false as const,
      status: 500,
      error: linkErr.message,
      student: null as any,
      activeClass: null as any,
    };
  }

  if (!link?.student_id) {
    return {
      ok: false as const,
      status: 403,
      error: "Forbidden: student not linked to parent",
      student: null as any,
      activeClass: null as any,
    };
  }

  const { data: student, error: studentErr } = await supabaseAdmin
    .from("students")
    .select("id, full_name, school_id, registration_number, class_id")
    .eq("school_id", params.schoolId)
    .eq("id", params.studentId)
    .maybeSingle();

  if (studentErr) {
    return {
      ok: false as const,
      status: 500,
      error: studentErr.message,
      student: null as any,
      activeClass: null as any,
    };
  }

  if (!student?.id) {
    return {
      ok: false as const,
      status: 404,
      error: "Student not found.",
      student: null as any,
      activeClass: null as any,
    };
  }

  const { data: activeLinks } = await supabaseAdmin
    .from("student_classes")
    .select("student_id, class_id, started_at, ended_at, is_active")
    .eq("school_id", params.schoolId)
    .eq("student_id", params.studentId)
    .eq("is_active", true)
    .order("started_at", { ascending: false })
    .limit(1);

  const activeClassId =
    cleanText(activeLinks?.[0]?.class_id) ||
    cleanText((student as any).class_id) ||
    "";

  let activeClass: any = null;

  if (activeClassId) {
    const { data: classData } = await supabaseAdmin
      .from("classes")
      .select("id, name, grade, shift")
      .eq("school_id", params.schoolId)
      .eq("id", activeClassId)
      .maybeSingle();

    if (classData?.id) {
      activeClass = {
        id: String(classData.id),
        name: cleanText(classData.name) || "Turma",
        grade: cleanText(classData.grade) || null,
        shift: cleanText(classData.shift) || null,
        label: [classData.name, classData.grade, classData.shift].map(cleanText).filter(Boolean).join(" • "),
      };
    } else {
      activeClass = {
        id: activeClassId,
        name: "Turma",
        grade: null,
        shift: null,
        label: "Turma",
      };
    }
  }

  return {
    ok: true as const,
    status: 200,
    error: null,
    student,
    activeClass,
  };
}

async function getApplicableCalendarBlocks(params: {
  schoolId: string;
  classId: string | null;
  classShift: string | null;
  from: string;
  to: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("school_calendar_blocks")
    .select(
      `
      id,
      block_date,
      type,
      title,
      description,
      target_scope,
      class_id,
      shift,
      affects_all_classes
    `
    )
    .eq("school_id", params.schoolId)
    .gte("block_date", params.from)
    .lte("block_date", params.to)
    .order("block_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      blockedDates: new Set<string>(),
      blocks: [] as any[],
    };
  }

  const blockedDates = new Set<string>();
  const blocks: any[] = [];

  for (const block of (data || []) as CalendarBlock[]) {
    let applies = false;

    if (block.affects_all_classes === true) {
      applies = true;
    } else {
      const scope = cleanText(block.target_scope);

      if (isAllSchoolScope(scope)) {
        applies = true;
      } else if (isClassScope(scope)) {
        applies = !!params.classId && cleanText(block.class_id) === params.classId;
      } else if (isShiftScope(scope)) {
        applies =
          !!cleanText(block.shift) &&
          normalizeComparable(block.shift) === normalizeComparable(params.classShift);
      }
    }

    if (!applies) continue;

    const date = cleanText(block.block_date);
    if (!date) continue;

    blockedDates.add(date);

    blocks.push({
      id: block.id,
      date,
      type: block.type,
      typeLabel: blockTypeLabel(block.type),
      title: cleanText(block.title) || "Não haverá aula",
      description:
        cleanText(block.description) ||
        "A escola informou que não haverá aula nesta data.",
      targetScope: cleanText(block.target_scope) || "all_school",
      classId: cleanText(block.class_id) || null,
      shift: cleanText(block.shift) || null,
    });
  }

  return {
    ok: true as const,
    error: null,
    blockedDates,
    blocks,
  };
}

export async function GET(req: Request) {
  try {
    const guard = await requireParent(req);
    if (!guard.ok) return guard.res;

    const { parentId, schoolId } = guard;

    const url = new URL(req.url);
    const studentId = cleanText(url.searchParams.get("studentId"));
    const from = cleanText(url.searchParams.get("from"));
    const to = cleanText(url.searchParams.get("to"));

    if (!studentId || !from || !to) {
      return jsonError("Missing params: studentId, from, to", 422);
    }

    if (!isISODate(from) || !isISODate(to)) {
      return jsonError("Invalid date params. Use YYYY-MM-DD.", 400);
    }

    const studentResult = await getStudentForParent({
      schoolId,
      parentId,
      studentId,
    });

    if (!studentResult.ok) {
      return jsonError(studentResult.error || "Falha ao buscar aluno.", studentResult.status);
    }

    const student = studentResult.student;
    const activeClass = studentResult.activeClass;

    const calendarResult = await getApplicableCalendarBlocks({
      schoolId,
      classId: activeClass?.id || null,
      classShift: activeClass?.shift || null,
      from,
      to,
    });

    if (!calendarResult.ok) {
      return jsonError("Erro ao verificar calendário escolar.", 500, {
        details: calendarResult.error,
      });
    }

    let sessionsQuery = supabaseAdmin
      .from("attendance_sessions")
      .select("id, school_id, class_id, lesson_date, lesson_number")
      .eq("school_id", schoolId)
      .gte("lesson_date", from)
      .lte("lesson_date", to)
      .order("lesson_date", { ascending: true })
      .order("lesson_number", { ascending: true });

    if (activeClass?.id) {
      sessionsQuery = sessionsQuery.eq("class_id", activeClass.id);
    }

    const { data: sessionsData, error: sessionsErr } = await sessionsQuery;

    if (sessionsErr) {
      return jsonError("attendance_sessions lookup failed: " + sessionsErr.message, 500);
    }

    const sessions = ((sessionsData || []) as any[]).filter(
      (session) => !calendarResult.blockedDates.has(cleanText(session.lesson_date))
    );

    const sessionIds = sessions.map((session) => String(session.id)).filter(Boolean);

    let items: any[] = [];

    if (sessionIds.length > 0) {
      const { data: recordsData, error: recordsErr } = await supabaseAdmin
        .from("attendance_records")
        .select("session_id, student_id, status, note")
        .eq("school_id", schoolId)
        .eq("student_id", studentId)
        .in("session_id", sessionIds);

      if (recordsErr) {
        return jsonError("attendance_records lookup failed: " + recordsErr.message, 500);
      }

      const sessionById = new Map<string, any>();

      for (const session of sessions) {
        sessionById.set(String(session.id), session);
      }

      items = (recordsData || [])
        .map((record: any) => {
          const session = sessionById.get(String(record.session_id));
          const status = normalizeStatus(record.status);

          if (!session || !status) return null;

          return {
            date: cleanText(session.lesson_date),
            status,
            statusLabel: statusLabel(status),
            class_id: cleanText(session.class_id) || null,
            session_id: cleanText(record.session_id),
            lesson_number: session.lesson_number ?? null,
            note: record.note ?? null,
          };
        })
        .filter(Boolean);
    }

    return jsonOk({
      student: {
        id: student.id,
        full_name: student.full_name ?? null,
        registration_number: student.registration_number ?? null,
        activeClass,
      },
      range: {
        from,
        to,
      },
      items,
      sessions,
      calendarBlocks: calendarResult.blocks,
      blockedDates: Array.from(calendarResult.blockedDates),
      summary: {
        totalItems: items.length,
        present: items.filter((item) => item.status === "present").length,
        absent: items.filter((item) => item.status === "absent").length,
        late: items.filter((item) => item.status === "late").length,
        blockedDaysRemoved: calendarResult.blockedDates.size,
      },
      meta: {
        source: "parent_attendance_day_sessions_records_calendar_blocks_v1",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/parent/attendance/day", 500);
  }
}