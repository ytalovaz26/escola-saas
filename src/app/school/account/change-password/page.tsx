"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: {
    id: string;
    email: string | null;
  };
  isPlatformAdmin: boolean;
  school?: {
    schoolId: string;
    role: string;
  };
  parent?: {
    parentId: string;
    schoolId: string;
  };
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
    return { ok: false, error: text || "Resposta inválida do servidor." };
  }
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function roleLabel(role?: string | null) {
  const r = normalizeRole(role);

  if (r === "professor" || r === "teacher") return "Professor";
  if (r === "diretor" || r === "director") return "Diretor";
  if (r === "coordenador" || r === "coordinator") return "Coordenador";
  if (r === "secretaria" || r === "secretary") return "Secretaria";
  if (r === "admin") return "Administrador";
  if (r === "responsavel" || r === "responsável" || r === "parent") return "Responsável";

  return role || "Usuário";
}

function getInitials(value?: string | null) {
  const safe = cleanText(value);

  if (!safe) return "US";

  const base = safe.includes("@") ? safe.split("@")[0] : safe;

  const parts = base
    .split(/[.\-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "US";

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
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

export default function ChangePasswordPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);

  const currentRole = me?.school?.role || (me?.parent ? "Responsável" : "");
  const userEmail = me?.user?.email || "";
  const schoolName = me?.branding?.brandName || "Plataforma Escolar";
  const logoUrl = me?.branding?.brandLogoUrl || me?.branding?.brandIconUrl || null;

  const canSubmit = useMemo(() => {
    return !saving && !validatePassword(newPassword, confirmPassword);
  }, [confirmPassword, newPassword, saving]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || null;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadMe() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getToken();

      if (!token) return;

      const res = await fetch("/api/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Não foi possível validar sua sessão.");
        return;
      }

      setMe(json as MePayload);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar usuário.");
    } finally {
      setLoading(false);
    }
  }

  async function changePassword() {
    setError(null);
    setSuccess(null);

    const validationError = validatePassword(newPassword, confirmPassword);

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);

      const token = await getToken();

      if (!token) return;

      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          newPassword,
          confirmPassword,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Não foi possível alterar a senha.");
        return;
      }

      setNewPassword("");
      setConfirmPassword("");

      setSuccess("Senha alterada com sucesso. Use a nova senha no próximo login.");

      try {
        await supabase.auth.refreshSession();
      } catch {
        // Não bloqueia a experiência.
      }
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao alterar senha.");
    } finally {
      setSaving(false);
    }
  }

  function goBackToPanel() {
    if (me?.redirectTo) {
      router.push(me.redirectTo);
      return;
    }

    const role = normalizeRole(me?.school?.role);

    if (role === "professor" || role === "teacher") {
      router.push("/teacher");
      return;
    }

    if (me?.parent) {
      router.push("/parent");
      return;
    }

    if (me?.isPlatformAdmin) {
      router.push("/admin-master");
      return;
    }

    router.push("/school");
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 p-4 md:p-6">
        <section className="mx-auto max-w-5xl rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-5">
            <div className="h-10 w-80 max-w-full rounded-2xl bg-slate-200" />
            <div className="h-4 w-[520px] max-w-full rounded-2xl bg-slate-100" />
            <div className="h-96 rounded-[32px] bg-slate-100" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="relative overflow-hidden rounded-[40px] border border-slate-200 bg-slate-950 p-6 text-white shadow-xl md:p-8">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Segurança da conta
              </div>

              <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight md:text-5xl">
                Alterar senha
              </h1>

              <p className="mt-3 max-w-3xl break-words text-sm leading-7 text-slate-300 md:text-base">
                Atualize sua senha de acesso com segurança. Essa página funciona para
                professores, responsáveis, secretaria, coordenação e direção.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goBackToPanel}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
              >
                Voltar ao painel
              </button>

              <button
                type="button"
                onClick={loadMe}
                className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
              >
                Recarregar
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800">
            {success}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Conta atual
            </div>

            <div className="mt-5 rounded-[32px] border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={schoolName}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  </div>
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-slate-950 text-base font-bold text-white shadow-sm">
                    {getInitials(schoolName)}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="break-words text-lg font-semibold text-slate-900">
                    {schoolName}
                  </div>

                  <div className="mt-1 break-all text-sm text-slate-500">
                    {userEmail || "Usuário logado"}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3">
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Perfil
                  </div>

                  <div className="mt-1 text-sm font-semibold text-slate-800">
                    {me?.parent ? "Responsável" : roleLabel(currentRole)}
                  </div>
                </div>

                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Escola ID
                  </div>

                  <div className="mt-1 break-all font-mono text-xs text-slate-600">
                    {me?.school?.schoolId || me?.parent?.schoolId || "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-blue-200 bg-blue-50 p-5">
              <div className="text-sm font-semibold text-blue-900">
                Recomendação de segurança
              </div>

              <p className="mt-2 text-sm leading-6 text-blue-800">
                Use uma senha diferente da senha do seu e-mail e evite combinações
                simples como datas de nascimento ou sequências numéricas.
              </p>
            </div>
          </div>

          <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Nova senha
                </div>

                <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-900">
                  Definir nova senha de acesso
                </h2>

                <p className="mt-2 break-words text-sm leading-6 text-slate-500">
                  A nova senha será usada no próximo login deste usuário.
                </p>
              </div>

              <div
                className={`rounded-full border px-4 py-2 text-xs font-semibold ${strength.className}`}
              >
                {strength.label}
              </div>
            </div>

            <div className="mt-6 space-y-4">
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
                  Requisitos mínimos
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
                  <li>• Recomendado: usar também símbolo e letras maiúsculas.</li>
                </ul>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={!canSubmit}
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Alterando senha..." : "Alterar senha"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setNewPassword("");
                    setConfirmPassword("");
                    setError(null);
                    setSuccess(null);
                  }}
                  disabled={saving}
                  className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Limpar campos
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}