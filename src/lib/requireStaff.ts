// src/lib/requireStaff.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normRole(role: any) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "director") return "diretor";
  if (r === "coordinator") return "coordenador";
  if (r === "teacher") return "professor";
  if (r === "secretary") return "secretaria";

  return r;
}

function jsonFail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function requireStaff(req: Request, allowedRoles: string[]) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return {
      ok: false as const,
      res: jsonFail(401, "Missing Bearer token"),
    };
  }

  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);

  if (uErr || !u?.user) {
    return {
      ok: false as const,
      res: jsonFail(401, "Invalid session"),
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
      res: jsonFail(500, suErr.message),
    };
  }

  if (!su?.school_id) {
    return {
      ok: false as const,
      res: jsonFail(404, "Perfil não encontrado ou vínculo escolar inativo."),
    };
  }

  const role = normRole(su.role);
  const allowed = allowedRoles.map(normRole);

  if (!allowed.includes(role)) {
    return {
      ok: false as const,
      res: jsonFail(403, `Forbidden: role=${role}`),
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(su.school_id),
    role,
  };
}