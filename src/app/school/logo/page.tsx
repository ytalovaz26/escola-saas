"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SchoolLogoPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function upload() {
    setErr(null);
    setMsg(null);

    const token = await ensureToken();
    if (!token) return;

    if (!file) {
      setErr("Selecione uma imagem.");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/school/logo/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Falha ao enviar logo.");
        return;
      }

      setMsg("Logo enviada com sucesso ✅");
      // força refresh pra pegar novo logo_url no /api/me (quando a gente integrar)
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Upload da Logo da Escola</h1>

      <div className="border rounded-xl p-4 bg-white space-y-3">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />

        {preview && (
          <div className="border rounded-xl p-3">
            <div className="text-sm text-gray-600 mb-2">Prévia:</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Prévia" className="max-h-40 object-contain" />
          </div>
        )}

        <button
          onClick={upload}
          disabled={loading || !file}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
        >
          {loading ? "Enviando..." : "Enviar logo"}
        </button>

        {msg && <div className="text-green-700">{msg}</div>}
        {err && <div className="text-red-700">{err}</div>}
      </div>

      <div className="text-xs text-gray-500">
        Dica: use PNG com fundo transparente para ficar mais profissional.
      </div>
    </main>
  );
}
