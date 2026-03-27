"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function parseHashParams(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

function ResetPasswordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handledRef = useRef(false);

  const code = useMemo(() => searchParams.get("code"), [searchParams]);
  const tokenHash = useMemo(() => searchParams.get("token_hash"), [searchParams]);
  const type = useMemo(() => searchParams.get("type"), [searchParams]);

  useEffect(() => {
    async function prepareRecoverySession() {
      if (handledRef.current) return;
      handledRef.current = true;

      setCheckingLink(true);
      setError(null);
      setMessage(null);

      try {
        if (typeof window !== "undefined") {
          const hash = window.location.hash || "";
          if (hash) {
            const params = parseHashParams(hash);

            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");
            const hashType = params.get("type");
            const errorCode = params.get("error_code");
            const errorDescription = params.get("error_description");

            if (errorCode || errorDescription) {
              if (errorCode === "otp_expired") {
                setError("O link de recuperação expirou. Solicite um novo email de redefinição.");
              } else {
                setError(
                  decodeURIComponent(
                    errorDescription || "Não foi possível validar o link de recuperação."
                  )
                );
              }
              setReady(false);
              return;
            }

            if (hashType === "recovery" && accessToken && refreshToken) {
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });

              if (error) {
                setError(error.message || "Não foi possível validar a sessão de recuperação.");
                setReady(false);
                return;
              }

              window.history.replaceState({}, document.title, "/reset-password");
              setReady(true);
              setMessage("Link validado. Agora defina sua nova senha.");
              return;
            }
          }
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            setError(error.message || "Não foi possível validar o link de recuperação.");
            setReady(false);
            return;
          }

          if (typeof window !== "undefined") {
            window.history.replaceState({}, document.title, "/reset-password");
          }

          setReady(true);
          setMessage("Link validado. Agora defina sua nova senha.");
          return;
        }

        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as any,
          });

          if (error) {
            setError(error.message || "Não foi possível validar o link de recuperação.");
            setReady(false);
            return;
          }

          if (typeof window !== "undefined") {
            window.history.replaceState({}, document.title, "/reset-password");
          }

          setReady(true);
          setMessage("Link validado. Agora defina sua nova senha.");
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setReady(true);
          setMessage("Sessão de recuperação pronta. Defina sua nova senha.");
          return;
        }

        setError("Link inválido ou expirado. Solicite uma nova recuperação de senha.");
        setReady(false);
      } catch (err: any) {
        setError(err?.message || "Erro inesperado ao validar o link.");
        setReady(false);
      } finally {
        setCheckingLink(false);
      }
    }

    prepareRecoverySession();
  }, [code, tokenHash, type]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!password || !confirmPassword) {
      setError("Preencha os dois campos de senha.");
      return;
    }

    if (password.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setError(error.message || "Não foi possível alterar a senha.");
        return;
      }

      setMessage("Senha alterada com sucesso! Redirecionando para o login...");

      setTimeout(async () => {
        await supabase.auth.signOut();
        router.replace("/login");
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao alterar a senha.");
    } finally {
      setLoading(false);
    }
  }

  if (checkingLink) {
    return (
      <div className="min-h-[70vh] flex items-start justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Redefinir senha</h1>
          <p className="mt-2 text-sm text-slate-600">Validando o link de recuperação...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-start justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Redefinir senha</h1>
          <p className="mt-1 text-sm text-slate-600">
            Defina uma nova senha para acessar o sistema.
          </p>
        </div>

        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!ready ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="w-full rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Nova senha</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                type="password"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Confirmar nova senha</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                type="password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-start justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold text-slate-900">Redefinir senha</h1>
            <p className="mt-2 text-sm text-slate-600">Carregando...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordPageContent />
    </Suspense>
  );
}