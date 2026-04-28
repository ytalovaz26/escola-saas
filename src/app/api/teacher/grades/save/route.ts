import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type PayloadItem = {
  studentId?: string;
  student_id?: string;
  score?: number | string;
};

type Payload = {
  classId: string;
  subject: string;
  term: string;
  items: PayloadItem[];
};

type NormalizedGradeItem = {
  student_id: string;
  score: number;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: corsHeaders() }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeScore(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;

  const normalized =
    typeof raw === "string" ? raw.replace(",", ".").trim() : raw;

  const score = Number(normalized);

  if (!Number.isFinite(score)) return null;

  return score;
}

async function loadAllowedStudentIds(params: {
  schoolId: string;
  classId: string;
}) {
  const { schoolId, classId } = params;

  const ids = new Set<string>();

  // 1) Fonte principal: vínculos ativos em student_classes
  const { data: activeLinks, error: linksErr } = await supabaseAdmin
    .from("student_classes")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (!linksErr && Array.isArray(activeLinks)) {
    for (const row of activeLinks) {
      const studentId = String((row as any)?.student_id || "").trim();
      if (studentId) ids.add(studentId);
    }
  }

  // 2) Fallback legado: students.class_id
  if (ids.size === 0) {
    const { data: legacyStudents, error: legacyErr } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId);

    if (!legacyErr && Array.isArray(legacyStudents)) {
      for (const row of legacyStudents) {
        const studentId = String((row as any)?.id || "").trim();
        if (studentId) ids.add(studentId);
      }
    }
  }

  return Array.from(ids);
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "admin",
    "secretaria",
    "coordenador",
    "coordinator",
    "professor",
    "teacher",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;
  const teacherUserId =
    (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

  if (!teacherUserId) {
    return jsonError("Professor não identificado no token.", 401);
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError("Body inválido (JSON).", 400);
  }

  const classId = normalizeText(body?.classId);
  const subject = normalizeText(body?.subject);
  const term = normalizeText(body?.term);
  const incomingItems: PayloadItem[] = Array.isArray(body?.items) ? body.items : [];

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!subject) return jsonError("subject é obrigatório.", 400);
  if (!term) return jsonError("term é obrigatório.", 400);

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id, is_active")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .eq("is_active", true)
    .limit(1);

  if (linkErr) {
    return jsonError("Erro ao validar vínculo professor-turma.", 500, {
      details: linkErr.message,
    });
  }

  if (!link || link.length === 0) {
    return jsonError("Professor não está vinculado a esta turma.", 403);
  }

  const allowedStudentIds = await loadAllowedStudentIds({
    schoolId,
    classId,
  });

  if (allowedStudentIds.length === 0) {
    return jsonError("Nenhum aluno ativo encontrado para esta turma.", 400, {
      classId,
    });
  }

  const incomingMap = new Map<string, NormalizedGradeItem>();

  for (const item of incomingItems) {
    const studentId = normalizeText(item?.studentId || item?.student_id);
    if (!studentId) continue;

    const score = normalizeScore(item?.score);

    if (score === null) {
      return jsonError("Existe nota inválida em items.", 400, {
        studentId,
        rawScore: item?.score,
      });
    }

    incomingMap.set(studentId, {
      student_id: studentId,
      score,
    });
  }

  const receivedStudentIds = Array.from(incomingMap.keys());

  if (receivedStudentIds.length === 0) {
    return jsonError("items deve conter ao menos uma nota válida.", 400);
  }

  const invalidStudentIds = receivedStudentIds.filter(
    (studentId) => !allowedStudentIds.includes(studentId)
  );

  if (invalidStudentIds.length > 0) {
    return jsonError("Existe aluno em items que não pertence a esta turma.", 400, {
      invalidStudentIds,
      allowedStudentIds,
      receivedStudentIds,
    });
  }

  const rows = receivedStudentIds.map((studentId) => {
    const item = incomingMap.get(studentId)!;

    return {
      school_id: schoolId,
      class_id: classId,
      student_id: item.student_id,
      teacher_user_id: teacherUserId,
      subject,
      term,
      score: item.score,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertErr } = await supabaseAdmin
    .from("grades")
    .upsert(rows, {
      onConflict: "school_id,class_id,student_id,subject,term",
    });

  if (upsertErr) {
    return jsonError("Falha ao salvar notas.", 500, {
      details: upsertErr.message,
      rowCount: rows.length,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      classId,
      subject,
      term,
      savedStudentIds: receivedStudentIds,
      totalSaved: receivedStudentIds.length,
    },
    { headers: corsHeaders() }
  );
}