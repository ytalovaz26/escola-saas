// src/app/api/school/students/[id]/profile/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
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

    const schoolId = guard.schoolId;

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
      return jsonError("Erro ao buscar turma ativa: " + activeLinkErr.message, 500);
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
        return jsonError("Erro ao buscar dados da turma: " + classErr.message, 500);
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
      return jsonError("Erro ao buscar vínculos com responsáveis: " + linksErr.message, 500);
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
        return jsonError("Erro ao buscar responsáveis: " + parentsErr.message, 500);
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

    return NextResponse.json({
      ok: true,
      student: {
        id: String(student.id),
        schoolId: String(student.school_id),
        fullName: student.full_name ?? null,
        birthDate: student.birth_date ?? null,
        registrationNumber: student.registration_number ?? null,
        legacyClassId: student.class_id ?? null,
        createdAt: student.created_at ?? null,

        // Mantém compatibilidade visual sem quebrar enquanto a coluna oficial não existe no banco atual.
        studentPhotoUrl: null,
        studentProfileUpdatedAt: null,
      },
      activeClass,
      parents,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao carregar ficha do aluno.", 500);
  }
}