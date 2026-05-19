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

function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M4 20V9.8L12 4l8 5.8V20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 20v-6h6v6M7 12h2M15 12h2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M12 3l7 3v5.2c0 4.4-2.8 8.3-7 9.8-4.2-1.5-7-5.4-7-9.8V6l7-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12l1.7 1.7L15 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M5 5h14v10H8l-3 3V5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M4 19h16M7 16v-5M12 16V8M17 16v-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7 10l5-3 5 1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
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

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0"
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
        d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLogin() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"
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
    <div className="inline-flex rounded-[30px] border border-white/35 bg-white px-6 py-5 shadow-[0_26px_70px_rgba(2,6,23,0.28)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OFFICIAL_LOGO_SRC}
        alt="Minha Escola - Gestão Escolar Inteligente"
        className="h-[86px] w-[360px] object-contain md:h-[96px] md:w-[410px]"
        draggable={false}
      />
    </div>
  );
}

function MobileBrandLogo() {
  return (
    <div className="inline-flex rounded-[26px] border border-slate-200 bg-white px-5 py-4 shadow-[0_20px_50px_rgba(15,23,42,0.12)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OFFICIAL_LOGO_SRC}
        alt="Minha Escola - Gestão Escolar Inteligente"
        className="h-[70px] w-[290px] object-contain"
        draggable={false}
      />
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
  color,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: "green" | "blue" | "yellow";
}) {
  const colorClass =
    color === "green"
      ? "from-emerald-400 to-green-600 text-white shadow-emerald-950/25"
      : color === "blue"
        ? "from-blue-400 to-blue-700 text-white shadow-blue-950/25"
        : "from-yellow-300 to-yellow-500 text-white shadow-yellow-950/20";

  return (
    <div className="rounded-[22px] border border-white/14 bg-white/[0.07] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl md:p-5">
      <div className="flex items-start gap-4">
        <div
          className={[
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-xl",
            colorClass,
          ].join(" ")}
        >
          {icon}
        </div>

        <div className="min-w-0">
          <div className="text-sm font-extrabold text-white">{title}</div>
          <div className="mt-1.5 text-xs leading-5 text-blue-50/82 md:text-[13px]">
            {description}
          </div>
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

  async function onSubmitLogin(e: React.FormEvent) {
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
      <div className="flex min-h-screen items-center justify-center bg-[#f4f8ff] p-6">
        <div className="w-full max-w-md rounded-[34px] border border-slate-200 bg-white p-8 text-center shadow-[0_28px_90px_rgba(15,23,42,0.12)]">
          <MobileBrandLogo />

          <h1 className="mt-7 text-2xl font-extrabold text-slate-950">
            Carregando...
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Validando sessão ou link de recuperação.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f8ff]">
      <div className="grid min-h-screen lg:grid-cols-[1.02fr_0.98fr]">
        <section className="relative hidden min-h-screen overflow-hidden bg-[#071b47] lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(34,99,235,0.70),transparent_28%),radial-gradient(circle_at_83%_18%,rgba(22,163,74,0.32),transparent_30%),linear-gradient(135deg,#071b47_0%,#07225a_45%,#053f38_100%)]" />

          <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.85)_1px,transparent_1px)] [background-size:38px_38px]" />

          <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full border border-emerald-300/20" />
          <div className="absolute -bottom-36 -left-36 h-[520px] w-[520px] rounded-full border border-emerald-300/14" />
          <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full border border-white/10" />
          <div className="absolute left-8 top-8 grid grid-cols-6 gap-4 opacity-25">
            {Array.from({ length: 30 }).map((_, index) => (
              <span key={index} className="h-1 w-1 rounded-full bg-white" />
            ))}
          </div>

          <div className="absolute right-0 top-0 h-full w-[46%] bg-[radial-gradient(circle_at_70%_25%,rgba(255,255,255,0.10),transparent_18%),linear-gradient(90deg,transparent,rgba(5,150,105,0.20))]" />

          <div className="relative z-10 flex w-full flex-col justify-center px-12 py-10 2xl:px-20">
            <div className="max-w-[760px]">
              <BrandLogo />

              <h1 className="mt-14 text-[52px] font-black leading-[1.08] tracking-[-0.045em] text-white 2xl:text-[64px]">
                Gestão escolar inteligente
                <br />
                para escolas{" "}
                <span className="text-[#35c85a]">organizadas</span>
                <br />e <span className="text-[#ffd400]">conectadas.</span>
              </h1>

              <p className="mt-6 max-w-[620px] text-[17px] leading-8 text-blue-50/90">
                Centralize a gestão da sua escola com eficiência e segurança.
                Direção, professores, alunos e responsáveis conectados em um só
                lugar.
              </p>

              <div className="mt-7 grid max-w-[690px] gap-4 md:grid-cols-2">
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
                  description="Facilite o diálogo entre escola, professores, alunos e famílias de forma rápida."
                />

                <FeatureCard
                  icon={<IconChart />}
                  color="green"
                  title="Gestão pedagógica"
                  description="Acompanhe o desempenho acadêmico e tome decisões com base em dados reais."
                />
              </div>

              <div className="mt-7 inline-flex items-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-5 py-3 text-sm font-semibold text-emerald-100">
                <IconLock />
                Plataforma segura, organizada e pronta para crescer.
              </div>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center overflow-hidden p-5 md:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.10),transparent_34%),linear-gradient(180deg,#ffffff_0%,#f4f8ff_52%,#edf5ff_100%)]" />

          <div className="relative w-full max-w-[560px]">
            <div className="mb-6 flex justify-center lg:hidden">
              <MobileBrandLogo />
            </div>

            <div className="rounded-[40px] border border-white bg-white/92 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.13)] ring-1 ring-blue-950/5 backdrop-blur-xl md:p-8">
              <div className="mb-8 grid grid-cols-2 overflow-hidden rounded-[18px] border border-slate-200 bg-slate-50 shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                    setMessage(null);
                  }}
                  className={[
                    "relative flex items-center justify-center gap-2 px-4 py-5 text-sm font-extrabold transition",
                    mode === "login"
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
                  ].join(" ")}
                >
                  <IconUser />
                  Entrar
                  {mode === "login" && (
                    <span className="absolute bottom-0 left-0 h-1 w-full bg-blue-600" />
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
                    "relative flex items-center justify-center gap-2 px-4 py-5 text-sm font-extrabold transition",
                    mode === "signup"
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
                  ].join(" ")}
                >
                  <IconUserPlus />
                  Criar diretor
                  {mode === "signup" && (
                    <span className="absolute bottom-0 left-0 h-1 w-full bg-blue-600" />
                  )}
                </button>
              </div>

              {mode === "login" ? (
                <>
                  <div className="mb-7 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                        <IconShield />
                      </div>

                      <div>
                        <div className="font-extrabold text-slate-900">
                          Acesso seguro
                        </div>
                        <div className="text-sm text-slate-500">
                          Seus dados sempre protegidos
                        </div>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                      {error}
                    </div>
                  )}

                  {message && (
                    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
                      {message}
                    </div>
                  )}

                  <form onSubmit={onSubmitLogin} className="space-y-5">
                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                        E-mail
                      </label>

                      <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                          <IconMail />
                        </div>

                        <input
                          className="w-full rounded-2xl border border-slate-300 bg-white px-12 py-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
                      <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                        Senha
                      </label>

                      <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                          <IconLock />
                        </div>

                        <input
                          className="w-full rounded-2xl border border-slate-300 bg-white px-12 py-4 pr-14 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                          aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        >
                          <IconEye />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={rememberAccess}
                          onChange={(e) => setRememberAccess(e.target.checked)}
                          className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        Lembrar meu acesso
                      </label>

                      <button
                        type="button"
                        onClick={() => router.push("/forgot-password")}
                        className="text-sm font-extrabold text-blue-700 transition hover:text-blue-900 hover:underline"
                      >
                        Esqueci minha senha
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-700 to-blue-600 px-5 py-4 text-sm font-black text-white shadow-[0_22px_46px_rgba(37,99,235,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_56px_rgba(37,99,235,0.38)] disabled:translate-y-0 disabled:opacity-60"
                    >
                      <IconLogin />
                      {loading ? "Entrando..." : "Entrar na plataforma"}
                    </button>
                  </form>

                  <p className="mt-6 text-center text-sm font-medium text-slate-400">
                    Não possui uma conta? Fale com o diretor da sua escola.
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-7 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                        <IconUserPlus />
                      </div>

                      <div>
                        <div className="font-extrabold text-slate-900">
                          Primeira implantação
                        </div>
                        <div className="text-sm text-slate-500">
                          Cadastre a escola e o primeiro diretor.
                        </div>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                      {error}
                    </div>
                  )}

                  {message && (
                    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
                      {message}
                    </div>
                  )}

                  <form onSubmit={onSubmitDirectorSignup} className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                        Nome do diretor
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                        value={directorName}
                        onChange={(e) => setDirectorName(e.target.value)}
                        type="text"
                        required
                        placeholder="Ex: Maria Fernanda Silva"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                        Nome da escola
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        type="text"
                        required
                        placeholder="Ex: Escola Canaã"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                        E-mail
                      </label>

                      <input
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
                        <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                          Senha
                        </label>

                        <input
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                          value={directorPassword}
                          onChange={(e) => setDirectorPassword(e.target.value)}
                          autoComplete="new-password"
                          type="password"
                          required
                          placeholder="Mínimo 6 caracteres"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-950">
                          Confirmar senha
                        </label>

                        <input
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
                      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-700 to-blue-600 px-5 py-4 text-sm font-black text-white shadow-[0_22px_46px_rgba(37,99,235,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_56px_rgba(37,99,235,0.38)] disabled:translate-y-0 disabled:opacity-60"
                    >
                      <IconUserPlus />
                      {loading ? "Criando conta..." : "Criar diretor"}
                    </button>
                  </form>
                </>
              )}

              <div className="my-6 flex items-center gap-3">
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
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-5 py-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <GoogleIcon />

                {googleLoading
                  ? "Conectando com Google..."
                  : mode === "signup"
                    ? "Criar diretor com Google"
                    : "Entrar com Google"}
              </button>
            </div>

            <div className="mt-9 flex items-center justify-center gap-2 text-center text-sm font-medium text-slate-500">
              <div className="text-slate-400">
                <IconShield />
              </div>
              Tecnologia segura, educação conectada e futuro inteligente.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}