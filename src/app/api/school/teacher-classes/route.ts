// src/app/api/school/teacher-classes/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

export async function GET(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const teacherId = String(url.searchParams.get("teacherId") || "").trim();

    if (!teacherId) return jsonFail(422, "teacherId is required");

    const { data, error } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, teacher_id, class_id, school_id, is_active, created_at")
      .eq("school_id", guard.schoolId)
      .eq("teacher_id", teacherId)
      .order("created_at", { ascending: false });

    if (error) return jsonFail(500, error.message);

    return jsonOk({ links: data || [] });
  } catch (err) {
    logRouteError("GET /api/school/teacher-classes", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);
    const teacherId = String(json?.teacherId || "").trim();
    const classId = String(json?.classId || "").trim();

    if (!teacherId) return jsonFail(422, "teacherId is required");
    if (!classId) return jsonFail(422, "classId is required");

    // valida turma pertence à escola
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id")
      .eq("id", classId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();
    if (clsErr) return jsonFail(500, clsErr.message);
    if (!cls) return jsonFail(404, "Class not found");

    // se já existe vínculo (ativo ou inativo), reativa
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, is_active")
      .eq("school_id", guard.schoolId)
      .eq("teacher_id", teacherId)
      .eq("class_id", classId)
      .maybeSingle();

    if (exErr) return jsonFail(500, exErr.message);

    if (existing?.id) {
      if (existing.is_active) return jsonOk({ message: "Already linked", id: existing.id });

      const { data: upd, error: updErr } = await supabaseAdmin
        .from("teacher_classes")
        .update({ is_active: true })
        .eq("id", existing.id)
        .eq("school_id", guard.schoolId)
        .select("id")
        .single();

      if (updErr) return jsonFail(500, updErr.message);
      return jsonOk({ message: "Reactivated", id: upd.id }, 201);
    }

    const { data: ins, error: insErr } = await supabaseAdmin
      .from("teacher_classes")
      .insert({
        school_id: guard.schoolId,
        teacher_id: teacherId,
        class_id: classId,
        is_active: true,
      })
      .select("id")
      .single();

    if (insErr) return jsonFail(500, insErr.message);

    return jsonOk({ message: "Linked", id: ins.id }, 201);
  } catch (err) {
    logRouteError("POST /api/school/teacher-classes", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}