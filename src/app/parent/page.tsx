"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type MePayload = {
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

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

export default function ParentHomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const brandTitle = useMemo(() => {
    const name = me?.branding?.brandName?.trim();
    return name || "Portal do Responsável";
  }, [me]);

  const logoUrl = useMemo(() => {
    const apiLogo = me?.branding?.brandLogoUrl?.trim();
    if (apiLogo) return apiLogo;
    return null;
  }, [me]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const text = await res.text();
        const json: any = safeJson(text);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao validar sessão.");
          return;
        }

        if (!json?.parent?.parentId) {
          router.replace(json?.redirectTo || "/login");
          return;
        }

        setMe(json as MePayload);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-56 rounded bg-slate-200" />
            <div className="h-4 w-72 rounded bg-slate-200" />
            <div className="h-28 rounded-2xl bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="text-red-700 font-medium">Erro</div>
          <div className="mt-2 text-sm text-red-600">{error}</div>
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white"
          >
            Voltar ao login
          </button>
        </div>
      </main>
    );
  }

  if (!me?.parent?.parentId) return null;

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Logo da escola"
                  className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-1"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                  Logo
                </div>
              )}

              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-blue-700">
                  Portal do Responsável
                </div>
                <h1 className="truncate text-2xl font-semibold text-slate-900">{brandTitle}</h1>
                <p className="mt-1 text-sm text-slate-600 truncate">
                  {me.user.email ?? "Conta do responsável"}
                </p>
                <p className="text-xs text-slate-500">
                  Escola ID: <span className="font-mono">{me.parent.schoolId}</span>
                </p>
              </div>
            </div>

            <button
              onClick={logout}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sair
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <button
            className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:bg-slate-50"
            onClick={() => router.push("/parent/children")}
          >
            <div className="text-sm text-slate-500">Área do aluno</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">Meus filhos</div>
            <div className="mt-2 text-sm text-slate-600">Ver alunos vinculados à conta.</div>
          </button>

          <button
            className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:bg-slate-50"
            onClick={() => router.push("/parent/calendar")}
          >
            <div className="text-sm text-slate-500">Rotina escolar</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">Agenda</div>
            <div className="mt-2 text-sm text-slate-600">Eventos, datas e compromissos.</div>
          </button>

          <button
            className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:bg-slate-50"
            onClick={() => router.push("/parent/messages")}
          >
            <div className="text-sm text-slate-500">Comunicação</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">Comunicados</div>
            <div className="mt-2 text-sm text-slate-600">Recados e avisos da escola.</div>
          </button>

          <button
            className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:bg-slate-50"
            onClick={() => router.push("/parent/invoices")}
          >
            <div className="text-sm text-slate-500">Financeiro</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">Mensalidades</div>
            <div className="mt-2 text-sm text-slate-600">Faturas, boletos e status.</div>
          </button>
        </section>
      </div>
    </main>
  );
}