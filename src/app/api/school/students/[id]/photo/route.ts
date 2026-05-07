// src/app/api/school/students/[id]/photo/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

const STUDENT_PHOTOS_BUCKET = "student-photos";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function sanitizeExtension(fileName: string, mimeType: string) {
  const lower = String(fileName || "").toLowerCase();

  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".jpg")) return "jpg";
  if (lower.endsWith(".jpeg")) return "jpg";

  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg") return "jpg";

  return "jpg";
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const studentId = String(params?.id || "").trim();
    const schoolId = guard.schoolId;
    const uploadedBy =
      (guard as any).userId ||
      (guard as any).authUserId ||
      (guard as any).user?.id ||
      null;

    if (!schoolId) {
      return jsonError("Escola não identificada.", 401);
    }

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao validar aluno: " + studentErr.message, 500);
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado nesta escola.", 404);
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return jsonError("Arquivo de imagem não enviado.", 400);
    }

    if (!file.type.startsWith("image/")) {
      return jsonError("Envie um arquivo de imagem válido.", 400);
    }

    if (file.size > 5 * 1024 * 1024) {
      return jsonError("A foto deve ter no máximo 5MB.", 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const extension = sanitizeExtension(file.name, file.type);
    const version = Date.now();

    const filePath = `${schoolId}/${studentId}/profile-${version}.${extension}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(STUDENT_PHOTOS_BUCKET)
      .upload(filePath, bytes, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });

    if (uploadErr) {
      return jsonError("Erro ao enviar foto para o storage: " + uploadErr.message, 500, {
        bucket: STUDENT_PHOTOS_BUCKET,
        path: filePath,
      });
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(STUDENT_PHOTOS_BUCKET)
      .getPublicUrl(filePath);

    const photoUrl = publicData?.publicUrl || null;

    if (!photoUrl) {
      return jsonError("Não foi possível gerar URL pública da foto.", 500, {
        bucket: STUDENT_PHOTOS_BUCKET,
        path: filePath,
      });
    }

    const now = new Date().toISOString();

    const { data: updatedStudent, error: updateErr } = await supabaseAdmin
      .from("students")
      .update({
        student_photo_url: photoUrl,
        student_photo_uploaded_at: now,
        student_photo_uploaded_by: uploadedBy,
        student_profile_updated_at: now,
      })
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .select(
        `
        id,
        school_id,
        full_name,
        student_photo_url,
        student_photo_uploaded_at,
        student_photo_uploaded_by,
        student_profile_updated_at
      `
      )
      .maybeSingle();

    if (updateErr) {
      return jsonError("Foto enviada, mas não foi possível salvar no aluno: " + updateErr.message, 500, {
        bucket: STUDENT_PHOTOS_BUCKET,
        path: filePath,
        photoUrl,
      });
    }

    if (!updatedStudent?.id) {
      return jsonError("Foto enviada, mas o aluno não foi atualizado no banco.", 500, {
        bucket: STUDENT_PHOTOS_BUCKET,
        path: filePath,
        photoUrl,
      });
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      studentId,
      schoolId,
      photoUrl,
      studentPhotoUrl: photoUrl,
      student: updatedStudent,
      bucket: STUDENT_PHOTOS_BUCKET,
      path: filePath,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao enviar foto do aluno.", 500);
  }
}