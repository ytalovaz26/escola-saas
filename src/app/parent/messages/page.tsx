"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MessageRecipient = {
  id: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt?: string | null;
};

type MessageRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  audienceType?: string | null;
  audienceLabel?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  recipient?: MessageRecipient | null;
  flags?: {
    unread?: boolean;
    delivered?: boolean;
    read?: boolean;
    recent?: boolean;
  };
};

type ChildRow = {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  relationship: string | null;
};

type ApiSummary = {
  total: number;
  unread: number;
  read: number;
  delivered?: number;
  recent?: number;
  children?: number;
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

function daysSince(value?: string | null) {
  if (!value) return 9999;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 9999;

  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getAudienceLabel(value?: string | null) {
  const type = String(value || "school").trim().toLowerCase();

  if (type === "class") return "Turma específica";
  if (type === "all_parents") return "Todos os responsáveis";
  if (type === "parents") return "Todos os responsáveis";
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

function getAudienceBadgeClass(message: MessageRow) {
  const type = String(message.audienceType || "").toLowerCase();

  if (type === "class") return "border-violet-200 bg-violet-50 text-violet-700";
  if (type === "all_parents" || type === "parents") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function isRecent(message: MessageRow) {
  if (message.flags?.recent === true) return true;
  return daysSince(getDateValue(message)) <= 7;
}

function isUnread(message: MessageRow) {
  return !message.recipient?.readAt;
}

function SummaryCard({
  label,
  value,
  help,
  tone = "default",
}: {
  label: string;
  value: string;
  help: string;
  tone?: "default" | "blue" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50"
          : tone === "red"
            ? "border-red-200 bg-red-50"
            : "border-slate-200 bg-white";

  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-600">{help}</div>
    </div>
  );
}

function MessageTag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "highlight" | "success" | "warning" | "danger";
}) {
  const className =
    variant === "highlight"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : variant === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : variant === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : variant === "danger"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[32px] border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-3xl shadow-sm">
        📭
      </div>

      <h3 className="mt-5 text-xl font-bold text-slate-950">{title}</h3>

      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

export default function ParentMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [parentName, setParentName] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [summary, setSummary] = useState<ApiSummary>({
    total: 0,
    unread: 0,
    read: 0,
    delivered: 0,
    recent: 0,
    children: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "recent" | "unread" | "read">("all");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

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
              createdAt: message.recipient?.createdAt || null,
            },
            flags: {
              ...(message.flags || {}),
              unread: false,
              delivered: true,
              read: true,
            },
          };
        })
      );

      setSummary((prev) => ({
        ...prev,
        read: prev.total,
        unread: 0,
        delivered: prev.total,
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

      setSchoolName(json.schoolName || json.school?.name || null);
      setParentName(json.parentName || null);
      setChildren(Array.isArray(json.children) ? json.children : []);
      setMessages(loadedMessages);
      setSelectedMessageId(loadedMessages[0]?.id || null);

      setSummary({
        total: Number(json.summary?.total || loadedMessages.length || 0),
        unread: Number(json.summary?.unread || 0),
        read: Number(json.summary?.read || 0),
        delivered: Number(json.summary?.delivered || 0),
        recent: Number(json.summary?.recent || 0),
        children: Number(json.summary?.children || 0),
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

  const visibleMessages = useMemo(() => {
    if (filter === "recent") return messages.filter(isRecent);
    if (filter === "unread") return messages.filter(isUnread);
    if (filter === "read") return messages.filter((message) => !!message.recipient?.readAt);

    return messages;
  }, [messages, filter]);

  const latestMessage = useMemo(() => {
    return messages.length > 0 ? messages[0] : null;
  }, [messages]);

  const selectedMessage = useMemo(() => {
    if (!selectedMessageId) return latestMessage;
    return messages.find((message) => message.id === selectedMessageId) || latestMessage;
  }, [messages, selectedMessageId, latestMessage]);

  const unreadCount = useMemo(() => {
    return messages.filter((message) => !message.recipient?.readAt).length;
  }, [messages]);

  const readCount = useMemo(() => {
    return messages.filter((message) => !!message.recipient?.readAt).length;
  }, [messages]);

  const recentCount = useMemo(() => {
    return messages.filter(isRecent).length;
  }, [messages]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-56 rounded-[36px] bg-slate-200" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div className="h-32 rounded-[28px] bg-white" />
              <div className="h-32 rounded-[28px] bg-white" />
              <div className="h-32 rounded-[28px] bg-white" />
              <div className="h-32 rounded-[28px] bg-white" />
              <div className="h-32 rounded-[28px] bg-white" />
            </div>
            <div className="h-96 rounded-[32px] bg-white" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
          <div className="relative overflow-hidden bg-slate-950 px-6 py-10 text-white md:px-8 md:py-12">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute -bottom-24 left-20 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                  Comunicação oficial
                </div>

                <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                  Comunicados da escola
                </h1>

                <p className="mt-4 text-base leading-8 text-slate-200">
                  Acompanhe avisos importantes, recados oficiais e publicações enviadas pela
                  escola para sua família.
                </p>

                <div className="mt-5 flex flex-wrap gap-2 text-sm text-slate-200">
                  {schoolName ? (
                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Escola: <strong>{schoolName}</strong>
                    </span>
                  ) : null}

                  {parentName ? (
                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Responsável: <strong>{parentName}</strong>
                    </span>
                  ) : null}

                  {markingRead ? (
                    <span className="rounded-full bg-emerald-500/20 px-3 py-1 font-semibold text-emerald-100">
                      Registrando leitura...
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={loadMessages}
                  disabled={markingRead}
                  className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15 disabled:opacity-60"
                >
                  Recarregar
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent/calendar")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver agenda
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent")}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
                >
                  Voltar ao portal
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-5 md:p-6">
            <SummaryCard
              label="Comunicados"
              value={String(summary.total || messages.length)}
              help="Total de comunicados recebidos."
              tone="blue"
            />

            <SummaryCard
              label="Recentes"
              value={String(recentCount)}
              help="Publicados nos últimos 7 dias."
              tone="amber"
            />

            <SummaryCard
              label="Visualizados"
              value={String(readCount)}
              help="Comunicados já marcados como lidos."
              tone="green"
            />

            <SummaryCard
              label="Pendentes"
              value={String(unreadCount)}
              help="Ainda não marcados como visualizados."
              tone="red"
            />

            <SummaryCard
              label="Filhos"
              value={String(children.length)}
              help="Alunos vinculados à sua conta."
            />
          </div>
        </section>

        {error ? (
          <div className="rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Destaque do mural
            </div>

            {selectedMessage ? (
              <div className="mt-4 rounded-[28px] bg-slate-950 p-6 text-white">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                    {formatShortDateBR(getDateValue(selectedMessage))}
                  </span>

                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                    {selectedMessage.audienceLabel || getAudienceLabel(selectedMessage.audienceType)}
                  </span>

                  {isRecent(selectedMessage) ? (
                    <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-slate-950">
                      Recente
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-5 text-2xl font-bold leading-tight">
                  {selectedMessage.title}
                </h2>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">
                  {selectedMessage.body || "Sem conteúdo adicional."}
                </p>
              </div>
            ) : (
              <EmptyState
                title="Nenhum comunicado disponível"
                description="Quando a escola publicar novos comunicados, eles aparecerão neste mural."
              />
            )}

            {children.length > 0 ? (
              <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Alunos vinculados
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {children.map((child) => (
                    <span
                      key={child.id}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {child.fullName}
                      {child.registrationNumber ? ` • Mat. ${child.registrationNumber}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Filtro do mural
                </div>

                <h2 className="mt-2 text-2xl font-bold text-slate-950">
                  Publicações recebidas
                </h2>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "Todos"],
                  ["recent", "Recentes"],
                  ["unread", "Pendentes"],
                  ["read", "Lidos"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value as any)}
                    className={[
                      "rounded-2xl px-4 py-2 text-sm font-bold transition",
                      filter === value
                        ? "bg-slate-950 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-[24px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Ao abrir esta tela, o sistema registra automaticamente a leitura dos comunicados
              recebidos. Isso ajuda a escola a acompanhar se os responsáveis visualizaram os
              avisos importantes.
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Todos os responsáveis
              </span>

              <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">
                Turma específica
              </span>

              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                Visualizado
              </span>

              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                Recente
              </span>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">
                  Mural da escola
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Mensagens publicadas oficialmente para os responsáveis.
                </p>
              </div>

              <div className="text-sm text-slate-500">
                {visibleMessages.length} comunicado(s)
              </div>
            </div>
          </div>

          <div className="p-4 md:p-6">
            {visibleMessages.length === 0 ? (
              <EmptyState
                title="Nenhum comunicado nesta visualização"
                description="Altere o filtro ou aguarde novas publicações da escola."
              />
            ) : (
              <div className="space-y-4">
                {visibleMessages.map((message) => {
                  const dateValue = getDateValue(message);
                  const selected = selectedMessageId === message.id;

                  return (
                    <article
                      key={message.id}
                      onClick={() => setSelectedMessageId(message.id)}
                      className={[
                        "cursor-pointer rounded-[28px] border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                        selected
                          ? "border-slate-950 ring-2 ring-slate-100"
                          : message.recipient?.readAt
                            ? "border-slate-200"
                            : "border-blue-200 ring-2 ring-blue-50",
                      ].join(" ")}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                              Comunicado oficial
                            </div>

                            <div
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${getReadBadgeClass(
                                message
                              )}`}
                            >
                              {getReadLabel(message)}
                            </div>

                            <div
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${getAudienceBadgeClass(
                                message
                              )}`}
                            >
                              {message.audienceLabel || getAudienceLabel(message.audienceType)}
                            </div>

                            {isRecent(message) ? (
                              <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                                Recente
                              </div>
                            ) : null}
                          </div>

                          <h3 className="mt-3 text-lg font-bold text-slate-950">
                            {message.title}
                          </h3>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <MessageTag variant="highlight">
                              Publicado em {formatDateTimeBR(dateValue)}
                            </MessageTag>

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

                        <button
                          type="button"
                          className={[
                            "rounded-2xl px-4 py-2 text-xs font-bold transition",
                            selected
                              ? "bg-slate-950 text-white"
                              : "border border-slate-300 text-slate-700 hover:bg-slate-50",
                          ].join(" ")}
                        >
                          {selected ? "Selecionado" : "Ver destaque"}
                        </button>
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