import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RegisterDirectorBody = {
  fullName?: string;
  schoolName?: string;
  email?: string;
  password?: string;
};

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegisterDirectorBody;

    const fullName = String(body.fullName || "").trim();
    const schoolName = String(body.schoolName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!fullName) {
      return badRequest("Informe o nome do diretor.");
    }

    if (!schoolName) {
      return badRequest("Informe o nome da escola.");
    }

    if (!email) {
      return badRequest("Informe o e-mail.");
    }

    if (!password || password.length < 6) {
      return badRequest("A senha precisa ter pelo menos 6 caracteres.");
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      return NextResponse.json(
        { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL não configurada no servidor." },
        { status: 500 }
      );
    }

    if (!serviceRoleKey) {
      return NextResponse.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY não configurada no servidor." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1) cria usuário auth
    const { data: userData, error: userError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
        },
      });

    if (userError) {
      return NextResponse.json(
        { ok: false, error: userError.message || "Falha ao criar usuário." },
        { status: 500 }
      );
    }

    const userId = userData?.user?.id;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Usuário foi criado sem ID válido." },
        { status: 500 }
      );
    }

    // 2) cria escola
    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .insert({
        name: schoolName,
      })
      .select("id, name")
      .single();

    if (schoolError || !school?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: schoolError?.message || "Falha ao criar a escola.",
        },
        { status: 500 }
      );
    }

    // 3) cria/atualiza profile
    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: userId,
        full_name: fullName,
      },
      {
        onConflict: "id",
      }
    );

    if (profileError) {
      return NextResponse.json(
        {
          ok: false,
          error: profileError.message || "Falha ao criar perfil do diretor.",
        },
        { status: 500 }
      );
    }

    // 4) vincula usuário à escola como diretor
    const { error: schoolUserError } = await supabase
      .from("school_users")
      .insert({
        user_id: userId,
        school_id: school.id,
        role: "diretor",
      });

    if (schoolUserError) {
      return NextResponse.json(
        {
          ok: false,
          error: schoolUserError.message || "Falha ao vincular diretor à escola.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      userId,
      schoolId: school.id,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Erro inesperado ao criar diretor.",
      },
      { status: 500 }
    );
  }
}