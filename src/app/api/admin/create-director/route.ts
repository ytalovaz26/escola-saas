import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body = {
  schoolId: string;
  email: string;
  passwordTemp: string;
};

export async function POST(req: Request) {
  try {
    // 1) Lê token do header
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    // 2) Valida quem está chamando (admin master logado)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Invalid session token" }, { status: 401 });
    }

    const callerId = userData.user.id;

    // 3) Confirma que é platform admin (admin_master)
    const { data: pa, error: paErr } = await supabaseAdmin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (paErr) {
      return NextResponse.json({ error: "platform_admins check failed: " + paErr.message }, { status: 500 });
    }
    if (!pa) {
      return NextResponse.json({ error: "Not authorized (not platform admin)" }, { status: 403 });
    }

    // 4) Lê body
    const body = (await req.json()) as Body;
    const schoolId = (body.schoolId || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const passwordTemp = (body.passwordTemp || "").trim();

    if (!schoolId) return NextResponse.json({ error: "schoolId is required" }, { status: 400 });
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
    if (passwordTemp.length < 6) return NextResponse.json({ error: "passwordTemp must be >= 6 chars" }, { status: 400 });

    // 5) Cria o usuário diretor (ou descobre o id se já existir)
    let directorUserId: string | null = null;
    let created = false;

    const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: passwordTemp,
      email_confirm: true,
    });

    if (!createErr && createdUser?.user?.id) {
      directorUserId = createdUser.user.id;
      created = true;
    } else {
      // Se já existe, buscamos o id via RPC (sem mexer direto no auth schema)
      const { data: rpcId, error: rpcErr } = await supabaseAdmin.rpc("get_user_id_by_email", { p_email: email });
      if (rpcErr) {
        return NextResponse.json(
          { error: "auth.users lookup failed: " + rpcErr.message },
          { status: 500 }
        );
      }
      if (!rpcId) {
        return NextResponse.json(
          { error: "User not created and not found by email. Create error: " + (createErr?.message || "unknown") },
          { status: 500 }
        );
      }
      directorUserId = rpcId as string;
      created = false;
    }

    // 6) Vincula na escola como DIRETOR (atenção: enum é 'diretor', não 'director')
    const { error: linkErr } = await supabaseAdmin
      .from("school_users")
      .upsert(
        {
          school_id: schoolId,
          user_id: directorUserId,
          role: "diretor",
        },
        { onConflict: "school_id,user_id" }
      );

    if (linkErr) {
      return NextResponse.json(
        { error: "school_users upsert failed: " + linkErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      created,
      userId: directorUserId,
      role: "diretor",
      schoolId,
      email,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
