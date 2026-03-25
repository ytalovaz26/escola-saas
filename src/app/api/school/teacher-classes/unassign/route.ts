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

    // 2) Vínculo ATIVO do requester (pega o mais recente ativo)
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
    const id = String(body?.id || "").trim();
    if (!id) return jsonError("id é obrigatório.", 400);

    // 4) Garante que o vínculo pertence à escola do requester
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, school_id, is_active")
      .eq("id", id)
      .maybeSingle();

    if (rowErr) return jsonError("teacher_classes lookup failed: " + rowErr.message, 500);
    if (!row?.id) return jsonError("Vínculo não encontrado.", 404);
    if (row.school_id !== schoolId) return jsonError("Vínculo não pertence à sua escola.", 403);

    // 5) Soft delete: is_active=false (se já estiver false, ok também)
    const { error: upErr } = await supabaseAdmin
      .from("teacher_classes")
      .update({ is_active: false })
      .eq("id", id);

    if (upErr) return jsonError("teacher_classes update failed: " + upErr.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/teacher-classes/unassign", 500);
  }
}
