// src/app/api/school/students/[id]/profile-pdf/route.ts
// PDF da ficha completa do aluno da própria escola. Busca os mesmos dados da ficha exibida
// na tela (students, turma ativa, responsáveis ativos) e monta o PDF em
// src/lib/students/profilePdf.ts.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SCHOOL_IDENTITY_COLUMNS, resolveSchoolIdentity } from "@/lib/schoolIdentity";
import { loadPdfImage } from "@/lib/pdf/pdfImage";
import { requireStaff } from "@/lib/requireStaff";
import { buildStudentProfilePdf, type ProfilePdfParent } from "@/lib/students/profilePdf";
import { safeFileName } from "@/lib/pdf/text";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator", "secretaria",
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
      .select(SCHOOL_IDENTITY_COLUMNS)
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

    let parents: ProfilePdfParent[] = [];

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
          first_login_completed
        `
        )
        .eq("school_id", schoolId)
        .in("id", parentIds);

      if (parentsErr) {
        return jsonError("Erro ao buscar responsáveis: " + parentsErr.message, 500);
      }

      // Mesma ordem dos vínculos (mais recentes primeiro), como na ficha exibida.
      const order = new Map(parentIds.map((id, i) => [id, i]));
      parents = ((parentRows || []) as any[])
        .map((p) => ({ ...p, id: String(p.id), relationship: relationshipByParentId.get(String(p.id)) ?? null }))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }

    // Identidade canônica da escola autorizada; imagens só do Storage do projeto, tratadas.
    const schoolIdentity = resolveSchoolIdentity(school);
    const [schoolLogo, studentPhoto] = await Promise.all([
      loadPdfImage(schoolIdentity.logoUrl),
      loadPdfImage(student.student_photo_url || null),
    ]);

    const buffer = await buildStudentProfilePdf({
      schoolName: String(schoolIdentity.displayName || "Escola"),
      schoolLogo,
      studentPhoto,
      student,
      activeClass,
      activeLinkStartedAt: activeLink?.started_at ?? null,
      parents,
      issuedAt: new Date(),
    });

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
