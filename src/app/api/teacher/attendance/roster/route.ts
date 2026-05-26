import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type StudentItem = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

type CalendarBlock = {
  id: string;
  block_date: string;
  type: string;
  title: string;
  description: string | null;
  target_scope: string | null;
  class_id: string | null;
  shift: string | null;
  affects_all_classes: boolean | null;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeStatus(raw: any): AttendanceStatus | null {
  const s = String(raw || "").toLowerCase().trim();

  if (!s) return null;
  if (s === "present" || s === "presente" || s === "p") return "present";
  if (s === "absent" || s === "ausente" || s === "f") return "absent";
  if (s === "late" || s === "tarde" || s === "atraso" || s === "t") return "late";

  return null;
}

function blockTypeLabel(type: string) {
  const safe = cleanText(type);

  if (safe === "holiday") return "Feriado";
  if (safe === "recess") return "Recesso escolar";
  if (safe === "no_class") return "Dia sem aula";
  if (safe === "pedagogical_day") return "Dia pedagógico";
  if (safe === "exam_day") return "Dia de avaliação";
  if (safe === "event") return "Evento escolar";

  return "Calendário escolar";
}

async function getClassInfo(params: { schoolId: string; classId: string }) {
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, name, grade, shift, school_id")
    .eq("school_id", params.schoolId)
    .eq("id", params.classId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      data: null as any,
    };
  }

  if (!data?.id) {
    return {
      ok: false as const,
      error: "Turma não encontrada nesta escola.",
      data: null as any,
    };
  }

  return {
    ok: true as const,
    error: null,
    data,
  };
}

async function getApplicableCalendarBlocks(params: {
  schoolId: string;
  classId: string;
  date: string;
}) {
  const classInfo = await getClassInfo({
    schoolId: params.schoolId,
    classId: params.classId,
  });

  if (!classInfo.ok) {
    return {
      ok: false as const,
      error: classInfo.error,
      blocks: [] as CalendarBlock[],
    };
  }

  const classShift = cleanText(classInfo.data?.shift);

  const { data, error } = await supabaseAdmin
    .from("school_calendar_blocks")
    .select(
      `
      id,
      block_date,
      type,
      title,
      description,
      target_scope,
      class_id,
      shift,
      affects_all_classes
    `
    )
    .eq("school_id", params.schoolId)
    .eq("block_date", params.date)
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      blocks: [] as CalendarBlock[],
    };
  }

  const applicableBlocks = ((data || []) as CalendarBlock[]).filter((block) => {
    const scope = cleanText(block.target_scope) || "all_school";

    if (scope === "all_school" || block.affects_all_classes === true) return true;

    if (scope === "class") {
      return cleanText(block.class_id) === params.classId;
    }

    if (scope === "shift") {
      return (
        !!cleanText(block.shift) &&
        normalizeComparable(block.shift) === normalizeComparable(classShift)
      );
    }

    return false;
  });

  return {
    ok: true as const,
    error: null,
    blocks: applicableBlocks,
  };
}

function formatCalendarBlockForResponse(block: CalendarBlock) {
  return {
    id: block.id,
    date: block.block_date,
    type: block.type,
    typeLabel: blockTypeLabel(block.type),
    title: cleanText(block.title) || "Não haverá aula",
    description:
      cleanText(block.description) ||
      "A escola informou que não haverá aula para esta data.",
    targetScope: cleanText(block.target_scope) || "all_school",
    classId: cleanText(block.class_id) || null,
    shift: cleanText(block.shift) || null,
  };
}

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

async function loadExistingMarks(params: {
  schoolId: string;
  classId: string;
  date: string;
  allowedStudentIds: string[];
}) {
  const { data: sessions, error: sessionsErr } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id")
    .eq("school_id", params.schoolId)
    .eq("class_id", params.classId)
    .eq("lesson_date", params.date)
    .eq("lesson_number", 1);

  if (sessionsErr) {
    return {
      ok: false as const,
      error: sessionsErr.message,
      marks: [] as {
        student_id: string;
        status: AttendanceStatus;
        note: string | null;
      }[],
    };
  }

  const sessionIds = (sessions || [])
    .map((session: any) => String(session.id))
    .filter(Boolean);

  const marksMap = new Map<
    string,
    {
      student_id: string;
      status: AttendanceStatus;
      note: string | null;
    }
  >();

  if (sessionIds.length > 0) {
    const { data: records, error: recordsErr } = await supabaseAdmin
      .from("attendance_records")
      .select("student_id, status, note, session_id")
      .eq("school_id", params.schoolId)
      .in("session_id", sessionIds)
      .in("student_id", params.allowedStudentIds);

    if (recordsErr) {
      return {
        ok: false as const,
        error: recordsErr.message,
        marks: [],
      };
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

  return {
    ok: true as const,
    error: null,
    marks: Array.from(marksMap.values()),
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

  const calendarBlocksResult = await getApplicableCalendarBlocks({
    schoolId,
    classId,
    date,
  });

  if (!calendarBlocksResult.ok) {
    return jsonError("Erro ao verificar calendário escolar.", 500, {
      details: calendarBlocksResult.error,
    });
  }

  const formattedBlocks = calendarBlocksResult.blocks.map(formatCalendarBlockForResponse);

  const attendanceBlock = {
    isBlocked: formattedBlocks.length > 0,
    blocks: formattedBlocks,
    mainBlock: formattedBlocks[0] || null,
    message:
      formattedBlocks.length > 0
        ? "Não haverá aula neste dia. A chamada não precisa ser realizada."
        : null,
  };

  const rpcRoster = await getRosterFromRpc(classId, date);

  if (!rpcRoster.ok) {
    const fallbackRoster = await getRosterFromActiveLinks(schoolId, classId);

    if (!fallbackRoster.ok) {
      return jsonError("Falha ao buscar alunos ativos da turma.", 500, {
        details: `RPC: ${rpcRoster.error} | Fallback: ${fallbackRoster.error}`,
      });
    }

    const allowedStudentIds = fallbackRoster.data.map((item) => item.student_id);

    if (allowedStudentIds.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          roster: [],
          marks: [],
          attendanceBlock,
          roster_source: "active_links_fallback_empty",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const marksResult = await loadExistingMarks({
      schoolId,
      classId,
      date,
      allowedStudentIds,
    });

    if (!marksResult.ok) {
      return jsonError("Falha ao buscar registros da chamada.", 500, {
        details: marksResult.error,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        roster: fallbackRoster.data,
        marks: marksResult.marks,
        attendanceBlock,
        roster_source: "active_links_fallback",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  let finalRoster = rpcRoster.data;

  if (finalRoster.length === 0) {
    const fallbackRoster = await getRosterFromActiveLinks(schoolId, classId);
    if (fallbackRoster.ok && fallbackRoster.data.length > 0) {
      finalRoster = fallbackRoster.data;
    }
  }

  const allowedStudentIds = finalRoster.map((item) => item.student_id);

  if (allowedStudentIds.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        roster: [],
        marks: [],
        attendanceBlock,
        roster_source: "empty",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const marksResult = await loadExistingMarks({
    schoolId,
    classId,
    date,
    allowedStudentIds,
  });

  if (!marksResult.ok) {
    return jsonError("Falha ao buscar registros da chamada.", 500, {
      details: marksResult.error,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      roster: finalRoster,
      marks: marksResult.marks,
      attendanceBlock,
      roster_source: finalRoster.length === rpcRoster.data.length ? "rpc" : "active_links_fallback",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}