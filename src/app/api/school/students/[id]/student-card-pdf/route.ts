// src/app/api/school/students/[id]/student-card-pdf/route.ts
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function field(value: any) {
  const safe = String(value ?? "").trim();
  return safe || "—";
}

function brDate(value?: string | null) {
  if (!value) return "—";
  const clean = String(value).slice(0, 10);
  const [y, m, d] = clean.split("-");
  if (!y || !m || !d) return field(value);
  return `${d}/${m}/${y}`;
}

function safeFileName(value: string) {
  return String(value || "aluno")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
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

  const sign = u.split("/storage/v1/object/sign/");
  if (sign.length === 2) {
    const rest = sign[1].split("?")[0];
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

async function getImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
  try {
    if (!url) return null;

    const clean = String(url).trim();
    if (!clean) return null;

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

function drawCircularImage(
  doc: PDFKit.PDFDocument,
  buffer: Buffer,
  x: number,
  y: number,
  size: number
) {
  doc.save();
  doc.circle(x + size / 2, y + size / 2, size / 2).clip();
  doc.image(buffer, x, y, {
    fit: [size, size],
    align: "center",
    valign: "center",
  });
  doc.restore();

  doc
    .circle(x + size / 2, y + size / 2, size / 2)
    .lineWidth(2)
    .strokeColor("#ffffff")
    .stroke();
}

function drawInitials(doc: PDFKit.PDFDocument, initials: string, x: number, y: number, size: number) {
  doc.circle(x + size / 2, y + size / 2, size / 2).fill("#0f172a");

  doc.font("Helvetica-Bold").fontSize(22).fillColor("#ffffff");
  doc.text(initials, x, y + size / 2 - 11, {
    width: size,
    align: "center",
  });

  doc
    .circle(x + size / 2, y + size / 2, size / 2)
    .lineWidth(2)
    .strokeColor("#ffffff")
    .stroke();
}

function initialsFromName(name: string | null | undefined) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "AL";
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
    "admin",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const studentId = String(params?.id || "").trim();
    const schoolId = guard.schoolId;

    if (!schoolId) return jsonError("Escola não identificada.", 401);
    if (!studentId) return jsonError("ID do aluno é obrigatório.", 400);

    const { data: school, error: schoolErr } = await supabaseAdmin
      .from("schools")
      .select("name, brand_logo_url, logo_url")
      .eq("id", schoolId)
      .maybeSingle();

    if (schoolErr) {
      return jsonError("Erro ao buscar escola: " + schoolErr.message, 500);
    }

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select(
        `
        id,
        school_id,
        full_name,
        birth_date,
        registration_number,
        student_photo_url,
        gender,
        created_at
      `
      )
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonError("Erro ao buscar aluno: " + studentErr.message, 500);
    }

    if (!student?.id) {
      return jsonError("Aluno não encontrado.", 404);
    }

    const { data: activeLink, error: activeLinkErr } = await supabaseAdmin
      .from("student_classes")
      .select("id, class_id, started_at, is_active, created_at")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeLinkErr) {
      return jsonError("Erro ao buscar vínculo ativo: " + activeLinkErr.message, 500);
    }

    let activeClass: any = null;

    if (activeLink?.class_id) {
      const { data: classData, error: classErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, grade, shift")
        .eq("id", activeLink.class_id)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (classErr) {
        return jsonError("Erro ao buscar turma: " + classErr.message, 500);
      }

      activeClass = classData || null;
    }

    const schoolLogoBuffer = await getImageBuffer(school?.brand_logo_url || school?.logo_url || null);
    const studentPhotoBuffer = await getImageBuffer(student.student_photo_url || null);

    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 0,
      bufferPages: false,
      autoFirstPage: true,
    });

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    doc.rect(0, 0, pageW, pageH).fill("#f1f5f9");

    const cardW = 500;
    const cardH = 300;
    const cardX = (pageW - cardW) / 2;
    const cardY = 130;

    doc.roundedRect(cardX, cardY, cardW, cardH, 24).fill("#ffffff");

    doc.roundedRect(cardX, cardY, cardW, 92, 24).fill("#0f172a");
    doc.rect(cardX, cardY + 68, cardW, 32).fill("#0f172a");

    doc.rect(cardX, cardY + 92, cardW, 5).fill("#2563eb");

    if (schoolLogoBuffer) {
      doc.roundedRect(cardX + 22, cardY + 20, 54, 54, 14).fill("#ffffff");
      doc.image(schoolLogoBuffer, cardX + 27, cardY + 25, {
        fit: [44, 44],
        align: "center",
        valign: "center",
      });
    }

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#cbd5e1");
    doc.text(field(school?.name || "Escola"), cardX + 90, cardY + 22, {
      width: cardW - 120,
      ellipsis: true,
    });

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff");
    doc.text("Carteirinha de Estudante", cardX + 90, cardY + 39, {
      width: cardW - 120,
      ellipsis: true,
    });

    doc.font("Helvetica").fontSize(8).fillColor("#cbd5e1");
    doc.text("Documento escolar de identificação do aluno", cardX + 90, cardY + 66, {
      width: cardW - 120,
    });

    const photoSize = 96;
    const photoX = cardX + 28;
    const photoY = cardY + 122;

    if (studentPhotoBuffer) {
      drawCircularImage(doc, studentPhotoBuffer, photoX, photoY, photoSize);
    } else {
      drawInitials(doc, initialsFromName(student.full_name), photoX, photoY, photoSize);
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a");
    doc.text(field(student.full_name), cardX + 145, cardY + 123, {
      width: cardW - 175,
      ellipsis: true,
    });

    doc.font("Helvetica").fontSize(9).fillColor("#64748b");
    doc.text("Aluno regularmente cadastrado no sistema escolar.", cardX + 145, cardY + 148, {
      width: cardW - 175,
    });

    const infoY = cardY + 178;
    const colW = 150;
    const gap = 10;

    function smallBox(x: number, y: number, label: string, value: string, width = colW) {
      doc.roundedRect(x, y, width, 44, 10).fillAndStroke("#f8fafc", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#94a3b8");
      doc.text(label.toUpperCase(), x + 10, y + 8, {
        width: width - 20,
        lineBreak: false,
      });

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a");
      doc.text(value, x + 10, y + 23, {
        width: width - 20,
        height: 13,
        ellipsis: true,
      });
    }

    smallBox(cardX + 145, infoY, "Matrícula", field(student.registration_number), 92);
    smallBox(cardX + 145 + 92 + gap, infoY, "Nascimento", brDate(student.birth_date), 105);
    smallBox(cardX + 145 + 92 + gap + 105 + gap, infoY, "Sexo", field(student.gender), 82);

    smallBox(cardX + 145, infoY + 54, "Turma", field(activeClass?.name), 140);
    smallBox(cardX + 145 + 140 + gap, infoY + 54, "Série", field(activeClass?.grade), 95);
    smallBox(cardX + 145 + 140 + gap + 95 + gap, infoY + 54, "Turno", field(activeClass?.shift), 90);

    doc.roundedRect(cardX + 28, cardY + 235, 96, 38, 10).fillAndStroke("#f8fafc", "#e2e8f0");
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#94a3b8");
    doc.text("ANO LETIVO", cardX + 38, cardY + 244);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a");
    doc.text(String(new Date().getFullYear()), cardX + 38, cardY + 257);

    doc.font("Helvetica").fontSize(7).fillColor("#64748b");
    doc.text(`ID: ${student.id}`, cardX + 28, cardY + cardH - 20, {
      width: cardW - 56,
      ellipsis: true,
    });

    doc.font("Helvetica").fontSize(8).fillColor("#64748b");
    doc.text(`Emitido em ${new Date().toLocaleDateString("pt-BR")}`, cardX, cardY + cardH + 24, {
      width: cardW,
      align: "center",
    });

    const buffer = await pdfToBuffer(doc);

    const fileName = `carteirinha-${safeFileName(student.full_name || studentId)}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao gerar carteirinha do aluno.", 500);
  }
}