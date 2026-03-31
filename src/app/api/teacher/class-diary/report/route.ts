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

function brDateFromISO(iso: string) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatMonthLabel(ref: string) {
  const [year, month] = String(ref || "").split("-");
  if (!year || !month) return ref;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function parseSupabaseStorageRef(logoUrl: string): { bucket: string; path: string } | null {
  const u = String(logoUrl || "").trim();
  if (!u) return null;

  const pub = u.split("/storage/v1/object/public/");
  if (pub.length === 2) {
    const rest = pub[1];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");
    if (bucket && path) return { bucket, path };
  }

  return null;
}

async function getLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  try {
    if (!logoUrl) return null;

    const ref = parseSupabaseStorageRef(logoUrl);

    if (ref) {
      const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
      if (!error && data) {
        const ab = await data.arrayBuffer();
        return Buffer.from(ab);
      }
    }

    const res = await fetch(logoUrl);
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

  return 225;
}

function drawFooter(params: {
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
}) {
  const { doc, teacherName } = params;

  const signatureY = doc.page.height - 110;

  doc
    .moveTo(doc.page.width - 240, signatureY)
    .lineTo(doc.page.width - 60, signatureY)
    .strokeColor("#6b7280")
    .lineWidth(1)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#374151")
    .text(teacherName || "Professor(a)", doc.page.width - 220, signatureY + 6, {
      width: 140,
      align: "center",
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#374151")
    .text("Professor(a)", doc.page.width - 220, signatureY + 20, {
      width: 140,
      align: "center",
      lineBreak: false,
    });
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "professor",
    "teacher",
    "coordenador",
    "coordinator",
    "diretor",
    "director",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;
  const teacherUserId =
    (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

  const url = new URL(req.url);
  const classId = String(url.searchParams.get("classId") || "").trim();
  const referenceMonth = String(url.searchParams.get("referenceMonth") || "").trim();
  const subjectName = String(url.searchParams.get("subjectName") || "").trim();
  const termLabel = String(url.searchParams.get("termLabel") || "").trim();
  const lessonDate = String(url.searchParams.get("lessonDate") || "").trim();

  if (!teacherUserId) return jsonError("Professor não identificado.", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!referenceMonth) return jsonError("referenceMonth é obrigatório.", 400);
  if (!subjectName) return jsonError("subjectName é obrigatório.", 400);
  if (!lessonDate) return jsonError("lessonDate é obrigatório.", 400);

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .limit(1);

  if (linkErr) {
    return jsonError("Erro ao validar vínculo professor-turma.", 500, {
      details: linkErr.message,
    });
  }

  if (!link || link.length === 0) {
    return jsonError("Professor não está vinculado a esta turma.", 403);
  }

  const { data: school, error: schoolErr } = await supabaseAdmin
    .from("schools")
    .select("name, brand_logo_url")
    .eq("id", schoolId)
    .single();

  if (schoolErr) {
    return jsonError("Falha ao buscar dados da escola.", 500, {
      details: schoolErr.message,
    });
  }

  const schoolName = school?.name || "Escola";
  const logoBuffer = await getLogoBuffer(school?.brand_logo_url || null);

  const { data: classData, error: classErr } = await supabaseAdmin
    .from("classes")
    .select("name")
    .eq("id", classId)
    .single();

  if (classErr) {
    return jsonError("Falha ao buscar dados da turma.", 500, {
      details: classErr.message,
    });
  }

  const className = classData?.name || classId;
  const teacherName = await getTeacherDisplayName({ teacherUserId, schoolId });

  const { data: diary, error: diaryErr } = await supabaseAdmin
    .from("class_diaries")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .eq("subject_name", subjectName)
    .eq("reference_month", referenceMonth)
    .maybeSingle();

  if (diaryErr) {
    return jsonError("Falha ao buscar diário.", 500, { details: diaryErr.message });
  }

  if (!diary?.id) {
    return jsonError("Diário não encontrado.", 404);
  }

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

  if (!entries || entries.length === 0) {
    return jsonError("Nenhum lançamento encontrado para a data informada.", 404);
  }

  const entry = (entries as DiaryEntry[])[0];

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 40,
    bufferPages: true,
    autoFirstPage: true,
  });

  const margin = 40;
  const contentWidth = doc.page.width - margin * 2;
  const referenceMonthLabel = formatMonthLabel(referenceMonth);

  const firstPageBottomLimit = doc.page.height - 150;
  const nextPageBottomLimit = doc.page.height - 150;

  let y = drawHeader({
    doc,
    schoolName,
    className,
    teacherName,
    subjectName,
    termLabel: termLabel || diary.term_label || "—",
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

  let isFirstPage = true;

  for (const block of blocks) {
    const blockHeight = estimateSectionHeight(doc, block.value || "", contentWidth);
    const currentBottomLimit = isFirstPage ? firstPageBottomLimit : nextPageBottomLimit;

    if (y + blockHeight > currentBottomLimit) {
      doc.addPage();
      y = 50;
      isFirstPage = false;
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

  drawSignature({
    doc,
    teacherName,
  });

  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    drawFooter({
      doc,
      className,
      referenceMonthLabel,
      lessonDate: entry.lesson_date,
      pageNumber: i + 1,
      totalPages,
    });
  }

  const buffer = await pdfToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="diario-classe-${classId}-${lessonDate}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}