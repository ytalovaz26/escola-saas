import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://appminhaescola.online"),

  title: "Minha Escola | Gestão Escolar Inteligente",

  description:
    "Gestão escolar inteligente para escolas, professores, pais e alunos.",

  manifest: "/manifest.webmanifest",

  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "https://appminhaescola.online",
    siteName: "Minha Escola",
    title: "Minha Escola | Gestão Escolar Inteligente",
    description:
      "Gestão escolar inteligente para escolas, professores, pais e alunos.",
    images: [
      {
        url: "/brand/minha-escola-logo.png",
        alt: "Minha Escola - Gestão Escolar Inteligente",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Minha Escola | Gestão Escolar Inteligente",
    description:
      "Gestão escolar inteligente para escolas, professores, pais e alunos.",
    images: ["/brand/minha-escola-logo.png"],
  },

  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Minha Escola",
  },

  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [{ url: "/icons/icon-192.png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}