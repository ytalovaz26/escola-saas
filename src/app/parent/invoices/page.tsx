"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";

type ParentInvoice = {
  id: string;
  school_id: string;
  student_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  amount: number;
  due_date: string;
  paid_at: string | null;
  status: InvoiceStatus;
  status_label: string;
  payment_method: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  student: {
    id: string;
    full_name: string;
    registration_number: string | null;
  } | null;
};

type ChildRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
  relationship: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateToYMD(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayYMD() {
  return dateToYMD(new Date());
}

function startOfMonth(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  return dateToYMD(new Date(y, m - 1, 1));
}

function endOfMonth(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  return dateToYMD(new Date(y, m, 0));
}

function addMonths(dateYmd: string, months: number) {
  const [y, m] = dateYmd.split("-").map(Number);
  return dateToYMD(new Date(y, m - 1 + months, 1));
}

function formatDateBR(value?: string | null) {
  if (!value) return "—";

  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;

  return `${pad2(d)}/${pad2(m)}/${y}`;
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoneyBR(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function statusBadgeClass(status: InvoiceStatus) {
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "overdue") return "border-red-200 bg-red-50 text-red-700";
  if (status === "cancelled") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
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
  tone = "default",
}: {
  label: string;
  value: string | number;
  help: string;
  tone?: "default" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "red"
          ? "border-red-200 bg-red-50"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50"
            : "border-slate-200 bg-white";

  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>

      <div className="mt-3 break-words text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-600">{help}</div>
    </div>
  );
}

export default function ParentInvoicesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [baseDate, setBaseDate] = useState(todayYMD());
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>("all");

  const [children, setChildren] = useState<ChildRow[]>([]);
  const [invoices, setInvoices] = useState<ParentInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    return {
      from: startOfMonth(baseDate),
      to: endOfMonth(baseDate),
    };
  }, [baseDate]);

  const summary = useMemo(() => {
    const totalAmount = invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    const paidAmount = invoices
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    const pendingAmount = invoices
      .filter((invoice) => invoice.status === "pending" || invoice.status === "overdue")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    return {
      total: invoices.length,
      pending: invoices.filter((invoice) => invoice.status === "pending").length,
      paid: invoices.filter((invoice) => invoice.status === "paid").length,
      overdue: invoices.filter((invoice) => invoice.status === "overdue").length,
      cancelled: invoices.filter((invoice) => invoice.status === "cancelled").length,
      totalAmount,
      paidAmount,
      pendingAmount,
    };
  }, [invoices]);

  const groupedInvoices = useMemo(() => {
    const map = new Map<string, ParentInvoice[]>();

    for (const invoice of invoices) {
      const key = invoice.due_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(invoice);
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [invoices]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadInvoices() {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        status: statusFilter,
      });

      const res = await fetch(`/api/parent/invoices?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao carregar mensalidades.");
        setInvoices([]);
        return;
      }

      setChildren(Array.isArray(json.children) ? json.children : []);
      setInvoices(Array.isArray(json.invoices) ? json.invoices : []);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar mensalidades.");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, statusFilter]);

  function goPreviousMonth() {
    setBaseDate(addMonths(baseDate, -1));
  }

  function goNextMonth() {
    setBaseDate(addMonths(baseDate, 1));
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden bg-slate-950 px-6 py-10 text-white md:px-8 md:py-12">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="absolute -bottom-24 left-20 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                Financeiro escolar
              </div>

              <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                Mensalidades
              </h1>

              <p className="mt-4 text-base leading-8 text-slate-200">
                Consulte as mensalidades vinculadas aos alunos sob sua responsabilidade.
              </p>

              <div className="mt-5 flex flex-wrap gap-2 text-sm text-slate-200">
                <span className="rounded-full bg-white/10 px-3 py-1">
                  Filhos vinculados: <strong>{children.length}</strong>
                </span>

                <span className="rounded-full bg-white/10 px-3 py-1">
                  Período: <strong>{formatDateBR(range.from)} até {formatDateBR(range.to)}</strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadInvoices}
                className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
              >
                Atualizar mensalidades
              </button>

              <button
                type="button"
                onClick={() => router.push("/parent")}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
              >
                Voltar ao portal
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <StatCard
            label="Total"
            value={formatMoneyBR(summary.totalAmount)}
            help={`${summary.total} mensalidade(s) no período.`}
            tone="blue"
          />

          <StatCard
            label="Pago"
            value={formatMoneyBR(summary.paidAmount)}
            help={`${summary.paid} mensalidade(s) quitada(s).`}
            tone="green"
          />

          <StatCard
            label="A pagar"
            value={formatMoneyBR(summary.pendingAmount)}
            help={`${summary.pending + summary.overdue} pendente(s)/vencida(s).`}
            tone="amber"
          />

          <StatCard
            label="Vencidas"
            value={summary.overdue}
            help="Mensalidades marcadas como vencidas."
            tone="red"
          />
        </div>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Filtro de mensalidades
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Navegue por mês e filtre por situação de pagamento.
          </p>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Período
            </div>

            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatDateBR(range.from)} até {formatDateBR(range.to)}
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Mês base
              </label>

              <input
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goPreviousMonth}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Mês anterior
              </button>

              <button
                type="button"
                onClick={() => setBaseDate(todayYMD())}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Hoje
              </button>

              <button
                type="button"
                onClick={goNextMonth}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Próximo mês
              </button>
            </div>
          </div>

          <div className="mt-6">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Status
            </label>

            <div className="flex flex-wrap gap-2">
              {[
                ["all", "Todos"],
                ["pending", "Pendentes"],
                ["paid", "Pagos"],
                ["overdue", "Vencidos"],
                ["cancelled", "Cancelados"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value as any)}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-semibold transition",
                    statusFilter === value
                      ? "bg-slate-950 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Observação
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600">
              Esta área é apenas para consulta. Para negociação, baixa manual ou correção de
              valores, entre em contato com a secretaria da escola.
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Lançamentos
                </h2>

                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Mensalidades agrupadas por vencimento.
                </p>
              </div>

              <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                {invoices.length} item(ns)
              </div>
            </div>
          </div>

          <div className="p-4 md:p-6">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                Carregando mensalidades...
              </div>
            ) : groupedInvoices.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="text-4xl">💳</div>

                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  Nenhuma mensalidade encontrada
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Não há lançamentos financeiros para este período e filtro.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {groupedInvoices.map(([date, items]) => (
                  <section
                    key={date}
                    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Vencimento
                        </div>

                        <h3 className="mt-1 text-lg font-semibold text-slate-900">
                          {formatDateBR(date)}
                        </h3>
                      </div>

                      <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                        {items.length} item(ns)
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4">
                      {items.map((invoice) => (
                        <article
                          key={invoice.id}
                          className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap gap-2">
                                <span
                                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(
                                    invoice.status
                                  )}`}
                                >
                                  {invoice.status_label}
                                </span>

                                <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                  {formatMoneyBR(invoice.amount)}
                                </span>

                                {invoice.payment_method ? (
                                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                    {invoice.payment_method}
                                  </span>
                                ) : null}
                              </div>

                              <h4 className="mt-3 break-words text-base font-semibold text-slate-900">
                                {invoice.title}
                              </h4>

                              <div className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  Aluno
                                </div>

                                <div className="mt-1 font-semibold text-slate-800">
                                  {invoice.student?.full_name || "Aluno não informado"}
                                </div>

                                {invoice.student?.registration_number ? (
                                  <div className="mt-1 text-xs text-slate-500">
                                    Matrícula: {invoice.student.registration_number}
                                  </div>
                                ) : null}
                              </div>

                              {invoice.description ? (
                                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                                  {invoice.description}
                                </p>
                              ) : null}

                              {invoice.paid_at ? (
                                <div className="mt-3 text-xs font-semibold text-emerald-700">
                                  Pago em {formatDateTimeBR(invoice.paid_at)}
                                </div>
                              ) : null}
                            </div>

                            <div className="shrink-0 rounded-3xl bg-slate-950 px-5 py-4 text-center text-white">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                                Valor
                              </div>
                              <div className="mt-2 text-xl font-bold">
                                {formatMoneyBR(invoice.amount)}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}