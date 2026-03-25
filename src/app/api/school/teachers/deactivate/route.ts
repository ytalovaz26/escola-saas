import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function canManageTeachers(roleRaw: any) {
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
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Authorization token." }, { status: 401 });
    }

    // Usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Sessão inválida." }, { status: 401 });
    }

    const requesterId = userData.user.id;

    // Vínculo do diretor/coordenador
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr || !staff?.school_id) {
      return NextResponse.json({ ok: false, error: "Usuário não vinculado a escola." }, { status: 403 });
    }

    if (!canManageTeachers(staff.role)) {
      return NextResponse.json(
        { ok: false, error: `Role "${staff.role}" não pode desativar professor.` },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => null);
    const teacherUserId = body?.user_id;

    if (!teacherUserId) {
      return NextResponse.json({ ok: false, error: "user_id do professor é obrigatório." }, { status: 400 });
    }

    // Desativa vínculo professor
    const { error: updErr } = await supabaseAdmin
      .from("school_users")
      .update({ is_active: false })
      .eq("school_id", staff.school_id)
      .eq("user_id", teacherUserId)
      .eq("role", "professor");

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro interno ao desativar professor." },
      { status: 500 }
    );
  }
}
