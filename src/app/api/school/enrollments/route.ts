// src/app/api/school/enrollments/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

/**
 * GET /api/school/enrollments?classId=...&active=1
 * - Lista vínculos (student_classes) com join de student (nome/matrícula)
 */
export async function GET(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const classId = String(url.searchParams.get("classId") || "").trim();
    const active = url.searchParams.get("active");

    if (!classId) return jsonFail(422, "classId is required");

    // garante que a turma pertence à escola
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id")
      .eq("id", classId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (clsErr) return jsonFail(500, clsErr.message);
    if (!cls) return jsonFail(404, "Class not found");

    let q = supabaseAdmin
      .from("student_classes")
      .select(
        `
        id, student_id, class_id, school_id, is_active, started_at, ended_at, created_at,
        students:student_id ( id, full_name, registration_number, birth_date, created_at )
      `
      )
      .eq("school_id", guard.schoolId)
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (active === "1" || active === "true") {
      q = q.eq("is_active", true);
    }

    const { data, error } = await q;
    if (error) return jsonFail(500, error.message);

    return jsonOk({ enrollments: data || [] });
  } catch (err) {
    logRouteError("GET /api/school/enrollments", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}

/**
 * POST /api/school/enrollments
 * body: { studentId, classId, mode?: 'rpc' | 'direct' }
 *
 * - modo padrão: tenta RPC set_active_class (se existir)
 * - fallback: faz update das ativas e cria novo vínculo ativo (atômico via transação não existe aqui),
 *   mas ainda assim é estável (ordem correta + checks).
 */
export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);
    const studentId = String(json?.studentId || "").trim();
    const classId = String(json?.classId || "").trim();
    const mode = String(json?.mode || "rpc").toLowerCase();

    if (!studentId) return jsonFail(422, "studentId is required");
    if (!classId) return jsonFail(422, "classId is required");

    // valida student e class pertencem à escola
    const [{ data: st, error: stErr }, { data: cls, error: clsErr }] = await Promise.all([
      supabaseAdmin.from("students").select("id").eq("id", studentId).eq("school_id", guard.schoolId).maybeSingle(),
      supabaseAdmin.from("classes").select("id").eq("id", classId).eq("school_id", guard.schoolId).maybeSingle(),
    ]);

    if (stErr) return jsonFail(500, stErr.message);
    if (clsErr) return jsonFail(500, clsErr.message);
    if (!st) return jsonFail(404, "Student not found");
    if (!cls) return jsonFail(404, "Class not found");

    // Evita duplicar vínculo ativo já existente
    const { data: existingActive, error: exErr } = await supabaseAdmin
      .from("student_classes")
      .select("id, class_id")
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle();

    if (exErr) return jsonFail(500, exErr.message);
    if (existingActive?.class_id === classId) {
      return jsonOk({ message: "Already active", enrollmentId: existingActive.id });
    }

    if (mode !== "direct") {
      // tenta RPC se existir
      const { error: rpcErr } = await supabaseAdmin.rpc("set_active_class", {
        p_student_id: studentId,
        p_class_id: classId,
      });

      if (!rpcErr) {
        return jsonOk({ message: "Enrolled via RPC" }, 201);
      }
      // fallback silencioso (mas com log mínimo)
      logRouteError("RPC set_active_class failed (fallback direct)", rpcErr, {
        schoolId: guard.schoolId,
        studentId,
        classId,
      });
    }

    // fallback direto:
    // 1) encerra qualquer vínculo ativo do aluno
    const { error: endErr } = await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false, ended_at: new Date().toISOString().slice(0, 10) })
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true);

    if (endErr) return jsonFail(500, endErr.message);

    // 2) cria novo vínculo ativo
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("student_classes")
      .insert({
        school_id: guard.schoolId,
        student_id: studentId,
        class_id: classId,
        is_active: true,
        started_at: new Date().toISOString().slice(0, 10),
        ended_at: null,
      })
      .select("id")
      .single();

    if (insErr) return jsonFail(500, insErr.message);

    return jsonOk({ message: "Enrolled direct", enrollmentId: inserted?.id }, 201);
  } catch (err) {
    logRouteError("POST /api/school/enrollments", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}