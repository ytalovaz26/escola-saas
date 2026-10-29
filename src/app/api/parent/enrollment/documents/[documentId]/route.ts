// src/app/api/parent/enrollment/documents/[documentId]/route.ts
// Matrícula digital (responsável): URL TEMPORÁRIA (5 min) para visualizar um documento enviado,
// somente se o responsável tiver vínculo ativo com o aluno do documento.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonFail, jsonOk } from "@/lib/http";
import { createSignedDocumentUrl, requireParentForStudent } from "@/lib/enrollment/server";
import { SIGNED_URL_SECONDS, isUuid } from "@/lib/enrollment/rules";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  if (!isUuid(documentId)) return jsonFail(404, "Documento não encontrado.");

  const { data: doc, error } = await supabaseAdmin
    .from("enrollment_documents")
    .select("id, school_id, student_id, storage_path, status")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !doc) return jsonFail(404, "Documento não encontrado.");

  const guard = await requireParentForStudent(req, String(doc.student_id));
  if (!guard.ok) return jsonFail(404, "Documento não encontrado.");
  if (String(doc.school_id) !== guard.schoolId) return jsonFail(404, "Documento não encontrado.");

  const url = await createSignedDocumentUrl(String(doc.storage_path));
  if (!url) return jsonFail(503, "Não foi possível gerar o link do documento.");

  return jsonOk({ url, expiresIn: SIGNED_URL_SECONDS });
}
