"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePathname, useRouter } from "next/navigation";

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

function withCacheBuster(url: string) {
  const hasQuery = url.includes("?");
  return url + (hasQuery ? "&" : "?") + "v=" + Date.now();
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "RP";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "RP";
}

function navIsActive(pathname: string, href: string) {
  if (href === "/parent") return pathname === "/parent";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SchoolLogo({
  logoUrl,
  brandName,
}: {
  logoUrl?: string | null;
  brandName: string;
}) {
  const [broken, setBroken] = useState(false);

  const validLogo = logoUrl && isHttpUrl(logoUrl) ? withCacheBuster(logoUrl) : null;

  if (validLogo && !broken) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={validLogo}
          alt={`Logo ${brandName}`}
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 text-sm font-bold text-white shadow-sm">
      {getInitials(brandName)}
    </div>
  );
}

function ParentAvatar({
  photoUrl,
  fallbackText,
}: {
  photoUrl?: string | null;
  fallbackText: string;
}) {
  const [broken, setBroken] = useState(false);

  const validPhoto = photoUrl && isHttpUrl(photoUrl) ? withCacheBuster(photoUrl) : null;

  if (validPhoto && !broken) {
    return (
      <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={validPhoto}
          alt="Foto do responsável"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 text-sm font-bold text-white shadow-sm">
      {fallbackText}
    </div>
  );
}

function NavItem({
  href,
  icon,
  title,
  description,
  active,
  onClick,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  active: boolean;
  onClick: (href: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(href)}
      className={[
        "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-700 hover:bg-slate-100",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base",
          active ? "bg-white/10" : "bg-slate-100",
        ].join(" ")}
      >
        {icon}
      </span>

      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        <span
          className={[
            "mt-0.5 block truncate text-xs leading-tight",
            active ? "text-slate-200" : "text-slate-500",
          ].join(" ")}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [profile, setProfile] = useState<ParentProfilePayload["parent"] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const brandName = useMemo(() => {
    return me?.branding?.brandName?.trim() || "Portal do Responsável";
  }, [me?.branding?.brandName]);

  const brandLogoUrl = useMemo(() => {
    return me?.branding?.brandLogoUrl || me?.branding?.brandIconUrl || null;
  }, [me?.branding?.brandLogoUrl, me?.branding?.brandIconUrl]);

  const responsibleName = useMemo(() => {
    return profile?.fullName?.trim() || me?.user?.email || "Responsável";
  }, [profile?.fullName, me?.user?.email]);

  const responsibleEmail = me?.user?.email || "";

  const responsibleInitials = useMemo(() => {
    return getInitials(profile?.fullName || me?.user?.email || "Responsável");
  }, [profile?.fullName, me?.user?.email]);

  useEffect(() => {
    let alive = true;

    async function load() {
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
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function goTo(href: string) {
    router.push(href);
  }

  const navItems = [
    {
      href: "/parent",
      icon: "🏠",
      title: "Início",
      description: "Visão geral do portal",
    },
    {
      href: "/parent/children",
      icon: "👨‍👩‍👧",
      title: "Filhos",
      description: "Alunos vinculados",
    },
    {
      href: "/parent/calendar",
      icon: "🗓️",
      title: "Agenda",
      description: "Eventos e compromissos",
    },
    {
      href: "/parent/schedule",
      icon: "🕒",
      title: "Horários",
      description: "Rotina escolar do filho",
    },
    {
      href: "/parent/menu",
      icon: "🍽️",
      title: "Cardápio",
      description: "Alimentação escolar",
    },
    {
      href: "/parent/messages",
      icon: "📩",
      title: "Comunicados",
      description: "Avisos oficiais",
    },
    {
      href: "/parent/invoices",
      icon: "💳",
      title: "Mensalidades",
      description: "Financeiro escolar",
    },
    {
      href: "/parent/complete-profile",
      icon: "🪪",
      title: "Meus dados",
      description: "Atualizar cadastro",
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-7xl animate-pulse space-y-5">
          <div className="h-24 rounded-[32px] bg-white" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
            <div className="h-[640px] rounded-[32px] bg-white" />
            <div className="h-[640px] rounded-[32px] bg-white" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xl shadow-sm"
            aria-label="Abrir menu"
          >
            ☰
          </button>

          <SchoolLogo logoUrl={brandLogoUrl} brandName={brandName} />

          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Portal do Responsável
            </div>
            <div className="truncate text-sm font-semibold text-slate-900">{brandName}</div>
          </div>
        </div>

        {mobileOpen ? (
          <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-lg">
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
              <ParentAvatar photoUrl={profile?.photoUrl} fallbackText={responsibleInitials} />

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {responsibleName}
                </div>
                <div className="truncate text-xs text-slate-500">{responsibleEmail}</div>
              </div>
            </div>

            <div className="space-y-1">
              {navItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  active={navIsActive(pathname, item.href)}
                  onClick={goTo}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={logout}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Sair do sistema
            </button>
          </div>
        ) : null}
      </div>

      <div className="mx-auto grid min-h-screen max-w-[1500px] grid-cols-1 lg:grid-cols-[310px_1fr]">
        <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="p-6">
            <div className="flex items-center gap-4">
              <SchoolLogo logoUrl={brandLogoUrl} brandName={brandName} />

              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Portal do Responsável
                </div>
                <div className="mt-1 truncate text-base font-semibold text-slate-900">
                  {brandName}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3">
              <ParentAvatar photoUrl={profile?.photoUrl} fallbackText={responsibleInitials} />

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {responsibleName}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{responsibleEmail}</div>
              </div>
            </div>
          </div>

          <div className="px-4">
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Navegação
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  active={navIsActive(pathname, item.href)}
                  onClick={goTo}
                />
              ))}
            </nav>
          </div>

          <div className="mt-auto p-6">
            <div className="rounded-[28px] bg-slate-900 p-5 text-white shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                Ambiente
              </div>

              <div className="mt-2 text-lg font-semibold">Portal familiar</div>

              <p className="mt-2 text-sm leading-6 text-slate-300">
                Acompanhe filhos, agenda, horários, cardápio, comunicados e financeiro em um
                ambiente seguro.
              </p>

              <button
                type="button"
                onClick={logout}
                className="mt-5 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Sair do sistema
              </button>
            </div>

            <div className="mt-5 text-xs text-slate-400">Sistema escolar multi-tenant</div>
          </div>
        </aside>

        <main className="min-w-0 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}