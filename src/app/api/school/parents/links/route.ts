// src/app/api/school/parents/links/route.ts
// Responsáveis, alunos e vínculos responsável ↔ aluno (student_parents) da escola do usuário.
// Toda leitura e gravação acontece no servidor (chave secreta), com autorização por vínculo
// ATIVO de gestão em school_users (requireStaff). A escola nunca vem do navegador.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";
import { SCHOOL_MANAGEMENT_ROLES } from "@/lib/auth/schoolRoles";
import { isUuid } from "@/lib/enrollment/rules";

export const runtime = "nodejs";

const CAN_MANAGE_PARENT_LINKS = [...SCHOOL_MANAGEMENT_ROLES];

export async function GET(req: Request) {
  const guard = await requireStaff(req, CAN_MANAGE_PARENT_LINKS);
  if (!guard.ok) return guard.res;

  try {
    const [parentsRes, studentsRes, linksRes] = await Promise.all([
      supabaseAdmin
        .from("parents")
        .select("id, school_id, user_id, full_name, phone, photo_url, created_at")
        .eq("school_id", guard.schoolId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("students")
        .select("id, full_name, registration_number, created_at")
        .eq("school_id", guard.schoolId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("student_parents")
        .select("id, parent_id, student_id, is_active, created_at")
        .eq("school_id", guard.schoolId)
        .eq("is_active", true),
    ]);

    if (parentsRes.error) return jsonFail(500, "Erro ao carregar responsáveis.");
    if (studentsRes.error) return jsonFail(500, "Erro ao carregar alunos.");
    if (linksRes.error) return jsonFail(500, "Erro ao carregar vínculos.");

    return jsonOk({
      parents: parentsRes.data || [],
      students: studentsRes.data || [],
      links: linksRes.data || [],
    });
  } catch (err) {
    logRouteError("GET /api/school/parents/links", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Erro interno.");
  }
}

export async function POST(req: Request) {
  const guard = await requireStaff(req, CAN_MANAGE_PARENT_LINKS);
  if (!guard.ok) return guard.res;

  try {
    const { json: body } = await readJsonBody(req);
    const parentId = String(body?.parentId || "").trim();
    const studentId = String(body?.studentId || "").trim();

    if (!isUuid(parentId) || !isUuid(studentId)) {
      return jsonFail(400, "Informe o responsável e o aluno.");
    }

    // Responsável e aluno precisam pertencer à escola de quem pede.
    const [{ data: parent, error: parentErr }, { data: student, error: studentErr }] = await Promise.all([
      supabaseAdmin.from("parents").select("id").eq("id", parentId).eq("school_id", guard.schoolId).maybeSingle(),
      supabaseAdmin.from("students").select("id").eq("id", studentId).eq("school_id", guard.schoolId).maybeSingle(),
    ]);

    if (parentErr || studentErr) return jsonFail(500, "Erro ao validar responsável ou aluno.");
    if (!parent || !student) return jsonFail(403, "Responsável ou aluno não pertence à sua escola.");

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("student_parents")
      .select("id, school_id, is_active")
      .eq("parent_id", parentId)
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    if (existingErr) return jsonFail(500, "Erro ao verificar vínculo existente.");

    if (existing?.id) {
      if (String(existing.school_id) !== guard.schoolId) {
        return jsonFail(409, "Existe um vínculo deste responsável com este aluno em outra escola.");
      }
      const wasActive = existing.is_active === true;
      if (!wasActive) {
        const { error: updErr } = await supabaseAdmin
          .from("student_parents")
          .update({ is_active: true })
          .eq("id", existing.id)
          .eq("school_id", guard.schoolId);
        if (updErr) return jsonFail(500, "Não foi possível reativar o vínculo.");
      }
      return jsonOk({ link: { id: String(existing.id) }, reactivated: !wasActive });
    }

    const { data: created, error: insErr } = await supabaseAdmin
      .from("student_parents")
      .insert({ school_id: guard.schoolId, parent_id: parentId, student_id: studentId, is_active: true })
      .select("id")
      .single();
    if (insErr || !created?.id) return jsonFail(500, "Não foi possível criar o vínculo.");

    return jsonOk({ link: { id: String(created.id) }, reactivated: false });
  } catch (err) {
    logRouteError("POST /api/school/parents/links", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Erro interno.");
  }
}
