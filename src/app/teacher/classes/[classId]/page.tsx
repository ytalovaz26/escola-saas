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
  avatar_url?: string | null;
  avatarUrl?: string | null;
  profile_photo_url?: string | null;
  image_url?: string | null;
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

function getStudentPhotoUrl(student: StudentRow) {
  return (
    student.photo_url ||
    student.photoUrl ||
    student.avatar_url ||
    student.avatarUrl ||
    student.profile_photo_url ||
    student.image_url ||
    null
  );
}

function StudentAvatar({ student }: { student: StudentRow }) {
  const photoUrl = getStudentPhotoUrl(student);

  if (photoUrl) {
    return (
      <div className="h-12 w-12 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={`Foto de ${student.full_name || "aluno"}`}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const img = e.currentTarget;
            img.style.display = "none";

            const parent = img.parentElement;
            if (parent) {
              parent.innerHTML = `<div style="height:100%;width:100%;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#334155;font-weight:700;font-size:14px;">${initials(
                student.full_name
              )}</div>`;
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700 shadow-sm">
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
    return (
      <main className="space-y-6">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-72 rounded-xl bg-slate-200" />
            <div className="h-4 w-96 rounded-xl bg-slate-100" />
            <div className="h-40 rounded-[28px] bg-slate-100" />
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">
              Não foi possível carregar
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => router.push("/teacher/classes")}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Voltar
              </button>

              <button
                type="button"
                onClick={load}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
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
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-5 py-7 text-white md:px-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
              Portal do Professor
            </div>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Alunos da Turma
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-200">
              {classLabel(classMeta)}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                onClick={() => router.push("/teacher/classes")}
              >
                Voltar
              </button>

              <button
                type="button"
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                onClick={load}
              >
                Recarregar
              </button>

              <button
                type="button"
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                onClick={() => router.push(`/teacher/classes/${classId}/attendance`)}
              >
                Chamada
              </button>

              <button
                type="button"
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                onClick={() => router.push(`/teacher/classes/${classId}/diary`)}
              >
                Diário pedagógico
              </button>

              <button
                type="button"
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                onClick={() => router.push(`/teacher/classes/${classId}/grades`)}
              >
                Notas
              </button>
            </div>
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
            <h2 className="text-lg font-semibold text-slate-900">
              Lista de alunos
            </h2>

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
                      <tr
                        key={student.student_id}
                        className="border-t border-slate-200 transition hover:bg-slate-50/70"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <StudentAvatar student={student} />

                            <div>
                              <div className="font-medium text-slate-900">
                                {student.full_name || "—"}
                              </div>

                              <div className="mt-1 text-xs text-slate-400">
                                ID:{" "}
                                <span className="font-mono">
                                  {student.student_id}
                                </span>
                              </div>
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
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <StudentAvatar student={student} />

                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">
                          {student.full_name || "—"}
                        </div>

                        <div className="mt-1 text-sm text-slate-500">
                          Matrícula: {student.registration_number || "—"}
                        </div>

                        <div className="mt-1 break-all text-xs text-slate-400">
                          ID: {student.student_id}
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