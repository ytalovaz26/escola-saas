"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function AppHome() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setEmail(data.session.user.email ?? "");
    });
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="p-4 max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow p-6">
        <h1 className="text-xl font-semibold">Painel</h1>
        <p className="text-sm text-gray-600 mt-1">
          Logado como: <b>{email}</b>
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="border rounded-xl p-4 text-left hover:bg-gray-50">
            Comunicados (MVP)
            <div className="text-xs text-gray-500 mt-1">Professor → Aprovação → Pais</div>
          </button>

          <button className="border rounded-xl p-4 text-left hover:bg-gray-50">
            Agenda / Cardápio (MVP)
            <div className="text-xs text-gray-500 mt-1">Calendário e rotina</div>
          </button>

          <button className="border rounded-xl p-4 text-left hover:bg-gray-50">
            Mensalidades (MVP)
            <div className="text-xs text-gray-500 mt-1">Lembretes e status</div>
          </button>

          <button className="border rounded-xl p-4 text-left hover:bg-gray-50">
            “Modo aluno” (dentro dos pais)
            <div className="text-xs text-gray-500 mt-1">Somente visualização</div>
          </button>
        </div>

        <button
          onClick={logout}
          className="mt-6 rounded-xl bg-gray-100 px-4 py-2 hover:bg-gray-200"
        >
          Sair
        </button>
      </div>
    </main>
  );
}
