"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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

type DirectorGoogleDraft = {
  fullName: string;
  schoolName: string;
};

const DIRECTOR_GOOGLE_DRAFT_KEY = "director_signup_google_draft";
const OFFICIAL_LOGO_SRC = "/brand/minha-escola-logo.png";
const STUDENTS_BG_SRC = "/brand/login-students-bg.png";

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

  if (!raw) return "Não foi possível entrar. Verifique e-mail e senha.";

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

function IconUserLogin() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M10.5 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M3.75 20a6.75 6.75 0 0 1 11.9-4.35"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 14v5M14.5 16.5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconUserPlus() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20a7 7 0 0 1 12.5-4.3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M19 14v6M16 17h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M4 7h16v10H4V7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M4 8l8 5 8-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M7 11h10v8H7v-8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 11V8a3 3 0 0 1 6 0v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function IconEnter() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M10 17l5-5-5-5"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 12H4"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M14 4h4.2A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8H14"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
      <path
        d="M12 3.5 19 6.4v5.3c0 4.3-2.75 8.1-7 9.55-4.25-1.45-7-5.25-7-9.55V6.4l7-2.9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m9.35 12.05 1.75 1.75 3.75-4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path
        d="M4.5 20V10.2L12 4.8l7.5 5.4V20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 20v-6h6v6M7 12.5h2M15 12.5h2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path
        d="M5 5.5h14v10H8.5L5 18.5v-13Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path
        d="M4 19h16M7.5 16v-4.5M12 16V8.5M16.5 16V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m7.5 11.5 4.5-3 4.5 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

function BrandLogo() {
  return (
    <div className="inline-flex rounded-[26px] bg-white px-7 py-5 shadow-[0_26px_60px_rgba(0,0,0,0.28)] ring-1 ring-white/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OFFICIAL_LOGO_SRC}
        alt="Minha Escola - Gestão Escolar Inteligente"
        className="h-[96px] w-[390px] object-contain"
        draggable={false}
      />
    </div>
  );
}

function MobileBrandLogo() {
  return (
    <div className="inline-flex rounded-[24px] bg-white px-5 py-4 shadow-[0_20px_45px_rgba(15,23,42,0.13)] ring-1 ring-slate-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OFFICIAL_LOGO_SRC}
        alt="Minha Escola - Gestão Escolar Inteligente"
        className="h-[76px] w-[310px] object-contain"
        draggable={false}
      />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  color: "green" | "blue" | "yellow";
}) {
  const colorClasses =
    color === "green"
      ? "bg-gradient-to-br from-[#3ad45d] to-[#0d8f36] shadow-[0_14px_28px_rgba(17,168,73,0.35)]"
      : color === "blue"
        ? "bg-gradient-to-br from-[#35a5ff] to-[#005bea] shadow-[0_14px_28px_rgba(0,91,234,0.35)]"
        : "bg-gradient-to-br from-[#ffe145] to-[#f6b900] shadow-[0_14px_28px_rgba(246,185,0,0.35)]";

  return (
    <div className="min-h-[108px] rounded-[14px] border border-white/16 bg-white/[0.055] px-4 py-4 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div
          className={[
            "flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full text-white",
            colorClasses,
          ].join(" ")}
        >
          {icon}
        </div>

        <div className="min-w-0">
          <h3 className="text-[14px] font-extrabold leading-tight text-white">
            {title}
          </h3>

          <p className="mt-2 text-[12.5px] font-medium leading-[1.45] text-white/86">
            {description}
          </p>
        </div>
      </div>
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
  const [rememberAccess, setRememberAccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  async function onSubmitLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      clearDirectorGoogleDraft();

      const cleanEmail = email.trim().toLowerCase();

      if (typeof window !== "undefined") {
        if (rememberAccess) {
          window.localStorage.setItem("login_email_hint", cleanEmail);
        } else {
          window.localStorage.removeItem("login_email_hint");
        }
      }

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

  async function onSubmitDirectorSignup(e: FormEvent) {
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
        if (typeof window !== "undefined") {
          const savedEmail = window.localStorage.getItem("login_email_hint");

          if (savedEmail) {
            setEmail(savedEmail);
            setRememberAccess(true);
          }
        }

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
      <main className="flex min-h-screen items-center justify-center bg-[#f4f8ff] p-6">
        <div className="w-full max-w-md rounded-[34px] border border-slate-200 bg-white p-8 text-center shadow-[0_28px_90px_rgba(15,23,42,0.12)]">
          <MobileBrandLogo />

          <h1 className="mt-7 text-2xl font-extrabold text-slate-950">
            Carregando...
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Validando sessão ou link de recuperação.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f8ff]">
      <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
        <section className="relative hidden min-h-screen overflow-hidden bg-[#061b4a] lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(0,89,220,0.78),transparent_34%),radial-gradient(circle_at_88%_30%,rgba(0,167,123,0.55),transparent_36%),linear-gradient(135deg,#06174a_0%,#092c6d_42%,#006956_100%)]" />

          <div
            className="absolute bottom-[18%] right-[-2%] top-[9%] w-[46%] bg-contain bg-center bg-no-repeat opacity-[0.60]"
            style={{ backgroundImage: `url(${STUDENTS_BG_SRC})` }}
          />

          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,15,52,0.05)_0%,rgba(4,15,52,0.10)_45%,rgba(0,113,93,0.08)_100%)]" />

          <div className="absolute left-[22px] top-[24px] grid grid-cols-4 gap-[16px] opacity-45">
            {Array.from({ length: 24 }).map((_, index) => (
              <span key={index} className="h-[4px] w-[4px] rounded-full bg-white/65" />
            ))}
          </div>

          <div className="absolute -bottom-[120px] -left-[140px] h-[360px] w-[360px] rounded-full border border-[#21b75a]/45" />
          <div className="absolute -bottom-[165px] -left-[190px] h-[520px] w-[520px] rounded-full border border-[#21b75a]/25" />
          <div className="absolute -bottom-[230px] right-[-120px] h-[420px] w-[420px] rounded-full border border-[#2366c9]/25" />
          <div className="absolute -bottom-[270px] right-[-165px] h-[560px] w-[560px] rounded-full border border-[#2366c9]/18" />
          <div className="absolute -right-[65px] -top-[90px] h-[260px] w-[260px] rounded-full border border-white/10" />

          <div className="relative z-10 flex w-full items-center justify-center px-10 py-10">
            <div className="w-full max-w-[680px]">
              <BrandLogo />

              <h1 className="mt-[58px] text-[43px] font-black leading-[1.13] tracking-[-0.04em] text-white xl:text-[47px] 2xl:text-[52px]">
                Gestão escolar inteligente
                <br />
                para escolas{" "}
                <span className="text-[#30bd42]">organizadas</span>
                <br />e{" "}
                <span className="text-[#ffd400]">conectadas.</span>
              </h1>

              <p className="mt-[22px] max-w-[555px] text-[16px] font-medium leading-[1.55] text-white/92">
                Centralize a gestão da sua escola com eficiência e segurança.
                <br />
                Direção, professores, alunos e responsáveis conectados
                <br />
                em um só lugar.
              </p>

              <div className="mt-[24px] grid max-w-[600px] grid-cols-2 gap-[14px]">
                <FeatureCard
                  icon={<IconBuilding />}
                  color="green"
                  title="Organização centralizada"
                  description="Tenha todas as informações da sua escola em um só lugar, com mais controle e eficiência."
                />

                <FeatureCard
                  icon={<IconShield />}
                  color="blue"
                  title="Ambiente seguro"
                  description="Seus dados protegidos com tecnologia de ponta e acesso seguro para cada usuário."
                />

                <FeatureCard
                  icon={<IconChat />}
                  color="yellow"
                  title="Comunicação eficiente"
                  description="Facilite o diálogo entre escola, professores, alunos e famílias de forma rápida e transparente."
                />

                <FeatureCard
                  icon={<IconChart />}
                  color="green"
                  title="Gestão pedagógica"
                  description="Acompanhe o desempenho acadêmico e tome decisões com base em dados reais."
                />
              </div>

              <div className="mt-[21px] inline-flex min-w-[450px] items-center justify-center gap-3 rounded-[11px] border border-[#21d060]/45 bg-[#0b7247]/28 px-5 py-3 text-[14px] font-semibold text-[#a9ffc5]">
                <span className="text-[#27df68]">
                  <IconLock />
                </span>
                Plataforma 100% segura e em conformidade com a LGPD
              </div>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10 md:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(37,99,235,0.10),transparent_31%),linear-gradient(180deg,#ffffff_0%,#f8fbff_46%,#eff6ff_100%)]" />

          <div className="relative flex w-full max-w-[650px] flex-col items-center">
            <div className="mb-7 flex justify-center lg:hidden">
              <MobileBrandLogo />
            </div>

            <div className="w-full max-w-[575px] rounded-[32px] border border-white bg-white/96 px-[32px] py-[30px] shadow-[0_28px_88px_rgba(15,23,42,0.13)] ring-1 ring-blue-950/5 backdrop-blur-xl xl:px-[36px] xl:py-[32px]">
              <div className="grid h-[72px] grid-cols-2 overflow-hidden rounded-[8px] border border-slate-200 bg-[#f7f9fc] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                    setMessage(null);
                  }}
                  className={[
                    "relative flex items-center justify-center gap-2 text-[15px] font-extrabold transition",
                    mode === "login"
                      ? "bg-white text-[#005bea]"
                      : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
                  ].join(" ")}
                >
                  <IconUserLogin />
                  Entrar
                  {mode === "login" && (
                    <span className="absolute bottom-0 left-0 h-[3px] w-full bg-[#005bea]" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setMessage(null);
                  }}
                  className={[
                    "relative flex items-center justify-center gap-2 text-[15px] font-extrabold transition",
                    mode === "signup"
                      ? "bg-white text-[#005bea]"
                      : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
                  ].join(" ")}
                >
                  <IconUserPlus />
                  Criar diretor
                  {mode === "signup" && (
                    <span className="absolute bottom-0 left-0 h-[3px] w-full bg-[#005bea]" />
                  )}
                </button>
              </div>

              {mode === "login" ? (
                <>
                  <div className="mt-[28px] rounded-[10px] border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-5 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center text-[#41c764]">
                        <IconShield />
                      </div>

                      <div>
                        <div className="text-[16px] font-extrabold leading-tight text-slate-800">
                          Acesso seguro
                        </div>
                        <div className="mt-1 text-[13px] font-medium text-slate-500">
                          Seus dados sempre protegidos
                        </div>
                      </div>
                    </div>
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

                  <form onSubmit={onSubmitLogin} className="mt-[27px] space-y-[22px]">
                    <div>
                      <label className="mb-[10px] block text-[14px] font-black uppercase tracking-[-0.01em] text-[#070d25]">
                        E-mail
                      </label>

                      <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                          <IconMail />
                        </div>

                        <input
                          className="h-[56px] w-full rounded-[10px] border border-slate-300 bg-white px-12 text-[15px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                          type="email"
                          required
                          placeholder="voce@escola.com"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-[10px] block text-[14px] font-black uppercase tracking-[-0.01em] text-[#070d25]">
                        Senha
                      </label>

                      <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                          <IconLock />
                        </div>

                        <input
                          className="h-[56px] w-full rounded-[10px] border border-slate-300 bg-white px-12 pr-14 text-[15px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete="current-password"
                          type={showPassword ? "text" : "password"}
                          required
                          placeholder="Sua senha"
                        />

                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-800"
                          aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        >
                          <IconEye />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-1">
                      <label className="flex cursor-pointer items-center gap-3 text-[14px] font-medium text-[#162039]">
                        <input
                          type="checkbox"
                          checked={rememberAccess}
                          onChange={(e) => setRememberAccess(e.target.checked)}
                          className="h-[20px] w-[20px] rounded border-slate-300 text-[#005bea] focus:ring-[#005bea]"
                        />
                        Lembrar meu acesso
                      </label>

                      <button
                        type="button"
                        onClick={() => router.push("/forgot-password")}
                        className="text-[14px] font-extrabold text-[#005bea] transition hover:text-blue-800 hover:underline"
                      >
                        Esqueci minha senha
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="flex h-[60px] w-full items-center justify-center gap-3 rounded-[9px] bg-gradient-to-r from-[#005bea] to-[#004ce0] text-[18px] font-black text-white shadow-[0_16px_34px_rgba(0,91,234,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(0,91,234,0.38)] disabled:translate-y-0 disabled:opacity-60"
                    >
                      <IconEnter />
                      {loading ? "Entrando..." : "Entrar na plataforma"}
                    </button>
                  </form>

                  <p className="mt-[20px] text-center text-[14px] font-medium text-slate-400">
                    Não possui uma conta? Fale com o diretor da sua escola.
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-[28px] rounded-[10px] border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-5 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center text-[#005bea]">
                        <IconUserPlus />
                      </div>

                      <div>
                        <div className="text-[16px] font-extrabold leading-tight text-slate-800">
                          Primeira implantação
                        </div>
                        <div className="mt-1 text-[13px] font-medium text-slate-500">
                          Cadastre a escola e o primeiro diretor.
                        </div>
                      </div>
                    </div>
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

                  <form
                    onSubmit={onSubmitDirectorSignup}
                    className="mt-[27px] space-y-[16px]"
                  >
                    <div>
                      <label className="mb-[8px] block text-[13px] font-black uppercase text-[#070d25]">
                        Nome do diretor
                      </label>

                      <input
                        className="h-[52px] w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
                        value={directorName}
                        onChange={(e) => setDirectorName(e.target.value)}
                        type="text"
                        required
                        placeholder="Ex: Maria Fernanda Silva"
                      />
                    </div>

                    <div>
                      <label className="mb-[8px] block text-[13px] font-black uppercase text-[#070d25]">
                        Nome da escola
                      </label>

                      <input
                        className="h-[52px] w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        type="text"
                        required
                        placeholder="Ex: Escola Canaã"
                      />
                    </div>

                    <div>
                      <label className="mb-[8px] block text-[13px] font-black uppercase text-[#070d25]">
                        E-mail
                      </label>

                      <input
                        className="h-[52px] w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
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
                        <label className="mb-[8px] block text-[13px] font-black uppercase text-[#070d25]">
                          Senha
                        </label>

                        <input
                          className="h-[52px] w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
                          value={directorPassword}
                          onChange={(e) => setDirectorPassword(e.target.value)}
                          autoComplete="new-password"
                          type="password"
                          required
                          placeholder="Mínimo 6 caracteres"
                        />
                      </div>

                      <div>
                        <label className="mb-[8px] block text-[13px] font-black uppercase text-[#070d25]">
                          Confirmar senha
                        </label>

                        <input
                          className="h-[52px] w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#005bea] focus:ring-4 focus:ring-blue-100"
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
                      className="flex h-[56px] w-full items-center justify-center gap-3 rounded-[9px] bg-gradient-to-r from-[#005bea] to-[#004ce0] text-[16px] font-black text-white shadow-[0_16px_34px_rgba(0,91,234,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(0,91,234,0.38)] disabled:translate-y-0 disabled:opacity-60"
                    >
                      <IconUserPlus />
                      {loading ? "Criando conta..." : "Criar diretor"}
                    </button>
                  </form>

                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      ou continue com
                    </span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={googleLoading}
                    className="flex h-[54px] w-full items-center justify-center gap-3 rounded-[10px] border border-slate-300 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <GoogleIcon />
                    {googleLoading ? "Conectando com Google..." : "Criar diretor com Google"}
                  </button>
                </>
              )}
            </div>

            <div className="mt-[54px] flex items-center justify-center gap-3 text-center text-[14px] font-medium text-slate-500">
              <span className="text-slate-500">
                <IconShield />
              </span>
              Tecnologia segura, educação conectada e futuro inteligente.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}