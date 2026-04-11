"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { openPdfFromResponse } from "@/lib/openPdfOnClient";

type RosterRow = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

type MarkRow = {
  student_id: string;
  status: "present" | "absent" | "late";
  note: string | null;
};

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function currentMonthISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function slugifyFileName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
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

export default function TeacherAttendancePage() {
  const router = useRouter();
  const params = useParams<{ classId: string }>();
  const classId = params.classId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingDailyPdf, setGeneratingDailyPdf] = useState(false);
  const [generatingReportPdf, setGeneratingReportPdf] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());

  const [reportMode, setReportMode] = useState<"month" | "period">("month");
  const [month, setMonth] = useState(currentMonthISO());
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkRow>>({});
  const [isLocked, setIsLocked] = useState(false);

  const [branding, setBranding] = useState<MePayload["branding"] | null>(null);
  const [schoolName, setSchoolName] = useState("Portal do Professor");

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  function ensureMark(studentId: string): MarkRow {
    return (
      marks[studentId] || {
        student_id: studentId,
        status: "present",
        note: null,
      }
    );
  }

  function setStatus(studentId: string, status: "present" | "absent" | "late") {
    if (isLocked) return;

    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { student_id: studentId, note: null }),
        student_id: studentId,
        status,
      },
    }));
  }

  const counts = useMemo(() => {
    let p = 0;
    let f = 0;
    let t = 0;

    for (const row of roster) {
      const status = ensureMark(row.student_id).status;
      if (status === "present") p++;
      else if (status === "absent") f++;
      else if (status === "late") t++;
    }

    return { p, f, t };
  }, [roster, marks]);

  function setAllPresent() {
    if (isLocked) return;

    setMarks((prev) => {
      const next = { ...prev };

      for (const row of roster) {
        next[row.student_id] = {
          ...(next[row.student_id] || { student_id: row.student_id, note: null }),
          student_id: row.student_id,
          status: "present",
        };
      }

      return next;
    });
  }

  async function loadBranding(token: string) {
    try {
      const res = await fetch("/api/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await safeJson(res);
      if (!res.ok || !json?.ok) return;

      setBranding(json.branding ?? null);
      setSchoolName(json?.branding?.brandName || "Portal do Professor");
    } catch {
      // não bloqueia a tela
    }
  }

  async function load() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    const token = await ensureToken();
    if (!token) return;

    try {
      await loadBranding(token);

      const res = await fetch(
        `/api/teacher/attendance/roster?classId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Falha ao carregar chamada.");
        return;
      }

      const r: RosterRow[] = json.roster || [];
      const m: MarkRow[] = json.marks || [];

      const rosterMap = new Map<string, RosterRow>();
      for (const row of r) {
        const studentId = String(row.student_id || "").trim();
        if (!studentId) continue;

        if (!rosterMap.has(studentId)) {
          rosterMap.set(studentId, {
            student_id: studentId,
            full_name: row.full_name ?? null,
            registration_number: row.registration_number ?? null,
          });
        }
      }

      const cleanRoster = Array.from(rosterMap.values());

      const markMap: Record<string, MarkRow> = {};
      for (const row of m) {
        const studentId = String(row.student_id || "").trim();
        if (!studentId) continue;

        markMap[studentId] = {
          student_id: studentId,
          status: row.status,
          note: row.note ?? null,
        };
      }

      for (const st of cleanRoster) {
        if (!markMap[st.student_id]) {
          markMap[st.student_id] = {
            student_id: st.student_id,
            status: "present",
            note: null,
          };
        }
      }

      setRoster(cleanRoster);
      setMarks(markMap);
      setIsLocked((m || []).length > 0);
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);

    const token = await ensureToken();
    if (!token) return;

    try {
      const items = roster.map((r) => {
        const mk = ensureMark(r.student_id);
        return {
          studentId: r.student_id,
          status: mk.status,
          note: mk.note,
        };
      });

      const res = await fetch("/api/teacher/attendance/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId,
          date,
          lessonNumber: 1,
          items,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Falha ao salvar chamada.");
        return;
      }

      setMsg("Chamada salva com sucesso.");
      setIsLocked(true);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado.");
    } finally {
      setSaving(false);
    }
  }

  async function openPdfDaily() {
    setErr(null);
    setMsg(null);
    setGeneratingDailyPdf(true);

    try {
      const token = await ensureToken();
      if (!token) return;

      const url = `/api/teacher/attendance/report?classId=${encodeURIComponent(
        classId
      )}&date=${encodeURIComponent(date)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const j = text ? JSON.parse(text) : null;
          setErr(
            (j?.error || "Falha ao gerar PDF.") +
              (j?.details ? `\n\nDetalhes: ${j.details}` : "")
          );
        } catch {
          setErr(text || "Falha ao gerar PDF.");
        }
        return;
      }

      const fileName = `${slugifyFileName(
        `${schoolName}-presenca-diaria-${date}`
      )}.pdf`;

      await openPdfFromResponse(res, {
        fileName,
      });

      setMsg("PDF diário gerado com sucesso.");
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado ao gerar PDF diário.");
    } finally {
      setGeneratingDailyPdf(false);
    }
  }

  async function openPdfReport() {
    setErr(null);
    setMsg(null);
    setGeneratingReportPdf(true);

    try {
      const token = await ensureToken();
      if (!token) return;

      const qs =
        reportMode === "period"
          ? `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
          : `month=${encodeURIComponent(month)}`;

      const url = `/api/teacher/attendance/report-month?classId=${encodeURIComponent(
        classId
      )}&${qs}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const j = text ? JSON.parse(text) : null;
          setErr(
            (j?.error || "Falha ao gerar PDF.") +
              (j?.details ? `\n\nDetalhes: ${j.details}` : "")
          );
        } catch {
          setErr(text || "Falha ao gerar PDF.");
        }
        return;
      }

      const fileName =
        reportMode === "period"
          ? `${slugifyFileName(
              `${schoolName}-presenca-periodo-${start}-a-${end}`
            )}.pdf`
          : `${slugifyFileName(
              `${schoolName}-presenca-mensal-${month}`
            )}.pdf`;

      await openPdfFromResponse(res, {
        fileName,
      });

      setMsg(
        reportMode === "period"
          ? "PDF por período gerado com sucesso."
          : "PDF mensal gerado com sucesso."
      );
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado ao gerar PDF do relatório.");
    } finally {
      setGeneratingReportPdf(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, classId]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-600">Carregando chamada...</div>;
  }

  return (
    <div className="p-4 md:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-4">
            {branding?.brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.brandLogoUrl}
                alt={schoolName}
                className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <div className="h-14 w-14 rounded-2xl border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                Logo
              </div>
            )}

            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-medium">
                Portal do Professor
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                Chamada Digital
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                {schoolName} · Controle de presença da turma com geração de PDF diário e mensal.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={() => router.push("/teacher/classes")}
            >
              Voltar
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm"
              onClick={load}
            >
              Recarregar
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Data (Diário)</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Tipo de relatório</label>
              <select
                value={reportMode}
                onChange={(e) => setReportMode(e.target.value as "month" | "period")}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
              >
                <option value="month">Mensal</option>
                <option value="period">Por período</option>
              </select>
            </div>

            {reportMode === "month" ? (
              <div>
                <label className="block text-xs text-slate-500 mb-1">Mês</label>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Início</label>
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fim</label>
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                  />
                </div>
              </>
            )}
          </div>

          <div className="mt-5 flex gap-2 flex-wrap">
            <button
              type="button"
              className="rounded-2xl bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50"
              onClick={setAllPresent}
              disabled={roster.length === 0 || isLocked}
            >
              Marcar todos como P
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              onClick={() => setIsLocked(false)}
              disabled={!isLocked}
            >
              Editar
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              onClick={openPdfDaily}
              disabled={roster.length === 0 || generatingDailyPdf}
            >
              {generatingDailyPdf ? "Gerando PDF diário..." : "Gerar PDF (Diário)"}
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              onClick={openPdfReport}
              disabled={generatingReportPdf}
            >
              {generatingReportPdf
                ? reportMode === "period"
                  ? "Gerando PDF por período..."
                  : "Gerando PDF mensal..."
                : reportMode === "period"
                  ? "Gerar PDF (Período)"
                  : "Gerar PDF (Mensal)"}
            </button>

            <button
              type="button"
              className="rounded-2xl bg-blue-600 text-white px-5 py-2 text-sm disabled:opacity-50"
              onClick={save}
              disabled={saving || roster.length === 0}
            >
              {saving ? "Salvando..." : "Salvar chamada"}
            </button>
          </div>

          {isLocked ? (
            <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Edição bloqueada após salvar. Use <b>Editar</b> para alterar.
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
              Marque <b>P</b>, <b>F</b> ou <b>T</b> individualmente e salve para registrar a presença.
            </div>
          )}

          {msg ? (
            <div className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
              {msg}
            </div>
          ) : null}

          {err ? (
            <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 whitespace-pre-wrap">
              {err}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <div className="xl:col-span-1 rounded-3xl bg-white border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-slate-900">Resumo da chamada</h2>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                <div className="text-xs text-slate-500">Presentes</div>
                <div className="text-2xl font-semibold">{counts.p}</div>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                <div className="text-xs text-slate-500">Faltas</div>
                <div className="text-2xl font-semibold text-red-600">{counts.f}</div>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                <div className="text-xs text-slate-500">Atrasos</div>
                <div className="text-2xl font-semibold text-amber-600">{counts.t}</div>
              </div>
            </div>
          </div>

          <div className="xl:col-span-3 rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Lista de alunos</h2>
              <p className="text-sm text-slate-500 mt-1">
                Selecione o status individual de cada aluno para a data escolhida.
              </p>
            </div>

            {roster.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                Nenhum aluno ativo nesta turma na data selecionada.
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr className="text-left">
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Aluno
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Matrícula
                        </th>
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((r) => {
                        const mk = ensureMark(r.student_id);

                        return (
                          <tr key={r.student_id} className="border-t border-slate-200">
                            <td className="px-5 py-4">
                              <div className="font-medium text-slate-900">{r.full_name || "—"}</div>
                            </td>
                            <td className="px-5 py-4 text-slate-600">
                              {r.registration_number || "—"}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => setStatus(r.student_id, "present")}
                                  disabled={isLocked}
                                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                                    mk.status === "present"
                                      ? "bg-slate-900 text-white"
                                      : "border border-slate-300 text-slate-700"
                                  }`}
                                >
                                  P
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setStatus(r.student_id, "absent")}
                                  disabled={isLocked}
                                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                                    mk.status === "absent"
                                      ? "bg-red-600 text-white"
                                      : "border border-slate-300 text-slate-700"
                                  }`}
                                >
                                  F
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setStatus(r.student_id, "late")}
                                  disabled={isLocked}
                                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                                    mk.status === "late"
                                      ? "bg-amber-500 text-white"
                                      : "border border-slate-300 text-slate-700"
                                  }`}
                                >
                                  T
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden p-4 space-y-3">
                  {roster.map((r) => {
                    const mk = ensureMark(r.student_id);

                    return (
                      <div key={r.student_id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="font-medium text-slate-900">{r.full_name || "—"}</div>
                        <div className="text-sm text-slate-500">
                          Matrícula: {r.registration_number || "—"}
                        </div>

                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setStatus(r.student_id, "present")}
                            disabled={isLocked}
                            className={`flex-1 rounded-2xl px-4 py-2 text-sm font-semibold ${
                              mk.status === "present"
                                ? "bg-slate-900 text-white"
                                : "border border-slate-300 text-slate-700"
                            }`}
                          >
                            P
                          </button>

                          <button
                            type="button"
                            onClick={() => setStatus(r.student_id, "absent")}
                            disabled={isLocked}
                            className={`flex-1 rounded-2xl px-4 py-2 text-sm font-semibold ${
                              mk.status === "absent"
                                ? "bg-red-600 text-white"
                                : "border border-slate-300 text-slate-700"
                            }`}
                          >
                            F
                          </button>

                          <button
                            type="button"
                            onClick={() => setStatus(r.student_id, "late")}
                            disabled={isLocked}
                            className={`flex-1 rounded-2xl px-4 py-2 text-sm font-semibold ${
                              mk.status === "late"
                                ? "bg-amber-500 text-white"
                                : "border border-slate-300 text-slate-700"
                            }`}
                          >
                            T
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}