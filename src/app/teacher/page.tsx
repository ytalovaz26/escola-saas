"use client";

import { useEffect, useState } from "react";
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

export default function TeacherHomePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeOk | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="p-6">
        <div className="animate-pulse text-sm text-gray-600">Carregando portal do professor...</div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-xl font-semibold">Portal do Professor</h1>
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : (
          <div className="text-sm text-gray-700">Sessão inválida. Redirecionando...</div>
        )}

        <button
          onClick={() => router.replace("/login")}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Ir para login
        </button>
      </div>
    );
  }

  const schoolId = me.school?.schoolId || "";
  const schoolName = me.branding?.brandName || "Portal do Professor";
  const logoUrl = me.branding?.brandLogoUrl || null;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Logo da escola"
                className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                Logo
              </div>
            )}

            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Portal do Professor</h1>
              <p className="mt-1 text-sm text-slate-500">
                {schoolName} · {me.user.email || me.user.id}
              </p>
              <p className="mt-1 text-xs text-slate-400">Escola ID: {schoolId || "—"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Ações rápidas</h2>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/teacher/classes"
              className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white hover:opacity-90"
            >
              Minhas turmas
            </Link>

            <Link
              href="/teacher/classes"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-4 py-3 text-sm hover:bg-slate-50"
            >
              Lançar diário pedagógico
            </Link>

            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
              }}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-4 py-3 text-sm hover:bg-slate-50"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}