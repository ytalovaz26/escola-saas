"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StaffMe = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
  isPlatformAdmin?: boolean;
  school?: { schoolId: string; role: string };
  parent?: any;
};

type TeacherApi = {
  userId: string;
  fullName: string | null;
  email: string | null;
  createdAt?: string | null;
};

type ClassApi = {
  id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

type AssignmentApi = {
  id: string;
  teacherUserId: string;
  classId: string;
  createdAt: string | null;
  teacherName?: string | null;
  teacherEmail?: string | null;
  className?: string | null;
  grade?: string | null;
  shift?: string | null;
};

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function classLabel(c: ClassApi) {
  const parts = [c.name];
  if (c.grade) parts.push(`Série: ${c.grade}`);
  if (c.shift) parts.push(`Turno: ${c.shift}`);
  return parts.join(" • ");
}

function teacherLabel(t: TeacherApi) {
  const name = t.fullName?.trim() ? t.fullName.trim() : null;
  const email = t.email?.trim() ? t.email.trim() : null;
  if (name && email) return `${name} • ${email}`;
  if (name) return name;
  if (email) return email;
  return t.userId;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR");
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "PR";
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export default function SchoolTeacherClassesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<StaffMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [teachers, setTeachers] = useState<TeacherApi[]>([]);
  const [classes, setClasses] = useState<ClassApi[]>([]);
  const [assignments, setAssignments] = useState<AssignmentApi[]>([]);

  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const canManage = useMemo(() => {
    const r = normRole(me?.school?.role);
    return r === "diretor" || r === "director" || r === "coordenador" || r === "coordinator";
  }, [me?.school?.role]);

  async function getTokenOrRedirect() {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) throw new Error(sessErr.message);

    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function reloadAssignments(token: string) {
    const aRes = await fetch("/api/school/teacher-classes/list", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const aJson = await aRes.json().catch(() => null);

    if (!aRes.ok || !aJson?.ok) {
      throw new Error(aJson?.error || "Falha ao carregar vínculos professor↔️turma.");
    }

    setAssignments((aJson.assignments ?? []) as AssignmentApi[]);
  }

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const meJson = (await meRes.json().catch(() => null)) as StaffMe | null;

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão (/api/me).");
        return;
      }

      if (meJson.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const role = normRole(meJson?.school?.role);
      const schoolId = meJson?.school?.schoolId;

      if (!schoolId) {
        setError("Seu usuário não tem schoolId. (Você está logado como parent ou sem vínculo staff.)");
        return;
      }

      const allowed =
        role === "diretor" ||
        role === "director" ||
        role === "coordenador" ||
        role === "coordinator";

      if (!allowed) {
        router.replace(meJson?.redirectTo || "/login");
        return;
      }

      setMe(meJson);

      const tRes = await fetch("/api/school/teachers/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const tJson = await tRes.json().catch(() => null);

      if (!tRes.ok || !tJson?.ok) throw new Error(tJson?.error || "Falha ao carregar professores.");

      const tList = (tJson.teachers ?? []) as TeacherApi[];
      setTeachers(tList);

      const cRes = await fetch("/api/school/classes/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const cJson = await cRes.json().catch(() => null);

      if (!cRes.ok || !cJson?.ok) throw new Error(cJson?.error || "Falha ao carregar turmas.");

      const cList = (cJson.classes ?? []) as ClassApi[];
      setClasses(cList);

      await reloadAssignments(token);

      if (!selectedTeacherId && tList[0]?.userId) setSelectedTeacherId(tList[0].userId);
      if (!selectedClassId && cList[0]?.id) setSelectedClassId(cList[0].id);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar dados.");
      setTeachers([]);
      setClasses([]);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignmentsByTeacher = useMemo(() => {
    const map = new Map<string, AssignmentApi[]>();
    for (const a of assignments) {
      const arr = map.get(a.teacherUserId) ?? [];
      arr.push(a);
      map.set(a.teacherUserId, arr);
    }
    return map;
  }, [assignments]);

  const classById = useMemo(() => {
    const m = new Map<string, ClassApi>();
    for (const c of classes) m.set(c.id, c);
    return m;
  }, [classes]);

  async function handleAssign() {
    if (!selectedTeacherId) return alert("Selecione um professor.");
    if (!selectedClassId) return alert("Selecione uma turma.");

    const key = `assign:${selectedTeacherId}:${selectedClassId}`;
    try {
      setBusyKey(key);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/school/teacher-classes/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teacher_user_id: selectedTeacherId,
          class_id: selectedClassId,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        alert(json?.error || "Falha ao vincular professor à turma.");
        return;
      }

      await reloadAssignments(token);
      alert("Vínculo criado ✅");
    } catch (e: any) {
      alert(e?.message || "Erro inesperado");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUnassign(assignmentId: string) {
    const ok = confirm("Confirma desvincular este vínculo?");
    if (!ok) return;

    const key = `unassign:${assignmentId}`;
    try {
      setBusyKey(key);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/school/teacher-classes/unassign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: assignmentId }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        alert(json?.error || "Falha ao desvincular.");
        return;
      }

      await reloadAssignments(token);
      alert("Desvinculado ✅");
    } catch (e: any) {
      alert(e?.message || "Erro inesperado");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-[60vh]">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="h-8 w-64 rounded bg-slate-200" />
            <div className="mt-3 h-4 w-96 rounded bg-slate-100" />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="h-36 rounded-[28px] bg-slate-100" />
            <div className="h-36 rounded-[28px] bg-slate-100" />
            <div className="h-36 rounded-[28px] bg-slate-100" />
          </div>
          <div className="h-96 rounded-[28px] bg-slate-100" />
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
                  Vínculo Professor ↔️ Turmas
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Defina com clareza quais turmas cada professor atende e mantenha o painel docente correto.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-wide text-slate-300">
                    Role
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">
                    {me?.school?.role ?? "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-wide text-slate-300">
                    Escola
                  </div>
                  <div className="mt-1 break-all text-sm font-medium text-white">
                    {me?.school?.schoolId ?? "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 shadow-sm">
            {error}
          </div>
        )}

        {!canManage ? (
          <section className="rounded-[28px] border border-amber-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Acesso restrito</h2>
            <p className="mt-2 text-sm text-slate-600">
              Você não tem permissão para vincular professores às turmas.
            </p>
          </section>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Professores
                </div>
                <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                  {teachers.length}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  Total de professores disponíveis para vínculo.
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Turmas
                </div>
                <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                  {classes.length}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  Total de turmas cadastradas para atribuição.
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Vínculos ativos
                </div>
                <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                  {assignments.length}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    onClick={() => router.push("/school")}
                  >
                    Painel
                  </button>

                  <button
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    onClick={loadAll}
                  >
                    Atualizar
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Criar vínculo</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    O professor verá somente as turmas vinculadas no painel dele.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  teacher_classes ativo
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Professor
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                    value={selectedTeacherId}
                    onChange={(e) => setSelectedTeacherId(e.target.value)}
                  >
                    {teachers.length === 0 ? (
                      <option value="">Cadastre professores primeiro</option>
                    ) : (
                      teachers.map((t) => (
                        <option key={t.userId} value={t.userId}>
                          {teacherLabel(t)}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Turma
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                  >
                    {classes.length === 0 ? (
                      <option value="">Cadastre turmas primeiro</option>
                    ) : (
                      classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {classLabel(c)}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  O vínculo afeta diretamente o acesso do professor às turmas e aos lançamentos.
                </p>

                <button
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                  onClick={handleAssign}
                  disabled={!selectedTeacherId || !selectedClassId || busyKey?.startsWith("assign:")}
                >
                  {busyKey?.startsWith("assign:") ? "Vinculando..." : "Vincular professor"}
                </button>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Vínculos atuais</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Visualize por professor todas as turmas atribuídas atualmente.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {assignments.length} vínculo(s)
                </div>
              </div>

              {teachers.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nenhum professor cadastrado.</p>
              ) : (
                <div className="mt-5 space-y-4">
                  {teachers.map((t) => {
                    const tAssign = assignmentsByTeacher.get(t.userId) ?? [];

                    return (
                      <div
                        key={t.userId}
                        className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-semibold text-slate-700 shadow-sm">
                              {getInitials(t.fullName)}
                            </div>

                            <div className="min-w-0">
                              <div className="text-base font-semibold text-slate-900">
                                {t.fullName || "Professor sem nome"}
                              </div>
                              <div className="mt-1 break-all text-sm text-slate-500">
                                {t.email || "Sem e-mail"}
                              </div>
                              <div className="mt-1 break-all font-mono text-xs text-slate-400">
                                {t.userId}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                            {tAssign.length} turma(s)
                          </div>
                        </div>

                        {tAssign.length === 0 ? (
                          <p className="mt-4 text-sm text-slate-500">Sem turmas vinculadas.</p>
                        ) : (
                          <div className="mt-4 grid grid-cols-1 gap-3">
                            {tAssign.map((a) => {
                              const c = classById.get(a.classId);
                              const key = `unassign:${a.id}`;
                              const busy = busyKey === key;

                              return (
                                <div
                                  key={a.id}
                                  className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-900">
                                      {c ? c.name : a.classId}
                                    </div>
                                    <div className="mt-1 text-sm text-slate-500">
                                      {c ? classLabel(c) : "Turma não encontrada."}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-400">
                                      Vinculado em: {formatDateTime(a.createdAt)}
                                    </div>
                                  </div>

                                  <button
                                    className="rounded-2xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                                    disabled={busy}
                                    onClick={() => handleUnassign(a.id)}
                                    title="Desvincular"
                                  >
                                    {busy ? "Desvinculando..." : "Desvincular"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}