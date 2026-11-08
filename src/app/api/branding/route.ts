import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { SCHOOL_IDENTITY_COLUMNS, resolveSchoolIdentity } from "@/lib/schoolIdentity";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeHexColor(c?: string | null) {
  const s = String(c || "").trim();
  if (!s) return null;
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return s;
  return null;
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador", "secretaria",
    "coordinator",
    "professor",
    "teacher",
  ]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  if (!schoolId) return jsonError("schoolId não identificado (token).", 401);

  const { data: school, error } = await supabaseAdmin
    .from("schools") // ✅ TABELA CORRETA
    .select(`${SCHOOL_IDENTITY_COLUMNS}, primary_color`)
    .eq("id", schoolId)
    .maybeSingle();

  if (error) {
    return jsonError("Falha ao buscar branding.", 500, {
      details: error.message,
    });
  }

  // Mesma identidade de /api/me e dos PDFs: brand_name ?? name, brand_logo_url ?? logo_url.
  // (Antes: name e logo_url do cadastro original, divergindo do painel da direção.)
  const identity = resolveSchoolIdentity(school, schoolId);

  return NextResponse.json({
    ok: true,
    schoolId,
    name: identity.displayName,
    legalName: identity.legalName,
    logoUrl: identity.logoUrl,
    primaryColor: normalizeHexColor(school?.primary_color),
  });
}
