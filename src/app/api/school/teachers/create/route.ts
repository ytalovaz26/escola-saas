import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

// roles do seu enum: admin_master, diretor, coordenador, professor, parent
function canManageTeachers(roleRaw: any) {
  const r = normRole(roleRaw);
  return r === "diretor" || r === "coordenador" || r === "director" || r === "coordinator";
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

// Busca usuário no Auth pelo email usando listUsers (paginado)
async function findAuthUserIdByEmail(email: string) {
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("listUsers failed: " + error.message);

    const users = data?.users || [];
    const found = users.find((u) => String(u.email || "").toLowerCase() === email.toLowerCase());
    if (found?.id) return found.id;

    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break; // safety
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) valida token e pega user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid token/session.", 401);

    const requesterId = userData.user.id;

    // 2) pega vínculo ATIVO do requester na escola (school_users)
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", requesterId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError("school_users lookup failed: " + staffErr.message, 500);
    if (!staff?.school_id) return jsonError("Você não está vinculado a nenhuma escola (school_users).", 403);

    if (!canManageTeachers(staff.role)) {
      return jsonError(`Forbidden: role "${staff?.role}" não pode criar professor.`, 403);
    }

    // 3) payload
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const fullName = String(body?.full_name || "").trim();
    const tempPassword = body?.temp_password ? String(body.temp_password) : "";

    if (!email) return jsonError("Email é obrigatório.", 400);
    if (!fullName) return jsonError("Nome completo é obrigatório.", 400);

    // 4) Se já existir um usuário Auth com esse email, REUTILIZA
    let teacherUserId: string | null = await findAuthUserIdByEmail(email);

    // 5) Se não existir, cria/invita
    if (!teacherUserId) {
      if (tempPassword) {
        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (cErr || !created?.user?.id) {
          return jsonError("Falha ao criar usuário Auth: " + (cErr?.message || "unknown"), 500);
        }

        teacherUserId = created.user.id;
      } else {
        const { data: invited, error: iErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName },
        });

        if (iErr || !invited?.user?.id) {
          return jsonError("Falha ao enviar convite/criar usuário Auth: " + (iErr?.message || "unknown"), 500);
        }

        teacherUserId = invited.user.id;
      }
    } else {
      // Usuário já existe -> garante metadata atualizada (nome)
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(teacherUserId, {
        user_metadata: { full_name: fullName },
      });

      if (updErr) {
        return jsonError("Falha ao atualizar metadata do usuário existente: " + updErr.message, 500);
      }
    }

    if (!teacherUserId) return jsonError("Não foi possível obter user_id do professor.", 500);

    // 6) profiles UPSERT (seu PK é profiles.user_id)
    const { error: profErr } = await supabaseAdmin.from("profiles").upsert(
      {
        user_id: teacherUserId,
        full_name: fullName || null,
      },
      { onConflict: "user_id" }
    );

    if (profErr) {
      return jsonError("Falha ao gravar profiles.full_name: " + profErr.message, 500);
    }

    // 7) vincula em school_users como professor (evita duplicar)
    const { data: existingLink, error: exErr } = await supabaseAdmin
      .from("school_users")
      .select("id, role, is_active, created_at")
      .eq("school_id", staff.school_id)
      .eq("user_id", teacherUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) return jsonError("Falha ao checar vínculo existente: " + exErr.message, 500);

    if (!existingLink?.id) {
      const { error: linkErr } = await supabaseAdmin.from("school_users").insert({
        school_id: staff.school_id,
        user_id: teacherUserId,
        role: "professor",
        is_active: true,
      });

      if (linkErr) {
        return jsonError("Falha ao vincular professor em school_users: " + linkErr.message, 500);
      }
    } else {
      // garante professor + ativo (mesmo se antes era outro role)
      const { error: upErr } = await supabaseAdmin
        .from("school_users")
        .update({ role: "professor", is_active: true })
        .eq("id", existingLink.id);

      if (upErr) {
        return jsonError("Falha ao atualizar vínculo existente: " + upErr.message, 500);
      }
    }

    return NextResponse.json({
      ok: true,
      teacher: { user_id: teacherUserId, email, full_name: fullName, school_id: staff.school_id },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/teachers/create", 500);
  }
}
