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
  return safe || "Não informado";
}

function compactField(value: any) {
  const safe = String(value ?? "").trim();
  return safe || "—";
}

function brDate(value?: string | null) {
  if (!value) return "—";

  const clean = String(value).slice(0, 10);
  const [y, m, d] = clean.split("-");

  if (!y || !m || !d) return compactField(value);

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

function safeFileName(value: string) {
  return String(value || "aluno")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
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

  return parts.length > 0 ? parts.join(", ") : "Não informado";
}

function initialsFromName(name: string | null | undefined) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "AL";
}

function parseSupabaseStorageRef(url: string): { bucket: string; path: string } | null {
  const u = String(url || "").trim();

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

function drawPill(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  text: string,
  options?: {
    bg?: string;
    color?: string;
    width?: number;
  }
) {
  const bg = options?.bg || "#e0f2fe";
  const color = options?.color || "#075985";
  const width = options?.width || Math.max(74, text.length * 5.2 + 18);

  doc.roundedRect(x, y, width, 20, 10).fill(bg);

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(color);
  doc.text(text, x + 9, y + 6, {
    width: width - 18,
    align: "center",
    lineBreak: false,
  });
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  schoolName: string,
  logoBuffer: Buffer | null,
  pageTitle = "Ficha Completa do Aluno"
) {
  const pageWidth = doc.page.width;
  const margin = 34;

  doc.save();

  doc.rect(0, 0, pageWidth, 92).fill("#0f172a");
  doc.rect(0, 88, pageWidth, 4).fill("#2563eb");

  if (logoBuffer) {
    doc.roundedRect(margin, 22, 48, 48, 10).fill("#ffffff");
    doc.image(logoBuffer, margin + 4, 26, {
      fit: [40, 40],
      align: "center",
      valign: "center",
    });
  } else {
    doc.roundedRect(margin, 22, 48, 48, 10).fill("#ffffff");
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a");
    doc.text("ESC", margin, 38, {
      width: 48,
      align: "center",
    });
  }

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#bfdbfe");
  doc.text(schoolName, margin + 62, 24, {
    width: pageWidth - margin * 2 - 62,
    ellipsis: true,
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff");
  doc.text(pageTitle, margin + 62, 40, {
    width: pageWidth - margin * 2 - 62,
    ellipsis: true,
  });

  doc.font("Helvetica").fontSize(8.5).fillColor("#cbd5e1");
  doc.text("Documento oficial com dados escolares, saúde, segurança e responsáveis vinculados.", margin + 62, 66, {
    width: pageWidth - margin * 2 - 62,
    ellipsis: true,
  });

  doc.restore();
}

function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number, totalPages: number) {
  const margin = 34;
  const y = doc.page.height - 38;

  doc.save();

  doc
    .moveTo(margin, y - 10)
    .lineTo(doc.page.width - margin, y - 10)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b");

  doc.text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, margin, y, {
    width: 230,
    align: "left",
    lineBreak: false,
  });

  doc.text(`Página ${pageNumber} de ${totalPages}`, doc.page.width - margin - 110, y, {
    width: 110,
    align: "right",
    lineBreak: false,
  });

  doc.restore();
}

function addPremiumPage(
  doc: PDFKit.PDFDocument,
  schoolName: string,
  logoBuffer: Buffer | null
) {
  doc.addPage();
  drawHeader(doc, schoolName, logoBuffer);
  return 118;
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  needed: number,
  schoolName: string,
  logoBuffer: Buffer | null
) {
  const bottomLimit = doc.page.height - 60;

  if (y + needed <= bottomLimit) return y;

  return addPremiumPage(doc, schoolName, logoBuffer);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number, subtitle?: string) {
  doc.save();

  doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#0f172a");
  doc.text(title, 34, y, {
    width: doc.page.width - 68,
    lineBreak: false,
  });

  if (subtitle) {
    doc.font("Helvetica").fontSize(7.8).fillColor("#64748b");
    doc.text(subtitle, 34, y + 15, {
      width: doc.page.width - 68,
      ellipsis: true,
    });

    doc.restore();
    return y + 30;
  }

  doc.restore();
  return y + 22;
}

function drawInfoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  options?: {
    height?: number;
    bg?: string;
    labelColor?: string;
    valueColor?: string;
    valueSize?: number;
    maxLines?: number;
  }
) {
  const boxHeight = options?.height || 42;
  const bg = options?.bg || "#f8fafc";
  const labelColor = options?.labelColor || "#64748b";
  const valueColor = options?.valueColor || "#0f172a";
  const valueSize = options?.valueSize || 8.4;
  const maxLines = options?.maxLines || 1;

  doc.save();

  doc.roundedRect(x, y, width, boxHeight, 9).fillAndStroke(bg, "#e5e7eb");

  doc.font("Helvetica-Bold").fontSize(6.6).fillColor(labelColor);
  doc.text(label.toUpperCase(), x + 9, y + 8, {
    width: width - 18,
    height: 8,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font("Helvetica-Bold").fontSize(valueSize).fillColor(valueColor);

  doc.text(value || "—", x + 9, y + 21, {
    width: width - 18,
    height: maxLines === 1 ? 12 : boxHeight - 27,
    ellipsis: true,
  });

  doc.restore();
}

function drawLongBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  height = 58
) {
  doc.save();

  doc.roundedRect(x, y, width, height, 10).fillAndStroke("#f8fafc", "#e5e7eb");

  doc.font("Helvetica-Bold").fontSize(6.7).fillColor("#64748b");
  doc.text(label.toUpperCase(), x + 10, y + 8, {
    width: width - 20,
    ellipsis: true,
  });

  doc.font("Helvetica").fontSize(8.1).fillColor("#0f172a");
  doc.text(value || "—", x + 10, y + 22, {
    width: width - 20,
    height: height - 29,
    ellipsis: true,
  });

  doc.restore();
}

function drawStudentHero(
  doc: PDFKit.PDFDocument,
  student: any,
  activeClass: any,
  studentPhotoBuffer: Buffer | null,
  y: number
) {
  const margin = 34;
  const contentWidth = doc.page.width - margin * 2;
  const cardHeight = 112;
  const photoSize = 78;

  doc.save();

  doc.roundedRect(margin, y, contentWidth, cardHeight, 16).fillAndStroke("#ffffff", "#dbeafe");

  const photoX = margin + 16;
  const photoY = y + 17;

  doc.roundedRect(photoX, photoY, photoSize, photoSize, 14).fillAndStroke("#eff6ff", "#dbeafe");

  if (studentPhotoBuffer) {
    doc.image(studentPhotoBuffer, photoX, photoY, {
      fit: [photoSize, photoSize],
      align: "center",
      valign: "center",
    });
  } else {
    doc.font("Helvetica-Bold").fontSize(24).fillColor("#1e293b");
    doc.text(initialsFromName(student.full_name), photoX, photoY + 26, {
      width: photoSize,
      align: "center",
    });
  }

  const textX = photoX + photoSize + 18;
  const textW = contentWidth - photoSize - 50;

  drawPill(doc, textX, y + 15, "ALUNO", {
    bg: "#dbeafe",
    color: "#1d4ed8",
    width: 58,
  });

  doc.font("Helvetica-Bold").fontSize(16.5).fillColor("#0f172a");
  doc.text(field(student.full_name), textX, y + 41, {
    width: textW,
    ellipsis: true,
  });

  doc.font("Helvetica").fontSize(8.6).fillColor("#475569");
  doc.text(
    `Matrícula: ${compactField(student.registration_number)}  •  Nascimento: ${brDate(student.birth_date)}  •  Turma: ${compactField(activeClass?.name)}`,
    textX,
    y + 66,
    {
      width: textW,
      ellipsis: true,
    }
  );

  doc.font("Helvetica").fontSize(8).fillColor("#64748b");
  doc.text(`Cadastro: ${brDateTime(student.created_at)}`, textX, y + 84, {
    width: textW,
    ellipsis: true,
  });

  doc.restore();

  return y + cardHeight + 18;
}

function drawSignatureBlock(doc: PDFKit.PDFDocument, y: number) {
  const margin = 34;
  const contentWidth = doc.page.width - margin * 2;

  doc.save();

  doc.roundedRect(margin, y, contentWidth, 70, 12).fillAndStroke("#ffffff", "#e5e7eb");

  doc.font("Helvetica").fontSize(8.2).fillColor("#475569");
  doc.text(
    "Declaro que as informações apresentadas nesta ficha correspondem aos dados registrados no sistema escolar até a data de emissão deste documento.",
    margin + 14,
    y + 14,
    {
      width: contentWidth - 28,
      height: 22,
    }
  );

  const lineW = 210;
  const lineX = margin + contentWidth - lineW - 20;
  const lineY = y + 48;

  doc
    .moveTo(lineX, lineY)
    .lineTo(lineX + lineW, lineY)
    .strokeColor("#64748b")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(7.8).fillColor("#334155");
  doc.text("Assinatura da direção / secretaria", lineX, lineY + 7, {
    width: lineW,
    align: "center",
  });

  doc.restore();

  return y + 84;
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
        allergies,
        continuous_medication,
        food_restrictions,
        emergency_contact_name,
        emergency_contact_phone,
        authorized_pickup_notes,
        general_notes,
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

    const relationshipByParentId = new Map<string, string | null>();

    for (const link of links || []) {
      relationshipByParentId.set(String(link.parent_id), link.relationship ?? null);
    }

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

    const schoolName = field(school?.name || "Escola");
    const schoolLogoBuffer = await getImageBuffer(school?.brand_logo_url || school?.logo_url || null);
    const studentPhotoBuffer = await getImageBuffer(student.student_photo_url || null);

    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 34,
      bufferPages: true,
      autoFirstPage: true,
    });

    const margin = 34;
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - margin * 2;
    const gap = 8;
    const col4 = (contentWidth - gap * 3) / 4;
    const col3 = (contentWidth - gap * 2) / 3;
    const col2 = (contentWidth - gap) / 2;

    drawHeader(doc, schoolName, schoolLogoBuffer);

    let y = 114;

    y = drawStudentHero(doc, student, activeClass, studentPhotoBuffer, y);

    y = sectionTitle(doc, "Dados oficiais do aluno", y);

    drawInfoBox(doc, margin, y, col4, "Nome completo", field(student.full_name));
    drawInfoBox(doc, margin + (col4 + gap), y, col4, "Matrícula", compactField(student.registration_number));
    drawInfoBox(doc, margin + (col4 + gap) * 2, y, col4, "Nascimento", brDate(student.birth_date));
    drawInfoBox(doc, margin + (col4 + gap) * 3, y, col4, "Sexo", compactField(student.gender));

    y += 50;

    drawInfoBox(doc, margin, y, col4, "CPF", compactField(student.cpf));
    drawInfoBox(doc, margin + (col4 + gap), y, col4, "RG", compactField(student.rg));
    drawInfoBox(doc, margin + (col4 + gap) * 2, y, col4, "Certidão", compactField(student.birth_certificate));
    drawInfoBox(doc, margin + (col4 + gap) * 3, y, col4, "Atualizado", brDateTime(student.student_profile_updated_at));

    y += 64;

    y = sectionTitle(doc, "Filiação", y);

    drawInfoBox(doc, margin, y, col2, "Nome da mãe", field(student.mother_name), {
      height: 44,
      maxLines: 1,
    });

    drawInfoBox(doc, margin + col2 + gap, y, col2, "Nome do pai", field(student.father_name), {
      height: 44,
      maxLines: 1,
    });

    y += 62;

    y = ensureSpace(doc, y, 192, schoolName, schoolLogoBuffer);
    y = sectionTitle(doc, "Saúde, segurança e observações", y);

    drawLongBox(doc, margin, y, col2, "Observações médicas / alertas", field(student.medical_notes), 52);
    drawLongBox(doc, margin + col2 + gap, y, col2, "Alergias", field(student.allergies), 52);

    y += 60;

    drawLongBox(doc, margin, y, col2, "Medicação contínua", field(student.continuous_medication), 52);
    drawLongBox(doc, margin + col2 + gap, y, col2, "Restrições alimentares", field(student.food_restrictions), 52);

    y += 60;

    drawInfoBox(doc, margin, y, col2, "Contato de emergência", field(student.emergency_contact_name), {
      height: 44,
    });

    drawInfoBox(doc, margin + col2 + gap, y, col2, "Telefone de emergência", field(student.emergency_contact_phone), {
      height: 44,
    });

    y += 52;

    drawLongBox(doc, margin, y, col2, "Autorizados para buscar / retirada", field(student.authorized_pickup_notes), 52);
    drawLongBox(doc, margin + col2 + gap, y, col2, "Observações gerais", field(student.general_notes), 52);

    y += 70;

    y = ensureSpace(doc, y, 78, schoolName, schoolLogoBuffer);
    y = sectionTitle(doc, "Turma atual", y);

    drawInfoBox(doc, margin, y, col4, "Turma", compactField(activeClass?.name));
    drawInfoBox(doc, margin + (col4 + gap), y, col4, "Série", compactField(activeClass?.grade));
    drawInfoBox(doc, margin + (col4 + gap) * 2, y, col4, "Turno", compactField(activeClass?.shift));
    drawInfoBox(doc, margin + (col4 + gap) * 3, y, col4, "Vínculo desde", brDate(activeLink?.started_at));

    y += 64;

    y = ensureSpace(doc, y, 142, schoolName, schoolLogoBuffer);
    y = sectionTitle(doc, "Responsáveis vinculados", y, "Dados de contato e endereço dos responsáveis associados ao aluno.");

    if (parents.length === 0) {
      doc.roundedRect(margin, y, contentWidth, 54, 12).fillAndStroke("#f8fafc", "#e5e7eb");
      doc.font("Helvetica").fontSize(9).fillColor("#475569");
      doc.text("Nenhum responsável vinculado ao aluno.", margin + 14, y + 20, {
        width: contentWidth - 28,
      });

      y += 68;
    } else {
      for (const parent of parents) {
        const parentHeight = 132;

        y = ensureSpace(doc, y, parentHeight + 12, schoolName, schoolLogoBuffer);

        doc.save();

        doc.roundedRect(margin, y, contentWidth, parentHeight, 14).fillAndStroke("#ffffff", "#e5e7eb");

        doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#0f172a");
        doc.text(field(parent.full_name), margin + 14, y + 13, {
          width: contentWidth - 170,
          ellipsis: true,
        });

        const relationship = relationshipByParentId.get(String(parent.id));

        if (relationship) {
          drawPill(doc, margin + contentWidth - 122, y + 12, relationship, {
            bg: "#eff6ff",
            color: "#1d4ed8",
            width: 96,
          });
        }

        doc.font("Helvetica").fontSize(7.6).fillColor("#64748b");
        doc.text(
          parent.first_login_completed
            ? "Cadastro completo preenchido no Portal dos Pais"
            : "Cadastro ainda não finalizado pelo responsável",
          margin + 14,
          y + 31,
          {
            width: contentWidth - 28,
            ellipsis: true,
          }
        );

        const rowY = y + 52;
        const innerX = margin + 14;
        const innerW = contentWidth - 28;
        const pCol = (innerW - gap * 2) / 3;

        drawInfoBox(doc, innerX, rowY, pCol, "Telefone", compactField(parent.phone), {
          height: 40,
          valueSize: 8.2,
        });

        drawInfoBox(doc, innerX + pCol + gap, rowY, pCol, "CPF", compactField(parent.cpf), {
          height: 40,
          valueSize: 8.2,
        });

        drawInfoBox(doc, innerX + (pCol + gap) * 2, rowY, pCol, "Telefone secundário", compactField(parent.phone_secondary), {
          height: 40,
          valueSize: 8.2,
        });

        drawInfoBox(doc, innerX, rowY + 47, innerW, "Endereço", buildAddressText(parent), {
          height: 40,
          valueSize: 8,
        });

        doc.restore();

        y += parentHeight + 10;
      }
    }

    y = ensureSpace(doc, y, 86, schoolName, schoolLogoBuffer);
    drawSignatureBlock(doc, y);

    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      if (i > 0) {
        drawHeader(doc, schoolName, schoolLogoBuffer);
      }

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