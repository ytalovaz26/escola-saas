import { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{
    schoolSlug: string;
  }>;
  searchParams?: Promise<{
    email?: string;
  }>;
};

type SchoolData = {
  id: string;
  name: string | null;
  slug: string | null;
  brand_name: string | null;
  brand_logo_url: string | null;
  brand_icon_url: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  created_at?: string | null;
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

function buildVersion(school: SchoolData) {
  const source =
    school.created_at ||
    school.brand_icon_url ||
    school.brand_logo_url ||
    school.logo_url ||
    school.id;

  return encodeURIComponent(String(source).replace(/[^a-zA-Z0-9._-]/g, ""));
}

async function getSchool(slug: string): Promise<SchoolData | null> {
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
        created_at
      `
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data?.id) {
    return null;
  }

  return data as SchoolData;
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
    manifest: manifestUrl,
    themeColor,
    appleWebApp: {
      capable: true,
      title: appName,
      statusBarStyle: "default",
    },
    icons: {
      icon: [
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
  const searchParams = props.searchParams ? await props.searchParams : {};

  const slug = normalizeSlug(schoolSlug);

  if (!slug) {
    notFound();
  }

  const school = await getSchool(slug);

  if (!school) {
    notFound();
  }

  const appName = school.brand_name || school.name || "Minha Escola";
  const primaryColor = hexColor(school.primary_color, "#0f172a");
  const secondaryColor = hexColor(school.secondary_color, "#2563eb");
  const version = buildVersion(school);

  const iconUrl = `/s/${slug}/icon?v=${version}`;
  const manifestUrl = `/s/${slug}/manifest?v=${version}`;
  const logoUrl = school.brand_logo_url || school.logo_url || school.brand_icon_url || null;

  return (
    <LoginClient
      slug={slug}
      initialEmail={String(searchParams?.email || "")}
      school={{
        id: school.id,
        name: school.name,
        slug: school.slug,
        brandName: school.brand_name,
        brandLogoUrl: school.brand_logo_url,
        brandIconUrl: school.brand_icon_url,
        logoUrl: school.logo_url,
        primaryColor,
        secondaryColor,
        appName,
        logoUrl,
        iconUrl,
        manifestUrl,
      }}
    />
  );
}