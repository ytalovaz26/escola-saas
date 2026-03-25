import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function supabaseUserFromToken(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.");
  }

  // IMPORTANTÍSSIMO: este client carrega o JWT do usuário -> auth.uid() funciona nas RPCs
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return jsonError("Missing Authorization Bearer token.", 401);

  // 1) Identifica o usuário pelo token (service role ok aqui)
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return jsonError("Invalid token/session.", 401);
  const userId = userData.user.id;

  // 2) Pega vínculo staff -> escola
  const { data: link, error: linkErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", userId)
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

  // 3) Body
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

  // 4) Valida turma (service role)
  const { data: cls, error: clsErr } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (clsErr) return jsonError("Erro ao validar turma.", 500, { details: clsErr.message });
  if (!cls?.id) return jsonError("Turma inválida para esta escola.", 403);

  // 5) Valida aluno (tabela correta: students)
  const { data: st, error: stErr } = await supabaseAdmin
    .from("students")
    .select("id, school_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (stErr) return jsonError("Erro ao validar aluno.", 500, { details: stErr.message });
  if (!st?.id) return jsonError("Aluno inválido para esta escola.", 403);

  // 6) ✅ RPC com contexto do usuário (auth.uid() funciona)
  const supabaseUser = supabaseUserFromToken(token);

  const { error: rpcErr } = await supabaseUser.rpc("set_active_class", {
    p_student_id: studentId,
    p_class_id: classId,
  });

  if (rpcErr) {
    return jsonError("Falha ao definir turma ativa (RPC set_active_class).", 500, {
      details: rpcErr.message,
    });
  }

  // 7) (Opcional) sincroniza cache students.class_id
  const { error: upErr } = await supabaseAdmin
    .from("students")
    .update({ class_id: classId })
    .eq("id", studentId)
    .eq("school_id", schoolId);

  if (upErr) {
    return NextResponse.json({
      ok: true,
      warning: "Turma ativa definida, mas falhou ao atualizar students.class_id (cache).",
      details: upErr.message,
    });
  }

  return NextResponse.json({ ok: true });
}
