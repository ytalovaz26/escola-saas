import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

async function getParentFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      status: 500,
      error: "Erro ao validar responsável: " + parentErr.message,
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false as const,
      status: 403,
      error: "Você não está cadastrado como responsável.",
    };
  }

  return {
    ok: true as const,
    userId,
    parentId: String(parent.id),
    schoolId: String(parent.school_id),
    parent,
  };
}

async function getSchoolName(schoolId: string) {
  try {
    const { data } = await supabaseAdmin
      .from("schools")
      .select("name")
      .eq("id", schoolId)
      .maybeSingle();

    return data?.name || null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return jsonError("Sessão não enviada.", 401);
    }

    const parentCheck = await getParentFromToken(token);

    if (!parentCheck.ok) {
      return jsonError(parentCheck.error, parentCheck.status);
    }

    const { parentId, schoolId, parent } = parentCheck;
    const schoolName = await getSchoolName(schoolId);

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

    const missingDelivered = (recipients || [])
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
      new Set((recipients || []).map((row: any) => String(row.message_id)).filter(Boolean))
    );

    if (messageIds.length === 0) {
      return jsonOk({
        schoolId,
        schoolName,
        parentId,
        parentName: parent.full_name || null,
        messages: [],
        summary: {
          total: 0,
          unread: 0,
          read: 0,
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

    for (const rec of recipients || []) {
      recipientByMessageId.set(String((rec as any).message_id), rec);
    }

    const rows = (messages || [])
      .map((message: any) => {
        const rec = recipientByMessageId.get(String(message.id)) || null;

        return {
          id: String(message.id),
          title: message.title,
          body: message.body,
          status: message.status,
          audienceType: message.audience_type || "school",
          publishedAt: message.published_at || message.created_at,
          createdAt: message.created_at,
          recipient: rec
            ? {
                id: String(rec.id),
                deliveredAt: rec.delivered_at || new Date().toISOString(),
                readAt: rec.read_at || null,
              }
            : null,
        };
      })
      .sort(
        (a: any, b: any) =>
          new Date(b.publishedAt || b.createdAt).getTime() -
          new Date(a.publishedAt || a.createdAt).getTime()
      );

    const unread = rows.filter((row: any) => !row.recipient?.readAt).length;
    const read = rows.filter((row: any) => !!row.recipient?.readAt).length;

    return jsonOk({
      schoolId,
      schoolName,
      parentId,
      parentName: parent.full_name || null,
      messages: rows,
      summary: {
        total: rows.length,
        unread,
        read,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar comunicados.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

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