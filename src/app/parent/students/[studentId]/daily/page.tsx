"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StudentRow = {
  id: string;
  full_name: string | null;
  registration_number: string | null;
};

type SessionRow = {
  id: string;
  lesson_date: string;
  lesson_number: number | null;
};

type RecordRow = {
  session_id: string;
  status: string;
  note: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYMDToLocalDate(ymdStr: string) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateBr(dateYmd: string) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!y || !m || !d) return dateYmd;

  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function normalizeStatus(status: string) {
  const s = String(status || "").toLowerCase().trim();

  if (s === "present" || s === "presente") return "present";
  if (s === "late" || s === "atraso" || s === "tarde" || s === "tardy") return "late";
  if (s === "absent" || s === "falta" || s === "ausente") return "absent";

  return "unknown";
}

function statusLabel(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "present") return "Presente";
  if (normalized === "late") return "Atraso";
  if (normalized === "absent") return "Falta";

  return status || "-";
}

function statusBadgeClass(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "present") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalized === "late") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (normalized === "absent") {
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

export default function DailyAttendancePage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();

  const studentId = String(params.studentId || "").trim();

  const initialDate = useMemo(() => {
    const q = searchParams.get("date");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    return ymd(new Date());
  }, [searchParams]);

  const [dateYMD, setDateYMD] = useState(initialDate);
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [records, setRecords] = useState<Array<{ session: SessionRow; record: RecordRow }>>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const totals = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;

    for (const item of records) {
      const normalized = normalizeStatus(item.record.status);

      if (normalized === "present") present += 1;
      else if (normalized === "late") late += 1;
      else if (normalized === "absent") absent += 1;
    }

    return {
      present,
      late,
      absent,
      total: records.length,
    };
  }, [records]);

  async function loadDaily() {
    setLoading(true);
    setErrMsg(null);

    try {
      const { data: st, error: stErr } = await supabase
        .from("students")
        .select("id, full_name, registration_number")
        .eq("id", studentId)
        .maybeSingle();

      if (stErr || !st) {
        setErrMsg("Aluno não encontrado ou sem permissão.");
        setStudent(null);
        setRecords([]);
        return;
      }

      setStudent(st);

      const dayStart = parseYMDToLocalDate(dateYMD);
      const nextDay = addDays(dayStart, 1);

      const start = ymd(dayStart);
      const end = ymd(nextDay);

      const { data: sessions, error: sErr } = await supabase
        .from("attendance_sessions")
        .select("id, lesson_date, lesson_number")
        .gte("lesson_date", start)
        .lt("lesson_date", end)
        .order("lesson_number", { ascending: true });

      if (sErr) {
        setErrMsg(`Erro ao buscar sessões do dia: ${sErr.message}`);
        setRecords([]);
        return;
      }

      const sess = (sessions || []) as SessionRow[];

      if (sess.length === 0) {
        setRecords([]);
        return;
      }

      const sessionIds = sess.map((x) => x.id);

      const { data: recs, error: rErr } = await supabase
        .from("attendance_records")
        .select("session_id, status, note")
        .eq("student_id", studentId)
        .in("session_id", sessionIds);

      if (rErr) {
        setErrMsg(`Erro ao buscar registros do dia: ${rErr.message}`);
        setRecords([]);
        return;
      }

      const recList = (recs || []) as RecordRow[];
      const recBySession = new Map(recList.map((r) => [r.session_id, r]));

      const merged = sess
        .map((s) => {
          const r = recBySession.get(s.id);
          if (!r) return null;
          return { session: s, record: r };
        })
        .filter(Boolean) as Array<{ session: SessionRow; record: RecordRow }>;

      setRecords(merged);
    } catch (e: any) {
      setErrMsg(e?.message || "Erro inesperado.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDaily();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, dateYMD]);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Acompanhamento escolar
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Presença diária
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Consulte a frequência do aluno em um dia específico, com visão clara
                  por aula e resumo rápido do dia letivo.
                </p>

                <div className="mt-4 space-y-1 text-sm text-slate-200">
                  <div>
                    <span className="font-semibold">Aluno:</span> {student?.full_name ?? "—"}
                    {student?.registration_number ? (
                      <>
                        {" "}
                        • <span className="font-semibold">Matrícula:</span>{" "}
                        {student.registration_number}
                      </>
                    ) : null}
                  </div>

                  <div>
                    <span className="font-semibold">Data selecionada:</span> {formatDateBr(dateYMD)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={loadDaily}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Recarregar
                </button>

                <button
                  onClick={() => router.push(`/parent/students/${studentId}/monthly`)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver mensal
                </button>

                <button
                  onClick={() => router.push(`/parent/students/${studentId}/report-card`)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver boletim
                </button>

                <button
                  onClick={() => router.push(`/parent/students/${studentId}`)}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Voltar
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-4 md:p-6">
            <SummaryCard
              label="Aulas no dia"
              value={String(totals.total)}
              help="Total de aulas com frequência registrada nesta data."
            />

            <SummaryCard
              label="Presenças"
              value={String(totals.present)}
              help="Aulas em que o aluno esteve presente."
            />

            <SummaryCard
              label="Atrasos"
              value={String(totals.late)}
              help="Registros em que houve atraso."
            />

            <SummaryCard
              label="Faltas"
              value={String(totals.absent)}
              help="Aulas em que o aluno esteve ausente."
            />
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Filtro da consulta
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Escolha uma data para verificar os lançamentos de frequência.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Data
                </label>
                <input
                  type="date"
                  value={dateYMD}
                  onChange={(e) => setDateYMD(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 sm:w-[220px]"
                />
              </div>

              <button
                onClick={loadDaily}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Atualizar
              </button>
            </div>
          </div>

          {errMsg ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errMsg}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Registros do dia
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Visualização detalhada da frequência por aula.
            </p>
          </div>

          <div className="p-4 md:p-6">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                Carregando...
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Nenhum registro de presença nesta data.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {records.map(({ session, record }) => (
                  <div
                    key={session.id}
                    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Aula
                        </div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                          {session.lesson_number != null ? `${session.lesson_number}ª aula` : "—"}
                        </div>
                      </div>

                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(
                          record.status
                        )}`}
                      >
                        {statusLabel(record.status)}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Situação registrada
                        </div>
                        <div className="mt-2 text-sm font-medium text-slate-900">
                          {statusLabel(record.status)}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Observação
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-700">
                          {record.note ? record.note : "Nenhuma observação registrada para esta aula."}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Navegação rápida
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Acesse outras áreas do acompanhamento escolar.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/parent/students/${studentId}`}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Painel do aluno
              </Link>

              <Link
                href={`/parent/students/${studentId}/monthly`}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Presença mensal
              </Link>

              <Link
                href={`/parent/students/${studentId}/report-card`}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Boletim escolar
              </Link>
            </div>
          </div>
        </section>

        <div className="text-xs text-slate-500">
          Dica: para voltar ao painel do aluno,{" "}
          <Link href={`/parent/students/${studentId}`} className="underline">
            clique aqui
          </Link>
          .
        </div>
      </div>
    </main>
  );
}