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

type AttendanceBlockItem = {
  id: string;
  date: string;
  type: string;
  typeLabel: string;
  title: string;
  description: string;
  targetScope: string;
  classId: string | null;
  shift: string | null;
};

type AttendanceBlock = {
  isBlocked: boolean;
  blocks: AttendanceBlockItem[];
  mainBlock: AttendanceBlockItem | null;
  message: string | null;
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

function formatDateBR(date: string) {
  const [year, month, day] = String(date || "").slice(0, 10).split("-");

  if (!year || !month || !day) return date;

  return `${day}/${month}/${year}`;
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
  const [attendanceBlock, setAttendanceBlock] = useState<AttendanceBlock>({
    isBlocked: false,
    blocks: [],
    mainBlock: null,
    message: null,
  });

  const [branding, setBranding] = useState<MePayload["branding"] | null>(null);
  const [schoolName, setSchoolName] = useState("Portal do Professor");

  const isAttendanceBlocked = attendanceBlock.isBlocked;

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
    if (isLocked || isAttendanceBlocked) return;

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
    if (isLocked || isAttendanceBlocked) return;

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
        `/api/teacher/attendance/roster?classId=${encodeURIComponent(
          classId
        )}&date=${encodeURIComponent(date)}`,
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

      const block: AttendanceBlock = {
        isBlocked: Boolean(json.attendanceBlock?.isBlocked),
        blocks: Array.isArray(json.attendanceBlock?.blocks)
          ? json.attendanceBlock.blocks
          : [],
        mainBlock: json.attendanceBlock?.mainBlock || null,
        message: json.attendanceBlock?.message || null,
      };

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
      setAttendanceBlock(block);
      setIsLocked((m || []).length > 0);
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (isAttendanceBlocked) {
      setErr("Não é possível salvar chamada em dia sem aula.");
      return;
    }

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
        if (json?.attendanceBlock?.isBlocked) {
          setAttendanceBlock({
            isBlocked: true,
            blocks: Array.isArray(json.attendanceBlock.blocks)
              ? json.attendanceBlock.blocks
              : [],
            mainBlock: json.attendanceBlock.mainBlock || null,
            message: json.attendanceBlock.message || null,
          });
        }

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
    if (isAttendanceBlocked) {
      setErr("Não há PDF diário de chamada para dia sem aula.");
      return;
    }

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

      const fileName = `${slugifyFileName(`${schoolName}-presenca-diaria-${date}`)}.pdf`;

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
          ? `${slugifyFileName(`${schoolName}-presenca-periodo-${start}-a-${end}`)}.pdf`
          : `${slugifyFileName(`${schoolName}-presenca-mensal-${month}`)}.pdf`;

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

  const mainBlock = attendanceBlock.mainBlock;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            {branding?.brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.brandLogoUrl}
                alt={schoolName}
                className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                Logo
              </div>
            )}

            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
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

          <div className="mt-4 flex flex-wrap gap-2">
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

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Data (Diário)</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Tipo de relatório</label>
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
                <label className="mb-1 block text-xs text-slate-500">Mês</label>
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
                  <label className="mb-1 block text-xs text-slate-500">Início</label>
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-500">Fim</label>
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

          {isAttendanceBlocked ? (
            <div className="mt-5 rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="inline-flex rounded-full border border-amber-200 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-amber-700">
                    Dia bloqueado no calendário escolar
                  </div>

                  <h2 className="mt-3 text-xl font-bold text-amber-950">
                    🚫 Não haverá aula neste dia
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    {attendanceBlock.message ||
                      "A chamada não precisa ser realizada para esta data."}
                  </p>

                  {mainBlock ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-white/60 p-4 text-sm leading-6">
                      <div>
                        <b>Motivo:</b> {mainBlock.typeLabel} · {mainBlock.title}
                      </div>

                      <div>
                        <b>Data:</b> {formatDateBR(mainBlock.date)}
                      </div>

                      {mainBlock.description ? (
                        <div>
                          <b>Descrição:</b> {mainBlock.description}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-950">
                  Chamada desativada
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={setAllPresent}
              disabled={roster.length === 0 || isLocked || isAttendanceBlocked}
            >
              Marcar todos como P
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              onClick={() => setIsLocked(false)}
              disabled={!isLocked || isAttendanceBlocked}
            >
              Editar
            </button>

            <button
              type="button"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              onClick={openPdfDaily}
              disabled={roster.length === 0 || generatingDailyPdf || isAttendanceBlocked}
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
              className="rounded-2xl bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50"
              onClick={save}
              disabled={saving || roster.length === 0 || isAttendanceBlocked}
            >
              {saving ? "Salvando..." : "Salvar chamada"}
            </button>
          </div>

          {isAttendanceBlocked ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              A chamada está bloqueada porque a direção marcou esta data como dia sem aula,
              feriado, recesso ou evento pedagógico sem aula.
            </div>
          ) : isLocked ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Edição bloqueada após salvar. Use <b>Editar</b> para alterar.
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Marque <b>P</b>, <b>F</b> ou <b>T</b> individualmente e salve para registrar a presença.
            </div>
          )}

          {msg ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {msg}
            </div>
          ) : null}

          {err ? (
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
            <h2 className="text-sm font-semibold text-slate-900">Resumo da chamada</h2>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">Presentes</div>
                <div className="text-2xl font-semibold">{isAttendanceBlocked ? "—" : counts.p}</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">Faltas</div>
                <div className="text-2xl font-semibold text-red-600">
                  {isAttendanceBlocked ? "—" : counts.f}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">Atrasos</div>
                <div className="text-2xl font-semibold text-amber-600">
                  {isAttendanceBlocked ? "—" : counts.t}
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm xl:col-span-3">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Lista de alunos</h2>
              <p className="mt-1 text-sm text-slate-500">
                {isAttendanceBlocked
                  ? "A lista permanece visível apenas para conferência. A chamada está bloqueada."
                  : "Selecione o status individual de cada aluno para a data escolhida."}
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
                              <div className="font-medium text-slate-900">
                                {r.full_name || "—"}
                              </div>
                            </td>

                            <td className="px-5 py-4 text-slate-600">
                              {r.registration_number || "—"}
                            </td>

                            <td className="px-5 py-4">
                              {isAttendanceBlocked ? (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                                  Sem aula
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-2">
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
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 p-4 md:hidden">
                  {roster.map((r) => {
                    const mk = ensureMark(r.student_id);

                    return (
                      <div key={r.student_id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="font-medium text-slate-900">{r.full_name || "—"}</div>

                        <div className="text-sm text-slate-500">
                          Matrícula: {r.registration_number || "—"}
                        </div>

                        {isAttendanceBlocked ? (
                          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                            Sem aula
                          </div>
                        ) : (
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
                        )}
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