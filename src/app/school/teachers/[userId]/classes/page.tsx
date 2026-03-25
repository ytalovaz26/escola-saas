// src/app/school/teachers/[userId]/classes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StaffMe = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
  school?: { schoolId: string; role: string };
};

type ClassApiRow = {
  id: string;
  name: string | null;
  grade: string | null;
  shift: string | null;
  createdAt: string | null;
  isAssigned: boolean;
};

type ListApiResponse = {
  ok: boolean;
  error?: string;
  schoolId?: string;
  teacherUserId?: string;
  classes?: ClassApiRow[];
};

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function pickUserId(params: any): string {
  const v = params?.userId;
  if (Array.isArray(v)) return v[0] || "";
  return String(v || "");
}

export default function TeacherClassesManagePage() {
  const router = useRouter();
  const params = useParams();
  const teacherUserId = useMemo(() => pickUserId(params), [params]);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [me, setMe] = useState<StaffMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassApiRow[]>([]);

  const canManage = useMemo(() => {
    const r = normRole(me?.school?.role);
    return r === "diretor" || r === "coordenador" || r === "director" || r === "coordinator";
  }, [me]);

  async function getTokenOrLogin(): Promise<string | null> {
    const { data, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      setError(sessErr.message);
      return null;
    }
    const token = data.session?.access_token || null;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function loadMe(token: string) {
    const meRes = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const meJson = (await meRes.json().catch(() => null)) as StaffMe | null;
    setMe(meJson);

    if (!meRes.ok || !meJson?.ok) {
      throw new Error(meJson?.error || "Falha ao validar sessão (/api/me).");
    }

    const schoolId = meJson.school?.schoolId;
    if (!schoolId) {
      throw new Error("Seu usuário não tem schoolId no /api/me. (Provável: parent ou sem vínculo staff.)");
    }

    const role = normRole(meJson.school?.role);
    const allowed = role === "diretor" || role === "coordenador" || role === "director" || role === "coordinator";
    if (!allowed) {
      throw new Error(`Acesso negado. Role atual: "${meJson.school?.role}".`);
    }
  }

  async function loadTeacherClasses(token: string) {
    if (!teacherUserId) throw new Error("Parâmetro userId ausente na URL.");

    const res = await fetch(
      `/api/school/teachers/classes/list?teacher_user_id=${encodeURIComponent(teacherUserId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    const json = (await res.json().catch(() => null)) as ListApiResponse | null;

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Falha ao carregar turmas do professor.");
    }

    setClasses((json.classes ?? []) as ClassApiRow[]);
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      await loadMe(token);
      await loadTeacherClasses(token);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar dados.");
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherUserId]);

  async function handleAssign(classId: string) {
    try {
      setSavingKey(`assign:${classId}`);
      setError(null);

      const token = await getTokenOrLogin();
      if (!token) return;

      const res = await fetch("/api/school/teachers/classes/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teacher_user_id: teacherUserId,
          class_id: classId,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao vincular turma.");
      }

      await loadTeacherClasses(token);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao vincular.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleUnassign(classId: string) {
    try {
      setSavingKey(`unassign:${classId}`);
      setError(null);

      const token = await getTokenOrLogin();
      if (!token) return;

      const res = await fetch("/api/school/teachers/classes/unassign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teacher_user_id: teacherUserId,
          class_id: classId,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao desvincular turma.");
      }

      await loadTeacherClasses(token);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao desvincular.");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <div className="p-4">Carregando...</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h1 className="text-2xl font-semibold">Vincular turmas ao professor</h1>
          <p className="text-xs text-gray-500 mt-1">
            Professor (user_id): <span className="font-mono">{teacherUserId || "—"}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Role detectada: <span className="font-mono">{me?.school?.role ?? "—"}</span> • Escola:{" "}
            <span className="font-mono">{me?.school?.schoolId ?? "—"}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <a className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm" href="/school/teachers">
            Voltar
          </a>
          <button
            className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={refreshAll}
            disabled={!!savingKey}
          >
            Recarregar
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{error}</div>
      )}

      {!canManage ? (
        <div className="mt-6 bg-white rounded-2xl shadow p-5">
          <p className="text-sm text-gray-700">Você não tem permissão para gerenciar turmas de professor.</p>
          <p className="text-xs text-gray-500 mt-2">
            Entre como <span className="font-mono">diretor</span> ou <span className="font-mono">coordenador</span>.
          </p>
        </div>
      ) : (
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="text-lg font-semibold">Turmas da escola</h2>
          <p className="text-xs text-gray-500 mt-2">
            Clique em <span className="font-mono">Vincular</span> para criar/reativar o vínculo (
            <span className="font-mono">teacher_classes.is_active=true</span>) e{" "}
            <span className="font-mono">Remover</span> para desativar (
            <span className="font-mono">is_active=false</span>).
          </p>

          {classes.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">Nenhuma turma encontrada.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Turma</th>
                    <th className="py-2">Detalhes</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => {
                    const assigned = !!c.isAssigned;
                    const busyAssign = savingKey === `assign:${c.id}`;
                    const busyUnassign = savingKey === `unassign:${c.id}`;
                    const busy = busyAssign || busyUnassign;

                    return (
                      <tr key={c.id} className="border-t">
                        <td className="py-2 font-medium">{c.name ?? "—"}</td>
                        <td className="py-2 text-xs text-gray-600">
                          {c.grade ? `Série: ${c.grade}` : "Série: —"}
                          {c.shift ? ` • Turno: ${c.shift}` : ""}
                        </td>
                        <td className="py-2">
                          {assigned ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-green-50 text-green-700 text-xs border border-green-200">
                              Vinculada
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-gray-50 text-gray-700 text-xs border border-gray-200">
                              Não vinculada
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          {assigned ? (
                            <button
                              className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm disabled:opacity-60"
                              onClick={() => handleUnassign(c.id)}
                              disabled={busy}
                              title="Desvincula (is_active=false)"
                            >
                              {busyUnassign ? "Removendo..." : "Remover"}
                            </button>
                          ) : (
                            <button
                              className="px-3 py-2 rounded-xl bg-black text-white text-sm disabled:opacity-60"
                              onClick={() => handleAssign(c.id)}
                              disabled={busy}
                              title="Vincula (insert/upsert com is_active=true)"
                            >
                              {busyAssign ? "Vinculando..." : "Vincular"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
