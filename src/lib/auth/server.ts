// Funções de servidor para senhas, primeiro acesso e contas criadas pela escola.
// Usa a chave secreta (supabaseAdmin) — nunca importar em componentes do navegador.
import { createClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mustChangePassword, withMustChangePassword } from "@/lib/auth/firstAccess";
import type { ExistingAccountLinks } from "@/lib/auth/schoolRoles";

export function passwordChangeRequiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      error: "Defina sua senha pessoal antes de continuar.",
    },
    { status: 403 }
  );
}

// Marca bloqueante dos helpers requireStaff/requireTeacher/requireParent.
export function blockedByFirstAccess(user: User | null | undefined) {
  return mustChangePassword(user) ? passwordChangeRequiredResponse() : null;
}

export async function setMustChangePassword(userId: string, value: boolean) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new Error(error?.message || "Usuário não encontrado.");
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: withMustChangePassword(data.user.app_metadata, value),
  });
  if (updErr) throw new Error(updErr.message);
}

export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("listUsers failed: " + error.message);
    const users = data?.users || [];
    const found = users.find((u) => String(u.email || "").trim().toLowerCase() === target);
    if (found) return found;
    if (users.length < perPage) return null;
  }
  throw new Error("Não foi possível concluir a busca de usuários.");
}

export async function getExistingAccountLinks(userId: string): Promise<ExistingAccountLinks> {
  const [pa, su, pr] = await Promise.all([
    supabaseAdmin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("school_users").select("school_id").eq("user_id", userId),
    supabaseAdmin.from("parents").select("school_id").eq("user_id", userId),
  ]);
  if (pa.error || su.error || pr.error) {
    throw new Error("Falha ao verificar vínculos da conta existente.");
  }
  return {
    isPlatformAdmin: !!pa.data?.user_id,
    staffSchoolIds: (su.data || []).map((r: any) => String(r.school_id)).filter(Boolean),
    parentSchoolIds: (pr.data || []).map((r: any) => String(r.school_id)).filter(Boolean),
  };
}

export const EXISTING_ACCOUNT_CONFLICT_MESSAGE =
  "Este e-mail já tem acesso ao Minha Escola por outra escola ou outro perfil. " +
  "Por segurança, a conta não foi alterada. Use outro e-mail ou contate o suporte.";

// Confere a senha atual sem alterar a sessão do usuário: abre uma sessão temporária com a
// chave pública e a encerra em seguida.
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Configuração do Supabase ausente.");
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, "local").catch(() => undefined);
  return true;
}
