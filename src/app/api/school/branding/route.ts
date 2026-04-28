import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeColor(value: unknown) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return raw;
  }

  return null;
}

function canManageBranding(role: unknown) {
  const r = String(role || "").trim().toLowerCase();

  return (
    r === "admin" ||
    r === "diretor" ||
    r === "director" ||
    r === "coordenador" ||
    r === "coordinator"
  );
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "professor",
    "teacher",
    "secretaria",
  ]);

  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  if (!schoolId) return jsonError("schoolId não identificado.", 401);

  const { data: school, error } = await supabaseAdmin
    .from("schools")
    .select(
      `
        id,
        name,
        slug,
        logo_url,
        brand_name,
        brand_logo_url,
        brand_icon_url,
        primary_color,
        secondary_color
      `
    )
    .eq("id", schoolId)
    .maybeSingle();

  if (error) {
    return jsonError("Falha ao buscar branding da escola.", 500, {
      details: error.message,
    });
  }

  const publicSlug =
    school?.slug ||
    normalizeSlug(String(school?.brand_name || school?.name || schoolId));

  return NextResponse.json({
    ok: true,
    school: {
      id: school?.id ?? schoolId,
      name: school?.name ?? null,
      slug: publicSlug,
      brandName: school?.brand_name ?? school?.name ?? null,
      brandLogoUrl: school?.brand_logo_url ?? school?.logo_url ?? null,
      brandIconUrl: school?.brand_icon_url ?? school?.brand_logo_url ?? school?.logo_url ?? null,
      logoUrl: school?.logo_url ?? null,
      primaryColor: school?.primary_color ?? null,
      secondaryColor: school?.secondary_color ?? null,
      publicUrl: `/s/${publicSlug}`,
    },
  });
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador",
    "coordinator",
  ]);

  if (!guard.ok) return guard.res;

  const { schoolId, role } = guard as any;

  if (!schoolId) {
    return jsonError("schoolId não identificado.", 401);
  }

  if (!canManageBranding(role)) {
    return jsonError("Você não tem permissão para alterar o branding.", 403);
  }

  let body: any = null;

  try {
    body = await req.json();
  } catch {
    return jsonError("JSON inválido.", 400);
  }

  const brandNameRaw = String(body?.brandName || "").trim();
  const slugRaw = String(body?.slug || "").trim();

  const { data: currentSchool, error: currentErr } = await supabaseAdmin
    .from("schools")
    .select("id, name, brand_name, slug")
    .eq("id", schoolId)
    .maybeSingle();

  if (currentErr) {
    return jsonError("Falha ao buscar escola atual.", 500, {
      details: currentErr.message,
    });
  }

  const baseName =
    brandNameRaw ||
    String(currentSchool?.brand_name || currentSchool?.name || schoolId).trim();

  let finalSlug = normalizeSlug(slugRaw || baseName);

  if (!finalSlug) {
    finalSlug = `escola-${String(schoolId).slice(0, 8)}`;
  }

  const payload: Record<string, any> = {
    slug: finalSlug,
    brand_name: brandNameRaw || null,
  };

  const primaryColor = normalizeColor(body?.primaryColor);
  const secondaryColor = normalizeColor(body?.secondaryColor);

  if (primaryColor) payload.primary_color = primaryColor;
  if (secondaryColor) payload.secondary_color = secondaryColor;

  const { data: duplicatedSlug, error: dupErr } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("slug", finalSlug)
    .neq("id", schoolId)
    .maybeSingle();

  if (dupErr) {
    return jsonError("Falha ao validar link personalizado.", 500, {
      details: dupErr.message,
    });
  }

  if (duplicatedSlug?.id) {
    return jsonError(
      `O link "${finalSlug}" já está sendo usado por outra escola. Escolha outro.`,
      409
    );
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("schools")
    .update(payload)
    .eq("id", schoolId)
    .select(
      `
        id,
        name,
        slug,
        logo_url,
        brand_name,
        brand_logo_url,
        brand_icon_url,
        primary_color,
        secondary_color
      `
    )
    .maybeSingle();

  if (updateErr) {
    return jsonError("Falha ao salvar identidade visual.", 500, {
      details: updateErr.message,
    });
  }

  return NextResponse.json({
    ok: true,
    school: {
      id: updated?.id ?? schoolId,
      name: updated?.name ?? null,
      slug: updated?.slug ?? finalSlug,
      brandName: updated?.brand_name ?? updated?.name ?? null,
      brandLogoUrl: updated?.brand_logo_url ?? updated?.logo_url ?? null,
      brandIconUrl:
        updated?.brand_icon_url ?? updated?.brand_logo_url ?? updated?.logo_url ?? null,
      logoUrl: updated?.logo_url ?? null,
      primaryColor: updated?.primary_color ?? null,
      secondaryColor: updated?.secondary_color ?? null,
      publicUrl: `/s/${updated?.slug ?? finalSlug}`,
    },
  });
}