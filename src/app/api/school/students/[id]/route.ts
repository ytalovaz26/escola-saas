import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

const STUDENT_PHOTOS_BUCKET = "student-photos";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const { id } = await ctx.params;
    const studentId = String(id || "").trim();

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

    return NextResponse.json({
      ok: true,
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