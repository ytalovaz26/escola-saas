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

function audienceLabel(message: any) {
  const type = String(message.audience_type || "school").trim().toLowerCase();

  if (type === "parent_individual") return "Pais individuais";
  if (type === "all_parents") return "Todos os pais/responsáveis";
  if (type === "class") return "Responsáveis de uma turma";
  if (type === "teachers") return "Todos os professores";
  if (type === "teachers_class" || type === "teacher_class") return "Professores de uma turma";
  if (type === "teacher_individual") return "Professor individual";
  if (type === "coordinators") return "Coordenadores";
  if (type === "secretaria") return "Secretaria";
  if (type === "staff") return "Toda equipe escolar";
  if (type === "school") return "Toda escola";

  return "Toda escola";
}

function staffNameFromAuthUser(user: any) {
  const meta = user?.raw_user_meta_data || user?.user_metadata || {};

  return (
    meta.full_name ||
    meta.fullName ||
    meta.name ||
    meta.nome ||
    user?.email ||
    "Usuário escolar"
  );
}

async function getStaffFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
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

  const canAccess =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canAccess) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para acessar comunicados da gestão.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

async function loadSelectableParents(schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("parents")
    .select("id, user_id, full_name, phone, photo_url, created_at")
    .eq("school_id", schoolId)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error("Erro ao carregar responsáveis: " + error.message);
  }

  return (data || []).map((parent: any) => ({
    id: String(parent.id),
    parentId: String(parent.id),
    userId: parent.user_id ? String(parent.user_id) : null,
    fullName: parent.full_name || "Responsável sem nome",
    name: parent.full_name || "Responsável sem nome",
    phone: parent.phone || null,
    photoUrl: parent.photo_url || null,
    createdAt: parent.created_at || null,
  }));
}

async function loadSelectableStaff(schoolId: string) {
  const { data: schoolUsers, error } = await supabaseAdmin
    .from("school_users")
    .select("user_id, role, created_at")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Erro ao carregar equipe escolar: " + error.message);
  }

  const userIds = Array.from(
    new Set((schoolUsers || []).map((row: any) => String(row.user_id)).filter(Boolean))
  );

  let authUsersById = new Map<string, any>();

  if (userIds.length > 0) {
    const result = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (!result.error) {
      authUsersById = new Map(
        (result.data.users || [])
          .filter((user: any) => userIds.includes(String(user.id)))
          .map((user: any) => [String(user.id), user])
      );
    }
  }

  return (schoolUsers || [])
    .map((row: any) => {
      const userId = String(row.user_id);
      const authUser = authUsersById.get(userId) || null;
      const role = normalizeRole(row.role);
      const fullName = staffNameFromAuthUser(authUser);

      return {
        userId,
        id: userId,
        role,
        roleLabel:
          role === "professor"
            ? "Professor"
            : role === "coordenador"
              ? "Coordenador"
              : role === "secretaria"
                ? "Secretaria"
                : role === "diretor"
                  ? "Diretor"
                  : role === "admin"
                    ? "Administrador"
                    : role,
        fullName,
        name: fullName,
        email: authUser?.email || null,
      };
    })
    .filter((item: any) =>
      ["professor", "coordenador", "secretaria", "diretor", "admin"].includes(item.role)
    )
    .sort((a: any, b: any) => {
      const roleOrder: Record<string, number> = {
        diretor: 1,
        coordenador: 2,
        secretaria: 3,
        professor: 4,
        admin: 5,
      };

      const roleCompare = (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);

      if (roleCompare !== 0) return roleCompare;

      return String(a.name).localeCompare(String(b.name), "pt-BR");
    });
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return jsonError("Sessão não enviada.", 401);
    }

    const staffCheck = await getStaffFromToken(token);

    if (!staffCheck.ok) {
      return jsonError(staffCheck.error, staffCheck.status);
    }

    const schoolId = staffCheck.schoolId;

    const { data: messages, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select(
        `
        id,
        school_id,
        created_by,
        title,
        body,
        status,
        audience_type,
        target_class_id,
        target_role,
        published_at,
        created_at
      `
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (msgErr) {
      return jsonError("Erro ao carregar comunicados: " + msgErr.message, 500);
    }

    const messageIds = (messages || []).map((m: any) => String(m.id)).filter(Boolean);
    const statsByMessage = new Map<string, any>();

    if (messageIds.length > 0) {
      const { data: recipients, error: recErr } = await supabaseAdmin
        .from("message_recipients")
        .select("message_id, delivered_at, read_at")
        .eq("school_id", schoolId)
        .in("message_id", messageIds);

      if (recErr) {
        return jsonError("Erro ao carregar status dos comunicados: " + recErr.message, 500);
      }

      for (const row of recipients || []) {
        const messageId = String((row as any).message_id);
        const deliveredAt = (row as any).delivered_at;
        const readAt = (row as any).read_at;

        const current = statsByMessage.get(messageId) || {
          sent: 0,
          delivered: 0,
          read: 0,
          pending: 0,
        };

        current.sent += 1;

        if (readAt) {
          current.read += 1;
        } else if (deliveredAt) {
          current.delivered += 1;
        } else {
          current.pending += 1;
        }

        statsByMessage.set(messageId, current);
      }
    }

    const classIds = Array.from(
      new Set((messages || []).map((m: any) => String(m.target_class_id || "")).filter(Boolean))
    );

    let classById = new Map<string, any>();

    if (classIds.length > 0) {
      const { data: classes, error: clsErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("school_id", schoolId)
        .in("id", classIds);

      if (clsErr) {
        return jsonError("Erro ao carregar turmas dos comunicados: " + clsErr.message, 500);
      }

      classById = new Map((classes || []).map((cls: any) => [String(cls.id), cls]));
    }

    const [selectableStaff, selectableParents] = await Promise.all([
      loadSelectableStaff(schoolId),
      loadSelectableParents(schoolId),
    ]);

    const rows = (messages || []).map((message: any) => {
      const stats = statsByMessage.get(String(message.id)) || {
        sent: 0,
        delivered: 0,
        read: 0,
        pending: 0,
      };

      return {
        ...message,
        audienceLabel: audienceLabel(message),
        targetClass: message.target_class_id
          ? classById.get(String(message.target_class_id)) || null
          : null,
        stats,
      };
    });

    return jsonOk({
      messages: rows,
      selectableStaff,
      selectableParents,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar comunicados.", 500);
  }
}