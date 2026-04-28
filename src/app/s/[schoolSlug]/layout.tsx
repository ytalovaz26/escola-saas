import { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type SchoolPublicLayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    schoolSlug: string;
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

async function getSchool(slug: string): Promise<SchoolPublicData | null> {
  if (!slug) return null;

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
  props: SchoolPublicLayoutProps
): Promise<Metadata> {
  const { schoolSlug } = await props.params;
  const slug = normalizeSlug(schoolSlug);

  const school = await getSchool(slug);

  if (!school) {
    return {
      title: "Escola não encontrada",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const appName = school.brand_name || school.name || "Minha Escola";
  const version = buildVersion(school);
  const iconUrl = `/s/${slug}/icon?v=${version}`;
  const manifestUrl = `/s/${slug}/manifest?v=${version}`;
  const themeColor = hexColor(school.primary_color, "#0f172a");

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
          sizes: "192x192",
          type: "image/png",
        },
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
      shortcut: [
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
      images: [iconUrl],
    },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "apple-mobile-web-app-title": appName,
    },
  };
}

export default function SchoolPublicLayout({ children }: SchoolPublicLayoutProps) {
  return children;
}