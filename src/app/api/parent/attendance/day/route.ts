// src/app/api/parent/attendance/day/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireParent } from "@/lib/requireParent";

const ATT_TABLE = "attendance"; // <<< se sua presença estiver em outra tabela, troca aqui

export async function GET(req: Request) {
  try {
    const guard = await requireParent(req);
    if (!guard.ok) return guard.res;

    const { parentId, schoolId } = guard;

    const url = new URL(req.url);
    const studentId = url.searchParams.get("studentId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!studentId || !from || !to) {
      return NextResponse.json(
        { ok: false, error: "Missing params: studentId, from, to" },
        { status: 422 }
      );
    }

    // garante que o student pertence ao parent
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

    // busca presença no período
    const { data, error } = await supabaseAdmin
      .from(ATT_TABLE)
      .select("date,status,class_id")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}