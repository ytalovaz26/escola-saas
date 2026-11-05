// Ficha do aluno: sincronização entre o que o responsável preenche (painel de matrícula) e o
// que a escola edita (ficha completa). Módulo puro, testado em
// tests/school-students-update.test.mjs.
//
// Fonte única dos dados: as MESMAS linhas de `students` (dados do aluno) e `parents`
// (dados do responsável, via `student_parents`). Não há cópia nem duplicidade; o que muda é
// QUEM pode gravar cada campo:
//   - responsável: lib/enrollment/rules → STUDENT_FIELDS (identidade só se vazia) e
//     POST /api/parent/profile (cadastro do próprio responsável);
//   - escola: os campos abaixo, enviando SOMENTE os alterados e com conferência de versão
//     (student_profile_updated_at), para não apagar o que o responsável acabou de enviar.

export const STAFF_STUDENT_FIELDS = [
  { key: "gender", column: "gender", max: 20 },
  { key: "cpf", column: "cpf", max: 14 },
  { key: "rg", column: "rg", max: 30 },
  { key: "birthCertificate", column: "birth_certificate", max: 60 },
  { key: "motherName", column: "mother_name", max: 150 },
  { key: "fatherName", column: "father_name", max: 150 },
  { key: "medicalNotes", column: "medical_notes", max: 2000 },
  { key: "allergies", column: "allergies", max: 1000 },
  { key: "continuousMedication", column: "continuous_medication", max: 1000 },
  { key: "foodRestrictions", column: "food_restrictions", max: 1000 },
  { key: "emergencyContactName", column: "emergency_contact_name", max: 150 },
  { key: "emergencyContactPhone", column: "emergency_contact_phone", max: 20 },
  { key: "authorizedPickupNotes", column: "authorized_pickup_notes", max: 1000 },
  { key: "generalNotes", column: "general_notes", max: 2000 },
] as const;

export type StaffStudentKey = (typeof STAFF_STUDENT_FIELDS)[number]["key"];

function clean(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

// Somente as chaves PRESENTES no pedido são gravadas; campos ausentes ficam como estão.
export function computeStaffStudentUpdate(
  input: Record<string, unknown>
): { ok: true; payload: Record<string, string | null> } | { ok: false; error: string } {
  const payload: Record<string, string | null> = {};
  for (const f of STAFF_STUDENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, f.key)) continue;
    const value = clean(input[f.key]);
    if (value && value.length > f.max) return { ok: false, error: `O campo excede ${f.max} caracteres.` };
    payload[f.column] = value;
  }
  return { ok: true, payload };
}

// A ficha só é gravada se ninguém (por exemplo, o responsável) alterou o aluno depois que
// ela foi aberta. Sem versão informada (telas antigas), mantém o comportamento anterior.
export function isStaleProfile(current: unknown, expected: unknown, expectedProvided: boolean): boolean {
  if (!expectedProvided) return false;
  return String(current ?? "") !== String(expected ?? "");
}

// Na tela: envia só o que a pessoa alterou em relação à ficha carregada.
export function changedStaffFields(
  original: Record<string, unknown>,
  edited: Record<string, unknown>
): Partial<Record<StaffStudentKey, string>> {
  const out: Partial<Record<StaffStudentKey, string>> = {};
  for (const f of STAFF_STUDENT_FIELDS) {
    const before = String(original[f.key] ?? "").trim();
    const after = String(edited[f.key] ?? "").trim();
    if (before !== after) out[f.key] = after;
  }
  return out;
}
