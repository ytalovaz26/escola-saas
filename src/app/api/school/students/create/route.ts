import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);

    const fullName = String(json?.full_name || "").trim();
    const birthDate = json?.birth_date ? String(json.birth_date).trim() : null;
    const registrationNumber = json?.registration_number
      ? String(json.registration_number).trim()
      : null;
    const classId = String(json?.class_id || "").trim();

    if (!fullName) return jsonFail(422, "Informe o nome completo do aluno.");
    if (!classId) return jsonFail(422, "Selecione a turma do aluno.");

    // 1) valida se a turma pertence à escola do diretor/coordenador
    const { data: classRow, error: classErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (classErr) return jsonFail(500, classErr.message);
    if (!classRow) return jsonFail(404, "Turma não encontrada para esta escola.");

    // 2) cria aluno já com school_id
    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .insert({
        school_id: guard.schoolId,
        full_name: fullName,
        birth_date: birthDate,
        registration_number: registrationNumber,
      })
      .select("id, school_id, full_name, birth_date, registration_number, created_at")
      .single();

    if (studentErr) {
      return jsonFail(500, `Erro ao criar aluno: ${studentErr.message}`);
    }

    // 3) desativa vínculos antigos só por segurança
    const { error: deactivateErr } = await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false })
      .eq("student_id", student.id)
      .eq("school_id", guard.schoolId)
      .eq("is_active", true);

    if (deactivateErr) {
      await supabaseAdmin.from("students").delete().eq("id", student.id).eq("school_id", guard.schoolId);
      return jsonFail(500, `Erro ao preparar vínculo da turma: ${deactivateErr.message}`);
    }

    // 4) cria vínculo ativo com a turma
    const { error: linkErr } = await supabaseAdmin
      .from("student_classes")
      .insert({
        school_id: guard.schoolId,
        student_id: student.id,
        class_id: classId,
        is_active: true,
      });

    if (linkErr) {
      await supabaseAdmin.from("students").delete().eq("id", student.id).eq("school_id", guard.schoolId);
      return jsonFail(500, `Erro ao vincular aluno na turma: ${linkErr.message}`);
    }

    return jsonOk({
      student,
      active_class: {
        student_id: student.id,
        class_id: classId,
      },
    });
  } catch (err) {
    logRouteError("POST /api/school/students/create", err);
    return jsonFail(500, "Internal error");
  }
}