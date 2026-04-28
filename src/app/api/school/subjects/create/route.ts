import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type Payload = {
  name?: string;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeName(value: unknown) {
  return String(value || "").trim();
}

export async function POST(req: Request) {
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

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const name = normalizeName(body?.name);

  if (!name) {
    return jsonError("name é obrigatório.", 400);
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("subjects")
    .select("id, name")
    .eq("school_id", schoolId)
    .ilike("name", name)
    .limit(1);

  if (existingErr) {
    return jsonError("Falha ao validar disciplina existente.", 500, {
      details: existingErr.message,
    });
  }

  if (existing && existing.length > 0) {
    return jsonError("Já existe uma disciplina com esse nome.", 400, {
      existing: existing[0],
    });
  }

  const { data, error } = await supabaseAdmin
    .from("subjects")
    .insert({
      school_id: schoolId,
      name,
    })
    .select("id, school_id, name, created_at")
    .single();

  if (error) {
    return jsonError("Falha ao criar disciplina.", 500, {
      details: error.message,
    });
  }

  return NextResponse.json({
    ok: true,
    subject: data,
  });
}