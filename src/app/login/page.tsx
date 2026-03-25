"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

async function callMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  return res.json();
}

function parseHashParams(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handledRecoveryRef = useRef(false);

  async function redirectByMe() {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) throw new Error(sessErr.message);

    const token = sessionData.session?.access_token;
    if (!token) return;

    const me = await callMe(token);
    if (!me || (me as any).ok !== true) return;

    router.replace((me as any).redirectTo || "/");
  }

  async function handleRecoveryRedirect() {
    if (typeof window === "undefined") return false;
    if (handledRecoveryRef.current) return false;

    const hash = window.location.hash || "";
    const search = new URLSearchParams(window.location.search);

    const hashParams = parseHashParams(hash);

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const hashType = hashParams.get("type");
    const hashErrorCode = hashParams.get("error_code");
    const hashErrorDescription = hashParams.get("error_description");

    if (hashErrorCode || hashErrorDescription) {
      handledRecoveryRef.current = true;

      if (hashErrorCode === "otp_expired") {
        setError("O link de recuperação expirou. Solicite um novo email.");
      } else {
        setError(
          decodeURIComponent(
            hashErrorDescription || "Não foi possível validar o link de recuperação."
          )
        );
      }

      window.history.replaceState({}, document.title, "/login");
      return true;
    }

    if (hashType === "recovery" && accessToken && refreshToken) {
      handledRecoveryRef.current = true;

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        setError(error.message || "Não foi possível validar a recuperação.");
        window.history.replaceState({}, document.title, "/login");
        return true;
      }

      window.history.replaceState({}, document.title, "/reset-password");
      router.replace("/reset-password");
      return true;
    }

    const code = search.get("code");
    const tokenHash = search.get("token_hash");
    const type = search.get("type");

    if (code || (tokenHash && type)) {
      handledRecoveryRef.current = true;

      const nextUrl = new URL("/reset-password", window.location.origin);
      if (code) nextUrl.searchParams.set("code", code);
      if (tokenHash) nextUrl.searchParams.set("token_hash", tokenHash);
      if (type) nextUrl.searchParams.set("type", type);

      router.replace(nextUrl.pathname + nextUrl.search);
      return true;
    }

    return false;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInErr) {
        setError(signInErr.message || "Erro ao entrar.");
        return;
      }

      await redirectByMe();
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const handled = await handleRecoveryRedirect();
        if (handled) return;

        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          await redirectByMe();
          return;
        }
      } catch (err: any) {
        setError(err?.message || "Erro ao verificar sessão.");
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  if (checkingSession) {
    return (
      <div className="min-h-[70vh] flex items-start justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold text-slate-900">Carregando...</h1>
            <p className="mt-2 text-sm text-slate-600">
              Validando sessão ou link de recuperação.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-start justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <div>
          <h1 className="text-3xl font-semibold">Entrar</h1>
          <p className="text-sm text-gray-600">Acesse com seu e-mail e senha.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">E-mail</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              type="email"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Senha</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              type="password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}