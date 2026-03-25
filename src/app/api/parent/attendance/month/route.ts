// src/app/api/parent/attendance/month/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireParent } from "@/lib/requireParent";

const ATT_TABLE = "attendance"; // <<< ajuste se necessário

function monthBounds(month: string) {
  // month: YYYY-MM
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return null;

  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const toExclusive = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { from, toExclusive };
}

export async function GET(req: Request) {
  try {
    const guard = await requireParent(req);
    if (!guard.ok) return guard.res;

    const { parentId, schoolId } = guard;

    const url = new URL(req.url);
    const studentId = url.searchParams.get("studentId");
    const month = url.searchParams.get("month"); // YYYY-MM

    if (!studentId || !month) {
      return NextResponse.json({ ok: false, error: "Missing params: studentId, month" }, { status: 422 });
    }

    const bounds = monthBounds(month);
    if (!bounds) return NextResponse.json({ ok: false, error: "Invalid month format. Use YYYY-MM" }, { status: 422 });

    // garante vínculo parent->student
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("student_parents")
      .select("id")
      .eq("school_id", schoolId)
      .eq("parent_id", parentId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle();

    if (linkErr) return NextResponse.json({ ok: false, error: linkErr.message }, { status: 500 });
    if (!link?.id) return NextResponse.json({ ok: false, error: "Forbidden: student not linked to parent" }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from(ATT_TABLE)
      .select("date,status")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .gte("date", bounds.from)
      .lt("date", bounds.toExclusive)
      .order("date", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row?.date) map[String(row.date)] = String(row.status ?? "");
    }

    return NextResponse.json({ ok: true, month, map });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}