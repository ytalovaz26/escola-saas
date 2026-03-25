import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) valida sessão/token
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid token/session.", 401);

    const userId = userData.user.id;

    // 2) lê payload
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    const messageBody = String(body?.body ?? "").trim();

    if (!title) return jsonError("Missing title.", 400);
    if (!messageBody) return jsonError("Missing body.", 400);

    // 3) descobre a escola e valida permissão (diretor/coordenador)
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (staffErr) return jsonError("school_users lookup failed: " + staffErr.message, 500);
    if (!staff?.school_id) return jsonError("User has no active school link.", 403);

    const role = String(staff.role || "").toLowerCase();
    const canPost = role === "diretor" || role === "coordenador" || role === "director" || role === "coordinator";

    if (!canPost) return jsonError("Not allowed. Only diretor/coordenador can create messages.", 403);

    const schoolId = staff.school_id as string;

    // 4) cria o comunicado (messages)
    const { data: created, error: insErr } = await supabaseAdmin
      .from("messages")
      .insert({
        school_id: schoolId,
        created_by: userId,
        title,
        body: messageBody,
        status: "published",
      })
      .select("id, school_id, created_by, title, body, status, created_at")
      .single();

    if (insErr) return jsonError("Insert failed: " + insErr.message, 500);

    return NextResponse.json({ ok: true, message: created });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/school/messages/create", 500);
  }
}
