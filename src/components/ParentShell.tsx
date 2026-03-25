"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  parent?: { parentId: string; schoolId: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

export default function ParentShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    return me?.branding?.brandName?.trim() || "Portal do Responsável";
  }, [me]);

  const logoUrl = useMemo(() => {
    return me?.branding?.brandLogoUrl?.trim() || null;
  }, [me]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const json = await safeJson(res);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao validar sessão.");
          router.replace("/login");
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
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          Carregando...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="max-w-lg w-full bg-white rounded-3xl border border-red-200 shadow-sm p-6">
          <h1 className="text-xl font-semibold text-slate-900">Erro</h1>
          <p className="text-sm text-slate-600 mt-2">{error}</p>
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 w-full rounded-2xl bg-slate-900 text-white p-3"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Logo da escola"
                className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                Logo
              </div>
            )}

            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{title}</div>
              <div className="truncate text-xs text-slate-600">{me?.user.email ?? me?.user.id}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/parent")}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
            >
              Menu
            </button>
            <button
              onClick={logout}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white hover:opacity-90"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}