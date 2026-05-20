import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaffContext =
  | {
      ok: true;
      userId: string;
      email: string | null;
      schoolId: string;
      role: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

function jsonOk(body: Record<string, any> = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isAllowedStaffRole(role: unknown) {
  const r = normalizeRole(role);

  return [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "secretaria",
    "secretary",
    "admin",
    "admin_master",
    "master",
  ].includes(r);
}

function isTeacherRole(role: unknown) {
  const r = normalizeRole(role);
  return r === "professor" || r === "teacher";
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function parseWeekday(value: unknown) {
  const n = Number(value);

  if (!Number.isInteger(n) || n < 0 || n > 6) {
    return null;
  }

  return n;
}

function normalizeTime(value: unknown) {
  const safe = cleanText(value);

  if (!safe) return "";

  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(safe)) return safe;

  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(safe)) {
    return safe.slice(0, 5);
  }

  return safe;
}

function isTime(value: unknown) {
  const safe = cleanText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(safe);
}

function timeToMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function classNameFromRow(cls: any) {
  return cleanText(cls?.name) || "Turma";
}

function teacherNameFromRow(teacher: any) {
  const email = cleanText(teacher?.email);

  if (!email) return "Professor";

  const beforeAt = email.split("@")[0] || email;

  const pretty = beforeAt
    .split(/[.\-_ ]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

  return pretty || email;
}

async function getStaffContext(req: Request): Promise<StaffContext> {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false,
      response: jsonError("Missing Authorization Bearer token.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false,
      response: jsonError("Sessão inválida.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: schoolUser, error: suErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (suErr) {
    return {
      ok: false,
      response: jsonError("Falha ao buscar vínculo escolar: " + suErr.message, 500),
    };
  }

  if (!schoolUser?.school_id) {
    return {
      ok: false,
      response: jsonError("Usuário não vinculado a uma escola.", 403),
    };
  }

  if (!isAllowedStaffRole(schoolUser.role)) {
    return {
      ok: false,
      response: jsonError(`Acesso negado. Role atual: "${schoolUser.role || "—"}".`, 403),
    };
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email || null,
    schoolId: String(schoolUser.school_id),
    role: String(schoolUser.role || ""),
  };
}

async function assertClassBelongsToSchool(classId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, school_id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    throw new Error("Falha ao validar turma: " + error.message);
  }

  return Boolean(data?.id);
}

async function assertTeacherBelongsToSchool(teacherUserId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("school_users")
    .select("user_id, school_id, role, is_active")
    .eq("user_id", teacherUserId)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error("Falha ao validar professor: " + error.message);
  }

  if (!data?.user_id) return false;

  return isTeacherRole(data.role);
}

async function assertSubjectBelongsToSchool(subjectId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("subjects")
    .select("id, school_id")
    .eq("id", subjectId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    throw new Error("Falha ao validar disciplina: " + error.message);
  }

  return Boolean(data?.id);
}

async function loadOptions(schoolId: string) {
  const [classesRes, teachersRes, subjectsRes] = await Promise.all([
    supabaseAdmin
      .from("classes")
      .select("id, name, school_id")
      .eq("school_id", schoolId)
      .order("name", { ascending: true }),

    supabaseAdmin
      .from("school_users")
      .select("user_id, email, role, is_active, school_id, created_at")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),

    supabaseAdmin
      .from("subjects")
      .select("id, name, school_id")
      .eq("school_id", schoolId)
      .order("name", { ascending: true }),
  ]);

  if (classesRes.error) {
    throw new Error("Falha ao buscar turmas: " + classesRes.error.message);
  }

  if (teachersRes.error) {
    throw new Error("Falha ao buscar professores: " + teachersRes.error.message);
  }

  if (subjectsRes.error) {
    throw new Error("Falha ao buscar disciplinas: " + subjectsRes.error.message);
  }

  const classes = (classesRes.data || []).map((cls: any) => ({
    id: String(cls.id),
    name: classNameFromRow(cls),
    rawName: cleanText(cls.name) || "Turma",
  }));

  const teachers = (teachersRes.data || [])
    .filter((teacher: any) => isTeacherRole(teacher.role))
    .map((teacher: any) => ({
      userId: String(teacher.user_id),
      name: teacherNameFromRow(teacher),
      email: cleanText(teacher.email) || null,
      role: cleanText(teacher.role) || "professor",
    }));

  const subjects = (subjectsRes.data || []).map((subject: any) => ({
    id: String(subject.id),
    name: cleanText(subject.name) || "Disciplina",
  }));

  return {
    classes,
    teachers,
    subjects,
  };
}

async function loadSchedule(schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("school_class_schedule")
    .select(
      `
      id,
      school_id,
      class_id,
      teacher_user_id,
      subject_id,
      weekday,
      start_time,
      end_time,
      room,
      notes,
      is_active,
      created_at,
      updated_at
    `
    )
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error("Falha ao buscar grade: " + error.message);
  }

  const rows = data || [];

  const classIds = Array.from(
    new Set(rows.map((row: any) => cleanText(row.class_id)).filter(Boolean))
  );

  const teacherIds = Array.from(
    new Set(rows.map((row: any) => cleanText(row.teacher_user_id)).filter(Boolean))
  );

  const subjectIds = Array.from(
    new Set(rows.map((row: any) => cleanText(row.subject_id)).filter(Boolean))
  );

  const [classesRes, teachersRes, subjectsRes] = await Promise.all([
    classIds.length
      ? supabaseAdmin.from("classes").select("id, name").in("id", classIds)
      : Promise.resolve({ data: [], error: null } as any),

    teacherIds.length
      ? supabaseAdmin
          .from("school_users")
          .select("user_id, email, role")
          .in("user_id", teacherIds)
          .eq("school_id", schoolId)
      : Promise.resolve({ data: [], error: null } as any),

    subjectIds.length
      ? supabaseAdmin.from("subjects").select("id, name").in("id", subjectIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (classesRes.error) {
    throw new Error("Falha ao buscar turmas da grade: " + classesRes.error.message);
  }

  if (teachersRes.error) {
    throw new Error("Falha ao buscar professores da grade: " + teachersRes.error.message);
  }

  if (subjectsRes.error) {
    throw new Error("Falha ao buscar disciplinas da grade: " + subjectsRes.error.message);
  }

  const classesById = new Map<string, any>();
  const teachersById = new Map<string, any>();
  const subjectsById = new Map<string, any>();

  for (const cls of classesRes.data || []) {
    classesById.set(String(cls.id), cls);
  }

  for (const teacher of teachersRes.data || []) {
    teachersById.set(String(teacher.user_id), teacher);
  }

  for (const subject of subjectsRes.data || []) {
    subjectsById.set(String(subject.id), subject);
  }

  return rows.map((row: any) => {
    const cls = classesById.get(String(row.class_id));
    const teacher = teachersById.get(String(row.teacher_user_id));
    const subject = row.subject_id ? subjectsById.get(String(row.subject_id)) : null;

    return {
      id: String(row.id),
      schoolId: String(row.school_id),
      classId: String(row.class_id),
      className: classNameFromRow(cls),
      teacherUserId: String(row.teacher_user_id),
      teacherName: teacherNameFromRow(teacher),
      teacherEmail: cleanText(teacher?.email) || null,
      subjectId: row.subject_id ? String(row.subject_id) : null,
      subjectName: cleanText(subject?.name) || null,
      weekday: Number(row.weekday),
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
      room: cleanText(row.room) || null,
      notes: cleanText(row.notes) || null,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function GET(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const url = new URL(req.url);
    const includeOptions = url.searchParams.get("includeOptions") === "1";

    const [schedule, options] = await Promise.all([
      loadSchedule(ctx.schoolId),
      includeOptions ? loadOptions(ctx.schoolId) : Promise.resolve(null),
    ]);

    return jsonOk({
      schedule,
      total: schedule.length,
      options,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar grade.", 500);
  }
}

export async function POST(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return jsonError("Body JSON inválido.", 400);
    }

    const classId = cleanText(body.classId || body.class_id);
    const teacherUserId = cleanText(body.teacherUserId || body.teacher_user_id);
    const subjectId = cleanText(body.subjectId || body.subject_id) || null;

    const weekday = parseWeekday(body.weekday);
    const startTime = normalizeTime(body.startTime || body.start_time);
    const endTime = normalizeTime(body.endTime || body.end_time);

    const room = cleanText(body.room) || null;
    const notes = cleanText(body.notes) || null;

    if (!classId) return jsonError("Informe a turma.", 400);
    if (!teacherUserId) return jsonError("Informe o professor.", 400);
    if (weekday === null) return jsonError("Informe um dia da semana válido.", 400);

    if (!isTime(startTime)) {
      return jsonError("Informe um horário inicial válido no formato HH:mm.", 400);
    }

    if (!isTime(endTime)) {
      return jsonError("Informe um horário final válido no formato HH:mm.", 400);
    }

    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      return jsonError("O horário final precisa ser maior que o horário inicial.", 400);
    }

    const classOk = await assertClassBelongsToSchool(classId, ctx.schoolId);

    if (!classOk) return jsonError("Turma não encontrada nesta escola.", 404);

    const teacherOk = await assertTeacherBelongsToSchool(teacherUserId, ctx.schoolId);

    if (!teacherOk) return jsonError("Professor não encontrado nesta escola.", 404);

    if (subjectId) {
      const subjectOk = await assertSubjectBelongsToSchool(subjectId, ctx.schoolId);

      if (!subjectOk) {
        return jsonError("Disciplina não encontrada nesta escola.", 404);
      }
    }

    const { data, error } = await supabaseAdmin
      .from("school_class_schedule")
      .insert({
        school_id: ctx.schoolId,
        class_id: classId,
        teacher_user_id: teacherUserId,
        subject_id: subjectId,
        weekday,
        start_time: startTime,
        end_time: endTime,
        room,
        notes,
        is_active: true,
      })
      .select("id")
      .single();

    if (error) {
      return jsonError("Falha ao criar horário: " + error.message, 500);
    }

    const [schedule, options] = await Promise.all([
      loadSchedule(ctx.schoolId),
      loadOptions(ctx.schoolId),
    ]);

    return jsonOk(
      {
        id: data.id,
        schedule,
        total: schedule.length,
        options,
      },
      201
    );
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao criar horário.", 500);
  }
}

export async function PATCH(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return jsonError("Body JSON inválido.", 400);
    }

    const id = cleanText(body.id);

    if (!id) return jsonError("Informe o ID do horário.", 400);

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("school_class_schedule")
      .select("id, school_id")
      .eq("id", id)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();

    if (existingErr) {
      return jsonError("Falha ao validar horário: " + existingErr.message, 500);
    }

    if (!existing?.id) {
      return jsonError("Horário não encontrado nesta escola.", 404);
    }

    const update: Record<string, any> = {};

    if ("classId" in body || "class_id" in body) {
      const classId = cleanText(body.classId || body.class_id);

      if (!classId) return jsonError("Informe a turma.", 400);

      if (!(await assertClassBelongsToSchool(classId, ctx.schoolId))) {
        return jsonError("Turma não encontrada nesta escola.", 404);
      }

      update.class_id = classId;
    }

    if ("teacherUserId" in body || "teacher_user_id" in body) {
      const teacherUserId = cleanText(body.teacherUserId || body.teacher_user_id);

      if (!teacherUserId) return jsonError("Informe o professor.", 400);

      if (!(await assertTeacherBelongsToSchool(teacherUserId, ctx.schoolId))) {
        return jsonError("Professor não encontrado nesta escola.", 404);
      }

      update.teacher_user_id = teacherUserId;
    }

    if ("subjectId" in body || "subject_id" in body) {
      const subjectId = cleanText(body.subjectId || body.subject_id) || null;

      if (subjectId && !(await assertSubjectBelongsToSchool(subjectId, ctx.schoolId))) {
        return jsonError("Disciplina não encontrada nesta escola.", 404);
      }

      update.subject_id = subjectId;
    }

    if ("weekday" in body) {
      const weekday = parseWeekday(body.weekday);

      if (weekday === null) return jsonError("Informe um dia da semana válido.", 400);

      update.weekday = weekday;
    }

    if ("startTime" in body || "start_time" in body) {
      const startTime = normalizeTime(body.startTime || body.start_time);

      if (!isTime(startTime)) {
        return jsonError("Informe um horário inicial válido no formato HH:mm.", 400);
      }

      update.start_time = startTime;
    }

    if ("endTime" in body || "end_time" in body) {
      const endTime = normalizeTime(body.endTime || body.end_time);

      if (!isTime(endTime)) {
        return jsonError("Informe um horário final válido no formato HH:mm.", 400);
      }

      update.end_time = endTime;
    }

    if (update.start_time && update.end_time) {
      if (timeToMinutes(update.end_time) <= timeToMinutes(update.start_time)) {
        return jsonError("O horário final precisa ser maior que o horário inicial.", 400);
      }
    }

    if ("room" in body) update.room = cleanText(body.room) || null;
    if ("notes" in body) update.notes = cleanText(body.notes) || null;

    if ("isActive" in body || "is_active" in body) {
      update.is_active = Boolean(body.isActive ?? body.is_active);
    }

    if (Object.keys(update).length === 0) {
      return jsonError("Nenhum campo para atualizar.", 400);
    }

    const { error } = await supabaseAdmin
      .from("school_class_schedule")
      .update(update)
      .eq("id", id)
      .eq("school_id", ctx.schoolId);

    if (error) {
      return jsonError("Falha ao atualizar horário: " + error.message, 500);
    }

    const [schedule, options] = await Promise.all([
      loadSchedule(ctx.schoolId),
      loadOptions(ctx.schoolId),
    ]);

    return jsonOk({
      id,
      schedule,
      total: schedule.length,
      options,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar horário.", 500);
  }
}

export async function DELETE(req: Request) {
  const ctx = await getStaffContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const url = new URL(req.url);
    const id = cleanText(url.searchParams.get("id"));

    if (!id) return jsonError("Informe o ID do horário.", 400);

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("school_class_schedule")
      .select("id, school_id")
      .eq("id", id)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();

    if (existingErr) {
      return jsonError("Falha ao validar horário: " + existingErr.message, 500);
    }

    if (!existing?.id) {
      return jsonError("Horário não encontrado nesta escola.", 404);
    }

    const { error } = await supabaseAdmin
      .from("school_class_schedule")
      .update({
        is_active: false,
      })
      .eq("id", id)
      .eq("school_id", ctx.schoolId);

    if (error) {
      return jsonError("Falha ao remover horário: " + error.message, 500);
    }

    const [schedule, options] = await Promise.all([
      loadSchedule(ctx.schoolId),
      loadOptions(ctx.schoolId),
    ]);

    return jsonOk({
      id,
      schedule,
      total: schedule.length,
      options,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao remover horário.", 500);
  }
}