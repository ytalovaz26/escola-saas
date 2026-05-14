import { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LayoutProps = {
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
  updated_at?: string | null;
  created_at?: string | null;
};

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

async function getSchool(slug: string): Promise<SchoolPublicData | null> {
  const normalizedSlug = normalizeSlug(slug);

  if (!normalizedSlug) {
    return null;
  }

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
      .eq("slug", normalizedSlug)
      .maybeSingle();

    if (error || !data?.id) {
      return null;
    }

    return data as SchoolPublicData;
  } catch {
    return null;
  }
}

export async function generateMetadata(props: LayoutProps): Promise<Metadata> {
  const { schoolSlug } = await props.params;
  const slug = normalizeSlug(schoolSlug);

  if (!slug) {
    return {
      title: "Portal escolar",
    };
  }

  const school = await getSchool(slug);

  if (!school) {
    return {
      title: "Portal escolar",
    };
  }

  const appName = school.brand_name || school.name || "Minha Escola";
  const themeColor = hexColor(school.primary_color, "#0f172a");
  const version = buildVersion(school);

  const icon192 = `/s/${slug}/icon?size=192&v=${version}`;
  const icon512 = `/s/${slug}/icon?size=512&v=${version}`;
  const appleIcon = `/s/${slug}/icon?size=180&v=${version}`;
  const manifestUrl = `/s/${slug}/manifest?v=${version}`;

  return {
    title: {
      default: appName,
      template: `%s | ${appName}`,
    },
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
          url: icon192,
          sizes: "192x192",
          type: "image/png",
        },
        {
          url: icon512,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      shortcut: [
        {
          url: icon512,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: appleIcon,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
    openGraph: {
      title: appName,
      description: `Portal escolar ${appName}`,
      images: [
        {
          url: icon512,
          width: 512,
          height: 512,
          alt: appName,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: appName,
      description: `Portal escolar ${appName}`,
      images: [icon512],
    },
  };
}

export default function SchoolPublicLayout({ children }: LayoutProps) {
  return children;
}