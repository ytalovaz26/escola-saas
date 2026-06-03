"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StudentRow = {
  id: string;
  full_name: string | null;
  registration_number: string | null;
  activeClass?: {
    id: string;
    name: string;
    grade: string | null;
    shift: string | null;
    label: string;
  } | null;
};

type AttendanceItem = {
  date: string;
  status: string;
  statusLabel?: string;
  class_id?: string | null;
  session_id: string;
  lesson_number: number | null;
  note: string | null;
};

type CalendarBlock = {
  id: string;
  date: string;
  type: string;
  typeLabel: string;
  title: string;
  description: string;
  targetScope?: string | null;
  classId?: string | null;
  shift?: string | null;
};

type DailyApiPayload = {
  ok: boolean;
  student?: StudentRow;
  range?: {
    from: string;
    to: string;
  };
  items?: AttendanceItem[];
  sessions?: Array<{
    id: string;
    lesson_date: string;
    lesson_number: number | null;
  }>;
  calendarBlocks?: CalendarBlock[];
  blockedDates?: string[];
  summary?: {
    totalItems: number;
    present: number;
    absent: number;
    late: number;
    blockedDaysRemoved: number;
  };
  error?: string;
};

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateBr(dateYmd: string) {
  const [y, m, d] = String(dateYmd || "").split("-").map(Number);
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

  if (s === "present" || s === "presente" || s === "p") return "present";
  if (s === "late" || s === "atraso" || s === "tarde" || s === "tardy" || s === "t") {
    return "late";
  }
  if (s === "absent" || s === "falta" || s === "ausente" || s === "f") return "absent";

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

function blockBadgeClass(type: string) {
  const t = String(type || "").toLowerCase().trim();

  if (t === "holiday") return "border-purple-200 bg-purple-50 text-purple-700";
  if (t === "recess") return "border-blue-200 bg-blue-50 text-blue-700";
  if (t === "no_class") return "border-orange-200 bg-orange-50 text-orange-700";

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
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([]);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const isBlockedDay = blockedDates.includes(dateYMD) || calendarBlocks.some((b) => b.date === dateYMD);

  const totals = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;

    if (isBlockedDay) {
      return {
        present: 0,
        late: 0,
        absent: 0,
        total: 0,
      };
    }

    for (const item of items) {
      const normalized = normalizeStatus(item.status);

      if (normalized === "present") present += 1;
      else if (normalized === "late") late += 1;
      else if (normalized === "absent") absent += 1;
    }

    return {
      present,
      late,
      absent,
      total: items.length,
    };
  }, [items, isBlockedDay]);

  async function loadDaily() {
    setLoading(true);
    setErrMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(
        `/api/parent/attendance/day?studentId=${encodeURIComponent(studentId)}&from=${encodeURIComponent(
          dateYMD
        )}&to=${encodeURIComponent(dateYMD)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = (await safeJson(res)) as DailyApiPayload | any;

      if (!res.ok || !json?.ok) {
        setErrMsg(json?.error || "Falha ao carregar presença diária.");
        setStudent(null);
        setItems([]);
        setCalendarBlocks([]);
        setBlockedDates([]);
        return;
      }

      setStudent(json.student ?? null);
      setItems(Array.isArray(json.items) ? json.items : []);
      setCalendarBlocks(Array.isArray(json.calendarBlocks) ? json.calendarBlocks : []);
      setBlockedDates(Array.isArray(json.blockedDates) ? json.blockedDates : []);
    } catch (e: any) {
      setErrMsg(e?.message || "Erro inesperado.");
      setItems([]);
      setCalendarBlocks([]);
      setBlockedDates([]);
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
                  Consulte a frequência do aluno em um dia específico, respeitando os dias
                  sem aula, recessos e feriados cadastrados pela escola.
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

                  {student?.activeClass?.label ? (
                    <div>
                      <span className="font-semibold">Turma:</span> {student.activeClass.label}
                    </div>
                  ) : null}
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
              label={isBlockedDay ? "Dia sem aula" : "Aulas no dia"}
              value={isBlockedDay ? "Sim" : String(totals.total)}
              help={
                isBlockedDay
                  ? "A escola bloqueou esta data no calendário escolar."
                  : "Total de aulas com frequência registrada nesta data."
              }
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
              help="Dias sem aula não entram como falta."
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

        {isBlockedDay ? (
          <section className="overflow-hidden rounded-[32px] border border-orange-200 bg-orange-50 shadow-sm">
            <div className="border-b border-orange-200 px-5 py-4 md:px-6">
              <h2 className="text-xl font-semibold tracking-tight text-orange-950">
                Sem aula nesta data
              </h2>
              <p className="mt-1 text-sm text-orange-800">
                Este dia foi bloqueado pela escola e não deve ser interpretado como falta ou
                ausência do aluno.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:p-6">
              {calendarBlocks.length > 0 ? (
                calendarBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="rounded-[28px] border border-orange-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${blockBadgeClass(
                          block.type
                        )}`}
                      >
                        {block.typeLabel || "Calendário escolar"}
                      </span>

                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                        {formatDateBr(block.date)}
                      </span>
                    </div>

                    <h3 className="mt-4 text-xl font-semibold text-slate-950">
                      {block.title || "Não haverá aula"}
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {block.description || "A escola informou que não haverá aula nesta data."}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[28px] border border-orange-200 bg-white p-5 shadow-sm">
                  <h3 className="text-xl font-semibold text-slate-950">
                    Data bloqueada pela escola
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Não há registro de frequência porque a data foi marcada como dia sem aula.
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : (
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
              ) : items.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                  Nenhum registro de presença nesta data.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {items.map((item) => (
                    <div
                      key={item.session_id}
                      className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Aula
                          </div>
                          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                            {item.lesson_number != null ? `${item.lesson_number}ª aula` : "—"}
                          </div>
                        </div>

                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(
                            item.status
                          )}`}
                        >
                          {item.statusLabel || statusLabel(item.status)}
                        </span>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Situação registrada
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-900">
                            {item.statusLabel || statusLabel(item.status)}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Observação
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-700">
                            {item.note ? item.note : "Nenhuma observação registrada para esta aula."}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

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
      </div>
    </main>
  );
}