// Regras de senha do Minha Escola. Módulo puro (sem servidor/navegador) — usado pelas
// telas e pelas rotas, e testado em tests/access-passwords.test.mjs.
// A senha nunca é cortada (trim): espaços fazem parte dela.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // limite do bcrypt usado pelo Supabase Auth

export function validateNewPassword(input: {
  newPassword: unknown;
  confirmPassword: unknown;
  currentPassword?: unknown;
}): string | null {
  const pw = typeof input.newPassword === "string" ? input.newPassword : "";
  const confirm = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  if (!pw) return "Informe a nova senha.";
  if (pw.length < PASSWORD_MIN) return `A nova senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (pw.length > PASSWORD_MAX) return `A nova senha precisa ter no máximo ${PASSWORD_MAX} caracteres.`;
  if (pw.trim() !== pw) return "A nova senha não pode começar nem terminar com espaço.";
  if (!/\p{L}/u.test(pw)) return "A nova senha precisa conter pelo menos uma letra.";
  if (!/[0-9]/.test(pw)) return "A nova senha precisa conter pelo menos um número.";
  if (pw !== confirm) return "A confirmação de senha não confere.";
  if (typeof input.currentPassword === "string" && input.currentPassword && input.currentPassword === pw) {
    return "A nova senha precisa ser diferente da senha atual.";
  }
  return null;
}

// Senha temporária definida pela direção: mesmas regras de tamanho e composição, sem confirmação.
export function validateTemporaryPassword(value: unknown): string | null {
  const pw = typeof value === "string" ? value : "";
  if (!pw) return null; // sem senha temporária = convite por e-mail
  return validateNewPassword({ newPassword: pw, confirmPassword: pw })?.replace("A nova senha", "A senha temporária") ?? null;
}

export function passwordStrength(password: string): { label: string; level: 0 | 1 | 2 | 3 } {
  const v = String(password || "");
  if (!v) return { label: "Aguardando senha", level: 0 };
  let score = 0;
  if (v.length >= PASSWORD_MIN) score++;
  if (/\p{L}/u.test(v) && /[0-9]/.test(v)) score++;
  if (/[^\p{L}0-9]/u.test(v)) score++;
  if (v.length >= 12) score++;
  if (score <= 1) return { label: "Senha fraca", level: 1 };
  if (score <= 3) return { label: "Senha média", level: 2 };
  return { label: "Senha forte", level: 3 };
}
