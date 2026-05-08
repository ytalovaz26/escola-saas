"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MessageRecipient = {
  id: string;
  deliveredAt: string | null;
  readAt: string | null;
};

type MessageRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  audienceType?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  recipient?: MessageRecipient | null;
};

type ApiSummary = {
  total: number;
  unread: number;
  read: number;
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

function getDateValue(message: MessageRow) {
  return (
    message.publishedAt ||
    message.createdAt ||
    message.created_at ||
    new Date().toISOString()
  );
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

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

function formatShortDateBR(value?: string | null) {
  if (!value) return "—";

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

function getAudienceLabel(value?: string | null) {
  const type = String(value || "school").trim().toLowerCase();

  if (type === "class") return "Turma específica";
  if (type === "all_parents") return "Todos os responsáveis";
  if (type === "teachers") return "Professores";
  if (type === "secretaria") return "Secretaria";
  if (type === "staff") return "Equipe escolar";

  return "Escola toda";
}

function getReadLabel(message: MessageRow) {
  if (message.recipient?.readAt) return "Visualizado";
  if (message.recipient?.deliveredAt) return "Entregue";
  return "Recebido";
}

function getReadBadgeClass(message: MessageRow) {
  if (message.recipient?.readAt) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (message.recipient?.deliveredAt) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-600";
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
  variant?: "default" | "highlight" | "success" | "warning";
}) {
  const className =
    variant === "highlight"
      ? "bg-blue-50 text-blue-700"
      : variant === "success"
        ? "bg-emerald-50 text-emerald-700"
        : variant === "warning"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export default function ParentMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [summary, setSummary] = useState<ApiSummary>({
    total: 0,
    unread: 0,
    read: 0,
  });
  const [error, setError] = useState<string | null>(null);

  async function getAccessToken() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token || null;

    if (sessionError || !token) {
      throw new Error(sessionError?.message || "Sessão inválida.");
    }

    return token;
  }

  async function markMessagesAsRead(token: string, rows: MessageRow[]) {
    const unreadMessages = rows.filter((message) => !message.recipient?.readAt);

    if (unreadMessages.length === 0) return;

    setMarkingRead(true);

    try {
      await Promise.all(
        unreadMessages.map(async (message) => {
          const res = await fetch("/api/parent/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            body: JSON.stringify({
              messageId: message.id,
            }),
          });

          const json = await safeJson(res);

          if (!res.ok || !json?.ok) {
            throw new Error(json?.error || "Erro ao marcar comunicado como visualizado.");
          }

          return json;
        })
      );

      const now = new Date().toISOString();

      setMessages((prev) =>
        prev.map((message) => {
          if (message.recipient?.readAt) return message;

          return {
            ...message,
            recipient: {
              id: message.recipient?.id || "",
              deliveredAt: message.recipient?.deliveredAt || now,
              readAt: now,
            },
          };
        })
      );

      setSummary((prev) => ({
        ...prev,
        read: prev.total,
        unread: 0,
      }));
    } catch (e: any) {
      setError(e?.message || "Erro ao registrar visualização dos comunicados.");
    } finally {
      setMarkingRead(false);
    }
  }

  async function loadMessages() {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/parent/messages", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar comunicados.");

        if (res.status === 401 || res.status === 403) {
          router.replace(json?.redirectTo || "/login");
        }

        return;
      }

      const loadedMessages = (json.messages ?? []) as MessageRow[];

      setSchoolId(json.schoolId ? String(json.schoolId) : null);
      setParentId(json.parentId ? String(json.parentId) : null);
      setMessages(loadedMessages);
      setSummary({
        total: Number(json.summary?.total || loadedMessages.length || 0),
        unread: Number(json.summary?.unread || 0),
        read: Number(json.summary?.read || 0),
      });

      await markMessagesAsRead(token, loadedMessages);
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao carregar comunicados.";
      setError(msg);

      if (String(msg).toLowerCase().includes("sessão")) {
        router.replace("/login");
      }
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

  const unreadCount = useMemo(() => {
    return messages.filter((message) => !message.recipient?.readAt).length;
  }, [messages]);

  const readCount = useMemo(() => {
    return messages.filter((message) => !!message.recipient?.readAt).length;
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
                  Avisos, recados e publicações oficiais da escola em um mural organizado
                  para o responsável acompanhar com clareza.
                </p>

                <div className="mt-4 flex flex-col gap-1 text-sm text-slate-200 md:flex-row md:flex-wrap md:gap-3">
                  {schoolId ? (
                    <span>
                      Escola vinculada: <span className="font-mono">{schoolId}</span>
                    </span>
                  ) : null}

                  {parentId ? (
                    <span>
                      Responsável: <span className="font-mono">{parentId}</span>
                    </span>
                  ) : null}

                  {markingRead ? (
                    <span className="font-semibold text-emerald-200">
                      Registrando visualização...
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadMessages}
                  disabled={markingRead}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15 disabled:opacity-60"
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

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
            <SummaryCard
              label="Comunicados"
              value={String(summary.total || messages.length)}
              help="Total de comunicados recebidos por este responsável."
            />

            <SummaryCard
              label="Visualizados"
              value={String(readCount)}
              help="Comunicados que já foram abertos neste portal."
            />

            <SummaryCard
              label="Pendentes"
              value={String(unreadCount)}
              help="Comunicados ainda não marcados como visualizados."
            />

            <SummaryCard
              label="Última publicação"
              value={latestMessage ? formatShortDateBR(getDateValue(latestMessage)) : "—"}
              help={
                latestMessage
                  ? latestMessage.title
                  : "Nenhum comunicado publicado até o momento."
              }
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
                Os comunicados aparecem do mais recente para o mais antigo. Ao abrir esta
                tela, o sistema registra automaticamente a leitura para a escola acompanhar
                quem já visualizou.
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
                    Publicado em {formatDateTimeBR(getDateValue(latestMessage))}
                  </MessageTag>

                  <MessageTag variant={latestMessage.recipient?.readAt ? "success" : "warning"}>
                    {getReadLabel(latestMessage)}
                  </MessageTag>
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
                {oldestMessage ? formatDateTimeBR(getDateValue(oldestMessage)) : "—"}
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
                {messages.map((message, index) => {
                  const dateValue = getDateValue(message);

                  return (
                    <article
                      key={message.id}
                      className={[
                        "rounded-[28px] border bg-white p-5 shadow-sm",
                        message.recipient?.readAt
                          ? "border-slate-200"
                          : "border-blue-200 ring-2 ring-blue-50",
                      ].join(" ")}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <div
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getRelativeTone(
                                index
                              )}`}
                            >
                              Comunicado oficial
                            </div>

                            <div
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getReadBadgeClass(
                                message
                              )}`}
                            >
                              {getReadLabel(message)}
                            </div>
                          </div>

                          <h3 className="mt-3 text-lg font-semibold text-slate-900">
                            {message.title}
                          </h3>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <MessageTag variant="highlight">
                              Publicado em {formatDateTimeBR(dateValue)}
                            </MessageTag>

                            <MessageTag>{getAudienceLabel(message.audienceType)}</MessageTag>

                            {message.recipient?.deliveredAt ? (
                              <MessageTag>
                                Entregue em {formatDateTimeBR(message.recipient.deliveredAt)}
                              </MessageTag>
                            ) : null}

                            {message.recipient?.readAt ? (
                              <MessageTag variant="success">
                                Visualizado em {formatDateTimeBR(message.recipient.readAt)}
                              </MessageTag>
                            ) : (
                              <MessageTag variant="warning">Leitura pendente</MessageTag>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] font-mono text-slate-400">
                          {message.id.slice(0, 8)}…
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">
                        {message.body}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}