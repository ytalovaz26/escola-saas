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

    // 1) Descobre usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const requesterId = userData.user.id;

    // 2) Vínculo ATIVO do requester (school_users)
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

    // 4) Busca vínculo ativo
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("class_students")
      .select("id, school_id, is_active")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowErr) return jsonError("class_students lookup failed: " + rowErr.message, 500);

    // idempotente: se já não existe vínculo ativo, não quebra
    if (!row?.id) {
      return NextResponse.json({ ok: true, alreadyInactive: true });
    }

    // 5) Soft delete (mantém histórico)
    const { error: upErr } = await supabaseAdmin
      .from("class_students")
      .update({ is_active: false })
      .eq("id", row.id);

    if (upErr) return jsonError("class_students update failed: " + upErr.message, 500);

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/class-students/unassign", 500);
  }
}
