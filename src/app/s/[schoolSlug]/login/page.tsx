import { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginClient from "./LoginClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    schoolSlug: string;
  }>;
  searchParams?: Promise<{
    email?: string;
  }>;
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
  updated_at?: string | null;
  created_at?: string | null;
};

type ApiSchoolPayload = {
  ok?: boolean;
  school?: {
    id: string;
    name: string | null;
    slug: string | null;
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
  };
};

function normalizeSlug(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function hexColor(value: unknown, fallback: string) {
  const raw = String(value || "").trim();

  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return raw;
  }

  return fallback;
}

function buildVersion(school: SchoolPublicData) {
  const source =
    school.updated_at ||
    school.created_at ||
    school.brand_icon_url ||
    school.brand_logo_url ||
    school.logo_url ||
    school.id;

  return encodeURIComponent(String(source).replace(/[^a-zA-Z0-9._-]/g, ""));
}

function getBaseUrl() {
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "";

  if (!envUrl) {
    return "http://localhost:3000";
  }

  if (envUrl.startsWith("http://") || envUrl.startsWith("https://")) {
    return envUrl.replace(/\/+$/, "");
  }

  return `https://${envUrl.replace(/\/+$/, "")}`;
}

function mapApiSchoolToDbSchool(payload: ApiSchoolPayload): SchoolPublicData | null {
  const school = payload.school;

  if (!payload.ok || !school?.id) {
    return null;
  }

  return {
    id: school.id,
    name: school.name,
    slug: school.slug,
    brand_name: school.brandName,
    brand_logo_url: school.brandLogoUrl,
    brand_icon_url: school.brandIconUrl,
    logo_url: school.logoUrl,
    primary_color: school.primaryColor,
    secondary_color: school.secondaryColor,
    updated_at: school.updatedAt || null,
    created_at: school.createdAt || null,
  };
}

async function getSchoolFromDatabase(slug: string): Promise<SchoolPublicData | null> {
  try {
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
          secondary_color,
          updated_at,
          created_at
        `
      )
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data?.id) {
      return null;
    }

    return data as SchoolPublicData;
  } catch {
    return null;
  }
}

async function getSchoolFromPublicApi(slug: string): Promise<SchoolPublicData | null> {
  try {
    const baseUrl = getBaseUrl();

    const res = await fetch(
      `${baseUrl}/api/public/school/${encodeURIComponent(slug)}`,
      {
        method: "GET",
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as ApiSchoolPayload;

    return mapApiSchoolToDbSchool(json);
  } catch {
    return null;
  }
}

async function getSchool(slug: string): Promise<SchoolPublicData | null> {
  const normalizedSlug = normalizeSlug(slug);

  if (!normalizedSlug) {
    return null;
  }

  const fromDatabase = await getSchoolFromDatabase(normalizedSlug);

  if (fromDatabase?.id) {
    return fromDatabase;
  }

  const fromPublicApi = await getSchoolFromPublicApi(normalizedSlug);

  if (fromPublicApi?.id) {
    return fromPublicApi;
  }

  return null;
}

function SchoolNotFoundPage({ slug }: { slug: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-[32px] border border-red-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">
          Escola não encontrada
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          O link de login informado não corresponde a uma escola ativa.
        </p>

        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Slug testado: <strong>{slug || "vazio"}</strong>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {slug ? (
            <Link
              href={`/s/${slug}`}
              className="inline-flex justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Tentar página pública da escola
            </Link>
          ) : null}

          <Link
            href="/login"
            className="inline-flex justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
          >
            Ir para login geral
          </Link>
        </div>
      </div>
    </main>
  );
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { schoolSlug } = await props.params;
  const slug = normalizeSlug(schoolSlug);

  if (!slug) {
    return {
      title: "Escola não encontrada",
    };
  }

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
      icon: [
        {
          url: iconUrl,
          sizes: "192x192",
          type: "image/png",
        },
        {
          url: iconUrl,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      shortcut: [
        {
          url: iconUrl,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: iconUrl,
          sizes: "180x180",
          type: "image/png",
        },
        {
          url: iconUrl,
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
    openGraph: {
      title: appName,
      description: `Portal escolar ${appName}`,
      images: [
        {
          url: iconUrl,
          width: 512,
          height: 512,
          alt: appName,
        },
      ],
    },
  };
}

export default async function SchoolSlugLoginPage(props: PageProps) {
  const { schoolSlug } = await props.params;
  const resolvedSearchParams = props.searchParams ? await props.searchParams : {};

  const slug = normalizeSlug(schoolSlug);
  const initialEmail = String(resolvedSearchParams?.email || "").trim();

  if (!slug) {
    return <SchoolNotFoundPage slug={slug} />;
  }

  const school = await getSchool(slug);

  if (!school) {
    return <SchoolNotFoundPage slug={slug} />;
  }

  const appName = school.brand_name || school.name || "Minha Escola";
  const primaryColor = hexColor(school.primary_color, "#0f172a");
  const secondaryColor = hexColor(school.secondary_color, "#2563eb");
  const version = buildVersion(school);

  const logoUrl =
    school.brand_logo_url || school.logo_url || school.brand_icon_url || null;

  const iconUrl = `/s/${slug}/icon?v=${version}`;
  const manifestUrl = `/s/${slug}/manifest?v=${version}`;

  return (
    <LoginClient
      slug={slug}
      initialEmail={initialEmail}
      school={{
        id: school.id,
        name: school.name,
        slug: school.slug,
        brandName: school.brand_name,
        brandLogoUrl: school.brand_logo_url,
        brandIconUrl: school.brand_icon_url,
        logoUrl,
        primaryColor,
        secondaryColor,
        appName,
        iconUrl,
        manifestUrl,
      }}
    />
  );
}