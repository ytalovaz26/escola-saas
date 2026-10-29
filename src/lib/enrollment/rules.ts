// src/lib/enrollment/rules.ts
// Matrícula digital: regras puras (sem rede, banco ou dependências), testáveis com
// `node --test`. O acesso a banco e Storage fica em ./server.ts.

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------
export const DOC_TYPES = ["birth_certificate", "guardian_id", "proof_of_address", "school_transcript"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_INFO: Record<DocType, { label: string; required: boolean; hint: string }> = {
  birth_certificate: { label: "Certidão de nascimento", required: true, hint: "Certidão do aluno, legível e completa." },
  guardian_id: { label: "Documento de identidade do responsável", required: true, hint: "RG, CNH ou documento oficial com foto." },
  proof_of_address: { label: "Comprovante de endereço", required: true, hint: "Conta de consumo ou correspondência recente." },
  school_transcript: { label: "Histórico escolar", required: false, hint: "Envie quando a escola solicitar (transferência)." },
};

export const DOC_STATUSES = ["pending", "approved", "rejected", "superseded"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const ENROLLMENT_BUCKET = "enrollment-documents";
export const SIGNED_URL_SECONDS = 300; // 5 minutos

const KINDS = {
  pdf: { mime: "application/pdf", exts: ["pdf"] },
  jpeg: { mime: "image/jpeg", exts: ["jpg", "jpeg"] },
  png: { mime: "image/png", exts: ["png"] },
} as const;
export type FileKind = keyof typeof KINDS;

export function isDocType(value: unknown): value is DocType {
  return typeof value === "string" && (DOC_TYPES as readonly string[]).includes(value);
}

// Tipo real do arquivo pela assinatura binária (não confia no nome nem no navegador).
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

// PDFs com ações automáticas, scripts ou arquivos embutidos são recusados.
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/;

export function sanitizeFilename(name: unknown): string {
  const base = String(name ?? "").split(/[\\/]/).pop() || "";
  const clean = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 120);
  return clean || "documento";
}

export type UploadValidation =
  | { ok: true; kind: FileKind; mime: string; ext: string; filename: string }
  | { ok: false; code: "ARQUIVO_VAZIO" | "ARQUIVO_GRANDE" | "EXTENSAO_NAO_PERMITIDA" | "CONTEUDO_NAO_PERMITIDO" | "EXTENSAO_DIVERGENTE" | "PDF_COM_CONTEUDO_ATIVO"; message: string };

export function validateUpload(input: { filename: unknown; size: number; bytes: Uint8Array }): UploadValidation {
  const filename = sanitizeFilename(input.filename);
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (!input.size || input.bytes.length === 0) return { ok: false, code: "ARQUIVO_VAZIO", message: "O arquivo está vazio." };
  if (input.size > MAX_DOCUMENT_BYTES || input.bytes.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, code: "ARQUIVO_GRANDE", message: "O arquivo ultrapassa 10 MB." };
  }
  const allowedExts: string[] = Object.values(KINDS).flatMap((k) => [...k.exts]);
  if (!allowedExts.includes(ext)) {
    return { ok: false, code: "EXTENSAO_NAO_PERMITIDA", message: "Envie arquivos PDF, JPG ou PNG." };
  }
  const kind = detectFileKind(input.bytes);
  if (!kind) return { ok: false, code: "CONTEUDO_NAO_PERMITIDO", message: "O conteúdo do arquivo não é um PDF, JPG ou PNG válido." };
  if (!(KINDS[kind].exts as readonly string[]).includes(ext)) {
    return { ok: false, code: "EXTENSAO_DIVERGENTE", message: "A extensão do arquivo não corresponde ao conteúdo." };
  }
  if (kind === "pdf") {
    const text = new TextDecoder("latin1").decode(input.bytes);
    if (PDF_ACTIVE_CONTENT.test(text)) {
      return { ok: false, code: "PDF_COM_CONTEUDO_ATIVO", message: "O PDF contém conteúdo ativo (scripts ou anexos) e não pode ser aceito." };
    }
  }
  return { ok: true, kind, mime: KINDS[kind].mime, ext: KINDS[kind].exts[0], filename };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Caminho no bucket privado: escola/aluno/tipo/documento.ext (sem nome original).
export function buildStoragePath(p: { schoolId: string; studentId: string; docType: DocType; documentId: string; ext: string }): string {
  for (const v of [p.schoolId, p.studentId, p.documentId]) {
    if (!isUuid(v)) throw new Error("Identificador inválido para o caminho do documento.");
  }
  if (!isDocType(p.docType) || !/^[a-z]{3,4}$/.test(p.ext)) throw new Error("Tipo ou extensão inválidos.");
  return `${p.schoolId}/${p.studentId}/${p.docType}/${p.documentId}.${p.ext}`;
}

// Reenvio: permitido quando não há documento, quando está pendente (substitui) ou rejeitado.
export function canParentUpload(currentStatus: DocStatus | null): boolean {
  return currentStatus === null || currentStatus === "pending" || currentStatus === "rejected";
}

export type ReviewInput = { decision: unknown; reason?: unknown };
export type ReviewResult =
  | { ok: true; status: "approved" | "rejected"; reason: string | null }
  | { ok: false; message: string };

export function validateReview(currentStatus: DocStatus, input: ReviewInput): ReviewResult {
  if (currentStatus !== "pending") return { ok: false, message: "Somente documentos pendentes podem ser analisados." };
  if (input.decision === "approve") return { ok: true, status: "approved", reason: null };
  if (input.decision === "reject") {
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 5) return { ok: false, message: "Informe o motivo da rejeição (mínimo de 5 caracteres)." };
    if (reason.length > 1000) return { ok: false, message: "O motivo deve ter no máximo 1000 caracteres." };
    return { ok: true, status: "rejected", reason };
  }
  return { ok: false, message: "Decisão inválida." };
}

// Situação de cada tipo de documento a partir do histórico (ignora substituídos).
export type DocSummaryItem = { docType: DocType; label: string; required: boolean; status: DocStatus | "missing"; documentId: string | null; rejectionReason: string | null };

export function summarizeDocuments(
  docs: Array<{ id: string; doc_type: string; status: string; rejection_reason?: string | null; uploaded_at?: string | null }>
): DocSummaryItem[] {
  return DOC_TYPES.map((docType) => {
    const current = docs
      .filter((d) => d.doc_type === docType && d.status !== "superseded")
      .sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")))[0];
    return {
      docType,
      label: DOC_TYPE_INFO[docType].label,
      required: DOC_TYPE_INFO[docType].required,
      status: current ? (current.status as DocStatus) : "missing",
      documentId: current ? String(current.id) : null,
      rejectionReason: current?.status === "rejected" ? current.rejection_reason ?? null : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Dados do aluno editáveis pelo responsável
// ---------------------------------------------------------------------------
// "always": o responsável pode atualizar sempre (saúde, contatos, retirada).
// "fill_if_empty": só pode preencher quando a escola ainda não informou (dados de
//   identidade); depois disso, alteração somente pela secretaria.
// Nome, matrícula, turma, situação e escola NUNCA são alterados pelo responsável.
export type StudentFieldMode = "always" | "fill_if_empty";
export type StudentFieldDef = { key: string; column: string; label: string; mode: StudentFieldMode; max: number; kind?: "date" | "cpf" | "phone" | "gender" };

export const STUDENT_FIELDS: StudentFieldDef[] = [
  { key: "birthDate", column: "birth_date", label: "Data de nascimento", mode: "fill_if_empty", max: 10, kind: "date" },
  { key: "cpf", column: "cpf", label: "CPF do aluno", mode: "fill_if_empty", max: 14, kind: "cpf" },
  { key: "rg", column: "rg", label: "RG do aluno", mode: "fill_if_empty", max: 30 },
  { key: "birthCertificate", column: "birth_certificate", label: "Nº da certidão de nascimento", mode: "fill_if_empty", max: 60 },
  { key: "gender", column: "gender", label: "Sexo", mode: "fill_if_empty", max: 20, kind: "gender" },
  { key: "motherName", column: "mother_name", label: "Nome da mãe", mode: "fill_if_empty", max: 150 },
  { key: "fatherName", column: "father_name", label: "Nome do pai", mode: "fill_if_empty", max: 150 },
  { key: "allergies", column: "allergies", label: "Alergias", mode: "always", max: 1000 },
  { key: "foodRestrictions", column: "food_restrictions", label: "Restrições alimentares", mode: "always", max: 1000 },
  { key: "continuousMedication", column: "continuous_medication", label: "Medicação contínua", mode: "always", max: 1000 },
  { key: "medicalNotes", column: "medical_notes", label: "Observações de saúde", mode: "always", max: 2000 },
  { key: "emergencyContactName", column: "emergency_contact_name", label: "Contato de emergência", mode: "always", max: 150 },
  { key: "emergencyContactPhone", column: "emergency_contact_phone", label: "Telefone de emergência", mode: "always", max: 20, kind: "phone" },
  { key: "authorizedPickupNotes", column: "authorized_pickup_notes", label: "Pessoas autorizadas a buscar", mode: "always", max: 1000 },
];

export const STUDENT_REQUIRED_KEYS = ["birthDate", "emergencyContactName", "emergencyContactPhone"];
export const STUDENT_SELECT_COLUMNS = ["id", "school_id", "full_name", "registration_number", ...STUDENT_FIELDS.map((f) => f.column)];

export function isValidCpf(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const dt = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== value) return false;
  const year = dt.getUTCFullYear();
  return year >= 1990 && dt.getTime() <= Date.now();
}

const isEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

export type StudentUpdateResult =
  | { ok: true; payload: Record<string, string | null>; ignored: string[] }
  | { ok: false; errors: Record<string, string> };

// Calcula o que pode ser gravado. Campos desconhecidos são ignorados; campos de
// identidade já preenchidos pela escola não são sobrescritos.
export function computeStudentUpdate(current: Record<string, unknown>, input: Record<string, unknown>): StudentUpdateResult {
  const payload: Record<string, string | null> = {};
  const ignored: string[] = [];
  const errors: Record<string, string> = {};

  for (const key of Object.keys(input || {})) {
    const def = STUDENT_FIELDS.find((f) => f.key === key);
    if (!def) {
      ignored.push(key);
      continue;
    }
    const raw = input[key];
    const value = isEmpty(raw) ? null : String(raw).trim();

    if (def.mode === "fill_if_empty" && !isEmpty(current[def.column])) {
      if (value !== null && value !== String(current[def.column]).trim()) ignored.push(key);
      continue;
    }
    if (value !== null && value.length > def.max) {
      errors[key] = `${def.label}: máximo de ${def.max} caracteres.`;
      continue;
    }
    if (value !== null && def.kind === "date" && !isValidDate(value)) errors[key] = `${def.label}: data inválida.`;
    else if (value !== null && def.kind === "cpf" && !isValidCpf(value)) errors[key] = `${def.label}: CPF inválido.`;
    else if (value !== null && def.kind === "phone" && !/^\d{10,11}$/.test(value.replace(/\D/g, ""))) errors[key] = `${def.label}: informe DDD e número.`;
    else if (value !== null && def.kind === "gender" && !["feminino", "masculino", "outro"].includes(value.toLowerCase())) errors[key] = `${def.label}: valor inválido.`;
    else if (def.mode === "fill_if_empty" && value === null) continue; // não apaga dado de identidade
    else payload[def.column] = def.kind === "cpf" && value ? value.replace(/\D/g, "") : def.kind === "gender" && value ? value.toLowerCase() : value;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, payload, ignored };
}

export function studentPendingFields(student: Record<string, unknown>): string[] {
  return STUDENT_FIELDS.filter((f) => STUDENT_REQUIRED_KEYS.includes(f.key) && isEmpty(student[f.column])).map((f) => f.label);
}

// Mesmos campos exigidos por POST /api/parent/profile (cadastro do responsável).
export const PARENT_REQUIRED = [
  ["cpf", "CPF"], ["zip_code", "CEP"], ["street", "Rua"], ["street_number", "Número"],
  ["neighborhood", "Bairro"], ["city", "Cidade"], ["state", "Estado"],
] as const;

export function parentPendingFields(parent: Record<string, unknown>): string[] {
  return PARENT_REQUIRED.filter(([col]) => isEmpty(parent[col])).map(([, label]) => label);
}

export function enrollmentProgress(input: { parentPending: string[]; studentPending: string[]; docs: DocSummaryItem[] }) {
  const requiredDocs = input.docs.filter((d) => d.required);
  const docsDone = requiredDocs.filter((d) => d.status === "approved").length;
  // Ação do responsável: obrigatório ausente ou rejeitado; opcional rejeitado.
  const docsToSend = input.docs.filter((d) => (d.required && (d.status === "missing" || d.status === "rejected")) || (!d.required && d.status === "rejected")).length;
  return {
    complete: input.parentPending.length === 0 && input.studentPending.length === 0 && docsDone === requiredDocs.length,
    pendingCount: input.parentPending.length + input.studentPending.length + docsToSend,
    docsApproved: docsDone,
    docsRequired: requiredDocs.length,
  };
}
