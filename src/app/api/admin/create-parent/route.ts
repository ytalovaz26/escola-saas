import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * Esta rota cria um usuário no Supabase Auth (pai) usando SERVICE_ROLE,
 * e registra/vincula no banco (tables) com RLS respeitado (via client anon + JWT).
 *
 * Segurança:
 * - Recebe Authorization: Bearer <access_token> do diretor/coordenador
 * - Valida se quem chama é diretor/coordenador na escola enviada ou platform admin
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing Bearer token" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const schoolId = body?.schoolId as string | undefined;
    const fullName = body?.fullName as string | undefined;
    const phone = (body?.phone as string | undefined) ?? null;
    const email = body?.email as string | undefined;
    const passwordTemp = body?.passwordTemp as string | undefined;

    if (!schoolId)
      return NextResponse.json(
        { ok: false, error: "schoolId é obrigatório" },
        { status: 400 }
      );
    if (!fullName?.trim())
      return NextResponse.json(
        { ok: false, error: "fullName é obrigatório" },
        { status: 400 }
      );
    if (!email?.trim())
      return NextResponse.json(
        { ok: false, error: "email é obrigatório" },
        { status: 400 }
      );
    if (!passwordTemp || passwordTemp.length < 6)
      return NextResponse.json(
        { ok: false, error: "passwordTemp precisa ter >= 6 caracteres" },
        { status: 400 }
      );

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Client com JWT do usuário logado (para validar role e gravar nas tables com RLS)
    const supaUser = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 1) valida chamador e escola
    const { data: meData, error: meErr } = await supaUser.auth.getUser();
    if (meErr || !meData?.user) {
      return NextResponse.json(
        { ok: false, error: "Token inválido" },
        { status: 401 }
      );
    }
    const callerId = meData.user.id;

    // ✅ CORREÇÃO AQUI: função espera p_user_id (não p_uid)
    const { data: isPlat, error: platErr } = await supaUser.rpc(
      "is_platform_admin",
      { p_user_id: callerId }
    );

    if (platErr) {
      return NextResponse.json(
        { ok: false, error: "RPC is_platform_admin falhou: " + platErr.message },
        { status: 400 }
      );
    }

    let allowed = Boolean(isPlat);

    if (!allowed) {
      const { data: roleRow, error: roleErr } = await supaUser
        .from("school_users")
        .select("role")
        .eq("school_id", schoolId)
        .eq("user_id", callerId)
        .maybeSingle();

      if (roleErr)
        return NextResponse.json(
          { ok: false, error: roleErr.message },
          { status: 400 }
        );

      const role = String(roleRow?.role || "");
      if (role === "diretor" || role === "coordenador") allowed = true;
    }

    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "Sem permissão para criar pai nesta escola" },
        { status: 403 }
      );
    }

    // 2) cria/recupera user no Auth usando service role
    const supaAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    let userId: string | null = null;
    let createdNew = false;

    // ✅ Estratégia sênior: tenta criar direto; se já existir, recupera e atualiza senha.
    const { data: created, error: createErr } = await supaAdmin.auth.admin.createUser(
      {
        email,
        password: passwordTemp,
        email_confirm: true,
      }
    );

    if (!createErr && created?.user) {
      userId = created.user.id;
      createdNew = true;
    } else {
      // Se já existe, precisamos localizar o user e atualizar
      // Algumas versões retornam mensagens diferentes; tratamos por string.
      const msg = (createErr?.message || "").toLowerCase();
      const already =
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exists");

      if (!already) {
        return NextResponse.json(
          { ok: false, error: "Falha createUser: " + (createErr?.message || "desconhecido") },
          { status: 500 }
        );
      }

      // Fallback: listUsers (mantive porque é o que seu projeto já usa)
      const { data: listData, error: listErr } = await supaAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });

      if (listErr) {
        return NextResponse.json(
          { ok: false, error: "Falha listUsers: " + listErr.message },
          { status: 500 }
        );
      }

      const existing = (listData.users || []).find(
        (u) => (u.email || "").toLowerCase() === email.toLowerCase()
      );

      if (!existing?.id) {
        return NextResponse.json(
          { ok: false, error: "Usuário já existe, mas não encontrei por email no listUsers." },
          { status: 500 }
        );
      }

      userId = existing.id;

      const { error: updErr } = await supaAdmin.auth.admin.updateUserById(userId, {
        password: passwordTemp,
        email_confirm: true,
      });

      if (updErr) {
        return NextResponse.json(
          { ok: false, error: "Falha updateUser: " + updErr.message },
          { status: 500 }
        );
      }
    }

    // 3) cria/atualiza registro em parents com RLS (via token)
    const { data: parentExisting, error: parentFindErr } = await supaUser
      .from("parents")
      .select("id,user_id,school_id,full_name,phone")
      .eq("school_id", schoolId)
      .eq("user_id", userId)
      .maybeSingle();

    if (parentFindErr) {
      return NextResponse.json(
        { ok: false, error: parentFindErr.message },
        { status: 400 }
      );
    }

    let parentId: string;

    if (parentExisting?.id) {
      parentId = parentExisting.id;

      const { error: upErr } = await supaUser
        .from("parents")
        .update({ full_name: fullName.trim(), phone })
        .eq("id", parentId);

      if (upErr)
        return NextResponse.json(
          { ok: false, error: upErr.message },
          { status: 400 }
        );
    } else {
      const { data: ins, error: insErr } = await supaUser
        .from("parents")
        .insert({
          school_id: schoolId,
          user_id: userId,
          full_name: fullName.trim(),
          phone,
        })
        .select("id")
        .single();

      if (insErr || !ins?.id) {
        return NextResponse.json(
          { ok: false, error: "Falha insert parents: " + (insErr?.message || "") },
          { status: 400 }
        );
      }
      parentId = ins.id;
    }

    return NextResponse.json({
      ok: true,
      created: createdNew,
      userId,
      parentId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro interno" },
      { status: 500 }
    );
  }
}
