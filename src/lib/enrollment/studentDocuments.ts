// Matrícula digital: visão dos documentos de UM aluno para a equipe da escola.
// Módulo puro (sem banco/rede), testado em tests/school-students-update.test.mjs.
// Mantém todas as versões (inclusive substituídas): o histórico nunca é apagado.
import { DOC_TYPES, DOC_TYPE_INFO, summarizeDocuments, type DocStatus, type DocType } from "./rules";

export type StudentDocumentRow = {
  id: string;
  doc_type: string;
  status: string;
  parent_id?: string | null;
  uploaded_by?: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  rejection_reason?: string | null;
  uploaded_at?: string | null;
  reviewed_at?: string | null;
  replaces_id?: string | null;
};

export type StudentDocumentVersion = {
  id: string;
  status: DocStatus;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sentBy: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  isCurrent: boolean;
  canReview: boolean;
};

export type StudentDocumentGroup = {
  docType: DocType;
  label: string;
  required: boolean;
  status: DocStatus | "missing";
  versions: StudentDocumentVersion[];
};

export function buildStudentDocumentGroups(
  rows: StudentDocumentRow[],
  parentNameById: Map<string, string>
): StudentDocumentGroup[] {
  const summary = summarizeDocuments(rows.map((r) => ({ ...r, id: String(r.id) })));
  return DOC_TYPES.map((docType) => {
    const item = summary.find((s) => s.docType === docType)!;
    const versions = rows
      .filter((r) => r.doc_type === docType)
      .sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")))
      .map((r) => {
        const isCurrent = String(r.id) === item.documentId;
        return {
          id: String(r.id),
          status: r.status as DocStatus,
          filename: String(r.original_filename || "documento"),
          mimeType: r.mime_type ?? null,
          sizeBytes: typeof r.size_bytes === "number" ? r.size_bytes : null,
          sentBy: r.parent_id ? parentNameById.get(String(r.parent_id)) || "Responsável" : "Equipe da escola",
          uploadedAt: r.uploaded_at ?? null,
          reviewedAt: r.reviewed_at ?? null,
          rejectionReason: r.rejection_reason ?? null,
          isCurrent,
          canReview: isCurrent && r.status === "pending",
        };
      });
    return {
      docType,
      label: DOC_TYPE_INFO[docType].label,
      required: DOC_TYPE_INFO[docType].required,
      status: item.status,
      versions,
    };
  });
}
