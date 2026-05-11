import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function normalizeRole(role?: string | null) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin") return "admin";

  return r;
}

async function getStaffFromToken(token: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }

  const userId = userData.user.id;

  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (staffErr) {
    return {
      ok: false as const,
      status: 500,
      error: "Erro ao validar usuário escolar: " + staffErr.message,
    };
  }

  if (!staff?.school_id) {
    return { ok: false as const, status: 403, error: "Usuário sem escola ativa." };
  }

  const role = normalizeRole(staff.role);

  const canManage =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canManage) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para gerenciar comunicados.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

async function getMessageOrFail(messageId: string, schoolId: string) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, school_id, title, body, status")
    .eq("id", messageId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, status: 500, error: "Erro ao buscar comunicado: " + error.message };
  }

  if (!data?.id) {
    return { ok: false as const, status: 404, error: "Comunicado não encontrado." };
  }

  return { ok: true as const, message: data };
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const messageId = String(params?.id || "").trim();

    if (!messageId) return jsonError("ID do comunicado é obrigatório.", 422);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);
    if (!staffCheck.ok) return jsonError(staffCheck.error, staffCheck.status);

    const existing = await getMessageOrFail(messageId, staffCheck.schoolId);
    if (!existing.ok) return jsonError(existing.error, existing.status);

    const body = await req.json().catch(() => ({}));

    const title = String(body?.title ?? "").trim();
    const messageBody = String(body?.body ?? "").trim();

    if (!title) return jsonError("Informe o título do comunicado.", 422);
    if (!messageBody) return jsonError("Informe o conteúdo do comunicado.", 422);

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("messages")
      .update({
        title,
        body: messageBody,
      })
      .eq("id", messageId)
      .eq("school_id", staffCheck.schoolId)
      .select(
        "id, school_id, created_by, title, body, status, audience_type, target_class_id, target_role, published_at, created_at"
      )
      .single();

    if (updateErr) {
      return jsonError("Erro ao atualizar comunicado: " + updateErr.message, 500);
    }

    return jsonOk({ message: updated });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar comunicado.", 500);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const messageId = String(params?.id || "").trim();

    if (!messageId) return jsonError("ID do comunicado é obrigatório.", 422);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);
    if (!staffCheck.ok) return jsonError(staffCheck.error, staffCheck.status);

    const existing = await getMessageOrFail(messageId, staffCheck.schoolId);
    if (!existing.ok) return jsonError(existing.error, existing.status);

    const { error: recipientsErr } = await supabaseAdmin
      .from("message_recipients")
      .delete()
      .eq("school_id", staffCheck.schoolId)
      .eq("message_id", messageId);

    if (recipientsErr) {
      return jsonError(
        "Erro ao remover destinatários do comunicado: " + recipientsErr.message,
        500
      );
    }

    const { error: deleteErr } = await supabaseAdmin
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("school_id", staffCheck.schoolId);

    if (deleteErr) {
      return jsonError("Erro ao excluir comunicado: " + deleteErr.message, 500);
    }

    return jsonOk({ deleted: true, id: messageId });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao excluir comunicado.", 500);
  }
}