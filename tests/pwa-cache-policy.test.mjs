// Política de cache do service worker (PWA): nada privado no Cache Storage; recursos públicos
// continuam disponíveis offline; caches antigos com dados privados são apagados na ativação.
// Executar com: node --test tests/pwa-cache-policy.test.mjs — sem rede, sem navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { runtimeCaching, PRIVATE_RESPONSE_GUARD } = require("../pwa/runtimeCaching.js");
// Script de limpeza incluído no sw.js (importScripts), carregado num escopo simulado de service worker.
const CLEANUP_SRC = readFileSync(path.join(REPO, "public/sw-cleanup.js"), "utf8");
function loadCleanup(caches) {
  const listeners = {};
  const scope = { caches, addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) };
  vm.runInNewContext(CLEANUP_SRC, { self: scope, Promise });
  return { scope, listeners };
}
// Array.from: arrays criados no contexto do vm têm outro protótipo.
const LEGACY_PRIVATE_CACHES = Array.from(loadCleanup(undefined).scope.__minhaEscolaLegacyPrivateCaches);
const cleanupLegacyPrivateCaches = async (caches) => Array.from(await loadCleanup(caches).scope.__minhaEscolaCleanupLegacyPrivateCaches(caches));

// Workbox vem como dependência do next-pwa (mesma versão usada no build).
const pwaRequire = createRequire(require.resolve("next-pwa"));
const workboxBuild = pwaRequire("workbox-build");
const { stringifyWithoutComments } = createRequire(pwaRequire.resolve("workbox-build"))("./lib/stringify-without-comments.js");

const ORIGIN = "https://appminhaescola.online";
const SUPA = "https://ficticio.supabase.co";
globalThis.self = { location: { origin: ORIGIN } };

// Mesma regra do Workbox: a primeira rota cujo urlPattern casar atende a requisição.
function routeFor(href, rules = runtimeCaching) {
  const url = new URL(href);
  return rules.find((r) => r.urlPattern({ url, sameOrigin: url.origin === ORIGIN, request: { url: href } })) || null;
}

const req = (href, headers = {}) => new Request(href, { headers });
const res = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });
const PUBLIC_PAGE = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" };
const DYNAMIC_PAGE = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate" };

// ---------------------------------------------------------------------------
test("rotas privadas nunca usam cache: /api/*, PDFs e todo o Supabase não público", () => {
  for (const href of [
    `${ORIGIN}/api/me`,
    `${ORIGIN}/api/teacher/lesson-plans/abc/pdf`,
    `${ORIGIN}/api/teacher/lesson-plans/abc/pdf?download=1`,
    `${ORIGIN}/api/school/students/abc/profile-pdf`,
    `${ORIGIN}/api/parent/report-card/pdf?studentId=1&term=1`,
    `${ORIGIN}/api/school/enrollment-documents/abc/url`,
    `${ORIGIN}/api/parent/students/abc/photo`,
    `${ORIGIN}/api/auth/register-director`,
    `${SUPA}/rest/v1/students?select=*`,
    `${SUPA}/auth/v1/user`,
    `${SUPA}/storage/v1/object/sign/enrollment-documents/escola/aluno/doc.pdf?token=abc`,
    `${SUPA}/storage/v1/object/authenticated/student-photos/a.jpg`,
    `${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png?token=abc`,
    `${SUPA}/functions/v1/qualquer`,
    "https://outro-servico.exemplo/qualquer.js",
  ]) {
    const route = routeFor(href);
    assert.ok(route, href);
    assert.equal(route.handler, "NetworkOnly", href);
  }
});

test("recursos públicos continuam com cache para uso offline", () => {
  const expectations = [
    [`${ORIGIN}/_next/static/chunks/app/page-123.js`, "static-js-assets"],
    [`${ORIGIN}/_next/static/css/app.css`, "static-style-assets"],
    [`${ORIGIN}/_next/static/media/font.woff2`, "static-font-assets"],
    [`${ORIGIN}/icons/icon-192.png`, "static-image-assets"],
    [`${ORIGIN}/brand/logo.svg`, "static-image-assets"],
    [`${ORIGIN}/manifest.webmanifest`, "static-data-assets"],
    [`${ORIGIN}/_next/image?url=%2Fbrand%2Flogo.png&w=64&q=75`, "next-image"],
    [`${ORIGIN}/login`, "pages"],
    [`${ORIGIN}/`, "pages"],
    [`${ORIGIN}/s/escola-ficticia/login`, "pages"],
    [`${ORIGIN}/s/escola-ficticia/manifest`, "pages"],
    [`${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`, "public-storage-assets"],
    ["https://fonts.gstatic.com/s/inter/v1/a.woff2", "google-fonts-webfonts"],
    ["https://fonts.googleapis.com/css2?family=Inter", "google-fonts-stylesheets"],
  ];
  for (const [href, cacheName] of expectations) {
    const route = routeFor(href);
    assert.notEqual(route.handler, "NetworkOnly", href);
    assert.equal(route.options.cacheName, cacheName, href);
    assert.ok(route.options.plugins.includes(PRIVATE_RESPONSE_GUARD), `${href} sem guarda`);
  }
  // Todas as regras que gravam algo passam pelo guarda; nenhuma usa os nomes antigos.
  for (const r of runtimeCaching) {
    if (r.handler === "NetworkOnly") continue;
    assert.ok(r.options.plugins.includes(PRIVATE_RESPONSE_GUARD), r.options.cacheName);
    assert.ok(!LEGACY_PRIVATE_CACHES.includes(r.options.cacheName), r.options.cacheName);
  }
});

// O guarda é testado no formato original E no formato serializado que vai para o sw.js.
function serializedGuard() {
  const code = stringifyWithoutComments(PRIVATE_RESPONSE_GUARD);
  return vm.runInNewContext(`(${code})`, { URL, decodeURIComponent, String });
}

for (const [label, guard] of [
  ["original", () => PRIVATE_RESPONSE_GUARD],
  ["serializado no sw.js", serializedGuard],
]) {
  test(`guarda (${label}): recusa respostas privadas e aceita públicas`, async () => {
    const g = guard().cacheWillUpdate;
    const deny = async (request, response, why) => assert.equal(await g({ request, response }), null, why);
    const allow = async (request, response, why) => assert.equal(await g({ request, response }), response, why);

    await deny(req(`${ORIGIN}/api/me`), res("{}", { headers: { "content-type": "application/json" } }), "/api");
    await deny(req(`${ORIGIN}/escola/x`, { authorization: "Bearer abc" }), res("x", { headers: PUBLIC_PAGE }), "Authorization");
    await deny(req(`${ORIGIN}/school/students`), res("<html>", { headers: DYNAMIC_PAGE }), "no-store");
    await deny(req(`${ORIGIN}/x.js`), res("x", { headers: { "cache-control": "private, max-age=60" } }), "private");
    await deny(req(`${ORIGIN}/arquivo.json`), res("x", { headers: { "content-type": "application/pdf" } }), "PDF");
    await deny(req(`${ORIGIN}/x.js`), res("x", { status: 404 }), "404");
    await deny(req(`${ORIGIN}/x.js`), res("x", { status: 206 }), "parcial");
    await deny(req(`${ORIGIN}/x.js`), res("x", { headers: { vary: "Authorization" } }), "Vary: Authorization");
    await deny(req(`${ORIGIN}/_next/image?url=${encodeURIComponent(`${SUPA}/storage/v1/object/sign/docs/a.png?token=t`)}&w=64`), res("img"), "imagem assinada via otimizador");
    await deny(req(`${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png?token=abc`), res("img"), "token na URL");
    await deny(req(`${SUPA}/rest/v1/students`), res("[]"), "REST");
    await deny(req(`${SUPA}/storage/v1/object/sign/x`), { type: "opaque", status: 0, headers: new Headers() }, "opaca privada");

    await allow(req(`${ORIGIN}/login`), res("<html>", { headers: PUBLIC_PAGE }), "página pública");
    await allow(req(`${ORIGIN}/_next/static/chunks/a.js`), res("js", { headers: { "cache-control": "public, max-age=31536000, immutable" } }), "JS estático");
    await allow(req(`${ORIGIN}/icons/icon-192.png`), res("png", { headers: { "content-type": "image/png" } }), "ícone");
    await allow(req(`${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`), res("png", { headers: { "content-type": "image/png" } }), "logo público");
    const opaque = { type: "opaque", status: 0, headers: new Headers() };
    await allow(req(`${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`), opaque, "logo público opaco (img sem CORS)");
  });
}

test("urlPattern serializado (texto no sw.js) decide igual ao original", () => {
  const serialized = runtimeCaching.map((r) => ({
    ...r,
    urlPattern: vm.runInNewContext(`(${r.urlPattern.toString()})`, { self: { location: { origin: ORIGIN } } }),
  }));
  for (const href of [`${ORIGIN}/api/x`, `${ORIGIN}/login`, `${ORIGIN}/a.js`, `${SUPA}/rest/v1/x`, `${SUPA}/storage/v1/object/public/a.png`, "https://fonts.gstatic.com/a.woff2"]) {
    assert.equal(serialized.indexOf(routeFor(href, serialized)), runtimeCaching.indexOf(routeFor(href)), href);
  }
  // O texto dos plugins não pode conter barra dupla nem comentário de bloco (o Workbox os removeria).
  const body = PRIVATE_RESPONSE_GUARD.cacheWillUpdate.toString();
  assert.ok(!body.includes("//") && !body.includes("/*"), "corpo do guarda sem // ou /*");
});

test("service worker gerado pelo Workbox: rotas NetworkOnly, guarda presente, sem cache 'apis' e código válido", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sw-teste-"));
  try {
    await workboxBuild.generateSW({
      swDest: path.join(dir, "sw.js"),
      globDirectory: dir,
      globPatterns: [],
      mode: "production",
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      inlineWorkboxRuntime: false,
      runtimeCaching,
    });
    const sw = readFileSync(path.join(dir, "sw.js"), "utf8");
    new vm.Script(sw); // sintaxe válida
    assert.match(sw, /NetworkOnly/);
    assert.match(sw, /cacheWillUpdate/);
    assert.match(sw, /storage\/v1\/object\/sign\//);
    assert.match(sw, /no-store\|private/);
    assert.doesNotMatch(sw, /cacheName:\s*"apis"/);
    assert.doesNotMatch(sw, /cacheName:\s*"cross-origin"/);
    assert.doesNotMatch(sw, /cacheName:\s*"others"/);
    assert.ok(readdirSync(dir).some((f) => /^workbox-.*\.js$/.test(f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("atualização: apaga só os caches antigos com dados privados e preserva o restante", async () => {
  const store = new Map(
    ["apis", "cross-origin", "others", "static-js-assets", "static-image-assets", "pages", "workbox-precache-v2-https://appminhaescola.online/", "start-url", "outro-cache-da-origem"].map((n) => [n, {}])
  );
  const fake = {
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  };
  const removed = await cleanupLegacyPrivateCaches(fake);
  assert.deepEqual(removed.sort(), ["apis", "cross-origin", "others"]);
  assert.deepEqual([...store.keys()].sort(), ["outro-cache-da-origem", "pages", "start-url", "static-image-assets", "static-js-assets", "workbox-precache-v2-https://appminhaescola.online/"]);
  // Rodar de novo não faz nada; falhas da API de cache não quebram a ativação.
  assert.deepEqual(await cleanupLegacyPrivateCaches(fake), []);
  assert.deepEqual(await cleanupLegacyPrivateCaches({ keys: async () => { throw new Error("indisponível"); } }), []);
  assert.deepEqual(await cleanupLegacyPrivateCaches(undefined), []);
  const failing = { keys: async () => ["apis"], delete: async () => { throw new Error("falhou"); } };
  assert.deepEqual(await cleanupLegacyPrivateCaches(failing), []);

  // Evento real de ativação: o service worker espera a limpeza terminar (waitUntil).
  const store2 = new Map([["apis", {}], ["pages", {}]]);
  const { listeners } = loadCleanup({ keys: async () => [...store2.keys()], delete: async (n) => store2.delete(n) });
  assert.equal(listeners.activate.length, 1);
  let waited;
  listeners.activate[0]({ waitUntil: (p) => (waited = p) });
  assert.deepEqual(Array.from(await waited), ["apis"]);
  assert.deepEqual([...store2.keys()], ["pages"]);
});

test("configuração ligada: next.config usa a política e inclui a limpeza no service worker", () => {
  const cfg = readFileSync(path.join(REPO, "next.config.js"), "utf8");
  assert.match(cfg, /require\("\.\/pwa\/runtimeCaching"\)/);
  assert.match(cfg, /runtimeCaching,/);
  assert.match(cfg, /importScripts: \["\/sw-cleanup\.js"\]/);
  assert.match(CLEANUP_SRC, /addEventListener\("activate"/);
  const code = CLEANUP_SRC.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /indexedDB|localStorage|sessionStorage|cookie/i, "não toca em outros armazenamentos");
  assert.match(code, /LEGACY_PRIVATE_CACHES\.indexOf\(name\) >= 0/, "apaga só nomes exatos da lista");
});

test("cabeçalho HTTP central: /api/* e rotas de dados respondem private, no-store", async () => {
  const cfg = require("../next.config.js"); // fora de produção: objeto simples, sem next-pwa
  const rules = await cfg.headers();
  for (const source of ["/api/:path*", "/school/classes/list"]) {
    const rule = rules.find((r) => r.source === source);
    assert.ok(rule, source);
    const cc = rule.headers.find((h) => h.key === "Cache-Control").value;
    assert.match(cc, /private/, source);
    assert.match(cc, /no-store/, source);
  }
  // Nenhuma regra de cabeçalho torna páginas ou estáticos privados (instalação/offline preservados).
  assert.ok(!rules.some((r) => r.source === "/:path*" || r.source.startsWith("/_next")));
});

test("áreas autenticadas, login e respostas RSC nunca usam cache; páginas públicas continuam", () => {
  for (const href of [
    `${ORIGIN}/school`,
    `${ORIGIN}/school/students`,
    `${ORIGIN}/school/classes/list`,
    `${ORIGIN}/teacher/classes/abc/diary`,
    `${ORIGIN}/parent`,
    `${ORIGIN}/parent/report-card`,
    `${ORIGIN}/admin-master`,
    `${ORIGIN}/account/change-password`,
    `${ORIGIN}/app`,
    `${ORIGIN}/dev/enroll`,
    `${ORIGIN}/auth/callback?code=abc`,
    `${ORIGIN}/login?_rsc=1a2b`,
    `${ORIGIN}/?_rsc=xyz`,
  ]) {
    assert.equal(routeFor(href).handler, "NetworkOnly", href);
  }
  // Navegação RSC identificada pelo cabeçalho (sem _rsc na URL).
  const rscRoute = runtimeCaching.find((r) =>
    r.urlPattern({ url: new URL(`${ORIGIN}/login`), request: new Request(`${ORIGIN}/login`, { headers: { RSC: "1" } }) })
  );
  assert.equal(rscRoute.handler, "NetworkOnly");
  // Prefixos não confundem rotas públicas parecidas.
  for (const href of [`${ORIGIN}/s/escola/login`, `${ORIGIN}/login`, `${ORIGIN}/schoolar.png`]) {
    assert.notEqual(routeFor(href).handler, "NetworkOnly", href);
  }
});

for (const [label, guard] of [
  ["original", () => PRIVATE_RESPONSE_GUARD],
  ["serializado no sw.js", serializedGuard],
]) {
  test(`guarda (${label}): recusa áreas autenticadas e RSC mesmo com cabeçalho público`, async () => {
    const g = guard().cacheWillUpdate;
    const pub = () => res("<html>", { headers: PUBLIC_PAGE });
    for (const href of [`${ORIGIN}/teacher`, `${ORIGIN}/school/students`, `${ORIGIN}/parent`, `${ORIGIN}/auth/callback`, `${ORIGIN}/login?_rsc=x`]) {
      assert.equal(await g({ request: req(href), response: pub() }), null, href);
    }
    for (const h of ["RSC", "Next-Router-State-Tree", "Next-Router-Prefetch"]) {
      assert.equal(await g({ request: req(`${ORIGIN}/login`, { [h]: "1" }), response: pub() }), null, h);
    }
  });
}

// ---------------------------------------------------------------------------
// Recuperação de senha, parâmetros sensíveis e fotografias pessoais
// ---------------------------------------------------------------------------
const TOKEN_URLS = [
  `${ORIGIN}/reset-password`,
  `${ORIGIN}/reset-password?token_hash=TOKEN-FICTICIO&type=recovery`,
  `${ORIGIN}/reset-password?code=CODIGO-FICTICIO`,
  `${ORIGIN}/forgot-password`,
  `${ORIGIN}/login?code=CODIGO-FICTICIO`,
  `${ORIGIN}/s/escola/login?access_token=A&refresh_token=B`,
  `${ORIGIN}/?otp=123456`,
  `${ORIGIN}/login?id_token=X`,
  `${ORIGIN}/login?provider_token=X`,
  `${ORIGIN}/login?redirect=%2Freset-password%3Ftoken_hash%3DT`, // token aninhado e codificado
];
const PHOTO_URLS = [
  `${SUPA}/storage/v1/object/public/student-photos/escola/aluno.jpg`,
  `${SUPA}/storage/v1/object/public/parent-profile-photos/escola/pai.jpg`,
  `${SUPA}/storage/v1/object/public/teacher-photos/escola/prof.jpg`,
  `${SUPA}/storage/v1/render/image/public/student-photos/escola/aluno.jpg?width=64`,
  `${SUPA}/storage/v1/object/sign/student-photos/escola/aluno.jpg?token=T`,
  `${SUPA}/storage/v1/object/authenticated/student-photos/escola/aluno.jpg`,
];
// Nomes parecidos com os buckets de marca NÃO podem ser tratados como públicos.
const LOOKALIKE_URLS = [
  `${SUPA}/storage/v1/object/public/school-branding-backup/escola/logo.png`,
  `${SUPA}/storage/v1/object/public/school-logos-old/escola/logo.png`,
  `${SUPA}/storage/v1/object/public/student-photos/school-branding/logo.png`,
  `${SUPA}/storage/v1/object/public/Student-photos/school-branding/x.png`,
  `${SUPA}/storage/v1/object/public/school-branding/`,
  `${SUPA}/x/storage/v1/object/public/school-branding/escola/logo.png`,
  `https://supabase.co.atacante.example/storage/v1/object/public/school-branding/escola/logo.png`,
  `https://outro.exemplo/storage/v1/object/public/school-branding/escola/logo.png`,
  `${SUPA}/storage/v1/object/public/school-branding/escola/logo.png?token=T`,
];
const BRANDING_URLS = [
  `${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`,
  `${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/icon/2-icone.png`,
  `${SUPA}/storage/v1/object/public/school-logos/escola-ficticia/logo.png`,
];

test("recuperação de senha e URLs com parâmetro sensível: sempre rede, nunca cache", () => {
  for (const href of TOKEN_URLS) assert.equal(routeFor(href).handler, "NetworkOnly", href);
  // Parâmetros comuns NÃO são confundidos com sensíveis (páginas públicas seguem offline).
  for (const href of [`${ORIGIN}/login?redirect=%2Fteacher`, `${ORIGIN}/s/escola/login?v=3`, `${ORIGIN}/?utm_source=app`, `${ORIGIN}/login?type=professor`]) {
    assert.equal(routeFor(href).options?.cacheName, "pages", href);
  }
});

test("Storage: só os buckets de identidade visual vão para o cache; fotos e parecidos nunca", () => {
  for (const href of BRANDING_URLS) assert.equal(routeFor(href).options?.cacheName, "public-storage-assets", href);
  for (const href of [...PHOTO_URLS, ...LOOKALIKE_URLS]) assert.equal(routeFor(href).handler, "NetworkOnly", href);
});

for (const [label, guard] of [
  ["original", () => PRIVATE_RESPONSE_GUARD],
  ["serializado no sw.js", serializedGuard],
]) {
  test(`guarda (${label}): recusa tokens, fotos pessoais e buckets parecidos; aceita só logos`, async () => {
    const g = guard().cacheWillUpdate;
    const img = () => res("img", { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
    const opaque = () => ({ type: "opaque", status: 0, headers: new Headers() });
    for (const href of TOKEN_URLS) assert.equal(await g({ request: req(href), response: res("<html>", { headers: PUBLIC_PAGE }) }), null, href);
    for (const href of [...PHOTO_URLS, ...LOOKALIKE_URLS]) {
      assert.equal(await g({ request: req(href), response: img() }), null, `${href} (cors)`);
      assert.equal(await g({ request: req(href), response: opaque() }), null, `${href} (opaca)`);
    }
    // Foto pessoal pedida pelo otimizador de imagens do Next também é recusada.
    const viaNextImage = `${ORIGIN}/_next/image?url=${encodeURIComponent(PHOTO_URLS[0])}&w=64&q=75`;
    assert.equal(await g({ request: req(viaNextImage), response: img() }), null, "via /_next/image");
    for (const href of BRANDING_URLS) {
      const r = img();
      assert.equal(await g({ request: req(href), response: r }), r, href);
      const o = opaque();
      assert.equal(await g({ request: req(href), response: o }), o, `${href} (opaca)`);
    }
  });
}

test("urlPattern serializado decide igual ao original também para tokens, fotos e logos", () => {
  const serialized = runtimeCaching.map((r) => ({
    ...r,
    urlPattern: vm.runInNewContext(`(${r.urlPattern.toString()})`, { self: { location: { origin: ORIGIN } }, decodeURIComponent }),
  }));
  for (const href of [...TOKEN_URLS, ...PHOTO_URLS, ...LOOKALIKE_URLS, ...BRANDING_URLS]) {
    assert.equal(serialized.indexOf(routeFor(href, serialized)), runtimeCaching.indexOf(routeFor(href)), href);
  }
  for (const r of runtimeCaching) {
    const body = r.urlPattern.toString();
    assert.ok(!body.includes("//") && !body.includes("/*"), "urlPattern sem // ou /*");
  }
});
