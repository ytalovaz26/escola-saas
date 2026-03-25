import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);

    const schoolId = body?.schoolId as string | undefined;
    const linkId = body?.linkId as string | undefined; // opcional (preferível)
    const parentId = body?.parentId as string | undefined; // opcional
    const studentId = body?.studentId as string | undefined; // opcional

    if (!schoolId) {
      return NextResponse.json({ ok: false, error: "schoolId é obrigatório" }, { status: 400 });
    }

    // Precisamos de UM identificador do vínculo:
    // - linkId OU (parentId + studentId)
    if (!linkId && !(parentId && studentId)) {
      return NextResponse.json(
        { ok: false, error: "Informe linkId ou (parentId e studentId)" },
        { status: 400 }
      );
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    // Cliente com JWT do usuário logado (RLS ativo)
    const supaUser = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 1) valida token e pega callerId
    const { data: meData, error: meErr } = await supaUser.auth.getUser();
    if (meErr || !meData?.user) {
      return NextResponse.json({ ok: false, error: "Token inválido" }, { status: 401 });
    }
    const callerId = meData.user.id;

    // 2) valida permissão (diretor/coordenador nesta escola)
    const { data: roleRow, error: roleErr } = await supaUser
      .from("school_users")
      .select("role")
      .eq("school_id", schoolId)
      .eq("user_id", callerId)
      .maybeSingle();

    if (roleErr) {
      return NextResponse.json({ ok: false, error: roleErr.message }, { status: 400 });
    }

    const role = String(roleRow?.role || "");
    const allowed = role === "diretor" || role === "coordenador";

    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Sem permissão para desvincular" }, { status: 403 });
    }

    // 3) desativa vínculo (soft delete)
    let q = supaUser.from("student_parents").update({ is_active: false });

    if (linkId) {
      q = q.eq("id", linkId);
    } else {
      q = q.eq("parent_id", parentId!).eq("student_id", studentId!);
    }

    // sempre garanta que é da escola
    q = q.eq("school_id", schoolId).eq("is_active", true);

    const { error: updErr } = await q;
    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno" }, { status: 500 });
  }
}
