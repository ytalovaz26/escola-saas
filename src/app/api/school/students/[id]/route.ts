// src/app/api/school/students/[id]/route.ts
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
    if (json?.full_name !== undefined) patch.full_name = String(json.full_name || "").trim();
    if (json?.registration_number !== undefined)
      patch.registration_number = json.registration_number === null ? null : String(json.registration_number).trim();
    if (json?.birth_date !== undefined) patch.birth_date = json.birth_date ? String(json.birth_date).trim() : null;

    if (patch.full_name !== undefined && !patch.full_name) return jsonFail(422, "full_name cannot be empty");

    const { data, error } = await supabaseAdmin
      .from("students")
      .update(patch)
      .eq("id", id)
      .eq("school_id", guard.schoolId)
      .select("id, school_id, full_name, birth_date, registration_number, class_id, created_at")
      .maybeSingle();

    if (error) return jsonFail(500, error.message);
    if (!data) return jsonFail(404, "Student not found");

    return jsonOk({ student: data });
  } catch (err) {
    logRouteError("PATCH /api/school/students/[id]", err, { schoolId: guard.schoolId, id });
    return jsonFail(500, "Internal error");
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;

  try {
    // segurança: não deletar se houver vínculos em student_classes (mantém histórico)
    const { data: links, error: linkErr } = await supabaseAdmin
      .from("student_classes")
      .select("id")
      .eq("school_id", guard.schoolId)
      .eq("student_id", id)
      .limit(1);

    if (linkErr) return jsonFail(500, linkErr.message);
    if (links && links.length > 0) {
      return jsonFail(422, "Não é possível excluir: aluno possui histórico em student_classes. Inative/remova vínculo em vez de deletar.");
    }

    const { error } = await supabaseAdmin
      .from("students")
      .delete()
      .eq("id", id)
      .eq("school_id", guard.schoolId);

    if (error) return jsonFail(500, error.message);

    return jsonOk({ deleted: true });
  } catch (err) {
    logRouteError("DELETE /api/school/students/[id]", err, { schoolId: guard.schoolId, id });
    return jsonFail(500, "Internal error");
  }
}