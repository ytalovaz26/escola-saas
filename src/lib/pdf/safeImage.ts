// src/lib/pdf/safeImage.ts
// O PDFKit só incorpora PNG e JPEG. Outros formatos (WebP e SVG, aceitos no upload da
// identidade visual) ou arquivos corrompidos fazem doc.image() lançar exceção
// ("Unknown image format.", "Incomplete or corrupt PNG file") e derrubam a geração do PDF.
// toPdfImage devolve o buffer só quando o PDFKit consegue abri-lo; caso contrário, null —
// e o PDF é gerado no layout "sem logo", que já existe.
import PDFDocument from "pdfkit";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function detectPdfImageKind(buf: Buffer | null | undefined): "png" | "jpeg" | null {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return null;
}

export function toPdfImage(buf: Buffer | null | undefined): Buffer | null {
  if (!buf || buf.length > MAX_IMAGE_BYTES || !detectPdfImageKind(buf)) return null;
  try {
    // Abre a imagem num documento descartável: se o PDFKit não conseguir ler, não usamos.
    const probe = new PDFDocument({ autoFirstPage: false });
    (probe as any).openImage(buf);
    return buf;
  } catch {
    return null;
  }
}
