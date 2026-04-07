import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RegisterDirectorBody = {
  fullName?: string;
  schoolName?: string;
  email?: string;
  password?: string;
};

type ProfilesShape = {
  hasId: boolean;
  hasUserId: boolean;
  hasFullName: boolean;
  hasEmail: boolean;
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

async function getProfilesShape(supabase: ReturnType<typeof getAdminClient>): Promise<ProfilesShape> {
  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "profiles");

  if (error) {
    throw new Error("Não foi possível ler schema de profiles: " + error.message);
  }

  const cols = new Set((data || []).map((r: any) => String(r.column_name)));

  return {
    hasId: cols.has("id"),
    hasUserId: cols.has("user_id"),
    hasFullName: cols.has("full_name"),
    hasEmail: cols.has("email"),
  };
}

async function saveProfileSafe(params: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  fullName: string;
  email: string;
}) {
  const { supabase, userId, fullName, email } = params;

  const shape = await getProfilesShape(supabase);

  const payload: Record<string, any> = {};
  if (shape.hasId) payload.id = userId;
  if (shape.hasUserId) payload.user_id = userId;
  if (shape.hasFullName) payload.full_name = fullName || null;
  if (shape.hasEmail) payload.email = email || null;

  let existingByUserId: any = null;
  let existingById: any = null;

  if (shape.hasUserId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error("Falha ao buscar profiles por user_id: " + error.message);
    }

    existingByUserId = data;
  }

  if (!existingByUserId && shape.hasId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new Error("Falha ao buscar profiles por id: " + error.message);
    }

    existingById = data;
  }

  if (existingByUserId) {
    const { error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("user_id", userId);

    if (error) {
      throw new Error("Falha ao atualizar profile por user_id: " + error.message);
    }

    return;
  }

  if (existingById) {
    const { error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId);

    if (error) {
      throw new Error("Falha ao atualizar profile por id: " + error.message);
    }

    return;
  }

  const { error } = await supabase.from("profiles").insert(payload);

  if (error) {
    throw new Error("Falha ao inserir profile: " + error.message);
  }
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