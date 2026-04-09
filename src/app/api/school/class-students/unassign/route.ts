import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);
    const studentId = String(json?.student_id || "").trim();

    if (!studentId) return jsonFail(422, "student_id é obrigatório.");

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (studentErr) return jsonFail(500, studentErr.message);
    if (!student) return jsonFail(404, "Aluno não encontrado nesta escola.");

    const { error: deactivateErr } = await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false })
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true);

    if (deactivateErr) return jsonFail(500, deactivateErr.message);

    const { error: legacyErr } = await supabaseAdmin
      .from("students")
      .update({ class_id: null })
      .eq("id", studentId)
      .eq("school_id", guard.schoolId);

    if (legacyErr) return jsonFail(500, legacyErr.message);

    return jsonOk({
      unassigned: true,
      student_id: studentId,
    });
  } catch (err) {
    logRouteError("POST /api/school/class-students/unassign", err, {
      schoolId: guard.schoolId,
    });
    return jsonFail(500, "Internal error");
  }
}