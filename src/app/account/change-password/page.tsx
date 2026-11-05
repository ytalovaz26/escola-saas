"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { PASSWORD_MIN, passwordStrength, validateNewPassword } from "@/lib/auth/passwordPolicy";

// Alterar senha (qualquer usuário logado) e primeiro acesso obrigatório.
// A troca é feita no servidor (/api/account/change-password), que confere a senha atual
// quando aplicável e só altera a conta da própria sessão.

type Status = {
  mustChangePassword: boolean;
  requiresCurrentPassword: boolean;
  email: string | null;
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const STRENGTH_STYLE = [
  "bg-slate-100 text-slate-500 border-slate-200",
  "bg-red-50 text-red-700 border-red-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
];

function PasswordField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  autoComplete: string;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.show ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
      />
    </div>
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [panelHref, setPanelHref] = useState("/login");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const firstAccess = !!status?.mustChangePassword;
  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function goToPanel() {
    const token = await getToken();
    if (!token) return router.replace("/login");
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const me = await safeJson(res);
    router.replace(res.ok && me?.ok && me.redirectTo ? me.redirectTo : "/login");
  }

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          router.replace("/login");
          return;
        }
        const [statusRes, meRes] = await Promise.all([
          fetch("/api/account/change-password", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
          fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        ]);
        const statusJson = await safeJson(statusRes);
        const meJson = await safeJson(meRes);
        if (!statusRes.ok || !statusJson?.ok) {
          router.replace("/login");
          return;
        }
        setStatus({
          mustChangePassword: !!statusJson.mustChangePassword,
          requiresCurrentPassword: !!statusJson.requiresCurrentPassword,
          email: statusJson.email ?? null,
        });
        if (meJson?.ok && meJson.redirectTo && !String(meJson.redirectTo).startsWith("/account/")) {
          setPanelHref(meJson.redirectTo);
        }
      } catch {
        setError("Não foi possível carregar sua conta. Tente novamente.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const needsCurrent = !!status?.requiresCurrentPassword;
    if (needsCurrent && !currentPassword) {
      setError("Informe a senha atual.");
      return;
    }
    const validation = validateNewPassword({
      newPassword,
      confirmPassword,
      currentPassword: needsCurrent ? currentPassword : undefined,
    });
    if (validation) {
      setError(validation);
      return;
    }

    try {
      setSaving(true);
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: needsCurrent ? currentPassword : undefined, newPassword, confirmPassword }),
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Não foi possível alterar a senha.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await supabase.auth.refreshSession().catch(() => undefined);

      if (firstAccess) {
        setSuccess("Senha definida com sucesso. Abrindo seu painel...");
        await goToPanel();
        return;
      }
      setSuccess("Senha alterada com sucesso. Os outros aparelhos conectados foram desconectados.");
    } catch {
      setError("Erro inesperado ao alterar a senha.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Carregando...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-xl items-center">
        <section className="w-full overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-xl">
          <div className="bg-slate-950 p-6 text-white md:p-8">
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
              {firstAccess ? "Primeiro acesso" : "Segurança da conta"}
            </div>
            <h1 className="mt-4 text-2xl font-semibold md:text-3xl">
              {firstAccess ? "Defina sua senha pessoal" : "Alterar senha"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {firstAccess
                ? "Seu acesso foi criado pela escola com uma senha temporária. Para continuar, crie uma senha que só você conheça."
                : status?.requiresCurrentPassword
                  ? "Para sua segurança, confirme a senha atual e escolha uma nova."
                  : "Escolha sua nova senha."}
            </p>
            {status?.email ? <p className="mt-3 text-xs text-slate-400">{status.email}</p> : null}
          </div>

          <form onSubmit={onSubmit} className="space-y-4 p-6 md:p-8" noValidate>
            {status?.requiresCurrentPassword ? (
              <PasswordField
                id="current-password"
                label="Senha atual"
                value={currentPassword}
                onChange={setCurrentPassword}
                show={show}
                autoComplete="current-password"
              />
            ) : null}

            <PasswordField
              id="new-password"
              label="Nova senha"
              value={newPassword}
              onChange={setNewPassword}
              show={show}
              autoComplete="new-password"
            />

            <div className={`rounded-2xl border px-3 py-2 text-xs font-medium ${STRENGTH_STYLE[strength.level]}`}>
              {strength.label}
            </div>

            <PasswordField
              id="confirm-password"
              label="Confirmar nova senha"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={show}
              autoComplete="new-password"
            />

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Mostrar senhas
            </label>

            <ul className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              <li>• Pelo menos {PASSWORD_MIN} caracteres, com letras e números.</li>
              <li>• Diferente da senha atual; não comece nem termine com espaço.</li>
              <li>• Não compartilhe sua senha com ninguém, nem com a escola.</li>
            </ul>

            {error ? (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {success ? (
              <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Salvando..." : firstAccess ? "Definir senha e continuar" : "Alterar senha"}
            </button>

            <div className="flex flex-wrap justify-between gap-2 pt-1">
              {!firstAccess ? (
                <button
                  type="button"
                  onClick={() => router.push(panelHref)}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Voltar ao painel
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={logout}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sair
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
