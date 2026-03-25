// src/app/api/school/teachers/classes/list/route.ts
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

// Somente diretor/coordenador (se no futuro quiser "admin_master", adiciona aqui)
function canManage(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "coordenador";
}

export async function GET(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const authedUserId = userData.user.id;

    // 2) vínculo ativo do requester (pega escola + role)
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", authedUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError("school_users lookup failed: " + staffErr.message, 500);
    if (!staff?.school_id) return jsonError("Usuário não vinculado a uma escola.", 403);

    if (!canManage(staff.role)) {
      return jsonError(`Acesso negado. Role: "${staff?.role}"`, 403);
    }

    const schoolId = staff.school_id;

    // 3) teacher_user_id (obrigatório via querystring)
    const url = new URL(req.url);
    const teacherUserId = String(url.searchParams.get("teacher_user_id") || "").trim();

    if (!teacherUserId) {
      return jsonError('Parâmetro "teacher_user_id" é obrigatório.', 400);
    }

    // 4) valida que esse teacherUserId é professor dessa escola (ativo)
    const { data: teacherLink, error: tlErr } = await supabaseAdmin
      .from("school_users")
      .select("id, user_id, role, is_active")
      .eq("school_id", schoolId)
      .eq("user_id", teacherUserId)
      .eq("role", "professor")
      .eq("is_active", true)
      .maybeSingle();

    if (tlErr) return jsonError("Falha ao validar professor: " + tlErr.message, 500);
    if (!teacherLink?.id) {
      return jsonError("Professor não encontrado nesta escola (ou está inativo).", 404);
    }

    // 5) lista turmas da escola
    // (Ajuste aqui se sua tabela 'classes' tiver nomes diferentes)
    const { data: classes, error: cErr } = await supabaseAdmin
      .from("classes")
      .select("id, name, grade, shift, created_at")
      .eq("school_id", schoolId)
      .order("name", { ascending: true });

    if (cErr) return jsonError("Falha ao listar turmas: " + cErr.message, 500);

    const classIds = Array.from(new Set((classes ?? []).map((c: any) => c.id).filter(Boolean)));

    // 6) vínculos ativos do professor na teacher_classes
    const assignedSet = new Set<string>();
    if (classIds.length > 0) {
      const { data: links, error: lErr } = await supabaseAdmin
        .from("teacher_classes")
        .select("class_id, is_active")
        .eq("school_id", schoolId)
        .eq("teacher_user_id", teacherUserId)
        .eq("is_active", true);

      if (lErr) return jsonError("Falha ao listar vínculos teacher_classes: " + lErr.message, 500);

      for (const row of links ?? []) {
        if (row?.class_id) assignedSet.add(row.class_id);
      }
    }

    // 7) resposta (classe + isAssigned)
    const result = (classes ?? []).map((c: any) => ({
      id: c.id,
      name: c.name ?? null,
      grade: c.grade ?? null,
      shift: c.shift ?? null,
      createdAt: c.created_at ?? null,
      isAssigned: assignedSet.has(c.id),
    }));

    return NextResponse.json({
      ok: true,
      schoolId,
      teacherUserId,
      classes: result,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/teachers/classes/list", 500);
  }
}
