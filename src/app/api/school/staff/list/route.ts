import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, details?: any) {
  return NextResponse.json(
    { ok: false, error: message, details: details ?? null },
    { status }
  );
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function canManageStaff(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "coordenador" || r === "director" || r === "coordinator";
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

async function buildAuthMap(userIds: string[]) {
  const wanted = new Set(userIds);
  const map = new Map<string, { email: string | null; full_name: string | null }>();

  let page = 1;
  const perPage = 1000;

  while (wanted.size > 0) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) break;

    const users = data?.users || [];

    for (const u of users) {
      if (wanted.has(u.id)) {
        const meta: any = u.user_metadata || {};
        map.set(u.id, {
          email: u.email ?? null,
          full_name: meta?.full_name ? String(meta.full_name) : null,
        });
        wanted.delete(u.id);
      }
    }

    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break;
  }

  for (const uid of userIds) {
    if (!map.has(uid)) map.set(uid, { email: null, full_name: null });
  }

  return map;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Sessão inválida.", 401, userErr?.message);
    }

    const requesterId = userData.user.id;

    const { data: requester, error: requesterErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requesterErr) {
      return jsonError("Falha ao validar vínculo do usuário.", 500, requesterErr.message);
    }

    if (!requester?.school_id) {
      return jsonError("Usuário não vinculado a uma escola.", 403);
    }

    if (!canManageStaff(requester.role)) {
      return jsonError(`Acesso negado. Role: "${requester?.role}"`, 403);
    }

    const schoolId = requester.school_id;

    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("id, user_id, school_id, role, is_active, created_at")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .in("role", ["diretor", "coordenador", "secretaria", "professor"])
      .order("created_at", { ascending: false });

    if (staffErr) {
      return jsonError("Falha ao carregar equipe escolar.", 500, staffErr.message);
    }

    const userIds = Array.from(
      new Set((staffRows ?? []).map((x: any) => x.user_id).filter(Boolean))
    );

    const profilesMap = new Map<string, { full_name?: string | null }>();

    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (Array.isArray(profiles)) {
        for (const p of profiles as any[]) {
          profilesMap.set(p.user_id, { full_name: p.full_name ?? null });
        }
      }
    }

    const authMap = await buildAuthMap(userIds);

    const staff = (staffRows ?? []).map((row: any) => {
      const uid = row.user_id as string;
      const auth = authMap.get(uid);
      const fullNameFromProfile = profilesMap.get(uid)?.full_name ?? null;

      return {
        id: row.id,
        userId: uid,
        schoolId: row.school_id,
        role: row.role,
        isActive: row.is_active,
        createdAt: row.created_at,
        fullName: fullNameFromProfile ?? auth?.full_name ?? null,
        email: auth?.email ?? null,
      };
    });

    return NextResponse.json({ ok: true, staff });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado em /api/school/staff/list", 500);
  }
}