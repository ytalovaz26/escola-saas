// src/app/api/school/classes/[id]/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;

  try {
    const { json } = await readJsonBody(req);

    const patch: any = {};
    if (json?.name !== undefined) patch.name = String(json.name || "").trim();
    if (json?.grade !== undefined) patch.grade = json.grade === null ? null : String(json.grade).trim();
    if (json?.shift !== undefined) patch.shift = json.shift === null ? null : String(json.shift).trim();

    if (patch.name !== undefined && !patch.name) return jsonFail(422, "name cannot be empty");

    const { data, error } = await supabaseAdmin
      .from("classes")
      .update(patch)
      .eq("id", id)
      .eq("school_id", guard.schoolId)
      .select("id, school_id, name, grade, shift, created_at")
      .maybeSingle();

    if (error) return jsonFail(500, error.message);
    if (!data) return jsonFail(404, "Class not found");

    return jsonOk({ class: data });
  } catch (err) {
    logRouteError("PATCH /api/school/classes/[id]", err, { schoolId: guard.schoolId, id });
    return jsonFail(500, "Internal error");
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;

  try {
    // Regra de segurança: não deletar turma se tiver vínculo ativo em student_classes
    const { data: activeLinks, error: linkErr } = await supabaseAdmin
      .from("student_classes")
      .select("id")
      .eq("school_id", guard.schoolId)
      .eq("class_id", id)
      .eq("is_active", true)
      .limit(1);

    if (linkErr) return jsonFail(500, linkErr.message);
    if (activeLinks && activeLinks.length > 0) {
      return jsonFail(422, "Não é possível excluir: existem alunos vinculados (student_classes ativo).");
    }

    // Regra de segurança: não deletar turma se tiver teacher_classes ativo
    const { data: activeTeachers, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id")
      .eq("school_id", guard.schoolId)
      .eq("class_id", id)
      .eq("is_active", true)
      .limit(1);

    if (tcErr) return jsonFail(500, tcErr.message);
    if (activeTeachers && activeTeachers.length > 0) {
      return jsonFail(422, "Não é possível excluir: existem professores vinculados (teacher_classes ativo).");
    }

    const { error } = await supabaseAdmin
      .from("classes")
      .delete()
      .eq("id", id)
      .eq("school_id", guard.schoolId);

    if (error) return jsonFail(500, error.message);

    return jsonOk({ deleted: true });
  } catch (err) {
    logRouteError("DELETE /api/school/classes/[id]", err, { schoolId: guard.schoolId, id });
    return jsonFail(500, "Internal error");
  }
}