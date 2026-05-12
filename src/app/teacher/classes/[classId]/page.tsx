"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ClassMeta = {
  id: string;
  name: string | null;
  grade: string | null;
  shift: string | null;
};

type StudentRow = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
  photo_url?: string | null;
  photoUrl?: string | null;
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

function initials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function classLabel(c?: ClassMeta | null) {
  if (!c) return "Turma";

  const parts: string[] = [];

  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(`Série: ${c.grade}`);
  if (c.shift) parts.push(`Turno: ${c.shift}`);

  return parts.join(" • ") || c.id;
}

function StudentAvatar({ student }: { student: StudentRow }) {
  const photoUrl = String(student.photo_url || student.photoUrl || "").trim();

  if (photoUrl) {
    return (
      <div className="h-12 w-12 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={student.full_name || "Foto do aluno"}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            const target = event.currentTarget;
            target.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
      {initials(student.full_name)}
    </div>
  );
}

export default function TeacherClassStudentsPage() {
  const router = useRouter();
  const params = useParams<{ classId: string }>();
  const classId = String(params.classId || "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [classMeta, setClassMeta] = useState<ClassMeta | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);

  const totalStudents = useMemo(() => students.length, [students]);

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

    const token = await ensureToken();

    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const [classRes, studentsRes] = await Promise.all([
        fetch(`/api/teacher/classes/${encodeURIComponent(classId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/teacher/class-students?classId=${encodeURIComponent(classId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const classJson = await safeJson(classRes);
      const studentsJson = await safeJson(studentsRes);

      if (!classRes.ok || !classJson?.ok) {
        setError(classJson?.error || "Falha ao carregar dados da turma.");
        setClassMeta(null);
        setStudents([]);
        return;
      }

      if (!studentsRes.ok || !studentsJson?.ok) {
        setError(studentsJson?.error || "Falha ao carregar alunos da turma.");
        setClassMeta(classJson.class ?? null);
        setStudents([]);
        return;
      }

      setClassMeta(classJson.class ?? null);
      setStudents(Array.isArray(studentsJson.students) ? studentsJson.students : []);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar turma.");
      setClassMeta(null);
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  if (loading) {
    return <main className="p-6">Carregando turma...</main>;
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6">
            <h1 className="text-xl font-semibold">Não foi possível carregar</h1>
            <p className="mt-2 text-sm text-slate-600">{error}</p>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => router.push("/teacher/classes")}
                className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
              >
                Voltar
              </button>

              <button
                onClick={load}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            Portal do Professor
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            Alunos da Turma
          </h1>

          <p className="mt-1 text-sm text-slate-500">{classLabel(classMeta)}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={() => router.push("/teacher/classes")}
            >
              Voltar
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
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white"
              onClick={() => router.push(`/teacher/classes/${classId}/attendance`)}
            >
              Chamada
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={() => router.push(`/teacher/classes/${classId}/diary`)}
            >
              Diário pedagógico
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={() => router.push(`/teacher/classes/${classId}/grades`)}
            >
              Notas
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Total de alunos
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-900">
              {totalStudents}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Série
            </div>
            <div className="mt-3 text-sm font-medium text-slate-900">
              {classMeta?.grade || "—"}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Turno
            </div>
            <div className="mt-3 text-sm font-medium text-slate-900">
              {classMeta?.shift || "—"}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Lista de alunos</h2>
            <p className="mt-1 text-sm text-slate-500">
              Relação atual de alunos ativos vinculados a esta turma.
            </p>
          </div>

          {students.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              Nenhum aluno vinculado a esta turma no momento.
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr className="text-left">
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Aluno
                      </th>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Matrícula
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {students.map((student) => (
                      <tr key={student.student_id} className="border-t border-slate-200">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <StudentAvatar student={student} />

                            <div className="font-medium text-slate-900">
                              {student.full_name || "—"}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-slate-600">
                          {student.registration_number || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-4 md:hidden">
                {students.map((student) => (
                  <div
                    key={student.student_id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <StudentAvatar student={student} />

                      <div>
                        <div className="font-medium text-slate-900">
                          {student.full_name || "—"}
                        </div>

                        <div className="text-sm text-slate-500">
                          Matrícula: {student.registration_number || "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}