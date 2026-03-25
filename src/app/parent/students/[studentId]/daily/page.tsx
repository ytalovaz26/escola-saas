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
  lesson_date: string; // DATE ou timestamp
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
  // cria Date local sem timezone shift
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function statusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "present") return "Presente";
  if (s === "late" || s === "atraso") return "Atraso";
  if (s === "absent" || s === "falta") return "Falta";
  return status || "-";
}

export default function DailyAttendancePage() {
  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();

  const studentId = params.studentId;

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

  async function loadDaily() {
    setLoading(true);
    setErrMsg(null);

    try {
      // 1) aluno (usa registration_number, que é o seu campo real)
      const { data: st, error: stErr } = await supabase
        .from("students")
        .select("id, full_name, registration_number")
        .eq("id", studentId)
        .maybeSingle();

      if (stErr || !st) {
        setErrMsg("Aluno não encontrado ou sem permissão.");
        setStudent(null);
        setRecords([]);
        setLoading(false);
        return;
      }

      setStudent(st);

      // 2) RANGE DO DIA (resolve DATE vs TIMESTAMP)
      const dayStart = parseYMDToLocalDate(dateYMD);
      const nextDay = addDays(dayStart, 1);

      const start = ymd(dayStart);      // YYYY-MM-DD
      const end = ymd(nextDay);         // YYYY-MM-DD do dia seguinte

      // pega todas as sessões daquele dia (mesmo que lesson_date seja DATE ou timestamp)
      const { data: sessions, error: sErr } = await supabase
        .from("attendance_sessions")
        .select("id, lesson_date, lesson_number")
        .gte("lesson_date", start)
        .lt("lesson_date", end)
        .order("lesson_number", { ascending: true });

      if (sErr) {
        setErrMsg(`Erro ao buscar sessões do dia: ${sErr.message}`);
        setRecords([]);
        setLoading(false);
        return;
      }

      const sess = (sessions || []) as SessionRow[];

      if (sess.length === 0) {
        setRecords([]);
        setLoading(false);
        return;
      }

      const sessionIds = sess.map((x) => x.id);

      // 3) records do aluno para essas sessões
      const { data: recs, error: rErr } = await supabase
        .from("attendance_records")
        .select("session_id, status, note")
        .eq("student_id", studentId)
        .in("session_id", sessionIds);

      if (rErr) {
        setErrMsg(`Erro ao buscar registros do dia: ${rErr.message}`);
        setRecords([]);
        setLoading(false);
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
      setLoading(false);
    } catch (e: any) {
      setErrMsg(e?.message || "Erro inesperado.");
      setRecords([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDaily();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, dateYMD]);

  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Presença diária</h1>

          <div className="mt-2 text-sm text-gray-700">
            <div>
              <b>Data:</b> {dateYMD}
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
            <label className="text-sm">Selecionar data:</label>
            <input
              type="date"
              value={dateYMD}
              onChange={(e) => setDateYMD(e.target.value)}
              className="border rounded-lg px-2 py-1 text-sm"
            />
            <button onClick={loadDaily} className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-50">
              Recarregar
            </button>
          </div>

          {errMsg ? (
            <div className="mt-3 text-sm text-red-600 border border-red-200 bg-red-50 rounded-xl p-3">
              {errMsg}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={() => router.push(`/parent/students/${studentId}/monthly`)} className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-50">
            Ver mensal
          </button>
          <button onClick={() => router.push(`/parent/students/${studentId}`)} className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-50">
            Voltar
          </button>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="text-sm text-gray-600">Carregando...</div>
        ) : records.length === 0 ? (
          <div className="text-sm text-gray-700">Nenhum registro de presença nesta data.</div>
        ) : (
          <div className="space-y-2">
            {records.map(({ session, record }) => (
              <div key={session.id} className="border rounded-xl p-3">
                <div className="text-sm">
                  <b>Aula:</b> {session.lesson_number ?? "—"} • <b>Status:</b> {statusLabel(record.status)}
                </div>
                {record.note ? <div className="text-xs text-gray-600 mt-1">{record.note}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Dica: se quiser voltar pro aluno,{" "}
        <Link href={`/parent/students/${studentId}`} className="underline">
          clique aqui
        </Link>
        .
      </div>
    </div>
  );
}