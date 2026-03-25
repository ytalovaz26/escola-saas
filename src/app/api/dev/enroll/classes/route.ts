import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

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

  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, name, grade, shift")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, classes: data || [] });
}
