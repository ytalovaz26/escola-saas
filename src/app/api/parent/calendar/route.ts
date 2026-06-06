import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentChild = {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  relationship: string | null;
};

type ParentCalendarItem = {
  id: string;
  source: "calendar_event" | "calendar_block";
  type: string;
  typeLabel: string;
  title: string;
  description: string | null;
  date: string;
  createdAt: string | null;
  targetScope?: string | null;
  classId?: string | null;
  shift?: string | null;
  affectsAllClasses?: boolean | null;
};

function jsonOk(body: Record<string, any> = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
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

function normalizeDate(value: unknown) {
  const safe = cleanText(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe;

  return new Date().toISOString().slice(0, 10);
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
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

async function getParentContext(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false as const,
      response: jsonError("Missing Authorization Bearer token.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: jsonError("Sessão inválida.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      response: jsonError("Falha ao buscar responsável: " + parentErr.message, 500),
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Você não está cadastrado como responsável.", 403),
    };
  }

  return {
    ok: true as const,
    user,
    parentId: String(parent.id),
    schoolId: String(parent.school_id),
    parentName: cleanText(parent.full_name) || user.email || "Responsável",
  };
}

async function loadChildren(params: {
  schoolId: string;
  parentId: string;
}) {
  const { data: links, error: linksErr } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, relationship, is_active")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("is_active", true);

  if (linksErr) {
    throw new Error("Falha ao buscar vínculos dos filhos: " + linksErr.message);
  }

  const studentIds = Array.from(
    new Set((links || []).map((row: any) => cleanText(row.student_id)).filter(Boolean))
  );

  if (studentIds.length === 0) return [];

  const relationshipByStudent = new Map<string, string | null>();

  for (const link of links || []) {
    relationshipByStudent.set(
      String(link.student_id),
      cleanText((link as any).relationship) || null
    );
  }

  const { data: students, error: studentsErr } = await supabaseAdmin
    .from("students")
    .select("id, school_id, full_name, registration_number")
    .eq("school_id", params.schoolId)
    .in("id", studentIds);

  if (studentsErr) {
    throw new Error("Falha ao buscar filhos: " + studentsErr.message);
  }

  const children: ParentChild[] = (students || [])
    .map((student: any) => ({
      id: String(student.id),
      fullName: cleanText(student.full_name) || "Aluno",
      registrationNumber: student.registration_number ?? null,
      relationship: relationshipByStudent.get(String(student.id)) ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));

  return children;
}

async function loadSchoolEvents(params: {
  schoolId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select("id, school_id, title, description, event_date, created_at")
    .eq("school_id", params.schoolId)
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Falha ao buscar eventos da escola: " + error.message);
  }

  const events: ParentCalendarItem[] = (data || []).map((ev: any) => ({
    id: `event-${String(ev.id)}`,
    source: "calendar_event",
    type: "event",
    typeLabel: "Evento escolar",
    title: cleanText(ev.title) || "Evento escolar",
    description: cleanText(ev.description) || null,
    date: normalizeDate(ev.event_date),
    createdAt: ev.created_at || null,
  }));

  return events;
}

async function loadSchoolCalendarBlocks(params: {
  schoolId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("school_calendar_blocks")
    .select(
      `
      id,
      school_id,
      block_date,
      type,
      title,
      description,
      target_scope,
      class_id,
      shift,
      affects_all_classes,
      created_at
    `
    )
    .eq("school_id", params.schoolId)
    .order("block_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Falha ao buscar dias sem aula: " + error.message);
  }

  const blocks: ParentCalendarItem[] = (data || []).map((block: any) => ({
    id: `block-${String(block.id)}`,
    source: "calendar_block",
    type: cleanText(block.type) || "no_class",
    typeLabel: blockTypeLabel(cleanText(block.type)),
    title: cleanText(block.title) || blockTypeLabel(cleanText(block.type)),
    description:
      cleanText(block.description) ||
      "A escola informou alteração no calendário escolar para esta data.",
    date: normalizeDate(block.block_date),
    createdAt: block.created_at || null,
    targetScope: cleanText(block.target_scope) || null,
    classId: cleanText(block.class_id) || null,
    shift: cleanText(block.shift) || null,
    affectsAllClasses: block.affects_all_classes === true,
  }));

  return blocks;
}

function sortItemsAsc(a: ParentCalendarItem, b: ParentCalendarItem) {
  const byDate = String(a.date).localeCompare(String(b.date));
  if (byDate !== 0) return byDate;

  const priorityA = a.source === "calendar_block" ? 0 : 1;
  const priorityB = b.source === "calendar_block" ? 0 : 1;

  return priorityA - priorityB;
}

export async function GET(req: Request) {
  const ctx = await getParentContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const [children, schoolEvents, calendarBlocks] = await Promise.all([
      loadChildren({
        schoolId: ctx.schoolId,
        parentId: ctx.parentId,
      }),
      loadSchoolEvents({
        schoolId: ctx.schoolId,
      }),
      loadSchoolCalendarBlocks({
        schoolId: ctx.schoolId,
      }),
    ]);

    const items = [...schoolEvents, ...calendarBlocks].sort(sortItemsAsc);

    return jsonOk({
      parent: {
        parentId: ctx.parentId,
        name: ctx.parentName,
        email: ctx.user.email || null,
      },
      schoolId: ctx.schoolId,
      children,
      events: schoolEvents,
      calendarBlocks,
      items,
      summary: {
        total: items.length,
        events: schoolEvents.length,
        calendarBlocks: calendarBlocks.length,
        children: children.length,
      },
      meta: {
        source: "parent_calendar_events_and_blocks_v1",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar agenda.", 500);
  }
}