import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AcademicPeriodInput = {
  id?: string;
  periodNumber?: number;
  name?: string;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
};

type SavePeriodsPayload = {
  academicYear?: number;
  periods?: AcademicPeriodInput[];
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

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      ...extra,
    },
    {
      status,
      headers: corsHeaders(),
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function currentYear() {
  return new Date().getFullYear();
}

function isValidYear(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 2000 &&
    value <= 2200
  );
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearRaw, monthRaw, dayRaw] = value.split("-");

  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function serializePeriod(row: any) {
  return {
    id: row.id,
    schoolId: row.school_id,
    academicYear: row.academic_year,
    periodNumber: row.period_number,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authorize(req: Request) {
  return requireStaff(req, [
    "diretor",
    "coordenador",
    "admin",
  ]);
}

function validateNoOverlap(
  periods: Array<{
    periodNumber: number;
    name: string;
    startDate: string;
    endDate: string;
  }>
) {
  const ordered = [...periods].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];

    if (current.startDate <= previous.endDate) {
      return {
        ok: false as const,
        message:
          `Os períodos "${previous.name}" e "${current.name}" possuem datas sobrepostas.`,
      };
    }
  }

  return { ok: true as const };
}

export async function GET(req: Request) {
  const guard = await authorize(req);

  if (!guard.ok) {
    return guard.res;
  }

  const schoolId = guard.schoolId;

  if (!schoolId) {
    return jsonError("Escola não identificada no token.", 401);
  }

  const url = new URL(req.url);
  const requestedYearRaw = url.searchParams.get("academicYear");

  let academicYear = currentYear();

  if (requestedYearRaw) {
    const parsed = Number(requestedYearRaw);

    if (!isValidYear(parsed)) {
      return jsonError("academicYear inválido.", 400);
    }

    academicYear = parsed;
  }

  const { data, error } = await supabaseAdmin
    .from("school_academic_periods")
    .select(
      `
      id,
      school_id,
      academic_year,
      period_number,
      name,
      start_date,
      end_date,
      is_active,
      created_at,
      updated_at
      `
    )
    .eq("school_id", schoolId)
    .eq("academic_year", academicYear)
    .order("period_number", { ascending: true });

  if (error) {
    return jsonError(
      "Falha ao buscar períodos acadêmicos.",
      500,
      { details: error.message }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      academicYear,
      periods: (data || []).map(serializePeriod),
    },
    {
      headers: corsHeaders(),
    }
  );
}

export async function POST(req: Request) {
  const guard = await authorize(req);

  if (!guard.ok) {
    return guard.res;
  }

  const schoolId = guard.schoolId;

  if (!schoolId) {
    return jsonError("Escola não identificada no token.", 401);
  }

  let body: SavePeriodsPayload;

  try {
    body = (await req.json()) as SavePeriodsPayload;
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const academicYear = Number(body?.academicYear);

  if (!isValidYear(academicYear)) {
    return jsonError(
      "academicYear é obrigatório e deve ser um ano válido.",
      400
    );
  }

  if (!Array.isArray(body?.periods)) {
    return jsonError(
      "periods deve ser uma lista de períodos acadêmicos.",
      400
    );
  }

  const { data: settings, error: settingsError } =
    await supabaseAdmin
      .from("school_academic_settings")
      .select("periods_count")
      .eq("school_id", schoolId)
      .eq("academic_year", academicYear)
      .maybeSingle();

  if (settingsError) {
    return jsonError(
      "Falha ao consultar as configurações acadêmicas.",
      500,
      { details: settingsError.message }
    );
  }

  if (!settings) {
    return jsonError(
      "Salve primeiro as configurações acadêmicas deste ano letivo.",
      409
    );
  }

  const expectedPeriodsCount = Number(settings.periods_count);

  if (body.periods.length !== expectedPeriodsCount) {
    return jsonError(
      `Este ano letivo está configurado para ${expectedPeriodsCount} período(s), mas foram enviados ${body.periods.length}.`,
      400
    );
  }

  const normalizedPeriods: Array<{
    periodNumber: number;
    name: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
  }> = [];

  const periodNumbers = new Set<number>();

  for (const rawPeriod of body.periods) {
    const periodNumber = Number(rawPeriod?.periodNumber);
    const name = String(rawPeriod?.name || "").trim();
    const startDate = String(rawPeriod?.startDate || "").trim();
    const endDate = String(rawPeriod?.endDate || "").trim();

    const isActive =
      typeof rawPeriod?.isActive === "boolean"
        ? rawPeriod.isActive
        : true;

    if (
      !Number.isInteger(periodNumber) ||
      periodNumber < 1 ||
      periodNumber > 12
    ) {
      return jsonError(
        "Cada periodNumber deve ser um número inteiro entre 1 e 12.",
        400
      );
    }

    if (periodNumbers.has(periodNumber)) {
      return jsonError(
        `O período de número ${periodNumber} foi informado mais de uma vez.`,
        400
      );
    }

    periodNumbers.add(periodNumber);

    if (!name) {
      return jsonError(
        `Informe o nome do período ${periodNumber}.`,
        400
      );
    }

    if (name.length > 100) {
      return jsonError(
        `O nome do período ${periodNumber} é muito longo.`,
        400
      );
    }

    if (!isValidDateString(startDate)) {
      return jsonError(
        `A data inicial do período "${name}" é inválida.`,
        400
      );
    }

    if (!isValidDateString(endDate)) {
      return jsonError(
        `A data final do período "${name}" é inválida.`,
        400
      );
    }

    if (endDate < startDate) {
      return jsonError(
        `A data final do período "${name}" não pode ser anterior à data inicial.`,
        400
      );
    }

    normalizedPeriods.push({
      periodNumber,
      name,
      startDate,
      endDate,
      isActive,
    });
  }

  for (
    let periodNumber = 1;
    periodNumber <= expectedPeriodsCount;
    periodNumber += 1
  ) {
    if (!periodNumbers.has(periodNumber)) {
      return jsonError(
        `Está faltando o período de número ${periodNumber}.`,
        400
      );
    }
  }

  const overlapValidation = validateNoOverlap(normalizedPeriods);

  if (!overlapValidation.ok) {
    return jsonError(overlapValidation.message, 400);
  }

  const now = new Date().toISOString();

  const rows = normalizedPeriods.map((period) => ({
    school_id: schoolId,
    academic_year: academicYear,
    period_number: period.periodNumber,
    name: period.name,
    start_date: period.startDate,
    end_date: period.endDate,
    is_active: period.isActive,
    updated_at: now,
  }));

  const { data: savedPeriods, error: saveError } =
    await supabaseAdmin
      .from("school_academic_periods")
      .upsert(rows, {
        onConflict: "school_id,academic_year,period_number",
      })
      .select(
        `
        id,
        school_id,
        academic_year,
        period_number,
        name,
        start_date,
        end_date,
        is_active,
        created_at,
        updated_at
        `
      );

  if (saveError) {
    return jsonError(
      "Falha ao salvar os períodos acadêmicos.",
      500,
      { details: saveError.message }
    );
  }

  const savedNumbers = new Set(
    normalizedPeriods.map((period) => period.periodNumber)
  );

  const { data: existingRows, error: existingRowsError } =
    await supabaseAdmin
      .from("school_academic_periods")
      .select("id, period_number")
      .eq("school_id", schoolId)
      .eq("academic_year", academicYear);

  if (existingRowsError) {
    return jsonError(
      "Os períodos foram salvos, mas houve falha ao verificar períodos antigos.",
      500,
      { details: existingRowsError.message }
    );
  }

  const obsoleteIds = (existingRows || [])
    .filter(
      (row: any) =>
        !savedNumbers.has(Number(row.period_number))
    )
    .map((row: any) => row.id);

  if (obsoleteIds.length > 0) {
    const { error: deactivateError } = await supabaseAdmin
      .from("school_academic_periods")
      .update({
        is_active: false,
        updated_at: now,
      })
      .eq("school_id", schoolId)
      .eq("academic_year", academicYear)
      .in("id", obsoleteIds);

    if (deactivateError) {
      return jsonError(
        "Os períodos principais foram salvos, mas houve falha ao inativar períodos antigos.",
        500,
        { details: deactivateError.message }
      );
    }
  }

  const orderedSavedPeriods = (savedPeriods || [])
    .map(serializePeriod)
    .sort(
      (a: { periodNumber: number }, b: { periodNumber: number }) =>
        a.periodNumber - b.periodNumber
    );

  return NextResponse.json(
    {
      ok: true,
      createdOrUpdated: true,
      academicYear,
      periods: orderedSavedPeriods,
    },
    {
      headers: corsHeaders(),
    }
  );
}