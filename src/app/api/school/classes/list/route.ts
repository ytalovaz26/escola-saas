// src/app/api/school/classes/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status: number, details?: any) {
  return NextResponse.json(
    { ok: false, error: message, details: details ?? null },
    { status }
  );
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "secretaria",
    "secretary",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const { data: classes, error } = await supabaseAdmin
      .from("classes")
      .select("id, school_id, name, grade, shift, created_at")
      .eq("school_id", guard.schoolId)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError("Falha ao listar turmas.", 500, error.message);
    }

    return NextResponse.json({
      ok: true,
      classes: classes ?? [],
    });
  } catch (e: any) {
    return jsonError(
      e?.message || "Internal error in /api/school/classes/list",
      500
    );
  }
}