import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";

function jsonOk(body: Record<string, any> = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeStatus(value: unknown): InvoiceStatus {
  const raw = cleanText(value).toLowerCase();

  if (raw === "paid") return "paid";
  if (raw === "overdue") return "overdue";
  if (raw === "cancelled") return "cancelled";

  return "pending";
}

function statusLabel(status: string) {
  const safe = normalizeStatus(status);

  if (safe === "paid") return "Pago";
  if (safe === "overdue") return "Vencido";
  if (safe === "cancelled") return "Cancelado";

  return "Pendente";
}

async function getParentContext(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false as const,
      response: jsonError("Sessão não enviada.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: jsonError("Sessão inválida.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id, full_name, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao validar responsável: " + parentErr.message, 500),
    };
  }

  if (!parent?.id || !parent?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Você não está cadastrado como responsável.", 403),
    };
  }

  return {
    ok: true as const,
    userId: user.id,
    email: user.email || null,
    parentId: String(parent.id),
    schoolId: String(parent.school_id),
    parentName: cleanText(parent.full_name) || user.email || "Responsável",
    parentPhone: cleanText(parent.phone) || null,
  };
}

async function getParentChildren(params: { schoolId: string; parentId: string }) {
  const { data: links, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, relationship, is_active")
    .eq("school_id", params.schoolId)
    .eq("parent_id", params.parentId)
    .eq("is_active", true);

  if (linkErr) {
    throw new Error("Erro ao carregar vínculos dos alunos: " + linkErr.message);
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

  const { data: students, error: studentsErr } = await supabaseAdmin
    .from("students")
    .select("id, full_name, registration_number")
    .eq("school_id", params.schoolId)
    .in("id", studentIds);

  if (studentsErr) {
    throw new Error("Erro ao carregar alunos: " + studentsErr.message);
  }

  return (students || [])
    .map((student: any) => ({
      id: String(student.id),
      full_name: cleanText(student.full_name) || "Aluno",
      registration_number: cleanText(student.registration_number) || null,
      relationship: relationshipByStudent.get(String(student.id)) || null,
    }))
    .sort((a: any, b: any) => a.full_name.localeCompare(b.full_name, "pt-BR"));
}

function normalizeInvoice(row: any) {
  const status = normalizeStatus(row.status);

  return {
    id: String(row.id),
    school_id: String(row.school_id),
    student_id: String(row.student_id),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    title: cleanText(row.title) || "Mensalidade escolar",
    description: cleanText(row.description) || null,
    amount: Number(row.amount || 0),
    due_date: cleanText(row.due_date),
    paid_at: row.paid_at || null,
    status,
    status_label: statusLabel(status),
    payment_method: cleanText(row.payment_method) || null,
    notes: cleanText(row.notes) || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    student: row.student
      ? {
          id: String(row.student.id),
          full_name: cleanText(row.student.full_name) || "Aluno",
          registration_number: cleanText(row.student.registration_number) || null,
        }
      : null,
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await getParentContext(req);
    if (!ctx.ok) return ctx.response;

    const url = new URL(req.url);

    const today = new Date().toISOString().slice(0, 10);
    const from = cleanText(url.searchParams.get("from")) || today.slice(0, 8) + "01";
    const to = cleanText(url.searchParams.get("to")) || today;
    const status = cleanText(url.searchParams.get("status")) || "all";

    if (!isISODate(from)) return jsonError("Data inicial inválida.", 400);
    if (!isISODate(to)) return jsonError("Data final inválida.", 400);

    const children = await getParentChildren({
      schoolId: ctx.schoolId,
      parentId: ctx.parentId,
    });

    const childIds = children.map((child: any) => child.id);

    let query = supabaseAdmin
      .from("school_invoices")
      .select(
        `
        id,
        school_id,
        student_id,
        parent_id,
        title,
        description,
        amount,
        due_date,
        paid_at,
        status,
        payment_method,
        notes,
        created_at,
        updated_at,
        student:students(id, full_name, registration_number)
      `
      )
      .eq("school_id", ctx.schoolId)
      .eq("parent_id", ctx.parentId)
      .gte("due_date", from)
      .lte("due_date", to)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });

    if (childIds.length > 0) {
      query = query.in("student_id", childIds);
    }

    if (status !== "all") {
      query = query.eq("status", normalizeStatus(status));
    }

    const { data, error } = await query;

    if (error) {
      return jsonError("Erro ao carregar mensalidades: " + error.message, 500);
    }

    const invoices = (data || []).map(normalizeInvoice);

    const totalAmount = invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const paidAmount = invoices
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const pendingAmount = invoices
      .filter((invoice) => invoice.status === "pending" || invoice.status === "overdue")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    return jsonOk({
      parent: {
        parentId: ctx.parentId,
        name: ctx.parentName,
        phone: ctx.parentPhone,
        email: ctx.email,
      },
      children,
      invoices,
      range: { from, to },
      summary: {
        total: invoices.length,
        pending: invoices.filter((invoice) => invoice.status === "pending").length,
        paid: invoices.filter((invoice) => invoice.status === "paid").length,
        overdue: invoices.filter((invoice) => invoice.status === "overdue").length,
        cancelled: invoices.filter((invoice) => invoice.status === "cancelled").length,
        totalAmount,
        paidAmount,
        pendingAmount,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar mensalidades.", 500);
  }
}