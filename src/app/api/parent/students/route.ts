// src/app/api/parent/students/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}
function jsonFail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}
function logErr(scope: string, err: any, meta?: Record<string, any>) {
  // log mínimo sem dados sensíveis
  console.error(`[${scope}]`, {
    message: err?.message || String(err),
    ...(meta ? meta : {}),
  });
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return jsonFail(401, "Missing Bearer token");

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !u?.user) return jsonFail(401, "Invalid session");

    const userId = u.user.id;

    // 1) acha o parent pelo user_id
    const { data: parent, error: pErr } = await supabaseAdmin
      .from("parents")
      .select("id, school_id, user_id, full_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) return jsonFail(500, pErr.message);
    if (!parent?.id) return jsonFail(403, "Você não está cadastrado como responsável (parents.user_id).");

    const parentId = parent.id as string;
    const schoolId = parent.school_id as string;

    // 2) vínculos parent -> students
    const { data: links, error: lErr } = await supabaseAdmin
      .from("student_parents")
      .select("student_id, is_active")
      .eq("school_id", schoolId)
      .eq("parent_id", parentId)
      .eq("is_active", true);

    if (lErr) return jsonFail(500, lErr.message);

    const studentIds = (links || []).map((x) => x.student_id).filter(Boolean);
    if (studentIds.length === 0) {
      return jsonOk({ schoolId, parentId, students: [] });
    }

    // 3) busca alunos
    const { data: students, error: sErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id, full_name, birth_date, registration_number, created_at")
      .eq("school_id", schoolId)
      .in("id", studentIds);

    if (sErr) return jsonFail(500, sErr.message);

    // 4) turma ativa via student_classes
    const { data: activeClasses, error: acErr } = await supabaseAdmin
      .from("student_classes")
      .select("student_id, class_id, started_at, ended_at, is_active")
      .eq("school_id", schoolId)
      .in("student_id", studentIds)
      .eq("is_active", true);

    if (acErr) return jsonFail(500, acErr.message);

    const activeByStudent = new Map<string, any>();
    for (const row of activeClasses || []) activeByStudent.set(row.student_id, row);

    // 5) pega dados das turmas ativas
    const classIds = Array.from(
      new Set((activeClasses || []).map((x: any) => x.class_id).filter(Boolean))
    );

    let classesById = new Map<string, any>();
    if (classIds.length > 0) {
      const { data: classes, error: cErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("school_id", schoolId)
        .in("id", classIds);

      if (cErr) return jsonFail(500, cErr.message);

      classesById = new Map((classes || []).map((c: any) => [c.id, c]));
    }

    const result = (students || [])
      .map((s: any) => {
        const active = activeByStudent.get(s.id) || null;
        const cls = active?.class_id ? classesById.get(active.class_id) : null;

        return {
          id: s.id,
          full_name: s.full_name,
          registration_number: s.registration_number ?? null,
          birth_date: s.birth_date ?? null,
          active_class: active
            ? {
                class_id: active.class_id,
                started_at: active.started_at,
                ended_at: active.ended_at,
                class: cls
                  ? {
                      id: cls.id,
                      name: cls.name,
                      grade: cls.grade,
                      shift: cls.shift,
                    }
                  : null,
              }
            : null,
        };
      })
      .sort((a: any, b: any) => String(a.full_name).localeCompare(String(b.full_name)));

    return jsonOk({ schoolId, parentId, students: result });
  } catch (err) {
    logErr("GET /api/parent/students", err);
    return jsonFail(500, "Internal error");
  }
}