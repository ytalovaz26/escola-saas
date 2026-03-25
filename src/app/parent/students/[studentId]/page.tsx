"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
    class: null | { id: string; name: string; grade: string | null; shift: string | null };
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

function classLabel(c: NonNullable<NonNullable<ChildRow["active_class"]>["class"]>) {
  const parts = [c.name];
  if (c.grade) parts.push(c.grade);
  if (c.shift) parts.push(c.shift);
  return parts.join(" • ");
}

export default function ParentStudentPage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const studentId = params?.studentId;

  const [loading, setLoading] = useState(true);
  const [child, setChild] = useState<ChildRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => child?.full_name || "Aluno", [child]);

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
          setError(json?.error || "Falha ao carregar dados do responsável.");
          if (res.status === 401) router.replace("/login");
          return;
        }

        const list = (json.children ?? []) as ChildRow[];
        const found = list.find((x) => x.id === studentId) || null;

        if (!found) {
          setError("Você não tem permissão para ver este aluno (não está vinculado).");
          return;
        }

        setChild(found);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, studentId]);

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-semibold">Erro</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
          <button onClick={() => router.push("/parent/children")} className="mt-4 w-full rounded-xl bg-gray-900 text-white p-3">
            Voltar
          </button>
        </div>
      </main>
    );
  }

  if (!child) return null;

  const cls = child.active_class?.class;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">{title}</h1>
            <p className="text-sm text-gray-600 mt-1">
              {child.registration_number ? `Matrícula: ${child.registration_number}` : "Sem matrícula"}
              {child.relationship ? ` • ${child.relationship}` : ""}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Turma ativa:{" "}
              {cls ? <span className="font-medium">{classLabel(cls)}</span> : <span className="text-gray-600">Sem turma ativa</span>}
            </p>
          </div>

          <button onClick={() => router.push("/parent/children")} className="rounded-xl border px-4 py-2">
            Voltar
          </button>
        </header>

        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Presença</h2>
          <p className="text-sm text-gray-600 mt-1">Escolha o tipo de visualização.</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-gray-900 text-white px-4 py-2"
              onClick={() => router.push(`/parent/students/${child.id}/daily`)}
            >
              Ver presença diária
            </button>

            <button
              className="rounded-xl border px-4 py-2"
              onClick={() => router.push(`/parent/students/${child.id}/monthly`)}
            >
              Ver presença mensal
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}