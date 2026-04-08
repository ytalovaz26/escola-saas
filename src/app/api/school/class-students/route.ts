import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk } from "@/lib/http";

export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const body = await req.json();

    const studentId = body?.student_id;

    if (!studentId) {
      return jsonFail(422, "student_id is required");
    }

    // 🔥 DESATIVA vínculo atual
    const { error } = await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false })
      .eq("student_id", studentId)
      .eq("school_id", guard.schoolId)
      .eq("is_active", true);

    if (error) {
      return jsonFail(500, error.message);
    }

    return jsonOk({ ok: true });
  } catch (err: any) {
    return jsonFail(500, err.message || "Internal error");
  }
}