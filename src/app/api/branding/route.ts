import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

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
    "coordenador",
    "coordinator",
    "professor",
    "teacher",
  ]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  if (!schoolId) return jsonError("schoolId não identificado (token).", 401);

  const { data: school, error } = await supabaseAdmin
    .from("schools") // ✅ TABELA CORRETA
    .select("id, name, logo_url, primary_color")
    .eq("id", schoolId)
    .maybeSingle();

  if (error) {
    return jsonError("Falha ao buscar branding.", 500, {
      details: error.message,
    });
  }

  return NextResponse.json({
    ok: true,
    schoolId,
    name: school?.name ?? null,
    logoUrl: school?.logo_url ?? null,
    primaryColor: normalizeHexColor(school?.primary_color),
  });
}
