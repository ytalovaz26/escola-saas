// src/app/api/school/class-students/list/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";

const CAN_READ_CLASS_STUDENTS = [
  "director",
  "coordinator",
  "secretary",
  "diretor",
  "coordenador",
  "secretaria",
  "admin",
];

export async function GET(req: Request) {
  const guard = await requireStaff(req, CAN_READ_CLASS_STUDENTS);
  if (!guard.ok) return guard.res;

  try {
    const { data, error } = await supabaseAdmin
      .from("student_classes")
      .select("student_id, class_id")
      .eq("school_id", guard.schoolId)
      .eq("is_active", true);

    if (error) return jsonFail(500, error.message);

    return jsonOk({
      links: data || [],
    });
  } catch (err) {
    logRouteError("GET /api/school/class-students/list", err, {
      schoolId: guard.schoolId,
    });

    return jsonFail(500, "Internal error");
  }
}