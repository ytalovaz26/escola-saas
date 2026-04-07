import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SchoolUserRow = {
  id?: string;
  school_id: string;
  role: string;
  is_active: boolean;
  created_at?: string | null;
};

function jsonError(message: string, status: number, details?: any) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      details: details ?? null,
    },
    { status }
  );
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

async function findAuthUserByEmail(email: string) {
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error("listUsers failed: " + error.message);
    }

    const users = data?.users || [];
    const found = users.find(
      (u) => String(u.email || "").trim().toLowerCase() === email
    );

    if (found) return found;

    if (users.length < perPage) break;

    page += 1;
    if (page > 20) break;
  }

  return null;
}

async function upsertProfileSafe(params: {
  userId: string;
  fullName: string;
}) {
  const { userId, fullName } = params;

  const attempts = [
    async () =>
      supabaseAdmin.from("profiles").upsert(
        {
          id: userId,
          full_name: fullName || null,
        },
        { onConflict: "id" }
      ),

    async () =>
      supabaseAdmin.from("profiles").upsert(
        {
          user_id: userId,
          full_name: fullName || null,
        },
        { onConflict: "user_id" }
      ),

    async () =>
      supabaseAdmin.from("profiles").insert({
        id: userId,
        full_name: fullName || null,
      }),

    async () =>
      supabaseAdmin.from("profiles").insert({
        user_id: userId,
        full_name: fullName || null,
      }),
  ];

  const errors: string[] = [];

  for (const run of attempts) {
    const { error } = await run();
    if (!error) return;
    errors.push(error.message);
  }

  throw new Error(errors.join(" | "));
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user) {
      return jsonError("Invalid token/session.", 401, userErr?.message);
    }

    const requesterId = userData.user.id;

    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("id, school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<SchoolUserRow>();

    if (staffErr) {
      return jsonError("school_users lookup failed.", 500, staffErr.message);
    }

    if (!staff?.school_id) {
      return jsonError(
        "Você não está vinculado a nenhuma escola (school_users).",
        403
      );
    }

    if (!canManageTeachers(staff.role)) {
      return jsonError(
        `Forbidden: role "${staff.role}" não pode criar professor.`,
        403
      );
    }

    const body = await req.json().catch(() => ({}));

    const email = String(body?.email || "").trim().toLowerCase();
    const fullName = String(body?.full_name || "").trim();
    const tempPassword = String(body?.temp_password || "").trim();

    if (!email) return jsonError("Email é obrigatório.", 400);
    if (!fullName) return jsonError("Nome completo é obrigatório.", 400);

    let teacherUserId: string | null = null;

    const existingAuthUser = await findAuthUserByEmail(email);

    if (existingAuthUser?.id) {
      teacherUserId = existingAuthUser.id;

      const updatePayload: {
        user_metadata: Record<string, any>;
        password?: string;
      } = {
        user_metadata: {
          ...(existingAuthUser.user_metadata || {}),
          full_name: fullName,
        },
      };

      if (tempPassword) {
        updatePayload.password = tempPassword;
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
        teacherUserId,
        updatePayload
      );

      if (updErr) {
        return jsonError(
          "Falha ao atualizar metadata do usuário existente.",
          500,
          updErr.message
        );
      }
    } else {
      if (tempPassword) {
        const { data: created, error: cErr } =
          await supabaseAdmin.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName },
          });

        if (cErr || !created?.user?.id) {
          return jsonError(
            "Falha ao criar usuário Auth.",
            500,
            cErr?.message || "unknown"
          );
        }

        teacherUserId = created.user.id;
      } else {
        const { data: invited, error: iErr } =
          await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName },
          });

        if (iErr || !invited?.user?.id) {
          return jsonError(
            "Falha ao enviar convite/criar usuário Auth.",
            500,
            iErr?.message || "unknown"
          );
        }

        teacherUserId = invited.user.id;
      }
    }

    if (!teacherUserId) {
      return jsonError("Não foi possível obter user_id do professor.", 500);
    }

    try {
      await upsertProfileSafe({
        userId: teacherUserId,
        fullName,
      });
    } catch (err: any) {
      return jsonError(
        "Falha ao gravar profile do professor.",
        500,
        err?.message
      );
    }

    const { data: existingLink, error: exErr } = await supabaseAdmin
      .from("school_users")
      .select("id, role, is_active, created_at")
      .eq("school_id", staff.school_id)
      .eq("user_id", teacherUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) {
      return jsonError("Falha ao checar vínculo existente.", 500, exErr.message);
    }

    if (!existingLink?.id) {
      const { error: linkErr } = await supabaseAdmin.from("school_users").insert({
        school_id: staff.school_id,
        user_id: teacherUserId,
        role: "professor",
        is_active: true,
      });

      if (linkErr) {
        return jsonError(
          "Falha ao vincular professor em school_users.",
          500,
          linkErr.message
        );
      }
    } else {
      const { error: upErr } = await supabaseAdmin
        .from("school_users")
        .update({ role: "professor", is_active: true })
        .eq("id", existingLink.id);

      if (upErr) {
        return jsonError(
          "Falha ao atualizar vínculo existente.",
          500,
          upErr.message
        );
      }
    }

    return NextResponse.json({
      ok: true,
      teacher: {
        user_id: teacherUserId,
        email,
        full_name: fullName,
        school_id: staff.school_id,
      },
    });
  } catch (e: any) {
    return jsonError(
      e?.message || "Internal error in /api/school/teachers/create",
      500
    );
  }
}