"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ClassItem = {
  id: string;
  name: string;
  series?: string | null;
  shift?: string | null;
};

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: text || "Resposta inválida do servidor",
    };
  }
}

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

function openLoadingTab() {
  const newTab = window.open("", "_blank");

  if (newTab) {
    newTab.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Gerando PDF...</title>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #f8fafc;
              color: #334155;
            }
          </style>
        </head>
        <body>
          Gerando PDF...
        </body>
      </html>
    `);
    newTab.document.close();
  }

  return newTab;
}

export default function SchoolAttendancePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [classesLoading, setClassesLoading] = useState(true);
  const [dailyGenerating, setDailyGenerating] = useState(false);
  const [monthlyGenerating, setMonthlyGenerating] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(todayISO());

  const [reportMode, setReportMode] = useState<"month" | "period">("month");
  const [month, setMonth] = useState(currentMonthISO());
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadClasses() {
    setClassesLoading(true);
    setLoading(true);
    setError(null);

    const token = await ensureToken();

    if (!token) {
      setClassesLoading(false);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/school/classes/list", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar turmas.");
        setClasses([]);
        return;
      }

      const list = Array.isArray(json?.classes) ? json.classes : [];

      const normalized: ClassItem[] = list
        .map((item: any) => ({
          id: String(item.id || "").trim(),
          name:
            String(item.name || "").trim() ||
            String(item.class_name || "").trim() ||
            String(item.title || "").trim() ||
            "Turma sem nome",
          series:
            item.series ??
            item.grade ??
            item.school_year ??
            item.year_label ??
            null,
          shift:
            item.shift ??
            item.turno ??
            item.period ??
            null,
        }))
        .filter((item: ClassItem) => item.id);

      setClasses(normalized);

      if (!classId && normalized.length > 0) {
        setClassId(normalized[0].id);
      }
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar turmas.");
      setClasses([]);
    } finally {
      setClassesLoading(false);
      setLoading(false);
    }
  }

  async function openDailyPdf() {
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) return;

    if (!classId) {
      setError("Selecione uma turma.");
      return;
    }

    const previewTab = openLoadingTab();
    setDailyGenerating(true);

    try {
      const url = `/api/school/attendance/report?classId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        if (previewTab && !previewTab.closed) previewTab.close();

        const json = await safeJson(res);
        setError(
          (json?.error || "Falha ao gerar PDF diário.") +
            (json?.details ? `\n\nDetalhes: ${json.details}` : "")
        );
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (previewTab && !previewTab.closed) {
        previewTab.location.href = objectUrl;
      } else {
        window.open(objectUrl, "_blank");
      }

      setMessage("PDF diário gerado com sucesso.");
    } catch (e: any) {
      if (previewTab && !previewTab.closed) previewTab.close();
      setError(e?.message || "Erro inesperado ao gerar PDF diário.");
    } finally {
      setDailyGenerating(false);
    }
  }

  async function openMonthlyPdf() {
    setError(null);
    setMessage(null);

    const token = await ensureToken();
    if (!token) return;

    if (!classId) {
      setError("Selecione uma turma.");
      return;
    }

    if (reportMode === "period" && (!start || !end)) {
      setError("Informe a data inicial e final do período.");
      return;
    }

    if (reportMode === "month" && !month) {
      setError("Informe o mês do relatório.");
      return;
    }

    const previewTab = openLoadingTab();
    setMonthlyGenerating(true);

    try {
      const qs =
        reportMode === "period"
          ? `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
          : `month=${encodeURIComponent(month)}`;

      const url = `/api/school/attendance/report-month?classId=${encodeURIComponent(classId)}&${qs}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        if (previewTab && !previewTab.closed) previewTab.close();

        const json = await safeJson(res);
        setError(
          (json?.error ||
            (reportMode === "period"
              ? "Falha ao gerar PDF por período."
              : "Falha ao gerar PDF mensal.")) +
            (json?.details ? `\n\nDetalhes: ${json.details}` : "")
        );
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (previewTab && !previewTab.closed) {
        previewTab.location.href = objectUrl;
      } else {
        window.open(objectUrl, "_blank");
      }

      setMessage(
        reportMode === "period"
          ? "PDF por período gerado com sucesso."
          : "PDF mensal gerado com sucesso."
      );
    } catch (e: any) {
      if (previewTab && !previewTab.closed) previewTab.close();

      setError(
        e?.message ||
          (reportMode === "period"
            ? "Erro inesperado ao gerar PDF por período."
            : "Erro inesperado ao gerar PDF mensal.")
      );
    } finally {
      setMonthlyGenerating(false);
    }
  }

  useEffect(() => {
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === classId) || null,
    [classes, classId]
  );

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                Gestão Escolar
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Chamada Escolar
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Gere os PDFs de chamada diária, mensal ou por período pela visão da direção.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Voltar ao painel
              </button>
            </div>
          </div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">Turma</label>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                disabled={classesLoading}
              >
                <option value="">
                  {classesLoading ? "Carregando turmas..." : "Selecione uma turma"}
                </option>

                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.series ? ` • ${item.series}` : ""}
                    {item.shift ? ` • ${item.shift}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Data (PDF diário)</label>
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
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
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

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadClasses}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              disabled={classesLoading}
            >
              {classesLoading ? "Recarregando..." : "Recarregar"}
            </button>

            <button
              type="button"
              onClick={openDailyPdf}
              disabled={!classId || loading || dailyGenerating}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {dailyGenerating ? "Gerando PDF diário..." : "Gerar PDF diário"}
            </button>

            <button
              type="button"
              onClick={openMonthlyPdf}
              disabled={!classId || loading || monthlyGenerating}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {monthlyGenerating
                ? reportMode === "period"
                  ? "Gerando PDF por período..."
                  : "Gerando PDF mensal..."
                : reportMode === "period"
                  ? "Gerar PDF por período"
                  : "Gerar PDF mensal"}
            </button>
          </div>

          {selectedClass ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <b>Turma selecionada:</b> {selectedClass.name}
              {selectedClass.series ? ` • ${selectedClass.series}` : ""}
              {selectedClass.shift ? ` • ${selectedClass.shift}` : ""}
            </div>
          ) : null}

          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}