import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MealType =
  | "breakfast"
  | "morning_snack"
  | "lunch"
  | "afternoon_snack"
  | "dinner"
  | "other";

function jsonOk(body: Record<string, any> = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeMealType(value: unknown): MealType {
  const raw = cleanText(value).toLowerCase();

  const allowed: MealType[] = [
    "breakfast",
    "morning_snack",
    "lunch",
    "afternoon_snack",
    "dinner",
    "other",
  ];

  return allowed.includes(raw as MealType) ? (raw as MealType) : "lunch";
}

function mealTypeLabel(type: string) {
  const safe = normalizeMealType(type);

  if (safe === "breakfast") return "Café da manhã";
  if (safe === "morning_snack") return "Lanche da manhã";
  if (safe === "lunch") return "Almoço";
  if (safe === "afternoon_snack") return "Lanche da tarde";
  if (safe === "dinner") return "Jantar";

  return "Outro";
}

async function getStaffContext(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false as const,
      response: jsonError("Sessão não enviada.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: jsonError("Sessão inválida.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: schoolUser, error: schoolUserErr } = await supabaseAdmin
    .from("school_users")
    .select("id, school_id, user_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (schoolUserErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao validar usuário da escola: " + schoolUserErr.message, 500),
    };
  }

  if (schoolUser?.school_id) {
    return {
      ok: true as const,
      user,
      userId: user.id,
      schoolId: String(schoolUser.school_id),
      role: cleanText((schoolUser as any).role) || null,
    };
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, user_id, school_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (profileErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao validar perfil: " + profileErr.message, 500),
    };
  }

  if (!profile?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Usuário não vinculado a uma escola.", 403),
    };
  }

  return {
    ok: true as const,
    user,
    userId: user.id,
    schoolId: String(profile.school_id),
    role: cleanText((profile as any).role) || null,
  };
}

function normalizeMeal(row: any) {
  const type = normalizeMealType(row.meal_type);

  return {
    id: String(row.id),
    school_id: String(row.school_id),
    meal_date: cleanText(row.meal_date),
    meal_type: type,
    meal_type_label: mealTypeLabel(type),
    title: cleanText(row.title),
    description: cleanText(row.description) || null,
    created_by: cleanText(row.created_by) || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function listMeals(params: {
  schoolId: string;
  from: string;
  to: string;
  mealType?: string | null;
}) {
  let query = supabaseAdmin
    .from("school_meals")
    .select(
      `
      id,
      school_id,
      meal_date,
      meal_type,
      title,
      description,
      created_by,
      created_at,
      updated_at
    `
    )
    .eq("school_id", params.schoolId)
    .gte("meal_date", params.from)
    .lte("meal_date", params.to)
    .order("meal_date", { ascending: true })
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (params.mealType && params.mealType !== "all") {
    query = query.eq("meal_type", normalizeMealType(params.mealType));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("Erro ao listar cardápio: " + error.message);
  }

  return (data || []).map(normalizeMeal);
}

export async function GET(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const url = new URL(req.url);

    const today = new Date().toISOString().slice(0, 10);
    const from = cleanText(url.searchParams.get("from")) || today;
    const to = cleanText(url.searchParams.get("to")) || from;
    const mealType = cleanText(url.searchParams.get("mealType")) || "all";

    if (!isISODate(from)) {
      return jsonError("Data inicial inválida. Use YYYY-MM-DD.", 400);
    }

    if (!isISODate(to)) {
      return jsonError("Data final inválida. Use YYYY-MM-DD.", 400);
    }

    const meals = await listMeals({
      schoolId: ctx.schoolId,
      from,
      to,
      mealType,
    });

    return jsonOk({
      meals,
      range: {
        from,
        to,
      },
      summary: {
        total: meals.length,
        breakfast: meals.filter((m) => m.meal_type === "breakfast").length,
        morning_snack: meals.filter((m) => m.meal_type === "morning_snack").length,
        lunch: meals.filter((m) => m.meal_type === "lunch").length,
        afternoon_snack: meals.filter((m) => m.meal_type === "afternoon_snack").length,
        dinner: meals.filter((m) => m.meal_type === "dinner").length,
        other: meals.filter((m) => m.meal_type === "other").length,
      },
      meta: {
        source: "school_menu_v1",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar cardápio.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const body = await req.json().catch(() => ({}));

    const mealDate = cleanText(body.mealDate || body.meal_date);
    const mealType = normalizeMealType(body.mealType || body.meal_type);
    const title = cleanText(body.title);
    const description = cleanText(body.description);

    if (!mealDate || !isISODate(mealDate)) {
      return jsonError("Informe uma data válida para o cardápio.", 422);
    }

    if (!title) {
      return jsonError("Informe o título do cardápio.", 422);
    }

    const { data, error } = await supabaseAdmin
      .from("school_meals")
      .insert({
        school_id: ctx.schoolId,
        meal_date: mealDate,
        meal_type: mealType,
        title,
        description: description || null,
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .select(
        `
        id,
        school_id,
        meal_date,
        meal_type,
        title,
        description,
        created_by,
        created_at,
        updated_at
      `
      )
      .single();

    if (error) {
      return jsonError("Erro ao cadastrar cardápio: " + error.message, 500);
    }

    return jsonOk({
      meal: normalizeMeal(data),
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao cadastrar cardápio.", 500);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const body = await req.json().catch(() => ({}));

    const id = cleanText(body.id);
    const mealDate = cleanText(body.mealDate || body.meal_date);
    const mealType = normalizeMealType(body.mealType || body.meal_type);
    const title = cleanText(body.title);
    const description = cleanText(body.description);

    if (!id) {
      return jsonError("ID do cardápio é obrigatório.", 422);
    }

    if (!mealDate || !isISODate(mealDate)) {
      return jsonError("Informe uma data válida para o cardápio.", 422);
    }

    if (!title) {
      return jsonError("Informe o título do cardápio.", 422);
    }

    const { data, error } = await supabaseAdmin
      .from("school_meals")
      .update({
        meal_date: mealDate,
        meal_type: mealType,
        title,
        description: description || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("school_id", ctx.schoolId)
      .select(
        `
        id,
        school_id,
        meal_date,
        meal_type,
        title,
        description,
        created_by,
        created_at,
        updated_at
      `
      )
      .maybeSingle();

    if (error) {
      return jsonError("Erro ao atualizar cardápio: " + error.message, 500);
    }

    if (!data?.id) {
      return jsonError("Cardápio não encontrado.", 404);
    }

    return jsonOk({
      meal: normalizeMeal(data),
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar cardápio.", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const url = new URL(req.url);
    const id = cleanText(url.searchParams.get("id"));

    if (!id) {
      return jsonError("ID do cardápio é obrigatório.", 422);
    }

    const { error } = await supabaseAdmin
      .from("school_meals")
      .delete()
      .eq("id", id)
      .eq("school_id", ctx.schoolId);

    if (error) {
      return jsonError("Erro ao remover cardápio: " + error.message, 500);
    }

    return jsonOk({
      deleted: true,
      id,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao remover cardápio.", 500);
  }
}