import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
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

  const url = new URL(req.url);
  const classId = normalizeText(url.searchParams.get("classId"));

  if (!classId) {
    return jsonError("classId é obrigatório.", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("student_classes")
    .select(`
      student_id,
      students!inner (
        id,
        full_name,
        registration_number
      )
    `)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (error) {
    return jsonError("Falha ao listar alunos da turma.", 500, {
      details: error.message,
    });
  }

  const items = (data || [])
    .map((row: any) => ({
      id: String(row?.student_id || row?.students?.id || "").trim(),
      full_name: row?.students?.full_name ?? null,
      registration_number: row?.students?.registration_number ?? null,
    }))
    .filter((row) => row.id)
    .sort((a, b) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
    );

  return NextResponse.json({
    ok: true,
    students: items,
  });
}