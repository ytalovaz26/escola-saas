import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

const BRANDING_BUCKET = "school-branding";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: corsHeaders() }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function allowedMimeType(type: string) {
  return [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/svg+xml",
  ].includes(type);
}

function extensionFromFile(file: File) {
  const original = file.name || "";
  const byName = original.includes(".") ? original.split(".").pop() : "";

  if (byName) return byName.toLowerCase();

  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg" || file.type === "image/jpg") return "jpg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/svg+xml") return "svg";

  return "bin";
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const { schoolId } = guard;

  try {
    const formData = await req.formData();

    const file = formData.get("file");
    const type = String(formData.get("type") || "logo").trim().toLowerCase();
    const brandName = String(formData.get("brandName") || "").trim();

    if (!(file instanceof File)) {
      return jsonError("Arquivo não enviado.", 400);
    }

    if (!["logo", "icon"].includes(type)) {
      return jsonError("type inválido. Use 'logo' ou 'icon'.", 400);
    }

    if (!allowedMimeType(file.type)) {
      return jsonError("Formato inválido. Use PNG, JPG, WEBP ou SVG.", 400, {
        receivedType: file.type,
      });
    }

    const maxSize = type === "icon" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return jsonError(
        `Arquivo muito grande. Limite: ${type === "icon" ? "2MB" : "5MB"}.`,
        400
      );
    }

    const bucketCheck = await supabaseAdmin.storage.getBucket(BRANDING_BUCKET);

    if (bucketCheck.error) {
      return jsonError("Bucket de branding não encontrado.", 500, {
        details: bucketCheck.error.message,
        expectedBucket: BRANDING_BUCKET,
      });
    }

    const ext = extensionFromFile(file);
    const safeBaseName = sanitizeFileName(file.name.replace(/\.[^.]+$/, "")) || type;
    const filePath = `${schoolId}/${type}/${Date.now()}-${safeBaseName}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BRANDING_BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return jsonError("Falha ao enviar arquivo.", 500, {
        details: uploadError.message,
        bucket: BRANDING_BUCKET,
        path: filePath,
      });
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(BRANDING_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicData.publicUrl;

    const updatePayload: Record<string, any> = {};

    if (type === "logo") {
      updatePayload.brand_logo_url = publicUrl;
    } else {
      updatePayload.brand_icon_url = publicUrl;
    }

    if (brandName) {
      updatePayload.brand_name = brandName;
    }

    const { error: updateError } = await supabaseAdmin
      .from("schools")
      .update(updatePayload)
      .eq("id", schoolId);

    if (updateError) {
      return jsonError("Upload feito, mas falhou ao salvar na escola.", 500, {
        details: updateError.message,
        publicUrl,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        bucket: BRANDING_BUCKET,
        path: filePath,
        type,
        url: publicUrl,
        brandName: brandName || null,
      },
      { headers: corsHeaders() }
    );
  } catch (e: any) {
    return jsonError("Erro interno no upload de branding.", 500, {
      details: e?.message || String(e),
    });
  }
}