import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaffContext =
  | {
      ok: true;
      userId: string;
      email: string | null;
      schoolId: string;
      role: string;
    }
  | {
      ok: false;
      response: NextResponse;
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

function normalizeBlockType(value: unknown) {
  const safe = cleanText(value);

  const allowed = new Set([
    "holiday",
    "recess",
    "no_class",
    "pedagogical_day",
    "exam_day",
    "event",
    "other",
  ]);

  return allowed.has(safe) ? safe : "no_class";
}

function normalizeTargetScope(value: unknown) {
  const safe = cleanText(value);

  const allowed = new Set(["all_school", "class", "shift"]);

  return allowed.has(safe) ? safe : "all_school";
}

function isStaffRole(role: string) {
  return ["diretor", "coordenador", "admin", "secretaria"].includes(role);
}

async function getStaffContext(req: Request): Promise<StaffContext> {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false,
      response: jsonError("Missing Authorization Bearer token.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false,
      response: jsonError("Sessão inválida.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: schoolUser, error: schoolUserErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (schoolUserErr) {
    return {
      ok: false,
      response: jsonError("Falha ao validar vínculo escolar: " + schoolUserErr.message, 500),
    };
  }

  if (!schoolUser?.school_id) {
    return {
      ok: false,
      response: jsonError("Usuário não vinculado a uma escola.", 403),
    };
  }

  const role = cleanText(schoolUser.role);

  if (!isStaffRole(role)) {
    return {
      ok: false,
      response: jsonError("Você não tem permissão para gerenciar o calendário escolar.", 403),
    };
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email || null,
    schoolId: String(schoolUser.school_id),
    role,
  };
}

async function assertClassBelongsToSchool(params: {
  schoolId: string;
  classId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, school_id, name, grade, shift")
    .eq("school_id", params.schoolId)
    .eq("id", params.classId)
    .maybeSingle();

  if (error) {
    throw new Error("Falha ao validar turma: " + error.message);
  }

  if (!data?.id) {
    throw new Error("Turma não encontrada nesta escola.");
  }

  return data;
}

async function loadClasses(schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, name, grade, shift")
    .eq("school_id", schoolId)
    .order("name", { ascending: true });

  if (error) return [];

  return data || [];
}

export async function GET(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const url = new URL(req.url);

    const startDate = normalizeDate(url.searchParams.get("startDate"));
    const endDate = normalizeDate(url.searchParams.get("endDate"));

    const [blocksRes, classes] = await Promise.all([
      supabaseAdmin
        .from("school_calendar_blocks")
        .select(
          `
          id,
          school_id,
          block_date,
          type,
          title,
          description,
          affects_all_classes,
          target_scope,
          class_id,
          shift,
          created_by,
          created_at,
          updated_at
        `
        )
        .eq("school_id", ctx.schoolId)
        .gte("block_date", startDate)
        .lte("block_date", endDate)
        .order("block_date", { ascending: true })
        .order("created_at", { ascending: true }),

      loadClasses(ctx.schoolId),
    ]);

    if (blocksRes.error) {
      return jsonError(
        "Falha ao buscar bloqueios do calendário: " + blocksRes.error.message,
        500
      );
    }

    return jsonOk({
      blocks: blocksRes.data || [],
      classes,
      meta: {
        schoolId: ctx.schoolId,
        startDate,
        endDate,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao buscar bloqueios.", 500);
  }
}

export async function POST(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json().catch(() => ({}));

    const blockDate = normalizeDate(body.blockDate || body.block_date);
    const type = normalizeBlockType(body.type);
    const title = cleanText(body.title);
    const description = cleanText(body.description) || null;

    const targetScope = normalizeTargetScope(
      body.targetScope || body.target_scope
    );

    const rawClassId = cleanText(body.classId || body.class_id);
    const rawShift = cleanText(body.shift);

    let classId: string | null = null;
    let shift: string | null = null;
    let affectsAllClasses = true;

    if (!title) {
      return jsonError("Informe o título do bloqueio.", 400);
    }

    if (targetScope === "class") {
      if (!rawClassId) {
        return jsonError("Selecione a turma para bloquear.", 400);
      }

      await assertClassBelongsToSchool({
        schoolId: ctx.schoolId,
        classId: rawClassId,
      });

      classId = rawClassId;
      shift = null;
      affectsAllClasses = false;
    }

    if (targetScope === "shift") {
      if (!rawShift) {
        return jsonError("Selecione o período/turno para bloquear.", 400);
      }

      classId = null;
      shift = rawShift;
      affectsAllClasses = false;
    }

    if (targetScope === "all_school") {
      classId = null;
      shift = null;
      affectsAllClasses = true;
    }

    const { data, error } = await supabaseAdmin
      .from("school_calendar_blocks")
      .insert({
        school_id: ctx.schoolId,
        block_date: blockDate,
        type,
        title,
        description,
        affects_all_classes: affectsAllClasses,
        target_scope: targetScope,
        class_id: classId,
        shift,
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .select(
        `
        id,
        school_id,
        block_date,
        type,
        title,
        description,
        affects_all_classes,
        target_scope,
        class_id,
        shift,
        created_by,
        created_at,
        updated_at
      `
      )
      .single();

    if (error) {
      return jsonError("Falha ao cadastrar bloqueio: " + error.message, 500);
    }

    return jsonOk({ block: data }, 201);
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao cadastrar bloqueio.", 500);
  }
}

export async function DELETE(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const url = new URL(req.url);
    const id = cleanText(url.searchParams.get("id"));

    if (!id) {
      return jsonError("Informe o ID do bloqueio para remover.", 400);
    }

    const { error } = await supabaseAdmin
      .from("school_calendar_blocks")
      .delete()
      .eq("school_id", ctx.schoolId)
      .eq("id", id);

    if (error) {
      return jsonError("Falha ao remover bloqueio: " + error.message, 500);
    }

    return jsonOk({
      deleted: true,
      id,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao remover bloqueio.", 500);
  }
}