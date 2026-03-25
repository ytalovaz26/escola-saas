"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Branding = {
  ok: true;
  schoolId: string;
  name: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

function normalizeHexColor(c?: string | null) {
  const s = (c || "").trim();
  if (!s) return "#2563eb";
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return s;
  return "#2563eb";
}

function hexToRgbTriplet(hex: string) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h.length === 6
        ? h
        : "2563eb";

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  return `${r} ${g} ${b}`;
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadBranding() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/branding", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const json = (await res.json().catch(() => null)) as any;
        if (!alive) return;

        if (res.ok && json?.ok) setBranding(json);
      } catch {
        // não quebra o app
      }
    }

    loadBranding();
    return () => {
      alive = false;
    };
  }, [pathname]);

  const schoolLabel = branding?.name || (branding?.schoolId ? `Escola ${branding.schoolId}` : "—");

  const primary = useMemo(() => normalizeHexColor(branding?.primaryColor), [branding?.primaryColor]);
  const brandRgb = useMemo(() => hexToRgbTriplet(primary), [primary]);

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900"
      style={
        {
          ["--brand-rgb" as any]: brandRgb,
          ["--brand" as any]: primary,
        } as React.CSSProperties
      }
    >
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="brand-logo-wrap">
            {branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt="Logo"
                className="brand-logo-img"
                draggable={false}
              />
            ) : (
              <div className="h-full w-full bg-slate-100" />
            )}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">Portal do Professor</div>
            <div className="text-xs text-slate-600 truncate">{schoolLabel}</div>
          </div>

          <div className="ml-auto hidden sm:flex items-center gap-2">
            <span className="text-xs text-slate-500">Agenda & Financeiro Escolar</span>
          </div>
        </div>

        <div
          className="h-[3px] w-full"
          style={{
            background: "linear-gradient(90deg, rgb(var(--brand-rgb)) 0%, rgba(0,0,0,0) 80%)",
          }}
        />
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5">{children}</main>
    </div>
  );
}
