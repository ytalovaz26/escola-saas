// src/app/api/school/attendance/report/route.ts
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { getTeacherDisplayName } from "@/lib/getTeacherDisplayName";

export const runtime = "nodejs";

type AttendanceStatus = "present" | "absent" | "late";

type RosterStudent = {
  id: string;
  full_name?: string | null;
  registration_number?: string | null;
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

function normalizeStatus(raw: any): AttendanceStatus | null {
  const s = String(raw || "").toLowerCase().trim();

  if (!s) return null;
  if (s === "present" || s === "presente" || s === "p") return "present";
  if (s === "absent" || s === "ausente" || s === "f" || s === "falta") return "absent";
  if (s === "late" || s === "tarde" || s === "atraso" || s === "t") return "late";

  return null;
}

function statusLabel(status: AttendanceStatus | undefined) {
  if (status === "present") return "Presente";
  if (status === "absent") return "Falta";
  if (status === "late") return "Atraso";
  return "Sem registro";
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

function classDisplayName(data: any, fallback: string) {
  const parts = [data?.name, data?.grade, data?.shift].map(cleanText).filter(Boolean);
  return parts.join(" • ") || fallback;
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

function drawCellText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  align: "left" | "center" | "right" = "left",
  color = "#111827",
  size = 10,
  font: "Helvetica" | "Helvetica-Bold" = "Helvetica"
) {
  doc.font(font).fontSize(size).fillColor(color).text(text, x, y, {
    width,
    align,
    lineBreak: false,
    ellipsis: true,
  });
}

async function tryGetTeacherForDate(params: {
  schoolId: string;
  classId: string;
  date: string;
}) {
  const { schoolId, classId, date } = params;

  const { data: sessions } = await supabaseAdmin
    .from("attendance_sessions")
    .select("teacher_user_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("lesson_date", date)
    .order("created_at", { ascending: false })
    .limit(1);

  const teacherUserId = sessions?.[0]?.teacher_user_id;
  if (!teacherUserId) return "Professor(a)";

  try {
    return await getTeacherDisplayName({ teacherUserId, schoolId });
  } catch {
    return "Professor(a)";
  }
}

async function getClassInfo(params: {
  schoolId: string;
  classId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("id, name, grade, shift, school_id")
    .eq("school_id", params.schoolId)
    .eq("id", params.classId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      data: null as any,
    };
  }

  if (!data?.id) {
    return {
      ok: false as const,
      error: "Turma não encontrada nesta escola.",
      data: null as any,
    };
  }

  return {
    ok: true as const,
    error: null,
    data,
  };
}

async function getApplicableCalendarBlocks(params: {
  schoolId: string;
  classId: string;
  date: string;
  classShift: string | null;
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
    .eq("block_date", params.date)
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      blocks: [] as CalendarBlock[],
    };
  }

  const applicableBlocks = ((data || []) as CalendarBlock[]).filter((block) => {
    if (block.affects_all_classes === true) return true;

    const scope = cleanText(block.target_scope);

    if (isAllSchoolScope(scope)) return true;

    if (isClassScope(scope)) {
      return cleanText(block.class_id) === params.classId;
    }

    if (isShiftScope(scope)) {
      return (
        !!cleanText(block.shift) &&
        normalizeComparable(block.shift) === normalizeComparable(params.classShift)
      );
    }

    return false;
  });

  return {
    ok: true as const,
    error: null,
    blocks: applicableBlocks,
  };
}

function drawNoClassPdf(params: {
  doc: PDFKit.PDFDocument;
  schoolName: string;
  logoBuffer: Buffer | null;
  className: string;
  teacherName: string;
  date: string;
  block: CalendarBlock;
}) {
  const { doc, schoolName, logoBuffer, className, teacherName, date, block } = params;

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
  doc.text(`Professor(a): ${teacherName}`, titleX, headerTop + 60);
  doc.text(`Data: ${brDateFromISO(date)}`, titleX, headerTop + 78);

  const boxY = headerTop + 140;

  doc.roundedRect(margin, boxY, pageW - margin * 2, 240, 22).fill("#fff7ed");

  doc
    .roundedRect(margin + 22, boxY + 22, pageW - margin * 2 - 44, 196, 18)
    .strokeColor("#fed7aa")
    .lineWidth(1.2)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(28).fillColor("#9a3412").text(
    "Não haverá aula neste dia",
    margin + 44,
    boxY + 48,
    {
      width: pageW - margin * 2 - 88,
      align: "center",
    }
  );

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#7c2d12").text(
    `${blockTypeLabel(block.type)} · ${cleanText(block.title) || "Calendário escolar"}`,
    margin + 44,
    boxY + 96,
    {
      width: pageW - margin * 2 - 88,
      align: "center",
    }
  );

  doc.font("Helvetica").fontSize(12).fillColor("#7c2d12").text(
    cleanText(block.description) ||
      "A escola informou bloqueio no calendário escolar. A chamada não precisa ser realizada nesta data.",
    margin + 70,
    boxY + 136,
    {
      width: pageW - margin * 2 - 140,
      align: "center",
      lineGap: 4,
    }
  );

  doc.font("Helvetica").fontSize(10).fillColor("#475569").text(
    "Este documento registra que a data não é considerada dia normal de chamada para esta turma.",
    margin,
    boxY + 270,
    {
      width: pageW - margin * 2,
      align: "center",
    }
  );
}

async function getRosterFromRpc(classId: string, date: string): Promise<RosterStudent[]> {
  try {
    const { data, error } = await supabaseAdmin.rpc("get_active_students_for_class_on_date", {
      p_class_id: classId,
      p_date: date,
    });

    if (error) return [];

    const map = new Map<string, RosterStudent>();

    for (const s of data || []) {
      const studentId = String((s as any).student_id ?? (s as any).id ?? "").trim();
      if (!studentId) continue;

      if (!map.has(studentId)) {
        map.set(studentId, {
          id: studentId,
          full_name: (s as any).full_name ?? (s as any).name ?? null,
          registration_number:
            (s as any).registration_number ??
            (s as any).registration ??
            (s as any).mat ??
            null,
        });
      }
    }

    return Array.from(map.values());
  } catch {
    return [];
  }
}

async function getRosterFromEnrollmentTables(params: {
  schoolId: string;
  classId: string;
}): Promise<RosterStudent[]> {
  const { schoolId, classId } = params;
  const foundIds = new Set<string>();

  const tableConfigs = [
    { table: "student_classes", classCol: "class_id", studentCol: "student_id" },
    { table: "class_students", classCol: "class_id", studentCol: "student_id" },
    { table: "enrollments", classCol: "class_id", studentCol: "student_id" },
    { table: "matriculas", classCol: "class_id", studentCol: "student_id" },
  ];

  for (const cfg of tableConfigs) {
    try {
      const { data, error } = await supabaseAdmin
        .from(cfg.table as any)
        .select(`${cfg.studentCol}, school_id, is_active, active, status, end_date, left_at`)
        .eq(cfg.classCol, classId);

      if (error) continue;

      for (const row of data || []) {
        if ((row as any).school_id && String((row as any).school_id) !== schoolId) continue;

        const studentId = String((row as any)?.[cfg.studentCol] || "").trim();
        if (!studentId) continue;

        const isActive =
          (row as any)?.is_active === true ||
          (row as any)?.active === true ||
          (row as any)?.status === "active" ||
          ((row as any)?.end_date == null && (row as any)?.left_at == null);

        if (isActive) foundIds.add(studentId);
      }
    } catch {}
  }

  if (foundIds.size === 0) return [];

  try {
    const { data: students } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number")
      .eq("school_id", schoolId)
      .in("id", Array.from(foundIds));

    return (students || []).map((s: any) => ({
      id: String(s.id),
      full_name: s.full_name ?? null,
      registration_number: s.registration_number ?? null,
    }));
  } catch {
    return Array.from(foundIds).map((id) => ({
      id,
      full_name: null,
      registration_number: null,
    }));
  }
}

async function enrichStudentsByIds(schoolId: string, studentIds: string[]): Promise<RosterStudent[]> {
  if (studentIds.length === 0) return [];

  try {
    const { data } = await supabaseAdmin
      .from("students")
      .select("id, full_name, registration_number")
      .eq("school_id", schoolId)
      .in("id", studentIds);

    return (data || []).map((s: any) => ({
      id: String(s.id),
      full_name: s.full_name ?? null,
      registration_number: s.registration_number ?? null,
    }));
  } catch {
    return studentIds.map((id) => ({
      id,
      full_name: null,
      registration_number: null,
    }));
  }
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

  const schoolId = guard.schoolId;

  const url = new URL(req.url);
  const classId = (url.searchParams.get("classId") || "").trim();
  const date = (url.searchParams.get("date") || "").trim();

  if (!classId) return jsonError("classId é obrigatório.", 400);
  if (!date) return jsonError("Envie date=YYYY-MM-DD.", 400);

  const { data: school, error: schoolErr } = await supabaseAdmin
    .from("schools")
    .select("name, brand_name, brand_logo_url, logo_url")
    .eq("id", schoolId)
    .maybeSingle();

  if (schoolErr) {
    return jsonError("Falha ao buscar dados da escola.", 500, {
      details: schoolErr.message,
    });
  }

  const schoolName = school?.brand_name || school?.name || "Escola";
  const logoUrl = school?.brand_logo_url || school?.logo_url || null;

  const classInfo = await getClassInfo({
    schoolId,
    classId,
  });

  if (!classInfo.ok) {
    return jsonError("Falha ao buscar turma.", 500, {
      details: classInfo.error,
    });
  }

  const className = classDisplayName(classInfo.data, classId);
  const classShift = cleanText(classInfo.data?.shift) || null;
  const teacherName = await tryGetTeacherForDate({ schoolId, classId, date });
  const logoBuffer = await getLogoBuffer(logoUrl);

  const calendarBlocksResult = await getApplicableCalendarBlocks({
    schoolId,
    classId,
    date,
    classShift,
  });

  if (!calendarBlocksResult.ok) {
    return jsonError("Erro ao verificar calendário escolar.", 500, {
      details: calendarBlocksResult.error,
    });
  }

  if (calendarBlocksResult.blocks.length > 0) {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
    });

    drawNoClassPdf({
      doc,
      schoolName,
      logoBuffer,
      className,
      teacherName,
      date,
      block: calendarBlocksResult.blocks[0],
    });

    const pdfBuffer = await pdfToBuffer(doc);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="sem-aula-${date}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const { data: sessions, error: sessionsErr } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("lesson_date", date)
    .eq("lesson_number", 1);

  if (sessionsErr) {
    return jsonError("Falha ao buscar sessões do dia.", 500, {
      details: sessionsErr.message,
    });
  }

  const sessionIds = (sessions || []).map((s: any) => String(s.id)).filter(Boolean);

  let records: any[] = [];

  if (sessionIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("attendance_records")
      .select("student_id, status, note, session_id")
      .eq("school_id", schoolId)
      .in("session_id", sessionIds);

    if (error) {
      return jsonError("Falha ao buscar registros de presença do dia.", 500, {
        details: error.message,
      });
    }

    records = data || [];
  }

  const rosterMap = new Map<string, RosterStudent>();

  const rpcRoster = await getRosterFromRpc(classId, date);
  for (const s of rpcRoster) {
    rosterMap.set(s.id, s);
  }

  const enrollmentRoster = await getRosterFromEnrollmentTables({ schoolId, classId });
  for (const s of enrollmentRoster) {
    const prev = rosterMap.get(s.id);
    rosterMap.set(s.id, {
      id: s.id,
      full_name: prev?.full_name || s.full_name || null,
      registration_number: prev?.registration_number || s.registration_number || null,
    });
  }

  for (const r of records) {
    const studentId = String(r?.student_id || "").trim();
    if (!studentId) continue;

    if (!rosterMap.has(studentId)) {
      rosterMap.set(studentId, {
        id: studentId,
        full_name: null,
        registration_number: null,
      });
    }
  }

  const missingIds = Array.from(rosterMap.values())
    .filter((s) => !s.full_name || !s.registration_number)
    .map((s) => s.id);

  if (missingIds.length > 0) {
    const enriched = await enrichStudentsByIds(schoolId, missingIds);

    for (const s of enriched) {
      const prev = rosterMap.get(s.id);
      rosterMap.set(s.id, {
        id: s.id,
        full_name: prev?.full_name || s.full_name || null,
        registration_number: prev?.registration_number || s.registration_number || null,
      });
    }
  }

  const students = Array.from(rosterMap.values()).sort((a, b) =>
    String(a.full_name || "").localeCompare(String(b.full_name || ""), "pt-BR")
  );

  const marks = new Map<string, AttendanceStatus>();

  for (const record of records) {
    const studentId = String(record?.student_id || "").trim();
    if (!studentId) continue;

    const status = normalizeStatus(record?.status);
    if (!status) continue;

    marks.set(studentId, status);
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 36,
  });

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 36;
  const headerTop = 38;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, margin, headerTop, { fit: [90, 90] });
    } catch {}
  }

  const titleX = margin + 100;

  doc
    .font("Helvetica-Bold")
    .fontSize(23)
    .fillColor("#0f172a")
    .text(schoolName, titleX, headerTop + 4, {
      width: pageW - titleX - margin,
      ellipsis: true,
    });

  doc.font("Helvetica").fontSize(11).fillColor("#334155");
  doc.text(`Turma: ${className}`, titleX, headerTop + 38);
  doc.text(`Professor(a): ${teacherName}`, titleX, headerTop + 56);
  doc.text(`Data: ${brDateFromISO(date)}  |  Aula 1`, titleX, headerTop + 74);

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#475569")
    .text("Legenda: P=Presente | F=Falta | T=Atraso", margin, headerTop + 74, {
      width: pageW - margin * 2,
      align: "right",
    });

  const lineY = headerTop + 108;

  doc
    .moveTo(margin, lineY)
    .lineTo(pageW - margin, lineY)
    .lineWidth(1.2)
    .strokeColor("#cbd5e1")
    .stroke();

  const startX = margin;
  let y = lineY + 18;

  const totalWidth = pageW - margin * 2;
  const colN = 34;
  const colMat = 70;
  const colSit = 120;
  const colP = 34;
  const colF = 34;
  const colT = 34;
  const colNomeFinal = totalWidth - colN - colMat - colSit - colP - colF - colT;

  doc.roundedRect(startX, y - 6, totalWidth, 28, 8).fill("#f8fafc");

  drawCellText(doc, "Nº", startX, y, colN, "center", "#0f172a", 10, "Helvetica-Bold");
  drawCellText(doc, "Nome", startX + colN, y, colNomeFinal, "left", "#0f172a", 10, "Helvetica-Bold");
  drawCellText(doc, "Mat.", startX + colN + colNomeFinal, y, colMat, "center", "#0f172a", 10, "Helvetica-Bold");
  drawCellText(doc, "Situação", startX + colN + colNomeFinal + colMat, y, colSit, "center", "#0f172a", 10, "Helvetica-Bold");
  drawCellText(doc, "P", startX + colN + colNomeFinal + colMat + colSit, y, colP, "center", "#0f172a", 10, "Helvetica-Bold");
  drawCellText(doc, "F", startX + colN + colNomeFinal + colMat + colSit + colP, y, colF, "center", "#0f172a", 10, "Helvetica-Bold");
  drawCellText(doc, "T", startX + colN + colNomeFinal + colMat + colSit + colP + colF, y, colT, "center", "#0f172a", 10, "Helvetica-Bold");

  y += 34;

  let idx = 1;
  let totalPresent = 0;
  let totalAbsent = 0;
  let totalLate = 0;

  for (const s of students) {
    if (y > pageH - margin - 30) {
      doc.addPage();
      y = margin;
    }

    const status = marks.get(s.id);

    if (status === "present") totalPresent++;
    if (status === "absent") totalAbsent++;
    if (status === "late") totalLate++;

    const rowTop = y - 4;
    doc.roundedRect(startX, rowTop, totalWidth, 26, 6).fill(idx % 2 === 0 ? "#ffffff" : "#fcfdff");

    drawCellText(doc, String(idx), startX, y, colN, "center");
    drawCellText(doc, String(s.full_name || "—"), startX + colN, y, colNomeFinal, "left");
    drawCellText(doc, String(s.registration_number || "—"), startX + colN + colNomeFinal, y, colMat, "center");

    const sitColor =
      status === "present"
        ? "#166534"
        : status === "absent"
          ? "#b91c1c"
          : status === "late"
            ? "#92400e"
            : "#64748b";

    drawCellText(
      doc,
      statusLabel(status),
      startX + colN + colNomeFinal + colMat,
      y,
      colSit,
      "center",
      sitColor,
      10,
      "Helvetica-Bold"
    );

    drawCellText(doc, status === "present" ? "X" : "", startX + colN + colNomeFinal + colMat + colSit, y, colP, "center", "#166534", 10, "Helvetica-Bold");
    drawCellText(doc, status === "absent" ? "X" : "", startX + colN + colNomeFinal + colMat + colSit + colP, y, colF, "center", "#dc2626", 10, "Helvetica-Bold");
    drawCellText(doc, status === "late" ? "X" : "", startX + colN + colNomeFinal + colMat + colSit + colP + colF, y, colT, "center", "#92400e", 10, "Helvetica-Bold");

    y += 30;
    idx += 1;
  }

  y += 10;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#475569")
    .text(
      `Resumo do dia: ${totalPresent} presentes | ${totalAbsent} faltas | ${totalLate} atrasos`,
      startX,
      y
    );

  const pdfBuffer = await pdfToBuffer(doc);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="chamada-${date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}