/** @type {import('next').NextConfig} */

// Importa o next-pwa apenas quando for produção
const isProd = process.env.NODE_ENV === "production";

let nextConfig = {
  reactStrictMode: true,

  // ✅ resolve o erro do PDFKit (Helvetica.afm) no Next (server)
  serverExternalPackages: ["pdfkit"],
};

if (isProd) {
  const withPWA = require("next-pwa")({
    dest: "public",
    register: true,
    skipWaiting: true,
  });

  nextConfig = withPWA(nextConfig);
}

module.exports = nextConfig;
