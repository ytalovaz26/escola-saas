"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ClassItem = {
  id: string;
  name: string | null;
  grade: string | null;
  shift: string | null;
};

type StudentItem = {
  id: string;
  full_name: string | null;
  registration_number: string | null;
};

function classLabel(c: ClassItem) {
  const parts: string[] = [];
  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(`Série: ${c.grade}`);
  if (c.shift) parts.push(`Turno: ${c.shift}`);
  return parts.join(" • ") || c.id;
}

function safeArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

export default function SchoolReportCardsPage() {
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [term, setTerm] = useState("1º Bimestre");

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

  async function loadClasses() {
    setLoadingClasses(true);
    setPageError("");

    try {
      const token = await getAccessToken();

      const res = await fetch("/api/school/report-cards/classes", {
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
      setClasses([]);
      setPageError(e?.message || "Erro ao carregar turmas.");
    } finally {
      setLoadingClasses(false);
    }
  }

  async function loadStudents(classId: string) {
    if (!classId) {
      setStudents([]);
      setSelectedStudentId("");
      return;
    }

    setLoadingStudents(true);
    setPageError("");
    setPageSuccess("");

    try {
      const token = await getAccessToken();

      const res = await fetch(
        `/api/school/report-cards/students?classId=${encodeURIComponent(classId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao carregar alunos.");
      }

      const nextStudents = safeArray<StudentItem>(json.students);
      setStudents(nextStudents);

      if (nextStudents.length > 0) {
        setSelectedStudentId(String(nextStudents[0].id));
      } else {
        setSelectedStudentId("");
      }
    } catch (e: any) {
      setStudents([]);
      setSelectedStudentId("");
      setPageError(e?.message || "Erro ao carregar alunos.");
    } finally {
      setLoadingStudents(false);
    }
  }

  async function openPdf() {
    try {
      setPageError("");
      setPageSuccess("");

      if (!selectedClassId) {
        throw new Error("Selecione uma turma.");
      }

      if (!selectedStudentId) {
        throw new Error("Selecione um aluno.");
      }

      if (!term.trim()) {
        throw new Error("Informe o período.");
      }

      const token = await getAccessToken();

      const url =
        `/api/school/report-cards/pdf?classId=${encodeURIComponent(selectedClassId)}` +
        `&studentId=${encodeURIComponent(selectedStudentId)}` +
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
        } catch {}
        throw new Error(message);
      }

      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      window.open(fileUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(fileUrl), 10000);
      setPageSuccess("Boletim PDF gerado com sucesso.");
    } catch (e: any) {
      setPageError(e?.message || "Erro ao gerar boletim PDF.");
    }
  }

  useEffect(() => {
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedClassId) return;
    loadStudents(selectedClassId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  return (
    <main className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
          Gestão Escolar • Boletins
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
          Boletins Bimestrais
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Gere o boletim PDF de qualquer aluno por turma e período.
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

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
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

              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {classLabel(item)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Aluno
            </label>
            <select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              disabled={loadingStudents || students.length === 0}
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            >
              {students.length === 0 ? (
                <option value="">Nenhum aluno encontrado</option>
              ) : null}

              {students.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name || item.id}
                  {item.registration_number ? ` • Matrícula: ${item.registration_number}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Período
            </label>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Ex.: 1º Bimestre"
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {selectedClass ? (
            <>
              Turma selecionada: <span className="font-medium">{classLabel(selectedClass)}</span>
            </>
          ) : (
            <>Selecione uma turma.</>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              if (selectedClassId) loadStudents(selectedClassId);
            }}
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Recarregar alunos
          </button>

          <button
            type="button"
            onClick={openPdf}
            disabled={!selectedClassId || !selectedStudentId}
            className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Gerar boletim PDF
          </button>
        </div>
      </section>
    </main>
  );
}