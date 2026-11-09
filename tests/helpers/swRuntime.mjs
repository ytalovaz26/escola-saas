// Ambiente de SERVICE WORKER simulado para testes (somente testes, sem navegador, sem rede real).
//
// Executa o sw.js GERADO e o runtime REAL do Workbox num contexto isolado (node:vm) com:
//   - Cache Storage em memória (conservador: ignora Vary, como o pior caso);
//   - rede controlada pelo teste (online/offline, resposta por requisição);
//   - eventos install / activate / fetch com waitUntil e respondWith.
// Única adaptação: ExpirationPlugin (validade/limite de entradas, depende de IndexedDB) vira um
// plugin vazio. Ele não decide SE uma resposta é guardada, só por quanto tempo.
// Não substitui o teste em navegador real.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const ORIGIN = "https://appminhaescola.online";

class FakeCache {
  constructor() {
    this.entries = new Map(); // url -> Response
  }
  _key(request) {
    return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
  }
  async match(request, options = {}) {
    const key = this._key(request);
    if (this.entries.has(key)) return this.entries.get(key).clone();
    if (options.ignoreSearch) {
      const base = key.split("?")[0];
      for (const [k, v] of this.entries) if (k.split("?")[0] === base) return v.clone();
    }
    return undefined;
  }
  async matchAll() {
    return [...this.entries.values()].map((r) => r.clone());
  }
  async put(request, response) {
    this.entries.set(this._key(request), response.clone());
  }
  async add(request) {
    throw new Error(`add não suportado: ${this._key(request)}`);
  }
  async delete(request) {
    return this.entries.delete(this._key(request));
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
}

export class FakeCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async has(name) {
    return this.caches.has(name);
  }
  async delete(name) {
    return this.caches.delete(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async match(request, options) {
    for (const c of this.caches.values()) {
      const r = await c.match(request, options);
      if (r) return r;
    }
    return undefined;
  }
  /** Todas as URLs guardadas, por cache (para asserções). */
  snapshot() {
    return Object.fromEntries([...this.caches].map(([n, c]) => [n, [...c.entries.keys()]]));
  }
  allUrls() {
    return [...this.caches.values()].flatMap((c) => [...c.entries.keys()]);
  }
  /** Corpos de TODAS as respostas guardadas (para procurar dados privados). */
  async allBodies() {
    const out = [];
    for (const c of this.caches.values()) for (const r of c.entries.values()) out.push(await r.clone().text());
    return out;
  }
}

export function createNetwork() {
  const net = {
    online: true,
    log: [],
    handler: () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      net.log.push(request.url);
      if (!net.online) throw new TypeError("Failed to fetch");
      return net.handler(request);
    },
  };
  return net;
}

/**
 * Carrega o service worker de `dir` (sw.js + workbox-*.js + scripts importados) e devolve
 * funções para instalar, ativar e enviar requisições como o navegador faria.
 */
export async function loadServiceWorker(dir, { caches = new FakeCacheStorage(), network = createNetwork() } = {}) {
  const listeners = {};
  class ExtendableEvent {
    constructor(type) {
      this.type = type;
      this._waits = [];
    }
    waitUntil(p) {
      this._waits.push(Promise.resolve(p));
    }
  }
  class FetchEvent extends ExtendableEvent {
    constructor(type, init) {
      super(type);
      this.request = init.request;
      this.clientId = "";
      this.resultingClientId = "";
      this.preloadResponse = Promise.resolve(undefined);
      this._response = null;
    }
    respondWith(p) {
      this._response = Promise.resolve(p);
    }
  }

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {}, info() {}, groupCollapsed() {}, groupEnd() {} },
    // APIs web do Node. Construtores nativos (RegExp, Array, Promise...) NÃO são repassados: o
    // contexto tem os seus, e misturar os dois quebraria "instanceof" dentro do Workbox.
    URL, URLSearchParams, Request, Response, Headers, Blob, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, queueMicrotask, structuredClone, AbortController, AbortSignal,
    decodeURIComponent, encodeURIComponent,
    ExtendableEvent, FetchEvent,
    caches,
    fetch: (...a) => network.fetch(...a),
    origin: ORIGIN, // self.origin (usado pelas regras padrão do next-pwa)
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js`, protocol: "https:", host: new URL(ORIGIN).host },
    registration: { scope: `${ORIGIN}/`, navigationPreload: undefined },
    clients: { claim: async () => {}, matchAll: async () => [] },
    navigator: { userAgent: "teste" },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    removeEventListener() {},
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...urls) => {
    for (const u of urls) {
      const file = path.join(dir, path.basename(new URL(u, ORIGIN).pathname));
      let src = fs.readFileSync(file, "utf8");
      vm.runInContext(src, ctx, { filename: file });
    }
  };
  const ctx = vm.createContext(sandbox);

  let swSrc = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  swSrc = swSrc.replace(/new (\w+)\.ExpirationPlugin\(/g, "new (class{})(");
  vm.runInContext(swSrc, ctx, { filename: path.join(dir, "sw.js") });
  // O carregador AMD do sw.js resolve o runtime do Workbox de forma assíncrona.
  for (let i = 0; i < 50 && !(listeners.fetch && listeners.fetch.length); i++) await new Promise((r) => setTimeout(r, 5));
  if (!listeners.fetch?.length) throw new Error("service worker não registrou o evento fetch");

  async function dispatch(type, event) {
    for (const fn of listeners[type] || []) fn(event);
    await Promise.allSettled(event._waits);
    // Rejeições de waitUntil viram falha visível no teste.
    for (const r of await Promise.allSettled(event._waits)) if (r.status === "rejected") throw r.reason;
    return event;
  }

  return {
    caches,
    network,
    listeners,
    async install() {
      await dispatch("install", new ExtendableEvent("install"));
    },
    async activate() {
      await dispatch("activate", new ExtendableEvent("activate"));
    },
    /** Envia uma requisição pelo SW. Retorna { response } ou { error } (como o navegador veria). */
    async request(href, init = {}) {
      const request = new Request(new URL(href, ORIGIN).href, init);
      const event = new FetchEvent("fetch", { request });
      for (const fn of listeners.fetch || []) fn(event);
      let response = null;
      let error = null;
      if (event._response) {
        try {
          response = await event._response;
        } catch (e) {
          error = e;
        }
      } else {
        // SW não respondeu: o navegador vai direto à rede.
        try {
          response = await network.fetch(request);
        } catch (e) {
          error = e;
        }
      }
      await Promise.allSettled(event._waits); // gravações em segundo plano (cache) terminam aqui
      return { response, error, handledBySW: Boolean(event._response) };
    },
  };
}
