import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  // ✅ Segurança: só funciona em DEV
  if (process.env.NODE_ENV !== "development") {
    return jsonError("Not found.", 404);
  }

  try {
    // 1) Auth via Bearer token (mesmo padrão do /api/me)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid token/session.", 401);

    const userId = userData.user.id;

    // 2) Descobrir school_id + role do usuário via school_users (vínculo ativo mais recente)
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("school_users")
      .select("school_id, role, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkErr) return jsonError("school_users lookup failed: " + linkErr.message, 500);
    if (!link?.school_id) return jsonError("Você não possui vínculo escolar ativo.", 403);

    const schoolId = String(link.school_id);
    const role = normRole(link.role);

    // ✅ Só direção/coordenador pode matricular aluno (mesmo sendo DEV-ONLY)
    if (!(role === "diretor" || role === "coordenador")) {
      return jsonError("Acesso negado: apenas direção/coordenador.", 403);
    }

    // 3) Body
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body inválido (JSON).", 400);
    }

    const classId = String(body?.classId || "").trim();
    const studentId = String(body?.studentId || "").trim();

    if (!classId) return jsonError("classId é obrigatório.", 400);
    if (!studentId) return jsonError("studentId é obrigatório.", 400);

    // 4) Validar que a turma pertence à escola
    // Assumimos tabela "classes" com colunas: id, school_id
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, school_id")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) {
      // Se der erro por schema diferente, aí sim precisamos do print da tabela classes
      return jsonError("Erro ao validar turma (classes).", 500, { details: clsErr.message });
    }
    if (!cls?.id) return jsonError("Turma não encontrada.", 404);
    if (String(cls.school_id) !== schoolId) return jsonError("Turma não pertence à sua escola.", 403);

    // 5) Validar que o aluno pertence à escola (profiles.user_id + profiles.school_id)
    const { data: st, error: stErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, school_id, full_name, role")
      .eq("user_id", studentId)
      .maybeSingle();

    if (stErr) return jsonError("Erro ao validar aluno (profiles).", 500, { details: stErr.message });
    if (!st?.user_id) return jsonError("Aluno não encontrado em profiles.", 404);
    if (String(st.school_id) !== schoolId) {
      return jsonError("Aluno não pertence à mesma escola da turma.", 403);
    }

    // 6) Upsert “manual”: se já existe, reativa; se não, cria
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("class_students")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (exErr) return jsonError("Erro ao consultar class_students.", 500, { details: exErr.message });

    if (existing?.id) {
      const { data: upd, error: updErr } = await supabaseAdmin
        .from("class_students")
        .update({ is_active: true })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (updErr) return jsonError("Erro ao reativar matrícula.", 500, { details: updErr.message });

      return NextResponse.json({
        ok: true,
        enrolled: true,
        reused: true,
        row: upd,
        student: { user_id: st.user_id, full_name: st.full_name ?? null },
      });
    }

    const { data: ins, error: insErr } = await supabaseAdmin
      .from("class_students")
      .insert({
        school_id: schoolId,
        class_id: classId,
        student_id: studentId,
        is_active: true,
      })
      .select("*")
      .single();

    if (insErr) return jsonError("Erro ao matricular aluno.", 500, { details: insErr.message });

    return NextResponse.json({
      ok: true,
      enrolled: true,
      reused: false,
      row: ins,
      student: { user_id: st.user_id, full_name: st.full_name ?? null },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error.", 500);
  }
}
