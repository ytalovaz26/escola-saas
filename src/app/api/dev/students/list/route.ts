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

  // pega school + role via school_users (mesma lógica do /api/me)
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

  // lista perfis de alunos vinculados à escola (você pode ajustar depois para tabela específica)
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, full_name")
    .eq("school_id", schoolId);

  if (error) return jsonError("Erro ao listar alunos.", 500, { details: error.message });

  const students = (data || [])
    .map((r: any) => ({
      id: r.user_id,
      name: r.full_name ?? "(sem nome)",
    }))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

  return NextResponse.json({ ok: true, schoolId, students });
}
