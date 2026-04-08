import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonFail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
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

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonFail(401, "Missing Authorization Bearer token.");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authData?.user) {
      return jsonFail(401, authErr?.message || "Invalid token/session.");
    }

    const userId = authData.user.id;

    const { data: schoolLink, error: schoolErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (schoolErr) {
      return jsonFail(500, schoolErr.message);
    }

    if (!schoolLink?.school_id) {
      return jsonFail(403, "Professor não vinculado a nenhuma escola.");
    }

    const role = normRole(schoolLink.role);
    if (!(role === "professor" || role === "teacher")) {
      return jsonFail(403, "Acesso permitido apenas para professor.");
    }

    const schoolId = schoolLink.school_id;

    const { data, error } = await supabaseAdmin
      .from("teacher_classes")
      .select(`
        id,
        class_id,
        created_at,
        classes (
          id,
          name,
          grade,
          shift
        )
      `)
      .eq("teacher_id", userId)
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonFail(500, error.message);
    }

    const classes = (data || []).map((item: any) => ({
      assignmentId: item.id,
      classId: item.class_id,
      createdAt: item.created_at || null,
      name: item.classes?.name || null,
      grade: item.classes?.grade || null,
      shift: item.classes?.shift || null,
    }));

    return jsonOk({
      schoolId,
      classes,
    });
  } catch (e: any) {
    return jsonFail(500, e?.message || "Internal error");
  }
}