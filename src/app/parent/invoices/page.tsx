"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type InvoiceRow = {
  id: string;
  student_id: string;
  amount_cents: number;
  due_date: string;
  status: string;
  description: string | null;
  created_at: string;
};

type StudentRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
};

function formatMoneyBRLFromCents(cents: number) {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBR(date: string) {
  if (!date) return "—";

  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;

  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function formatDateTimeBR(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string) {
  const s = String(status || "").toLowerCase().trim();

  if (s === "paid" || s === "pago" || s === "paid_out") return "Pago";
  if (s === "pending" || s === "pendente") return "Pendente";
  if (s === "open" || s === "aberto") return "Em aberto";
  if (s === "overdue" || s === "vencido") return "Vencido";

  return status || "—";
}

function statusBadgeClass(status: string) {
  const s = String(status || "").toLowerCase().trim();

  if (s === "paid" || s === "pago" || s === "paid_out") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (s === "pending" || s === "pendente") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (s === "overdue" || s === "vencido") {
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

function InvoiceTag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "highlight";
}) {
  return (
    <span
      className={[
        "inline-flex rounded-full px-3 py-1 text-xs font-medium",
        variant === "highlight"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-600",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function ParentInvoicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [meOk, setMeOk] = useState(false);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filterStudentId, setFilterStudentId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) map.set(s.id, s.full_name);
    return map;
  }, [students]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (filterStudentId !== "all" && inv.student_id !== filterStudentId) return false;
      if (filterStatus !== "all" && (inv.status || "").toLowerCase() !== filterStatus) return false;
      return true;
    });
  }, [invoices, filterStudentId, filterStatus]);

  const summary = useMemo(() => {
    let total = 0;
    let open = 0;
    let paid = 0;

    for (const i of filteredInvoices) {
      total += i.amount_cents || 0;
      const st = (i.status || "").toLowerCase();

      if (st === "paid" || st === "pago" || st === "paid_out") {
        paid += i.amount_cents || 0;
      } else {
        open += i.amount_cents || 0;
      }
    }

    return { total, open, paid };
  }, [filteredInvoices]);

  const nextDueInvoice = useMemo(() => {
    const upcoming = [...filteredInvoices]
      .filter((inv) => !!inv.due_date)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    return upcoming[0] || null;
  }, [filteredInvoices]);

  async function loadInvoices() {
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

      const me = await meRes.json();

      if (!meRes.ok || !me?.ok || !me?.parent?.parentId) {
        router.replace(me?.redirectTo || "/login");
        return;
      }

      setMeOk(true);

      const { data: stData, error: stErr } = await supabase
        .from("students")
        .select("id, full_name, registration_number")
        .order("full_name", { ascending: true });

      if (stErr) {
        setError("Erro ao carregar filhos: " + stErr.message);
        return;
      }

      setStudents((stData ?? []) as StudentRow[]);

      const { data: invData, error: invErr } = await supabase
        .from("invoices")
        .select("id, student_id, amount_cents, due_date, status, description, created_at")
        .order("due_date", { ascending: true });

      if (invErr) {
        setError("Erro ao carregar mensalidades: " + invErr.message);
        return;
      }

      setInvoices((invData ?? []) as InvoiceRow[]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-48 rounded-[32px] bg-slate-200" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-32 rounded-[28px] bg-slate-100" />
              <div className="h-32 rounded-[28px] bg-slate-100" />
              <div className="h-32 rounded-[28px] bg-slate-100" />
            </div>
            <div className="h-28 rounded-[28px] bg-slate-100" />
            <div className="h-96 rounded-[28px] bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          <div className="rounded-[32px] border border-red-200 bg-white p-6 shadow-sm">
            <div className="text-red-700 font-medium">Erro</div>
            <div className="mt-2 text-sm text-red-600">{error}</div>
          </div>
        </div>
      </main>
    );
  }

  if (!meOk) return null;

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Financeiro escolar
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Mensalidades
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Consulte valores, vencimentos e situação financeira dos seus filhos
                  em uma visão mais organizada e profissional.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadInvoices}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Recarregar
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent/messages")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver comunicados
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/parent")}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Voltar ao portal
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <SummaryCard
              label="Total"
              value={formatMoneyBRLFromCents(summary.total)}
              help="Soma de todas as faturas filtradas na tela."
            />

            <SummaryCard
              label="Em aberto"
              value={formatMoneyBRLFromCents(summary.open)}
              help="Valor ainda pendente ou não quitado."
            />

            <SummaryCard
              label="Pago"
              value={formatMoneyBRLFromCents(summary.paid)}
              help="Valor já pago dentro do filtro atual."
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Filtros financeiros
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Refine a visualização por filho e por status da fatura.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:w-[520px]">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Filho
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    value={filterStudentId}
                    onChange={(e) => setFilterStudentId(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Status
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="aberto">Aberto</option>
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Destaque financeiro
            </div>

            {nextDueInvoice ? (
              <div className="mt-3">
                <div className="text-lg font-semibold text-slate-900">
                  Próximo vencimento
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <InvoiceTag variant="highlight">
                    {formatDateBR(nextDueInvoice.due_date)}
                  </InvoiceTag>
                  <InvoiceTag>
                    {studentNameById.get(nextDueInvoice.student_id) || nextDueInvoice.student_id}
                  </InvoiceTag>
                  <InvoiceTag>{statusLabel(nextDueInvoice.status)}</InvoiceTag>
                </div>

                <div className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
                  {formatMoneyBRLFromCents(nextDueInvoice.amount_cents)}
                </div>

                <div className="mt-2 text-sm leading-6 text-slate-600">
                  {nextDueInvoice.description || "Sem descrição adicional para esta fatura."}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-slate-500">
                Nenhuma fatura identificada no filtro atual.
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Faturas
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Visualização das mensalidades do responsável.
            </p>
          </div>

          <div className="p-4 md:p-6">
            {filteredInvoices.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Nenhuma mensalidade encontrada.
              </div>
            ) : (
              <>
                <div className="hidden xl:block overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr className="text-left">
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Vencimento
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Filho
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Descrição
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Status
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Valor
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Criada em
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-slate-200">
                          <td className="px-5 py-4 text-sm text-slate-700">
                            {formatDateBR(inv.due_date)}
                          </td>
                          <td className="px-5 py-4 text-sm font-medium text-slate-900">
                            {studentNameById.get(inv.student_id) || inv.student_id}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">
                            {inv.description ?? "—"}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(
                                inv.status
                              )}`}
                            >
                              {statusLabel(inv.status)}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                            {formatMoneyBRLFromCents(inv.amount_cents)}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatDateTimeBR(inv.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-4 xl:hidden">
                  {filteredInvoices.map((inv) => (
                    <article
                      key={inv.id}
                      className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="text-base font-semibold text-slate-900">
                            {studentNameById.get(inv.student_id) || inv.student_id}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <InvoiceTag variant="highlight">
                              Vencimento: {formatDateBR(inv.due_date)}
                            </InvoiceTag>

                            <InvoiceTag>{statusLabel(inv.status)}</InvoiceTag>
                          </div>
                        </div>

                        <div className="text-xl font-semibold tracking-tight text-slate-900">
                          {formatMoneyBRLFromCents(inv.amount_cents)}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Descrição
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-700">
                            {inv.description ?? "—"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Criada em
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-700">
                            {formatDateTimeBR(inv.created_at)}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}