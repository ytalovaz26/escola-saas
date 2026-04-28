"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type MessageRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
};

function formatDateTimeBR(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDateBR(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getRelativeTone(index: number) {
  const tones = [
    "bg-blue-50 text-blue-700 border-blue-200",
    "bg-emerald-50 text-emerald-700 border-emerald-200",
    "bg-amber-50 text-amber-700 border-amber-200",
    "bg-violet-50 text-violet-700 border-violet-200",
  ];

  return tones[index % tones.length];
}

function SummaryCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

function MessageTag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "highlight";
}) {
  return (
    <span
      className={[
        "inline-flex rounded-full px-3 py-1 text-xs font-medium",
        variant === "highlight"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-600",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function ParentMessagesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadMessages() {
    try {
      setLoading(true);
      setError(null);

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
  }

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const latestMessage = useMemo(() => {
    return messages.length > 0 ? messages[0] : null;
  }, [messages]);

  const oldestMessage = useMemo(() => {
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }, [messages]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-48 rounded-[32px] bg-slate-200" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-32 rounded-[28px] bg-slate-100" />
              <div className="h-32 rounded-[28px] bg-slate-100" />
              <div className="h-32 rounded-[28px] bg-slate-100" />
            </div>
            <div className="h-96 rounded-[28px] bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Comunicação escolar
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Comunicados
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Avisos, recados e publicações oficiais da escola em um mural
                  organizado para o responsável acompanhar com clareza.
                </p>

                {schoolId ? (
                  <div className="mt-4 text-sm text-slate-200">
                    Escola vinculada: <span className="font-mono">{schoolId}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadMessages}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Recarregar
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent/calendar")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver agenda
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent")}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Voltar ao portal
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <SummaryCard
              label="Comunicados"
              value={String(messages.length)}
              help="Total de comunicados publicados e disponíveis para leitura."
            />

            <SummaryCard
              label="Última publicação"
              value={latestMessage ? formatShortDateBR(latestMessage.created_at) : "—"}
              help={
                latestMessage
                  ? latestMessage.title
                  : "Nenhum comunicado publicado até o momento."
              }
            />

            <SummaryCard
              label="Canal oficial"
              value="Escola"
              help="Espaço centralizado para avisos oficiais aos responsáveis."
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Visão do mural
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Aqui ficam concentradas as publicações mais importantes da escola.
            </p>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                Os comunicados aparecem do mais recente para o mais antigo, ajudando o
                responsável a acompanhar as informações mais atuais primeiro.
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Destaque do mural
            </div>

            {latestMessage ? (
              <div className="mt-3">
                <div className="text-lg font-semibold text-slate-900">
                  {latestMessage.title}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <MessageTag variant="highlight">
                    Publicado em {formatDateTimeBR(latestMessage.created_at)}
                  </MessageTag>
                  <MessageTag>Mensagem oficial</MessageTag>
                </div>

                <div className="mt-4 text-sm leading-6 text-slate-600 line-clamp-5">
                  {latestMessage.body}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-slate-500">
                Ainda não há comunicados disponíveis no mural.
              </div>
            )}

            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Registro mais antigo
              </div>
              <div className="mt-2 text-sm text-slate-700">
                {oldestMessage ? formatDateTimeBR(oldestMessage.created_at) : "—"}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Mural da escola
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Mensagens publicadas oficialmente para os responsáveis.
            </p>
          </div>

          <div className="p-4 md:p-6">
            {messages.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Nenhum comunicado publicado ainda.
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, index) => (
                  <article
                    key={m.id}
                    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getRelativeTone(
                            index
                          )}`}
                        >
                          Comunicado oficial
                        </div>

                        <h3 className="mt-3 text-lg font-semibold text-slate-900">
                          {m.title}
                        </h3>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <MessageTag variant="highlight">
                            Publicado em {formatDateTimeBR(m.created_at)}
                          </MessageTag>
                          <MessageTag>Status: {m.status}</MessageTag>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400 font-mono">
                        {m.id.slice(0, 8)}…
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">
                      {m.body}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}