"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MessageRow = {
  id: string;
  school_id: string;
  created_by: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
};

export default function SchoolMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publishing, setPublishing] = useState(false);

  const [messages, setMessages] = useState<MessageRow[]>([]);

  async function loadMessages(sid: string) {
    const { data, error } = await supabase
      .from("messages")
      .select("id,school_id,created_by,title,body,status,created_at")
      .eq("school_id", sid)
      .order("created_at", { ascending: false });

    if (error) {
      setError("Erro ao carregar comunicados: " + error.message);
      return;
    }

    setMessages((data ?? []) as MessageRow[]);
  }

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const meText = await meRes.text();
        const me = meText ? JSON.parse(meText) : null;

        if (!meRes.ok || !me?.ok) {
          setError(me?.error || "Falha ao validar sessão.");
          return;
        }

        if (me?.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        const r = me?.school?.role ? String(me.school.role) : null;
        const sid = me?.school?.schoolId ? String(me.school.schoolId) : null;

        setRole(r);
        setSchoolId(sid);

        // só diretor/coordenador acessa
        if (r !== "diretor" && r !== "coordenador" && r !== "director" && r !== "coordinator") {
          router.replace("/school");
          return;
        }

        if (!sid) {
          setError("Usuário sem escola vinculada.");
          return;
        }

        await loadMessages(sid);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function publish() {
    if (!title.trim()) return alert("Informe o título.");
    if (!body.trim()) return alert("Informe o conteúdo.");

    try {
      setPublishing(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        alert("Sessão inválida. Faça login novamente.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/school/messages/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: text || "Resposta inválida" };
      }

      if (!res.ok || !json?.ok) {
        alert("Erro ao criar comunicado: " + (json?.error || "desconhecido"));
        return;
      }

      setTitle("");
      setBody("");

      if (schoolId) await loadMessages(schoolId);
      alert("Comunicado publicado ✅");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="p-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-semibold">Erro</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
          <button onClick={() => router.push("/school")} className="mt-4 rounded-xl border px-4 py-2">
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
            <h1 className="text-2xl font-semibold">Comunicados</h1>
            <p className="text-sm text-gray-600 mt-1">
              Escola: <span className="font-mono text-xs">{schoolId}</span> • Perfil:{" "}
              <span className="font-medium">{role}</span>
            </p>
          </div>
          <button onClick={() => router.push("/school")} className="rounded-xl border px-4 py-2">
            Voltar
          </button>
        </header>

        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Criar aviso / comunicado</h2>

          <div className="mt-3 space-y-3">
            <input
              className="border rounded-xl p-3 w-full"
              placeholder="Título do comunicado"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <textarea
              className="border rounded-xl p-3 w-full min-h-[140px]"
              placeholder="Digite o conteúdo..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <button
            onClick={publish}
            disabled={publishing}
            className="mt-4 rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-60"
          >
            {publishing ? "Publicando..." : "Publicar"}
          </button>

          <p className="text-xs text-gray-500 mt-3">
            Próximo passo: segmentação (por turma/aluno) + anexos + confirmação de leitura.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Comunicados publicados</h2>

          {messages.length === 0 ? (
            <p className="text-sm text-gray-600 mt-3">Nenhum comunicado ainda.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {messages.map((m) => (
                <article key={m.id} className="border rounded-2xl p-4 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium">{m.title}</h3>
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
      </div>
    </main>
  );
}
