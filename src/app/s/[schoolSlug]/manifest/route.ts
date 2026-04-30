import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicSchoolResponse =
  | {
      ok: true;
      school: {
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
    }
  | {
      ok: false;
      error?: string;
      slug?: string;
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

function getSlugFromRequest(req: Request) {
  const url = new URL(req.url);

  // Exemplo: /s/teste-3/manifest
  const parts = url.pathname.split("/").filter(Boolean);
  const sIndex = parts.indexOf("s");

  if (sIndex >= 0 && parts[sIndex + 1]) {
    return normalizeSlug(decodeURIComponent(parts[sIndex + 1]));
  }

  return "";
}

function buildHeaders() {
  return {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

async function readPublicSchool(req: Request, slug: string) {
  const url = new URL(req.url);
  const origin = url.origin;

  const res = await fetch(
    `${origin}/api/public/school/${encodeURIComponent(slug)}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const json = (await res.json().catch(() => null)) as PublicSchoolResponse | null;

  if (!res.ok || !json || json.ok !== true) {
    return {
      ok: false as const,
      status: res.status || 404,
      error:
        json && "error" in json && json.error
          ? json.error
          : "Escola não encontrada.",
      debug: json,
    };
  }

  return {
    ok: true as const,
    school: json.school,
  };
}

export async function GET(req: Request) {
  try {
    const slug = getSlugFromRequest(req);

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

    const result = await readPublicSchool(req, slug);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "Escola não encontrada.",
          slug,
          debug: result.debug || null,
        },
        {
          status: result.status || 404,
          headers: buildHeaders(),
        }
      );
    }

    const school = result.school;

    const appName = school.brandName || school.name || "Minha Escola";
    const shortName = appName.slice(0, 12);
    const themeColor = hexColor(school.primaryColor, "#0f172a");

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
      background_color: "#ffffff",
      theme_color: themeColor,
      icons: [
        {
          src: `${iconBase}?size=192&purpose=any`,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `${iconBase}?size=512&purpose=any`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `${iconBase}?size=512&purpose=maskable`,
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