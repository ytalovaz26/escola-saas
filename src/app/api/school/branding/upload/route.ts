import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return String(name || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function slugify(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

async function makeUniqueSlug(baseSlug: string, schoolId: string) {
  let cleanBase = slugify(baseSlug);

  if (!cleanBase) {
    cleanBase = `escola-${String(schoolId).slice(0, 8)}`;
  }

  let finalSlug = cleanBase;
  let counter = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("schools")
      .select("id")
      .eq("slug", finalSlug)
      .neq("id", schoolId)
      .limit(1);

    if (error) {
      throw new Error(`Falha ao validar slug: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return finalSlug;
    }

    counter += 1;
    finalSlug = `${cleanBase}-${counter}`;
  }
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

  if (!schoolId) {
    return jsonError("schoolId não identificado.", 401);
  }

  try {
    const formData = await req.formData();

    const file = formData.get("file");
    const rawKind = String(
      formData.get("kind") || formData.get("type") || "logo"
    )
      .trim()
      .toLowerCase();

    const kind = rawKind === "icon" ? "icon" : "logo";

    const brandName = String(formData.get("brandName") || "").trim();
    const requestedSlug = String(formData.get("slug") || "").trim();

    const { data: currentSchool, error: currentSchoolError } = await supabaseAdmin
      .from("schools")
      .select("id,name,brand_name,slug")
      .eq("id", schoolId)
      .maybeSingle();

    if (currentSchoolError || !currentSchool?.id) {
      return jsonError("Escola não encontrada para atualizar branding.", 404, {
        details: currentSchoolError?.message,
      });
    }

    const slugBase =
      requestedSlug ||
      brandName ||
      currentSchool.brand_name ||
      currentSchool.name ||
      schoolId;

    const finalSlug = await makeUniqueSlug(slugBase, schoolId);

    const updatePayload: Record<string, any> = {
      slug: finalSlug,
    };

    if (brandName) {
      updatePayload.brand_name = brandName;
    }

    let publicUrl: string | null = null;
    let filePath: string | null = null;

    if (file instanceof File) {
      if (!allowedMimeType(file.type)) {
        return jsonError("Formato inválido. Use PNG, JPG, WEBP ou SVG.", 400, {
          receivedType: file.type,
        });
      }

      const maxSize = kind === "icon" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;

      if (file.size > maxSize) {
        return jsonError(
          `Arquivo muito grande. Limite: ${kind === "icon" ? "2MB" : "5MB"}.`,
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
      const safeBaseName =
        sanitizeFileName(file.name.replace(/\.[^.]+$/, "")) || kind;

      filePath = `${schoolId}/${kind}/${Date.now()}-${safeBaseName}.${ext}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BRANDING_BUCKET)
        .upload(filePath, buffer, {
          contentType: file.type || "image/png",
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

      publicUrl = publicData.publicUrl;

      if (kind === "logo") {
        updatePayload.brand_logo_url = publicUrl;
      }

      if (kind === "icon") {
        updatePayload.brand_icon_url = publicUrl;
      }
    }

    const { data: updatedSchool, error: updateError } = await supabaseAdmin
      .from("schools")
      .update(updatePayload)
      .eq("id", schoolId)
      .select(
        `
          id,
          name,
          slug,
          brand_name,
          brand_logo_url,
          brand_icon_url,
          logo_url,
          primary_color,
          secondary_color
        `
      )
      .maybeSingle();

    if (updateError || !updatedSchool?.id) {
      return jsonError("Falha ao salvar branding na escola.", 500, {
        details: updateError?.message,
        updatePayload,
        publicUrl,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        school: {
          id: updatedSchool.id,
          name: updatedSchool.name,
          slug: updatedSchool.slug,
          brandName: updatedSchool.brand_name,
          brandLogoUrl: updatedSchool.brand_logo_url,
          brandIconUrl: updatedSchool.brand_icon_url,
          logoUrl: updatedSchool.logo_url,
          primaryColor: updatedSchool.primary_color,
          secondaryColor: updatedSchool.secondary_color,
        },
        bucket: BRANDING_BUCKET,
        path: filePath,
        kind,
        type: kind,
        url: publicUrl,
        brandName: updatedSchool.brand_name,
        slug: updatedSchool.slug,
        publicLink: updatedSchool.slug ? `/s/${updatedSchool.slug}` : null,
        loginLink: updatedSchool.slug ? `/s/${updatedSchool.slug}/login` : null,
      },
      {
        headers: {
          ...corsHeaders(),
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e: any) {
    return jsonError("Erro interno no upload de branding.", 500, {
      details: e?.message || String(e),
    });
  }
}