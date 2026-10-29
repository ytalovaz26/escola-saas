// src/app/api/school/enrollment-documents/route.ts
// Matrícula digital (secretaria/direção): documentos recebidos e pendências por aluno,
// somente da escola do vínculo ativo do usuário (requireStaff).
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";
import { STAFF_DOCUMENT_ROLES } from "@/lib/enrollment/server";
import { DOC_TYPE_INFO, summarizeDocuments, type DocType } from "@/lib/enrollment/rules";

export const runtime = "nodejs";

const STATUS_FILTERS = ["pending", "approved", "rejected", "all"] as const;

export async function GET(req: Request) {
  const guard = await requireStaff(req, STAFF_DOCUMENT_ROLES);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const statusParam = String(url.searchParams.get("status") || "pending");
    const status = (STATUS_FILTERS as readonly string[]).includes(statusParam) ? statusParam : "pending";

    let docsQuery = supabaseAdmin
      .from("enrollment_documents")
      .select("id, student_id, parent_id, doc_type, status, rejection_reason, original_filename, mime_type, size_bytes, uploaded_at, reviewed_at")
      .eq("school_id", guard.schoolId)
      .neq("status", "superseded")
      .order("uploaded_at", { ascending: false })
      .limit(1000);
    if (status !== "all") docsQuery = docsQuery.eq("status", status);

    const [docsRes, allDocsRes, studentsRes] = await Promise.all([
      docsQuery,
      supabaseAdmin
        .from("enrollment_documents")
        .select("id, student_id, doc_type, status, rejection_reason, uploaded_at")
        .eq("school_id", guard.schoolId)
        .neq("status", "superseded")
        .limit(5000),
      supabaseAdmin
        .from("students")
        .select("id, full_name, registration_number")
        .eq("school_id", guard.schoolId)
        .order("full_name", { ascending: true })
        .limit(2000),
    ]);

    if (docsRes.error || allDocsRes.error) return jsonFail(503, "Documentos de matrícula ainda não disponíveis nesta escola.");
    if (studentsRes.error) return jsonFail(500, "Falha ao carregar os alunos.");

    const studentName = new Map((studentsRes.data || []).map((s: any) => [String(s.id), s.full_name || "Aluno"]));
    const parentIds = [...new Set((docsRes.data || []).map((d: any) => d.parent_id).filter(Boolean))];
    const { data: parents } = parentIds.length
      ? await supabaseAdmin.from("parents").select("id, full_name").eq("school_id", guard.schoolId).in("id", parentIds)
      : { data: [] as any[] };
    const parentName = new Map((parents || []).map((p: any) => [String(p.id), p.full_name || "Responsável"]));

    const documents = (docsRes.data || []).map((d: any) => ({
      id: String(d.id),
      studentId: String(d.student_id),
      studentName: studentName.get(String(d.student_id)) || "Aluno",
      parentName: d.parent_id ? parentName.get(String(d.parent_id)) || "Responsável" : null,
      docType: d.doc_type,
      docLabel: DOC_TYPE_INFO[d.doc_type as DocType]?.label || d.doc_type,
      status: d.status,
      rejectionReason: d.rejection_reason ?? null,
      filename: d.original_filename,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes,
      uploadedAt: d.uploaded_at,
      reviewedAt: d.reviewed_at,
    }));

    const byStudent = new Map<string, any[]>();
    for (const d of allDocsRes.data || []) {
      const k = String(d.student_id);
      if (!byStudent.has(k)) byStudent.set(k, []);
      byStudent.get(k)!.push(d);
    }
    const students = (studentsRes.data || []).map((s: any) => {
      const summary = summarizeDocuments(byStudent.get(String(s.id)) || []);
      return {
        id: String(s.id),
        fullName: s.full_name || "Aluno",
        registrationNumber: s.registration_number || null,
        missingRequired: summary.filter((x) => x.required && (x.status === "missing" || x.status === "rejected")).map((x) => x.label),
        awaitingReview: summary.filter((x) => x.status === "pending").length,
      };
    });

    return jsonOk({
      documents,
      students,
      counts: {
        pending: (allDocsRes.data || []).filter((d: any) => d.status === "pending").length,
        studentsWithPendencies: students.filter((s) => s.missingRequired.length > 0).length,
      },
    });
  } catch (err) {
    logRouteError("GET /api/school/enrollment-documents", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Erro interno.");
  }
}
