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
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; // YYYY-MM
}

function firstDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function firstDayOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function statusLetter(status: string) {
  const s = String(status || "").toLowerCase();

  // EN
  if (s === "present") return "P";
  if (s === "late" || s === "tardy") return "A";
  if (s === "absent") return "F";

  // PT (caso algum lugar grave assim)
  if (s === "presente") return "P";
  if (s === "tarde" || s === "atraso") return "A";
  if (s === "ausente" || s === "falta") return "F";

  return s ? s.slice(0, 1).toUpperCase() : "-";
}

export default function MonthlyPage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();

  const studentId = params.studentId;

  const initialMonth = useMemo(() => {
    const q = searchParams.get("month");
    if (q && /^\d{4}-\d{2}$/.test(q)) return q;
    return monthKey(new Date());
  }, [searchParams]);

  const [month, setMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(true);

  const [student, setStudent] = useState<StudentRow | null>(null);
  const [dayMap, setDayMap] = useState<Record<string, DayMark[]>>({});
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const monthStart = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1);
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

  async function loadStudentAndMonthly() {
    setLoading(true);
    setErrMsg(null);

    try {
      // 1) valida sessão
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      // 2) aluno do responsável
      const res = await fetch("/api/parent/children", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setErrMsg(json?.error || "Falha ao carregar dados do responsável.");
        if (res.status === 401) router.replace("/login");
        setStudent(null);
        setDayMap({});
        setLoading(false);
        return;
      }

      const list = (json.children ?? []) as any[];
      const found = list.find((x) => x.id === studentId) || null;

      if (!found) {
        setErrMsg("Você não tem permissão para ver este aluno (não está vinculado).");
        setStudent(null);
        setDayMap({});
        setLoading(false);
        return;
      }

      setStudent({
        id: found.id,
        full_name: found.full_name ?? null,
        registration_number: found.registration_number ?? null,
        school_id: found.school_id ?? null,
      });

      const startYMD = ymd(monthStart);
      const endYMD = ymd(monthEnd);

      // ✅ ÚNICA fonte: attendance_records_view (igual professor registrou)
      const { data: rows, error } = await supabase
        .from("attendance_records_view")
        .select("lesson_date, lesson_number, status, student_id")
        .eq("student_id", studentId)
        .gte("lesson_date", startYMD)
        .lt("lesson_date", endYMD)
        .order("lesson_date", { ascending: true })
        .order("lesson_number", { ascending: true });

      if (error) {
        setErrMsg(`Falha ao carregar do relatório (attendance_records_view): ${error.message}`);
        setDayMap({});
        setLoading(false);
        return;
      }

      const map: Record<string, DayMark[]> = {};

      for (const r of rows || []) {
        const dateStr = String((r as any).lesson_date || "").slice(0, 10);
        if (!dateStr) continue;

        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push({
          lessonNumber: (r as any).lesson_number ?? null,
          status: (r as any).status,
        });
      }

      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0));
      }

      setDayMap(map);
      setLoading(false);
    } catch (e: any) {
      setErrMsg(e?.message || "Erro inesperado ao carregar presença mensal.");
      setDayMap({});
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

  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Presença mensal</h1>

          <div className="mt-2 text-sm text-gray-700">
            <div>
              <b>Mês:</b> {month}
            </div>
            <div>
              <b>Aluno:</b> {student?.full_name ?? "—"}{" "}
              {student?.registration_number ? (
                <>
                  • <b>Matrícula:</b> {student.registration_number}
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm">Selecionar mês:</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border rounded-lg px-2 py-1 text-sm"
            />
            <button
              onClick={loadStudentAndMonthly}
              className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-50"
            >
              Recarregar
            </button>
          </div>

          <div className="mt-2 text-sm text-gray-700">
            <b>P</b> = presentes | <b>A</b> = atrasos | <b>F</b> = faltas
          </div>

          {errMsg ? (
            <div className="mt-3 text-sm text-red-600 border border-red-200 bg-red-50 rounded-xl p-3">
              {errMsg}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={goBack} className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-50">
            Voltar
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[720px] w-full border-collapse">
          <thead>
            <tr className="text-left text-sm">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((w) => (
                <th key={w} className="border p-2 bg-gray-50">
                  {w}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: calendarDays.length / 7 }).map((_, weekIdx) => {
              const row = calendarDays.slice(weekIdx * 7, weekIdx * 7 + 7);

              return (
                <tr key={weekIdx} className="align-top">
                  {row.map((cell, idx) => {
                    if (!cell.date) return <td key={idx} className="border p-2 h-24" />;

                    const dateStr = ymd(cell.date);
                    const marks = dayMap[dateStr] || [];

                    const summary =
                      marks.length === 0
                        ? "Sem registros"
                        : marks.length === 1
                        ? statusLetter(marks[0].status)
                        : `${statusLetter(marks[0].status)}(${marks.length})`;

                    const dailyHref = `/parent/students/${studentId}/daily?date=${dateStr}`;

                    return (
                      <td key={idx} className="border p-2 h-24">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{cell.dayNumber}</div>
                          <Link href={dailyHref} className="text-xs text-blue-600 underline">
                            abrir
                          </Link>
                        </div>

                        <div className="mt-1 text-sm">{summary}</div>

                        {marks.length > 1 ? (
                          <div className="mt-1 text-xs text-gray-600">
                            {marks
                              .map((m) =>
                                m.lessonNumber
                                  ? `${m.lessonNumber}:${statusLetter(m.status)}`
                                  : statusLetter(m.status)
                              )
                              .join(" • ")}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-3 text-sm text-gray-600">
          Dica: clique em <b>abrir</b> para ir para a presença diária.
        </div>
      </div>

      {loading ? <div className="mt-4 text-sm text-gray-600">Carregando...</div> : null}
    </div>
  );
}