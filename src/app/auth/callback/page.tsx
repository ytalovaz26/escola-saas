"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

const DIRECTOR_GOOGLE_DRAFT_KEY = "director_signup_google_draft";

type DirectorGoogleDraft = {
  fullName: string;
  schoolName: string;
};

async function callMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  return res.json();
}

function readDirectorGoogleDraft(): DirectorGoogleDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(DIRECTOR_GOOGLE_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DirectorGoogleDraft;
  } catch {
    return null;
  }
}

function clearDirectorGoogleDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DIRECTOR_GOOGLE_DRAFT_KEY);
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState("Validando autenticação...");

  useEffect(() => {
    async function run() {
      try {
        const code = searchParams.get("code");
        const flow = searchParams.get("flow");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            setError(exchangeError.message || "Não foi possível concluir o login.");
            return;
          }
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token || !session.user) {
          setError("Sessão não encontrada após autenticação.");
          return;
        }

        if (flow === "director_signup_google") {
          setLoadingText("Finalizando cadastro do diretor...");

          const draft = readDirectorGoogleDraft();

          if (!draft?.fullName?.trim() || !draft?.schoolName?.trim()) {
            setError("Não foi possível concluir o cadastro com Google. Dados da escola não encontrados.");
            return;
          }

          const res = await fetch("/api/auth/register-director/google", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              fullName: draft.fullName.trim(),
              schoolName: draft.schoolName.trim(),
            }),
          });

          const json = await res.json().catch(() => null);

          if (!res.ok || !json?.ok) {
            setError(json?.error || "Não foi possível concluir o cadastro com Google.");
            return;
          }

          clearDirectorGoogleDraft();
        }

        setLoadingText("Redirecionando...");

        const me = await callMe(session.access_token);

        if (!me || (me as any).ok !== true) {
          setError("Não foi possível identificar o destino do usuário.");
          return;
        }

        router.replace((me as any).redirectTo || "/");
      } catch (err: any) {
        setError(err?.message || "Erro inesperado na autenticação.");
      }
    }

    run();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        {error ? (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Erro na autenticação</h1>
            <p className="mt-2 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="mt-6 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
            >
              Voltar para login
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Carregando...</h1>
            <p className="mt-2 text-sm text-slate-600">{loadingText}</p>
          </>
        )}
      </div>
    </div>
  );
}