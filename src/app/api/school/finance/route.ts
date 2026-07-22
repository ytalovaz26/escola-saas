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

function toMoneyNumber(value: unknown) {
  const raw = String(value || "0").replace(",", ".");
  const n = Number(raw);

  if (!Number.isFinite(n)) return 0;

  return Math.max(0, Math.round(n * 100) / 100);
}

async function getStaffContext(req: Request) {
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

  const { data: schoolUser, error: schoolUserErr } = await supabaseAdmin
    .from("school_users")
    .select("id, school_id, user_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (schoolUserErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao validar usuário da escola: " + schoolUserErr.message, 500),
    };
  }

  if (schoolUser?.school_id) {
    return {
      ok: true as const,
      userId: user.id,
      schoolId: String(schoolUser.school_id),
      role: cleanText((schoolUser as any).role),
    };
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, user_id, school_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (profileErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao validar perfil: " + profileErr.message, 500),
    };
  }

  if (!profile?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Usuário não vinculado a uma escola.", 403),
    };
  }

  return {
    ok: true as const,
    userId: user.id,
    schoolId: String(profile.school_id),
    role: cleanText((profile as any).role),
  };
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
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    student: row.student
      ? {
          id: String(row.student.id),
          full_name: cleanText(row.student.full_name) || "Aluno",
          registration_number: cleanText(row.student.registration_number) || null,
        }
      : null,
    parent: row.parent
      ? {
          id: String(row.parent.id),
          full_name: cleanText(row.parent.full_name) || "Responsável",
          phone: cleanText(row.parent.phone) || null,
        }
      : null,
  };
}

async function getStudentsWithParents(schoolId: string) {
  const { data: students, error: studentsErr } = await supabaseAdmin
    .from("students")
    .select("id, full_name, registration_number")
    .eq("school_id", schoolId)
    .order("full_name", { ascending: true });

  if (studentsErr) {
    throw new Error("Erro ao carregar alunos: " + studentsErr.message);
  }

  const studentIds = (students || []).map((student: any) => String(student.id));

  if (studentIds.length === 0) return [];

  const { data: links } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, parent_id, is_active")
    .eq("school_id", schoolId)
    .in("student_id", studentIds)
    .eq("is_active", true);

  const parentIds = Array.from(
    new Set((links || []).map((row: any) => cleanText(row.parent_id)).filter(Boolean))
  );

  let parentsById = new Map<string, any>();

  if (parentIds.length > 0) {
    const { data: parents } = await supabaseAdmin
      .from("parents")
      .select("id, full_name, phone")
      .eq("school_id", schoolId)
      .in("id", parentIds);

    parentsById = new Map((parents || []).map((parent: any) => [String(parent.id), parent]));
  }

  const linksByStudentId = new Map<string, any[]>();

  for (const link of links || []) {
    const studentId = String((link as any).student_id);

    if (!linksByStudentId.has(studentId)) linksByStudentId.set(studentId, []);
    linksByStudentId.get(studentId)!.push(link);
  }

  return (students || []).map((student: any) => {
    const studentLinks = linksByStudentId.get(String(student.id)) || [];

    const parents = studentLinks
      .map((link: any) => parentsById.get(String(link.parent_id)))
      .filter(Boolean)
      .map((parent: any) => ({
        id: String(parent.id),
        full_name: cleanText(parent.full_name) || "Responsável",
        phone: cleanText(parent.phone) || null,
      }));

    return {
      id: String(student.id),
      full_name: cleanText(student.full_name) || "Aluno",
      registration_number: cleanText(student.registration_number) || null,
      parents,
      default_parent_id: parents[0]?.id || null,
    };
  });
}

export async function GET(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const url = new URL(req.url);

    const today = new Date().toISOString().slice(0, 10);
    const from = cleanText(url.searchParams.get("from")) || today.slice(0, 8) + "01";
    const to = cleanText(url.searchParams.get("to")) || today;
    const status = cleanText(url.searchParams.get("status")) || "all";

    if (!isISODate(from)) return jsonError("Data inicial inválida.", 400);
    if (!isISODate(to)) return jsonError("Data final inválida.", 400);

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
        created_by,
        created_at,
        updated_at,
        student:students(id, full_name, registration_number),
        parent:parents(id, full_name, phone)
      `
      )
      .eq("school_id", ctx.schoolId)
      .gte("due_date", from)
      .lte("due_date", to)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", normalizeStatus(status));
    }

    const { data, error } = await query;

    if (error) {
      return jsonError("Erro ao carregar mensalidades: " + error.message, 500);
    }

    const invoices = (data || []).map(normalizeInvoice);
    const students = await getStudentsWithParents(ctx.schoolId);

    const totalAmount = invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const paidAmount = invoices
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const pendingAmount = invoices
      .filter((invoice) => invoice.status === "pending" || invoice.status === "overdue")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    return jsonOk({
      invoices,
      students,
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
    return jsonError(e?.message || "Erro interno ao carregar financeiro.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const body = await req.json().catch(() => ({}));

    const studentId = cleanText(body.studentId || body.student_id);
    const parentId = cleanText(body.parentId || body.parent_id);
    const title = cleanText(body.title) || "Mensalidade escolar";
    const description = cleanText(body.description);
    const amount = toMoneyNumber(body.amount);
    const dueDate = cleanText(body.dueDate || body.due_date);
    const status = normalizeStatus(body.status);
    const paymentMethod = cleanText(body.paymentMethod || body.payment_method);
    const notes = cleanText(body.notes);

    if (!studentId) return jsonError("Selecione o aluno.", 422);
    if (!dueDate || !isISODate(dueDate)) return jsonError("Informe um vencimento válido.", 422);
    if (amount <= 0) return jsonError("Informe um valor maior que zero.", 422);

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();

    if (studentErr) return jsonError("Erro ao validar aluno: " + studentErr.message, 500);
    if (!student?.id) return jsonError("Aluno não encontrado nesta escola.", 404);

    const paidAt = status === "paid" ? new Date().toISOString() : null;

    const { data, error } = await supabaseAdmin
      .from("school_invoices")
      .insert({
        school_id: ctx.schoolId,
        student_id: studentId,
        parent_id: parentId || null,
        title,
        description: description || null,
        amount,
        due_date: dueDate,
        paid_at: paidAt,
        status,
        payment_method: paymentMethod || null,
        notes: notes || null,
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
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
        created_by,
        created_at,
        updated_at,
        student:students(id, full_name, registration_number),
        parent:parents(id, full_name, phone)
      `
      )
      .single();

    if (error) return jsonError("Erro ao criar mensalidade: " + error.message, 500);

    return jsonOk({ invoice: normalizeInvoice(data) });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao criar mensalidade.", 500);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const body = await req.json().catch(() => ({}));

    const id = cleanText(body.id);
    const studentId = cleanText(body.studentId || body.student_id);
    const parentId = cleanText(body.parentId || body.parent_id);
    const title = cleanText(body.title) || "Mensalidade escolar";
    const description = cleanText(body.description);
    const amount = toMoneyNumber(body.amount);
    const dueDate = cleanText(body.dueDate || body.due_date);
    const status = normalizeStatus(body.status);
    const paymentMethod = cleanText(body.paymentMethod || body.payment_method);
    const notes = cleanText(body.notes);

    if (!id) return jsonError("ID da mensalidade é obrigatório.", 422);
    if (!studentId) return jsonError("Selecione o aluno.", 422);
    if (!dueDate || !isISODate(dueDate)) return jsonError("Informe um vencimento válido.", 422);
    if (amount <= 0) return jsonError("Informe um valor maior que zero.", 422);

    const paidAt = status === "paid" ? new Date().toISOString() : null;

    const { data, error } = await supabaseAdmin
      .from("school_invoices")
      .update({
        student_id: studentId,
        parent_id: parentId || null,
        title,
        description: description || null,
        amount,
        due_date: dueDate,
        paid_at: paidAt,
        status,
        payment_method: paymentMethod || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("school_id", ctx.schoolId)
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
        created_by,
        created_at,
        updated_at,
        student:students(id, full_name, registration_number),
        parent:parents(id, full_name, phone)
      `
      )
      .maybeSingle();

    if (error) return jsonError("Erro ao atualizar mensalidade: " + error.message, 500);
    if (!data?.id) return jsonError("Mensalidade não encontrada.", 404);

    return jsonOk({ invoice: normalizeInvoice(data) });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar mensalidade.", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getStaffContext(req);
    if (!ctx.ok) return ctx.response;

    const url = new URL(req.url);
    const id = cleanText(url.searchParams.get("id"));

    if (!id) return jsonError("ID da mensalidade é obrigatório.", 422);

    const { error } = await supabaseAdmin
      .from("school_invoices")
      .delete()
      .eq("id", id)
      .eq("school_id", ctx.schoolId);

    if (error) return jsonError("Erro ao excluir mensalidade: " + error.message, 500);

    return jsonOk({ deleted: true, id });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao excluir mensalidade.", 500);
  }
}