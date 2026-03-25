import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function supabaseRlsClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function getTeacherContextOrFail(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, resp: jsonError("Missing Authorization Bearer token.", 401) };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, resp: jsonError("Invalid token/session.", 401) };

  const userId = userData.user.id;

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkErr) return { ok: false as const, resp: jsonError("school_users lookup failed: " + linkErr.message, 500) };

  const role = String(link?.role || "").trim().toLowerCase();
  const schoolId = link?.school_id ? String(link.school_id) : "";

  if (role !== "professor") return { ok: false as const, resp: jsonError("Acesso negado (somente professor).", 403) };
  if (!schoolId) return { ok: false as const, resp: jsonError("Vínculo sem school_id.", 403) };

  const supabase = supabaseRlsClient(token);
  return { ok: true as const, userId, schoolId, supabase };
}

async function ensureTeacherHasClassAccess(supabase: any, teacherId: string, schoolId: string, classId: string) {
  const { data, error } = await supabase
    .from("teacher_classes")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", classId)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return { ok: false as const, error };
  if (!data) return { ok: false as const, error: new Error("Professor não vinculado a esta turma (ou vínculo inativo).") };
  return { ok: true as const };
}

function normalizeSessionRow(row: any) {
  return {
    id: row.id_uuid ?? row.id,
    class_id: row.class_id ?? row.classId,
    teacher_id: row.teacher_id ?? row.teacherId,
    school_id: row.school_id ?? row.schoolId,
    lesson: row.lesson,
    date: row.session_date ?? row.date,
    created_at: row.created_at ?? row.createdAt,
  };
}

export async function GET(req: Request) {
  const ctx = await getTeacherContextOrFail(req);
  if (!ctx.ok) return ctx.resp;

  const url = new URL(req.url);
  const classId = String(url.searchParams.get("classId") || "").trim();
  if (!classId) return jsonError("classId é obrigatório.", 400);

  const access = await ensureTeacherHasClassAccess(ctx.supabase, ctx.userId, ctx.schoolId, classId);
  if (!access.ok) return jsonError(access.error?.message || "Acesso negado.", 403);

  let { data, error } = await ctx.supabase
    .from("attendance_sessions")
    .select("*")
    .eq("school_id", ctx.schoolId)
    .eq("class_id", classId)
    .eq("teacher_id", ctx.userId)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error && String(error.message || "").toLowerCase().includes("session_date")) {
    ({ data, error } = await ctx.supabase
      .from("attendance_sessions")
      .select("*")
      .eq("school_id", ctx.schoolId)
      .eq("class_id", classId)
      .eq("teacher_id", ctx.userId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }));
  }

  if (error) return jsonError("Erro ao listar sessões.", 500, { details: error.message });

  return NextResponse.json({ ok: true, sessions: (data || []).map(normalizeSessionRow) });
}
