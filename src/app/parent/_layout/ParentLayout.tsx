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

type NavItem = {
  href: string;
  label: string;
  icon: string;
  description: string;
};

function withCacheBuster(url: string) {
  const hasQuery = url.includes("?");
  return url + (hasQuery ? "&" : "?") + "v=" + Date.now();
}

function isHttpUrl(url: string) {
  return url.startsWith("https://") || url.startsWith("http://");
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "PR";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function isActive(pathname: string, href: string) {
  if (href === "/parent") return pathname === "/parent";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItemButton({
  item,
  pathname,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  onClick: (href: string) => void;
}) {
  const active = isActive(pathname, item.href);

  return (
    <button
      type="button"
      onClick={() => onClick(item.href)}
      className={[
        "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-700 hover:bg-slate-100",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base transition",
          active
            ? "bg-white/10 text-white"
            : "bg-slate-100 text-slate-700 group-hover:bg-slate-200",
        ].join(" ")}
      >
        {item.icon}
      </span>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{item.label}</div>
        <div
          className={[
            "truncate text-xs",
            active ? "text-slate-300" : "text-slate-500",
          ].join(" ")}
        >
          {item.description}
        </div>
      </div>
    </button>
  );
}

function Avatar({
  photoUrl,
  fallbackText,
  size = "md",
}: {
  photoUrl?: string | null;
  fallbackText: string;
  size?: "sm" | "md" | "lg";
}) {
  const [broken, setBroken] = useState(false);

  const sizeClass =
    size === "sm"
      ? "h-11 w-11 rounded-2xl text-xs"
      : size === "lg"
      ? "h-16 w-16 rounded-3xl text-sm"
      : "h-12 w-12 rounded-2xl text-xs";

  const validPhoto = photoUrl && isHttpUrl(photoUrl) ? withCacheBuster(photoUrl) : null;

  if (validPhoto && !broken) {
    return (
      <img
        src={validPhoto}
        alt="Foto do responsável"
        className={`${sizeClass} object-cover border border-slate-200 bg-white shadow-sm`}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      className={`flex ${sizeClass} items-center justify-center bg-slate-900 font-bold text-white shadow-sm`}
    >
      {fallbackText}
    </div>
  );
}

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [me, setMe] = useState<MePayload | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [parentFullName, setParentFullName] = useState<string | null>(null);
  const [parentPhotoUrl, setParentPhotoUrl] = useState<string | null>(null);

  const brandTitle = useMemo(() => {
    const name = me?.branding?.brandName?.trim();
    return name || "Portal do Responsável";
  }, [me]);

  const rawLogoUrl = me?.branding?.brandLogoUrl?.trim() || "";

  const brandLogoUrl = useMemo(() => {
    if (!rawLogoUrl) return null;
    if (!isHttpUrl(rawLogoUrl)) return null;
    return withCacheBuster(rawLogoUrl);
  }, [rawLogoUrl]);

  const responsibleName = useMemo(() => {
    return parentFullName?.trim() || me?.user?.email || "Responsável";
  }, [parentFullName, me?.user?.email]);

  const responsibleInitials = useMemo(() => {
    return getInitials(parentFullName || me?.user?.email || "Responsável");
  }, [parentFullName, me?.user?.email]);

  useEffect(() => {
    let alive = true;

    async function loadLayoutData() {
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

        const firstLoginCompleted = !!json?.parent?.firstLoginCompleted;
        const isCompleteProfilePage = pathname === "/parent/complete-profile";

        if (!firstLoginCompleted && !isCompleteProfilePage) {
          router.replace("/parent/complete-profile");
          return;
        }

        if (firstLoginCompleted && isCompleteProfilePage) {
          // segue carregando, porque esse acesso pode ser edição manual
        }

        if (!alive) return;
        setMe(json as MePayload);

        const profileRes = await fetch("/api/parent/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const profileText = await profileRes.text();
        let profileJson: ParentProfilePayload | any = null;

        try {
          profileJson = profileText ? JSON.parse(profileText) : null;
        } catch {
          profileJson = null;
        }

        if (!alive) return;

        if (profileRes.ok && profileJson?.ok) {
          setParentFullName(profileJson.parent?.fullName || null);
          setParentPhotoUrl(profileJson.parent?.photoUrl || null);
        }
      } catch {
        router.replace("/login");
      }
    }

    loadLayoutData();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function go(href: string) {
    setMenuOpen(false);
    router.push(href);
  }

  const items: NavItem[] = [
    {
      href: "/parent",
      label: "Início",
      icon: "🏠",
      description: "Visão geral do portal",
    },
    {
      href: "/parent/children",
      label: "Filhos",
      icon: "🧒",
      description: "Acompanhar alunos vinculados",
    },
    {
      href: "/parent/calendar",
      label: "Agenda",
      icon: "📅",
      description: "Eventos e compromissos",
    },
    {
      href: "/parent/messages",
      label: "Mensagens",
      icon: "📩",
      description: "Comunicados da escola",
    },
    {
      href: "/parent/invoices",
      label: "Mensalidades",
      icon: "💳",
      description: "Financeiro escolar",
    },
    {
      href: "/parent/complete-profile",
      label: "Meus dados",
      icon: "🪪",
      description: "Atualizar cadastro",
    },
  ];

  const hideNavigation = false;

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen">
        {!hideNavigation && (
          <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white xl:flex">
            <div className="flex w-full flex-col">
              <div className="border-b border-slate-200 px-5 py-5">
                <div className="flex items-center gap-4">
                  <Avatar
                    photoUrl={parentPhotoUrl}
                    fallbackText={responsibleInitials}
                    size="lg"
                  />

                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Portal do Responsável
                    </div>
                    <div className="mt-1 truncate text-base font-semibold text-slate-900">
                      {brandTitle}
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-700">
                      {responsibleName}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-slate-400">
                      {me?.user?.email ?? "Carregando..."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  {brandLogoUrl ? (
                    <img
                      src={brandLogoUrl}
                      alt="Logo da escola"
                      className="h-12 w-12 rounded-2xl border border-slate-200 bg-white object-contain p-1.5"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200 text-xs font-semibold text-slate-600">
                      {getInitials(brandTitle)}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {brandTitle}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      Ambiente do responsável
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-5">
                <div className="space-y-2">
                  {items.map((item) => (
                    <NavItemButton
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      onClick={go}
                    />
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 px-4 py-4">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Acesso
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-800">
                    Conta do responsável ativa
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    Ambiente preparado para acompanhar boletim, presença, agenda,
                    mensagens, financeiro e atualização cadastral.
                  </div>

                  <button
                    type="button"
                    onClick={logout}
                    className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    Sair do portal
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!hideNavigation && (
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

                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      photoUrl={parentPhotoUrl}
                      fallbackText={responsibleInitials}
                      size="sm"
                    />

                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Portal do Responsável
                      </div>
                      <div className="truncate text-sm font-semibold text-slate-900 md:text-base">
                        {brandTitle}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hidden items-center gap-2 md:flex">
                  <Link
                    href="/parent/children"
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Meus filhos
                  </Link>

                  <Link
                    href="/parent/complete-profile"
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Meus dados
                  </Link>

                  <button
                    type="button"
                    onClick={logout}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    Sair
                  </button>
                </div>
              </div>

              {menuOpen && (
                <div className="border-t border-slate-200 bg-white px-4 py-4 xl:hidden">
                  <div className="mb-4 flex items-center gap-3">
                    <Avatar
                      photoUrl={parentPhotoUrl}
                      fallbackText={responsibleInitials}
                      size="md"
                    />

                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {responsibleName}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {me?.user?.email ?? "Conta do responsável"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {items.map((item) => (
                      <NavItemButton
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        onClick={go}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={logout}
                    className="mt-5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700"
                  >
                    Sair do portal
                  </button>
                </div>
              )}
            </header>
          )}

          <main className="flex-1">
            <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}