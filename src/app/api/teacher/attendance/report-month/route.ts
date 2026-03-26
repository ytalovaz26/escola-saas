import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { getTeacherDisplayName } from "@/lib/getTeacherDisplayName";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

type AttendanceStatus = "present" | "absent" | "late";

function safeText(v: any) {
  return typeof v === "string" ? v : "";
}

function brDateFromISO(iso: string) {
  const [y, m, d] = iso.split("-");
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
  return { startISO: isoFromUTCDate(start), endISO: isoFromUTCDate(end) };
}

function datesBetweenInclusive(startISO: string, endISO: string) {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
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

async function pdfToBuffer(doc: PDFKit.PDFDocument) {
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

async function fetchImageBuffer(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar logo: ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
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
  doc.fontSize(fontSize).fillColor("#000");

  const w = doc.widthOfString(ddmm);
  const yFix = fontSize * 0.35;

  doc.text(ddmm, -w / 2, -yFix, { lineBreak: false });

  doc.restore();
}

function aggregateStatus(statuses: AttendanceStatus[]) {
  if (statuses.includes("absent")) return "absent";
  if (statuses.includes("late")) return "late";
  if (statuses.includes("present")) return "present";
  return null;
}

type SessionRow = {
  id: string;
  lesson_date: string;
  lesson_number: number;
};

type RecordRow = {
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  note: string | null;
};

type StudentRow = {
  id: string;
  full_name?: string | null;
  registration_number?: string | null;
};

async function tryGetClassName(classId: string) {
  try {
    const { data } = await supabaseAdmin.from("classes").select("*").eq("id", classId).single();
    const candidates = [
      data?.name,
      data?.title,
      data?.nome,
      data?.class_name,
      data?.descricao,
      data?.description,
      data?.series,
      data?.ano,
    ];
    const found = candidates.map(safeText).find((x) => x.trim().length > 0);
    return found || "";
  } catch {
    return "";
  }
}

async function getRosterStudentIdsRobust(params: {
  schoolId: string;
  classId: string;
  endISO: string;
}) {
  const { schoolId, classId, endISO } = params;

  const all = new Set<string>();

  const candidateTables = [
    { table: "class_students", studentCol: "student_id", classCol: "class_id" },
    { table: "student_classes", studentCol: "student_id", classCol: "class_id" },
    { table: "enrollments", studentCol: "student_id", classCol: "class_id" },
    { table: "matriculas", studentCol: "student_id", classCol: "class_id" },
  ];

  for (const t of candidateTables) {
    try {
      const { data, error } = await supabaseAdmin
        .from(t.table as any)
        .select(`${t.studentCol}`)
        .eq("school_id", schoolId)
        .eq(t.classCol, classId);

      if (error) continue;

      for (const r of (data || []) as any[]) {
        const id = (r as any)?.[t.studentCol];
        if (typeof id === "string" && id.length > 0) all.add(id);
      }
    } catch {}
  }

  try {
    const { data } = await supabaseAdmin.rpc("get_active_students_for_class_on_date", {
      p_class_id: classId,
      p_date: endISO,
    });

    for (const r of (data || []) as any[]) {
      const id = r?.student_id ?? r?.id;
      if (typeof id === "string" && id.length > 0) all.add(id);
    }
  } catch {}

  return Array.from(all);
}

async function fetchStudentsByIds(params: {
  schoolId: string;
  studentIds: string[];
}): Promise<StudentRow[]> {
  const { schoolId, studentIds } = params;
  if (studentIds.length === 0) return [];

  try {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number")
      .in("id", studentIds)
      .eq("school_id", schoolId);

    if (!error) return (data || []) as StudentRow[];
  } catch {}

  try {
    const { data } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number")
      .in("id", studentIds);

    return (data || []) as StudentRow[];
  } catch {
    return [];
  }
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

  const { schoolId } = guard as any;
  const teacherUserId =
    (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();

  const month = (url.searchParams.get("month") || "").trim();
  const start = (url.searchParams.get("start") || "").trim();
  const end = (url.searchParams.get("end") || "").trim();

  if (!teacherUserId) return jsonError("Professor não identificado (token).", 401);
  if (!classId) return jsonError("classId é obrigatório.", 400);

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("teacher_user_id", teacherUserId)
    .limit(1);

  if (linkErr) {
    return jsonError("Erro ao validar vínculo professor-turma.", 500, { details: linkErr.message });
  }
  if (!link || link.length === 0) {
    return jsonError("Professor não está vinculado a esta turma.", 403);
  }

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

  let schoolName = "";
  let brandLogoUrl = "";
  try {
    const { data: sch } = await supabaseAdmin
      .from("schools")
      .select("name, brand_logo_url, logo_url")
      .eq("id", schoolId)
      .single();
    schoolName = safeText((sch as any)?.name);
    brandLogoUrl = safeText((sch as any)?.brand_logo_url || (sch as any)?.logo_url);
  } catch {}

  const className = (await tryGetClassName(classId)) || "";
  const teacherName = await getTeacherDisplayName({
    teacherUserId,
    schoolId,
  });

  const dateCols = datesBetweenInclusive(startISO, endISO);

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
    return jsonError("Falha ao buscar sessões no período.", 500, { details: sessErr.message });
  }

  const sessList = (sessions || []) as SessionRow[];
  const sessionIds = sessList.map((s) => s.id);

  let recList: RecordRow[] = [];
  if (sessionIds.length > 0) {
    const { data: recs, error: recErr } = await supabaseAdmin
      .from("attendance_records")
      .select("session_id, student_id, status, note")
      .eq("school_id", schoolId)
      .in("session_id", sessionIds);

    if (recErr) {
      return jsonError("Falha ao buscar registros de presença.", 500, { details: recErr.message });
    }
    recList = (recs || []) as RecordRow[];
  }

  const rosterIdsRaw = await getRosterStudentIdsRobust({ schoolId, classId, endISO });
  const fallbackIds = Array.from(new Set(recList.map((r) => r.student_id)));
  const rosterIds = rosterIdsRaw.length > 0 ? rosterIdsRaw : fallbackIds;

  const students = await fetchStudentsByIds({ schoolId, studentIds: rosterIds });

  const validStudentIds =
    students.length > 0 ? students.map((s) => s.id) : rosterIds;

  const stuMap = new Map<string, StudentRow>();
  for (const s of students) stuMap.set(s.id, s);

  const sessIdToDate = new Map<string, string>();
  for (const s of sessList) sessIdToDate.set(s.id, s.lesson_date);

  const byStudentDate = new Map<string, Map<string, AttendanceStatus>>();
  for (const stId of validStudentIds) byStudentDate.set(stId, new Map());

  const tempAgg = new Map<string, Map<string, AttendanceStatus[]>>();
  for (const r of recList) {
    if (!validStudentIds.includes(r.student_id)) continue;

    const d = sessIdToDate.get(r.session_id);
    if (!d) continue;

    if (!tempAgg.has(r.student_id)) tempAgg.set(r.student_id, new Map());
    const m = tempAgg.get(r.student_id)!;

    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(r.status);
  }

  for (const [studentId, m] of tempAgg.entries()) {
    if (!byStudentDate.has(studentId)) byStudentDate.set(studentId, new Map());
    const out = byStudentDate.get(studentId)!;
    for (const [dateISO, sts] of m.entries()) {
      const agg = aggregateStatus(sts);
      if (agg) out.set(dateISO, agg);
    }
  }

  const finalStudents = validStudentIds
    .map((id) => {
      const st = stuMap.get(id);
      return {
        id,
        name: safeText(st?.full_name) || id,
        reg: safeText(st?.registration_number) || "—",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 22 });

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const headerTop = 18;
  const headerH = 70;

  if (brandLogoUrl) {
    try {
      const logo = await fetchImageBuffer(brandLogoUrl);
      doc.image(logo, 22, headerTop, { fit: [100, 55] });
    } catch {}
  }

  doc.fillColor("#000");
  doc.fontSize(15).text(schoolName || "Diário de Classe", 135, headerTop + 2);

  doc.fontSize(10).fillColor("#333");
  doc.text(`Turma: ${className || classId}`, 135, headerTop + 24);
  doc.text(`Professor(a): ${teacherName || "—"}`, 135, headerTop + 38);
  doc.text(`Período: ${brDateFromISO(startISO)} até ${brDateFromISO(endISO)}`, 135, headerTop + 52);

  const tableX = 22;
  const tableY = headerTop + headerH;
  const tableW = pageW - 44;
  const tableH = pageH - tableY - 55;

  const colNumW = 22;
  const colNameW = 260;
  const colRegW = 65;

  const fixedW = colNumW + colNameW + colRegW;
  const varW = Math.max(1, tableW - fixedW);

  const cols = dateCols.length;
  let cellW = varW / Math.max(1, cols);

  if (cellW > 18) cellW = 18;
  if (cellW < 10) cellW = 10;

  const usedVarW = cellW * cols;
  const startVarX = tableX + fixedW + Math.max(0, (varW - usedVarW) / 2);

  const headerRowH = 46;
  const rowH = 16;

  const fontHeader = cols > 26 ? 7 : 8;
  const fontCell = cols > 26 ? 7 : 8;

  doc.lineWidth(0.8);

  doc.rect(tableX, tableY, tableW, headerRowH).stroke();

  doc.moveTo(tableX + colNumW, tableY).lineTo(tableX + colNumW, tableY + tableH).stroke();
  doc
    .moveTo(tableX + colNumW + colNameW, tableY)
    .lineTo(tableX + colNumW + colNameW, tableY + tableH)
    .stroke();
  doc.moveTo(tableX + fixedW, tableY).lineTo(tableX + fixedW, tableY + tableH).stroke();

  doc.fillColor("#000").fontSize(9);
  doc.text("N°", tableX + 5, tableY + 14, { width: colNumW - 10 });
  doc.text("Nome", tableX + colNumW + 6, tableY + 14, { width: colNameW - 12 });
  doc.text("Mat.", tableX + colNumW + colNameW + 6, tableY + 14, { width: colRegW - 12 });

  for (let i = 0; i < cols; i++) {
    const dateISO = dateCols[i];
    const x = startVarX + i * cellW;

    doc.rect(x, tableY, cellW, headerRowH).stroke();

    const ddmm = brDateFromISO(dateISO).slice(0, 5);
    drawHeaderDateVerticalCentered(doc, ddmm, x, tableY, cellW, headerRowH, fontHeader);
  }

  let y = tableY + headerRowH;

  const maxRows = Math.floor((tableH - headerRowH) / rowH);
  const displayStudents = finalStudents.slice(0, maxRows);

  doc.fontSize(fontCell).fillColor("#000");

  for (let idx = 0; idx < displayStudents.length; idx++) {
    const st = displayStudents[idx];

    doc.moveTo(tableX, y).lineTo(tableX + tableW, y).stroke();

    doc.fillColor("#000").fontSize(fontCell);
    doc.text(String(idx + 1), tableX + 5, y + 4, { width: colNumW - 10 });
    doc.text(st.name, tableX + colNumW + 6, y + 4, { width: colNameW - 12, ellipsis: true });
    doc.text(st.reg, tableX + colNumW + colNameW + 6, y + 4, { width: colRegW - 12 });

    const map = byStudentDate.get(st.id) || new Map<string, AttendanceStatus>();

    for (let i = 0; i < cols; i++) {
      const dateISO = dateCols[i];
      const x = startVarX + i * cellW;

      doc.rect(x, y, cellW, rowH).stroke();

      const status = map.get(dateISO);

      if (status === "present") {
        doc.save();
        doc.fillColor("#000");
        doc.circle(x + cellW / 2, y + rowH / 2 + 1, 2.2).fill();
        doc.restore();
      } else if (status === "absent") {
        doc.save();
        doc.fillColor("#C00000");
        doc.fontSize(fontCell + 1);
        doc.text("F", x, y + 3, { width: cellW, align: "center" });
        doc.restore();
        doc.fontSize(fontCell).fillColor("#000");
      } else if (status === "late") {
        doc.save();
        doc.fillColor("#000");
        doc.fontSize(fontCell);
        doc.text("T", x, y + 3, { width: cellW, align: "center" });
        doc.restore();
      }
    }

    y += rowH;
  }

  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).stroke();

  const footerY = pageH - 40;
  doc.moveTo(22, footerY).lineTo(pageW - 22, footerY).stroke();
  doc.fontSize(10).fillColor("#000");
  doc.text("Professor(a)", 22, footerY + 6);

  const buffer = await pdfToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio-${startISO}-a-${endISO}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}