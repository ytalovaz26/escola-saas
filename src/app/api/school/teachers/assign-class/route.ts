import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, details?: any) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      details: details ?? null,
    },
    { status }
  );
}

function jsonOk(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function canManageTeachers(roleRaw: any) {
  const r = normRole(roleRaw);
  return (
    r === "diretor" ||
    r === "coordenador" ||
    r === "director" ||
    r === "coordinator"
  );
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
    if (!map.has(uid)) {
      map.set(uid, { email: null, full_name: null });
    }
  }

  return map;
}

async function getRequesterSchool(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, res: jsonError("Missing Authorization Bearer token.", 401) };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, res: jsonError("Invalid token/session.", 401, userErr?.message) };
  }

  const requesterId = userData.user.id;

  const { data: requesterLink, error: requesterErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", requesterId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (requesterErr) {
    return { ok: false as const, res: jsonError("school_users lookup failed.", 500, requesterErr.message) };
  }

  if (!requesterLink?.school_id) {
    return { ok: false as const, res: jsonError("Usuário não vinculado a uma escola.", 403) };
  }

  if (!canManageTeachers(requesterLink.role)) {
    return {
      ok: false as const,
      res: jsonError(`Acesso negado. Role: "${requesterLink?.role}"`, 403),
    };
  }

  return {
    ok: true as const,
    schoolId: requesterLink.school_id as string,
  };
}

export async function GET(req: Request) {
  try {
    const guard = await getRequesterSchool(req);
    if (!guard.ok) return guard.res;

    const schoolId = guard.schoolId;

    const { data: teacherLinks, error: teacherLinksErr } = await supabaseAdmin
      .from("school_users")
      .select("user_id, created_at")
      .eq("school_id", schoolId)
      .eq("role", "professor")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (teacherLinksErr) {
      return jsonError("Falha ao listar professores.", 500, teacherLinksErr.message);
    }

    const userIds = Array.from(
      new Set((teacherLinks ?? []).map((x: any) => x.user_id).filter(Boolean))
    );

    const profilesMap = new Map<string, { full_name?: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (!pErr && Array.isArray(profiles)) {
        for (const p of profiles as any[]) {
          profilesMap.set(p.user_id, { full_name: p.full_name ?? null });
        }
      }
    }

    const authMap = await buildAuthMap(userIds);

    const teacherClassesMap = new Map<
      string,
      Array<{
        assignmentId: string;
        classId: string;
        name: string | null;
        grade: string | null;
        shift: string | null;
      }>
    >();

    if (userIds.length > 0) {
      const { data: tcRows, error: tcErr } = await supabaseAdmin
        .from("teacher_classes")
        .select(`
          id,
          teacher_user_id,
          class_id,
          classes (
            id,
            name,
            grade,
            shift
          )
        `)
        .eq("school_id", schoolId)
        .in("teacher_user_id", userIds);

      if (tcErr) {
        return jsonError("Falha ao listar vínculos professor/turma.", 500, tcErr.message);
      }

      for (const row of (tcRows || []) as any[]) {
        const teacherId = row.teacher_user_id as string;
        const item = {
          assignmentId: row.id as string,
          classId: row.class_id as string,
          name: row.classes?.name ?? null,
          grade: row.classes?.grade ?? null,
          shift: row.classes?.shift ?? null,
        };

        if (!teacherClassesMap.has(teacherId)) {
          teacherClassesMap.set(teacherId, []);
        }
        teacherClassesMap.get(teacherId)!.push(item);
      }
    }

    const teachers = (teacherLinks ?? []).map((row: any) => {
      const uid = row.user_id as string;
      const fullNameFromProfiles = profilesMap.get(uid)?.full_name ?? null;
      const auth = authMap.get(uid);

      return {
        userId: uid,
        createdAt: row.created_at,
        fullName: fullNameFromProfiles ?? auth?.full_name ?? null,
        email: auth?.email ?? null,
        classAssignments: teacherClassesMap.get(uid) ?? [],
      };
    });

    return jsonOk({ teachers });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado", 500);
  }
}

export async function POST(req: Request) {
  try {
    const guard = await getRequesterSchool(req);
    if (!guard.ok) return guard.res;

    const schoolId = guard.schoolId;

    const body = await req.json().catch(() => ({}));
    const teacherId = String(body?.teacher_id || "").trim();
    const classId = String(body?.class_id || "").trim();

    if (!teacherId) return jsonError("teacher_id é obrigatório.", 422);
    if (!classId) return jsonError("class_id é obrigatório.", 422);

    const { data: teacherLink, error: teacherErr } = await supabaseAdmin
      .from("school_users")
      .select("user_id, school_id, role, is_active")
      .eq("school_id", schoolId)
      .eq("user_id", teacherId)
      .eq("role", "professor")
      .eq("is_active", true)
      .maybeSingle();

    if (teacherErr) {
      return jsonError("Falha ao validar professor.", 500, teacherErr.message);
    }

    if (!teacherLink?.user_id) {
      return jsonError("Professor não encontrado ou não está ativo nesta escola.", 404);
    }

    const { data: classRow, error: classErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id, name, grade, shift")
      .eq("id", classId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (classErr) {
      return jsonError("Falha ao validar turma.", 500, classErr.message);
    }

    if (!classRow?.id) {
      return jsonError("Turma não encontrada nesta escola.", 404);
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id")
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherId)
      .eq("class_id", classId)
      .maybeSingle();

    if (existingErr) {
      return jsonError("Falha ao verificar vínculo existente.", 500, existingErr.message);
    }

    if (!existing?.id) {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("teacher_classes")
        .insert({
          school_id: schoolId,
          teacher_user_id: teacherId,
          class_id: classId,
        })
        .select("id")
        .single();

      if (insertErr) {
        return jsonError("Falha ao vincular turma ao professor.", 500, insertErr.message);
      }

      return jsonOk(
        {
          linked: true,
          assignmentId: inserted?.id ?? null,
          teacherId,
          class: {
            id: classRow.id,
            name: classRow.name ?? null,
            grade: classRow.grade ?? null,
            shift: classRow.shift ?? null,
          },
        },
        201
      );
    }

    return jsonOk({
      linked: true,
      alreadyExisted: true,
      assignmentId: existing.id,
      teacherId,
      class: {
        id: classRow.id,
        name: classRow.name ?? null,
        grade: classRow.grade ?? null,
        shift: classRow.shift ?? null,
      },
    });
  } catch (e: any) {
    return jsonError(
      e?.message || "Internal error in /api/school/teachers/assign-class",
      500
    );
  }
}