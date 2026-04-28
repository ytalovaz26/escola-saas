"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SchoolPayload = {
  id: string;
  name: string | null;
  slug: string | null;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandIconUrl: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  appName: string;
  logoUrl: string | null;
  iconUrl: string;
  manifestUrl: string;
};

type LoginClientProps = {
  slug: string;
  initialEmail?: string;
  school: SchoolPayload;
};

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

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();

  if (!safe) return "ES";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor." };
  }
}

async function callMe(accessToken: string): Promise<MeResponse | null> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  return safeJson(res);
}

function forceSchoolHead(params: {
  title: string;
  manifestHref: string;
  iconHref: string;
  themeColor: string;
}) {
  if (typeof document === "undefined") return;

  document.title = params.title;

  const oldManifests = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]')
  );

  for (const old of oldManifests) {
    old.remove();
  }

  const oldIcons = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
    )
  );

  for (const old of oldIcons) {
    old.remove();
  }

  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = params.manifestHref;
  manifest.id = "school-dynamic-manifest";
  document.head.appendChild(manifest);

  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = params.iconHref;
  icon.type = "image/png";
  icon.sizes = "512x512";
  icon.id = "school-dynamic-icon";
  document.head.appendChild(icon);

  const shortcutIcon = document.createElement("link");
  shortcutIcon.rel = "shortcut icon";
  shortcutIcon.href = params.iconHref;
  shortcutIcon.type = "image/png";
  shortcutIcon.sizes = "512x512";
  shortcutIcon.id = "school-dynamic-shortcut-icon";
  document.head.appendChild(shortcutIcon);

  const appleIcon = document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  appleIcon.href = params.iconHref;
  appleIcon.sizes = "512x512";
  appleIcon.id = "school-dynamic-apple-icon";
  document.head.appendChild(appleIcon);

  const oldTheme = document.head.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );

  if (oldTheme) {
    oldTheme.content = params.themeColor;
  } else {
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = params.themeColor;
    document.head.appendChild(theme);
  }

  const oldAppleTitle = document.head.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]'
  );

  if (oldAppleTitle) {
    oldAppleTitle.content = params.title;
  } else {
    const appleTitle = document.createElement("meta");
    appleTitle.name = "apple-mobile-web-app-title";
    appleTitle.content = params.title;
    document.head.appendChild(appleTitle);
  }

  const oldCapable = document.head.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-capable"]'
  );

  if (oldCapable) {
    oldCapable.content = "yes";
  } else {
    const capable = document.createElement("meta");
    capable.name = "apple-mobile-web-app-capable";
    capable.content = "yes";
    document.head.appendChild(capable);
  }
}

export default function LoginClient({ slug, initialEmail = "", school }: LoginClientProps) {
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const appName = school.appName;
  const logoUrl = school.logoUrl;
  const primaryColor = school.primaryColor;
  const secondaryColor = school.secondaryColor;
  const iconUrl = school.iconUrl;
  const manifestUrl = school.manifestUrl;

  useEffect(() => {
    forceSchoolHead({
      title: appName,
      manifestHref: manifestUrl,
      iconHref: iconUrl,
      themeColor: primaryColor,
    });
  }, [appName, manifestUrl, iconUrl, primaryColor]);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const { data } = await supabase.auth.getSession();

        if (cancelled) return;

        const token = data.session?.access_token;

        if (!token) return;

        const me = await callMe(token);

        if (cancelled) return;

        if (!me || (me as any).ok !== true) return;

        const redirectTo = (me as any).redirectTo || "/";

        router.replace(redirectTo);
      } catch {
        // Não trava tela pública.
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    }

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function redirectByMe(accessToken: string) {
    const me = await callMe(accessToken);

    if (!me || (me as any).ok !== true) {
      return false;
    }

    const redirectTo = (me as any).redirectTo || "/";

    router.replace(redirectTo);

    return true;
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    try {
      setSubmitting(true);
      setError(null);

      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInErr) {
        setError(signInErr.message || "Erro ao entrar.");
        return;
      }

      const token = data.session?.access_token;

      if (!token) {
        setError("Login realizado, mas a sessão não foi encontrada.");
        return;
      }

      const redirected = await redirectByMe(token);

      if (!redirected) {
        router.replace("/login");
      }
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="h-14 w-14 animate-pulse rounded-2xl bg-slate-200" />

          <h1 className="mt-5 text-2xl font-semibold text-slate-900">
            Carregando portal...
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Preparando o acesso da escola.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-slate-100 px-4 py-8 md:px-6"
      style={{
        background:
          "linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%)",
      }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[40px] border border-slate-200 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.12)] lg:grid-cols-[1fr_0.9fr]">
          <div
            className="relative overflow-hidden px-6 py-10 text-white md:px-10"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
            }}
          >
            <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.8)_1px,transparent_1px)] [background-size:32px_32px]" />

            <div className="relative z-10 flex min-h-full flex-col justify-center">
              <div>
                <div className="flex items-center gap-4">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt={appName}
                      className="h-20 w-28 rounded-3xl border border-white/20 bg-white/95 object-contain p-3 shadow-sm"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/20 bg-white/10 text-xl font-bold">
                      {getInitials(appName)}
                    </div>
                  )}

                  <div>
                    <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
                      Portal oficial da escola
                    </div>

                    <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                      {appName}
                    </h1>
                  </div>
                </div>

                <p className="mt-8 max-w-xl text-base leading-7 text-white/85">
                  Acesse o portal escolar para acompanhar presença, comunicados,
                  informações acadêmicas e rotinas da escola.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center p-6 md:p-10">
            <div className="w-full max-w-md">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
                  Entrar na plataforma
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Use seu e-mail e senha cadastrados pela escola.
                </p>
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    E-mail
                  </label>

                  <input
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    type="email"
                    required
                    placeholder="voce@escola.com"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Senha
                  </label>

                  <input
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
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
                  disabled={submitting}
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? "Entrando..." : "Entrar"}
                </button>
              </form>

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">
                  Está instalando no celular?
                </div>

                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Para instalar com o ícone correto, volte para a página pública da escola
                  e use a opção “Adicionar à Tela de Início”.
                </p>

                <Link
                  href={`/s/${slug}`}
                  className="mt-3 inline-flex rounded-2xl border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Ver página de instalação
                </Link>
              </div>

              <div className="mt-5 text-center text-xs text-slate-400">
                Portal escolar • {appName}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}