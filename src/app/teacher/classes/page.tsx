"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
  isPlatformAdmin?: boolean;
  school?: { schoolId: string; role: string };
};

type TeacherClassItem = {
  assignmentId: string;
  classId: string;
  createdAt: string | null;
  name: string | null;
  grade: string | null;
  shift: string | null;
};

type BrandingResp = any;

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function classLabel(c: TeacherClassItem) {
  const parts: string[] = [];
  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(`Série: ${c.grade}`);
  if (c.shift) parts.push(`Turno: ${c.shift}`);
  return parts.join(" • ") || c.classId;
}

export default function TeacherClassesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);

  const [branding, setBranding] = useState<{ name?: string | null; logoUrl?: string | null } | null>(null);

  const canAccess = useMemo(() => {
    const r = normRole(me?.school?.role);
    return r === "professor" || r === "teacher";
  }, [me?.school?.role]);

  const brandBtn =
    "bg-[rgb(var(--brand-rgb))] hover:bg-[rgb(var(--brand-rgb))]/90 text-white";

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

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const meJson = (await meRes.json().catch(() => null)) as MePayload | null;

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão (/api/me).");
        return;
      }

      if (meJson.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const role = normRole(meJson?.school?.role);
      if (!(role === "professor" || role === "teacher")) {
        router.replace(meJson?.redirectTo || "/login");
        return;
      }

      setMe(meJson);

      const bRes = await fetch("/api/school/branding", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const bJson = (await bRes.json().catch(() => null)) as BrandingResp | null;

      if (bRes.ok && bJson?.ok) {
        const school = bJson.school || bJson;
        const name = school?.brand_name ?? school?.name ?? null;
        const logoUrl = school?.brand_logo_url ?? school?.logo_url ?? null;
        setBranding({ name, logoUrl });
      } else {
        setBranding(null);
      }

      const res = await fetch("/api/teacher/classes/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar turmas do professor.");
        setClasses([]);
        return;
      }

      setSchoolId(json.schoolId ?? null);
      setClasses((json.classes ?? []) as TeacherClassItem[]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado.");
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border bg-white p-6">
          <h1 className="text-xl font-semibold">Não foi possível carregar</h1>
          <p className="text-sm text-slate-600 mt-2">{error}</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => router.replace("/teacher")} className="flex-1 rounded-xl border p-3 hover:bg-slate-50">
              Voltar
            </button>
            <button onClick={load} className={`flex-1 rounded-xl ${brandBtn} p-3 font-semibold`}>
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border bg-white p-6">
          <h1 className="text-xl font-semibold">Acesso negado</h1>
          <p className="text-sm text-slate-600 mt-2">Esta página é exclusiva para professores.</p>
          <button onClick={() => router.replace("/login")} className={`mt-4 w-full rounded-xl ${brandBtn} p-3 font-semibold`}>
            Ir para login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl border bg-white p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-xl border bg-white overflow-hidden flex items-center justify-center">
              {branding?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logoUrl} alt="Logo da escola" className="h-full w-full object-contain" />
              ) : (
                <div className="h-full w-full bg-slate-100" />
              )}
            </div>

            <div className="min-w-0">
              <div className="text-sm text-slate-500">Portal do Professor</div>
              <h1 className="text-xl font-semibold truncate">{branding?.name || "Minha escola"}</h1>
              <div className="text-xs text-slate-500 mt-1">
                Escola ID: <span className="font-mono">{schoolId ?? me?.school?.schoolId ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => router.push("/teacher")} className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50">
              Voltar
            </button>
            <button onClick={load} className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50">
              Atualizar
            </button>
            <button onClick={logout} className={`rounded-xl px-4 py-2 text-sm font-semibold ${brandBtn}`}>
              Sair
            </button>
          </div>
        </div>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-2xl font-semibold tracking-tight">Minhas turmas</h2>
          <p className="text-sm text-slate-600 mt-2">
            Acesse chamada e diário pedagógico da turma.
          </p>

          {classes.length === 0 ? (
            <p className="text-sm text-slate-600 mt-4">Nenhuma turma vinculada ao seu usuário.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {classes.map((c) => (
                <div
                  key={c.assignmentId}
                  className="border rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hover:bg-slate-50/40 transition"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{classLabel(c)}</div>
                    <div className="text-xs text-slate-500 mt-1 font-mono break-all">{c.classId}</div>
                    {c.createdAt && (
                      <div className="text-xs text-slate-500 mt-1">
                        Vinculado em: {new Date(c.createdAt).toLocaleString("pt-BR")}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => router.push(`/teacher/classes/${c.classId}`)}
                      className="rounded-xl border px-4 py-2 text-sm hover:bg-white"
                    >
                      Ver alunos
                    </button>

                    <button
                      onClick={() => router.push(`/teacher/classes/${c.classId}/attendance`)}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold ${brandBtn}`}
                    >
                      Chamada
                    </button>

                    <button
                      onClick={() => router.push(`/teacher/classes/${c.classId}/diary`)}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-white"
                    >
                      Diário pedagógico
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}