import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { getTeacherDisplayName } from "@/lib/getTeacherDisplayName";

export const runtime = "nodejs";

type DiaryEntry = {
  id: string;
  lesson_date: string;
  content_taught: string;
  methodology: string | null;
  activities: string | null;
  notes: string | null;
  homework: string | null;
};

type SectionBlock = {
  title: string;
  value: string;
};

type RenderItem =
  | { kind: "date"; text: string }
  | { kind: "section"; title: string; value: string };

type RenderPage = {
  items: RenderItem[];
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function brDateFromISO(iso: string) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatMonthLabel(ref: string) {
  const [year, month] = String(ref || "").split("-");
  if (!year || !month) return ref || "—";

  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function parseSupabaseStorageRef(logoUrl: string): { bucket: string; path: string } | null {
  const u = (logoUrl || "").trim();
  if (!u) return null;

  const pub = u.split("/storage/v1/object/public/");
  if (pub.length === 2) {
    const rest = pub[1];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");
    if (bucket && path) return { bucket, path };
  }

  const sign = u.split("/storage/v1/object/sign/");
  if (sign.length === 2) {
    const restWithQuery = sign[1];
    const rest = restWithQuery.split("?")[0];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");
    if (bucket && path) return { bucket, path };
  }

  if (!u.startsWith("http://") && !u.startsWith("https://") && u.includes("/")) {
    const parts = u.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");
    if (bucket && path) return { bucket, path };
  }

  return null;
}

function bufferFromDataUrl(dataUrl: string): Buffer | null {
  try {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

async function getLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  try {
    if (!logoUrl) return null;

    const clean = logoUrl.trim();
    if (!clean) return null;

    if (clean.startsWith("data:image/")) {
      return bufferFromDataUrl(clean);
    }

    const ref = parseSupabaseStorageRef(clean);
    if (ref) {
      const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
      if (!error && data) {
        const ab = await data.arrayBuffer();
        return Buffer.from(ab);
      }
    }

    const res = await fetch(clean);
    if (!res.ok) return null;

    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

async function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function drawSingleLineCentered(
  doc: PDFKit.PDFDocument,
  text: string,
  y: number,
  fontSize = 9,
  color = "#6b7280",
  font: "Helvetica" | "Helvetica-Bold" = "Helvetica"
) {
  doc.font(font).fontSize(fontSize).fillColor(color);

  const safeText = text || "";
  const textWidth = doc.widthOfString(safeText);
  const x = Math.max(40, (doc.page.width - textWidth) / 2);

  doc.text(safeText, x, y, {
    lineBreak: false,
  });
}

function drawHeader(params: {
  doc: PDFKit.PDFDocument;
  schoolName: string;
  className: string;
  teacherName: string;
  subjectName: string;
  termLabel: string;
  referenceMonthLabel: string;
  logoBuffer: Buffer | null;
}) {
  const {
    doc,
    schoolName,
    className,
    teacherName,
    subjectName,
    termLabel,
    referenceMonthLabel,
    logoBuffer,
  } = params;

  const margin = 40;

  if (logoBuffer) {
    doc.image(logoBuffer, margin, 36, { fit: [70, 70] });
  }

  const titleX = margin + 84;

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text(schoolName, titleX, 40);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text("Diário de Classe", titleX, 64);

  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  doc.text(`Turma: ${className}`, margin, 120);
  doc.text(`Professor(a): ${teacherName}`, margin, 136);
  doc.text(`Disciplina: ${subjectName}`, margin, 152);
  doc.text(`Período: ${termLabel || "—"}`, margin, 168);
  doc.text(`Mês de referência: ${referenceMonthLabel}`, margin, 184);

  doc
    .moveTo(margin, 206)
    .lineTo(doc.page.width - margin, 206)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();
}

function drawFooter(params: {
  doc: PDFKit.PDFDocument;
  className: string;
  referenceMonthLabel: string;
}) {
  const { doc, className, referenceMonthLabel } = params;

  const emitDate = new Date().toLocaleDateString("pt-BR");
  const footerText = `Turma: ${className}  •  Mês: ${referenceMonthLabel}  •  Emitido em: ${emitDate}`;

  // bem acima do fim da página, evitando qualquer chance de o PDFKit paginar
  drawSingleLineCentered(doc, footerText, doc.page.height - 72, 9, "#6b7280", "Helvetica");
}

function drawSignature(params: {
  doc: PDFKit.PDFDocument;
  teacherName: string;
}) {
  const { doc, teacherName } = params;

  const lineY = doc.page.height - 125;
  const textY1 = lineY + 8;
  const textY2 = lineY + 22;
  const lineStartX = doc.page.width - 240;
  const lineEndX = doc.page.width - 60;
  const centerX = (lineStartX + lineEndX) / 2;

  doc
    .moveTo(lineStartX, lineY)
    .lineTo(lineEndX, lineY)
    .strokeColor("#6b7280")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#374151");

  const teacherSafe = teacherName || "Professor(a)";
  const teacherWidth = doc.widthOfString(teacherSafe);
  const labelWidth = doc.widthOfString("Professor(a)");

  doc.text(teacherSafe, centerX - teacherWidth / 2, textY1, {
    lineBreak: false,
  });

  doc.text("Professor(a)", centerX - labelWidth / 2, textY2, {
    lineBreak: false,
  });
}

function measureDateHeight() {
  return 24;
}

function measureSectionHeight(doc: PDFKit.PDFDocument, width: number, value: string) {
  const safeValue = value?.trim() ? value.trim() : "—";

  const textHeight = doc.heightOfString(safeValue, {
    width: width - 24,
    align: "left",
  });

  const boxHeight = Math.max(40, textHeight + 20);

  return 16 + boxHeight + 18;
}

function drawSection(params: {
  doc: PDFKit.PDFDocument;
  x: number;
  y: number;
  width: number;
  title: string;
  value: string;
}) {
  const { doc, x, y, width, title, value } = params;
  const safeValue = value?.trim() ? value.trim() : "—";

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(title, x, y);

  const boxY = y + 16;

  const textHeight = doc.heightOfString(safeValue, {
    width: width - 24,
    align: "left",
  });

  const boxHeight = Math.max(40, textHeight + 20);

  doc
    .roundedRect(x, boxY, width, boxHeight, 8)
    .strokeColor("#d1d5db")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#374151").text(safeValue, x + 12, boxY + 10, {
    width: width - 24,
    align: "left",
  });

  return boxY + boxHeight;
}

function paginateDiary(params: {
  doc: PDFKit.PDFDocument;
  entries: DiaryEntry[];
  contentWidth: number;
  firstPageStartY: number;
  otherPagesStartY: number;
  usableBottomY: number;
}) {
  const { doc, entries, contentWidth, firstPageStartY, otherPagesStartY, usableBottomY } = params;

  const pages: RenderPage[] = [];
  let currentPage: RenderPage = { items: [] };
  let currentY = firstPageStartY;

  function pushPage() {
    if (currentPage.items.length > 0) {
      pages.push(currentPage);
    }
    currentPage = { items: [] };
    currentY = otherPagesStartY;
  }

  for (const entry of entries) {
    const dateText = `Data: ${brDateFromISO(entry.lesson_date)}`;
    const dateHeight = measureDateHeight();

    if (currentY + dateHeight > usableBottomY) {
      pushPage();
    }

    currentPage.items.push({
      kind: "date",
      text: dateText,
    });

    currentY += dateHeight;

    const blocks: SectionBlock[] = [
      { title: "Conteúdo ministrado", value: entry.content_taught || "" },
      { title: "Metodologia", value: entry.methodology || "" },
      { title: "Atividades desenvolvidas", value: entry.activities || "" },
      { title: "Observações", value: entry.notes || "" },
      { title: "Tarefa de casa", value: entry.homework || "" },
    ];

    for (const block of blocks) {
      const sectionHeight = measureSectionHeight(doc, contentWidth, block.value || "");

      if (currentY + sectionHeight > usableBottomY) {
        pushPage();
      }

      currentPage.items.push({
        kind: "section",
        title: block.title,
        value: block.value || "",
      });

      currentY += sectionHeight;
    }

    currentY += 6;
  }

  if (currentPage.items.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const referenceMonth = (url.searchParams.get("referenceMonth") || "").trim();
  const subjectName = (url.searchParams.get("subjectName") || "").trim();
  const termLabel = (url.searchParams.get("termLabel") || "").trim();
  const lessonDate = (url.searchParams.get("lessonDate") || "").trim();

  if (!schoolId) return jsonError("Escola não identificada.", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!referenceMonth) return jsonError("referenceMonth é obrigatório.", 400);
  if (!subjectName) return jsonError("subjectName é obrigatório.", 400);
  if (!lessonDate) return jsonError("lessonDate é obrigatório.", 400);

  const { data: school, error: schoolErr } = await supabaseAdmin
    .from("schools")
    .select("name, brand_logo_url, logo_url")
    .eq("id", schoolId)
    .single();

  if (schoolErr) {
    return jsonError("Falha ao buscar dados da escola.", 500, {
      details: schoolErr.message,
    });
  }

  const schoolName = school?.name || "Escola";
  const logoUrl = school?.brand_logo_url || school?.logo_url || null;
  const logoBuffer = await getLogoBuffer(logoUrl);

  const { data: classData } = await supabaseAdmin
    .from("classes")
    .select("name")
    .eq("id", classId)
    .single();

  const className = classData?.name || classId;

  const { data: diary, error: diaryErr } = await supabaseAdmin
    .from("class_diaries")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("subject_name", subjectName)
    .eq("reference_month", referenceMonth)
    .limit(1)
    .maybeSingle();

  if (diaryErr) {
    return jsonError("Falha ao buscar diário.", 500, {
      details: diaryErr.message,
    });
  }

  if (!diary?.id) {
    return jsonError("Diário não encontrado para os filtros informados.", 404);
  }

  const teacherName = await getTeacherDisplayName({
    teacherUserId: diary.teacher_user_id,
    schoolId,
  });

  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from("class_diary_entries")
    .select("id, lesson_date, content_taught, methodology, activities, notes, homework")
    .eq("diary_id", diary.id)
    .eq("lesson_date", lessonDate)
    .order("lesson_date", { ascending: true });

  if (entriesErr) {
    return jsonError("Falha ao buscar lançamentos do diário.", 500, {
      details: entriesErr.message,
    });
  }

  const diaryEntries = (entries || []) as DiaryEntry[];

  if (diaryEntries.length === 0) {
    return jsonError("Nenhum lançamento encontrado para a data selecionada.", 404);
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 40,
    autoFirstPage: true,
  });

  const margin = 40;
  const contentWidth = doc.page.width - margin * 2;
  const referenceMonthLabel = formatMonthLabel(referenceMonth);

  // Reserva fixa para assinatura + rodapé
  const firstPageStartY = 225;
  const otherPagesStartY = 50;
  const usableBottomY = doc.page.height - 185;

  const pages = paginateDiary({
    doc,
    entries: diaryEntries,
    contentWidth,
    firstPageStartY,
    otherPagesStartY,
    usableBottomY,
  });

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      doc.addPage();
    }

    if (pageIndex === 0) {
      drawHeader({
        doc,
        schoolName,
        className,
        teacherName,
        subjectName,
        termLabel: termLabel || diary.term_label || "—",
        referenceMonthLabel,
        logoBuffer,
      });
    }

    let y = pageIndex === 0 ? firstPageStartY : otherPagesStartY;

    for (const item of page.items) {
      if (item.kind === "date") {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#111827")
          .text(item.text, margin, y);

        y += 24;
      } else {
        const endY = drawSection({
          doc,
          x: margin,
          y,
          width: contentWidth,
          title: item.title,
          value: item.value,
        });

        y = endY + 18;
      }
    }

    if (pageIndex === pages.length - 1) {
      drawSignature({
        doc,
        teacherName,
      });
    }

    drawFooter({
      doc,
      className,
      referenceMonthLabel,
    });
  });

  const buffer = await pdfToBuffer(doc);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="diario-escola-${classId}-${lessonDate}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}