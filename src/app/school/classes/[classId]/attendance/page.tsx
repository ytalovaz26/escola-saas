"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RosterRow = {
  student_id: string;
  full_name: string | null;
  registration_number: string | null;
};

type MarkRow = {
  student_id: string;
  status: "present" | "absent";
  note: string | null;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function AttendancePage() {
  const router = useRouter();
  const params = useParams<{ classId: string }>();
  const classId = params.classId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkRow>>({});

  // ✅ trava edição após salvar (pode destravar clicando em "Editar")
  const [isLocked, setIsLocked] = useState(false);

  async function ensureToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  function ensureMark(studentId: string) {
    return (
      marks[studentId] || {
        student_id: studentId,
        status: "present" as const,
        note: null,
      }
    );
  }

  function setStatus(studentId: string, status: "present" | "absent") {
    if (isLocked) return;
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { student_id: studentId, note: null }),
        status,
      },
    }));
  }

  const counts = useMemo(() => {
    let p = 0;
    let f = 0;
    for (const r of roster) {
      const st = ensureMark(r.student_id).status;
      if (st === "present") p++;
      else f++;
    }
    return { p, f };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, marks]);

  function setAllPresent() {
    if (isLocked) return;
    setMarks((prev) => {
      const next = { ...prev };
      for (const r of roster) {
        next[r.student_id] = {
          ...(next[r.student_id] || { student_id: r.student_id, note: null }),
          status: "present",
        };
      }
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    // ao trocar data/turma, destrava automaticamente
    setIsLocked(false);

    const token = await ensureToken();
    if (!token) return;

    try {
      const res = await fetch(
        `/api/attendance/roster?classId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: text || "Resposta inválida do servidor" };
      }

      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Falha ao carregar presença.");
        return;
      }

      const r: RosterRow[] = json.roster || [];
      const m: MarkRow[] = json.marks || [];

      const map: Record<string, MarkRow> = {};
      for (const row of m) map[row.student_id] = row;

      // default: se não existe marca, assume presente
      for (const st of r) {
        if (!map[st.student_id]) {
          map[st.student_id] = {
            student_id: st.student_id,
            status: "present",
            note: null,
          };
        }
      }

      setRoster(r);
      setMarks(map);
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
        return { studentId: r.student_id, status: mk.status, note: mk.note };
      });

      const res = await fetch("/api/attendance/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ classId, date, items }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: text || "Resposta inválida do servidor" };
      }

      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Falha ao salvar presença.");
        return;
      }

      setMsg("Presença salva com sucesso ✅");

      // ✅ trava após salvar
      setIsLocked(true);

      // opcional: recarrega do servidor para garantir que está tudo persistido
      await load();
      setIsLocked(true);
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, classId]);

  if (loading) {
    return (
      <main className="p-4 md:p-6">
        <div className="max-w-4xl mx-auto">Carregando...</div>
      </main>
    );
  }

  if (err) {
    return (
      <main className="p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">Presença</h1>
          <p className="text-red-600">{err}</p>
          <div className="flex gap-2 flex-wrap">
            <button className="border px-4 py-2 rounded" onClick={() => router.push("/school/classes")}>
              Voltar
            </button>
            <button className="border px-4 py-2 rounded" onClick={load}>
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-start md:items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Presença</h1>
            <p className="text-xs text-gray-600">
              Turma: <span className="font-mono break-all">{classId}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <button className="border px-4 py-2 rounded" onClick={() => router.push("/school/classes")}>
              Voltar
            </button>
            <button className="border px-4 py-2 rounded" onClick={load}>
              Recarregar
            </button>
          </div>
        </div>

        {/* Controles */}
        <div className="bg-white border rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-xs text-gray-600 mb-1">Data</div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border px-3 py-2 rounded w-full md:w-auto"
              />
            </div>

            <div className="border rounded px-4 py-2 font-medium w-fit">
              Presente: {counts.p} / Falta: {counts.f}
            </div>

            {isLocked && (
              <div className="text-xs text-gray-600">
                Edição bloqueada após salvar. Clique em <b>Editar</b> se precisar alterar.
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap md:justify-end">
            <button
              className="border px-4 py-2 rounded disabled:opacity-60"
              onClick={setAllPresent}
              disabled={roster.length === 0 || isLocked}
              title="Marca todos como presentes"
            >
              Marcar todos P
            </button>

            <button
              className="border px-4 py-2 rounded disabled:opacity-60"
              onClick={() => setIsLocked(false)}
              disabled={!isLocked}
              title="Desbloqueia para editar"
            >
              Editar
            </button>

            <button
              className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
              onClick={save}
              disabled={saving || roster.length === 0}
            >
              {saving ? "Salvando..." : "Salvar presença"}
            </button>
          </div>
        </div>

        {msg && <div className="text-green-700">{msg}</div>}

        {/* Lista */}
        {roster.length === 0 ? (
          <div className="text-gray-600">Nenhum aluno ativo nesta turma na data selecionada.</div>
        ) : (
          <>
            {/* MOBILE: Cards */}
            <div className="grid gap-3 md:hidden">
              {roster.map((r) => {
                const mk = ensureMark(r.student_id);
                return (
                  <div key={r.student_id} className="bg-white border rounded-xl p-4">
                    <div className="font-semibold">{r.full_name || "—"}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      Matrícula: <b>{r.registration_number || "—"}</b>
                    </div>
                    <div className="text-xs text-gray-500 font-mono break-all mt-2">{r.student_id}</div>

                    <div className="mt-3 flex gap-2">
                      <button
                        className={`flex-1 border rounded-lg py-3 text-lg font-semibold ${
                          mk.status === "present" ? "bg-black text-white" : ""
                        } ${isLocked ? "opacity-60" : ""}`}
                        onClick={() => setStatus(r.student_id, "present")}
                        disabled={isLocked}
                      >
                        P
                      </button>
                      <button
                        className={`flex-1 border rounded-lg py-3 text-lg font-semibold ${
                          mk.status === "absent" ? "bg-black text-white" : ""
                        } ${isLocked ? "opacity-60" : ""}`}
                        onClick={() => setStatus(r.student_id, "absent")}
                        disabled={isLocked}
                      >
                        F
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP: Tabela */}
            <div className="hidden md:block bg-white border rounded-xl overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-3 px-3 text-left">Aluno</th>
                    <th className="py-3 px-3 text-left">Matrícula</th>
                    <th className="py-3 px-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const mk = ensureMark(r.student_id);
                    return (
                      <tr key={r.student_id} className="border-b">
                        <td className="py-3 px-3">
                          <div className="font-medium">{r.full_name || "—"}</div>
                          <div className="text-xs text-gray-500 font-mono break-all">{r.student_id}</div>
                        </td>
                        <td className="py-3 px-3">{r.registration_number || "—"}</td>
                        <td className="py-3 px-3">
                          <div className="flex gap-2">
                            <button
                              className={`border rounded px-4 py-2 font-semibold ${
                                mk.status === "present" ? "bg-black text-white" : ""
                              } ${isLocked ? "opacity-60" : ""}`}
                              onClick={() => setStatus(r.student_id, "present")}
                              disabled={isLocked}
                            >
                              P
                            </button>
                            <button
                              className={`border rounded px-4 py-2 font-semibold ${
                                mk.status === "absent" ? "bg-black text-white" : ""
                              } ${isLocked ? "opacity-60" : ""}`}
                              onClick={() => setStatus(r.student_id, "absent")}
                              disabled={isLocked}
                            >
                              F
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
