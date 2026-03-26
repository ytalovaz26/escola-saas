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

  if (role !== "professor") {
    return { ok: false as const, resp: jsonError("Acesso negado (somente professor).", 403) };
  }
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
    created_at: row.created_at ?? row.createdAt,
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

async function ensureTeacherOwnsSession(
  supabase: any,
  teacherId: string,
  schoolId: string,
  sessionRow: any
) {
  const s = normalizeSessionRow(sessionRow);

  if (String(s.teacher_id) !== String(teacherId)) {
    return { ok: false as const, error: new Error("Sessão não pertence a este professor.") };
  }

  if (String(s.school_id) !== String(schoolId)) {
    return { ok: false as const, error: new Error("Sessão não pertence a esta escola.") };
  }

  const { data, error } = await supabase
    .from("teacher_classes")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", s.class_id)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return { ok: false as const, error };
  if (!data) {
    return { ok: false as const, error: new Error("Professor não vinculado à turma desta sessão.") };
  }

  return { ok: true as const, session: s };
}

async function listActiveClassStudents(supabase: any, schoolId: string, classId: string) {
  const { data, error } = await supabase
    .from("class_students")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (error) return { ok: false as const, error };

  const ids = (data || []).map((r: any) => r.student_id).filter(Boolean);
  return { ok: true as const, studentIds: ids };
}

async function loadStudentProfiles(supabase: any, studentIds: string[]) {
  if (!studentIds.length) return { ok: true as const, students: [] as any[] };

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .in("user_id", studentIds);

  if (error) return { ok: false as const, error };

  const students = (data || []).map((p: any) => ({
    student_id: p.user_id,
    full_name: p.full_name ?? "",
  }));

  students.sort(
    (
      a: { student_id: string; full_name: string },
      b: { student_id: string; full_name: string }
    ) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
  );

  return { ok: true as const, students };
}

async function listActiveMarks(supabase: any, schoolId: string, sessionId: string) {
  let q = supabase
    .from("attendance_marks")
    .select("*")
    .eq("school_id", schoolId)
    .eq("is_active", true);

  let { data, error } = await q.eq("session_id", sessionId);

  if (error && String(error.message || "").toLowerCase().includes("session_id")) {
    ({ data, error } = await q.eq("attendance_session_id", sessionId));
  }

  if (error) return { ok: false as const, error };

  const byStudent: Record<string, any> = {};
  for (const r of data || []) {
    const sid = r.student_id ?? r.studentId;
    if (!sid) continue;

    const present = r.is_present ?? r.present ?? r.status ?? false;
    byStudent[String(sid)] = {
      present: Boolean(present),
      marked_at: r.marked_at ?? r.created_at ?? null,
    };
  }

  return { ok: true as const, marksByStudent: byStudent };
}

export async function GET(req: Request) {
  const ctx = await getTeacherContextOrFail(req);
  if (!ctx.ok) return ctx.resp;

  const url = new URL(req.url);
  const sessionId = String(url.searchParams.get("sessionId") || "").trim();
  if (!sessionId) return jsonError("sessionId é obrigatório.", 400);

  const sess = await getSessionById(ctx.supabase, sessionId);
  if (!sess.ok) return jsonError("Sessão não encontrada.", 404, { details: sess.error?.message });

  const owns = await ensureTeacherOwnsSession(ctx.supabase, ctx.userId, ctx.schoolId, sess.row);
  if (!owns.ok) return jsonError(owns.error?.message || "Acesso negado.", 403);

  const session = owns.session;

  const cs = await listActiveClassStudents(ctx.supabase, ctx.schoolId, session.class_id);
  if (!cs.ok) return jsonError("Erro ao listar alunos da turma.", 500, { details: cs.error?.message });

  const profs = await loadStudentProfiles(ctx.supabase, cs.studentIds);
  if (!profs.ok) return jsonError("Erro ao carregar perfis dos alunos.", 500, { details: profs.error?.message });

  const marks = await listActiveMarks(ctx.supabase, ctx.schoolId, sessionId);
  if (!marks.ok) return jsonError("Erro ao carregar marcas de presença.", 500, { details: marks.error?.message });

  const students = profs.students.map((st: any) => ({
    student_id: st.student_id,
    full_name: st.full_name,
    present: Boolean(marks.marksByStudent[String(st.student_id)]?.present ?? false),
    marked_at: marks.marksByStudent[String(st.student_id)]?.marked_at ?? null,
  }));

  return NextResponse.json({ ok: true, session, students });
}