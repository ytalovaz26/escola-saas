// Primeiro acesso e sessão de recuperação. Módulo puro, testado em
// tests/access-passwords.test.mjs.
//
// A marca "must_change_password" fica em app_metadata do Supabase Auth: só o servidor
// (chave secreta) grava app_metadata; o próprio usuário não consegue removê-la pelo
// navegador. Nenhuma senha temporária é guardada — o Auth guarda apenas o hash.
// Usuários antigos não têm a marca e não são afetados.

export const MUST_CHANGE_PASSWORD_KEY = "must_change_password";
export const FIRST_ACCESS_PATH = "/account/change-password?primeiro-acesso=1";

type UserLike = { app_metadata?: Record<string, unknown> | null } | null | undefined;

export function mustChangePassword(user: UserLike): boolean {
  return user?.app_metadata?.[MUST_CHANGE_PASSWORD_KEY] === true;
}

export function withMustChangePassword(
  appMetadata: Record<string, unknown> | null | undefined,
  value: boolean
): Record<string, unknown> {
  return { ...(appMetadata || {}), [MUST_CHANGE_PASSWORD_KEY]: value };
}

// Lê o payload de um JWT JÁ VALIDADO pelo Auth (supabaseAdmin.auth.getUser). Não valida
// assinatura — nunca use sem a validação prévia.
export function decodeJwtPayload(token: string): Record<string, any> | null {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

// Métodos de autenticação que provam posse do e-mail (link de recuperação ou convite).
const EMAIL_PROOF_METHODS = new Set(["recovery", "invite", "otp", "magiclink"]);
export const EMAIL_PROOF_MAX_AGE_SECONDS = 60 * 60;

// true quando a sessão veio de um link de recuperação/convite recente (claim "amr").
// Nesses casos a senha atual não é exigida para definir a nova.
export function isRecentEmailProofSession(payload: Record<string, any> | null, nowSeconds: number): boolean {
  const amr = Array.isArray(payload?.amr) ? payload!.amr : [];
  return amr.some(
    (entry: any) =>
      EMAIL_PROOF_METHODS.has(String(entry?.method || "")) &&
      Number.isFinite(Number(entry?.timestamp)) &&
      nowSeconds - Number(entry.timestamp) >= -60 &&
      nowSeconds - Number(entry.timestamp) <= EMAIL_PROOF_MAX_AGE_SECONDS
  );
}

// Decide se a troca de senha exige a senha atual.
export function currentPasswordRequired(input: { mustChange: boolean; emailProof: boolean }): boolean {
  return !input.mustChange && !input.emailProof;
}
