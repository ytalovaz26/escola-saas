import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentChild = {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  relationship: string | null;
  activeClass: null | {
    classId: string;
    className: string;
    grade: string | null;
    shift: string | null;
  };
};

type CalendarBlockRow = {
  id: string;
  school_id: string;
  block_date: string;
  type: string;
  title: string;
  description: string | null;
  affects_all_classes: boolean | null;
  target_scope: "all_school" | "class" | "shift" | string | null;
  class_id: string | null;
  shift: string | null;
  created_at: string | null;
};

type ParentScheduleEvent = {
  id: string;
  source: "official_schedule" | "school_event";
  type: "class" | "event";
  title: string;
  description: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  studentId: string | null;
  studentName: string | null;
  classId: string | null;
  className: string | null;
  classShift?: string | null;
  subjectId: string | null;
  subjectName: string | null;
  teacherUserId: string | null;
  teacherName: string | null;
  teacherEmail: string | null;
  room: string | null;
  notes: string | null;
  createdAt: string | null;
  isCalendarBlock?: boolean;
  blockTargetScope?: "all_school" | "class" | "shift" | string | null;
  blockShift?: string | null;
};

function jsonOk(body: Record<string, any> = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
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
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseDate: string, days: number) {
  const d = new Date(`${baseDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function jsWeekday(date: string) {
  return new Date(`${date}T12:00:00`).getDay();
}

function possibleWeekdaysForDate(date: string) {
  const day = jsWeekday(date);

  if (day === 0) return [0, 7];

  return [day];
}

function normalizeDate(value: unknown) {
  const safe = cleanText(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe;

  return todayISO();
}

function normalizeTime(value: unknown) {
  const safe = cleanText(value);

  if (!safe) return null;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(safe)) return safe;
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(safe)) return safe.slice(0, 5);

  return safe;
}

function teacherNameFromEmail(email?: string | null) {
  const safe = cleanText(email);

  if (!safe) return "Professor";

  const beforeAt = safe.split("@")[0] || safe;

  const pretty = beforeAt
    .split(/[.\-_ ]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

  return pretty || "Professor";
}

function classDisplayName(cls: any) {
  const parts = [cls?.name, cls?.grade, cls?.shift]
    .map(cleanText)
    .filter(Boolean);

  return parts.join(" • ") || "Turma";
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

function isBlockTargetingChild(block: CalendarBlockRow, child: ParentChild) {
  const scope = cleanText(block.target_scope) || "all_school";

  if (scope === "all_school" || block.affects_all_classes === true) return true;

  if (scope === "class") {
    return cleanText(block.class_id) === cleanText(child.activeClass?.classId);
  }

  if (scope === "shift") {
    return (
      !!cleanText(block.shift) &&
      normalizeComparable(block.shift) === normalizeComparable(child.activeClass?.shift)
    );
  }

  return false;
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
      response: jsonError("Sessão inválida.", 401, {
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
      response: jsonError("Falha ao buscar responsável: " + parentErr.message, 500),
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Você não está cadastrado como responsável.", 403),
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

async function loadChildren(params: {
  schoolId: string;
  parentId: string;
}) {
  const { data: links, error: linksErr } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, relationship, is_active")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("is_active", true);

  if (linksErr) {
    throw new Error("Falha ao buscar vínculos dos filhos: " + linksErr.message);
  }

  const studentIds = Array.from(
    new Set((links || []).map((row: any) => cleanText(row.student_id)).filter(Boolean))
  );

  if (studentIds.length === 0) return [];

  const relationshipByStudent = new Map<string, string | null>();

  for (const link of links || []) {
    relationshipByStudent.set(
      String(link.student_id),
      cleanText((link as any).relationship) || null
    );
  }

  const [studentsRes, studentClassesRes] = await Promise.all([
    supabaseAdmin
      .from("students")
      .select("id, school_id, full_name, registration_number, class_id")
      .eq("school_id", params.schoolId)
      .in("id", studentIds),

    supabaseAdmin
      .from("student_classes")
      .select("student_id, class_id, started_at, ended_at, is_active")
      .eq("school_id", params.schoolId)
      .in("student_id", studentIds),
  ]);

  if (studentsRes.error) {
    throw new Error("Falha ao buscar filhos: " + studentsRes.error.message);
  }

  if (studentClassesRes.error) {
    throw new Error("Falha ao buscar turmas dos filhos: " + studentClassesRes.error.message);
  }

  const activeByStudent = new Map<string, any>();

  for (const row of studentClassesRes.data || []) {
    const studentId = String(row.student_id);

    const isActive =
      row.is_active === true ||
      row.ended_at === null ||
      row.ended_at === undefined ||
      cleanText(row.ended_at) === "";

    const previous = activeByStudent.get(studentId);

    if (!previous && isActive) {
      activeByStudent.set(studentId, row);
      continue;
    }

    if (previous && isActive) {
      const prevStarted = cleanText(previous.started_at);
      const nextStarted = cleanText(row.started_at);

      if (nextStarted > prevStarted) {
        activeByStudent.set(studentId, row);
      }
    }
  }

  const legacyClassIds = (studentsRes.data || [])
    .map((student: any) => cleanText(student.class_id))
    .filter(Boolean);

  const linkedClassIds = Array.from(activeByStudent.values())
    .map((row: any) => cleanText(row.class_id))
    .filter(Boolean);

  const classIds = Array.from(new Set([...linkedClassIds, ...legacyClassIds]));

  let classById = new Map<string, any>();

  if (classIds.length > 0) {
    const { data: classes, error: classesErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id, name, grade, shift")
      .eq("school_id", params.schoolId)
      .in("id", classIds);

    if (classesErr) {
      throw new Error("Falha ao buscar turmas: " + classesErr.message);
    }

    classById = new Map((classes || []).map((cls: any) => [String(cls.id), cls]));
  }

  const children: ParentChild[] = (studentsRes.data || [])
    .map((student: any) => {
      const active = activeByStudent.get(String(student.id)) || null;

      const classId =
        cleanText(active?.class_id) ||
        cleanText(student.class_id) ||
        "";

      const cls = classId ? classById.get(classId) : null;

      return {
        id: String(student.id),
        fullName: cleanText(student.full_name) || "Aluno",
        registrationNumber: student.registration_number ?? null,
        relationship: relationshipByStudent.get(String(student.id)) ?? null,
        activeClass: classId
          ? {
              classId,
              className: cls ? classDisplayName(cls) : "Turma",
              grade: cls?.grade ?? null,
              shift: cls?.shift ?? null,
            }
          : null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));

  return children;
}

async function getAuthUsersMap(userIds: string[]) {
  const uniqueIds = Array.from(new Set(userIds.map(cleanText).filter(Boolean)));
  const map = new Map<string, { email: string | null; name: string }>();

  await Promise.all(
    uniqueIds.map(async (userId) => {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (error || !data?.user) {
          map.set(userId, { email: null, name: "Professor" });
          return;
        }

        const email = data.user.email || null;
        const name =
          cleanText((data.user.user_metadata as any)?.full_name) ||
          cleanText((data.user.user_metadata as any)?.name) ||
          teacherNameFromEmail(email);

        map.set(userId, { email, name });
      } catch {
        map.set(userId, { email: null, name: "Professor" });
      }
    })
  );

  return map;
}

async function loadOfficialScheduleEvents(params: {
  schoolId: string;
  children: ParentChild[];
  selectedStudentId: string;
  startDate: string;
  days: number;
}) {
  const visibleChildren =
    params.selectedStudentId === "all"
      ? params.children
      : params.children.filter((child) => child.id === params.selectedStudentId);

  const childrenWithClass = visibleChildren.filter((child) => child.activeClass?.classId);

  if (childrenWithClass.length === 0) return [];

  const classIds = Array.from(
    new Set(
      childrenWithClass
        .map((child) => cleanText(child.activeClass?.classId))
        .filter(Boolean)
    )
  );

  if (classIds.length === 0) return [];

  const { data: scheduleRows, error: scheduleErr } = await supabaseAdmin
    .from("school_class_schedule")
    .select(
      `
      id,
      school_id,
      class_id,
      teacher_user_id,
      subject_id,
      weekday,
      start_time,
      end_time,
      room,
      notes,
      is_active,
      created_at
    `
    )
    .eq("school_id", params.schoolId)
    .in("class_id", classIds)
    .eq("is_active", true)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (scheduleErr) {
    throw new Error("Falha ao buscar rotina escolar: " + scheduleErr.message);
  }

  const rows = scheduleRows || [];

  if (rows.length === 0) return [];

  const subjectIds = Array.from(
    new Set(rows.map((row: any) => cleanText(row.subject_id)).filter(Boolean))
  );

  const teacherIds = Array.from(
    new Set(rows.map((row: any) => cleanText(row.teacher_user_id)).filter(Boolean))
  );

  let subjectsById = new Map<string, { id: string; name: string }>();

  if (subjectIds.length > 0) {
    const { data: subjects, error: subjectsErr } = await supabaseAdmin
      .from("subjects")
      .select("id, school_id, name")
      .eq("school_id", params.schoolId)
      .in("id", subjectIds);

    if (subjectsErr) {
      throw new Error("Falha ao buscar disciplinas da rotina: " + subjectsErr.message);
    }

    subjectsById = new Map(
      (subjects || []).map((subject: any) => [
        String(subject.id),
        {
          id: String(subject.id),
          name: cleanText(subject.name) || "Disciplina",
        },
      ])
    );
  }

  const teachersById = await getAuthUsersMap(teacherIds);

  const childrenByClass = new Map<string, ParentChild[]>();

  for (const child of childrenWithClass) {
    const classId = cleanText(child.activeClass?.classId);

    if (!classId) continue;

    const arr = childrenByClass.get(classId) || [];
    arr.push(child);
    childrenByClass.set(classId, arr);
  }

  const events: ParentScheduleEvent[] = [];

  for (let i = 0; i < params.days; i++) {
    const date = addDaysISO(params.startDate, i);
    const possibleWeekdays = possibleWeekdaysForDate(date);

    const dayRows = rows.filter((row: any) =>
      possibleWeekdays.includes(Number(row.weekday))
    );

    for (const row of dayRows) {
      const classId = cleanText(row.class_id);
      const relatedChildren = childrenByClass.get(classId) || [];

      for (const child of relatedChildren) {
        const subjectId = cleanText(row.subject_id) || null;
        const subject = subjectId ? subjectsById.get(subjectId) : null;

        const teacherUserId = cleanText(row.teacher_user_id) || null;
        const teacher = teacherUserId ? teachersById.get(teacherUserId) : null;

        const subjectName = subject?.name || "Aula";
        const className = child.activeClass?.className || "Turma";

        events.push({
          id: `routine-${row.id}-${child.id}-${date}`,
          source: "official_schedule",
          type: "class",
          title: `${subjectName} • ${className}`,
          description: cleanText(row.notes) || "Aula cadastrada na grade oficial da escola.",
          date,
          startTime: normalizeTime(row.start_time),
          endTime: normalizeTime(row.end_time),
          studentId: child.id,
          studentName: child.fullName,
          classId,
          className,
          classShift: child.activeClass?.shift || null,
          subjectId,
          subjectName,
          teacherUserId,
          teacherName: teacher?.name || null,
          teacherEmail: teacher?.email || null,
          room: cleanText(row.room) || null,
          notes: cleanText(row.notes) || null,
          createdAt: row.created_at || null,
        });
      }
    }
  }

  return events;
}

async function loadSchoolEvents(params: {
  schoolId: string;
  selectedStudentId: string;
  children: ParentChild[];
}) {
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select("id, school_id, title, description, event_date, created_at")
    .eq("school_id", params.schoolId)
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return [];

  const targetChildren =
    params.selectedStudentId === "all"
      ? params.children
      : params.children.filter((child) => child.id === params.selectedStudentId);

  const selectedChild =
    params.selectedStudentId === "all" ? null : targetChildren[0] || null;

  return (data || []).map((ev: any): ParentScheduleEvent => ({
    id: `event-${ev.id}`,
    source: "school_event",
    type: "event",
    title: cleanText(ev.title) || "Evento escolar",
    description: cleanText(ev.description) || null,
    date: normalizeDate(ev.event_date),
    startTime: null,
    endTime: null,
    studentId: selectedChild?.id || null,
    studentName: selectedChild?.fullName || null,
    classId: null,
    className: null,
    classShift: null,
    subjectId: null,
    subjectName: null,
    teacherUserId: null,
    teacherName: null,
    teacherEmail: null,
    room: null,
    notes: null,
    createdAt: ev.created_at || null,
  }));
}

async function loadCalendarBlockEvents(params: {
  schoolId: string;
  selectedStudentId: string;
  children: ParentChild[];
  startDate: string;
  days: number;
}) {
  const endDate = addDaysISO(params.startDate, params.days - 1);

  const { data, error } = await supabaseAdmin
    .from("school_calendar_blocks")
    .select(
      `
      id,
      school_id,
      block_date,
      type,
      title,
      description,
      affects_all_classes,
      target_scope,
      class_id,
      shift,
      created_at
    `
    )
    .eq("school_id", params.schoolId)
    .gte("block_date", params.startDate)
    .lte("block_date", endDate)
    .order("block_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return [];

  const targetChildren =
    params.selectedStudentId === "all"
      ? params.children
      : params.children.filter((child) => child.id === params.selectedStudentId);

  const events: ParentScheduleEvent[] = [];

  for (const block of (data || []) as CalendarBlockRow[]) {
    const scope = cleanText(block.target_scope) || "all_school";
    const affectedChildren = targetChildren.filter((child) =>
      isBlockTargetingChild(block, child)
    );

    if (affectedChildren.length === 0) continue;

    const title = `${blockTypeLabel(block.type)} • ${
      cleanText(block.title) || "Não haverá aula"
    }`;

    const description =
      cleanText(block.description) ||
      "A escola informou que não haverá aula para esta data.";

    if (params.selectedStudentId === "all") {
      const firstChild = affectedChildren[0] || null;

      events.push({
        id: `block-${block.id}`,
        source: "school_event",
        type: "event",
        title,
        description,
        date: normalizeDate(block.block_date),
        startTime: null,
        endTime: null,
        studentId: null,
        studentName: null,
        classId: scope === "class" ? cleanText(block.class_id) || null : null,
        className:
          scope === "class"
            ? firstChild?.activeClass?.className || "Turma específica"
            : scope === "shift"
              ? `Turno: ${cleanText(block.shift)}`
              : "Toda a escola",
        classShift: scope === "shift" ? cleanText(block.shift) || null : null,
        subjectId: null,
        subjectName: "Não haverá aula",
        teacherUserId: null,
        teacherName: null,
        teacherEmail: null,
        room: null,
        notes: description,
        createdAt: block.created_at || null,
        isCalendarBlock: true,
        blockTargetScope: scope,
        blockShift: cleanText(block.shift) || null,
      });

      continue;
    }

    for (const child of affectedChildren) {
      events.push({
        id: `block-${block.id}-${child.id}`,
        source: "school_event",
        type: "event",
        title,
        description,
        date: normalizeDate(block.block_date),
        startTime: null,
        endTime: null,
        studentId: child.id,
        studentName: child.fullName,
        classId:
          scope === "class"
            ? cleanText(block.class_id) || child.activeClass?.classId || null
            : child.activeClass?.classId || null,
        className: child.activeClass?.className || null,
        classShift: child.activeClass?.shift || null,
        subjectId: null,
        subjectName: "Não haverá aula",
        teacherUserId: null,
        teacherName: null,
        teacherEmail: null,
        room: null,
        notes: description,
        createdAt: block.created_at || null,
        isCalendarBlock: true,
        blockTargetScope: scope,
        blockShift: cleanText(block.shift) || null,
      });
    }
  }

  return events;
}

function filterRoutineEventsByBlocks(params: {
  routineEvents: ParentScheduleEvent[];
  blockEvents: ParentScheduleEvent[];
}) {
  if (params.blockEvents.length === 0) return params.routineEvents;

  return params.routineEvents.filter((event) => {
    return !params.blockEvents.some((block) => {
      if (!block.isCalendarBlock) return false;
      if (block.date !== event.date) return false;

      const scope = cleanText(block.blockTargetScope) || "all_school";

      if (scope === "all_school") return true;

      if (scope === "class") {
        return !!block.classId && block.classId === event.classId;
      }

      if (scope === "shift") {
        return (
          !!cleanText(block.blockShift) &&
          normalizeComparable(block.blockShift) === normalizeComparable(event.classShift)
        );
      }

      return false;
    });
  });
}

export async function GET(req: Request) {
  const ctx = await getParentContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const url = new URL(req.url);

    const selectedStudentId = cleanText(url.searchParams.get("studentId")) || "all";
    const startDate = normalizeDate(url.searchParams.get("startDate"));
    const daysParam = Number(url.searchParams.get("days") || "45");

    const days = Number.isFinite(daysParam)
      ? Math.min(Math.max(daysParam, 1), 90)
      : 45;

    const children = await loadChildren({
      schoolId: ctx.schoolId,
      parentId: ctx.parentId,
    });

    if (selectedStudentId !== "all") {
      const ownsStudent = children.some((child) => child.id === selectedStudentId);

      if (!ownsStudent) {
        return jsonError("Aluno não encontrado para este responsável.", 404);
      }
    }

    const [rawRoutineEvents, schoolEvents, blockEvents] = await Promise.all([
      loadOfficialScheduleEvents({
        schoolId: ctx.schoolId,
        children,
        selectedStudentId,
        startDate,
        days,
      }),
      loadSchoolEvents({
        schoolId: ctx.schoolId,
        selectedStudentId,
        children,
      }),
      loadCalendarBlockEvents({
        schoolId: ctx.schoolId,
        selectedStudentId,
        children,
        startDate,
        days,
      }),
    ]);

    const routineEvents = filterRoutineEventsByBlocks({
      routineEvents: rawRoutineEvents,
      blockEvents,
    });

    const events = [...routineEvents, ...schoolEvents, ...blockEvents].sort((a, b) => {
      const ad = `${a.date}T${a.startTime || "99:99"}:00`;
      const bd = `${b.date}T${b.startTime || "99:99"}:00`;

      return ad.localeCompare(bd);
    });

    return jsonOk({
      parent: {
        parentId: ctx.parentId,
        name: ctx.parentName,
        email: ctx.user.email || null,
      },
      schoolId: ctx.schoolId,
      selectedStudentId,
      children,
      events,
      summary: {
        total: events.length,
        routine: routineEvents.length,
        schoolEvents: schoolEvents.length + blockEvents.length,
        children: children.length,
      },
      debug: {
        children: children.map((child) => ({
          id: child.id,
          name: child.fullName,
          classId: child.activeClass?.classId || null,
          className: child.activeClass?.className || null,
          shift: child.activeClass?.shift || null,
        })),
        blocks: blockEvents.map((block) => ({
          id: block.id,
          date: block.date,
          title: block.title,
          targetScope: block.blockTargetScope,
          classId: block.classId,
          shift: block.blockShift,
        })),
      },
      meta: {
        startDate,
        days,
        source: "parent_schedule_official_class_routine_with_calendar_blocks",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar rotina escolar.", 500);
  }
}