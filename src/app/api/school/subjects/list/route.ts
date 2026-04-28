import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "admin",
    "secretaria",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;

  const { data, error } = await supabaseAdmin
    .from("subjects")
    .select("id, school_id, name, created_at")
    .eq("school_id", schoolId)
    .order("name", { ascending: true });

  if (error) {
    return jsonError("Falha ao listar disciplinas.", 500, {
      details: error.message,
    });
  }

  return NextResponse.json({
    ok: true,
    subjects: data || [],
  });
}