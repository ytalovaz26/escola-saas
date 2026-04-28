"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DiaryEntry = {
  id: string;
  lesson_date: string;
  content_taught: string;
  methodology: string | null;
  activities: string | null;
  notes: string | null;
  homework: string | null;
};

type DiaryGroup = {
  diary: {
    id: string;
    class_id: string;
    class_name?: string | null;
    subject_name: string;
    term_label: string | null;
    reference_month: string | null;
    teacher_user_id: string;
    teacher_name?: string | null;
  };
  entries: DiaryEntry[];
};

type PeriodPreset = "month" | "bimester" | "semester" | "year" | "custom";

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toYMD(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function currentMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthStart(referenceMonth: string) {
  const [y, m] = referenceMonth.split("-").map(Number);
  if (!y || !m) return toYMD(new Date());

  return `${y}-${pad2(m)}-01`;
}

function monthEnd(referenceMonth: string) {
  const [y, m] = referenceMonth.split("-").map(Number);
  if (!y || !m) return toYMD(new Date());

  return toYMD(new Date(y, m, 0));
}

function yearStart(referenceMonth: string) {
  const [y] = referenceMonth.split("-").map(Number);
  if (!y) return `${new Date().getFullYear()}-01-01`;

  return `${y}-01-01`;
}

function yearEnd(referenceMonth: string) {
  const [y] = referenceMonth.split("-").map(Number);
  if (!y) return `${new Date().getFullYear()}-12-31`;

  return `${y}-12-31`;
}

function bimesterRange(referenceMonth: string) {
  const [y, m] = referenceMonth.split("-").map(Number);
  if (!y || !m) {
    const now = new Date();
    return {
      start: `${now.getFullYear()}-01-01`,
      end: `${now.getFullYear()}-02-28`,
    };
  }

  const bimesterStartMonth = Math.floor((m - 1) / 2) * 2 + 1;
  const start = `${y}-${pad2(bimesterStartMonth)}-01`;
  const end = toYMD(new Date(y, bimesterStartMonth + 1, 0));

  return { start, end };
}

function semesterRange(referenceMonth: string) {
  const [y, m] = referenceMonth.split("-").map(Number);
  if (!y || !m) {
    const now = new Date();
    return {
      start: `${now.getFullYear()}-01-01`,
      end: `${now.getFullYear()}-06-30`,
    };
  }

  if (m <= 6) {
    return {
      start: `${y}-01-01`,
      end: `${y}-06-30`,
    };
  }

  return {
    start: `${y}-07-01`,
    end: `${y}-12-31`,
  };
}

function formatDateBR(iso: string) {
  if (!iso) return "—";

  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;

  return `${d}/${m}/${y}`;
}

function periodLabel(startDate: string, endDate: string) {
  if (!startDate && !endDate) return "—";
  if (startDate && !endDate) return `A partir de ${formatDateBR(startDate)}`;
  if (!startDate && endDate) return `Até ${formatDateBR(endDate)}`;
  if (startDate === endDate) return formatDateBR(startDate);

  return `${formatDateBR(startDate)} até ${formatDateBR(endDate)}`;
}

function TextBox({
  label,
  value,
  className = "",
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 ${className}`}
    >
      <div className="font-semibold text-slate-900">{label}</div>
      <div className="mt-2 overflow-hidden whitespace-pre-wrap break-words leading-6 text-slate-700">
        {value && value.trim() ? value : "—"}
      </div>
    </div>
  );
}

export default function SchoolClassDiaryPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [referenceMonth, setReferenceMonth] = useState(currentMonthISO());
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("month");
  const [startDate, setStartDate] = useState(monthStart(currentMonthISO()));
  const [endDate, setEndDate] = useState(monthEnd(currentMonthISO()));

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [groups, setGroups] = useState<DiaryGroup[]>([]);
  const [selectedDiaryId, setSelectedDiaryId] = useState<string>("");

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  function applyPreset(nextPreset: PeriodPreset, monthValue = referenceMonth) {
    setPeriodPreset(nextPreset);

    if (nextPreset === "month") {
      setStartDate(monthStart(monthValue));
      setEndDate(monthEnd(monthValue));
      return;
    }

    if (nextPreset === "bimester") {
      const range = bimesterRange(monthValue);
      setStartDate(range.start);
      setEndDate(range.end);
      return;
    }

    if (nextPreset === "semester") {
      const range = semesterRange(monthValue);
      setStartDate(range.start);
      setEndDate(range.end);
      return;
    }

    if (nextPreset === "year") {
      setStartDate(yearStart(monthValue));
      setEndDate(yearEnd(monthValue));
      return;
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) return;

    try {
      const query = new URLSearchParams({
        referenceMonth,
        startDate,
        endDate,
      });

      const res = await fetch(`/api/school/class-diary?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar diários.");
        setGroups([]);
        setSelectedDiaryId("");
        return;
      }

      const loadedGroups: DiaryGroup[] = Array.isArray(json.groups) ? json.groups : [];
      setGroups(loadedGroups);

      if (loadedGroups.length > 0) {
        const stillExists = loadedGroups.some((g) => g.diary.id === selectedDiaryId);
        setSelectedDiaryId(stillExists ? selectedDiaryId : loadedGroups[0].diary.id);
      } else {
        setSelectedDiaryId("");
      }
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar diários.");
      setGroups([]);
      setSelectedDiaryId("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceMonth, startDate, endDate]);

  const selectedGroup = useMemo(() => {
    return groups.find((g) => g.diary.id === selectedDiaryId) || null;
  }, [groups, selectedDiaryId]);

  const totalEntries = useMemo(() => {
    return groups.reduce((sum, group) => sum + group.entries.length, 0);
  }, [groups]);

  async function generatePdf() {
    setError(null);
    setMessage(null);

    if (!selectedGroup) {
      setError("Selecione uma turma/diário.");
      return;
    }

    if (!startDate || !endDate) {
      setError("Informe a data inicial e a data final do relatório.");
      return;
    }

    if (startDate > endDate) {
      setError("A data inicial não pode ser maior que a data final.");
      return;
    }

    const token = await ensureToken();
    if (!token) return;

    setGenerating(true);

    try {
      const query = new URLSearchParams({
        classId: selectedGroup.diary.class_id,
        referenceMonth: selectedGroup.diary.reference_month || referenceMonth,
        subjectName: selectedGroup.diary.subject_name || "",
        termLabel: selectedGroup.diary.term_label || "",
        startDate,
        endDate,
        reportMode: "summary",
      });

      const res = await fetch(`/api/school/class-diary/report?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();

        try {
          const json = text ? JSON.parse(text) : null;
          setError(
            (json?.error || "Falha ao gerar PDF do diário.") +
              (json?.details ? `\n\nDetalhes: ${json.details}` : "")
          );
        } catch {
          setError(text || "Falha ao gerar PDF do diário.");
        }

        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");

      setTimeout(() => URL.revokeObjectURL(url), 15000);

      setMessage("PDF do diário por período gerado com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao gerar PDF.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
                Gestão Pedagógica
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Diário de Classe
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Acompanhe os lançamentos pedagógicos feitos pelos professores e gere
                relatórios por dia, mês, bimestre, semestre, ano ou período personalizado.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Voltar
              </button>

              <button
                type="button"
                onClick={load}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Recarregar
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Mês base
              </label>
              <input
                type="month"
                value={referenceMonth}
                onChange={(e) => {
                  const nextMonth = e.target.value;
                  setReferenceMonth(nextMonth);
                  applyPreset(periodPreset, nextMonth);
                }}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Tipo de período
              </label>
              <select
                value={periodPreset}
                onChange={(e) => applyPreset(e.target.value as PeriodPreset)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="month">Mensal</option>
                <option value="bimester">Bimestre</option>
                <option value="semester">Semestre</option>
                <option value="year">Anual</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Data inicial
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setPeriodPreset("custom");
                  setStartDate(e.target.value);
                }}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Data final
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setPeriodPreset("custom");
                  setEndDate(e.target.value);
                }}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="xl:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Turma / diário
              </label>
              <select
                value={selectedDiaryId}
                onChange={(e) => setSelectedDiaryId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                disabled={groups.length === 0}
              >
                {groups.length === 0 ? (
                  <option value="">Nenhum diário encontrado</option>
                ) : (
                  groups.map((group) => (
                    <option key={group.diary.id} value={group.diary.id}>
                      {(group.diary.class_name || group.diary.class_id) +
                        " • " +
                        group.diary.subject_name +
                        " • " +
                        (group.diary.term_label || "Sem período")}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Período selecionado
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {periodLabel(startDate, endDate)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Diários encontrados
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {groups.length}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Lançamentos no período
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {totalEntries}
              </div>
            </div>
          </div>

          {selectedGroup ? (
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium text-slate-500">Turma</div>
                <div className="mt-1 break-words text-sm font-semibold text-slate-900">
                  {selectedGroup.diary.class_name || selectedGroup.diary.class_id}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium text-slate-500">Disciplina</div>
                <div className="mt-1 break-words text-sm font-semibold text-slate-900">
                  {selectedGroup.diary.subject_name}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium text-slate-500">Professor(a)</div>
                <div className="mt-1 break-words text-sm font-semibold text-slate-900">
                  {selectedGroup.diary.teacher_name || selectedGroup.diary.teacher_user_id || "—"}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm leading-6 text-slate-500">
              O relatório resumido exibe apenas a data e o conteúdo ministrado,
              no modelo tradicional de diário escolar.
            </p>

            <button
              type="button"
              onClick={generatePdf}
              disabled={!selectedGroup || !startDate || !endDate || generating}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Gerando PDF..." : "Gerar relatório do período"}
            </button>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </section>

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Carregando diários...
          </section>
        ) : groups.length === 0 ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Nenhum diário encontrado para o período selecionado.
          </section>
        ) : selectedGroup ? (
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Lançamentos do período
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Visualização do diário selecionado.
              </p>
            </div>

            {selectedGroup.entries.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                Nenhum lançamento encontrado para este diário no período selecionado.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {selectedGroup.entries.map((entry) => (
                  <div key={entry.id} className="p-5">
                    <div className="text-sm font-semibold text-slate-900">
                      Aula do dia {formatDateBR(entry.lesson_date)}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <TextBox label="Conteúdo" value={entry.content_taught} />
                      <TextBox label="Metodologia" value={entry.methodology} />
                      <TextBox label="Atividades" value={entry.activities} />
                      <TextBox label="Observações" value={entry.notes} />
                      <TextBox
                        label="Tarefa de casa"
                        value={entry.homework}
                        className="md:col-span-2"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}