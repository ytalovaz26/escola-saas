import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      return jsonError("ID do aluno é obrigatório.", 400);
    }

    const body = await req.json().catch(() => ({}));
    const action = cleanText(body.action || "archive");
    const reason = cleanText(body.reason || body.archive_reason);

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id, full_name, status, is_active")
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao validar aluno: " + studentErr.message, 500);
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado nesta escola.", 404);
    }

    if (action === "reactivate") {
      const { data, error } = await supabaseAdmin
        .from("students")
        .update({
          status: "active",
          is_active: true,
          archived_at: null,
          archived_by: null,
          archive_reason: null,
        })
        .eq("id", studentId)
        .eq("school_id", guard.schoolId)
        .select("id, school_id, full_name, status, is_active, archived_at, archive_reason")
        .single();

      if (error) {
        return jsonError("Erro ao reativar aluno: " + error.message, 500);
      }

      return jsonOk({
        student: data,
        message: "Aluno reativado com sucesso.",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .update({
        status: "archived",
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_by: guard.userId,
        archive_reason: reason || "Aluno arquivado pela escola.",
      })
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .select("id, school_id, full_name, status, is_active, archived_at, archive_reason")
      .single();

    if (error) {
      return jsonError("Erro ao arquivar aluno: " + error.message, 500);
    }

    await supabaseAdmin
      .from("student_classes")
      .update({ is_active: false })
      .eq("student_id", studentId)
      .eq("school_id", guard.schoolId)
      .eq("is_active", true);

    return jsonOk({
      student: data,
      message: "Aluno arquivado com sucesso.",
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao arquivar/reativar aluno.", 500);
  }
}