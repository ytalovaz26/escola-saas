// src/app/school/calendar/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type CalendarEventRow = {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  event_date: string;
  created_at: string;
};

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
};

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function normalizeRole(role: string | null | undefined) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function canManageCalendar(role: string | null | undefined) {
  const r = normalizeRole(role);

  return (
    r === "diretor" ||
    r === "director" ||
    r === "coordenador" ||
    r === "coordinator" ||
    r === "secretaria" ||
    r === "secretary" ||
    r === "admin"
  );
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateBR(value?: string | null) {
  if (!value) return "—";

  const clean = String(value).slice(0, 10);
  const [y, m, d] = clean.split("-");

  if (!y || !m || !d) return value;

  return `${d}/${m}/${y}`;
}

function formatLongDateBR(value?: string | null) {
  if (!value) return "—";

  const clean = String(value).slice(0, 10);
  const [y, m, d] = clean.split("-").map(Number);

  if (!y || !m || !d) return formatDateBR(value);

  const date = new Date(y, m - 1, d);

  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return formatDateBR(value);
  }
}

function isFutureOrToday(value?: string | null) {
  if (!value) return false;

  const today = todayDateInput();
  const clean = String(value).slice(0, 10);

  return clean >= today;
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

      <div className="mt-2 text-sm leading-6 text-slate-500 break-words">
        {help}
      </div>
    </div>
  );
}

function EventBadge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "future" | "past";
}) {
  return (
    <span
      className={[
        "inline-flex max-w-full rounded-full px-3 py-1 text-xs font-semibold",
        variant === "future"
          ? "bg-emerald-50 text-emerald-700"
          : variant === "past"
            ? "bg-slate-100 text-slate-500"
            : "bg-blue-50 text-blue-700",
      ].join(" ")}
    >
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export default function SchoolCalendarPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(todayDateInput());

  const [editingId, setEditingId] = useState<string | null>(null);

  const futureEvents = useMemo(() => {
    return events.filter((event) => isFutureOrToday(event.event_date));
  }, [events]);

  const pastEvents = useMemo(() => {
    return events.filter((event) => !isFutureOrToday(event.event_date));
  }, [events]);

  const nextEvent = useMemo(() => {
    return futureEvents[0] || null;
  }, [futureEvents]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();

    for (const event of events) {
      const day = String(event.event_date || "").slice(0, 10) || "sem-data";
      const list = map.get(day) ?? [];
      list.push(event);
      map.set(day, list);
    }

    for (const [day, list] of map.entries()) {
      list.sort((a, b) => {
        const da = String(a.created_at || "");
        const db = String(b.created_at || "");
        return db.localeCompare(da);
      });

      map.set(day, list);
    }

    return map;
  }, [events]);

  const sortedDays = useMemo(() => {
    return Array.from(eventsByDay.keys()).sort((a, b) => a.localeCompare(b));
  }, [eventsByDay]);

  async function getAccessToken() {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  }

  async function loadEvents(token: string) {
    const res = await fetch("/api/school/calendar", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar agenda.");
      return;
    }

    setEvents((json.events ?? []) as CalendarEventRow[]);
  }

  async function loadPage() {
    try {
      setError(null);
      setLoading(true);

      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meJson = await safeJson(meRes);

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão.");

        if (meRes.status === 401 || meRes.status === 403) {
          router.replace("/login");
        }

        return;
      }

      const me = meJson as MePayload;

      if (me.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const currentRole = me.school?.role || null;
      const currentSchoolId = me.school?.schoolId || null;

      if (!canManageCalendar(currentRole)) {
        router.replace(me.redirectTo || "/school");
        return;
      }

      if (!currentSchoolId) {
        setError("Usuário sem escola vinculada.");
        return;
      }

      setRole(currentRole);
      setSchoolId(currentSchoolId);

      await loadEvents(token);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar agenda.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setTitle("");
    setDescription("");
    setEventDate(todayDateInput());
    setEditingId(null);
  }

  function startEdit(event: CalendarEventRow) {
    setEditingId(event.id);
    setTitle(event.title || "");
    setDescription(event.description || "");
    setEventDate(String(event.event_date || "").slice(0, 10) || todayDateInput());

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveEvent() {
    if (!title.trim()) {
      alert("Informe o título do evento.");
      return;
    }

    if (!eventDate) {
      alert("Informe a data do evento.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const token = await getAccessToken();

      if (!token) {
        alert("Sessão inválida. Faça login novamente.");
        router.replace("/login");
        return;
      }

      const method = editingId ? "PATCH" : "POST";

      const res = await fetch("/api/school/calendar", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          id: editingId,
          title: title.trim(),
          description: description.trim() || null,
          eventDate,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        alert(json?.error || "Erro ao salvar evento.");
        return;
      }

      resetForm();
      await loadEvents(token);

      alert(editingId ? "Evento atualizado com sucesso ✅" : "Evento publicado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao salvar evento.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(event: CalendarEventRow) {
    const ok = confirm(
      `Deseja excluir este evento da agenda?\n\n${event.title}\n${formatDateBR(
        event.event_date
      )}`
    );

    if (!ok) return;

    try {
      setDeletingId(event.id);
      setError(null);

      const token = await getAccessToken();

      if (!token) {
        alert("Sessão inválida. Faça login novamente.");
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/school/calendar?id=${encodeURIComponent(event.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        alert(json?.error || "Erro ao excluir evento.");
        return;
      }

      if (editingId === event.id) {
        resetForm();
      }

      await loadEvents(token);

      alert("Evento excluído com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao excluir evento.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="h-48 animate-pulse rounded-[32px] bg-slate-200" />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-32 animate-pulse rounded-[28px] bg-slate-200" />
          <div className="h-32 animate-pulse rounded-[28px] bg-slate-200" />
          <div className="h-32 animate-pulse rounded-[28px] bg-slate-200" />
        </section>

        <section className="h-96 animate-pulse rounded-[32px] bg-slate-200" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            Não foi possível carregar
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/school")}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Voltar ao painel
            </button>

            <button
              type="button"
              onClick={loadPage}
              className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Gestão da rotina escolar
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Agenda escolar
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                Cadastre eventos, compromissos, datas importantes e avisos de rotina
                que serão exibidos no portal dos responsáveis.
              </p>

              <div className="mt-4 text-sm text-slate-200">
                Escola:{" "}
                <span className="font-mono text-xs">{schoolId || "—"}</span>{" "}
                • Perfil: <span className="font-semibold">{role || "—"}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  const token = await getAccessToken();
                  if (token) await loadEvents(token);
                }}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Recarregar
              </button>

              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Voltar ao painel
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
          <MetricCard
            label="Eventos cadastrados"
            value={String(events.length)}
            help="Quantidade total de eventos publicados na agenda da escola."
          />

          <MetricCard
            label="Próximos eventos"
            value={String(futureEvents.length)}
            help="Eventos de hoje em diante visíveis para os responsáveis."
          />

          <MetricCard
            label="Próximo destaque"
            value={nextEvent ? formatDateBR(nextEvent.event_date) : "—"}
            help={nextEvent ? nextEvent.title : "Nenhum evento futuro cadastrado."}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {editingId ? "Editar evento" : "Criar evento"}
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                O evento salvo aqui aparece automaticamente no portal dos pais.
              </p>
            </div>

            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar edição
              </button>
            ) : null}
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Título do evento *
              </label>

              <input
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                placeholder="Ex: Reunião de pais, Festa Junina, Simulado..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Data do evento *
              </label>

              <input
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Descrição
              </label>

              <textarea
                className="min-h-[150px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                placeholder="Digite detalhes importantes para os responsáveis..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
            </div>

            <button
              type="button"
              onClick={saveEvent}
              disabled={saving}
              className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving
                ? "Salvando..."
                : editingId
                  ? "Salvar alterações"
                  : "Publicar evento"}
            </button>

            <p className="text-xs leading-5 text-slate-500">
              Nesta primeira versão usamos a estrutura atual do banco: título,
              descrição e data. Depois podemos evoluir para horário, anexos,
              turmas específicas e confirmação de leitura.
            </p>
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Destaque da agenda
          </div>

          {nextEvent ? (
            <div className="mt-4 rounded-[28px] border border-emerald-200 bg-emerald-50 p-5">
              <EventBadge variant="future">Próximo evento</EventBadge>

              <h3 className="mt-3 break-words text-xl font-semibold text-slate-900">
                {nextEvent.title}
              </h3>

              <div className="mt-2 text-sm font-medium capitalize text-slate-700">
                {formatLongDateBR(nextEvent.event_date)}
              </div>

              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {nextEvent.description || "Sem descrição adicional."}
              </p>

              <div className="mt-4 break-words text-xs text-slate-500">
                Publicado em: {formatDateTimeBR(nextEvent.created_at)}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-500">
              Nenhum evento futuro cadastrado. Crie o próximo compromisso escolar
              para aparecer aqui e no portal dos responsáveis.
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Eventos futuros
              </div>

              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {futureEvents.length}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Eventos anteriores
              </div>

              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {pastEvents.length}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Eventos publicados
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-500">
            Visualização por data para conferência rápida da agenda exibida aos pais.
          </p>
        </div>

        <div className="p-4 md:p-6">
          {events.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <div className="text-sm font-semibold text-slate-700">
                Nenhum evento cadastrado ainda
              </div>

              <p className="mt-1 text-sm text-slate-500">
                Crie o primeiro evento para alimentar a agenda dos responsáveis.
              </p>
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
                        <div className="break-words text-lg font-semibold capitalize text-slate-900">
                          {formatLongDateBR(day)}
                        </div>

                        <div className="mt-1 text-sm text-slate-500">
                          {formatDateBR(day)}
                        </div>
                      </div>

                      <div className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {dayEvents.length} evento(s)
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3">
                      {dayEvents.map((event) => {
                        const future = isFutureOrToday(event.event_date);
                        const deleting = deletingId === event.id;

                        return (
                          <article
                            key={event.id}
                            className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm"
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <EventBadge variant={future ? "future" : "past"}>
                                    {future ? "Futuro / hoje" : "Anterior"}
                                  </EventBadge>

                                  <EventBadge>
                                    Publicado: {formatDateTimeBR(event.created_at)}
                                  </EventBadge>
                                </div>

                                <h3 className="mt-3 break-words text-base font-semibold text-slate-900">
                                  {event.title}
                                </h3>

                                {event.description ? (
                                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                                    {event.description}
                                  </p>
                                ) : (
                                  <p className="mt-3 text-sm text-slate-400">
                                    Sem descrição adicional.
                                  </p>
                                )}
                              </div>

                              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                                <button
                                  type="button"
                                  onClick={() => startEdit(event)}
                                  disabled={saving || deleting}
                                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                >
                                  Editar
                                </button>

                                <button
                                  type="button"
                                  onClick={() => deleteEvent(event)}
                                  disabled={saving || deleting}
                                  className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                                >
                                  {deleting ? "Excluindo..." : "Excluir"}
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 break-all border-t border-slate-100 pt-3 text-[11px] font-mono text-slate-400">
                              ID: {event.id}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}