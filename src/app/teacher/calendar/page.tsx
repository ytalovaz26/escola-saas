"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

type CalendarPayload = {
  teacher: {
    userId: string;
    email: string | null;
    name: string;
  };
  schoolId: string;
  classes: CalendarClass[];
  events: CalendarEvent[];
  meta: {
    startDate: string;
    days: number;
    source: string;
    hasOfficialSchedule: boolean;
  };
};

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor." };
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

function formatDateBR(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
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

function statusLabel(status: CalendarEvent["status"]) {
  if (status === "done") return "Concluído";
  if (status === "pending") return "Pendente";
  return "Previsto";
}

function typeLabel(type: CalendarEvent["type"]) {
  if (type === "planning") return "Planejamento";
  if (type === "notice") return "Comunicado";
  return "Aula";
}

function typeStyle(type: CalendarEvent["type"]) {
  if (type === "planning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (type === "notice") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function groupEventsByDate(events: CalendarEvent[]) {
  return events.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
    if (!acc[event.date]) acc[event.date] = [];
    acc[event.date].push(event);
    return acc;
  }, {});
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

function EventCard({ event }: { event: CalendarEvent }) {
  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${typeStyle(
                event.type
              )}`}
            >
              {typeLabel(event.type)}
            </span>

            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {statusLabel(event.status)}
            </span>

            {event.room ? (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Sala: {event.room}
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 break-words text-lg font-bold text-slate-950">
            {event.title}
          </h3>

          <p className="mt-2 break-words text-sm leading-6 text-slate-500">
            {event.description}
          </p>

          {event.className ? (
            <div className="mt-3 inline-flex rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              Turma: {event.className}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 rounded-2xl bg-slate-950 px-4 py-3 text-center text-white">
          <div className="text-xs font-medium text-slate-300">
            {formatDateBR(event.date)}
          </div>

          <div className="mt-1 text-sm font-bold">
            {event.startTime} - {event.endTime}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TeacherCalendarPage() {
  const router = useRouter();

  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [view, setView] = useState<"day" | "week" | "month">("day");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const events = payload?.events || [];

  const dayEvents = useMemo(() => {
    return events.filter((event) => event.date === selectedDate);
  }, [events, selectedDate]);

  const weekDates = useMemo(() => {
    const start = startOfWeekISO(selectedDate);
    return Array.from({ length: 7 }).map((_, index) => addDaysISO(start, index));
  }, [selectedDate]);

  const weekEvents = useMemo(() => {
    return events.filter((event) => weekDates.includes(event.date));
  }, [events, weekDates]);

  const monthDates = useMemo(() => {
    const start = monthStartISO(selectedDate);
    return Array.from({ length: 35 }).map((_, index) => addDaysISO(start, index));
  }, [selectedDate]);

  const monthEventsByDate = useMemo(() => {
    return groupEventsByDate(events);
  }, [events]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadCalendar(date = selectedDate) {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();

      if (!token) return;

      const startDate = monthStartISO(date);

      const res = await fetch(
        `/api/teacher/calendar?startDate=${encodeURIComponent(startDate)}&days=45`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar horários.");
        return;
      }

      setPayload({
        teacher: json.teacher,
        schoolId: json.schoolId,
        classes: json.classes || [],
        events: json.events || [],
        meta: json.meta,
      });
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar horários.");
    } finally {
      setLoading(false);
    }
  }

  function moveDate(days: number) {
    const next = addDaysISO(selectedDate, days);
    setSelectedDate(next);
    loadCalendar(next);
  }

  useEffect(() => {
    loadCalendar(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[40px] border border-slate-200 bg-slate-950 p-6 text-white shadow-xl md:p-8">
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
        />

        <div className="absolute -bottom-28 left-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
              Grade oficial
            </div>

            <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight md:text-5xl">
              Meus horários
            </h1>

            <p className="mt-3 max-w-3xl break-words text-sm leading-7 text-slate-300 md:text-base">
              Acompanhe a grade oficial cadastrada pela direção da escola. As aulas
              aparecem aqui conforme turma, disciplina, dia da semana e horário.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/teacher")}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
            >
              Voltar ao painel
            </button>

            <button
              type="button"
              onClick={() => loadCalendar(selectedDate)}
              className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Recarregar
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="space-y-5">
          <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Professor
            </div>

            <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-900">
              {payload?.teacher?.name || "Professor"}
            </h2>

            <p className="mt-2 break-all text-sm text-slate-500">
              {payload?.teacher?.email || "—"}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Turmas
                </div>

                <div className="mt-2 text-2xl font-bold text-slate-950">
                  {payload?.classes?.length || 0}
                </div>
              </div>

              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Aulas
                </div>

                <div className="mt-2 text-2xl font-bold text-slate-950">
                  {events.length}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Turmas vinculadas
            </div>

            <div className="mt-5 space-y-3">
              {payload?.classes?.length ? (
                payload.classes.map((cls) => (
                  <div
                    key={cls.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="break-words text-sm font-bold text-slate-900">
                      {cls.name}
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      Grade oficial vinculada ao professor
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  Nenhuma turma vinculada ao professor até o momento.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[36px] border border-blue-200 bg-blue-50 p-6 shadow-sm">
            <div className="text-sm font-bold text-blue-900">
              Integração ativa
            </div>

            <p className="mt-2 text-sm leading-6 text-blue-800">
              Esta tela agora usa a grade oficial cadastrada pela direção. Se a direção
              alterar ou remover um horário, a agenda do professor será atualizada.
            </p>
          </div>
        </div>

        <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Visualização
              </div>

              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                {view === "day"
                  ? `${weekdayLabel(selectedDate)}, ${formatDateBR(selectedDate)}`
                  : view === "week"
                    ? "Semana selecionada"
                    : monthLabel(selectedDate)}
              </h2>
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

          <div className="mt-5 flex flex-col gap-3 md:flex-row">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                loadCalendar(e.target.value);
              }}
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
              onClick={() => {
                const today = todayISO();
                setSelectedDate(today);
                loadCalendar(today);
              }}
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

          <div className="mt-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-32 animate-pulse rounded-[26px] bg-slate-100"
                  />
                ))}
              </div>
            ) : view === "day" ? (
              dayEvents.length ? (
                <div className="space-y-4">
                  {dayEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Nenhuma aula neste dia"
                  description="Não existe aula cadastrada na grade oficial para esta data."
                />
              )
            ) : view === "week" ? (
              <div className="space-y-5">
                {weekDates.map((date) => {
                  const dateEvents = weekEvents.filter((event) => event.date === date);

                  return (
                    <div key={date} className="rounded-[28px] bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            {weekdayLabel(date)}
                          </div>

                          <div className="text-xs text-slate-500">
                            {formatDateBR(date)}
                          </div>
                        </div>

                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                          {dateEvents.length} aula(s)
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
                          Sem aulas.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
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
                        {dateEvents.length} aula(s)
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}