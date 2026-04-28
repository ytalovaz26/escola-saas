import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{
    schoolSlug: string;
  }>;
};

type SchoolRow = {
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

function buildVersion(school: SchoolRow) {
  const source =
    school.created_at ||
    school.brand_icon_url ||
    school.brand_logo_url ||
    school.logo_url ||
    school.id;

  return encodeURIComponent(String(source).replace(/[^a-zA-Z0-9._-]/g, ""));
}

function absoluteUrl(req: Request, pathOrUrl: string) {
  const raw = String(pathOrUrl || "").trim();

  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  const url = new URL(req.url);

  return `${url.origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { schoolSlug } = await context.params;
    const slug = normalizeSlug(schoolSlug);

    if (!slug) {
      return NextResponse.json(
        {
          error: "Slug inválido.",
        },
        {
          status: 400,
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        }
      );
    }

    const { data: school, error } = await supabaseAdmin
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

    if (error) {
      return NextResponse.json(
        {
          error: "Falha ao buscar escola.",
          details: error.message,
          slug,
        },
        {
          status: 500,
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        }
      );
    }

    if (!school?.id) {
      return NextResponse.json(
        {
          error: "Escola não encontrada.",
          slug,
        },
        {
          status: 404,
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        }
      );
    }

    const typedSchool = school as SchoolRow;

    const appName = typedSchool.brand_name || typedSchool.name || "Minha Escola";
    const version = buildVersion(typedSchool);

    const iconPath = `/s/${slug}/icon?v=${version}`;
    const iconAbsolute = absoluteUrl(req, iconPath);

    const startUrl = `/s/${slug}/login`;
    const scope = `/s/${slug}/`;
    const appId = `/s/${slug}`;

    const themeColor = hexColor(typedSchool.primary_color, "#0f172a");

    return NextResponse.json(
      {
        id: appId,
        name: appName,
        short_name: appName.slice(0, 24),
        description: `Portal escolar ${appName}`,
        start_url: startUrl,
        scope,
        display: "standalone",
        orientation: "portrait",
        background_color: "#ffffff",
        theme_color: themeColor,
        icons: [
          {
            src: iconAbsolute,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: iconAbsolute,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: iconAbsolute,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/manifest+json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Erro interno no manifest da escola.",
        details: e?.message || String(e),
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/manifest+json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  }
}