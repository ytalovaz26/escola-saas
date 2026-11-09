/** @type {import('next').NextConfig} */

// Importa o next-pwa apenas quando for produção
const isProd = process.env.NODE_ENV === "production";

let nextConfig = {
  reactStrictMode: true,

  // ✅ resolve o erro do PDFKit (Helvetica.afm) no Next (server)
  serverExternalPackages: ["pdfkit"],

  // Respostas de dados são privadas: nenhum cache HTTP (navegador, proxy, CDN) pode guardá-las.
  // Complementa a política do service worker (pwa/runtimeCaching.js).
  async headers() {
    const privateNoStore = [
      { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ];
    return [
      { source: "/api/:path*", headers: privateNoStore },
      { source: "/school/classes/list", headers: privateNoStore },
    ];
  },
};

if (isProd) {
  // Política de cache segura: nada privado (/api/*, PDFs, documentos, Supabase) no Cache
  // Storage; recursos públicos continuam offline. Caches antigos com dados privados são
  // apagados na ativação (public/sw-cleanup.js). Ver pwa/runtimeCaching.js.
  const { runtimeCaching } = require("./pwa/runtimeCaching");
  const withPWA = require("next-pwa")({
    dest: "public",
    register: true,
    skipWaiting: true,
    runtimeCaching,
    importScripts: ["/sw-cleanup.js"],
  });

  nextConfig = withPWA(nextConfig);
}

module.exports = nextConfig;
