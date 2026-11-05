// Papéis de school_users e regras de hierarquia. Módulo puro, testado em
// tests/access-passwords.test.mjs. Nomes reais usados no banco: diretor, coordenador,
// secretaria, professor (e "admin" legado); aceitamos também os equivalentes em inglês.

export type SchoolRole = "diretor" | "coordenador" | "secretaria" | "professor" | "admin" | "unknown";

const ALIASES: Record<string, SchoolRole> = {
  diretor: "diretor",
  director: "diretor",
  coordenador: "coordenador",
  coordinator: "coordenador",
  secretaria: "secretaria",
  secretary: "secretaria",
  professor: "professor",
  teacher: "professor",
  admin: "admin",
};

export function canonicalRole(role: unknown): SchoolRole {
  return ALIASES[String(role ?? "").trim().toLowerCase()] ?? "unknown";
}

// Equipe de gestão: acessa o painel /school (mesmo painel do diretor).
export const SCHOOL_MANAGEMENT_ROLES = ["diretor", "coordenador", "secretaria", "admin"] as const;

export function isSchoolManagementRole(role: unknown): boolean {
  return (SCHOOL_MANAGEMENT_ROLES as readonly string[]).includes(canonicalRole(role));
}

// Papéis que podem ser atribuídos pela tela Equipe Escolar.
export const ASSIGNABLE_ROLES = ["diretor", "coordenador", "secretaria", "professor"] as const;

// Diretor (e "admin" legado da escola) atribui qualquer papel; coordenação e secretaria
// não criam nem promovem diretores. Ninguém atribui papel fora da lista.
export function canAssignRole(requesterRole: unknown, targetRole: unknown): boolean {
  const requester = canonicalRole(requesterRole);
  const target = canonicalRole(targetRole);
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(target)) return false;
  if (requester === "diretor" || requester === "admin") return true;
  if (requester === "coordenador" || requester === "secretaria") return target !== "diretor";
  return false;
}

// Alterar conta já vinculada (papel, senha temporária): só se quem pede pode atribuir
// tanto o papel atual quanto o novo. Ninguém altera o próprio vínculo por essa via.
export function canManageExistingMember(input: {
  requesterRole: unknown;
  requesterUserId: string;
  targetUserId: string;
  currentTargetRole: unknown;
  newTargetRole: unknown;
}): boolean {
  if (input.requesterUserId === input.targetUserId) return false;
  const current = canonicalRole(input.currentTargetRole);
  if (current !== "unknown" && !canAssignRole(input.requesterRole, current)) return false;
  return canAssignRole(input.requesterRole, input.newTargetRole);
}

// Conta de e-mail já existente no Auth: só pode ser reaproveitada se pertence APENAS à
// escola de quem pede. Qualquer vínculo com outra escola, cadastro de responsável em outra
// escola ou Admin Master => recusa (impede tomada de conta entre escolas).
export type ExistingAccountLinks = {
  isPlatformAdmin: boolean;
  staffSchoolIds: string[]; // school_users (ativos ou não)
  parentSchoolIds: string[]; // parents
};

export type ExistingAccountDecision = "allow" | "conflict";

export function decideExistingAccount(
  links: ExistingAccountLinks,
  schoolId: string,
  kind: "staff" | "parent"
): ExistingAccountDecision {
  if (links.isPlatformAdmin) return "conflict";
  const otherStaff = links.staffSchoolIds.some((id) => id !== schoolId);
  const otherParent = links.parentSchoolIds.some((id) => id !== schoolId);
  if (otherStaff || otherParent) return "conflict";
  // Conta sem nenhum vínculo (ex.: cadastro anterior que falhou no meio): pode ser reaproveitada.
  if (links.staffSchoolIds.length === 0 && links.parentSchoolIds.length === 0) return "allow";
  // Caso contrário, só reaproveita quem já tem o mesmo tipo de vínculo nesta escola.
  if (kind === "staff") return links.staffSchoolIds.includes(schoolId) ? "allow" : "conflict";
  return links.parentSchoolIds.includes(schoolId) && links.staffSchoolIds.length === 0 ? "allow" : "conflict";
}
