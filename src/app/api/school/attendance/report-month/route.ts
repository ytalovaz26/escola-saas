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

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function safeText(v: any) {
  return typeof v === "string" ? v : "";
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

function normalizeStatus(raw: any): AttendanceStatus | null {
  const s = String(raw || "").toLowerCase().trim();

  if (!s) return null;
  if (s === "present" || s === "presente" || s === "p") return "present";
  if (s === "absent" || s === "ausente" || s === "f") return "absent";
  if (s === "late" || s === "tarde" || s === "atraso" || s === "t") return "late";

  return null;
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

    const res = await fetch(u);
    if (!res.ok) return null;

    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
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

async function getRosterAcrossPeriod(params: {
  classId: string;
  startISO: string;
  endISO: string;
}) {
  const { classId, startISO, endISO } = params;

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

  return Array.from(all);
}

async function fetchStudentsByIds(studentIds: string[]): Promise<StudentRow[]> {
  if (studentIds.length === 0) return [];

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

  const className = (await tryGetClassName(classId)) || classId;
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

  const rosterIdsFromPeriod = await getRosterAcrossPeriod({ classId, startISO, endISO });
  const rosterIdsFromRecords = Array.from(
    new Set(
      recList
        .map((r) => String(r.student_id || "").trim())
        .filter(Boolean)
    )
  );

  const allStudentIds = Array.from(new Set([...rosterIdsFromPeriod, ...rosterIdsFromRecords]));

  const students = await fetchStudentsByIds(allStudentIds);

  const stuMap = new Map<string, StudentRow>();
  for (const s of students) {
    stuMap.set(String(s.id), s);
  }

  const finalStudents = allStudentIds
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
    const finalMap = byStudentDate.get(studentId)!;
    for (const [dateISO, statuses] of byDate.entries()) {
      const agg = aggregateStatus(statuses);
      if (agg) finalMap.set(dateISO, agg);
    }
  }

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 22 });

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const logoBuffer = await getLogoBuffer(brandLogoUrl);
  const headerTop = 18;
  const headerH = 70;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 22, headerTop, { fit: [100, 55] });
    } catch {}
  }

  doc.fillColor("#000");
  doc.fontSize(15).text(schoolName || "Chamada Escolar", 135, headerTop + 2);

  doc.fontSize(10).fillColor("#333");
  doc.text(`Turma: ${className}`, 135, headerTop + 24);
  doc.text(`Período: ${brDateFromISO(startISO)} até ${brDateFromISO(endISO)}`, 135, headerTop + 38);
  doc.text(`Legenda: • = Presente | F = Falta | T = Atraso`, 135, headerTop + 52);

  const tableX = 22;
  const tableY = headerTop + headerH;
  const tableW = pageW - 44;
  const tableH = pageH - tableY - 30;

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
  doc.moveTo(tableX + colNumW + colNameW, tableY).lineTo(tableX + colNumW + colNameW, tableY + tableH).stroke();
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

  const buffer = await pdfToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="frequencia-${classId}-${startISO}-a-${endISO}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}