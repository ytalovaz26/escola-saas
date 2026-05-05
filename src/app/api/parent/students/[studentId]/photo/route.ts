import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const STUDENT_PHOTOS_BUCKET = "student-photos";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
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

async function getAuthenticatedParent(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false as const,
      response: jsonError("Missing Authorization Bearer token.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: jsonError("Invalid token/session.", 401),
    };
  }

  const userId = String(userData.user.id);

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      response: jsonError("parents lookup failed: " + parentErr.message, 500),
    };
  }

  if (!parent?.id) {
    return {
      ok: false as const,
      response: jsonError("Not a parent.", 403),
    };
  }

  return {
    ok: true as const,
    parent,
    userId,
  };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ studentId: string }> }
) {
  try {
    const auth = await getAuthenticatedParent(req);
    if (!auth.ok) return auth.response;

    const params = await context.params;
    const studentId = String(params.studentId || "").trim();

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    const { data: link, error: linkErr } = await supabaseAdmin
      .from("student_parents")
      .select("id, school_id, student_id, parent_id, is_active")
      .eq("school_id", auth.parent.school_id)
      .eq("student_id", studentId)
      .eq("parent_id", auth.parent.id)
      .eq("is_active", true)
      .maybeSingle();

    if (linkErr) {
      return jsonError("Erro ao validar vínculo responsável/aluno: " + linkErr.message, 500);
    }

    if (!link?.id) {
      return jsonError("Você não tem permissão para alterar este aluno.", 403);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id")
      .eq("id", studentId)
      .eq("school_id", auth.parent.school_id)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao validar aluno: " + studentErr.message, 500);
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado.", 404);
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

    const filePath = `${auth.parent.school_id}/${studentId}/parent-upload-${now}.${ext}`;

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
      .eq("school_id", auth.parent.school_id);

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