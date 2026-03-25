import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function isISODate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function toMonthKey(dateISO: string) {
  // YYYY-MM
  return dateISO.slice(0, 7);
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "professor",
    "teacher",
    "coordenador",
    "coordinator",
    "diretor",
    "director",
    "admin",
  ]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  const teacherUserId =
    (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();

  if (!teacherUserId) return jsonError("Professor não identificado (token).", 401);
  if (!schoolId) return jsonError("schoolId não identificado (token).", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!from || !to) return jsonError("from e to são obrigatórios (YYYY-MM-DD).", 400);
  if (!isISODate(from) || !isISODate(to)) return jsonError("Datas inválidas. Use YYYY-MM-DD.", 400);

  // vínculo professor-turma
  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .limit(1);

  if (linkErr) {
    return jsonError("Erro ao validar vínculo professor-turma.", 500, { details: linkErr.message });
  }
  if (!link || link.length === 0) return jsonError("Professor não está vinculado a esta turma.", 403);

  const { data: rows, error } = await supabaseAdmin
    .from("attendance")
    .select("date,status")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .gte("date", from)
    .lte("date", to);

  if (error) return jsonError("Falha ao buscar histórico mensal.", 500, { details: error.message });

  const map: Record<
    string,
    { month: string; present: number; absent: number; total: number; daysWithAttendance: Set<string> }
  > = {};

  for (const r of rows || []) {
    const d = String((r as any).date || "").slice(0, 10);
    if (!d) continue;

    const month = toMonthKey(d);
    if (!map[month]) {
      map[month] = { month, present: 0, absent: 0, total: 0, daysWithAttendance: new Set<string>() };
    }

    const st = String((r as any).status || "");
    if (st === "present") map[month].present += 1;
    else if (st === "absent") map[month].absent += 1;

    map[month].total += 1;
    map[month].daysWithAttendance.add(d);
  }

  const monthly = Object.values(map)
    .map((x) => ({
      month: x.month,
      present: x.present,
      absent: x.absent,
      total: x.total,
      daysWithAttendance: x.daysWithAttendance.size,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  return NextResponse.json(
    {
      ok: true,
      classId,
      from,
      to,
      monthly,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
