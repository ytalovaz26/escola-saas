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

function normalizeSessionRow(row: any) {
  return {
    id: row.id_uuid ?? row.id,
    school_id: row.school_id ?? row.schoolId,
    class_id: row.class_id ?? row.classId,
    teacher_id: row.teacher_id ?? row.teacherId,
    lesson: row.lesson,
    date: row.session_date ?? row.date,
  };
}

async function getSessionById(supabase: any, sessionId: string) {
  let { data, error } = await supabase.from("attendance_sessions").select("*").eq("id_uuid", sessionId).single();
  if (error && String(error.message || "").toLowerCase().includes("id_uuid")) {
    ({ data, error } = await supabase.from("attendance_sessions").select("*").eq("id", sessionId).single());
  }
  if (error) return { ok: false as const, error };
  return { ok: true as const, row: data };
}

async function ensureTeacherOwnsSession(supabase: any, teacherId: string, schoolId: string, sessionRow: any) {
  const s = normalizeSessionRow(sessionRow);

  if (String(s.teacher_id) !== String(teacherId)) return { ok: false as const, error: new Error("Sessão não pertence a este professor.") };
  if (String(s.school_id) !== String(schoolId)) return { ok: false as const, error: new Error("Sessão não pertence a esta escola.") };

  const { data, error } = await supabase
    .from("teacher_classes")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", s.class_id)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return { ok: false as const, error };
  if (!data) return { ok: false as const, error: new Error("Professor não vinculado à turma desta sessão.") };

  return { ok: true as const, session: s };
}

async function ensureStudentInClass(supabase: any, schoolId: string, classId: string, studentId: string) {
  const { data, error } = await supabase
    .from("class_students")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return { ok: false as const, error };
  if (!data) return { ok: false as const, error: new Error("Aluno não pertence a esta turma (ou vínculo inativo).") };
  return { ok: true as const };
}

export async function POST(req: Request) {
  const ctx = await getTeacherContextOrFail(req);
  if (!ctx.ok) return ctx.resp;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const sessionId = String(body?.sessionId || "").trim();
  const studentId = String(body?.studentId || "").trim();
  const present = Boolean(body?.present);

  if (!sessionId) return jsonError("sessionId é obrigatório.", 400);
  if (!studentId) return jsonError("studentId é obrigatório.", 400);

  const sess = await getSessionById(ctx.supabase, sessionId);
  if (!sess.ok) return jsonError("Sessão não encontrada.", 404, { details: sess.error?.message });

  const owns = await ensureTeacherOwnsSession(ctx.supabase, ctx.userId, ctx.schoolId, sess.row);
  if (!owns.ok) return jsonError(owns.error?.message || "Acesso negado.", 403);

  const session = (owns as any).session;

  const inClass = await ensureStudentInClass(ctx.supabase, ctx.schoolId, session.class_id, studentId);
  if (!inClass.ok) return jsonError(inClass.error?.message || "Aluno inválido para esta turma.", 403);

  // 1) desativa marca anterior ativa (se houver)
  let upd = await ctx.supabase
    .from("attendance_marks")
    .update({ is_active: false })
    .eq("school_id", ctx.schoolId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .eq("session_id", sessionId);

  if (upd.error && String(upd.error.message || "").toLowerCase().includes("session_id")) {
    upd = await ctx.supabase
      .from("attendance_marks")
      .update({ is_active: false })
      .eq("school_id", ctx.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .eq("attendance_session_id", sessionId);
  }

  if (upd.error) return jsonError("Erro ao atualizar marca anterior.", 500, { details: upd.error.message });

  // 2) insere nova marca
  const baseInsert: any = {
    school_id: ctx.schoolId,
    student_id: studentId,
    marked_by: ctx.userId,
    marked_at: new Date().toISOString(),
    is_active: true,
  };

  let insertPayload: any = { ...baseInsert, session_id: sessionId, is_present: present };
  let ins = await ctx.supabase.from("attendance_marks").insert(insertPayload).select("*").single();

  if (ins.error && String(ins.error.message || "").toLowerCase().includes("is_present")) {
    const { is_present, ...rest } = insertPayload;
    ins = await ctx.supabase.from("attendance_marks").insert({ ...rest, present }).select("*").single();
  }

  if (ins.error && String(ins.error.message || "").toLowerCase().includes("session_id")) {
    const { session_id, ...rest } = insertPayload;
    let payload2: any = { ...rest, attendance_session_id: sessionId };
    let ins2 = await ctx.supabase.from("attendance_marks").insert(payload2).select("*").single();

    if (ins2.error && String(ins2.error.message || "").toLowerCase().includes("is_present")) {
      const { is_present, ...r2 } = payload2;
      ins2 = await ctx.supabase.from("attendance_marks").insert({ ...r2, present }).select("*").single();
    }

    if (ins2.error) return jsonError("Erro ao marcar presença.", 500, { details: ins2.error.message });
    return NextResponse.json({ ok: true, mark: ins2.data });
  }

  if (ins.error) return jsonError("Erro ao marcar presença.", 500, { details: ins.error.message });

  return NextResponse.json({ ok: true, mark: ins.data });
}
