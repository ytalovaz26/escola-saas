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

  const canRead =
    role === "diretor" ||
    role === "coordenador" ||
    role === "secretaria" ||
    role === "admin";

  if (!canRead) {
    return {
      ok: false as const,
      status: 403,
      error: "Sem permissão para visualizar comunicados da gestão.",
    };
  }

  return {
    ok: true as const,
    userId,
    schoolId: String(staff.school_id),
    role,
  };
}

function audienceLabel(message: any) {
  const type = String(message.audience_type || "school");

  if (type === "class") return "Turma específica";
  if (type === "teachers") return "Professores";
  if (type === "secretaria") return "Secretaria";
  if (type === "staff") return "Equipe escolar";
  if (type === "all_parents") return "Todos os responsáveis";

  return "Escola toda";
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) return jsonError("Sessão não enviada.", 401);

    const staffCheck = await getStaffFromToken(token);
    if (!staffCheck.ok) return jsonError(staffCheck.error, staffCheck.status);

    const schoolId = staffCheck.schoolId;

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
      .order("created_at", { ascending: false })
      .limit(500);

    if (msgErr) {
      return jsonError("Erro ao carregar comunicados: " + msgErr.message, 500);
    }

    const messageIds = (messages || []).map((m: any) => String(m.id)).filter(Boolean);

    let statsByMessage = new Map<string, any>();

    if (messageIds.length > 0) {
      const { data: recipients, error: recErr } = await supabaseAdmin
        .from("message_recipients")
        .select("message_id, delivered_at, read_at")
        .eq("school_id", schoolId)
        .in("message_id", messageIds);

      if (recErr) {
        return jsonError("Erro ao carregar status dos comunicados: " + recErr.message, 500);
      }

      for (const row of recipients || []) {
        const messageId = String((row as any).message_id);
        const current = statsByMessage.get(messageId) || {
          sent: 0,
          delivered: 0,
          read: 0,
          pending: 0,
        };

        current.sent += 1;
        if ((row as any).delivered_at) current.delivered += 1;
        if ((row as any).read_at) current.read += 1;

        statsByMessage.set(messageId, current);
      }

      for (const [messageId, stat] of statsByMessage.entries()) {
        stat.pending = Math.max(0, stat.sent - stat.read);
        statsByMessage.set(messageId, stat);
      }
    }

    const classIds = Array.from(
      new Set(
        (messages || [])
          .map((m: any) => String(m.target_class_id || ""))
          .filter(Boolean)
      )
    );

    let classById = new Map<string, any>();

    if (classIds.length > 0) {
      const { data: classes, error: clsErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("school_id", schoolId)
        .in("id", classIds);

      if (clsErr) {
        return jsonError("Erro ao carregar turmas dos comunicados: " + clsErr.message, 500);
      }

      classById = new Map((classes || []).map((cls: any) => [String(cls.id), cls]));
    }

    const rows = (messages || []).map((message: any) => {
      const stats = statsByMessage.get(String(message.id)) || {
        sent: 0,
        delivered: 0,
        read: 0,
        pending: 0,
      };

      return {
        ...message,
        audienceLabel: audienceLabel(message),
        targetClass: message.target_class_id
          ? classById.get(String(message.target_class_id)) || null
          : null,
        stats,
      };
    });

    return jsonOk({ messages: rows });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar comunicados.", 500);
  }
}