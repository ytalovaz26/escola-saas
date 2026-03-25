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
    .from("students")
    .select("id, full_name") // ✅ removido email
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Normaliza para o front não quebrar (email vira null)
  const students = (data || []).map((s: any) => ({
    id: s.id,
    full_name: s.full_name ?? null,
    email: null,
  }));

  return NextResponse.json({ ok: true, students });
}
