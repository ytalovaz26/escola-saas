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

/**
 * GET
 * Params (query):
 *  - classId (uuid)
 *  - date (YYYY-MM-DD)
 *  - lesson (number)
 *
 * Retorna:
 *  - session (attendance_sessions)
 *  - students da turma
 */
export async function GET(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Sessão inválida.", 401);
    }

    const teacherUserId = userData.user.id;

    // 2) vínculo ativo do professor
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role")
      .eq("user_id", teacherUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError(staffErr.message, 500);

    const role = normRole(staff?.role);
    if (!(role === "professor" || role === "teacher")) {
      return jsonError("Acesso permitido apenas para professores.", 403);
    }

    const schoolId = staff.school_id;
    if (!schoolId) return jsonError("Professor sem escola vinculada.", 403);

    // 3) params
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    const lessonDate = searchParams.get("date");
    const lessonNumber = Number(searchParams.get("lesson"));

    if (!classId || !lessonDate || !lessonNumber) {
      return jsonError("Parâmetros obrigatórios: classId, date, lesson.", 400);
    }

    // 4) garante que o professor é vinculado à turma
    const { data: tc, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id")
      .eq("teacher_user_id", teacherUserId)
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .maybeSingle();

    if (tcErr) return jsonError(tcErr.message, 500);
    if (!tc?.id) return jsonError("Você não está vinculado a esta turma.", 403);

    // 5) buscar ou criar sessão da aula
    let { data: session, error: sErr } = await supabaseAdmin
      .from("attendance_sessions")
      .select("*")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("lesson_date", lessonDate)
      .eq("lesson_number", lessonNumber)
      .eq("is_active", true)
      .maybeSingle();

    if (sErr) return jsonError(sErr.message, 500);

    if (!session) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from("attendance_sessions")
        .insert({
          school_id: schoolId,
          class_id: classId,
          teacher_user_id: teacherUserId,
          lesson_date: lessonDate,
          lesson_number: lessonNumber,
          is_active: true,
        })
        .select()
        .single();

      if (cErr) return jsonError(cErr.message, 500);
      session = created;
    }

    // 6) alunos da turma
    const { data: students, error: stErr } = await supabaseAdmin
      .from("class_students")
      .select(`
        student_id,
        students (
          id,
          full_name,
          enrollment_number
        )
      `)
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("is_active", true);

    if (stErr) return jsonError(stErr.message, 500);

    const normalizedStudents =
      students?.map((r: any) => ({
        studentId: r.students.id,
        fullName: r.students.full_name,
        enrollmentNumber: r.students.enrollment_number,
      })) ?? [];

    return NextResponse.json({
      ok: true,
      session,
      students: normalizedStudents,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado na sessão de presença.", 500);
  }
}
