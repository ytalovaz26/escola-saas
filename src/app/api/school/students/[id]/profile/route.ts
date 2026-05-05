import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function jsonFail(status: number, message: string, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function formatNullable(value: any) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(req: Request, ctx: RouteContext) {
  const guard = await requireStaff(req, [
    "director",
    "coordinator",
    "diretor",
    "coordenador",
  ]);

  if (!guard.ok) return guard.res;

  try {
    const params = await ctx.params;
    const studentId = String(params?.id || "").trim();

    if (!studentId) {
      return jsonFail(422, "studentId is required");
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
          created_at
        `
      )
      .eq("id", studentId)
      .eq("school_id", guard.schoolId)
      .maybeSingle();

    if (studentErr) {
      return jsonFail(500, "Falha ao buscar aluno.", {
        details: studentErr.message,
      });
    }

    if (!student?.id) {
      return jsonFail(404, "Aluno não encontrado.");
    }

    const { data: activeLink, error: activeLinkErr } = await supabaseAdmin
      .from("student_classes")
      .select("id, student_id, class_id, school_id, is_active, started_at, ended_at, created_at")
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeLinkErr) {
      return jsonFail(500, "Falha ao buscar vínculo ativo com turma.", {
        details: activeLinkErr.message,
      });
    }

    let activeClass: any = null;

    if (activeLink?.class_id) {
      const { data: cls, error: clsErr } = await supabaseAdmin
        .from("classes")
        .select("id, school_id, name, grade, shift, created_at")
        .eq("id", activeLink.class_id)
        .eq("school_id", guard.schoolId)
        .maybeSingle();

      if (clsErr) {
        return jsonFail(500, "Falha ao buscar turma atual.", {
          details: clsErr.message,
        });
      }

      activeClass = cls || null;
    }

    const { data: parentLinks, error: linksErr } = await supabaseAdmin
      .from("student_parents")
      .select("id, school_id, parent_id, student_id, is_active, created_at")
      .eq("school_id", guard.schoolId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (linksErr) {
      return jsonFail(500, "Falha ao buscar vínculos com responsáveis.", {
        details: linksErr.message,
      });
    }

    const parentIds = Array.from(
      new Set((parentLinks || []).map((link: any) => String(link.parent_id)).filter(Boolean))
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
        .eq("school_id", guard.schoolId)
        .in("id", parentIds);

      if (parentsErr) {
        return jsonFail(500, "Falha ao buscar dados dos responsáveis.", {
          details: parentsErr.message,
        });
      }

      const linkByParentId = new Map<string, any>();
      for (const link of parentLinks || []) {
        linkByParentId.set(String(link.parent_id), link);
      }

      parents = (parentRows || []).map((parent: any) => {
        const link = linkByParentId.get(String(parent.id));

        const addressParts = [
          formatNullable(parent.street),
          formatNullable(parent.street_number),
          formatNullable(parent.address_complement),
          formatNullable(parent.neighborhood),
          formatNullable(parent.city),
          formatNullable(parent.state),
          formatNullable(parent.zip_code),
        ].filter(Boolean);

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
          addressText: addressParts.length > 0 ? addressParts.join(", ") : null,
        };
      });
    }

    return jsonOk({
      student: {
        id: String(student.id),
        schoolId: String(student.school_id),
        fullName: student.full_name ?? null,
        birthDate: student.birth_date ?? null,
        registrationNumber: student.registration_number ?? null,
        legacyClassId: student.class_id ?? null,
        createdAt: student.created_at ?? null,
      },
      activeClass: activeClass
        ? {
            id: String(activeClass.id),
            name: activeClass.name ?? null,
            grade: activeClass.grade ?? null,
            shift: activeClass.shift ?? null,
            createdAt: activeClass.created_at ?? null,
            link: activeLink
              ? {
                  id: String(activeLink.id),
                  startedAt: activeLink.started_at ?? null,
                  endedAt: activeLink.ended_at ?? null,
                  createdAt: activeLink.created_at ?? null,
                  isActive: !!activeLink.is_active,
                }
              : null,
          }
        : null,
      parents,
    });
  } catch (err: any) {
    return jsonFail(500, "Erro interno ao carregar ficha do aluno.", {
      details: err?.message || String(err),
    });
  }
}