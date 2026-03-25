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

type TeacherRowApi = {
  userId: string;
  createdAt: string;
  fullName: string | null;
  email: string | null;
};

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
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

  const [teachers, setTeachers] = useState<TeacherRowApi[]>([]);

  const canManage = useMemo(() => {
    const role = normRole(me?.school?.role);
    return role === "diretor" || role === "coordenador" || role === "director" || role === "coordinator";
  }, [me]);

  async function loadTeachers(token: string) {
    const r = await fetch("/api/school/teachers/list", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      throw new Error(j?.error || "Falha ao carregar professores.");
    }

    setTeachers((j.teachers ?? []) as TeacherRowApi[]);
  }

  async function loadMeAndTeachers() {
    try {
      setLoading(true);
      setError(null);

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        setError(sessErr.message);
        return;
      }

      const token = sessionData.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meJson = (await meRes.json().catch(() => null)) as StaffMe | null;
      setMe(meJson);

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão (/api/me).");
        return;
      }

      const role = normRole(meJson?.school?.role);
      const schoolId = meJson?.school?.schoolId;

      if (!schoolId) {
        setError(
          "Seu usuário não tem schoolId no /api/me. (Provável: você está logado como parent ou sem vínculo staff.)"
        );
        return;
      }

      const allowed = role === "diretor" || role === "coordenador" || role === "director" || role === "coordinator";
      if (!allowed) {
        setError(`Acesso negado. Role atual: "${meJson?.school?.role}".`);
        return;
      }

      await loadTeachers(token);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar dados.");
      setTeachers([]);
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

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        setError(sessErr.message);
        return;
      }

      const token = sessionData.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

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

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao criar professor.");
        return;
      }

      setEmail("");
      setFullName("");
      setTempPassword("");

      await loadTeachers(token);

      alert("Professor criado e vinculado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivateTeacher(userId: string, displayName: string) {
    const ok = confirm(`Tem certeza que deseja desativar este professor?\n\n${displayName}\n(${userId})`);
    if (!ok) return;

    try {
      setDeactivatingId(userId);
      setError(null);

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        setError(sessErr.message);
        return;
      }

      const token = sessionData.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/school/teachers/deactivate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao desativar professor.");
        return;
      }

      await loadTeachers(token);

      alert("Professor desativado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao desativar.");
    } finally {
      setDeactivatingId(null);
    }
  }

  if (loading) return <div className="p-4">Carregando...</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h1 className="text-2xl font-semibold">Professores</h1>
          <p className="text-xs text-gray-500 mt-1">
            Role detectada: <span className="font-mono">{me?.school?.role ?? "—"}</span> • Escola:{" "}
            <span className="font-mono">{me?.school?.schoolId ?? "—"}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <a className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm" href="/school">
            Voltar ao painel
          </a>
        </div>
      </div>

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{error}</div>
      )}

      {!canManage ? (
        <div className="mt-6 bg-white rounded-2xl shadow p-5">
          <p className="text-sm text-gray-700">Você não tem permissão para gerenciar professores com este usuário.</p>
          <p className="text-xs text-gray-500 mt-2">
            Se você é diretor/coordenador e mesmo assim caiu aqui, então o seu{" "}
            <span className="font-mono">/api/me</span> está retornando role diferente do esperado.
          </p>
        </div>
      ) : (
        <>
          <section className="mt-6 bg-white rounded-2xl shadow p-5">
            <h2 className="text-lg font-semibold">Criar professor</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-600">Nome completo</label>
                <input
                  className="mt-1 w-full border rounded-xl px-3 py-2"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: Maria Silva"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Email</label>
                <input
                  className="mt-1 w-full border rounded-xl px-3 py-2"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="professor@escola.com"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Senha temporária (DEV opcional)</label>
                <input
                  className="mt-1 w-full border rounded-xl px-3 py-2"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="Se vazio, envia convite"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500">
                Se o convite por email falhar (SMTP não configurado), use senha temporária para testar.
              </p>

              <button
                className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60"
                onClick={handleCreateTeacher}
                disabled={saving || !fullName.trim() || !email.trim()}
              >
                {saving ? "Criando..." : "Criar professor"}
              </button>
            </div>
          </section>

          <section className="mt-6 bg-white rounded-2xl shadow p-5">
            <h2 className="text-lg font-semibold">Professores cadastrados</h2>

            {teachers.length === 0 ? (
              <p className="text-sm text-gray-600 mt-3">Nenhum professor cadastrado ainda.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-2">Nome</th>
                      <th className="py-2">Email</th>
                      <th className="py-2">User ID</th>
                      <th className="py-2">Criado em</th>
                      <th className="py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((t) => {
                      const label = `${t.fullName ?? "Professor"} • ${t.email ?? "sem email"}`;
                      const busy = deactivatingId === t.userId;

                      return (
                        <tr key={t.userId} className="border-t">
                          <td className="py-2">{t.fullName ?? "—"}</td>
                          <td className="py-2">{t.email ?? "—"}</td>
                          <td className="py-2 font-mono text-xs">{t.userId}</td>
                          <td className="py-2">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</td>
                          <td className="py-2">
                            <button
                              className="text-red-600 text-xs hover:underline disabled:opacity-60"
                              disabled={busy}
                              onClick={() => handleDeactivateTeacher(t.userId, label)}
                              title="Desativar professor (remove acesso sem apagar histórico)"
                            >
                              {busy ? "Desativando..." : "Desativar"}
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
        </>
      )}
    </main>
  );
}
