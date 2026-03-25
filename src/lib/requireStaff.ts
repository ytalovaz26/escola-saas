// src/lib/requireStaff.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

export async function requireStaff(req: Request, allowedRoles: string[]) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 }) };
  }

  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
  if (uErr || !u?.user) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 }) };
  }

  const userId = u.user.id;

  // pega vínculo na school_users
  const { data: su, error: suErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (suErr) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: suErr.message }, { status: 500 }) };
  }

  if (!su?.school_id) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Perfil não encontrado (sem vínculo na escola)." }, { status: 404 }) };
  }

  const role = normRole(su.role);

  const allowed = allowedRoles.map(normRole);
  if (!allowed.includes(role)) {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: `Forbidden: role=${role}` }, { status: 403 }),
    };
  }

  return { ok: true as const, userId, schoolId: su.school_id as string, role };
}
