import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const STUDENT_PHOTOS_BUCKET = "student-photos";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
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

  if (!parent?.id || !parent?.school_id) {
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

async function validateStudentAccess(parentId: string, schoolId: string, studentId: string) {
  const { data: link, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("parent_id", parentId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .maybeSingle();

  if (linkErr) {
    return { ok: false as const, error: "Erro ao validar vínculo: " + linkErr.message };
  }

  if (!link?.id) {
    return { ok: false as const, error: "Você não tem permissão para atualizar este aluno." };
  }

  const { data: student, error: studentErr } = await supabaseAdmin
    .from("students")
    .select("id, school_id, student_photo_url")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (studentErr) {
    return { ok: false as const, error: "Erro ao buscar aluno: " + studentErr.message };
  }

  if (!student?.id) {
    return { ok: false as const, error: "Aluno não encontrado." };
  }

  return { ok: true as const, student };
}

export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const auth = await getAuthenticatedParent(req);
  if (!auth.ok) return auth.response;

  try {
    const { studentId: rawStudentId } = await ctx.params;
    const studentId = String(rawStudentId || "").trim();

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    const access = await validateStudentAccess(
      String(auth.parent.id),
      String(auth.parent.school_id),
      studentId
    );

    if (!access.ok) {
      return jsonError(access.error, 403);
    }

    return NextResponse.json({
      ok: true,
      studentId,
      photoUrl: access.student.student_photo_url || null,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao buscar foto do aluno.", 500);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const auth = await getAuthenticatedParent(req);
  if (!auth.ok) return auth.response;

  try {
    const { studentId: rawStudentId } = await ctx.params;
    const studentId = String(rawStudentId || "").trim();
    const schoolId = String(auth.parent.school_id || "");
    const parentId = String(auth.parent.id || "");

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    const access = await validateStudentAccess(parentId, schoolId, studentId);

    if (!access.ok) {
      return jsonError(access.error, 403);
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

    const filePath = `${schoolId}/${studentId}/parent-upload-${Date.now()}.${ext}`;

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
      .eq("school_id", schoolId);

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