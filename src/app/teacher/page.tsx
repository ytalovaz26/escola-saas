"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MeOk = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: { parentId: string; schoolId: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

type MeResp = MeOk | { ok: false; error?: string };

async function fetchMeWithToken(accessToken: string): Promise<MeResp> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  return res.json();
}

function SummaryCard({
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

function QuickLink({
  href,
  title,
  description,
  primary = false,
}: {
  href: string;
  title: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "group rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        primary
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-900",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={primary ? "text-lg font-semibold text-white" : "text-lg font-semibold"}>
            {title}
          </h2>

          <p
            className={[
              "mt-2 text-sm leading-6",
              primary ? "text-slate-200" : "text-slate-500",
            ].join(" ")}
          >
            {description}
          </p>
        </div>

        <div
          className={[
            "rounded-2xl px-3 py-2 text-sm",
            primary ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          →
        </div>
      </div>

      <div
        className={[
          "mt-5 text-sm font-semibold",
          primary ? "text-white" : "text-slate-700 group-hover:text-slate-900",
        ].join(" ")}
      >
        Abrir agora
      </div>
    </Link>
  );
}

export default function TeacherHomePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messagesSummary, setMessagesSummary] = useState<{
    total: number;
    unread: number;
    read: number;
  }>({
    total: 0,
    unread: 0,
    read: 0,
  });

  const schoolId = me?.school?.schoolId || "";
  const schoolName = me?.branding?.brandName || "Portal do Professor";
  const logoUrl = me?.branding?.brandLogoUrl || null;

  const unreadMessagesLabel = useMemo(() => {
    if (messagesSummary.unread > 0) return `${messagesSummary.unread} novo(s)`;
    if (messagesSummary.total > 0) return "Tudo lido";
    return "Nenhum";
  }, [messagesSummary]);

  async function loadMessagesSummary(accessToken: string) {
    try {
      const res = await fetch("/api/teacher/messages", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (res.ok && json?.ok) {
        setMessagesSummary(
          json.summary || {
            total: 0,
            unread: 0,
            read: 0,
          }
        );
      }
    } catch {
      setMessagesSummary({
        total: 0,
        unread: 0,
        read: 0,
      });
    }
  }

  useEffect(() => {
    let alive = true;

    async function boot() {
      setLoading(true);
      setError(null);

      try {
        const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw new Error(sessErr.message);

        const accessToken = sessionData.session?.access_token;

        if (!accessToken) {
          router.replace("/login");
          return;
        }

        const data = await fetchMeWithToken(accessToken);

        if (!alive) return;

        if (!data || (data as any).ok !== true) {
          router.replace("/login");
          return;
        }

        const role = String((data as any).school?.role || "").trim().toLowerCase();

        if (role !== "professor" && role !== "teacher") {
          router.replace((data as any).redirectTo || "/");
          return;
        }

        setMe(data as MeOk);

        await loadMessagesSummary(accessToken);
      } catch (e: any) {
        if (!alive) return;

        setError(e?.message || "Falha ao carregar sessão do professor.");
        setMe(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    boot();

    return () => {
      alive = false;
    };
  }, [router]);

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

  if (!me) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Portal do Professor</h1>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Sessão inválida. Redirecionando...</p>
          )}

          <button
            onClick={() => router.replace("/login")}
            className="mt-6 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
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
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Logo da escola"
                  className="h-24 w-24 rounded-3xl border border-white/15 bg-white/10 object-contain p-2"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/15 bg-white/10 text-sm text-slate-200">
                  Logo
                </div>
              )}

              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Área do professor
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Portal do Professor
                </h1>

                <p className="mt-2 text-sm text-slate-200 md:text-base">
                  {schoolName} · {me.user.email || me.user.id}
                </p>

                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  Acesse suas turmas, realize chamadas, lance diário pedagógico e acompanhe
                  comunicados oficiais da escola.
                </p>

                <div className="mt-4 text-xs text-slate-300">
                  Escola ID: <span className="font-mono">{schoolId || "—"}</span>
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
              }}
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
            >
              Sair
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
          <SummaryCard
            label="Turmas"
            value="Acessar"
            help="Entre nas turmas vinculadas ao seu usuário."
          />

          <SummaryCard
            label="Comunicados"
            value={unreadMessagesLabel}
            help="Avisos enviados pela direção, coordenação ou secretaria."
          />

          <SummaryCard
            label="Rotina docente"
            value="Ativa"
            help="Chamada e diário pedagógico disponíveis no painel."
          />
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Ações rápidas
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Acesse rapidamente os principais módulos do professor.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <QuickLink
            href="/teacher/classes"
            title="Minhas turmas"
            description="Acesse alunos, chamada e diário pedagógico das turmas vinculadas."
            primary
          />

          <QuickLink
            href="/teacher/messages"
            title="Comunicados"
            description="Veja avisos oficiais enviados pela escola para professores e equipe."
          />

          <QuickLink
            href="/teacher/classes"
            title="Diário pedagógico"
            description="Entre na turma desejada para lançar ou consultar o diário."
          />
        </div>
      </section>
    </main>
  );
}