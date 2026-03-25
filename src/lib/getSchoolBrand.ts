import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type SchoolBrand = {
  logo_url: string | null;
  primary_color: string | null;
  name?: string | null;
};

export async function getSchoolBrand(schoolId: string): Promise<SchoolBrand | null> {
  if (!schoolId) return null;

  // tenta pegar name se existir; se não existir, o Supabase retorna erro de coluna
  // então a gente faz fallback para select só de logo e cor
  const tryWithName = await supabaseAdmin
    .from("schools")
    .select("logo_url,primary_color,name")
    .eq("id", schoolId)
    .maybeSingle();

  if (!tryWithName.error) return (tryWithName.data as any) ?? null;

  const fallback = await supabaseAdmin
    .from("schools")
    .select("logo_url,primary_color")
    .eq("id", schoolId)
    .maybeSingle();

  if (fallback.error) return null;
  return (fallback.data as any) ?? null;
}
