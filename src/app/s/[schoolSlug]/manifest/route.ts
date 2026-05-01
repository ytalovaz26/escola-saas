import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
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

function buildHeaders() {
  return {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function getSlugFromUrl(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  const sIndex = parts.indexOf("s");

  if (sIndex >= 0 && parts[sIndex + 1]) {
    return normalizeSlug(decodeURIComponent(parts[sIndex + 1]));
  }

  return "";
}

async function getSlug(req: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const fromParams = normalizeSlug(params?.schoolSlug);

    if (fromParams) {
      return fromParams;
    }
  } catch {
    // Fallback pela URL abaixo.
  }

  return getSlugFromUrl(req);
}

async function getSchool(slug: string): Promise<SchoolPublicData | null> {
  const normalized = normalizeSlug(slug);

  if (!normalized) {
    return null;
  }

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
    .eq("slug", normalized)
    .maybeSingle();

  if (error || !data?.id) {
    console.error("[school-manifest] school not found", {
      slug: normalized,
      error: error?.message || null,
    });

    return null;
  }

  return data as SchoolPublicData;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const slug = await getSlug(req, context);

    if (!slug) {
      return NextResponse.json(
        {
          ok: false,
          error: "Slug inválido.",
          slug,
        },
        {
          status: 400,
          headers: buildHeaders(),
        }
      );
    }

    const school = await getSchool(slug);

    if (!school) {
      return NextResponse.json(
        {
          ok: false,
          error: "Escola não encontrada.",
          slug,
        },
        {
          status: 404,
          headers: buildHeaders(),
        }
      );
    }

    const appName = school.brand_name || school.name || "Minha Escola";
    const shortName = appName.slice(0, 12);
    const themeColor = hexColor(school.primary_color, "#0f172a");
    const backgroundColor = "#ffffff";

    const iconBase = `/s/${slug}/icon`;

    const manifest = {
      id: `/s/${slug}`,
      name: appName,
      short_name: shortName,
      description: `Portal escolar ${appName}`,
      start_url: `/s/${slug}/login`,
      scope: `/s/${slug}/`,
      display: "standalone",
      orientation: "portrait",
      background_color: backgroundColor,
      theme_color: themeColor,
      icons: [
        {
          src: `${iconBase}?size=192`,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `${iconBase}?size=512`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `${iconBase}?size=512&maskable=1`,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    };

    return NextResponse.json(manifest, {
      status: 200,
      headers: buildHeaders(),
    });
  } catch (e: any) {
    console.error("[school-manifest] unexpected error", e);

    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Erro inesperado ao gerar manifest.",
      },
      {
        status: 500,
        headers: buildHeaders(),
      }
    );
  }
}