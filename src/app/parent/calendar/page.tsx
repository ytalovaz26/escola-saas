export const dynamic = "force-dynamic";

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StudentRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
};

type CalendarEventRow = {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

export default function ParentCalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialStudentId = searchParams.get("studentId") || "all";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);

  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialStudentId);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();

    for (const ev of events) {
      const day = new Date(ev.starts_at).toISOString().slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(ev);
      map.set(day, arr);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
      map.set(k, arr);
    }

    return map;
  }, [events]);

  const sortedDays = useMemo(() => {
    const days = Array.from(eventsByDay.keys());
    days.sort((a, b) => (a < b ? -1 : 1));
    return days;
  }, [eventsByDay]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const text = await meRes.text();
        let me: any = null;

        try {
          me = text ? JSON.parse(text) : null;
        } catch {
          me = { ok: false, error: text || "Resposta inválida do servidor" };
        }

        if (!meRes.ok || !me?.ok || !me?.parent?.parentId) {
          router.replace(me?.redirectTo || "/login");
          return;
        }

        const { data: stData, error: stErr } = await supabase
          .from("students")
          .select("id, full_name, registration_number")
          .order("full_name", { ascending: true });

        if (stErr) {
          setError("Erro ao carregar filhos: " + stErr.message);
          return;
        }

        setStudents((stData ?? []) as StudentRow[]);

        const { data: evData, error: evErr } = await supabase
          .from("calendar_events")
          .select("id, school_id, title, description, starts_at, ends_at, created_at")
          .order("starts_at", { ascending: true });

        if (evErr) {
          setError("Erro ao carregar agenda: " + evErr.message);
          return;
        }

        setEvents((evData ?? []) as CalendarEventRow[]);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  function formatDayBR(yyyyMmDd: string) {
    const [y, m, d] = yyyyMmDd.split("-").map((x) => Number(x));
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  function formatTimeBR(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const studentLabel = useMemo(() => {
    if (selectedStudentId === "all") return "Todos os filhos";
    const s = students.find((x) => x.id === selectedStudentId);
    return s ? s.full_name : "Filho selecionado";
  }, [selectedStudentId, students]);

  if (loading) return <div>Carregando...</div>;
  if (error) return <div className="text-red-600">Erro: {error}</div>;

  return (
    <section className="bg-white rounded-2xl shadow p-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agenda</h1>
          <p className="text-sm text-gray-600 mt-1">{studentLabel} • eventos da escola</p>
        </div>

        <div className="w-full sm:w-80">
          <div className="text-xs text-gray-600 mb-1">Filtrar por filho (UI)</div>
          <select
            className="border rounded-xl p-3 w-full"
            value={selectedStudentId}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedStudentId(v);
              const qs = v === "all" ? "" : `?studentId=${encodeURIComponent(v)}`;
              router.replace(`/parent/calendar${qs}`);
            }}
          >
            <option value="all">Todos</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {sortedDays.length === 0 ? (
        <p className="text-sm text-gray-600 mt-4">Nenhum evento cadastrado ainda.</p>
      ) : (
        <div className="mt-5 space-y-5">
          {sortedDays.map((day) => (
            <div key={day} className="border rounded-2xl p-4">
              <div className="font-semibold capitalize">{formatDayBR(day)}</div>

              <div className="mt-3 space-y-3">
                {(eventsByDay.get(day) ?? []).map((ev) => (
                  <div key={ev.id} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{ev.title}</div>
                        <div className="text-xs text-gray-600 mt-1">
                          {formatTimeBR(ev.starts_at)}
                          {ev.ends_at ? ` • até ${formatTimeBR(ev.ends_at)}` : ""}
                        </div>
                      </div>

                      <div className="text-[11px] text-gray-500 font-mono">{ev.id.slice(0, 8)}…</div>
                    </div>

                    {ev.description ? (
                      <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
                        {ev.description}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}