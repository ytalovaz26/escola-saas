"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type StaffMe = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
  school?: { schoolId: string; role: string };
  parent?: any;
};

type ClassAssignment = {
  assignmentId: string;
  classId: string;
  name: string | null;
  grade: string | null;
  shift: string | null;
};

type TeacherRowApi = {
  userId: string;
  createdAt: string;
  fullName: string | null;
  email: string | null;
  classAssignments: ClassAssignment[];
};

type ClassRow = {
  id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "PR";
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function classLabel(c: ClassRow | ClassAssignment) {
  const parts: string[] = [];
  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(String(c.grade));
  if (c.shift) parts.push(String(c.shift));
  return parts.join(" • ");
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

export default function SchoolTeachersPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<StaffMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [tempPassword, setTempPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [unassigningKey, setUnassigningKey] = useState<string | null>(null);

  const [teachers, setTeachers] = useState<TeacherRowApi[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassByTeacher, setSelectedClassByTeacher] = useState<Record<string, string>>({});

  const canManage = useMemo(() => {
    const role = normRole(me?.school?.role);
    return (
      role === "diretor" ||
      role === "coordenador" ||
      role === "director" ||
      role === "coordinator"
    );
  }, [me]);

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

  async function loadTeachers(token: string) {
    const r = await fetch("/api/school/teachers/list", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const j = await safeJson(r);

    if (!r.ok || !j?.ok) {
      throw new Error(j?.error || "Falha ao carregar professores.");
    }

    setTeachers((j.teachers ?? []) as TeacherRowApi[]);
  }

  async function loadClasses(token: string) {
    const r = await fetch("/api/school/classes", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const j = await safeJson(r);

    if (!r.ok || !j?.ok) {
      throw new Error(j?.error || "Falha ao carregar turmas.");
    }

    setClasses((j.classes ?? []) as ClassRow[]);
  }

  async function loadMeAndTeachers() {
    try {
      setLoading(true);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meJson = (await safeJson(meRes)) as StaffMe | null;
      setMe(meJson);

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão (/api/me).");
        return;
      }

      const role = normRole(meJson?.school?.role);
      const schoolId = meJson?.school?.schoolId;

      if (!schoolId) {
        setError(
          "Seu usuário não tem schoolId no /api/me. (Provável: você está logado sem vínculo staff.)"
        );
        return;
      }

      const allowed =
        role === "diretor" ||
        role === "coordenador" ||
        role === "director" ||
        role === "coordinator";

      if (!allowed) {
        setError(`Acesso negado. Role atual: "${meJson?.school?.role}".`);
        return;
      }

      await Promise.all([loadTeachers(token), loadClasses(token)]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar dados.");
      setTeachers([]);
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeAndTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateTeacher() {
    try {
      setSaving(true);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/school/teachers/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          full_name: fullName,
          temp_password: tempPassword || undefined,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao criar professor.");
        return;
      }

      setEmail("");
      setFullName("");
      setTempPassword("");

      await loadMeAndTeachers();
      alert("Professor criado e vinculado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivateTeacher(userId: string, displayName: string) {
    const ok = confirm(
      `Tem certeza que deseja desativar este professor?\n\n${displayName}\n(${userId})`
    );
    if (!ok) return;

    try {
      setDeactivatingId(userId);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/school/teachers/deactivate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao desativar professor.");
        return;
      }

      await loadMeAndTeachers();
      alert("Professor desativado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao desativar.");
    } finally {
      setDeactivatingId(null);
    }
  }

  async function handleAssignClass(teacherId: string) {
    const classId = selectedClassByTeacher[teacherId];

    if (!classId) {
      setError("Selecione uma turma para vincular.");
      return;
    }

    try {
      setError(null);
      setAssigningKey(`${teacherId}:${classId}`);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/school/teachers/assign-class", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teacher_id: teacherId,
          class_id: classId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao vincular turma ao professor.");
        return;
      }

      setSelectedClassByTeacher((prev) => ({ ...prev, [teacherId]: "" }));
      await loadMeAndTeachers();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao vincular turma.");
    } finally {
      setAssigningKey(null);
    }
  }

  async function handleUnassignClass(teacherId: string, classId: string, className: string) {
    const ok = confirm(`Deseja desvincular a turma "${className}" deste professor?`);
    if (!ok) return;

    try {
      setError(null);
      setUnassigningKey(`${teacherId}:${classId}`);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/school/teachers/unassign-class", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teacher_id: teacherId,
          class_id: classId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao desvincular turma do professor.");
        return;
      }

      await loadMeAndTeachers();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao desvincular turma.");
    } finally {
      setUnassigningKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-[60vh]">
        <div className="mx-auto max-w-7xl">
          <div className="animate-pulse space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="h-8 w-64 rounded bg-slate-200" />
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

  if (!canManage) {
    return (
      <main className="min-h-[70vh]">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[28px] border border-amber-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Acesso restrito</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Você não tem permissão para gerenciar professores com este usuário.
            </p>

            {error && (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-6">
              <button
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
              >
                Voltar ao painel
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
                  Professores
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Cadastre, visualize e gerencie o corpo docente da escola com segurança.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-wide text-slate-300">
                    Role detectada
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

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Professores ativos
            </div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {teachers.length}
            </div>
            <div className="mt-2 text-sm text-slate-500">
              Total de professores cadastrados e disponíveis no painel.
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Convite / acesso
            </div>
            <div className="mt-3 text-sm text-slate-600">
              Você pode criar via convite por e-mail ou informar uma senha temporária para uso imediato.
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ação rápida
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Painel
              </button>

              <button
                type="button"
                onClick={loadMeAndTeachers}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Recarregar
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Criar professor</h2>
              <p className="mt-1 text-sm text-slate-500">
                Cadastre novos professores e libere o acesso ao portal docente.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Se o convite por e-mail falhar, use uma senha temporária.
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Nome completo
              </label>
              <input
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ex: Maria Silva"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                E-mail
              </label>
              <input
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="professor@escola.com"
                type="email"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Senha temporária
              </label>
              <input
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Se vazio, envia convite"
                type="text"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              O professor será criado e vinculado à escola automaticamente.
            </p>

            <button
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              onClick={handleCreateTeacher}
              disabled={saving || !fullName.trim() || !email.trim()}
            >
              {saving ? "Criando..." : "Criar professor"}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Professores cadastrados</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Lista completa dos professores com acesso vinculado à escola.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {teachers.length} registro(s)
              </div>
            </div>
          </div>

          {teachers.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-500">
              Nenhum professor cadastrado ainda.
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1200px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-slate-500">
                      <th className="px-6 py-4 font-medium">Professor</th>
                      <th className="px-6 py-4 font-medium">E-mail</th>
                      <th className="px-6 py-4 font-medium">Turmas</th>
                      <th className="px-6 py-4 font-medium">Vincular turma</th>
                      <th className="px-6 py-4 font-medium">Criado em</th>
                      <th className="px-6 py-4 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {teachers.map((t) => {
                      const label = `${t.fullName ?? "Professor"} • ${t.email ?? "sem email"}`;
                      const busyDeactivate = deactivatingId === t.userId;

                      return (
                        <tr key={t.userId}>
                          <td className="px-6 py-4 align-top">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                                {getInitials(t.fullName)}
                              </div>
                              <div>
                                <div className="font-medium text-slate-900">
                                  {t.fullName ?? "—"}
                                </div>
                                <div className="mt-1 text-xs text-slate-400">Professor</div>
                                <div className="mt-1 font-mono text-[11px] text-slate-400">
                                  {t.userId}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4 align-top text-slate-700">
                            {t.email ?? "—"}
                          </td>

                          <td className="px-6 py-4 align-top">
                            {t.classAssignments?.length ? (
                              <div className="flex flex-wrap gap-2">
                                {t.classAssignments.map((ca) => {
                                  const key = `${t.userId}:${ca.classId}`;
                                  const busyUnassign = unassigningKey === key;
                                  const labelClass = classLabel(ca) || ca.classId;

                                  return (
                                    <button
                                      key={ca.assignmentId}
                                      type="button"
                                      disabled={busyUnassign}
                                      onClick={() =>
                                        handleUnassignClass(t.userId, ca.classId, labelClass)
                                      }
                                      className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                      title="Clique para desvincular esta turma"
                                    >
                                      {busyUnassign ? "Removendo..." : `${labelClass} ✕`}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-slate-400">Sem turma vinculada</span>
                            )}
                          </td>

                          <td className="px-6 py-4 align-top">
                            <div className="flex gap-2">
                              <select
                                className="min-w-[240px] rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                value={selectedClassByTeacher[t.userId] || ""}
                                onChange={(e) =>
                                  setSelectedClassByTeacher((prev) => ({
                                    ...prev,
                                    [t.userId]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Selecione uma turma</option>
                                {classes
                                  .filter(
                                    (c) =>
                                      !t.classAssignments?.some((ca) => ca.classId === c.id)
                                  )
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {classLabel(c)}
                                    </option>
                                  ))}
                              </select>

                              <button
                                type="button"
                                onClick={() => handleAssignClass(t.userId)}
                                disabled={
                                  !selectedClassByTeacher[t.userId] ||
                                  assigningKey ===
                                    `${t.userId}:${selectedClassByTeacher[t.userId]}`
                                }
                                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                              >
                                {assigningKey ===
                                `${t.userId}:${selectedClassByTeacher[t.userId]}`
                                  ? "Vinculando..."
                                  : "Vincular"}
                              </button>
                            </div>
                          </td>

                          <td className="px-6 py-4 align-top text-slate-700">
                            {formatDateTime(t.createdAt)}
                          </td>

                          <td className="px-6 py-4 align-top">
                            <button
                              className="rounded-2xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                              disabled={busyDeactivate}
                              onClick={() => handleDeactivateTeacher(t.userId, label)}
                              title="Desativar professor (remove acesso sem apagar histórico)"
                            >
                              {busyDeactivate ? "Desativando..." : "Desativar"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-4 p-4 lg:hidden">
                {teachers.map((t) => {
                  const label = `${t.fullName ?? "Professor"} • ${t.email ?? "sem email"}`;
                  const busyDeactivate = deactivatingId === t.userId;

                  return (
                    <div
                      key={t.userId}
                      className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                          {getInitials(t.fullName)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-base font-semibold text-slate-900">
                            {t.fullName ?? "—"}
                          </div>
                          <div className="mt-1 break-all text-sm text-slate-500">
                            {t.email ?? "—"}
                          </div>
                          <div className="mt-1 break-all font-mono text-xs text-slate-400">
                            {t.userId}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Turmas vinculadas
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {t.classAssignments?.length ? (
                            t.classAssignments.map((ca) => {
                              const key = `${t.userId}:${ca.classId}`;
                              const busyUnassign = unassigningKey === key;
                              const labelClass = classLabel(ca) || ca.classId;

                              return (
                                <button
                                  key={ca.assignmentId}
                                  type="button"
                                  disabled={busyUnassign}
                                  onClick={() =>
                                    handleUnassignClass(t.userId, ca.classId, labelClass)
                                  }
                                  className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                  {busyUnassign ? "Removendo..." : `${labelClass} ✕`}
                                </button>
                              );
                            })
                          ) : (
                            <span className="text-sm text-slate-400">Sem turma vinculada</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3">
                        <select
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm"
                          value={selectedClassByTeacher[t.userId] || ""}
                          onChange={(e) =>
                            setSelectedClassByTeacher((prev) => ({
                              ...prev,
                              [t.userId]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Selecione uma turma</option>
                          {classes
                            .filter(
                              (c) => !t.classAssignments?.some((ca) => ca.classId === c.id)
                            )
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {classLabel(c)}
                              </option>
                            ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => handleAssignClass(t.userId)}
                          disabled={
                            !selectedClassByTeacher[t.userId] ||
                            assigningKey ===
                              `${t.userId}:${selectedClassByTeacher[t.userId]}`
                          }
                          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {assigningKey ===
                          `${t.userId}:${selectedClassByTeacher[t.userId]}`
                            ? "Vinculando..."
                            : "Vincular turma"}
                        </button>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400">
                            Criado em
                          </div>
                          <div className="mt-1 text-sm text-slate-700">
                            {formatDateTime(t.createdAt)}
                          </div>
                        </div>
                      </div>

                      <button
                        className="mt-4 w-full rounded-2xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                        disabled={busyDeactivate}
                        onClick={() => handleDeactivateTeacher(t.userId, label)}
                      >
                        {busyDeactivate ? "Desativando..." : "Desativar professor"}
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