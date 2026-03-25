// src/lib/requireTeacher.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

export async function requireTeacher(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 }),
    };
  }

  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
  if (uErr || !u?.user) {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 }),
    };
  }

  const userId = u.user.id;

  const { data: su, error: suErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (suErr) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: suErr.message }, { status: 500 }) };
  }

  if (!su?.school_id) {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: "Perfil não encontrado (sem vínculo na escola)." }, { status: 404 }),
    };
  }

  if (su.is_active === false) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Usuário inativo." }, { status: 403 }) };
  }

  const role = normRole(su.role);
  if (role !== "teacher" && role !== "professor") {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: `Forbidden: role=${role}` }, { status: 403 }) };
  }

  return { ok: true as const, userId, schoolId: su.school_id as string, role };
}