// src/app/api/school/enrollment-documents/[documentId]/review/route.ts
// Matrícula digital (secretaria/direção): aprovar ou rejeitar (com motivo) um documento PENDENTE
// da própria escola. A atualização só acontece se o documento ainda estiver pendente.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";
import { STAFF_DOCUMENT_ROLES } from "@/lib/enrollment/server";
import { isUuid, validateReview, type DocStatus } from "@/lib/enrollment/rules";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const guard = await requireStaff(req, STAFF_DOCUMENT_ROLES);
  if (!guard.ok) return guard.res;

  const { documentId } = await ctx.params;
  if (!isUuid(documentId)) return jsonFail(404, "Documento não encontrado.");

  try {
    const { json } = await readJsonBody(req);

    const { data: doc, error } = await supabaseAdmin
      .from("enrollment_documents")
      .select("id, status")
      .eq("id", documentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();
    if (error || !doc) return jsonFail(404, "Documento não encontrado.");

    const review = validateReview(doc.status as DocStatus, { decision: json?.decision, reason: json?.reason });
    if (!review.ok) return jsonFail(422, review.message);

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("enrollment_documents")
      .update({
        status: review.status,
        rejection_reason: review.reason,
        reviewed_by: guard.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("school_id", guard.schoolId)
      .eq("status", "pending")
      .select("id, status")
      .maybeSingle();
    if (updErr) return jsonFail(500, "Não foi possível registrar a análise.");
    if (!updated) return jsonFail(409, "O documento foi alterado por outra pessoa. Atualize a lista.");

    return jsonOk({ document: { id: String(updated.id), status: updated.status } });
  } catch (err) {
    logRouteError("POST /api/school/enrollment-documents/[documentId]/review", err, { schoolId: guard.schoolId, documentId });
    return jsonFail(500, "Erro interno.");
  }
}
