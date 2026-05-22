"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
  subjectId: string | null;
  subjectName: string | null;
  teacherUserId: string | null;
  teacherName: string | null;
  teacherEmail: string | null;
  room: string | null;
  notes: string | null;
  createdAt: string | null;
};

type ParentSchedulePayload = {
  parent: {
    parentId: string;
    name: string;
    email: string | null;
  };
  schoolId: string;
  selectedStudentId: string;
  children: ParentChild[];
  events: ParentScheduleEvent[];
  summary: {
    total: number;
    routine: number;
    schoolEvents: number;
    children: number;
  };
  meta: {
    startDate: string;
    days: number;
    source: string;
  };
};

async function safeJsonFromResponse(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseDate: string, days: number) {
  const d = new Date(`${baseDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeekISO(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function endOfWeekISO(date: string) {
  return addDaysISO(startOfWeekISO(date), 6);
}

function monthStartISO(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function monthEndISO(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function calendarGridDates(date: string) {
  const monthStart = monthStartISO(date);
  const monthEnd = monthEndISO(date);

  const start = new Date(`${monthStart}T12:00:00`);
  const end = new Date(`${monthEnd}T12:00:00`);

  const startDay = start.getDay();
  const startDiff = startDay === 0 ? -6 : 1 - startDay;
  start.setDate(start.getDate() + startDiff);

  const endDay = end.getDay();
  const endDiff = endDay === 0 ? 0 : 7 - endDay;
  end.setDate(end.getDate() + endDiff);

  const dates: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function formatShortDateBR(date: string) {
  const [year, month, day] = String(date).slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatLongDateBR(date: string) {
  const d = new Date(`${date}T12:00:00`);

  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatMonthBR(date: string) {
  const d = new Date(`${date}T12:00:00`);

  return d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function weekdayLabel(date: string) {
  const labels = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
  ];

  const d = new Date(`${date}T12:00:00`);
  return labels[d.getDay()] || "";
}

function weekdayShortLabel(date: string) {
  const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const d = new Date(`${date}T12:00:00`);
  return labels[d.getDay()] || "";
}

function eventSort(a: ParentScheduleEvent, b: ParentScheduleEvent) {
  const ad = `${a.date}T${a.startTime || "99:99"}:00`;
  const bd = `${b.date}T${b.startTime || "99:99"}:00`;

  return ad.localeCompare(bd);
}

function isFutureOrToday(date: string) {
  return String(date).slice(0, 10) >= todayISO();
}

function sameMonth(a: string, b: string) {
  return a.slice(0, 7) === b.slice(0, 7);
}

function getTimeLabel(event: ParentScheduleEvent) {
  if (event.startTime && event.endTime) return `${event.startTime} - ${event.endTime}`;
  if (event.startTime) return event.startTime;
  return "Dia todo";
}

function getSubjectTitle(event: ParentScheduleEvent) {
  if (event.source === "school_event") return event.title;
  return event.subjectName || event.title || "Aula";
}

function getSelectedStudentLabel(
  children: ParentChild[],
  selectedStudentId: string
) {
  if (selectedStudentId === "all") return "Todos os filhos";

  const child = children.find((item) => item.id === selectedStudentId);

  return child?.fullName || "Filho selecionado";
}

function getSelectedStudentClass(
  children: ParentChild[],
  selectedStudentId: string
) {
  if (selectedStudentId === "all") return null;

  const child = children.find((item) => item.id === selectedStudentId);

  return child?.activeClass?.className || null;
}

function StatCard({
  label,
  value,
  description,
  tone = "default",
}: {
  label: string;
  value: string;
  description: string;
  tone?: "default" | "blue" | "green" | "amber";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-950"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-slate-200 bg-white text-slate-950";

  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${toneClass}`}>
      <div className="text-xs font-bold uppercase tracking-[0.18em] opacity-70">
        {label}
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight">{value}</div>

      <p className="mt-2 text-sm leading-6 opacity-75">{description}</p>
    </div>
  );
}

function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "blue" | "green" | "amber";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${toneClass}`}
    >
      {children}
    </span>
  );
}

function EmptyRoutine({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-3xl">
        🕒
      </div>

      <h3 className="mt-5 text-xl font-bold text-slate-950">{title}</h3>

      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        {description}
      </p>

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function ClassCard({
  event,
  compact = false,
}: {
  event: ParentScheduleEvent;
  compact?: boolean;
}) {
  const isClass = event.source === "official_schedule";

  return (
    <article className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Pill tone={isClass ? "green" : "blue"}>
              {isClass ? "Aula" : "Evento escolar"}
            </Pill>

            {event.studentName ? <Pill tone="amber">{event.studentName}</Pill> : null}

            <Pill>{formatShortDateBR(event.date)}</Pill>

            {event.room ? <Pill>Sala: {event.room}</Pill> : null}
          </div>

          <h3 className="mt-4 break-words text-xl font-bold text-slate-950">
            {getSubjectTitle(event)}
          </h3>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {event.className ? (
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Turma
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">
                  {event.className}
                </div>
              </div>
            ) : null}

            {event.teacherName || event.teacherEmail ? (
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Professor
                </div>
                <div className="mt-1 break-words text-sm font-semibold text-slate-800">
                  {event.teacherName || "Professor"}
                  {event.teacherEmail ? (
                    <span className="font-normal text-slate-500">
                      {" "}
                      • {event.teacherEmail}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {event.description ? (
            <p
              className={[
                "mt-4 break-words rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600",
                compact ? "line-clamp-3" : "",
              ].join(" ")}
            >
              {event.description}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 rounded-[24px] bg-slate-950 px-5 py-4 text-center text-white xl:w-40">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Horário
          </div>

          <div className="mt-2 text-lg font-bold">{getTimeLabel(event)}</div>

          <div className="mt-2 text-xs font-medium capitalize text-slate-300">
            {weekdayLabel(event.date)}
          </div>
        </div>
      </div>
    </article>
  );
}

function DayBlock({
  date,
  events,
}: {
  date: string;
  events: ParentScheduleEvent[];
}) {
  return (
    <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            {weekdayLabel(date)}
          </div>

          <h3 className="mt-1 text-xl font-bold capitalize text-slate-950">
            {formatLongDateBR(date)}
          </h3>
        </div>

        <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600">
          {events.length} aula(s)
        </div>
      </div>

      {events.length > 0 ? (
        <div className="space-y-4">
          {events.map((event) => (
            <ClassCard key={event.id} event={event} compact />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          Nenhuma aula cadastrada para este dia.
        </div>
      )}
    </section>
  );
}

function MonthCalendar({
  selectedDate,
  routineEvents,
  schoolEvents,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
}: {
  selectedDate: string;
  routineEvents: ParentScheduleEvent[];
  schoolEvents: ParentScheduleEvent[];
  onSelectDate: (date: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}) {
  const dates = useMemo(() => calendarGridDates(selectedDate), [selectedDate]);

  const eventsByDate = useMemo(() => {
    const map = new Map<
      string,
      {
        routine: ParentScheduleEvent[];
        school: ParentScheduleEvent[];
      }
    >();

    for (const date of dates) {
      map.set(date, { routine: [], school: [] });
    }

    for (const event of routineEvents) {
      const current = map.get(event.date) || { routine: [], school: [] };
      current.routine.push(event);
      map.set(event.date, current);
    }

    for (const event of schoolEvents) {
      const current = map.get(event.date) || { routine: [], school: [] };
      current.school.push(event);
      map.set(event.date, current);
    }

    return map;
  }, [dates, routineEvents, schoolEvents]);

  const selectedDayEvents = eventsByDate.get(selectedDate) || {
    routine: [],
    school: [],
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            Calendário mensal
          </div>

          <h3 className="mt-2 text-2xl font-bold capitalize text-slate-950">
            {formatMonthBR(selectedDate)}
          </h3>

          <p className="mt-1 text-sm text-slate-500">
            Visualize os dias com aulas e compromissos escolares.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPreviousMonth}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            Mês anterior
          </button>

          <button
            type="button"
            onClick={onNextMonth}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            Próximo mês
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
          <div
            key={day}
            className="hidden rounded-2xl bg-slate-100 px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.16em] text-slate-500 md:block"
          >
            {day}
          </div>
        ))}

        {dates.map((date) => {
          const dayData = eventsByDate.get(date) || { routine: [], school: [] };
          const total = dayData.routine.length + dayData.school.length;
          const selected = date === selectedDate;
          const isToday = date === todayISO();
          const inCurrentMonth = sameMonth(date, selectedDate);

          return (
            <button
              type="button"
              key={date}
              onClick={() => onSelectDate(date)}
              className={[
                "min-h-[132px] rounded-[26px] border p-4 text-left transition",
                selected
                  ? "border-slate-950 bg-slate-950 text-white shadow-md"
                  : "border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:shadow-md",
                !inCurrentMonth && !selected ? "opacity-45" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div
                    className={[
                      "text-xs font-bold uppercase tracking-wide",
                      selected ? "text-slate-300" : "text-slate-400",
                    ].join(" ")}
                  >
                    {weekdayShortLabel(date)}
                  </div>

                  <div className="mt-1 text-2xl font-bold">{date.slice(8, 10)}</div>
                </div>

                {isToday ? (
                  <span
                    className={[
                      "rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
                      selected
                        ? "bg-white/10 text-white"
                        : "bg-emerald-50 text-emerald-700",
                    ].join(" ")}
                  >
                    Hoje
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                <div
                  className={[
                    "rounded-full px-3 py-1 text-xs font-bold",
                    selected ? "bg-white/10 text-white" : "bg-emerald-50 text-emerald-700",
                  ].join(" ")}
                >
                  {dayData.routine.length} aula(s)
                </div>

                <div
                  className={[
                    "rounded-full px-3 py-1 text-xs font-bold",
                    selected ? "bg-white/10 text-white" : "bg-blue-50 text-blue-700",
                  ].join(" ")}
                >
                  {dayData.school.length} compromisso(s)
                </div>

                {total > 0 ? (
                  <div
                    className={[
                      "text-xs font-semibold",
                      selected ? "text-slate-300" : "text-slate-500",
                    ].join(" ")}
                  >
                    Toque para ver detalhes
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-[30px] border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Detalhes do dia
            </div>

            <h4 className="mt-1 text-xl font-bold capitalize text-slate-950">
              {formatLongDateBR(selectedDate)}
            </h4>
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill tone="green">{selectedDayEvents.routine.length} aula(s)</Pill>
            <Pill tone="blue">{selectedDayEvents.school.length} compromisso(s)</Pill>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {selectedDayEvents.routine.length > 0 ? (
            selectedDayEvents.routine.sort(eventSort).map((event) => (
              <ClassCard key={event.id} event={event} compact />
            ))
          ) : selectedDayEvents.school.length > 0 ? null : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Nenhuma aula ou compromisso encontrado para este dia.
            </div>
          )}

          {selectedDayEvents.school.length > 0 ? (
            <div className="space-y-3">
              {selectedDayEvents.school.sort(eventSort).map((event) => (
                <article
                  key={event.id}
                  className="rounded-[26px] border border-blue-100 bg-blue-50 p-5"
                >
                  <div className="flex flex-wrap gap-2">
                    <Pill tone="blue">Compromisso escolar</Pill>
                    <Pill>{formatShortDateBR(event.date)}</Pill>
                  </div>

                  <h5 className="mt-3 text-lg font-bold text-slate-950">
                    {event.title}
                  </h5>

                  {event.description ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {event.description}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ParentSchedulePage() {
  const router = useRouter();

  const [payload, setPayload] = useState<ParentSchedulePayload | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [view, setView] = useState<"today" | "week" | "month" | "all">("today");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const children = payload?.children || [];
  const events = payload?.events || [];

  const routineEvents = useMemo(() => {
    return events
      .filter((event) => event.source === "official_schedule")
      .sort(eventSort);
  }, [events]);

  const schoolEvents = useMemo(() => {
    return events.filter((event) => event.source === "school_event").sort(eventSort);
  }, [events]);

  const selectedStudentLabel = useMemo(() => {
    return getSelectedStudentLabel(children, selectedStudentId);
  }, [children, selectedStudentId]);

  const selectedStudentClass = useMemo(() => {
    return getSelectedStudentClass(children, selectedStudentId);
  }, [children, selectedStudentId]);

  const todayEvents = useMemo(() => {
    return routineEvents
      .filter((event) => event.date === selectedDate)
      .sort(eventSort);
  }, [routineEvents, selectedDate]);

  const weekDates = useMemo(() => {
    const start = startOfWeekISO(selectedDate);
    return Array.from({ length: 7 }).map((_, index) => addDaysISO(start, index));
  }, [selectedDate]);

  const weekEvents = useMemo(() => {
    return routineEvents
      .filter((event) => weekDates.includes(event.date))
      .sort(eventSort);
  }, [routineEvents, weekDates]);

  const futureRoutineEvents = useMemo(() => {
    return routineEvents
      .filter((event) => isFutureOrToday(event.date))
      .sort(eventSort);
  }, [routineEvents]);

  const nextClasses = useMemo(() => {
    return futureRoutineEvents.slice(0, 5);
  }, [futureRoutineEvents]);

  const nextClass = nextClasses[0] || null;

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadSchedule(params?: {
    studentId?: string;
    date?: string;
  }) {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();

      if (!token) return;

      const nextStudentId = params?.studentId ?? selectedStudentId;
      const nextDate = params?.date ?? selectedDate;

      const startDate = addDaysISO(monthStartISO(nextDate), -7);

      const qs = new URLSearchParams({
        studentId: nextStudentId,
        startDate,
        days: "60",
      });

      const res = await fetch(`/api/parent/schedule?${qs.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJsonFromResponse(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar horários do aluno.");
        return;
      }

      setPayload({
        parent: json.parent,
        schoolId: json.schoolId,
        selectedStudentId: json.selectedStudentId,
        children: Array.isArray(json.children) ? json.children : [],
        events: Array.isArray(json.events) ? json.events : [],
        summary: json.summary || {
          total: 0,
          routine: 0,
          schoolEvents: 0,
          children: 0,
        },
        meta: json.meta,
      });
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar horários do aluno.");
    } finally {
      setLoading(false);
    }
  }

  function changeStudent(studentId: string) {
    setSelectedStudentId(studentId);

    const qs =
      studentId === "all" ? "" : `?studentId=${encodeURIComponent(studentId)}`;

    router.replace(`/parent/schedule${qs}`);
    loadSchedule({ studentId, date: selectedDate });
  }

  function changeDate(date: string) {
    setSelectedDate(date);
    loadSchedule({ studentId: selectedStudentId, date });
  }

  function moveDate(days: number) {
    const next = addDaysISO(selectedDate, days);
    changeDate(next);
  }

  function moveMonth(months: number) {
    const d = new Date(`${selectedDate}T12:00:00`);
    d.setMonth(d.getMonth() + months);
    const next = d.toISOString().slice(0, 10);
    changeDate(next);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlStudentId = params.get("studentId") || "all";

    setSelectedStudentId(urlStudentId);
    loadSchedule({ studentId: urlStudentId, date: selectedDate });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !payload) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
          <div className="h-64 animate-pulse rounded-[36px] bg-slate-200" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="h-32 animate-pulse rounded-[28px] bg-white" />
            <div className="h-32 animate-pulse rounded-[28px] bg-white" />
            <div className="h-32 animate-pulse rounded-[28px] bg-white" />
            <div className="h-32 animate-pulse rounded-[28px] bg-white" />
          </div>

          <div className="h-96 animate-pulse rounded-[32px] bg-white" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
          <div className="relative overflow-hidden bg-slate-950 px-6 py-10 text-white md:px-8 md:py-12">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute -bottom-24 left-20 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                  Rotina escolar do aluno
                </div>

                <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                  Horários e rotina escolar
                </h1>

                <p className="mt-4 text-base leading-8 text-slate-200">
                  Acompanhe as aulas oficiais cadastradas pela escola, com disciplina,
                  professor, turma, sala, data e horário.
                </p>

                <div className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                    Visualização atual
                  </div>

                  <div className="mt-1 text-xl font-bold">{selectedStudentLabel}</div>

                  {selectedStudentClass ? (
                    <div className="mt-1 text-sm text-slate-300">
                      {selectedStudentClass}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    loadSchedule({
                      studentId: selectedStudentId,
                      date: selectedDate,
                    })
                  }
                  className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
                >
                  Atualizar horários
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent/calendar")}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
                >
                  Ver agenda
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
            <StatCard
              label="Aulas"
              value={String(routineEvents.length)}
              description="Aulas oficiais carregadas."
              tone="green"
            />

            <StatCard
              label="Hoje"
              value={String(todayEvents.length)}
              description="Aulas na data selecionada."
              tone="blue"
            />

            <StatCard
              label="Semana"
              value={String(weekEvents.length)}
              description={`${formatShortDateBR(startOfWeekISO(selectedDate))} até ${formatShortDateBR(
                endOfWeekISO(selectedDate)
              )}.`}
              tone="amber"
            />

            <StatCard
              label="Filhos"
              value={String(children.length)}
              description="Alunos vinculados à conta."
            />
          </div>
        </section>

        {error ? (
          <div className="rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_0.9fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Filtro da rotina
                </div>

                <h2 className="mt-2 text-2xl font-bold text-slate-950">
                  Escolha o filho e a data
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  A rotina é montada a partir da grade oficial cadastrada pela escola.
                </p>
              </div>

              <div className="w-full xl:w-[360px]">
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  Filho
                </label>

                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                  value={selectedStudentId}
                  onChange={(e) => changeStudent(e.target.value)}
                >
                  <option value="all">Todos os filhos</option>

                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.fullName}
                      {child.activeClass?.className
                        ? ` • ${child.activeClass.className}`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 md:flex-row">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => changeDate(e.target.value)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />

              <button
                type="button"
                onClick={() => moveDate(-1)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Dia anterior
              </button>

              <button
                type="button"
                onClick={() => changeDate(todayISO())}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Hoje
              </button>

              <button
                type="button"
                onClick={() => moveDate(1)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Próximo dia
              </button>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Próxima aula
            </div>

            {nextClass ? (
              <div className="mt-4 rounded-[28px] bg-slate-950 p-5 text-white">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                    {formatShortDateBR(nextClass.date)}
                  </span>

                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                    {getTimeLabel(nextClass)}
                  </span>
                </div>

                <h3 className="mt-4 text-2xl font-bold leading-tight">
                  {getSubjectTitle(nextClass)}
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {nextClass.studentName ? `${nextClass.studentName} • ` : ""}
                  {nextClass.className || "Turma não informada"}
                </p>

                {nextClass.teacherName ? (
                  <p className="mt-1 text-sm text-slate-300">
                    Professor: {nextClass.teacherName}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="text-3xl">📭</div>

                <h3 className="mt-3 text-lg font-bold text-slate-950">
                  Nenhuma aula futura
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Quando a escola cadastrar a rotina do aluno, a próxima aula aparecerá aqui.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Visualização da rotina
                </div>

                <h2 className="mt-2 text-2xl font-bold text-slate-950">
                  Aulas e compromissos do aluno
                </h2>

                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Veja as aulas do dia, a semana completa, o calendário mensal ou os próximos registros.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setView("today")}
                  className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${
                    view === "today"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Aulas de hoje
                </button>

                <button
                  type="button"
                  onClick={() => setView("week")}
                  className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${
                    view === "week"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Semana completa
                </button>

                <button
                  type="button"
                  onClick={() => setView("month")}
                  className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${
                    view === "month"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Calendário mensal
                </button>

                <button
                  type="button"
                  onClick={() => setView("all")}
                  className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${
                    view === "all"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Próximas aulas
                </button>
              </div>
            </div>
          </div>

          <div className="p-5 md:p-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-32 animate-pulse rounded-[28px] bg-slate-100"
                  />
                ))}
              </div>
            ) : view === "today" ? (
              <div>
                <div className="mb-5">
                  <div className="text-xl font-bold capitalize text-slate-950">
                    {formatLongDateBR(selectedDate)}
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    {todayEvents.length} aula(s) encontrada(s)
                  </div>
                </div>

                {todayEvents.length > 0 ? (
                  <div className="space-y-4">
                    {todayEvents.map((event) => (
                      <ClassCard key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <EmptyRoutine
                    title="Nenhuma rotina neste dia"
                    description="Não existe aula cadastrada na grade oficial para esta data. Confira se a escola já cadastrou os horários da turma do aluno."
                    action={
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => setView("week")}
                          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:opacity-90"
                        >
                          Ver semana completa
                        </button>

                        <button
                          type="button"
                          onClick={() => setView("month")}
                          className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                        >
                          Ver calendário mensal
                        </button>
                      </div>
                    }
                  />
                )}
              </div>
            ) : view === "week" ? (
              <div className="space-y-5">
                <div className="mb-2 text-sm font-semibold text-slate-500">
                  Semana de {formatShortDateBR(startOfWeekISO(selectedDate))} até{" "}
                  {formatShortDateBR(endOfWeekISO(selectedDate))}
                </div>

                {weekDates.map((date) => {
                  const dateEvents = weekEvents
                    .filter((event) => event.date === date)
                    .sort(eventSort);

                  return <DayBlock key={date} date={date} events={dateEvents} />;
                })}
              </div>
            ) : view === "month" ? (
              <MonthCalendar
                selectedDate={selectedDate}
                routineEvents={routineEvents}
                schoolEvents={schoolEvents}
                onSelectDate={(date) => {
                  setSelectedDate(date);
                }}
                onPreviousMonth={() => moveMonth(-1)}
                onNextMonth={() => moveMonth(1)}
              />
            ) : (
              <div>
                <div className="mb-5">
                  <div className="text-xl font-bold text-slate-950">
                    Próximas aulas
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    {nextClasses.length} próxima(s) aula(s) destacada(s)
                  </div>
                </div>

                {nextClasses.length > 0 ? (
                  <div className="space-y-4">
                    {nextClasses.map((event) => (
                      <ClassCard key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <EmptyRoutine
                    title="Nenhuma próxima aula encontrada"
                    description="A rotina escolar ainda não foi localizada para os próximos dias. Verifique se a turma do aluno está vinculada corretamente e se a grade oficial foi cadastrada pela escola."
                  />
                )}
              </div>
            )}
          </div>
        </section>

        {schoolEvents.length > 0 ? (
          <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Eventos gerais
            </div>

            <h2 className="mt-2 text-2xl font-bold text-slate-950">
              Também existem eventos na agenda
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              A rotina de aulas aparece nesta tela. Eventos gerais continuam disponíveis
              na agenda escolar e também aparecem no calendário mensal.
            </p>

            <button
              type="button"
              onClick={() => router.push("/parent/calendar")}
              className="mt-5 rounded-2xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              Abrir agenda escolar
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}