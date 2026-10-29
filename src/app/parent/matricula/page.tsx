"use client";

// Matrícula digital (responsável): dados do aluno e envio de documentos.
// Toda leitura/gravação passa pelas APIs do servidor (/api/parent/enrollment/*).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type FieldDef = { key: string; label: string; mode: "always" | "fill_if_empty"; max: number; kind: string | null };
type DocItem = {
  docType: string;
  label: string;
  required: boolean;
  status: "missing" | "pending" | "approved" | "rejected";
  documentId: string | null;
  rejectionReason: string | null;
  hint: string;
};
type Child = {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  fields: Record<string, string | null>;
  locked: Record<string, boolean>;
  pendingFields: string[];
  documents: DocItem[];
  progress: { complete: boolean; pendingCount: number; docsApproved: number; docsRequired: number };
};
type EnrollmentData = {
  parentPending: string[];
  children: Child[];
  documentsAvailable: boolean;
  summary: { pendingCount: number; complete: boolean };
  fieldDefinitions: FieldDef[];
};

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

const STATUS_STYLE: Record<DocItem["status"], { text: string; cls: string }> = {
  missing: { text: "Não enviado", cls: "bg-slate-100 text-slate-700" },
  pending: { text: "Em análise", cls: "bg-amber-100 text-amber-800" },
  approved: { text: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { text: "Rejeitado", cls: "bg-rose-100 text-rose-800" },
};

async function authedFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, cache: "no-store" });
}

async function readJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `Erro ${res.status}` }));
}

function inputType(kind: string | null) {
  if (kind === "date") return "date";
  if (kind === "phone") return "tel";
  return "text";
}

function ChildCard({ child, defs, documentsAvailable, onChanged }: {
  child: Child;
  defs: FieldDef[];
  documentsAvailable: boolean;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(defs.map((d) => [d.key, child.fields[d.key] ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [docMsg, setDocMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const editable = defs.filter((d) => !child.locked[d.key]);
  const locked = defs.filter((d) => child.locked[d.key]);

  async function saveFields() {
    setSaving(true);
    setSaveMsg(null);
    setFieldErrors({});
    try {
      const payload = Object.fromEntries(editable.map((d) => [d.key, form[d.key] ?? ""]));
      const res = await authedFetch(`/api/parent/enrollment/students/${child.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await readJson(res);
      if (!res.ok || !json.ok) {
        setFieldErrors(json.details || {});
        setSaveMsg({ ok: false, text: json.error || "Não foi possível salvar." });
        return;
      }
      setSaveMsg({ ok: true, text: "Dados salvos." });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function upload(doc: DocItem, file: File | null) {
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) {
      setDocMsg((m) => ({ ...m, [doc.docType]: { ok: false, text: "Envie PDF, JPG ou PNG." } }));
      return;
    }
    if (file.size > MAX_BYTES) {
      setDocMsg((m) => ({ ...m, [doc.docType]: { ok: false, text: "O arquivo ultrapassa 10 MB." } }));
      return;
    }
    setUploading(doc.docType);
    setDocMsg((m) => ({ ...m, [doc.docType]: { ok: true, text: "Enviando..." } }));
    try {
      const body = new FormData();
      body.append("studentId", child.id);
      body.append("docType", doc.docType);
      body.append("file", file);
      const res = await authedFetch("/api/parent/enrollment/documents", { method: "POST", body });
      const json = await readJson(res);
      if (!res.ok || !json.ok) {
        setDocMsg((m) => ({ ...m, [doc.docType]: { ok: false, text: json.error || "Falha no envio." } }));
        return;
      }
      setDocMsg((m) => ({ ...m, [doc.docType]: { ok: true, text: "Documento enviado. Aguarde a análise da escola." } }));
      await onChanged();
    } finally {
      setUploading(null);
    }
  }

  async function view(documentId: string, docType: string) {
    const res = await authedFetch(`/api/parent/enrollment/documents/${documentId}`);
    const json = await readJson(res);
    if (!res.ok || !json.ok || !json.url) {
      setDocMsg((m) => ({ ...m, [docType]: { ok: false, text: json.error || "Não foi possível abrir o documento." } }));
      return;
    }
    window.open(json.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{child.fullName}</h2>
          {child.registrationNumber ? <p className="text-xs text-slate-500">Matrícula {child.registrationNumber}</p> : null}
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${child.progress.complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {child.progress.complete ? "Matrícula completa" : `${child.progress.pendingCount} pendência(s)`}
        </span>
      </header>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-800">Dados do aluno</h3>
        {child.pendingFields.length ? (
          <p className="mt-1 text-xs text-amber-700">Faltam: {child.pendingFields.join(", ")}.</p>
        ) : null}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {editable.map((d) => (
            <label key={d.key} className="flex flex-col gap-1 text-sm">
              <span className="text-slate-700">{d.label}</span>
              {d.max > 200 ? (
                <textarea
                  className="min-h-[72px] rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  maxLength={d.max}
                  value={form[d.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [d.key]: e.target.value }))}
                />
              ) : d.kind === "gender" ? (
                <select
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  value={form[d.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [d.key]: e.target.value }))}
                >
                  <option value="">Selecione</option>
                  <option value="feminino">Feminino</option>
                  <option value="masculino">Masculino</option>
                  <option value="outro">Outro</option>
                </select>
              ) : (
                <input
                  type={inputType(d.kind)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  maxLength={d.max}
                  value={form[d.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [d.key]: e.target.value }))}
                />
              )}
              {fieldErrors[d.key] ? <span className="text-xs text-rose-700">{fieldErrors[d.key]}</span> : null}
            </label>
          ))}
        </div>
        {locked.length ? (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Informados pela escola (alteração pela secretaria):</p>
            <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {locked.map((d) => (
                <li key={d.key}>
                  {d.label}: <span className="text-slate-900">{child.fields[d.key]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={saveFields}
            disabled={saving}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar dados do aluno"}
          </button>
          {saveMsg ? <span className={`text-sm ${saveMsg.ok ? "text-emerald-700" : "text-rose-700"}`}>{saveMsg.text}</span> : null}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-800">Documentos</h3>
        {!documentsAvailable ? (
          <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
            O envio de documentos ainda não foi liberado pela escola.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {child.documents.map((doc) => {
              const st = STATUS_STYLE[doc.status];
              const canUpload = doc.status !== "approved";
              const msg = docMsg[doc.docType];
              return (
                <li key={doc.docType} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {doc.label}
                        {doc.required ? "" : " (quando solicitado)"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{doc.hint}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.text}</span>
                  </div>
                  {doc.status === "rejected" && doc.rejectionReason ? (
                    <p className="mt-2 rounded-xl bg-rose-50 p-2 text-xs text-rose-800">Motivo: {doc.rejectionReason}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canUpload ? (
                      <label className={`cursor-pointer rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                        {uploading === doc.docType ? "Enviando..." : doc.status === "missing" ? "Enviar arquivo" : "Enviar novamente"}
                        <input
                          type="file"
                          accept={ACCEPT}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            e.target.value = "";
                            void upload(doc, f);
                          }}
                        />
                      </label>
                    ) : null}
                    {doc.documentId ? (
                      <button type="button" onClick={() => view(doc.documentId!, doc.docType)} className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 underline">
                        Visualizar
                      </button>
                    ) : null}
                  </div>
                  {msg ? <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">PDF, JPG ou PNG, até 10 MB. Os arquivos ficam em área privada da escola.</p>
      </div>
    </section>
  );
}

export default function ParentEnrollmentPage() {
  const [data, setData] = useState<EnrollmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await authedFetch("/api/parent/enrollment");
    const json = await readJson(res);
    if (!res.ok || !json.ok) {
      setError(json.error || "Não foi possível carregar a matrícula.");
      return;
    }
    setData(json as EnrollmentData);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const defs = useMemo(() => data?.fieldDefinitions || [], [data]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-3xl bg-white" />
        <div className="h-64 animate-pulse rounded-3xl bg-white" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        <p>{error || "Não foi possível carregar a matrícula."}</p>
        <button type="button" onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }} className="mt-3 rounded-xl bg-rose-700 px-4 py-2 text-white">
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-white p-5 shadow-sm md:p-6">
        <h1 className="text-xl font-semibold text-slate-900 md:text-2xl">Matrícula digital</h1>
        <p className="mt-1 text-sm text-slate-600">
          Complete os dados e envie os documentos. Você pode continuar depois: o que já foi salvo fica guardado.
        </p>
        <p className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${data.summary.complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {data.summary.complete ? "Tudo certo" : `${data.summary.pendingCount} pendência(s) no total`}
        </p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Seus dados (responsável)</h2>
        {data.parentPending.length ? (
          <p className="mt-1 text-sm text-amber-700">Faltam: {data.parentPending.join(", ")}.</p>
        ) : (
          <p className="mt-1 text-sm text-emerald-700">Cadastro do responsável completo.</p>
        )}
        <Link href="/parent/complete-profile" className="mt-3 inline-block rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800">
          {data.parentPending.length ? "Completar meus dados" : "Revisar meus dados"}
        </Link>
      </section>

      {data.children.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-600">Nenhum aluno vinculado ao seu cadastro. Procure a secretaria da escola.</p>
      ) : (
        data.children.map((c) => (
          <ChildCard key={c.id} child={c} defs={defs} documentsAvailable={data.documentsAvailable} onChanged={load} />
        ))
      )}
    </div>
  );
}
