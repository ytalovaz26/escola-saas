// src/app/api/parent/enrollment/route.ts
// Matrícula digital (responsável): situação do cadastro, dos alunos vinculados e dos documentos.
// Somente leitura. Nenhuma URL de arquivo é devolvida aqui (downloads usam URL temporária).
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";
import { getSessionUserId, loadParentContext } from "@/lib/enrollment/server";
import {
  DOC_TYPE_INFO,
  STUDENT_FIELDS,
  STUDENT_SELECT_COLUMNS,
  enrollmentProgress,
  parentPendingFields,
  studentPendingFields,
  summarizeDocuments,
} from "@/lib/enrollment/rules";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await getSessionUserId(req);
  if (!userId) return jsonFail(401, "Sessão inválida. Faça login novamente.");

  try {
    const { accounts, links } = await loadParentContext(userId);
    if (!accounts.length) return jsonFail(403, "Cadastro de responsável não encontrado.");

    const studentIds = [...new Set(links.map((l) => l.studentId))];
    const [studentsRes, docsRes] = await Promise.all([
      studentIds.length
        ? supabaseAdmin.from("students").select(STUDENT_SELECT_COLUMNS.join(", ")).in("id", studentIds)
        : Promise.resolve({ data: [], error: null } as any),
      studentIds.length
        ? supabaseAdmin
            .from("enrollment_documents")
            .select("id, school_id, student_id, doc_type, status, rejection_reason, original_filename, size_bytes, uploaded_at, reviewed_at")
            .in("student_id", studentIds)
            .neq("status", "superseded")
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (studentsRes.error) return jsonFail(500, "Falha ao carregar os alunos.");
    // A tabela de documentos pode ainda não existir (migração não aplicada): a tela continua funcionando.
    const docsAvailable = !docsRes.error;
    const docs = docsAvailable ? docsRes.data || [] : [];

    const parentPending = [...new Set(accounts.flatMap((a) => parentPendingFields(a.row)))];

    const children = (studentsRes.data || [])
      // Só alunos cuja escola coincide com a do vínculo
      .filter((s: any) => links.some((l) => l.studentId === String(s.id) && l.schoolId === String(s.school_id)))
      .map((s: any) => {
        const own = docs.filter((d: any) => String(d.student_id) === String(s.id) && String(d.school_id) === String(s.school_id));
        const documents = summarizeDocuments(own);
        const pendingFields = studentPendingFields(s);
        return {
          id: String(s.id),
          schoolId: String(s.school_id),
          fullName: s.full_name || "Aluno",
          registrationNumber: s.registration_number || null,
          fields: Object.fromEntries(STUDENT_FIELDS.map((f) => [f.key, s[f.column] ?? null])),
          locked: Object.fromEntries(
            STUDENT_FIELDS.map((f) => [f.key, f.mode === "fill_if_empty" && s[f.column] !== null && String(s[f.column] ?? "").trim() !== ""])
          ),
          pendingFields,
          documents: documents.map((d) => ({ ...d, hint: DOC_TYPE_INFO[d.docType].hint })),
          history: own
            .map((d: any) => ({
              id: String(d.id),
              docType: d.doc_type,
              status: d.status,
              rejectionReason: d.rejection_reason ?? null,
              filename: d.original_filename,
              sizeBytes: d.size_bytes,
              uploadedAt: d.uploaded_at,
              reviewedAt: d.reviewed_at,
            }))
            .sort((a: any, b: any) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""))),
          progress: enrollmentProgress({ parentPending, studentPending: pendingFields, docs: documents }),
        };
      });

    const pendingCount = parentPending.length +
      children.reduce((n: number, c: { progress: { pendingCount: number } }) => n + c.progress.pendingCount - parentPending.length, 0);

    return jsonOk({
      parentPending,
      children,
      documentsAvailable: docsAvailable,
      summary: { pendingCount: Math.max(pendingCount, parentPending.length), complete: children.length > 0 && children.every((c: { progress: { complete: boolean } }) => c.progress.complete) },
      fieldDefinitions: STUDENT_FIELDS.map((f) => ({ key: f.key, label: f.label, mode: f.mode, max: f.max, kind: f.kind ?? null })),
    });
  } catch (err) {
    logRouteError("GET /api/parent/enrollment", err, { userId });
    return jsonFail(500, "Não foi possível carregar a matrícula.");
  }
}
