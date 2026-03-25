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
  return r === "diretor" || r === "coordenador" || r === "director" || r === "coordinator";
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function POST(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) Descobre user logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const requesterId = userData.user.id;

    // 2) Vínculo ATIVO do requester (pegar school_id e role)
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError("school_users lookup failed: " + staffErr.message, 500);
    if (!staff?.school_id) return jsonError("Você não está vinculado a nenhuma escola.", 403);
    if (!canManage(staff.role)) return jsonError(`Forbidden: role "${staff.role}"`, 403);

    const schoolId = staff.school_id;

    // 3) Payload
    const body = await req.json().catch(() => ({}));
    const classId = String(body?.classId || "").trim();
    const studentId = String(body?.studentId || "").trim();

    if (!classId) return jsonError("classId é obrigatório.", 400);
    if (!studentId) return jsonError("studentId é obrigatório.", 400);

    // 4) Garante que a turma pertence à escola do requester
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return jsonError("classes lookup failed: " + clsErr.message, 500);
    if (!cls?.id) return jsonError("Turma não encontrada.", 404);
    if (cls.school_id !== schoolId) return jsonError("Turma não pertence à sua escola.", 403);

    // 5) Garante que o aluno pertence à escola do requester (se sua tabela students tiver school_id)
    // Se seu students NÃO tiver school_id, me avise que eu adapto para validar via class_students/parents.
    const { data: stu, error: stuErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .maybeSingle();

    if (stuErr) return jsonError("students lookup failed: " + stuErr.message, 500);
    if (!stu?.id) return jsonError("Aluno não encontrado.", 404);
    if (stu.school_id !== schoolId) return jsonError("Aluno não pertence à sua escola.", 403);

    // 6) Evita duplicar: se existir vínculo inativo, reativa; se não existir, insere
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("class_students")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) return jsonError("class_students lookup failed: " + exErr.message, 500);

    if (existing?.id) {
      if (existing.is_active) {
        return NextResponse.json({ ok: true, reused: true, id: existing.id });
      }

      const { error: upErr } = await supabaseAdmin
        .from("class_students")
        .update({ is_active: true })
        .eq("id", existing.id);

      if (upErr) return jsonError("class_students update failed: " + upErr.message, 500);

      return NextResponse.json({ ok: true, reactivated: true, id: existing.id });
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("class_students")
      .insert({
        school_id: schoolId,
        class_id: classId,
        student_id: studentId,
        is_active: true,
      })
      .select("id")
      .maybeSingle();

    if (insErr) return jsonError("class_students insert failed: " + insErr.message, 500);

    return NextResponse.json({ ok: true, id: inserted?.id ?? null });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/class-students/assign", 500);
  }
}
