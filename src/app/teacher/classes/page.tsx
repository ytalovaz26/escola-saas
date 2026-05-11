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

function MetricCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>

      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

export default function TeacherClassesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);

  const [branding, setBranding] = useState<{
    name?: string | null;
    logoUrl?: string | null;
  } | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-72 rounded-xl bg-slate-200" />
            <div className="h-4 w-96 rounded-xl bg-slate-100" />
            <div className="h-40 rounded-[28px] bg-slate-100" />
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-[28px] border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Não foi possível carregar</h1>

          <p className="mt-2 text-sm text-slate-600">{error}</p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => router.replace("/teacher")}
              className="flex-1 rounded-2xl border border-slate-300 p-3 text-sm hover:bg-slate-50"
            >
              Voltar
            </button>

            <button
              onClick={load}
              className={`flex-1 rounded-2xl ${brandBtn} p-3 text-sm font-semibold`}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-[28px] border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Acesso negado</h1>

          <p className="mt-2 text-sm text-slate-600">
            Esta página é exclusiva para professores.
          </p>

          <button
            onClick={() => router.replace("/login")}
            className={`mt-4 w-full rounded-2xl ${brandBtn} p-3 text-sm font-semibold`}
          >
            Ir para login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-2">
                {branding?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={branding.logoUrl}
                    alt="Logo da escola"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="h-full w-full rounded-2xl bg-white/10" />
                )}
              </div>

              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Portal do professor
                </div>

                <h1 className="mt-3 truncate text-3xl font-semibold tracking-tight">
                  {branding?.name || "Minha escola"}
                </h1>

                <p className="mt-2 text-sm text-slate-200">
                  Escola ID:{" "}
                  <span className="font-mono">
                    {schoolId ?? me?.school?.schoolId ?? "—"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => router.push("/teacher")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Voltar
              </button>

              <button
                onClick={() => router.push("/teacher/messages")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Comunicados
              </button>

              <button
                onClick={load}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Atualizar
              </button>

              <button
                onClick={logout}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Sair
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
          <MetricCard
            label="Turmas vinculadas"
            value={String(classes.length)}
            help="Total de turmas disponíveis para este professor."
          />

          <MetricCard
            label="Rotina"
            value="Ativa"
            help="Acesse chamada, alunos e diário pedagógico."
          />

          <MetricCard
            label="Comunicados"
            value="Disponível"
            help="Avisos oficiais da escola para professores."
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Minhas turmas
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Acesse os alunos, a chamada e o diário pedagógico da turma.
          </p>
        </div>

        <div className="p-4 md:p-6">
          {classes.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              Nenhuma turma vinculada ao seu usuário.
            </div>
          ) : (
            <div className="space-y-3">
              {classes.map((c) => (
                <div
                  key={c.assignmentId}
                  className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50/40 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-900">
                      {classLabel(c)}
                    </div>

                    <div className="mt-1 break-all font-mono text-xs text-slate-500">
                      {c.classId}
                    </div>

                    {c.createdAt ? (
                      <div className="mt-1 text-xs text-slate-500">
                        Vinculado em: {new Date(c.createdAt).toLocaleString("pt-BR")}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => router.push(`/teacher/classes/${c.classId}`)}
                      className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-white"
                    >
                      Ver alunos
                    </button>

                    <button
                      onClick={() =>
                        router.push(`/teacher/classes/${c.classId}/attendance`)
                      }
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold ${brandBtn}`}
                    >
                      Chamada
                    </button>

                    <button
                      onClick={() => router.push(`/teacher/classes/${c.classId}/diary`)}
                      className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-white"
                    >
                      Diário pedagógico
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}