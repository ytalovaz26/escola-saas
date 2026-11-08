// src/lib/pdf/schoolPdfIdentity.ts
// Nome e logomarca da escola para PDFs: mesma identidade dos painéis (brand_name ?? name,
// brand_logo_url ?? logo_url), da escola autorizada pelo guard, com a imagem já tratada.
import { loadSchoolIdentity, type SchoolIdentity } from "@/lib/schoolIdentity";
import { loadPdfImage } from "./pdfImage";

export type SchoolPdfIdentity = {
  identity: SchoolIdentity | null;
  name: string | null;
  logo: Buffer | null;
  error: string | null;
};

export async function loadSchoolPdfIdentity(schoolId: string): Promise<SchoolPdfIdentity> {
  const { identity, error } = await loadSchoolIdentity(schoolId);
  if (error || !identity) return { identity: null, name: null, logo: null, error };
  const logo = await loadPdfImage(identity.logoUrl);
  return { identity, name: identity.displayName, logo, error: null };
}
