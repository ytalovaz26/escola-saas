// src/app/api/school/teachers/classes/unassign/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

// diretor/coordenador podem gerenciar (se quiser admin_master, inclua aqui)
function canManage(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "coordenador";
}

export async function POST(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const requesterId = userData.user.id;

    // 2) vínculo ativo do requester (pega escola + role)
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError("school_users lookup failed: " + staffErr.message, 500);
    if (!staff?.school_id) return jsonError("Você não está vinculado a nenhuma escola (school_users).", 403);

    if (!canManage(staff.role)) {
      return jsonError(`Forbidden: role "${staff?.role}" não pode desvincular professor de turma.`, 403);
    }

    const schoolId = staff.school_id;

    // 3) payload
    const body = await req.json().catch(() => ({}));
    const teacherUserId = String(body?.teacher_user_id || "").trim();
    const classId = String(body?.class_id || "").trim();

    if (!teacherUserId) return jsonError("teacher_user_id é obrigatório.", 400);
    if (!classId) return jsonError("class_id é obrigatório.", 400);

    // 4) valida que professor é professor dessa escola (mesmo que vá "remover turma", ele precisa existir)
    const { data: teacherLink, error: tErr } = await supabaseAdmin
      .from("school_users")
      .select("id, user_id, role, is_active")
      .eq("school_id", schoolId)
      .eq("user_id", teacherUserId)
      .eq("role", "professor")
      .maybeSingle();

    if (tErr) return jsonError("Falha ao validar professor: " + tErr.message, 500);
    if (!teacherLink?.id) return jsonError("Professor não encontrado nesta escola.", 404);

    // 5) valida que a turma pertence à escola
    const { data: classRow, error: cErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (cErr) return jsonError("Falha ao validar turma: " + cErr.message, 500);
    if (!classRow?.id) return jsonError("Turma não encontrada.", 404);
    if (String(classRow.school_id) !== String(schoolId)) {
      return jsonError("Turma não pertence a esta escola.", 403);
    }

    // 6) soft-unassign: seta is_active=false
    // Primeiro tenta achar o vínculo específico
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherUserId)
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) return jsonError("Falha ao localizar vínculo teacher_classes: " + exErr.message, 500);

    // Se não existe vínculo, ok (idempotente)
    if (!existing?.id) {
      return NextResponse.json({
        ok: true,
        message: "Nenhum vínculo encontrado (já estava removido).",
        link: { schoolId, teacherUserId, classId, isActive: false },
      });
    }

    // Se existe, desativa
    const { error: updErr } = await supabaseAdmin
      .from("teacher_classes")
      .update({ is_active: false })
      .eq("id", existing.id);

    if (updErr) return jsonError("Falha ao desativar vínculo teacher_classes: " + updErr.message, 500);

    return NextResponse.json({
      ok: true,
      link: { schoolId, teacherUserId, classId, isActive: false },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/teachers/classes/unassign", 500);
  }
}
