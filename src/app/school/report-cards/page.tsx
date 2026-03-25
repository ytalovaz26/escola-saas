"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type BrandingPayload = {
  brandName: string | null;
  brandLogoUrl: string | null;
  brandIconUrl: string | null;
};

type MePayload = {
  ok: boolean;
  user?: {
    id: string;
    email: string | null;
  };
  school?: {
    schoolId: string;
    role: string;
  };
  branding?: BrandingPayload | null;
};

type ModuleCard = {
  category: string;
  title: string;
  description: string;
  href: string;
  status: "Disponível" | "Em implantação" | "Próxima etapa";
};

function statusClasses(status: ModuleCard["status"]) {
  if (status === "Disponível") {
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  }

  if (status === "Em implantação") {
    return "bg-amber-50 text-amber-700 border border-amber-200";
  }

  return "bg-slate-100 text-slate-600 border border-slate-200";
}

export default function SchoolPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [schoolName, setSchoolName] = useState("Painel da Escola");
  const [branding, setBranding] = useState<BrandingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMe() {
    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json: MePayload = await res.json();

      if (!res.ok || !json?.ok) {
        setError("Não foi possível carregar os dados da escola.");
        return;
      }

      const loadedSchoolId = json.school?.schoolId || "";
      const loadedRole = json.school?.role || "";
      const loadedEmail = json.user?.email || "";
      const loadedBranding = json.branding || null;
      const loadedSchoolName =
        json.branding?.brandName?.trim() || "Painel da Escola";

      setSchoolId(loadedSchoolId);
      setRole(loadedRole);
      setEmail(loadedEmail);
      setBranding(loadedBranding);
      setSchoolName(loadedSchoolName);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar painel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const modules: ModuleCard[] = [
    {
      category: "Gestão Acadêmica",
      title: "Turmas",
      description: "Crie, visualize e organize as turmas da escola por série e turno.",
      href: "/school/classes",
      status: "Disponível",
    },
    {
      category: "Gestão Acadêmica",
      title: "Alunos",
      description: "Cadastre alunos, acompanhe matrícula e visualize vínculos por turma.",
      href: "/school/students",
      status: "Disponível",
    },
    {
      category: "Gestão Acadêmica",
      title: "Matrículas",
      description: "Controle o vínculo aluno ↔ turma com segurança e consistência histórica.",
      href: "/school/enrollments",
      status: "Disponível",
    },
    {
      category: "Relacionamento",
      title: "Pais / Responsáveis",
      description: "Cadastre responsáveis, prepare acessos e organize o relacionamento escolar.",
      href: "/school/parents",
      status: "Disponível",
    },
    {
      category: "Gestão Acadêmica",
      title: "Professores",
      description: "Cadastre professores e mantenha o corpo docente centralizado pela direção.",
      href: "/school/teachers",
      status: "Disponível",
    },
    {
      category: "Gestão Acadêmica",
      title: "Vínculo Professor ↔ Turmas",
      description: "Defina quais professores atendem cada turma e mantenha o painel docente correto.",
      href: "/school/teacher-classes",
      status: "Disponível",
    },
    {
      category: "Gestão Escolar",
      title: "Branding da Escola",
      description: "Personalize logo e identidade visual da escola nos painéis e PDFs.",
      href: "/school/branding",
      status: "Disponível",
    },
    {
      category: "Gestão Escolar",
      title: "Financeiro",
      description: "Área preparada para mensalidades, recebimentos, cobranças e visão financeira.",
      href: "/school/finance",
      status: "Em implantação",
    },
    {
      category: "Gestão Acadêmica",
      title: "Diário de Classe",
      description: "Acompanhe o diário pedagógico lançado pelos professores por turma e período.",
      href: "/school/class-diary",
      status: "Disponível",
    },
    {
      category: "Gestão Acadêmica",
      title: "Chamada Escolar",
      description: "Gere os PDFs de chamada diária, mensal e por período pela visão da direção.",
      href: "/school/attendance",
      status: "Disponível",
    },
    {
      category: "Gestão Acadêmica",
      title: "Boletins Bimestrais",
      description: "Área reservada para notas, médias, pareceres e boletins por bimestre.",
      href: "/school/report-cards",
      status: "Próxima etapa",
    },
    {
      category: "Relacionamento",
      title: "Comunicação com Pais",
      description: "Central de comunicados da direção com pais e responsáveis.",
      href: "/school/messages",
      status: "Próxima etapa",
    },
  ];

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-500">
            Carregando painel da escola...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center min-h-[220px]">
              {branding?.brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.brandLogoUrl}
                  alt={schoolName}
                  className="max-h-40 w-auto object-contain"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-3xl border border-dashed border-slate-300 text-sm text-slate-400">
                  Sem logo
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  Gestão Escolar • Versão operacional
                </div>

                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  Painel da Escola
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  {schoolName} • Perfil {role || "Diretor"} • Usuário {email || "—"}
                </p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/school/branding")}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Personalizar escola
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Sair
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Escola vinculada
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900 break-all">
                {schoolId || "—"}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Identidade visual
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Logo configurada e pronta para uso nos painéis e PDFs.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Entrega de hoje
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Painel central da diretoria com acesso aos módulos acadêmicos e operacionais.
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">
            Módulos da gestão escolar
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            A diretoria pode acessar rapidamente tudo o que já está operacional na plataforma.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {modules.map((module) => (
              <div
                key={module.title}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {module.category}
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${statusClasses(
                      module.status
                    )}`}
                  >
                    {module.status}
                  </span>
                </div>

                <h3 className="mt-3 text-xl font-semibold text-slate-900">
                  {module.title}
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {module.description}
                </p>

                <button
                  type="button"
                  onClick={() => router.push(module.href)}
                  className="mt-5 rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Abrir módulo →
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">
            Orientação da entrega
          </h2>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            Para a apresentação de hoje, o ponto mais forte é mostrar que a direção já possui
            um painel central com controle sobre turmas, alunos, professores, responsáveis,
            branding e expansão pedagógica do sistema.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <b>MVP já ativo:</b> cadastro acadêmico, vínculos, diário pedagógico e PDF de chamada.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <b>Próxima expansão:</b> boletim, comunicação com pais e financeiro completo.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}