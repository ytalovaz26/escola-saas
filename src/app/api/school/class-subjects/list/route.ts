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

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();

  if (!classId) {
    return jsonError("classId é obrigatório.", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("class_subjects")
    .select(`
      id,
      class_id,
      subject_id,
      subjects!inner (
        id,
        name
      )
    `)
    .eq("school_id", schoolId)
    .eq("class_id", classId);

  if (error) {
    return jsonError("Falha ao listar disciplinas da turma.", 500, {
      details: error.message,
    });
  }

  const items = (data || []).map((row: any) => ({
    id: String(row.id),
    class_id: String(row.class_id),
    subject_id: String(row.subject_id),
    subject_name: row?.subjects?.name ?? null,
  }));

  items.sort((a, b) =>
    String(a.subject_name || "").localeCompare(String(b.subject_name || ""), "pt-BR")
  );

  return NextResponse.json({
    ok: true,
    items,
  });
}