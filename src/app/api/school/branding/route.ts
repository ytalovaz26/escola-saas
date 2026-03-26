import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "professor",
    "teacher",
  ]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  if (!schoolId) return jsonError("schoolId não identificado (token).", 401);

  const { data: school, error } = await supabaseAdmin
    .from("schools")
    .select("id,name,logo_url,primary_color")
    .eq("id", schoolId)
    .maybeSingle();

  if (error) return jsonError("Falha ao buscar branding da escola.", 500, { details: error.message });

  return NextResponse.json({
    ok: true,
    school: {
      id: school?.id ?? schoolId,
      name: school?.name ?? null,
      logo_url: school?.logo_url ?? null,
      primary_color: school?.primary_color ?? null,
    },
  });
}
