import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function canManage(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "director" || r === "coordenador" || r === "coordinator";
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

/**
 * GET /api/school/class-students/list?classId=<uuid>
 * - diretor/coordenador
 * - lista alunos vinculados à turma (ativos), com dados do aluno
 */
export async function GET(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) user logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const authedUserId = userData.user.id;

    // 2) vínculo ATIVO em school_users (pra pegar school_id e role)
    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", authedUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (suErr) return jsonError("school_users lookup failed: " + suErr.message, 500);
    if (!su?.school_id) return jsonError("Usuário não vinculado a uma escola.", 403);
    if (!canManage(su.role)) return jsonError(`Acesso negado. Role: "${su?.role}"`, 403);

    const schoolId = su.school_id;

    // 3) querystring classId
    const url = new URL(req.url);
    const classId = String(url.searchParams.get("classId") || "").trim();
    if (!classId) return jsonError("classId é obrigatório. Ex: ?classId=<uuid>", 400);

    // 4) garante que a turma pertence à escola (evita alguém listar turma de outra escola)
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return jsonError("classes lookup failed: " + clsErr.message, 500);
    if (!cls?.id) return jsonError("Turma não encontrada.", 404);
    if (cls.school_id !== schoolId) return jsonError("Turma não pertence à sua escola.", 403);

    // 5) lista vínculos ativos class_students
    const { data: links, error: lErr } = await supabaseAdmin
      .from("class_students")
      .select("id, student_id, class_id, school_id, is_active, created_at")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (lErr) return jsonError("class_students list failed: " + lErr.message, 500);

    const studentIds = Array.from(new Set((links ?? []).map((x: any) => x.student_id).filter(Boolean)));

    // 6) carrega dados dos alunos (ajuste aqui se seu schema tiver outros nomes)
    // Campos comuns: full_name, registration_number
    const studentsMap = new Map<string, { full_name?: string | null; registration_number?: string | null }>();

    if (studentIds.length > 0) {
      const { data: studs, error: sErr } = await supabaseAdmin
        .from("students")
        .select("id, full_name, registration_number")
        .in("id", studentIds);

      if (sErr) return jsonError("students lookup failed: " + sErr.message, 500);

      for (const s of (studs ?? []) as any[]) {
        studentsMap.set(s.id, {
          full_name: s.full_name ?? null,
          registration_number: s.registration_number ?? null,
        });
      }
    }

    // 7) monta resposta
    const classStudents = (links ?? []).map((row: any) => {
      const sid = row.student_id as string;
      const st = studentsMap.get(sid);

      return {
        id: row.id,
        classId: row.class_id,
        studentId: sid,
        createdAt: row.created_at ?? null,

        studentName: st?.full_name ?? null,
        registrationNumber: st?.registration_number ?? null,
      };
    });

    return NextResponse.json({ ok: true, classStudents });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/class-students/list", 500);
  }
}
