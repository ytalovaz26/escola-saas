// src/app/api/parent/enrollment/students/[studentId]/route.ts
// Matrícula digital (responsável): atualização dos dados do aluno vinculado.
// Somente campos autorizados (lib/enrollment/rules → STUDENT_FIELDS); dados de identidade
// já informados pela escola não são sobrescritos; nome, matrícula, turma e escola nunca mudam.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";
import { requireParentForStudent } from "@/lib/enrollment/server";
import { STUDENT_FIELDS, STUDENT_SELECT_COLUMNS, computeStudentUpdate, studentPendingFields } from "@/lib/enrollment/rules";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  const guard = await requireParentForStudent(req, studentId);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);
    if (!json || typeof json !== "object" || Array.isArray(json)) return jsonFail(400, "Dados inválidos.");

    const { data: current, error: loadErr } = await supabaseAdmin
      .from("students")
      .select(STUDENT_SELECT_COLUMNS.join(", "))
      .eq("id", guard.studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();
    if (loadErr || !current) return jsonFail(404, "Aluno não encontrado.");

    const result = computeStudentUpdate(current as any, json as Record<string, unknown>);
    if (!result.ok) return jsonFail(422, "Revise os campos destacados.", { details: result.errors });

    if (Object.keys(result.payload).length) {
      const { error: updErr } = await supabaseAdmin
        .from("students")
        .update({ ...result.payload, student_profile_updated_at: new Date().toISOString() })
        .eq("id", guard.studentId)
        .eq("school_id", guard.schoolId);
      if (updErr) return jsonFail(500, "Não foi possível salvar os dados do aluno.");
    }

    const merged = { ...(current as any), ...result.payload };
    return jsonOk({
      saved: Object.keys(result.payload).length,
      ignored: result.ignored,
      fields: Object.fromEntries(STUDENT_FIELDS.map((f) => [f.key, merged[f.column] ?? null])),
      pendingFields: studentPendingFields(merged),
    });
  } catch (err) {
    logRouteError("PATCH /api/parent/enrollment/students/[studentId]", err, { studentId: guard.studentId });
    return jsonFail(500, "Erro interno.");
  }
}
