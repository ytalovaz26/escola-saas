"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ReportGrade = {
  subject_id: string | null;
  subject: string | null;
  score: number | null;
  updated_at: string | null;
  created_at: string | null;
};

type ReportPayload = {
  ok: true;
  student: {
    id: string;
    full_name: string | null;
    registration_number: string | null;
  };
  school: {
    id: string;
    name: string | null;
    logo_url: string | null;
  };
  class: {
    id: string;
    name: string | null;
    grade: string | null;
    shift: string | null;
  } | null;
  term: string;
  grades: ReportGrade[];
  summary: {
    average: number | null;
    situation: string;
    total_subjects: number;
  };
};

function formatDateTimeBr(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("pt-BR");
}

function formatGrade(score: number | null) {
  if (score === null || score === undefined) return "—";
  if (Number.isInteger(score)) return String(score);
  return String(score).replace(".", ",");
}

function situationBadgeClass(situation?: string) {
  const s = String(situation || "").toLowerCase();

  if (s.includes("aprovado")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (s.includes("recuperação") || s.includes("recuperacao")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (s.includes("baixo") || s.includes("reprovado")) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
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
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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

export default function ParentReportCardPage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const studentId = String(params?.studentId || "").trim();

  const [term, setTerm] = useState("1º Bimestre");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [payload, setPayload] = useState<ReportPayload | null>(null);

  const lastUpdated = useMemo(() => {
    const values = (payload?.grades || [])
      .map((item) => item.updated_at || item.created_at)
      .filter(Boolean)
      .sort();
    return values.length > 0 ? values[values.length - 1] : null;
  }, [payload]);

  const highestGrade = useMemo(() => {
    const scores = (payload?.grades || [])
      .map((item) => item.score)
      .filter((score): score is number => typeof score === "number");

    if (scores.length === 0) return null;
    return Math.max(...scores);
  }, [payload]);

  async function getAccessToken() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message || "Falha ao obter sessão.");
    }

    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessão não encontrada. Faça login novamente.");
    }

    return token;
  }

  async function loadReportCard() {
    setLoading(true);
    setError(null);

    try {
      if (!studentId) {
        throw new Error("Aluno não identificado.");
      }

      if (!term.trim()) {
        throw new Error("Informe o período.");
      }

      const token = await getAccessToken();

      const res = await fetch(
        `/api/parent/report-card?studentId=${encodeURIComponent(studentId)}&term=${encodeURIComponent(
          term.trim()
        )}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao carregar boletim.");
      }

      setPayload(json as ReportPayload);
    } catch (e: any) {
      setPayload(null);
      setError(e?.message || "Erro ao carregar boletim.");
    } finally {
      setLoading(false);
    }
  }

  async function openPdf() {
    try {
      if (!studentId) {
        throw new Error("Aluno não identificado.");
      }

      if (!term.trim()) {
        throw new Error("Informe o período.");
      }

      const token = await getAccessToken();

      const res = await fetch(
        `/api/parent/report-card/pdf?studentId=${encodeURIComponent(studentId)}&term=${encodeURIComponent(
          term.trim()
        )}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        let message = "Falha ao gerar PDF do boletim.";
        try {
          const err = await res.json();
          message = err?.error || message;
        } catch {}
        throw new Error(message);
      }

      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      window.open(fileUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(fileUrl), 10000);
    } catch (e: any) {
      setError(e?.message || "Erro ao abrir PDF do boletim.");
    }
  }

  useEffect(() => {
    loadReportCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Portal do Responsável • Boletim
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Boletim Escolar
                </h1>

                <p className="mt-2 text-sm text-slate-200 md:text-base">
                  Acompanhe notas, média e situação do período.
                </p>

                <div className="mt-4 space-y-1 text-sm text-slate-200">
                  <div>
                    <span className="font-semibold">Aluno:</span>{" "}
                    {payload?.student?.full_name ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">Matrícula:</span>{" "}
                    {payload?.student?.registration_number ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">Turma:</span>{" "}
                    {payload?.class
                      ? `${payload.class.name ?? "—"} • Série: ${payload.class.grade ?? "—"} • Turno: ${
                          payload.class.shift ?? "—"
                        }`
                      : "—"}
                  </div>
                  <div>
                    <span className="font-semibold">Escola:</span>{" "}
                    {payload?.school?.name ?? "—"}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={openPdf}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Baixar PDF
                </button>

                <button
                  onClick={() => router.push(`/parent/students/${studentId}/daily`)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver presença diária
                </button>

                <button
                  onClick={() => router.push(`/parent/students/${studentId}`)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Voltar
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
            <SummaryCard
              label="Média do período"
              value={payload?.summary?.average != null ? formatGrade(payload.summary.average) : "—"}
              help="Média calculada com base nas disciplinas lançadas neste período."
            />

            <SummaryCard
              label="Disciplinas"
              value={String(payload?.summary?.total_subjects ?? 0)}
              help="Quantidade de disciplinas com nota registrada."
            />

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Situação
              </div>
              <div className="mt-3">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${situationBadgeClass(
                    payload?.summary?.situation
                  )}`}
                >
                  {payload?.summary?.situation || "—"}
                </span>
              </div>
              <div className="mt-3 text-sm leading-6 text-slate-500">
                Resultado acadêmico atual para o período selecionado.
              </div>
            </div>

            <SummaryCard
              label="Maior nota"
              value={highestGrade != null ? formatGrade(highestGrade) : "—"}
              help="Melhor desempenho registrado entre as disciplinas do período."
            />
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Período
              </label>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Ex.: 1º Bimestre"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={loadReportCard}
                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Carregar boletim
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </section>

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-500">
            Carregando boletim...
          </section>
        ) : (
          <>
            <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4 md:px-6">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Notas do período
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Período atual: {term}
                </p>
              </div>

              {!payload?.grades || payload.grades.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  Nenhuma nota lançada para este período.
                </div>
              ) : (
                <>
                  <div className="hidden md:block">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr className="text-left">
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Disciplina
                          </th>
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Nota
                          </th>
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Atualização
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.grades.map((grade, index) => (
                          <tr
                            key={`${grade.subject}-${index}`}
                            className="border-t border-slate-200"
                          >
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">
                              {grade.subject || "—"}
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex rounded-2xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
                                {formatGrade(grade.score)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600">
                              {formatDateTimeBr(grade.updated_at || grade.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 p-4 md:hidden">
                    {payload.grades.map((grade, index) => (
                      <div
                        key={`${grade.subject}-${index}`}
                        className="rounded-2xl border border-slate-200 p-4"
                      >
                        <div className="text-sm font-semibold text-slate-900">
                          {grade.subject || "—"}
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-xs text-slate-500">Nota</div>
                          <span className="inline-flex rounded-2xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
                            {formatGrade(grade.score)}
                          </span>
                        </div>

                        <div className="mt-3 text-xs text-slate-500">
                          Atualização: {formatDateTimeBr(grade.updated_at || grade.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Última atualização
              </div>
              <div className="mt-2 text-sm text-slate-700">
                {formatDateTimeBr(lastUpdated)}
              </div>
            </section>
          </>
        )}

        <div className="text-xs text-slate-500">
          Dica: para voltar ao aluno,{" "}
          <Link href={`/parent/students/${studentId}`} className="underline">
            clique aqui
          </Link>
          .
        </div>
      </div>
    </main>
  );
}