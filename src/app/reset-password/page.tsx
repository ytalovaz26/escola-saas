"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function validatePassword(password: string, confirmPassword: string) {
  if (!password) return "Informe a nova senha.";

  if (password.length < 8) {
    return "A nova senha precisa ter pelo menos 8 caracteres.";
  }

  if (password.length > 72) {
    return "A nova senha precisa ter no máximo 72 caracteres.";
  }

  if (!/[A-Za-zÀ-ÿ]/.test(password)) {
    return "A nova senha precisa conter pelo menos uma letra.";
  }

  if (!/[0-9]/.test(password)) {
    return "A nova senha precisa conter pelo menos um número.";
  }

  if (password !== confirmPassword) {
    return "A confirmação de senha não confere.";
  }

  return null;
}

function passwordStrength(password: string) {
  const value = String(password || "");

  let score = 0;

  if (value.length >= 8) score++;
  if (/[A-Za-zÀ-ÿ]/.test(value)) score++;
  if (/[0-9]/.test(value)) score++;
  if (/[^A-Za-zÀ-ÿ0-9]/.test(value)) score++;
  if (value.length >= 12) score++;

  if (!value) {
    return {
      label: "Aguardando senha",
      className: "bg-slate-100 text-slate-500 border-slate-200",
      percent: 0,
    };
  }

  if (score <= 2) {
    return {
      label: "Senha fraca",
      className: "bg-red-50 text-red-700 border-red-200",
      percent: 35,
    };
  }

  if (score <= 4) {
    return {
      label: "Senha média",
      className: "bg-amber-50 text-amber-700 border-amber-200",
      percent: 70,
    };
  }

  return {
    label: "Senha forte",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    percent: 100,
  };
}

export default function ResetPasswordPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);

  const canSubmit = useMemo(() => {
    return !saving && !validatePassword(newPassword, confirmPassword);
  }, [confirmPassword, newPassword, saving]);

  async function checkRecoverySession() {
    setChecking(true);
    setError(null);

    try {
      const { data, error: sessionErr } = await supabase.auth.getSession();

      if (sessionErr) {
        setError("Não foi possível validar o link de recuperação.");
        setHasSession(false);
        return;
      }

      if (!data.session) {
        setHasSession(false);
        setError(
          "Link inválido ou expirado. Solicite um novo link em “Esqueci minha senha”."
        );
        return;
      }

      setHasSession(true);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao validar link de recuperação.");
      setHasSession(false);
    } finally {
      setChecking(false);
    }
  }

  async function updatePassword() {
    setError(null);
    setSuccess(null);

    const validationError = validatePassword(newPassword, confirmPassword);

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);

      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateErr) {
        setError("Não foi possível alterar a senha. Solicite um novo link e tente novamente.");
        return;
      }

      setNewPassword("");
      setConfirmPassword("");

      setSuccess("Senha redefinida com sucesso. Você já pode entrar com a nova senha.");

      setTimeout(async () => {
        await supabase.auth.signOut();
        router.replace("/login");
      }, 1800);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao redefinir senha.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    checkRecoverySession();
  }, []);

  if (checking) {
    return (
      <main className="min-h-screen bg-slate-100 p-4 md:p-6">
        <section className="mx-auto flex min-h-[calc(100vh-48px)] max-w-3xl items-center justify-center">
          <div className="w-full rounded-[36px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-950 text-2xl text-white">
              🔐
            </div>

            <h1 className="mt-5 text-2xl font-semibold text-slate-950">
              Validando link...
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Aguarde enquanto verificamos sua sessão de recuperação.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-4xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[40px] border border-slate-200 bg-white shadow-xl">
          <div className="bg-slate-950 p-6 text-white md:p-8">
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
              Redefinição de senha
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
              Criar nova senha
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
              Defina uma senha segura para recuperar o acesso à plataforma.
            </p>
          </div>

          <div className="p-6 md:p-8">
            {error ? (
              <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
                {success}
              </div>
            ) : null}

            {!hasSession ? (
              <div className="space-y-4">
                <p className="text-sm leading-6 text-slate-600">
                  O link de recuperação não está ativo. Solicite um novo link de
                  redefinição de senha.
                </p>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => router.push("/forgot-password")}
                    className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Solicitar novo link
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Voltar ao login
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                      Informe sua nova senha
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Depois de salvar, você será redirecionado para o login.
                    </p>
                  </div>

                  <div
                    className={`rounded-full border px-4 py-2 text-xs font-semibold ${strength.className}`}
                  >
                    {strength.label}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Nova senha *
                  </label>

                  <div className="flex overflow-hidden rounded-2xl border border-slate-300 bg-white focus-within:border-slate-500 focus-within:ring-4 focus-within:ring-slate-100">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setError(null);
                        setSuccess(null);
                      }}
                      className="min-w-0 flex-1 px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="Digite a nova senha"
                      disabled={saving}
                      autoComplete="new-password"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="shrink-0 border-l border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      {showPassword ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Confirmar nova senha *
                  </label>

                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError(null);
                      setSuccess(null);
                    }}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                    placeholder="Repita a nova senha"
                    disabled={saving}
                    autoComplete="new-password"
                  />
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">
                    Segurança da senha
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-slate-950 transition-all"
                      style={{ width: `${strength.percent}%` }}
                    />
                  </div>

                  <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                    <li>• Pelo menos 8 caracteres.</li>
                    <li>• Pelo menos uma letra.</li>
                    <li>• Pelo menos um número.</li>
                    <li>• Recomendado: símbolo e letras maiúsculas.</li>
                  </ul>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={updatePassword}
                    disabled={!canSubmit}
                    className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Salvando nova senha..." : "Salvar nova senha"}
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    disabled={saving}
                    className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    Voltar ao login
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}