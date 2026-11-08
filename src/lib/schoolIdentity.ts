// src/lib/schoolIdentity.ts
// Identidade institucional CANÔNICA da escola (nome e logomarca exibidos).
//
// A tela de Identidade Visual grava `brand_name` e `brand_logo_url`; `name` e `logo_url` são
// os valores originais do cadastro. A regra usada por /api/me e /api/school/branding — e agora
// por todos os painéis e PDFs — é:
//   nome exibido = brand_name ?? name
//   logomarca    = brand_logo_url ?? logo_url
// A escola é sempre a do usuário autorizado (school_id do guard), nunca vinda do navegador.
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const SCHOOL_IDENTITY_COLUMNS = "id, name, brand_name, brand_logo_url, brand_icon_url, logo_url";

export type SchoolIdentity = {
  schoolId: string;
  displayName: string | null;
  legalName: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
};

function clean(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export function resolveSchoolIdentity(row: Record<string, any> | null | undefined, schoolId?: string): SchoolIdentity {
  const logoUrl = clean(row?.brand_logo_url) || clean(row?.logo_url);
  return {
    schoolId: String(row?.id ?? schoolId ?? ""),
    displayName: clean(row?.brand_name) || clean(row?.name),
    legalName: clean(row?.name),
    logoUrl,
    iconUrl: clean(row?.brand_icon_url) || logoUrl,
  };
}

/** Uma única consulta, sempre filtrada pelo school_id autorizado. */
export async function loadSchoolIdentity(schoolId: string): Promise<{ identity: SchoolIdentity | null; error: string | null }> {
  if (!schoolId) return { identity: null, error: "Escola não identificada." };
  const { data, error } = await supabaseAdmin.from("schools").select(SCHOOL_IDENTITY_COLUMNS).eq("id", schoolId).maybeSingle();
  if (error) return { identity: null, error: error.message };
  if (!data) return { identity: null, error: null };
  return { identity: resolveSchoolIdentity(data, schoolId), error: null };
}
