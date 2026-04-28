"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
};

type BrandingPayload = {
  ok: true;
  school: {
    id: string;
    name: string | null;
    slug: string | null;
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    publicUrl: string;
  };
};

function safeRole(role: string | null | undefined) {
  return String(role || "").trim().toLowerCase();
}

function canManageBranding(role: string | null | undefined) {
  const r = safeRole(role);

  return (
    r === "diretor" ||
    r === "director" ||
    r === "coordenador" ||
    r === "coordinator"
  );
}

function normalizeSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor." };
  }
}

export default function BrandingSettingsPage() {
  const router = useRouter();

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const iconInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const [brandName, setBrandName] = useState("");
  const [slug, setSlug] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  const [brandIconUrl, setBrandIconUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#0f172a");
  const [secondaryColor, setSecondaryColor] = useState("#2563eb");

  const [savingIdentity, setSavingIdentity] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "icon" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const publicSchoolUrl = useMemo(() => {
    if (typeof window === "undefined") return slug ? `/s/${slug}` : "";

    if (!slug) return "";

    return `${window.location.origin}/s/${slug}`;
  }, [slug]);

  async function getTokenOrRedirect() {
    const { data, error } = await supabase.auth.getSession();

    if (error || !data.session?.access_token) {
      router.replace("/login");
      return null;
    }

    return data.session.access_token;
  }

  async function fetchBranding(token: string) {
    const res = await fetch("/api/school/branding", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await safeJson(res)) as BrandingPayload | any;

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Falha ao carregar branding.");
    }

    const school = json.school;

    setBrandName(school.brandName || "");
    setSlug(school.slug || "");
    setBrandLogoUrl(school.brandLogoUrl || null);
    setBrandIconUrl(school.brandIconUrl || null);
    setPrimaryColor(school.primaryColor || "#0f172a");
    setSecondaryColor(school.secondaryColor || "#2563eb");
  }

  async function loadPage() {
    try {
      setMsg(null);
      setLoading(true);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = (await safeJson(res)) as MePayload | { ok?: false; error?: string } | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        router.replace("/login");
        return;
      }

      if (json.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const r = json.school?.role || null;
      const sid = json.school?.schoolId || null;

      setRole(r);
      setSchoolId(sid);

      if (!canManageBranding(r)) {
        router.replace("/school");
        return;
      }

      await fetchBranding(token);
    } catch (e: any) {
      setMsg(e?.message || "Erro ao carregar branding.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveIdentity() {
    if (!schoolId) {
      setMsg("School ID não encontrado.");
      return;
    }

    setMsg(null);

    try {
      setSavingIdentity(true);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const finalSlug = normalizeSlug(slug || brandName);

      if (!brandName.trim()) {
        setMsg("Informe o nome de exibição da escola.");
        return;
      }

      if (!finalSlug) {
        setMsg("Informe um link personalizado válido.");
        return;
      }

      const res = await fetch("/api/school/branding", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          brandName: brandName.trim(),
          slug: finalSlug,
          primaryColor,
          secondaryColor,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setMsg("Erro ao salvar identidade: " + (json?.error || "desconhecido"));
        return;
      }

      const school = json.school;

      setBrandName(school.brandName || "");
      setSlug(school.slug || finalSlug);
      setBrandLogoUrl(school.brandLogoUrl || null);
      setBrandIconUrl(school.brandIconUrl || null);
      setPrimaryColor(school.primaryColor || primaryColor);
      setSecondaryColor(school.secondaryColor || secondaryColor);

      setMsg("Identidade visual salva com sucesso ✅");
    } catch (e: any) {
      setMsg(e?.message || "Erro inesperado ao salvar identidade.");
    } finally {
      setSavingIdentity(false);
    }
  }

  async function upload(kind: "logo" | "icon", file: File) {
    if (!schoolId) {
      setMsg("School ID não encontrado.");
      return;
    }

    setMsg(null);

    try {
      setUploading(kind);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const form = new FormData();
      form.append("schoolId", schoolId);
      form.append("kind", kind);
      form.append("brandName", brandName.trim());
      form.append("file", file);

      const res = await fetch("/api/school/branding/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setMsg(
          `Erro ao enviar ${kind === "logo" ? "logo" : "ícone"}: ` +
            (json?.error || "desconhecido")
        );
        return;
      }

      if (kind === "logo") {
        setBrandLogoUrl(json?.url || json?.brandLogoUrl || null);
      } else {
        setBrandIconUrl(json?.url || json?.brandIconUrl || null);
      }

      await fetchBranding(token);

      setMsg(`${kind === "logo" ? "Logo" : "Ícone"} atualizado com sucesso ✅`);
    } catch (e: any) {
      setMsg(e?.message || "Erro inesperado no upload.");
    } finally {
      setUploading(null);
    }
  }

  async function copyPublicLink() {
    if (!publicSchoolUrl) {
      setMsg("Salve o link personalizado primeiro.");
      return;
    }

    try {
      await navigator.clipboard.writeText(publicSchoolUrl);
      setMsg("Link personalizado copiado ✅");
    } catch {
      setMsg(publicSchoolUrl);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          Carregando identidade visual...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Branding multi-tenant
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Identidade Visual da Escola
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Configure nome, logo, ícone do app e link personalizado da escola sem afetar
                  o ícone global do SaaS.
                </p>

                <p className="mt-3 text-xs text-slate-300">
                  Perfil: <span className="font-medium">{role || "-"}</span>
                  {schoolId ? (
                    <>
                      {" "}
                      • Escola: <span className="font-mono">{schoolId}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <button
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Voltar ao painel
              </button>
            </div>
          </div>
        </header>

        {msg ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {msg}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Dados públicos da escola</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Esses dados formam o link personalizado e a experiência de instalação no celular.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Nome de exibição
                </label>
                <input
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  placeholder="Ex: Centro Educacional Crescer"
                  value={brandName}
                  onChange={(e) => {
                    const next = e.target.value;
                    setBrandName(next);

                    if (!slug.trim()) {
                      setSlug(normalizeSlug(next));
                    }
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Link personalizado
                </label>

                <div className="flex flex-col gap-2 md:flex-row">
                  <div className="flex min-w-0 flex-1 items-center rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                    <span className="shrink-0 text-sm text-slate-400">/s/</span>
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                      placeholder="centro-educacional-crescer"
                      value={slug}
                      onChange={(e) => setSlug(normalizeSlug(e.target.value))}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={copyPublicLink}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Copiar link
                  </button>
                </div>

                <p className="mt-2 break-all text-xs text-slate-500">
                  {publicSchoolUrl || "Salve um link para gerar a URL pública da escola."}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Cor principal
                  </label>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-300 bg-white p-1"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Cor secundária
                  </label>
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-300 bg-white p-1"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={saveIdentity}
              disabled={savingIdentity}
              className="mt-5 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {savingIdentity ? "Salvando..." : "Salvar identidade e link"}
            </button>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Pré-visualização</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Essa é a aparência que a escola terá no portal e no app instalado.
            </p>

            <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-4">
                {brandLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brandLogoUrl}
                    alt="Logo"
                    className="h-16 w-28 rounded-2xl border border-slate-200 bg-white object-contain p-2"
                  />
                ) : (
                  <div className="flex h-16 w-28 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xs text-slate-500">
                    Sem logo
                  </div>
                )}

                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-900">
                    {brandName || "Sua escola"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Portal da escola</div>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-4">
                {brandIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brandIconUrl}
                    alt="Ícone"
                    className="h-20 w-20 rounded-[24px] border border-slate-200 bg-white object-contain p-2 shadow-sm"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-[24px] border border-slate-200 bg-white text-xs text-slate-500 shadow-sm">
                    Sem ícone
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Ícone do app instalado
                  </div>
                  <div className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                    Pais, professores e equipe devem instalar o app usando o link personalizado
                    da escola para aparecer com esse ícone.
                  </div>
                </div>
              </div>
            </div>

            {publicSchoolUrl ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-sm font-semibold text-emerald-800">
                  Link da escola pronto
                </div>
                <div className="mt-2 break-all text-xs text-emerald-700">
                  {publicSchoolUrl}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Logo da escola</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Use para painéis, PDFs, portal dos pais e cabeçalhos. Preferível PNG transparente.
            </p>

            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("logo", f);
                e.currentTarget.value = "";
              }}
              disabled={uploading !== null}
            />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploading !== null}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {uploading === "logo" ? "Enviando logo..." : "Selecionar logo"}
              </button>

              {brandLogoUrl ? (
                <a
                  href={brandLogoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Ver logo atual
                </a>
              ) : null}
            </div>

            <div className="mt-4 text-xs leading-5 text-slate-500">
              Recomendado: largura entre 600 e 1200px para boa qualidade no desktop,
              mobile e PDFs.
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Ícone do app da escola</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Esse ícone será usado no link personalizado da escola. Ideal: PNG 512×512 quadrado.
            </p>

            <input
              ref={iconInputRef}
              type="file"
              accept="image/png,image/webp,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("icon", f);
                e.currentTarget.value = "";
              }}
              disabled={uploading !== null}
            />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => iconInputRef.current?.click()}
                disabled={uploading !== null}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {uploading === "icon" ? "Enviando ícone..." : "Selecionar ícone"}
              </button>

              {brandIconUrl ? (
                <a
                  href={brandIconUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Ver ícone atual
                </a>
              ) : null}
            </div>

            <div className="mt-4 text-xs leading-5 text-slate-500">
              Importante: o ícone global do SaaS não deve ser alterado pela escola.
              Cada escola terá seu próprio ícone ao instalar pelo link personalizado.
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">
            Como a escola deve usar o link
          </h2>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-900">1. Salvar identidade</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Configure nome, link, logo e ícone da escola.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-900">2. Copiar link</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Envie o link personalizado para pais, professores e equipe.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-900">3. Instalar no celular</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Ao adicionar à tela inicial, o app aparece com nome e ícone da escola.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}