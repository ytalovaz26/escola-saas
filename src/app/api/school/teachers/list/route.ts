import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

// Bulk: busca email + full_name (metadata) via listUsers (paginado)
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
    const token = await getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token." }, { status: 401 });
    }

    // 1) Usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Sessão inválida." }, { status: 401 });
    }

    const authedUserId = userData.user.id;

    // 2) vínculo ATIVO mais recente do requester
    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", authedUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (suErr) {
      return NextResponse.json({ ok: false, error: suErr.message }, { status: 500 });
    }
    if (!su?.school_id) {
      return NextResponse.json({ ok: false, error: "Usuário não vinculado a uma escola." }, { status: 403 });
    }

    const role = normRole(su.role);
    const allowed = role === "diretor" || role === "coordenador" || role === "director" || role === "coordinator";
    if (!allowed) {
      return NextResponse.json({ ok: false, error: `Acesso negado. Role: "${su?.role}"` }, { status: 403 });
    }

    const schoolId = su.school_id;

    // 3) Lista professores ativos
    const { data: teachersSu, error: tErr } = await supabaseAdmin
      .from("school_users")
      .select("user_id, created_at, is_active")
      .eq("school_id", schoolId)
      .eq("role", "professor")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const userIds = Array.from(new Set((teachersSu ?? []).map((x: any) => x.user_id).filter(Boolean)));

    // 4) Profiles (SEU PK: profiles.user_id)
    const profilesMap = new Map<string, { full_name?: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (!pErr && Array.isArray(profiles)) {
        for (const p of profiles as any[]) profilesMap.set(p.user_id, { full_name: p.full_name ?? null });
      }
    }

    // 5) Auth map (email + metadata.full_name)
    const authMap = await buildAuthMap(userIds);

    // 6) Resposta
    const teachers = (teachersSu ?? []).map((row: any) => {
      const uid = row.user_id as string;

      const fullNameFromProfiles = profilesMap.get(uid)?.full_name ?? null;
      const auth = authMap.get(uid);

      return {
        userId: uid,
        createdAt: row.created_at,
        fullName: fullNameFromProfiles ?? auth?.full_name ?? null,
        email: auth?.email ?? null,
      };
    });

    return NextResponse.json({ ok: true, teachers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro inesperado" }, { status: 500 });
  }
}
