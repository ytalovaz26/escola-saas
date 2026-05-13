"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

type RoleKey = "diretor" | "coordenador" | "secretaria" | "professor" | "admin" | "unknown";

type ModuleStatus = "ativo" | "implantacao" | "proximo";

type QuickAction = {
  label: string;
  href: string;
  description: string;
  status: ModuleStatus;
  category: "Gestão Acadêmica" | "Relacionamento" | "Gestão Escolar";
  roles: RoleKey[];
};

const SUBJECTS_HREF = "/school/subjects";
const BRANDING_HREF = "/school/settings/branding";
const STAFF_HREF = "/school/staff";

function safeJson(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function normalizeRole(role?: string): RoleKey {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin") return "admin";

  return "unknown";
}

function canAccess(role: RoleKey, item: QuickAction) {
  if (role === "admin") return true;
  return item.roles.includes(role);
}

function getRoleLabel(role?: string) {
  const r = normalizeRole(role);

  if (r === "diretor") return "Diretor";
  if (r === "coordenador") return "Coordenador";
  if (r === "secretaria") return "Secretaria";
  if (r === "admin") return "Administrador";
  if (r === "professor") return "Professor";

  return "Usuário escolar";
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "ES";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function statusBadgeClass(status: ModuleStatus) {
  if (status === "ativo") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "implantacao") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-600";
}

function statusLabel(status: ModuleStatus) {
  if (status === "ativo") return "Disponível";
  if (status === "implantacao") return "Em implantação";
  return "Próxima etapa";
}

function categoryIcon(category: QuickAction["category"]) {
  if (category === "Gestão Acadêmica") return "🎓";
  if (category === "Relacionamento") return "👨‍👩‍👧‍👦";
  return "🏫";
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

function HighlightCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-[28px] border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        </div>

        <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
          →
        </div>
      </div>

      <div className="mt-4 text-sm font-medium text-slate-700 group-hover:text-slate-900">
        Abrir agora
      </div>
    </button>
  );
}

function ModuleCard({
  item,
  onOpen,
}: {
  item: QuickAction;
  onOpen: (href: string) => void;
}) {
  const isReady = item.status === "ativo";

  return (
    <button
      type="button"
      onClick={() => {
        if (isReady) onOpen(item.href);
      }}
      disabled={!isReady}
      className={[
        "group w-full rounded-[28px] border border-slate-200 bg-white p-5 text-left shadow-sm transition",
        isReady ? "hover:-translate-y-0.5 hover:shadow-md" : "cursor-not-allowed opacity-80",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">
          {categoryIcon(item.category)}
        </div>

        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(
            item.status
          )}`}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {item.category}
        </div>
        <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.label}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
      </div>

      <div className="mt-5 text-sm font-semibold text-slate-700">
        {isReady ? "Abrir módulo →" : "Em breve"}
      </div>
    </button>
  );
}

export default function SchoolDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentRole = normalizeRole(me?.school?.role);
  const roleLabel = useMemo(() => getRoleLabel(me?.school?.role), [me?.school?.role]);

  const brandName = me?.branding?.brandName || "Minha Escola";
  const logoUrl = me?.branding?.brandLogoUrl || null;
  const schoolId = me?.school?.schoolId || "—";

  const allActions: QuickAction[] = [
    {
      label: "Equipe Escolar",
      href: STAFF_HREF,
      description: "Gerencie diretores, coordenadores, secretarias e professores.",
      status: "ativo",
      category: "Gestão Escolar",
      roles: ["diretor", "coordenador", "admin"],
    },
    {
      label: "Turmas",
      href: "/school/classes",
      description: "Crie, visualize e organize as turmas da escola por série e turno.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "admin"],
    },
    {
      label: "Alunos",
      href: "/school/students",
      description: "Cadastre alunos, acompanhe matrícula e visualize vínculos por turma.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Matrículas",
      href: "/school/enrollments",
      description: "Controle o vínculo aluno ↔️ turma com segurança e consistência histórica.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Pais / Responsáveis",
      href: "/school/parents",
      description: "Cadastre responsáveis, prepare acessos e organize o relacionamento escolar.",
      status: "ativo",
      category: "Relacionamento",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Professores",
      href: "/school/teachers",
      description: "Cadastre professores e mantenha o corpo docente centralizado pela direção.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "admin"],
    },
    {
      label: "Vínculo Professor ↔️ Turmas",
      href: "/school/teacher-classes",
      description: "Defina quais professores atendem cada turma e mantenha o painel docente correto.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "admin"],
    },
    {
      label: "Disciplinas",
      href: SUBJECTS_HREF,
      description: "Cadastre as disciplinas da escola e vincule quais matérias pertencem a cada turma.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "admin"],
    },
    {
      label: "Presença",
      href: "/school/attendance",
      description: "Acompanhe registros de frequência e rotina escolar dos alunos.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Diário de Classe",
      href: "/school/class-diary",
      description: "Acompanhe o diário pedagógico lançado pelos professores por turma e período.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "admin"],
    },
    {
      label: "Boletins Bimestrais",
      href: "/school/report-cards",
      description: "Área reservada para visão da direção sobre notas, médias e emissão de boletins.",
      status: "ativo",
      category: "Gestão Acadêmica",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Agenda Escolar",
      href: "/school/calendar",
      description: "Crie eventos, reuniões e compromissos que aparecem no portal dos responsáveis.",
      status: "ativo",
      category: "Relacionamento",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Financeiro",
      href: "/school/finance",
      description: "Área preparada para mensalidades, recebimentos, cobranças e visão financeira.",
      status: "implantacao",
      category: "Gestão Escolar",
      roles: ["diretor", "secretaria", "admin"],
    },
    {
      label: "Comunicados",
      href: "/school/messages",
      description: "Central de comunicados da direção com pais, responsáveis e equipe escolar.",
      status: "ativo",
      category: "Relacionamento",
      roles: ["diretor", "coordenador", "secretaria", "admin"],
    },
    {
      label: "Branding da Escola",
      href: BRANDING_HREF,
      description: "Personalize logo e identidade visual da escola nos painéis e PDFs.",
      status: "ativo",
      category: "Gestão Escolar",
      roles: ["diretor", "admin"],
    },
  ];

  const actions = useMemo(() => {
    return allActions.filter((item) => canAccess(currentRole, item));
  }, [currentRole]);

  const highlightActions = useMemo(() => {
    const preferredByRole: Record<RoleKey, string[]> = {
      diretor: [
        "Equipe Escolar",
        "Turmas",
        "Alunos",
        "Agenda Escolar",
        "Comunicados",
        "Pais / Responsáveis",
      ],
      coordenador: [
        "Equipe Escolar",
        "Turmas",
        "Alunos",
        "Agenda Escolar",
        "Comunicados",
        "Boletins Bimestrais",
      ],
      secretaria: [
        "Alunos",
        "Matrículas",
        "Pais / Responsáveis",
        "Agenda Escolar",
        "Comunicados",
        "Financeiro",
      ],
      professor: [],
      admin: [
        "Equipe Escolar",
        "Turmas",
        "Alunos",
        "Agenda Escolar",
        "Comunicados",
        "Pais / Responsáveis",
      ],
      unknown: [],
    };

    const preferred = preferredByRole[currentRole] || [];

    return preferred
      .map((label) => actions.find((item) => item.label === label))
      .filter(Boolean) as QuickAction[];
  }, [actions, currentRole]);

  const availableCount = actions.filter((a) => a.status === "ativo").length;
  const inProgressCount = actions.filter((a) => a.status === "implantacao").length;
  const nextCount = actions.filter((a) => a.status === "proximo").length;

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const text = await res.text();
        const json: any = safeJson(text);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao validar sessão/perfil.");
          return;
        }

        const payload = json as MePayload;

        if (payload.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        const role = normalizeRole(payload.school?.role);

        if (
          role !== "diretor" &&
          role !== "coordenador" &&
          role !== "secretaria" &&
          role !== "admin"
        ) {
          router.replace(payload.redirectTo || "/login");
          return;
        }

        setMe(payload);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado ao carregar o painel.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function go(href: string) {
    router.push(href);
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse">
            <div className="h-8 w-64 rounded-xl bg-slate-200" />
            <div className="mt-3 h-4 w-96 rounded-xl bg-slate-100" />
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="h-36 rounded-[28px] bg-slate-100" />
              <div className="h-36 rounded-[28px] bg-slate-100" />
              <div className="h-36 rounded-[28px] bg-slate-100" />
              <div className="h-36 rounded-[28px] bg-slate-100" />
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Não foi possível entrar</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

          <button
            type="button"
            onClick={() => router.replace("/login")}
            className="mt-6 inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Voltar ao login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              {logoUrl ? (
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl}
                    alt={brandName}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl border border-white/15 bg-white/10 text-2xl font-bold backdrop-blur">
                  {getInitials(brandName)}
                </div>
              )}

              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Painel executivo da escola
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  {brandName}
                </h1>

                <p className="mt-2 text-sm text-slate-200 md:text-base">
                  Perfil {roleLabel} • Usuário {me?.user.email || me?.user.id}
                </p>

                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  Controle os módulos acadêmicos, pedagógicos e operacionais permitidos
                  para o seu perfil em uma experiência profissional e segura.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {currentRole === "diretor" ||
              currentRole === "coordenador" ||
              currentRole === "admin" ? (
                <button
                  type="button"
                  onClick={() => go(STAFF_HREF)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Equipe escolar
                </button>
              ) : null}

              {currentRole === "diretor" ||
              currentRole === "coordenador" ||
              currentRole === "admin" ? (
                <button
                  type="button"
                  onClick={() => go(SUBJECTS_HREF)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Disciplinas
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => go("/school/calendar")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Agenda
              </button>

              <button
                type="button"
                onClick={() => go("/school/messages")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Comunicados
              </button>

              {currentRole === "diretor" || currentRole === "admin" ? (
                <button
                  type="button"
                  onClick={() => go(BRANDING_HREF)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Personalizar escola
                </button>
              ) : null}

              <button
                type="button"
                onClick={logout}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Sair
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <MetricCard
            label="Módulos ativos"
            value={String(availableCount)}
            help="Áreas liberadas para o seu perfil atual."
          />

          <MetricCard
            label="Em implantação"
            value={String(inProgressCount)}
            help="Recursos em evolução para ampliar o sistema."
          />

          <MetricCard
            label="Próximas entregas"
            value={String(nextCount)}
            help="Itens estratégicos planejados para novas versões."
          />

          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Escola vinculada
            </div>
            <div className="mt-3 break-all font-mono text-xs text-slate-700">{schoolId}</div>
            <div className="mt-3 text-sm leading-6 text-slate-500">
              Ambiente multi-tenant ativo e isolado por escola.
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Atalhos principais
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Os módulos mais usados para o seu perfil no dia a dia.
          </p>
        </div>

        {highlightActions.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Nenhum atalho disponível para este perfil.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {highlightActions.map((item) => (
              <HighlightCard
                key={item.href}
                title={item.label}
                description={item.description}
                onClick={() => go(item.href)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Módulos da gestão escolar
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Acesso rápido ao que está liberado para o seu perfil.
            </p>
          </div>

          <div className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
            Multi-tenant ativo
          </div>
        </div>

        {actions.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Nenhum módulo disponível para este perfil.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {actions.map((item) => (
              <ModuleCard key={item.href} item={item} onOpen={go} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Resumo estratégico</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Este painel adapta os atalhos e módulos conforme o cargo do usuário.
              Assim, cada colaborador visualiza apenas o que faz sentido para sua função.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Perfil atual: {roleLabel}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Acadêmico
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Alunos, matrículas, turmas, boletins e presença conforme permissões do perfil.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Relacionamento
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Agenda e comunicados centralizam avisos, eventos e rotina escolar para responsáveis.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Pedagógico
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Coordenação acompanha equipe, turmas, professores, disciplinas, boletins e diário.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Direção
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Diretor mantém visão ampla da escola, equipe, branding, financeiro e operação.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}