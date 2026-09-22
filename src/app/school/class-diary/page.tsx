"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type PeriodPreset = "month" | "academic" | "year" | "custom";

type AcademicPeriod = {
  id: string;
  periodNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
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

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
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
  const [generatingPeriod, setGeneratingPeriod] = useState(false);
  const [generatingDaily, setGeneratingDaily] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string>("");
  const [editLessonDate, setEditLessonDate] = useState("");
  const [editContentTaught, setEditContentTaught] = useState("");
  const [editMethodology, setEditMethodology] = useState("");
  const [editActivities, setEditActivities] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editHomework, setEditHomework] = useState("");

  const [referenceMonth, setReferenceMonth] = useState(currentMonthISO());
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("month");
  const [startDate, setStartDate] = useState(monthStart(currentMonthISO()));
  const [endDate, setEndDate] = useState(monthEnd(currentMonthISO()));
  const [academicPeriods, setAcademicPeriods] = useState<AcademicPeriod[]>([]);
  const [selectedAcademicPeriodId, setSelectedAcademicPeriodId] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [groups, setGroups] = useState<DiaryGroup[]>([]);
  const [selectedDiaryId, setSelectedDiaryId] = useState<string>("");
  const [selectedDailyEntryId, setSelectedDailyEntryId] = useState<string>("");

  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null);
  const [lastPdfName, setLastPdfName] = useState<string>("diario-de-classe.pdf");
  const loadRequestIdRef = useRef(0);

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
      setSelectedAcademicPeriodId("");
      setStartDate(monthStart(monthValue));
      setEndDate(monthEnd(monthValue));
      return;
    }

    if (nextPreset === "academic") {
      const monthFirstDay = `${monthValue}-01`;
      const matchingPeriod =
        academicPeriods.find(
          (period) =>
            period.isActive &&
            period.startDate <= monthEnd(monthValue) &&
            period.endDate >= monthFirstDay
        ) ||
        academicPeriods.find((period) => period.isActive) ||
        null;

      if (matchingPeriod) {
        setSelectedAcademicPeriodId(matchingPeriod.id);
        setStartDate(matchingPeriod.startDate);
        setEndDate(matchingPeriod.endDate);
      }
      return;
    }

    if (nextPreset === "year") {
      setSelectedAcademicPeriodId("");
      setStartDate(yearStart(monthValue));
      setEndDate(yearEnd(monthValue));
      return;
    }

    if (nextPreset === "custom") {
      setSelectedAcademicPeriodId("");
    }
  }

  function applyAcademicPeriod(periodId: string) {
    setSelectedAcademicPeriodId(periodId);
    setPeriodPreset("academic");

    const period = academicPeriods.find((item) => item.id === periodId);
    if (!period) return;

    setStartDate(period.startDate);
    setEndDate(period.endDate);
  }

  function clearLastPdf() {
    if (lastPdfUrl) {
      URL.revokeObjectURL(lastPdfUrl);
      setLastPdfUrl(null);
    }
  }

  async function openPdfFromResponse(res: Response, fileName: string) {
    clearLastPdf();

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    setLastPdfUrl(url);
    setLastPdfName(fileName);

    const opened = window.open(url, "_blank", "noopener,noreferrer");

    if (!opened) {
      setMessage("PDF pronto para abrir. Toque no botão azul abaixo para visualizar ou baixar.");
      return;
    }

    setMessage("PDF gerado com sucesso.");
  }

  async function loadAcademicPeriods(year: number) {
    const token = await ensureToken();
    if (!token) return;

    try {
      const query = new URLSearchParams({ academicYear: String(year) });
      const res = await fetch(`/api/school/academic-periods?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setAcademicPeriods([]);
        return;
      }

      const periods: AcademicPeriod[] = Array.isArray(json.periods)
        ? json.periods.filter(
            (period: AcademicPeriod) =>
              period?.id &&
              period?.startDate &&
              period?.endDate &&
              period?.isActive !== false
          )
        : [];

      setAcademicPeriods(periods);
    } catch {
      setAcademicPeriods([]);
    }
  }

  async function load() {
    const requestId = ++loadRequestIdRef.current;

    setLoading(true);
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
      return;
    }

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

      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar diários.");
        setGroups([]);
        setSelectedDiaryId("");
        setSelectedDailyEntryId("");
        return;
      }

      const loadedGroups: DiaryGroup[] = Array.isArray(json.groups) ? json.groups : [];
      setGroups(loadedGroups);

      if (loadedGroups.length > 0) {
        const stillExists = loadedGroups.some((g) => g.diary.id === selectedDiaryId);
        const nextDiaryId = stillExists ? selectedDiaryId : loadedGroups[0].diary.id;
        setSelectedDiaryId(nextDiaryId);

        const nextGroup =
          loadedGroups.find((g) => g.diary.id === nextDiaryId) || loadedGroups[0];

        if (nextGroup.entries.length > 0) {
          const dailyStillExists = nextGroup.entries.some((e) => e.id === selectedDailyEntryId);
          setSelectedDailyEntryId(
            dailyStillExists ? selectedDailyEntryId : nextGroup.entries[0].id
          );
        } else {
          setSelectedDailyEntryId("");
        }
      } else {
        setSelectedDiaryId("");
        setSelectedDailyEntryId("");
      }
    } catch (e: any) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      setError(e?.message || "Erro inesperado ao carregar diários.");
      setGroups([]);
      setSelectedDiaryId("");
      setSelectedDailyEntryId("");
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const year = Number(referenceMonth.slice(0, 4));
    if (Number.isInteger(year)) {
      loadAcademicPeriods(year);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceMonth]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceMonth, startDate, endDate]);

  const selectedGroup = useMemo(() => {
    return groups.find((g) => g.diary.id === selectedDiaryId) || null;
  }, [groups, selectedDiaryId]);

  const selectedDailyEntry = useMemo(() => {
    if (!selectedGroup) return null;
    return selectedGroup.entries.find((entry) => entry.id === selectedDailyEntryId) || null;
  }, [selectedGroup, selectedDailyEntryId]);

  const totalEntries = useMemo(() => {
    return groups.reduce((sum, group) => sum + group.entries.length, 0);
  }, [groups]);

  function startEditingEntry(entry: DiaryEntry) {
    setEditingEntryId(entry.id);
    setEditLessonDate(entry.lesson_date || "");
    setEditContentTaught(entry.content_taught || "");
    setEditMethodology(entry.methodology || "");
    setEditActivities(entry.activities || "");
    setEditNotes(entry.notes || "");
    setEditHomework(entry.homework || "");
    setError(null);
    setMessage(null);
  }

  function cancelEditingEntry() {
    setEditingEntryId("");
    setEditLessonDate("");
    setEditContentTaught("");
    setEditMethodology("");
    setEditActivities("");
    setEditNotes("");
    setEditHomework("");
  }

  async function saveEditedEntry() {
    if (!selectedGroup || !editingEntryId) return;

    if (!editLessonDate) {
      setError("Informe a data da aula.");
      return;
    }

    if (!editContentTaught.trim()) {
      setError("Informe o conteúdo ministrado.");
      return;
    }

    const token = await ensureToken();
    if (!token) return;

    setSavingEntry(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/school/class-diary/update", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          diaryId: selectedGroup.diary.id,
          entryId: editingEntryId,
          classId: selectedGroup.diary.class_id,
          teacherUserId: selectedGroup.diary.teacher_user_id,
          lessonDate: editLessonDate,
          contentTaught: editContentTaught.trim(),
          methodology: editMethodology.trim(),
          activities: editActivities.trim(),
          notes: editNotes.trim(),
          homework: editHomework.trim(),
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(
          (json?.error || "Falha ao alterar lançamento do diário.") +
            (json?.details ? `\n\nDetalhes: ${json.details}` : "")
        );
        return;
      }

      cancelEditingEntry();
      await load();
      setMessage("Lançamento do diário alterado com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao alterar lançamento do diário.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function generatePeriodPdf() {
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

    setGeneratingPeriod(true);

    try {
      const query = new URLSearchParams({
        classId: selectedGroup.diary.class_id,
        teacherUserId: selectedGroup.diary.teacher_user_id || "",
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

      const fileName = `${safeFileName(
        selectedGroup.diary.class_name || "turma"
      )}-${safeFileName(selectedGroup.diary.subject_name || "disciplina")}-periodo.pdf`;

      await openPdfFromResponse(res, fileName);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao gerar PDF.");
    } finally {
      setGeneratingPeriod(false);
    }
  }

  async function generateDailyPdf(entry?: DiaryEntry | null) {
    setError(null);
    setMessage(null);

    const dailyEntry = entry || selectedDailyEntry;

    if (!selectedGroup) {
      setError("Selecione uma turma/diário.");
      return;
    }

    if (!dailyEntry) {
      setError("Selecione uma aula do dia para gerar o PDF diário.");
      return;
    }

    const token = await ensureToken();
    if (!token) return;

    setGeneratingDaily(true);

    try {
      const query = new URLSearchParams({
        classId: selectedGroup.diary.class_id,
        teacherUserId: selectedGroup.diary.teacher_user_id || "",
        referenceMonth: selectedGroup.diary.reference_month || referenceMonth,
        subjectName: selectedGroup.diary.subject_name || "",
        termLabel: selectedGroup.diary.term_label || "",
        lessonDate: dailyEntry.lesson_date,
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
            (json?.error || "Falha ao gerar PDF diário.") +
              (json?.details ? `\n\nDetalhes: ${json.details}` : "")
          );
        } catch {
          setError(text || "Falha ao gerar PDF diário.");
        }

        return;
      }

      const fileName = `${safeFileName(
        selectedGroup.diary.class_name || "turma"
      )}-${safeFileName(selectedGroup.diary.subject_name || "disciplina")}-diario-${dailyEntry.lesson_date}.pdf`;

      await openPdfFromResponse(res, fileName);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao gerar PDF diário.");
    } finally {
      setGeneratingDaily(false);
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
                relatórios por dia, mês, período letivo configurado, ano ou período personalizado.
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
                  if (periodPreset !== "academic") {
                    applyPreset(periodPreset, nextMonth);
                  }
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
                <option value="academic">Período letivo configurado</option>
                <option value="year">Anual</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            {periodPreset === "academic" ? (
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Período letivo
                </label>
                <select
                  value={selectedAcademicPeriodId}
                  onChange={(e) => applyAcademicPeriod(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                  disabled={academicPeriods.length === 0}
                >
                  <option value="">Selecione o período</option>
                  {academicPeriods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name} • {formatDateBR(period.startDate)} até {formatDateBR(period.endDate)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Data inicial
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setPeriodPreset("custom");
                  setSelectedAcademicPeriodId("");
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
                  setSelectedAcademicPeriodId("");
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
                onChange={(e) => {
                  const nextDiaryId = e.target.value;
                  setSelectedDiaryId(nextDiaryId);

                  const nextGroup = groups.find((g) => g.diary.id === nextDiaryId);
                  setSelectedDailyEntryId(nextGroup?.entries?.[0]?.id || "");
                }}
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

          <div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-slate-900">Gerar PDF diário completo</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Este botão gera o PDF completo da aula selecionada, com conteúdo, metodologia,
                  atividades, observações e tarefa de casa.
                </p>

                <label className="mt-4 mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Aula do dia
                </label>
                <select
                  value={selectedDailyEntryId}
                  onChange={(e) => setSelectedDailyEntryId(e.target.value)}
                  disabled={!selectedGroup || selectedGroup.entries.length === 0}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm"
                >
                  {!selectedGroup || selectedGroup.entries.length === 0 ? (
                    <option value="">Nenhuma aula disponível</option>
                  ) : (
                    selectedGroup.entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {formatDateBR(entry.lesson_date)} •{" "}
                        {entry.content_taught?.slice(0, 80) || "Sem conteúdo"}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <button
                type="button"
                onClick={() => generateDailyPdf()}
                disabled={!selectedGroup || !selectedDailyEntry || generatingDaily}
                className="rounded-2xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {generatingDaily ? "Gerando PDF diário..." : "Gerar PDF do dia"}
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm leading-6 text-slate-500">
              O relatório do período é resumido e exibe apenas a data e o conteúdo ministrado,
              respeitando exatamente as datas do período letivo configurado ou do intervalo escolhido.
            </p>

            <button
              type="button"
              onClick={generatePeriodPdf}
              disabled={!selectedGroup || !startDate || !endDate || generatingPeriod}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {generatingPeriod ? "Gerando PDF..." : "Gerar relatório do período"}
            </button>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {lastPdfUrl ? (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-900">
              <div className="font-semibold">PDF pronto para abrir</div>
              <p className="mt-1 leading-6 text-blue-800">
                No celular, toque no botão abaixo. Se abrir uma prévia, use a opção de
                compartilhar/salvar do navegador.
              </p>

              <a
                href={lastPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={lastPdfName}
                className="mt-3 inline-flex rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                Abrir PDF gerado
              </a>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </section>

        {editingEntryId && selectedGroup ? (
          <section className="rounded-3xl border border-amber-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Alterando lançamento
                </div>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">
                  Corrigir informações do Diário de Classe
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Diretor e coordenação podem corrigir o lançamento selecionado sem alterar os demais registros.
                </p>
              </div>

              <button
                type="button"
                onClick={cancelEditingEntry}
                disabled={savingEntry}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Data da aula
                </label>
                <input
                  type="date"
                  value={editLessonDate}
                  onChange={(e) => setEditLessonDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Conteúdo ministrado
                </label>
                <textarea
                  value={editContentTaught}
                  onChange={(e) => setEditContentTaught(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Metodologia
                </label>
                <textarea
                  value={editMethodology}
                  onChange={(e) => setEditMethodology(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Atividades desenvolvidas
                </label>
                <textarea
                  value={editActivities}
                  onChange={(e) => setEditActivities(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Observações
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Tarefa de casa
                </label>
                <textarea
                  value={editHomework}
                  onChange={(e) => setEditHomework(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={saveEditedEntry}
                disabled={savingEntry}
                className="rounded-2xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingEntry ? "Salvando alteração..." : "Salvar alteração"}
              </button>
            </div>
          </section>
        ) : null}

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
                Visualização do diário selecionado. Cada lançamento também possui botão individual
                para gerar o PDF diário completo.
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
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          Aula do dia {formatDateBR(entry.lesson_date)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Diário completo disponível para impressão ou arquivo.
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditingEntry(entry)}
                          disabled={savingEntry}
                          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        >
                          Alterar
                        </button>

                        <button
                          type="button"
                          onClick={() => generateDailyPdf(entry)}
                          disabled={generatingDaily}
                          className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {generatingDaily ? "Gerando..." : "Gerar PDF do dia"}
                        </button>
                      </div>
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