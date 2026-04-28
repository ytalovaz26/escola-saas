"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StudentRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
};

type CalendarEventRow = {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function formatDayBR(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatShortDateBR(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimeBR(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTimeBR(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isFutureEvent(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() >= Date.now();
}

function MetricCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

function EventTag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "highlight";
}) {
  return (
    <span
      className={[
        "inline-flex rounded-full px-3 py-1 text-xs font-medium",
        variant === "highlight"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-600",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function ParentCalendarPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("all");

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();

    for (const ev of events) {
      const date = new Date(ev.starts_at);
      if (Number.isNaN(date.getTime())) continue;

      const day = date.toISOString().slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(ev);
      map.set(day, arr);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
      map.set(k, arr);
    }

    return map;
  }, [events]);

  const sortedDays = useMemo(() => {
    const days = Array.from(eventsByDay.keys());
    days.sort((a, b) => (a < b ? -1 : 1));
    return days;
  }, [eventsByDay]);

  const studentLabel = useMemo(() => {
    if (selectedStudentId === "all") return "Todos os filhos";
    const s = students.find((x) => x.id === selectedStudentId);
    return s ? s.full_name : "Filho selecionado";
  }, [selectedStudentId, students]);

  const totalEvents = useMemo(() => events.length, [events]);

  const futureEvents = useMemo(
    () => events.filter((ev) => isFutureEvent(ev.starts_at)),
    [events]
  );

  const nextEvent = useMemo(() => {
    return futureEvents[0] || null;
  }, [futureEvents]);

  const latestPublished = useMemo(() => {
    if (events.length === 0) return null;

    const ordered = [...events].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return ordered[0] || null;
  }, [events]);

  async function loadPage() {
    try {
      setError(null);
      setLoading(true);

      const params = new URLSearchParams(window.location.search);
      const urlStudentId = params.get("studentId") || "all";
      setSelectedStudentId(urlStudentId);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meText = await meRes.text();
      const me: any = safeJson(meText);

      if (!meRes.ok || !me?.ok || !me?.parent?.parentId) {
        router.replace(me?.redirectTo || "/login");
        return;
      }

      const { data: stData, error: stErr } = await supabase
        .from("students")
        .select("id, full_name, registration_number")
        .order("full_name", { ascending: true });

      if (stErr) {
        setError("Erro ao carregar filhos: " + stErr.message);
        return;
      }

      setStudents((stData ?? []) as StudentRow[]);

      const { data: evData, error: evErr } = await supabase
        .from("calendar_events")
        .select("id, school_id, title, description, starts_at, ends_at, created_at")
        .order("starts_at", { ascending: true });

      if (evErr) {
        setError("Erro ao carregar agenda: " + evErr.message);
        return;
      }

      setEvents((evData ?? []) as CalendarEventRow[]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (loading) {
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
                  Rotina escolar
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Agenda escolar
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Acompanhe compromissos, eventos e datas importantes da escola em uma
                  visualização mais clara, organizada e profissional.
                </p>

                <div className="mt-4 text-sm text-slate-200">
                  Visualização atual:{" "}
                  <span className="font-semibold">{studentLabel}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadPage}
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

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <MetricCard
              label="Eventos"
              value={String(totalEvents)}
              help="Quantidade total de eventos carregados na agenda."
            />

            <MetricCard
              label="Dias com agenda"
              value={String(sortedDays.length)}
              help="Dias que possuem pelo menos um evento cadastrado."
            />

            <MetricCard
              label="Próximo evento"
              value={nextEvent ? formatTimeBR(nextEvent.starts_at) : "—"}
              help={
                nextEvent
                  ? `${nextEvent.title} • ${formatShortDateBR(
                      new Date(nextEvent.starts_at).toISOString().slice(0, 10)
                    )}`
                  : "Nenhum próximo evento futuro identificado."
              }
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Filtro da agenda
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  O filtro é visual e ajuda a navegação do responsável dentro do portal.
                </p>
              </div>

              <div className="w-full xl:w-[320px]">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Filho
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  value={selectedStudentId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedStudentId(v);

                    const qs = v === "all" ? "" : `?studentId=${encodeURIComponent(v)}`;
                    router.replace(`/parent/calendar${qs}`);
                  }}
                >
                  <option value="all">Todos</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Destaque da agenda
            </div>

            {nextEvent ? (
              <div className="mt-3">
                <div className="text-lg font-semibold text-slate-900">
                  {nextEvent.title}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <EventTag variant="highlight">
                    {formatShortDateBR(
                      new Date(nextEvent.starts_at).toISOString().slice(0, 10)
                    )}
                  </EventTag>
                  <EventTag>Início: {formatTimeBR(nextEvent.starts_at)}</EventTag>
                  <EventTag>
                    Término: {nextEvent.ends_at ? formatTimeBR(nextEvent.ends_at) : "—"}
                  </EventTag>
                </div>

                <div className="mt-4 text-sm leading-6 text-slate-600">
                  {nextEvent.description || "Sem descrição adicional para este evento."}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-slate-500">
                Nenhum evento futuro foi identificado no momento.
              </div>
            )}

            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Última publicação
              </div>
              <div className="mt-2 text-sm text-slate-700">
                {latestPublished ? formatDateTimeBR(latestPublished.created_at) : "—"}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Eventos da escola
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Visualização organizada por dia para facilitar o acompanhamento da rotina escolar.
            </p>
          </div>

          <div className="p-4 md:p-6">
            {sortedDays.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Nenhum evento cadastrado ainda.
              </div>
            ) : (
              <div className="space-y-5">
                {sortedDays.map((day) => {
                  const dayEvents = eventsByDay.get(day) ?? [];

                  return (
                    <div
                      key={day}
                      className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 md:p-5"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-lg font-semibold capitalize text-slate-900">
                            {formatDayBR(day)}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {formatShortDateBR(day)}
                          </div>
                        </div>

                        <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                          {dayEvents.length} evento(s)
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3">
                        {dayEvents.map((ev) => (
                          <article
                            key={ev.id}
                            className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <h3 className="text-base font-semibold text-slate-900">
                                  {ev.title}
                                </h3>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <EventTag variant="highlight">
                                    Início: {formatTimeBR(ev.starts_at)}
                                  </EventTag>

                                  <EventTag>
                                    Término: {ev.ends_at ? formatTimeBR(ev.ends_at) : "—"}
                                  </EventTag>

                                  <EventTag>
                                    Publicado em: {formatDateTimeBR(ev.created_at)}
                                  </EventTag>
                                </div>
                              </div>

                              <div className="text-[11px] font-mono text-slate-400">
                                {ev.id.slice(0, 8)}…
                              </div>
                            </div>

                            {ev.description ? (
                              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 whitespace-pre-wrap">
                                {ev.description}
                              </div>
                            ) : (
                              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                Sem descrição adicional para este evento.
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}