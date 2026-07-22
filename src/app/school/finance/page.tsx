"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";

type ParentOption = {
  id: string;
  full_name: string;
  phone: string | null;
};

type StudentOption = {
  id: string;
  full_name: string;
  registration_number: string | null;
  parents: ParentOption[];
  default_parent_id: string | null;
};

type SchoolInvoice = {
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
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  student: {
    id: string;
    full_name: string;
    registration_number: string | null;
  } | null;
  parent: {
    id: string;
    full_name: string;
    phone: string | null;
  } | null;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

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

function normalizeMoneyInput(value: string) {
  return value.replace(/[^\d,.-]/g, "").replace(".", ",");
}

function statusLabel(status: InvoiceStatus) {
  if (status === "paid") return "Pago";
  if (status === "overdue") return "Vencido";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
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

export default function SchoolFinancePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [baseDate, setBaseDate] = useState(todayYMD());
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>("all");

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [invoices, setInvoices] = useState<SchoolInvoice[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [studentId, setStudentId] = useState("");
  const [parentId, setParentId] = useState("");
  const [title, setTitle] = useState("Mensalidade escolar");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayYMD());
  const [status, setStatus] = useState<InvoiceStatus>("pending");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const range = useMemo(() => {
    return {
      from: startOfMonth(baseDate),
      to: endOfMonth(baseDate),
    };
  }, [baseDate]);

  const selectedStudent = useMemo(() => {
    return students.find((student) => student.id === studentId) || null;
  }, [students, studentId]);

  const parentOptions = useMemo(() => {
    return selectedStudent?.parents || [];
  }, [selectedStudent]);

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
    const map = new Map<string, SchoolInvoice[]>();

    for (const invoice of invoices) {
      const key = invoice.due_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(invoice);
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [invoices]);

  useEffect(() => {
    if (!studentId) {
      setParentId("");
      return;
    }

    if (!editingId && selectedStudent?.default_parent_id) {
      setParentId(selectedStudent.default_parent_id);
    }
  }, [studentId, selectedStudent, editingId]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadFinance() {
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

      const res = await fetch(`/api/school/finance?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao carregar financeiro.");
        setInvoices([]);
        return;
      }

      setInvoices(Array.isArray(json.invoices) ? json.invoices : []);
      setStudents(Array.isArray(json.students) ? json.students : []);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar financeiro.");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFinance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, statusFilter]);

  function resetForm() {
    setEditingId(null);
    setStudentId("");
    setParentId("");
    setTitle("Mensalidade escolar");
    setDescription("");
    setAmount("");
    setDueDate(todayYMD());
    setStatus("pending");
    setPaymentMethod("");
    setNotes("");
  }

  function startEdit(invoice: SchoolInvoice) {
    setEditingId(invoice.id);
    setStudentId(invoice.student_id);
    setParentId(invoice.parent_id || "");
    setTitle(invoice.title || "Mensalidade escolar");
    setDescription(invoice.description || "");
    setAmount(String(invoice.amount || "").replace(".", ","));
    setDueDate(invoice.due_date);
    setStatus(invoice.status);
    setPaymentMethod(invoice.payment_method || "");
    setNotes(invoice.notes || "");
    setSuccess(null);
    setError(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveInvoice() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const safeTitle = cleanText(title) || "Mensalidade escolar";
      const safeAmount = cleanText(amount).replace(",", ".");

      if (!studentId) {
        setError("Selecione o aluno.");
        return;
      }

      if (!dueDate) {
        setError("Informe a data de vencimento.");
        return;
      }

      if (Number(safeAmount) <= 0 || Number.isNaN(Number(safeAmount))) {
        setError("Informe um valor maior que zero.");
        return;
      }

      const token = await getToken();
      if (!token) return;

      const method = editingId ? "PUT" : "POST";

      const res = await fetch("/api/school/finance", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          id: editingId,
          studentId,
          parentId: parentId || null,
          title: safeTitle,
          description: cleanText(description) || null,
          amount: safeAmount,
          dueDate,
          status,
          paymentMethod: cleanText(paymentMethod) || null,
          notes: cleanText(notes) || null,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao salvar mensalidade.");
        return;
      }

      setSuccess(editingId ? "Mensalidade atualizada com sucesso." : "Mensalidade criada com sucesso.");
      resetForm();
      await loadFinance();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao salvar mensalidade.");
    } finally {
      setSaving(false);
    }
  }

  async function removeInvoice(invoice: SchoolInvoice) {
    const ok = window.confirm(
      `Deseja excluir esta mensalidade?\n\n${invoice.title}\n${formatMoneyBR(invoice.amount)}`
    );

    if (!ok) return;

    setError(null);
    setSuccess(null);

    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`/api/school/finance?id=${encodeURIComponent(invoice.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao excluir mensalidade.");
        return;
      }

      setSuccess("Mensalidade excluída com sucesso.");
      await loadFinance();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao excluir mensalidade.");
    }
  }

  function goPreviousMonth() {
    setBaseDate(addMonths(baseDate, -1));
  }

  function goNextMonth() {
    setBaseDate(addMonths(baseDate, 1));
  }

  return (
    <main className="space-y-6">
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
                Cadastre cobranças manuais, acompanhe vencimentos e marque mensalidades como
                pagas, pendentes, vencidas ou canceladas.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadFinance}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Recarregar
              </button>

              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Voltar ao painel
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <StatCard
            label="Total lançado"
            value={formatMoneyBR(summary.totalAmount)}
            help={`${summary.total} mensalidade(s) no período.`}
            tone="blue"
          />

          <StatCard
            label="Recebido"
            value={formatMoneyBR(summary.paidAmount)}
            help={`${summary.paid} mensalidade(s) marcada(s) como pagas.`}
            tone="green"
          />

          <StatCard
            label="A receber"
            value={formatMoneyBR(summary.pendingAmount)}
            help={`${summary.pending + summary.overdue} mensalidade(s) pendentes/vencidas.`}
            tone="amber"
          />

          <StatCard
            label="Vencidas"
            value={summary.overdue}
            help="Itens marcados como vencidos."
            tone="red"
          />
        </div>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      {success ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {success}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {editingId ? "Editar mensalidade" : "Nova mensalidade"}
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Lance uma cobrança manual vinculada ao aluno e ao responsável financeiro.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Aluno
              </label>

              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                disabled={saving}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              >
                <option value="">Selecione um aluno</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name}
                    {student.registration_number ? ` • Mat. ${student.registration_number}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Responsável financeiro
              </label>

              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                disabled={saving || !studentId}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100 disabled:bg-slate-50"
              >
                <option value="">Sem responsável vinculado</option>
                {parentOptions.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.full_name}
                    {parent.phone ? ` • ${parent.phone}` : ""}
                  </option>
                ))}
              </select>

              {studentId && parentOptions.length === 0 ? (
                <p className="mt-2 text-xs leading-5 text-amber-700">
                  Este aluno não possui responsável ativo vinculado. A cobrança será criada para o
                  aluno, mas não aparecerá no portal dos pais até vincular um responsável.
                </p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Título
              </label>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                placeholder="Ex.: Mensalidade Maio/2026"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Valor
                </label>

                <input
                  value={amount}
                  onChange={(e) => setAmount(normalizeMoneyInput(e.target.value))}
                  disabled={saving}
                  placeholder="Ex.: 350,00"
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Vencimento
                </label>

                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={saving}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </label>

                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                  disabled={saving}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                >
                  <option value="pending">Pendente</option>
                  <option value="paid">Pago</option>
                  <option value="overdue">Vencido</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Forma de pagamento
                </label>

                <input
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  disabled={saving}
                  placeholder="Ex.: PIX, Dinheiro, Cartão"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Descrição
              </label>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
                placeholder="Ex.: Referente à mensalidade escolar do mês."
                className="min-h-[110px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Observações internas
              </label>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving}
                placeholder="Uso interno da secretaria/direção."
                className="min-h-[90px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={saveInvoice}
                disabled={saving}
                className="flex-1 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {saving
                  ? "Salvando..."
                  : editingId
                    ? "Salvar alterações"
                    : "Cadastrar mensalidade"}
              </button>

              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Filtro financeiro
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Navegue por mês e filtre os lançamentos por status.
              </p>
            </div>

            <button
              type="button"
              onClick={loadFinance}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Atualizar
            </button>
          </div>

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
              MVP financeiro
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600">
              Nesta fase, o financeiro é manual: a escola lança mensalidades e marca como
              pago, pendente, vencido ou cancelado. PIX automático e checkout ficam para uma
              próxima etapa.
            </p>
          </div>
        </section>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Lançamentos do período
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                Mensalidades agrupadas por vencimento.
              </p>
            </div>

            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
              {invoices.length} lançamento(s)
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6">
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Carregando financeiro...
            </div>
          ) : groupedInvoices.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <div className="text-4xl">💳</div>

              <h3 className="mt-4 text-lg font-semibold text-slate-900">
                Nenhuma mensalidade lançada
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Cadastre a primeira mensalidade para este período.
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
                                {invoice.status_label || statusLabel(invoice.status)}
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

                            <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-600 md:grid-cols-2">
                              <div className="rounded-2xl bg-white px-4 py-3">
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

                              <div className="rounded-2xl bg-white px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  Responsável
                                </div>
                                <div className="mt-1 font-semibold text-slate-800">
                                  {invoice.parent?.full_name || "Não vinculado"}
                                </div>
                                {invoice.parent?.phone ? (
                                  <div className="mt-1 text-xs text-slate-500">
                                    {invoice.parent.phone}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {invoice.description ? (
                              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                                {invoice.description}
                              </p>
                            ) : null}

                            {invoice.notes ? (
                              <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-500">
                                <strong>Observação interna:</strong> {invoice.notes}
                              </div>
                            ) : null}

                            {invoice.paid_at ? (
                              <div className="mt-3 text-xs font-semibold text-emerald-700">
                                Pago em {formatDateTimeBR(invoice.paid_at)}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(invoice)}
                              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                              Editar
                            </button>

                            <button
                              type="button"
                              onClick={() => removeInvoice(invoice)}
                              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                            >
                              Excluir
                            </button>
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
    </main>
  );
}