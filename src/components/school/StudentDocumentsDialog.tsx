"use client";

// Documentos de matrícula de UM aluno (direção, coordenação, secretaria).
// Usa as APIs da matrícula digital: lista (GET /api/school/students/[id]/documents),
// link temporário (GET /api/school/enrollment-documents/[id]/url) e análise
// (POST /api/school/enrollment-documents/[id]/review). Nenhuma URL permanente.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Version = {
  id: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sentBy: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  isCurrent: boolean;
  canReview: boolean;
};

type Group = {
  docType: string;
  label: string;
  required: boolean;
  status: Version["status"] | "missing";
  versions: Version[];
};

const STATUS_LABEL: Record<Group["status"], string> = {
  pending: "Aguardando análise",
  approved: "Aprovado",
  rejected: "Rejeitado",
  superseded: "Substituído",
  missing: "Não enviado",
};

const STATUS_CLASS: Record<Group["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
  superseded: "border-slate-200 bg-slate-50 text-slate-500",
  missing: "border-slate-200 bg-white text-slate-500",
};

function brDateTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function sizeLabel(bytes: number | null) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return { Authorization: `Bearer ${token}` };
}

export default function StudentDocumentsDialog(props: {
  studentId: string;
  studentName: string;
  onClose: () => void;
}) {
  const { studentId, studentName, onClose } = props;
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/school/students/${studentId}/documents`, {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Não foi possível carregar os documentos.");
      setGroups(json.groups as Group[]);
    } catch (e: any) {
      setError(e?.message || "Não foi possível carregar os documentos.");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function openFile(version: Version, download: boolean) {
    // Abre a aba antes da chamada (bloqueadores de pop-up) e só então define o endereço temporário.
    const tab = window.open("", "_blank");
    setBusyId(version.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/school/enrollment-documents/${version.id}/url${download ? "?download=1" : ""}`,
        { headers: await authHeaders(), cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json.url) throw new Error(json?.error || "Não foi possível gerar o link.");
      if (tab) {
        tab.opener = null;
        tab.location.href = json.url;
      } else {
        window.location.assign(json.url);
      }
    } catch (e: any) {
      tab?.close();
      setError(e?.message || "Não foi possível abrir o documento.");
    } finally {
      setBusyId(null);
    }
  }

  async function review(versionId: string, decision: "approve" | "reject", reason?: string) {
    setBusyId(versionId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/school/enrollment-documents/${versionId}/review`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Não foi possível registrar a análise.");
      setMessage(decision === "approve" ? "Documento aprovado." : "Documento rejeitado. O responsável verá o motivo.");
      setRejecting(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Não foi possível registrar a análise.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Documentos de ${studentName}`}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Documentos de matrícula</div>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">{studentName}</h2>
            <p className="mt-1 text-xs text-slate-500">Links de visualização e download valem por 5 minutos.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}
          {message ? (
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
          ) : null}

          {loading && !groups ? <div className="text-sm text-slate-500">Carregando documentos...</div> : null}

          {(groups || []).map((g) => (
            <section key={g.docType} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-900">
                  {g.label}
                  {g.required ? null : <span className="ml-2 text-xs font-normal text-slate-500">(opcional)</span>}
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASS[g.status]}`}>
                  {STATUS_LABEL[g.status]}
                </span>
              </div>

              {g.versions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Nenhum arquivo enviado.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {g.versions.map((v) => (
                    <li
                      key={v.id}
                      className={`rounded-xl border p-3 text-sm ${v.isCurrent ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{v.filename}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Enviado por {v.sentBy} em {brDateTime(v.uploadedAt)}
                            {v.sizeBytes ? ` · ${sizeLabel(v.sizeBytes)}` : ""}
                            {v.isCurrent ? "" : ` · ${STATUS_LABEL[v.status]} (histórico)`}
                          </div>
                          {v.status === "rejected" || (v.status === "superseded" && v.rejectionReason) ? (
                            <div className="mt-1 text-xs text-red-700">Motivo: {v.rejectionReason || "—"}</div>
                          ) : null}
                          {v.reviewedAt && (v.status === "approved" || v.status === "rejected") ? (
                            <div className="mt-0.5 text-xs text-slate-500">Analisado em {brDateTime(v.reviewedAt)}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId === v.id}
                            onClick={() => openFile(v, false)}
                            className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Visualizar
                          </button>
                          <button
                            type="button"
                            disabled={busyId === v.id}
                            onClick={() => openFile(v, true)}
                            className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Baixar
                          </button>
                          {v.canReview ? (
                            <>
                              <button
                                type="button"
                                disabled={busyId === v.id}
                                onClick={() => review(v.id, "approve")}
                                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                              >
                                Aprovar
                              </button>
                              <button
                                type="button"
                                disabled={busyId === v.id}
                                onClick={() => setRejecting({ id: v.id, reason: "" })}
                                className="rounded-xl border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                              >
                                Rejeitar
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {rejecting?.id === v.id ? (
                        <div className="mt-3 space-y-2">
                          <label htmlFor={`motivo-${v.id}`} className="block text-xs font-semibold text-slate-600">
                            Motivo da rejeição (o responsável verá este texto)
                          </label>
                          <textarea
                            id={`motivo-${v.id}`}
                            value={rejecting.reason}
                            onChange={(e) => setRejecting({ id: v.id, reason: e.target.value })}
                            maxLength={1000}
                            rows={3}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === v.id || rejecting.reason.trim().length < 5}
                              onClick={() => review(v.id, "reject", rejecting.reason.trim())}
                              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              Confirmar rejeição
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejecting(null)}
                              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
