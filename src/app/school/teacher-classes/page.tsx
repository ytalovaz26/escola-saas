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
      throw new Error(aJson?.error || "Falha ao carregar vínculos professor↔turma.");
    }

    setAssignments((aJson.assignments ?? []) as AssignmentApi[]);
  }

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      // 1) /api/me
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

      const allowed = role === "diretor" || role === "director" || role === "coordenador" || role === "coordinator";
      if (!allowed) {
        router.replace(meJson?.redirectTo || "/login");
        return;
      }

      setMe(meJson);

      // 2) professores
      const tRes = await fetch("/api/school/teachers/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const tJson = await tRes.json().catch(() => null);

      if (!tRes.ok || !tJson?.ok) throw new Error(tJson?.error || "Falha ao carregar professores.");

      const tList = (tJson.teachers ?? []) as TeacherApi[];
      setTeachers(tList);

      // 3) turmas
      const cRes = await fetch("/api/school/classes/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const cJson = await cRes.json().catch(() => null);

      if (!cRes.ok || !cJson?.ok) throw new Error(cJson?.error || "Falha ao carregar turmas.");

      const cList = (cJson.classes ?? []) as ClassApi[];
      setClasses(cList);

      // 4) vínculos
      await reloadAssignments(token);

      // defaults
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

      // ✅ envia snake_case (compatível com API e com banco)
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

      // ✅ seu unassign atual exige { id }
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

  if (loading) return <div className="p-4">Carregando...</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h1 className="text-2xl font-semibold">Vincular Professor ↔ Turmas</h1>
          <p className="text-xs text-gray-500 mt-1">
            Role: <span className="font-mono">{me?.school?.role ?? "—"}</span> • Escola:{" "}
            <span className="font-mono">{me?.school?.schoolId ?? "—"}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm" onClick={() => router.push("/school")}>
            Voltar ao painel
          </button>

          <button className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm" onClick={loadAll}>
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{error}</div>
      )}

      {!canManage ? (
        <div className="mt-6 bg-white rounded-2xl shadow p-5">
          <p className="text-sm text-gray-700">Você não tem permissão para vincular professores.</p>
        </div>
      ) : (
        <>
          <section className="mt-6 bg-white rounded-2xl shadow p-5">
            <h2 className="text-lg font-semibold">Criar vínculo</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600">Professor</label>
                <select
                  className="mt-1 w-full border rounded-xl px-3 py-2"
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
                <label className="text-xs text-gray-600">Turma</label>
                <select
                  className="mt-1 w-full border rounded-xl px-3 py-2"
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

            <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500">O professor só verá as próprias turmas no painel dele (via teacher_classes).</p>

              <button
                className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60"
                onClick={handleAssign}
                disabled={!selectedTeacherId || !selectedClassId || busyKey?.startsWith("assign:")}
              >
                {busyKey?.startsWith("assign:") ? "Vinculando..." : "Vincular"}
              </button>
            </div>
          </section>

          <section className="mt-6 bg-white rounded-2xl shadow p-5">
            <h2 className="text-lg font-semibold">Vínculos atuais</h2>
            <p className="text-xs text-gray-500 mt-1">Mostra o que cada professor está vinculado hoje.</p>

            {teachers.length === 0 ? (
              <p className="text-sm text-gray-600 mt-3">Nenhum professor cadastrado.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {teachers.map((t) => {
                  const tAssign = assignmentsByTeacher.get(t.userId) ?? [];

                  return (
                    <div key={t.userId} className="border rounded-2xl p-4">
                      <div className="font-medium">{teacherLabel(t)}</div>
                      <div className="text-xs text-gray-500 mt-1 font-mono break-all">{t.userId}</div>

                      {tAssign.length === 0 ? (
                        <p className="text-sm text-gray-600 mt-3">Sem turmas vinculadas.</p>
                      ) : (
                        <ul className="mt-3 space-y-2">
                          {tAssign.map((a) => {
                            const c = classById.get(a.classId);
                            const key = `unassign:${a.id}`;
                            const busy = busyKey === key;

                            return (
                              <li key={a.id} className="flex items-center justify-between gap-3 border rounded-xl p-3">
                                <div>
                                  <div className="text-sm font-medium">{c ? c.name : a.classId}</div>
                                  <div className="text-xs text-gray-600 mt-1">{c ? classLabel(c) : "Turma não encontrada."}</div>
                                  <div className="text-[11px] text-gray-500 mt-1">
                                    Vinculado em: {a.createdAt ? new Date(a.createdAt).toLocaleString() : "—"}
                                  </div>
                                </div>

                                <button
                                  className="text-xs rounded-xl border px-3 py-2 disabled:opacity-60"
                                  disabled={busy}
                                  onClick={() => handleUnassign(a.id)}
                                  title="Desvincular"
                                >
                                  {busy ? "..." : "Desvincular"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
