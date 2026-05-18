"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AudienceType =
  | "all_parents"
  | "parent_individual"
  | "class"
  | "teachers"
  | "teachers_class"
  | "teacher_individual"
  | "coordinators"
  | "secretaria"
  | "staff"
  | "school";

type MessageCategory = "normal" | "advertencia_suspensao";

type MessageStats = {
  sent: number;
  delivered: number;
  read: number;
  pending: number;
};

type SchoolMessage = {
  id: string;
  school_id: string;
  created_by: string | null;
  title: string;
  body: string;
  status: string | null;
  audience_type: string | null;
  target_class_id: string | null;
  target_role: string | null;
  published_at: string | null;
  created_at: string | null;
  audienceLabel?: string | null;
  targetClass?: {
    id: string;
    name: string | null;
    grade?: string | null;
    shift?: string | null;
  } | null;
  stats?: MessageStats;
};

type SelectableParent = {
  id: string;
  parentId?: string;
  userId?: string | null;
  fullName?: string | null;
  name?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
};

type SelectableStaff = {
  id: string;
  userId?: string;
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  roleLabel?: string | null;
};

type ClassRow = {
  id: string;
  name: string;
  grade?: string | null;
  shift?: string | null;
};

type RecipientStatusRow = {
  id?: string;
  recipientId?: string;
  recipient_id?: string;
  recipientUserId?: string | null;
  recipient_user_id?: string | null;
  recipientType?: string;
  recipient_type?: string;
  type?: string | null;
  name?: string | null;
  displayName?: string | null;
  fullName?: string | null;
  full_name?: string | null;
  recipientName?: string | null;
  recipient_name?: string | null;
  email?: string | null;
  phone?: string | null;
  deliveredAt?: string | null;
  delivered_at?: string | null;
  readAt?: string | null;
  read_at?: string | null;
  status?: string | null;
};

type RecipientModal = {
  title: string;
  subtitle: string;
  messageTitle: string;
  rows: RecipientStatusRow[];
  stats: MessageStats;
} | null;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function safeNumber(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAudienceType(value: unknown): AudienceType {
  const v = String(value || "all_parents").trim().toLowerCase();

  if (v === "teacher_class") return "teachers_class";

  const allowed: AudienceType[] = [
    "all_parents",
    "parent_individual",
    "class",
    "teachers",
    "teachers_class",
    "teacher_individual",
    "coordinators",
    "secretaria",
    "staff",
    "school",
  ];

  return allowed.includes(v as AudienceType) ? (v as AudienceType) : "all_parents";
}

function normalizeRecipientType(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();

  if (raw === "parent" || raw === "responsavel" || raw === "responsável") {
    return "Responsável";
  }

  if (raw === "professor" || raw === "teacher") {
    return "Professor";
  }

  if (raw === "coordenador" || raw === "coordinator") {
    return "Coordenador";
  }

  if (raw === "secretaria" || raw === "secretary") {
    return "Secretaria";
  }

  if (raw === "diretor" || raw === "director") {
    return "Diretor";
  }

  if (raw === "admin" || raw === "administrador") {
    return "Administrador";
  }

  if (raw === "staff" || raw === "equipe" || raw === "equipe_escolar") {
    return "Equipe escolar";
  }

  if (raw === "user" || raw === "usuario" || raw === "usuário") {
    return "Usuário";
  }

  return cleanText(value) || "Destinatário";
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatDateBR(value?: string | null) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleDateString("pt-BR");
  } catch {
    return value;
  }
}

function getStats(message: SchoolMessage): MessageStats {
  return {
    sent: safeNumber(message.stats?.sent),
    delivered: safeNumber(message.stats?.delivered),
    read: safeNumber(message.stats?.read),
    pending: safeNumber(message.stats?.pending),
  };
}

function audienceLabel(type: AudienceType) {
  if (type === "all_parents") return "Todos os pais/responsáveis";
  if (type === "parent_individual") return "Pais individuais";
  if (type === "class") return "Responsáveis de uma turma";
  if (type === "teachers") return "Todos os professores";
  if (type === "teachers_class") return "Professores de uma turma";
  if (type === "teacher_individual") return "Professor individual";
  if (type === "coordinators") return "Coordenadores";
  if (type === "secretaria") return "Secretaria";
  if (type === "staff") return "Toda equipe escolar";
  if (type === "school") return "Toda escola";

  return "Todos os pais/responsáveis";
}

function normalizeName(row: any) {
  return (
    cleanText(row?.fullName) ||
    cleanText(row?.full_name) ||
    cleanText(row?.name) ||
    cleanText(row?.displayName) ||
    cleanText(row?.recipientName) ||
    cleanText(row?.recipient_name) ||
    cleanText(row?.email) ||
    cleanText(row?.phone) ||
    cleanText(row?.recipientId) ||
    cleanText(row?.recipient_id) ||
    "Destinatário"
  );
}

function initials(name?: string | null) {
  const safe = cleanText(name);

  if (!safe) return "DE";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function audienceNeedsClass(type: AudienceType) {
  return type === "class" || type === "teachers_class";
}

function audienceNeedsTeacher(type: AudienceType) {
  return type === "teacher_individual";
}

function audienceNeedsParent(type: AudienceType) {
  return type === "parent_individual";
}

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function StatCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string | number;
  help: string;
}) {
  return (
    <div className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>

      <div className="mt-3 break-words text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>

      <div className="mt-2 break-words text-sm leading-6 text-slate-500">
        {help}
      </div>
    </div>
  );
}

function AudienceHelpCard() {
  return (
    <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">
        Como funciona o status
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-500">
        O painel mostra se o comunicado foi enviado, entregue e visualizado. Nos
        comunicados publicados, cada card de status é clicável e mostra a lista nominal.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm font-semibold text-blue-800">Enviado</div>
          <p className="mt-2 text-sm leading-6 text-blue-700">
            Todos os destinatários registrados para aquele comunicado.
          </p>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-800">Entregue</div>
          <p className="mt-2 text-sm leading-6 text-emerald-700">
            Quem recebeu o comunicado, mas ainda não visualizou.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">Visualizado</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Quem abriu o comunicado no portal.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Segmentações disponíveis
        </div>

        <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
          <li>• Todos os pais/responsáveis.</li>
          <li>• Pais individuais.</li>
          <li>• Responsáveis de uma turma.</li>
          <li>• Todos os professores.</li>
          <li>• Professores de uma turma.</li>
          <li>• Professor individual.</li>
          <li>• Coordenadores, secretaria ou toda equipe escolar.</li>
          <li>• Toda escola: responsáveis e equipe escolar.</li>
          <li>• Advertência/Suspensão para comunicação disciplinar formal.</li>
        </ul>
      </div>
    </section>
  );
}

function RecipientModalView({
  modal,
  onClose,
}: {
  modal: RecipientModal;
  onClose: () => void;
}) {
  if (!modal) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4">
      <div className="my-8 w-full max-w-6xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <div className="bg-slate-950 px-6 py-6 text-white md:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                Lista de destinatários
              </div>

              <h2 className="mt-4 break-words text-2xl font-semibold">
                {modal.title}
              </h2>

              <p className="mt-2 break-words text-sm leading-6 text-slate-200">
                {modal.subtitle}
              </p>

              <p className="mt-4 break-words text-sm text-slate-200">
                Comunicado: <span className="font-semibold">{modal.messageTitle}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-4 md:grid-cols-4 md:p-6">
          <StatCard
            label="Enviado"
            value={modal.stats.sent}
            help="Total de destinatários."
          />
          <StatCard
            label="Entregue"
            value={modal.stats.delivered}
            help="Recebeu e ainda não visualizou."
          />
          <StatCard
            label="Visualizado"
            value={modal.stats.read}
            help="Abriu no portal."
          />
          <StatCard
            label="Pendente"
            value={modal.stats.pending}
            help="Sem confirmação."
          />
        </div>

        <div className="p-4 md:p-6">
          {modal.rows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Nenhum destinatário encontrado para este filtro.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 xl:hidden">
                {modal.rows.map((row, index) => {
                  const name = normalizeName(row);
                  const deliveredAt = row.deliveredAt || row.delivered_at || null;
                  const readAt = row.readAt || row.read_at || null;
                  const typeLabel = normalizeRecipientType(
                    row.type || row.recipientType || row.recipient_type || row.status
                  );

                  return (
                    <article
                      key={`${row.id || row.recipientId || row.recipient_id || index}`}
                      className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                          {initials(name)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-semibold text-slate-900">
                            {name}
                          </div>

                          <div className="mt-1 break-words text-xs font-medium text-slate-500">
                            {typeLabel}
                          </div>

                          {row.email ? (
                            <div className="mt-1 break-all text-xs text-slate-500">
                              {row.email}
                            </div>
                          ) : null}

                          {row.phone ? (
                            <div className="mt-1 break-words text-xs text-slate-500">
                              {row.phone}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-slate-600">
                        <div className="rounded-2xl bg-white px-3 py-2">
                          Entregue: {formatDateTimeBR(deliveredAt)}
                        </div>
                        <div className="rounded-2xl bg-white px-3 py-2">
                          Visualizado: {formatDateTimeBR(readAt)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden rounded-3xl border border-slate-200 xl:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left">
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Destinatário
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Tipo
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Entregue em
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Visualizado em
                        </th>
                      </tr>
                    </thead>

                    <tbody className="bg-white">
                      {modal.rows.map((row, index) => {
                        const name = normalizeName(row);
                        const deliveredAt = row.deliveredAt || row.delivered_at || null;
                        const readAt = row.readAt || row.read_at || null;
                        const typeLabel = normalizeRecipientType(
                          row.type || row.recipientType || row.recipient_type || row.status
                        );

                        return (
                          <tr
                            key={`${row.id || row.recipientId || row.recipient_id || index}`}
                            className="border-b border-slate-100 align-top last:border-b-0"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                                  {initials(name)}
                                </div>

                                <div className="min-w-0">
                                  <div className="max-w-[360px] break-words text-sm font-semibold text-slate-900">
                                    {name}
                                  </div>

                                  {row.email ? (
                                    <div className="mt-1 max-w-[360px] break-all text-xs text-slate-500">
                                      {row.email}
                                    </div>
                                  ) : null}

                                  {row.phone ? (
                                    <div className="mt-1 max-w-[360px] break-words text-xs text-slate-500">
                                      {row.phone}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>

                            <td className="px-5 py-4 text-sm text-slate-600">
                              {typeLabel}
                            </td>

                            <td className="px-5 py-4 text-sm text-slate-600">
                              {formatDateTimeBR(deliveredAt)}
                            </td>

                            <td className="px-5 py-4 text-sm text-slate-600">
                              {formatDateTimeBR(readAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SchoolMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [messages, setMessages] = useState<SchoolMessage[]>([]);
  const [selectableParents, setSelectableParents] = useState<SelectableParent[]>([]);
  const [selectableStaff, setSelectableStaff] = useState<SelectableStaff[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  const [audienceType, setAudienceType] = useState<AudienceType>("all_parents");
  const [category, setCategory] = useState<MessageCategory>("normal");
  const [targetClassId, setTargetClassId] = useState("");
  const [targetTeacherUserId, setTargetTeacherUserId] = useState("");
  const [targetParentId, setTargetParentId] = useState("");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [recipientModal, setRecipientModal] = useState<RecipientModal>(null);

  const teacherOptions = useMemo(() => {
    return selectableStaff.filter((item) => {
      const role = cleanText(item.role).toLowerCase();
      return role === "professor" || role === "teacher";
    });
  }, [selectableStaff]);

  const totals = useMemo(() => {
    const totalMessages = messages.length;
    const sent = messages.reduce((acc, msg) => acc + getStats(msg).sent, 0);
    const read = messages.reduce((acc, msg) => acc + getStats(msg).read, 0);
    const last = messages[0] || null;

    return {
      totalMessages,
      sent,
      read,
      last,
    };
  }, [messages]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadClasses(token: string) {
    const res = await fetch("/api/school/classes/list", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setClasses([]);
      return;
    }

    const list = Array.isArray(json.classes) ? json.classes : [];

    setClasses(
      list
        .map((item: any) => ({
          id: String(item.id || ""),
          name: cleanText(item.name) || cleanText(item.class_name) || "Turma sem nome",
          grade: item.grade ?? item.series ?? null,
          shift: item.shift ?? item.turno ?? null,
        }))
        .filter((item: ClassRow) => item.id)
    );
  }

  async function loadMessages(options?: { silent?: boolean }) {
    const silent = options?.silent === true;

    if (silent) {
      setReloading(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const [messagesRes] = await Promise.all([
        fetch("/api/school/messages", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }),
        loadClasses(token),
      ]);

      const messagesJson = await safeJson(messagesRes);

      if (!messagesRes.ok || !messagesJson?.ok) {
        setError(messagesJson?.error || "Erro ao carregar comunicados.");
        return;
      }

      setMessages(Array.isArray(messagesJson.messages) ? messagesJson.messages : []);
      setSelectableParents(
        Array.isArray(messagesJson.selectableParents) ? messagesJson.selectableParents : []
      );
      setSelectableStaff(
        Array.isArray(messagesJson.selectableStaff) ? messagesJson.selectableStaff : []
      );
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar comunicados.");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const type = normalizeAudienceType(audienceType);

    if (!audienceNeedsClass(type)) {
      setTargetClassId("");
    }

    if (!audienceNeedsTeacher(type)) {
      setTargetTeacherUserId("");
    }

    if (!audienceNeedsParent(type)) {
      setTargetParentId("");
    }
  }, [audienceType]);

  async function createMessage() {
    setError(null);
    setSuccess(null);

    const safeTitle = cleanText(title);
    const safeBody = cleanText(body);
    const type = normalizeAudienceType(audienceType);

    if (!safeTitle) {
      setError("Informe o título do comunicado.");
      return;
    }

    if (!safeBody) {
      setError("Informe o conteúdo do comunicado.");
      return;
    }

    if (audienceNeedsClass(type) && !targetClassId) {
      setError("Selecione a turma para esta segmentação.");
      return;
    }

    if (audienceNeedsTeacher(type) && !targetTeacherUserId) {
      setError("Selecione o professor individual.");
      return;
    }

    if (audienceNeedsParent(type) && !targetParentId) {
      setError("Selecione o responsável individual.");
      return;
    }

    try {
      setSaving(true);

      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/school/messages/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          title: safeTitle,
          body: safeBody,
          audienceType: type,
          targetClassId: targetClassId || null,
          targetTeacherUserId: targetTeacherUserId || null,
          targetParentId: targetParentId || null,
          category,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao publicar comunicado.");
        return;
      }

      setTitle("");
      setBody("");
      setCategory("normal");
      setAudienceType("all_parents");
      setTargetClassId("");
      setTargetTeacherUserId("");
      setTargetParentId("");

      setSuccess(
        `Comunicado publicado com sucesso para ${json.recipientsCreated || 0} destinatário(s).`
      );

      await loadMessages({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao publicar comunicado.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMessage(message: SchoolMessage) {
    const ok = window.confirm(
      `Deseja excluir este comunicado?\n\n${message.title}`
    );

    if (!ok) return;

    try {
      setError(null);
      setSuccess(null);

      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/school/messages/${encodeURIComponent(message.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao excluir comunicado.");
        return;
      }

      setSuccess("Comunicado excluído com sucesso.");
      await loadMessages({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao excluir comunicado.");
    }
  }

  async function openRecipients(
    message: SchoolMessage,
    filter: "sent" | "delivered" | "read" | "pending"
  ) {
    setError(null);

    try {
      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(
        `/api/school/messages/${encodeURIComponent(message.id)}/recipients?filter=${encodeURIComponent(filter)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao carregar destinatários.");
        return;
      }

      const stats = getStats(message);
      const rows = Array.isArray(json?.recipients) ? json.recipients : [];

      let titleLabel = "Destinatários";

      if (filter === "sent") titleLabel = "Destinatários enviados";
      if (filter === "delivered") titleLabel = "Entregues não visualizados";
      if (filter === "read") titleLabel = "Visualizados";
      if (filter === "pending") titleLabel = "Pendentes";

      setRecipientModal({
        title: titleLabel,
        subtitle:
          filter === "sent"
            ? "Lista completa dos destinatários registrados para este comunicado."
            : filter === "delivered"
              ? "Destinatários que receberam, mas ainda não visualizaram."
              : filter === "read"
                ? "Destinatários que visualizaram o comunicado no portal."
                : "Destinatários ainda sem confirmação.",
        messageTitle: message.title,
        rows,
        stats: json.stats || stats,
      });
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar destinatários.");
    }
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="h-56 animate-pulse rounded-[32px] border border-slate-200 bg-white shadow-sm" />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-36 animate-pulse rounded-[28px] border border-slate-200 bg-white shadow-sm"
            />
          ))}
        </section>

        <section className="h-96 animate-pulse rounded-[32px] border border-slate-200 bg-white shadow-sm" />
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
                Comunicação escolar
              </div>

              <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight md:text-4xl">
                Comunicados
              </h1>

              <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate-200 md:text-base">
                Envie avisos para pais, responsáveis, professores e equipe escolar com
                acompanhamento de entrega e visualização.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => loadMessages({ silent: true })}
                disabled={reloading}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15 disabled:opacity-60"
              >
                {reloading ? "Recarregando..." : "Recarregar lista"}
              </button>

              <button
                type="button"
                onClick={() => router.push("/school/my-messages")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Meus comunicados
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
          <StatCard
            label="Comunicados"
            value={totals.totalMessages}
            help="Total de comunicados criados pela gestão escolar."
          />

          <StatCard
            label="Enviados"
            value={totals.sent}
            help="Total de destinatários registrados para os comunicados."
          />

          <StatCard
            label="Visualizados"
            value={totals.read}
            help="Quantidade total de leituras confirmadas no portal."
          />

          <StatCard
            label="Última publicação"
            value={totals.last ? formatDateBR(totals.last.published_at || totals.last.created_at) : "—"}
            help={totals.last?.title || "Nenhum comunicado publicado ainda."}
          />
        </div>
      </section>

      {error ? (
        <section className="whitespace-pre-wrap rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      {success ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {success}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Criar aviso / comunicado
          </h2>

          <p className="mt-2 break-words text-sm leading-6 text-slate-500">
            Selecione o público correto antes de publicar. O sistema registra
            entrega e leitura para acompanhamento da escola.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Tipo de comunicado
              </label>

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MessageCategory)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
              >
                <option value="normal">Comunicado normal</option>
                <option value="advertencia_suspensao">Advertência/Suspensão</option>
              </select>

              {category === "advertencia_suspensao" ? (
                <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  Use esta opção para comunicações disciplinares formais. O título e o
                  conteúdo serão identificados como Advertência/Suspensão.
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Público do comunicado
              </label>

              <select
                value={audienceType}
                onChange={(e) => setAudienceType(normalizeAudienceType(e.target.value))}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
              >
                <option value="all_parents">Todos os pais/responsáveis</option>
                <option value="parent_individual">Pais individuais</option>
                <option value="class">Responsáveis de uma turma</option>
                <option value="teachers">Todos os professores</option>
                <option value="teachers_class">Professores de uma turma</option>
                <option value="teacher_individual">Professor individual</option>
                <option value="coordinators">Coordenadores</option>
                <option value="secretaria">Secretaria</option>
                <option value="staff">Toda equipe escolar</option>
                <option value="school">Toda escola</option>
              </select>

              <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                O comunicado será entregue para:{" "}
                <span className="font-semibold text-slate-700">
                  {audienceLabel(audienceType)}
                </span>
                .
              </p>
            </div>

            {audienceNeedsClass(audienceType) ? (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Turma
                </label>

                <select
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                  disabled={saving}
                >
                  <option value="">Selecione uma turma</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                      {cls.grade ? ` • ${cls.grade}` : ""}
                      {cls.shift ? ` • ${cls.shift}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {audienceNeedsParent(audienceType) ? (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Responsável individual
                </label>

                <select
                  value={targetParentId}
                  onChange={(e) => setTargetParentId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                  disabled={saving}
                >
                  <option value="">Selecione um responsável</option>
                  {selectableParents.map((parent) => {
                    const id = parent.parentId || parent.id;
                    const name = parent.fullName || parent.name || "Responsável sem nome";

                    return (
                      <option key={id} value={id}>
                        {name}
                        {parent.phone ? ` • ${parent.phone}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}

            {audienceNeedsTeacher(audienceType) ? (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Professor individual
                </label>

                <select
                  value={targetTeacherUserId}
                  onChange={(e) => setTargetTeacherUserId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                  disabled={saving}
                >
                  <option value="">Selecione um professor</option>
                  {teacherOptions.map((teacher) => {
                    const id = teacher.userId || teacher.id;
                    const name = teacher.fullName || teacher.name || teacher.email || "Professor";

                    return (
                      <option key={id} value={id}>
                        {name}
                        {teacher.email ? ` • ${teacher.email}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Título
              </label>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Reunião de pais, feriado, comunicado importante..."
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
                maxLength={180}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Conteúdo
              </label>

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  category === "advertencia_suspensao"
                    ? "Descreva a advertência, suspensão, motivo, data, orientação aos responsáveis e próximos passos..."
                    : "Digite o comunicado que será enviado..."
                }
                className="min-h-[180px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
              />
            </div>

            <button
              type="button"
              onClick={createMessage}
              disabled={saving}
              className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Publicando comunicado..." : "Publicar comunicado"}
            </button>
          </div>
        </section>

        <AudienceHelpCard />
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Histórico de comunicados
              </h2>

              <p className="mt-1 break-words text-sm leading-6 text-slate-500">
                Comunicados publicados do mais recente para o mais antigo.
              </p>
            </div>

            <button
              type="button"
              onClick={() => loadMessages({ silent: true })}
              disabled={reloading}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {reloading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6">
          {messages.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <div className="text-sm font-semibold text-slate-700">
                Nenhum comunicado publicado ainda
              </div>

              <p className="mt-1 text-sm text-slate-500">
                Crie o primeiro aviso para alimentar o portal dos responsáveis e da equipe.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const stats = getStats(message);
                const disciplinary =
                  String(message.target_role || "") === "advertencia_suspensao" ||
                  String(message.title || "").toLowerCase().includes("advertência") ||
                  String(message.title || "").toLowerCase().includes("advertencia") ||
                  String(message.body || "").toLowerCase().startsWith("advertência") ||
                  String(message.body || "").toLowerCase().startsWith("advertencia");

                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                                disciplinary
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-700",
                              ].join(" ")}
                            >
                              {disciplinary ? "Advertência/Suspensão" : "Publicado"}
                            </span>

                            <span className="inline-flex max-w-full rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                              <span className="truncate">
                                {message.audienceLabel ||
                                  audienceLabel(normalizeAudienceType(message.audience_type))}
                              </span>
                            </span>

                            {message.targetClass ? (
                              <span className="inline-flex max-w-full rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                <span className="truncate">
                                  {message.targetClass.name || "Turma"}
                                  {message.targetClass.grade ? ` • ${message.targetClass.grade}` : ""}
                                  {message.targetClass.shift ? ` • ${message.targetClass.shift}` : ""}
                                </span>
                              </span>
                            ) : null}
                          </div>

                          <h3 className="mt-4 break-words text-lg font-semibold text-slate-900">
                            {message.title}
                          </h3>

                          <div className="mt-2 text-xs text-slate-500">
                            Publicado em: {formatDateTimeBR(message.published_at || message.created_at)}
                          </div>

                          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                            {message.body}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2 xl:flex-col">
                          <button
                            type="button"
                            onClick={() => deleteMessage(message)}
                            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
                        <button
                          type="button"
                          onClick={() => openRecipients(message, "sent")}
                          className="rounded-3xl border border-blue-200 bg-blue-50 p-4 text-left transition hover:bg-blue-100"
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">
                            Enviado
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-blue-900">
                            {stats.sent}
                          </div>
                          <div className="mt-2 break-words text-xs leading-5 text-blue-700">
                            Clique para ver lista
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openRecipients(message, "delivered")}
                          className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100"
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                            Entregue
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-emerald-900">
                            {stats.delivered}
                          </div>
                          <div className="mt-2 break-words text-xs leading-5 text-emerald-700">
                            Clique para ver lista
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openRecipients(message, "read")}
                          className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-slate-100"
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Visualizado
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-slate-900">
                            {stats.read}
                          </div>
                          <div className="mt-2 break-words text-xs leading-5 text-slate-600">
                            Clique para ver lista
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openRecipients(message, "pending")}
                          className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:bg-amber-100"
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                            Pendente
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-amber-900">
                            {stats.pending}
                          </div>
                          <div className="mt-2 break-words text-xs leading-5 text-amber-700">
                            Clique para ver lista
                          </div>
                        </button>
                      </div>

                      <div className="mt-4 break-all rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[11px] text-slate-500">
                        ID: {message.id}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <RecipientModalView
        modal={recipientModal}
        onClose={() => setRecipientModal(null)}
      />
    </main>
  );
}