// PDF da "Ficha Completa do Aluno" (mesmo modelo visual de antes: cabeçalho escuro com logo,
// cartão do aluno, seções em caixas arredondadas, responsáveis e assinatura).
// Sem banco/rede: recebe os dados prontos — testado em tests/school-students-update.test.mjs
// com dados fictícios e textos longos.
//
// Regras de layout: caixas com altura medida pelo conteúdo (nada é cortado com "..."),
// quebra de página antes de qualquer bloco que não caiba, margens fixas de 34 pt, rodapé
// "Página X de Y" e datas no horário de Brasília.
import PDFDocument from "pdfkit";
import {
  EMPTY,
  brDate,
  brDateTime,
  buildAddressText,
  formatCpf,
  formatPhoneBR,
  normalizePdfText,
  orEmpty,
} from "../pdf/text";

export type ProfilePdfParent = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  cpf?: string | null;
  phone_secondary?: string | null;
  zip_code?: string | null;
  street?: string | null;
  street_number?: string | null;
  address_complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  first_login_completed?: boolean | null;
  relationship?: string | null;
};

export type ProfilePdfData = {
  schoolName: string;
  schoolLogo: Buffer | null;
  studentPhoto: Buffer | null;
  student: Record<string, any>;
  activeClass: { name?: string | null; grade?: string | null; shift?: string | null } | null;
  activeLinkStartedAt: string | null;
  parents: ProfilePdfParent[];
  issuedAt: Date;
};

export type PdfBox = { page: number; x: number; y: number; w: number; h: number; label: string };

const MARGIN = 34;
const GAP = 8;
const HEADER_BOTTOM = 104;
const FOOTER_SPACE = 52; // linha do rodapé fica em altura - 46
const LABEL_SIZE = 6.2;
const VALUE_SIZE = 7.8;
const LONG_SIZE = 7.7;

type Ctx = {
  doc: PDFKit.PDFDocument;
  data: ProfilePdfData;
  y: number;
  page: number;
  onBox?: (b: PdfBox) => void;
};

const contentWidth = (doc: PDFKit.PDFDocument) => doc.page.width - MARGIN * 2;
const bottomLimit = (doc: PDFKit.PDFDocument) => doc.page.height - FOOTER_SPACE;
const maxBlockHeight = (doc: PDFKit.PDFDocument) => bottomLimit(doc) - HEADER_BOTTOM;

function safeImage(doc: PDFKit.PDFDocument, buffer: Buffer | null, x: number, y: number, size: number): boolean {
  if (!buffer) return false;
  try {
    doc.image(buffer, x, y, { fit: [size, size], align: "center", valign: "center" });
    return true;
  } catch {
    return false; // formato não suportado (ex.: WEBP/SVG): usa as iniciais
  }
}

function initials(name: unknown, fallback: string) {
  const parts = normalizePdfText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase(); // mesmo critério do modelo anterior
}

function drawHeader(ctx: Ctx) {
  const { doc, data } = ctx;
  const w = doc.page.width;
  doc.save();
  doc.rect(0, 0, w, 86).fill("#0f172a");
  doc.rect(0, 82, w, 4).fill("#2563eb");
  doc.roundedRect(MARGIN, 18, 48, 48, 10).fill("#ffffff");
  if (!safeImage(doc, data.schoolLogo, MARGIN + 4, 22, 40)) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a");
    doc.text("ESC", MARGIN, 36, { width: 48, align: "center", lineBreak: false });
  }
  const textX = MARGIN + 62;
  const textW = w - MARGIN * 2 - 62;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#bfdbfe");
  doc.text(orEmpty(ctx.data.schoolName, "Escola"), textX, 21, { width: textW, height: 12, ellipsis: true, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff");
  doc.text("Ficha Completa do Aluno", textX, 37, { width: textW, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor("#cbd5e1");
  doc.text(
    "Documento oficial com dados escolares, saúde, segurança e responsáveis vinculados.",
    textX,
    61,
    { width: textW, height: 12, ellipsis: true, lineBreak: false }
  );
  doc.restore();
}

function newPage(ctx: Ctx) {
  ctx.doc.addPage({ size: "A4", margin: 0 });
  ctx.page += 1;
  drawHeader(ctx);
  ctx.y = HEADER_BOTTOM;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y + needed > bottomLimit(ctx.doc)) newPage(ctx);
}

function textHeight(doc: PDFKit.PDFDocument, text: string, width: number, font: string, size: number) {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text || "—", { width, lineGap: 1 });
}

type BoxSpec = { label: string; value: string; long?: boolean; width: number };

function boxHeight(doc: PDFKit.PDFDocument, b: BoxSpec, min: number) {
  const font = b.long ? "Helvetica" : "Helvetica-Bold";
  const size = b.long ? LONG_SIZE : VALUE_SIZE;
  const h = 20 + textHeight(doc, b.value, b.width - 16, font, size) + 8;
  return Math.min(Math.max(min, Math.ceil(h)), maxBlockHeight(doc));
}

function drawBox(ctx: Ctx, x: number, y: number, h: number, b: BoxSpec) {
  const { doc } = ctx;
  doc.save();
  doc.roundedRect(x, y, b.width, h, 8).fillAndStroke("#f8fafc", "#e5e7eb");
  doc.font("Helvetica-Bold").fontSize(LABEL_SIZE).fillColor("#64748b");
  doc.text(normalizePdfText(b.label).toUpperCase(), x + 8, y + 7, { width: b.width - 16, height: 8, ellipsis: true, lineBreak: false });
  doc.font(b.long ? "Helvetica" : "Helvetica-Bold").fontSize(b.long ? LONG_SIZE : VALUE_SIZE).fillColor("#0f172a");
  doc.text(b.value || "—", x + 8, y + 20, { width: b.width - 16, height: h - 24, lineGap: 1, ellipsis: true });
  doc.restore();
  ctx.onBox?.({ page: ctx.page, x, y, w: b.width, h, label: b.label });
}

// Linha de caixas lado a lado com a mesma altura (a maior entre elas).
function boxRow(ctx: Ctx, boxes: Array<Omit<BoxSpec, "width">>, columns = boxes.length, min = 38) {
  const { doc } = ctx;
  const width = (contentWidth(doc) - GAP * (columns - 1)) / columns;
  const specs = boxes.map((b) => ({ ...b, width }));
  const h = Math.max(...specs.map((s) => boxHeight(doc, s, min)));
  ensureSpace(ctx, h);
  specs.forEach((s, i) => drawBox(ctx, MARGIN + i * (width + GAP), ctx.y, h, s));
  ctx.y += h + GAP;
}

function sectionTitle(ctx: Ctx, title: string, subtitle?: string, keepWith = 50) {
  ensureSpace(ctx, (subtitle ? 26 : 18) + keepWith);
  const { doc } = ctx;
  doc.save();
  doc.font("Helvetica-Bold").fontSize(11.2).fillColor("#0f172a");
  doc.text(title, MARGIN, ctx.y, { width: contentWidth(doc), lineBreak: false });
  if (subtitle) {
    doc.font("Helvetica").fontSize(7.4).fillColor("#64748b");
    doc.text(subtitle, MARGIN, ctx.y + 14, { width: contentWidth(doc), lineBreak: false });
  }
  doc.restore();
  ctx.y += subtitle ? 26 : 18;
}

function drawHero(ctx: Ctx) {
  const { doc, data } = ctx;
  const s = data.student;
  const w = contentWidth(doc);
  const photo = 66;
  const textX = MARGIN + 14 + photo + 16;
  const textW = w - photo - 46;
  const name = orEmpty(s.full_name);
  doc.font("Helvetica-Bold").fontSize(15);
  const nameH = Math.min(doc.heightOfString(name, { width: textW }), 38); // até 2 linhas
  const details = `Matrícula: ${orEmpty(s.registration_number, "—")}  •  Nascimento: ${brDate(s.birth_date)}  •  Turma: ${orEmpty(
    data.activeClass?.name,
    "—"
  )}`;
  doc.font("Helvetica").fontSize(8.1);
  const detailsH = doc.heightOfString(details, { width: textW });
  const cardH = Math.max(94, Math.ceil(35 + nameH + 6 + detailsH + 4 + 10 + 12));
  ensureSpace(ctx, cardH);
  const y = ctx.y;

  doc.save();
  doc.roundedRect(MARGIN, y, w, cardH, 15).fillAndStroke("#ffffff", "#dbeafe");
  doc.roundedRect(MARGIN + 14, y + 14, photo, photo, 13).fillAndStroke("#eff6ff", "#dbeafe");
  if (!safeImage(doc, data.studentPhoto, MARGIN + 14, y + 14, photo)) {
    doc.font("Helvetica-Bold").fontSize(21).fillColor("#1e293b");
    doc.text(initials(s.full_name, "AL"), MARGIN + 14, y + 36, { width: photo, align: "center", lineBreak: false });
  }
  doc.roundedRect(textX, y + 12, 54, 18, 9).fill("#dbeafe");
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#1d4ed8");
  doc.text("ALUNO", textX, y + 17, { width: 54, align: "center", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a");
  doc.text(name, textX, y + 35, { width: textW, height: nameH + 2, ellipsis: true });
  let ty = y + 35 + nameH + 6;
  doc.font("Helvetica").fontSize(8.1).fillColor("#475569");
  doc.text(details, textX, ty, { width: textW });
  ty += detailsH + 4;
  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b");
  doc.text(`Cadastro: ${brDateTime(s.created_at)}`, textX, ty, { width: textW, lineBreak: false });
  doc.restore();
  ctx.onBox?.({ page: ctx.page, x: MARGIN, y, w, h: cardH, label: "Aluno" });
  ctx.y = y + cardH + 8;
}

function drawParent(ctx: Ctx, p: ProfilePdfParent) {
  const { doc } = ctx;
  const w = contentWidth(doc);
  const inner = w - 24;
  const col = (inner - GAP * 2) / 3;
  const name = orEmpty(p.full_name);
  const rel = normalizePdfText(p.relationship);
  const nameW = inner - (rel ? 92 : 0);
  doc.font("Helvetica-Bold").fontSize(10.5);
  const nameH = Math.min(doc.heightOfString(name, { width: nameW }), 28);

  const row = [
    { label: "Telefone", value: formatPhoneBR(p.phone), width: col },
    { label: "CPF", value: formatCpf(p.cpf), width: col },
    { label: "Telefone secundário", value: formatPhoneBR(p.phone_secondary), width: col },
  ];
  const rowH = Math.max(...row.map((b) => boxHeight(doc, b, 36)));
  const address = { label: "Endereço", value: buildAddressText(p) || EMPTY, long: true, width: inner };
  const addrH = boxHeight(doc, address, 34);
  const headerH = 10 + nameH + 4 + 10 + 8;
  const cardH = headerH + rowH + GAP + addrH + 12;

  ensureSpace(ctx, cardH);
  const y = ctx.y;
  doc.save();
  doc.roundedRect(MARGIN, y, w, cardH, 12).fillAndStroke("#ffffff", "#e5e7eb");
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a");
  doc.text(name, MARGIN + 12, y + 10, { width: nameW, height: nameH + 2, ellipsis: true });
  doc.font("Helvetica").fontSize(7.2).fillColor("#64748b");
  doc.text(
    p.first_login_completed ? "Cadastro completo preenchido no Portal dos Pais" : "Cadastro ainda não finalizado pelo responsável",
    MARGIN + 12,
    y + 10 + nameH + 4,
    { width: inner, lineBreak: false }
  );
  if (rel) {
    doc.roundedRect(MARGIN + w - 92, y + 9, 78, 18, 9).fill("#ecfeff");
    doc.font("Helvetica-Bold").fontSize(6.7).fillColor("#0369a1");
    doc.text(rel, MARGIN + w - 92, y + 14, { width: 78, height: 8, align: "center", ellipsis: true, lineBreak: false });
  }
  doc.restore();
  ctx.onBox?.({ page: ctx.page, x: MARGIN, y, w, h: cardH, label: `Responsável ${name}` });

  const rowY = y + headerH;
  row.forEach((b, i) => drawBox(ctx, MARGIN + 12 + i * (col + GAP), rowY, rowH, b));
  drawBox(ctx, MARGIN + 12, rowY + rowH + GAP, addrH, address);
  ctx.y = y + cardH + 9;
}

function drawSignature(ctx: Ctx) {
  const { doc } = ctx;
  const w = contentWidth(doc);
  const text =
    "Declaro que as informações apresentadas nesta ficha correspondem aos dados registrados no sistema escolar até a data de emissão deste documento.";
  doc.font("Helvetica").fontSize(7.5);
  const textH = doc.heightOfString(text, { width: w - 24 });
  const h = Math.ceil(10 + textH + 30);
  ensureSpace(ctx, h);
  const y = ctx.y;
  doc.save();
  doc.roundedRect(MARGIN, y, w, h, 11).fillAndStroke("#ffffff", "#e5e7eb");
  doc.font("Helvetica").fontSize(7.5).fillColor("#475569");
  doc.text(text, MARGIN + 12, y + 10, { width: w - 24 });
  const lineW = 190;
  const lineX = MARGIN + w - lineW - 18;
  const lineY = y + h - 18;
  doc.moveTo(lineX, lineY).lineTo(lineX + lineW, lineY).strokeColor("#64748b").lineWidth(1).stroke();
  doc.font("Helvetica").fontSize(7).fillColor("#334155");
  doc.text("Assinatura da direção / secretaria", lineX, lineY + 5, { width: lineW, align: "center", lineBreak: false });
  doc.restore();
  ctx.onBox?.({ page: ctx.page, x: MARGIN, y, w, h, label: "Assinatura" });
  ctx.y = y + h + 8;
}

function drawFooters(doc: PDFKit.PDFDocument, issuedAt: Date) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const lineY = doc.page.height - 46;
    doc.save();
    doc.moveTo(MARGIN, lineY).lineTo(doc.page.width - MARGIN, lineY).strokeColor("#e5e7eb").lineWidth(1).stroke();
    doc.font("Helvetica").fontSize(7).fillColor("#64748b");
    doc.text(`Emitido em ${brDateTime(issuedAt)} (horário de Brasília)`, MARGIN, doc.page.height - 34, {
      width: 300,
      lineBreak: false,
    });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, doc.page.width - MARGIN - 120, doc.page.height - 34, {
      width: 120,
      align: "right",
      lineBreak: false,
    });
    doc.restore();
  }
}

export async function buildStudentProfilePdf(
  data: ProfilePdfData,
  opts: { compress?: boolean; onBox?: (b: PdfBox) => void; onPages?: (n: number) => void } = {}
): Promise<Buffer> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: "A4",
    layout: "portrait",
    margin: 0,
    bufferPages: true,
    compress: opts.compress ?? true,
    info: { Title: `Ficha do aluno - ${normalizePdfText(data.student.full_name) || "Aluno"}`, Producer: "Minha Escola" },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const ctx: Ctx = { doc, data, y: HEADER_BOTTOM, page: 0, onBox: opts.onBox };
  newPage(ctx);

  const s = data.student;
  drawHero(ctx);

  sectionTitle(ctx, "Dados oficiais do aluno");
  boxRow(ctx, [
    { label: "Nome completo", value: orEmpty(s.full_name) },
    { label: "Matrícula", value: orEmpty(s.registration_number) },
    { label: "Nascimento", value: brDate(s.birth_date, EMPTY) },
    { label: "Sexo", value: orEmpty(s.gender) },
  ]);
  boxRow(ctx, [
    { label: "CPF", value: formatCpf(s.cpf) },
    { label: "RG", value: orEmpty(s.rg) },
    { label: "Certidão de nascimento", value: orEmpty(s.birth_certificate) },
    { label: "Atualizado em", value: brDateTime(s.student_profile_updated_at, EMPTY) },
  ]);

  sectionTitle(ctx, "Filiação");
  boxRow(ctx, [
    { label: "Nome da mãe", value: orEmpty(s.mother_name) },
    { label: "Nome do pai", value: orEmpty(s.father_name) },
  ], 2, 40);

  const long = (v: unknown) => normalizePdfText(v, { keepLineBreaks: true }) || EMPTY;
  sectionTitle(ctx, "Saúde, segurança e observações");
  boxRow(ctx, [
    { label: "Observações médicas / alertas", value: long(s.medical_notes), long: true },
    { label: "Alergias", value: long(s.allergies), long: true },
  ], 2, 38);
  boxRow(ctx, [
    { label: "Medicação contínua", value: long(s.continuous_medication), long: true },
    { label: "Restrições alimentares", value: long(s.food_restrictions), long: true },
  ], 2, 38);
  const emergencyName = normalizePdfText(s.emergency_contact_name);
  const emergencyPhone = normalizePdfText(s.emergency_contact_phone) ? formatPhoneBR(s.emergency_contact_phone) : "";
  boxRow(ctx, [
    {
      label: "Contato de emergência",
      value: emergencyName || emergencyPhone ? [emergencyName || EMPTY, emergencyPhone].filter(Boolean).join(" — ") : EMPTY,
      long: true,
    },
    { label: "Autorizados para buscar / retirada", value: long(s.authorized_pickup_notes), long: true },
  ], 2, 38);
  boxRow(ctx, [{ label: "Observações gerais", value: long(s.general_notes), long: true }], 1, 38);

  sectionTitle(ctx, "Turma atual");
  boxRow(ctx, [
    { label: "Turma", value: orEmpty(data.activeClass?.name) },
    { label: "Série", value: orEmpty(data.activeClass?.grade) },
    { label: "Turno", value: orEmpty(data.activeClass?.shift) },
    { label: "Vínculo desde", value: brDate(data.activeLinkStartedAt, EMPTY) },
  ]);

  sectionTitle(
    ctx,
    "Responsáveis vinculados",
    "Dados de contato e endereço dos responsáveis associados ao aluno.",
    data.parents.length ? 120 : 50
  );
  if (!data.parents.length) {
    boxRow(ctx, [{ label: "Responsáveis", value: "Nenhum responsável vinculado ao aluno.", long: true }], 1, 38);
  } else {
    for (const p of data.parents) drawParent(ctx, p);
  }

  drawSignature(ctx);
  drawFooters(doc, data.issuedAt);
  opts.onPages?.(doc.bufferedPageRange().count);

  doc.end();
  return done;
}
