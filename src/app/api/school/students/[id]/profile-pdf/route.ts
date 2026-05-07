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

function initialsFromName(name: string | null | undefined) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "AL";
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

function parseSupabaseStorageRef(url: string): { bucket: string; path: string } | null {
  const u = String(url || "").trim();
  if (!u) return null;

  const publicParts = u.split("/storage/v1/object/public/");
  if (publicParts.length === 2) {
    const rest = publicParts[1];
    const pieces = rest.split("/");
    const bucket = pieces.shift();
    const path = pieces.join("/");
    if (bucket && path) return { bucket, path };
  }

  const signedParts = u.split("/storage/v1/object/sign/");
  if (signedParts.length === 2) {
    const rest = signedParts[1].split("?")[0];
    const pieces = rest.split("/");
    const bucket = pieces.shift();
    const path = pieces.join("/");
    if (bucket && path) return { bucket, path };
  }

  if (!u.startsWith("http://") && !u.startsWith("https://") && u.includes("/")) {
    const pieces = u.split("/");
    const bucket = pieces.shift();
    const path = pieces.join("/");
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

function drawHeader(
  doc: PDFKit.PDFDocument,
  schoolName: string,
  logoBuffer: Buffer | null
) {
  const pageWidth = doc.page.width;
  const margin = 34;

  doc.save();

  doc.rect(0, 0, pageWidth, 86).fill("#0f172a");
  doc.rect(0, 82, pageWidth, 4).fill("#2563eb");

  doc.roundedRect(margin, 18, 48, 48, 10).fill("#ffffff");

  if (logoBuffer) {
    doc.image(logoBuffer, margin + 4, 22, {
      fit: [40, 40],
      align: "center",
      valign: "center",
    });
  } else {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a");
    doc.text("ESC", margin, 36, {
      width: 48,
      height: 12,
      align: "center",
      lineBreak: false,
    });
  }

  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#bfdbfe");
  doc.text(schoolName, margin + 62, 21, {
    width: pageWidth - margin * 2 - 62,
    height: 12,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff");
  doc.text("Ficha Completa do Aluno", margin + 62, 37, {
    width: pageWidth - margin * 2 - 62,
    height: 22,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font("Helvetica").fontSize(8).fillColor("#cbd5e1");
  doc.text(
    "Documento oficial com dados escolares, saúde, segurança e responsáveis vinculados.",
    margin + 62,
    61,
    {
      width: pageWidth - margin * 2 - 62,
      height: 12,
      ellipsis: true,
      lineBreak: false,
    }
  );

  doc.restore();
}

function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number) {
  const margin = 34;
  const footerLineY = doc.page.height - 46;
  const footerTextY = doc.page.height - 34;

  doc.save();

  doc
    .moveTo(margin, footerLineY)
    .lineTo(doc.page.width - margin, footerLineY)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(7).fillColor("#64748b");

  doc.text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, margin, footerTextY, {
    width: 260,
    height: 9,
    lineBreak: false,
  });

  doc.text(`Página ${pageNumber}`, doc.page.width - margin - 100, footerTextY, {
    width: 100,
    height: 9,
    align: "right",
    lineBreak: false,
  });

  doc.restore();
}

function sectionTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  y: number,
  subtitle?: string
) {
  doc.save();

  doc.font("Helvetica-Bold").fontSize(11.2).fillColor("#0f172a");
  doc.text(title, 34, y, {
    width: doc.page.width - 68,
    height: 14,
    lineBreak: false,
  });

  if (subtitle) {
    doc.font("Helvetica").fontSize(7.4).fillColor("#64748b");
    doc.text(subtitle, 34, y + 14, {
      width: doc.page.width - 68,
      height: 10,
      ellipsis: true,
      lineBreak: false,
    });

    doc.restore();
    return y + 28;
  }

  doc.restore();
  return y + 20;
}

function drawInfoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  height = 38
) {
  doc.save();

  doc.roundedRect(x, y, width, height, 8).fillAndStroke("#f8fafc", "#e5e7eb");

  doc.font("Helvetica-Bold").fontSize(6.2).fillColor("#64748b");
  doc.text(label.toUpperCase(), x + 8, y + 7, {
    width: width - 16,
    height: 8,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font("Helvetica-Bold").fontSize(7.8).fillColor("#0f172a");
  doc.text(value || "—", x + 8, y + 20, {
    width: width - 16,
    height: height - 23,
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
  height = 42
) {
  doc.save();

  doc.roundedRect(x, y, width, height, 9).fillAndStroke("#f8fafc", "#e5e7eb");

  doc.font("Helvetica-Bold").fontSize(6.2).fillColor("#64748b");
  doc.text(label.toUpperCase(), x + 8, y + 7, {
    width: width - 16,
    height: 8,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font("Helvetica").fontSize(7.7).fillColor("#0f172a");
  doc.text(value || "—", x + 8, y + 20, {
    width: width - 16,
    height: height - 24,
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
  const cardHeight = 94;
  const photoSize = 66;

  doc.save();

  doc.roundedRect(margin, y, contentWidth, cardHeight, 15).fillAndStroke("#ffffff", "#dbeafe");

  const photoX = margin + 14;
  const photoY = y + 14;

  doc.roundedRect(photoX, photoY, photoSize, photoSize, 13).fillAndStroke("#eff6ff", "#dbeafe");

  if (studentPhotoBuffer) {
    doc.image(studentPhotoBuffer, photoX, photoY, {
      fit: [photoSize, photoSize],
      align: "center",
      valign: "center",
    });
  } else {
    doc.font("Helvetica-Bold").fontSize(21).fillColor("#1e293b");
    doc.text(initialsFromName(student.full_name), photoX, photoY + 22, {
      width: photoSize,
      height: 24,
      align: "center",
      lineBreak: false,
    });
  }

  const textX = photoX + photoSize + 16;
  const textW = contentWidth - photoSize - 46;

  doc.roundedRect(textX, y + 12, 54, 18, 9).fill("#dbeafe");

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#1d4ed8");
  doc.text("ALUNO", textX, y + 17, {
    width: 54,
    height: 8,
    align: "center",
    lineBreak: false,
  });

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a");
  doc.text(field(student.full_name), textX, y + 35, {
    width: textW,
    height: 18,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font("Helvetica").fontSize(8.1).fillColor("#475569");
  doc.text(
    `Matrícula: ${compactField(student.registration_number)}  •  Nascimento: ${brDate(
      student.birth_date
    )}  •  Turma: ${compactField(activeClass?.name)}`,
    textX,
    y + 58,
    {
      width: textW,
      height: 11,
      ellipsis: true,
      lineBreak: false,
    }
  );

  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b");
  doc.text(`Cadastro: ${brDateTime(student.created_at)}`, textX, y + 74, {
    width: textW,
    height: 10,
    ellipsis: true,
    lineBreak: false,
  });

  doc.restore();

  return y + cardHeight + 11;
}

function drawSignatureBlock(doc: PDFKit.PDFDocument, y: number) {
  const margin = 34;
  const contentWidth = doc.page.width - margin * 2;
  const height = 56;

  doc.save();

  doc.roundedRect(margin, y, contentWidth, height, 11).fillAndStroke("#ffffff", "#e5e7eb");

  doc.font("Helvetica").fontSize(7.5).fillColor("#475569");
  doc.text(
    "Declaro que as informações apresentadas nesta ficha correspondem aos dados registrados no sistema escolar até a data de emissão deste documento.",
    margin + 12,
    y + 10,
    {
      width: contentWidth - 24,
      height: 18,
      ellipsis: true,
    }
  );

  const lineW = 190;
  const lineX = margin + contentWidth - lineW - 18;
  const lineY = y + 38;

  doc
    .moveTo(lineX, lineY)
    .lineTo(lineX + lineW, lineY)
    .strokeColor("#64748b")
    .lineWidth(1)
    .stroke();

  doc.font("Helvetica").fontSize(7).fillColor("#334155");
  doc.text("Assinatura da direção / secretaria", lineX, lineY + 5, {
    width: lineW,
    height: 9,
    align: "center",
    lineBreak: false,
  });

  doc.restore();

  return y + height + 8;
}

function createNewPage(
  doc: PDFKit.PDFDocument,
  schoolName: string,
  logoBuffer: Buffer | null,
  pageState: { pageNumber: number }
) {
  if (pageState.pageNumber > 0) {
    drawFooter(doc, pageState.pageNumber);
  }

  doc.addPage({
    size: "A4",
    margin: 0,
  });

  pageState.pageNumber += 1;

  drawHeader(doc, schoolName, logoBuffer);

  return 104;
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  needed: number,
  schoolName: string,
  logoBuffer: Buffer | null,
  pageState: { pageNumber: number }
) {
  const bottomLimit = doc.page.height - 68;

  if (y + needed <= bottomLimit) return y;

  return createNewPage(doc, schoolName, logoBuffer, pageState);
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
      autoFirstPage: false,
      size: "A4",
      layout: "portrait",
      margin: 0,
    });

    const pageState = { pageNumber: 0 };

    let y = createNewPage(doc, schoolName, schoolLogoBuffer, pageState);

    const margin = 34;
    const contentWidth = doc.page.width - margin * 2;
    const gap = 8;
    const col4 = (contentWidth - gap * 3) / 4;
    const col2 = (contentWidth - gap) / 2;

    y = drawStudentHero(doc, student, activeClass, studentPhotoBuffer, y);

    y = sectionTitle(doc, "Dados oficiais do aluno", y);

    drawInfoBox(doc, margin, y, col4, "Nome completo", field(student.full_name));
    drawInfoBox(doc, margin + (col4 + gap), y, col4, "Matrícula", compactField(student.registration_number));
    drawInfoBox(doc, margin + (col4 + gap) * 2, y, col4, "Nascimento", brDate(student.birth_date));
    drawInfoBox(doc, margin + (col4 + gap) * 3, y, col4, "Sexo", compactField(student.gender));

    y += 46;

    drawInfoBox(doc, margin, y, col4, "CPF", compactField(student.cpf));
    drawInfoBox(doc, margin + (col4 + gap), y, col4, "RG", compactField(student.rg));
    drawInfoBox(doc, margin + (col4 + gap) * 2, y, col4, "Certidão", compactField(student.birth_certificate));
    drawInfoBox(
      doc,
      margin + (col4 + gap) * 3,
      y,
      col4,
      "Atualizado",
      brDateTime(student.student_profile_updated_at)
    );

    y += 53;

    y = sectionTitle(doc, "Filiação", y);

    drawInfoBox(doc, margin, y, col2, "Nome da mãe", field(student.mother_name), 40);
    drawInfoBox(doc, margin + col2 + gap, y, col2, "Nome do pai", field(student.father_name), 40);

    y += 53;

    y = ensureSpace(doc, y, 190, schoolName, schoolLogoBuffer, pageState);
    y = sectionTitle(doc, "Saúde, segurança e observações", y);

    drawLongBox(doc, margin, y, col2, "Observações médicas / alertas", field(student.medical_notes), 41);
    drawLongBox(doc, margin + col2 + gap, y, col2, "Alergias", field(student.allergies), 41);

    y += 49;

    drawLongBox(doc, margin, y, col2, "Medicação contínua", field(student.continuous_medication), 41);
    drawLongBox(doc, margin + col2 + gap, y, col2, "Restrições alimentares", field(student.food_restrictions), 41);

    y += 49;

    drawLongBox(
      doc,
      margin,
      y,
      col2,
      "Contato de emergência",
      `${field(student.emergency_contact_name)} — ${compactField(student.emergency_contact_phone)}`,
      41
    );

    drawLongBox(
      doc,
      margin + col2 + gap,
      y,
      col2,
      "Autorização de retirada",
      field(student.authorized_pickup_notes),
      41
    );

    y += 49;

    drawLongBox(doc, margin, y, contentWidth, "Observações gerais", field(student.general_notes), 41);

    y += 53;

    y = ensureSpace(doc, y, 74, schoolName, schoolLogoBuffer, pageState);
    y = sectionTitle(doc, "Turma atual", y);

    drawInfoBox(doc, margin, y, col4, "Turma", compactField(activeClass?.name));
    drawInfoBox(doc, margin + (col4 + gap), y, col4, "Série", compactField(activeClass?.grade));
    drawInfoBox(doc, margin + (col4 + gap) * 2, y, col4, "Turno", compactField(activeClass?.shift));
    drawInfoBox(doc, margin + (col4 + gap) * 3, y, col4, "Vínculo desde", brDate(activeLink?.started_at));

    y += 55;

    y = ensureSpace(doc, y, parents.length > 0 ? 122 : 70, schoolName, schoolLogoBuffer, pageState);
    y = sectionTitle(
      doc,
      "Responsáveis vinculados",
      y,
      "Dados de contato e endereço dos responsáveis associados ao aluno."
    );

    if (parents.length === 0) {
      drawLongBox(doc, margin, y, contentWidth, "Responsáveis", "Nenhum responsável vinculado ao aluno.", 46);
      y += 56;
    } else {
      for (const parent of parents) {
        const parentHeight = 118;

        y = ensureSpace(doc, y, parentHeight + 10, schoolName, schoolLogoBuffer, pageState);

        doc.save();

        doc.roundedRect(margin, y, contentWidth, parentHeight, 12).fillAndStroke("#ffffff", "#e5e7eb");

        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a");
        doc.text(field(parent.full_name), margin + 12, y + 10, {
          width: contentWidth - 24,
          height: 13,
          ellipsis: true,
          lineBreak: false,
        });

        doc.font("Helvetica").fontSize(7.2).fillColor("#64748b");
        doc.text(
          parent.first_login_completed
            ? "Cadastro completo preenchido no Portal dos Pais"
            : "Cadastro ainda não finalizado pelo responsável",
          margin + 12,
          y + 26,
          {
            width: contentWidth - 24,
            height: 10,
            ellipsis: true,
            lineBreak: false,
          }
        );

        const rel = relationshipByParentId.get(String(parent.id));

        if (rel) {
          doc.roundedRect(margin + contentWidth - 92, y + 9, 78, 18, 9).fill("#ecfeff");
          doc.font("Helvetica-Bold").fontSize(6.7).fillColor("#0369a1");
          doc.text(rel, margin + contentWidth - 92, y + 14, {
            width: 78,
            height: 8,
            align: "center",
            ellipsis: true,
            lineBreak: false,
          });
        }

        doc.restore();

        const rowY = y + 43;
        const pColW = (contentWidth - 24 - gap * 2) / 3;
        const startX = margin + 12;

        drawInfoBox(doc, startX, rowY, pColW, "Telefone", compactField(parent.phone), 36);
        drawInfoBox(doc, startX + pColW + gap, rowY, pColW, "CPF", compactField(parent.cpf), 36);
        drawInfoBox(
          doc,
          startX + (pColW + gap) * 2,
          rowY,
          pColW,
          "Telefone secundário",
          compactField(parent.phone_secondary),
          36
        );

        drawLongBox(doc, startX, rowY + 43, contentWidth - 24, "Endereço", buildAddressText(parent), 34);

        y += parentHeight + 9;
      }
    }

    const signatureHeight = 64;

    y = ensureSpace(doc, y, signatureHeight, schoolName, schoolLogoBuffer, pageState);
    y = drawSignatureBlock(doc, y);

    drawFooter(doc, pageState.pageNumber);

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