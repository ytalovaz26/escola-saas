// src/lib/requireParent.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function requireParent(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 }) };
  }

  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
  if (uErr || !u?.user) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 }) };
  }

  const userId = u.user.id;

  // parent vinculado (parents.user_id)
  const { data: p, error: pErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (pErr) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: pErr.message }, { status: 500 }) };
  }

  if (!p?.id || !p?.school_id) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Parent profile not found" }, { status: 403 }) };
  }

  return {
    ok: true as const,
    userId,
    parentId: p.id as string,
    schoolId: p.school_id as string,
  };
}