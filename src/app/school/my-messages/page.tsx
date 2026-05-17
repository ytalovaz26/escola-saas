"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StaffMessageRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  audienceType: string;
  audienceLabel: string;
  publishedAt: string;
  createdAt: string;
  recipient: null | {
    id: string;
    recipientType?: string | null;
    deliveredAt: string | null;
    readAt: string | null;
  };
};

type ApiPayload = {
  ok: true;
  schoolId: string;
  userId: string;
  role: string;
  roleLabel: string;
  messages: StaffMessageRow[];
  summary: {
    total: number;
    unread: number;
    read: number;
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

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

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
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getMessageTone(index: number) {
  const tones = [
    "border-blue-200 bg-blue-50 text-blue-700",
    "border-emerald-200 bg-emerald-50 text-emerald-700",
    "border-amber-200 bg-amber-50 text-amber-700",
    "border-violet-200 bg-violet-50 text-violet-700",
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
  variant?: "default" | "highlight" | "success" | "warning";
}) {
  const classes = {
    default: "bg-slate-100 text-slate-600",
    highlight: "bg-blue-50 text-blue-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
  };

  return (
    <span
      className={[
        "inline-flex rounded-full px-3 py-1 text-xs font-medium",
        classes[variant],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function SchoolMyMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [roleLabel, setRoleLabel] = useState<string>("Equipe escolar");
  const [messages, setMessages] = useState<StaffMessageRow[]>([]);
  const [summary, setSummary] = useState<ApiPayload["summary"]>({
    total: 0,
    unread: 0,
    read: 0,
  });
  const [error, setError] = useState<string | null>(null);

  async function getAccessToken() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session?.access_token) {
      throw new Error(sessionError?.message || "Sessão inválida.");
    }

    return sessionData.session.access_token;
  }

  async function markMessagesAsRead(token: string, rows: StaffMessageRow[]) {
    const unreadRows = rows.filter((row) => !row.recipient?.readAt);

    if (unreadRows.length === 0) return;

    await Promise.allSettled(
      unreadRows.map((row) =>
        fetch("/api/school/my-messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          body: JSON.stringify({ messageId: row.id }),
        })
      )
    );
  }

  async function loadMessages({ markAsRead = true }: { markAsRead?: boolean } = {}) {
    try {
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/school/my-messages", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = (await safeJson(res)) as ApiPayload | any;

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao carregar comunicados recebidos.");

        if (res.status === 401 || res.status === 403) {
          router.replace("/login");
        }

        return;
      }

      const loadedMessages = (json.messages || []) as StaffMessageRow[];

      setSchoolId(json.schoolId || null);
      setUserId(json.userId || null);
      setRoleLabel(json.roleLabel || "Equipe escolar");
      setMessages(loadedMessages);
      setSummary(
        json.summary || {
          total: loadedMessages.length,
          unread: loadedMessages.filter((row) => !row.recipient?.readAt).length,
          read: loadedMessages.filter((row) => !!row.recipient?.readAt).length,
        }
      );

      if (markAsRead && loadedMessages.some((row) => !row.recipient?.readAt)) {
        await markMessagesAsRead(token, loadedMessages);

        const refreshed = await fetch("/api/school/my-messages", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const refreshedJson = (await safeJson(refreshed)) as ApiPayload | any;

        if (refreshed.ok && refreshedJson?.ok) {
          setMessages((refreshedJson.messages || []) as StaffMessageRow[]);
          setSummary(
            refreshedJson.summary || {
              total: 0,
              unread: 0,
              read: 0,
            }
          );
        }
      }
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao carregar comunicados.";

      setError(msg);

      if (msg.toLowerCase().includes("sessão")) {
        router.replace("/login");
      }
    }
  }

  async function refresh() {
    try {
      setRefreshing(true);
      await loadMessages({ markAsRead: true });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadMessages({ markAsRead: true });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestMessage = useMemo(() => messages[0] || null, [messages]);

  const unreadCount = useMemo(
    () => messages.filter((message) => !message.recipient?.readAt).length,
    [messages]
  );

  const readCount = useMemo(
    () => messages.filter((message) => !!message.recipient?.readAt).length,
    [messages]
  );

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-72 rounded-xl bg-slate-200" />
            <div className="h-4 w-96 rounded-xl bg-slate-100" />
            <div className="h-40 rounded-[28px] bg-slate-100" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Comunicação interna
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Meus comunicados
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                Avisos oficiais enviados para você como membro da equipe escolar. Ao abrir
                esta página, os comunicados recebidos são marcados como visualizados.
              </p>

              <div className="mt-4 flex flex-col gap-1 text-sm text-slate-200 md:flex-row md:flex-wrap md:gap-3">
                {schoolId ? (
                  <span>
                    Escola vinculada: <span className="font-mono">{schoolId}</span>
                  </span>
                ) : null}

                {userId ? (
                  <span>
                    Usuário: <span className="font-mono">{userId}</span>
                  </span>
                ) : null}

                <span>
                  Perfil: <span className="font-semibold">{roleLabel}</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15 disabled:opacity-60"
              >
                {refreshing ? "Atualizando..." : "Atualizar"}
              </button>

              <button
                type="button"
                onClick={() => router.push("/school/messages")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Comunicados enviados
              </button>

              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Voltar ao painel
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <SummaryCard
            label="Recebidos"
            value={String(summary.total || messages.length)}
            help="Total de comunicados disponíveis para este usuário."
          />

          <SummaryCard
            label="Visualizados"
            value={String(summary.read || readCount)}
            help="Comunicados que já foram abertos."
          />

          <SummaryCard
            label="Não lidos"
            value={String(summary.unread || unreadCount)}
            help="Após abrir esta tela, novos comunicados são marcados como lidos."
          />

          <SummaryCard
            label="Último aviso"
            value={latestMessage ? formatShortDateBR(latestMessage.publishedAt) : "—"}
            help={latestMessage ? latestMessage.title : "Nenhum comunicado recebido ainda."}
          />
        </div>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Comunicados recebidos
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Mensagens enviadas oficialmente pela direção, coordenação, secretaria ou
            administração escolar.
          </p>
        </div>

        <div className="p-4 md:p-6">
          {messages.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              Nenhum comunicado recebido até o momento.
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isRead = !!message.recipient?.readAt;

                return (
                  <article
                    key={message.id}
                    className={[
                      "rounded-[28px] border bg-white p-5 shadow-sm",
                      isRead ? "border-slate-200" : "border-blue-200 ring-2 ring-blue-50",
                    ].join(" ")}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getMessageTone(
                              index
                            )}`}
                          >
                            Comunicado oficial
                          </span>

                          <MessageTag variant="highlight">
                            {message.audienceLabel || "Equipe escolar"}
                          </MessageTag>

                          <MessageTag variant={isRead ? "success" : "warning"}>
                            {isRead ? "Visualizado" : "Novo"}
                          </MessageTag>
                        </div>

                        <h3 className="mt-3 text-lg font-semibold text-slate-900">
                          {message.title}
                        </h3>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <MessageTag variant="highlight">
                            Publicado em {formatDateTimeBR(message.publishedAt)}
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

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">
                          {message.body}
                        </div>
                      </div>

                      <div className="text-[11px] font-mono text-slate-400">
                        {message.id.slice(0, 8)}…
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}