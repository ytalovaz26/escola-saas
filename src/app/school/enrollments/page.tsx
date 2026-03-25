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

  // UI: adicionar aluno
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const classById = useMemo(() => {
    const m = new Map<string, ClassRow>();
    for (const c of classes) m.set(c.id, c);
    return m;
  }, [classes]);

  const enrollmentByStudentId = useMemo(() => {
    const m = new Map<string, EnrollmentRow>();
    for (const e of enrollments) m.set(e.student_id, e);
    return m;
  }, [enrollments]);

  const filteredStudentsForAdd = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();

    // não sugerir quem já está ativo nessa turma
    const activeStudentIds = new Set(enrollments.map((e) => e.student_id));

    let list = students.filter((s) => !activeStudentIds.has(s.id));

    if (q) {
      list = list.filter((s) => s.full_name.toLowerCase().includes(q));
    }

    // limita para não ficar pesado
    return list.slice(0, 30);
  }, [students, enrollments, studentQuery]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const token = await getAccessToken();
        if (!token) {
          router.replace("/login");
          return;
        }

        // valida perfil/role via /api/me
        const meRes = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const meJson = await safeJson(meRes);

        if (!meRes.ok || !meJson?.ok) {
          setError(meJson?.error || "Falha ao validar sessão/perfil.");
          if (meRes.status === 401 || meRes.status === 403) router.replace("/login");
          return;
        }

        const payload = meJson as MePayload;

        if (payload.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        const role = payload.school?.role;
        if (role !== "diretor" && role !== "coordenador") {
          router.replace("/school");
          return;
        }

        const sid = payload.school?.schoolId;
        if (!sid) {
          setError("Usuário sem escola vinculada.");
          return;
        }
        setSchoolId(sid);

        // carrega turmas + alunos
        await Promise.all([loadClasses(token), loadStudents(token)]);

        // se vier classId por URL (ex: /school/enrollments?classId=xxx)
        const fromUrl = searchParams.get("classId");
        if (fromUrl) {
          setSelectedClassId(fromUrl);
        }
      } catch (e: any) {
        setError(e?.message || "Erro inesperado.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // quando selecionar turma, carrega matrículas ativas
  useEffect(() => {
    (async () => {
      if (!selectedClassId) return;
      const token = await getAccessToken();
      if (!token) return;
      await loadEnrollments(token, selectedClassId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  async function loadClasses(token: string) {
    const res = await fetch("/api/school/classes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar turmas.");
      return;
    }

    const list = (json.classes ?? []) as ClassRow[];
    setClasses(list);

    // se ainda não tiver selecionada, escolhe a primeira
    if (!selectedClassId && list[0]?.id) setSelectedClassId(list[0].id);
    if (list.length === 0) setSelectedClassId("");
  }

  async function loadStudents(token: string) {
    const res = await fetch("/api/school/students", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar alunos.");
      return;
    }

    setStudents((json.students ?? []) as StudentRow[]);
  }

  async function loadEnrollments(token: string, classId: string) {
    setError(null);

    const res = await fetch(`/api/school/enrollments?classId=${encodeURIComponent(classId)}&active=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar matrículas.");
      return;
    }

    setEnrollments((json.enrollments ?? []) as EnrollmentRow[]);
  }

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
          mode: "rpc", // tenta rpc e faz fallback
        }),
      });

      const json = await safeJson(res);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao matricular aluno.");
        return;
      }

      setSelectedStudentId("");
      setStudentQuery("");

      await loadEnrollments(token, classId);
    } finally {
      setSaving(false);
    }
  }

  async function removeEnrollment(enrollmentId: string) {
    if (!selectedClassId) return;

    const ok = confirm("Remover aluno desta turma? (isso encerra o vínculo e mantém histórico)");
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

    const from = classById.get(selectedClassId)?.name || "Turma atual";
    const to = classById.get(newClassId)?.name || "Nova turma";

    const ok = confirm(`Trocar turma ativa deste aluno?\n\nDe: ${from}\nPara: ${to}\n\nIsso fica no histórico.`);
    if (!ok) return;

    await enrollStudent(studentId, newClassId);

    // se moveu pra outra turma, e estamos vendo a turma antiga, o aluno some da lista (correto).
    // recarrega lista atual
    const token = await getAccessToken();
    if (token) await loadEnrollments(token, selectedClassId);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-semibold">Erro</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
          <button
            onClick={() => router.push("/school")}
            className="mt-4 w-full rounded-xl bg-gray-900 text-white p-3"
          >
            Voltar ao painel
          </button>
        </div>
      </main>
    );
  }

  const selectedClass = classById.get(selectedClassId || "");

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Matrículas (Aluno ↔ Turma)</h1>
            <p className="text-sm text-gray-600 mt-1">
              Escola: <span className="font-mono text-xs">{schoolId}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => router.push("/school")} className="rounded-xl border px-4 py-2">
              Painel
            </button>
            <button onClick={logout} className="rounded-xl bg-gray-900 text-white px-4 py-2">
              Sair
            </button>
          </div>
        </header>

        {/* Selecionar Turma */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Turma</h2>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <div className="text-xs text-gray-600 mb-1">Selecionar turma</div>
              <select
                className="border rounded-xl p-3 w-full"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={classes.length === 0}
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
              <div className="text-xs text-gray-600 mb-1">Matriculados (ativos)</div>
              <div className="border rounded-xl p-3 text-sm bg-gray-50">
                {selectedClassId ? enrollments.length : "—"}
              </div>
            </div>
          </div>

          {!selectedClassId && (
            <p className="text-xs text-red-600 mt-2">Você precisa criar e selecionar uma turma.</p>
          )}
        </section>

        {/* Adicionar aluno */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Adicionar aluno na turma</h2>
          <p className="text-xs text-gray-500 mt-1">
            Isso ativa vínculo em <span className="font-mono">student_classes</span> e mantém histórico.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <div className="text-xs text-gray-600 mb-1">Buscar aluno por nome</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Digite parte do nome (ex: João)"
                value={studentQuery}
                onChange={(e) => {
                  setStudentQuery(e.target.value);
                  setSelectedStudentId("");
                }}
                disabled={!selectedClassId || saving}
              />
              {studentQuery.trim().length > 0 && filteredStudentsForAdd.length > 0 && (
                <div className="mt-2 border rounded-xl overflow-hidden">
                  {filteredStudentsForAdd.map((s) => (
                    <button
                      key={s.id}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        selectedStudentId === s.id ? "bg-gray-50" : "bg-white"
                      }`}
                      onClick={() => setSelectedStudentId(s.id)}
                      type="button"
                    >
                      <div className="font-medium">{s.full_name}</div>
                      <div className="text-xs text-gray-500">
                        {s.registration_number ? `Matrícula: ${s.registration_number}` : "Matrícula: —"} •{" "}
                        <span className="font-mono">{s.id}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {studentQuery.trim().length > 0 && filteredStudentsForAdd.length === 0 && (
                <div className="mt-2 text-xs text-gray-500">Nenhum aluno disponível para adicionar.</div>
              )}
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Ação</div>
              <button
                className="rounded-xl bg-gray-900 text-white px-4 py-3 w-full disabled:opacity-60"
                disabled={!selectedClassId || !selectedStudentId || saving}
                onClick={() => enrollStudent(selectedStudentId, selectedClassId)}
              >
                {saving ? "Salvando..." : "Matricular na turma"}
              </button>

              <div className="mt-2 text-xs text-gray-500">
                Turma selecionada:{" "}
                <span className="font-medium">{selectedClass?.name ?? "—"}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Lista matriculados */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Alunos matriculados (ativos)</h2>
              <p className="text-xs text-gray-500 mt-1">
                Remover encerra vínculo (não apaga histórico). Trocar turma cria novo vínculo ativo e encerra o anterior.
              </p>
            </div>

            <button
              className="rounded-xl border px-4 py-2 text-sm"
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

          {!selectedClassId ? (
            <p className="text-sm text-gray-600 mt-4">Selecione uma turma para ver as matrículas.</p>
          ) : enrollments.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">Nenhum aluno matriculado nesta turma.</p>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Aluno</th>
                    <th className="py-2">Matrícula</th>
                    <th className="py-2">Início</th>
                    <th className="py-2">Trocar turma</th>
                    <th className="py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((e) => {
                    const st = e.students;
                    const displayName = st?.full_name || e.student_id;
                    const reg = st?.registration_number || "—";

                    return (
                      <tr key={e.id} className="border-b">
                        <td className="py-2">
                          <div className="font-medium">{displayName}</div>
                          <div className="text-xs text-gray-500 font-mono">{e.student_id}</div>
                        </td>
                        <td className="py-2">{reg}</td>
                        <td className="py-2">{e.started_at || "—"}</td>
                        <td className="py-2">
                          <select
                            className="border rounded-xl p-2"
                            value={enrollmentByStudentId.get(e.student_id)?.class_id || selectedClassId}
                            onChange={(ev) => moveStudentToClass(e.student_id, ev.target.value)}
                            disabled={saving || classes.length === 0}
                          >
                            {classes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2">
                          <button
                            className="rounded-xl border px-3 py-2 text-sm disabled:opacity-60"
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
          )}
        </section>
      </div>
    </main>
  );
}