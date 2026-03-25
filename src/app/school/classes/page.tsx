"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  created_at?: string;
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

export default function SchoolClassesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<ClassRow[]>([]);
  const [q, setQ] = useState("");

  // form criar
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [shift, setShift] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((c) => c.name.toLowerCase().includes(s));
  }, [items, q]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const token = await getAccessToken();
        if (!token) {
          router.replace("/login");
          return;
        }

        // valida perfil
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

        await load(token);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(token?: string) {
    setError(null);

    const t = token || (await getAccessToken());
    if (!t) {
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/school/classes", {
      headers: { Authorization: `Bearer ${t}` },
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar turmas.");
      return;
    }

    setItems((json.classes ?? []) as ClassRow[]);
  }

  async function createClass() {
    if (!name.trim()) return;

    setError(null);
    const token = await getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      setSaving(true);

      const res = await fetch("/api/school/classes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          grade: grade.trim() ? grade.trim() : null,
          shift: shift.trim() ? shift.trim() : null,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao criar turma.");
        return;
      }

      setName("");
      setGrade("");
      setShift("");
      await load(token);
    } finally {
      setSaving(false);
    }
  }

  async function deleteClass(id: string) {
    const ok = confirm("Excluir esta turma? (só se não houver vínculos ativos)");
    if (!ok) return;

    setError(null);
    const token = await getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const res = await fetch(`/api/school/classes/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao excluir turma.");
      return;
    }

    await load(token);
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
          <button onClick={() => router.push("/school")} className="mt-4 w-full rounded-xl bg-gray-900 text-white p-3">
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
            <h1 className="text-2xl font-semibold">Turmas</h1>
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

        {/* Criar turma */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Criar turma</h2>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">Nome *</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: 1º Ano A"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Série/Ano</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: 1º Ano"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Turno</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: matutino"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={createClass}
                disabled={saving || !name.trim()}
                className="w-full rounded-xl bg-gray-900 text-white px-4 py-3 disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Criar turma"}
              </button>
            </div>
          </div>
        </section>

        {/* Lista */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <h2 className="font-semibold">Lista de turmas</h2>
              <p className="text-xs text-gray-500 mt-1">Abra a matrícula já filtrada por turma.</p>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              <input
                className="border rounded-xl p-3 w-full md:w-80"
                placeholder="Buscar por nome..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button onClick={() => load()} className="rounded-xl border px-4 py-3" disabled={saving}>
                Atualizar
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">Nenhuma turma encontrada.</p>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Turma</th>
                    <th className="py-2">Série</th>
                    <th className="py-2">Turno</th>
                    <th className="py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{c.id}</div>
                      </td>
                      <td className="py-2">{c.grade ?? "—"}</td>
                      <td className="py-2">{c.shift ?? "—"}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {/* ✅ NOVO: vai direto para matrículas filtrado */}
                          <button
                            onClick={() => router.push(`/school/enrollments?classId=${encodeURIComponent(c.id)}`)}
                            className="rounded-xl border px-3 py-2 text-sm"
                          >
                            Matrículas
                          </button>

                          <button
                            onClick={() => router.push(`/school/students?classId=${encodeURIComponent(c.id)}`)}
                            className="rounded-xl border px-3 py-2 text-sm"
                            title="Ver alunos (filtra pela turma ativa)"
                          >
                            Ver alunos
                          </button>

                          <button
                            onClick={() => deleteClass(c.id)}
                            className="rounded-xl border border-red-500/40 text-red-600 px-3 py-2 text-sm"
                            title="Excluir (só sem vínculos ativos)"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}