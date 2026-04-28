import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function calcAverage(values: Array<number | null | undefined>) {
  const valid = values.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))) as number[];
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, n) => sum + Number(n), 0);
  return Number((total / valid.length).toFixed(2));
}

function getSituation(avg: number | null) {
  if (avg === null) return "Sem média";
  if (avg >= 7) return "Aprovado parcial";
  if (avg >= 5) return "Em recuperação";
  return "Baixo desempenho";
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token/session.", 401);
    }

    const userId = String(userData.user.id);
    const url = new URL(req.url);

    const studentId = normalizeText(url.searchParams.get("studentId"));
    const term = normalizeText(url.searchParams.get("term"));

    if (!studentId) return jsonError("studentId é obrigatório.", 400);
    if (!term) return jsonError("term é obrigatório.", 400);

    const { data: parentRow, error: parentErr } = await supabaseAdmin
      .from("parents")
      .select("id, school_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (parentErr) {
      return jsonError("Falha ao localizar responsável.", 500, {
        details: parentErr.message,
      });
    }

    if (!parentRow?.id) {
      return jsonError("Responsável não encontrado.", 403);
    }

    const parentId = String(parentRow.id);

    const { data: relation, error: relationErr } = await supabaseAdmin
      .from("student_parents")
      .select("id")
      .eq("parent_id", parentId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .limit(1);

    if (relationErr) {
      return jsonError("Falha ao validar vínculo do responsável com o aluno.", 500, {
        details: relationErr.message,
      });
    }

    if (!relation || relation.length === 0) {
      return jsonError("Você não tem permissão para acessar este aluno.", 403);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id, class_id, full_name, registration_number")
      .eq("id", studentId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Falha ao buscar dados do aluno.", 500, {
        details: studentErr.message,
      });
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado.", 404);
    }

    const schoolId = String(student.school_id || parentRow.school_id || "");
    if (!schoolId) {
      return jsonError("school_id do aluno não encontrado.", 500);
    }

    let classId = normalizeText(student.class_id);

    if (!classId) {
      const { data: activeLink } = await supabaseAdmin
        .from("student_classes")
        .select("class_id")
        .eq("school_id", schoolId)
        .eq("student_id", studentId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      classId = normalizeText(activeLink?.class_id);
    }

    const [{ data: school }, { data: classData }, { data: gradesRows, error: gradesErr }] =
      await Promise.all([
        supabaseAdmin
          .from("schools")
          .select("name, brand_name, brand_logo_url")
          .eq("id", schoolId)
          .maybeSingle(),
        classId
          ? supabaseAdmin
              .from("classes")
              .select("id, name, grade, shift")
              .eq("id", classId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
        supabaseAdmin
          .from("grades")
          .select("subject_id, subject, score, term, updated_at, created_at")
          .eq("school_id", schoolId)
          .eq("student_id", studentId)
          .eq("term", term)
          .order("subject", { ascending: true }),
      ]);

    if (gradesErr) {
      return jsonError("Falha ao buscar boletim do aluno.", 500, {
        details: gradesErr.message,
      });
    }

    const grades = (gradesRows || []).map((row: any) => ({
      subject_id: row?.subject_id ? String(row.subject_id) : null,
      subject: row?.subject ? String(row.subject) : null,
      score:
        row?.score !== null && row?.score !== undefined && Number.isFinite(Number(row.score))
          ? Number(row.score)
          : null,
      updated_at: row?.updated_at ?? null,
      created_at: row?.created_at ?? null,
    }));

    const average = calcAverage(grades.map((g) => g.score));
    const situation = getSituation(average);

    return NextResponse.json({
      ok: true,
      student: {
        id: String(student.id),
        full_name: student.full_name ?? null,
        registration_number: student.registration_number ?? null,
      },
      school: {
        id: schoolId,
        name: school?.brand_name ?? school?.name ?? null,
        logo_url: school?.brand_logo_url ?? null,
      },
      class: classData
        ? {
            id: String(classData.id),
            name: classData.name ?? null,
            grade: classData.grade ?? null,
            shift: classData.shift ?? null,
          }
        : null,
      term,
      grades,
      summary: {
        average,
        situation,
        total_subjects: grades.length,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno em /api/parent/report-card", 500);
  }
}