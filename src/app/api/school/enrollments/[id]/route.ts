// src/app/api/school/enrollments/[id]/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/school/enrollments/:id
 * Encerra vínculo (não apaga histórico)
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;

  try {
    // pega vínculo e confere school_id
    const { data: link, error: lErr } = await supabaseAdmin
      .from("student_classes")
      .select("id, school_id, is_active")
      .eq("id", id)
      .maybeSingle();

    if (lErr) return jsonFail(500, lErr.message);
    if (!link) return jsonFail(404, "Enrollment not found");
    if (link.school_id !== guard.schoolId) return jsonFail(403, "Forbidden");

    if (!link.is_active) return jsonOk({ message: "Already inactive" });

    const { error: updErr } = await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false, ended_at: new Date().toISOString().slice(0, 10) })
      .eq("id", id)
      .eq("school_id", guard.schoolId);

    if (updErr) return jsonFail(500, updErr.message);

    return jsonOk({ ok: true, ended: true });
  } catch (err) {
    logRouteError("DELETE /api/school/enrollments/[id]", err, { schoolId: guard.schoolId, id });
    return jsonFail(500, "Internal error");
  }
}