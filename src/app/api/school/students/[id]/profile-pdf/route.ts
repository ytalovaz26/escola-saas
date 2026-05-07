// src/app/api/school/students/[id]/profile-pdf/route.ts
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

type ParentRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  cpf: string | null;
  phone_secondary: string | null;
  zip_code: string | null;
  street: string | null;
  street_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  photo_url: string | null;
  first_login_completed: boolean | null;
  profile_updated_at: string | null;
  created_at: string | null;
};

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

function brDateTime(value?: string | null) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return brDate(value);
  }
}

function buildAddressText(parent: ParentRow) {
  const parts: string[] = [];

  const street = String(parent.street || "").trim();
  const number = String(parent.street_number || "").trim();
  const complement = String(parent.address_complement || "").trim();
  const neighborhood = String(parent.neighborhood || "").trim();
  const city = String(parent.city || "").trim();
  const state = String(parent.state || "").trim();
  const zip = String(parent.zip_code || "").trim();

  if (street) parts.push(number ? `${street}, ${number}` : street);
  if (complement) parts.push(complement);
  if (neighborhood) parts.push(neighborhood);

  const cityUf = [city, state].filter(Boolean).join(" / ");
  if (cityUf) parts.push(cityUf);

  if (zip) parts.push(`CEP ${zip}`);

  return parts.length > 0 ? parts.join(", ") : "—";
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

function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number, totalPages: number) {
  const margin = 40;
  const y = doc.page.height - 45;

  doc
    .moveTo(margin, y - 10)
    .lineTo(doc.page.width - margin, y - 10)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(8).fillColor("#6b7280");

  doc.text(`Emitido em: ${new Date().toLocaleDateString("pt-BR")}`, margin, y, {
    width: 220,
    align: "left",
    lineBreak: false,
  });

  doc.text(`Página ${pageNumber} de ${totalPages}`, doc.page.width - margin - 120, y, {
    width: 120,
    align: "right",
    lineBreak: false,
  });
}

function drawInfoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string
) {
  const boxHeight = 48;

  doc
    .roundedRect(x, y, width, boxHeight, 10)
    .fillAndStroke("#f8fafc", "#e5e7eb");

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#94a3b8");
  doc.text(label.toUpperCase(), x + 12, y + 10, {
    width: width - 24,
    lineBreak: false,
  });

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a");
  doc.text(value || "—", x + 12, y + 25, {
    width: width - 24,
    height: 16,
    ellipsis: true,
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number) {
  const bottomLimit = doc.page.height - 85;

  if (y + needed <= bottomLimit) return y;

  doc.addPage();
  return 50;
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a");
  doc.text(title, 40, y);

  return y + 24;
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
    if (!studentId) return jsonError("studentId é obrigatório.", 400);

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
        class_id,
        student_photo_url,
        student_photo_uploaded_at,
        student_profile_updated_at,
        gender,
        cpf,
        rg,
        birth_certificate,
        mother_name,
        father_name,
        medical_notes,
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
      .select("id, student_id, class_id, school_id, is_active, started_at, ended_at, created_at")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeLinkErr) {
      return jsonError("Erro ao buscar turma ativa: " + activeLinkErr.message, 500);
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

    const { data: links, error: linksErr } = await supabaseAdmin
      .from("student_parents")
      .select("id, parent_id, student_id, school_id, relationship, is_active, created_at")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (linksErr) {
      return jsonError("Erro ao buscar vínculos: " + linksErr.message, 500);
    }

    const parentIds = Array.from(
      new Set((links || []).map((link: any) => String(link.parent_id)).filter(Boolean))
    );

    let parents: ParentRow[] = [];

    if (parentIds.length > 0) {
      const { data: parentRows, error: parentsErr } = await supabaseAdmin
        .from("parents")
        .select(
          `
          id,
          full_name,
          phone,
          cpf,
          phone_secondary,
          zip_code,
          street,
          street_number,
          address_complement,
          neighborhood,
          city,
          state,
          photo_url,
          first_login_completed,
          profile_updated_at,
          created_at
        `
        )
        .eq("school_id", schoolId)
        .in("id", parentIds);

      if (parentsErr) {
        return jsonError("Erro ao buscar responsáveis: " + parentsErr.message, 500);
      }

      parents = (parentRows || []) as ParentRow[];
    }

    const schoolLogoBuffer = await getImageBuffer(school?.brand_logo_url || school?.logo_url || null);
    const studentPhotoBuffer = await getImageBuffer(student.student_photo_url || null);

    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 40,
      bufferPages: true,
      autoFirstPage: true,
    });

    const margin = 40;
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - margin * 2;

    doc.rect(0, 0, pageWidth, 126).fill("#0f172a");

    if (schoolLogoBuffer) {
      doc.image(schoolLogoBuffer, margin, 28, { fit: [72, 72] });
    }

    const titleX = schoolLogoBuffer ? margin + 88 : margin;

    doc.font("Helvetica-Bold").fontSize(17).fillColor("#ffffff");
    doc.text(field(school?.name || "Escola"), titleX, 32, {
      width: pageWidth - titleX - margin,
      ellipsis: true,
    });

    doc.font("Helvetica-Bold").fontSize(21).fillColor("#ffffff");
    doc.text("Ficha Completa do Aluno", titleX, 58, {
      width: pageWidth - titleX - margin,
      ellipsis: true,
    });

    doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1");
    doc.text("Documento oficial com dados escolares e responsáveis vinculados.", titleX, 88, {
      width: pageWidth - titleX - margin,
    });

    let y = 152;

    const photoX = margin;
    const photoY = y;
    const photoSize = 96;

    doc.roundedRect(photoX, photoY, photoSize, photoSize, 18).fillAndStroke("#f8fafc", "#e5e7eb");

    if (studentPhotoBuffer) {
      doc.image(studentPhotoBuffer, photoX, photoY, {
        fit: [photoSize, photoSize],
        align: "center",
        valign: "center",
      });
    } else {
      doc.font("Helvetica-Bold").fontSize(28).fillColor("#334155");
      const initials = String(student.full_name || "AL")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p: string) => p[0])
        .join("")
        .toUpperCase();

      doc.text(initials || "AL", photoX, photoY + 34, {
        width: photoSize,
        align: "center",
      });
    }

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a");
    doc.text(field(student.full_name), photoX + photoSize + 22, y + 8, {
      width: contentWidth - photoSize - 22,
    });

    doc.font("Helvetica").fontSize(10).fillColor("#475569");
    doc.text(`Matrícula: ${field(student.registration_number)}`, photoX + photoSize + 22, y + 40, {
      width: contentWidth - photoSize - 22,
    });

    doc.text(`Nascimento: ${brDate(student.birth_date)}`, photoX + photoSize + 22, y + 58, {
      width: contentWidth - photoSize - 22,
    });

    doc.text(`Cadastro: ${brDateTime(student.created_at)}`, photoX + photoSize + 22, y + 76, {
      width: contentWidth - photoSize - 22,
    });

    y += 128;

    y = sectionTitle(doc, "Dados oficiais do aluno", y);

    const colGap = 10;
    const colW = (contentWidth - colGap * 3) / 4;

    drawInfoBox(doc, margin, y, colW, "Nome completo", field(student.full_name));
    drawInfoBox(doc, margin + (colW + colGap), y, colW, "Matrícula", field(student.registration_number));
    drawInfoBox(doc, margin + (colW + colGap) * 2, y, colW, "Nascimento", brDate(student.birth_date));
    drawInfoBox(doc, margin + (colW + colGap) * 3, y, colW, "Sexo", field(student.gender));

    y += 62;

    drawInfoBox(doc, margin, y, colW, "CPF", field(student.cpf));
    drawInfoBox(doc, margin + (colW + colGap), y, colW, "RG", field(student.rg));
    drawInfoBox(doc, margin + (colW + colGap) * 2, y, colW, "Certidão", field(student.birth_certificate));
    drawInfoBox(doc, margin + (colW + colGap) * 3, y, colW, "Atualizado", brDateTime(student.student_profile_updated_at));

    y += 78;

    y = sectionTitle(doc, "Filiação e informações complementares", y);

    drawInfoBox(doc, margin, y, (contentWidth - colGap) / 2, "Nome da mãe", field(student.mother_name));
    drawInfoBox(
      doc,
      margin + (contentWidth - colGap) / 2 + colGap,
      y,
      (contentWidth - colGap) / 2,
      "Nome do pai",
      field(student.father_name)
    );

    y += 62;

    const notesHeight = Math.max(
      56,
      doc.heightOfString(field(student.medical_notes), { width: contentWidth - 24 }) + 32
    );

    doc.roundedRect(margin, y, contentWidth, notesHeight, 10).fillAndStroke("#f8fafc", "#e5e7eb");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#94a3b8");
    doc.text("OBSERVAÇÕES MÉDICAS / ALERTAS", margin + 12, y + 10);
    doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
    doc.text(field(student.medical_notes), margin + 12, y + 25, {
      width: contentWidth - 24,
    });

    y += notesHeight + 22;

    y = ensureSpace(doc, y, 110);
    y = sectionTitle(doc, "Turma atual", y);

    drawInfoBox(doc, margin, y, colW, "Turma", field(activeClass?.name));
    drawInfoBox(doc, margin + (colW + colGap), y, colW, "Série", field(activeClass?.grade));
    drawInfoBox(doc, margin + (colW + colGap) * 2, y, colW, "Turno", field(activeClass?.shift));
    drawInfoBox(doc, margin + (colW + colGap) * 3, y, colW, "Vínculo desde", brDate(activeLink?.started_at));

    y += 78;

    y = ensureSpace(doc, y, 130);
    y = sectionTitle(doc, "Responsáveis vinculados", y);

    if (parents.length === 0) {
      doc.roundedRect(margin, y, contentWidth, 54, 10).fillAndStroke("#f8fafc", "#e5e7eb");
      doc.font("Helvetica").fontSize(10).fillColor("#475569");
      doc.text("Nenhum responsável vinculado ao aluno.", margin + 14, y + 20, {
        width: contentWidth - 28,
      });

      y += 70;
    } else {
      for (const parent of parents) {
        const parentHeight = 154;
        y = ensureSpace(doc, y, parentHeight + 20);

        doc.roundedRect(margin, y, contentWidth, parentHeight, 12).fillAndStroke("#ffffff", "#e5e7eb");

        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a");
        doc.text(field(parent.full_name), margin + 14, y + 14, {
          width: contentWidth - 28,
        });

        doc.font("Helvetica").fontSize(8).fillColor("#64748b");
        doc.text(
          parent.first_login_completed
            ? "Cadastro completo preenchido"
            : "Cadastro ainda não finalizado pelo responsável",
          margin + 14,
          y + 33,
          { width: contentWidth - 28 }
        );

        const rowY = y + 56;
        const pColW = (contentWidth - 28 - colGap * 2) / 3;
        const startX = margin + 14;

        drawInfoBox(doc, startX, rowY, pColW, "Telefone", field(parent.phone));
        drawInfoBox(doc, startX + pColW + colGap, rowY, pColW, "CPF", field(parent.cpf));
        drawInfoBox(doc, startX + (pColW + colGap) * 2, rowY, pColW, "Telefone secundário", field(parent.phone_secondary));

        const addressY = rowY + 62;

        doc.roundedRect(startX, addressY, contentWidth - 28, 44, 10).fillAndStroke("#f8fafc", "#e5e7eb");
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#94a3b8");
        doc.text("ENDEREÇO", startX + 12, addressY + 9);
        doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
        doc.text(buildAddressText(parent), startX + 12, addressY + 23, {
          width: contentWidth - 52,
          height: 14,
          ellipsis: true,
        });

        y += parentHeight + 14;
      }
    }

    y = ensureSpace(doc, y, 90);

    doc.font("Helvetica").fontSize(9).fillColor("#64748b");
    doc.text(
      "Declaro que as informações apresentadas nesta ficha correspondem aos dados registrados no sistema escolar até a data de emissão deste documento.",
      margin,
      y,
      {
        width: contentWidth,
        align: "left",
      }
    );

    y += 62;

    doc
      .moveTo(pageWidth - 250, y)
      .lineTo(pageWidth - margin, y)
      .strokeColor("#64748b")
      .lineWidth(1)
      .stroke();

    doc.font("Helvetica").fontSize(9).fillColor("#334155");
    doc.text("Assinatura da direção / secretaria", pageWidth - 250, y + 8, {
      width: 210,
      align: "center",
    });

    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      drawFooter(doc, i + 1, totalPages);
    }

    const buffer = await pdfToBuffer(doc);

    const fileName = `ficha-aluno-${safeFileName(student.full_name || studentId)}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao gerar PDF da ficha do aluno.", 500);
  }
}