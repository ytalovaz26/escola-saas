// src/app/api/school/students/[id]/profile/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function normalizeNullableText(value: unknown) {
  const safe = String(value ?? "").trim();
  return safe.length > 0 ? safe : null;
}

function buildAddressText(parent: any) {
  const parts: string[] = [];

  const street = String(parent?.street || "").trim();
  const number = String(parent?.street_number || "").trim();
  const complement = String(parent?.address_complement || "").trim();
  const neighborhood = String(parent?.neighborhood || "").trim();
  const city = String(parent?.city || "").trim();
  const state = String(parent?.state || "").trim();
  const zip = String(parent?.zip_code || "").trim();

  if (street) parts.push(number ? `${street}, ${number}` : street);
  if (complement) parts.push(complement);
  if (neighborhood) parts.push(neighborhood);

  const cityUf = [city, state].filter(Boolean).join(" / ");
  if (cityUf) parts.push(cityUf);

  if (zip) parts.push(`CEP ${zip}`);

  return parts.length > 0 ? parts.join(", ") : null;
}

async function getStudentProfile(studentId: string, schoolId: string) {
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
      student_photo_uploaded_by,
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
    return {
      ok: false as const,
      response: jsonError("Erro ao buscar aluno: " + studentErr.message, 500),
    };
  }

  if (!student?.id) {
    return {
      ok: false as const,
      response: jsonError("Aluno não encontrado.", 404),
    };
  }

  const { data: activeLink, error: activeLinkErr } = await supabaseAdmin
    .from("student_classes")
    .select(
      `
      id,
      student_id,
      class_id,
      school_id,
      is_active,
      started_at,
      ended_at,
      created_at
    `
    )
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeLinkErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao buscar turma ativa: " + activeLinkErr.message, 500),
    };
  }

  let activeClass: any = null;

  if (activeLink?.class_id) {
    const { data: classData, error: classErr } = await supabaseAdmin
      .from("classes")
      .select("id, name, grade, shift, created_at")
      .eq("id", activeLink.class_id)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (classErr) {
      return {
        ok: false as const,
        response: jsonError("Erro ao buscar dados da turma: " + classErr.message, 500),
      };
    }

    if (classData?.id) {
      activeClass = {
        id: String(classData.id),
        name: classData.name ?? null,
        grade: classData.grade ?? null,
        shift: classData.shift ?? null,
        createdAt: classData.created_at ?? null,
        link: {
          id: String(activeLink.id),
          startedAt: activeLink.started_at ?? null,
          endedAt: activeLink.ended_at ?? null,
          createdAt: activeLink.created_at ?? null,
          isActive: !!activeLink.is_active,
        },
      };
    }
  }

  const { data: links, error: linksErr } = await supabaseAdmin
    .from("student_parents")
    .select("id, school_id, parent_id, student_id, is_active, created_at")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (linksErr) {
    return {
      ok: false as const,
      response: jsonError("Erro ao buscar vínculos com responsáveis: " + linksErr.message, 500),
    };
  }

  const parentIds = Array.from(
    new Set((links || []).map((link: any) => String(link.parent_id)).filter(Boolean))
  );

  let parents: any[] = [];

  if (parentIds.length > 0) {
    const { data: parentRows, error: parentsErr } = await supabaseAdmin
      .from("parents")
      .select(
        `
        id,
        school_id,
        user_id,
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
      return {
        ok: false as const,
        response: jsonError("Erro ao buscar responsáveis: " + parentsErr.message, 500),
      };
    }

    const linkByParentId = new Map<string, any>();

    for (const link of links || []) {
      linkByParentId.set(String(link.parent_id), link);
    }

    parents = (parentRows || []).map((parent: any) => {
      const link = linkByParentId.get(String(parent.id));

      return {
        id: String(parent.id),
        linkId: link?.id ? String(link.id) : null,
        linkedAt: link?.created_at ?? null,
        schoolId: parent.school_id ? String(parent.school_id) : null,
        userId: parent.user_id ? String(parent.user_id) : null,
        fullName: parent.full_name ?? null,
        phone: parent.phone ?? null,
        cpf: parent.cpf ?? null,
        phoneSecondary: parent.phone_secondary ?? null,
        zipCode: parent.zip_code ?? null,
        street: parent.street ?? null,
        streetNumber: parent.street_number ?? null,
        addressComplement: parent.address_complement ?? null,
        neighborhood: parent.neighborhood ?? null,
        city: parent.city ?? null,
        state: parent.state ?? null,
        photoUrl: parent.photo_url ?? null,
        firstLoginCompleted: !!parent.first_login_completed,
        profileUpdatedAt: parent.profile_updated_at ?? parent.created_at ?? null,
        addressText: buildAddressText(parent),
      };
    });
  }

  return {
    ok: true as const,
    payload: {
      ok: true,
      student: {
        id: String(student.id),
        schoolId: String(student.school_id),
        fullName: student.full_name ?? null,
        birthDate: student.birth_date ?? null,
        registrationNumber: student.registration_number ?? null,
        legacyClassId: student.class_id ?? null,
        createdAt: student.created_at ?? null,

        studentPhotoUrl: student.student_photo_url ?? null,
        photoUrl: student.student_photo_url ?? null,
        studentPhotoUploadedAt: student.student_photo_uploaded_at ?? null,
        studentPhotoUploadedBy: student.student_photo_uploaded_by ?? null,
        studentProfileUpdatedAt:
          student.student_profile_updated_at ?? student.created_at ?? null,

        gender: student.gender ?? null,
        cpf: student.cpf ?? null,
        rg: student.rg ?? null,
        birthCertificate: student.birth_certificate ?? null,
        motherName: student.mother_name ?? null,
        fatherName: student.father_name ?? null,
        medicalNotes: student.medical_notes ?? null,
        allergies: student.allergies ?? null,
        continuousMedication: student.continuous_medication ?? null,
        foodRestrictions: student.food_restrictions ?? null,
        emergencyContactName: student.emergency_contact_name ?? null,
        emergencyContactPhone: student.emergency_contact_phone ?? null,
        authorizedPickupNotes: student.authorized_pickup_notes ?? null,
        generalNotes: student.general_notes ?? null,
      },
      activeClass,
      parents,
    },
  };
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
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const studentId = String(params?.id || "").trim();

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    const profile = await getStudentProfile(studentId, guard.schoolId);

    if (!profile.ok) return profile.response;

    return NextResponse.json(profile.payload);
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar ficha do aluno.", 500);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await context.params;
    const studentId = String(params?.id || "").trim();

    if (!studentId) {
      return jsonError("studentId é obrigatório.", 400);
    }

    let body: any = null;

    try {
      body = await req.json();
    } catch {
      return jsonError("JSON inválido.", 400);
    }

    const payload = {
      gender: normalizeNullableText(body?.gender),
      cpf: normalizeNullableText(body?.cpf),
      rg: normalizeNullableText(body?.rg),
      birth_certificate: normalizeNullableText(body?.birthCertificate),
      mother_name: normalizeNullableText(body?.motherName),
      father_name: normalizeNullableText(body?.fatherName),
      medical_notes: normalizeNullableText(body?.medicalNotes),
      allergies: normalizeNullableText(body?.allergies),
      continuous_medication: normalizeNullableText(body?.continuousMedication),
      food_restrictions: normalizeNullableText(body?.foodRestrictions),
      emergency_contact_name: normalizeNullableText(body?.emergencyContactName),
      emergency_contact_phone: normalizeNullableText(body?.emergencyContactPhone),
      authorized_pickup_notes: normalizeNullableText(body?.authorizedPickupNotes),
      general_notes: normalizeNullableText(body?.generalNotes),
      student_profile_updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("students")
      .update(payload)
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .select("id")
      .maybeSingle();

    if (updateErr) {
      return jsonError("Erro ao atualizar dados do aluno: " + updateErr.message, 500);
    }

    if (!updated?.id) {
      return jsonError("Aluno não encontrado para atualização.", 404);
    }

    const profile = await getStudentProfile(studentId, guard.schoolId);

    if (!profile.ok) return profile.response;

    return NextResponse.json({
      ...profile.payload,
      saved: true,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao atualizar ficha do aluno.", 500);
  }
}