"use client";

// Matrícula digital (secretaria/direção): análise dos documentos enviados pelos responsáveis.
// Toda leitura e decisão passa pelas APIs /api/school/enrollment-documents (requireStaff no servidor).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Doc = {
  id: string;
  studentName: string;
  parentName: string | null;
  docLabel: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
};
type StudentPending = { id: string; fullName: string; registrationNumber: string | null; missingRequired: string[]; awaitingReview: number };
type Payload = { documents: Doc[]; students: StudentPending[]; counts: { pending: number; studentsWithPendencies: number } };

const TABS = [
  { key: "pending", label: "Pendentes" },
  { key: "approved", label: "Aprovados" },
  { key: "rejected", label: "Rejeitados" },
  { key: "all", label: "Todos" },
] as const;

const BADGE: Record<Doc["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};
const STATUS_TEXT: Record<Doc["status"], string> = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado" };

async function authedFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers, cache: "no-store" });
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function SchoolDocumentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/school/enrollment-documents?status=${tab}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Não foi possível carregar os documentos.");
        return;
      }
      setData(json as Payload);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function view(id: string) {
    setBusy(id);
    try {
      const res = await authedFetch(`/api/school/enrollment-documents/${id}/url`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.url) {
        setNotice({ ok: false, text: json?.error || "Não foi possível abrir o documento." });
        return;
      }
      window.open(json.url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  }

  async function review(id: string, decision: "approve" | "reject") {
    if (decision === "reject" && reason.trim().length < 5) {
      setNotice({ ok: false, text: "Informe o motivo da rejeição (mínimo de 5 caracteres)." });
      return;
    }
    setBusy(id);
    try {
      const res = await authedFetch(`/api/school/enrollment-documents/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: decision === "reject" ? reason.trim() : undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setNotice({ ok: false, text: json?.error || "Não foi possível registrar a análise." });
        return;
      }
      setNotice({ ok: true, text: decision === "approve" ? "Documento aprovado." : "Documento rejeitado; o responsável poderá reenviar." });
      setRejecting(null);
      setReason("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h1 className="text-xl font-semibold text-slate-900 md:text-2xl">Documentos de matrícula</h1>
        <p className="mt-1 text-sm text-slate-600">Analise os documentos enviados pelos responsáveis. Arquivos abrem por link temporário.</p>
        {data ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">{data.counts.pending} aguardando análise</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{data.counts.studentsWithPendencies} aluno(s) com documento obrigatório faltando</span>
          </div>
        ) : null}
      </section>

      {notice ? (
        <div className={`rounded-2xl p-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === t.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 animate-pulse rounded-3xl bg-white" />
      ) : error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{error}</div>
      ) : (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm md:p-4">
            {data && data.documents.length === 0 ? (
              <p className="p-4 text-sm text-slate-600">Nenhum documento nesta situação.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data?.documents.map((d) => (
                  <li key={d.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{d.docLabel} — {d.studentName}</p>
                      <p className="truncate text-xs text-slate-500">
                        {d.parentName ? `Enviado por ${d.parentName} · ` : ""}{new Date(d.uploadedAt).toLocaleString("pt-BR")} · {formatSize(d.sizeBytes)}
                      </p>
                      {d.status === "rejected" && d.rejectionReason ? <p className="mt-1 text-xs text-rose-700">Motivo: {d.rejectionReason}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE[d.status]}`}>{STATUS_TEXT[d.status]}</span>
                      <button type="button" disabled={busy === d.id} onClick={() => view(d.id)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-60">
                        Visualizar
                      </button>
                      {d.status === "pending" ? (
                        <>
                          <button type="button" disabled={busy === d.id} onClick={() => review(d.id, "approve")} className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                            Aprovar
                          </button>
                          <button type="button" disabled={busy === d.id} onClick={() => { setRejecting(rejecting === d.id ? null : d.id); setReason(""); }} className="rounded-xl bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                            Rejeitar
                          </button>
                        </>
                      ) : null}
                    </div>
                    {rejecting === d.id ? (
                      <div className="w-full md:basis-full">
                        <textarea
                          className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm"
                          placeholder="Motivo da rejeição (o responsável verá este texto)"
                          maxLength={1000}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button type="button" disabled={busy === d.id} onClick={() => review(d.id, "reject")} className="mt-2 rounded-xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
                          Confirmar rejeição
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-base font-semibold text-slate-900">Alunos com documentos obrigatórios faltando</h2>
            {data && data.students.filter((s) => s.missingRequired.length).length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Nenhum aluno com pendência.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {data?.students
                  .filter((s) => s.missingRequired.length)
                  .map((s) => (
                    <li key={s.id} className="py-2 text-sm">
                      <span className="font-medium text-slate-900">{s.fullName}</span>
                      {s.registrationNumber ? <span className="text-slate-500"> · {s.registrationNumber}</span> : null}
                      <span className="block text-xs text-amber-800">Falta: {s.missingRequired.join(", ")}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
