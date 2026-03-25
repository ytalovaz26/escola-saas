"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
};

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao validar sessão/perfil.");
          return;
        }

        const payload = json as MePayload;
        if (payload.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }
        if (payload.school?.role !== "diretor") {
          router.replace("/login");
          return;
        }

        setSchoolId(payload.school.schoolId);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-semibold">Erro</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
          <button
            onClick={() => router.push("/school")}
            className="mt-4 w-full rounded-xl bg-gray-900 text-white p-3"
          >
            Voltar ao painel
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Financeiro</h1>
            <p className="text-sm text-gray-600 mt-1">
              Escola: <span className="font-mono text-xs">{schoolId}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/school")}
              className="rounded-xl border px-4 py-2"
            >
              Painel
            </button>
            <button
              onClick={logout}
              className="rounded-xl bg-gray-900 text-white px-4 py-2"
            >
              Sair
            </button>
          </div>
        </header>

        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Em implementação</h2>
          <p className="text-sm text-gray-600 mt-2">
            Próximo passo: mensalidades, status, cobrança e relatórios com isolamento por escola (RLS).
          </p>
        </section>
      </div>
    </main>
  );
}
