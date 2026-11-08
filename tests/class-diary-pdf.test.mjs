// Incidente: "Falha ao gerar PDF diário." — logomarca WebP/SVG/corrompida derrubava o PDFKit
// (exceção não tratada = HTTP 500 sem corpo). Testa as rotas reais do diário de classe com
// Supabase em memória e dados FICTÍCIOS. Executar: node --test tests/class-diary-pdf.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { deflateSync } from "node:zlib";

register("./helpers/loader.mjs", import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ficticio.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-ficticia";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-secreta-ficticia";
globalThis.fetch = async () => {
  throw new Error("rede bloqueada nos testes");
};

const { state, reset, addUser, issueToken } = await import("./helpers/fakeState.mjs");
const { supabaseAdmin } = await import("./helpers/fakeSupabaseAdmin.mjs");
const schoolReport = await import("../src/app/api/school/class-diary/report/route.ts");
const teacherReport = await import("../src/app/api/teacher/class-diary/report/route.ts");
const { toPdfImage, detectPdfImageKind } = await import("../src/lib/pdf/safeImage.ts");

// ---------------------------------------------------------------------------
// Imagens fictícias
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
  chunk("IEND", Buffer.alloc(0)),
]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(18)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const PNG_CORROMPIDO = PNG.subarray(0, 20);
const HTML = Buffer.from("<!doctype html><html><body>Not found</body></html>");

// ---------------------------------------------------------------------------
// Cenário fictício: escolas A e B
// ---------------------------------------------------------------------------
let S;
let storageBytes = null;
function seed({ logo = PNG, entry = {} } = {}) {
  reset();
  storageBytes = logo;
  supabaseAdmin.storage.from = () => ({
    download: async () => (storageBytes ? { data: new Blob([storageBytes]), error: null } : { data: null, error: { message: "não encontrado" } }),
  });
  const mk = (email, name) => addUser({ email, user_metadata: { full_name: name } });
  const ids = {
    dirA: mk("dir.a@ficticio.test", "Diretora A"),
    coordA: mk("coord.a@ficticio.test", "Coordenadora A"),
    secA: mk("sec.a@ficticio.test", "Secretária A"),
    profA: mk("prof.a@ficticio.test", "Professor João"),
    prof2A: mk("prof2.a@ficticio.test", "Professora sem vínculo"),
    paiA: mk("pai.a@ficticio.test", "Responsável A"),
    dirB: mk("dir.b@ficticio.test", "Diretor B"),
    profB: mk("prof.b@ficticio.test", "Professor B"),
  };
  const link = (u, school, role) =>
    state.tables.school_users.push({ id: `su-${u}`, user_id: u, school_id: school, role, is_active: true, created_at: "2026-01-01" });
  link(ids.dirA, "esc-a", "diretor");
  link(ids.coordA, "esc-a", "coordenador");
  link(ids.secA, "esc-a", "secretaria");
  link(ids.profA, "esc-a", "professor");
  link(ids.prof2A, "esc-a", "professor");
  link(ids.dirB, "esc-b", "diretor");
  link(ids.profB, "esc-b", "professor");
  state.tables.parents.push({ id: "pai-a", user_id: ids.paiA, school_id: "esc-a" });
  const logoUrl = logo ? "https://ficticio.supabase.co/storage/v1/object/public/school-branding/esc-a/logo" : null;
  state.tables.schools.push(
    { id: "esc-a", name: "Escola Fictícia Água Viva", brand_logo_url: logoUrl, logo_url: null },
    { id: "esc-b", name: "Escola Fictícia B", brand_logo_url: null, logo_url: null }
  );
  state.tables.classes.push({ id: "turma-a", school_id: "esc-a", name: "1º Ano A" }, { id: "turma-b", school_id: "esc-b", name: "1º Ano B" });
  state.tables.teacher_classes.push(
    { id: "tc1", school_id: "esc-a", teacher_user_id: ids.profA, class_id: "turma-a", is_active: true },
    { id: "tc2", school_id: "esc-b", teacher_user_id: ids.profB, class_id: "turma-b", is_active: true }
  );
  state.tables.class_diaries = [
    { id: "diario-a", school_id: "esc-a", class_id: "turma-a", teacher_user_id: ids.profA, subject_name: "Língua Portuguesa", term_label: "1º bimestre", reference_month: "2026-11", created_at: "2026-11-01" },
  ];
  state.tables.class_diary_entries = [
    { id: "e1", diary_id: "diario-a", lesson_date: "2026-11-05", content_taught: "Fábulas: leitura e interpretação", methodology: "Roda de leitura", activities: "Reconto", notes: null, homework: "", ...entry },
    { id: "e2", diary_id: "diario-a", lesson_date: "2026-11-06", content_taught: "Produção de texto", methodology: null, activities: null, notes: null, homework: null },
  ];
  S = { ids, tok: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, issueToken(v)])) };
}
beforeEach(() => seed());

async function call(handler, url, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await handler(new Request(`http://localhost${url}`, { headers }));
  const type = res.headers.get("content-type") || "";
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, body, json: type.includes("json") ? JSON.parse(body.toString() || "null") : null };
}
const pages = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
const isPdf = (r) => r.status === 200 && r.type === "application/pdf" && r.body.subarray(0, 5).toString() === "%PDF-";

const daily = (q = {}) =>
  "/api/school/class-diary/report?" +
  new URLSearchParams({ classId: "turma-a", referenceMonth: "2026-11", subjectName: "Língua Portuguesa", termLabel: "1º bimestre", lessonDate: "2026-11-05", ...q });
const period = (q = {}) =>
  "/api/school/class-diary/report?" +
  new URLSearchParams({ classId: "turma-a", referenceMonth: "2026-11", subjectName: "Língua Portuguesa", startDate: "2026-11-01", endDate: "2026-11-30", ...q });
const teacherDaily = (q = {}) =>
  "/api/teacher/class-diary/report?" +
  new URLSearchParams({ classId: "turma-a", referenceMonth: "2026-11", subjectName: "Língua Portuguesa", lessonDate: "2026-11-05", ...q });

// ---------------------------------------------------------------------------
test("validação de imagem: só PNG/JPEG legíveis pelo PDFKit", () => {
  assert.equal(detectPdfImageKind(PNG), "png");
  assert.equal(detectPdfImageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "jpeg");
  assert.equal(toPdfImage(PNG), PNG);
  for (const bad of [WEBP, SVG, PNG_CORROMPIDO, HTML, Buffer.alloc(0), null, undefined]) assert.equal(toPdfImage(bad), null);
});

for (const [label, logo] of [
  ["sem logomarca", null],
  ["logomarca PNG", PNG],
  ["logomarca WebP (causa do incidente)", WEBP],
  ["logomarca SVG (causa do incidente)", SVG],
  ["logomarca PNG corrompida", PNG_CORROMPIDO],
  ["logomarca que é uma página HTML", HTML],
]) {
  test(`PDF do dia e do período com ${label}`, async () => {
    seed({ logo });
    const d = await call(schoolReport.GET, daily(), S.tok.dirA);
    assert.ok(isPdf(d), `diário do dia: ${d.status} ${d.body.toString().slice(0, 120)}`);
    const p = await call(schoolReport.GET, period(), S.tok.dirA);
    assert.ok(isPdf(p), `período: ${p.status} ${p.body.toString().slice(0, 120)}`);
    const t = await call(teacherReport.GET, teacherDaily(), S.tok.profA);
    assert.ok(isPdf(t), `professor: ${t.status} ${t.body.toString().slice(0, 120)}`);
  });
}

test("logomarca inválida gera o mesmo layout do PDF sem logomarca", async () => {
  seed({ logo: null });
  const semLogo = await call(schoolReport.GET, daily(), S.tok.dirA);
  seed({ logo: WEBP });
  const webp = await call(schoolReport.GET, daily(), S.tok.dirA);
  seed({ logo: PNG });
  const png = await call(schoolReport.GET, daily(), S.tok.dirA);
  assert.equal(pages(webp.body), pages(semLogo.body));
  assert.ok(Math.abs(webp.body.length - semLogo.body.length) < 64, "mesmo conteúdo do PDF sem logo");
  assert.ok(/\/Subtype \/Image/.test(png.body.toString("latin1")), "PNG continua sendo incorporado");
  assert.ok(!/\/Subtype \/Image/.test(webp.body.toString("latin1")), "WebP não é incorporado");
});

test("conteúdo longo, campos vazios e caracteres especiais", async () => {
  const longo = "Leitura compartilhada com pausas para inferências e reconto oral. ".repeat(220);
  seed({ entry: { content_taught: longo, methodology: longo, activities: "", notes: null, homework: undefined } });
  const r = await call(schoolReport.GET, daily(), S.tok.coordA);
  assert.ok(isPdf(r));
  assert.ok(pages(r.body) >= 3, `texto longo em várias páginas (${pages(r.body)})`);

  seed({ entry: { content_taught: "", methodology: null, activities: null, notes: null, homework: null } });
  assert.ok(isPdf(await call(schoolReport.GET, daily(), S.tok.dirA)), "campos vazios");

  const especiais = "Ação, coração, pão — “aspas” ‘simples’ … € ™ • ½ °C 😀 🚀 中文 ﷺ  linha  \t tab ­​";
  seed({ entry: { content_taught: especiais, methodology: especiais, activities: especiais, notes: especiais, homework: especiais } });
  assert.ok(isPdf(await call(schoolReport.GET, daily(), S.tok.dirA)), "caracteres especiais");
  assert.ok(isPdf(await call(schoolReport.GET, period(), S.tok.dirA)), "caracteres especiais no período");
  assert.ok(isPdf(await call(teacherReport.GET, teacherDaily(), S.tok.profA)), "caracteres especiais (professor)");
});

test("autorização: gestão da escola gera; professor, responsável e anônimo não usam a rota da escola", async () => {
  for (const k of ["dirA", "coordA", "secA"]) assert.ok(isPdf(await call(schoolReport.GET, daily(), S.tok[k])), k);
  for (const k of ["profA", "paiA"]) {
    const r = await call(schoolReport.GET, daily(), S.tok[k]);
    assert.ok(r.status === 403 || r.status === 404, `${k}: ${r.status}`);
    assert.notEqual(r.type, "application/pdf");
  }
  assert.equal((await call(schoolReport.GET, daily(), null)).status, 401);
});

test("autorização: professor só gera PDF de turma com vínculo", async () => {
  assert.ok(isPdf(await call(teacherReport.GET, teacherDaily(), S.tok.profA)));
  const semVinculo = await call(teacherReport.GET, teacherDaily(), S.tok.prof2A);
  assert.equal(semVinculo.status, 403);
  assert.ok((await call(teacherReport.GET, teacherDaily(), S.tok.paiA)).status >= 400);
  assert.equal((await call(teacherReport.GET, teacherDaily(), null)).status, 401);
});

test("isolamento: escola B não obtém PDF do diário da escola A", async () => {
  const dir = await call(schoolReport.GET, daily(), S.tok.dirB);
  assert.notEqual(dir.type, "application/pdf");
  assert.ok(dir.status >= 400);
  const per = await call(schoolReport.GET, period(), S.tok.dirB);
  assert.notEqual(per.type, "application/pdf");
  const prof = await call(teacherReport.GET, teacherDaily(), S.tok.profB);
  assert.equal(prof.status, 403);
  assert.notEqual(prof.type, "application/pdf");
});

test("erro inesperado: resposta JSON com mensagem (não mais HTTP 500 vazio)", async () => {
  // Força uma falha dentro da geração: a turma "explode" ao ser lida.
  const original = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    if (table === "class_diary_entries") throw new Error("falha simulada");
    return original(table);
  };
  try {
    for (const [handler, url, tok] of [
      [schoolReport.GET, daily(), S.tok.dirA],
      [teacherReport.GET, teacherDaily(), S.tok.profA],
    ]) {
      const r = await call(handler, url, tok);
      assert.equal(r.status, 500);
      assert.equal(r.json?.code, "PDF_GENERATION_FAILED");
      assert.match(r.json?.error, /Não foi possível gerar o PDF do diário/);
      assert.ok(!JSON.stringify(r.json).includes("falha simulada"), "não expõe detalhes internos");
    }
  } finally {
    supabaseAdmin.from = original;
  }
});

test("lançamento inexistente continua respondendo 404 com mensagem", async () => {
  const r = await call(schoolReport.GET, daily({ lessonDate: "2026-11-20" }), S.tok.dirA);
  assert.equal(r.status, 404);
  assert.match(r.json.error, /Nenhum lançamento/);
});
