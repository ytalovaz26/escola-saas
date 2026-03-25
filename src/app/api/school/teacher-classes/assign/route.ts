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

    // 1) Usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const requesterId = userData.user.id;

    // 2) Vínculo ATIVO do requester (diretor/coordenador)
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

    const schoolId = String(staff.school_id);

    // 3) Payload (aceita camelCase e snake_case)
    const body = await req.json().catch(() => ({}));

    const teacherUserId = String(body?.teacher_user_id || body?.teacherUserId || "").trim();
    const classId = String(body?.class_id || body?.classId || "").trim();

    if (!teacherUserId) return jsonError("teacher_user_id é obrigatório.", 400);
    if (!classId) return jsonError("class_id é obrigatório.", 400);

    // 4) Garante que o professor pertence à escola e está ativo
    const { data: teacherLink, error: tLinkErr } = await supabaseAdmin
      .from("school_users")
      .select("id, school_id, role, is_active")
      .eq("school_id", schoolId)
      .eq("user_id", teacherUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tLinkErr) return jsonError("school_users teacher lookup failed: " + tLinkErr.message, 500);
    if (!teacherLink?.id) return jsonError("Professor não está vinculado/ativo nesta escola.", 404);

    const teacherRole = normRole(teacherLink.role);
    if (teacherRole !== "professor" && teacherRole !== "teacher") {
      return jsonError(`Usuário não é professor (role atual: "${teacherLink.role}").`, 400);
    }

    // 5) Garante que a turma existe e pertence à mesma escola
    // ✅ NÃO seleciona is_active porque sua tabela não tem essa coluna
    const { data: cls, error: cErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (cErr) return jsonError("classes lookup failed: " + cErr.message, 500);
    if (!cls?.id) return jsonError("Turma não encontrada.", 404);
    if (String(cls.school_id) !== String(schoolId)) return jsonError("Turma não pertence à sua escola.", 403);

    // 6) Evita duplicar: se já existe vínculo, reativa; se não existe, cria
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherUserId)
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) return jsonError("teacher_classes lookup failed: " + exErr.message, 500);

    let assignmentId: string | null = null;

    if (!existing?.id) {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("teacher_classes")
        .insert({
          school_id: schoolId,
          teacher_user_id: teacherUserId,
          class_id: classId,
          is_active: true,
        })
        .select("id")
        .maybeSingle();

      if (insErr) return jsonError("teacher_classes insert failed: " + insErr.message, 500);
      assignmentId = inserted?.id ?? null;
    } else {
      const { error: upErr } = await supabaseAdmin
        .from("teacher_classes")
        .update({ is_active: true })
        .eq("id", existing.id);

      if (upErr) return jsonError("teacher_classes update failed: " + upErr.message, 500);
      assignmentId = existing.id;
    }

    return NextResponse.json({
      ok: true,
      assignment: {
        id: assignmentId,
        schoolId,
        teacherUserId,
        classId,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/teacher-classes/assign", 500);
  }
}
