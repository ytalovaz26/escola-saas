import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CalendarClass = {
  id: string;
  name: string;
};

type CalendarEvent = {
  id: string;
  type: "class" | "planning" | "notice";
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  classId?: string | null;
  className?: string | null;
  subjectId?: string | null;
  subjectName?: string | null;
  room?: string | null;
  notes?: string | null;
  status: "scheduled" | "pending" | "done";
};

function jsonOk(body: any = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isTeacherRole(role: unknown) {
  const r = normalizeRole(role);
  return r === "professor" || r === "teacher";
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

function getWeekday(date: string) {
  return new Date(`${date}T12:00:00`).getDay();
}

function normalizeTime(value: unknown) {
  const safe = cleanText(value);

  if (!safe) return "";
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

async function getTeacherContext(req: Request) {
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

  const { data: schoolUser, error: suErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (suErr) {
    return {
      ok: false as const,
      response: jsonError("Falha ao buscar vínculo escolar: " + suErr.message, 500),
    };
  }

  if (!schoolUser?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Usuário não vinculado a uma escola.", 403),
    };
  }

  if (!isTeacherRole(schoolUser.role)) {
    return {
      ok: false as const,
      response: jsonError(`Acesso negado. Role atual: "${schoolUser.role || "—"}".`, 403),
    };
  }

  return {
    ok: true as const,
    user,
    schoolId: String(schoolUser.school_id),
    role: String(schoolUser.role || "professor"),
  };
}

async function getTeacherLinkedClassIds(teacherUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("teacher_classes")
    .select("class_id")
    .eq("teacher_user_id", teacherUserId);

  if (error) {
    throw new Error("Falha ao buscar turmas vinculadas ao professor: " + error.message);
  }

  return Array.from(
    new Set((data || []).map((item: any) => cleanText(item.class_id)).filter(Boolean))
  );
}

async function getOfficialSchedule(params: {
  schoolId: string;
  teacherUserId: string;
}) {
  const { data, error } = await supabaseAdmin
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
      is_active
    `
    )
    .eq("school_id", params.schoolId)
    .eq("teacher_user_id", params.teacherUserId)
    .eq("is_active", true)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error("Falha ao buscar grade oficial do professor: " + error.message);
  }

  return data || [];
}

async function getClassesByIds(params: {
  schoolId: string;
  classIds: string[];
}) {
  const ids = Array.from(new Set(params.classIds.map(cleanText).filter(Boolean)));

  if (ids.length === 0) return new Map<string, CalendarClass>();

  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, name, school_id")
    .in("id", ids)
    .eq("school_id", params.schoolId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error("Falha ao buscar dados das turmas: " + error.message);
  }

  const map = new Map<string, CalendarClass>();

  for (const cls of data || []) {
    map.set(String(cls.id), {
      id: String(cls.id),
      name: cleanText(cls.name) || "Turma",
    });
  }

  return map;
}

async function getSubjectsByIds(params: {
  schoolId: string;
  subjectIds: string[];
}) {
  const ids = Array.from(new Set(params.subjectIds.map(cleanText).filter(Boolean)));

  if (ids.length === 0) return new Map<string, { id: string; name: string }>();

  const { data, error } = await supabaseAdmin
    .from("subjects")
    .select("id, name, school_id")
    .in("id", ids)
    .eq("school_id", params.schoolId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error("Falha ao buscar disciplinas da grade: " + error.message);
  }

  const map = new Map<string, { id: string; name: string }>();

  for (const subject of data || []) {
    map.set(String(subject.id), {
      id: String(subject.id),
      name: cleanText(subject.name) || "Disciplina",
    });
  }

  return map;
}

function buildOfficialEvents(params: {
  scheduleRows: any[];
  classesById: Map<string, CalendarClass>;
  subjectsById: Map<string, { id: string; name: string }>;
  startDate: string;
  days: number;
}) {
  const events: CalendarEvent[] = [];

  for (let i = 0; i < params.days; i++) {
    const date = addDaysISO(params.startDate, i);
    const weekday = getWeekday(date);

    const dayRows = params.scheduleRows.filter((row) => Number(row.weekday) === weekday);

    for (const row of dayRows) {
      const classId = cleanText(row.class_id);
      const subjectId = cleanText(row.subject_id) || null;

      const cls = params.classesById.get(classId);
      const subject = subjectId ? params.subjectsById.get(subjectId) : null;

      const className = cls?.name || "Turma";
      const subjectName = subject?.name || "Aula";

      const startTime = normalizeTime(row.start_time);
      const endTime = normalizeTime(row.end_time);

      events.push({
        id: `official-${row.id}-${date}`,
        type: "class",
        title: `${subjectName} • ${className}`,
        description:
          cleanText(row.notes) ||
          "Aula cadastrada na grade oficial da escola pelo painel da direção.",
        date,
        startTime,
        endTime,
        classId,
        className,
        subjectId,
        subjectName,
        room: cleanText(row.room) || null,
        notes: cleanText(row.notes) || null,
        status: "scheduled",
      });
    }
  }

  return events.sort((a, b) => {
    const da = `${a.date}T${a.startTime}:00`;
    const db = `${b.date}T${b.startTime}:00`;
    return da.localeCompare(db);
  });
}

export async function GET(req: Request) {
  const ctx = await getTeacherContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const url = new URL(req.url);

    const startDate = cleanText(url.searchParams.get("startDate")) || todayISO();
    const daysParam = Number(url.searchParams.get("days") || "31");
    const days = Number.isFinite(daysParam)
      ? Math.min(Math.max(daysParam, 1), 62)
      : 31;

    const [linkedClassIds, scheduleRows] = await Promise.all([
      getTeacherLinkedClassIds(ctx.user.id),
      getOfficialSchedule({
        schoolId: ctx.schoolId,
        teacherUserId: ctx.user.id,
      }),
    ]);

    const scheduleClassIds = scheduleRows
      .map((row: any) => cleanText(row.class_id))
      .filter(Boolean);

    const allClassIds = Array.from(new Set([...linkedClassIds, ...scheduleClassIds]));

    const subjectIds = scheduleRows
      .map((row: any) => cleanText(row.subject_id))
      .filter(Boolean);

    const [classesById, subjectsById] = await Promise.all([
      getClassesByIds({
        schoolId: ctx.schoolId,
        classIds: allClassIds,
      }),
      getSubjectsByIds({
        schoolId: ctx.schoolId,
        subjectIds,
      }),
    ]);

    const classes = Array.from(classesById.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR")
    );

    const events = buildOfficialEvents({
      scheduleRows,
      classesById,
      subjectsById,
      startDate,
      days,
    });

    return jsonOk({
      teacher: {
        userId: ctx.user.id,
        email: ctx.user.email || null,
        name:
          cleanText((ctx.user.user_metadata as any)?.full_name) ||
          cleanText((ctx.user.user_metadata as any)?.name) ||
          teacherNameFromEmail(ctx.user.email) ||
          "Professor",
      },
      schoolId: ctx.schoolId,
      classes,
      events,
      meta: {
        startDate,
        days,
        source: "official_school_class_schedule",
        hasOfficialSchedule: scheduleRows.length > 0,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar agenda do professor.", 500);
  }
}