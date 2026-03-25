// src/app/api/school/teacher-classes/[id]/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;

  try {
    const { data: link, error: lErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, school_id, is_active")
      .eq("id", id)
      .maybeSingle();

    if (lErr) return jsonFail(500, lErr.message);
    if (!link) return jsonFail(404, "Link not found");
    if (link.school_id !== guard.schoolId) return jsonFail(403, "Forbidden");

    if (!link.is_active) return jsonOk({ message: "Already inactive" });

    const { error: updErr } = await supabaseAdmin
      .from("teacher_classes")
      .update({ is_active: false })
      .eq("id", id)
      .eq("school_id", guard.schoolId);

    if (updErr) return jsonFail(500, updErr.message);

    return jsonOk({ ok: true, disabled: true });
  } catch (err) {
    logRouteError("DELETE /api/school/teacher-classes/[id]", err, { schoolId: guard.schoolId, id });
    return jsonFail(500, "Internal error");
  }
}