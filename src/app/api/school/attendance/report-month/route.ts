// src/app/api/school/attendance/report-month/route.ts
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type SessionRow = {
  id: string;
  lesson_date: string;
  lesson_number: number;
};

type RecordRow = {
  session_id: string;
  student_id: string;
  status: AttendanceStatus | string;
  note: string | null;
};

type StudentRow = {
  id: string;
  full_name?: string | null;
  registration_number?: string | null;
};

type FinalStudent = {
  id: string;
  name: string;
  reg: string;
};

type CalendarBlock = {
  id: string;
  block_date: string;
  type: string;
  title: string;
  description: string | null;
  target_scope: string | null;
  class_id: string | null;
  shift: string | null;
  affects_all_classes: boolean | null;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function safeText(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function brDateFromISO(iso: string) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function isoFromUTCDate(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function rangeFromMonth(month: string) {
  const [y, m] = month.split("-");
  const year = Number(y);
  const mon = Number(m);

  if (!year || !mon) return null;

  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));

  return {
    startISO: isoFromUTCDate(start),
    endISO: isoFromUTCDate(end),
  };
}

function datesBetweenInclusive(startISO: string, endISO: string) {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);

  if (!sy || !sm || !sd || !ey || !em || !ed) return [];

  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));

  const out: string[] = [];
  let cur = start;

  while (cur.getTime() <= end.getTime()) {
    out.push(isoFromUTCDate(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }

  return out;
}

function normalizeStatus(raw: any): AttendanceStatus | null {
  const s = String(raw || "").toLowerCase().trim();

  if (!s) return null;
  if (s === "present" || s === "presente" || s === "p") return "present";
  if (s === "absent" || s === "ausente" || s === "f" || s === "falta") return "absent";
  if (s === "late" || s === "tarde" || s === "atraso" || s === "t") return "late";

  return null;
}

function aggregateStatus(statuses: AttendanceStatus[]) {
  if (statuses.includes("absent")) return "absent";
  if (statuses.includes("late")) return "late";
  if (statuses.includes("present")) return "present";
  return null;
}

function isAllSchoolScope(value: unknown) {
  const scope = normalizeComparable(value);

  return (
    !scope ||
    scope === "all" ||
    scope === "school" ||
    scope === "all_school" ||
    scope === "allschool" ||
    scope === "all_classes" ||
    scope === "allclasses" ||
    scope === "toda_escola" ||
    scope === "todaescola"
  );
}

function isClassScope(value: unknown) {
  const scope = normalizeComparable(value);
  return scope === "class" || scope === "turma";
}

function isShiftScope(value: unknown) {
  const scope = normalizeComparable(value);
  return scope === "shift" || scope === "period" || scope === "periodo" || scope === "turno";
}

function blockTypeLabel(type: string) {
  const safe = cleanText(type);

  if (safe === "holiday") return "Feriado";
  if (safe === "recess") return "Recesso escolar";
  if (safe === "no_class") return "Dia sem aula";
  if (safe === "pedagogical_day") return "Dia pedagógico";
  if (safe === "exam_day") return "Dia de avaliação";
  if (safe === "event") return "Evento escolar";

  return "Calendário escolar";
}

async function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function parseSupabaseStorageRef(logoUrl: string): { bucket: string; path: string } | null {
  const u = (logoUrl || "").trim();
  if (!u) return null;

  const pub = u.split("/storage/v1/object/public/");
  if (pub.length === 2) {
    const rest = pub[1].split("?")[0];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");
    if (bucket && path) return { bucket, path };
  }

  const sign = u.split("/storage/v1/object/sign/");
  if (sign.length === 2) {
    const rest = sign[1].split("?")[0];
    const parts = rest.split("/");
    const bucket = parts.shift();
    const path = parts.join("/");
    if (bucket && path) return { bucket, path };
  }

  if (!u.startsWith("http://") && !u.startsWith("https://") && u.includes("/")) {
    const clean = u.split("?")[0];
    const parts = clean.split("/");
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

    const u = logoUrl.trim();
    if (!u) return null;

    if (u.startsWith("data:image/")) {
      return bufferFromDataUrl(u);
    }

    const ref = parseSupabaseStorageRef(u);
    if (ref) {
      const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
      if (!error && data) {
        const ab = await data.arrayBuffer();
        return Buffer.from(ab);
      }
    }

    if (u.startsWith("http://") || u.startsWith("https://")) {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    }

    return null;
  } catch {
    return null;
  }
}

function drawHeaderDateVerticalCentered(
  doc: PDFKit.PDFDocument,
  ddmm: string,
  x: number,
  y: number,
  cellW: number,
  headerH: number,
  fontSize: number
) {
  const cx = x + cellW / 2;
  const cy = y + headerH / 2;

  doc.save();
  doc.translate(cx, cy);
  doc.rotate(-90);
  doc.font("Helvetica").fontSize(fontSize).fillColor("#000");

  const w = doc.widthOfString(ddmm);
  const yFix = fontSize * 0.35;

  doc.text(ddmm, -w / 2, -yFix, { lineBreak: false });
  doc.restore();
}

async function tryGetClassInfo(params: { schoolId: string; classId: string }) {
  const { schoolId, classId } = params;

  try {
    const { data, error } = await supabaseAdmin
      .from("classes")
      .select("id, name, grade, shift")
      .eq("id", classId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (error || !data?.id) {
      return {
        id: classId,
        name: classId,
        grade: null,
        shift: null,
        displayName: classId,
      };
    }

    const parts = [data?.name, data?.grade, data?.shift].map(safeText).filter(Boolean);

    return {
      id: String(data.id),
      name: safeText(data.name) || classId,
      grade: safeText(data.grade) || null,
      shift: safeText(data.shift) || null,
      displayName: parts.join(" • ") || classId,
    };
  } catch {
    return {
      id: classId,
      name: classId,
      grade: null,
      shift: null,
      displayName: classId,
    };
  }
}

async function getApplicableBlockedDates(params: {
  schoolId: string;
  classId: string;
  classShift: string | null;
  startISO: string;
  endISO: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("school_calendar_blocks")
    .select(
      `
      id,
      block_date,
      type,
      title,
      description,
      target_scope,
      class_id,
      shift,
      affects_all_classes
    `
    )
    .eq("school_id", params.schoolId)
    .gte("block_date", params.startISO)
    .lte("block_date", params.endISO)
    .order("block_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      blockedDates: new Set<string>(),
      blocksByDate: new Map<string, CalendarBlock[]>(),
    };
  }

  const blockedDates = new Set<string>();
  const blocksByDate = new Map<string, CalendarBlock[]>();

  for (const block of (data || []) as CalendarBlock[]) {
    let applies = false;

    if (block.affects_all_classes === true) {
      applies = true;
    } else {
      const scope = cleanText(block.target_scope);

      if (isAllSchoolScope(scope)) {
        applies = true;
      } else if (isClassScope(scope)) {
        applies = cleanText(block.class_id) === params.classId;
      } else if (isShiftScope(scope)) {
        applies =
          !!cleanText(block.shift) &&
          normalizeComparable(block.shift) === normalizeComparable(params.classShift);
      }
    }

    if (!applies) continue;

    const date = cleanText(block.block_date);
    if (!date) continue;

    blockedDates.add(date);

    const list = blocksByDate.get(date) || [];
    list.push(block);
    blocksByDate.set(date, list);
  }

  return {
    ok: true as const,
    error: null,
    blockedDates,
    blocksByDate,
  };
}

async function getRosterAcrossPeriod(params: {
  schoolId: string;
  classId: string;
  startISO: string;
  endISO: string;
}) {
  const { schoolId, classId, startISO, endISO } = params;

  const dates = datesBetweenInclusive(startISO, endISO);
  const all = new Set<string>();

  for (const date of dates) {
    try {
      const { data } = await supabaseAdmin.rpc("get_active_students_for_class_on_date", {
        p_class_id: classId,
        p_date: date,
      });

      for (const r of data || []) {
        const id = String((r as any)?.student_id ?? (r as any)?.id ?? "").trim();
        if (id) all.add(id);
      }
    } catch {}
  }

  try {
    const { data } = await supabaseAdmin
      .from("student_classes")
      .select("student_id")
      .eq("school_id", schoolId)
      .eq("class_id", classId)
      .eq("is_active", true);

    for (const row of data || []) {
      const id = String((row as any)?.student_id || "").trim();
      if (id) all.add(id);
    }
  } catch {}

  return Array.from(all);
}

async function fetchStudentsByIds(schoolId: string, studentIds: string[]): Promise<StudentRow[]> {
  if (studentIds.length === 0) return [];

  try {
    const { data } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number")
      .eq("school_id", schoolId)
      .in("id", studentIds);

    return (data || []) as StudentRow[];
  } catch {
    return [];
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
}

function drawReportHeader(params: {
  doc: PDFKit.PDFDocument;
  logoBuffer: Buffer | null;
  schoolName: string;
  className: string;
  startISO: string;
  endISO: string;
  dateChunk: string[];
  datePage: number;
  datePages: number;
  studentPage: number;
  studentPages: number;
  removedDatesCount: number;
}) {
  const {
    doc,
    logoBuffer,
    schoolName,
    className,
    startISO,
    endISO,
    dateChunk,
    datePage,
    datePages,
    studentPage,
    studentPages,
    removedDatesCount,
  } = params;

  const headerTop = 16;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 22, headerTop, { fit: [100, 55] });
    } catch {}
  }

  const dateStart = dateChunk[0] || startISO;
  const dateEnd = dateChunk[dateChunk.length - 1] || endISO;

  doc.fillColor("#000");
  doc.font("Helvetica-Bold").fontSize(15).text(schoolName || "Chamada Escolar", 135, headerTop + 2, {
    width: doc.page.width - 160,
    ellipsis: true,
  });

  doc.font("Helvetica").fontSize(9).fillColor("#333");
  doc.text(`Turma: ${className}`, 135, headerTop + 22, {
    width: doc.page.width - 160,
    ellipsis: true,
  });

  doc.text(`Período geral: ${brDateFromISO(startISO)} até ${brDateFromISO(endISO)}`, 135, headerTop + 35);

  doc.text(`Dias exibidos: ${brDateFromISO(dateStart)} até ${brDateFromISO(dateEnd)}`, 135, headerTop + 48);

  const removedInfo =
    removedDatesCount > 0
      ? ` | ${removedDatesCount} dia(s) sem aula removido(s)`
      : "";

  doc.text(
    `Legenda: • = Presente | F = Falta | T = Atraso${removedInfo} | Datas ${datePage}/${datePages} | Alunos ${studentPage}/${studentPages}`,
    135,
    headerTop + 61,
    {
      width: doc.page.width - 160,
      ellipsis: true,
    }
  );
}

function drawNoSchoolDaysDocument(params: {
  doc: PDFKit.PDFDocument;
  logoBuffer: Buffer | null;
  schoolName: string;
  className: string;
  startISO: string;
  endISO: string;
  removedDatesCount: number;
}) {
  const { doc, logoBuffer, schoolName, className, startISO, endISO, removedDatesCount } = params;

  const pageW = doc.page.width;
  const margin = 46;
  const headerTop = 44;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, margin, headerTop, { fit: [90, 90] });
    } catch {}
  }

  const titleX = margin + 110;

  doc.font("Helvetica-Bold").fontSize(24).fillColor("#0f172a").text(
    schoolName,
    titleX,
    headerTop + 4,
    {
      width: pageW - titleX - margin,
      ellipsis: true,
    }
  );

  doc.font("Helvetica").fontSize(11).fillColor("#334155");
  doc.text(`Turma: ${className}`, titleX, headerTop + 42);
  doc.text(`Período: ${brDateFromISO(startISO)} até ${brDateFromISO(endISO)}`, titleX, headerTop + 60);

  const boxY = headerTop + 140;

  doc.roundedRect(margin, boxY, pageW - margin * 2, 240, 22).fill("#f8fafc");

  doc
    .roundedRect(margin + 22, boxY + 22, pageW - margin * 2 - 44, 196, 18)
    .strokeColor("#cbd5e1")
    .lineWidth(1.2)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(25).fillColor("#0f172a").text(
    "Nenhum dia letivo exibido no período",
    margin + 44,
    boxY + 56,
    {
      width: pageW - margin * 2 - 88,
      align: "center",
    }
  );

  doc.font("Helvetica").fontSize(12).fillColor("#475569").text(
    `Todos os ${removedDatesCount} dia(s) do período foram marcados como dia sem aula, recesso, feriado ou bloqueio de calendário para esta turma/turno/escola.`,
    margin + 70,
    boxY + 116,
    {
      width: pageW - margin * 2 - 140,
      align: "center",
      lineGap: 4,
    }
  );

  doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(
    "Este documento não contabiliza faltas, atrasos ou presenças em dias removidos pelo calendário escolar.",
    margin,
    boxY + 270,
    {
      width: pageW - margin * 2,
      align: "center",
    }
  );
}

function drawAttendanceTable(params: {
  doc: PDFKit.PDFDocument;
  students: FinalStudent[];
  allStudentStartIndex: number;
  dateChunk: string[];
  byStudentDate: Map<string, Map<string, AttendanceStatus>>;
}) {
  const { doc, students, allStudentStartIndex, dateChunk, byStudentDate } = params;

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const tableX = 18;
  const tableY = 96;
  const tableW = pageW - 36;
  const tableBottom = pageH - 34;
  const tableH = tableBottom - tableY;

  const cols = dateChunk.length;

  const colNumW = 24;
  const colRegW = 54;

  const preferredNameW = cols >= 30 ? 210 : cols >= 26 ? 230 : 250;
  const minDateCellW = cols >= 30 ? 12.4 : cols >= 26 ? 13.2 : 14;

  const fixedBaseW = colNumW + preferredNameW + colRegW;
  const dateAreaW = tableW - fixedBaseW;
  const rawCellW = dateAreaW / Math.max(1, cols);

  const cellW = Math.max(minDateCellW, Math.min(18, rawCellW));
  const usedDateW = cellW * cols;

  let colNameW = preferredNameW;
  let startVarX = tableX + colNumW + colNameW + colRegW;

  const overflow = startVarX + usedDateW - (tableX + tableW);

  if (overflow > 0) {
    colNameW = Math.max(175, colNameW - overflow - 2);
    startVarX = tableX + colNumW + colNameW + colRegW;
  }

  const headerRowH = 46;
  const rowH = 16;

  const fontHeader = cols >= 30 ? 6.4 : cols >= 26 ? 7 : 8;
  const fontCell = 7;

  doc.lineWidth(0.65).strokeColor("#000");

  doc.rect(tableX, tableY, tableW, headerRowH).stroke();

  doc.moveTo(tableX + colNumW, tableY).lineTo(tableX + colNumW, tableY + tableH).stroke();
  doc
    .moveTo(tableX + colNumW + colNameW, tableY)
    .lineTo(tableX + colNumW + colNameW, tableY + tableH)
    .stroke();
  doc
    .moveTo(tableX + colNumW + colNameW + colRegW, tableY)
    .lineTo(tableX + colNumW + colNameW + colRegW, tableY + tableH)
    .stroke();

  doc.fillColor("#000").font("Helvetica-Bold").fontSize(8);
  doc.text("N°", tableX + 5, tableY + 15, { width: colNumW - 10 });
  doc.text("Nome", tableX + colNumW + 6, tableY + 15, { width: colNameW - 12 });
  doc.text("Mat.", tableX + colNumW + colNameW + 6, tableY + 15, { width: colRegW - 12 });

  for (let i = 0; i < cols; i++) {
    const dateISO = dateChunk[i];
    const x = startVarX + i * cellW;

    doc.rect(x, tableY, cellW, headerRowH).stroke();

    const ddmm = brDateFromISO(dateISO).slice(0, 5);
    drawHeaderDateVerticalCentered(doc, ddmm, x, tableY, cellW, headerRowH, fontHeader);
  }

  let y = tableY + headerRowH;

  for (let idx = 0; idx < students.length; idx++) {
    const st = students[idx];

    doc.moveTo(tableX, y).lineTo(tableX + tableW, y).stroke();

    doc.fillColor("#000").font("Helvetica").fontSize(fontCell);
    doc.text(String(allStudentStartIndex + idx + 1), tableX + 5, y + 4, {
      width: colNumW - 10,
      lineBreak: false,
    });

    doc.text(st.name, tableX + colNumW + 6, y + 4, {
      width: colNameW - 12,
      ellipsis: true,
      lineBreak: false,
    });

    doc.text(st.reg, tableX + colNumW + colNameW + 6, y + 4, {
      width: colRegW - 12,
      lineBreak: false,
    });

    const map = byStudentDate.get(st.id) || new Map<string, AttendanceStatus>();

    for (let i = 0; i < cols; i++) {
      const dateISO = dateChunk[i];
      const x = startVarX + i * cellW;

      doc.rect(x, y, cellW, rowH).stroke();

      const status = map.get(dateISO);

      if (status === "present") {
        doc.save();
        doc.fillColor("#000");
        doc.circle(x + cellW / 2, y + rowH / 2 + 1, 2.1).fill();
        doc.restore();
      } else if (status === "absent") {
        doc.save();
        doc.fillColor("#C00000");
        doc.font("Helvetica-Bold").fontSize(8);
        doc.text("F", x, y + 3, { width: cellW, align: "center", lineBreak: false });
        doc.restore();
      } else if (status === "late") {
        doc.save();
        doc.fillColor("#000");
        doc.font("Helvetica-Bold").fontSize(8);
        doc.text("T", x, y + 3, { width: cellW, align: "center", lineBreak: false });
        doc.restore();
      }
    }

    y += rowH;
  }

  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).stroke();
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, [
    "diretor",
    "director",
    "coordenador",
    "coordinator",
    "secretaria",
    "secretary",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  const schoolId = (guard as any).schoolId as string;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();

  const month = (url.searchParams.get("month") || "").trim();
  const start = (url.searchParams.get("start") || "").trim();
  const end = (url.searchParams.get("end") || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);

  let startISO = "";
  let endISO = "";

  if (start && end) {
    startISO = start;
    endISO = end;
  } else if (month) {
    const r = rangeFromMonth(month);
    if (!r) return jsonError("month inválido (use YYYY-MM).", 400);
    startISO = r.startISO;
    endISO = r.endISO;
  } else {
    return jsonError("Envie month=YYYY-MM ou start=YYYY-MM-DD&end=YYYY-MM-DD.", 400);
  }

  const fullDateCols = datesBetweenInclusive(startISO, endISO);

  if (fullDateCols.length === 0) {
    return jsonError("Período inválido.", 400);
  }

  let schoolName = "Chamada Escolar";
  let brandLogoUrl = "";

  try {
    const { data: sch } = await supabaseAdmin
      .from("schools")
      .select("name, brand_name, brand_logo_url, logo_url")
      .eq("id", schoolId)
      .maybeSingle();

    schoolName = safeText((sch as any)?.brand_name) || safeText((sch as any)?.name) || schoolName;
    brandLogoUrl = safeText((sch as any)?.brand_logo_url || (sch as any)?.logo_url);
  } catch {}

  const classInfo = await tryGetClassInfo({ schoolId, classId });
  const className = classInfo.displayName || classId;
  const classShift = classInfo.shift || null;

  const blockedResult = await getApplicableBlockedDates({
    schoolId,
    classId,
    classShift,
    startISO,
    endISO,
  });

  if (!blockedResult.ok) {
    return jsonError("Erro ao verificar dias sem aula no calendário escolar.", 500, {
      details: blockedResult.error,
    });
  }

  const blockedDates = blockedResult.blockedDates;

  const dateCols = fullDateCols.filter((dateISO) => !blockedDates.has(dateISO));
  const removedDatesCount = fullDateCols.length - dateCols.length;

  const logoBuffer = await getLogoBuffer(brandLogoUrl);

  if (dateCols.length === 0) {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 22,
    });

    drawNoSchoolDaysDocument({
      doc,
      logoBuffer,
      schoolName,
      className,
      startISO,
      endISO,
      removedDatesCount,
    });

    const buffer = await pdfToBuffer(doc);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="frequencia-${classId}-${startISO}-a-${endISO}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const { data: sessions, error: sessErr } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id, lesson_date, lesson_number")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .gte("lesson_date", startISO)
    .lte("lesson_date", endISO)
    .order("lesson_date", { ascending: true })
    .order("lesson_number", { ascending: true });

  if (sessErr) {
    return jsonError("Falha ao buscar sessões no período.", 500, {
      details: sessErr.message,
    });
  }

  const sessList = ((sessions || []) as SessionRow[]).filter(
    (session) => !blockedDates.has(session.lesson_date)
  );

  const sessionIds = sessList.map((s) => s.id);

  let recList: RecordRow[] = [];

  if (sessionIds.length > 0) {
    const { data: recs, error: recErr } = await supabaseAdmin
      .from("attendance_records")
      .select("session_id, student_id, status, note")
      .eq("school_id", schoolId)
      .in("session_id", sessionIds);

    if (recErr) {
      return jsonError("Falha ao buscar registros de presença.", 500, {
        details: recErr.message,
      });
    }

    recList = (recs || []) as RecordRow[];
  }

  const rosterIdsFromPeriod = await getRosterAcrossPeriod({
    schoolId,
    classId,
    startISO,
    endISO,
  });

  const rosterIdsFromRecords = Array.from(
    new Set(recList.map((r) => String(r.student_id || "").trim()).filter(Boolean))
  );

  const allStudentIds = Array.from(new Set([...rosterIdsFromPeriod, ...rosterIdsFromRecords]));

  const students = await fetchStudentsByIds(schoolId, allStudentIds);

  const stuMap = new Map<string, StudentRow>();
  for (const s of students) {
    stuMap.set(String(s.id), s);
  }

  const finalStudents: FinalStudent[] = allStudentIds
    .map((id) => {
      const st = stuMap.get(id);
      return {
        id,
        name: safeText(st?.full_name) || id,
        reg: safeText(st?.registration_number) || "—",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const sessIdToDate = new Map<string, string>();

  for (const s of sessList) {
    sessIdToDate.set(s.id, s.lesson_date);
  }

  const tempAgg = new Map<string, Map<string, AttendanceStatus[]>>();

  for (const r of recList) {
    const studentId = String(r.student_id || "").trim();
    if (!studentId) continue;
    if (!allStudentIds.includes(studentId)) continue;

    const dateISO = sessIdToDate.get(r.session_id);
    if (!dateISO) continue;
    if (blockedDates.has(dateISO)) continue;

    const normalized = normalizeStatus(r.status);
    if (!normalized) continue;

    if (!tempAgg.has(studentId)) tempAgg.set(studentId, new Map());

    const byDate = tempAgg.get(studentId)!;

    if (!byDate.has(dateISO)) byDate.set(dateISO, []);
    byDate.get(dateISO)!.push(normalized);
  }

  const byStudentDate = new Map<string, Map<string, AttendanceStatus>>();

  for (const studentId of allStudentIds) {
    byStudentDate.set(studentId, new Map());
  }

  for (const [studentId, byDate] of tempAgg.entries()) {
    const finalMap = byStudentDate.get(studentId) || new Map<string, AttendanceStatus>();

    for (const [dateISO, statuses] of byDate.entries()) {
      const agg = aggregateStatus(statuses);
      if (agg) finalMap.set(dateISO, agg);
    }

    byStudentDate.set(studentId, finalMap);
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 22,
    autoFirstPage: false,
  });

  const MAX_DATES_PER_PAGE = 31;
  const MAX_STUDENTS_PER_PAGE = 27;

  const dateChunks = chunkArray(dateCols, MAX_DATES_PER_PAGE);
  const studentChunks = finalStudents.length
    ? chunkArray(finalStudents, MAX_STUDENTS_PER_PAGE)
    : [[] as FinalStudent[]];

  for (let dIndex = 0; dIndex < dateChunks.length; dIndex++) {
    const dateChunk = dateChunks[dIndex];

    for (let sIndex = 0; sIndex < studentChunks.length; sIndex++) {
      const studentChunk = studentChunks[sIndex];

      doc.addPage();

      drawReportHeader({
        doc,
        logoBuffer,
        schoolName,
        className,
        startISO,
        endISO,
        dateChunk,
        datePage: dIndex + 1,
        datePages: dateChunks.length,
        studentPage: sIndex + 1,
        studentPages: studentChunks.length,
        removedDatesCount,
      });

      drawAttendanceTable({
        doc,
        students: studentChunk,
        allStudentStartIndex: sIndex * MAX_STUDENTS_PER_PAGE,
        dateChunk,
        byStudentDate,
      });
    }
  }

  const buffer = await pdfToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="frequencia-${classId}-${startISO}-a-${endISO}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}