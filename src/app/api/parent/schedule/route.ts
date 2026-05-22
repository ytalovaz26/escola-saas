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

type ParentCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  date: string;
  createdAt: string | null;
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

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value: unknown) {
  const safe = cleanText(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe;

  return todayISO();
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

  const events: ParentCalendarEvent[] = (data || []).map((ev: any) => ({
    id: String(ev.id),
    title: cleanText(ev.title) || "Evento escolar",
    description: cleanText(ev.description) || null,
    date: normalizeDate(ev.event_date),
    createdAt: ev.created_at || null,
  }));

  return events;
}

export async function GET(req: Request) {
  const ctx = await getParentContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const [children, events] = await Promise.all([
      loadChildren({
        schoolId: ctx.schoolId,
        parentId: ctx.parentId,
      }),
      loadSchoolEvents({
        schoolId: ctx.schoolId,
      }),
    ]);

    return jsonOk({
      parent: {
        parentId: ctx.parentId,
        name: ctx.parentName,
        email: ctx.user.email || null,
      },
      schoolId: ctx.schoolId,
      children,
      events,
      summary: {
        total: events.length,
        children: children.length,
      },
      meta: {
        source: "parent_calendar_school_events",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar agenda.", 500);
  }
}