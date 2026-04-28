"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StudentRow = {
  id: string;
  full_name: string | null;
  registration_number: string | null;
  school_id?: string | null;
};

type DayMark = {
  lessonNumber: number | null;
  status: string;
};

type ParentChildrenResponse = {
  ok: boolean;
  children?: Array<{
    id: string;
    full_name: string | null;
    registration_number: string | null;
    relationship?: string | null;
    active_class?: {
      class?: {
        name?: string | null;
        grade?: string | null;
        shift?: string | null;
      } | null;
    } | null;
  }>;
  error?: string;
};

type MonthlyApiPayload = {
  ok: boolean;
  student?: {
    id: string;
    full_name: string | null;
  };
  month?: string;
  range?: {
    startYMD: string;
    endYMD: string;
  };
  sessions?: Array<{
    id: string;
    lesson_date: string;
    lesson_number: number | null;
  }>;
  records?: Array<{
    session_id: string;
    status: string;
  }>;
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

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function firstDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function firstDayOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);

  return d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function statusLetter(status: string) {
  const s = String(status || "").toLowerCase().trim();

  if (s === "present" || s === "presente") return "P";
  if (s === "late" || s === "tardy" || s === "atraso" || s === "tarde") return "A";
  if (s === "absent" || s === "ausente" || s === "falta") return "F";

  return s ? s.slice(0, 1).toUpperCase() : "-";
}

function normalizeStatus(status: string) {
  const s = String(status || "").toLowerCase().trim();

  if (s === "present" || s === "presente") return "present";
  if (s === "late" || s === "tardy" || s === "atraso" || s === "tarde") return "late";
  if (s === "absent" || s === "ausente" || s === "falta") return "absent";

  return "unknown";
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

function statusText(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "present") return "Presença";
  if (normalized === "late") return "Atraso";
  if (normalized === "absent") return "Falta";

  return "Registro";
}

function classLabelFromChild(child: any) {
  const cls = child?.active_class?.class;
  if (!cls) return "Sem turma ativa";

  const parts: string[] = [];
  if (cls.name) parts.push(cls.name);
  if (cls.grade) parts.push(cls.grade);
  if (cls.shift) parts.push(cls.shift);

  return parts.join(" • ") || "Sem turma ativa";
}

function MetricCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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

export default function MonthlyPage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();

  const studentId = String(params.studentId || "").trim();

  const initialMonth = useMemo(() => {
    const q = searchParams.get("month");
    if (q && /^\d{4}-\d{2}$/.test(q)) return q;
    return monthKey(new Date());
  }, [searchParams]);

  const [month, setMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(true);

  const [student, setStudent] = useState<StudentRow | null>(null);
  const [studentClassLabel, setStudentClassLabel] = useState<string>("Sem turma ativa");
  const [relationship, setRelationship] = useState<string | null>(null);

  const [dayMap, setDayMap] = useState<Record<string, DayMark[]>>({});
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const monthStart = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, (m || 1) - 1, 1);
  }, [month]);

  const monthEnd = useMemo(() => firstDayOfNextMonth(monthStart), [monthStart]);

  const calendarDays = useMemo(() => {
    const first = firstDayOfMonth(monthStart);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

    const cells: Array<{ date: Date | null; dayNumber?: number }> = [];

    for (let i = 0; i < startWeekday; i++) cells.push({ date: null });

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(first.getFullYear(), first.getMonth(), d), dayNumber: d });
    }

    while (cells.length % 7 !== 0) cells.push({ date: null });

    return cells;
  }, [monthStart]);

  const summary = useMemo(() => {
    let totalMarks = 0;
    let present = 0;
    let late = 0;
    let absent = 0;
    let daysWithRecords = 0;

    for (const key of Object.keys(dayMap)) {
      const marks = dayMap[key] || [];
      if (marks.length > 0) daysWithRecords += 1;

      for (const mark of marks) {
        totalMarks += 1;
        const normalized = normalizeStatus(mark.status);

        if (normalized === "present") present += 1;
        else if (normalized === "late") late += 1;
        else if (normalized === "absent") absent += 1;
      }
    }

    return {
      totalMarks,
      present,
      late,
      absent,
      daysWithRecords,
    };
  }, [dayMap]);

  async function loadStudentAndMonthly() {
    setLoading(true);
    setErrMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      const childrenRes = await fetch("/api/parent/children", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const childrenJson = (await safeJson(childrenRes)) as ParentChildrenResponse | any;

      if (!childrenRes.ok || !childrenJson?.ok) {
        setErrMsg(childrenJson?.error || "Falha ao carregar dados do responsável.");
        if (childrenRes.status === 401) router.replace("/login");
        setStudent(null);
        setDayMap({});
        return;
      }

      const list = Array.isArray(childrenJson.children) ? childrenJson.children : [];
      const found = list.find((x: any) => String(x.id) === studentId) || null;

      if (!found) {
        setErrMsg("Você não tem permissão para ver este aluno (não está vinculado).");
        setStudent(null);
        setDayMap({});
        return;
      }

      setStudent({
        id: found.id,
        full_name: found.full_name ?? null,
        registration_number: found.registration_number ?? null,
        school_id: found.school_id ?? null,
      });

      setRelationship(found.relationship ?? null);
      setStudentClassLabel(classLabelFromChild(found));

      const monthlyRes = await fetch(
        `/api/parent/attendance/monthly?studentId=${encodeURIComponent(studentId)}&month=${encodeURIComponent(
          month
        )}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const monthlyJson = (await safeJson(monthlyRes)) as MonthlyApiPayload | any;

      if (!monthlyRes.ok || !monthlyJson?.ok) {
        setErrMsg(monthlyJson?.error || "Falha ao carregar presença mensal.");
        setDayMap({});
        return;
      }

      const sessions = Array.isArray(monthlyJson.sessions) ? monthlyJson.sessions : [];
      const records = Array.isArray(monthlyJson.records) ? monthlyJson.records : [];

      const sessionById = new Map<
        string,
        { id: string; lesson_date: string; lesson_number: number | null }
      >();

      for (const session of sessions) {
        if (!session?.id) continue;
        sessionById.set(String(session.id), {
          id: String(session.id),
          lesson_date: String(session.lesson_date || "").slice(0, 10),
          lesson_number:
            typeof session.lesson_number === "number" ? session.lesson_number : null,
        });
      }

      const map: Record<string, DayMark[]> = {};

      for (const record of records) {
        const session = sessionById.get(String(record.session_id || ""));
        if (!session?.lesson_date) continue;

        if (!map[session.lesson_date]) map[session.lesson_date] = [];

        map[session.lesson_date].push({
          lessonNumber: session.lesson_number,
          status: String(record.status || ""),
        });
      }

      for (const key of Object.keys(map)) {
        map[key].sort((a, b) => (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0));
      }

      setDayMap(map);
    } catch (e: any) {
      setErrMsg(e?.message || "Erro inesperado ao carregar presença mensal.");
      setDayMap({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudentAndMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, month]);

  function goBack() {
    router.push(`/parent/students/${studentId}`);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl p-4 md:p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-44 rounded-[32px] bg-slate-200" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="h-32 rounded-3xl bg-slate-100" />
              <div className="h-32 rounded-3xl bg-slate-100" />
              <div className="h-32 rounded-3xl bg-slate-100" />
              <div className="h-32 rounded-3xl bg-slate-100" />
            </div>
            <div className="h-[540px] rounded-[32px] bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Acompanhamento escolar
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Presença mensal
                </h1>

                <p className="mt-2 text-sm text-slate-200 md:text-base">
                  Visualize o histórico completo do mês com clareza e organização.
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
                    <span className="font-semibold">Turma:</span> {studentClassLabel}
                    {relationship ? (
                      <>
                        {" "}
                        • <span className="font-semibold">Parentesco:</span> {relationship}
                      </>
                    ) : null}
                  </div>

                  <div>
                    <span className="font-semibold">Mês:</span> {monthLabel(month)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadStudentAndMonthly}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Recarregar
                </button>

                <button
                  type="button"
                  onClick={() => router.push(`/parent/students/${studentId}/daily`)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver diária
                </button>

                <button
                  type="button"
                  onClick={() => router.push(`/parent/students/${studentId}/report-card`)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ver boletim
                </button>

                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Voltar
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
            <MetricCard
              label="Dias com registro"
              value={String(summary.daysWithRecords)}
              help="Dias do mês que possuem ao menos um lançamento de frequência."
            />

            <MetricCard
              label="Presenças"
              value={String(summary.present)}
              help="Total de registros lançados como presença."
            />

            <MetricCard
              label="Atrasos"
              value={String(summary.late)}
              help="Total de registros lançados como atraso."
            />

            <MetricCard
              label="Faltas"
              value={String(summary.absent)}
              help="Total de registros lançados como falta."
            />
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Período e legenda
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Navegue entre os meses e acompanhe o significado de cada marcação.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Mês
                </label>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 sm:w-[220px]"
                />
              </div>

              <button
                onClick={loadStudentAndMonthly}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Atualizar
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              P = Presença
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              A = Atraso
            </span>
            <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
              F = Falta
            </span>
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Sem registros = dia sem lançamento
            </span>
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
              Calendário do mês
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Toque em “abrir” em qualquer dia com registros para ver o detalhe diário.
            </p>
          </div>

          <div className="p-4 md:p-6">
            <div className="grid grid-cols-7 gap-2">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((w) => (
                <div
                  key={w}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {w}
                </div>
              ))}

              {calendarDays.map((cell, idx) => {
                if (!cell.date) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="min-h-[130px] rounded-3xl border border-dashed border-slate-200 bg-slate-50/50"
                    />
                  );
                }

                const dateStr = ymd(cell.date);
                const marks = dayMap[dateStr] || [];
                const dailyHref = `/parent/students/${studentId}/daily?date=${dateStr}`;

                const hasPresent = marks.some((m) => normalizeStatus(m.status) === "present");
                const hasLate = marks.some((m) => normalizeStatus(m.status) === "late");
                const hasAbsent = marks.some((m) => normalizeStatus(m.status) === "absent");

                const dominantClass = hasAbsent
                  ? "border-red-200 bg-red-50/50"
                  : hasLate
                  ? "border-amber-200 bg-amber-50/50"
                  : hasPresent
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-slate-200 bg-white";

                return (
                  <div
                    key={dateStr}
                    className={`min-h-[130px] rounded-3xl border p-3 shadow-sm transition ${dominantClass}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{cell.dayNumber}</div>

                      <Link
                        href={dailyHref}
                        className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-100"
                      >
                        abrir
                      </Link>
                    </div>

                    <div className="mt-3">
                      {marks.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          Sem registros
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {marks.map((mark, markIdx) => (
                            <span
                              key={`${dateStr}-${markIdx}-${mark.lessonNumber ?? "x"}`}
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusBadgeClass(
                                mark.status
                              )}`}
                            >
                              {mark.lessonNumber ? `${mark.lessonNumber}ª ` : ""}
                              {statusLetter(mark.status)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {marks.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {marks.slice(0, 3).map((mark, markIdx) => (
                          <div
                            key={`detail-${dateStr}-${markIdx}`}
                            className="text-[11px] text-slate-600"
                          >
                            {mark.lessonNumber ? `${mark.lessonNumber}ª aula` : "Aula"} •{" "}
                            {statusText(mark.status)}
                          </div>
                        ))}

                        {marks.length > 3 ? (
                          <div className="text-[11px] text-slate-500">
                            +{marks.length - 3} registro(s)
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 text-sm text-slate-500">
              Dica: clique em <b>abrir</b> em qualquer dia para consultar a presença diária detalhada.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}