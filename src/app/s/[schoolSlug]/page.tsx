import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SchoolPublicPageProps = {
  params:
    | Promise<{
        schoolSlug: string;
      }>
    | {
        schoolSlug: string;
      };
};

type SchoolPublicData = {
  id: string;
  name: string | null;
  slug: string | null;
  brand_name: string | null;
  brand_logo_url: string | null;
  brand_icon_url: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

function hexColor(value: unknown, fallback: string) {
  const raw = String(value || "").trim();

  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return raw;
  }

  return fallback;
}

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function getParams(props: SchoolPublicPageProps) {
  return await Promise.resolve(props.params);
}

async function getSchool(slug: string): Promise<SchoolPublicData | null> {
  const { data, error } = await supabaseAdmin
    .from("schools")
    .select(
      `
        id,
        name,
        slug,
        brand_name,
        brand_logo_url,
        brand_icon_url,
        logo_url,
        primary_color,
        secondary_color
      `
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data?.id) return null;

  return data as SchoolPublicData;
}

function buildVersion(school: SchoolPublicData) {
  const source =
    school.brand_icon_url ||
    school.brand_logo_url ||
    school.logo_url ||
    school.id ||
    Date.now();

  return encodeURIComponent(String(source).replace(/[^a-zA-Z0-9._-]/g, ""));
}

export async function generateMetadata(
  props: SchoolPublicPageProps
): Promise<Metadata> {
  const { schoolSlug } = await getParams(props);
  const slug = normalizeSlug(schoolSlug);

  const school = await getSchool(slug);

  if (!school) {
    return {
      title: "Escola não encontrada",
    };
  }

  const appName = school.brand_name || school.name || "Minha Escola";
  const themeColor = hexColor(school.primary_color, "#0f172a");
  const version = buildVersion(school);

  const iconUrl = `/s/${slug}/icon?v=${version}`;
  const manifestUrl = `/s/${slug}/manifest?v=${version}`;

  return {
    title: appName,
    description: `Portal escolar ${appName}`,
    applicationName: appName,
    themeColor,
    manifest: manifestUrl,
    appleWebApp: {
      capable: true,
      title: appName,
      statusBarStyle: "default",
    },
    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: iconUrl,
    },
    openGraph: {
      title: appName,
      description: `Portal escolar ${appName}`,
      images: [iconUrl],
    },
  };
}

export default async function SchoolPublicPage(props: SchoolPublicPageProps) {
  const { schoolSlug } = await getParams(props);
  const slug = normalizeSlug(schoolSlug);

  const school = await getSchool(slug);

  if (!school) {
    notFound();
  }

  const appName = school.brand_name || school.name || "Minha Escola";
  const logoUrl = school.brand_logo_url || school.logo_url || school.brand_icon_url || null;
  const primaryColor = hexColor(school.primary_color, "#0f172a");
  const secondaryColor = hexColor(school.secondary_color, "#2563eb");

  const version = buildVersion(school);
  const iconUrl = `/s/${slug}/icon?v=${version}`;

  const publicHref = `/s/${slug}`;
  const loginHref = `/s/${slug}/login`;
  const manifestHref = `/s/${slug}/manifest?v=${version}`;

  return (
    <main
      className="min-h-screen bg-slate-100 px-4 py-8 md:px-6"
      style={{
        background:
          "linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%)",
      }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[40px] border border-slate-200 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.12)]">
          <div
            className="px-6 py-10 text-white md:px-10"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
            }}
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
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
                    {appName.slice(0, 2).toUpperCase()}
                  </div>
                )}

                <div>
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
                    Portal oficial da escola
                  </div>

                  <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                    {appName}
                  </h1>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/85 md:text-base">
                    Acesse o portal escolar, acompanhe alunos, comunicados, presença,
                    mensalidades e informações importantes da escola.
                  </p>
                </div>
              </div>

              <div className="rounded-[32px] border border-white/15 bg-white/10 p-4 backdrop-blur">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={iconUrl}
                  alt={`Ícone ${appName}`}
                  className="h-20 w-20 rounded-[24px] bg-white object-contain p-2"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1.2fr_0.8fr] md:p-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Entrar no portal
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Use seu e-mail e senha cadastrados pela escola.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={loginHref}
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Entrar na plataforma
                </Link>

                <Link
                  href={manifestHref}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Ver manifest
                </Link>
              </div>

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-900">
                  Como instalar no celular
                </div>

                <div className="mt-3 space-y-3 text-sm leading-6 text-slate-500">
                  <p>
                    <strong className="text-slate-700">No iPhone:</strong> abra este link
                    no Safari, toque no botão de compartilhar e escolha{" "}
                    <strong>Adicionar à Tela de Início</strong>.
                  </p>

                  <p>
                    <strong className="text-slate-700">No Android:</strong> abra este link
                    no Chrome e escolha <strong>Instalar app</strong> ou{" "}
                    <strong>Adicionar à tela inicial</strong>.
                  </p>

                  <p className="text-xs text-slate-400">
                    Depois de instalado, o app abrirá direto na tela de login da escola.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-slate-50 p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Link personalizado para instalação
              </div>

              <div className="mt-3 break-all rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700">
                {publicHref}
              </div>

              <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Link direto do login
              </div>

              <div className="mt-3 break-all rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700">
                {loginHref}
              </div>

              <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                App instalado
              </div>

              <div className="mt-3 flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={iconUrl}
                  alt={`App ${appName}`}
                  className="h-16 w-16 rounded-[20px] border border-slate-200 bg-white object-contain p-2 shadow-sm"
                />

                <div>
                  <div className="text-sm font-semibold text-slate-900">{appName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Ícone próprio da escola
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}