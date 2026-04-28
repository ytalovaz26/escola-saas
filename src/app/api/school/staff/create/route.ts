import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number, details?: any) {
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

function isAllowedNewRole(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "coordenador" || r === "secretaria" || r === "professor";
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
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });

    if (error) throw new Error("listUsers failed: " + error.message);

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

async function saveProfileSafe(params: {
  userId: string;
  fullName: string;
  email: string;
}) {
  const { userId, fullName, email } = params;

  const payloadFull = {
    id: userId,
    user_id: userId,
    full_name: fullName || null,
    email: email || null,
  };

  const payloadNoEmail = {
    id: userId,
    user_id: userId,
    full_name: fullName || null,
  };

  const payloadOnlyUserId = {
    user_id: userId,
    full_name: fullName || null,
  };

  const payloadOnlyId = {
    id: userId,
    full_name: fullName || null,
  };

  {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      let result = await supabaseAdmin.from("profiles").update(payloadFull).eq("user_id", userId);
      if (!result.error) return;

      result = await supabaseAdmin.from("profiles").update(payloadNoEmail).eq("user_id", userId);
      if (!result.error) return;

      result = await supabaseAdmin.from("profiles").update(payloadOnlyUserId).eq("user_id", userId);
      if (!result.error) return;
    }
  }

  {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (data) {
      let result = await supabaseAdmin.from("profiles").update(payloadFull).eq("id", userId);
      if (!result.error) return;

      result = await supabaseAdmin.from("profiles").update(payloadNoEmail).eq("id", userId);
      if (!result.error) return;

      result = await supabaseAdmin.from("profiles").update(payloadOnlyId).eq("id", userId);
      if (!result.error) return;
    }
  }

  let result = await supabaseAdmin.from("profiles").insert(payloadFull);
  if (!result.error) return;

  result = await supabaseAdmin.from("profiles").insert(payloadNoEmail);
  if (!result.error) return;

  result = await supabaseAdmin.from("profiles").insert(payloadOnlyUserId);
  if (!result.error) return;

  result = await supabaseAdmin.from("profiles").insert(payloadOnlyId);
  if (!result.error) return;

  throw new Error(result.error?.message || "Não foi possível gravar profile.");
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user) {
      return jsonError("Invalid token/session.", 401, userErr?.message);
    }

    const requesterId = userData.user.id;

    const { data: requester, error: requesterErr } = await supabaseAdmin
      .from("school_users")
      .select("id, school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requesterErr) {
      return jsonError("school_users lookup failed.", 500, requesterErr.message);
    }

    if (!requester?.school_id) {
      return jsonError("Você não está vinculado a nenhuma escola.", 403);
    }

    if (!canManageStaff(requester.role)) {
      return jsonError(`Forbidden: role "${requester.role}" não pode criar equipe.`, 403);
    }

    const body = await req.json().catch(() => ({}));

    const email = String(body?.email || "").trim().toLowerCase();
    const fullName = String(body?.full_name || "").trim();
    const role = normRole(body?.role);
    const tempPassword = String(body?.temp_password || "").trim();

    if (!email) return jsonError("Email é obrigatório.", 400);
    if (!fullName) return jsonError("Nome completo é obrigatório.", 400);
    if (!role) return jsonError("Cargo/função é obrigatório.", 400);

    if (!isAllowedNewRole(role)) {
      return jsonError(
        `Role inválida: "${role}". Use diretor, coordenador, secretaria ou professor.`,
        400
      );
    }

    let targetUserId: string | null = null;

    const existingAuthUser = await findAuthUserByEmail(email);

    if (existingAuthUser?.id) {
      targetUserId = existingAuthUser.id;

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
        targetUserId,
        updatePayload
      );

      if (updErr) {
        return jsonError("Falha ao atualizar usuário existente.", 500, updErr.message);
      }
    } else {
      if (tempPassword) {
        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (cErr || !created?.user?.id) {
          return jsonError("Falha ao criar usuário Auth.", 500, cErr?.message || "unknown");
        }

        targetUserId = created.user.id;
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

        targetUserId = invited.user.id;
      }
    }

    if (!targetUserId) {
      return jsonError("Não foi possível obter user_id do colaborador.", 500);
    }

    try {
      await saveProfileSafe({ userId: targetUserId, fullName, email });
    } catch (err: any) {
      return jsonError("Falha ao gravar profile do colaborador.", 500, err?.message);
    }

    const { data: existingLink, error: exErr } = await supabaseAdmin
      .from("school_users")
      .select("id, role, is_active, created_at")
      .eq("school_id", requester.school_id)
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) {
      return jsonError("Falha ao checar vínculo existente.", 500, exErr.message);
    }

    if (!existingLink?.id) {
      const { error: linkErr } = await supabaseAdmin.from("school_users").insert({
        school_id: requester.school_id,
        user_id: targetUserId,
        role,
        is_active: true,
      });

      if (linkErr) {
        return jsonError("Falha ao vincular colaborador em school_users.", 500, linkErr.message);
      }
    } else {
      const { error: upErr } = await supabaseAdmin
        .from("school_users")
        .update({ role, is_active: true })
        .eq("id", existingLink.id);

      if (upErr) {
        return jsonError("Falha ao atualizar vínculo existente.", 500, upErr.message);
      }
    }

    return NextResponse.json({
      ok: true,
      staff: {
        user_id: targetUserId,
        email,
        full_name: fullName,
        role,
        school_id: requester.school_id,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/staff/create", 500);
  }
}