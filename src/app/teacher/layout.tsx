"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Branding = {
  ok: true;
  schoolId: string;
  name: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

type MePayload = {
  ok: true;
  user: {
    id: string;
    email: string | null;
  };
  isPlatformAdmin: boolean;
  school?: {
    schoolId: string;
    role: string;
  };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

type TeacherProfile = {
  userId?: string;
  schoolId?: string;
  role?: string;
  name: string;
  email: string;
  phone?: string;
  initials: string;
  photoUrl: string | null;
};

type NavItem = {
  label: string;
  href: string;
  icon: string;
  description: string;
};

const navItems: NavItem[] = [
  {
    label: "Início",
    href: "/teacher",
    icon: "🏠",
    description: "Resumo da rotina docente",
  },
  {
    label: "Turmas",
    href: "/teacher/classes",
    icon: "🏫",
    description: "Alunos, chamada e diário",
  },
  {
    label: "Comunicados",
    href: "/teacher/messages",
    icon: "📩",
    description: "Avisos oficiais da escola",
  },
  {
    label: "Meus dados",
    href: "/teacher/profile",
    icon: "🪪",
    description: "Foto e informações pessoais",
  },
];

function normalizeHexColor(c?: string | null) {
  const s = String(c || "").trim();

  if (!s) return "#2563eb";
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return s;

  return "#2563eb";
}

function hexToRgbTriplet(hex: string) {
  const h = hex.replace("#", "");

  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.length === 6
        ? h
        : "2563eb";

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  return `${r} ${g} ${b}`;
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function getInitials(name?: string | null, fallback = "PE") {
  const safe = cleanText(name);

  if (!safe) return fallback;

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function titleCaseWord(value: string) {
  const safe = cleanText(value);

  if (!safe) return "";

  return safe.charAt(0).toUpperCase() + safe.slice(1).toLowerCase();
}

function nameFromEmail(email?: string | null) {
  const safe = cleanText(email);

  if (!safe) return "Professor";

  const beforeAt = safe.split("@")[0] || safe;
  const parts = beforeAt
    .split(/[.\-_ ]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "Professor";

  return parts.slice(0, 2).map(titleCaseWord).join(" ");
}

function isActive(pathname: string, href: string) {
  if (href === "/teacher") return pathname === "/teacher";
  return pathname === href || pathname.startsWith(`${href}/`);
}

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function TeacherProfileAvatar({
  profile,
  brandRgb,
}: {
  profile: TeacherProfile;
  brandRgb: string;
}) {
  if (profile.photoUrl) {
    return (
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={profile.photoUrl}
          alt={`Foto de ${profile.name}`}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm"
      style={{ backgroundColor: `rgb(${brandRgb})` }}
    >
      {profile.initials}
    </div>
  );
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [branding, setBranding] = useState<Branding | null>(null);
  const [me, setMe] = useState<MePayload | null>(null);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loadingBranding, setLoadingBranding] = useState(true);

  useEffect(() => {
    let alive = true;

    async function loadIdentity() {
      try {
        setLoadingBranding(true);

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) return;

        const [meRes, brandingRes, profileRes] = await Promise.all([
          fetch("/api/me", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/branding", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/teacher/profile", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);

        const meJson = (await safeJson(meRes)) as MePayload | any;
        const brandingJson = (await safeJson(brandingRes)) as Branding | any;
        const profileJson = await safeJson(profileRes);

        if (!alive) return;

        if (meRes.ok && meJson?.ok) {
          setMe(meJson as MePayload);
        }

        if (profileRes.ok && profileJson?.ok && profileJson?.profile) {
          const p = profileJson.profile;

          setProfile({
            userId: p.userId,
            schoolId: p.schoolId,
            role: p.role,
            name: p.fullName || "Professor",
            email: p.email || meJson?.user?.email || "Professor",
            phone: p.phone || "",
            initials: p.initials || getInitials(p.fullName || "Professor", "PR"),
            photoUrl: p.photoUrl || null,
          });
        } else if (meJson?.ok) {
          const email = meJson?.user?.email || "";
          const fallbackName = nameFromEmail(email);

          setProfile({
            name: fallbackName,
            email: email || "Professor",
            initials: getInitials(fallbackName, "PR"),
            photoUrl: null,
          });
        }

        if (brandingRes.ok && brandingJson?.ok) {
          setBranding(brandingJson as Branding);
          return;
        }

        if (meJson?.ok) {
          setBranding({
            ok: true,
            schoolId: meJson?.school?.schoolId || "",
            name: meJson?.branding?.brandName || "Portal do Professor",
            logoUrl: meJson?.branding?.brandLogoUrl || meJson?.branding?.brandIconUrl || null,
            primaryColor: "#2563eb",
          });
        }
      } catch {
        // Não quebra o portal do professor se a identidade falhar.
      } finally {
        if (alive) setLoadingBranding(false);
      }
    }

    loadIdentity();

    return () => {
      alive = false;
    };
  }, [pathname]);

  const schoolLabel =
    branding?.name ||
    me?.branding?.brandName ||
    (branding?.schoolId ? `Escola ${branding.schoolId}` : "Portal do Professor");

  const logoUrl =
    branding?.logoUrl ||
    me?.branding?.brandLogoUrl ||
    me?.branding?.brandIconUrl ||
    null;

  const primary = useMemo(
    () => normalizeHexColor(branding?.primaryColor),
    [branding?.primaryColor]
  );

  const brandRgb = useMemo(() => hexToRgbTriplet(primary), [primary]);

  const teacherProfile: TeacherProfile = useMemo(() => {
    if (profile) return profile;

    const email = me?.user?.email || "";
    const name = nameFromEmail(email);

    return {
      name,
      email: email || "Professor",
      initials: getInitials(name, "PR"),
      photoUrl: null,
    };
  }, [me?.user?.email, profile]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div
      className="min-h-screen bg-[#f3f6fb] text-slate-900"
      style={
        {
          ["--brand-rgb" as any]: brandRgb,
          ["--brand" as any]: primary,
        } as React.CSSProperties
      }
    >
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
        />

        <div className="absolute right-0 top-40 h-[420px] w-[420px] rounded-full bg-slate-300/30 blur-3xl" />

        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-white blur-3xl" />
      </div>

      <div className="flex min-h-screen">
        <aside className="hidden w-[310px] shrink-0 border-r border-white/70 bg-white/80 backdrop-blur-xl xl:flex">
          <div className="flex w-full flex-col">
            <div className="p-5">
              <button
                type="button"
                onClick={() => router.push("/teacher")}
                className="flex w-full items-center gap-3 rounded-[28px] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={schoolLabel}
                    className="h-16 w-16 shrink-0 rounded-3xl border border-slate-200 bg-white object-contain p-2"
                    draggable={false}
                  />
                ) : (
                  <div
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl text-base font-bold text-white shadow-sm"
                    style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
                  >
                    {getInitials(schoolLabel)}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Portal docente
                  </div>

                  <div className="mt-1 truncate text-base font-semibold text-slate-900">
                    {schoolLabel}
                  </div>

                  <div className="mt-1 truncate text-xs text-slate-500">
                    Área do Professor
                  </div>
                </div>
              </button>
            </div>

            <div className="px-5 pb-4">
              <button
                type="button"
                onClick={() => router.push("/teacher/profile")}
                className="w-full rounded-[28px] border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-white hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <TeacherProfileAvatar profile={teacherProfile} brandRgb={brandRgb} />

                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {teacherProfile.name}
                    </div>

                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {teacherProfile.email}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-slate-500 shadow-sm">
                  Perfil: Professor
                </div>
              </button>
            </div>

            <div className="flex-1 px-4 pb-4">
              <div className="rounded-[32px] border border-slate-200 bg-white p-3 shadow-sm">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Navegação
                </div>

                <nav className="space-y-1">
                  {navItems.map((item) => {
                    const active = isActive(pathname, item.href);

                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => router.push(item.href)}
                        className={[
                          "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition",
                          active
                            ? "bg-slate-950 text-white shadow-sm"
                            : "text-slate-700 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg transition",
                            active
                              ? "bg-white/10 text-white"
                              : "bg-slate-100 text-slate-700 group-hover:bg-white",
                          ].join(" ")}
                        >
                          {item.icon}
                        </span>

                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">
                            {item.label}
                          </span>

                          <span
                            className={[
                              "mt-0.5 block truncate text-xs",
                              active ? "text-slate-300" : "text-slate-500",
                            ].join(" ")}
                          >
                            {item.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div className="mt-4 rounded-[32px] border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Ambiente
                </div>

                <div className="mt-3 break-words text-lg font-semibold">
                  Rotina docente ativa
                </div>

                <p className="mt-2 break-words text-sm leading-6 text-slate-300">
                  Acesse chamadas, diário pedagógico e comunicados em um painel centralizado.
                </p>

                <button
                  type="button"
                  onClick={logout}
                  className="mt-5 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
                >
                  Sair do sistema
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 p-5">
              <div className="break-words text-xs leading-5 text-slate-500">
                {loadingBranding ? "Carregando identidade..." : "Sistema escolar multi-tenant"}
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-white/70 bg-white/80 backdrop-blur-xl xl:hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={schoolLabel}
                  className="h-12 w-12 shrink-0 rounded-2xl border border-slate-200 bg-white object-contain p-1.5"
                  draggable={false}
                />
              ) : (
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xs font-bold text-white"
                  style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
                >
                  {getInitials(schoolLabel)}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Portal do Professor
                </div>

                <div className="truncate text-sm font-semibold text-slate-900">
                  {schoolLabel}
                </div>

                <div className="truncate text-xs text-slate-500">
                  {teacherProfile.name}
                </div>
              </div>

              {teacherProfile.photoUrl ? (
                <button
                  type="button"
                  onClick={() => router.push("/teacher/profile")}
                  className="h-10 w-10 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={teacherProfile.photoUrl}
                    alt={teacherProfile.name}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push("/teacher/profile")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-xs font-bold text-white"
                >
                  {teacherProfile.initials}
                </button>
              )}

              <button
                type="button"
                onClick={logout}
                className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm"
              >
                Sair
              </button>
            </div>

            <div
              className="h-[3px] w-full"
              style={{
                background:
                  "linear-gradient(90deg, rgb(var(--brand-rgb)) 0%, rgba(15,23,42,0.15) 80%)",
              }}
            />
          </header>

          <main className="flex-1 px-4 pb-28 pt-5 md:px-6 xl:px-8 xl:pb-8">
            <div className="mx-auto w-full max-w-[1500px]">{children}</div>
          </main>

          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-xl xl:hidden">
            <div className="grid grid-cols-4 gap-2">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);

                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => router.push(item.href)}
                    className={[
                      "flex min-w-0 flex-col items-center justify-center rounded-2xl px-2 py-2 text-xs transition",
                      active
                        ? "bg-slate-950 text-white"
                        : "text-slate-500 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <span className="text-lg">{item.icon}</span>
                    <span className="mt-1 max-w-full truncate font-semibold">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}