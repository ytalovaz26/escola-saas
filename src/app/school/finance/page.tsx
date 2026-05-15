// src/app/school/finance/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
};

function normalizeRole(role: string | null | undefined) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function canAccessFinance(role: string | null | undefined) {
  const r = normalizeRole(role);

  return (
    r === "diretor" ||
    r === "director" ||
    r === "secretaria" ||
    r === "secretary" ||
    r === "admin"
  );
}

function roleLabel(role: string | null | undefined) {
  const r = normalizeRole(role);

  if (r === "diretor" || r === "director") return "Diretor";
  if (r === "secretaria" || r === "secretary") return "Secretaria";
  if (r === "admin") return "Administrador";

  return "Gestão escolar";
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

export default function FinancePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readableRole = useMemo(() => roleLabel(role), [role]);

  async function getAccessToken() {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao validar sessão/perfil.");
        return;
      }

      const payload = json as MePayload;

      if (payload.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const currentRole = payload.school?.role || null;
      const currentSchoolId = payload.school?.schoolId || null;

      if (!canAccessFinance(currentRole)) {
        router.replace(payload.redirectTo || "/school");
        return;
      }

      if (!currentSchoolId) {
        setError("Usuário sem escola vinculada.");
        return;
      }

      setRole(currentRole);
      setSchoolId(currentSchoolId);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar financeiro.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="h-48 animate-pulse rounded-[32px] bg-slate-200" />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-32 animate-pulse rounded-[28px] bg-slate-200" />
          <div className="h-32 animate-pulse rounded-[28px] bg-slate-200" />
          <div className="h-32 animate-pulse rounded-[28px] bg-slate-200" />
        </section>

        <section className="h-96 animate-pulse rounded-[32px] bg-slate-200" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            Não foi possível carregar
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => router.push("/school")}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Voltar ao painel
            </button>

            <button
              onClick={loadPage}
              className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Gestão financeira
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Financeiro Escolar
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                Área preparada para mensalidades, recebimentos, cobranças, relatórios
                e integração futura com pagamentos recorrentes.
              </p>

              <div className="mt-4 text-sm text-slate-200">
                Escola:{" "}
                <span className="font-mono text-xs">{schoolId || "—"}</span>{" "}
                • Perfil: <span className="font-semibold">{readableRole}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Voltar ao painel
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
          <MetricCard
            label="Status"
            value="Preparado"
            help="Página liberada para direção e secretaria sem quebrar a navegação."
          />

          <MetricCard
            label="Cobranças"
            value="Próximo"
            help="Estrutura pronta para evoluir com mensalidades e pagamentos."
          />

          <MetricCard
            label="Isolamento"
            value="Ativo"
            help="Ambiente financeiro vinculado ao school_id da escola logada."
          />
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Módulo financeiro em implantação
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              A página agora abre corretamente para os perfis autorizados. A próxima etapa
              é criar a operação financeira real: alunos pagantes, mensalidades, status
              de pagamento, baixa manual, relatórios e integração com gateway.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
            Em implantação
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Mensalidades
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Cadastro de valores, vencimentos, desconto, multa e status por aluno.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Pagamentos
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Baixa manual e futura integração com Pix, cartão, boleto e Stripe.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Portal dos pais
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Responsável poderá consultar pendências e comprovantes no próprio app.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Relatórios
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              Visão por turma, aluno, vencimento, inadimplência e previsão de receita.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}