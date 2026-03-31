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

function initialsFromName(name: string) {
  const safe = String(name || "").trim();
  if (!safe) return "TR";
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export default function SchoolClassesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<ClassRow[]>([]);
  const [q, setQ] = useState("");

  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [shift, setShift] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;

    return items.filter((c) => {
      const haystack = [c.name, c.grade || "", c.shift || ""].join(" ").toLowerCase();
      return haystack.includes(s);
    });
  }, [items, q]);

  const totalClasses = items.length;

  const byShift = useMemo(() => {
    const counts = {
      matutino: 0,
      vespertino: 0,
      noturno: 0,
      outros: 0,
    };

    for (const item of items) {
      const shiftValue = String(item.shift || "").trim().toLowerCase();

      if (shiftValue.includes("mat")) counts.matutino += 1;
      else if (shiftValue.includes("ves")) counts.vespertino += 1;
      else if (shiftValue.includes("not")) counts.noturno += 1;
      else counts.outros += 1;
    }

    return counts;
  }, [items]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
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
          if (meRes.status === 401 || meRes.status === 403) router.replace("/login");
          return;
        }

        const payload = meJson as MePayload;

        if (payload.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        const role = String(payload.school?.role || "").trim().toLowerCase();
        if (
          role !== "diretor" &&
          role !== "director" &&
          role !== "coordenador" &&
          role !== "coordinator" &&
          role !== "admin"
        ) {
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
  }, [router]);

  async function load(token?: string) {
    setError(null);

    const t = token || (await getAccessToken());
    if (!t) {
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/school/classes", {
      headers: { Authorization: `Bearer ${t}` },
      cache: "no-store",
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
    const ok = confirm("Excluir esta turma? (somente se não houver vínculos ativos)");
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

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-56 rounded-xl bg-slate-200" />
            <div className="h-4 w-80 rounded-xl bg-slate-100" />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-sm" />
          ))}
        </section>

        <section className="h-80 animate-pulse rounded-[28px] border border-slate-200 bg-white shadow-sm" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Não foi possível carregar</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

          <button
            onClick={() => router.push("/school")}
            className="mt-6 inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Voltar ao painel
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      {/* Hero */}
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-7 text-white md:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Gestão Acadêmica
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Turmas</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
                Organize as turmas da escola, mantenha a estrutura acadêmica centralizada
                e acesse rapidamente matrículas e alunos por turma.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => router.push("/school")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Voltar ao painel
              </button>

              <button
                onClick={() => load()}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                disabled={saving}
              >
                Atualizar lista
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Escola vinculada
            </div>
            <div className="mt-3 break-all font-mono text-xs text-slate-700">{schoolId}</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Total de turmas
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-900">{totalClasses}</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Turnos principais
            </div>
            <div className="mt-3 text-sm leading-6 text-slate-700">
              Matutino: <span className="font-semibold">{byShift.matutino}</span>
              <br />
              Vespertino: <span className="font-semibold">{byShift.vespertino}</span>
              <br />
              Noturno: <span className="font-semibold">{byShift.noturno}</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Outras classificações
            </div>
            <div className="mt-3 text-sm leading-6 text-slate-700">
              Registros fora dos turnos padrão:{" "}
              <span className="font-semibold">{byShift.outros}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Criar turma */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Criar nova turma</h2>
            <p className="mt-1 text-sm text-slate-500">
              Cadastre uma turma com nome, série/ano e turno para organizar a operação acadêmica.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
            Nome é obrigatório
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Nome da turma *</label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="Ex: 1º Ano A"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Série / Ano</label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="Ex: 1º Ano"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Turno</label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="Ex: Matutino"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={createClass}
            disabled={saving || !name.trim()}
            className="inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Salvando turma..." : "Criar turma"}
          </button>

          <button
            onClick={() => {
              setName("");
              setGrade("");
              setShift("");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            type="button"
          >
            Limpar campos
          </button>
        </div>
      </section>

      {/* Lista */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Lista de turmas</h2>
            <p className="mt-1 text-sm text-slate-500">
              Filtre, visualize e acesse rapidamente os módulos relacionados a cada turma.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 md:flex-row lg:w-auto">
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200 md:w-80"
              placeholder="Buscar por nome, série ou turno..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <button
              onClick={() => load()}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              disabled={saving}
            >
              Recarregar
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <div className="text-sm font-medium text-slate-700">Nenhuma turma encontrada</div>
            <p className="mt-1 text-sm text-slate-500">
              Ajuste a busca ou crie uma nova turma para começar.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="mt-6 grid grid-cols-1 gap-4 xl:hidden">
              {filtered.map((c) => (
                <div key={c.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-xs font-bold text-white">
                        {initialsFromName(c.name)}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{c.name}</div>
                        <div className="mt-1 font-mono text-[11px] text-slate-500 break-all">{c.id}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">Série</div>
                      <div className="mt-1 text-sm font-medium text-slate-800">{c.grade ?? "—"}</div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">Turno</div>
                      <div className="mt-1 text-sm font-medium text-slate-800">{c.shift ?? "—"}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() =>
                        router.push(`/school/enrollments?classId=${encodeURIComponent(c.id)}`)
                      }
                      className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
                    >
                      Matrículas
                    </button>

                    <button
                      onClick={() =>
                        router.push(`/school/students?classId=${encodeURIComponent(c.id)}`)
                      }
                      className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
                    >
                      Ver alunos
                    </button>

                    <button
                      onClick={() => deleteClass(c.id)}
                      className="rounded-2xl border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="mt-6 hidden overflow-hidden rounded-3xl border border-slate-200 xl:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-left">
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Turma
                      </th>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Série
                      </th>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Turno
                      </th>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Ações
                      </th>
                    </tr>
                  </thead>

                  <tbody className="bg-white">
                    {filtered.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-xs font-bold text-white">
                              {initialsFromName(c.name)}
                            </div>

                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                              <div className="mt-1 break-all font-mono text-[11px] text-slate-500">
                                {c.id}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 align-top text-sm text-slate-700">
                          {c.grade ?? "—"}
                        </td>

                        <td className="px-5 py-4 align-top text-sm text-slate-700">
                          {c.shift ?? "—"}
                        </td>

                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                router.push(`/school/enrollments?classId=${encodeURIComponent(c.id)}`)
                              }
                              className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Matrículas
                            </button>

                            <button
                              onClick={() =>
                                router.push(`/school/students?classId=${encodeURIComponent(c.id)}`)
                              }
                              className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                              title="Ver alunos"
                            >
                              Ver alunos
                            </button>

                            <button
                              onClick={() => deleteClass(c.id)}
                              className="rounded-2xl border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                              title="Excluir turma"
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
            </div>
          </>
        )}
      </section>
    </main>
  );
}