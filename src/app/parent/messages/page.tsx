"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type MessageRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
};

export default function ParentMessagesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
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

        // valida quem é (pai) e pega schoolId
        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const me = await meRes.json();

        if (!meRes.ok || !me?.ok) {
          setError(me?.error || "Falha ao validar sessão.");
          return;
        }

        if (!me?.parent?.parentId || !me?.parent?.schoolId) {
          router.replace(me?.redirectTo || "/login");
          return;
        }

        const sid = String(me.parent.schoolId);
        setSchoolId(sid);

        // ✅ comunicados gerais da escola (messages)
        const { data, error } = await supabase
          .from("messages")
          .select("id,title,body,status,created_at")
          .eq("school_id", sid)
          .eq("status", "published")
          .order("created_at", { ascending: false });

        if (error) {
          setError(error.message);
          return;
        }

        setMessages((data ?? []) as MessageRow[]);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <div>Carregando...</div>;
  if (error) return <div className="text-red-600">Erro: {error}</div>;

  return (
    <section className="bg-white rounded-2xl shadow p-5">
      <h1 className="text-xl font-semibold">Comunicados</h1>
      <p className="text-sm text-gray-600 mt-2">
        {schoolId ? (
          <>
            Você está vendo os comunicados gerais da sua escola.{" "}
            <span className="font-mono text-xs">({schoolId})</span>
          </>
        ) : (
          "Você está vendo os comunicados gerais da sua escola."
        )}
      </p>

      {messages.length === 0 ? (
        <p className="text-sm text-gray-600 mt-4">Nenhum comunicado publicado ainda.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {messages.map((m) => (
            <article key={m.id} className="border rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium">{m.title}</h2>
                <span className="text-xs text-gray-500">
                  {new Date(m.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{m.body}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
