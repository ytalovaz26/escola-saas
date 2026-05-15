// src/lib/requireStaff.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function normalizeAllowedRoles(roles: string[]) {
  const set = new Set<string>();

  for (const role of roles || []) {
    const r = normRole(role);
    if (!r) continue;

    set.add(r);

    if (r === "diretor") set.add("director");
    if (r === "director") set.add("diretor");

    if (r === "coordenador") set.add("coordinator");
    if (r === "coordinator") set.add("coordenador");

    if (r === "professor") set.add("teacher");
    if (r === "teacher") set.add("professor");

    if (r === "secretaria") set.add("secretary");
    if (r === "secretary") set.add("secretaria");
  }

  return Array.from(set);
}

export async function requireStaff(req: Request, allowedRoles: string[]) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { ok: false, error: "Missing Bearer token" },
        { status: 401 }
      ),
    };
  }

  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);

  if (uErr || !u?.user) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { ok: false, error: "Invalid session" },
        { status: 401 }
      ),
    };
  }

  const userId = u.user.id;

  const { data: su, error: suErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (suErr) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { ok: false, error: suErr.message },
        { status: 500 }
      ),
    };
  }

  if (!su?.school_id) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { ok: false, error: "Perfil não encontrado ou usuário sem vínculo ativo com a escola." },
        { status: 404 }
      ),
    };
  }

  const role = normRole(su.role);
  const allowed = normalizeAllowedRoles(allowedRoles);

  if (!allowed.includes(role)) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { ok: false, error: `Forbidden: role=${role}` },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(su.school_id),
    role,
  };
}