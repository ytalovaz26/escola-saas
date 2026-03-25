import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeStatus(raw: any): "present" | "absent" | "late" | null {
  const s = String(raw || "").toLowerCase().trim();

  if (!s) return null;
  if (s === "present" || s === "presente" || s === "p") return "present";
  if (s === "absent" || s === "ausente" || s === "f") return "absent";
  if (s === "late" || s === "tarde" || s === "atraso" || s === "t") return "late";

  return null;
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "professor",
    "teacher",
    "coordenador",
    "coordinator",
    "diretor",
    "director",
    "admin",
  ]);
  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;
  const teacherUserId =
    (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const date = (url.searchParams.get("date") || "").trim();

  if (!teacherUserId) return jsonError("Professor não identificado (token).", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!date) return jsonError("date é obrigatório (YYYY-MM-DD).", 400);

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .limit(1);

  if (linkErr) {
    return jsonError("Erro ao validar vínculo professor-turma.", 500, {
      details: linkErr.message,
    });
  }

  if (!link || link.length === 0) {
    return jsonError("Professor não está vinculado a esta turma.", 403);
  }

  const { data: roster, error: rosterErr } = await supabaseAdmin.rpc(
    "get_active_students_for_class_on_date",
    {
      p_class_id: classId,
      p_date: date,
    }
  );

  if (rosterErr) {
    return jsonError("Falha ao buscar alunos ativos (RPC).", 500, {
      details: rosterErr.message,
    });
  }

  const rosterMap = new Map<
    string,
    {
      student_id: string;
      full_name: string | null;
      registration_number: string | null;
    }
  >();

  for (const row of roster || []) {
    const studentId = String((row as any)?.student_id ?? (row as any)?.id ?? "").trim();
    if (!studentId) continue;

    if (!rosterMap.has(studentId)) {
      rosterMap.set(studentId, {
        student_id: studentId,
        full_name: (row as any)?.full_name ?? (row as any)?.name ?? null,
        registration_number:
          (row as any)?.registration_number ??
          (row as any)?.registration ??
          (row as any)?.mat ??
          null,
      });
    }
  }

  const rosterList = Array.from(rosterMap.values()).sort((a, b) =>
    String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
  );

  const allowedStudentIds = rosterList.map((item) => item.student_id);

  if (allowedStudentIds.length === 0) {
    return NextResponse.json({
      ok: true,
      roster: [],
      marks: [],
    });
  }

  const { data: sessions, error: sessionsErr } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("lesson_date", date)
    .eq("lesson_number", 1);

  if (sessionsErr) {
    return jsonError("Falha ao buscar sessões da chamada.", 500, {
      details: sessionsErr.message,
    });
  }

  const sessionIds = (sessions || []).map((session: any) => String(session.id)).filter(Boolean);

  const marksMap = new Map<
    string,
    {
      student_id: string;
      status: "present" | "absent" | "late";
      note: string | null;
    }
  >();

  if (sessionIds.length > 0) {
    const { data: records, error: recordsErr } = await supabaseAdmin
      .from("attendance_records")
      .select("student_id, status, note, session_id")
      .eq("school_id", schoolId)
      .in("session_id", sessionIds)
      .in("student_id", allowedStudentIds);

    if (recordsErr) {
      return jsonError("Falha ao buscar registros da chamada.", 500, {
        details: recordsErr.message,
      });
    }

    for (const record of records || []) {
      const studentId = String((record as any)?.student_id || "").trim();
      if (!studentId) continue;

      const status = normalizeStatus((record as any)?.status);
      if (!status) continue;

      marksMap.set(studentId, {
        student_id: studentId,
        status,
        note: (record as any)?.note ?? null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    roster: rosterList,
    marks: Array.from(marksMap.values()),
  });
}