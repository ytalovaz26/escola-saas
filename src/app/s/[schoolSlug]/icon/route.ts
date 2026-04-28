import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{
    schoolSlug: string;
  }>;
};

type SchoolRow = {
  id: string;
  name: string | null;
  slug: string | null;
  brand_name: string | null;
  brand_logo_url: string | null;
  brand_icon_url: string | null;
  logo_url: string | null;
};

function normalizeSlug(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();

  if (!safe) return "ES";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function parseSupabaseStorageRef(
  fileUrl: string
): { bucket: string; path: string } | null {
  const raw = String(fileUrl || "").trim();

  if (!raw) return null;

  const publicParts = raw.split("/storage/v1/object/public/");

  if (publicParts.length === 2) {
    const rest = publicParts[1].split("?")[0];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");

    if (bucket && path) {
      return { bucket, path };
    }
  }

  const signedParts = raw.split("/storage/v1/object/sign/");

  if (signedParts.length === 2) {
    const rest = signedParts[1].split("?")[0];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");

    if (bucket && path) {
      return { bucket, path };
    }
  }

  if (!raw.startsWith("http://") && !raw.startsWith("https://") && raw.includes("/")) {
    const clean = raw.split("?")[0];
    const parts = clean.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");

    if (bucket && path) {
      return { bucket, path };
    }
  }

  return null;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer | null> {
  const cleanUrl = String(imageUrl || "").trim();

  if (!cleanUrl) return null;

  try {
    const storageRef = parseSupabaseStorageRef(cleanUrl);

    if (storageRef) {
      const { data, error } = await supabaseAdmin.storage
        .from(storageRef.bucket)
        .download(storageRef.path);

      if (!error && data) {
        const arrayBuffer = await data.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    }

    if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
      const res = await fetch(cleanUrl, {
        cache: "no-store",
      });

      if (!res.ok) return null;

      const arrayBuffer = await res.arrayBuffer();

      return Buffer.from(arrayBuffer);
    }

    return null;
  } catch {
    return null;
  }
}

function fallbackSvg(appName: string, slug: string) {
  const initials = getInitials(appName || slug || "ES");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0f172a"/>
  <rect x="54" y="54" width="404" height="404" rx="92" fill="#ffffff" opacity="0.08"/>
  <text x="256" y="296" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="132" font-weight="800" fill="#ffffff">${initials}</text>
</svg>
`.trim();
}

async function makePngIcon(input: Buffer, appName: string, slug: string) {
  try {
    const normalizedLogo = await sharp(input, {
      failOn: "none",
      animated: false,
    })
      .resize({
        width: 380,
        height: 380,
        fit: "contain",
        background: {
          r: 255,
          g: 255,
          b: 255,
          alpha: 0,
        },
      })
      .png()
      .toBuffer();

    const icon = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: {
          r: 15,
          g: 23,
          b: 42,
          alpha: 1,
        },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `
              <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                <rect x="52" y="52" width="408" height="408" rx="98" fill="white"/>
              </svg>
            `.trim()
          ),
          top: 0,
          left: 0,
        },
        {
          input: normalizedLogo,
          top: 66,
          left: 66,
        },
      ])
      .png()
      .toBuffer();

    return icon;
  } catch {
    return sharp(Buffer.from(fallbackSvg(appName, slug)))
      .resize(512, 512)
      .png()
      .toBuffer();
  }
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { schoolSlug } = await context.params;
    const slug = normalizeSlug(schoolSlug);

    if (!slug) {
      return new NextResponse("Slug inválido.", {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    const { data, error } = await supabaseAdmin
      .from("schools")
      .select(
        `
          id,
          name,
          slug,
          brand_name,
          brand_logo_url,
          brand_icon_url,
          logo_url
        `
      )
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data?.id) {
      return new NextResponse("Escola não encontrada.", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    const school = data as SchoolRow;

    const appName = school.brand_name || school.name || "Minha Escola";
    const sourceUrl = school.brand_icon_url || school.brand_logo_url || school.logo_url || "";

    const imageBuffer = await fetchImageBuffer(sourceUrl);

    const pngIcon = imageBuffer
      ? await makePngIcon(imageBuffer, appName, slug)
      : await sharp(Buffer.from(fallbackSvg(appName, slug))).resize(512, 512).png().toBuffer();

    return new NextResponse(new Uint8Array(pngIcon), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(pngIcon.length),
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (e: any) {
    const fallback = await sharp(
      Buffer.from(fallbackSvg("Minha Escola", "escola"))
    )
      .resize(512, 512)
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(fallback), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(fallback.length),
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "X-Icon-Fallback-Reason": e?.message || "unknown",
      },
    });
  }
}