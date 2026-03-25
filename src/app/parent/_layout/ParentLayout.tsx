"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: { parentId: string; schoolId: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-sm ${
        active ? "bg-gray-900 text-white" : "hover:bg-gray-100 text-gray-700"
      }`}
    >
      {label}
    </Link>
  );
}

function withCacheBuster(url: string) {
  const hasQuery = url.includes("?");
  return url + (hasQuery ? "&" : "?") + "v=" + Date.now();
}

function isHttpUrl(url: string) {
  return url.startsWith("https://") || url.startsWith("http://");
}

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [me, setMe] = useState<MePayload | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  const brandTitle = useMemo(() => {
    const name = me?.branding?.brandName?.trim();
    return name || "Portal do Responsável";
  }, [me]);

  const rawLogoUrl = me?.branding?.brandLogoUrl?.trim() || "";

  // ✅ garante que NUNCA vira "/logo.jpg"
  const brandLogoUrl = useMemo(() => {
    if (!rawLogoUrl) return null;
    if (!isHttpUrl(rawLogoUrl)) return null;
    return withCacheBuster(rawLogoUrl);
  }, [rawLogoUrl]);

  // ✅ se mudou a URL, tenta de novo (não fica “travado quebrado”)
  useEffect(() => {
    setLogoBroken(false);
  }, [brandLogoUrl]);

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = { ok: false, error: text || "Resposta inválida do servidor" };
        }

        if (!res.ok || !json?.ok) {
          router.replace("/login");
          return;
        }

        if (!json?.parent?.parentId) {
          router.replace(json?.redirectTo || "/login");
          return;
        }

        setMe(json as MePayload);
      } catch {
        router.replace("/login");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const items = [
    { href: "/parent", label: "Início" },
    { href: "/parent/children", label: "Filhos" },
    { href: "/parent/calendar", label: "Agenda" },
    { href: "/parent/messages", label: "Mensagens" },
    { href: "/parent/invoices", label: "Mensalidades" },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {brandLogoUrl && !logoBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogoUrl}
                alt="Logo da escola"
                className="h-10 w-10 rounded-xl object-cover border bg-white"
                onError={() => {
                  console.error("Falha ao carregar logo:", brandLogoUrl);
                  setLogoBroken(true);
                }}
              />
            ) : (
              <div className="h-10 w-10 rounded-xl bg-gray-100 border flex items-center justify-center text-xs text-gray-500">
                Logo
              </div>
            )}

            <div className="min-w-0">
              <div className="font-semibold truncate">{brandTitle}</div>
              <div className="text-xs text-gray-600 truncate">
                {me?.user?.email ?? "Carregando..."}
              </div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-2">
            {items.map((it) => (
              <NavLink
                key={it.href}
                href={it.href}
                label={it.label}
                active={pathname === it.href}
              />
            ))}
            <button
              onClick={logout}
              className="ml-2 px-3 py-2 rounded-xl text-sm border hover:bg-gray-50"
            >
              Sair
            </button>
          </nav>

          <div className="md:hidden flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-xl border text-sm"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Abrir menu"
            >
              Menu
            </button>
            <button onClick={logout} className="px-3 py-2 rounded-xl border text-sm">
              Sair
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t bg-white">
            <div className="max-w-5xl mx-auto p-3 flex flex-col gap-2">
              {items.map((it) => (
                <NavLink
                  key={it.href}
                  href={it.href}
                  label={it.label}
                  active={pathname === it.href}
                  onClick={() => setMenuOpen(false)}
                />
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="max-w-5xl mx-auto p-4">{children}</div>
    </main>
  );
}