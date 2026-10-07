import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AcademicSettingsPayload = {
  academicYear?: number;
  periodsCount?: number;
  minimumPassingGrade?: number;
  minimumAttendancePercentage?: number;
  gradingScaleMax?: number;
  isActive?: boolean;
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

function normalizeNumber(value: unknown): number | null {
  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function serializeSettings(row: any) {
  return {
    id: row.id,
    schoolId: row.school_id,
    academicYear: row.academic_year,
    periodsCount: row.periods_count,
    minimumPassingGrade: Number(row.minimum_passing_grade),
    minimumAttendancePercentage: Number(
      row.minimum_attendance_percentage
    ),
    gradingScaleMax: Number(row.grading_scale_max),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authorize(req: Request) {
  return requireStaff(req, [
    "diretor",
    "director",
    "admin",
    "secretaria",
    "coordenador",
    "coordinator",
  ]);
}

export async function GET(req: Request) {
  const guard = await authorize(req);

  if (!guard.ok) {
    return guard.res;
  }

  const schoolId = (guard as any).schoolId as string;

  if (!schoolId) {
    return jsonError(
      "Escola não identificada no token.",
      401
    );
  }

  const url = new URL(req.url);

  const requestedYearRaw = url.searchParams.get("academicYear");

  let academicYear: number;

  if (requestedYearRaw) {
    const parsedYear = Number(requestedYearRaw);

    if (
      !Number.isInteger(parsedYear) ||
      parsedYear < 2000 ||
      parsedYear > 2200
    ) {
      return jsonError(
        "academicYear inválido.",
        400
      );
    }

    academicYear = parsedYear;
  } else {
    academicYear = currentYear();
  }

  const { data, error } = await supabaseAdmin
    .from("school_academic_settings")
    .select(
      `
      id,
      school_id,
      academic_year,
      periods_count,
      minimum_passing_grade,
      minimum_attendance_percentage,
      grading_scale_max,
      is_active,
      created_at,
      updated_at
      `
    )
    .eq("school_id", schoolId)
    .eq("academic_year", academicYear)
    .maybeSingle();

  if (error) {
    return jsonError(
      "Falha ao buscar configuração acadêmica.",
      500,
      {
        details: error.message,
      }
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        ok: true,
        exists: false,
        academicYear,
        settings: null,
        defaults: {
          academicYear,
          periodsCount: 4,
          minimumPassingGrade: 6,
          minimumAttendancePercentage: 75,
          gradingScaleMax: 10,
          isActive: true,
        },
      },
      {
        headers: corsHeaders(),
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      exists: true,
      academicYear,
      settings: serializeSettings(data),
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

  const schoolId = (guard as any).schoolId as string;

  if (!schoolId) {
    return jsonError(
      "Escola não identificada no token.",
      401
    );
  }

  let body: AcademicSettingsPayload;

  try {
    body = (await req.json()) as AcademicSettingsPayload;
  } catch {
    return jsonError(
      "Body inválido (JSON).",
      400
    );
  }

  const academicYear = normalizeNumber(body?.academicYear);

  const periodsCount =
    body?.periodsCount === undefined
      ? 4
      : normalizeNumber(body.periodsCount);

  const minimumPassingGrade =
    body?.minimumPassingGrade === undefined
      ? 6
      : normalizeNumber(body.minimumPassingGrade);

  const minimumAttendancePercentage =
    body?.minimumAttendancePercentage === undefined
      ? 75
      : normalizeNumber(body.minimumAttendancePercentage);

  const gradingScaleMax =
    body?.gradingScaleMax === undefined
      ? 10
      : normalizeNumber(body.gradingScaleMax);

  const isActive =
    typeof body?.isActive === "boolean"
      ? body.isActive
      : true;

  if (
    academicYear === null ||
    !Number.isInteger(academicYear) ||
    academicYear < 2000 ||
    academicYear > 2200
  ) {
    return jsonError(
      "academicYear é obrigatório e deve ser um ano válido.",
      400
    );
  }

  if (
    periodsCount === null ||
    !Number.isInteger(periodsCount) ||
    periodsCount < 1 ||
    periodsCount > 12
  ) {
    return jsonError(
      "periodsCount deve ser um número inteiro entre 1 e 12.",
      400
    );
  }

  if (
    gradingScaleMax === null ||
    gradingScaleMax <= 0
  ) {
    return jsonError(
      "gradingScaleMax deve ser maior que zero.",
      400
    );
  }

  if (
    minimumPassingGrade === null ||
    minimumPassingGrade < 0 ||
    minimumPassingGrade > gradingScaleMax
  ) {
    return jsonError(
      "minimumPassingGrade deve estar entre 0 e gradingScaleMax.",
      400
    );
  }

  if (
    minimumAttendancePercentage === null ||
    minimumAttendancePercentage < 0 ||
    minimumAttendancePercentage > 100
  ) {
    return jsonError(
      "minimumAttendancePercentage deve estar entre 0 e 100.",
      400
    );
  }

  const now = new Date().toISOString();

  const row = {
    school_id: schoolId,
    academic_year: academicYear,
    periods_count: periodsCount,
    minimum_passing_grade: minimumPassingGrade,
    minimum_attendance_percentage:
      minimumAttendancePercentage,
    grading_scale_max: gradingScaleMax,
    is_active: isActive,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .from("school_academic_settings")
    .upsert(row, {
      onConflict: "school_id,academic_year",
    })
    .select(
      `
      id,
      school_id,
      academic_year,
      periods_count,
      minimum_passing_grade,
      minimum_attendance_percentage,
      grading_scale_max,
      is_active,
      created_at,
      updated_at
      `
    )
    .single();

  if (error) {
    return jsonError(
      "Falha ao salvar configuração acadêmica.",
      500,
      {
        details: error.message,
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      createdOrUpdated: true,
      settings: serializeSettings(data),
    },
    {
      headers: corsHeaders(),
    }
  );
}