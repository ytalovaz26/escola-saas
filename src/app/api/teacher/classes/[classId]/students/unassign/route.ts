// src/app/api/teacher/classes/[classId]/students/unassign/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function POST(req: Request, context: any) {
  try {
    const classId = String(context?.params?.classId || "").trim();
    if (!classId) return jsonError("classId é obrigatório.", 400);

    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const teacherUserId = userData.user.id;

    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", teacherUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (suErr) return jsonError("school_users lookup failed: " + suErr.message, 500);
    if (!su?.school_id) return jsonError("Usuário não vinculado a uma escola.", 403);

    const role = normRole(su.role);
    if (!(role === "professor" || role === "teacher")) {
      return jsonError(`Acesso negado. Role: "${su?.role}"`, 403);
    }

    const schoolId = su.school_id;

    const { data: clsRow, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return jsonError("classes lookup failed: " + clsErr.message, 500);
    if (!clsRow?.id) return jsonError("Turma não encontrada.", 404);
    if (clsRow.school_id !== schoolId) return jsonError("Turma não pertence à sua escola.", 403);

    const { data: tc, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("teacher_user_id", teacherUserId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (tcErr) return jsonError("teacher_classes lookup failed: " + tcErr.message, 500);
    if (!tc?.id) return jsonError("Você não tem acesso a esta turma.", 403);

    const body = await req.json().catch(() => ({}));
    const studentId = String(body?.studentId || "").trim();
    const classStudentId = String(body?.classStudentId || "").trim();

    if (!studentId && !classStudentId) {
      return jsonError("Envie studentId ou classStudentId.", 400);
    }

    let row: any = null;

    if (classStudentId) {
      const { data, error } = await supabaseAdmin
        .from("class_students")
        .select("id, school_id, class_id, student_id, is_active")
        .eq("id", classStudentId)
        .maybeSingle();

      if (error) return jsonError("class_students lookup failed: " + error.message, 500);
      row = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("class_students")
        .select("id, school_id, class_id, student_id, is_active")
        .eq("school_id", schoolId)
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return jsonError("class_students lookup failed: " + error.message, 500);
      row = data;
    }

    if (!row?.id) return jsonError("Vínculo aluno↔️turma não encontrado.", 404);
    if (row.school_id !== schoolId) return jsonError("Vínculo não pertence à sua escola.", 403);
    if (row.class_id !== classId) return jsonError("Vínculo não pertence a esta turma.", 403);

    const { error: upErr } = await supabaseAdmin
      .from("class_students")
      .update({ is_active: false })
      .eq("id", row.id);

    if (upErr) return jsonError("class_students update failed: " + upErr.message, 500);

    return NextResponse.json({
      ok: true,
      classStudentId: row.id,
      studentId: row.student_id,
    });
  } catch (e: any) {
    return jsonError(
      e?.message || "Internal error in /api/teacher/classes/[classId]/students/unassign",
      500
    );
  }
}