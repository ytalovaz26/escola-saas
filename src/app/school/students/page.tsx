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
  class_id?: string | null; // legacy (mantido por compat)
};

type StudentActiveClassRow = {
  id: string;
  student_id: string;
  class_id: string;
  school_id: string;
  is_active: boolean;
  started_at: string; // no banco é NOT NULL (date)
  ended_at: string | null;
  created_at: string;
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

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [activeLinks, setActiveLinks] = useState<StudentActiveClassRow[]>([]);

  // Form: criar aluno + turma ativa
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [saving, setSaving] = useState(false);

  // filtro por turma (listagem)
  const [filterClassId, setFilterClassId] = useState("");

  const activeClassByStudentId = useMemo(() => {
    const map = new Map<string, StudentActiveClassRow>();
    for (const link of activeLinks) map.set(link.student_id, link);
    return map;
  }, [activeLinks]);

  const classById = useMemo(() => {
    const map = new Map<string, ClassRow>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

  const filteredStudents = useMemo(() => {
    if (!filterClassId) return students;
    return students.filter((s) => {
      const link = activeClassByStudentId.get(s.id);
      return link?.class_id === filterClassId;
    });
  }, [students, filterClassId, activeClassByStudentId]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const token = await getAccessToken();
        if (!token) {
          router.replace("/login");
          return;
        }

        // valida perfil/role via API (fonte de verdade)
        const res = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        const json = await safeJson(res);

        if (!res.ok || !json?.ok) {
          const msg = json?.error || "Falha ao validar sessão/perfil.";
          setError(msg);
          // se for 401/403, manda pro login pra evitar ficar “travado”
          if (res.status === 401 || res.status === 403) router.replace("/login");
          return;
        }

        const payload = json as MePayload;

        if (payload.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        // seu /api/me devolve role pt (diretor/coordenador) — mantém como está
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

        // aplica filtro vindo de /school/classes -> "Ver alunos"
        const classIdFromUrl = searchParams.get("classId");
        if (classIdFromUrl) setFilterClassId(classIdFromUrl);

        // carrega dados (classes/students via API; vínculos via supabase direto)
        await Promise.all([loadClasses(token), loadStudentsAndLinks(sid, token)]);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadClasses(token: string) {
    // Preferimos API para padronizar erro/permissão e reduzir risco de RLS quebrar no client
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

    // se não tem turma selecionada, seleciona a primeira
    if (!selectedClassId && list[0]?.id) setSelectedClassId(list[0].id);
    // se não tem nenhuma turma, limpa seleção
    if (list.length === 0) setSelectedClassId("");
  }

  async function loadStudentsAndLinks(sid: string, token: string) {
    // students via API (padroniza erro)
    const sres = await fetch("/api/school/students", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sjson = await safeJson(sres);

    if (!sres.ok || !sjson?.ok) {
      setError(sjson?.error || "Erro ao carregar alunos.");
      return;
    }

    // vínculos via supabase direto (até criarmos uma rota dedicada)
    const { data: ldata, error: lerror } = await supabase
      .from("student_classes")
      .select("id,student_id,class_id,school_id,is_active,started_at,ended_at,created_at")
      .eq("school_id", sid)
      .eq("is_active", true);

    if (lerror) {
      setError("Erro ao carregar vínculos aluno-turma: " + lerror.message);
      return;
    }

    setStudents((sjson.students ?? []) as StudentRow[]);
    setActiveLinks((ldata ?? []) as StudentActiveClassRow[]);
  }

  async function createStudentWithActiveClass() {
    if (!schoolId) return;
    if (!fullName.trim()) return alert("Informe o nome completo do aluno.");
    if (!selectedClassId) return alert("Selecione a turma do aluno.");

    try {
      setSaving(true);

      // 1) cria aluno (client direto: mantém seu fluxo atual)
      // Obs: se quiser 100% padronizado, depois migramos isso pra /api/school/students POST
      const { data: inserted, error: ierr } = await supabase
        .from("students")
        .insert({
          school_id: schoolId,
          full_name: fullName.trim(),
          birth_date: birthDate.trim() || null,
          registration_number: registrationNumber.trim() || null,
        })
        .select("id")
        .single();

      if (ierr) {
        alert("Erro ao criar aluno: " + ierr.message);
        return;
      }

      const studentId = inserted?.id as string;

      // 2) usa a RPC (OPÇÃO A) para ativar a turma (seguro/atômico)
      const { error: rpcErr } = await supabase.rpc("set_active_class", {
        p_student_id: studentId,
        p_class_id: selectedClassId,
      });

      if (rpcErr) {
        alert(
          "Aluno criado, mas falhou ao matricular na turma (RPC): " +
            rpcErr.message +
            "\n\n(Se isso acontecer, a gente reprocessa pelo botão de matrícula.)"
        );
        return;
      }

      // 3) reload
      setFullName("");
      setBirthDate("");
      setRegistrationNumber("");

      const token = await getAccessToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      await loadStudentsAndLinks(schoolId, token);
    } finally {
      setSaving(false);
    }
  }

  async function changeActiveClass(studentId: string, newClassId: string) {
    if (!schoolId) return;
    if (!newClassId) return;

    const ok = confirm(
      "Tem certeza que deseja trocar a turma ativa deste aluno?\n\nIsso ficará registrado no histórico."
    );
    if (!ok) return;

    try {
      setSaving(true);

      // OPÇÃO A: tudo pela RPC (sem update/insert no client)
      const { error: rpcErr } = await supabase.rpc("set_active_class", {
        p_student_id: studentId,
        p_class_id: newClassId,
      });

      if (rpcErr) {
        alert("Erro ao trocar turma (RPC): " + rpcErr.message);
        return;
      }

      const token = await getAccessToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      await loadStudentsAndLinks(schoolId, token);
    } finally {
      setSaving(false);
    }
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

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Alunos</h1>
            <p className="text-sm text-gray-600 mt-1">
              Escola: <span className="font-mono text-xs">{schoolId}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/school")}
              className="rounded-xl border px-4 py-2"
            >
              Painel
            </button>
            <button
              onClick={logout}
              className="rounded-xl bg-gray-900 text-white px-4 py-2"
            >
              Sair
            </button>
          </div>
        </header>

        {/* Cadastro */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Cadastrar aluno</h2>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">Nome completo *</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: João Pedro da Silva"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Turma *</div>
              <select
                className="border rounded-xl p-3 w-full"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
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
              <div className="text-xs text-gray-600 mb-1">Data de nascimento</div>
              <input
                className="border rounded-xl p-3 w-full"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Matrícula</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: 2026-001"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={createStudentWithActiveClass}
            disabled={saving || classes.length === 0}
            className="mt-4 rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Cadastrar aluno"}
          </button>

          {classes.length === 0 && (
            <p className="text-xs text-red-600 mt-2">
              Você precisa criar pelo menos 1 turma em /school/classes antes de cadastrar alunos.
            </p>
          )}
        </section>

        {/* Lista */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <h2 className="font-semibold">Lista de alunos</h2>
              <p className="text-xs text-gray-500 mt-1">
                Troca de turma usa RPC (Opção A) e mantém histórico automaticamente.
              </p>
            </div>

            <div className="w-full md:w-80">
              <div className="text-xs text-gray-600 mb-1">Filtrar por turma</div>
              <select
                className="border rounded-xl p-3 w-full"
                value={filterClassId}
                onChange={(e) => setFilterClassId(e.target.value)}
              >
                <option value="">Todas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.grade ? ` • ${c.grade}` : ""}
                    {c.shift ? ` • ${c.shift}` : ""}
                  </option>
                ))}
              </select>

              {filterClassId && (
                <button
                  onClick={() => router.replace("/school/students")}
                  className="mt-2 text-xs underline text-gray-600"
                  title="Remove o filtro e volta para todos os alunos"
                >
                  Limpar filtro
                </button>
              )}
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">Nenhum aluno encontrado.</p>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Aluno</th>
                    <th className="py-2">Turma ativa</th>
                    <th className="py-2">Matrícula</th>
                    <th className="py-2">Trocar turma</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => {
                    const link = activeClassByStudentId.get(s.id);
                    const cls = link ? classById.get(link.class_id) : null;

                    return (
                      <tr key={s.id} className="border-b">
                        <td className="py-2">
                          <div className="font-medium">{s.full_name}</div>
                          <div className="text-xs text-gray-500 font-mono">{s.id}</div>
                        </td>
                        <td className="py-2">
                          {cls ? (
                            <div>
                              <div className="font-medium">{cls.name}</div>
                              <div className="text-xs text-gray-500">
                                {cls.grade ?? "—"} • {cls.shift ?? "—"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-500">Sem turma ativa</span>
                          )}
                        </td>
                        <td className="py-2">{s.registration_number ?? "—"}</td>
                        <td className="py-2">
                          <select
                            className="border rounded-xl p-2"
                            value={link?.class_id || ""}
                            onChange={(e) => changeActiveClass(s.id, e.target.value)}
                            disabled={saving || classes.length === 0}
                          >
                            <option value="">(selecionar)</option>
                            {classes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
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