import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type CalendarClass = {
  id: string;
  name: string;
  grade?: string | null;
  section?: string | null;
  shift?: string | null;
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

function classDisplayName(cls: CalendarClass) {
  const parts = [
    cleanText(cls.name),
    cleanText(cls.grade),
    cleanText(cls.section),
    cleanText(cls.shift),
  ].filter(Boolean);

  return parts.length ? parts.join(" • ") : "Turma";
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
    .select("school_id, role, is_active, created_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
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

async function getTeacherClasses(params: {
  teacherUserId: string;
  schoolId: string;
}) {
  const { data: links, error: linksErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("class_id")
    .eq("teacher_user_id", params.teacherUserId);

  if (linksErr) {
    throw new Error("Falha ao buscar turmas do professor: " + linksErr.message);
  }

  const classIds = Array.from(
    new Set(
      (links || [])
        .map((item: any) => cleanText(item.class_id))
        .filter(Boolean)
    )
  );

  if (classIds.length === 0) {
    return [];
  }

  const { data: classesBasic, error: classesBasicErr } = await supabaseAdmin
    .from("classes")
    .select("id, name, grade, section, shift, school_id")
    .in("id", classIds)
    .eq("school_id", params.schoolId)
    .order("name", { ascending: true });

  if (!classesBasicErr && Array.isArray(classesBasic)) {
    return classesBasic.map((cls: any) => ({
      id: String(cls.id),
      name: cleanText(cls.name) || "Turma",
      grade: cleanText(cls.grade) || null,
      section: cleanText(cls.section) || null,
      shift: cleanText(cls.shift) || null,
    })) as CalendarClass[];
  }

  const { data: classesFallback, error: classesFallbackErr } = await supabaseAdmin
    .from("classes")
    .select("id, name")
    .in("id", classIds)
    .order("name", { ascending: true });

  if (classesFallbackErr) {
    throw new Error("Falha ao buscar dados das turmas: " + classesFallbackErr.message);
  }

  return (classesFallback || []).map((cls: any) => ({
    id: String(cls.id),
    name: cleanText(cls.name) || "Turma",
    grade: null,
    section: null,
    shift: null,
  })) as CalendarClass[];
}

function buildInternalAgenda(params: {
  classes: CalendarClass[];
  startDate: string;
  days: number;
}) {
  const events: CalendarEvent[] = [];

  const usefulWeekdays = [1, 2, 3, 4, 5];

  const timeSlots = [
    ["07:00", "07:50"],
    ["07:50", "08:40"],
    ["08:40", "09:30"],
    ["09:50", "10:40"],
    ["10:40", "11:30"],
    ["13:00", "13:50"],
    ["13:50", "14:40"],
    ["14:40", "15:30"],
    ["15:50", "16:40"],
    ["16:40", "17:30"],
  ];

  const classes = params.classes.slice(0, 10);

  for (let i = 0; i < params.days; i++) {
    const date = addDaysISO(params.startDate, i);
    const weekday = getWeekday(date);

    if (!usefulWeekdays.includes(weekday)) continue;

    classes.forEach((cls, index) => {
      const slot = timeSlots[(index + weekday) % timeSlots.length];
      const className = classDisplayName(cls);

      events.push({
        id: `internal-${date}-${cls.id}-${index}`,
        type: "class",
        title: `Aula prevista • ${className}`,
        description:
          "Agenda interna inicial baseada nas turmas vinculadas ao professor. Na próxima etapa, estes horários serão conectados à grade oficial da escola.",
        date,
        startTime: slot[0],
        endTime: slot[1],
        classId: cls.id,
        className,
        status: "scheduled",
      });
    });
  }

  const planningDate = params.startDate;

  events.push({
    id: `planning-${planningDate}`,
    type: "planning",
    title: "Planejamento pedagógico",
    description:
      "Revise chamada, diário pedagógico, comunicados e conteúdos previstos para o dia.",
    date: planningDate,
    startTime: "06:40",
    endTime: "07:00",
    classId: null,
    className: null,
    status: "pending",
  });

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

    const classes = await getTeacherClasses({
      teacherUserId: ctx.user.id,
      schoolId: ctx.schoolId,
    });

    const events = buildInternalAgenda({
      classes,
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
          cleanText(ctx.user.email) ||
          "Professor",
      },
      schoolId: ctx.schoolId,
      classes,
      events,
      meta: {
        startDate,
        days,
        source: "internal_initial_calendar",
        hasOfficialSchedule: false,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar agenda do professor.", 500);
  }
}