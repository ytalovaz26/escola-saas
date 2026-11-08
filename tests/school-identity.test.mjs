// Incidente: identidade institucional divergente (painel "Escola Formiguinha", PDF/menu "Escola teste")
// e logomarca ausente nos PDFs. Rotas reais + Supabase em memória + dados FICTÍCIOS (Escola Alfa e
// Escola Beta). Executar: node --test tests/school-identity.test.mjs — sem rede, sem banco.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register, createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./helpers/loader.mjs", import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ficticio.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-ficticia";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-secreta-ficticia";
const externalFetches = [];
globalThis.fetch = async (url) => {
  externalFetches.push(String(url));
  throw new Error("rede bloqueada nos testes");
};

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(import.meta.url)("sharp");
const { state, reset, addUser, issueToken } = await import("./helpers/fakeState.mjs");
const { supabaseAdmin } = await import("./helpers/fakeSupabaseAdmin.mjs");
const identityLib = await import("../src/lib/schoolIdentity.ts");
const pdfImage = await import("../src/lib/pdf/pdfImage.ts");
const me = await import("../src/app/api/me/route.ts");
const branding = await import("../src/app/api/branding/route.ts");
const schoolDiary = await import("../src/app/api/school/class-diary/report/route.ts");
const teacherDiary = await import("../src/app/api/teacher/class-diary/report/route.ts");
const studentCard = await import("../src/app/api/school/students/[id]/student-card-pdf/route.ts");

// ---------------------------------------------------------------------------
// Imagens fictícias geradas na hora
// ---------------------------------------------------------------------------
const solid = (color, w = 240, h = 100) => sharp({ create: { width: w, height: h, channels: 3, background: color } });
const IMG = {
  pngAlfa: await solid("#cc0000").png().toBuffer(),
  pngBeta: await solid("#0000cc").png().toBuffer(),
  jpeg: await solid("#00aa00").jpeg().toBuffer(),
  webp: await solid("#aa00aa").webp().toBuffer(),
  gif: await solid("#aaaa00").gif().toBuffer(),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><defs><linearGradient id="g"><stop offset="0" stop-color="#0a0"/></linearGradient></defs><rect width="200" height="80" fill="url(#g)"/></svg>'),
  svgScript: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="9" height="9"/></svg>'),
  svgExterna: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="http://169.254.169.254/latest/meta-data" width="9" height="9"/></svg>'),
  invalida: Buffer.from("isto não é uma imagem, apenas texto qualquer"),
  enorme: await solid("#123456", 3000, 1200).png().toBuffer(),
};
IMG.corrompida = IMG.pngAlfa.subarray(0, 60);

// ---------------------------------------------------------------------------
// Cenário: Escola Alfa e Escola Beta (nome de cadastro ≠ nome exibido, como no incidente)
// ---------------------------------------------------------------------------
const STORAGE = "https://ficticio.supabase.co/storage/v1/object/public/school-branding";
let S;
let storageFiles;
let downloads;
function seed({ alfaLogo = IMG.pngAlfa, alfaLogoUrl } = {}) {
  reset();
  externalFetches.length = 0;
  downloads = [];
  storageFiles = new Map([
    ["school-branding/alfa/logo", alfaLogo],
    ["school-branding/beta/logo", IMG.pngBeta],
  ]);
  supabaseAdmin.storage.from = (bucket) => ({
    download: async (p) => {
      downloads.push(`${bucket}/${p}`);
      const b = storageFiles.get(`${bucket}/${p}`);
      return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "não encontrado" } };
    },
  });
  const mk = (k, name) => addUser({ email: `${k}@ficticio.test`, user_metadata: { full_name: name } });
  const ids = {
    dirA: mk("dir.a", "Diretora Alfa"),
    coordA: mk("coord.a", "Coordenadora Alfa"),
    secA: mk("sec.a", "Secretária Alfa"),
    profA: mk("prof.a", "Professor Alfa"),
    paiA: mk("pai.a", "Responsável Alfa"),
    dirB: mk("dir.b", "Diretor Beta"),
    profB: mk("prof.b", "Professora Beta"),
    multi: mk("multi", "Coordenação nas duas"),
    exA: mk("ex.a", "Ex-funcionário Alfa"),
    voltouA: mk("voltou.a", "Desligado da Beta"),
  };
  const link = (u, school, role, is_active = true, created_at = "2026-01-01") =>
    state.tables.school_users.push({ id: `su-${u}-${school}`, user_id: u, school_id: school, role, is_active, created_at });
  link(ids.dirA, "alfa", "diretor");
  link(ids.coordA, "alfa", "coordenador");
  link(ids.secA, "alfa", "secretaria");
  link(ids.profA, "alfa", "professor");
  link(ids.dirB, "beta", "diretor");
  link(ids.profB, "beta", "professor");
  link(ids.multi, "alfa", "coordenador", true, "2026-01-01");
  link(ids.multi, "beta", "coordenador", true, "2026-06-01"); // vínculo mais recente
  link(ids.exA, "alfa", "professor", false);
  link(ids.voltouA, "alfa", "coordenador", true, "2026-01-01");
  link(ids.voltouA, "beta", "coordenador", false, "2026-06-01"); // mais recente, porém desativado

  state.tables.schools.push(
    { id: "alfa", name: "Escola teste Alfa", brand_name: "Escola Alfa", brand_logo_url: alfaLogoUrl ?? `${STORAGE}/alfa/logo`, logo_url: `${STORAGE}/alfa/logo-antiga`, brand_icon_url: null },
    { id: "beta", name: "Escola teste Beta", brand_name: "Escola Beta", brand_logo_url: `${STORAGE}/beta/logo`, logo_url: null, brand_icon_url: null }
  );
  state.tables.parents.push({ id: "pai-alfa", user_id: ids.paiA, school_id: "alfa", first_login_completed: true });
  state.tables.students.push(
    { id: "aluno-alfa", school_id: "alfa", full_name: "Aluno Fictício Alfa", registration_number: "A-1", class_id: "turma-alfa", student_photo_url: `${STORAGE}/alfa/foto-aluno` },
    { id: "aluno-beta", school_id: "beta", full_name: "Aluno Fictício Beta", registration_number: "B-1", class_id: "turma-beta", student_photo_url: null }
  );
  state.tables.student_parents.push({ id: "sp1", parent_id: "pai-alfa", student_id: "aluno-alfa", school_id: "alfa", is_active: true, created_at: "2026-02-01" });
  state.tables.student_classes.push(
    { id: "sc1", school_id: "alfa", student_id: "aluno-alfa", class_id: "turma-alfa", is_active: true },
    { id: "sc2", school_id: "beta", student_id: "aluno-beta", class_id: "turma-beta", is_active: true }
  );
  state.tables.classes.push(
    { id: "turma-alfa", school_id: "alfa", name: "1º Ano Alfa", grade: "1º ano", shift: "Manhã" },
    { id: "turma-beta", school_id: "beta", name: "1º Ano Beta", grade: "1º ano", shift: "Tarde" }
  );
  state.tables.teacher_classes.push(
    { id: "tc1", school_id: "alfa", teacher_user_id: ids.profA, class_id: "turma-alfa", is_active: true },
    { id: "tc2", school_id: "beta", teacher_user_id: ids.profB, class_id: "turma-beta", is_active: true },
    { id: "tc3", school_id: "alfa", teacher_user_id: ids.exA, class_id: "turma-alfa", is_active: false }
  );
  state.tables.class_diaries = [
    { id: "d-alfa", school_id: "alfa", class_id: "turma-alfa", teacher_user_id: ids.profA, subject_name: "Língua Portuguesa", term_label: "1º bimestre", reference_month: "2026-11", created_at: "2026-11-01" },
    { id: "d-beta", school_id: "beta", class_id: "turma-beta", teacher_user_id: ids.profB, subject_name: "Língua Portuguesa", term_label: "1º bimestre", reference_month: "2026-11", created_at: "2026-11-01" },
  ];
  state.tables.class_diary_entries = [
    { id: "e-alfa", diary_id: "d-alfa", lesson_date: "2026-11-05", content_taught: "Fábulas: ação, coração e reflexão — “moral da história”", methodology: "Roda de leitura", activities: "Reconto", notes: null, homework: "" },
    { id: "e-beta", diary_id: "d-beta", lesson_date: "2026-11-05", content_taught: "Conteúdo exclusivo da Beta", methodology: "", activities: "", notes: "", homework: "" },
  ];
  storageFiles.set("school-branding/alfa/foto-aluno", IMG.jpeg);
  S = { ids, tok: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, issueToken(v)])) };
}
beforeEach(() => seed());

async function call(handler, url, token, params) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await handler(new Request(`http://localhost${url}`, { headers }), params ? { params: Promise.resolve(params) } : undefined);
  const type = res.headers.get("content-type") || "";
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, body, json: type.includes("json") ? JSON.parse(body.toString() || "null") : null };
}

// Texto real de dentro do PDF (descomprime os streams e decodifica as strings em WinAnsi).
const CP1252 = { 0x80: "€", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };
function pdfText(buf) {
  const raw = buf.toString("latin1");
  let content = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const bytes = Buffer.from(m[1], "latin1");
    try {
      content += inflateSync(bytes).toString("latin1") + "\n";
    } catch {
      content += m[1] + "\n";
    }
  }
  return [...content.matchAll(/\[((?:<[0-9a-f]*>|[-\d. ]+)+)\] TJ/g)]
    .map((m) => [...m[1].matchAll(/<([0-9a-f]*)>/g)].map((h) => Array.from(Buffer.from(h[1], "hex"), (b) => CP1252[b] ?? String.fromCharCode(b)).join("")).join(""))
    .join(" ")
    .replace(/\s+/g, " ");
}
const imageCount = (buf) => (buf.toString("latin1").match(/\/Subtype \/Image/g) || []).length;
const isPdf = (r) => r.status === 200 && r.type === "application/pdf";

const dailyUrl = (q = {}) =>
  "/api/school/class-diary/report?" +
  new URLSearchParams({ classId: "turma-alfa", referenceMonth: "2026-11", subjectName: "Língua Portuguesa", lessonDate: "2026-11-05", ...q });
const periodUrl = (q = {}) =>
  "/api/school/class-diary/report?" +
  new URLSearchParams({ classId: "turma-alfa", referenceMonth: "2026-11", subjectName: "Língua Portuguesa", startDate: "2026-11-01", endDate: "2026-11-30", ...q });
const teacherUrl = (q = {}) =>
  "/api/teacher/class-diary/report?" +
  new URLSearchParams({ classId: "turma-alfa", referenceMonth: "2026-11", subjectName: "Língua Portuguesa", lessonDate: "2026-11-05", ...q });

// ---------------------------------------------------------------------------
// A. Identidade
// ---------------------------------------------------------------------------
test("regra canônica: nome exibido = brand_name ?? name; logomarca = brand_logo_url ?? logo_url", () => {
  const r = identityLib.resolveSchoolIdentity({ id: "x", name: "Escola teste", brand_name: "  Escola Formiguinha ", brand_logo_url: " ", logo_url: "a/b.png" });
  assert.equal(r.displayName, "Escola Formiguinha");
  assert.equal(r.legalName, "Escola teste");
  assert.equal(r.logoUrl, "a/b.png");
  assert.equal(identityLib.resolveSchoolIdentity({ id: "x", name: "Só Cadastro", brand_name: null }).displayName, "Só Cadastro");
  assert.equal(identityLib.resolveSchoolIdentity(null, "x").displayName, null);
});

test("todos os perfis veem o mesmo nome e a mesma logomarca da própria escola (/api/me e /api/branding)", async () => {
  for (const k of ["dirA", "coordA", "secA", "profA"]) {
    const m = await call(me.GET, ["/api/me", S.tok[k]][0], S.tok[k]);
    assert.equal(m.json.branding.brandName, "Escola Alfa", `${k} /api/me`);
    assert.equal(m.json.branding.brandLogoUrl, `${STORAGE}/alfa/logo`);
    const b = await call(branding.GET, "/api/branding", S.tok[k]);
    assert.equal(b.status, 200, `${k} /api/branding`);
    assert.equal(b.json.name, "Escola Alfa", `${k}: menu lateral do professor usava o nome de cadastro`);
    assert.equal(b.json.legalName, "Escola teste Alfa");
    assert.equal(b.json.logoUrl, `${STORAGE}/alfa/logo`, `${k}: menu usava logo_url antiga`);
    assert.equal(b.json.schoolId, "alfa");
  }
  const pai = await call(me.GET, "/api/me", S.tok.paiA);
  assert.equal(pai.json.branding.brandName, "Escola Alfa", "responsável vê a escola do filho");
  for (const k of ["dirB", "profB"]) {
    assert.equal((await call(branding.GET, "/api/branding", S.tok[k])).json.name, "Escola Beta");
    assert.equal((await call(me.GET, "/api/me", S.tok[k])).json.branding.brandName, "Escola Beta");
  }
  assert.ok((await call(branding.GET, "/api/branding", S.tok.paiA)).status >= 400, "responsável não usa a rota da equipe");
});

test("alteração de nome e de logomarca aparece na próxima consulta (sem cache no servidor)", async () => {
  const school = state.tables.schools.find((s) => s.id === "alfa");
  school.brand_name = "Escola Alfa Renomeada";
  school.brand_logo_url = `${STORAGE}/alfa/logo-nova`;
  storageFiles.set("school-branding/alfa/logo-nova", IMG.jpeg);
  assert.equal((await call(branding.GET, "/api/branding", S.tok.profA)).json.name, "Escola Alfa Renomeada");
  assert.equal((await call(me.GET, "/api/me", S.tok.dirA)).json.branding.brandName, "Escola Alfa Renomeada");
  const pdf = await call(schoolDiary.GET, dailyUrl(), S.tok.dirA);
  assert.ok(pdfText(pdf.body).includes("Escola Alfa Renomeada"));
  assert.ok(downloads.includes("school-branding/alfa/logo-nova"));
});

// ---------------------------------------------------------------------------
// B. Multi-tenant
// ---------------------------------------------------------------------------
test("PDFs da Escola Alfa: nome exibido e logomarca da Alfa, nunca da Beta nem o nome de cadastro", async () => {
  for (const [handler, url, tok] of [
    [schoolDiary.GET, dailyUrl(), S.tok.dirA],
    [schoolDiary.GET, periodUrl(), S.tok.secA],
    [teacherDiary.GET, teacherUrl(), S.tok.profA],
  ]) {
    downloads = [];
    const r = await call(handler, url, tok);
    assert.ok(isPdf(r), `${url}: ${r.status} ${r.body.toString().slice(0, 100)}`);
    const text = pdfText(r.body);
    assert.ok(text.includes("Escola Alfa"), "nome exibido da Alfa no PDF");
    assert.ok(!text.includes("Escola teste"), "o PDF não usa mais o nome de cadastro");
    assert.ok(!text.includes("Beta"), "nenhum dado da Beta");
    assert.equal(imageCount(r.body), 1, "logomarca incorporada");
    assert.deepEqual(downloads, ["school-branding/alfa/logo"], "somente a logomarca da Alfa foi lida");
  }
  const card = await call(studentCard.GET, "/api/school/students/aluno-alfa/student-card-pdf", S.tok.dirA, { id: "aluno-alfa" });
  assert.ok(isPdf(card), `carteirinha: ${card.status} ${card.body.toString().slice(0, 100)}`);
  assert.ok(pdfText(card.body).includes("Escola Alfa"));
  assert.ok(!pdfText(card.body).includes("Escola teste"));
  assert.equal(externalFetches.length, 0, "nenhuma URL externa buscada");
});

test("usuário com vínculos nas duas escolas: identidade e dados da MESMA escola (vínculo ativo mais recente)", async () => {
  const m = await call(me.GET, "/api/me", S.tok.multi);
  const b = await call(branding.GET, "/api/branding", S.tok.multi);
  assert.equal(m.json.school.schoolId, "beta");
  assert.equal(m.json.branding.brandName, "Escola Beta");
  assert.equal(b.json.schoolId, "beta");
  assert.equal(b.json.name, "Escola Beta");
  const beta = await call(schoolDiary.GET, dailyUrl({ classId: "turma-beta" }), S.tok.multi);
  assert.ok(isPdf(beta));
  assert.ok(pdfText(beta.body).includes("Escola Beta"));
  const alfa = await call(schoolDiary.GET, dailyUrl(), S.tok.multi);
  assert.notEqual(alfa.type, "application/pdf", "contexto é a Beta: turma da Alfa não sai");

  // Vínculo mais recente desativado: o contexto volta para o vínculo ativo (Alfa).
  assert.equal((await call(me.GET, "/api/me", S.tok.voltouA)).json.branding.brandName, "Escola Alfa");
  assert.equal((await call(branding.GET, "/api/branding", S.tok.voltouA)).json.name, "Escola Alfa");
});

test("desvinculados e adulteração: nada da outra escola sai, nem com school_id/classId forjados", async () => {
  assert.ok((await call(branding.GET, "/api/branding", S.tok.exA)).status >= 400, "sem vínculo ativo");
  assert.ok((await call(schoolDiary.GET, dailyUrl(), S.tok.exA)).status >= 400);
  // school_id forjado na URL é ignorado: a escola vem do vínculo.
  const forged = await call(branding.GET, "/api/branding?schoolId=beta&school_id=beta", S.tok.dirA);
  assert.equal(forged.json.schoolId, "alfa");
  assert.equal(forged.json.name, "Escola Alfa");
  // Turma da Beta pedida por usuário da Alfa.
  for (const [handler, url, tok] of [
    [schoolDiary.GET, dailyUrl({ classId: "turma-beta", schoolId: "beta" }), S.tok.dirA],
    [schoolDiary.GET, periodUrl({ classId: "turma-beta" }), S.tok.coordA],
    [teacherDiary.GET, teacherUrl({ classId: "turma-beta" }), S.tok.profA],
  ]) {
    const r = await call(handler, url, tok);
    assert.notEqual(r.type, "application/pdf");
    assert.ok(!r.body.toString("latin1").includes("Beta"), "nenhum dado da Beta na resposta");
  }
  const card = await call(studentCard.GET, "/api/school/students/aluno-beta/student-card-pdf", S.tok.dirA, { id: "aluno-beta" });
  assert.notEqual(card.type, "application/pdf");
  // Sem permissão.
  assert.ok((await call(schoolDiary.GET, dailyUrl(), S.tok.paiA)).status >= 400);
  assert.ok((await call(schoolDiary.GET, dailyUrl(), S.tok.profA)).status >= 400);
  assert.equal((await call(schoolDiary.GET, dailyUrl(), null)).status, 401);
});

test("requisições alternadas entre escolas não misturam identidade (sem estado compartilhado)", async () => {
  const seq = ["dirA", "dirB", "profA", "profB", "multi", "secA"];
  const expected = { dirA: "Escola Alfa", dirB: "Escola Beta", profA: "Escola Alfa", profB: "Escola Beta", multi: "Escola Beta", secA: "Escola Alfa" };
  const results = await Promise.all([...seq, ...seq].map((k) => call(branding.GET, "/api/branding", S.tok[k]).then((r) => [k, r.json.name])));
  for (const [k, name] of results) assert.equal(name, expected[k], k);
  const pdfs = await Promise.all([
    call(schoolDiary.GET, dailyUrl(), S.tok.dirA),
    call(schoolDiary.GET, dailyUrl({ classId: "turma-beta" }), S.tok.dirB),
    call(schoolDiary.GET, dailyUrl(), S.tok.coordA),
  ]);
  assert.ok(pdfText(pdfs[0].body).includes("Escola Alfa") && !pdfText(pdfs[0].body).includes("Beta"));
  assert.ok(pdfText(pdfs[1].body).includes("Escola Beta") && !pdfText(pdfs[1].body).includes("Alfa"));
  assert.ok(pdfText(pdfs[2].body).includes("Escola Alfa"));
});

// ---------------------------------------------------------------------------
// C. Imagens nos PDFs
// ---------------------------------------------------------------------------
for (const [label, bytes, embedded] of [
  ["PNG", IMG.pngAlfa, 1],
  ["JPEG", IMG.jpeg, 1],
  ["WebP (convertido)", IMG.webp, 1],
  ["GIF (convertido)", IMG.gif, 1],
  ["SVG seguro (convertido)", IMG.svg, 1],
  ["PNG enorme (reduzido)", IMG.enorme, 1],
  ["SVG com script (rejeitado)", IMG.svgScript, 0],
  ["SVG com URL externa (rejeitado)", IMG.svgExterna, 0],
  ["arquivo inválido", IMG.invalida, 0],
  ["PNG corrompido", IMG.corrompida, 0],
  ["sem logomarca", null, 0],
]) {
  test(`logomarca ${label}: PDF gerado ${embedded ? "com" : "sem"} logo, nunca derrubado`, async () => {
    seed({ alfaLogo: bytes });
    for (const [handler, url, tok] of [
      [schoolDiary.GET, dailyUrl(), S.tok.dirA],
      [schoolDiary.GET, periodUrl(), S.tok.dirA],
      [teacherDiary.GET, teacherUrl(), S.tok.profA],
    ]) {
      const r = await call(handler, url, tok);
      assert.ok(isPdf(r), `${label} ${url}: ${r.status}`);
      // Imagem com transparência vira imagem + máscara (2 objetos); o que importa é ter ou não logo.
      if (embedded) assert.ok(imageCount(r.body) >= 1, `${label}: logo incorporada`);
      else assert.equal(imageCount(r.body), 0, `${label}: sem logo`);
      assert.ok(pdfText(r.body).includes("Escola Alfa"));
    }
  });
}

test("origens não permitidas nunca são buscadas (sem SSRF): URL externa, metadados de nuvem, outro projeto", async () => {
  for (const url of ["http://169.254.169.254/latest/meta-data", "https://outro-projeto.supabase.co/storage/v1/object/public/x/logo.png", "https://exemplo.invalid/logo.png", "file:///etc/passwd"]) {
    seed({ alfaLogoUrl: url });
    const r = await call(schoolDiary.GET, dailyUrl(), S.tok.dirA);
    assert.ok(isPdf(r), url);
    assert.equal(imageCount(r.body), 0, url);
    assert.equal(externalFetches.length, 0, `não buscou ${url}`);
    assert.deepEqual(downloads, [], `não leu o Storage para ${url}`);
  }
});

test("conteúdo longo, acentuação e paginação no PDF do dia", async () => {
  // Marcador sem hífen: o PDFKit pode quebrar a linha em hífens.
  const longo = "Leitura compartilhada com pausas para inferências e reconto oral. ".repeat(180) + "FIMDOCONTEUDO";
  state.tables.class_diary_entries[0].content_taught = longo;
  const r = await call(schoolDiary.GET, dailyUrl(), S.tok.dirA);
  assert.ok(isPdf(r));
  const text = pdfText(r.body);
  const pages = (r.body.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 2, `várias páginas (${pages})`);
  assert.ok(text.includes(`Página 1 de ${pages}`) && text.includes(`Página ${pages} de ${pages}`), "paginação");
  assert.ok(text.includes("FIMDOCONTEUDO"), "conteúdo longo até o fim");
  assert.equal(text.split("reconto oral.").length - 1, 180, "nenhuma repetição perdida");
  assert.ok(text.includes("Língua Portuguesa"), "acentuação preservada");
});

test("tratamento de imagem: limites, formatos e sanitização de SVG", async () => {
  assert.equal(pdfImage.sniffImageKind(IMG.webp), "webp");
  assert.equal(pdfImage.sniffImageKind(IMG.svg), "svg");
  assert.equal(pdfImage.isSafeSvg(IMG.svg.toString()), true);
  for (const bad of [
    "<svg><script>x</script></svg>",
    '<svg onload="x()"></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY e SYSTEM "file:///etc/passwd">]><svg>&e;</svg>',
    '<svg><image xlink:href="file:///etc/passwd"/></svg>',
    '<svg><style>@import url(http://x/y.css);</style></svg>',
    '<svg><rect style="fill:url(https://x/y#a)"/></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
  ]) {
    assert.equal(pdfImage.isSafeSvg(bad), false, bad);
  }
  assert.equal(pdfImage.isSafeSvg('<svg><use href="#a"/><rect fill="url(#g)"/></svg>'), true);
  const big = await pdfImage.normalizePdfImage(IMG.enorme);
  const meta = await sharp(big).metadata();
  assert.ok(meta.width <= pdfImage.MAX_OUTPUT_DIMENSION && meta.height <= pdfImage.MAX_OUTPUT_DIMENSION);
  assert.equal(await pdfImage.normalizePdfImage(Buffer.alloc(pdfImage.MAX_IMAGE_INPUT_BYTES + 1, 1)), null);
  const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.equal(await pdfImage.normalizePdfImage(huge), null, "acima de 16 megapixels");
  assert.equal(pdfImage.parseOwnStorageRef("https://ficticio.supabase.co/storage/v1/object/sign/docs/a.png?token=t")?.bucket, "docs");
  assert.equal(pdfImage.parseOwnStorageRef("https://ficticio.supabase.co/storage/v1/object/public/a/%2e%2e/b"), null);
  assert.equal(pdfImage.parseOwnStorageRef("https://ficticio.supabase.co.evil.com/storage/v1/object/public/a/b"), null);
});

// ---------------------------------------------------------------------------
// Garantias estáticas
// ---------------------------------------------------------------------------
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("geradores de PDF: nenhum fetch externo e nenhum nome de cadastro (schools.name) isolado", () => {
  const routes = walk(path.join(REPO, "src/app/api")).filter((f) => f.endsWith("route.ts"));
  const pdfRoutes = routes.filter((f) => /from "pdfkit"|buildStudentProfilePdf/.test(readFileSync(f, "utf8")));
  assert.ok(pdfRoutes.length >= 12, `rotas de PDF encontradas: ${pdfRoutes.length}`);
  for (const f of pdfRoutes) {
    const src = readFileSync(f, "utf8");
    const rel = path.relative(REPO, f);
    assert.doesNotMatch(src, /await fetch\(/, `${rel}: fetch externo`);
    assert.doesNotMatch(src, /(?<!brand_name \|\| )school\?\.name \|\| "Escola"|String\(school\?\.name/, `${rel}: usa só o nome de cadastro`);
    assert.doesNotMatch(src, /\.select\("name, brand_logo_url(, logo_url)?"\)/, `${rel}: seleção antiga da identidade`);
  }
  assert.match(readFileSync(path.join(REPO, "src/app/api/branding/route.ts"), "utf8"), /resolveSchoolIdentity/);
});
