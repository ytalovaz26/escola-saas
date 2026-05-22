"use client";

import { useEffect, useMemo, useState } from "react";
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

type ParentCalendarEvent = {
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

type ParentCalendarPayload = {
  parent: {
    parentId: string;
    name: string;
    email: string | null;
  };
  schoolId: string;
  selectedStudentId: string;
  children: ParentChild[];
  events: ParentCalendarEvent[];
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

function monthStartISO(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
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

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function weekdayLabel(date: string) {
  const labels = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];

  const d = new Date(`${date}T12:00:00`);
  return labels[d.getDay()] || "";
}

function monthLabel(date: string) {
  const d = new Date(`${date}T12:00:00`);

  return d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function isFutureOrToday(date: string) {
  return String(date).slice(0, 10) >= todayISO();
}

function groupEventsByDate(events: ParentCalendarEvent[]) {
  return events.reduce<Record<string, ParentCalendarEvent[]>>((acc, event) => {
    if (!acc[event.date]) acc[event.date] = [];
    acc[event.date].push(event);
    return acc;
  }, {});
}

function eventSort(a: ParentCalendarEvent, b: ParentCalendarEvent) {
  const ad = `${a.date}T${a.startTime || "99:99"}:00`;
  const bd = `${b.date}T${b.startTime || "99:99"}:00`;

  return ad.localeCompare(bd);
}

function MetricCard({
  label,
  value,
  help,
  tone = "default",
}: {
  label: string;
  value: string;
  help: string;
  tone?: "default" | "blue" | "green" | "amber";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-950"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
        {label}
      </div>

      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>

      <div className="mt-2 text-sm leading-6 opacity-75">{help}</div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[30px] border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
        📅
      </div>

      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>

      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function EventPill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
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
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}
    >
      {children}
    </span>
  );
}

function EventCard({ event }: { event: ParentCalendarEvent }) {
  const isClass = event.source === "official_schedule";

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <EventPill tone={isClass ? "green" : "blue"}>
              {isClass ? "Aula" : "Evento escolar"}
            </EventPill>

            {event.studentName ? (
              <EventPill tone="amber">{event.studentName}</EventPill>
            ) : null}

            {event.room ? <EventPill>Sala: {event.room}</EventPill> : null}
          </div>

          <h3 className="mt-3 break-words text-lg font-bold text-slate-950">
            {event.title}
          </h3>

          {event.description ? (
            <p className="mt-2 break-words text-sm leading-6 text-slate-500">
              {event.description}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {event.className ? <EventPill>Turma: {event.className}</EventPill> : null}

            {event.teacherName ? (
              <EventPill>
                Professor: {event.teacherName}
                {event.teacherEmail ? ` • ${event.teacherEmail}` : ""}
              </EventPill>
            ) : null}

            {event.createdAt && event.source === "school_event" ? (
              <EventPill>Publicado em: {formatDateTimeBR(event.createdAt)}</EventPill>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 rounded-2xl bg-slate-950 px-4 py-3 text-center text-white">
          <div className="text-xs font-medium text-slate-300">
            {formatShortDateBR(event.date)}
          </div>

          <div className="mt-1 text-sm font-bold">
            {event.startTime && event.endTime
              ? `${event.startTime} - ${event.endTime}`
              : "Dia todo"}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ParentSchedulePage() {
  const router = useRouter();

  const [payload, setPayload] = useState<ParentCalendarPayload | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [view, setView] = useState<"day" | "week" | "month">("day");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const children = payload?.children || [];
  const events = payload?.events || [];

  const selectedStudentLabel = useMemo(() => {
    if (selectedStudentId === "all") return "Todos os filhos";

    const child = children.find((item) => item.id === selectedStudentId);

    return child?.fullName || "Filho selecionado";
  }, [children, selectedStudentId]);

  const dayEvents = useMemo(() => {
    return events.filter((event) => event.date === selectedDate).sort(eventSort);
  }, [events, selectedDate]);

  const weekDates = useMemo(() => {
    const start = startOfWeekISO(selectedDate);
    return Array.from({ length: 7 }).map((_, index) => addDaysISO(start, index));
  }, [selectedDate]);

  const weekEvents = useMemo(() => {
    return events.filter((event) => weekDates.includes(event.date)).sort(eventSort);
  }, [events, weekDates]);

  const monthDates = useMemo(() => {
    const start = monthStartISO(selectedDate);
    return Array.from({ length: 35 }).map((_, index) => addDaysISO(start, index));
  }, [selectedDate]);

  const monthEventsByDate = useMemo(() => {
    return groupEventsByDate(events);
  }, [events]);

  const futureEvents = useMemo(() => {
    return events.filter((event) => isFutureOrToday(event.date)).sort(eventSort);
  }, [events]);

  const nextEvent = futureEvents[0] || null;

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

      const startDate = monthStartISO(nextDate);

      const qs = new URLSearchParams({
        studentId: nextStudentId,
        startDate,
        days: "45",
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
          <div className="animate-pulse space-y-4">
            <div className="h-48 rounded-[32px] bg-slate-200" />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-32 rounded-[28px] bg-slate-100" />
              <div className="h-32 rounded-[28px] bg-slate-100" />
              <div className="h-32 rounded-[28px] bg-slate-100" />
            </div>

            <div className="h-28 rounded-[28px] bg-slate-100" />
            <div className="h-96 rounded-[28px] bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Rotina escolar do aluno
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Horários e rotina escolar
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Acompanhe as aulas oficiais cadastradas pela direção, professores,
                  salas, disciplinas e horários da rotina escolar do aluno.
                </p>

                <div className="mt-4 text-sm text-slate-200">
                  Visualização atual:{" "}
                  <span className="font-semibold">{selectedStudentLabel}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    loadSchedule({
                      studentId: selectedStudentId,
                      date: selectedDate,
                    })
                  }
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Recarregar
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent/children")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Meus filhos
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent")}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Voltar ao portal
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
            <MetricCard
              label="Total"
              value={String(payload?.summary?.total || 0)}
              help="Aulas e registros carregados."
              tone="blue"
            />

            <MetricCard
              label="Aulas"
              value={String(payload?.summary?.routine || 0)}
              help="Horários oficiais da grade."
              tone="green"
            />

            <MetricCard
              label="Eventos"
              value={String(payload?.summary?.schoolEvents || 0)}
              help="Eventos gerais incluídos."
              tone="amber"
            />

            <MetricCard
              label="Filhos"
              value={String(payload?.summary?.children || children.length)}
              help="Alunos vinculados à conta."
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Filtro da rotina
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Selecione um filho para ver a rotina individual ou mantenha todos para
                  visualizar a rotina familiar completa.
                </p>
              </div>

              <div className="w-full xl:w-[360px]">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Filho
                </label>

                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  value={selectedStudentId}
                  onChange={(e) => changeStudent(e.target.value)}
                >
                  <option value="all">Todos os filhos</option>

                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.fullName}
                      {child.registrationNumber ? ` • ${child.registrationNumber}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 md:flex-row">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => changeDate(e.target.value)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />

              <button
                type="button"
                onClick={() => moveDate(-1)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Dia anterior
              </button>

              <button
                type="button"
                onClick={() => changeDate(todayISO())}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Hoje
              </button>

              <button
                type="button"
                onClick={() => moveDate(1)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Próximo dia
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Próxima aula
            </div>

            {nextEvent ? (
              <div className="mt-3">
                <div className="text-lg font-semibold text-slate-900">
                  {nextEvent.title}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <EventPill tone={nextEvent.source === "official_schedule" ? "green" : "blue"}>
                    {nextEvent.source === "official_schedule" ? "Aula" : "Evento"}
                  </EventPill>

                  <EventPill>{formatShortDateBR(nextEvent.date)}</EventPill>

                  {nextEvent.startTime && nextEvent.endTime ? (
                    <EventPill>
                      {nextEvent.startTime} - {nextEvent.endTime}
                    </EventPill>
                  ) : null}
                </div>

                <div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {nextEvent.description || "Sem descrição adicional."}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-slate-500">
                Nenhuma aula futura identificada no momento.
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Visualização dos horários
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Escolha entre dia, semana ou mês para acompanhar a rotina escolar.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setView("day")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    view === "day"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Dia
                </button>

                <button
                  type="button"
                  onClick={() => setView("week")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    view === "week"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Semana
                </button>

                <button
                  type="button"
                  onClick={() => setView("month")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    view === "month"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Mês
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 md:p-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-32 animate-pulse rounded-[28px] bg-slate-100"
                  />
                ))}
              </div>
            ) : view === "day" ? (
              <div>
                <div className="mb-4">
                  <div className="text-lg font-bold capitalize text-slate-900">
                    {formatLongDateBR(selectedDate)}
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    {dayEvents.length} aula(s) ou registro(s)
                  </div>
                </div>

                {dayEvents.length ? (
                  <div className="space-y-4">
                    {dayEvents.map((event) => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Nenhuma rotina neste dia"
                    description="Não existe aula cadastrada na grade oficial para esta data."
                  />
                )}
              </div>
            ) : view === "week" ? (
              <div className="space-y-5">
                {weekDates.map((date) => {
                  const dateEvents = weekEvents
                    .filter((event) => event.date === date)
                    .sort(eventSort);

                  return (
                    <div key={date} className="rounded-[28px] bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            {weekdayLabel(date)}
                          </div>

                          <div className="text-xs text-slate-500">
                            {formatShortDateBR(date)}
                          </div>
                        </div>

                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                          {dateEvents.length} item(ns)
                        </span>
                      </div>

                      {dateEvents.length ? (
                        <div className="space-y-3">
                          {dateEvents.map((event) => (
                            <EventCard key={event.id} event={event} />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
                          Sem rotina cadastrada.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                <div className="mb-4 text-lg font-bold capitalize text-slate-900">
                  {monthLabel(selectedDate)}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                  {monthDates.map((date) => {
                    const dateEvents = monthEventsByDate[date] || [];
                    const isSelected = date === selectedDate;

                    return (
                      <button
                        type="button"
                        key={date}
                        onClick={() => {
                          setSelectedDate(date);
                          setView("day");
                        }}
                        className={`min-h-[116px] rounded-3xl border p-3 text-left transition ${
                          isSelected
                            ? "border-slate-950 bg-slate-950 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-white"
                        }`}
                      >
                        <div className="text-xs font-semibold">
                          {weekdayLabel(date).slice(0, 3)}
                        </div>

                        <div className="mt-1 text-lg font-bold">
                          {date.split("-")[2]}
                        </div>

                        <div
                          className={`mt-3 rounded-full px-2 py-1 text-xs font-semibold ${
                            isSelected
                              ? "bg-white/10 text-white"
                              : "bg-white text-slate-500"
                          }`}
                        >
                          {dateEvents.length} item(ns)
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}