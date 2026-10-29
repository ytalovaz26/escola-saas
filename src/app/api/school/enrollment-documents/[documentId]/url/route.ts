// src/app/api/school/enrollment-documents/[documentId]/url/route.ts
// Matrícula digital (secretaria/direção): URL TEMPORÁRIA (5 min) de um documento da própria escola.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk } from "@/lib/http";
import { STAFF_DOCUMENT_ROLES, createSignedDocumentUrl } from "@/lib/enrollment/server";
import { SIGNED_URL_SECONDS, isUuid } from "@/lib/enrollment/rules";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const guard = await requireStaff(req, STAFF_DOCUMENT_ROLES);
  if (!guard.ok) return guard.res;

  const { documentId } = await ctx.params;
  if (!isUuid(documentId)) return jsonFail(404, "Documento não encontrado.");

  const { data: doc, error } = await supabaseAdmin
    .from("enrollment_documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("school_id", guard.schoolId)
    .maybeSingle();
  if (error || !doc) return jsonFail(404, "Documento não encontrado.");

  const url = await createSignedDocumentUrl(String(doc.storage_path));
  if (!url) return jsonFail(503, "Não foi possível gerar o link do documento.");
  return jsonOk({ url, expiresIn: SIGNED_URL_SECONDS });
}
