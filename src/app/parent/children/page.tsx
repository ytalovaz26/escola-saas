// src/app/parent/children/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ChildRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
  relationship: string | null;
  active_class: null | {
    class_id: string;
    started_at: string;
    ended_at: string | null;
    class: null | {
      id: string;
      name: string;
      grade: string | null;
      shift: string | null;
    };
  };
};

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

export default function ParentChildrenPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/parent/children", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const json = await safeJson(res);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao carregar seus filhos.");
          if (res.status === 401) router.replace("/login");
          return;
        }

        setChildren((json.children ?? []) as ChildRow[]);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-semibold">Erro</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
          <button
            onClick={() => router.push("/parent")}
            className="mt-4 w-full rounded-xl bg-gray-900 text-white p-3"
          >
            Voltar
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
            <h1 className="text-2xl font-semibold">Meus filhos</h1>
            <p className="text-sm text-gray-600 mt-1">Alunos vinculados ao seu cadastro.</p>
          </div>

          <button
            onClick={() => router.push("/parent")}
            className="rounded-xl border px-4 py-2"
          >
            Voltar
          </button>
        </header>

        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          {children.length === 0 ? (
            <p className="text-sm text-gray-600">
              Nenhum aluno vinculado a este responsável.
              <br />
              Peça para a escola vincular você a um aluno.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {children.map((c) => {
                const cls = c.active_class?.class;
                return (
                  <li key={c.id} className="border rounded-2xl p-4">
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {c.registration_number ? `Matrícula: ${c.registration_number}` : "Sem matrícula"}
                      {c.relationship ? ` • Parentesco: ${c.relationship}` : ""}
                    </div>

                    <div className="mt-3 text-sm">
                      <div className="text-xs text-gray-500">Turma ativa</div>
                      {cls ? (
                        <div className="mt-1">
                          <div className="font-medium">{cls.name}</div>
                          <div className="text-xs text-gray-600">
                            {cls.grade ?? "—"} • {cls.shift ?? "—"}
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-600 mt-1">Sem turma ativa</div>
                      )}
                    </div>

                    <div className="mt-4">
                      <button
                        className="rounded-xl border px-3 py-2 text-sm"
                        onClick={() => router.push(`/parent/students/${c.id}`)}
                      >
                        Ver presença
                      </button>
                    </div>

                    <div className="text-[11px] text-gray-500 font-mono mt-3 break-all">
                      {c.id}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}