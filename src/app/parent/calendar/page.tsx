"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ParentChild = {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  relationship: string | null;
};

type ParentCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  date: string;
  createdAt: string | null;
};

type ParentCalendarPayload = {
  parent: {
    parentId: string;
    name: string;
    email: string | null;
  };
  schoolId: string;
  children: ParentChild[];
  events: ParentCalendarEvent[];
  summary: {
    total: number;
    children: number;
  };
  meta: {
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

function eventSortAsc(a: ParentCalendarEvent, b: ParentCalendarEvent) {
  return String(a.date).localeCompare(String(b.date));
}

function eventSortDesc(a: ParentCalendarEvent, b: ParentCalendarEvent) {
  return String(b.date).localeCompare(String(a.date));
}

function isFutureOrToday(date: string) {
  return String(date).slice(0, 10) >= todayISO();
}

function isPast(date: string) {
  return String(date).slice(0, 10) < todayISO();
}

function getDaysUntil(date: string) {
  const today = new Date(`${todayISO()}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  const diff = target.getTime() - today.getTime();

  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function groupByMonth(events: ParentCalendarEvent[]) {
  return events.reduce<Record<string, ParentCalendarEvent[]>>((acc, event) => {
    const key = event.date.slice(0, 7);

    if (!acc[key]) acc[key] = [];
    acc[key].push(event);

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
    <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-3xl">
        🗓️
      </div>

      <h3 className="mt-5 text-xl font-bold text-slate-950">{title}</h3>

      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
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
      <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
        {label}
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight">{value}</div>

      <p className="mt-2 text-sm leading-6 opacity-75">{description}</p>
    </div>
  );
}

function EventStatusBadge({ date }: { date: string }) {
  const days = getDaysUntil(date);

  if (days === 0) {
    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        Hoje
      </span>
    );
  }

  if (days === 1) {
    return (
      <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
        Amanhã
      </span>
    );
  }

  if (days > 1) {
    return (
      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
        Em {days} dias
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500">
      Encerrado
    </span>
  );
}

function EventCard({
  event,
  compact = false,
}: {
  event: ParentCalendarEvent;
  compact?: boolean;
}) {
  return (
    <article className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="flex shrink-0 flex-col items-center justify-center rounded-[24px] bg-slate-950 px-5 py-4 text-white md:w-28">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Data
          </div>

          <div className="mt-1 text-lg font-bold">{formatShortDateBR(event.date)}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              Evento escolar
            </span>

            <EventStatusBadge date={event.date} />
          </div>

          <h3 className="mt-3 break-words text-lg font-bold text-slate-950">
            {event.title}
          </h3>

          {event.description ? (
            <p
              className={[
                "mt-2 break-words text-sm leading-6 text-slate-600",
                compact ? "line-clamp-3" : "",
              ].join(" ")}
            >
              {event.description}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Sem descrição adicional.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold">
              {formatLongDateBR(event.date)}
            </span>

            {event.createdAt ? (
              <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold">
                Publicado em {formatDateTimeBR(event.createdAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ParentCalendarPage() {
  const router = useRouter();

  const [payload, setPayload] = useState<ParentCalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"upcoming" | "all" | "past">("upcoming");

  const events = payload?.events || [];
  const children = payload?.children || [];

  const upcomingEvents = useMemo(() => {
    return events.filter((event) => isFutureOrToday(event.date)).sort(eventSortAsc);
  }, [events]);

  const pastEvents = useMemo(() => {
    return events.filter((event) => isPast(event.date)).sort(eventSortDesc);
  }, [events]);

  const visibleEvents = useMemo(() => {
    if (filter === "past") return pastEvents;
    if (filter === "all") return [...events].sort(eventSortAsc);
    return upcomingEvents;
  }, [events, filter, pastEvents, upcomingEvents]);

  const groupedVisibleEvents = useMemo(() => {
    return groupByMonth(visibleEvents);
  }, [visibleEvents]);

  const groupKeys = useMemo(() => {
    return Object.keys(groupedVisibleEvents).sort();
  }, [groupedVisibleEvents]);

  const nextEvent = upcomingEvents[0] || null;

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadCalendar() {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();

      if (!token) return;

      const res = await fetch("/api/parent/calendar", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJsonFromResponse(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar agenda escolar.");
        return;
      }

      setPayload({
        parent: json.parent,
        schoolId: json.schoolId,
        children: Array.isArray(json.children) ? json.children : [],
        events: Array.isArray(json.events) ? json.events : [],
        summary: json.summary || {
          total: 0,
          children: 0,
        },
        meta: json.meta || {
          source: "parent_calendar_school_events",
        },
      });
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar agenda escolar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !payload) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
          <div className="h-64 animate-pulse rounded-[36px] bg-slate-200" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                  Agenda geral da escola
                </div>

                <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                  Agenda e eventos escolares
                </h1>

                <p className="mt-4 text-base leading-8 text-slate-200">
                  Acompanhe datas importantes, reuniões, atividades, comunicados de
                  calendário e compromissos gerais publicados pela escola.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={loadCalendar}
                  className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
                >
                  Atualizar agenda
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent/schedule")}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
                >
                  Ver horários do filho
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
            <StatCard
              label="Eventos"
              value={String(events.length)}
              description="Eventos gerais publicados."
              tone="blue"
            />

            <StatCard
              label="Próximos"
              value={String(upcomingEvents.length)}
              description="Eventos de hoje em diante."
              tone="green"
            />

            <StatCard
              label="Histórico"
              value={String(pastEvents.length)}
              description="Eventos já encerrados."
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

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Próximo evento
            </div>

            {nextEvent ? (
              <div className="mt-4">
                <div className="rounded-[28px] bg-slate-950 p-6 text-white">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                      {formatShortDateBR(nextEvent.date)}
                    </span>

                    <EventStatusBadge date={nextEvent.date} />
                  </div>

                  <h2 className="mt-5 text-2xl font-bold leading-tight">
                    {nextEvent.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {nextEvent.description || "Sem descrição adicional."}
                  </p>
                </div>

                <div className="mt-4 rounded-[24px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  <strong className="text-slate-900">Data completa:</strong>{" "}
                  <span className="capitalize">{formatLongDateBR(nextEvent.date)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="text-3xl">📭</div>

                <h3 className="mt-3 text-lg font-bold text-slate-950">
                  Nenhum evento futuro
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Quando a escola publicar novos eventos, eles aparecerão aqui.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Filtro da agenda
                </div>

                <h2 className="mt-2 text-2xl font-bold text-slate-950">
                  Eventos publicados
                </h2>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFilter("upcoming")}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-bold transition",
                    filter === "upcoming"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Próximos
                </button>

                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-bold transition",
                    filter === "all"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Todos
                </button>

                <button
                  type="button"
                  onClick={() => setFilter("past")}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-bold transition",
                    filter === "past"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Encerrados
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Esta página mostra somente eventos gerais da escola. Para visualizar a
              rotina de aulas do aluno, acesse o menu <strong>Horários</strong>.
            </div>
          </div>
        </section>

        <section className="rounded-[36px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                Lista da agenda
              </div>

              <h2 className="mt-2 text-2xl font-bold text-slate-950">
                {filter === "upcoming"
                  ? "Próximos eventos"
                  : filter === "past"
                    ? "Eventos encerrados"
                    : "Todos os eventos"}
              </h2>
            </div>

            <div className="text-sm text-slate-500">
              {visibleEvents.length} evento(s) encontrado(s)
            </div>
          </div>

          {visibleEvents.length === 0 ? (
            <EmptyState
              title={
                filter === "upcoming"
                  ? "Nenhum próximo evento"
                  : filter === "past"
                    ? "Nenhum evento encerrado"
                    : "Nenhum evento publicado"
              }
              description="A escola ainda não possui eventos nesta visualização."
            />
          ) : (
            <div className="space-y-8">
              {groupKeys.map((key) => {
                const eventsInMonth = groupedVisibleEvents[key] || [];
                const monthReference = `${key}-01`;

                return (
                  <div key={key}>
                    <div className="mb-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-200" />

                      <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                        {formatMonthBR(monthReference)}
                      </div>

                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <div className="space-y-4">
                      {eventsInMonth.map((event) => (
                        <EventCard key={event.id} event={event} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}