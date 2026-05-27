import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateToISO(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  const start = new Date(year, monthNumber - 1, 1);
  const endExclusive = new Date(year, monthNumber, 1);
  const endInclusive = new Date(year, monthNumber, 0);

  return {
    startYMD: dateToISO(start),
    endYMD: dateToISO(endExclusive),
    endInclusiveYMD: dateToISO(endInclusive),
  };
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

async function getParentContext(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false as const,
      response: jsonError("Missing Authorization Bearer token.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: jsonError("Invalid token/session.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      response: jsonError("parents lookup failed: " + parentErr.message, 500),
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Not a parent.", 403),
    };
  }

  return {
    ok: true as const,
    user,
    parentId: String(parent.id),
    schoolId: String(parent.school_id),
    parentName: cleanText(parent.full_name) || user.email || "Responsável",
  };
}

async function getStudentForParent(params: {
  schoolId: string;
  parentId: string;
  studentId: string;
}) {
  const { data: link, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("id, student_id, parent_id, is_active")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("student_id", params.studentId)
    .eq("is_active", true)
    .maybeSingle();

  if (linkErr) {
    return {
      ok: false as const,
      status: 500,
      error: "student_parents lookup failed: " + linkErr.message,
      student: null as any,
      activeClass: null as any,
    };
  }

  if (!link?.student_id) {
    return {
      ok: false as const,
      status: 403,
      error: "You don't have permission to view this student.",
      student: null as any,
      activeClass: null as any,
    };
  }

  const { data: student, error: studentErr } = await supabaseAdmin
    .from("students")
    .select("id, full_name, school_id, registration_number, class_id")
    .eq("id", params.studentId)
    .eq("school_id", params.schoolId)
    .maybeSingle();

  if (studentErr) {
    return {
      ok: false as const,
      status: 500,
      error: "students lookup failed: " + studentErr.message,
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

async function getApplicableBlockedDates(params: {
  schoolId: string;
  classId: string | null;
  classShift: string | null;
  startYMD: string;
  endInclusiveYMD: string;
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
    .gte("block_date", params.startYMD)
    .lte("block_date", params.endInclusiveYMD)
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
    const ctx = await getParentContext(req);
    if (!ctx.ok) return ctx.response;

    const { searchParams } = new URL(req.url);

    const studentId = cleanText(searchParams.get("studentId"));
    const month = cleanText(searchParams.get("month"));

    if (!studentId) return jsonError("Missing studentId.", 400);
    if (!month || !isMonthKey(month)) return jsonError("Invalid month. Use YYYY-MM.", 400);

    const studentResult = await getStudentForParent({
      schoolId: ctx.schoolId,
      parentId: ctx.parentId,
      studentId,
    });

    if (!studentResult.ok) {
      return jsonError(studentResult.error || "Falha ao buscar aluno.", studentResult.status);
    }

    const student = studentResult.student;
    const activeClass = studentResult.activeClass;

    const { startYMD, endYMD, endInclusiveYMD } = monthRange(month);

    const blockedResult = await getApplicableBlockedDates({
      schoolId: ctx.schoolId,
      classId: activeClass?.id || null,
      classShift: activeClass?.shift || null,
      startYMD,
      endInclusiveYMD,
    });

    if (!blockedResult.ok) {
      return jsonError("Erro ao verificar calendário escolar.", 500, {
        details: blockedResult.error,
      });
    }

    const blockedDates = blockedResult.blockedDates;

    let sessionsQuery = supabaseAdmin
      .from("attendance_sessions")
      .select("id, school_id, class_id, lesson_date, lesson_number")
      .eq("school_id", ctx.schoolId)
      .gte("lesson_date", startYMD)
      .lt("lesson_date", endYMD)
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
      (session) => !blockedDates.has(cleanText(session.lesson_date))
    );

    const sessionIds = sessions.map((session) => String(session.id)).filter(Boolean);

    let records: Array<{
      session_id: string;
      student_id: string;
      status: AttendanceStatus;
      statusLabel: string;
      lesson_date: string;
      lesson_number: number | null;
    }> = [];

    if (sessionIds.length > 0) {
      const { data: recordData, error: recordsErr } = await supabaseAdmin
        .from("attendance_records")
        .select("session_id, student_id, status")
        .eq("school_id", ctx.schoolId)
        .eq("student_id", studentId)
        .in("session_id", sessionIds);

      if (recordsErr) {
        return jsonError("attendance_records lookup failed: " + recordsErr.message, 500);
      }

      const sessionById = new Map<string, any>();

      for (const session of sessions) {
        sessionById.set(String(session.id), session);
      }

      records = (recordData || [])
        .map((record: any) => {
          const status = normalizeStatus(record.status);
          const session = sessionById.get(String(record.session_id));

          if (!status || !session) return null;

          return {
            session_id: String(record.session_id),
            student_id: String(record.student_id),
            status,
            statusLabel: statusLabel(status),
            lesson_date: cleanText(session.lesson_date),
            lesson_number: session.lesson_number ?? null,
          };
        })
        .filter(Boolean) as any[];
    }

    const totalPresent = records.filter((record) => record.status === "present").length;
    const totalAbsent = records.filter((record) => record.status === "absent").length;
    const totalLate = records.filter((record) => record.status === "late").length;

    const totalSessions = sessions.length;
    const totalRecords = records.length;
    const attendancePercentage =
      totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : null;

    return jsonOk({
      student: {
        id: student.id,
        full_name: student.full_name ?? null,
        registration_number: student.registration_number ?? null,
        activeClass,
      },
      month,
      range: {
        startYMD,
        endYMD,
        endInclusiveYMD,
      },
      sessions,
      records,
      calendarBlocks: blockedResult.blocks,
      blockedDates: Array.from(blockedDates),
      summary: {
        totalSessions,
        totalRecords,
        present: totalPresent,
        absent: totalAbsent,
        late: totalLate,
        blockedDaysRemoved: blockedDates.size,
        attendancePercentage,
      },
      meta: {
        source: "parent_attendance_monthly_sessions_records_calendar_blocks_v1",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/parent/attendance/monthly", 500);
  }
}