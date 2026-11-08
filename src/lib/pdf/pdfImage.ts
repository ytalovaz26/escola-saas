// src/lib/pdf/pdfImage.ts
// Imagens para PDFs (logomarcas e fotos) com tratamento seguro.
//
// - Origem: SOMENTE o Storage do próprio projeto Supabase (download com a chave do servidor)
//   ou data URL. Nenhuma URL arbitrária é buscada (sem SSRF).
// - Limites: 5 MB de entrada, 16 megapixels, saída redimensionada para no máximo 1024 px.
// - PNG/JPEG válidos seguem como estão. WebP/GIF são convertidos para PNG (sharp).
//   SVG é sanitizado (sem scripts, eventos, entidades, referências externas) e rasterizado;
//   SVG suspeito é rejeitado.
// - Qualquer falha devolve null: o PDF é gerado no layout "sem imagem", nunca derrubado.
// - Logs técnicos sem URL, caminho ou dado pessoal.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toPdfImage } from "./safeImage";

// sharp é carregado sob demanda: se o binário nativo não estiver disponível no ambiente,
// PNG/JPEG continuam funcionando e os demais formatos saem sem imagem — nunca derruba a rota.
type SharpFn = typeof import("sharp");
let sharpLoaded: SharpFn | null | undefined;
async function getSharp(): Promise<SharpFn | null> {
  if (sharpLoaded !== undefined) return sharpLoaded;
  try {
    const mod: any = await import("sharp");
    sharpLoaded = (mod?.default ?? mod) as SharpFn;
  } catch {
    sharpLoaded = null;
    console.warn("[pdf-image]", { reason: "sharp_indisponivel" });
  }
  return sharpLoaded;
}

export const MAX_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_BYTES = 1024 * 1024;
export const MAX_INPUT_PIXELS = 16_777_216; // 4096 x 4096
export const MAX_OUTPUT_DIMENSION = 1024;

export type ImageKind = "png" | "jpeg" | "webp" | "gif" | "svg";

export function sniffImageKind(buf: Buffer | null | undefined): ImageKind | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "gif";
  const head = buf.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/** SVG aceito somente sem conteúdo ativo nem referências externas. */
export function isSafeSvg(text: string): boolean {
  if (!text || text.length > MAX_SVG_BYTES) return false;
  const t = text.toLowerCase();
  if (!t.includes("<svg")) return false;
  const forbidden = [/<script/, /<!doctype/, /<!entity/, /<\?xml-stylesheet/, /<foreignobject/, /<(iframe|object|embed|audio|video)\b/, /\son[a-z]+\s*=/, /javascript:/, /@import/, /xml:base/];
  if (forbidden.some((re) => re.test(t))) return false;
  // Referências permitidas: só âncoras internas (#id) e imagens embutidas em base64.
  const allowedRef = (v: string) => {
    const s = v.trim().replace(/^["']|["']$/g, "").trim();
    return s.startsWith("#") || /^data:image\/(png|jpe?g|gif|webp);base64,/.test(s);
  };
  for (const m of t.matchAll(/(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
    if (!allowedRef(m[1])) return false;
  }
  for (const m of t.matchAll(/url\(([^)]*)\)/g)) {
    if (!allowedRef(m[1])) return false;
  }
  return true;
}

function logImage(reason: string, extra: Record<string, unknown> = {}) {
  console.warn("[pdf-image]", { reason, ...extra });
}

function supabaseHost(): string | null {
  try {
    return new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || "")).hostname || null;
  } catch {
    return null;
  }
}

/** Converte a referência em {bucket, path} do Storage do próprio projeto; outra origem = null. */
export function parseOwnStorageRef(raw: string): { bucket: string; path: string } | null {
  const u = String(raw || "").trim();
  if (!u) return null;
  let rest: string | null = null;
  if (/^https?:\/\//i.test(u)) {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return null;
    }
    const host = supabaseHost();
    if (!host || url.hostname !== host) return null;
    const markers = ["/storage/v1/object/public/", "/storage/v1/object/sign/", "/storage/v1/object/authenticated/"];
    const marker = markers.find((m) => url.pathname.startsWith(m));
    if (!marker) return null;
    rest = url.pathname.slice(marker.length);
  } else if (!u.startsWith("/") && !u.includes(":") && u.includes("/")) {
    rest = u.split("?")[0];
  }
  if (!rest) return null;
  const parts = rest.split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });
  const bucket = parts.shift() || "";
  const path = parts.join("/");
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(bucket) || !path || path.split("/").some((p) => !p || p === "." || p === "..")) return null;
  return { bucket, path };
}

async function readSource(source: string): Promise<Buffer | null> {
  const s = String(source || "").trim();
  if (!s) return null;
  const dataUrl = s.match(/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataUrl) {
    const buf = Buffer.from(dataUrl[2].replace(/\s+/g, ""), "base64");
    return buf.length > 0 && buf.length <= MAX_IMAGE_INPUT_BYTES ? buf : null;
  }
  const ref = parseOwnStorageRef(s);
  if (!ref) {
    logImage("origem_nao_permitida");
    return null;
  }
  const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
  if (error || !data) {
    logImage("storage_indisponivel");
    return null;
  }
  if (typeof (data as any).size === "number" && (data as any).size > MAX_IMAGE_INPUT_BYTES) {
    logImage("arquivo_grande", { bytes: (data as any).size });
    return null;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > MAX_IMAGE_INPUT_BYTES) {
    logImage("arquivo_grande", { bytes: buf.length });
    return null;
  }
  return buf;
}

/** Normaliza bytes de imagem para PNG/JPEG que o PDFKit aceita; null quando não for possível. */
export async function normalizePdfImage(buf: Buffer | null | undefined): Promise<Buffer | null> {
  if (!buf || buf.length === 0 || buf.length > MAX_IMAGE_INPUT_BYTES) return null;
  const kind = sniffImageKind(buf);
  if (!kind) {
    logImage("formato_desconhecido", { bytes: buf.length });
    return null;
  }
  if (kind === "svg" && !isSafeSvg(buf.toString("utf8"))) {
    logImage("svg_rejeitado", { bytes: buf.length });
    return null;
  }
  const sharp = await getSharp();
  if (!sharp) {
    // Sem conversor: só PNG/JPEG legíveis pelo PDFKit.
    if (kind === "png" || kind === "jpeg") return toPdfImage(buf);
    logImage("conversor_indisponivel", { kind });
    return null;
  }
  try {
    if (kind === "png" || kind === "jpeg") {
      const meta = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      const small = (meta.width || 0) <= MAX_OUTPUT_DIMENSION && (meta.height || 0) <= MAX_OUTPUT_DIMENSION;
      const direct = small ? toPdfImage(buf) : null;
      if (direct) return direct;
    }
    const png = await sharp(buf, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
      animated: false,
      ...(kind === "svg" ? { density: 144 } : {}),
    })
      .rotate()
      .resize({ width: MAX_OUTPUT_DIMENSION, height: MAX_OUTPUT_DIMENSION, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const out = toPdfImage(png);
    if (!out) logImage("conversao_invalida", { kind });
    return out;
  } catch (err) {
    logImage("conversao_falhou", { kind, message: err instanceof Error ? err.message.slice(0, 120) : "erro" });
    return null;
  }
}

/** Carrega uma imagem do Storage do próprio projeto (ou data URL) pronta para doc.image(). */
export async function loadPdfImage(source: string | null | undefined): Promise<Buffer | null> {
  try {
    if (!source) return null;
    return await normalizePdfImage(await readSource(source));
  } catch {
    logImage("falha_inesperada");
    return null;
  }
}
