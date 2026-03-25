import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

async function getUserFromBearer(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { ok: false as const, resp: jsonError("Missing Authorization Bearer token.", 401) };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, resp: jsonError("Invalid token/session.", 401) };

  return { ok: true as const, userId: userData.user.id };
}

export async function GET(req: Request) {
  const u = await getUserFromBearer(req);
  if (!u.ok) return u.resp;

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", u.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkErr) return jsonError("school_users lookup failed: " + linkErr.message, 500);
  if (!link?.school_id) return jsonError("Usuário sem vínculo escolar ativo.", 403);

  const role = normRole(link.role);
  if (!(role === "diretor" || role === "coordenador")) {
    return jsonError("Acesso negado (somente diretor/coordenador).", 403);
  }

  const schoolId = link.school_id as string;

  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, name")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (error) return jsonError("Erro ao listar turmas.", 500, { details: error.message });

  const classes = (data || []).map((c: any) => ({
    id: c.id,
    name: c.name ?? "(sem nome)",
  }));

  return NextResponse.json({ ok: true, schoolId, classes });
}
