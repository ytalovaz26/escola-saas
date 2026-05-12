import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function normalizeRole(role?: string | null) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin") return "admin";

  return r;
}

function roleLabel(role?: string | null) {
  const r = normalizeRole(role);

  if (r === "diretor") return "Diretor";
  if (r === "coordenador") return "Coordenador";
  if (r === "secretaria") return "Secretaria";
  if (r === "professor") return "Professor";
  if (r === "admin") return "Administrador";

  return r || "Equipe escolar";
}

async function getRequesterFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (staffErr) {
    return {
      ok: false as const,
      status: 500,
      error: "Erro ao validar usuário escolar: " + staffErr.message,
    };
  }

  if (!staff?.school_id) {
    return { ok: false as const, status: 403, error: "Usuário sem escola ativa." };
  }

  const role = normalizeRole(staff.role);

  const canRead =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canRead) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para listar equipe escolar.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

async function getAuthUserSafe(userId: string) {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (error || !data?.user) {
      return null;
    }

    return data.user;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const requester = await getRequesterFromToken(token);
    if (!requester.ok) return jsonError(requester.error, requester.status);

    const schoolId = requester.schoolId;

    const { data: rows, error } = await supabaseAdmin
      .from("school_users")
      .select("id, school_id, user_id, role, is_active, created_at")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError("Erro ao carregar equipe escolar: " + error.message, 500);
    }

    const uniqueUserIds = Array.from(
      new Set((rows || []).map((row: any) => String(row.user_id || "")).filter(Boolean))
    );

    const authUsers = new Map<string, any>();

    await Promise.all(
      uniqueUserIds.map(async (userId) => {
        const authUser = await getAuthUserSafe(userId);
        if (authUser) authUsers.set(userId, authUser);
      })
    );

    const staff = (rows || [])
      .map((row: any) => {
        const userId = String(row.user_id || "");
        const authUser = authUsers.get(userId) || null;
        const metadata = authUser?.user_metadata || {};

        const fullName =
          metadata.full_name ||
          metadata.fullName ||
          metadata.name ||
          metadata.display_name ||
          null;

        const email = authUser?.email || null;
        const normalizedRole = normalizeRole(row.role);

        return {
          id: String(row.id),
          schoolId: String(row.school_id),
          userId,
          user_id: userId,
          fullName: fullName ? String(fullName) : null,
          full_name: fullName ? String(fullName) : null,
          email: email ? String(email) : null,
          role: normalizedRole,
          roleLabel: roleLabel(normalizedRole),
          isActive: Boolean(row.is_active),
          is_active: Boolean(row.is_active),
          createdAt: row.created_at || null,
          created_at: row.created_at || null,
        };
      })
      .filter((item: any) => item.userId);

    const teachers = staff.filter((item: any) => normalizeRole(item.role) === "professor");
    const coordinators = staff.filter((item: any) => normalizeRole(item.role) === "coordenador");

    return jsonOk({
      schoolId,
      staff,
      teachers,
      coordinators,
      total: staff.length,
      totalTeachers: teachers.length,
      totalCoordinators: coordinators.length,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar equipe escolar.", 500);
  }
}