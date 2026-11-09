// Service worker em EXECUÇÃO: gera o sw.js com o Workbox (como o next-pwa faz no build) e o roda
// com o runtime real do Workbox num ambiente de service worker simulado (tests/helpers/swRuntime.mjs).
// Compara a política ATUAL de produção (regras padrão do next-pwa) com a NOVA.
// Dados 100% fictícios. Não substitui o teste em navegador real.
// Executar: node --test tests/pwa-sw-runtime.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServiceWorker, FakeCacheStorage, createNetwork, ORIGIN } from "./helpers/swRuntime.mjs";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pwaRequire = createRequire(require.resolve("next-pwa"));
const workboxBuild = pwaRequire("workbox-build");
globalThis.self = { location: { origin: ORIGIN } };
const { runtimeCaching: NOVA } = require("../pwa/runtimeCaching.js");
const ANTIGA = pwaRequire("./cache.js"); // regras padrão do next-pwa 5.6 = produção atual
const SUPA = "https://ficticio.supabase.co";

// Mesma rota "start-url" que o next-pwa acrescenta (next-pwa/index.js, dynamicStartUrl).
const START_URL = {
  urlPattern: "/",
  handler: "NetworkFirst",
  options: {
    cacheName: "start-url",
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response && response.type === "opaqueredirect" ? new Response(response.body, { status: 200, statusText: "OK", headers: response.headers }) : response,
      },
    ],
  },
};

const dirs = {};
async function buildSW(name, runtimeCaching, { withCleanup }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
  fs.mkdirSync(path.join(dir, "icons"));
  for (const f of ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"]) fs.copyFileSync(path.join(REPO, "public", f), path.join(dir, f));
  if (withCleanup) fs.copyFileSync(path.join(REPO, "public/sw-cleanup.js"), path.join(dir, "sw-cleanup.js"));
  await workboxBuild.generateSW({
    swDest: path.join(dir, "sw.js"),
    globDirectory: dir,
    globPatterns: ["manifest.webmanifest", "icons/*.png"],
    mode: "production",
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    inlineWorkboxRuntime: false,
    importScripts: withCleanup ? ["/sw-cleanup.js"] : [],
    runtimeCaching: [START_URL, ...runtimeCaching],
  });
  return dir;
}
before(async () => {
  dirs.nova = await buildSW("nova", NOVA, { withCleanup: true });
  dirs.antiga = await buildSW("antiga", ANTIGA, { withCleanup: false });
});
after(() => Object.values(dirs).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// ---------------------------------------------------------------------------
// Servidor fictício: respostas dependem do token (usuário) e do estado (escola, revogação)
// ---------------------------------------------------------------------------
const USERS = {
  "tok-prof-alfa": { nome: "Professora Ficticia Alfa", papel: "professor", escola: "Escola Alfa" },
  "tok-pai-alfa": { nome: "Responsavel Ficticio Alfa", papel: "responsavel", escola: "Escola Alfa" },
  "tok-dir-beta": { nome: "Diretor Ficticio Beta", papel: "diretor", escola: "Escola Beta" },
};
const PRIVADOS = [...Object.values(USERS).map((u) => u.nome), "Aluno Ficticio Um", "Escola Alfa", "Escola Beta", "%PDF-boletim"];
const HTML_PUBLICO = { "content-type": "text/html; charset=utf-8", "cache-control": "s-maxage=31536000" }; // como o Next envia páginas estáticas
const PRIVATE_API = { "content-type": "application/json", "cache-control": "private, no-store, no-cache, max-age=0, must-revalidate" };

function servidor(state = {}) {
  return (request) => {
    const url = new URL(request.url);
    const tok = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    const user = USERS[tok];
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: PRIVATE_API });
    if (url.origin === ORIGIN) {
      const p = url.pathname;
      if (p === "/api/me") return user ? json({ ...user, escola: state.escolaDe?.[tok] || user.escola }) : json({ error: "401" }, 401);
      if (p === "/api/teacher/class-students") {
        if (!user || user.papel !== "professor" || state.revogado?.[tok]) return json({ ok: false, error: "Professor sem vínculo ativo com esta turma." }, 403);
        return json({ ok: true, alunos: ["Aluno Ficticio Um"] });
      }
      if (p === "/api/parent/report-card/pdf") return user ? new Response("%PDF-boletim " + user.nome, { headers: { "content-type": "application/pdf", "cache-control": "private, no-store" } }) : json({}, 401);
      if (p === "/school/classes/list") return user ? json({ turmas: ["1 Ano A"], escola: user.escola }) : json({}, 401);
      if (url.searchParams.has("_rsc") || request.headers.get("rsc")) return new Response("0:rsc-payload", { headers: { "content-type": "text/x-component", "cache-control": "s-maxage=31536000" } });
      if (/^\/(login|teacher|school|parent|reset-password|forgot-password)?$/.test(p) || p.startsWith("/teacher/") || p.startsWith("/s/")) return new Response(`<html>${p}</html>`, { headers: HTML_PUBLICO });
      if (p.endsWith(".js")) return new Response("console.log(1)", { headers: { "content-type": "application/javascript", "cache-control": "public, max-age=31536000, immutable" } });
      if (p.endsWith(".png") || p === "/manifest.webmanifest" || p === "/sw-cleanup.js") return new Response("publico", { headers: { "cache-control": "public, max-age=0" } });
    }
    if (url.origin === SUPA) {
      if (url.pathname === "/auth/v1/user") return user ? json({ email: `${user.papel}@ficticio.test`, nome: user.nome }) : json({}, 401);
      if (/^\/storage\/v1\/object\/public\/(school-branding|school-logos)\//.test(url.pathname)) return new Response("logo-publico", { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
      if (url.pathname.startsWith("/storage/v1/")) return new Response("FOTO-PESSOAL-FICTICIA " + url.pathname, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
      if (url.pathname.startsWith("/storage/v1/object/sign/")) return new Response("%PDF-boletim documento", { headers: { "content-type": "application/pdf" } });
    }
    return new Response("nao encontrado", { status: 404 });
  };
}

async function sw(versao, state, opts = {}) {
  const network = createNetwork();
  network.handler = servidor(state);
  const w = await loadServiceWorker(dirs[versao], { network, caches: opts.caches || new FakeCacheStorage() });
  await w.install();
  await w.activate();
  return w;
}
const auth = (tok) => ({ headers: { authorization: `Bearer ${tok}` } });
const body = async (r) => (r.response ? r.response.clone().text() : null);
async function semDadosPrivadosNoCache(w, label) {
  const bodies = (await w.caches.allBodies()).join("\n");
  for (const p of PRIVADOS) assert.ok(!bodies.includes(p), `${label}: Cache Storage contém "${p}"`);
  assert.ok(!w.caches.allUrls().some((u) => new URL(u).pathname.startsWith("/api/")), `${label}: URL de /api no cache`);
}

// ---------------------------------------------------------------------------
// Reprodução da vulnerabilidade na política ATUAL de produção (deve vazar)
// ---------------------------------------------------------------------------
test("política ATUAL (produção): reproduz o vazamento entre usuários no mesmo aparelho", async () => {
  const w = await sw("antiga", {});
  const a = await w.request("/api/me", auth("tok-prof-alfa"));
  assert.match(await body(a), /Professora Ficticia Alfa/);
  assert.ok(w.caches.snapshot().apis?.some((u) => u.endsWith("/api/me")), "API gravada no cache 'apis'");
  w.network.online = false; // rede cai (ou demora mais de 10 s)
  const b = await w.request("/api/me", auth("tok-pai-alfa")); // OUTRO usuário
  assert.match(await body(b), /Professora Ficticia Alfa/, "o responsável recebeu os dados da professora");
  w.network.online = true;
  await w.request(`${SUPA}/auth/v1/user`, auth("tok-prof-alfa"));
  assert.ok(w.caches.snapshot()["cross-origin"]?.length, "resposta do Supabase Auth gravada");
});

// ---------------------------------------------------------------------------
// Política NOVA
// ---------------------------------------------------------------------------
test("APIs privadas nunca são armazenadas nem servidas do cache (inclui PDF)", async () => {
  const w = await sw("nova", {});
  for (const [href, tok] of [["/api/me", "tok-prof-alfa"], ["/api/teacher/class-students?classId=1", "tok-prof-alfa"], ["/api/parent/report-card/pdf?studentId=1&term=1", "tok-pai-alfa"]]) {
    const r = await w.request(href, auth(tok));
    assert.equal(r.response.status, 200, href);
  }
  await semDadosPrivadosNoCache(w, "online");
  w.network.online = false;
  for (const href of ["/api/me", "/api/teacher/class-students?classId=1", "/api/parent/report-card/pdf?studentId=1&term=1"]) {
    const r = await w.request(href, auth("tok-pai-alfa"));
    assert.ok(r.error && !r.response, `${href}: offline deve falhar, não servir cópia`);
  }
});

test("respostas de professor nunca aparecem para o responsável (online e offline)", async () => {
  const w = await sw("nova", {});
  const prof = await w.request("/api/teacher/class-students?classId=1", auth("tok-prof-alfa"));
  assert.match(await body(prof), /Aluno Ficticio Um/);
  const paiOnline = await w.request("/api/teacher/class-students?classId=1", auth("tok-pai-alfa"));
  assert.equal(paiOnline.response.status, 403);
  assert.doesNotMatch(await body(paiOnline), /Aluno Ficticio Um/);
  w.network.online = false;
  const paiOffline = await w.request("/api/teacher/class-students?classId=1", auth("tok-pai-alfa"));
  assert.ok(paiOffline.error && !paiOffline.response);
});

test("troca de escola: dados de uma escola nunca aparecem na outra", async () => {
  const state = { escolaDe: {} };
  const w = await sw("nova", state);
  assert.match(await body(await w.request("/api/me", auth("tok-prof-alfa"))), /Escola Alfa/);
  state.escolaDe["tok-prof-alfa"] = "Escola Beta"; // vínculo mais recente passa a ser a Beta
  const depois = await w.request("/api/me", auth("tok-prof-alfa"));
  assert.match(await body(depois), /Escola Beta/);
  assert.doesNotMatch(await body(depois), /Escola Alfa/);
  w.network.online = false;
  const off = await w.request("/api/me", auth("tok-prof-alfa"));
  assert.ok(off.error && !off.response, "offline não entrega a escola anterior");
  await semDadosPrivadosNoCache(w, "troca de escola");
});

test("logout/troca de usuário: nada privado do usuário anterior fica reutilizável", async () => {
  const w = await sw("nova", {});
  await w.request("/api/me", auth("tok-prof-alfa"));
  await w.request(`${SUPA}/auth/v1/user`, auth("tok-prof-alfa"));
  await w.request("/school/classes/list", auth("tok-prof-alfa"));
  // logout + login de outro usuário: o SW não depende de limpeza no logout
  for (const online of [true, false]) {
    w.network.online = online;
    for (const href of ["/api/me", `${SUPA}/auth/v1/user`, "/school/classes/list"]) {
      const r = await w.request(href, auth("tok-dir-beta"));
      if (online) assert.doesNotMatch(await body(r), /Professora Ficticia Alfa/, href);
      else assert.ok(r.error && !r.response, `${href} offline`);
    }
  }
  await semDadosPrivadosNoCache(w, "logout");
});

test("revogação de acesso: resposta anterior não é recuperável pelo service worker", async () => {
  const state = { revogado: {} };
  const w = await sw("nova", state);
  assert.equal((await w.request("/api/teacher/class-students?classId=1", auth("tok-prof-alfa"))).response.status, 200);
  state.revogado["tok-prof-alfa"] = true;
  const online = await w.request("/api/teacher/class-students?classId=1", auth("tok-prof-alfa"));
  assert.equal(online.response.status, 403);
  assert.doesNotMatch(await body(online), /Aluno Ficticio Um/);
  w.network.online = false;
  const offline = await w.request("/api/teacher/class-students?classId=1", auth("tok-prof-alfa"));
  assert.ok(offline.error && !offline.response);
});

test("atualização: caches antigos com dados privados são apagados; estáticos preservados", async () => {
  // Aparelho que usava a versão atual: caches no formato do next-pwa padrão.
  const caches = new FakeCacheStorage();
  const put = async (name, href, text) => (await caches.open(name)).put(new Request(new URL(href, ORIGIN).href), new Response(text));
  await put("apis", "/api/me", "Professora Ficticia Alfa");
  await put("apis", "/api/parent/report-card/pdf?studentId=1", "%PDF-boletim");
  await put("others", "/teacher", "<html>Professora Ficticia Alfa</html>");
  await put("others", "/school/classes/list", "Escola Alfa");
  await put("cross-origin", `${SUPA}/auth/v1/user`, "Professora Ficticia Alfa");
  await put("static-js-assets", "/_next/static/chunks/a.js", "console.log(1)");
  await put("start-url", "/", "<html>/</html>");
  const w = await sw("nova", {}, { caches });
  const nomes = await caches.keys();
  for (const legado of ["apis", "others", "cross-origin"]) assert.ok(!nomes.includes(legado), `${legado} deveria ser apagado`);
  assert.ok(nomes.includes("static-js-assets") && nomes.includes("start-url"), "caches públicos preservados");
  await semDadosPrivadosNoCache(w, "após atualização");
  w.network.online = false;
  const r = await w.request("/api/me", auth("tok-dir-beta"));
  assert.ok(r.error && !r.response, "nenhum resto da versão antiga é servido");
});

test("recursos estáticos públicos continuam funcionando, inclusive offline", async () => {
  const w = await sw("nova", {});
  const publicos = ["/_next/static/chunks/app-123.js", "/login", "/", "/s/escola-ficticia/login", `${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`];
  for (const href of publicos) assert.equal((await w.request(href)).response.status, 200, href);
  w.network.online = false;
  for (const href of [...publicos, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]) {
    const r = await w.request(href);
    assert.ok(r.response && r.response.status === 200, `${href} offline: ${r.error}`);
  }
});

test("páginas autenticadas, RSC e rotas de dados fora de /api não são persistidas", async () => {
  const w = await sw("nova", {});
  for (const [href, init] of [
    ["/teacher", {}],
    ["/teacher/classes/abc/diary", {}],
    ["/school", {}],
    ["/parent", {}],
    ["/login?_rsc=a1", { headers: { RSC: "1" } }],
    ["/?_rsc=b2", { headers: { RSC: "1" } }],
    ["/school/classes/list", auth("tok-prof-alfa")],
  ]) {
    assert.equal((await w.request(href, init)).response.status, 200, href);
  }
  const salvos = w.caches.allUrls().map((u) => new URL(u));
  assert.ok(!salvos.some((u) => /^\/(teacher|school|parent)(\/|$)/.test(u.pathname)), "página autenticada gravada");
  assert.ok(!salvos.some((u) => u.searchParams.has("_rsc")), "resposta RSC gravada");
  await semDadosPrivadosNoCache(w, "páginas");
  w.network.online = false;
  for (const href of ["/teacher", "/school/classes/list"]) assert.ok((await w.request(href)).error, `${href} offline não usa cópia`);
});

test("Supabase: Auth, REST e URLs assinadas nunca vão para o cache; Storage público sim", async () => {
  const w = await sw("nova", {});
  await w.request(`${SUPA}/auth/v1/user`, auth("tok-prof-alfa"));
  await w.request(`${SUPA}/storage/v1/object/sign/docs/escola/aluno/boletim.pdf?token=abc`);
  await w.request(`${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`);
  const urls = w.caches.allUrls();
  assert.ok(!urls.some((u) => u.includes("/auth/v1/") || u.includes("/object/sign/")));
  assert.ok(urls.some((u) => u.includes("/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png")));
});

test("offline seguro: dados privados falham de forma explícita; nenhum resto é servido", async () => {
  const w = await sw("nova", {});
  await w.request("/api/me", auth("tok-prof-alfa"));
  w.network.online = false;
  const tentativas = ["/api/me", "/api/teacher/class-students?classId=1", "/api/parent/report-card/pdf?studentId=1", "/school/classes/list", `${SUPA}/auth/v1/user`, "/teacher"];
  for (const href of tentativas) {
    const r = await w.request(href, auth("tok-prof-alfa"));
    assert.ok(r.error && !r.response, `${href} offline`);
  }
});

test("PWA instalável: manifest, ícones e registro não são afetados pela política de cache", async () => {
  // Observação: o CONTEÚDO de public/icons/*.png está vazio desde o commit 56e1e14 (defeito anterior,
  // fora do escopo desta correção). Aqui se verifica o que a política pode afetar: manifest, ícones e
  // service worker continuam servidos (inclusive offline) exatamente como o servidor os entrega.
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "public/manifest.webmanifest"), "utf8"));
  assert.ok(manifest.name && manifest.short_name, "nome");
  assert.equal(manifest.start_url, "/");
  assert.match(manifest.display, /standalone|fullscreen|minimal-ui/);
  for (const size of ["192x192", "512x512"]) {
    const icon = manifest.icons.find((i) => i.sizes === size);
    assert.ok(icon, size);
    assert.ok(fs.existsSync(path.join(REPO, "public", icon.src.replace(/^\//, ""))), icon.src);
    assert.notEqual(NOVA.find((r) => r.urlPattern({ url: new URL(icon.src, ORIGIN), request: new Request(new URL(icon.src, ORIGIN)) })).handler, "NetworkOnly");
  }
  // Manifest de cada escola (gerado no servidor) continua acessível e cacheável como público.
  const escola = NOVA.find((r) => r.urlPattern({ url: new URL("/s/escola-ficticia/manifest?v=1", ORIGIN), request: new Request(`${ORIGIN}/s/escola-ficticia/manifest?v=1`) }));
  assert.equal(escola.options.cacheName, "pages");
  const cfg = fs.readFileSync(path.join(REPO, "next.config.js"), "utf8");
  assert.match(cfg, /register: true/);
  assert.match(cfg, /dest: "public"/);
  // O service worker novo instala, ativa e responde a eventos fetch (requisito de instalação).
  const w = await sw("nova", {});
  assert.ok(w.listeners.fetch?.length >= 1);
  const precache = Object.entries(w.caches.snapshot()).find(([n]) => n.startsWith("workbox-precache"));
  assert.ok(precache && precache[1].some((u) => u.includes("manifest.webmanifest")) && precache[1].some((u) => u.includes("icon-512.png")));
});

// ---------------------------------------------------------------------------
// Regressão: recuperação de senha, fotografias pessoais e logotipos públicos
// ---------------------------------------------------------------------------
const RECUPERACAO = [
  "/reset-password?token_hash=TOKEN-FICTICIO-RECUPERACAO&type=recovery",
  "/reset-password?code=CODIGO-FICTICIO-PKCE",
  "/forgot-password",
  "/reset-password",
];
const FOTOS = [
  `${SUPA}/storage/v1/object/public/student-photos/escola/aluno.jpg`,
  `${SUPA}/storage/v1/object/public/parent-profile-photos/escola/pai.jpg`,
  `${SUPA}/storage/v1/object/public/teacher-photos/escola/prof.jpg`,
  `${SUPA}/storage/v1/object/public/school-branding-backup/escola/foto.jpg`,
  `${SUPA}/storage/v1/render/image/public/student-photos/escola/aluno.jpg?width=64`,
  `${SUPA}/storage/v1/object/sign/student-photos/escola/aluno.jpg?token=T`,
];
const LOGO = `${SUPA}/storage/v1/object/public/school-branding/escola-ficticia/logo/1-logo.png`;
const tokensOuFotosNoCache = async (w) => {
  const urls = w.caches.allUrls().filter((u) => /token_hash|code=|reset-password|forgot-password|student-photos|parent-profile-photos|teacher-photos|branding-backup/.test(u));
  const bodies = (await w.caches.allBodies()).filter((b) => /FOTO-PESSOAL|TOKEN-FICTICIO/.test(b));
  return [...urls, ...bodies];
};

test("recuperação de senha funciona com rede e nenhum token fica no Cache Storage", async () => {
  const w = await sw("nova", {});
  for (const href of RECUPERACAO) {
    const r = await w.request(href);
    assert.equal(r.response?.status, 200, `${href} online`);
  }
  assert.deepEqual(await tokensOuFotosNoCache(w), []);
  w.network.online = false;
  for (const href of RECUPERACAO) assert.ok((await w.request(href)).error, `${href} offline não usa cópia`);
});

test("token de recuperação guardado pela versão antiga é apagado na atualização e nunca servido", async () => {
  const caches = new FakeCacheStorage();
  await (await caches.open("others")).put(new Request(`${ORIGIN}${RECUPERACAO[0]}`), new Response("<html>reset</html>"));
  await (await caches.open("cross-origin")).put(new Request(FOTOS[0]), new Response("FOTO-PESSOAL-FICTICIA"));
  const w = await sw("nova", {}, { caches });
  assert.deepEqual(await tokensOuFotosNoCache(w), []);
  w.network.online = false;
  assert.ok((await w.request(RECUPERACAO[0])).error);
  assert.ok((await w.request(FOTOS[0])).error);
});

test("fotografias pessoais não são guardadas nem entregues a outro usuário pelo cache", async () => {
  const w = await sw("nova", {});
  for (const href of FOTOS) {
    const r = await w.request(href, auth("tok-prof-alfa"));
    assert.equal(r.response?.status, 200, `${href} aparece com rede`);
  }
  assert.deepEqual(await tokensOuFotosNoCache(w), []);
  w.network.online = false; // outro usuário, mesmo aparelho, sem rede
  for (const href of FOTOS) {
    const r = await w.request(href, auth("tok-pai-alfa"));
    assert.ok(r.error && !r.response, `${href} offline`);
  }
});

test("logotipos públicos das escolas continuam funcionando, inclusive offline", async () => {
  const w = await sw("nova", {});
  assert.equal((await w.request(LOGO)).response.status, 200);
  assert.ok(w.caches.snapshot()["public-storage-assets"]?.includes(LOGO), "logo no cache público");
  w.network.online = false;
  const off = await w.request(LOGO);
  assert.equal(off.response?.status, 200);
  assert.equal(await off.response.text(), "logo-publico");
});
