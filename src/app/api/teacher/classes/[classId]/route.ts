import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonFail(status: number, error: string, details?: any) {
  return NextResponse.json({ ok: false, error, details: details ?? null }, { status });
}

function jsonOk(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

type Ctx = {
  params: Promise<{ classId: string }>;
};

export async function GET(req: Request, ctx: Ctx) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonFail(401, "Missing Authorization Bearer token.");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authData?.user) {
      return jsonFail(401, authErr?.message || "Invalid token/session.");
    }

    const userId = authData.user.id;
    const { classId } = await ctx.params;

    if (!classId) return jsonFail(400, "classId é obrigatório.");

    const { data: schoolLink, error: schoolErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (schoolErr) return jsonFail(500, schoolErr.message);
    if (!schoolLink?.school_id) {
      return jsonFail(403, "Professor não vinculado a nenhuma escola.");
    }

    const role = normRole(schoolLink.role);
    if (!(role === "professor" || role === "teacher")) {
      return jsonFail(403, "Acesso permitido apenas para professor.");
    }

    const schoolId = schoolLink.school_id;

    const { data: teacherClass, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("teacher_user_id", userId)
      .limit(1)
      .maybeSingle();

    if (tcErr) return jsonFail(500, tcErr.message);
    if (!teacherClass?.id) {
      return jsonFail(403, "Professor não está vinculado a esta turma.");
    }

    const { data: cls, error: classErr } = await supabaseAdmin
      .from("classes")
      .select("id, name, grade, shift")
      .eq("id", classId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (classErr) return jsonFail(500, classErr.message);
    if (!cls) return jsonFail(404, "Turma não encontrada.");

    return jsonOk({
      class: {
        id: cls.id,
        name: cls.name ?? null,
        grade: cls.grade ?? null,
        shift: cls.shift ?? null,
      },
    });
  } catch (e: any) {
    return jsonFail(500, e?.message || "Internal error");
  }
}