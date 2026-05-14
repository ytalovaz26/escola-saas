// src/app/api/school/classes/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

const CAN_READ_CLASSES = [
  "director",
  "coordinator",
  "secretary",
  "diretor",
  "coordenador",
  "secretaria",
  "admin",
];

const CAN_CREATE_CLASSES = [
  "director",
  "coordinator",
  "diretor",
  "coordenador",
  "admin",
];

export async function GET(req: Request) {
  const guard = await requireStaff(req, CAN_READ_CLASSES);
  if (!guard.ok) return guard.res;

  try {
    const { data, error } = await supabaseAdmin
      .from("classes")
      .select("id, school_id, name, grade, shift, created_at")
      .eq("school_id", guard.schoolId)
      .order("created_at", { ascending: false });

    if (error) return jsonFail(500, error.message);

    return jsonOk({ classes: data || [] });
  } catch (err) {
    logRouteError("GET /api/school/classes", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, CAN_CREATE_CLASSES);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);

    const name = String(json?.name || "").trim();
    const grade = json?.grade != null ? String(json.grade).trim() : null;
    const shift = json?.shift != null ? String(json.shift).trim() : null;

    if (!name) return jsonFail(422, "name is required");

    const { data, error } = await supabaseAdmin
      .from("classes")
      .insert({
        school_id: guard.schoolId,
        name,
        grade,
        shift,
      })
      .select("id, school_id, name, grade, shift, created_at")
      .single();

    if (error) return jsonFail(500, error.message);

    return jsonOk({ class: data }, 201);
  } catch (err) {
    logRouteError("POST /api/school/classes", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}