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

type ModuleStatus = "ativo" | "implantacao" | "proximo";

type QuickAction = {
  label: string;
  href: string;
  description: string;
  status: ModuleStatus;
  category: "Gestão Acadêmica" | "Relacionamento" | "Gestão Escolar";
};

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function getRoleLabel(role?: string) {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "Diretor";
  if (r === "coordenador" || r === "coordinator") return "Coordenador";
  if (r === "admin") return "Administrador";
  return role || "Usuário escolar";
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

function ModuleCard({
  item,
  onOpen,
}: {
  item: QuickAction;
  onOpen: (href: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.href)}
      className="group w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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

      <div className="mt-5 text-sm font-semibold text-slate-700 group-hover:text-slate-900">
        Abrir módulo →
      </div>
    </button>
  );
}

export default function SchoolDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleLabel = useMemo(() => getRoleLabel(me?.school?.role), [me?.school?.role]);
  const brandName = me?.branding?.brandName || "Minha Escola";
  const logoUrl = me?.branding?.brandLogoUrl || null;
  const schoolId = me?.school?.schoolId || "—";

  const actions: QuickAction[] = [
    {
      label: "Turmas",
      href: "/school/classes",
      description: "Crie, visualize e organize as turmas da escola por série e turno.",
      status: "ativo",
      category: "Gestão Acadêmica",
    },
    {
      label: "Alunos",
      href: "/school/students",
      description: "Cadastre alunos, acompanhe matrícula e visualize vínculos por turma.",
      status: "ativo",
      category: "Gestão Acadêmica",
    },
    {
      label: "Matrículas",
      href: "/school/enrollments",
      description: "Controle o vínculo aluno ↔ turma com segurança e consistência histórica.",
      status: "ativo",
      category: "Gestão Acadêmica",
    },
    {
      label: "Pais / Responsáveis",
      href: "/school/parents",
      description: "Cadastre responsáveis, prepare acessos e organize o relacionamento escolar.",
      status: "ativo",
      category: "Relacionamento",
    },
    {
      label: "Professores",
      href: "/school/teachers",
      description: "Cadastre professores e mantenha o corpo docente centralizado pela direção.",
      status: "ativo",
      category: "Gestão Acadêmica",
    },
    {
      label: "Vínculo Professor ↔ Turmas",
      href: "/school/teacher-classes",
      description: "Defina quais professores atendem cada turma e mantenha o painel docente correto.",
      status: "ativo",
      category: "Gestão Acadêmica",
    },
    {
      label: "Branding da Escola",
      href: "/school/settings/branding",
      description: "Personalize logo e identidade visual da escola nos painéis e PDFs.",
      status: "ativo",
      category: "Gestão Escolar",
    },
    {
      label: "Financeiro",
      href: "/school/finance",
      description: "Área preparada para mensalidades, recebimentos, cobranças e visão financeira.",
      status: "implantacao",
      category: "Gestão Escolar",
    },
    {
      label: "Diário de Classe",
      href: "/school/class-diary",
      description: "Acompanhe o diário pedagógico lançado pelos professores por turma e período.",
      status: "implantacao",
      category: "Gestão Acadêmica",
    },
    {
      label: "Boletins Bimestrais",
      href: "/school/report-cards",
      description: "Área reservada para notas, médias, pareceres e boletins por bimestre.",
      status: "proximo",
      category: "Gestão Acadêmica",
    },
    {
      label: "Comunicação com Pais",
      href: "/school/messages",
      description: "Central de comunicados da direção com pais e responsáveis.",
      status: "proximo",
      category: "Relacionamento",
    },
  ];

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

        const role = String(payload.school?.role || "").trim().toLowerCase();

        if (
          role !== "diretor" &&
          role !== "director" &&
          role !== "coordenador" &&
          role !== "coordinator" &&
          role !== "admin"
        ) {
          router.replace("/login");
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
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl">
          <div className="animate-pulse rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="h-8 w-64 rounded bg-slate-200" />
            <div className="mt-3 h-4 w-96 rounded bg-slate-100" />
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-40 rounded-3xl bg-slate-100" />
              <div className="h-40 rounded-3xl bg-slate-100" />
              <div className="h-40 rounded-3xl bg-slate-100" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
          <div className="w-full rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Não foi possível entrar</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

            <button
              onClick={() => router.replace("/login")}
              className="mt-6 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
            >
              Voltar ao login
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-2 backdrop-blur">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={brandName}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/15 bg-white/10 text-2xl font-bold backdrop-blur">
                    {getInitials(brandName)}
                  </div>
                )}

                <div>
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                    Gestão Escolar • Versão operacional
                  </div>

                  <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                    Painel da Escola
                  </h1>

                  <p className="mt-2 text-sm text-slate-200 md:text-base">
                    {brandName} • Perfil {roleLabel} • Usuário {me?.user.email || me?.user.id}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => go("/school/settings/branding")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Personalizar escola
                </button>

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

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-medium text-slate-500">Escola vinculada</div>
              <div className="mt-3 break-all font-mono text-sm text-slate-800">{schoolId}</div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-medium text-slate-500">Identidade visual</div>
              <div className="mt-3 text-sm text-slate-800">
                {logoUrl
                  ? "Logo configurada e pronta para uso nos painéis e PDFs."
                  : "Logo ainda não configurada. Defina a identidade visual da escola."}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-medium text-slate-500">Entrega de hoje</div>
              <div className="mt-3 text-sm text-slate-800">
                Painel central da diretoria com acesso aos módulos acadêmicos e operacionais.
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Turmas
            </div>
            <div className="mt-2 text-sm text-slate-700">
              Organização de séries, anos e turnos.
            </div>
            <button
              onClick={() => go("/school/classes")}
              className="mt-4 rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Acessar
            </button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Alunos
            </div>
            <div className="mt-2 text-sm text-slate-700">
              Cadastro, visualização e vínculo com turma.
            </div>
            <button
              onClick={() => go("/school/students")}
              className="mt-4 rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Acessar
            </button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Professores
            </div>
            <div className="mt-2 text-sm text-slate-700">
              Cadastro docente e vínculo com turmas.
            </div>
            <button
              onClick={() => go("/school/teachers")}
              className="mt-4 rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Acessar
            </button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Responsáveis
            </div>
            <div className="mt-2 text-sm text-slate-700">
              Login dos pais e relacionamento escolar.
            </div>
            <button
              onClick={() => go("/school/parents")}
              className="mt-4 rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Acessar
            </button>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Módulos da gestão escolar
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              A diretoria pode acessar rapidamente tudo o que já está operacional na plataforma.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {actions.map((item) => (
              <ModuleCard key={item.href} item={item} onOpen={go} />
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Orientação da entrega</h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Para a apresentação de hoje, o ponto mais forte é mostrar que a direção já possui
                um painel central com controle sobre turmas, alunos, professores, responsáveis,
                branding e expansão pedagógica do sistema.
              </p>
            </div>

            <div className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
              Multi-tenant ativo
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Acadêmico
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Turmas, alunos, matrículas, professores e vínculos já acessíveis pela direção.
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Professor
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Chamada digital, diário de classe e PDFs pedagógicos já fazem parte da operação.
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Responsáveis
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Estrutura pronta para login, vinculação e expansão da comunicação com pais.
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Próximos passos
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Financeiro completo, boletim bimestral e mensagens da direção.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}