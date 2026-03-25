// src/app/api/teacher/classes/[classId]/students/list/route.ts
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
 * GET /api/teacher/classes/[classId]/students/list
 *
 * Segurança (OPÇÃO A):
 * - valida sessão no Auth
 * - exige role professor
 * - garante que o professor está vinculado à turma (teacher_classes.is_active = true)
 * - retorna alunos da turma (class_students.is_active = true) com dados básicos do students
 */
export async function GET(req: Request, ctx: { params: { classId: string } }) {
  try {
    const classId = String(ctx?.params?.classId || "").trim();
    if (!classId) return jsonError("classId é obrigatório.", 400);

    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) Usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const userId = userData.user.id;

    // 2) Confirma vínculo staff (professor) ativo e pega school_id
    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", userId)
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

    // 3) Garante que a turma pertence à escola do professor
    const { data: clsRow, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id, name, grade, shift")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return jsonError("classes lookup failed: " + clsErr.message, 500);
    if (!clsRow?.id) return jsonError("Turma não encontrada.", 404);
    if (clsRow.school_id !== schoolId) return jsonError("Turma não pertence à sua escola.", 403);

    // 4) Garante que o professor está vinculado a essa turma (teacher_classes)
    const { data: tc, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("teacher_user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (tcErr) return jsonError("teacher_classes lookup failed: " + tcErr.message, 500);
    if (!tc?.id) return jsonError("Você não tem acesso a esta turma.", 403);

    // 5) Lista alunos vinculados à turma (class_students)
    // OBS: se sua tabela for "students" com colunas diferentes, ajuste o select abaixo.
    const { data: cs, error: csErr } = await supabaseAdmin
      .from("class_students")
      .select("id, student_id, created_at, is_active")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (csErr) return jsonError("class_students list failed: " + csErr.message, 500);

    const studentIds = Array.from(new Set((cs ?? []).map((r: any) => r.student_id).filter(Boolean)));

    // 6) Carrega dados básicos dos students (ajuste colunas se necessário)
    const studentsMap = new Map<string, any>();
    if (studentIds.length > 0) {
      const { data: students, error: sErr } = await supabaseAdmin
        .from("students")
        .select("id, full_name, ra, created_at")
        .in("id", studentIds);

      if (!sErr && Array.isArray(students)) {
        for (const s of students as any[]) studentsMap.set(s.id, s);
      }
    }

    // 7) Monta resposta
    const students = (cs ?? []).map((row: any) => {
      const sid = row.student_id as string;
      const s = studentsMap.get(sid);

      return {
        classStudentId: row.id,
        studentId: sid,
        createdAt: row.created_at ?? null,

        // dados do aluno (pode vir null se não existir/colunas divergirem)
        fullName: s?.full_name ?? null,
        ra: s?.ra ?? null,
        studentCreatedAt: s?.created_at ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      schoolId,
      class: {
        id: clsRow.id,
        name: clsRow.name ?? null,
        grade: clsRow.grade ?? null,
        shift: clsRow.shift ?? null,
      },
      students,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/teacher/classes/[classId]/students/list", 500);
  }
}
