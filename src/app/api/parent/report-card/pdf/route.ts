import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function calcAverage(values: Array<number | null | undefined>) {
  const valid = values.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))) as number[];
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, n) => sum + Number(n), 0);
  return Number((total / valid.length).toFixed(2));
}

function getSituation(avg: number | null) {
  if (avg === null) return "Sem média";
  if (avg >= 7) return "Aprovado parcial";
  if (avg >= 5) return "Em recuperação";
  return "Baixo desempenho";
}

function brDateTimeFromIso(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pt-BR");
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
  });
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token/session.", 401);
    }

    const userId = String(userData.user.id);
    const url = new URL(req.url);

    const studentId = normalizeText(url.searchParams.get("studentId"));
    const term = normalizeText(url.searchParams.get("term"));

    if (!studentId) return jsonError("studentId é obrigatório.", 400);
    if (!term) return jsonError("term é obrigatório.", 400);

    const { data: parentRow, error: parentErr } = await supabaseAdmin
      .from("parents")
      .select("id, school_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (parentErr) {
      return jsonError("Falha ao localizar responsável.", 500, {
        details: parentErr.message,
      });
    }

    if (!parentRow?.id) {
      return jsonError("Responsável não encontrado.", 403);
    }

    const { data: relation, error: relationErr } = await supabaseAdmin
      .from("student_parents")
      .select("id")
      .eq("parent_id", parentRow.id)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .limit(1);

    if (relationErr) {
      return jsonError("Falha ao validar vínculo do responsável com o aluno.", 500, {
        details: relationErr.message,
      });
    }

    if (!relation || relation.length === 0) {
      return jsonError("Você não tem permissão para acessar este aluno.", 403);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id, school_id, class_id, full_name, registration_number")
      .eq("id", studentId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Falha ao buscar dados do aluno.", 500, {
        details: studentErr.message,
      });
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado.", 404);
    }

    const schoolId = String(student.school_id || parentRow.school_id || "");
    if (!schoolId) return jsonError("school_id do aluno não encontrado.", 500);

    let classId = normalizeText(student.class_id);

    if (!classId) {
      const { data: activeLink } = await supabaseAdmin
        .from("student_classes")
        .select("class_id")
        .eq("school_id", schoolId)
        .eq("student_id", studentId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      classId = normalizeText(activeLink?.class_id);
    }

    const [{ data: school }, { data: classData }, { data: gradesRows, error: gradesErr }] =
      await Promise.all([
        supabaseAdmin
          .from("schools")
          .select("name, brand_name, brand_logo_url")
          .eq("id", schoolId)
          .maybeSingle(),
        classId
          ? supabaseAdmin
              .from("classes")
              .select("id, name, grade, shift")
              .eq("id", classId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
        supabaseAdmin
          .from("grades")
          .select("subject, score, created_at, updated_at")
          .eq("school_id", schoolId)
          .eq("student_id", studentId)
          .eq("term", term)
          .order("subject", { ascending: true }),
      ]);

    if (gradesErr) {
      return jsonError("Falha ao buscar boletim do aluno.", 500, {
        details: gradesErr.message,
      });
    }

    const grades = (gradesRows || []).map((row: any) => ({
      subject: row?.subject ? String(row.subject) : null,
      score:
        row?.score !== null && row?.score !== undefined && Number.isFinite(Number(row.score))
          ? Number(row.score)
          : null,
      updated_at: row?.updated_at ?? null,
      created_at: row?.created_at ?? null,
    }));

    const average = calcAverage(grades.map((g) => g.score));
    const situation = getSituation(average);

    const schoolName = school?.brand_name || school?.name || "Escola";
    const logoUrl = school?.brand_logo_url || null;
    const className = classData?.name || "—";
    const classGrade = classData?.grade || "—";
    const classShift = classData?.shift || "—";
    const studentName = student?.full_name || "Aluno";
    const registrationNumber = student?.registration_number || "—";

    const logoBuffer = await getLogoBuffer(logoUrl);

    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 36,
    });

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 36;
    const headerTop = 34;

    if (logoBuffer) {
      doc.image(logoBuffer, margin, headerTop, { fit: [80, 80] });
    }

    const titleX = margin + 92;

    doc.font("Helvetica-Bold").fontSize(21).fillColor("#0f172a").text(schoolName, titleX, headerTop + 2);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Boletim Escolar", titleX, headerTop + 30);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Turma: ${className}`, titleX, headerTop + 48)
      .text(`Série: ${classGrade}`, titleX, headerTop + 64)
      .text(`Turno: ${classShift}`, titleX, headerTop + 80);

    const metaTop = headerTop + 112;

    doc.moveTo(margin, metaTop).lineTo(pageW - margin, metaTop).lineWidth(1.1).strokeColor("#cbd5e1").stroke();

    const infoY = metaTop + 18;

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a");
    doc.text("Aluno:", margin, infoY);
    doc.text("Matrícula:", margin, infoY + 22);
    doc.text("Período:", margin, infoY + 44);
    doc.text("Média:", pageW / 2, infoY);
    doc.text("Situação:", pageW / 2, infoY + 22);

    doc.font("Helvetica").fontSize(11).fillColor("#334155");
    doc.text(studentName, margin + 55, infoY, { width: pageW / 2 - 90 });
    doc.text(registrationNumber, margin + 75, infoY + 22, { width: pageW / 2 - 110 });
    doc.text(term, margin + 58, infoY + 44, { width: pageW / 2 - 93 });
    doc.text(average !== null ? String(average) : "—", pageW / 2 + 48, infoY, {
      width: pageW / 2 - margin - 48,
    });
    doc.text(situation, pageW / 2 + 62, infoY + 22, {
      width: pageW / 2 - margin - 62,
    });

    const tableTop = infoY + 90;
    const tableX = margin;
    const tableW = pageW - margin * 2;
    const rowH = 28;
    const colDisc = Math.floor(tableW * 0.65);
    const colNota = tableW - colDisc;

    doc.roundedRect(tableX, tableTop, tableW, 28, 8).fill("#f8fafc");

    drawCellText(doc, "Disciplina", tableX + 10, tableTop + 8, colDisc - 20, "left", "#0f172a", 10, "Helvetica-Bold");
    drawCellText(doc, "Nota", tableX + colDisc, tableTop + 8, colNota - 10, "center", "#0f172a", 10, "Helvetica-Bold");

    let y = tableTop + 36;

    if (grades.length === 0) {
      doc.roundedRect(tableX, y - 4, tableW, 30, 6).fill("#ffffff");

      drawCellText(
        doc,
        "Nenhuma nota lançada para este período.",
        tableX + 10,
        y + 4,
        tableW - 20,
        "left",
        "#64748b",
        10,
        "Helvetica"
      );

      y += 38;
    } else {
      for (let i = 0; i < grades.length; i++) {
        const row = grades[i];
        const rowTop = y - 4;

        if (y > pageH - 120) {
          doc.addPage();
          y = margin + 20;
        }

        doc.roundedRect(tableX, rowTop, tableW, rowH, 6).fill(i % 2 === 0 ? "#ffffff" : "#fcfdff");

        drawCellText(
          doc,
          String(row.subject || "—"),
          tableX + 10,
          y + 4,
          colDisc - 20,
          "left",
          "#111827",
          10,
          "Helvetica"
        );

        drawCellText(
          doc,
          row.score !== null && row.score !== undefined ? String(row.score) : "—",
          tableX + colDisc,
          y + 4,
          colNota - 10,
          "center",
          "#0f172a",
          10,
          "Helvetica-Bold"
        );

        y += rowH + 4;
      }
    }

    y += 12;

    doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(`Emitido em: ${brDateTimeFromIso(new Date().toISOString())}`, margin, y);

    const signY = pageH - 80;
    doc.moveTo(margin, signY).lineTo(pageW - margin, signY).lineWidth(0.8).strokeColor("#cbd5e1").stroke();

    doc.font("Helvetica").fontSize(10).fillColor("#475569");
    doc.text("Documento emitido para consulta do responsável", margin, signY + 8, {
      width: pageW - margin * 2,
      align: "center",
    });

    const pdfBuffer = await pdfToBuffer(doc);
    const pdfBytes = new Uint8Array(pdfBuffer);

    const safeStudentName = String(studentName || "aluno")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="boletim-${safeStudentName || "aluno"}-${term}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno em /api/parent/report-card/pdf", 500);
  }
}