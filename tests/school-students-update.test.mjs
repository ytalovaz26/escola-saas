// Documentos por aluno, sincronização da ficha, PDF da ficha e vínculo de responsáveis.
// Executar com: node --test tests/school-students-update.test.mjs — sem banco, sem rede,
// somente dados fictícios.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { randomUUID } from "node:crypto";

register("./helpers/loader.mjs", import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ficticio.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-ficticia";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-secreta-ficticia";

const { state, reset, addUser, issueToken } = await import("./helpers/fakeState.mjs");
const docsRoute = await import("../src/app/api/school/students/[id]/documents/route.ts");
const urlRoute = await import("../src/app/api/school/enrollment-documents/[documentId]/url/route.ts");
const reviewRoute = await import("../src/app/api/school/enrollment-documents/[documentId]/review/route.ts");
const profileRoute = await import("../src/app/api/school/students/[id]/profile/route.ts");
const pdfRoute = await import("../src/app/api/school/students/[id]/profile-pdf/route.ts");
const parentStudentRoute = await import("../src/app/api/parent/enrollment/students/[studentId]/route.ts");
const linksRoute = await import("../src/app/api/school/parents/links/route.ts");
const unlinkRoute = await import("../src/app/api/admin/unlink-student-parent/route.ts");
const { buildStudentDocumentGroups } = await import("../src/lib/enrollment/studentDocuments.ts");
const sync = await import("../src/lib/students/profileSync.ts");
const pdfText = await import("../src/lib/pdf/text.ts");
const { buildStudentProfilePdf } = await import("../src/lib/students/profilePdf.ts");

// ---------------------------------------------------------------------------
// Cenário fictício
// ---------------------------------------------------------------------------
let S;
function seed() {
  reset();
  const A = randomUUID();
  const B = randomUUID();
  state.tables.schools.push({ id: A, name: "Escola Fictícia A" }, { id: B, name: "Escola Fictícia B" });
  const ids = {};
  for (const k of ["diretorA", "coordA", "secA", "profA", "paiA", "paiA2", "diretorB", "paiB"]) {
    ids[k] = addUser({ email: `${k.toLowerCase()}@ficticio.test` });
  }
  const link = (user, school, role) =>
    state.tables.school_users.push({ id: randomUUID(), user_id: user, school_id: school, role, is_active: true, created_at: "2026-01-01" });
  link(ids.diretorA, A, "diretor");
  link(ids.coordA, A, "coordenador");
  link(ids.secA, A, "secretaria");
  link(ids.profA, A, "professor");
  link(ids.diretorB, B, "diretor");

  const alunoA = randomUUID();
  const alunoA2 = randomUUID();
  const alunoB = randomUUID();
  state.tables.students.push(
    { id: alunoA, school_id: A, full_name: "Aluno Fictício A", registration_number: "A-1", cpf: "52998224725", birth_date: null, allergies: null, student_profile_updated_at: null, created_at: "2026-02-01T12:00:00Z" },
    { id: alunoA2, school_id: A, full_name: "Aluna Fictícia A2", registration_number: "A-2", student_profile_updated_at: null, created_at: "2026-02-01T12:00:00Z" },
    { id: alunoB, school_id: B, full_name: "Aluno Fictício B", registration_number: "B-1", student_profile_updated_at: null, created_at: "2026-02-01T12:00:00Z" }
  );
  const paiA = randomUUID();
  const paiA2 = randomUUID();
  const paiB = randomUUID();
  state.tables.parents.push(
    { id: paiA, user_id: ids.paiA, school_id: A, full_name: "Mãe Fictícia A", phone: "11987654321", first_login_completed: true },
    { id: paiA2, user_id: ids.paiA2, school_id: A, full_name: "Pai Fictício A2", phone: null, first_login_completed: false },
    { id: paiB, user_id: ids.paiB, school_id: B, full_name: "Responsável Fictício B", first_login_completed: true }
  );
  state.tables.student_parents.push(
    { id: randomUUID(), school_id: A, student_id: alunoA, parent_id: paiA, is_active: true, created_at: "2026-02-02" },
    { id: randomUUID(), school_id: B, student_id: alunoB, parent_id: paiB, is_active: true, created_at: "2026-02-02" }
  );

  const doc = (school, student, parent, docType, status, uploadedAt, extra = {}) => {
    const id = randomUUID();
    state.tables.enrollment_documents.push({
      id,
      school_id: school,
      student_id: student,
      parent_id: parent,
      uploaded_by: ids.paiA,
      doc_type: docType,
      status,
      original_filename: `${docType}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 2048,
      storage_path: `${school}/${student}/${docType}/${id}.pdf`,
      rejection_reason: null,
      uploaded_at: uploadedAt,
      reviewed_at: null,
      ...extra,
    });
    return id;
  };
  const docs = {
    certidaoAntiga: doc(A, alunoA, paiA, "birth_certificate", "superseded", "2026-03-01T10:00:00Z", { rejection_reason: "Ilegível, reenviar" }),
    certidaoAtual: doc(A, alunoA, paiA, "birth_certificate", "pending", "2026-03-05T10:00:00Z"),
    comprovante: doc(A, alunoA, paiA, "proof_of_address", "approved", "2026-03-02T10:00:00Z"),
    docB: doc(B, alunoB, paiB, "birth_certificate", "pending", "2026-03-05T10:00:00Z"),
  };
  const tok = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, issueToken(v)]));
  S = { A, B, ids, tok, alunoA, alunoA2, alunoB, paiA, paiA2, paiB, docs };
}
beforeEach(seed);

function req(url, token, body, method = body === undefined ? "GET" : "POST") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(handler, args, params) {
  const res = await handler(req(...args), params ? { params: Promise.resolve(params) } : undefined);
  const type = res.headers.get("content-type") || "";
  return { status: res.status, type, json: type.includes("json") ? await res.json() : null, body: type.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : null };
}

// ---------------------------------------------------------------------------
// 1. Documentos na lista de alunos
// ---------------------------------------------------------------------------
test("documentos do aluno: gestão da própria escola vê todas as versões com situação, responsável e data", async () => {
  for (const k of ["diretorA", "coordA", "secA"]) {
    const r = await call(docsRoute.GET, [`/api/school/students/${S.alunoA}/documents`, S.tok[k]], { id: S.alunoA });
    assert.equal(r.status, 200, `${k}: ${JSON.stringify(r.json)}`);
    const cert = r.json.groups.find((g) => g.docType === "birth_certificate");
    assert.equal(cert.status, "pending");
    assert.equal(cert.versions.length, 2, "histórico preservado (versão substituída aparece)");
    assert.equal(cert.versions[0].isCurrent, true);
    assert.equal(cert.versions[0].canReview, true);
    assert.equal(cert.versions[1].status, "superseded");
    assert.equal(cert.versions[1].canReview, false);
    assert.equal(cert.versions[1].rejectionReason, "Ilegível, reenviar");
    assert.equal(cert.versions[0].sentBy, "Mãe Fictícia A");
    assert.equal(cert.versions[0].uploadedAt, "2026-03-05T10:00:00Z");
    assert.equal(r.json.groups.find((g) => g.docType === "guardian_id").status, "missing");
    assert.ok(!JSON.stringify(r.json).includes("storage"), "nenhum caminho/URL de arquivo na listagem");
  }
});

test("documentos do aluno: isolamento por escola e por perfil", async () => {
  const other = await call(docsRoute.GET, [`/api/school/students/${S.alunoB}/documents`, S.tok.secA], { id: S.alunoB });
  assert.equal(other.status, 404, "aluno de outra escola");
  assert.equal((await call(docsRoute.GET, [`/api/school/students/${S.alunoA}/documents`, S.tok.profA], { id: S.alunoA })).status, 403);
  assert.equal((await call(docsRoute.GET, [`/api/school/students/${S.alunoA}/documents`, S.tok.paiA], { id: S.alunoA })).status, 404, "responsável não é equipe");
  assert.equal((await call(docsRoute.GET, [`/api/school/students/${S.alunoA}/documents`, null], { id: S.alunoA })).status, 401);
  assert.equal((await call(docsRoute.GET, [`/api/school/students/nao-e-uuid/documents`, S.tok.secA], { id: "nao-e-uuid" })).status, 404);
});

test("visualizar/baixar: só link temporário (5 min) e só de documento da própria escola", async () => {
  const view = await call(urlRoute.GET, [`/api/school/enrollment-documents/${S.docs.certidaoAntiga}/url`, S.tok.secA], { documentId: S.docs.certidaoAntiga });
  assert.equal(view.status, 200);
  assert.equal(view.json.expiresIn, 300);
  assert.match(view.json.url, /\/object\/sign\/enrollment-documents\//, "URL assinada, nunca /object/public/");
  const dl = await call(urlRoute.GET, [`/api/school/enrollment-documents/${S.docs.comprovante}/url?download=1`, S.tok.coordA], { documentId: S.docs.comprovante });
  assert.equal(dl.status, 200);
  assert.equal(state.signedUrls.at(-1).download, "proof_of_address.pdf");
  assert.equal(state.signedUrls.at(-1).bucket, "enrollment-documents", "mesmo bucket privado da matrícula");
  const cross = await call(urlRoute.GET, [`/api/school/enrollment-documents/${S.docs.docB}/url`, S.tok.diretorA], { documentId: S.docs.docB });
  assert.equal(cross.status, 404, "documento da escola B");
  assert.equal((await call(urlRoute.GET, [`/api/school/enrollment-documents/${S.docs.comprovante}/url`, S.tok.profA], { documentId: S.docs.comprovante })).status, 403);
});

test("aprovação e rejeição pela tela do aluno usam a análise existente (só pendente, motivo obrigatório)", async () => {
  const bad = await call(reviewRoute.POST, [`/x`, S.tok.secA, { decision: "reject", reason: "no" }], { documentId: S.docs.certidaoAtual });
  assert.equal(bad.status, 422);
  const ok = await call(reviewRoute.POST, [`/x`, S.tok.secA, { decision: "reject", reason: "Documento cortado" }], { documentId: S.docs.certidaoAtual });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const row = state.tables.enrollment_documents.find((d) => d.id === S.docs.certidaoAtual);
  assert.equal(row.status, "rejected");
  assert.equal(row.reviewed_by, S.ids.secA);
  const again = await call(reviewRoute.POST, [`/x`, S.tok.diretorA, { decision: "approve" }], { documentId: S.docs.certidaoAtual });
  assert.equal(again.status, 422, "não reanalisa documento já analisado");
  const cross = await call(reviewRoute.POST, [`/x`, S.tok.diretorA, { decision: "approve" }], { documentId: S.docs.docB });
  assert.equal(cross.status, 404);
  assert.equal(state.tables.enrollment_documents.find((d) => d.id === S.docs.docB).status, "pending");
  assert.equal(state.tables.enrollment_documents.length, 4, "nenhum documento criado ou apagado");
});

test("agrupamento puro: versões em ordem, atual marcada, envio pela escola identificado", () => {
  const groups = buildStudentDocumentGroups(
    [
      { id: "1", doc_type: "guardian_id", status: "rejected", parent_id: null, uploaded_at: "2026-01-01", rejection_reason: "Sem foto" },
      { id: "2", doc_type: "guardian_id", status: "superseded", parent_id: "p", uploaded_at: "2025-12-01" },
    ],
    new Map([["p", "Responsável X"]])
  );
  const g = groups.find((x) => x.docType === "guardian_id");
  assert.deepEqual(g.versions.map((v) => v.id), ["1", "2"]);
  assert.equal(g.versions[0].sentBy, "Equipe da escola");
  assert.equal(g.versions[0].canReview, false, "rejeitado não é reanalisado");
  assert.equal(g.versions[1].sentBy, "Responsável X");
  assert.equal(groups.length, 4);
});

// ---------------------------------------------------------------------------
// 2. Sincronização: painel do responsável <-> ficha da escola
// ---------------------------------------------------------------------------
const P = (id) => `/api/school/students/${id}/profile`;

test("o que o responsável preenche aparece na ficha da escola (mesma linha de students/parents)", async () => {
  const r = await call(parentStudentRoute.PATCH, [`/x`, S.tok.paiA, { allergies: "Amendoim", birthDate: "2018-04-09", cpf: "11144477735", emergencyContactName: "Avó Fictícia", emergencyContactPhone: "(11) 91234-5678" }, "PATCH"], { studentId: S.alunoA });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const k of ["diretorA", "coordA", "secA"]) {
    const f = await call(profileRoute.GET, [P(S.alunoA), S.tok[k]], { id: S.alunoA });
    assert.equal(f.status, 200, k);
    assert.equal(f.json.student.allergies, "Amendoim");
    assert.equal(f.json.student.birthDate, "2018-04-09");
    assert.equal(f.json.student.emergencyContactName, "Avó Fictícia");
    assert.equal(f.json.student.cpf, "52998224725", "CPF já informado pela escola não é sobrescrito pelo responsável");
    assert.equal(f.json.parents[0].fullName, "Mãe Fictícia A");
  }
  assert.equal(state.tables.students.length, 3, "nenhum registro duplicado");
});

test("ficha da escola grava só os campos alterados e não apaga o que o responsável enviou", async () => {
  const opened = await call(profileRoute.GET, [P(S.alunoA), S.tok.secA], { id: S.alunoA });
  const version = opened.json.student.profileVersion;
  assert.equal(version, null);

  // O responsável atualiza alergias enquanto a ficha está aberta na secretaria.
  await call(parentStudentRoute.PATCH, [`/x`, S.tok.paiA, { allergies: "Lactose" }, "PATCH"], { studentId: S.alunoA });

  // A secretaria salva com a versão antiga: recusado, nada é sobrescrito.
  const stale = await call(profileRoute.PATCH, [P(S.alunoA), S.tok.secA, { generalNotes: "Observação", allergies: "", expectedProfileVersion: version }, "PATCH"], { id: S.alunoA });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "PROFILE_CHANGED");
  const row = () => state.tables.students.find((s) => s.id === S.alunoA);
  assert.equal(row().allergies, "Lactose");
  assert.equal(row().general_notes, undefined);

  // Recarregou: salva só o campo alterado; alergias do responsável preservadas.
  const fresh = await call(profileRoute.GET, [P(S.alunoA), S.tok.secA], { id: S.alunoA });
  const ok = await call(profileRoute.PATCH, [P(S.alunoA), S.tok.secA, { generalNotes: "Observação", expectedProfileVersion: fresh.json.student.profileVersion }, "PATCH"], { id: S.alunoA });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(row().general_notes, "Observação");
  assert.equal(row().allergies, "Lactose");
  assert.equal(row().full_name, "Aluno Fictício A", "nome não é alterável pela ficha");
});

test("ficha: isolamento e perfis", async () => {
  assert.equal((await call(profileRoute.GET, [P(S.alunoB), S.tok.secA], { id: S.alunoB })).status, 404);
  assert.equal((await call(profileRoute.PATCH, [P(S.alunoB), S.tok.diretorA, { allergies: "X" }, "PATCH"], { id: S.alunoB })).status, 404);
  assert.equal(state.tables.students.find((s) => s.id === S.alunoB).allergies, undefined);
  assert.equal((await call(profileRoute.GET, [P(S.alunoA), S.tok.profA], { id: S.alunoA })).status, 403);
  assert.equal((await call(parentStudentRoute.PATCH, [`/x`, S.tok.paiA, { allergies: "X" }, "PATCH"], { studentId: S.alunoA2 })).status, 403, "responsável sem vínculo com o aluno");
});

test("regras puras de sincronização", () => {
  assert.deepEqual(sync.computeStaffStudentUpdate({ allergies: " Pólen ", unknownField: "x", full_name: "Hacker" }), { ok: true, payload: { allergies: "Pólen" } });
  assert.deepEqual(sync.computeStaffStudentUpdate({ generalNotes: "" }), { ok: true, payload: { general_notes: null } });
  assert.equal(sync.computeStaffStudentUpdate({ cpf: "1".repeat(20) }).ok, false);
  assert.deepEqual(sync.changedStaffFields({ allergies: "A", rg: "1" }, { allergies: "A", rg: "2" }), { rg: "2" });
  assert.equal(sync.isStaleProfile("2026-01-01", "2026-01-01", true), false);
  assert.equal(sync.isStaleProfile("2026-01-02", "2026-01-01", true), true);
  assert.equal(sync.isStaleProfile("x", "y", false), false);
});

// ---------------------------------------------------------------------------
// 3. PDF da ficha
// ---------------------------------------------------------------------------
// Decodificação WinAnsi (Windows-1252) feita à mão: o TextDecoder do Node trata 0x80–0x9F
// como Latin-1, o que trocaria aspas e travessões.
const CP1252 = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };
const decode1252 = (hex) => Array.from(Buffer.from(hex, "hex"), (b) => CP1252[b] ?? String.fromCharCode(b)).join("");
function pdfStrings(buf) {
  const s = buf.toString("latin1");
  return [...s.matchAll(/\[((?:<[0-9a-f]*>|[-\d. ]+)+)\] TJ/g)].map((m) =>
    [...m[1].matchAll(/<([0-9a-f]*)>/g)].map((h) => decode1252(h[1])).join("")
  );
}

const LONG = "Paciente com alergia severa a amendoim, castanhas e derivados; manter adrenalina autoinjetável na mochila. ".repeat(9) + "FIM-DO-TEXTO-ALERGIAS";
function pdfData(overrides = {}) {
  return {
    schoolName: "Escola Municipal de Educação Infantil e Ensino Fundamental Professora Maria José da Conceição Albuquerque",
    schoolLogo: Buffer.from("não é uma imagem"),
    studentPhoto: null,
    student: {
      full_name: "Maria Eduarda Conceição de Albuquerque Gonçalves Vasconcelos Bittencourt Fictícia",
      registration_number: "2026-000123",
      birth_date: "2018-04-09",
      gender: "feminino",
      cpf: "52998224725",
      rg: "",
      birth_certificate: null,
      mother_name: "Ana Lúcia Conceição de Albuquerque Gonçalves Vasconcelos",
      father_name: "  ",
      medical_notes: "Asma leve.\nUsa bombinha em crises.",
      allergies: LONG,
      continuous_medication: "Nenhuma 💊",
      food_restrictions: "Sem lactose → leite vegetal",
      emergency_contact_name: "Avó Fictícia",
      emergency_contact_phone: "+55 (11) 98765-4321",
      authorized_pickup_notes: "Avó, tio João e a van escolar “Tia Cida”.",
      general_notes: null,
      student_profile_updated_at: "2026-03-10T02:30:00Z",
      created_at: "2026-02-01T12:00:00Z",
    },
    activeClass: { name: "Infantil V - Turma Girassol", grade: "Pré-escola", shift: "Manhã" },
    activeLinkStartedAt: "2026-02-03",
    parents: Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`,
      full_name: `Responsável Fictício Número ${i + 1} com Nome Muito Extenso para Testar a Quebra de Linha Correta`,
      phone: "1134567890",
      cpf: "11144477735",
      phone_secondary: i === 0 ? null : "21987654321",
      zip_code: "01310100",
      street: "Avenida Paulista de Teste com Nome de Logradouro Extremamente Longo para Validação",
      street_number: "1578",
      address_complement: "Bloco B, apartamento 1203, entrada pela rua lateral ao lado da padaria",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      first_login_completed: i % 2 === 0,
      relationship: i === 0 ? "Mãe" : null,
    })),
    issuedAt: new Date("2026-03-10T15:45:00Z"),
    ...overrides,
  };
}

test("PDF: textos longos completos, acentuação, datas/telefones/CPF/CEP brasileiros e campos vazios", async () => {
  let pages = 0;
  const buf = await buildStudentProfilePdf(pdfData(), { compress: false, onPages: (n) => (pages = n) });
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  const strings = pdfStrings(buf);
  // Linhas quebradas pelo PDF são reunidas com espaço para procurar trechos completos.
  const all = strings.join(" ").replace(/\s+/g, " ");
  assert.ok(all.includes("FIM-DO-TEXTO-ALERGIAS"), "alergia longa sem corte");
  assert.ok(all.includes("Bittencourt Fictícia"), "nome longo completo (acentos preservados)");
  assert.ok(all.includes("Conceição"));
  assert.ok(all.includes("09/04/2018"), "data de nascimento dd/mm/aaaa");
  assert.ok(all.includes("10/03/2026 12:45"), "emissão no horário de Brasília (15:45 UTC = 12:45)");
  assert.ok(all.includes("09/03/2026 23:30"), "atualização convertida para Brasília");
  assert.ok(all.includes("(11) 98765-4321"), "telefone com DDI normalizado");
  assert.ok(all.includes("(11) 3456-7890"), "telefone fixo");
  assert.ok(all.includes("529.982.247-25"), "CPF do aluno");
  assert.ok(all.includes("CEP 01310-100"), "CEP formatado no endereço");
  assert.ok(all.includes("entrada pela rua lateral"), "complemento do endereço completo");
  assert.ok(all.includes("Não informado"), "campos vazios explícitos");
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(all), "emoji removido (sem glifo na fonte)");
  assert.ok(all.includes("Sem lactose -> leite vegetal"));
  assert.ok(all.includes("“Tia Cida”"), "aspas tipográficas suportadas");
  assert.ok(pages >= 2, "quebra de página com 4 responsáveis");
  assert.ok(all.includes(`Página 1 de ${pages}`) && all.includes(`Página ${pages} de ${pages}`));
  assert.ok(all.includes("Responsável Fictício Número 4"), "todos os responsáveis presentes");
});

test("PDF: tudo dentro das margens, abaixo do cabeçalho, acima do rodapé e sem sobreposição", async () => {
  const boxes = [];
  await buildStudentProfilePdf(pdfData(), { compress: false, onBox: (b) => boxes.push(b) });
  const W = 595.28;
  const H = 841.89;
  for (const b of boxes) {
    assert.ok(b.x >= 34 - 0.01 && b.x + b.w <= W - 34 + 0.01, `margem lateral: ${b.label}`);
    assert.ok(b.y >= 104 - 0.01, `abaixo do cabeçalho: ${b.label}`);
    assert.ok(b.y + b.h <= H - 52 + 0.01, `acima do rodapé: ${b.label} (página ${b.page})`);
  }
  // Caixas de primeiro nível (cartões e linhas) não se sobrepõem; caixas internas dos
  // cartões de responsável ficam dentro do cartão.
  const cards = boxes.filter((b) => b.label.startsWith("Responsável "));
  for (const c of cards) {
    const inner = boxes.filter((b) => b.page === c.page && b !== c && b.y >= c.y && b.y < c.y + c.h && b.x > c.x);
    for (const i of inner) assert.ok(i.y + i.h <= c.y + c.h + 0.01, `${i.label} dentro do cartão`);
  }
  const top = boxes.filter((b) => !cards.some((c) => b !== c && b.page === c.page && b.y >= c.y && b.y < c.y + c.h && b.x > c.x));
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i];
      const b = top[j];
      if (a.page !== b.page) continue;
      const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      assert.ok(!overlap, `sobreposição: ${a.label} x ${b.label}`);
    }
  }
});

test("PDF: aluno sem dados opcionais nem responsáveis ainda gera documento válido", async () => {
  const buf = await buildStudentProfilePdf(
    pdfData({ parents: [], activeClass: null, activeLinkStartedAt: null, schoolLogo: null, student: { full_name: "Aluno Mínimo" } }),
    { compress: false }
  );
  const all = pdfStrings(buf).join("\n");
  assert.ok(all.includes("Nenhum responsável vinculado ao aluno."));
  assert.ok(all.includes("Página 1 de 1"));
});

test("PDF pela rota: só aluno da própria escola e mesmos dados da ficha exibida", async () => {
  state.tables.students.find((s) => s.id === S.alunoA).allergies = "Camarão";
  const ok = await call(pdfRoute.GET, [`/api/school/students/${S.alunoA}/profile-pdf`, S.tok.secA], { id: S.alunoA });
  assert.equal(ok.status, 200);
  assert.match(ok.type, /application\/pdf/);
  assert.equal(ok.body.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await call(pdfRoute.GET, [`/api/school/students/${S.alunoB}/profile-pdf`, S.tok.secA], { id: S.alunoB })).status, 404);
  assert.equal((await call(pdfRoute.GET, [`/api/school/students/${S.alunoA}/profile-pdf`, S.tok.profA], { id: S.alunoA })).status, 403);
});

test("formatadores brasileiros", () => {
  assert.equal(pdfText.brDate("2026-12-31"), "31/12/2026");
  assert.equal(pdfText.brDate(null), "—");
  assert.equal(pdfText.brDateTime("2026-01-01T02:00:00Z"), "31/12/2025 23:00");
  assert.equal(pdfText.brDateTime("data inválida"), "—");
  assert.equal(pdfText.formatPhoneBR("11987654321"), "(11) 98765-4321");
  assert.equal(pdfText.formatPhoneBR("+55 11 3456-7890"), "(11) 3456-7890");
  assert.equal(pdfText.formatPhoneBR("ramal 12"), "ramal 12");
  assert.equal(pdfText.formatPhoneBR(""), "Não informado");
  assert.equal(pdfText.formatCpf("529.982.247-25"), "529.982.247-25");
  assert.equal(pdfText.formatCep("01310100"), "01310-100");
  assert.equal(pdfText.normalizePdfText("Olá​ mundo 🎉 — ok"), "Olá mundo — ok");
  assert.equal(pdfText.normalizePdfText("linha 1\n\nlinha 2", { keepLineBreaks: true }), "linha 1\n\nlinha 2");
  assert.equal(pdfText.buildAddressText({}), null);
  assert.equal(pdfText.safeFileName("Ação & Cia"), "acao-cia");
});

// ---------------------------------------------------------------------------
// 4. Vínculo responsável <-> aluno pelo servidor
// ---------------------------------------------------------------------------
const L = "/api/school/parents/links";

test("vínculos: lista somente responsáveis, alunos e vínculos da própria escola", async () => {
  for (const k of ["diretorA", "coordA", "secA"]) {
    const r = await call(linksRoute.GET, [L, S.tok[k]]);
    assert.equal(r.status, 200, k);
    assert.ok(r.json.parents.every((p) => p.school_id === S.A));
    assert.deepEqual(new Set(r.json.students.map((s) => s.id)), new Set([S.alunoA, S.alunoA2]));
    assert.equal(r.json.links.length, 1);
  }
  assert.equal((await call(linksRoute.GET, [L, S.tok.profA])).status, 403);
  assert.equal((await call(linksRoute.GET, [L, S.tok.paiA])).status, 404);
});

test("vínculos: secretaria vincula dentro da escola; nunca com aluno ou responsável de outra escola", async () => {
  const ok = await call(linksRoute.POST, [L, S.tok.secA, { parentId: S.paiA2, studentId: S.alunoA2 }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const created = state.tables.student_parents.find((l) => l.parent_id === S.paiA2 && l.student_id === S.alunoA2);
  assert.equal(created.school_id, S.A);
  assert.equal(created.is_active, true);

  const n = state.tables.student_parents.length;
  assert.equal((await call(linksRoute.POST, [L, S.tok.secA, { parentId: S.paiA, studentId: S.alunoB }])).status, 403, "aluno da escola B");
  assert.equal((await call(linksRoute.POST, [L, S.tok.diretorA, { parentId: S.paiB, studentId: S.alunoA }])).status, 403, "responsável da escola B");
  assert.equal((await call(linksRoute.POST, [L, S.tok.profA, { parentId: S.paiA, studentId: S.alunoA2 }])).status, 403, "professor");
  assert.equal((await call(linksRoute.POST, [L, S.tok.secA, { parentId: "x", studentId: S.alunoA }])).status, 400);
  assert.equal(state.tables.student_parents.length, n, "nenhum vínculo criado nas tentativas negadas");

  const again = await call(linksRoute.POST, [L, S.tok.coordA, { parentId: S.paiA2, studentId: S.alunoA2 }]);
  assert.equal(again.status, 200);
  assert.equal(state.tables.student_parents.length, n, "vínculo repetido não duplica");
});

test("vínculos: desvincular e reativar ficam restritos à escola de quem pede", async () => {
  const forged = await call(unlinkRoute.POST, ["/x", S.tok.secA, { schoolId: S.B, parentId: S.paiB, studentId: S.alunoB }]);
  assert.equal(forged.status, 403, "escola do corpo diferente da escola do vínculo");
  assert.equal(state.tables.student_parents.find((l) => l.parent_id === S.paiB).is_active, true);

  const ok = await call(unlinkRoute.POST, ["/x", S.tok.secA, { schoolId: S.A, parentId: S.paiA, studentId: S.alunoA }]);
  assert.equal(ok.status, 200);
  const link = state.tables.student_parents.find((l) => l.parent_id === S.paiA && l.student_id === S.alunoA);
  assert.equal(link.is_active, false, "desvínculo lógico (histórico preservado)");

  const re = await call(linksRoute.POST, [L, S.tok.diretorA, { parentId: S.paiA, studentId: S.alunoA }]);
  assert.equal(re.status, 200);
  assert.equal(re.json.reactivated, true);
  assert.equal(link.is_active, true);
  assert.equal((await call(unlinkRoute.POST, ["/x", S.tok.profA, { schoolId: S.A, parentId: S.paiA, studentId: S.alunoA }])).status, 403);
});
