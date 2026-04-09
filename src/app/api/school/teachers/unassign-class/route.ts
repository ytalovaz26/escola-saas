import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, details?: any) {
  return NextResponse.json(
    { ok: false, error: message, details: details ?? null },
    { status }
  );
}

function jsonOk(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function canManageTeachers(roleRaw: any) {
  const r = normRole(roleRaw);
  return (
    r === "diretor" ||
    r === "coordenador" ||
    r === "director" ||
    r === "coordinator"
  );
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token/session.", 401, userErr?.message);
    }

    const requesterId = userData.user.id;

    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError("school_users lookup failed.", 500, staffErr.message);
    if (!staff?.school_id) return jsonError("Você não está vinculado a nenhuma escola.", 403);

    if (!canManageTeachers(staff.role)) {
      return jsonError(`Forbidden: role "${staff.role}" não pode desvincular professor.`, 403);
    }

    const body = await req.json().catch(() => ({}));
    const teacherId = String(body?.teacher_id || "").trim();
    const classId = String(body?.class_id || "").trim();

    if (!teacherId) return jsonError("teacher_id é obrigatório.", 422);
    if (!classId) return jsonError("class_id é obrigatório.", 422);

    const schoolId = staff.school_id;

    const { error: delErr } = await supabaseAdmin
      .from("teacher_classes")
      .delete()
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherId)
      .eq("class_id", classId);

    if (delErr) {
      return jsonError("Falha ao desvincular professor da turma.", 500, delErr.message);
    }

    return jsonOk({ removed: true });
  } catch (e: any) {
    return jsonError(
      e?.message || "Internal error in /api/school/teachers/unassign-class",
      500
    );
  }
}