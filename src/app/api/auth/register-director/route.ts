import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RegisterDirectorBody = {
  fullName?: string;
  schoolName?: string;
  email?: string;
  password?: string;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function saveProfileSafe(params: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  fullName: string;
  email: string;
}) {
  const { supabase, userId, fullName, email } = params;

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

  // tenta atualizar registro existente por user_id
  {
    const { data } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      let result = await supabase.from("profiles").update(payloadFull).eq("user_id", userId);
      if (!result.error) return;

      result = await supabase.from("profiles").update(payloadNoEmail).eq("user_id", userId);
      if (!result.error) return;

      result = await supabase.from("profiles").update(payloadOnlyUserId).eq("user_id", userId);
      if (!result.error) return;
    }
  }

  // tenta atualizar registro existente por id
  {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (data) {
      let result = await supabase.from("profiles").update(payloadFull).eq("id", userId);
      if (!result.error) return;

      result = await supabase.from("profiles").update(payloadNoEmail).eq("id", userId);
      if (!result.error) return;

      result = await supabase.from("profiles").update(payloadOnlyId).eq("id", userId);
      if (!result.error) return;
    }
  }

  // se não existir, tenta inserir em formatos compatíveis
  let result = await supabase.from("profiles").insert(payloadFull);
  if (!result.error) return;

  result = await supabase.from("profiles").insert(payloadNoEmail);
  if (!result.error) return;

  result = await supabase.from("profiles").insert(payloadOnlyUserId);
  if (!result.error) return;

  result = await supabase.from("profiles").insert(payloadOnlyId);
  if (!result.error) return;

  throw new Error(result.error?.message || "Não foi possível gravar profile.");
}

async function cleanupProfileSafe(params: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
}) {
  const { supabase, userId } = params;

  try {
    await supabase.from("profiles").delete().eq("user_id", userId);
  } catch {}

  try {
    await supabase.from("profiles").delete().eq("id", userId);
  } catch {}
}

export async function POST(req: Request) {
  const supabase = getAdminClient();

  let createdUserId: string | null = null;
  let createdSchoolId: string | null = null;

  try {
    const body = (await req.json()) as RegisterDirectorBody;

    const fullName = String(body.fullName || "").trim();
    const schoolName = String(body.schoolName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!fullName) {
      return NextResponse.json({ ok: false, error: "Informe o nome do diretor." }, { status: 400 });
    }

    if (!schoolName) {
      return NextResponse.json({ ok: false, error: "Informe o nome da escola." }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ ok: false, error: "Informe o e-mail." }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "A senha precisa ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    const { data: createdUser, error: createUserError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
        },
      });

    if (createUserError || !createdUser?.user) {
      return NextResponse.json(
        {
          ok: false,
          error: createUserError?.message || "Não foi possível criar o usuário no Auth.",
        },
        { status: 400 }
      );
    }

    createdUserId = createdUser.user.id;

    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .insert({
        name: schoolName,
      })
      .select("id, name")
      .single();

    if (schoolError || !school) {
      await supabase.auth.admin.deleteUser(createdUserId);

      return NextResponse.json(
        {
          ok: false,
          error: schoolError?.message || "Não foi possível criar a escola.",
        },
        { status: 400 }
      );
    }

    createdSchoolId = school.id;

    try {
      await saveProfileSafe({
        supabase,
        userId: createdUserId,
        fullName,
        email,
      });
    } catch (err: any) {
      if (createdSchoolId) {
        await supabase.from("schools").delete().eq("id", createdSchoolId);
      }
      await supabase.auth.admin.deleteUser(createdUserId);

      return NextResponse.json(
        {
          ok: false,
          error: err?.message || "Não foi possível criar o perfil.",
        },
        { status: 400 }
      );
    }

    const { error: schoolUserError } = await supabase.from("school_users").insert({
      user_id: createdUserId,
      school_id: createdSchoolId,
      role: "diretor",
      is_active: true,
    });

    if (schoolUserError) {
      await cleanupProfileSafe({ supabase, userId: createdUserId });

      if (createdSchoolId) {
        await supabase.from("schools").delete().eq("id", createdSchoolId);
      }

      await supabase.auth.admin.deleteUser(createdUserId);

      return NextResponse.json(
        {
          ok: false,
          error: schoolUserError.message || "Não foi possível vincular o diretor à escola.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Diretor criado com sucesso.",
      userId: createdUserId,
      schoolId: createdSchoolId,
    });
  } catch (e: any) {
    if (createdUserId) {
      try {
        await cleanupProfileSafe({ supabase, userId: createdUserId });
      } catch {}

      try {
        await supabase.from("school_users").delete().eq("user_id", createdUserId);
      } catch {}

      try {
        await supabase.auth.admin.deleteUser(createdUserId);
      } catch {}
    }

    if (createdSchoolId) {
      try {
        await supabase.from("schools").delete().eq("id", createdSchoolId);
      } catch {}
    }

    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Erro inesperado ao criar diretor.",
      },
      { status: 500 }
    );
  }
}