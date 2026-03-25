import { supabaseAdmin } from "@/lib/supabaseAdmin";

function cleanUrl(u?: string | null) {
  const s = String(u || "").trim();
  return s.length > 0 ? s : null;
}

function normalizeHexColor(c?: string | null) {
  const s = String(c || "").trim();
  if (!s) return null;
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return s;
  return null;
}

export async function getSchoolBranding(schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("escolas")
    .select("id, da_marca, url_do_logotipo, cor_primaria")
    .eq("id", schoolId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return {
    ok: true as const,
    schoolId,
    name: data?.da_marca ?? null,
    logoUrl: cleanUrl(data?.url_do_logotipo ?? null),
    primaryColor: normalizeHexColor(data?.cor_primaria ?? null),
  };
}
