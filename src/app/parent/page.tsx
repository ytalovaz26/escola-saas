"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: {
    parentId: string;
    schoolId: string;
    firstLoginCompleted?: boolean;
    profileUpdatedAt?: string | null;
  };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

type ParentProfilePayload = {
  ok: true;
  parent: {
    id: string;
    schoolId: string | null;
    fullName: string | null;
    phone: string | null;
    cpf: string | null;
    phoneSecondary: string | null;
    zipCode: string | null;
    street: string | null;
    streetNumber: string | null;
    addressComplement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    photoUrl: string | null;
    firstLoginCompleted: boolean;
    profileUpdatedAt: string | null;
  };
};

type ChildrenPayload = {
  ok: true;
  schoolId: string;
  parentId: string;
  children: Array<{
    id: string;
    full_name: string | null;
    registration_number: string | null;
    birth_date: string | null;
    student_photo_url: string | null;
    relationship: string | null;
    active_class: {
      class_id: string;
      started_at: string | null;
      ended_at: string | null;
      class: {
        id: string;
        name: string | null;
        grade: string | null;
        shift: string | null;
      } | null;
    } | null;
  }>;
};

type MessagesPayload = {
  ok: true;
  summary?: {
    total: number;
    unread: number;
    read: number;
  };
};

async function safeJsonFromResponse(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function isHttpUrl(url?: string | null) {
  const safe = String(url || "").trim();
  return safe.startsWith("https://") || safe.startsWith("http://");
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();

  if (!safe) return "RP";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "RP";
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classLabel(child: ChildrenPayload["children"][number]) {
  const cls = child.active_class?.class;

  if (!cls) return "Sem turma ativa";

  const parts = [cls.name, cls.grade, cls.shift].filter(Boolean);

  return parts.join(" • ") || "Turma vinculada";
}

function StatCard({
  label,
  value,
  help,
  tone = "default",
}: {
  label: string;
  value: string;
  help: string;
  tone?: "default" | "dark" | "green" | "blue";
}) {
  const toneClasses = {
    default: "border-slate-200 bg-white text-slate-900",
    dark: "border-slate-900 bg-slate-900 text-white",
    green: "border-emerald-200 bg-emerald-50 text-emerald-950",
    blue: "border-blue-200 bg-blue-50 text-blue-950",
  };

  const mutedClasses = {
    default: "text-slate-500",
    dark: "text-slate-300",
    green: "text-emerald-700",
    blue: "text-blue-700",
  };

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <div
        className={`text-xs font-semibold uppercase tracking-wide ${
          tone === "default" ? "text-slate-400" : "opacity-70"
        }`}
      >
        {label}
      </div>

      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>

      <div className={`mt-2 text-sm leading-6 ${mutedClasses[tone]}`}>{help}</div>
    </div>
  );
}

function QuickAccessCard({
  icon,
  title,
  description,
  onClick,
  badge,
  primary = false,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  badge?: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group w-full rounded-3xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        primary
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={[
            "flex h-12 w-12 items-center justify-center rounded-2xl text-xl",
            primary ? "bg-white/10" : "bg-slate-100",
          ].join(" ")}
        >
          {icon}
        </div>

        {badge ? (
          <span
            className={[
              "inline-flex rounded-full px-3 py-1 text-[11px] font-semibold",
              primary ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600",
            ].join(" ")}
          >
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-4 text-xl font-semibold">{title}</div>

      <p
        className={[
          "mt-2 text-sm leading-6",
          primary ? "text-slate-200" : "text-slate-500",
        ].join(" ")}
      >
        {description}
      </p>

      <div
        className={[
          "mt-5 text-sm font-semibold",
          primary ? "text-white" : "text-slate-700 group-hover:text-slate-900",
        ].join(" ")}
      >
        Abrir módulo →
      </div>
    </button>
  );
}

function ResponsibleAvatar({
  photoUrl,
  fallbackText,
}: {
  photoUrl?: string | null;
  fallbackText: string;
}) {
  const [broken, setBroken] = useState(false);

  if (isHttpUrl(photoUrl) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={String(photoUrl)}
        alt="Foto do responsável"
        className="h-20 w-20 rounded-3xl border border-white/20 bg-white/10 object-cover shadow-sm md:h-24 md:w-24"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/20 bg-white/10 text-xl font-bold text-white shadow-sm md:h-24 md:w-24">
      {fallbackText}
    </div>
  );
}

function SchoolLogo({
  logoUrl,
  brandName,
}: {
  logoUrl?: string | null;
  brandName: string;
}) {
  const [broken, setBroken] = useState(false);

  if (isHttpUrl(logoUrl) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={String(logoUrl)}
        alt={`Logo ${brandName}`}
        className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-2 shadow-sm"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-500 shadow-sm">
      Logo
    </div>
  );
}

function ChildPreviewCard({
  child,
  onClick,
}: {
  child: ChildrenPayload["children"][number];
  onClick: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const hasPhoto = isHttpUrl(child.student_photo_url) && !broken;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md"
    >
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={String(child.student_photo_url)}
          alt="Foto do aluno"
          className="h-14 w-14 rounded-2xl border border-slate-200 object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-700">
          {getInitials(child.full_name)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900">
          {child.full_name || "Aluno"}
        </div>

        <div className="mt-1 truncate text-xs text-slate-500">{classLabel(child)}</div>

        <div className="mt-1 text-xs text-slate-400">
          Matrícula: {child.registration_number || "—"}
        </div>
      </div>

      <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">→</div>
    </button>
  );
}

function FeatureInfoCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-lg">
        {icon}
      </div>

      <div className="mt-4 text-lg font-semibold text-slate-900">{title}</div>

      <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
    </div>
  );
}

export default function ParentHomePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [profile, setProfile] = useState<ParentProfilePayload["parent"] | null>(null);
  const [children, setChildren] = useState<ChildrenPayload["children"]>([]);
  const [messagesSummary, setMessagesSummary] = useState({
    total: 0,
    unread: 0,
    read: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const brandName = useMemo(() => {
    return me?.branding?.brandName?.trim() || "Escola";
  }, [me?.branding?.brandName]);

  const brandLogoUrl = useMemo(() => {
    return me?.branding?.brandLogoUrl || me?.branding?.brandIconUrl || null;
  }, [me?.branding?.brandLogoUrl, me?.branding?.brandIconUrl]);

  const responsibleName = useMemo(() => {
    return profile?.fullName?.trim() || me?.user?.email || "Responsável";
  }, [profile?.fullName, me?.user?.email]);

  const responsibleInitials = useMemo(() => {
    return getInitials(profile?.fullName || me?.user?.email || "Responsável");
  }, [profile?.fullName, me?.user?.email]);

  const profileStatus = useMemo(() => {
    if (profile?.firstLoginCompleted || profile?.profileUpdatedAt) return "Atualizado";
    return "Pendente";
  }, [profile?.firstLoginCompleted, profile?.profileUpdatedAt]);

  const unreadMessagesLabel = useMemo(() => {
    if (messagesSummary.unread > 0) return `${messagesSummary.unread} novo(s)`;
    if (messagesSummary.total > 0) return "Tudo lido";
    return "Nenhum";
  }, [messagesSummary]);

  useEffect(() => {
    let alive = true;

    async function boot() {
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

        const meJson: any = await safeJsonFromResponse(meRes);

        if (!alive) return;

        if (!meRes.ok || !meJson?.ok) {
          setError(meJson?.error || "Falha ao validar sessão.");
          return;
        }

        if (!meJson?.parent?.parentId) {
          router.replace(meJson?.redirectTo || "/login");
          return;
        }

        setMe(meJson as MePayload);

        const [profileRes, childrenRes, messagesRes] = await Promise.all([
          fetch("/api/parent/profile", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/parent/children", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/parent/messages", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);

        const profileJson: any = await safeJsonFromResponse(profileRes);
        const childrenJson: any = await safeJsonFromResponse(childrenRes);
        const messagesJson: any = await safeJsonFromResponse(messagesRes);

        if (!alive) return;

        if (profileRes.ok && profileJson?.ok) {
          setProfile(profileJson.parent || null);
        }

        if (childrenRes.ok && childrenJson?.ok) {
          setChildren(Array.isArray(childrenJson.children) ? childrenJson.children : []);
        }

        if (messagesRes.ok && messagesJson?.ok) {
          setMessagesSummary(
            messagesJson.summary || {
              total: 0,
              unread: 0,
              read: 0,
            }
          );
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Erro inesperado ao carregar portal.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    boot();

    return () => {
      alive = false;
    };
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="animate-pulse space-y-4">
              <div className="h-10 w-64 rounded-xl bg-slate-200" />
              <div className="h-4 w-80 rounded-xl bg-slate-100" />
              <div className="h-28 rounded-3xl bg-slate-100" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-32 rounded-3xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="h-56 rounded-3xl bg-slate-100" />
            <div className="h-56 rounded-3xl bg-slate-100" />
            <div className="h-56 rounded-3xl bg-slate-100" />
            <div className="h-56 rounded-3xl bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="font-medium text-red-700">Erro ao abrir o portal</div>

          <div className="mt-2 text-sm text-red-600">{error}</div>

          <button
            onClick={() => router.replace("/login")}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white"
          >
            Voltar ao login
          </button>
        </div>
      </main>
    );
  }

  if (!me?.parent?.parentId) return null;

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-white px-6 py-5 md:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <SchoolLogo logoUrl={brandLogoUrl} brandName={brandName} />

                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Portal do Responsável
                  </div>

                  <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                    {brandName}
                  </h1>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => router.push("/parent/children")}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Meus filhos
                </button>

                <button
                  onClick={() => router.push("/parent/complete-profile")}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Meus dados
                </button>

                <button
                  onClick={logout}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Sair
                </button>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-col gap-5 md:flex-row md:items-center">
                <ResponsibleAvatar
                  photoUrl={profile?.photoUrl}
                  fallbackText={responsibleInitials}
                />

                <div className="min-w-0">
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                    Bem-vindo ao acompanhamento escolar
                  </div>

                  <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                    Olá, {responsibleName}
                  </h2>

                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
                    Acompanhe filhos, presença, boletins, agenda, comunicados e financeiro em um
                    ambiente seguro, organizado e vinculado diretamente à escola.
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Conta: {me.user.email ?? "Responsável"}
                    </span>

                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Cadastro: {profileStatus}
                    </span>

                    {profile?.profileUpdatedAt ? (
                      <span className="rounded-full bg-white/10 px-3 py-1">
                        Atualizado em {formatDateTimeBR(profile.profileUpdatedAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur xl:w-[320px]">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Resumo familiar
                </div>

                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-2xl bg-white/10 p-3">
                    <div className="text-2xl font-semibold">{children.length}</div>
                    <div className="mt-1 text-[11px] text-slate-300">Filhos</div>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-3">
                    <div className="text-2xl font-semibold">{messagesSummary.total}</div>
                    <div className="mt-1 text-[11px] text-slate-300">Avisos</div>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-3">
                    <div className="text-2xl font-semibold">{messagesSummary.unread}</div>
                    <div className="mt-1 text-[11px] text-slate-300">Novos</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <StatCard
              label="Acompanhamento"
              value={children.length > 0 ? "Ativo" : "Sem vínculo"}
              help={
                children.length > 0
                  ? "Você já possui aluno(s) vinculado(s) para acompanhamento."
                  : "Nenhum aluno foi vinculado à sua conta ainda."
              }
              tone="blue"
            />

            <StatCard
              label="Comunicados"
              value={unreadMessagesLabel}
              help="Avisos oficiais enviados pela escola para sua conta."
              tone={messagesSummary.unread > 0 ? "green" : "default"}
            />

            <StatCard
              label="Cadastro"
              value={profileStatus}
              help="Mantenha seus dados corretos para fortalecer a comunicação com a escola."
              tone={profileStatus === "Atualizado" ? "default" : "dark"}
            />
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Acesso rápido
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Os módulos mais importantes para o acompanhamento escolar da família.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push("/parent/messages")}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Ver comunicados
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <QuickAccessCard
              icon="👨‍👩‍👧"
              title="Meus filhos"
              description="Veja os alunos vinculados à sua conta e entre em cada painel individual."
              onClick={() => router.push("/parent/children")}
              badge={`${children.length} aluno(s)`}
              primary
            />

            <QuickAccessCard
              icon="📅"
              title="Agenda"
              description="Consulte eventos, compromissos e datas importantes da escola."
              onClick={() => router.push("/parent/calendar")}
              badge="Disponível"
            />

            <QuickAccessCard
              icon="📩"
              title="Comunicados"
              description="Acompanhe avisos, recados e publicações oficiais da escola."
              onClick={() => router.push("/parent/messages")}
              badge={messagesSummary.unread > 0 ? `${messagesSummary.unread} novo(s)` : "Aberto"}
            />

            <QuickAccessCard
              icon="💳"
              title="Mensalidades"
              description="Veja status, vencimentos e valores relacionados ao financeiro escolar."
              onClick={() => router.push("/parent/invoices")}
              badge="Financeiro"
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Alunos vinculados
                </h3>

                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Acompanhe rapidamente os alunos conectados à sua conta.
                </p>
              </div>

              <button
                type="button"
                onClick={() => router.push("/parent/children")}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Abrir filhos
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {children.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Nenhum aluno vinculado ao responsável até o momento.
                </div>
              ) : (
                children.slice(0, 4).map((child) => (
                  <ChildPreviewCard
                    key={child.id}
                    child={child}
                    onClick={() => router.push(`/parent/students/${child.id}/daily`)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                O que você já pode consultar
              </h3>

              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                O portal entrega uma base sólida para acompanhar desempenho, frequência e
                relacionamento com a escola.
              </p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <FeatureInfoCard
                icon="✅"
                title="Presença diária"
                description="Consulte a frequência do aluno por data, com status por aula e observações."
              />

              <FeatureInfoCard
                icon="📆"
                title="Presença mensal"
                description="Acompanhe o histórico do mês em calendário, com visão clara dos registros."
              />

              <FeatureInfoCard
                icon="📄"
                title="Boletim escolar"
                description="Veja notas, média, situação e gere boletins em PDF profissional."
              />

              <FeatureInfoCard
                icon="🪪"
                title="Atualização cadastral"
                description="Mantenha telefone, endereço, CPF e foto sempre atualizados."
              />
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Próxima evolução do portal
              </h3>

              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
                A próxima camada premium pode incluir chat escolar, cardápio, autorizações
                digitais, histórico de comunicados por aluno, comprovantes financeiros e
                integração mais profunda entre família e escola.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              Ambiente seguro e multi-tenant
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <b>Comunicação:</b> chat com professores, coordenação, direção e setores da escola.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <b>Rotina:</b> agenda detalhada, cardápio, eventos, tarefas e avisos segmentados.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <b>Financeiro:</b> segunda via, comprovantes, histórico e visão transparente.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}