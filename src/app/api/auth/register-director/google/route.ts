import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function slugifySchoolName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Token de autenticação não enviado." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const fullName = String(body?.fullName || "").trim();
    const schoolName = String(body?.schoolName || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!fullName) {
      return NextResponse.json(
        { ok: false, error: "Nome do diretor é obrigatório." },
        { status: 400 }
      );
    }

    if (!schoolName) {
      return NextResponse.json(
        { ok: false, error: "Nome da escola é obrigatório." },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "E-mail é obrigatório." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "Não foi possível identificar o usuário autenticado." },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = (user.email || email).trim().toLowerCase();

    const { data: existingLink } = await supabaseAdmin
      .from("school_users")
      .select("id, school_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingLink) {
      return NextResponse.json({
        ok: true,
        alreadyLinked: true,
        schoolId: existingLink.school_id,
      });
    }

    const schoolSlugBase = slugifySchoolName(schoolName) || "escola";
    const schoolSlug = `${schoolSlugBase}-${randomSuffix()}`;

    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .insert({
        name: schoolName,
        slug: schoolSlug,
      })
      .select("id")
      .single();

    if (schoolError || !school) {
      throw new Error(schoolError?.message || "Falha ao criar escola.");
    }

    const profilePayload: Record<string, any> = {
      id: userId,
      email: userEmail,
      full_name: fullName,
    };

    const profileTry = await supabaseAdmin
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" });

    if (profileTry.error) {
      throw new Error(profileTry.error.message || "Falha ao salvar perfil.");
    }

    const schoolUserTry = await supabaseAdmin.from("school_users").insert({
      school_id: school.id,
      user_id: userId,
      role: "diretor",
      is_active: true,
    });

    if (schoolUserTry.error) {
      throw new Error(schoolUserTry.error.message || "Falha ao vincular diretor à escola.");
    }

    return NextResponse.json({
      ok: true,
      schoolId: school.id,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Erro inesperado ao criar diretor com Google.",
      },
      { status: 500 }
    );
  }
}