"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type CalendarBlock = {
  id: string;
  school_id: string;
  block_date: string;
  type: string;
  title: string;
  description: string | null;
  affects_all_classes: boolean;
  target_scope: "all_school" | "class" | "shift" | string | null;
  class_id: string | null;
  shift: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolClass = {
  id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

const blockTypeLabels: Record<string, string> = {
  holiday: "Feriado",
  recess: "Recesso",
  no_class: "Dia sem aula",
  pedagogical_day: "Dia pedagógico",
  exam_day: "Dia de avaliação",
  event: "Evento escolar",
  other: "Outro",
};

const targetScopeLabels: Record<string, string> = {
  all_school: "Toda a escola",
  class: "Turma específica",
  shift: "Turno/período",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

function formatDateBR(date: string) {
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

function normalizeComparable(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getClassLabel(cls?: SchoolClass | null) {
  if (!cls) return "Turma não encontrada";

  const parts = [
    cls.name,
    cls.grade ? cls.grade : null,
    cls.shift ? cls.shift : null,
  ].filter(Boolean);

  return parts.join(" • ");
}

function getBlockTargetLabel(block: CalendarBlock, classes: SchoolClass[]) {
  const scope = block.target_scope || "all_school";

  if (scope === "all_school" || block.affects_all_classes) {
    return "Toda a escola";
  }

  if (scope === "class") {
    const cls = classes.find((item) => item.id === block.class_id);
    return cls ? `Turma: ${getClassLabel(cls)}` : "Turma específica";
  }

  if (scope === "shift") {
    return block.shift ? `Turno: ${block.shift}` : "Turno/período";
  }

  return targetScopeLabels[scope] || "Aplicação do bloqueio";
}

async function safeJsonFromResponse(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

export default function SchoolCalendarBlocksPage() {
  const router = useRouter();

  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [referenceDate, setReferenceDate] = useState(todayISO());

  const [blockDate, setBlockDate] = useState(todayISO());
  const [type, setType] = useState("no_class");
  const [title, setTitle] = useState("Não haverá aula");
  const [description, setDescription] = useState("");

  const [targetScope, setTargetScope] = useState<"all_school" | "class" | "shift">(
    "all_school"
  );
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedShift, setSelectedShift] = useState("");

  const startDate = useMemo(() => monthStartISO(referenceDate), [referenceDate]);
  const endDate = useMemo(() => monthEndISO(referenceDate), [referenceDate]);

  const availableShifts = useMemo(() => {
    const map = new Map<string, string>();

    for (const cls of classes) {
      const shift = String(cls.shift || "").trim();
      if (!shift) continue;

      const key = normalizeComparable(shift);
      if (!map.has(key)) map.set(key, shift);
    }

    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [classes]);

  const sortedClasses = useMemo(() => {
    return [...classes].sort((a, b) => {
      const an = getClassLabel(a);
      const bn = getClassLabel(b);
      return an.localeCompare(bn);
    });
  }, [classes]);

  const sortedBlocks = useMemo(() => {
    return [...blocks].sort((a, b) => {
      const ad = `${a.block_date}T${a.created_at}`;
      const bd = `${b.block_date}T${b.created_at}`;
      return ad.localeCompare(bd);
    });
  }, [blocks]);

  const monthLabel = useMemo(() => {
    const d = new Date(`${referenceDate}T12:00:00`);
    return d.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  }, [referenceDate]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadBlocks() {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();

      if (!token) return;

      const qs = new URLSearchParams({
        startDate,
        endDate,
      });

      const res = await fetch(`/api/school/calendar-blocks?${qs.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJsonFromResponse(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar bloqueios do calendário.");
        return;
      }

      setBlocks(Array.isArray(json.blocks) ? json.blocks : []);
      setClasses(Array.isArray(json.classes) ? json.classes : []);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar calendário.");
    } finally {
      setLoading(false);
    }
  }

  async function createBlock() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getToken();

      if (!token) return;

      if (!title.trim()) {
        setError("Informe o título do bloqueio.");
        return;
      }

      if (targetScope === "class" && !selectedClassId) {
        setError("Selecione a turma que será bloqueada.");
        return;
      }

      if (targetScope === "shift" && !selectedShift) {
        setError("Selecione o turno/período que será bloqueado.");
        return;
      }

      const res = await fetch("/api/school/calendar-blocks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blockDate,
          type,
          title,
          description,
          targetScope,
          classId: targetScope === "class" ? selectedClassId : null,
          shift: targetScope === "shift" ? selectedShift : null,
          affectsAllClasses: targetScope === "all_school",
        }),
      });

      const json = await safeJsonFromResponse(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao cadastrar bloqueio.");
        return;
      }

      setSuccess("Bloqueio cadastrado com sucesso.");
      setDescription("");
      await loadBlocks();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao cadastrar bloqueio.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteBlock(id: string) {
    const confirmed = window.confirm("Tem certeza que deseja remover este bloqueio?");

    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getToken();

      if (!token) return;

      const qs = new URLSearchParams({ id });

      const res = await fetch(`/api/school/calendar-blocks?${qs.toString()}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJsonFromResponse(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao remover bloqueio.");
        return;
      }

      setSuccess("Bloqueio removido com sucesso.");
      await loadBlocks();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao remover bloqueio.");
    } finally {
      setSaving(false);
    }
  }

  function moveMonth(months: number) {
    const d = new Date(`${referenceDate}T12:00:00`);
    d.setMonth(d.getMonth() + months);
    setReferenceDate(d.toISOString().slice(0, 10));
  }

  useEffect(() => {
    loadBlocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

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
                  Calendário escolar
                </div>

                <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                  Dias sem aula e feriados
                </h1>

                <p className="mt-4 text-base leading-8 text-slate-200">
                  Cadastre feriados, recessos, dias sem aula e eventos pedagógicos para
                  toda a escola, uma turma específica ou um turno/período.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/school/schedule")}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
                >
                  Voltar aos horários
                </button>

                <button
                  type="button"
                  onClick={loadBlocks}
                  className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
                >
                  Recarregar
                </button>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-700">
            {success}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Novo bloqueio
            </div>

            <h2 className="mt-2 text-2xl font-bold text-slate-950">
              Bloquear dia no calendário
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Defina se o bloqueio vale para toda a escola, uma turma ou um turno.
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  Data
                </label>

                <input
                  type="date"
                  value={blockDate}
                  onChange={(e) => setBlockDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  Tipo
                </label>

                <select
                  value={type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setType(nextType);

                    if (nextType === "holiday") setTitle("Feriado");
                    if (nextType === "recess") setTitle("Recesso escolar");
                    if (nextType === "no_class") setTitle("Não haverá aula");
                    if (nextType === "pedagogical_day") setTitle("Dia pedagógico");
                    if (nextType === "exam_day") setTitle("Dia de avaliação");
                    if (nextType === "event") setTitle("Evento escolar");
                    if (nextType === "other") setTitle("Bloqueio no calendário");
                  }}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                >
                  <option value="no_class">Dia sem aula</option>
                  <option value="holiday">Feriado</option>
                  <option value="recess">Recesso</option>
                  <option value="pedagogical_day">Dia pedagógico</option>
                  <option value="exam_day">Dia de avaliação</option>
                  <option value="event">Evento escolar</option>
                  <option value="other">Outro</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  Aplicar bloqueio em
                </label>

                <select
                  value={targetScope}
                  onChange={(e) => {
                    const next = e.target.value as "all_school" | "class" | "shift";
                    setTargetScope(next);

                    if (next !== "class") setSelectedClassId("");
                    if (next !== "shift") setSelectedShift("");
                  }}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                >
                  <option value="all_school">Toda a escola</option>
                  <option value="class">Turma específica</option>
                  <option value="shift">Turno/período</option>
                </select>
              </div>

              {targetScope === "class" ? (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                    Turma
                  </label>

                  <select
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                  >
                    <option value="">Selecione uma turma</option>

                    {sortedClasses.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {getClassLabel(cls)}
                      </option>
                    ))}
                  </select>

                  {sortedClasses.length === 0 ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Nenhuma turma foi encontrada. Cadastre turmas antes de usar este
                      tipo de bloqueio.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {targetScope === "shift" ? (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                    Turno/período
                  </label>

                  <select
                    value={selectedShift}
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                  >
                    <option value="">Selecione um turno/período</option>

                    {availableShifts.map((shift) => (
                      <option key={shift} value={shift}>
                        {shift}
                      </option>
                    ))}
                  </select>

                  {availableShifts.length === 0 ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Nenhum turno foi encontrado nas turmas cadastradas.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  Título
                </label>

                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Feriado municipal"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  Observação
                </label>

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Não haverá aula devido ao feriado municipal."
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                />
              </div>

              <button
                type="button"
                onClick={createBlock}
                disabled={saving}
                className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Cadastrar bloqueio"}
              </button>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Bloqueios cadastrados
                </div>

                <h2 className="mt-2 text-2xl font-bold capitalize text-slate-950">
                  {monthLabel}
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Período: {formatDateBR(startDate)} até {formatDateBR(endDate)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moveMonth(-1)}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Mês anterior
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setReferenceDate(todayISO());
                    setBlockDate(todayISO());
                  }}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Hoje
                </button>

                <button
                  type="button"
                  onClick={() => moveMonth(1)}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Próximo mês
                </button>
              </div>
            </div>

            <div className="mt-6">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="h-28 animate-pulse rounded-[28px] bg-slate-100"
                    />
                  ))}
                </div>
              ) : sortedBlocks.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <div className="text-3xl">📅</div>

                  <h3 className="mt-3 text-lg font-bold text-slate-950">
                    Nenhum bloqueio neste mês
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Cadastre feriados, recessos ou dias sem aula para orientar a rotina
                    escolar.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedBlocks.map((block) => (
                    <article
                      key={block.id}
                      className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                              {blockTypeLabels[block.type] || "Bloqueio"}
                            </span>

                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                              {formatDateBR(block.block_date)}
                            </span>

                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                              {getBlockTargetLabel(block, classes)}
                            </span>
                          </div>

                          <h3 className="mt-3 text-lg font-bold text-slate-950">
                            {block.title}
                          </h3>

                          <p className="mt-1 text-sm font-medium capitalize text-slate-500">
                            {formatLongDateBR(block.block_date)}
                          </p>

                          {block.description ? (
                            <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                              {block.description}
                            </p>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() => deleteBlock(block.id)}
                          disabled={saving}
                          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remover
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}