"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { openPdfFromResponse } from "@/lib/openPdfOnClient";

type DiaryEntry = {
  id: string;
  lesson_date: string;
  content_taught: string;
  methodology: string | null;
  activities: string | null;
  notes: string | null;
  homework: string | null;
};

type DiaryMeta = {
  id: string;
  subject_name: string;
  term_label: string | null;
  reference_month: string;
  class_name?: string | null;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function currentMonthISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function brDate(iso: string) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function slugifyFileName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

export default function TeacherClassDiaryPage() {
  const router = useRouter();
  const params = useParams<{ classId: string }>();
  const classId = params.classId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [diaryMeta, setDiaryMeta] = useState<DiaryMeta | null>(null);

  const [subjectName, setSubjectName] = useState("");
  const [termLabel, setTermLabel] = useState("");
  const [referenceMonth, setReferenceMonth] = useState(currentMonthISO());
  const [lessonDate, setLessonDate] = useState(todayISO());
  const [contentTaught, setContentTaught] = useState("");
  const [methodology, setMethodology] = useState("");
  const [activities, setActivities] = useState("");
  const [notes, setNotes] = useState("");
  const [homework, setHomework] = useState("");

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const hasFilledMainFields = useMemo(() => {
    return !!subjectName.trim() && !!lessonDate.trim() && !!contentTaught.trim();
  }, [subjectName, lessonDate, contentTaught]);

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  function resetFormKeepHeader() {
    setEditingEntryId(null);
    setLessonDate(todayISO());
    setContentTaught("");
    setMethodology("");
    setActivities("");
    setNotes("");
    setHomework("");
  }

  function loadEntryIntoForm(entry: DiaryEntry) {
    setEditingEntryId(entry.id);
    setLessonDate(entry.lesson_date || todayISO());
    setContentTaught(entry.content_taught || "");
    setMethodology(entry.methodology || "");
    setActivities(entry.activities || "");
    setNotes(entry.notes || "");
    setHomework(entry.homework || "");
    setMessage("Modo edição ativado. Atualize os campos e clique em salvar.");
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function load() {
    setLoading(true);
    setError(null);

    const token = await ensureToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/teacher/class-diary?classId=${encodeURIComponent(
          classId
        )}&referenceMonth=${encodeURIComponent(referenceMonth)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar diário.");
        setEntries([]);
        return;
      }

      const diary = json?.diary;
      const loadedEntries = Array.isArray(json?.entries) ? json.entries : [];

      if (diary) {
        setDiaryMeta({
          id: diary.id,
          subject_name: diary.subject_name || "",
          term_label: diary.term_label || "",
          reference_month: diary.reference_month || referenceMonth,
          class_name: diary.class_name || null,
        });

        setSubjectName(diary.subject_name || "");
        setTermLabel(diary.term_label || "");
      } else {
        setDiaryMeta(null);
      }

      setEntries(loadedEntries);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar diário.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const method = editingEntryId ? "PUT" : "POST";

      const res = await fetch("/api/teacher/class-diary", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId,
          entryId: editingEntryId,
          subjectName,
          termLabel,
          referenceMonth,
          lessonDate,
          contentTaught,
          methodology,
          activities,
          notes,
          homework,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao salvar diário.");
        return;
      }

      setMessage(
        editingEntryId ? "Diário alterado com sucesso ✅" : "Diário salvo com sucesso ✅"
      );
      resetFormKeepHeader();
      await load();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao salvar diário.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entryId: string) {
    const confirmed = window.confirm("Tem certeza que deseja excluir este lançamento do diário?");
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) {
      setDeleting(false);
      return;
    }

    try {
      const res = await fetch("/api/teacher/class-diary", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId,
          entryId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao excluir lançamento.");
        return;
      }

      if (editingEntryId === entryId) {
        resetFormKeepHeader();
      }

      setMessage("Lançamento excluído com sucesso ✅");
      await load();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao excluir lançamento.");
    } finally {
      setDeleting(false);
    }
  }

  async function generateDiaryPdf() {
    setGeneratingPdf(true);
    setError(null);
    setMessage(null);

    try {
      const token = await ensureToken();
      if (!token) {
        setGeneratingPdf(false);
        return;
      }

      if (!classId.trim()) {
        setError("Turma não identificada para gerar o PDF.");
        return;
      }

      if (!subjectName.trim()) {
        setError("Informe a disciplina antes de gerar o PDF.");
        return;
      }

      if (!referenceMonth.trim()) {
        setError("Informe o mês de referência antes de gerar o PDF.");
        return;
      }

      if (!lessonDate.trim()) {
        setError("Informe a data da aula antes de gerar o PDF.");
        return;
      }

      const query = new URLSearchParams({
        classId,
        referenceMonth,
        subjectName,
        termLabel,
        lessonDate,
      });

      const res = await fetch(`/api/teacher/class-diary/report?${query.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const json = await safeJson(res);
        setError(json?.error || "Falha ao gerar PDF do diário.");
        return;
      }

      const fileBase = slugifyFileName(
        `${diaryMeta?.class_name || "turma"}-${subjectName}-${referenceMonth}-diario`
      );

      await openPdfFromResponse(res, {
        fileName: `${fileBase || "diario-de-classe"}.pdf`,
      });

      setMessage("PDF do diário gerado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao gerar PDF do diário.");
    } finally {
      setGeneratingPdf(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, referenceMonth]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
            Diário Pedagógico
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            Diário de Classe
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Registre, edite, exclua e gere o PDF pedagógico da turma.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={() => router.push(`/teacher/classes/${classId}`)}
            >
              Voltar para alunos
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={load}
            >
              Recarregar
            </button>

            <button
              type="button"
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={generatingPdf}
              onClick={generateDiaryPdf}
            >
              {generatingPdf ? "Gerando PDF..." : "Gerar PDF do diário"}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Disciplina</label>
              <input
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                placeholder="Ex.: Matemática"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Bimestre / Período</label>
              <input
                value={termLabel}
                onChange={(e) => setTermLabel(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                placeholder="Ex.: 1º Bimestre"
              />
            </div>

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
              <label className="mb-1 block text-xs text-slate-500">Data da aula</label>
              <input
                type="date"
                value={lessonDate}
                onChange={(e) => setLessonDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Conteúdo ministrado</label>
              <textarea
                value={contentTaught}
                onChange={(e) => setContentTaught(e.target.value)}
                className="min-h-[110px] w-full rounded-2xl border border-slate-300 px-3 py-3"
                placeholder="Descreva o conteúdo ministrado na aula..."
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Metodologia</label>
              <textarea
                value={methodology}
                onChange={(e) => setMethodology(e.target.value)}
                className="min-h-[90px] w-full rounded-2xl border border-slate-300 px-3 py-3"
                placeholder="Ex.: aula expositiva, atividade em grupo, leitura guiada, roda de conversa..."
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Atividades desenvolvidas</label>
              <textarea
                value={activities}
                onChange={(e) => setActivities(e.target.value)}
                className="min-h-[90px] w-full rounded-2xl border border-slate-300 px-3 py-3"
                placeholder="Descreva as atividades aplicadas em sala..."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Observações</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[90px] w-full rounded-2xl border border-slate-300 px-3 py-3"
                  placeholder="Observações da aula..."
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Tarefa de casa</label>
                <textarea
                  value={homework}
                  onChange={(e) => setHomework(e.target.value)}
                  className="min-h-[90px] w-full rounded-2xl border border-slate-300 px-3 py-3"
                  placeholder="Tarefa enviada para casa..."
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!hasFilledMainFields || saving}
              onClick={save}
              className="rounded-2xl bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : editingEntryId ? "Salvar alteração" : "Salvar diário"}
            </button>

            {editingEntryId ? (
              <button
                type="button"
                onClick={resetFormKeepHeader}
                className="rounded-2xl border border-slate-300 px-5 py-2 text-sm"
              >
                Cancelar edição
              </button>
            ) : null}
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-wrap">
              {error}
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Lançamentos do mês</h2>
            <p className="mt-1 text-sm text-slate-500">
              Histórico das aulas registradas para este mês de referência.
            </p>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-500">Carregando diário...</div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              Nenhum lançamento pedagógico neste mês.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {entries.map((entry) => (
                <div key={entry.id} className="p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Aula do dia {brDate(entry.lesson_date)}
                      </div>

                      <div className="mt-2 text-sm text-slate-700">
                        <strong>Conteúdo:</strong> {entry.content_taught}
                      </div>

                      {entry.methodology ? (
                        <div className="mt-1 text-sm text-slate-700">
                          <strong>Metodologia:</strong> {entry.methodology}
                        </div>
                      ) : null}

                      {entry.activities ? (
                        <div className="mt-1 text-sm text-slate-700">
                          <strong>Atividades:</strong> {entry.activities}
                        </div>
                      ) : null}

                      {entry.notes ? (
                        <div className="mt-1 text-sm text-slate-700">
                          <strong>Observações:</strong> {entry.notes}
                        </div>
                      ) : null}

                      {entry.homework ? (
                        <div className="mt-1 text-sm text-slate-700">
                          <strong>Tarefa:</strong> {entry.homework}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => loadEntryIntoForm(entry)}
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                      >
                        Alterar
                      </button>

                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => deleteEntry(entry.id)}
                        className="rounded-2xl border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}