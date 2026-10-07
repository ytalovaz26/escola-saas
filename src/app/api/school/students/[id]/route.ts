import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDENT_PHOTOS_BUCKET = "student-photos";

function jsonOk(body: Record<string, any> = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function getStudentIdFromRequest(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "students");

  if (index >= 0 && parts[index + 1]) {
    return cleanText(parts[index + 1]);
  }

  return "";
}

function getExtFromFile(file: File) {
  const name = String(file.name || "").toLowerCase();
  const fromName = name.includes(".") ? name.split(".").pop() : "";

  if (fromName && ["jpg", "jpeg", "png", "webp"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  const type = String(file.type || "").toLowerCase();

  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";

  return "jpg";
}

async function safeCount(table: string, filters: Array<[string, string, any]>) {
  try {
    let query = supabaseAdmin.from(table).select("id", {
      count: "exact",
      head: true,
    });

    for (const [column, operator, value] of filters) {
      if (operator === "eq") query = query.eq(column, value);
      if (operator === "neq") query = query.neq(column, value);
      if (operator === "in") query = query.in(column, value);
      if (operator === "not") query = query.not(column, "is", value);
    }

    const { count, error } = await query;

    if (error) {
      if (
        error.message?.includes("does not exist") ||
        error.message?.includes("schema cache")
      ) {
        return 0;
      }

      throw error;
    }

    return count || 0;
  } catch {
    return 0;
  }
}

async function safeDelete(table: string, filters: Array<[string, string, any]>) {
  let query = supabaseAdmin.from(table).delete();

  for (const [column, operator, value] of filters) {
    if (operator === "eq") query = query.eq(column, value);
    if (operator === "neq") query = query.neq(column, value);
    if (operator === "in") query = query.in(column, value);
  }

  const { error } = await query;

  if (error) {
    if (
      error.message?.includes("does not exist") ||
      error.message?.includes("schema cache")
    ) {
      return;
    }

    throw error;
  }
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "secretary",
    "diretor",
    "coordenador",
    "secretaria",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const studentId = getStudentIdFromRequest(req);

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao validar aluno: " + studentErr.message, 500);
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado nesta escola.", 404);
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonError("Envie uma imagem no campo file.", 400);
    }

    if (!file.type.startsWith("image/")) {
      return jsonError("O arquivo precisa ser uma imagem.", 400);
    }

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      return jsonError("A imagem deve ter no máximo 5MB.", 400);
    }

    const ext = getExtFromFile(file);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filePath = `${guard.schoolId}/${studentId}/profile-${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(STUDENT_PHOTOS_BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });

    if (uploadErr) {
      return jsonError("Erro ao enviar foto: " + uploadErr.message, 500, {
        bucket: STUDENT_PHOTOS_BUCKET,
        path: filePath,
      });
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(STUDENT_PHOTOS_BUCKET)
      .getPublicUrl(filePath);

    const photoUrl = publicData.publicUrl;

    const { error: updateErr } = await supabaseAdmin
      .from("students")
      .update({
        student_photo_url: photoUrl,
        student_profile_updated_at: new Date().toISOString(),
      })
      .eq("id", studentId)
      .eq("school_id", guard.schoolId);

    if (updateErr) {
      return jsonError("Foto enviada, mas houve erro ao salvar no aluno: " + updateErr.message, 500);
    }

    return jsonOk({
      saved: true,
      studentId,
      photoUrl,
      bucket: STUDENT_PHOTOS_BUCKET,
      path: filePath,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao enviar foto do aluno.", 500);
  }
}

export async function DELETE(req: Request) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "secretary",
    "diretor",
    "coordenador",
    "secretaria",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const studentId = getStudentIdFromRequest(req);

    if (!studentId) {
      return jsonError("ID do aluno é obrigatório.", 400);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id, full_name")
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao validar aluno: " + studentErr.message, 500);
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado nesta escola.", 404);
    }

    const attendanceCount = await safeCount("attendance_records", [
      ["student_id", "eq", studentId],
    ]);

    const reportCardCount = await safeCount("report_cards", [
      ["student_id", "eq", studentId],
      ["school_id", "eq", guard.schoolId],
    ]);

    const paidInvoiceCount = await safeCount("school_invoices", [
      ["student_id", "eq", studentId],
      ["school_id", "eq", guard.schoolId],
      ["status", "eq", "paid"],
    ]);

    const generatedInvoiceCount = await safeCount("school_invoices", [
      ["student_id", "eq", studentId],
      ["school_id", "eq", guard.schoolId],
      ["gateway_payment_id", "not", null],
    ]);

    const hasRealHistory =
      attendanceCount > 0 ||
      reportCardCount > 0 ||
      paidInvoiceCount > 0 ||
      generatedInvoiceCount > 0;

    if (hasRealHistory) {
      return jsonError(
        "Este aluno já possui histórico escolar ou financeiro. Para preservar relatórios, chamadas e registros da escola, ele não pode ser excluído definitivamente. Use a opção de inativar/arquivar quando ela estiver disponível.",
        409,
        {
          canDelete: false,
          history: {
            attendance: attendanceCount,
            reportCards: reportCardCount,
            paidInvoices: paidInvoiceCount,
            generatedInvoices: generatedInvoiceCount,
          },
        }
      );
    }

    await safeDelete("student_classes", [
      ["student_id", "eq", studentId],
      ["school_id", "eq", guard.schoolId],
    ]);

    await safeDelete("student_parents", [
      ["student_id", "eq", studentId],
      ["school_id", "eq", guard.schoolId],
    ]);

    await safeDelete("school_invoices", [
      ["student_id", "eq", studentId],
      ["school_id", "eq", guard.schoolId],
    ]);

    const { error: deleteErr } = await supabaseAdmin
      .from("students")
      .delete()
      .eq("id", studentId)
      .eq("school_id", guard.schoolId);

    if (deleteErr) {
      return jsonError(
        "Não foi possível excluir o aluno. Ainda existe algum vínculo ou histórico relacionado a ele.",
        500,
        {
          details: deleteErr.message,
        }
      );
    }

    return jsonOk({
      deleted: true,
      studentId,
      message: "Aluno excluído com sucesso.",
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao excluir aluno.", 500);
  }
}