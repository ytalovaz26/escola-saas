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

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function isValidDateYMD(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function periodLabel(startDate: string, endDate: string) {
  if (startDate && endDate) {
    if (startDate === endDate) return brDateFromISO(startDate);
    return `${brDateFromISO(startDate)} até ${brDateFromISO(endDate)}`;
  }

  if (startDate) return `A partir de ${brDateFromISO(startDate)}`;
  if (endDate) return `Até ${brDateFromISO(endDate)}`;

  return "—";
}

function monthStart(referenceMonth: string) {
  const [y, m] = String(referenceMonth || "").split("-").map(Number);
  if (!y || !m) return "";

  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function monthEnd(referenceMonth: string) {
  const [y, m] = String(referenceMonth || "").split("-").map(Number);
  if (!y || !m) return "";

  const end = new Date(y, m, 0);

  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate()
  ).padStart(2, "0")}`;
}

function monthFromDateYMD(value: string) {
  if (!isValidDateYMD(value)) return "";
  return value.slice(0, 7);
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

function getTextHeight(doc: PDFKit.PDFDocument, text: string, width: number, fontSize = 10) {
  doc.font("Helvetica").fontSize(fontSize);

  return doc.heightOfString(text || "—", {
    width,
    align: "left",
  });
}

function drawDailyHeader(params: {
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

  return 225;
}

function drawSummaryHeader(params: {
  doc: PDFKit.PDFDocument;
  schoolName: string;
  className: string;
  teacherName: string;
  subjectName: string;
  termLabel: string;
  referenceMonthLabel: string;
  periodText: string;
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
    periodText,
    logoBuffer,
  } = params;

  const margin = 40;

  if (logoBuffer) {
    doc.image(logoBuffer, margin, 32, { fit: [72, 52] });
  }

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827");
  doc.text(schoolName, margin, 38, {
    width: doc.page.width - margin * 2,
    align: "center",
  });

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
  doc.text("Diário de Classe", margin, 68, {
    width: doc.page.width - margin * 2,
    align: "center",
  });

  const boxY = 102;
  const boxH = 98;

  doc
    .roundedRect(margin, boxY, doc.page.width - margin * 2, boxH, 8)
    .strokeColor("#d1d5db")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#374151");

  const leftX = margin + 14;
  const rightX = margin + 285;

  doc.text(`Turma: ${className}`, leftX, boxY + 14);
  doc.text(`Professor(a): ${teacherName}`, leftX, boxY + 32);
  doc.text(`Mês base: ${referenceMonthLabel}`, leftX, boxY + 50);

  doc.text(`Disciplina: ${subjectName}`, rightX, boxY + 14);
  doc.text(`Período letivo: ${termLabel || "—"}`, rightX, boxY + 32);
  doc.text(`Relatório: ${periodText}`, rightX, boxY + 50, {
    width: doc.page.width - rightX - margin - 14,
  });

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  doc.text("Relatório resumido de conteúdo ministrado", margin, boxY + 76, {
    width: doc.page.width - margin * 2,
    align: "center",
  });
}

function drawSummaryTableHeader(doc: PDFKit.PDFDocument, y: number) {
  const margin = 40;
  const dateW = 86;
  const contentW = doc.page.width - margin * 2 - dateW;

  doc.rect(margin, y, dateW, 24).fillAndStroke("#f1f5f9", "#d1d5db");
  doc.rect(margin + dateW, y, contentW, 24).fillAndStroke("#f1f5f9", "#d1d5db");

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");

  doc.text("Data", margin + 8, y + 7, {
    width: dateW - 16,
    lineBreak: false,
  });

  doc.text("Conteúdo ministrado", margin + dateW + 8, y + 7, {
    width: contentW - 16,
    lineBreak: false,
  });

  return y + 24;
}

function drawDailyFooter(params: {
  doc: PDFKit.PDFDocument;
  className: string;
  referenceMonthLabel: string;
  lessonDate: string;
  pageNumber: number;
  totalPages: number;
}) {
  const { doc, className, referenceMonthLabel, lessonDate, pageNumber, totalPages } = params;

  const margin = 40;
  const safeBottom = doc.page.height - margin;
  const lineY = safeBottom - 24;
  const leftTextY = safeBottom - 16;
  const rightTextY = safeBottom - 16;

  const emitDate = new Date().toLocaleDateString("pt-BR");
  const schoolDay = brDateFromISO(lessonDate);

  doc
    .moveTo(margin, lineY)
    .lineTo(doc.page.width - margin, lineY)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7280")
    .text(
      `Turma: ${className}  •  Aula do dia: ${schoolDay}  •  Mês: ${referenceMonthLabel}  •  Emitido em: ${emitDate}`,
      margin,
      leftTextY,
      {
        width: doc.page.width - margin * 2 - 90,
        align: "left",
        lineBreak: false,
      }
    );

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7280")
    .text(`Página ${pageNumber} de ${totalPages}`, doc.page.width - margin - 90, rightTextY, {
      width: 90,
      align: "right",
      lineBreak: false,
    });
}

function drawSummaryFooter(params: {
  doc: PDFKit.PDFDocument;
  className: string;
  periodText: string;
  pageNumber: number;
  totalPages: number;
}) {
  const { doc, className, periodText, pageNumber, totalPages } = params;

  const margin = 40;
  const safeBottom = doc.page.height - margin;
  const lineY = safeBottom - 24;
  const textY = safeBottom - 16;
  const emitDate = new Date().toLocaleDateString("pt-BR");

  doc
    .moveTo(margin, lineY)
    .lineTo(doc.page.width - margin, lineY)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(8).fillColor("#6b7280");

  doc.text(`Turma: ${className} • Período: ${periodText} • Emitido em: ${emitDate}`, margin, textY, {
    width: doc.page.width - margin * 2 - 90,
    align: "left",
    lineBreak: false,
  });

  doc.text(`Página ${pageNumber} de ${totalPages}`, doc.page.width - margin - 90, textY, {
    width: 90,
    align: "right",
    lineBreak: false,
  });
}

function estimateSectionHeight(doc: PDFKit.PDFDocument, value: string, width: number) {
  const titleGap = 16;
  const text = value?.trim() ? value.trim() : "—";
  const textHeight = getTextHeight(doc, text, width - 24, 10);
  const boxHeight = Math.max(40, textHeight + 20);

  return titleGap + boxHeight + 18;
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
  const text = value?.trim() ? value.trim() : "—";

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(title, x, y);

  const boxY = y + 16;
  const textHeight = getTextHeight(doc, text, width - 24, 10);
  const boxHeight = Math.max(40, textHeight + 20);

  doc
    .roundedRect(x, boxY, width, boxHeight, 8)
    .strokeColor("#d1d5db")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#374151").text(text, x + 12, boxY + 10, {
    width: width - 24,
    align: "left",
  });

  return boxY + boxHeight;
}

function drawSignature(params: {
  doc: PDFKit.PDFDocument;
  teacherName: string;
  y?: number;
}) {
  const { doc, teacherName, y } = params;

  const signatureY = y ?? doc.page.height - 112;
  const lineStartX = doc.page.width - 240;
  const lineEndX = doc.page.width - 60;

  doc
    .moveTo(lineStartX, signatureY)
    .lineTo(lineEndX, signatureY)
    .strokeColor("#6b7280")
    .lineWidth(1)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#374151")
    .text(teacherName || "Professor(a)", lineStartX, signatureY + 6, {
      width: lineEndX - lineStartX,
      align: "center",
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#374151")
    .text("Professor(a)", lineStartX, signatureY + 20, {
      width: lineEndX - lineStartX,
      align: "center",
      lineBreak: false,
    });
}

function drawDailyReport(params: {
  doc: PDFKit.PDFDocument;
  entry: DiaryEntry;
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
    entry,
    schoolName,
    className,
    teacherName,
    subjectName,
    termLabel,
    referenceMonthLabel,
    logoBuffer,
  } = params;

  const margin = 40;
  const contentWidth = doc.page.width - margin * 2;
  const bottomLimit = doc.page.height - 150;

  let y = drawDailyHeader({
    doc,
    schoolName,
    className,
    teacherName,
    subjectName,
    termLabel,
    referenceMonthLabel,
    logoBuffer,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111827")
    .text(`Data da aula: ${brDateFromISO(entry.lesson_date)}`, margin, y);

  y += 24;

  const blocks = [
    { title: "Conteúdo ministrado", value: entry.content_taught || "" },
    { title: "Metodologia", value: entry.methodology || "" },
    { title: "Atividades desenvolvidas", value: entry.activities || "" },
    { title: "Observações", value: entry.notes || "" },
    { title: "Tarefa de casa", value: entry.homework || "" },
  ];

  for (const block of blocks) {
    const blockHeight = estimateSectionHeight(doc, block.value || "", contentWidth);

    if (y + blockHeight > bottomLimit) {
      doc.addPage();
      y = 50;
    }

    y =
      drawSection({
        doc,
        x: margin,
        y,
        width: contentWidth,
        title: block.title,
        value: block.value || "",
      }) + 18;
  }

  const signatureHeight = 44;
  const signatureY = doc.page.height - 112;

  if (y + signatureHeight > signatureY) {
    doc.addPage();
  }

  drawSignature({
    doc,
    teacherName,
  });
}

function drawSummaryReport(params: {
  doc: PDFKit.PDFDocument;
  entries: DiaryEntry[];
  schoolName: string;
  className: string;
  teacherName: string;
  subjectName: string;
  termLabel: string;
  referenceMonthLabel: string;
  periodText: string;
  logoBuffer: Buffer | null;
}) {
  const {
    doc,
    entries,
    schoolName,
    className,
    teacherName,
    subjectName,
    termLabel,
    referenceMonthLabel,
    periodText,
    logoBuffer,
  } = params;

  const margin = 40;
  const dateW = 86;
  const contentW = doc.page.width - margin * 2 - dateW;

  const tableTopFirstPage = 222;
  const tableTopOtherPages = 68;
  const bottomLimit = doc.page.height - 150;

  drawSummaryHeader({
    doc,
    schoolName,
    className,
    teacherName,
    subjectName,
    termLabel,
    referenceMonthLabel,
    periodText,
    logoBuffer,
  });

  let y = drawSummaryTableHeader(doc, tableTopFirstPage);

  for (const entry of entries) {
    const content = String(entry.content_taught || "").trim() || "—";

    doc.font("Helvetica").fontSize(9);

    const contentHeight = doc.heightOfString(content, {
      width: contentW - 16,
      align: "left",
    });

    const rowH = Math.max(24, contentHeight + 14);

    if (y + rowH > bottomLimit) {
      doc.addPage();

      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
      doc.text("Diário de Classe — continuação", margin, 38, {
        width: doc.page.width - margin * 2,
        align: "center",
      });

      y = drawSummaryTableHeader(doc, tableTopOtherPages);
    }

    doc.rect(margin, y, dateW, rowH).strokeColor("#d1d5db").lineWidth(1).stroke();
    doc.rect(margin + dateW, y, contentW, rowH).strokeColor("#d1d5db").lineWidth(1).stroke();

    doc.font("Helvetica").fontSize(9).fillColor("#111827");

    doc.text(brDateFromISO(entry.lesson_date), margin + 8, y + 8, {
      width: dateW - 16,
      align: "center",
    });

    doc.text(content, margin + dateW + 8, y + 8, {
      width: contentW - 16,
      align: "left",
    });

    y += rowH;
  }

  const signatureHeight = 44;
  const signatureY = doc.page.height - 112;

  if (y + signatureHeight > signatureY) {
    doc.addPage();
  }

  drawSignature({
    doc,
    teacherName,
  });
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
  const startDateParam = (url.searchParams.get("startDate") || "").trim();
  const endDateParam = (url.searchParams.get("endDate") || "").trim();
  const reportMode = (url.searchParams.get("reportMode") || "").trim();

  const isDailyReport = Boolean(lessonDate) && reportMode !== "summary";

  let startDate = startDateParam;
  let endDate = endDateParam;

  if (lessonDate && !startDate && !endDate) {
    startDate = lessonDate;
    endDate = lessonDate;
  }

  if (!startDate && referenceMonth) {
    startDate = monthStart(referenceMonth);
  }

  if (!endDate && referenceMonth) {
    endDate = monthEnd(referenceMonth);
  }

  if (!schoolId) return jsonError("Escola não identificada.", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!referenceMonth) return jsonError("referenceMonth é obrigatório.", 400);
  if (!subjectName) return jsonError("subjectName é obrigatório.", 400);

  if (isDailyReport && !isValidDateYMD(lessonDate)) {
    return jsonError("lessonDate inválida. Use o formato YYYY-MM-DD.", 400);
  }

  if (!startDate || !endDate) {
    return jsonError("Informe startDate e endDate para gerar o relatório.", 400);
  }

  if (!isValidDateYMD(startDate)) {
    return jsonError("startDate inválida. Use o formato YYYY-MM-DD.", 400);
  }

  if (!isValidDateYMD(endDate)) {
    return jsonError("endDate inválida. Use o formato YYYY-MM-DD.", 400);
  }

  if (startDate > endDate) {
    return jsonError("A data inicial não pode ser maior que a data final.", 400);
  }

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

  const { data: classData, error: classErr } = await supabaseAdmin
    .from("classes")
    .select("name")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .single();

  if (classErr) {
    return jsonError("Falha ao buscar turma.", 500, {
      details: classErr.message,
    });
  }

  const className = classData?.name || classId;

  const startMonth = monthFromDateYMD(startDate);
  const endMonth = monthFromDateYMD(endDate);

  let diaryQuery = supabaseAdmin
    .from("class_diaries")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("subject_name", subjectName)
    .order("reference_month", { ascending: true });

  if (isDailyReport) {
    diaryQuery = diaryQuery.eq("reference_month", referenceMonth);
  } else if (startMonth && endMonth) {
    diaryQuery = diaryQuery.gte("reference_month", startMonth).lte("reference_month", endMonth);
  } else {
    diaryQuery = diaryQuery.eq("reference_month", referenceMonth);
  }

  const { data: diaries, error: diaryErr } = await diaryQuery;

  if (diaryErr) {
    return jsonError("Falha ao buscar diário.", 500, {
      details: diaryErr.message,
    });
  }

  if (!diaries || diaries.length === 0) {
    return jsonError("Diário não encontrado para os filtros informados.", 404);
  }

  const diaryIds = diaries.map((d: any) => d.id).filter(Boolean);
  const firstDiary = diaries[0] as any;

  const teacherName = await getTeacherDisplayName({
    teacherUserId: firstDiary.teacher_user_id,
    schoolId,
  });

  let entriesQuery = supabaseAdmin
    .from("class_diary_entries")
    .select("id, lesson_date, content_taught, methodology, activities, notes, homework")
    .in("diary_id", diaryIds)
    .order("lesson_date", { ascending: true });

  if (isDailyReport) {
    entriesQuery = entriesQuery.eq("lesson_date", lessonDate);
  } else {
    entriesQuery = entriesQuery.gte("lesson_date", startDate).lte("lesson_date", endDate);
  }

  const { data: entries, error: entriesErr } = await entriesQuery;

  if (entriesErr) {
    return jsonError("Falha ao buscar lançamentos do diário.", 500, {
      details: entriesErr.message,
    });
  }

  const diaryEntries = (entries || []) as DiaryEntry[];

  if (diaryEntries.length === 0) {
    return jsonError(
      isDailyReport
        ? "Nenhum lançamento encontrado para a data informada."
        : "Nenhum lançamento encontrado para o período selecionado.",
      404
    );
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 40,
    bufferPages: true,
    autoFirstPage: true,
  });

  const referenceMonthLabel = formatMonthLabel(referenceMonth);
  const selectedPeriodLabel = periodLabel(startDate, endDate);
  const finalTermLabel = termLabel || firstDiary.term_label || "—";

  if (isDailyReport) {
    drawDailyReport({
      doc,
      entry: diaryEntries[0],
      schoolName,
      className,
      teacherName,
      subjectName,
      termLabel: finalTermLabel,
      referenceMonthLabel,
      logoBuffer,
    });
  } else {
    drawSummaryReport({
      doc,
      entries: diaryEntries,
      schoolName,
      className,
      teacherName,
      subjectName,
      termLabel: finalTermLabel,
      referenceMonthLabel,
      periodText: selectedPeriodLabel,
      logoBuffer,
    });
  }

  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);

    if (isDailyReport) {
      drawDailyFooter({
        doc,
        className,
        referenceMonthLabel,
        lessonDate: diaryEntries[0].lesson_date,
        pageNumber: i + 1,
        totalPages,
      });
    } else {
      drawSummaryFooter({
        doc,
        className,
        periodText: selectedPeriodLabel,
        pageNumber: i + 1,
        totalPages,
      });
    }
  }

  const buffer = await pdfToBuffer(doc);

  const safeFileName = isDailyReport
    ? `diario-dia-${lessonDate}.pdf`
    : `diario-classe-${classId}-${startDate}-ate-${endDate}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFileName}"`,
      "Cache-Control": "no-store",
    },
  });
}