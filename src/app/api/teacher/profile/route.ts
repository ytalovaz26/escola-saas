import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type TeacherProfileMetadata = {
  full_name?: string;
  fullName?: string;
  name?: string;
  nome?: string;
  display_name?: string;
  phone?: string;
  telefone?: string;
  avatar_url?: string;
  photo_url?: string;
  photoUrl?: string;
  picture?: string;
  teacher_photo_url?: string;
};

function jsonOk(body: any, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isTeacherRole(role: unknown) {
  const r = normalizeRole(role);
  return r === "professor" || r === "teacher";
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function titleCaseWord(value: string) {
  const safe = cleanText(value);

  if (!safe) return "";

  return safe.charAt(0).toUpperCase() + safe.slice(1).toLowerCase();
}

function nameFromEmail(email?: string | null) {
  const safe = cleanText(email);

  if (!safe) return "Professor";

  const beforeAt = safe.split("@")[0] || safe;

  const parts = beforeAt
    .split(/[.\-_ ]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "Professor";

  return parts.slice(0, 2).map(titleCaseWord).join(" ");
}

function getInitials(name?: string | null) {
  const safe = cleanText(name);

  if (!safe) return "PR";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function getNameFromMetadata(metadata: TeacherProfileMetadata, email?: string | null) {
  return (
    cleanText(metadata.full_name) ||
    cleanText(metadata.fullName) ||
    cleanText(metadata.name) ||
    cleanText(metadata.nome) ||
    cleanText(metadata.display_name) ||
    nameFromEmail(email)
  );
}

function getPhoneFromMetadata(metadata: TeacherProfileMetadata) {
  return cleanText(metadata.phone) || cleanText(metadata.telefone) || "";
}

function getPhotoFromMetadata(metadata: TeacherProfileMetadata) {
  return (
    cleanText(metadata.avatar_url) ||
    cleanText(metadata.photo_url) ||
    cleanText(metadata.photoUrl) ||
    cleanText(metadata.picture) ||
    cleanText(metadata.teacher_photo_url) ||
    null
  );
}

function extensionFromMime(mime: string) {
  const clean = cleanText(mime).toLowerCase();

  if (clean.includes("png")) return "png";
  if (clean.includes("webp")) return "webp";
  if (clean.includes("gif")) return "gif";
  if (clean.includes("jpeg")) return "jpg";
  if (clean.includes("jpg")) return "jpg";

  return "jpg";
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

    if (!match) return null;

    const mime = match[1];
    const base64 = match[2];

    if (!mime || !base64) return null;

    return {
      mime,
      buffer: Buffer.from(base64, "base64"),
    };
  } catch {
    return null;
  }
}

async function ensureTeacherPhotosBucket() {
  const bucketName = "teacher-photos";

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();

  if (!listErr && Array.isArray(buckets)) {
    const exists = buckets.some((bucket) => bucket.name === bucketName);

    if (exists) return bucketName;
  }

  await supabaseAdmin.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  });

  return bucketName;
}

async function uploadTeacherPhoto(params: {
  schoolId: string;
  userId: string;
  dataUrl: string;
}) {
  const parsed = parseDataUrl(params.dataUrl);

  if (!parsed) {
    throw new Error("Imagem inválida. Envie uma imagem em formato válido.");
  }

  if (!parsed.mime.startsWith("image/")) {
    throw new Error("O arquivo enviado precisa ser uma imagem.");
  }

  if (parsed.buffer.length > 5 * 1024 * 1024) {
    throw new Error("A imagem precisa ter no máximo 5MB.");
  }

  const bucket = await ensureTeacherPhotosBucket();
  const ext = extensionFromMime(parsed.mime);
  const path = `${params.schoolId}/${params.userId}/profile-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, parsed.buffer, {
      contentType: parsed.mime,
      upsert: true,
    });

  if (uploadErr) {
    throw new Error("Falha ao enviar foto: " + uploadErr.message);
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);

  const publicUrl = data?.publicUrl || "";

  if (!publicUrl) {
    throw new Error("Não foi possível gerar URL pública da foto.");
  }

  return publicUrl;
}

async function getTeacherContext(req: Request) {
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
      response: jsonError("Sessão inválida.", 401, {
        details: userErr?.message,
      }),
    };
  }

  const user = userData.user;

  const { data: schoolUser, error: suErr } = await supabaseAdmin
    .from("school_users")
    .select("school_id, role, is_active, created_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (suErr) {
    return {
      ok: false as const,
      response: jsonError("Falha ao buscar vínculo escolar: " + suErr.message, 500),
    };
  }

  if (!schoolUser?.school_id) {
    return {
      ok: false as const,
      response: jsonError("Usuário não vinculado a uma escola.", 403),
    };
  }

  if (!isTeacherRole(schoolUser.role)) {
    return {
      ok: false as const,
      response: jsonError(`Acesso negado. Role atual: "${schoolUser.role || "—"}".`, 403),
    };
  }

  return {
    ok: true as const,
    user,
    schoolId: String(schoolUser.school_id),
    role: String(schoolUser.role || "professor"),
  };
}

export async function GET(req: Request) {
  const ctx = await getTeacherContext(req);

  if (!ctx.ok) return ctx.response;

  const metadata = ((ctx.user.user_metadata || {}) as TeacherProfileMetadata) || {};
  const email = cleanText(ctx.user.email);

  const fullName = getNameFromMetadata(metadata, email);
  const phone = getPhoneFromMetadata(metadata);
  const photoUrl = getPhotoFromMetadata(metadata);

  return jsonOk({
    profile: {
      userId: ctx.user.id,
      schoolId: ctx.schoolId,
      role: ctx.role,
      email,
      fullName,
      phone,
      photoUrl,
      initials: getInitials(fullName),
    },
  });
}

export async function PATCH(req: Request) {
  const ctx = await getTeacherContext(req);

  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json().catch(() => null);

    const fullName = cleanText(body?.fullName || body?.name || body?.nome);
    const phone = cleanText(body?.phone || body?.telefone);
    const photoDataUrl = cleanText(body?.photoDataUrl);
    const removePhoto = Boolean(body?.removePhoto);

    if (!fullName) {
      return jsonError("Informe o nome do professor.", 400);
    }

    if (fullName.length < 2) {
      return jsonError("O nome precisa ter pelo menos 2 caracteres.", 400);
    }

    if (fullName.length > 120) {
      return jsonError("O nome precisa ter no máximo 120 caracteres.", 400);
    }

    if (phone.length > 40) {
      return jsonError("O telefone precisa ter no máximo 40 caracteres.", 400);
    }

    const currentMetadata = ((ctx.user.user_metadata || {}) as TeacherProfileMetadata) || {};

    let nextPhotoUrl = getPhotoFromMetadata(currentMetadata);

    if (removePhoto) {
      nextPhotoUrl = null;
    }

    if (photoDataUrl) {
      nextPhotoUrl = await uploadTeacherPhoto({
        schoolId: ctx.schoolId,
        userId: ctx.user.id,
        dataUrl: photoDataUrl,
      });
    }

    const nextMetadata = {
      ...currentMetadata,
      full_name: fullName,
      fullName,
      name: fullName,
      nome: fullName,
      display_name: fullName,
      phone,
      telefone: phone,
      avatar_url: nextPhotoUrl,
      photo_url: nextPhotoUrl,
      photoUrl: nextPhotoUrl,
      picture: nextPhotoUrl,
      teacher_photo_url: nextPhotoUrl,
    };

    const { data: updated, error: updateErr } =
      await supabaseAdmin.auth.admin.updateUserById(ctx.user.id, {
        user_metadata: nextMetadata,
      });

    if (updateErr) {
      return jsonError("Falha ao atualizar perfil: " + updateErr.message, 500);
    }

    const metadata = ((updated?.user?.user_metadata || nextMetadata) as TeacherProfileMetadata) || {};
    const email = cleanText(updated?.user?.email || ctx.user.email);
    const finalName = getNameFromMetadata(metadata, email);
    const finalPhone = getPhoneFromMetadata(metadata);
    const finalPhoto = getPhotoFromMetadata(metadata);

    return jsonOk({
      profile: {
        userId: ctx.user.id,
        schoolId: ctx.schoolId,
        role: ctx.role,
        email,
        fullName: finalName,
        phone: finalPhone,
        photoUrl: finalPhoto,
        initials: getInitials(finalName),
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar perfil do professor.", 500);
  }
}