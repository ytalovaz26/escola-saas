import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function corsHeaders() {
  // Para DEV local, liberamos tudo.
  // Em produção, podemos travar para seu domínio.
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: corsHeaders() }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "admin",
    "secretaria",
    "coordenador",
    "professor",
    "teacher",
  ]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const date = (url.searchParams.get("date") || "").trim(); // YYYY-MM-DD

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!date) return jsonError("date é obrigatório (YYYY-MM-DD).", 400);

  // 1) roster (alunos ativos na turma naquela data)
  const { data: roster, error: rosterErr } = await supabaseAdmin.rpc(
    "get_active_students_for_class_on_date",
    { p_class_id: classId, p_date: date }
  );

  if (rosterErr) {
    return jsonError("Falha ao buscar alunos ativos (RPC).", 500, {
      details: rosterErr.message,
    });
  }

  // 2) presenças já salvas para o dia
  const { data: marks, error: marksErr } = await supabaseAdmin
    .from("attendance")
    .select("student_id,status,note")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("date", date);

  if (marksErr) {
    return jsonError("Falha ao buscar presenças do dia.", 500, {
      details: marksErr.message,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      roster: roster || [],
      marks: marks || [],
    },
    { headers: corsHeaders() }
  );
}
