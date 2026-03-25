"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type InvoiceRow = {
  id: string;
  student_id: string;
  amount_cents: number;
  due_date: string; // date
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
      if (st === "paid" || st === "pago" || st === "paid_out") paid += i.amount_cents || 0;
      else open += i.amount_cents || 0;
    }
    return { total, open, paid };
  }, [filteredInvoices]);

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const me = await meRes.json();

        if (!meRes.ok || !me?.ok || !me?.parent?.parentId) {
          router.replace(me?.redirectTo || "/login");
          return;
        }

        setMeOk(true);

        // Buscar filhos (RLS garante que só venha os filhos)
        const { data: stData, error: stErr } = await supabase
          .from("students")
          .select("id, full_name, registration_number")
          .order("full_name", { ascending: true });

        if (stErr) {
          setError("Erro ao carregar filhos: " + stErr.message);
          return;
        }
        setStudents((stData ?? []) as StudentRow[]);

        // Buscar invoices (RLS garante que só venha invoices dos filhos)
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
    })();
  }, [router]);

  if (loading) return <div>Carregando...</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!meOk) return null;

  return (
    <section className="bg-white rounded-2xl shadow p-5">
      <h1 className="text-xl font-semibold">Mensalidades</h1>
      <p className="text-sm text-gray-600 mt-1">Você vê somente as faturas dos seus filhos (RLS).</p>

      {/* filtros */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-gray-600 mb-1">Filho</div>
          <select
            className="border rounded-xl p-3 w-full"
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
          <div className="text-xs text-gray-600 mb-1">Status</div>
          <select
            className="border rounded-xl p-3 w-full"
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

        <div className="border rounded-2xl p-4 bg-gray-50">
          <div className="text-xs text-gray-600">Resumo (filtro atual)</div>
          <div className="mt-1 text-sm">
            <div>Total: <b>{formatMoneyBRLFromCents(summary.total)}</b></div>
            <div>Em aberto: <b>{formatMoneyBRLFromCents(summary.open)}</b></div>
            <div>Pago: <b>{formatMoneyBRLFromCents(summary.paid)}</b></div>
          </div>
        </div>
      </div>

      {/* tabela */}
      {filteredInvoices.length === 0 ? (
        <p className="text-sm text-gray-600 mt-4">Nenhuma mensalidade encontrada.</p>
      ) : (
        <div className="mt-5 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Vencimento</th>
                <th className="py-2">Filho</th>
                <th className="py-2">Descrição</th>
                <th className="py-2">Status</th>
                <th className="py-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="border-b">
                  <td className="py-2">{inv.due_date}</td>
                  <td className="py-2">{studentNameById.get(inv.student_id) || inv.student_id}</td>
                  <td className="py-2">{inv.description ?? "—"}</td>
                  <td className="py-2">{inv.status}</td>
                  <td className="py-2 font-medium">{formatMoneyBRLFromCents(inv.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
