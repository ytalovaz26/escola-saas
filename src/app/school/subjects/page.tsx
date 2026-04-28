"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SubjectItem = {
  id: string;
  school_id: string;
  name: string;
  created_at: string;
};

type ClassItem = {
  id: string;
  name: string | null;
  grade: string | null;
  shift: string | null;
  created_at?: string | null;
};

type ClassSubjectItem = {
  id: string;
  class_id: string;
  subject_id: string;
  subject_name: string | null;
};

function safeArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function classLabel(c: ClassItem) {
  const parts: string[] = [];
  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(`Série: ${c.grade}`);
  if (c.shift) parts.push(`Turno: ${c.shift}`);
  return parts.join(" • ") || c.id;
}

export default function SchoolSubjectsPage() {
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [savingLinks, setSavingLinks] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState(false);

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [newSubjectName, setNewSubjectName] = useState("");

  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  async function getAccessToken() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message || "Falha ao obter sessão.");
    }

    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessão não encontrada. Faça login novamente.");
    }

    return token;
  }

  async function loadSubjects() {
    setLoadingSubjects(true);
    try {
      const token = await getAccessToken();

      const res = await fetch("/api/school/subjects/list", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao carregar disciplinas.");
      }

      setSubjects(safeArray<SubjectItem>(json.subjects));
    } catch (e: any) {
      setPageError(e?.message || "Erro ao carregar disciplinas.");
      setSubjects([]);
    } finally {
      setLoadingSubjects(false);
    }
  }

  async function loadClasses() {
    setLoadingClasses(true);
    try {
      const token = await getAccessToken();

      const res = await fetch("/api/school/subjects/classes-list", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao carregar turmas.");
      }

      const nextClasses = safeArray<ClassItem>(json.classes);
      setClasses(nextClasses);

      if (!selectedClassId && nextClasses.length > 0) {
        setSelectedClassId(String(nextClasses[0].id));
      }
    } catch (e: any) {
      setPageError(e?.message || "Erro ao carregar turmas.");
      setClasses([]);
    } finally {
      setLoadingClasses(false);
    }
  }

  async function loadClassSubjects(classId: string) {
    if (!classId) {
      setSelectedSubjectIds([]);
      return;
    }

    try {
      const token = await getAccessToken();

      const res = await fetch(
        `/api/school/class-subjects/list?classId=${encodeURIComponent(classId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao carregar disciplinas da turma.");
      }

      const items = safeArray<ClassSubjectItem>(json.items);
      setSelectedSubjectIds(items.map((item) => String(item.subject_id)));
    } catch (e: any) {
      setPageError(e?.message || "Erro ao carregar vínculo da turma.");
      setSelectedSubjectIds([]);
    }
  }

  async function createSubject() {
    setCreatingSubject(true);
    setPageError("");
    setPageSuccess("");

    try {
      const name = newSubjectName.trim();
      if (!name) {
        throw new Error("Informe o nome da disciplina.");
      }

      const token = await getAccessToken();

      const res = await fetch("/api/school/subjects/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao criar disciplina.");
      }

      setNewSubjectName("");
      setPageSuccess("Disciplina cadastrada com sucesso.");
      await loadSubjects();
    } catch (e: any) {
      setPageError(e?.message || "Erro ao cadastrar disciplina.");
    } finally {
      setCreatingSubject(false);
    }
  }

  async function saveClassSubjects() {
    setSavingLinks(true);
    setPageError("");
    setPageSuccess("");

    try {
      if (!selectedClassId) {
        throw new Error("Selecione uma turma.");
      }

      const token = await getAccessToken();

      const res = await fetch("/api/school/class-subjects/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId: selectedClassId,
          subjectIds: selectedSubjectIds,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao salvar disciplinas da turma.");
      }

      setPageSuccess("Disciplinas da turma salvas com sucesso.");
      await loadClassSubjects(selectedClassId);
    } catch (e: any) {
      setPageError(e?.message || "Erro ao salvar vínculo da turma.");
    } finally {
      setSavingLinks(false);
    }
  }

  function toggleSubject(subjectId: string) {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId)
        ? prev.filter((id) => id !== subjectId)
        : [...prev, subjectId]
    );
  }

  useEffect(() => {
    loadSubjects();
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedClassId) return;
    loadClassSubjects(selectedClassId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            Painel da Escola
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            Disciplinas
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Cadastre as disciplinas da escola e vincule quais disciplinas pertencem a cada turma.
          </p>
        </section>

        {pageError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pageError}
          </section>
        ) : null}

        {pageSuccess ? (
          <section className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {pageSuccess}
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Cadastrar nova disciplina</h2>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="Ex.: Matemática"
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            />

            <button
              type="button"
              onClick={createSubject}
              disabled={creatingSubject}
              className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingSubject ? "Salvando..." : "Cadastrar disciplina"}
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Disciplinas cadastradas</h2>

            {loadingSubjects ? (
              <div className="mt-4 text-sm text-slate-500">Carregando disciplinas...</div>
            ) : subjects.length === 0 ? (
              <div className="mt-4 text-sm text-slate-500">
                Nenhuma disciplina cadastrada ainda.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {subjects.map((subject) => (
                  <div
                    key={subject.id}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800"
                  >
                    {subject.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Vincular disciplinas à turma</h2>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Turma
              </label>

              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={loadingClasses}
                className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
              >
                {classes.length === 0 ? (
                  <option value="">Nenhuma turma encontrada</option>
                ) : null}

                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {classLabel(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {selectedClass ? (
                <>Turma selecionada: <span className="font-medium">{classLabel(selectedClass)}</span></>
              ) : (
                <>Selecione uma turma.</>
              )}
            </div>

            <div className="mt-4">
              <div className="mb-2 text-sm font-medium text-slate-700">
                Disciplinas dessa turma
              </div>

              {loadingSubjects || loadingClasses ? (
                <div className="text-sm text-slate-500">Carregando...</div>
              ) : subjects.length === 0 ? (
                <div className="text-sm text-slate-500">
                  Cadastre pelo menos uma disciplina antes.
                </div>
              ) : (
                <div className="space-y-2">
                  {subjects.map((subject) => {
                    const checked = selectedSubjectIds.includes(subject.id);

                    return (
                      <label
                        key={subject.id}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSubject(subject.id)}
                          className="h-4 w-4"
                        />
                        <span>{subject.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={saveClassSubjects}
                disabled={savingLinks || !selectedClassId}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingLinks ? "Salvando..." : "Salvar disciplinas da turma"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}