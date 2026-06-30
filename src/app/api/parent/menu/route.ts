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

async function getParentContext(req: Request) {
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

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao validar responsável: " + parentErr.message, 500),
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Você não está cadastrado como responsável.", 403),
    };
  }

  return {
    ok: true as const,
    user,
    parentId: String(parent.id),
    schoolId: String(parent.school_id),
    parentName: cleanText(parent.full_name) || user.email || "Responsável",
  };
}

async function getSchoolInfo(schoolId: string) {
  try {
    const { data } = await supabaseAdmin
      .from("schools")
      .select("id, name, brand_name")
      .eq("id", schoolId)
      .maybeSingle();

    return {
      id: schoolId,
      name: cleanText((data as any)?.brand_name) || cleanText((data as any)?.name) || null,
    };
  } catch {
    return {
      id: schoolId,
      name: null,
    };
  }
}

async function getParentChildren(params: { schoolId: string; parentId: string }) {
  const { data: links, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, relationship, is_active")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("is_active", true);

  if (linkErr) return [];

  const studentIds = Array.from(
    new Set((links || []).map((row: any) => cleanText(row.student_id)).filter(Boolean))
  );

  if (studentIds.length === 0) return [];

  const relationshipByStudent = new Map<string, string | null>();

  for (const link of links || []) {
    relationshipByStudent.set(
      String((link as any).student_id),
      cleanText((link as any).relationship) || null
    );
  }

  const { data: students } = await supabaseAdmin
    .from("students")
    .select("id, full_name, registration_number")
    .eq("school_id", params.schoolId)
    .in("id", studentIds);

  return (students || [])
    .map((student: any) => ({
      id: String(student.id),
      fullName: cleanText(student.full_name) || "Aluno",
      registrationNumber: cleanText(student.registration_number) || null,
      relationship: relationshipByStudent.get(String(student.id)) || null,
    }))
    .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, "pt-BR"));
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
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function GET(req: Request) {
  const ctx = await getParentContext(req);

  if (!ctx.ok) return ctx.response;

  try {
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
        created_at,
        updated_at
      `
      )
      .eq("school_id", ctx.schoolId)
      .gte("meal_date", from)
      .lte("meal_date", to)
      .order("meal_date", { ascending: true })
      .order("meal_type", { ascending: true })
      .order("created_at", { ascending: true });

    if (mealType && mealType !== "all") {
      query = query.eq("meal_type", normalizeMealType(mealType));
    }

    const { data, error } = await query;

    if (error) {
      return jsonError("Erro ao carregar cardápio: " + error.message, 500);
    }

    const meals = (data || []).map(normalizeMeal);

    const [school, children] = await Promise.all([
      getSchoolInfo(ctx.schoolId),
      getParentChildren({
        schoolId: ctx.schoolId,
        parentId: ctx.parentId,
      }),
    ]);

    return jsonOk({
      school,
      schoolId: ctx.schoolId,
      parent: {
        parentId: ctx.parentId,
        name: ctx.parentName,
        email: ctx.user.email || null,
      },
      children,
      meals,
      range: {
        from,
        to,
      },
      summary: {
        total: meals.length,
        days: new Set(meals.map((meal) => meal.meal_date)).size,
        breakfast: meals.filter((m) => m.meal_type === "breakfast").length,
        morning_snack: meals.filter((m) => m.meal_type === "morning_snack").length,
        lunch: meals.filter((m) => m.meal_type === "lunch").length,
        afternoon_snack: meals.filter((m) => m.meal_type === "afternoon_snack").length,
        dinner: meals.filter((m) => m.meal_type === "dinner").length,
        other: meals.filter((m) => m.meal_type === "other").length,
        children: children.length,
      },
      meta: {
        source: "parent_menu_v1",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar cardápio.", 500);
  }
}