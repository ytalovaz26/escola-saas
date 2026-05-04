"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
};

type ClassRow = {
  id: string;
  school_id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

type StudentRow = {
  id: string;
  school_id: string;
  full_name: string;
  birth_date: string | null;
  registration_number: string | null;
  created_at: string;
};

type EnrollmentRow = {
  id: string;
  student_id: string;
  class_id: string;
  school_id: string;
  is_active: boolean;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  students?: {
    id: string;
    full_name: string;
    registration_number: string | null;
    birth_date: string | null;
    created_at: string;
  } | null;
};

async function getAccessToken() {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token || null;
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

function formatDateBR(value?: string | null) {
  if (!value) return "—";

  const [y, m, d] = String(value).split("-");

  if (!y || !m || !d) return value;

  return `${d}/${m}/${y}`;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function roleCanManage(role: string | null | undefined) {
  const r = normalizeText(role);

  return (
    r === "diretor" ||
    r === "director" ||
    r === "coordenador" ||
    r === "coordinator"
  );
}

export default function EnrollmentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const classById = useMemo(() => {
    const m = new Map<string, ClassRow>();

    for (const c of classes) {
      m.set(c.id, c);
    }

    return m;
  }, [classes]);

  const enrollmentByStudentId = useMemo(() => {
    const m = new Map<string, EnrollmentRow>();

    for (const e of enrollments) {
      m.set(e.student_id, e);
    }

    return m;
  }, [enrollments]);

  const selectedClass = useMemo(() => {
    return classById.get(selectedClassId || "") || null;
  }, [classById, selectedClassId]);

  const queryNormalized = useMemo(() => {
    return normalizeText(studentQuery);
  }, [studentQuery]);

  const matchedStudents = useMemo(() => {
    if (!queryNormalized) return [];

    return students
      .filter((s) => {
        const name = normalizeText(s.full_name);
        const reg = normalizeText(s.registration_number);

        return name.includes(queryNormalized) || reg.includes(queryNormalized);
      })
      .slice(0, 50);
  }, [students, queryNormalized]);

  const availableStudentsForAdd = useMemo(() => {
    const activeStudentIds = new Set(enrollments.map((e) => e.student_id));

    return matchedStudents.filter((s) => !activeStudentIds.has(s.id)).slice(0, 30);
  }, [matchedStudents, enrollments]);

  const alreadyEnrolledMatches = useMemo(() => {
    const activeStudentIds = new Set(enrollments.map((e) => e.student_id));

    return matchedStudents.filter((s) => activeStudentIds.has(s.id)).slice(0, 30);
  }, [matchedStudents, enrollments]);

  const selectedStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) || null;
  }, [students, selectedStudentId]);

  async function loadClasses(token: string) {
    const res = await fetch("/api/school/classes", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar turmas.");
      return;
    }

    const list = (json.classes ?? []) as ClassRow[];

    setClasses(list);

    const fromUrl = searchParams.get("classId");

    if (fromUrl && list.some((c) => c.id === fromUrl)) {
      setSelectedClassId(fromUrl);
      return;
    }

    if (!selectedClassId && list[0]?.id) {
      setSelectedClassId(list[0].id);
    }

    if (list.length === 0) {
      setSelectedClassId("");
    }
  }

  async function loadStudents(token: string) {
    const res = await fetch("/api/school/students", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar alunos.");
      return;
    }

    const list = ((json.students ?? []) as StudentRow[]).sort((a, b) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
    );

    setStudents(list);
  }

  async function loadEnrollments(token: string, classId: string) {
    setError(null);

    const res = await fetch(
      `/api/school/enrollments?classId=${encodeURIComponent(classId)}&active=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar matrículas.");
      return;
    }

    setEnrollments((json.enrollments ?? []) as EnrollmentRow[]);
  }

  async function loadPage() {
    try {
      setError(null);
      setLoading(true);

      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const meRes = await fetch("/api/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meJson = await safeJson(meRes);

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão/perfil.");

        if (meRes.status === 401 || meRes.status === 403) {
          router.replace("/login");
        }

        return;
      }

      const payload = meJson as MePayload;

      if (payload.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const role = payload.school?.role;

      if (!roleCanManage(role)) {
        router.replace("/school");
        return;
      }

      const sid = payload.school?.schoolId;

      if (!sid) {
        setError("Usuário sem escola vinculada.");
        return;
      }

      setSchoolId(sid);

      await Promise.all([loadClasses(token), loadStudents(token)]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedClassId) return;

      const token = await getAccessToken();

      if (!token) return;

      setSelectedStudentId("");
      setStudentQuery("");

      await loadEnrollments(token, selectedClassId);
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  async function enrollStudent(studentId: string, classId: string) {
    setError(null);

    const token = await getAccessToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      setSaving(true);

      const res = await fetch("/api/school/enrollments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          studentId,
          classId,
          mode: "rpc",
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao matricular aluno.");
        return;
      }

      setSelectedStudentId("");
      setStudentQuery("");

      await Promise.all([loadStudents(token), loadEnrollments(token, classId)]);
    } finally {
      setSaving(false);
    }
  }

  async function removeEnrollment(enrollmentId: string) {
    if (!selectedClassId) return;

    const ok = confirm(
      "Remover aluno desta turma? Isso encerra o vínculo e mantém o histórico."
    );

    if (!ok) return;

    setError(null);

    const token = await getAccessToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      setSaving(true);

      const res = await fetch(`/api/school/enrollments/${enrollmentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao remover matrícula.");
        return;
      }

      await loadEnrollments(token, selectedClassId);
    } finally {
      setSaving(false);
    }
  }

  async function moveStudentToClass(studentId: string, newClassId: string) {
    if (!selectedClassId) return;
    if (!newClassId) return;
    if (newClassId === selectedClassId) return;

    const from = classById.get(selectedClassId)?.name || "Turma atual";
    const to = classById.get(newClassId)?.name || "Nova turma";

    const ok = confirm(
      `Trocar turma ativa deste aluno?\n\nDe: ${from}\nPara: ${to}\n\nIsso fica no histórico.`
    );

    if (!ok) return;

    await enrollStudent(studentId, newClassId);

    const token = await getAccessToken();

    if (token) {
      await loadEnrollments(token, selectedClassId);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="min-h-[60vh]">
        <div className="mx-auto max-w-7xl">
          <div className="animate-pulse space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="h-8 w-72 rounded bg-slate-200" />
              <div className="mt-3 h-4 w-96 rounded bg-slate-100" />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="h-40 rounded-[28px] bg-slate-100" />
              <div className="h-40 rounded-[28px] bg-slate-100" />
              <div className="h-40 rounded-[28px] bg-slate-100" />
            </div>

            <div className="h-96 rounded-[28px] bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-[70vh]">
        <div className="mx-auto flex max-w-xl items-center justify-center">
          <div className="w-full rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">
              Não foi possível carregar
            </h1>

            <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
              >
                Voltar ao painel
              </button>

              <button
                onClick={logout}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[60vh]">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Gestão Acadêmica
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Matrículas
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Controle o vínculo aluno ↔ turma com segurança, histórico e operação
                  centralizada.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-wide text-slate-300">
                    Escola vinculada
                  </div>

                  <div className="mt-1 break-all text-sm font-medium text-white">
                    {schoolId || "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-wide text-slate-300">
                    Turma atual
                  </div>

                  <div className="mt-1 text-sm font-medium text-white">
                    {selectedClass?.name || "Selecione uma turma"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Turma selecionada
            </div>

            <div className="mt-3 text-lg font-semibold text-slate-900">
              {selectedClass?.name || "—"}
            </div>

            <div className="mt-2 text-sm text-slate-500">
              {selectedClass
                ? `${selectedClass.grade || "Sem série"} • ${
                    selectedClass.shift || "Sem turno"
                  }`
                : "Escolha uma turma para começar."}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Matrículas ativas
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {selectedClassId ? enrollments.length : 0}
            </div>

            <div className="mt-2 text-sm text-slate-500">
              Quantidade de alunos com vínculo ativo nesta turma.
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ação rápida
            </div>

            <div className="mt-3 text-sm text-slate-600">
              Selecione a turma, pesquise o aluno e faça a matrícula com histórico
              preservado.
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => router.push("/school")}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Painel
              </button>

              <button
                onClick={logout}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Sair
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Turma</h2>

              <p className="mt-1 text-sm text-slate-500">
                Escolha a turma para visualizar e gerenciar as matrículas ativas.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Selecionar turma
              </label>

              <select
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={classes.length === 0 || saving}
              >
                {classes.length === 0 ? (
                  <option value="">Crie uma turma primeiro</option>
                ) : (
                  classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.grade ? ` • ${c.grade}` : ""}
                      {c.shift ? ` • ${c.shift}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Total nesta turma
              </label>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                {selectedClassId ? `${enrollments.length} matriculado(s)` : "—"}
              </div>
            </div>
          </div>

          {!selectedClassId ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Você precisa criar e selecionar uma turma para continuar.
            </div>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Adicionar aluno na turma
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                A busca agora mostra alunos disponíveis e também avisa quando o aluno já
                está matriculado nesta turma.
              </p>
            </div>

            {selectedClass ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="font-medium">Turma:</span> {selectedClass.name}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Buscar aluno por nome ou matrícula
              </label>

              <input
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                placeholder="Digite parte do nome ou número de matrícula"
                value={studentQuery}
                onChange={(e) => {
                  setStudentQuery(e.target.value);
                  setSelectedStudentId("");
                }}
                disabled={!selectedClassId || saving}
              />

              {queryNormalized && availableStudentsForAdd.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Alunos disponíveis para adicionar
                  </div>

                  <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                    {availableStudentsForAdd.map((s) => (
                      <button
                        key={s.id}
                        className={[
                          "w-full px-4 py-3 text-left transition hover:bg-slate-50",
                          selectedStudentId === s.id ? "bg-slate-50" : "bg-white",
                        ].join(" ")}
                        onClick={() => setSelectedStudentId(s.id)}
                        type="button"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">
                              {s.full_name}
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              {s.registration_number
                                ? `Matrícula: ${s.registration_number}`
                                : "Matrícula: —"}
                            </div>
                          </div>

                          <div className="truncate text-[11px] text-slate-400 sm:text-right">
                            {s.id}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {queryNormalized && alreadyEnrolledMatches.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
                  <div className="border-b border-emerald-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Já matriculado nesta turma
                  </div>

                  <div className="divide-y divide-emerald-100">
                    {alreadyEnrolledMatches.map((s) => (
                      <div key={s.id} className="px-4 py-3">
                        <div className="font-medium text-emerald-950">{s.full_name}</div>

                        <div className="mt-1 text-xs text-emerald-700">
                          {s.registration_number
                            ? `Matrícula: ${s.registration_number}`
                            : "Matrícula: —"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {queryNormalized &&
              matchedStudents.length === 0 &&
              availableStudentsForAdd.length === 0 &&
              alreadyEnrolledMatches.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Nenhum aluno encontrado com esse nome ou matrícula.
                </div>
              ) : null}

              {queryNormalized &&
              matchedStudents.length > 0 &&
              availableStudentsForAdd.length === 0 &&
              alreadyEnrolledMatches.length > 0 ? (
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  O aluno foi encontrado, mas já está matriculado nesta turma.
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Ação
              </label>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <button
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                  disabled={!selectedClassId || !selectedStudentId || saving}
                  onClick={() => enrollStudent(selectedStudentId, selectedClassId)}
                >
                  {saving ? "Salvando..." : "Matricular na turma"}
                </button>

                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <div>
                    <span className="font-medium text-slate-800">Turma:</span>{" "}
                    {selectedClass?.name ?? "—"}
                  </div>

                  <div>
                    <span className="font-medium text-slate-800">
                      Aluno selecionado:
                    </span>{" "}
                    {selectedStudent?.full_name || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Alunos matriculados ativos
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Remover encerra vínculo. Trocar turma cria novo vínculo ativo e preserva
                  o histórico.
                </p>
              </div>

              <button
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                disabled={!selectedClassId || saving}
                onClick={async () => {
                  const token = await getAccessToken();

                  if (!token || !selectedClassId) return;

                  await loadEnrollments(token, selectedClassId);
                }}
              >
                Atualizar
              </button>
            </div>
          </div>

          {!selectedClassId ? (
            <div className="px-6 py-8 text-sm text-slate-500">
              Selecione uma turma para ver as matrículas.
            </div>
          ) : enrollments.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-500">
              Nenhum aluno matriculado nesta turma.
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-slate-500">
                      <th className="px-6 py-4 font-medium">Aluno</th>
                      <th className="px-6 py-4 font-medium">Matrícula</th>
                      <th className="px-6 py-4 font-medium">Início</th>
                      <th className="px-6 py-4 font-medium">Trocar turma</th>
                      <th className="px-6 py-4 font-medium">Ações</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {enrollments.map((e) => {
                      const st = e.students;
                      const displayName = st?.full_name || e.student_id;
                      const reg = st?.registration_number || "—";

                      return (
                        <tr key={e.id} className="align-middle">
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900">
                              {displayName}
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {e.student_id}
                            </div>
                          </td>

                          <td className="px-6 py-4 text-slate-700">{reg}</td>

                          <td className="px-6 py-4 text-slate-700">
                            {formatDateBR(e.started_at)}
                          </td>

                          <td className="px-6 py-4">
                            <select
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                              value={
                                enrollmentByStudentId.get(e.student_id)?.class_id ||
                                selectedClassId
                              }
                              onChange={(ev) =>
                                moveStudentToClass(e.student_id, ev.target.value)
                              }
                              disabled={saving || classes.length === 0}
                            >
                              {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-6 py-4">
                            <button
                              className="rounded-2xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                              disabled={saving}
                              onClick={() => removeEnrollment(e.id)}
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-4 p-4 lg:hidden">
                {enrollments.map((e) => {
                  const st = e.students;
                  const displayName = st?.full_name || e.student_id;
                  const reg = st?.registration_number || "—";

                  return (
                    <div
                      key={e.id}
                      className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-slate-900">
                            {displayName}
                          </div>

                          <div className="mt-1 break-all text-xs text-slate-400">
                            {e.student_id}
                          </div>
                        </div>

                        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                          Ativo
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400">
                            Matrícula
                          </div>

                          <div className="mt-1 text-sm font-medium text-slate-800">
                            {reg}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400">
                            Início
                          </div>

                          <div className="mt-1 text-sm font-medium text-slate-800">
                            {formatDateBR(e.started_at)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Trocar turma
                        </label>

                        <select
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                          value={
                            enrollmentByStudentId.get(e.student_id)?.class_id ||
                            selectedClassId
                          }
                          onChange={(ev) =>
                            moveStudentToClass(e.student_id, ev.target.value)
                          }
                          disabled={saving || classes.length === 0}
                        >
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        className="mt-4 w-full rounded-2xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                        disabled={saving}
                        onClick={() => removeEnrollment(e.id)}
                      >
                        Remover matrícula
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}