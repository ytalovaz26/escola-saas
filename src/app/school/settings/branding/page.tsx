"use client";

import { useEffect, useRef, useState } from "react";
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
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  const [brandIconUrl, setBrandIconUrl] = useState<string | null>(null);

  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "icon" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function getTokenOrRedirect() {
    const { data, error } = await supabase.auth.getSession();

    if (error || !data.session?.access_token) {
      router.replace("/login");
      return null;
    }

    return data.session.access_token;
  }

  async function loadPage() {
    try {
      setMsg(null);

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

      setBrandName(json.branding?.brandName || "");
      setBrandLogoUrl(json.branding?.brandLogoUrl || null);
      setBrandIconUrl(json.branding?.brandIconUrl || null);
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

  async function saveBrandName() {
    if (!schoolId) {
      setMsg("School ID não encontrado.");
      return;
    }

    setMsg(null);

    try {
      setSavingName(true);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const form = new FormData();
      form.append("schoolId", schoolId);
      form.append("kind", "logo");
      form.append("brandName", brandName.trim());

      const res = await fetch("/api/school/branding/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setMsg("Erro ao salvar nome: " + (json?.error || "desconhecido"));
        return;
      }

      if (json?.brandName) {
        setBrandName(String(json.brandName));
      }

      setMsg("Nome salvo com sucesso ✅");
    } catch (e: any) {
      setMsg(e?.message || "Erro inesperado ao salvar nome.");
    } finally {
      setSavingName(false);
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
        setMsg(`Erro ao enviar ${kind === "logo" ? "logo" : "ícone"}: ` + (json?.error || "desconhecido"));
        return;
      }

      if (kind === "logo") {
        setBrandLogoUrl(json?.url || json?.brandLogoUrl || null);
      } else {
        setBrandIconUrl(json?.url || json?.brandIconUrl || null);
      }

      setMsg(`${kind === "logo" ? "Logo" : "Ícone"} atualizado com sucesso ✅`);
    } catch (e: any) {
      setMsg(e?.message || "Erro inesperado no upload.");
    } finally {
      setUploading(null);
    }
  }

  if (loading) {
    return <main className="p-6">Carregando...</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Identidade Visual</h1>
            <p className="text-sm text-gray-600 mt-1">
              Perfil: <span className="font-medium">{role || "-"}</span>
              {schoolId ? (
                <>
                  {" "}
                  • Escola: <span className="font-mono text-xs">{schoolId}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/school")}
              className="rounded-xl border px-4 py-2 hover:bg-white"
            >
              Voltar
            </button>
          </div>
        </header>

        {msg ? (
          <div className="mt-4 rounded-xl border bg-white p-3 text-sm">
            {msg}
          </div>
        ) : null}

        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="font-semibold">Nome de exibição</h2>
            <p className="text-sm text-gray-600 mt-1">
              Esse nome pode aparecer no topo do portal dos pais.
            </p>

            <div className="mt-4">
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: Escola Canaã"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
              />
            </div>

            <button
              onClick={saveBrandName}
              disabled={savingName}
              className="mt-4 rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-60"
            >
              {savingName ? "Salvando..." : "Salvar nome"}
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="font-semibold">Pré-visualização</h2>

            <div className="mt-4 flex items-center gap-3">
              {brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandLogoUrl}
                  alt="Logo"
                  className="h-12 w-auto rounded bg-gray-50 border p-1 object-contain"
                />
              ) : (
                <div className="h-12 w-28 rounded bg-gray-100 border flex items-center justify-center text-xs text-gray-600">
                  Sem logo
                </div>
              )}

              <div>
                <div className="text-sm font-medium">{brandName || "Sua escola"}</div>
                <div className="text-xs text-gray-600">Portal (pais/direção)</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {brandIconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandIconUrl}
                  alt="Ícone"
                  className="h-14 w-14 rounded-2xl border bg-gray-50 p-1 object-contain"
                />
              ) : (
                <div className="h-14 w-14 rounded-2xl bg-gray-100 border flex items-center justify-center text-xs text-gray-600">
                  Sem ícone
                </div>
              )}

              <div className="text-xs text-gray-600">
                Recomendado: PNG 512×512 quadrado. Esse será o ícone do app (PWA).
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="font-semibold">Logo da escola</h2>
            <p className="text-sm text-gray-600 mt-1">
              PNG/JPG/WEBP/SVG. Preferível fundo transparente.
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

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploading !== null}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-60"
              >
                {uploading === "logo" ? "Enviando logo..." : "Selecionar logo"}
              </button>

              {brandLogoUrl ? (
                <a
                  href={brandLogoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Ver logo atual
                </a>
              ) : null}
            </div>

            <div className="text-xs text-gray-500 mt-3">
              Dica: use largura entre 600 e 1200px para boa qualidade no desktop e mobile.
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="font-semibold">Ícone do app (PWA)</h2>
            <p className="text-sm text-gray-600 mt-1">
              PNG/WEBP/JPG quadrado. Ideal: 512×512.
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

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => iconInputRef.current?.click()}
                disabled={uploading !== null}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-60"
              >
                {uploading === "icon" ? "Enviando ícone..." : "Selecionar ícone"}
              </button>

              {brandIconUrl ? (
                <a
                  href={brandIconUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Ver ícone atual
                </a>
              ) : null}
            </div>

            <div className="text-xs text-gray-500 mt-3">
              Esse arquivo será usado futuramente no PWA da escola.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}