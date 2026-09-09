import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

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
  calendar_action: "block" | "allow" | string | null;
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
      affects_all_classes,
      calendar_action
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

function normalizeCalendarAction(value: unknown) {
  return cleanText(value) === "allow" ? "allow" : "block";
}

function calendarScopePriority(block: CalendarBlock) {
  const scope = cleanText(block.target_scope) || "all_school";

  if (scope === "class") return 3;
  if (scope === "shift") return 2;

  return 1;
}

function resolveAttendanceCalendar(params: {
  date: string;
  blocks: CalendarBlock[];
}) {
  const explicitBlocks = params.blocks || [];

  if (explicitBlocks.length > 0) {
    const highestPriority = Math.max(
      ...explicitBlocks.map(calendarScopePriority)
    );

    const winningRules = explicitBlocks.filter(
      (block) => calendarScopePriority(block) === highestPriority
    );

    const blockingRules = winningRules.filter(
      (block) => normalizeCalendarAction(block.calendar_action) === "block"
    );

    if (blockingRules.length > 0) {
      return {
        isBlocked: true,
        blockingRules,
        weekendBlock: null,
      };
    }

    const allowingRules = winningRules.filter(
      (block) => normalizeCalendarAction(block.calendar_action) === "allow"
    );

    if (allowingRules.length > 0) {
      return {
        isBlocked: false,
        blockingRules: [] as CalendarBlock[],
        weekendBlock: null,
      };
    }
  }

  const weekendBlock = getWeekendBlock(params.date);

  if (weekendBlock) {
    return {
      isBlocked: true,
      blockingRules: [] as CalendarBlock[],
      weekendBlock,
    };
  }

  return {
    isBlocked: false,
    blockingRules: [] as CalendarBlock[],
    weekendBlock: null,
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

export async function GET(req: Request) {
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

  const { schoolId } = guard;
  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const date = (url.searchParams.get("date") || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!date) return jsonError("date é obrigatório (YYYY-MM-DD).", 400);
  if (!isValidDateString(date)) {
    return jsonError("date inválido. Use o formato YYYY-MM-DD.", 400);
  }

  const classInfo = await getClassInfo({ schoolId, classId });
  if (!classInfo.ok) return jsonError(classInfo.error, 404);

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

  const calendarDecision = resolveAttendanceCalendar({
    date,
    blocks: calendarBlocksResult.blocks,
  });

  const effectiveBlocks = calendarDecision.isBlocked
    ? calendarDecision.blockingRules.length > 0
      ? calendarDecision.blockingRules.map(formatCalendarBlockForResponse)
      : calendarDecision.weekendBlock
        ? [calendarDecision.weekendBlock]
        : []
    : [];

  const attendanceBlock = {
    isBlocked: effectiveBlocks.length > 0,
    blocks: effectiveBlocks,
    mainBlock: effectiveBlocks[0] || null,
    message:
      effectiveBlocks.length > 0
        ? "Não haverá aula neste dia. A chamada não precisa ser realizada."
        : null,
  };

  const { data: roster, error: rosterErr } = await supabaseAdmin.rpc(
    "get_active_students_for_class_on_date",
    { p_class_id: classId, p_date: date }
  );

  if (rosterErr) {
    return jsonError("Falha ao buscar alunos ativos (RPC).", 500, {
      details: rosterErr.message,
    });
  }

  const { data: marks, error: marksErr } = await supabaseAdmin
    .from("attendance")
    .select("student_id,status,note")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("date", date);

  if (marksErr) {
    return jsonError("Falha ao buscar presenças do dia.", 500, {
      details: marksErr.message,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      roster: roster || [],
      marks: marks || [],
      attendanceBlock,
    },
    { headers: corsHeaders() }
  );
}
