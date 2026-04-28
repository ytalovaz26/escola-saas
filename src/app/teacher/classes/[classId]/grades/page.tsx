"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SubjectItem = {
  id: string;
  name: string;
};

type StudentItem = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

type GridResponse = {
  ok: boolean;
  classId: string;
  term: string;
  subjects: SubjectItem[];
  roster: StudentItem[];
  gradesMatrix: Record<string, Record<string, number>>;
  error?: string;
};

type GridRow = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
  grades: Record<string, string>;
};

function classIdLabel(classId: string) {
  return classId || "Turma";
}

function normalizeScoreInput(value: string) {
  return value.replace(",", ".");
}

export default function TeacherClassGradesPage() {
  const params = useParams<{ classId: string }>();
  const router = useRouter();

  const classId = String(params?.classId || "").trim();

  const [term, setTerm] = useState("1º Bimestre");

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  const hasRows = rows.length > 0;
  const hasSubjects = subjects.length > 0;

  const payloadItems = useMemo(() => {
    return rows.map((row) => ({
      student_id: row.student_id,
      grades: Object.fromEntries(
        subjects.map((subject) => [
          subject.id,
          normalizeScoreInput(row.grades[subject.id] ?? "").trim(),
        ])
      ),
    }));
  }, [rows, subjects]);

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

  async function loadGrid() {
    setLoading(true);
    setPageError("");
    setPageSuccess("");

    try {
      if (!classId) {
        throw new Error("Turma não identificada na rota.");
      }

      if (!term.trim()) {
        throw new Error("Informe a etapa/período.");
      }

      const token = await getAccessToken();

      const res = await fetch(
        `/api/teacher/grades/grid?classId=${encodeURIComponent(classId)}&term=${encodeURIComponent(term.trim())}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data = (await res.json()) as GridResponse;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Falha ao carregar grade de notas.");
      }

      const nextSubjects = Array.isArray(data.subjects) ? data.subjects : [];
      const nextRoster = Array.isArray(data.roster) ? data.roster : [];
      const matrix = data.gradesMatrix || {};

      const nextRows: GridRow[] = nextRoster.map((student) => {
        const studentGrades = matrix[String(student.student_id)] || {};

        const rowGrades: Record<string, string> = {};
        for (const subject of nextSubjects) {
          const existing = studentGrades[subject.id];
          rowGrades[subject.id] =
            existing !== undefined &&
            existing !== null &&
            Number.isFinite(Number(existing))
              ? String(existing)
              : "";
        }

        return {
          student_id: String(student.student_id),
          full_name: student.full_name ?? "",
          registration_number: student.registration_number ?? "",
          grades: rowGrades,
        };
      });

      setSubjects(nextSubjects);
      setRows(nextRows);

      if (nextSubjects.length === 0) {
        setPageSuccess("Esta turma ainda não possui disciplinas vinculadas.");
      } else if (nextRows.length === 0) {
        setPageSuccess("Nenhum aluno encontrado para esta turma.");
      } else {
        setPageSuccess("Grade de notas carregada com sucesso.");
      }
    } catch (err: any) {
      setSubjects([]);
      setRows([]);
      setPageError(err?.message || "Erro ao carregar grade.");
    } finally {
      setLoading(false);
    }
  }

  async function saveGrid() {
    setSaving(true);
    setPageError("");
    setPageSuccess("");

    try {
      if (!classId) {
        throw new Error("Turma não identificada.");
      }

      if (!term.trim()) {
        throw new Error("Informe a etapa/período.");
      }

      if (!hasSubjects) {
        throw new Error("Esta turma não possui disciplinas vinculadas.");
      }

      if (!hasRows) {
        throw new Error("Nenhum aluno encontrado para salvar.");
      }

      const token = await getAccessToken();

      const res = await fetch("/api/teacher/grades/save-grid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId,
          term: term.trim(),
          items: payloadItems,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao salvar grade de notas.");
      }

      setPageSuccess("Notas salvas com sucesso.");
      await loadGrid();
    } catch (err: any) {
      setPageError(err?.message || "Erro ao salvar grade.");
    } finally {
      setSaving(false);
    }
  }

  async function openReport(studentId: string) {
    try {
      setPageError("");

      if (!classId) {
        throw new Error("Turma não identificada.");
      }

      if (!term.trim()) {
        throw new Error("Informe a etapa/período antes de gerar o boletim.");
      }

      const token = await getAccessToken();

      const url =
        `/api/teacher/grades/report?classId=${encodeURIComponent(classId)}` +
        `&studentId=${encodeURIComponent(studentId)}` +
        `&term=${encodeURIComponent(term.trim())}`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        let message = "Falha ao gerar boletim PDF.";
        try {
          const err = await res.json();
          message = err?.error || message;
        } catch {
          // ignora parse
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      window.open(fileUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(fileUrl), 10000);
    } catch (err: any) {
      setPageError(err?.message || "Erro ao gerar boletim.");
    }
  }

  function updateGrade(studentId: string, subjectId: string, value: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.student_id === studentId
          ? {
              ...row,
              grades: {
                ...row.grades,
                [subjectId]: value,
              },
            }
          : row
      )
    );
  }

  useEffect(() => {
    if (!classId) return;
    loadGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  return (
    <main className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
          Portal do Professor
        </div>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          Lançamento de Notas
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Turma: {classIdLabel(classId)}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push(`/teacher/classes/${classId}`)}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
          >
            Voltar
          </button>

          <button
            type="button"
            onClick={loadGrid}
            disabled={loading}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Carregando..." : "Recarregar"}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Etapa / Período
            </label>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Ex.: 1º Bimestre"
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={loadGrid}
              disabled={loading}
              className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Carregando..." : "Carregar grade"}
            </button>
          </div>
        </div>
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

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Grade de notas</h2>
          <p className="mt-1 text-sm text-slate-500">
            Alunos nas linhas e disciplinas da turma nas colunas.
          </p>
        </div>

        {!hasSubjects && !loading ? (
          <div className="p-6">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">
                Esta turma ainda não possui disciplinas configuradas.
              </div>

              <div className="mt-1 text-sm text-amber-800">
                Para lançar notas em grade, primeiro é preciso cadastrar e
                vincular as disciplinas da turma.
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/school/subjects")}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Gerenciar disciplinas
                </button>

                <button
                  type="button"
                  onClick={() => router.push(`/teacher/classes/${classId}`)}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
                >
                  Voltar para turma
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {hasSubjects && !hasRows && !loading ? (
          <div className="p-6 text-sm text-slate-500">
            Nenhum aluno encontrado nesta turma.
          </div>
        ) : null}

        {hasSubjects && hasRows ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Aluno
                    </th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Matrícula
                    </th>

                    {subjects.map((subject) => (
                      <th
                        key={subject.id}
                        className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {subject.name}
                      </th>
                    ))}

                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Boletim
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.student_id}
                      className="border-t border-slate-200"
                    >
                      <td className="px-5 py-4 text-sm font-medium text-slate-900">
                        {row.full_name || "—"}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {row.registration_number || "—"}
                      </td>

                      {subjects.map((subject) => (
                        <td key={subject.id} className="px-4 py-4">
                          <input
                            inputMode="decimal"
                            value={row.grades[subject.id] ?? ""}
                            onChange={(e) =>
                              updateGrade(
                                row.student_id,
                                subject.id,
                                e.target.value
                              )
                            }
                            placeholder="—"
                            className="w-24 rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                          />
                        </td>
                      ))}

                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => openReport(row.student_id)}
                          className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-4 md:hidden">
              {rows.map((row) => (
                <div
                  key={row.student_id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {row.full_name || "—"}
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    Matrícula: {row.registration_number || "—"}
                  </div>

                  <div className="mt-4 space-y-3">
                    {subjects.map((subject) => (
                      <div key={subject.id}>
                        <label className="mb-1 block text-xs font-medium text-slate-700">
                          {subject.name}
                        </label>
                        <input
                          inputMode="decimal"
                          value={row.grades[subject.id] ?? ""}
                          onChange={(e) =>
                            updateGrade(
                              row.student_id,
                              subject.id,
                              e.target.value
                            )
                          }
                          placeholder="—"
                          className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => openReport(row.student_id)}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm hover:bg-slate-50"
                    >
                      Gerar boletim PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={saveGrid}
          disabled={saving || loading || !hasSubjects || !hasRows}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar notas"}
        </button>
      </div>
    </main>
  );
}