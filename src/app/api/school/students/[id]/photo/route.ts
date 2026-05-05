import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

const STUDENT_PHOTOS_BUCKET = "student-photos";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function sanitizeExtension(fileName: string, mimeType: string) {
  const lower = String(fileName || "").toLowerCase();

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";

  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";

  return "jpg";
}

function isAllowedImage(mimeType: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
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
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const studentId = String(params.id || "").trim();

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

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return jsonError("Envie a imagem no campo 'file'.", 400);
    }

    if (!isAllowedImage(file.type)) {
      return jsonError("Formato inválido. Envie JPG, PNG ou WEBP.", 415, {
        receivedType: file.type,
      });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return jsonError("Imagem muito grande. O limite é 5MB.", 413, {
        maxSizeMb: 5,
      });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = sanitizeExtension(file.name, file.type);
    const now = Date.now();

    const filePath = `${guard.schoolId}/${studentId}/student-${now}.${ext}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(STUDENT_PHOTOS_BUCKET)
      .upload(filePath, bytes, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadErr) {
      return jsonError("Erro ao enviar foto do aluno.", 500, {
        details: uploadErr.message,
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
        photo_url: photoUrl,
        student_profile_updated_at: new Date().toISOString(),
      })
      .eq("id", studentId)
      .eq("school_id", guard.schoolId);

    if (updateErr) {
      return jsonError("Foto enviada, mas não foi possível salvar no aluno.", 500, {
        details: updateErr.message,
        photoUrl,
      });
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