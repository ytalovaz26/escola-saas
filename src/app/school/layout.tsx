"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type BrandingPayload = {
  brandName: string | null;
  brandLogoUrl: string | null;
  brandIconUrl: string | null;
};

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  branding?: BrandingPayload;
  redirectTo: string;
};

type NavItem = {
  label: string;
  href: string;
  icon: string;
  section: "principal" | "operacao" | "configuracao";
};

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "ES";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function getRoleLabel(role?: string) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "Diretor";
  if (r === "coordenador" || r === "coordinator") return "Coordenador";
  if (r === "admin") return "Administrador";

  return "Gestão Escolar";
}

function isActive(pathname: string, href: string) {
  if (href === "/school") return pathname === "/school";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavSection({
  title,
  items,
  pathname,
  onGo,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onGo: (href: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {title}
      </div>

      <nav className="space-y-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);

          return (
            <button
              key={item.href}
              type="button"
              onClick={() => onGo(item.href)}
              className={[
                "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition",
                active
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-700 hover:bg-slate-100",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-xl text-base transition",
                  active
                    ? "bg-white/10 text-white"
                    : "bg-slate-100 text-slate-700 group-hover:bg-slate-200",
                ].join(" ")}
              >
                {item.icon}
              </span>

              <div className="min-w-0">
                <div className="truncate font-medium">{item.label}</div>
              </div>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function SchoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [menuOpen, setMenuOpen] = useState(false);
  const [me, setMe] = useState<MePayload | null>(null);

  const brandName = me?.branding?.brandName || "Minha Escola";
  const logoUrl = me?.branding?.brandLogoUrl || null;
  const roleLabel = getRoleLabel(me?.school?.role);
  const userEmail = me?.user?.email || "Acesso escolar";

  const navItems: NavItem[] = useMemo(
    () => [
      { label: "Dashboard", href: "/school", icon: "🏠", section: "principal" },
      { label: "Turmas", href: "/school/classes", icon: "🏫", section: "principal" },
      { label: "Alunos", href: "/school/students", icon: "🎓", section: "principal" },
      { label: "Matrículas", href: "/school/enrollments", icon: "🧾", section: "principal" },

      { label: "Responsáveis", href: "/school/parents", icon: "👨‍👩‍👧‍👦", section: "operacao" },
      { label: "Professores", href: "/school/teachers", icon: "👩‍🏫", section: "operacao" },
      { label: "Presença", href: "/school/attendance", icon: "✅", section: "operacao" },
      { label: "Diário de classe", href: "/school/class-diary", icon: "📘", section: "operacao" },

      { label: "Financeiro", href: "/school/finance", icon: "💳", section: "configuracao" },
      { label: "Branding", href: "/school/settings/branding", icon: "🎨", section: "configuracao" },
    ],
    []
  );

  const mainItems = navItems.filter((i) => i.section === "principal");
  const operationItems = navItems.filter((i) => i.section === "operacao");
  const configItems = navItems.filter((i) => i.section === "configuracao");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) return;

        const res = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const text = await res.text();
        const json = safeJson(text);

        if (res.ok && json?.ok) {
          setMe(json as MePayload);
        }
      } catch {
        // não quebrar layout por branding
      }
    })();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function go(href: string) {
    setMenuOpen(false);
    router.push(href);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen">
        {/* Sidebar desktop */}
        <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white xl:flex">
          <div className="flex w-full flex-col">
            <div className="border-b border-slate-200 px-5 py-5">
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={brandName}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-900 text-base font-bold text-white shadow-sm">
                    {getInitials(brandName)}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-900">
                    {brandName}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{roleLabel}</div>
                  <div className="mt-1 truncate text-[11px] text-slate-400">{userEmail}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              <div className="space-y-6">
                <NavSection title="Principal" items={mainItems} pathname={pathname} onGo={go} />
                <NavSection title="Operação" items={operationItems} pathname={pathname} onGo={go} />
                <NavSection title="Configuração" items={configItems} pathname={pathname} onGo={go} />
              </div>
            </div>

            <div className="border-t border-slate-200 px-4 py-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Ambiente
                </div>
                <div className="mt-2 text-sm font-medium text-slate-800">
                  Multi-tenant ativo
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  Cada escola opera em ambiente isolado e seguro.
                </div>

                <button
                  type="button"
                  onClick={logout}
                  className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
                >
                  Sair do sistema
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-700 shadow-sm xl:hidden"
                >
                  ☰
                </button>

                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Plataforma escolar
                  </div>
                  <div className="truncate text-sm font-semibold text-slate-900 md:text-base">
                    {brandName}
                  </div>
                </div>
              </div>

              <div className="hidden items-center gap-2 md:flex">
                <button
                  type="button"
                  onClick={() => go("/school/settings/branding")}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Personalizar
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                >
                  Sair
                </button>
              </div>
            </div>

            {/* Mobile menu */}
            {menuOpen && (
              <div className="border-t border-slate-200 bg-white px-4 py-4 xl:hidden">
                <div className="mb-4 flex items-center gap-3">
                  {logoUrl ? (
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logoUrl}
                        alt={brandName}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-xs font-bold text-white">
                      {getInitials(brandName)}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {brandName}
                    </div>
                    <div className="text-xs text-slate-500">{roleLabel}</div>
                  </div>
                </div>

                <div className="space-y-5">
                  <NavSection title="Principal" items={mainItems} pathname={pathname} onGo={go} />
                  <NavSection title="Operação" items={operationItems} pathname={pathname} onGo={go} />
                  <NavSection title="Configuração" items={configItems} pathname={pathname} onGo={go} />
                </div>

                <button
                  type="button"
                  onClick={logout}
                  className="mt-5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700"
                >
                  Sair do sistema
                </button>
              </div>
            )}
          </header>

          {/* Content shell */}
          <main className="flex-1">
            <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}