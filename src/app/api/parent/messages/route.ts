import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentContext =
  | {
      ok: true;
      userId: string;
      parentId: string;
      schoolId: string;
      parent: any;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function normalizeAudienceType(value: unknown) {
  const type = cleanText(value).toLowerCase();

  if (type === "class") return "class";
  if (type === "all_parents") return "all_parents";
  if (type === "parents") return "all_parents";
  if (type === "school") return "school";
  if (type === "all") return "school";

  return type || "school";
}

function getAudienceLabel(value?: string | null) {
  const type = normalizeAudienceType(value);

  if (type === "class") return "Turma específica";
  if (type === "all_parents") return "Todos os responsáveis";
  if (type === "teachers") return "Professores";
  if (type === "secretaria") return "Secretaria";
  if (type === "staff") return "Equipe escolar";

  return "Escola toda";
}

function getMessageDate(message: any) {
  return (
    cleanText(message?.published_at) ||
    cleanText(message?.publishedAt) ||
    cleanText(message?.created_at) ||
    cleanText(message?.createdAt) ||
    new Date().toISOString()
  );
}

async function getParentFromToken(token: string): Promise<ParentContext> {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false,
      status: 401,
      error: "Sessão inválida.",
    };
  }

  const userId = userData.user.id;

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false,
      status: 500,
      error: "Erro ao validar responsável: " + parentErr.message,
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false,
      status: 403,
      error: "Você não está cadastrado como responsável.",
    };
  }

  return {
    ok: true,
    userId,
    parentId: String(parent.id),
    schoolId: String(parent.school_id),
    parent,
  };
}

async function getSchoolInfo(schoolId: string) {
  try {
    const { data } = await supabaseAdmin
      .from("schools")
      .select("id, name, brand_name")
      .eq("id", schoolId)
      .maybeSingle();

    return {
      id: schoolId,
      name: cleanText((data as any)?.brand_name) || cleanText((data as any)?.name) || null,
    };
  } catch {
    return {
      id: schoolId,
      name: null,
    };
  }
}

async function getParentChildren(params: { schoolId: string; parentId: string }) {
  const { data: links, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, relationship, is_active")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("is_active", true);

  if (linkErr) {
    return [];
  }

  const studentIds = Array.from(
    new Set((links || []).map((row: any) => cleanText(row.student_id)).filter(Boolean))
  );

  if (studentIds.length === 0) return [];

  const relationshipByStudent = new Map<string, string | null>();

  for (const link of links || []) {
    relationshipByStudent.set(
      String((link as any).student_id),
      cleanText((link as any).relationship) || null
    );
  }

  const { data: students } = await supabaseAdmin
    .from("students")
    .select("id, full_name, registration_number")
    .eq("school_id", params.schoolId)
    .in("id", studentIds);

  return (students || [])
    .map((student: any) => ({
      id: String(student.id),
      fullName: cleanText(student.full_name) || "Aluno",
      registrationNumber: cleanText(student.registration_number) || null,
      relationship: relationshipByStudent.get(String(student.id)) || null,
    }))
    .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, "pt-BR"));
}

function buildMessageRow(message: any, recipient: any) {
  const publishedAt = getMessageDate(message);
  const audienceType = normalizeAudienceType(message?.audience_type);

  return {
    id: String(message.id),
    title: cleanText(message.title) || "Comunicado",
    body: cleanText(message.body),
    status: cleanText(message.status) || "published",
    audienceType,
    audienceLabel: getAudienceLabel(audienceType),
    targetClassId: cleanText(message.target_class_id) || null,
    targetRole: cleanText(message.target_role) || null,
    publishedAt,
    createdAt: cleanText(message.created_at) || publishedAt,
    recipient: recipient
      ? {
          id: String(recipient.id),
          deliveredAt: recipient.delivered_at || null,
          readAt: recipient.read_at || null,
          createdAt: recipient.created_at || null,
        }
      : null,
    flags: {
      unread: !recipient?.read_at,
      delivered: !!recipient?.delivered_at,
      read: !!recipient?.read_at,
      recent:
        new Date().getTime() - new Date(publishedAt).getTime() <=
        1000 * 60 * 60 * 24 * 7,
    },
  };
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError("Sessão não enviada.", 401);
    }

    const parentCheck = await getParentFromToken(token);

    if (!parentCheck.ok) {
      return jsonError(parentCheck.error, parentCheck.status);
    }

    const { parentId, schoolId, parent } = parentCheck;

    const [school, childrenResult] = await Promise.all([
      getSchoolInfo(schoolId),
      getParentChildren({ schoolId, parentId }),
    ]);

    const { data: recipients, error: recErr } = await supabaseAdmin
      .from("message_recipients")
      .select("id, message_id, delivered_at, read_at, created_at")
      .eq("school_id", schoolId)
      .eq("recipient_type", "parent")
      .eq("recipient_id", parentId)
      .order("created_at", { ascending: false });

    if (recErr) {
      return jsonError("Erro ao carregar comunicados recebidos: " + recErr.message, 500);
    }

    const recipientRows = recipients || [];

    const missingDelivered = recipientRows
      .filter((row: any) => !row.delivered_at)
      .map((row: any) => String(row.id))
      .filter(Boolean);

    if (missingDelivered.length > 0) {
      await supabaseAdmin
        .from("message_recipients")
        .update({ delivered_at: new Date().toISOString() })
        .in("id", missingDelivered)
        .eq("school_id", schoolId)
        .eq("recipient_type", "parent")
        .eq("recipient_id", parentId);
    }

    const messageIds = Array.from(
      new Set(recipientRows.map((row: any) => String(row.message_id)).filter(Boolean))
    );

    if (messageIds.length === 0) {
      return jsonOk({
        schoolId,
        schoolName: school.name,
        school,
        parentId,
        parentName: cleanText(parent.full_name) || null,
        children: childrenResult,
        messages: [],
        summary: {
          total: 0,
          unread: 0,
          read: 0,
          delivered: 0,
          recent: 0,
          children: childrenResult.length,
        },
      });
    }

    const { data: messages, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select(
        `
        id,
        school_id,
        created_by,
        title,
        body,
        status,
        audience_type,
        target_class_id,
        target_role,
        published_at,
        created_at
      `
      )
      .eq("school_id", schoolId)
      .eq("status", "published")
      .in("id", messageIds);

    if (msgErr) {
      return jsonError("Erro ao carregar comunicados: " + msgErr.message, 500);
    }

    const recipientByMessageId = new Map<string, any>();

    for (const rec of recipientRows) {
      recipientByMessageId.set(String((rec as any).message_id), rec);
    }

    const rows = (messages || [])
      .map((message: any) => buildMessageRow(message, recipientByMessageId.get(String(message.id))))
      .sort(
        (a: any, b: any) =>
          new Date(b.publishedAt || b.createdAt).getTime() -
          new Date(a.publishedAt || a.createdAt).getTime()
      );

    const unread = rows.filter((row: any) => !row.recipient?.readAt).length;
    const read = rows.filter((row: any) => !!row.recipient?.readAt).length;
    const delivered = rows.filter((row: any) => !!row.recipient?.deliveredAt).length;
    const recent = rows.filter((row: any) => row.flags?.recent).length;

    return jsonOk({
      schoolId,
      schoolName: school.name,
      school,
      parentId,
      parentName: cleanText(parent.full_name) || null,
      children: childrenResult,
      messages: rows,
      summary: {
        total: rows.length,
        unread,
        read,
        delivered,
        recent,
        children: childrenResult.length,
      },
      meta: {
        source: "parent_messages_v2",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar comunicados.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError("Sessão não enviada.", 401);
    }

    const parentCheck = await getParentFromToken(token);

    if (!parentCheck.ok) {
      return jsonError(parentCheck.error, parentCheck.status);
    }

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.messageId || body?.message_id || "").trim();

    if (!messageId) {
      return jsonError("messageId é obrigatório.", 422);
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("message_recipients")
      .update({
        delivered_at: now,
        read_at: now,
      })
      .eq("school_id", parentCheck.schoolId)
      .eq("message_id", messageId)
      .eq("recipient_type", "parent")
      .eq("recipient_id", parentCheck.parentId)
      .select("id, message_id, delivered_at, read_at")
      .maybeSingle();

    if (error) {
      return jsonError("Erro ao marcar comunicado como visualizado: " + error.message, 500);
    }

    if (!data?.id) {
      return jsonError("Comunicado não encontrado para este responsável.", 404);
    }

    return jsonOk({ recipient: data });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao marcar leitura.", 500);
  }
}