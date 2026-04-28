import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  updated_at?: string | null;
};

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeDbSlug(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function findSchoolBySlugOrId(rawSlug: string): Promise<SchoolRow | null> {
  const slug = normalizeSlug(rawSlug);
  const directSlug = normalizeDbSlug(rawSlug);

  if (!slug && !directSlug) return null;

  const selectFields = `
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
  `;

  if (isUuid(directSlug)) {
    const { data } = await supabaseAdmin
      .from("schools")
      .select(selectFields)
      .eq("id", directSlug)
      .maybeSingle();

    if (data?.id) return data as SchoolRow;
  }

  const slugCandidates = Array.from(
    new Set([directSlug, slug].filter(Boolean))
  );

  for (const candidate of slugCandidates) {
    const { data } = await supabaseAdmin
      .from("schools")
      .select(selectFields)
      .eq("slug", candidate)
      .maybeSingle();

    if (data?.id) return data as SchoolRow;
  }

  const { data: recentSchools } = await supabaseAdmin
    .from("schools")
    .select(selectFields)
    .order("created_at", { ascending: false })
    .limit(500);

  for (const school of recentSchools || []) {
    const bySlug = normalizeSlug((school as any).slug);
    const byBrand = normalizeSlug((school as any).brand_name);
    const byName = normalizeSlug((school as any).name);

    if (bySlug === slug || byBrand === slug || byName === slug) {
      return school as SchoolRow;
    }
  }

  return null;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { schoolSlug } = await context.params;
    const rawSlug = String(schoolSlug || "").trim();

    if (!rawSlug) {
      return NextResponse.json(
        { ok: false, error: "Slug inválido." },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const school = await findSchoolBySlugOrId(rawSlug);

    if (!school?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Escola não encontrada.",
          slug: normalizeSlug(rawSlug),
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const finalSlug =
      normalizeSlug(school.slug) ||
      normalizeSlug(school.brand_name) ||
      normalizeSlug(school.name) ||
      school.id;

    if (!school.slug || normalizeSlug(school.slug) !== finalSlug) {
      await supabaseAdmin
        .from("schools")
        .update({
          slug: finalSlug,
        })
        .eq("id", school.id);
    }

    return NextResponse.json(
      {
        ok: true,
        school: {
          id: school.id,
          name: school.name,
          slug: finalSlug,
          brandName: school.brand_name || school.name,
          brandLogoUrl: school.brand_logo_url || school.logo_url || null,
          brandIconUrl:
            school.brand_icon_url ||
            school.brand_logo_url ||
            school.logo_url ||
            null,
          logoUrl: school.logo_url || null,
          primaryColor: school.primary_color || "#0f172a",
          secondaryColor: school.secondary_color || "#2563eb",
          createdAt: school.created_at || null,
          updatedAt: school.created_at || null,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Erro interno ao buscar escola.",
        details: e?.message || String(e),
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}