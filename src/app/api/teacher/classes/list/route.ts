import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

async function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function GET(req: Request) {
  try {
    const token = await getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) usuário logado
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida.", 401);

    const userId = userData.user.id;

    // 2) confirma que é professor (school_users ativo)
    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (suErr) return jsonError("school_users lookup failed: " + suErr.message, 500);
    if (!su?.school_id) return jsonError("Usuário não vinculado a nenhuma escola.", 403);

    const role = normRole(su.role);
    if (!(role === "professor" || role === "teacher")) {
      return jsonError(`Acesso negado. Role: "${su?.role}"`, 403);
    }

    const schoolId = String(su.school_id);

    // 3) vínculos ativos teacher_classes do professor
    const { data: tc, error: tcErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id, class_id, created_at, is_active")
      .eq("school_id", schoolId)
      .eq("teacher_user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (tcErr) return jsonError("teacher_classes list failed: " + tcErr.message, 500);

    const classIds = Array.from(new Set((tc ?? []).map((x: any) => x.class_id).filter(Boolean)));

    // 4) carrega turmas
    const classesMap = new Map<string, { id: string; name: string; grade: string | null; shift: string | null }>();
    if (classIds.length > 0) {
      const { data: cls, error: cErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .in("id", classIds);

      if (cErr) return jsonError("classes lookup failed: " + cErr.message, 500);

      for (const c of (cls ?? []) as any[]) {
        classesMap.set(String(c.id), {
          id: String(c.id),
          name: String(c.name ?? ""),
          grade: c.grade ?? null,
          shift: c.shift ?? null,
        });
      }
    }

    // 5) resposta
    const items = (tc ?? []).map((row: any) => {
      const cid = String(row.class_id);
      const c = classesMap.get(cid);

      return {
        assignmentId: String(row.id),
        classId: cid,
        createdAt: row.created_at ?? null,

        name: c?.name ?? null,
        grade: c?.grade ?? null,
        shift: c?.shift ?? null,
      };
    });

    return NextResponse.json({ ok: true, schoolId, classes: items });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/teacher/classes/list", 500);
  }
}
