// src/app/api/parent/enrollment/documents/route.ts
// Matrícula digital (responsável): envio de documento do aluno vinculado.
// Arquivo validado pelo CONTEÚDO (assinatura binária), gravado em bucket PRIVADO pelo servidor.
// O histórico nunca é apagado: versões anteriores pendentes/rejeitadas ficam "superseded".
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";
import { requireParentForStudent } from "@/lib/enrollment/server";
import {
  DOC_TYPE_INFO,
  ENROLLMENT_BUCKET,
  MAX_DOCUMENT_BYTES,
  buildStoragePath,
  canParentUpload,
  isDocType,
  validateUpload,
  type DocStatus,
} from "@/lib/enrollment/rules";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Recusa cedo pelo tamanho declarado (o conteúdo é revalidado abaixo).
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) return jsonFail(413, "O arquivo ultrapassa 10 MB.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonFail(400, "Envio inválido.");
  }

  const studentId = String(form.get("studentId") || "");
  const docType = String(form.get("docType") || "");
  const file = form.get("file");

  const guard = await requireParentForStudent(req, studentId);
  if (!guard.ok) return guard.res;
  if (!isDocType(docType)) return jsonFail(400, "Tipo de documento inválido.");
  if (!(file instanceof File)) return jsonFail(400, "Selecione um arquivo.");

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateUpload({ filename: file.name, size: file.size, bytes });
    if (!check.ok) return jsonFail(422, check.message, { code: check.code });

    // Situação atual do tipo de documento para este aluno
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("enrollment_documents")
      .select("id, status")
      .eq("school_id", guard.schoolId)
      .eq("student_id", guard.studentId)
      .eq("doc_type", docType)
      .in("status", ["pending", "approved", "rejected"]);
    if (exErr) return jsonFail(503, "Envio de documentos ainda não disponível nesta escola.");

    const statuses = (existing || []).map((d: any) => d.status as DocStatus);
    const current: DocStatus | null = statuses.includes("approved") ? "approved"
      : statuses.includes("pending") ? "pending" : statuses.includes("rejected") ? "rejected" : null;
    if (!canParentUpload(current)) {
      return jsonFail(409, `${DOC_TYPE_INFO[docType].label} já foi aprovado(a) pela escola. Fale com a secretaria para alterar.`);
    }

    const documentId = randomUUID();
    const storagePath = buildStoragePath({ schoolId: guard.schoolId, studentId: guard.studentId, docType, documentId, ext: check.ext });
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const { error: upErr } = await supabaseAdmin.storage
      .from(ENROLLMENT_BUCKET)
      .upload(storagePath, bytes, { contentType: check.mime, upsert: false, cacheControl: "no-store" });
    if (upErr) return jsonFail(503, "Não foi possível armazenar o arquivo. Tente novamente.");

    // Registro atômico no banco (substitui pendente/rejeitado anterior na mesma transação).
    const { error: subErr } = await supabaseAdmin.rpc("enrollment_document_submit", {
      p_id: documentId,
      p_school_id: guard.schoolId,
      p_student_id: guard.studentId,
      p_parent_id: guard.parentId,
      p_doc_type: docType,
      p_storage_path: storagePath,
      p_original_filename: check.filename,
      p_mime_type: check.mime,
      p_size_bytes: bytes.length,
      p_sha256: sha256,
      p_uploaded_by: guard.userId,
    });

    if (subErr) {
      // Nada foi registrado: só o arquivo recém-enviado sai do Storage.
      await supabaseAdmin.storage.from(ENROLLMENT_BUCKET).remove([storagePath]);
      const approved = /aprovado/i.test(String(subErr.message || ""));
      return approved
        ? jsonFail(409, `${DOC_TYPE_INFO[docType].label} já foi aprovado(a) pela escola. Fale com a secretaria para alterar.`)
        : jsonFail(500, "Não foi possível registrar o documento.");
    }

    return jsonOk({ document: { id: documentId, docType, status: "pending", filename: check.filename, sizeBytes: bytes.length } }, 201);
  } catch (err) {
    logRouteError("POST /api/parent/enrollment/documents", err, { studentId: guard.studentId, docType });
    return jsonFail(500, "Erro interno ao enviar o documento.");
  }
}
