"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: {
    parentId: string;
    schoolId: string;
    firstLoginCompleted?: boolean;
    profileUpdatedAt?: string | null;
  };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

type ParentProfilePayload = {
  ok: true;
  parent: {
    id: string;
    schoolId: string | null;
    fullName: string | null;
    phone: string | null;
    cpf: string | null;
    phoneSecondary: string | null;
    zipCode: string | null;
    street: string | null;
    streetNumber: string | null;
    addressComplement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    photoUrl: string | null;
    firstLoginCompleted: boolean;
    profileUpdatedAt: string | null;
  };
};

function safeJson(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function isHttpUrl(url?: string | null) {
  const safe = String(url || "").trim();
  return safe.startsWith("https://") || safe.startsWith("http://");
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();

  if (!safe) return "RP";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "RP";
}

function navItems() {
  return [
    {
      href: "/parent",
      icon: "🏠",
      label: "Início",
      description: "Visão geral do portal",
    },
    {
      href: "/parent/children",
      icon: "👨‍👩‍👧",
      label: "Filhos",
      description: "Alunos vinculados",
    },
    {
      href: "/parent/calendar",
      icon: "📅",
      label: "Agenda",
      description: "Eventos e compromissos",
    },
    {
      href: "/parent/messages",
      icon: "📩",
      label: "Comunicados",
      description: "Avisos oficiais",
    },
    {
      href: "/parent/invoices",
      icon: "💳",
      label: "Mensalidades",
      description: "Financeiro escolar",
    },
    {
      href: "/parent/complete-profile",
      icon: "🪪",
      label: "Meus dados",
      description: "Atualizar cadastro",
    },
  ];
}

function isActivePath(pathname: string, href: string) {
  if (href === "/parent") return pathname === "/parent";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SchoolLogo({
  logoUrl,
  iconUrl,
  schoolName,
}: {
  logoUrl?: string | null;
  iconUrl?: string | null;
  schoolName: string;
}) {
  const [broken, setBroken] = useState(false);

  const finalUrl = isHttpUrl(logoUrl) ? logoUrl : isHttpUrl(iconUrl) ? iconUrl : null;

  if (finalUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={finalUrl}
        alt={`Logo ${schoolName}`}
        className="h-12 w-12 rounded-2xl border border-slate-200 bg-white object-contain p-1.5 shadow-sm"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-500 shadow-sm">
      Logo
    </div>
  );
}

function ParentAvatar({
  photoUrl,
  name,
}: {
  photoUrl?: string | null;
  name: string;
}) {
  const [broken, setBroken] = useState(false);

  if (isHttpUrl(photoUrl) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={String(photoUrl)}
        alt="Foto do responsável"
        className="h-12 w-12 rounded-2xl border border-white/10 object-cover"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold text-white">
      {getInitials(name)}
    </div>
  );
}

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [profile, setProfile] = useState<ParentProfilePayload["parent"] | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const schoolName = useMemo(() => {
    return me?.branding?.brandName?.trim() || "Minha Escola";
  }, [me?.branding?.brandName]);

  const responsibleName = useMemo(() => {
    return profile?.fullName?.trim() || me?.user?.email || "Responsável";
  }, [profile?.fullName, me?.user?.email]);

  const items = useMemo(() => navItems(), []);

  useEffect(() => {
    let alive = true;

    async function boot() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const meText = await meRes.text();
        const meJson: any = safeJson(meText);

        if (!alive) return;

        if (!meRes.ok || !meJson?.ok) {
          router.replace("/login");
          return;
        }

        if (!meJson?.parent?.parentId) {
          router.replace(meJson?.redirectTo || "/login");
          return;
        }

        setMe(meJson as MePayload);

        const profileRes = await fetch("/api/parent/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const profileText = await profileRes.text();
        const profileJson: any = safeJson(profileText);

        if (!alive) return;

        if (profileRes.ok && profileJson?.ok) {
          setProfile(profileJson.parent || null);
        }
      } catch {
        if (!alive) return;
        router.replace("/login");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    boot();

    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-64 rounded-xl bg-slate-200" />
              <div className="h-4 w-96 max-w-full rounded-xl bg-slate-100" />
              <div className="h-96 rounded-3xl bg-slate-100" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!me?.parent?.parentId) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-[292px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center gap-3">
              <SchoolLogo
                logoUrl={me.branding?.brandLogoUrl}
                iconUrl={me.branding?.brandIconUrl}
                schoolName={schoolName}
              />

              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Portal do Responsável
                </div>

                <div className="mt-1 truncate text-base font-semibold text-slate-900">
                  {schoolName}
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            {items.map((item) => {
              const active = isActivePath(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "flex items-center gap-3 rounded-3xl px-4 py-3 transition",
                    active
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-10 w-10 items-center justify-center rounded-2xl text-lg",
                      active ? "bg-white/10" : "bg-slate-100",
                    ].join(" ")}
                  >
                    {item.icon}
                  </span>

                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span
                      className={[
                        "block truncate text-xs",
                        active ? "text-slate-200" : "text-slate-500",
                      ].join(" ")}
                    >
                      {item.description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="p-4">
            <div className="rounded-[28px] bg-slate-900 p-4 text-white shadow-sm">
              <div className="flex items-center gap-3">
                <ParentAvatar photoUrl={profile?.photoUrl} name={responsibleName} />

                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{responsibleName}</div>
                  <div className="mt-1 truncate text-xs text-slate-300">
                    {me.user.email || "Responsável"}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={logout}
                className="mt-4 w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Sair do sistema
              </button>
            </div>

            <div className="mt-4 text-center text-[11px] text-slate-400">
              Sistema escolar multi-tenant
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xl"
                aria-label="Abrir menu"
              >
                ☰
              </button>

              <div className="flex min-w-0 items-center gap-3">
                <SchoolLogo
                  logoUrl={me.branding?.brandLogoUrl}
                  iconUrl={me.branding?.brandIconUrl}
                  schoolName={schoolName}
                />

                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Portal
                  </div>
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {schoolName}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={logout}
                className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
              >
                Sair
              </button>
            </div>

            {mobileMenuOpen ? (
              <div className="border-t border-slate-200 bg-white p-3">
                <nav className="grid grid-cols-2 gap-2">
                  {items.map((item) => {
                    const active = isActivePath(pathname, item.href);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={[
                          "rounded-2xl px-3 py-3 text-sm font-semibold transition",
                          active
                            ? "bg-slate-900 text-white"
                            : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        <span className="mr-2">{item.icon}</span>
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            ) : null}
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}