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
  | { ok: false; error?: string; status?: number };

const DIRECTOR_GOOGLE_DRAFT_KEY = "director_signup_google_draft";
const OFFICIAL_LOGO_SRC = "/brand/minha-escola-logo.png";

type DirectorGoogleDraft = {
  fullName: string;
  schoolName: string;
};

async function readJsonSafely(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error:
        text.startsWith("<!DOCTYPE") || text.startsWith("<html")
          ? `A rota retornou HTML em vez de JSON. Status: ${res.status}. Verifique o terminal do Next.js para o erro real.`
          : text,
    };
  }
}

async function callMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const json = await readJsonSafely(res);

  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      status: res.status,
      error: json?.error || `Falha ao carregar /api/me. Status: ${res.status}`,
    };
  }

  return json as MeResponse;
}

function parseHashParams(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

function saveDirectorGoogleDraft(draft: DirectorGoogleDraft) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DIRECTOR_GOOGLE_DRAFT_KEY, JSON.stringify(draft));
}

function clearDirectorGoogleDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DIRECTOR_GOOGLE_DRAFT_KEY);
}

function friendlyAuthError(message?: string) {
  const raw = String(message || "").trim();

  if (!raw) {
    return "Não foi possível entrar. Verifique e-mail e senha.";
  }

  const lower = raw.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "E-mail ou senha inválidos. Verifique os dados e tente novamente.";
  }

  if (lower.includes("email not confirmed")) {
    return "Este e-mail ainda não foi confirmado. Verifique o convite recebido no e-mail ou peça para a escola definir uma senha temporária.";
  }

  if (lower.includes("signup disabled")) {
    return "Cadastro direto está desativado. Peça para a escola criar seu acesso.";
  }

  if (lower.includes("sign in failed")) {
    return "Falha ao entrar. Se este usuário foi criado por convite, defina uma senha temporária na tela Equipe Escolar ou aceite o convite por e-mail.";
  }

  return raw;
}

function BrandLogo({
  compact = false,
  light = false,
  centered = false,
}: {
  compact?: boolean;
  light?: boolean;
  centered?: boolean;
}) {
  return (
    <div
      className={[
        "flex min-w-0 items-center",
        compact ? "gap-3" : "gap-4",
        centered ? "justify-center" : "",
      ].join(" ")}
    >
      <div
        className={[
          "relative shrink-0 overflow-hidden rounded-[26px] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.22)] ring-1",
          compact ? "h-16 w-16" : "h-24 w-24",
          light ? "ring-slate-200" : "ring-white/20",
        ].join(" ")}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-emerald-50" />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={OFFICIAL_LOGO_SRC}
          alt="Minha Escola - Gestão Escolar Inteligente"
          className="relative h-full w-full object-contain p-1.5"
          draggable={false}
        />
      </div>

      <div className="min-w-0">
        <div
          className={[
            "font-extrabold leading-none tracking-tight",
            compact ? "text-2xl" : "text-4xl",
            light ? "text-slate-950" : "text-white",
          ].join(" ")}
        >
          <span>minha</span>
          <br />
          <span className={light ? "text-emerald-700" : "text-emerald-300"}>
            escola
          </span>
        </div>

        <div
          className={[
            "mt-2 font-semibold uppercase tracking-[0.18em]",
            compact ? "text-[9px]" : "text-xs",
            light ? "text-slate-500" : "text-slate-300",
          ].join(" ")}
        >
          Gestão Escolar Inteligente
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.805 10.023H12.24v3.955h5.48c-.236 1.272-.963 2.35-2.054 3.072v2.554h3.32c1.943-1.79 3.06-4.431 3.06-7.57 0-.67-.06-1.313-.171-1.954Z"
        fill="#4285F4"
      />
      <path
        d="M12.24 22c2.76 0 5.075-.914 6.767-2.473l-3.32-2.554c-.922.618-2.1.983-3.447.983-2.648 0-4.892-1.788-5.693-4.193H3.116v2.635A10.215 10.215 0 0 0 12.24 22Z"
        fill="#34A853"
      />
      <path
        d="M6.547 13.763a6.13 6.13 0 0 1-.318-1.94c0-.674.114-1.327.318-1.94V7.248H3.116A10.215 10.215 0 0 0 2 11.823c0 1.64.393 3.19 1.116 4.575l3.431-2.635Z"
        fill="#FBBC05"
      />
      <path
        d="M12.24 5.69c1.5 0 2.845.516 3.904 1.53l2.926-2.926C17.31 2.655 15 1.646 12.24 1.646A10.215 10.215 0 0 0 3.116 7.248l3.431 2.635C7.348 7.478 9.592 5.69 12.24 5.69Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-xl">
        {icon}
      </div>

      <div className="mt-4 text-sm font-bold text-white">{title}</div>

      <div className="mt-2 text-sm leading-6 text-slate-300">{description}</div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [directorName, setDirectorName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [directorEmail, setDirectorEmail] = useState("");
  const [directorPassword, setDirectorPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handledRecoveryRef = useRef(false);

  async function redirectByMe() {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();

    if (sessErr) {
      throw new Error(sessErr.message);
    }

    const token = sessionData.session?.access_token;

    if (!token) {
      throw new Error("Sessão não encontrada após login.");
    }

    const me = await callMe(token);

    if (!me || me.ok !== true) {
      throw new Error(
        "Login realizado, mas não foi possível identificar o perfil do usuário. " +
          ((me as any)?.error || "")
      );
    }

    router.replace(me.redirectTo || "/");
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

  async function onSubmitLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      clearDirectorGoogleDraft();

      const cleanEmail = email.trim().toLowerCase();

      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInErr) {
        setError(friendlyAuthError(signInErr.message));
        return;
      }

      if (!data.session?.access_token) {
        setError(
          "Login não retornou sessão. Se este acesso foi criado por convite, defina uma senha temporária na tela Equipe Escolar."
        );
        return;
      }

      await redirectByMe();
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitDirectorSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!directorName.trim()) {
      setError("Informe o nome do diretor.");
      return;
    }

    if (!schoolName.trim()) {
      setError("Informe o nome da escola.");
      return;
    }

    if (!directorEmail.trim()) {
      setError("Informe o e-mail.");
      return;
    }

    if (directorPassword.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (directorPassword !== confirmPassword) {
      setError("A confirmação de senha não confere.");
      return;
    }

    setLoading(true);

    try {
      clearDirectorGoogleDraft();

      const res = await fetch("/api/auth/register-director", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: directorName.trim(),
          schoolName: schoolName.trim(),
          email: directorEmail.trim(),
          password: directorPassword,
        }),
      });

      const json = await readJsonSafely(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Não foi possível criar o diretor.");
        return;
      }

      setMessage("Conta de diretor criada com sucesso. Agora você já pode entrar.");
      setMode("login");
      setEmail(directorEmail.trim());
      setPassword("");
      setDirectorName("");
      setSchoolName("");
      setDirectorEmail("");
      setDirectorPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao criar conta.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleAuth() {
    setError(null);
    setMessage(null);
    setGoogleLoading(true);

    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";

      if (mode === "signup") {
        if (!directorName.trim()) {
          setError("Informe o nome do diretor antes de continuar com Google.");
          return;
        }

        if (!schoolName.trim()) {
          setError("Informe o nome da escola antes de continuar com Google.");
          return;
        }

        saveDirectorGoogleDraft({
          fullName: directorName.trim(),
          schoolName: schoolName.trim(),
        });
      } else {
        clearDirectorGoogleDraft();
      }

      const redirectTo =
        mode === "signup"
          ? `${origin}/auth/oauth-callback?flow=director_signup_google`
          : `${origin}/auth/oauth-callback?flow=login_google`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: false,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });

      if (error) {
        setError(error.message || "Não foi possível iniciar login com Google.");
        return;
      }

      if (data?.url && typeof window !== "undefined") {
        window.location.href = data.url;
      }
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao iniciar Google.");
    } finally {
      setGoogleLoading(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#eff6ff,#f8fafc,#ecfdf5)] p-6">
        <div className="w-full max-w-md rounded-[36px] border border-slate-200 bg-white/95 p-8 text-center shadow-[0_24px_90px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="mx-auto mb-6 flex justify-center">
            <BrandLogo compact light centered />
          </div>

          <h1 className="text-2xl font-semibold text-slate-900">Carregando...</h1>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Validando sessão ou link de recuperação.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_35%,#f8fafc_100%)]">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(37,99,235,0.38),transparent_28%),radial-gradient(circle_at_78%_24%,rgba(22,163,74,0.20),transparent_26%),radial-gradient(circle_at_70%_92%,rgba(250,204,21,0.16),transparent_26%),linear-gradient(135deg,#020617,#071328_42%,#0f172a)]" />

          <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.70)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.70)_1px,transparent_1px)] [background-size:34px_34px]" />

          <div className="absolute -left-28 top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="absolute bottom-0 right-10 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative z-10 flex w-full flex-col justify-between p-12 text-white 2xl:p-16">
            <div>
              <BrandLogo />

              <div className="mt-9 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                Plataforma escolar inteligente
              </div>

              <h1 className="mt-8 max-w-2xl text-5xl font-extrabold leading-tight tracking-tight 2xl:text-6xl">
                Sua escola organizada, conectada e pronta para crescer.
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-200 2xl:text-lg">
                Centralize direção, professores, alunos, responsáveis, comunicados,
                presença, diário pedagógico e gestão escolar em uma experiência moderna,
                segura e profissional.
              </p>

              <div className="mt-9 grid max-w-2xl grid-cols-2 gap-4">
                <FeatureCard
                  icon="🏫"
                  title="Gestão centralizada"
                  description="A escola acompanha rotinas, equipes, alunos e responsáveis em um só lugar."
                />

                <FeatureCard
                  icon="🔐"
                  title="Ambiente seguro"
                  description="Cada escola opera isolada com identidade própria e controle de acesso."
                />

                <FeatureCard
                  icon="📣"
                  title="Comunicação oficial"
                  description="Comunicados com confirmação de entrega e visualização por destinatário."
                />

                <FeatureCard
                  icon="📲"
                  title="Portal conectado"
                  description="Professores e responsáveis acessam informações importantes com facilidade."
                />
              </div>
            </div>

            <div className="mt-10 space-y-4">
              <div className="max-w-2xl rounded-[30px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                <div className="text-sm leading-6 text-slate-100">
                  “Uma plataforma feita para dar clareza à gestão e aproximar escola,
                  professores e famílias.”
                </div>
              </div>

              <div className="flex flex-wrap gap-3 text-xs font-medium text-slate-300">
                <span>Gestão escolar</span>
                <span>•</span>
                <span>Seguro</span>
                <span>•</span>
                <span>Multi-tenant</span>
                <span>•</span>
                <span>Comunicação inteligente</span>
                <span>•</span>
                <span>2026</span>
              </div>
            </div>
          </div>
        </section>

        <section className="relative flex items-center justify-center p-5 md:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.10),transparent_30%),radial-gradient(circle_at_bottom,_rgba(34,197,94,0.08),transparent_30%),linear-gradient(180deg,#f8fafc,#eef2ff,#f8fafc)] lg:hidden" />

          <div className="relative w-full max-w-xl">
            <div className="mb-6 flex justify-center lg:hidden">
              <div className="rounded-[28px] border border-slate-200 bg-white/95 px-5 py-4 shadow-sm backdrop-blur">
                <BrandLogo compact light />
              </div>
            </div>

            <div className="overflow-hidden rounded-[38px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.12)] backdrop-blur md:p-8">
              <div className="mb-6 flex rounded-2xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                    setMessage(null);
                  }}
                  className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    mode === "login"
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Entrar
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setMessage(null);
                  }}
                  className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    mode === "signup"
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Criar diretor
                </button>
              </div>

              {mode === "login" ? (
                <>
                  <div>
                    <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-blue-700">
                      Acesso seguro
                    </div>

                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950">
                      Entrar na plataforma
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Use seu e-mail e senha cadastrados para acessar o painel da escola.
                    </p>
                  </div>

                  {error && (
                    <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                      {error}
                    </div>
                  )}

                  {message && (
                    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
                      {message}
                    </div>
                  )}

                  <form onSubmit={onSubmitLogin} className="mt-6 space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        E-mail
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        type="email"
                        required
                        placeholder="voce@escola.com"
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Senha
                        </label>

                        <button
                          type="button"
                          onClick={() => router.push("/forgot-password")}
                          className="text-xs font-bold text-blue-700 transition hover:text-blue-900 hover:underline"
                        >
                          Esqueci minha senha
                        </button>
                      </div>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        type="password"
                        required
                        placeholder="Digite sua senha"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:opacity-95 disabled:translate-y-0 disabled:opacity-60"
                    >
                      {loading ? "Entrando..." : "Entrar"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div>
                    <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                      Primeira implantação
                    </div>

                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950">
                      Criar conta de diretor
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Cadastre a escola e o primeiro usuário diretor para iniciar a
                      configuração da plataforma.
                    </p>
                  </div>

                  {error && (
                    <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                      {error}
                    </div>
                  )}

                  {message && (
                    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
                      {message}
                    </div>
                  )}

                  <form onSubmit={onSubmitDirectorSignup} className="mt-6 space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Nome do diretor
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                        value={directorName}
                        onChange={(e) => setDirectorName(e.target.value)}
                        type="text"
                        required
                        placeholder="Ex: Maria Fernanda Silva"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Nome da escola
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        type="text"
                        required
                        placeholder="Ex: Escola Canaã"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        E-mail
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                        value={directorEmail}
                        onChange={(e) => setDirectorEmail(e.target.value)}
                        autoComplete="email"
                        type="email"
                        required
                        placeholder="diretor@escola.com"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Senha
                        </label>

                        <input
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          value={directorPassword}
                          onChange={(e) => setDirectorPassword(e.target.value)}
                          autoComplete="new-password"
                          type="password"
                          required
                          placeholder="Mínimo 6 caracteres"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Confirmar senha
                        </label>

                        <input
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          autoComplete="new-password"
                          type="password"
                          required
                          placeholder="Repita a senha"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:opacity-95 disabled:translate-y-0 disabled:opacity-60"
                    >
                      {loading ? "Criando conta..." : "Criar diretor"}
                    </button>
                  </form>
                </>
              )}

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />

                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  ou continue com
                </span>

                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <button
                type="button"
                onClick={handleGoogleAuth}
                disabled={googleLoading}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <GoogleIcon />

                {googleLoading
                  ? "Conectando com Google..."
                  : mode === "signup"
                    ? "Criar diretor com Google"
                    : "Entrar com Google"}
              </button>

              <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-center text-xs font-medium text-slate-400">
                Minha Escola • Gestão Escolar Inteligente • Seguro • Multi-tenant
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}