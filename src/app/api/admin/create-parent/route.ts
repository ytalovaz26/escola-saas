import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decideExistingAccount, isSchoolManagementRole } from "@/lib/auth/schoolRoles";
import { withMustChangePassword } from "@/lib/auth/firstAccess";
import { validateTemporaryPassword } from "@/lib/auth/passwordPolicy";
import {
  blockedByFirstAccess,
  EXISTING_ACCOUNT_CONFLICT_MESSAGE,
  findAuthUserByEmail,
  getExistingAccountLinks,
} from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Cria (ou reaproveita) o acesso de um responsável numa escola.
 *
 * Segurança:
 * - Autorização no servidor: Admin Master, ou gestão ATIVA da própria escola enviada
 *   (diretor, coordenação, secretaria). Só depois disso usa a chave secreta.
 * - E-mail já existente de outra escola, de equipe escolar ou do Admin Master é recusado:
 *   a rota nunca altera a senha de contas de terceiros.
 * - A senha temporária não é guardada; a conta fica marcada para o primeiro acesso.
 */

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return fail("Missing Bearer token", 401);

    const body = await req.json().catch(() => null);
    const schoolId = typeof body?.schoolId === "string" ? body.schoolId.trim() : "";
    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const phone = (typeof body?.phone === "string" ? body.phone : null) ?? null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const passwordTemp = typeof body?.passwordTemp === "string" ? body.passwordTemp : "";

    if (!schoolId) return fail("schoolId é obrigatório", 400);
    if (!fullName) return fail("fullName é obrigatório", 400);
    if (!email) return fail("email é obrigatório", 400);
    if (!passwordTemp) return fail("Informe a senha temporária.", 400);
    const tempError = validateTemporaryPassword(passwordTemp);
    if (tempError) return fail(tempError, 400);

    // 1) valida chamador e escola
    const { data: meData, error: meErr } = await supabaseAdmin.auth.getUser(token);
    if (meErr || !meData?.user) return fail("Token inválido", 401);

    const firstAccess = blockedByFirstAccess(meData.user);
    if (firstAccess) return firstAccess;

    const callerId = meData.user.id;

    const { data: pa, error: paErr } = await supabaseAdmin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();
    if (paErr) return fail("Falha ao verificar permissão.", 500);

    let allowed = !!pa?.user_id;

    if (!allowed) {
      const { data: roleRow, error: roleErr } = await supabaseAdmin
        .from("school_users")
        .select("role")
        .eq("school_id", schoolId)
        .eq("user_id", callerId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (roleErr) return fail("Falha ao verificar permissão.", 500);
      allowed = isSchoolManagementRole(roleRow?.role);
    }

    if (!allowed) return fail("Sem permissão para criar pai nesta escola", 403);

    const { data: school, error: schoolErr } = await supabaseAdmin
      .from("schools")
      .select("id")
      .eq("id", schoolId)
      .maybeSingle();
    if (schoolErr) return fail("Falha ao verificar a escola.", 500);
    if (!school?.id) return fail("Escola não encontrada.", 404);

    // 2) cria ou reaproveita o usuário no Auth (somente contas desta escola)
    let userId: string;
    let createdNew = false;

    const existing = await findAuthUserByEmail(email);

    if (existing?.id) {
      if (existing.id === callerId) return fail("Você não pode alterar o próprio acesso por esta tela.", 400);

      const links = await getExistingAccountLinks(existing.id);
      if (decideExistingAccount(links, schoolId, "parent") === "conflict") {
        return fail(EXISTING_ACCOUNT_CONFLICT_MESSAGE, 409);
      }

      userId = existing.id;

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: passwordTemp,
        email_confirm: true,
        app_metadata: withMustChangePassword(existing.app_metadata, true),
      });
      if (updErr) return fail("Falha ao atualizar o acesso do responsável.", 500);
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: passwordTemp,
        email_confirm: true,
        app_metadata: withMustChangePassword(null, true),
      });
      if (createErr || !created?.user) return fail("Falha ao criar o acesso do responsável.", 500);
      userId = created.user.id;
      createdNew = true;
    }

    // 3) cria/atualiza o cadastro do responsável nesta escola
    const { data: parentExisting, error: parentFindErr } = await supabaseAdmin
      .from("parents")
      .select("id")
      .eq("school_id", schoolId)
      .eq("user_id", userId)
      .maybeSingle();
    if (parentFindErr) return fail(parentFindErr.message, 400);

    let parentId: string;

    if (parentExisting?.id) {
      parentId = parentExisting.id;
      const { error: upErr } = await supabaseAdmin
        .from("parents")
        .update({ full_name: fullName, phone })
        .eq("id", parentId)
        .eq("school_id", schoolId);
      if (upErr) return fail(upErr.message, 400);
    } else {
      const { data: ins, error: insErr } = await supabaseAdmin
        .from("parents")
        .insert({ school_id: schoolId, user_id: userId, full_name: fullName, phone })
        .select("id")
        .single();
      if (insErr || !ins?.id) return fail("Falha insert parents: " + (insErr?.message || ""), 400);
      parentId = ins.id;
    }

    return NextResponse.json({ ok: true, created: createdNew, userId, parentId });
  } catch (e: any) {
    return fail(e?.message || "Erro interno", 500);
  }
}
