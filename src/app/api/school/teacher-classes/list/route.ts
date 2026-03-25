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

// Busca emails via listUsers e monta um map (paginado)
async function buildEmailMap(userIds: string[]) {
  const emailMap = new Map<string, string | null>();
  if (!userIds || userIds.length === 0) return emailMap;

  const wanted = new Set(userIds);

  let page = 1;
  const perPage = 1000;

  while (wanted.size > 0) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) break;

    const users = data?.users || [];
    for (const u of users) {
      if (wanted.has(u.id)) {
        emailMap.set(u.id, u.email ?? null);
        wanted.delete(u.id);
      }
    }

    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break; // safety
  }

  // garante entradas (mesmo se não achou)
  for (const uid of userIds) {
    if (!emailMap.has(uid)) emailMap.set(uid, null);
  }

  return emailMap;
}

export async function GET(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) Descobre usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const authedUserId = userData.user.id;

    // 2) Vínculo ATIVO do usuário em school_users (pegar school_id e role)
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

    const role = normRole(su.role);
    const allowed =
      role === "diretor" || role === "coordenador" || role === "director" || role === "coordinator";
    if (!allowed) return jsonError(`Acesso negado. Role: "${su?.role}"`, 403);

    const schoolId = su.school_id;

    // 3) Busca vínculos teacher_classes (ativos)
    const { data: tc, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, teacher_user_id, class_id, created_at, is_active")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (tcErr) return jsonError("teacher_classes list failed: " + tcErr.message, 500);

    // Se não tem vínculos, retorna rápido
    if (!tc || tc.length === 0) {
      return NextResponse.json({ ok: true, assignments: [] });
    }

    const teacherUserIds = Array.from(
      new Set((tc ?? []).map((x: any) => x.teacher_user_id).filter(Boolean))
    );

    const classIds = Array.from(new Set((tc ?? []).map((x: any) => x.class_id).filter(Boolean)));

    // 4) Carrega profiles (PK = user_id)
    const profilesMap = new Map<string, { full_name?: string | null }>();
    if (teacherUserIds.length > 0) {
      const { data: profiles, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", teacherUserIds);

      if (!pErr && Array.isArray(profiles)) {
        for (const p of profiles as any[]) profilesMap.set(p.user_id, { full_name: p.full_name ?? null });
      }
    }

    // 5) Carrega turmas
    const classesMap = new Map<string, { name?: string | null; grade?: string | null; shift?: string | null }>();
    if (classIds.length > 0) {
      const { data: cls, error: cErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .in("id", classIds);

      if (!cErr && Array.isArray(cls)) {
        for (const c of cls as any[]) {
          classesMap.set(c.id, { name: c.name ?? null, grade: c.grade ?? null, shift: c.shift ?? null });
        }
      }
    }

    // 6) Emails (bulk listUsers)
    const emailMap = await buildEmailMap(teacherUserIds);

    // 7) Resposta para o front
    const assignments = (tc ?? []).map((row: any) => {
      const tuid = row.teacher_user_id as string;
      const cid = row.class_id as string;

      const teacherName = profilesMap.get(tuid)?.full_name ?? null;
      const teacherEmail = emailMap.get(tuid) ?? null;

      const c = classesMap.get(cid);

      return {
        id: row.id,
        teacherUserId: tuid,
        classId: cid,
        isActive: !!row.is_active,
        createdAt: row.created_at,

        teacherName,
        teacherEmail,

        className: c?.name ?? null,
        grade: c?.grade ?? null,
        shift: c?.shift ?? null,
      };
    });

    return NextResponse.json({ ok: true, assignments });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/teacher-classes/list", 500);
  }
}
