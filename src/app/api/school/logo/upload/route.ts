import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function publicLogoUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/school-logos/${path}`;
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, [
    "admin",
    "diretor",
    "director",
    "coordenador",
    "coordinator",
  ]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  if (!schoolId) return jsonError("schoolId não encontrado no token.", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Falha ao ler formData.", 400);
  }

  const file = form.get("file") as File | null;
  if (!file) return jsonError("Envie um arquivo no campo 'file'.", 400);

  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) {
    return jsonError("Formato inválido. Use PNG, JPG/JPEG ou WEBP.", 400, { fileType: file.type });
  }

  const maxBytes = 2 * 1024 * 1024; // 2MB (ajustável)
  if (file.size > maxBytes) {
    return jsonError("Arquivo muito grande. Máximo 2MB.", 400, { size: file.size });
  }

  // Sempre salva como logo.png (padroniza)
  const path = `${schoolId}/logo.png`;

  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabaseAdmin.storage
    .from("school-logos")
    .upload(path, bytes, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });

  if (upErr) return jsonError("Falha ao enviar a logo.", 500, { details: upErr.message });

  const logoUrl = publicLogoUrl(path);
  if (!logoUrl) return jsonError("NEXT_PUBLIC_SUPABASE_URL não configurado.", 500);

  // grava no schools.logo_url
  const { error: dbErr } = await supabaseAdmin
    .from("schools")
    .update({ logo_url: logoUrl })
    .eq("id", schoolId);

  if (dbErr) return jsonError("Logo enviada, mas falhou ao salvar no banco.", 500, { details: dbErr.message });

  return NextResponse.json({ ok: true, schoolId, logoUrl });
}
