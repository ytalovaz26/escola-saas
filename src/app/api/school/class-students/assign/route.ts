import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);

    const studentId = String(json?.student_id || "").trim();
    const classId = String(json?.class_id || "").trim();

    if (!studentId) return jsonFail(422, "student_id é obrigatório.");
    if (!classId) return jsonFail(422, "class_id é obrigatório.");

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (studentErr) return jsonFail(500, studentErr.message);
    if (!student) return jsonFail(404, "Aluno não encontrado nesta escola.");

    const { data: cls, error: classErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (classErr) return jsonFail(500, classErr.message);
    if (!cls) return jsonFail(404, "Turma não encontrada nesta escola.");

    const { error: deactivateErr } = await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false })
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true);

    if (deactivateErr) return jsonFail(500, deactivateErr.message);

    const { error: insertErr } = await supabaseAdmin
      .from("student_classes")
      .insert({
        school_id: guard.schoolId,
        student_id: studentId,
        class_id: classId,
        is_active: true,
      });

    if (insertErr) return jsonFail(500, insertErr.message);

    const { error: legacyErr } = await supabaseAdmin
      .from("students")
      .update({ class_id: classId })
      .eq("id", studentId)
      .eq("school_id", guard.schoolId);

    if (legacyErr) return jsonFail(500, legacyErr.message);

    return jsonOk({
      assigned: true,
      student_id: studentId,
      class_id: classId,
    });
  } catch (err) {
    logRouteError("POST /api/school/class-students/assign", err, {
      schoolId: guard.schoolId,
    });
    return jsonFail(500, "Internal error");
  }
}