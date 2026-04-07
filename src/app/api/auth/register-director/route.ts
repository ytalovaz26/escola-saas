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

async function upsertProfileSafe(params: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  fullName: string;
}) {
  const { supabase, userId, fullName } = params;

  const attempts = [
    async () =>
      supabase.from("profiles").upsert(
        {
          id: userId,
          full_name: fullName || null,
        },
        { onConflict: "id" }
      ),

    async () =>
      supabase.from("profiles").upsert(
        {
          user_id: userId,
          full_name: fullName || null,
        },
        { onConflict: "user_id" }
      ),

    async () =>
      supabase.from("profiles").insert({
        id: userId,
        full_name: fullName || null,
      }),

    async () =>
      supabase.from("profiles").insert({
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

async function cleanupProfileSafe(params: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
}) {
  const { supabase, userId } = params;

  await supabase.from("profiles").delete().eq("id", userId);
  await supabase.from("profiles").delete().eq("user_id", userId);
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
      return NextResponse.json(
        { ok: false, error: "Informe o nome do diretor." },
        { status: 400 }
      );
    }

    if (!schoolName) {
      return NextResponse.json(
        { ok: false, error: "Informe o nome da escola." },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Informe o e-mail." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "A senha precisa ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    // 1) cria usuário no Auth
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

    // 2) cria escola
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

    // 3) cria/atualiza profile com fallback seguro
    try {
      await upsertProfileSafe({
        supabase,
        userId: createdUserId,
        fullName,
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

    // 4) vincula diretor à escola
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