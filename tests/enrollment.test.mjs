// Matrícula digital: regras (src/lib/enrollment/rules.ts) e garantias de segurança das rotas.
// Executar com: node --test tests/enrollment.test.mjs — sem banco, sem rede, dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOC_TYPES,
  MAX_DOCUMENT_BYTES,
  buildStoragePath,
  canParentUpload,
  computeStudentUpdate,
  detectFileKind,
  enrollmentProgress,
  isValidCpf,
  parentPendingFields,
  sanitizeFilename,
  studentPendingFields,
  summarizeDocuments,
  validateReview,
  validateUpload,
} from "../src/lib/enrollment/rules.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(REPO, rel), "utf8");

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const EXE = new TextEncoder().encode("MZ\x90\x00 programa");
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const up = (filename, bytes, size = bytes.length) => validateUpload({ filename, bytes, size });

// ---------------------------------------------------------------------------
// Validação de arquivos
// ---------------------------------------------------------------------------
test("aceita PDF, JPG e PNG pelo conteúdo real", () => {
  assert.equal(up("certidao.pdf", PDF).ok && up("certidao.pdf", PDF).mime, "application/pdf");
  assert.equal(up("foto.png", PNG).ok && up("foto.png", PNG).mime, "image/png");
  assert.equal(up("rg.JPG", JPG).ok && up("rg.JPG", JPG).ext, "jpg");
  assert.equal(up("rg.jpeg", JPG).ok, true);
  assert.equal(detectFileKind(PDF), "pdf");
  assert.equal(detectFileKind(EXE), null);
});

test("recusa extensão não permitida, conteúdo falso e extensão divergente", () => {
  assert.equal(up("virus.exe", EXE).code, "EXTENSAO_NAO_PERMITIDA");
  assert.equal(up("pagina.html", HTML).code, "EXTENSAO_NAO_PERMITIDA");
  assert.equal(up("falso.pdf", EXE).code, "CONTEUDO_NAO_PERMITIDO");
  assert.equal(up("falso.pdf", HTML).code, "CONTEUDO_NAO_PERMITIDO");
  assert.equal(up("imagem.pdf", PNG).code, "EXTENSAO_DIVERGENTE");
  assert.equal(up("documento.png", PDF).code, "EXTENSAO_DIVERGENTE");
  assert.equal(up("sem-extensao", PDF).code, "EXTENSAO_NAO_PERMITIDA");
});

test("recusa arquivo vazio e acima de 10 MB", () => {
  assert.equal(up("vazio.pdf", new Uint8Array()).code, "ARQUIVO_VAZIO");
  assert.equal(up("grande.pdf", PDF, MAX_DOCUMENT_BYTES + 1).code, "ARQUIVO_GRANDE");
  const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
  big.set(PDF);
  assert.equal(up("grande.pdf", big, 10).code, "ARQUIVO_GRANDE", "tamanho real prevalece sobre o declarado");
});

test("recusa PDF com conteúdo ativo (JavaScript, ações automáticas, anexos)", () => {
  for (const marker of ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/OpenAction", "/AA"]) {
    const bytes = new TextEncoder().encode(`%PDF-1.7\n<< ${marker} (x) >>\n%%EOF`);
    assert.equal(up("ativo.pdf", bytes).code, "PDF_COM_CONTEUDO_ATIVO", marker);
  }
});

test("nome de arquivo é higienizado (sem caminhos nem caracteres especiais)", () => {
  assert.equal(sanitizeFilename("../../etc/passwd.pdf"), "passwd.pdf");
  assert.equal(sanitizeFilename("C:\\Users\\x\\Certidão Nº 1.pdf"), "Certidao_N_1.pdf");
  assert.equal(sanitizeFilename(".htaccess"), "htaccess");
  assert.equal(sanitizeFilename(""), "documento");
});

test("caminho no Storage é derivado de ids do servidor e não do nome enviado", () => {
  const ids = { schoolId: "aaaaaaaa-0000-4000-8000-00000000000a", studentId: "bbbbbbbb-0000-4000-8000-00000000000b", documentId: "cccccccc-0000-4000-8000-00000000000c" };
  assert.equal(buildStoragePath({ ...ids, docType: "birth_certificate", ext: "pdf" }), `${ids.schoolId}/${ids.studentId}/birth_certificate/${ids.documentId}.pdf`);
  assert.throws(() => buildStoragePath({ ...ids, schoolId: "../outra", docType: "birth_certificate", ext: "pdf" }));
  assert.throws(() => buildStoragePath({ ...ids, docType: "../../x", ext: "pdf" }));
  assert.throws(() => buildStoragePath({ ...ids, docType: "birth_certificate", ext: "p/df" }));
});

// ---------------------------------------------------------------------------
// Fluxo dos documentos
// ---------------------------------------------------------------------------
test("reenvio: permitido sem documento, pendente ou rejeitado; bloqueado se aprovado", () => {
  assert.equal(canParentUpload(null), true);
  assert.equal(canParentUpload("pending"), true);
  assert.equal(canParentUpload("rejected"), true);
  assert.equal(canParentUpload("approved"), false);
});

test("análise: só documento pendente; rejeição exige motivo", () => {
  assert.deepEqual(validateReview("pending", { decision: "approve" }), { ok: true, status: "approved", reason: null });
  assert.equal(validateReview("pending", { decision: "reject", reason: "ilegível" }).status, "rejected");
  assert.equal(validateReview("pending", { decision: "reject" }).ok, false);
  assert.equal(validateReview("pending", { decision: "reject", reason: "  ab " }).ok, false);
  assert.equal(validateReview("pending", { decision: "reject", reason: "x".repeat(1001) }).ok, false);
  assert.equal(validateReview("approved", { decision: "reject", reason: "mudou de ideia" }).ok, false);
  assert.equal(validateReview("pending", { decision: "delete" }).ok, false);
});

test("resumo usa a versão mais recente e ignora substituídas; motivo só quando rejeitado", () => {
  const s = summarizeDocuments([
    { id: "1", doc_type: "birth_certificate", status: "superseded", uploaded_at: "2026-10-01" },
    { id: "2", doc_type: "birth_certificate", status: "rejected", rejection_reason: "ilegível", uploaded_at: "2026-10-02" },
    { id: "3", doc_type: "guardian_id", status: "approved", uploaded_at: "2026-10-03" },
  ]);
  assert.equal(s.length, DOC_TYPES.length);
  const cert = s.find((x) => x.docType === "birth_certificate");
  assert.equal(cert.status, "rejected");
  assert.equal(cert.documentId, "2");
  assert.equal(cert.rejectionReason, "ilegível");
  assert.equal(s.find((x) => x.docType === "guardian_id").rejectionReason, null);
  assert.equal(s.find((x) => x.docType === "proof_of_address").status, "missing");
  assert.equal(s.find((x) => x.docType === "school_transcript").required, false);
});

test("progresso: pendências contam dados faltando e documentos a enviar, sem dupla contagem", () => {
  const docs = summarizeDocuments([
    { id: "1", doc_type: "birth_certificate", status: "rejected", rejection_reason: "x", uploaded_at: "1" },
    { id: "2", doc_type: "guardian_id", status: "pending", uploaded_at: "1" },
  ]);
  const p = enrollmentProgress({ parentPending: ["CEP"], studentPending: [], docs });
  // CEP + certidão rejeitada + comprovante ausente (identidade em análise não conta)
  assert.equal(p.pendingCount, 3);
  assert.equal(p.complete, false);
  const all = summarizeDocuments(["birth_certificate", "guardian_id", "proof_of_address"].map((t, i) => ({ id: String(i), doc_type: t, status: "approved", uploaded_at: "1" })));
  assert.equal(enrollmentProgress({ parentPending: [], studentPending: [], docs: all }).complete, true);
});

// ---------------------------------------------------------------------------
// Dados do aluno
// ---------------------------------------------------------------------------
test("responsável altera campos permitidos; campos desconhecidos e de sistema são ignorados", () => {
  const r = computeStudentUpdate({}, { allergies: "amendoim", fullName: "Outro Nome", school_id: "x", class_id: "y", registrationNumber: "999" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { allergies: "amendoim" });
  assert.deepEqual(r.ignored.sort(), ["class_id", "fullName", "registrationNumber", "school_id"]);
});

test("identidade já informada pela escola não é sobrescrita nem apagada; vazia pode ser preenchida", () => {
  const current = { cpf: "52998224725", mother_name: "Maria", birth_date: null };
  const r = computeStudentUpdate(current, { cpf: "11144477735", motherName: "", birthDate: "2018-05-10" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { birth_date: "2018-05-10" });
  assert.ok(r.ignored.includes("cpf"));
  // Campo de identidade vazio enviado em branco não grava null
  assert.deepEqual(computeStudentUpdate({ rg: null }, { rg: "" }).payload, {});
});

test("validações: data, CPF, telefone, sexo e tamanho máximo", () => {
  assert.equal(computeStudentUpdate({}, { birthDate: "2030-01-01" }).ok, false);
  assert.equal(computeStudentUpdate({}, { birthDate: "2019-02-30" }).ok, false);
  assert.equal(computeStudentUpdate({}, { cpf: "111.111.111-11" }).ok, false);
  assert.deepEqual(computeStudentUpdate({}, { cpf: "529.982.247-25" }).payload, { cpf: "52998224725" });
  assert.equal(computeStudentUpdate({}, { emergencyContactPhone: "123" }).ok, false);
  assert.equal(computeStudentUpdate({}, { emergencyContactPhone: "(11) 98888-7777" }).ok, true);
  assert.equal(computeStudentUpdate({}, { gender: "x" }).ok, false);
  assert.equal(computeStudentUpdate({}, { allergies: "a".repeat(1001) }).ok, false);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("00000000000"), false);
});

test("pendências do responsável e do aluno", () => {
  assert.deepEqual(parentPendingFields({ cpf: "1", zip_code: "", street: "Rua", street_number: "1", neighborhood: "B", city: "C", state: "SP" }), ["CEP"]);
  assert.deepEqual(studentPendingFields({ birth_date: "2018-01-01", emergency_contact_name: "", emergency_contact_phone: null }), ["Contato de emergência", "Telefone de emergência"]);
});

// ---------------------------------------------------------------------------
// Segurança das rotas e da migração (estático)
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const enrollmentFiles = [
  ...walk(path.join(REPO, "src/app/api/parent/enrollment")),
  ...walk(path.join(REPO, "src/app/api/school/enrollment-documents")),
  path.join(REPO, "src/lib/enrollment/server.ts"),
].map((f) => path.relative(REPO, f).split(path.sep).join("/"));
const clientFiles = ["src/app/parent/matricula/page.tsx", "src/app/school/documentos/page.tsx", "src/components/parent/EnrollmentPendingBanner.tsx"];

test("rotas do responsável exigem vínculo verificado no servidor", () => {
  for (const rel of enrollmentFiles.filter((f) => f.includes("api/parent/enrollment"))) {
    const src = read(rel);
    assert.match(src, /requireParentForStudent|getSessionUserId/, `${rel} sem autenticação`);
  }
  const server = read("src/lib/enrollment/server.ts");
  assert.match(server, /\.eq\("is_active", true\)/, "vínculo precisa estar ativo");
  assert.match(server, /bySchool\.get\(String\(r\.parent_id\)\) === String\(r\.school_id\)/, "vínculo na mesma escola do cadastro");
  assert.match(server, /\.eq\("school_id", link\.schoolId\)/, "aluno na mesma escola do vínculo");
});

test("rotas da escola exigem requireStaff com papéis administrativos (sem professor) e filtram por school_id", () => {
  for (const rel of enrollmentFiles.filter((f) => f.includes("api/school/enrollment-documents"))) {
    const src = read(rel);
    assert.match(src, /requireStaff\(req, STAFF_DOCUMENT_ROLES\)/, rel);
    assert.match(src, /\.eq\("school_id", guard\.schoolId\)/, `${rel} sem isolamento por escola`);
  }
  const roles = read("src/lib/enrollment/server.ts").match(/STAFF_DOCUMENT_ROLES = \[([^\]]+)\]/)[1];
  assert.doesNotMatch(roles, /professor|teacher|parent|responsavel/);
});

test("Storage privado: somente URL assinada temporária; nunca URL pública", () => {
  for (const rel of [...enrollmentFiles, ...clientFiles]) {
    assert.doesNotMatch(read(rel), /getPublicUrl/, `${rel} gera URL pública`);
  }
  assert.match(read("src/lib/enrollment/server.ts"), /createSignedUrl\(storagePath, SIGNED_URL_SECONDS\)/);
  assert.match(read("src/lib/enrollment/rules.ts"), /SIGNED_URL_SECONDS = 300/);
});

test("navegador não acessa banco/Storage diretamente nem conhece a chave de serviço", () => {
  for (const rel of clientFiles) {
    const src = read(rel);
    assert.doesNotMatch(src, /\.from\(["'`]|\.storage\b|SERVICE_ROLE|supabaseAdmin/, rel);
  }
});

test("migração: bucket privado, RLS ligada, sem acesso anon/authenticated, histórico protegido, sem destruição", () => {
  const sql = read("supabase/migrations/20261029120000_enrollment_documents.sql");
  const body = sql.replace(/--.*$/gm, "").toLowerCase();
  assert.match(body, /'enrollment-documents', 'enrollment-documents', false/);
  assert.match(body, /alter table public\.enrollment_documents enable row level security/);
  assert.match(body, /revoke all on table public\.enrollment_documents from public, anon, authenticated, service_role/);
  assert.match(body, /grant select, insert, update on table public\.enrollment_documents to service_role/);
  assert.doesNotMatch(body, /grant[^;]*\bto (anon|authenticated)\b/);
  // A única política criada é RESTRICTIVE, só para o bucket de matrícula, negando anon/authenticated.
  const policies = body.match(/create policy[\s\S]*?;/g) || [];
  assert.equal(policies.length, 1);
  assert.match(policies[0], /on storage\.objects\s+as restrictive\s+for all\s+to anon, authenticated/);
  assert.match(policies[0], /using \(bucket_id <> 'enrollment-documents'\)\s+with check \(bucket_id <> 'enrollment-documents'\)/);
  assert.doesNotMatch(body, /create policy[^;]*as permissive/);
  assert.doesNotMatch(body, /\bdrop\b|\bdelete from\b|^\s*truncate\b/m);
  assert.match(body, /before delete on public\.enrollment_documents/);
  assert.match(body, /before truncate on public\.enrollment_documents/);
  assert.match(body, /where status in \('pending', 'approved'\)/, "um documento ativo por aluno e tipo");
});

test("migração não altera tabelas existentes nem a migração financeira validada", () => {
  const body = read("supabase/migrations/20261029120000_enrollment_documents.sql").replace(/--.*$/gm, "").toLowerCase();
  assert.doesNotMatch(body, /alter table public\.(students|parents|schools|school_users|student_parents)/);
  assert.doesNotMatch(body, /update public\.(students|parents|schools)/);
});
