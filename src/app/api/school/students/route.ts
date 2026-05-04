// src/app/api/school/students/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();

    let query = supabaseAdmin
      .from("students")
      .select(
        "id, school_id, full_name, birth_date, registration_number, class_id, created_at"
      )
      .eq("school_id", guard.schoolId)
      .order("full_name", { ascending: true })
      .limit(1000);

    if (q) {
      const safeQ = q.replace(/[%_]/g, "\\$&");

      query = query.or(
        `full_name.ilike.%${safeQ}%,registration_number.ilike.%${safeQ}%`
      );
    }

    const { data, error } = await query;

    if (error) {
      return jsonFail(500, error.message);
    }

    return jsonOk({ students: data || [] });
  } catch (err) {
    logRouteError("GET /api/school/students", err, {
      schoolId: guard.schoolId,
    });

    return jsonFail(500, "Internal error");
  }
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);

    const full_name = String(json?.full_name || "").trim();

    const registration_number =
      json?.registration_number != null
        ? String(json.registration_number).trim()
        : null;

    const birth_date = json?.birth_date ? String(json.birth_date).trim() : null;

    if (!full_name) {
      return jsonFail(422, "full_name is required");
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .insert({
        school_id: guard.schoolId,
        full_name,
        registration_number,
        birth_date,
        class_id: null,
      })
      .select(
        "id, school_id, full_name, birth_date, registration_number, class_id, created_at"
      )
      .single();

    if (error) {
      return jsonFail(500, error.message);
    }

    return jsonOk({ student: data }, 201);
  } catch (err) {
    logRouteError("POST /api/school/students", err, {
      schoolId: guard.schoolId,
    });

    return jsonFail(500, "Internal error");
  }
}