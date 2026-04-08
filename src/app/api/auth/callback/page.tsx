"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MeResponse =
  | {
      ok: true;
      redirectTo: string;
      user: { id: string; email: string | null };
      isPlatformAdmin: boolean;
      school?: { schoolId: string; role: string };
      parent?: { parentId: string; schoolId: string };
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

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const code = searchParams.get("code");
        const flow = searchParams.get("flow") || "login_google";

        if (!code) {
          setError("Código de autenticação não encontrado.");
          return;
        }

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          setError(exchangeError.message || "Não foi possível concluir o login com Google.");
          return;
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token || !session.user) {
          setError(sessionError?.message || "Sessão inválida após autenticação.");
          return;
        }

        if (flow === "director_signup_google") {
          const fullName =
            String(session.user.user_metadata?.full_name || "").trim() ||
            String(session.user.user_metadata?.name || "").trim() ||
            "Diretor";

          const email = String(session.user.email || "").trim().toLowerCase();

          const schoolName =
            String(session.user.user_metadata?.school_name || "").trim() || "Nova Escola";

          const res = await fetch("/api/auth/register-director-google", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              fullName,
              schoolName,
              email,
            }),
          });

          const json = await res.json().catch(() => null);

          if (!res.ok || !json?.ok) {
            setError(json?.error || "Não foi possível concluir o cadastro com Google.");
            return;
          }
        }

        const me = await callMe(session.access_token);

        if (!me || (me as any).ok !== true) {
          setError("Não foi possível identificar o destino do usuário.");
          return;
        }

        router.replace((me as any).redirectTo || "/");
      } catch (err: any) {
        setError(err?.message || "Erro inesperado na autenticação.");
      }
    })();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        {error ? (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Erro na autenticação</h1>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
            <button
              onClick={() => router.replace("/login")}
              className="mt-6 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
            >
              Voltar para login
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Concluindo acesso...</h1>
            <p className="mt-2 text-sm text-slate-600">
              Aguarde enquanto validamos sua autenticação.
            </p>
          </>
        )}
      </div>
    </div>
  );
}