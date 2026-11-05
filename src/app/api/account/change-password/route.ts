import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validateNewPassword } from "@/lib/auth/passwordPolicy";
import {
  currentPasswordRequired,
  decodeJwtPayload,
  isRecentEmailProofSession,
  mustChangePassword,
  withMustChangePassword,
} from "@/lib/auth/firstAccess";
import { verifyCurrentPassword } from "@/lib/auth/server";

export const runtime = "nodejs";

// Altera a senha do PRÓPRIO usuário da sessão (o user_id vem só do token validado; o corpo
// nunca escolhe a conta). Exige a senha atual, exceto no primeiro acesso (marca em
// app_metadata) e em sessão recente de link de recuperação/convite.

const NO_STORE = { "Cache-Control": "no-store" };

function jsonOk(body: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...body }, { status: 200, headers: NO_STORE });
}

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status, headers: NO_STORE });
}

function getBearerToken(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function hasEmailProof(token: string) {
  return isRecentEmailProofSession(decodeJwtPayload(token), Math.floor(Date.now() / 1000));
}

// GET: informa à tela se a senha atual será pedida.
export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return jsonError("Sessão não encontrada. Faça login novamente.", 401);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return jsonError("Sessão inválida. Faça login novamente.", 401);
  const mustChange = mustChangePassword(data.user);
  return jsonOk({
    mustChangePassword: mustChange,
    requiresCurrentPassword: currentPasswordRequired({ mustChange, emailProof: hasEmailProof(token) }),
    email: data.user.email ?? null,
  });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Sessão não encontrada. Faça login novamente.", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Sessão inválida. Faça login novamente.", 401);
    const user = userData.user;

    const body = await req.json().catch(() => null);
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";

    const mustChange = mustChangePassword(user);
    const needsCurrent = currentPasswordRequired({ mustChange, emailProof: hasEmailProof(token) });

    const validationError = validateNewPassword({
      newPassword,
      confirmPassword,
      currentPassword: needsCurrent ? currentPassword : undefined,
    });
    if (validationError) return jsonError(validationError, 400, "INVALID_PASSWORD");

    if (needsCurrent) {
      if (!currentPassword) return jsonError("Informe a senha atual.", 400, "CURRENT_PASSWORD_REQUIRED");
      if (!user.email) return jsonError("Conta sem e-mail: use “Esqueci minha senha”.", 400);
      const valid = await verifyCurrentPassword(user.email, currentPassword);
      if (!valid) return jsonError("Senha atual incorreta.", 400, "CURRENT_PASSWORD_INVALID");
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
      app_metadata: withMustChangePassword(user.app_metadata, false),
    });
    if (updateErr) {
      const weak = /weak|pwned|leaked|characters/i.test(updateErr.message);
      return jsonError(
        weak ? "Senha recusada pelo Auth por ser fraca ou conhecida. Escolha outra." : "Não foi possível alterar a senha.",
        weak ? 400 : 500
      );
    }

    // Encerra as outras sessões (outros aparelhos); mantém a atual.
    await supabaseAdmin.auth.admin.signOut(token, "others").catch(() => undefined);

    return jsonOk({ message: "Senha alterada com sucesso." });
  } catch {
    return jsonError("Erro interno ao alterar senha.", 500);
  }
}
