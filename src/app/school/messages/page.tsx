"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AudienceType =
  | "school"
  | "all_parents"
  | "class"
  | "teachers"
  | "teachers_class"
  | "teacher_individual"
  | "coordinators"
  | "secretaria"
  | "staff";

type ClassRow = {
  id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

type StaffRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
};

type MessageStats = {
  sent: number;
  delivered: number;
  read: number;
  pending: number;
};

type MessageRow = {
  id: string;
  school_id: string;
  created_by: string;
  title: string;
  body: string;
  status: string;
  audience_type?: AudienceType | string | null;
  target_class_id?: string | null;
  target_role?: string | null;
  target_user_id?: string | null;
  published_at?: string | null;
  created_at: string;
  audienceLabel?: string;
  targetClass?: ClassRow | null;
  stats?: MessageStats;
};

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
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

function normalizeRole(role?: string | null) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin") return "admin";

  return r || "unknown";
}

function roleLabel(role?: string | null) {
  const r = normalizeRole(role);

  if (r === "diretor") return "Diretor";
  if (r === "coordenador") return "Coordenador";
  if (r === "secretaria") return "Secretaria";
  if (r === "admin") return "Administrador";

  return "Gestão escolar";
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

function staffLabel(staff: StaffRow) {
  return staff.fullName || staff.email || staff.userId;
}

function audienceLabel(
  type: AudienceType,
  selectedClass?: ClassRow | null,
  selectedTeacher?: StaffRow | null
) {
  if (type === "school") return "Toda escola";
  if (type === "all_parents") return "Todos os pais/responsáveis";

  if (type === "class") {
    if (!selectedClass) return "Responsáveis de uma turma";

    return `Responsáveis da turma: ${selectedClass.name}${
      selectedClass.grade ? ` • ${selectedClass.grade}` : ""
    }${selectedClass.shift ? ` • ${selectedClass.shift}` : ""}`;
  }

  if (type === "teachers") return "Todos os professores";

  if (type === "teachers_class") {
    if (!selectedClass) return "Professores de uma turma";

    return `Professores da turma: ${selectedClass.name}${
      selectedClass.grade ? ` • ${selectedClass.grade}` : ""
    }${selectedClass.shift ? ` • ${selectedClass.shift}` : ""}`;
  }

  if (type === "teacher_individual") {
    if (!selectedTeacher) return "Professor individual";
    return `Professor: ${staffLabel(selectedTeacher)}`;
  }

  if (type === "coordinators") return "Coordenadores";
  if (type === "secretaria") return "Secretaria";
  if (type === "staff") return "Toda equipe escolar";

  return "Toda escola";
}

function statusLabel(status?: string | null) {
  const safe = String(status || "").toLowerCase();

  if (safe === "published") return "Publicado";
  if (safe === "draft") return "Rascunho";

  return safe || "—";
}

function MetricCard({
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

function StatusPill({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "blue" | "emerald" | "amber";
}) {
  const classes = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 ${classes[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function AudienceHelp({ audienceType }: { audienceType: AudienceType }) {
  if (audienceType === "school" || audienceType === "all_parents") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será entregue para todos os responsáveis cadastrados na escola.
      </p>
    );
  }

  if (audienceType === "class") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será entregue apenas aos responsáveis dos alunos ativos na turma selecionada.
      </p>
    );
  }

  if (audienceType === "teachers") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será direcionado para todos os professores ativos da escola.
      </p>
    );
  }

  if (audienceType === "teachers_class") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será direcionado apenas aos professores vinculados à turma selecionada.
      </p>
    );
  }

  if (audienceType === "teacher_individual") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será direcionado para um professor específico.
      </p>
    );
  }

  if (audienceType === "coordinators") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será direcionado aos coordenadores ativos da escola.
      </p>
    );
  }

  if (audienceType === "secretaria") {
    return (
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O comunicado será direcionado aos usuários com perfil de secretaria.
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs leading-5 text-slate-500">
      O comunicado será direcionado para toda a equipe escolar cadastrada.
    </p>
  );
}

export default function SchoolMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("Minha Escola");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("all_parents");
  const [targetClassId, setTargetClassId] = useState("");
  const [targetTeacherUserId, setTargetTeacherUserId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [editingMessage, setEditingMessage] = useState<MessageRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const teachers = useMemo(() => {
    return staff.filter((item) => normalizeRole(item.role) === "professor");
  }, [staff]);

  const selectedClass = useMemo(() => {
    if (!targetClassId) return null;
    return classes.find((item) => item.id === targetClassId) || null;
  }, [classes, targetClassId]);

  const selectedTeacher = useMemo(() => {
    if (!targetTeacherUserId) return null;
    return teachers.find((item) => item.userId === targetTeacherUserId) || null;
  }, [teachers, targetTeacherUserId]);

  const totalMessages = useMemo(() => messages.length, [messages]);

  const totalSent = useMemo(() => {
    return messages.reduce((acc, item) => acc + Number(item.stats?.sent || 0), 0);
  }, [messages]);

  const totalRead = useMemo(() => {
    return messages.reduce((acc, item) => acc + Number(item.stats?.read || 0), 0);
  }, [messages]);

  const latestMessage = useMemo(() => {
    return messages[0] || null;
  }, [messages]);

  async function getAccessToken() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session?.access_token) {
      throw new Error(sessionError?.message || "Sessão inválida.");
    }

    return sessionData.session.access_token;
  }

  async function loadClasses(token: string) {
    const res = await fetch("/api/school/classes", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setClasses([]);
      return;
    }

    setClasses((json.classes || []) as ClassRow[]);
  }

  function normalizeStaffRows(payload: any): StaffRow[] {
    const rawRows =
      payload?.staff ||
      payload?.users ||
      payload?.teachers ||
      payload?.items ||
      payload?.data ||
      [];

    if (!Array.isArray(rawRows)) return [];

    return rawRows
      .map((row: any) => {
        const userId =
          row.userId ||
          row.user_id ||
          row.auth_user_id ||
          row.teacher_user_id ||
          row.staff_user_id ||
          "";

        const fullName =
          row.fullName ||
          row.full_name ||
          row.name ||
          row.display_name ||
          row.teacher_name ||
          null;

        const email = row.email || row.user_email || row.teacher_email || null;

        const role = normalizeRole(row.role || row.user_role || row.profile || "professor");

        return {
          userId: String(userId || "").trim(),
          fullName: fullName ? String(fullName) : null,
          email: email ? String(email) : null,
          role,
        };
      })
      .filter((row: StaffRow) => row.userId);
  }

  async function loadStaff(token: string) {
    const endpoints = ["/api/school/staff", "/api/school/teachers"];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const json = await safeJson(res);

        if (res.ok && json?.ok) {
          const rows = normalizeStaffRows(json);
          if (rows.length > 0) {
            setStaff(rows);
            return;
          }
        }
      } catch {
        // tenta próximo endpoint
      }
    }

    setStaff([]);
  }

  async function loadMessages(token?: string) {
    const accessToken = token || (await getAccessToken());

    const res = await fetch("/api/school/messages", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    const json = await safeJson(res);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Erro ao carregar comunicados.");
      setMessages([]);
      return;
    }

    setMessages((json.messages || []) as MessageRow[]);
  }

  async function loadPage() {
    try {
      setError(null);
      setSuccessMessage(null);
      setLoading(true);

      const token = await getAccessToken();

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const me = (await safeJson(meRes)) as MePayload | any;

      if (!meRes.ok || !me?.ok) {
        router.replace(me?.redirectTo || "/login");
        return;
      }

      if (me?.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const normalized = normalizeRole(me?.school?.role);
      const sid = me?.school?.schoolId ? String(me.school.schoolId) : null;

      if (
        normalized !== "diretor" &&
        normalized !== "coordenador" &&
        normalized !== "secretaria" &&
        normalized !== "admin"
      ) {
        router.replace("/school");
        return;
      }

      if (!sid) {
        setError("Usuário sem escola vinculada.");
        return;
      }

      setSchoolId(sid);
      setRole(normalized);
      setBrandName(me?.branding?.brandName || "Minha Escola");

      await Promise.all([loadClasses(token), loadStaff(token), loadMessages(token)]);
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao carregar comunicados.";
      setError(msg);

      if (msg.toLowerCase().includes("sessão")) {
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      setRefreshing(true);
      setError(null);
      setSuccessMessage(null);

      const token = await getAccessToken();
      await Promise.all([loadClasses(token), loadStaff(token), loadMessages(token)]);
    } catch (e: any) {
      setError(e?.message || "Erro ao atualizar comunicados.");
    } finally {
      setRefreshing(false);
    }
  }

  function resetAudienceTargets(next: AudienceType) {
    if (next !== "class" && next !== "teachers_class") {
      setTargetClassId("");
    }

    if (next !== "teacher_individual") {
      setTargetTeacherUserId("");
    }
  }

  async function publish() {
    if (!title.trim()) {
      setError("Informe o título do comunicado.");
      return;
    }

    if (!body.trim()) {
      setError("Informe o conteúdo do comunicado.");
      return;
    }

    if ((audienceType === "class" || audienceType === "teachers_class") && !targetClassId) {
      setError("Selecione a turma para enviar o comunicado.");
      return;
    }

    if (audienceType === "teacher_individual" && !targetTeacherUserId) {
      setError("Selecione o professor para enviar o comunicado individual.");
      return;
    }

    try {
      setPublishing(true);
      setError(null);
      setSuccessMessage(null);

      const token = await getAccessToken();

      const selectedTeacherId =
        audienceType === "teacher_individual" ? targetTeacherUserId : null;

      const selectedClassId =
        audienceType === "class" || audienceType === "teachers_class" ? targetClassId : null;

      const res = await fetch("/api/school/messages/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audienceType,
          audience_type: audienceType,

          targetClassId: selectedClassId,
          target_class_id: selectedClassId,

          targetTeacherUserId: selectedTeacherId,
          target_teacher_user_id: selectedTeacherId,

          targetUserId: selectedTeacherId,
          target_user_id: selectedTeacherId,

          targetStaffId: selectedTeacherId,
          target_staff_id: selectedTeacherId,

          status: "published",
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao publicar comunicado.");
        return;
      }

      setTitle("");
      setBody("");
      setAudienceType("all_parents");
      setTargetClassId("");
      setTargetTeacherUserId("");

      await loadMessages(token);

      const recipientsCreated = Number(json.recipientsCreated || 0);

      setSuccessMessage(
        recipientsCreated > 0
          ? `Comunicado publicado com sucesso para ${recipientsCreated} destinatário(s).`
          : "Comunicado publicado com sucesso."
      );
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao publicar comunicado.");
    } finally {
      setPublishing(false);
    }
  }

  function openEdit(message: MessageRow) {
    setEditingMessage(message);
    setEditTitle(message.title || "");
    setEditBody(message.body || "");
    setError(null);
    setSuccessMessage(null);
  }

  function closeEdit() {
    setEditingMessage(null);
    setEditTitle("");
    setEditBody("");
    setSavingEdit(false);
  }

  async function saveEdit() {
    if (!editingMessage?.id) return;

    if (!editTitle.trim()) {
      setError("Informe o título do comunicado.");
      return;
    }

    if (!editBody.trim()) {
      setError("Informe o conteúdo do comunicado.");
      return;
    }

    try {
      setSavingEdit(true);
      setError(null);
      setSuccessMessage(null);

      const token = await getAccessToken();

      const res = await fetch(`/api/school/messages/${editingMessage.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          title: editTitle.trim(),
          body: editBody.trim(),
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao atualizar comunicado.");
        return;
      }

      closeEdit();
      await loadMessages(token);
      setSuccessMessage("Comunicado atualizado com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao atualizar comunicado.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteMessage(message: MessageRow) {
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir o comunicado "${message.title}"?\n\nEssa ação também removerá o histórico de envio, entrega e visualização desse comunicado.`
    );

    if (!confirmed) return;

    try {
      setDeletingId(message.id);
      setError(null);
      setSuccessMessage(null);

      const token = await getAccessToken();

      const res = await fetch(`/api/school/messages/${message.id}`, {
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

      await loadMessages(token);
      setSuccessMessage("Comunicado excluído com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao excluir comunicado.");
    } finally {
      setDeletingId(null);
    }
  }

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
                Comunicação escolar
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Comunicados
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                Envie avisos segmentados para responsáveis, turmas ou equipe escolar e acompanhe
                o status de entrega e visualização.
              </p>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
                <span className="rounded-full bg-white/10 px-3 py-1">
                  Escola: {brandName}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1">
                  Perfil: {roleLabel(role)}
                </span>
                {schoolId ? (
                  <span className="rounded-full bg-white/10 px-3 py-1">ID: {schoolId}</span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing || publishing}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15 disabled:opacity-60"
              >
                {refreshing ? "Atualizando..." : "Atualizar"}
              </button>

              <button
                type="button"
                onClick={() => router.push("/school/calendar")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Agenda
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
          <MetricCard
            label="Comunicados"
            value={String(totalMessages)}
            help="Total de comunicados criados pela gestão escolar."
          />

          <MetricCard
            label="Enviados"
            value={String(totalSent)}
            help="Total de destinatários registrados para os comunicados."
          />

          <MetricCard
            label="Visualizados"
            value={String(totalRead)}
            help="Quantidade total de leituras confirmadas pelos responsáveis/equipe."
          />

          <MetricCard
            label="Última publicação"
            value={latestMessage ? formatDateTimeBR(latestMessage.created_at) : "—"}
            help={latestMessage ? latestMessage.title : "Nenhum comunicado publicado ainda."}
          />
        </div>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      {successMessage ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {successMessage}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Criar aviso / comunicado
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Selecione o público correto antes de publicar. O sistema registra entrega e leitura
              para acompanhamento da escola.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Público do comunicado
              </span>

              <select
                className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                value={audienceType}
                onChange={(e) => {
                  const next = e.target.value as AudienceType;
                  setAudienceType(next);
                  resetAudienceTargets(next);
                }}
                disabled={publishing}
              >
                <option value="all_parents">Todos os pais/responsáveis</option>
                <option value="class">Responsáveis de uma turma</option>
                <option value="teachers">Todos os professores</option>
                <option value="teachers_class">Professores de uma turma</option>
                <option value="teacher_individual">Professor individual</option>
                <option value="coordinators">Coordenadores</option>
                <option value="secretaria">Secretaria</option>
                <option value="staff">Toda equipe escolar</option>
                <option value="school">Toda escola</option>
              </select>

              <AudienceHelp audienceType={audienceType} />
            </label>

            {audienceType === "class" || audienceType === "teachers_class" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Turma
                </span>

                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  disabled={publishing}
                >
                  <option value="">Selecione uma turma</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.grade ? ` • ${item.grade}` : ""}
                      {item.shift ? ` • ${item.shift}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {audienceType === "teacher_individual" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Professor
                </span>

                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  value={targetTeacherUserId}
                  onChange={(e) => setTargetTeacherUserId(e.target.value)}
                  disabled={publishing}
                >
                  <option value="">Selecione um professor</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.userId} value={teacher.userId}>
                      {staffLabel(teacher)}
                    </option>
                  ))}
                </select>

                {teachers.length === 0 ? (
                  <p className="mt-2 text-xs leading-5 text-amber-700">
                    Nenhum professor encontrado. Verifique se os professores estão cadastrados e
                    ativos em Equipe Escolar / Professores.
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {teachers.length} professor(es) ativo(s) encontrado(s).
                  </p>
                )}
              </label>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Título
              </span>

              <input
                className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                placeholder="Ex.: Reunião de pais, feriado, comunicado importante..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={publishing}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Conteúdo
              </span>

              <textarea
                className="min-h-[180px] w-full resize-y rounded-2xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-500"
                placeholder="Digite o comunicado que será enviado..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={publishing}
              />
            </label>
          </div>

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Resumo do envio
            </div>

            <div className="mt-2 text-sm font-semibold text-slate-900">
              {audienceLabel(audienceType, selectedClass, selectedTeacher)}
            </div>

            <div className="mt-2 text-xs leading-5 text-slate-500">
              Após publicar, o comunicado será registrado com status de enviado/entregue e
              passará para visualizado quando o destinatário abrir no portal.
            </div>
          </div>

          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            className="mt-5 w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {publishing ? "Publicando..." : "Publicar comunicado"}
          </button>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Como funciona o status
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-500">
            O painel mostra se o comunicado foi enviado, entregue e visualizado.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-sm font-semibold text-blue-800">Enviado</div>
              <p className="mt-2 text-xs leading-5 text-blue-700">
                Todos os destinatários registrados para aquele comunicado.
              </p>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-semibold text-emerald-800">Entregue</div>
              <p className="mt-2 text-xs leading-5 text-emerald-700">
                Quem recebeu o comunicado, mas ainda não visualizou.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-800">Visualizado</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Quem abriu o comunicado no portal.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Segmentações disponíveis
            </div>

            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <p>• Todos os pais/responsáveis.</p>
              <p>• Responsáveis de uma turma.</p>
              <p>• Todos os professores.</p>
              <p>• Professores de uma turma.</p>
              <p>• Professor individual.</p>
              <p>• Coordenadores, secretaria ou toda equipe escolar.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Comunicados publicados
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Histórico de comunicados com indicadores de entrega e visualização.
              </p>
            </div>

            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {refreshing ? "Atualizando..." : "Recarregar lista"}
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6">
          {messages.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              Nenhum comunicado publicado ainda.
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const stats = message.stats || {
                  sent: 0,
                  delivered: 0,
                  read: 0,
                  pending: 0,
                };

                const classInfo = message.targetClass;

                return (
                  <article
                    key={message.id}
                    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                            {statusLabel(message.status)}
                          </span>

                          <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                            {message.audienceLabel ||
                              audienceLabel(
                                (message.audience_type as AudienceType) || "school",
                                classInfo
                              )}
                          </span>

                          {classInfo ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                              {classInfo.name}
                              {classInfo.grade ? ` • ${classInfo.grade}` : ""}
                              {classInfo.shift ? ` • ${classInfo.shift}` : ""}
                            </span>
                          ) : null}
                        </div>

                        <h3 className="mt-3 text-lg font-semibold text-slate-900">
                          {message.title}
                        </h3>

                        <div className="mt-2 text-xs text-slate-500">
                          Publicado em:{" "}
                          <span className="font-medium">
                            {formatDateTimeBR(message.published_at || message.created_at)}
                          </span>
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">
                          {message.body}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(message)}
                            disabled={deletingId === message.id}
                            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            Editar comunicado
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteMessage(message)}
                            disabled={deletingId === message.id}
                            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                          >
                            {deletingId === message.id ? "Excluindo..." : "Excluir"}
                          </button>
                        </div>
                      </div>

                      <div className="w-full xl:w-[360px]">
                        <div className="grid grid-cols-2 gap-3">
                          <StatusPill label="Enviado" value={stats.sent} tone="blue" />
                          <StatusPill label="Entregue" value={stats.delivered} tone="emerald" />
                          <StatusPill label="Visualizado" value={stats.read} tone="slate" />
                          <StatusPill label="Pendente" value={stats.pending} tone="amber" />
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                          ID: <span className="font-mono">{message.id}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {editingMessage ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="my-8 w-full max-w-3xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-6 text-white">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
                    Editar comunicado
                  </div>

                  <h2 className="mt-3 text-2xl font-semibold">{editingMessage.title}</h2>

                  <p className="mt-1 text-sm text-slate-200">
                    A edição altera o conteúdo exibido para os destinatários, mas mantém o
                    histórico de envio, entrega e visualização.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeEdit}
                  disabled={savingEdit}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90 disabled:opacity-60"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="space-y-4 p-5 md:p-6">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Título
                </span>

                <input
                  className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  disabled={savingEdit}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Conteúdo
                </span>

                <textarea
                  className="min-h-[220px] w-full resize-y rounded-2xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-500"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  disabled={savingEdit}
                />
              </label>

              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                Para preservar auditoria escolar, esta edição não altera o público original do
                comunicado. Para mudar o público, exclua e publique um novo comunicado.
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEdit}
                  disabled={savingEdit}
                  className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {savingEdit ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}