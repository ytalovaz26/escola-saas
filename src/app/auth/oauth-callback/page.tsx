"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const DIRECTOR_GOOGLE_DRAFT_KEY = "director_signup_google_draft";

type DirectorGoogleDraft = {
  fullName: string;
  schoolName: string;
};

type MeResponse =
  | {
      ok: true;
      user: { id: string; email: string | null };
      isPlatformAdmin: boolean;
      school?: { schoolId: string; role: string };
      parent?: { parentId: string; schoolId: string };
      redirectTo: string;
    }
  | { ok: false; error?: string };

async function callMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  return res.json();
}

function readDirectorGoogleDraft(): DirectorGoogleDraft | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(DIRECTOR_GOOGLE_DRAFT_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DirectorGoogleDraft;
  } catch {
    return null;
  }
}

function clearDirectorGoogleDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DIRECTOR_GOOGLE_DRAFT_KEY);
}

function OAuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState("Validando autenticação...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const flow = searchParams.get("flow") || "login_google";

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          throw new Error(sessionError.message || "Falha ao obter sessão do Google.");
        }

        const session = sessionData.session;
        const accessToken = session?.access_token;
        const user = session?.user;

        if (!accessToken || !user) {
          throw new Error("Sessão do Google não encontrada após o login.");
        }

        if (flow === "director_signup_google") {
          setStatus("Finalizando criação da conta do diretor...");

          const draft = readDirectorGoogleDraft();

          if (!draft?.fullName?.trim()) {
            throw new Error("Nome do diretor não encontrado para concluir cadastro com Google.");
          }

          if (!draft?.schoolName?.trim()) {
            throw new Error("Nome da escola não encontrado para concluir cadastro com Google.");
          }

          const email = user.email?.trim();
          if (!email) {
            throw new Error("O Google não retornou um e-mail válido.");
          }

          const res = await fetch("/api/auth/register-director-google", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              fullName: draft.fullName.trim(),
              schoolName: draft.schoolName.trim(),
              email,
            }),
          });

          const json = await res.json().catch(() => null);

          if (!res.ok || !json?.ok) {
            throw new Error(json?.error || "Não foi possível concluir o cadastro com Google.");
          }

          clearDirectorGoogleDraft();
        }

        setStatus("Redirecionando...");

        const me = await callMe(accessToken);

        if (!me || (me as any).ok !== true) {
          throw new Error("Sessão criada, mas o /api/me não conseguiu identificar o usuário.");
        }

        if (active) {
          router.replace((me as any).redirectTo || "/");
        }
      } catch (e: any) {
        clearDirectorGoogleDraft();
        if (active) {
          setError(e?.message || "Erro inesperado no callback do Google.");
        }
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-lg rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">
          {error ? "Erro na autenticação" : "Conectando com Google"}
        </h1>

        <p className="mt-3 text-sm text-slate-600">{error || status}</p>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => router.replace("/login")}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Voltar para login
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
          <div className="w-full max-w-lg rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-semibold text-slate-900">Conectando com Google</h1>
            <p className="mt-3 text-sm text-slate-600">Carregando autenticação...</p>
          </div>
        </div>
      }
    >
      <OAuthCallbackInner />
    </Suspense>
  );
}