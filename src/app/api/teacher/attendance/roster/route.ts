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

type StudentItem = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

async function getRosterFromRpc(classId: string, date: string) {
  const { data, error } = await supabaseAdmin.rpc("get_active_students_for_class_on_date", {
    p_class_id: classId,
    p_date: date,
  });

  if (error) {
    return { ok: false as const, error: error.message, data: [] as StudentItem[] };
  }

  const rosterMap = new Map<string, StudentItem>();

  for (const row of data || []) {
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

  return {
    ok: true as const,
    data: Array.from(rosterMap.values()).sort((a, b) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
    ),
  };
}

async function getRosterFromActiveLinks(schoolId: string, classId: string) {
  const { data, error } = await supabaseAdmin
    .from("student_classes")
    .select(`
      student_id,
      students!inner (
        id,
        full_name,
        registration_number
      )
    `)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (error) {
    return { ok: false as const, error: error.message, data: [] as StudentItem[] };
  }

  const rosterMap = new Map<string, StudentItem>();

  for (const row of data || []) {
    const studentId = String((row as any)?.student_id ?? (row as any)?.students?.id ?? "").trim();
    if (!studentId) continue;

    if (!rosterMap.has(studentId)) {
      rosterMap.set(studentId, {
        student_id: studentId,
        full_name: (row as any)?.students?.full_name ?? null,
        registration_number: (row as any)?.students?.registration_number ?? null,
      });
    }
  }

  return {
    ok: true as const,
    data: Array.from(rosterMap.values()).sort((a, b) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
    ),
  };
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

  // 1) tenta roster pela RPC histórica
  const rpcRoster = await getRosterFromRpc(classId, date);

  if (!rpcRoster.ok) {
    // 2) se a RPC falhar, usa fallback seguro pelo vínculo ativo atual
    const fallbackRoster = await getRosterFromActiveLinks(schoolId, classId);

    if (!fallbackRoster.ok) {
      return jsonError("Falha ao buscar alunos ativos da turma.", 500, {
        details: `RPC: ${rpcRoster.error} | Fallback: ${fallbackRoster.error}`,
      });
    }

    const allowedStudentIds = fallbackRoster.data.map((item) => item.student_id);

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

    const sessionIds = (sessions || [])
      .map((session: any) => String(session.id))
      .filter(Boolean);

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
      roster: fallbackRoster.data,
      marks: Array.from(marksMap.values()),
      roster_source: "active_links_fallback",
    });
  }

  // 3) se a RPC veio vazia, mas existe vínculo ativo atual, usa fallback também
  let finalRoster = rpcRoster.data;

  if (finalRoster.length === 0) {
    const fallbackRoster = await getRosterFromActiveLinks(schoolId, classId);
    if (fallbackRoster.ok && fallbackRoster.data.length > 0) {
      finalRoster = fallbackRoster.data;
    }
  }

  const allowedStudentIds = finalRoster.map((item) => item.student_id);

  if (allowedStudentIds.length === 0) {
    return NextResponse.json({
      ok: true,
      roster: [],
      marks: [],
      roster_source: "empty",
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

  const sessionIds = (sessions || [])
    .map((session: any) => String(session.id))
    .filter(Boolean);

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
    roster: finalRoster,
    marks: Array.from(marksMap.values()),
    roster_source: finalRoster.length === rpcRoster.data.length ? "rpc" : "active_links_fallback",
  });
}