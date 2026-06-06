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

type ParentCalendarItem = {
  id: string;
  source: "calendar_event" | "calendar_block";
  type: string;
  typeLabel: string;
  title: string;
  description: string | null;
  date: string;
  createdAt: string | null;
  targetScope?: string | null;
  classId?: string | null;
  shift?: string | null;
  affectsAllClasses?: boolean | null;
};

type ParentCalendarPayload = {
  parent: {
    parentId: string;
    name: string;
    email: string | null;
  };
  schoolId: string;
  children: ParentChild[];
  events: ParentCalendarItem[];
  calendarBlocks: ParentCalendarItem[];
  items: ParentCalendarItem[];
  summary: {
    total: number;
    events: number;
    calendarBlocks: number;
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

function itemSortAsc(a: ParentCalendarItem, b: ParentCalendarItem) {
  const byDate = String(a.date).localeCompare(String(b.date));
  if (byDate !== 0) return byDate;

  const priorityA = a.source === "calendar_block" ? 0 : 1;
  const priorityB = b.source === "calendar_block" ? 0 : 1;

  return priorityA - priorityB;
}

function itemSortDesc(a: ParentCalendarItem, b: ParentCalendarItem) {
  const byDate = String(b.date).localeCompare(String(a.date));
  if (byDate !== 0) return byDate;

  const priorityA = a.source === "calendar_block" ? 0 : 1;
  const priorityB = b.source === "calendar_block" ? 0 : 1;

  return priorityA - priorityB;
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

function groupByMonth(items: ParentCalendarItem[]) {
  return items.reduce<Record<string, ParentCalendarItem[]>>((acc, item) => {
    const key = item.date.slice(0, 7);

    if (!acc[key]) acc[key] = [];
    acc[key].push(item);

    return acc;
  }, {});
}

function isCalendarBlock(item: ParentCalendarItem) {
  return item.source === "calendar_block";
}

function itemTone(item: ParentCalendarItem) {
  if (!isCalendarBlock(item)) return "event";

  const type = String(item.type || "").toLowerCase();

  if (type === "holiday") return "holiday";
  if (type === "recess") return "recess";
  if (type === "no_class") return "no_class";

  return "block";
}

function badgeClass(item: ParentCalendarItem) {
  const tone = itemTone(item);

  if (tone === "event") return "border-blue-200 bg-blue-50 text-blue-700";
  if (tone === "holiday") return "border-purple-200 bg-purple-50 text-purple-700";
  if (tone === "recess") return "border-orange-200 bg-orange-50 text-orange-700";
  if (tone === "no_class") return "border-red-200 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-100 text-slate-700";
}

function dateBoxClass(item: ParentCalendarItem) {
  const tone = itemTone(item);

  if (tone === "event") return "bg-slate-950 text-white";
  if (tone === "holiday") return "bg-purple-700 text-white";
  if (tone === "recess") return "bg-orange-600 text-white";
  if (tone === "no_class") return "bg-red-600 text-white";

  return "bg-slate-700 text-white";
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
  tone?: "default" | "blue" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-950"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : tone === "red"
            ? "border-red-200 bg-red-50 text-red-950"
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

function CalendarItemCard({
  item,
  compact = false,
}: {
  item: ParentCalendarItem;
  compact?: boolean;
}) {
  const block = isCalendarBlock(item);

  return (
    <article className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div
          className={[
            "flex shrink-0 flex-col items-center justify-center rounded-[24px] px-5 py-4 md:w-28",
            dateBoxClass(item),
          ].join(" ")}
        >
          <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Data
          </div>

          <div className="mt-1 text-lg font-bold">{formatShortDateBR(item.date)}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                "inline-flex rounded-full border px-3 py-1 text-xs font-bold",
                badgeClass(item),
              ].join(" ")}
            >
              {item.typeLabel || (block ? "Calendário escolar" : "Evento escolar")}
            </span>

            <EventStatusBadge date={item.date} />

            {block ? (
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                Dia sem aula / calendário
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 break-words text-lg font-bold text-slate-950">
            {item.title}
          </h3>

          {item.description ? (
            <p
              className={[
                "mt-2 break-words text-sm leading-6 text-slate-600",
                compact ? "line-clamp-3" : "",
              ].join(" ")}
            >
              {item.description}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Sem descrição adicional.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold">
              {formatLongDateBR(item.date)}
            </span>

            {item.createdAt ? (
              <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold">
                Publicado em {formatDateTimeBR(item.createdAt)}
              </span>
            ) : null}

            {block && item.shift ? (
              <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold">
                Turno: {item.shift}
              </span>
            ) : null}

            {block && item.affectsAllClasses ? (
              <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold">
                Todas as turmas
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
  const [filter, setFilter] = useState<"upcoming" | "all" | "past" | "blocks">("upcoming");

  const items = payload?.items || [];
  const children = payload?.children || [];
  const calendarBlocks = payload?.calendarBlocks || [];
  const schoolEvents = payload?.events || [];

  const upcomingItems = useMemo(() => {
    return items.filter((item) => isFutureOrToday(item.date)).sort(itemSortAsc);
  }, [items]);

  const pastItems = useMemo(() => {
    return items.filter((item) => isPast(item.date)).sort(itemSortDesc);
  }, [items]);

  const visibleItems = useMemo(() => {
    if (filter === "past") return pastItems;
    if (filter === "all") return [...items].sort(itemSortAsc);
    if (filter === "blocks") return [...calendarBlocks].sort(itemSortAsc);
    return upcomingItems;
  }, [items, filter, pastItems, upcomingItems, calendarBlocks]);

  const groupedVisibleItems = useMemo(() => {
    return groupByMonth(visibleItems);
  }, [visibleItems]);

  const groupKeys = useMemo(() => {
    return Object.keys(groupedVisibleItems).sort();
  }, [groupedVisibleItems]);

  const nextItem = upcomingItems[0] || null;

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
        calendarBlocks: Array.isArray(json.calendarBlocks) ? json.calendarBlocks : [],
        items: Array.isArray(json.items) ? json.items : [],
        summary: json.summary || {
          total: 0,
          events: 0,
          calendarBlocks: 0,
          children: 0,
        },
        meta: json.meta || {
          source: "parent_calendar_events_and_blocks_v1",
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
                  Agenda completa da escola
                </div>

                <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                  Agenda e calendário escolar
                </h1>

                <p className="mt-4 text-base leading-8 text-slate-200">
                  Acompanhe eventos, reuniões, atividades, feriados, recessos e dias sem aula
                  publicados pela escola em um só lugar.
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

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-5 md:p-6">
            <StatCard
              label="Total"
              value={String(items.length)}
              description="Itens publicados na agenda."
              tone="blue"
            />

            <StatCard
              label="Eventos"
              value={String(schoolEvents.length)}
              description="Eventos gerais da escola."
              tone="green"
            />

            <StatCard
              label="Dias sem aula"
              value={String(calendarBlocks.length)}
              description="Feriados, recessos e bloqueios."
              tone="red"
            />

            <StatCard
              label="Próximos"
              value={String(upcomingItems.length)}
              description="Compromissos de hoje em diante."
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
              Próximo compromisso
            </div>

            {nextItem ? (
              <div className="mt-4">
                <div className="rounded-[28px] bg-slate-950 p-6 text-white">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                      {formatShortDateBR(nextItem.date)}
                    </span>

                    <EventStatusBadge date={nextItem.date} />

                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                      {nextItem.typeLabel}
                    </span>
                  </div>

                  <h2 className="mt-5 text-2xl font-bold leading-tight">
                    {nextItem.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {nextItem.description || "Sem descrição adicional."}
                  </p>
                </div>

                <div className="mt-4 rounded-[24px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  <strong className="text-slate-900">Data completa:</strong>{" "}
                  <span className="capitalize">{formatLongDateBR(nextItem.date)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="text-3xl">📭</div>

                <h3 className="mt-3 text-lg font-bold text-slate-950">
                  Nenhum compromisso futuro
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Quando a escola publicar novos eventos ou dias sem aula, eles aparecerão aqui.
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
                  Itens publicados
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
                  onClick={() => setFilter("blocks")}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-bold transition",
                    filter === "blocks"
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Dias sem aula
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
              Esta página une <strong>eventos escolares</strong> e{" "}
              <strong>alterações do calendário</strong>. Para visualizar a rotina de aulas do
              aluno, acesse o menu <strong>Horários</strong>.
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Evento escolar
              </span>

              <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                Recesso
              </span>

              <span className="inline-flex rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">
                Feriado
              </span>

              <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                Dia sem aula
              </span>
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
                  ? "Próximos compromissos"
                  : filter === "past"
                    ? "Compromissos encerrados"
                    : filter === "blocks"
                      ? "Dias sem aula e alterações"
                      : "Todos os compromissos"}
              </h2>
            </div>

            <div className="text-sm text-slate-500">
              {visibleItems.length} item(ns) encontrado(s)
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <EmptyState
              title={
                filter === "upcoming"
                  ? "Nenhum próximo compromisso"
                  : filter === "past"
                    ? "Nenhum compromisso encerrado"
                    : filter === "blocks"
                      ? "Nenhum dia sem aula publicado"
                      : "Nenhum item publicado"
              }
              description="A escola ainda não possui itens nesta visualização."
            />
          ) : (
            <div className="space-y-8">
              {groupKeys.map((key) => {
                const itemsInMonth = groupedVisibleItems[key] || [];
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
                      {itemsInMonth.map((item) => (
                        <CalendarItemCard key={item.id} item={item} />
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