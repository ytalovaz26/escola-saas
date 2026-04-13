import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type PayloadItem = {
  studentId?: string;
  student_id?: string;
  status?: AttendanceStatus | string;
  note?: string | null;
};

type Payload = {
  classId: string;
  date: string;
  lessonNumber?: number;
  items: PayloadItem[];
};

type NormalizedIncomingItem = {
  student_id: string;
  status: AttendanceStatus;
  note: string | null;
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

function normalizeStatus(raw: any): AttendanceStatus {
  const value = String(raw || "").trim().toLowerCase();

  if (value === "absent" || value === "f" || value === "ausente") return "absent";
  if (value === "late" || value === "t" || value === "atraso" || value === "tarde") return "late";
  return "present";
}

async function getOrCreateSession(params: {
  schoolId: string;
  classId: string;
  teacherUserId: string;
  lessonDate: string;
  lessonNumber: number;
}) {
  const { schoolId, classId, teacherUserId, lessonDate, lessonNumber } = params;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("lesson_date", lessonDate)
    .eq("lesson_number", lessonNumber)
    .limit(1);

  if (existingError) {
    return {
      ok: false as const,
      error: "Falha ao buscar sessão de presença.",
      details: existingError.message,
    };
  }

  if (existing && existing.length > 0) {
    return {
      ok: true as const,
      sessionId: String(existing[0].id),
    };
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from("attendance_sessions")
    .insert({
      school_id: schoolId,
      class_id: classId,
      teacher_user_id: teacherUserId,
      lesson_date: lessonDate,
      lesson_number: lessonNumber,
    })
    .select("id")
    .single();

  if (createError) {
    const { data: retry, error: retryError } = await supabaseAdmin
      .from("attendance_sessions")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("lesson_date", lessonDate)
      .eq("lesson_number", lessonNumber)
      .limit(1);

    if (retryError) {
      return {
        ok: false as const,
        error: "Falha ao criar sessão de presença.",
        details: `${createError.message} | retry: ${retryError.message}`,
      };
    }

    if (retry && retry.length > 0) {
      return {
        ok: true as const,
        sessionId: String(retry[0].id),
      };
    }

    return {
      ok: false as const,
      error: "Falha ao criar sessão de presença.",
      details: createError.message,
    };
  }

  return {
    ok: true as const,
    sessionId: String(created.id),
  };
}

async function loadAllowedStudentIds(params: {
  schoolId: string;
  classId: string;
  date: string;
}) {
  const { schoolId, classId, date } = params;

  const ids = new Set<string>();

  // 1) Fonte principal: RPC histórica
  try {
    const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc(
      "get_active_students_for_class_on_date",
      {
        p_class_id: classId,
        p_date: date,
      }
    );

    if (!rpcErr && Array.isArray(rpcRows)) {
      for (const row of rpcRows) {
        const studentId = String((row as any)?.student_id ?? (row as any)?.id ?? "").trim();
        if (studentId) ids.add(studentId);
      }
    }
  } catch {
    // segue para fallback
  }

  // 2) Fallback principal: vínculos ativos atuais em student_classes
  if (ids.size === 0) {
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
  }

  // 3) Fallback legado: students.class_id
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

  const classId = String(body?.classId || "").trim();
  const date = String(body?.date || "").trim();
  const lessonNumber =
    typeof body?.lessonNumber === "number" && body.lessonNumber >= 1
      ? body.lessonNumber
      : 1;

  const incomingItems: PayloadItem[] = Array.isArray(body?.items) ? body.items : [];

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!date) return jsonError("date é obrigatório (YYYY-MM-DD).", 400);

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
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
    date,
  });

  if (allowedStudentIds.length === 0) {
    return jsonError("Nenhum aluno ativo encontrado para esta turma/data.", 400, {
      classId,
      date,
    });
  }

  const incomingMap = new Map<string, NormalizedIncomingItem>();

  for (const item of incomingItems) {
    const studentId = String(item?.studentId || item?.student_id || "").trim();
    if (!studentId) continue;

    incomingMap.set(studentId, {
      student_id: studentId,
      status: normalizeStatus(item?.status),
      note: item?.note ?? null,
    });
  }

  const receivedStudentIds = Array.from(incomingMap.keys());

  const invalidStudentIds = receivedStudentIds.filter(
    (studentId) => !allowedStudentIds.includes(studentId)
  );

  if (invalidStudentIds.length > 0) {
    return jsonError("Existe aluno em items que não pertence a esta turma/data.", 400, {
      invalidStudentIds,
      allowedStudentIds,
      receivedStudentIds,
    });
  }

  const completedItems: NormalizedIncomingItem[] = allowedStudentIds.map((studentId) => {
    const existing = incomingMap.get(studentId);

    if (existing) return existing;

    return {
      student_id: studentId,
      status: "present",
      note: null,
    };
  });

  const sessionResult = await getOrCreateSession({
    schoolId,
    classId,
    teacherUserId,
    lessonDate: date,
    lessonNumber,
  });

  if (!sessionResult.ok) {
    return jsonError("Falha ao criar/obter sessão de presença.", 500, {
      details: sessionResult.details,
    });
  }

  const sessionId = sessionResult.sessionId;

  const rows = completedItems.map((item) => ({
    school_id: schoolId,
    session_id: sessionId,
    student_id: item.student_id,
    status: item.status,
    note: item.note,
  }));

  const { error: upsertErr } = await supabaseAdmin
    .from("attendance_records")
    .upsert(rows, { onConflict: "session_id,student_id" });

  if (upsertErr) {
    return jsonError("Falha ao salvar presença.", 500, {
      details: upsertErr.message,
      sessionId,
      rowCount: rows.length,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      sessionId,
      savedStudentIds: completedItems.map((item) => item.student_id),
      totalSaved: completedItems.length,
    },
    { headers: corsHeaders() }
  );
}