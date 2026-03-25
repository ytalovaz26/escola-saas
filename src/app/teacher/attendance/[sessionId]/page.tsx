"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiClient";

type Session = {
  id: string;
  class_id: string;
  lesson: string;
  date: string;
};

type StudentRow = {
  student_id: string;
  full_name: string;
  present: boolean;
  marked_at?: string | null;
};

type AttendanceListResponse =
  | { ok: true; session: Session; students: StudentRow[] }
  | { ok: false; error?: string; details?: string };

type MeOk = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: { parentId: string; schoolId: string };
  redirectTo: string;
};

type MeErr = { ok: false; error?: string };
type MeResponse = MeOk | MeErr;

export default function TeacherAttendanceSessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = String((params as any)?.sessionId || "");

  const [loading, setLoading] = useState(true);
  const [meOk, setMeOk] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});

  const presentCount = useMemo(() => students.filter((s) => s.present).length, [students]);
  const totalCount = students.length;

  async function validateMe() {
    try {
      const res = await apiFetch("/api/me", { method: "GET" });
      const data = (await res.json()) as MeResponse;

      if (!res.ok || !data || (data as any).ok !== true) {
        setMeOk(false);
        router.replace("/login");
        return;
      }

      const redirectTo = (data as MeOk).redirectTo;
      if (redirectTo !== "/teacher") {
        router.replace("/api/me");
        return;
      }

      setMeOk(true);
    } catch {
      setMeOk(false);
      setError("Falha ao validar sessão do usuário.");
    }
  }

  async function loadAttendance() {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/teacher/attendance/list?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "GET",
      });
      const data = (await res.json()) as AttendanceListResponse;

      if (!res.ok || !data.ok) {
        setError((data as any)?.error || "Erro ao carregar presença.");
        setSession(null);
        setStudents([]);
        return;
      }

      setSession(data.session);
      setStudents(data.students || []);
    } catch {
      setError("Falha ao carregar dados da presença.");
      setSession(null);
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }

  async function setPresent(studentId: string, present: boolean) {
    setError(null);
    setSavingMap((m) => ({ ...m, [studentId]: true }));

    // otimista
    setStudents((prev) => prev.map((s) => (s.student_id === studentId ? { ...s, present } : s)));

    try {
      const res = await apiFetch("/api/teacher/attendance/mark", {
        method: "POST",
        body: JSON.stringify({ sessionId, studentId, present }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setStudents((prev) => prev.map((s) => (s.student_id === studentId ? { ...s, present: !present } : s)));
        setError(data?.error || "Erro ao marcar presença.");
        return;
      }

      setStudents((prev) =>
        prev.map((s) =>
          s.student_id === studentId ? { ...s, present, marked_at: new Date().toISOString() } : s
        )
      );
    } catch {
      setStudents((prev) => prev.map((s) => (s.student_id === studentId ? { ...s, present: !present } : s)));
      setError("Falha ao salvar marca de presença.");
    } finally {
      setSavingMap((m) => ({ ...m, [studentId]: false }));
    }
  }

  useEffect(() => {
    validateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (meOk) loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meOk, sessionId]);

  if (!meOk && loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse text-sm text-gray-600">Carregando...</div>
      </div>
    );
  }

  if (!meOk && !loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">Sem permissão.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Presença</h1>
          <p className="text-sm text-gray-600">Sessão: {sessionId}</p>
          {session && (
            <p className="text-sm text-gray-700">
              <span className="font-medium">{session.lesson}</span> — {session.date}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {session?.class_id && (
            <button
              onClick={() => router.push(`/teacher/classes/${session.class_id}`)}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Voltar para turma
            </button>
          )}
          <button
            onClick={loadAttendance}
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            disabled={loading}
          >
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          <span className="font-medium">{presentCount}</span> presentes de{" "}
          <span className="font-medium">{totalCount}</span> alunos
        </div>
        <div className="text-xs text-gray-500">Marcação salva automaticamente ao clicar.</div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        {loading ? (
          <div className="text-sm text-gray-600">Carregando alunos...</div>
        ) : students.length === 0 ? (
          <div className="text-sm text-gray-600">Nenhum aluno ativo nessa turma.</div>
        ) : (
          <div className="space-y-2">
            {students.map((st) => {
              const saving = Boolean(savingMap[st.student_id]);
              return (
                <div key={st.student_id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{st.full_name || "Aluno sem nome"}</div>
                    <div className="text-xs text-gray-500 truncate">{st.student_id}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPresent(st.student_id, true)}
                      disabled={saving}
                      className={`rounded-md px-3 py-1.5 text-sm text-white hover:opacity-90 ${
                        st.present ? "bg-green-600" : "bg-gray-700"
                      }`}
                    >
                      {saving && st.present ? "Salvando..." : "Presente"}
                    </button>

                    <button
                      onClick={() => setPresent(st.student_id, false)}
                      disabled={saving}
                      className={`rounded-md px-3 py-1.5 text-sm text-white hover:opacity-90 ${
                        !st.present ? "bg-red-600" : "bg-gray-700"
                      }`}
                    >
                      {saving && !st.present ? "Salvando..." : "Faltou"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
