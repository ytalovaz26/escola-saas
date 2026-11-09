// pwa/runtimeCaching.js
// Política de cache do service worker (next-pwa / Workbox 6), usada em next.config.js.
//
// Regra principal: NADA privado vai para o Cache Storage.
// - /api/* (dados, PDFs, documentos) e qualquer chamada ao Supabase (REST, Auth, Functions,
//   Storage assinado/autenticado) usam NetworkOnly: nunca são gravadas.
// - Os demais caches passam por PRIVATE_RESPONSE_GUARD, que recusa respostas com
//   Authorization na requisição, Cache-Control private/no-store, PDF, URL assinada/token
//   e status diferente de 200.
// - Áreas autenticadas (/school, /teacher, /parent, /admin-master, /account, /app, /dev),
//   fluxos de login e senha (/auth, /reset-password, /forgot-password), respostas RSC do Next
//   e QUALQUER URL com parâmetro sensível (token, token_hash, code, otp, access/refresh token,
//   apikey, signature...) também usam NetworkOnly e nunca são gravadas.
// - Storage do Supabase: só os buckets de identidade visual (school-branding, school-logos)
//   podem ir para o cache. Fotos pessoais e qualquer outro bucket: sempre rede.
// - Recursos públicos (JS/CSS/fontes/imagens do app, manifest, ícones, páginas públicas,
//   logos em Storage PÚBLICO) continuam em cache para o uso offline do PWA.
//
// ATENÇÃO: as funções abaixo são copiadas como TEXTO para o sw.js gerado. Elas não podem
// usar variáveis externas, e o corpo do plugin não pode conter barra dupla nem abertura de
// comentário de bloco (o Workbox remove comentários do texto dos plugins).
// Testado em tests/pwa-cache-policy.test.mjs (inclusive na forma serializada).

const PRIVATE_RESPONSE_GUARD = {
  cacheWillUpdate: async ({ request, response }) => {
    if (!request || !response) return null;
    let url;
    try {
      url = new URL(request.url);
    } catch (e) {
      return null;
    }
    if (url.pathname.indexOf("/api/") === 0) return null;
    const privatePrefixes = ["/school", "/teacher", "/parent", "/admin-master", "/account", "/app", "/dev", "/auth", "/reset-password", "/forgot-password"];
    for (const prefix of privatePrefixes) {
      if (url.pathname === prefix || url.pathname.indexOf(prefix + "/") === 0) return null;
    }
    if (url.searchParams.has("_rsc")) return null;
    if (request.headers && typeof request.headers.get === "function") {
      if (request.headers.get("rsc") || request.headers.get("next-router-state-tree") || request.headers.get("next-router-prefetch")) return null;
    }
    let full = request.url;
    try {
      full = decodeURIComponent(request.url);
    } catch (e) {
      full = request.url;
    }
    const lower = full.toLowerCase();
    const sensitiveParam = /[?&#]([a-z0-9_.-]*(token|secret|password|signature|jwt|otp|credential)[a-z0-9_.-]*|code|apikey|api_key|key|sig)=/;
    if (sensitiveParam.test(lower)) return null;
    const privateMarkers = ["/rest/v1/", "/auth/v1/", "/functions/v1/", "/graphql/v1/", "/realtime/v1/", "/storage/v1/object/sign/", "/storage/v1/object/authenticated/", "/storage/v1/object/upload/"];
    for (const marker of privateMarkers) {
      if (lower.indexOf(marker) >= 0) return null;
    }
    const seg = url.pathname.split("/");
    const isBrandingAsset =
      /\.supabase\.co$/.test(url.hostname) &&
      seg.length >= 7 &&
      seg[1] === "storage" && seg[2] === "v1" && seg[3] === "object" && seg[4] === "public" &&
      ["school-branding", "school-logos"].indexOf(seg[5]) >= 0 &&
      seg.slice(6).every((s) => s.length > 0);
    if (lower.indexOf("/storage/v1/") >= 0 && !isBrandingAsset) return null;
    if (request.headers && typeof request.headers.has === "function" && request.headers.has("authorization")) return null;
    if (response.type === "opaque") {
      return isBrandingAsset ? response : null;
    }
    if (response.status !== 200) return null;
    const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
    if (/(^|[\s,])(no-store|private)([\s,=]|$)/.test(cacheControl)) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.indexOf("application/pdf") >= 0) return null;
    if (/(^|[\s,])(authorization|cookie)([\s,]|$)/.test(String(response.headers.get("vary") || "").toLowerCase())) return null;
    return response;
  },
};

const DAY = 24 * 60 * 60;

const runtimeCaching = [
  // 1. APIs do próprio app: sempre rede, nunca cache (dados privados, PDFs, documentos).
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.indexOf("/api/") === 0,
    handler: "NetworkOnly",
    method: "GET",
  },
  // 1b. Áreas autenticadas, fluxos de login e respostas RSC (payload de navegação do Next):
  //     sempre rede. Inclui rotas de dados fora de /api (ex.: /school/classes/list).
  {
    urlPattern: ({ url, request }) => {
      if (url.origin !== self.location.origin) return false;
      if (url.searchParams.has("_rsc")) return true;
      if (request && request.headers && (request.headers.get("rsc") || request.headers.get("next-router-state-tree") || request.headers.get("next-router-prefetch"))) return true;
      let full = url.href;
      try {
        full = decodeURIComponent(url.href);
      } catch (e) {
        full = url.href;
      }
      if (/[?&#]([a-z0-9_.-]*(token|secret|password|signature|jwt|otp|credential)[a-z0-9_.-]*|code|apikey|api_key|key|sig)=/.test(full.toLowerCase())) return true;
      const privatePrefixes = ["/school", "/teacher", "/parent", "/admin-master", "/account", "/app", "/dev", "/auth", "/reset-password", "/forgot-password"];
      return privatePrefixes.some((prefix) => url.pathname === prefix || url.pathname.indexOf(prefix + "/") === 0);
    },
    handler: "NetworkOnly",
    method: "GET",
  },
  // 2. Fontes do Google (públicas).
  {
    urlPattern: ({ url }) => url.hostname === "fonts.gstatic.com",
    handler: "CacheFirst",
    options: { cacheName: "google-fonts-webfonts", expiration: { maxEntries: 4, maxAgeSeconds: 365 * DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com",
    handler: "StaleWhileRevalidate",
    options: { cacheName: "google-fonts-stylesheets", expiration: { maxEntries: 4, maxAgeSeconds: 7 * DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  // 3. Identidade visual das escolas (logos/ícones) no Storage PÚBLICO: permitida offline.
  //    Lista FECHADA de buckets, comparada por segmento exato do caminho. Fotos de alunos,
  //    responsáveis e professores (mesmo em buckets públicos) e qualquer outro arquivo do
  //    Storage caem na regra 4 (sempre rede, nunca gravados).
  {
    urlPattern: ({ url }) => {
      if (url.origin === self.location.origin || !/\.supabase\.co$/.test(url.hostname)) return false;
      const seg = url.pathname.split("/");
      const isBranding =
        seg.length >= 7 &&
        seg[1] === "storage" && seg[2] === "v1" && seg[3] === "object" && seg[4] === "public" &&
        ["school-branding", "school-logos"].indexOf(seg[5]) >= 0 &&
        seg.slice(6).every((s) => s.length > 0);
      if (!isBranding) return false;
      let full = url.href;
      try {
        full = decodeURIComponent(url.href);
      } catch (e) {
        full = url.href;
      }
      return !/[?&#]([a-z0-9_.-]*(token|secret|password|signature|jwt|otp|credential)[a-z0-9_.-]*|code|apikey|api_key|key|sig)=/.test(full.toLowerCase());
    },
    handler: "StaleWhileRevalidate",
    options: { cacheName: "public-storage-assets", expiration: { maxEntries: 32, maxAgeSeconds: 7 * DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  // 4. Qualquer outra origem (Supabase REST/Auth/Storage privado, etc.): sempre rede.
  {
    urlPattern: ({ url }) => url.origin !== self.location.origin,
    handler: "NetworkOnly",
    method: "GET",
  },
  // 5. Recursos estáticos do próprio app.
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:eot|otf|ttc|ttf|woff|woff2|font\.css)$/i.test(url.pathname),
    handler: "StaleWhileRevalidate",
    options: { cacheName: "static-font-assets", expiration: { maxEntries: 4, maxAgeSeconds: 7 * DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i.test(url.pathname),
    handler: "StaleWhileRevalidate",
    options: { cacheName: "static-image-assets", expiration: { maxEntries: 64, maxAgeSeconds: DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname === "/_next/image",
    handler: "StaleWhileRevalidate",
    options: { cacheName: "next-image", expiration: { maxEntries: 64, maxAgeSeconds: DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:mp3|wav|ogg)$/i.test(url.pathname),
    handler: "CacheFirst",
    options: { rangeRequests: true, cacheName: "static-audio-assets", expiration: { maxEntries: 32, maxAgeSeconds: DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:mp4)$/i.test(url.pathname),
    handler: "CacheFirst",
    options: { rangeRequests: true, cacheName: "static-video-assets", expiration: { maxEntries: 32, maxAgeSeconds: DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:js)$/i.test(url.pathname),
    handler: "StaleWhileRevalidate",
    options: { cacheName: "static-js-assets", expiration: { maxEntries: 32, maxAgeSeconds: DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:css|less)$/i.test(url.pathname),
    handler: "StaleWhileRevalidate",
    options: { cacheName: "static-style-assets", expiration: { maxEntries: 32, maxAgeSeconds: DAY }, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:json|xml|csv|webmanifest)$/i.test(url.pathname),
    handler: "NetworkFirst",
    options: { cacheName: "static-data-assets", expiration: { maxEntries: 32, maxAgeSeconds: DAY }, networkTimeoutSeconds: 10, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
  // 6. Páginas do app: offline só para o que o servidor marcar como cacheável
  //    (páginas dinâmicas/privadas vêm com no-store e não são gravadas).
  {
    urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.indexOf("/api/") !== 0,
    handler: "NetworkFirst",
    options: { cacheName: "pages", expiration: { maxEntries: 32, maxAgeSeconds: DAY }, networkTimeoutSeconds: 10, plugins: [PRIVATE_RESPONSE_GUARD] },
  },
];

module.exports = { runtimeCaching, PRIVATE_RESPONSE_GUARD };
