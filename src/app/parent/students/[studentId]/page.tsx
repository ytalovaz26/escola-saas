"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ChildRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
  relationship: string | null;
  active_class: null | {
    class_id: string;
    started_at: string;
    ended_at: string | null;
    class: null | {
      id: string;
      name: string;
      grade: string | null;
      shift: string | null;
    };
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

function classLabel(c: NonNullable<NonNullable<ChildRow["active_class"]>["class"]>) {
  const parts = [c.name];
  if (c.grade) parts.push(c.grade);
  if (c.shift) parts.push(c.shift);
  return parts.join(" • ");
}

function initials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
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
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

function QuickCard({
  title,
  description,
  onClick,
  primary = false,
}: {
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-3xl border p-5 text-left shadow-sm transition",
        primary
          ? "border-slate-900 bg-slate-900 text-white hover:opacity-95"
          : "border-slate-200 bg-white hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md",
      ].join(" ")}
    >
      <div className={`text-lg font-semibold ${primary ? "text-white" : "text-slate-900"}`}>
        {title}
      </div>
      <p className={`mt-2 text-sm leading-6 ${primary ? "text-slate-200" : "text-slate-500"}`}>
        {description}
      </p>
      <div className={`mt-5 text-sm font-semibold ${primary ? "text-white" : "text-slate-700"}`}>
        Abrir →
      </div>
    </button>
  );
}

export default function ParentStudentPage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const studentId = String(params?.studentId || "").trim();

  const [loading, setLoading] = useState(true);
  const [child, setChild] = useState<ChildRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => child?.full_name || "Aluno", [child]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/parent/children", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await safeJson(res);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao carregar dados do responsável.");
          if (res.status === 401) router.replace("/login");
          return;
        }

        const list = (json.children ?? []) as ChildRow[];
        const found = list.find((x) => x.id === studentId) || null;

        if (!found) {
          setError("Você não tem permissão para ver este aluno (não está vinculado).");
          return;
        }

        setChild(found);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, studentId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-7xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-56 rounded-xl bg-slate-200" />
            <div className="h-4 w-72 rounded-xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Erro</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button
            onClick={() => router.push("/parent/children")}
            className="mt-4 w-full rounded-2xl bg-slate-900 p-3 text-white"
          >
            Voltar
          </button>
        </div>
      </main>
    );
  }

  if (!child) return null;

  const cls = child.active_class?.class;

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-white/15 bg-white/10 text-xl font-semibold backdrop-blur">
                  {initials(child.full_name)}
                </div>

                <div className="min-w-0">
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                    Central do aluno
                  </div>

                  <h1 className="mt-3 truncate text-3xl font-semibold tracking-tight">
                    {title}
                  </h1>

                  <p className="mt-2 text-sm text-slate-200">
                    {child.registration_number
                      ? `Matrícula: ${child.registration_number}`
                      : "Sem matrícula"}
                    {child.relationship ? ` • ${child.relationship}` : ""}
                  </p>

                  <p className="mt-2 text-xs text-slate-300">
                    Turma ativa: {cls ? classLabel(cls) : "Sem turma ativa"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => router.push("/parent/children")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:opacity-90"
              >
                Voltar para filhos
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <MetricCard
              label="Presença diária"
              value="Disponível"
              help="Consulte o status de presença do aluno por data e por aula."
            />

            <MetricCard
              label="Presença mensal"
              value="Disponível"
              help="Acompanhe o histórico do mês com visão consolidada em calendário."
            />

            <MetricCard
              label="Boletim"
              value="Disponível"
              help="Consulte notas, média, situação e gere o PDF do período."
            />
          </div>
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Acompanhamento escolar
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Escolha o que deseja consultar neste momento para este aluno.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <QuickCard
              title="Presença diária"
              description="Veja a frequência do aluno em um dia específico, com detalhamento por aula."
              onClick={() => router.push(`/parent/students/${child.id}/daily`)}
              primary
            />

            <QuickCard
              title="Presença mensal"
              description="Acompanhe o histórico do mês em uma visualização de calendário mais ampla."
              onClick={() => router.push(`/parent/students/${child.id}/monthly`)}
            />

            <QuickCard
              title="Boletim escolar"
              description="Consulte notas, média do período, situação e baixe o boletim em PDF."
              onClick={() => router.push(`/parent/students/${child.id}/report-card`)}
            />
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Resumo do aluno</h3>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Nome
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {child.full_name}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Matrícula
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {child.registration_number || "—"}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Parentesco
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {child.relationship || "—"}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Turma
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {cls ? classLabel(cls) : "Sem turma ativa"}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}