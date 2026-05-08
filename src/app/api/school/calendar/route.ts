// src/app/api/school/calendar/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function jsonFail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeDateOnly(value: unknown) {
  const raw = cleanText(value);

  if (!raw) return "";

  const clean = raw.slice(0, 10);
  const parts = clean.split("-");

  if (parts.length !== 3) return "";

  const [y, m, d] = parts;

  if (!y || !m || !d) return "";
  if (y.length !== 4 || m.length !== 2 || d.length !== 2) return "";

  return `${y}-${m}-${d}`;
}

async function getGuard(req: Request) {
  return await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);
}

export async function GET(req: Request) {
  const guard = await getGuard(req);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonFail(401, "Escola não identificada.");
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 200;

    const { data, error } = await supabaseAdmin
      .from("calendar_events")
      .select("id,school_id,title,description,event_date,created_at")
      .eq("school_id", schoolId)
      .order("event_date", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return jsonFail(500, "Erro ao carregar agenda: " + error.message);
    }

    return jsonOk({
      events: data || [],
    });
  } catch (err: any) {
    console.error("[GET /api/school/calendar]", err);
    return jsonFail(500, err?.message || "Erro interno ao carregar agenda.");
  }
}

export async function POST(req: Request) {
  const guard = await getGuard(req);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonFail(401, "Escola não identificada.");
    }

    const body = await req.json().catch(() => null);

    const title = cleanText(body?.title);
    const description = cleanText(body?.description) || null;
    const eventDate = normalizeDateOnly(body?.eventDate || body?.event_date);

    if (!title) {
      return jsonFail(400, "Informe o título do evento.");
    }

    if (!eventDate) {
      return jsonFail(400, "Informe uma data válida para o evento.");
    }

    const { data, error } = await supabaseAdmin
      .from("calendar_events")
      .insert({
        school_id: schoolId,
        title,
        description,
        event_date: eventDate,
      })
      .select("id,school_id,title,description,event_date,created_at")
      .single();

    if (error) {
      return jsonFail(500, "Erro ao criar evento: " + error.message);
    }

    return jsonOk(
      {
        event: data,
      },
      201
    );
  } catch (err: any) {
    console.error("[POST /api/school/calendar]", err);
    return jsonFail(500, err?.message || "Erro interno ao criar evento.");
  }
}

export async function PATCH(req: Request) {
  const guard = await getGuard(req);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonFail(401, "Escola não identificada.");
    }

    const body = await req.json().catch(() => null);

    const id = cleanText(body?.id);
    const title = cleanText(body?.title);
    const description = cleanText(body?.description) || null;
    const eventDate = normalizeDateOnly(body?.eventDate || body?.event_date);

    if (!id) {
      return jsonFail(400, "ID do evento é obrigatório.");
    }

    if (!title) {
      return jsonFail(400, "Informe o título do evento.");
    }

    if (!eventDate) {
      return jsonFail(400, "Informe uma data válida para o evento.");
    }

    const { data, error } = await supabaseAdmin
      .from("calendar_events")
      .update({
        title,
        description,
        event_date: eventDate,
      })
      .eq("id", id)
      .eq("school_id", schoolId)
      .select("id,school_id,title,description,event_date,created_at")
      .maybeSingle();

    if (error) {
      return jsonFail(500, "Erro ao atualizar evento: " + error.message);
    }

    if (!data?.id) {
      return jsonFail(404, "Evento não encontrado.");
    }

    return jsonOk({
      event: data,
    });
  } catch (err: any) {
    console.error("[PATCH /api/school/calendar]", err);
    return jsonFail(500, err?.message || "Erro interno ao atualizar evento.");
  }
}

export async function DELETE(req: Request) {
  const guard = await getGuard(req);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = guard.schoolId;

    if (!schoolId) {
      return jsonFail(401, "Escola não identificada.");
    }

    const url = new URL(req.url);
    const idFromUrl = cleanText(url.searchParams.get("id"));

    let id = idFromUrl;

    if (!id) {
      const body = await req.json().catch(() => null);
      id = cleanText(body?.id);
    }

    if (!id) {
      return jsonFail(400, "ID do evento é obrigatório.");
    }

    const { error } = await supabaseAdmin
      .from("calendar_events")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId);

    if (error) {
      return jsonFail(500, "Erro ao excluir evento: " + error.message);
    }

    return jsonOk({
      deleted: true,
      id,
    });
  } catch (err: any) {
    console.error("[DELETE /api/school/calendar]", err);
    return jsonFail(500, err?.message || "Erro interno ao excluir evento.");
  }
}