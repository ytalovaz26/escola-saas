import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

async function getUserFromBearer(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { ok: false as const, resp: jsonError("Missing Authorization Bearer token.", 401) };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, resp: jsonError("Invalid token/session.", 401) };

  return { ok: true as const, userId: userData.user.id };
}

export async function POST(req: Request) {
  const u = await getUserFromBearer(req);
  if (!u.ok) return u.resp;

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", u.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkErr) return jsonError("school_users lookup failed: " + linkErr.message, 500);
  if (!link?.school_id) return jsonError("Usuário sem vínculo escolar ativo.", 403);

  const role = normRole(link.role);
  if (!(role === "diretor" || role === "coordenador")) {
    return jsonError("Acesso negado (somente diretor/coordenador).", 403);
  }

  const schoolId = link.school_id as string;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const classId = String(body?.classId || "").trim();
  const studentId = String(body?.studentId || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!studentId) return jsonError("studentId é obrigatório.", 400);

  // valida turma pertence à escola
  const { data: cls, error: clsErr } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (clsErr) return jsonError("Erro ao validar turma.", 500, { details: clsErr.message });
  if (!cls?.id) return jsonError("Turma inválida para esta escola.", 403);

  // valida aluno pertence à escola (profiles.school_id)
  const { data: st, error: stErr } = await supabaseAdmin
    .from("profiles")
    .select("user_id")
    .eq("user_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (stErr) return jsonError("Erro ao validar aluno.", 500, { details: stErr.message });
  if (!st?.user_id) return jsonError("Aluno inválido para esta escola.", 403);

  // cria (ou reativa) vínculo em class_students
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("class_students")
    .select("id, is_active")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (exErr) return jsonError("Erro ao checar matrícula existente.", 500, { details: exErr.message });

  if (existing?.id) {
    // reativar
    const { error: upErr } = await supabaseAdmin
      .from("class_students")
      .update({ is_active: true })
      .eq("id", existing.id);

    if (upErr) return jsonError("Erro ao reativar matrícula.", 500, { details: upErr.message });
    return NextResponse.json({ ok: true, reused: true });
  }

  const { error: insErr } = await supabaseAdmin.from("class_students").insert({
    school_id: schoolId,
    class_id: classId,
    student_id: studentId,
    is_active: true,
  });

  if (insErr) return jsonError("Erro ao matricular.", 500, { details: insErr.message });

  return NextResponse.json({ ok: true, reused: false });
}
