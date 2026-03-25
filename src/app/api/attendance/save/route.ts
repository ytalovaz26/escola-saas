import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type Payload = {
  classId: string;
  date: string; // YYYY-MM-DD
  lessonNumber?: number;
  items: Array<{
    studentId?: string;
    student_id?: string;
    status: AttendanceStatus;
    note?: string | null;
  }>;
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

async function getOrCreateSession(params: {
  schoolId: string;
  classId: string;
  teacherUserId: string;
  lessonDate: string;
  lessonNumber: number;
}) {
  const { schoolId, classId, teacherUserId, lessonDate, lessonNumber } = params;

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("lesson_date", lessonDate)
    .eq("lesson_number", lessonNumber)
    .limit(1);

  if (findErr) {
    return {
      ok: false as const,
      error: "Failed to find attendance session.",
      details: findErr.message,
    };
  }

  if (existing && existing.length > 0) {
    return { ok: true as const, sessionId: existing[0].id as string };
  }

  const { data: created, error: insertErr } = await supabaseAdmin
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

  if (insertErr) {
    const { data: retry, error: retryErr } = await supabaseAdmin
      .from("attendance_sessions")
      .select("id")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("lesson_date", lessonDate)
      .eq("lesson_number", lessonNumber)
      .limit(1);

    if (retryErr) {
      return {
        ok: false as const,
        error: "Failed to create attendance session.",
        details: `${insertErr.message} | retry: ${retryErr.message}`,
      };
    }

    if (retry && retry.length > 0) {
      return { ok: true as const, sessionId: retry[0].id as string };
    }

    return {
      ok: false as const,
      error: "Failed to create attendance session.",
      details: insertErr.message,
    };
  }

  return { ok: true as const, sessionId: created.id as string };
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

  const { schoolId, userId } = guard;

  if (!userId) {
    return jsonError("Teacher user not identified.", 401);
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const classId = (body?.classId || "").trim();
  const date = (body?.date || "").trim();
  const lessonNumber =
    typeof body?.lessonNumber === "number" && body.lessonNumber >= 1
      ? body.lessonNumber
      : 1;

  const items = Array.isArray(body?.items) ? body.items : [];

  if (!classId) return jsonError("classId is required.", 400);
  if (!date) return jsonError("date is required (YYYY-MM-DD).", 400);
  if (items.length === 0) return jsonError("items is required (non-empty list).", 400);

  const { data: teacherClassLink, error: teacherClassErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", userId)
    .limit(1);

  if (teacherClassErr) {
    return jsonError("Failed to validate teacher-class link.", 500, {
      details: teacherClassErr.message,
    });
  }

  if (!teacherClassLink || teacherClassLink.length === 0) {
    return jsonError("Teacher is not linked to this class.", 403);
  }

  const { data: activeStudents, error: activeStudentsErr } = await supabaseAdmin.rpc(
    "get_active_students_for_class_on_date",
    {
      p_class_id: classId,
      p_date: date,
    }
  );

  if (activeStudentsErr) {
    return jsonError("Failed to validate active students for class/date.", 500, {
      details: activeStudentsErr.message,
    });
  }

  const allowedStudentIds = new Set(
    (activeStudents || []).map((student: any) =>
      String(student?.student_id || student?.id || "").trim()
    )
  );

  const normalizedItems = items.map((item) => {
    const studentId = String(item.studentId || item.student_id || "").trim();

    return {
      student_id: studentId,
      status: item.status,
      note: item.note ?? null,
    };
  });

  if (normalizedItems.some((item) => !item.student_id)) {
    return jsonError("Invalid studentId in items.", 400);
  }

  if (normalizedItems.some((item) => !allowedStudentIds.has(item.student_id))) {
    return jsonError("There is a student in items that does not belong to this class/date.", 400);
  }

  const sessionResult = await getOrCreateSession({
    schoolId,
    classId,
    teacherUserId: userId,
    lessonDate: date,
    lessonNumber,
  });

  if (!sessionResult.ok) {
    return jsonError("Failed to create/get attendance session.", 500, {
      details: sessionResult.details,
    });
  }

  const sessionId = sessionResult.sessionId;

  const rows = normalizedItems.map((item) => ({
    school_id: schoolId,
    session_id: sessionId,
    student_id: item.student_id,
    status: item.status,
    note: item.note,
  }));

  const { error: saveErr } = await supabaseAdmin
    .from("attendance_records")
    .upsert(rows, { onConflict: "session_id,student_id" });

  if (saveErr) {
    return jsonError("Failed to save attendance.", 500, {
      details: saveErr.message,
    });
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders() });
}