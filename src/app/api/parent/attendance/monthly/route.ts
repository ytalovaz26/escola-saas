import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test(s);
}

function monthRange(month: string) {
  // month: YYYY-MM -> [startYMD, endYMDExclusive]
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  return { startYMD: ymd(start), endYMD: ymd(end) };
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get("studentId") || "";
    const month = searchParams.get("month") || "";

    if (!studentId) return jsonError("Missing studentId.", 400);
    if (!month || !isMonthKey(month)) return jsonError("Invalid month. Use YYYY-MM.", 400);

    // 1) valida sessão
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid token/session.", 401);

    const userId = userData.user.id;

    // 2) descobre parent vinculado ao user
    const { data: parent, error: pErr } = await supabaseAdmin
      .from("parents")
      .select("id, school_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) return jsonError("parents lookup failed: " + pErr.message, 500);
    if (!parent?.id) return jsonError("Not a parent.", 403);

    // 3) verifica se o parent pode ver esse aluno (vínculo)
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("student_parents")
      .select("student_id, parent_id")
      .eq("parent_id", parent.id)
      .eq("student_id", studentId)
      .maybeSingle();

    if (linkErr) return jsonError("student_parents lookup failed: " + linkErr.message, 500);
    if (!link?.student_id) return jsonError("You don't have permission to view this student.", 403);

    // 4) busca dados do aluno (sem depender de enrollment_number vs registration_number)
    //    -> pega só o que temos certeza que existe: id e full_name
    const { data: st, error: stErr } = await supabaseAdmin
      .from("students")
      .select("id, full_name, school_id")
      .eq("id", studentId)
      .maybeSingle();

    if (stErr) return jsonError("students lookup failed: " + stErr.message, 500);
    if (!st?.id) return jsonError("Student not found.", 404);

    const schoolId = st.school_id || parent.school_id || null;

    const { startYMD, endYMD } = monthRange(month);

    // 5) sessões do mês (ideal filtrar por school_id se existir/for relevante)
    //    Se sua tabela attendance_sessions tiver school_id, isso evita puxar sessões de outras escolas.
    let sessions: Array<{ id: string; lesson_date: string; lesson_number: number | null }> = [];

    // tenta com school_id
    if (schoolId) {
      const { data: s1, error: s1Err } = await supabaseAdmin
        .from("attendance_sessions")
        .select("id, lesson_date, lesson_number")
        .eq("school_id", schoolId)
        .gte("lesson_date", startYMD)
        .lt("lesson_date", endYMD)
        .order("lesson_date", { ascending: true });

      if (!s1Err) sessions = (s1 || []) as any;
      // se der erro por coluna inexistente, cai no fallback abaixo
    }

    if (sessions.length === 0) {
      const { data: s2, error: s2Err } = await supabaseAdmin
        .from("attendance_sessions")
        .select("id, lesson_date, lesson_number")
        .gte("lesson_date", startYMD)
        .lt("lesson_date", endYMD)
        .order("lesson_date", { ascending: true });

      if (s2Err) return jsonError("attendance_sessions lookup failed: " + s2Err.message, 500);
      sessions = (s2 || []) as any;
    }

    const sessionIds = sessions.map((x) => x.id);

    // 6) records do aluno para essas sessões
    let records: Array<{ session_id: string; status: string }> = [];
    if (sessionIds.length > 0) {
      const { data: r, error: rErr } = await supabaseAdmin
        .from("attendance_records")
        .select("session_id, status")
        .eq("student_id", studentId)
        .in("session_id", sessionIds);

      if (rErr) return jsonError("attendance_records lookup failed: " + rErr.message, 500);
      records = (r || []) as any;
    }

    return NextResponse.json({
      ok: true,
      student: {
        id: st.id,
        full_name: st.full_name ?? null,
      },
      month,
      range: { startYMD, endYMD },
      sessions,
      records,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/parent/attendance/monthly", 500);
  }
}