"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MeOk = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: { parentId: string; schoolId: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

type MeResp = MeOk | { ok: false; error?: string };

type MessagesSummary = {
  total: number;
  unread: number;
  read: number;
};

type TeacherIdentity = {
  name: string;
  firstName: string;
  email: string;
  initials: string;
  photoUrl: string | null;
};

async function fetchMeWithToken(accessToken: string): Promise<MeResp> {
  const res = await fetch("/api/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor." };
  }
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function formatTodayBR() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function getPeriodGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function titleCaseWord(value: string) {
  const safe = cleanText(value);

  if (!safe) return "";

  return safe.charAt(0).toUpperCase() + safe.slice(1).toLowerCase();
}

function nameFromEmailOrId(value?: string | null) {
  const safe = cleanText(value);

  if (!safe) return "Professor";

  const beforeAt = safe.split("@")[0] || safe;

  const parts = beforeAt
    .split(/[.\-_ ]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "Professor";

  return parts.slice(0, 2).map(titleCaseWord).join(" ");
}

function firstNameFromFullName(value?: string | null) {
  const safe = cleanText(value);

  if (!safe) return "Professor";

  const first = safe.split(/\s+/).filter(Boolean)[0] || safe;

  return titleCaseWord(first);
}

function getInitials(name?: string | null) {
  const safe = cleanText(name);

  if (!safe) return "PR";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function getTeacherIdentityFromSessionUser(user: any, fallbackEmail?: string | null): TeacherIdentity {
  const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
  const email = cleanText(user?.email) || cleanText(fallbackEmail) || "Professor";

  const name =
    cleanText(metadata.full_name) ||
    cleanText(metadata.fullName) ||
    cleanText(metadata.name) ||
    cleanText(metadata.nome) ||
    cleanText(metadata.display_name) ||
    nameFromEmailOrId(email);

  const photoUrl =
    cleanText(metadata.avatar_url) ||
    cleanText(metadata.picture) ||
    cleanText(metadata.photo_url) ||
    cleanText(metadata.photoUrl) ||
    cleanText(metadata.teacher_photo_url) ||
    null;

  return {
    name,
    firstName: firstNameFromFullName(name),
    email,
    initials: getInitials(name),
    photoUrl,
  };
}

function StatCard({
  label,
  value,
  help,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  help: string;
  icon: string;
  tone?: "default" | "brand" | "blue" | "emerald" | "amber";
}) {
  const toneClass =
    tone === "brand"
      ? "border-slate-900 bg-slate-950 text-white"
      : tone === "blue"
        ? "border-blue-200 bg-blue-50 text-slate-900"
        : tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-slate-900"
          : tone === "amber"
            ? "border-amber-200 bg-amber-50 text-slate-900"
            : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`min-w-0 rounded-[32px] border p-5 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div
          className={[
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl",
            tone === "brand" ? "bg-white/10 text-white" : "bg-white text-slate-700 shadow-sm",
          ].join(" ")}
        >
          {icon}
        </div>

        <div
          className={[
            "min-w-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
            tone === "brand" ? "bg-white/10 text-slate-200" : "bg-white text-slate-500 shadow-sm",
          ].join(" ")}
        >
          <span className="block max-w-full truncate">{label}</span>
        </div>
      </div>

      <div
        className={[
          "mt-5 break-words text-2xl font-semibold tracking-tight md:text-3xl",
          tone === "brand" ? "text-white" : "text-slate-900",
        ].join(" ")}
      >
        {value}
      </div>

      <div
        className={[
          "mt-2 break-words text-sm leading-6",
          tone === "brand" ? "text-slate-300" : "text-slate-500",
        ].join(" ")}
      >
        {help}
      </div>
    </div>
  );
}

function FeatureCard({
  href,
  title,
  description,
  icon,
  primary = false,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
  primary?: boolean;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "group relative min-w-0 overflow-hidden rounded-[34px] border p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl",
        primary
          ? "border-slate-900 bg-slate-950 text-white"
          : "border-slate-200 bg-white text-slate-900",
      ].join(" ")}
    >
      {primary ? (
        <div
          className="absolute -right-20 -top-20 h-48 w-48 rounded-full opacity-30 blur-2xl"
          style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
        />
      ) : null}

      <div className="relative min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div
            className={[
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl text-2xl",
              primary ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700",
            ].join(" ")}
          >
            {icon}
          </div>

          <div className="flex min-w-0 items-center gap-2">
            {badge ? (
              <span
                className={[
                  "max-w-[150px] truncate rounded-full px-3 py-1 text-xs font-semibold",
                  primary ? "bg-white/10 text-white" : "bg-blue-50 text-blue-700",
                ].join(" ")}
              >
                {badge}
              </span>
            ) : null}

            <span
              className={[
                "shrink-0 rounded-2xl px-3 py-2 text-sm transition group-hover:translate-x-1",
                primary ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              →
            </span>
          </div>
        </div>

        <h2
          className={[
            "mt-6 break-words text-2xl font-semibold tracking-tight",
            primary ? "text-white" : "text-slate-900",
          ].join(" ")}
        >
          {title}
        </h2>

        <p
          className={[
            "mt-3 break-words text-sm leading-7",
            primary ? "text-slate-300" : "text-slate-500",
          ].join(" ")}
        >
          {description}
        </p>

        <div
          className={[
            "mt-6 text-sm font-semibold",
            primary ? "text-white" : "text-slate-800",
          ].join(" ")}
        >
          Abrir módulo
        </div>
      </div>
    </Link>
  );
}

function RoutineStep({
  number,
  title,
  description,
  href,
}: {
  number: string;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 gap-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
        {number}
      </div>

      <div className="min-w-0">
        <div className="break-words text-base font-semibold text-slate-900">{title}</div>

        <div className="mt-1 break-words text-sm leading-6 text-slate-500">
          {description}
        </div>

        <div className="mt-3 text-sm font-semibold text-slate-700 group-hover:text-slate-950">
          Acessar →
        </div>
      </div>
    </Link>
  );
}

function TeacherAvatar({
  identity,
  size = "lg",
}: {
  identity: TeacherIdentity;
  size?: "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-24 w-24 text-2xl" : "h-14 w-14 text-base";

  if (identity.photoUrl) {
    return (
      <div
        className={[
          "shrink-0 overflow-hidden rounded-[30px] border border-white/15 bg-white/10 shadow-sm",
          sizeClass,
        ].join(" ")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={identity.photoUrl}
          alt={`Foto de ${identity.name}`}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={[
        "flex shrink-0 items-center justify-center rounded-[30px] border border-white/15 bg-white/10 font-bold text-white shadow-sm",
        sizeClass,
      ].join(" ")}
    >
      {identity.initials}
    </div>
  );
}

function SchoolLogo({
  schoolName,
  logoUrl,
}: {
  schoolName: string;
  logoUrl: string | null;
}) {
  if (logoUrl) {
    return (
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={schoolName}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border border-slate-200 bg-white text-base font-bold text-slate-900 shadow-sm">
      {getInitials(schoolName)}
    </div>
  );
}

export default function TeacherHomePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeOk | null>(null);
  const [teacherIdentity, setTeacherIdentity] = useState<TeacherIdentity>({
    name: "Professor",
    firstName: "Professor",
    email: "Professor",
    initials: "PR",
    photoUrl: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [messagesSummary, setMessagesSummary] = useState<MessagesSummary>({
    total: 0,
    unread: 0,
    read: 0,
  });

  const schoolId = me?.school?.schoolId || "";
  const schoolName = me?.branding?.brandName || "Portal do Professor";
  const logoUrl = me?.branding?.brandLogoUrl || me?.branding?.brandIconUrl || null;
  const userLabel = teacherIdentity.email || me?.user.email || me?.user.id || "Professor";

  const unreadMessagesLabel = useMemo(() => {
    if (messagesSummary.unread > 0) return `${messagesSummary.unread} novo(s)`;
    if (messagesSummary.total > 0) return "Tudo lido";
    return "Nenhum";
  }, [messagesSummary]);

  async function loadMessagesSummary(accessToken: string) {
    try {
      const res = await fetch("/api/teacher/messages", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (res.ok && json?.ok) {
        setMessagesSummary(
          json.summary || {
            total: 0,
            unread: 0,
            read: 0,
          }
        );
      }
    } catch {
      setMessagesSummary({
        total: 0,
        unread: 0,
        read: 0,
      });
    }
  }

  useEffect(() => {
    let alive = true;

    async function boot() {
      setLoading(true);
      setError(null);

      try {
        const { data: sessionData, error: sessErr } = await supabase.auth.getSession();

        if (sessErr) throw new Error(sessErr.message);

        const accessToken = sessionData.session?.access_token;

        if (!accessToken) {
          router.replace("/login");
          return;
        }

        const data = await fetchMeWithToken(accessToken);

        if (!alive) return;

        if (!data || (data as any).ok !== true) {
          router.replace("/login");
          return;
        }

        const role = String((data as any).school?.role || "").trim().toLowerCase();

        if (role !== "professor" && role !== "teacher") {
          router.replace((data as any).redirectTo || "/");
          return;
        }

        const sessionUser = sessionData.session?.user || null;

        setTeacherIdentity(
          getTeacherIdentityFromSessionUser(sessionUser, (data as MeOk).user.email)
        );

        setMe(data as MeOk);

        await loadMessagesSummary(accessToken);
      } catch (e: any) {
        if (!alive) return;

        setError(e?.message || "Falha ao carregar sessão do professor.");
        setMe(null);
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

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-5">
            <div className="h-10 w-80 max-w-full rounded-2xl bg-slate-200" />
            <div className="h-4 w-[520px] max-w-full rounded-2xl bg-slate-100" />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="h-36 rounded-[32px] bg-slate-100" />
              <div className="h-36 rounded-[32px] bg-slate-100" />
              <div className="h-36 rounded-[32px] bg-slate-100" />
              <div className="h-36 rounded-[32px] bg-slate-100" />
            </div>

            <div className="h-80 rounded-[34px] bg-slate-100" />
          </div>
        </section>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[32px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Portal do Professor</h1>

          {error ? (
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              Sessão inválida. Redirecionando...
            </p>
          )}

          <button
            type="button"
            onClick={() => router.replace("/login")}
            className="mt-6 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            Ir para login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[40px] border border-slate-200 bg-slate-950 p-5 text-white shadow-xl md:p-8">
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
        />

        <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative grid grid-cols-1 gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <TeacherAvatar identity={teacherIdentity} />

              <div className="min-w-0">
                <div className="inline-flex max-w-full rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  <span className="truncate">{formatTodayBR()}</span>
                </div>

                <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight md:text-5xl">
                  {getPeriodGreeting()}, {teacherIdentity.firstName}
                </h1>

                <p className="mt-3 max-w-3xl break-words text-sm leading-7 text-slate-300 md:text-base">
                  Este é seu painel de rotina docente. Acesse turmas, chamada,
                  diário pedagógico e comunicados oficiais da escola em poucos cliques.
                </p>

                <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="max-w-full truncate rounded-full bg-white/10 px-3 py-1">
                    {teacherIdentity.name}
                  </span>

                  <span className="max-w-full truncate rounded-full bg-white/10 px-3 py-1">
                    {schoolName}
                  </span>

                  <span className="max-w-full truncate rounded-full bg-white/10 px-3 py-1">
                    Usuário: {userLabel}
                  </span>

                  <span className="max-w-full truncate rounded-full bg-white/10 px-3 py-1">
                    Escola ID: <span className="font-mono">{schoolId || "—"}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => router.push("/teacher/classes")}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
              >
                Abrir minhas turmas
              </button>

              <button
                type="button"
                onClick={() => router.push("/teacher/messages")}
                className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
              >
                Ver comunicados
              </button>
            </div>
          </div>

          <div className="min-w-0 rounded-[36px] border border-white/10 bg-white/10 p-5 backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              Central de comunicados
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="min-w-0 rounded-3xl bg-white/10 p-4 text-center">
                <div className="break-words text-3xl font-semibold">
                  {messagesSummary.total}
                </div>
                <div className="mt-1 text-xs text-slate-300">Total</div>
              </div>

              <div className="min-w-0 rounded-3xl bg-blue-500/20 p-4 text-center">
                <div className="break-words text-3xl font-semibold text-blue-100">
                  {messagesSummary.unread}
                </div>
                <div className="mt-1 text-xs text-blue-100">Novos</div>
              </div>

              <div className="min-w-0 rounded-3xl bg-emerald-500/20 p-4 text-center">
                <div className="break-words text-3xl font-semibold text-emerald-100">
                  {messagesSummary.read}
                </div>
                <div className="mt-1 text-xs text-emerald-100">Lidos</div>
              </div>
            </div>

            <div className="mt-5 rounded-3xl bg-white p-4 text-slate-900">
              <div className="break-words text-sm font-semibold">
                {messagesSummary.unread > 0
                  ? "Você tem comunicados novos"
                  : "Comunicados em dia"}
              </div>

              <p className="mt-2 break-words text-sm leading-6 text-slate-500">
                Ao abrir os comunicados, o sistema confirma a visualização para a escola.
              </p>

              <button
                type="button"
                onClick={() => router.push("/teacher/messages")}
                className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Abrir comunicados
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          label="Turmas"
          value="Minhas turmas"
          help="Acesse os vínculos ativos e entre na chamada ou diário."
          icon="🏫"
          tone="brand"
        />

        <StatCard
          label="Comunicados"
          value={unreadMessagesLabel}
          help="Avisos oficiais enviados pela gestão escolar."
          icon="📩"
          tone={messagesSummary.unread > 0 ? "blue" : "default"}
        />

        <StatCard
          label="Chamada"
          value="Disponível"
          help="Registro de presença, ausência e atraso por turma."
          icon="✅"
          tone="emerald"
        />

        <StatCard
          label="Diário"
          value="Pedagógico"
          help="Registro de conteúdos e observações do dia."
          icon="📘"
          tone="amber"
        />
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-slate-900">
              Módulos principais
            </h2>

            <p className="mt-1 break-words text-sm text-slate-500">
              Seu trabalho docente organizado em módulos rápidos.
            </p>
          </div>

          <div className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">
            Portal premium do professor
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FeatureCard
            href="/teacher/classes"
            title="Minhas turmas"
            description="Entre nas turmas vinculadas, visualize alunos e acesse as ações principais do professor."
            icon="🏫"
            primary
          />

          <FeatureCard
            href="/teacher/classes"
            title="Chamada"
            description="Acesse a turma desejada e registre frequência dos alunos com controle diário."
            icon="✅"
          />

          <FeatureCard
            href="/teacher/messages"
            title="Comunicados"
            description="Leia avisos oficiais enviados pela direção, coordenação ou secretaria."
            icon="📩"
            badge={messagesSummary.unread > 0 ? `${messagesSummary.unread} novo(s)` : undefined}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[36px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Fluxo sugerido
              </div>

              <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-900">
                Rotina do dia
              </h2>

              <p className="mt-2 break-words text-sm leading-6 text-slate-500">
                Um caminho simples para executar as principais tarefas docentes.
              </p>
            </div>

            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Hoje
            </span>
          </div>

          <div className="mt-5 space-y-3">
            <RoutineStep
              number="01"
              title="Abrir turmas"
              description="Confira as turmas vinculadas ao seu usuário professor."
              href="/teacher/classes"
            />

            <RoutineStep
              number="02"
              title="Realizar chamada"
              description="Entre na turma desejada e registre a presença dos alunos."
              href="/teacher/classes"
            />

            <RoutineStep
              number="03"
              title="Lançar diário pedagógico"
              description="Registre conteúdos trabalhados e observações importantes."
              href="/teacher/classes"
            />

            <RoutineStep
              number="04"
              title="Conferir comunicados"
              description="Veja avisos oficiais e confirme leitura automaticamente."
              href="/teacher/messages"
            />
          </div>
        </div>

        <div className="rounded-[36px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Visão rápida
          </div>

          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
            <SchoolLogo schoolName={schoolName} logoUrl={logoUrl} />

            <div className="min-w-0">
              <h2 className="break-words text-2xl font-semibold tracking-tight text-slate-900">
                Seu painel está pronto para uso
              </h2>

              <p className="mt-2 break-words text-sm leading-7 text-slate-500">
                O professor não precisa navegar por áreas administrativas. O painel foi
                desenhado para abrir a rotina de sala de aula rapidamente e manter a
                comunicação escolar clara.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Foco na aula</div>

              <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                Chamada e diário ficam centralizados nas turmas.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Comunicação</div>

              <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                Avisos da gestão aparecem no painel do professor.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Multi-tenant</div>

              <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                Cada professor opera dentro da escola vinculada.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Mobile first</div>

              <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                A navegação inferior facilita o uso pelo celular.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}