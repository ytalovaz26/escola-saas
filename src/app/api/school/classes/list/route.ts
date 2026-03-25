import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

// diretor/coordenador (aceita pt/en por segurança)
function canManageSchool(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "coordenador" || r === "director" || r === "coordinator";
}

export async function GET(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) valida sessão e pega user_id
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const authedUserId = userData.user.id;

    // 2) pega vínculo ATIVO em school_users pra saber school_id e role
    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", authedUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (suErr) return jsonError("school_users lookup failed: " + suErr.message, 500);
    if (!su?.school_id) return jsonError("Usuário não vinculado a uma escola.", 403);

    if (!canManageSchool(su.role)) {
      return jsonError(`Acesso negado. Role: "${su?.role}"`, 403);
    }

    const schoolId = su.school_id;

    // 3) lista turmas
    // OBS: mantive colunas seguras. Se sua tabela não tiver 'name', me avise o nome da coluna.
    const { data: classes, error: cErr } = await supabaseAdmin
      .from("classes")
      .select("id, name, created_at")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });

    if (cErr) return jsonError("Falha ao listar turmas: " + cErr.message, 500);

    return NextResponse.json({ ok: true, classes: classes ?? [] });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/classes/list", 500);
  }
}
