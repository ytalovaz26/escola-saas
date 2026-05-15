import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function normalizeRole(role?: string | null) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "admin") return "admin";

  return r;
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "secretaria",
    "secretary",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const schoolId = (guard as any).schoolId as string;
    const role = normalizeRole((guard as any).role);

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    if (!["diretor", "coordenador", "secretaria", "admin"].includes(role)) {
      return jsonError("Sem permissão para listar responsáveis.", 403);
    }

    const { data, error } = await supabaseAdmin
      .from("parents")
      .select("id, school_id, user_id, full_name, phone, photo_url, created_at")
      .eq("school_id", schoolId)
      .order("full_name", { ascending: true });

    if (error) {
      return jsonError("Erro ao carregar responsáveis: " + error.message, 500);
    }

    const parents = (data || []).map((parent: any) => ({
      id: String(parent.id),
      parentId: String(parent.id),
      schoolId: String(parent.school_id),
      userId: parent.user_id ? String(parent.user_id) : null,
      fullName: parent.full_name || "Responsável sem nome",
      name: parent.full_name || "Responsável sem nome",
      phone: parent.phone || null,
      photoUrl: parent.photo_url || null,
      createdAt: parent.created_at || null,
    }));

    return jsonOk({ parents });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao listar responsáveis.", 500);
  }
}