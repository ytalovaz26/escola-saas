// src/app/api/school/students/[id]/documents/route.ts
// Matrícula digital (direção, coordenação, secretaria): documentos de UM aluno da própria
// escola, com todas as versões (histórico). Não devolve URLs: visualização e download usam
// GET /api/school/enrollment-documents/[documentId]/url (link temporário de 5 min) e a
// análise usa POST /api/school/enrollment-documents/[documentId]/review.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";
import { STAFF_DOCUMENT_ROLES } from "@/lib/enrollment/server";
import { isUuid } from "@/lib/enrollment/rules";
import { buildStudentDocumentGroups } from "@/lib/enrollment/studentDocuments";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(req, STAFF_DOCUMENT_ROLES);
  if (!guard.ok) return guard.res;

  const { id: studentId } = await ctx.params;
  if (!isUuid(studentId)) return jsonFail(404, "Aluno não encontrado.");

  try {
    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number")
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();
    if (studentErr) return jsonFail(500, "Falha ao carregar o aluno.");
    if (!student) return jsonFail(404, "Aluno não encontrado.");

    const { data: rows, error: docsErr } = await supabaseAdmin
      .from("enrollment_documents")
      .select(
        "id, doc_type, status, parent_id, uploaded_by, original_filename, mime_type, size_bytes, rejection_reason, uploaded_at, reviewed_at, replaces_id"
      )
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .order("uploaded_at", { ascending: false })
      .limit(500);
    if (docsErr) return jsonFail(503, "Documentos de matrícula ainda não disponíveis nesta escola.");

    const parentIds = [...new Set((rows || []).map((r: any) => r.parent_id).filter(Boolean).map(String))];
    const { data: parents, error: parentsErr } = parentIds.length
      ? await supabaseAdmin.from("parents").select("id, full_name").eq("school_id", guard.schoolId).in("id", parentIds)
      : { data: [] as any[], error: null };
    if (parentsErr) return jsonFail(500, "Falha ao carregar os responsáveis.");

    const parentNameById = new Map<string, string>(
      (parents || []).map((p: any) => [String(p.id), String(p.full_name || "Responsável")])
    );

    return jsonOk({
      student: {
        id: String(student.id),
        fullName: student.full_name || "Aluno",
        registrationNumber: student.registration_number || null,
      },
      groups: buildStudentDocumentGroups((rows || []) as any[], parentNameById),
    });
  } catch (err) {
    logRouteError("GET /api/school/students/[id]/documents", err, { schoolId: guard.schoolId, studentId });
    return jsonFail(500, "Erro interno.");
  }
}
