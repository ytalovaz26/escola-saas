"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function sendRecoveryEmail() {
    setError(null);
    setSuccess(null);

    const safeEmail = cleanText(email).toLowerCase();

    if (!safeEmail) {
      setError("Informe o e-mail cadastrado.");
      return;
    }

    if (!isValidEmail(safeEmail)) {
      setError("Informe um e-mail válido.");
      return;
    }

    try {
      setSending(true);

      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : undefined;

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo,
      });

      if (resetErr) {
        setError(
          "Não foi possível enviar o e-mail de recuperação. Verifique o e-mail e tente novamente."
        );
        return;
      }

      setSuccess(
        "Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Verifique também a caixa de spam."
      );
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao solicitar recuperação de senha.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-6xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[40px] border border-slate-200 bg-white shadow-xl lg:grid-cols-[0.95fr_1.05fr]">
          <div className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:block">
            <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -bottom-32 left-20 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

            <div className="relative">
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Segurança da conta
              </div>

              <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight">
                Recupere o acesso à plataforma escolar.
              </h1>

              <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300">
                Informe o e-mail cadastrado. O sistema enviará um link seguro para
                redefinição da senha.
              </p>

              <div className="mt-10 grid gap-4">
                <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur">
                  <div className="text-sm font-semibold">Link seguro</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    O link será enviado diretamente para o e-mail do usuário cadastrado.
                  </p>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur">
                  <div className="text-sm font-semibold">Nova senha</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Depois de abrir o link, o usuário poderá definir uma nova senha.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 md:p-10">
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Voltar ao login
            </button>

            <div className="mt-8">
              <div className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Esqueci minha senha
              </div>

              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Recuperar senha
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Digite o e-mail usado no cadastro. Se ele existir na plataforma, você
                receberá um link para criar uma nova senha.
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  E-mail cadastrado
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                    setSuccess(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      sendRecoveryEmail();
                    }
                  }}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                  placeholder="usuario@email.com"
                  disabled={sending}
                  autoComplete="email"
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
                  {success}
                </div>
              ) : null}

              <button
                type="button"
                onClick={sendRecoveryEmail}
                disabled={sending}
                className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Enviando link..." : "Enviar link de recuperação"}
              </button>

              <p className="text-center text-xs leading-5 text-slate-500">
                Não recebeu? Confira a caixa de spam ou solicite novamente em alguns
                minutos.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}