import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

async function getSchoolIdFromLoggedUser() {
  // usa auth-helpers pra ler o usuário logado por cookie
  const supabase = createRouteHandlerClient({ cookies: () => cookies() });
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr || !u?.user) return { ok: false as const, error: "Não autenticado." };

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("school_id, role")
    .eq("user_id", u.user.id)
    .single();

  if (pErr || !prof?.school_id) return { ok: false as const, error: "Perfil sem school_id." };
  return { ok: true as const, userId: u.user.id, schoolId: prof.school_id, role: prof.role };
}

export async function POST(req: Request) {
  try {
    const me = await getSchoolIdFromLoggedUser();
    if (!me.ok) return jsonError(me.error, 401);

    const body = await req.json().catch(() => null);

    const classId = String(body?.classId || "").trim();
    const studentId = String(body?.studentId || "").trim();

    if (!classId) return jsonError("classId é obrigatório.", 400);
    if (!studentId) return jsonError("studentId é obrigatório.", 400);

    const schoolId = me.schoolId; // ✅ SEMPRE do usuário logado

    // Checa se turma pertence à escola
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return jsonError("Erro ao validar turma.", 500, { details: clsErr.message });
    if (!cls || cls.school_id !== schoolId) return jsonError("Turma não pertence à sua escola.", 403);

    // Checa se aluno pertence à escola
    const { data: st, error: stErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, school_id, role")
      .eq("user_id", studentId)
      .maybeSingle();

    if (stErr) return jsonError("Erro ao validar aluno.", 500, { details: stErr.message });
    if (!st || st.school_id !== schoolId) return jsonError("Aluno não pertence à sua escola.", 403);

    // Não duplica matrícula ativa
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("class_students")
      .select("id, school_id, class_id, student_id, is_active, created_at")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle();

    if (exErr) return jsonError("Erro ao checar matrícula.", 500, { details: exErr.message });

    if (existing?.id) {
      return NextResponse.json({ ok: true, reused: true, enrollment: existing });
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("class_students")
      .insert({
        school_id: schoolId,
        class_id: classId,
        student_id: studentId,
        is_active: true,
      })
      .select("id, school_id, class_id, student_id, is_active, created_at")
      .single();

    if (insErr) return jsonError("Erro ao inserir matrícula.", 500, { details: insErr.message });

    return NextResponse.json({ ok: true, reused: false, enrollment: inserted });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno.", 500);
  }
}
