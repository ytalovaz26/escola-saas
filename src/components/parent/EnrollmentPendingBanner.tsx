"use client";

// Aviso de pendências da matrícula digital no painel do responsável.
// Não bloqueia nada: some se não houver pendências, se a API falhar ou se o
// responsável escolher "Depois" (até o fim da sessão do navegador).
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const DISMISS_KEY = "me_matricula_aviso_adiado";

export default function EnrollmentPendingBanner() {
  const [pending, setPending] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
      } catch {
        // armazenamento indisponível: segue sem lembrar a escolha
      }
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/parent/enrollment", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (alive && res.ok && json?.ok) setPending(Number(json.summary?.pendingCount || 0));
      } catch {
        // falha silenciosa: o aviso é opcional
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (pending <= 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p>
        <span className="font-semibold">Matrícula pendente:</span> há {pending} item(ns) para completar (dados ou documentos).
      </p>
      <div className="flex gap-2">
        <Link href="/parent/matricula" className="rounded-xl bg-amber-700 px-4 py-2 font-semibold text-white">
          Completar agora
        </Link>
        <button
          type="button"
          className="rounded-xl px-3 py-2 font-semibold text-amber-900 underline"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // ignora
            }
            setPending(0);
          }}
        >
          Depois
        </button>
      </div>
    </div>
  );
}
