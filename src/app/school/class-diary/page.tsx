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

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function formatDateBR(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function currentMonthISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
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
      <div className="mt-2 whitespace-pre-wrap break-words overflow-hidden leading-6 text-slate-700">
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

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [groups, setGroups] = useState<DiaryGroup[]>([]);

  const [selectedDiaryId, setSelectedDiaryId] = useState<string>("");
  const [selectedLessonDate, setSelectedLessonDate] = useState<string>("");

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) return;

    try {
      const res = await fetch(
        `/api/school/class-diary?referenceMonth=${encodeURIComponent(referenceMonth)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar diários.");
        setGroups([]);
        setSelectedDiaryId("");
        setSelectedLessonDate("");
        return;
      }

      const loadedGroups: DiaryGroup[] = Array.isArray(json.groups) ? json.groups : [];
      setGroups(loadedGroups);

      if (loadedGroups.length > 0) {
        const firstGroup = loadedGroups[0];
        setSelectedDiaryId(firstGroup.diary.id);

        const firstDate =
          Array.isArray(firstGroup.entries) && firstGroup.entries.length > 0
            ? firstGroup.entries[0].lesson_date
            : "";

        setSelectedLessonDate(firstDate);
      } else {
        setSelectedDiaryId("");
        setSelectedLessonDate("");
      }
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar diários.");
      setGroups([]);
      setSelectedDiaryId("");
      setSelectedLessonDate("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceMonth]);

  const selectedGroup = useMemo(() => {
    return groups.find((g) => g.diary.id === selectedDiaryId) || null;
  }, [groups, selectedDiaryId]);

  const availableDates = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.entries.map((e) => e.lesson_date);
  }, [selectedGroup]);

  useEffect(() => {
    if (!selectedGroup) {
      setSelectedLessonDate("");
      return;
    }

    const stillExists = availableDates.includes(selectedLessonDate);
    if (!stillExists) {
      setSelectedLessonDate(availableDates[0] || "");
    }
  }, [selectedGroup, availableDates, selectedLessonDate]);

  async function generatePdf() {
    setError(null);
    setMessage(null);

    if (!selectedGroup) {
      setError("Selecione uma turma/diário.");
      return;
    }

    if (!selectedLessonDate) {
      setError("Selecione a data da aula.");
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
        lessonDate: selectedLessonDate,
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
      setMessage("PDF do diário gerado com sucesso.");
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
                os PDFs pela visão da direção.
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

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Mês de referência</label>
              <input
                type="month"
                value={referenceMonth}
                onChange={(e) => setReferenceMonth(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Turma / diário</label>
              <select
                value={selectedDiaryId}
                onChange={(e) => setSelectedDiaryId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
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

            <div>
              <label className="mb-1 block text-xs text-slate-500">Data da aula</label>
              <select
                value={selectedLessonDate}
                onChange={(e) => setSelectedLessonDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                disabled={!selectedGroup || availableDates.length === 0}
              >
                {!selectedGroup || availableDates.length === 0 ? (
                  <option value="">Nenhuma data disponível</option>
                ) : (
                  availableDates.map((date) => (
                    <option key={date} value={date}>
                      {formatDateBR(date)}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={generatePdf}
                disabled={!selectedGroup || !selectedLessonDate || generating}
                className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {generating ? "Gerando PDF..." : "Gerar PDF do diário"}
              </button>
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
            Nenhum diário encontrado neste mês.
          </section>
        ) : selectedGroup ? (
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Lançamentos</h2>
              <p className="mt-1 text-sm text-slate-500">
                Visualização do diário selecionado.
              </p>
            </div>

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
          </section>
        ) : null}
      </div>
    </main>
  );
}