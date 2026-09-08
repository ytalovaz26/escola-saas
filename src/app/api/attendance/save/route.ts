import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type Payload = {
  classId: string;
  date: string;
  lessonNumber?: number;
  items: Array<{
    studentId?: string;
    student_id?: string;
    status: AttendanceStatus;
    note?: string | null;
  }>;
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: corsHeaders() }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
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

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function getWeekendBlock(date: string) {
  if (!isValidDateString(date)) return null;

  const parsed = new Date(`${date}T12:00:00Z`);
  const day = parsed.getUTCDay();

  if (day !== 0 && day !== 6) return null;

  return {
    id: `weekend-${date}`,
    date,
    type: "weekend",
    typeLabel: "Fim de semana",
    title: day === 6 ? "Sábado — sem aula" : "Domingo — sem aula",
    description:
      "Fim de semana não é considerado dia letivo para a chamada regular.",
    targetScope: "all_school",
    classId: null,
    shift: null,
  };
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
    return { ok: false as const, error: error.message, data: null as any };
  }

  if (!data?.id) {
    return {
      ok: false as const,
      error: "Turma não encontrada nesta escola.",
      data: null as any,
    };
  }

  return { ok: true as const, error: null, data };
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
    .select(`
      id,
      block_date,
      type,
      title,
      description,
      target_scope,
      class_id,
      shift,
      affects_all_classes
    `)
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

  return { ok: true as const, error: null, blocks: applicableBlocks };
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

function isTeacherRole(role: unknown) {
  const value = cleanText(role).toLowerCase();
  return value === "professor" || value === "teacher";
}

async function getOrCreateSession(params: {
  schoolId: string;
  classId: string;
  teacherUserId: string;
  lessonDate: string;
  lessonNumber: number;
}) {
  const { schoolId, classId, teacherUserId, lessonDate, lessonNumber } = params;

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("lesson_date", lessonDate)
    .eq("lesson_number", lessonNumber)
    .limit(1);

  if (findErr) {
    return {
      ok: false as const,
      error: "Failed to find attendance session.",
      details: findErr.message,
    };
  }

  if (existing && existing.length > 0) {
    return { ok: true as const, sessionId: existing[0].id as string };
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("attendance_sessions")
    .insert({
      school_id: schoolId,
      class_id: classId,
      teacher_user_id: teacherUserId,
      lesson_date: lessonDate,
      lesson_number: lessonNumber,
    })
    .select("id")
    .single();

  if (insertErr) {
    const { data: retry, error: retryErr } = await supabaseAdmin
      .from("attendance_sessions")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("lesson_date", lessonDate)
      .eq("lesson_number", lessonNumber)
      .limit(1);

    if (retryErr) {
      return {
        ok: false as const,
        error: "Failed to create attendance session.",
        details: `${insertErr.message} | retry: ${retryErr.message}`,
      };
    }

    if (retry && retry.length > 0) {
      return { ok: true as const, sessionId: retry[0].id as string };
    }

    return {
      ok: false as const,
      error: "Failed to create attendance session.",
      details: insertErr.message,
    };
  }

  return { ok: true as const, sessionId: created.id as string };
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "admin",
    "secretaria",
    "coordenador",
    "coordinator",
    "professor",
    "teacher",
  ]);

  if (!guard.ok) return guard.res;

  const { schoolId, userId, role } = guard;

  if (!userId) return jsonError("Usuário não identificado.", 401);

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const classId = (body?.classId || "").trim();
  const date = (body?.date || "").trim();
  const lessonNumber =
    typeof body?.lessonNumber === "number" && body.lessonNumber >= 1
      ? body.lessonNumber
      : 1;
  const items = Array.isArray(body?.items) ? body.items : [];

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!date) return jsonError("date é obrigatório (YYYY-MM-DD).", 400);
  if (!isValidDateString(date)) {
    return jsonError("date inválido. Use o formato YYYY-MM-DD.", 400);
  }
  if (items.length === 0) {
    return jsonError("items é obrigatório e não pode estar vazio.", 400);
  }

  const classInfo = await getClassInfo({ schoolId, classId });
  if (!classInfo.ok) return jsonError(classInfo.error, 404);

  if (isTeacherRole(role)) {
    const { data: teacherClassLink, error: teacherClassErr } = await supabaseAdmin
      .from("teacher_classes")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("teacher_user_id", userId)
      .limit(1);

    if (teacherClassErr) {
      return jsonError("Falha ao validar vínculo professor-turma.", 500, {
        details: teacherClassErr.message,
      });
    }

    if (!teacherClassLink || teacherClassLink.length === 0) {
      return jsonError("Professor não está vinculado a esta turma.", 403);
    }
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

  const formattedBlocks = calendarBlocksResult.blocks.map(
    formatCalendarBlockForResponse
  );
  const weekendBlock = getWeekendBlock(date);
  const effectiveBlocks = weekendBlock
    ? [weekendBlock, ...formattedBlocks]
    : formattedBlocks;

  if (effectiveBlocks.length > 0) {
    return jsonError("Não é possível salvar chamada em dia sem aula.", 409, {
      attendanceBlock: {
        isBlocked: true,
        blocks: effectiveBlocks,
        mainBlock: effectiveBlocks[0] || null,
        message:
          "Não haverá aula neste dia. A chamada não precisa ser realizada.",
      },
    });
  }

  const { data: activeStudents, error: activeStudentsErr } =
    await supabaseAdmin.rpc("get_active_students_for_class_on_date", {
      p_class_id: classId,
      p_date: date,
    });

  if (activeStudentsErr) {
    return jsonError("Falha ao validar alunos ativos da turma/data.", 500, {
      details: activeStudentsErr.message,
    });
  }

  const allowedStudentIds = new Set(
    (activeStudents || [])
      .map((student: any) =>
        String(student?.student_id || student?.id || "").trim()
      )
      .filter(Boolean)
  );

  const normalizedItems = items.map((item) => {
    const studentId = String(item.studentId || item.student_id || "").trim();

    return {
      student_id: studentId,
      status: item.status,
      note: item.note ?? null,
    };
  });

  if (normalizedItems.some((item) => !item.student_id)) {
    return jsonError("studentId inválido em items.", 400);
  }

  if (normalizedItems.some((item) => !allowedStudentIds.has(item.student_id))) {
    return jsonError(
      "Existe aluno em items que não pertence a esta turma/data.",
      400
    );
  }

  const sessionResult = await getOrCreateSession({
    schoolId,
    classId,
    teacherUserId: userId,
    lessonDate: date,
    lessonNumber,
  });

  if (!sessionResult.ok) {
    return jsonError("Falha ao criar/obter sessão de presença.", 500, {
      details: sessionResult.details,
    });
  }

  const sessionId = sessionResult.sessionId;
  const rows = normalizedItems.map((item) => ({
    school_id: schoolId,
    session_id: sessionId,
    student_id: item.student_id,
    status: item.status,
    note: item.note,
  }));

  const { error: saveErr } = await supabaseAdmin
    .from("attendance_records")
    .upsert(rows, { onConflict: "session_id,student_id" });

  if (saveErr) {
    return jsonError("Falha ao salvar presença.", 500, {
      details: saveErr.message,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      sessionId,
      totalSaved: rows.length,
    },
    { headers: corsHeaders() }
  );
}
