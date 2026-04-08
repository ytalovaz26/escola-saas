"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ClassRow = {
  id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

type StudentRow = {
  id: string;
  full_name: string;
  birth_date: string | null;
  registration_number: string | null;
};

type StudentActiveClassRow = {
  student_id: string;
  class_id: string;
};

function initials(name: string) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "AL";
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

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [links, setLinks] = useState<StudentActiveClassRow[]>([]);

  const [filterClassId, setFilterClassId] = useState("");

  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMap = useMemo(() => {
    const map = new Map<string, string>();
    links.forEach((l) => map.set(l.student_id, l.class_id));
    return map;
  }, [links]);

  const classMap = useMemo(() => {
    const map = new Map<string, ClassRow>();
    classes.forEach((c) => map.set(c.id, c));
    return map;
  }, [classes]);

  const filtered = useMemo(() => {
    if (!filterClassId) return students;
    return students.filter((s) => activeMap.get(s.id) === filterClassId);
  }, [students, filterClassId, activeMap]);

  async function loadAll() {
    setError(null);

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      setError(sessionError.message);
      router.replace("/login");
      return;
    }

    if (!sessionData.session) {
      router.replace("/login");
      return;
    }

    const token = sessionData.session.access_token;

    try {
      const [cRes, sRes] = await Promise.all([
        fetch("/api/school/classes", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/school/students", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const cJson = await safeJson(cRes);
      const sJson = await safeJson(sRes);

      if (!cRes.ok || !cJson?.ok) {
        setError(cJson?.error || "Erro ao carregar turmas.");
        setClasses([]);
      } else {
        const loadedClasses = cJson.classes || [];
        setClasses(loadedClasses);

        if (!selectedClassId && loadedClasses[0]?.id) {
          setSelectedClassId(loadedClasses[0].id);
        }
      }

      if (!sRes.ok || !sJson?.ok) {
        setError((prev) => prev || sJson?.error || "Erro ao carregar alunos.");
        setStudents([]);
      } else {
        setStudents(sJson.students || []);
      }

      const { data: linksData, error: linksError } = await supabase
        .from("student_classes")
        .select("student_id,class_id")
        .eq("is_active", true);

      if (linksError) {
        setError((prev) => prev || `Erro ao carregar vínculos: ${linksError.message}`);
        setLinks([]);
      } else {
        setLinks(linksData || []);
      }

      const classFromUrl = searchParams.get("classId");
      if (classFromUrl) {
        setFilterClassId(classFromUrl);
      }
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar dados.");
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadAll();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createStudent() {
    if (!fullName.trim()) {
      setError("Informe o nome completo do aluno.");
      return;
    }

    if (!selectedClassId) {
      setError("Selecione a turma do aluno.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        setError(sessionError.message);
        return;
      }

      const token = sessionData.session?.access_token;

      if (!token) {
        setError("Sessão inválida. Faça login novamente.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/school/students/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          birth_date: birthDate || null,
          registration_number: registrationNumber.trim() || null,
          class_id: selectedClassId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao criar aluno.");
        return;
      }

      setFullName("");
      setBirthDate("");
      setRegistrationNumber("");

      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao cadastrar aluno.");
    } finally {
      setSaving(false);
    }
  }

  async function changeClass(studentId: string, classId: string) {
    if (!classId) return;

    try {
      setSaving(true);
      setError(null);

      const { error: rpcError } = await supabase.rpc("set_active_class", {
        p_student_id: studentId,
        p_class_id: classId,
      });

      if (rpcError) {
        setError(`Erro ao trocar turma: ${rpcError.message}`);
        return;
      }

      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao trocar turma.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="p-6">
        <div className="animate-pulse h-32 bg-white rounded-3xl" />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="rounded-[28px] bg-gradient-to-r from-slate-900 to-slate-700 text-white p-6">
        <h1 className="text-3xl font-semibold">Gestão de Alunos</h1>
        <p className="text-sm mt-2 text-slate-200">
          Controle completo dos alunos e suas turmas com histórico automático.
        </p>
      </section>

      {error ? (
        <section className="bg-red-50 border border-red-200 text-red-700 rounded-3xl p-4">
          {error}
        </section>
      ) : null}

      <section className="bg-white rounded-3xl p-6 border">
        <h2 className="font-semibold mb-4">Cadastrar aluno</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <input
            placeholder="Nome completo"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />

          <select
            className="input"
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
          >
            <option value="">Selecione a turma</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.grade ? ` • ${c.grade}` : ""}
                {c.shift ? ` • ${c.shift}` : ""}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="input"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />

          <input
            placeholder="Matrícula"
            className="input"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
          />
        </div>

        <button
          onClick={createStudent}
          disabled={saving}
          className="btn btn-primary mt-4 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Cadastrar aluno"}
        </button>
      </section>

      <section className="bg-white rounded-3xl p-6 border">
        <select
          className="input max-w-sm"
          value={filterClassId}
          onChange={(e) => setFilterClassId(e.target.value)}
        >
          <option value="">Todas as turmas</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.grade ? ` • ${c.grade}` : ""}
              {c.shift ? ` • ${c.shift}` : ""}
            </option>
          ))}
        </select>
      </section>

      <section className="bg-white rounded-3xl border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            Nenhum aluno encontrado
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((s) => {
              const classId = activeMap.get(s.id);
              const cls = classMap.get(classId || "");

              return (
                <div
                  key={s.id}
                  className="p-5 flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-slate-900 text-white rounded-xl w-12 h-12 flex items-center justify-center">
                      {initials(s.full_name)}
                    </div>

                    <div>
                      <div className="font-semibold">{s.full_name}</div>
                      <div className="text-xs text-slate-500">
                        {s.registration_number || "Sem matrícula"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="text-sm text-slate-600 min-w-[140px]">
                      {cls?.name || "Sem turma"}
                    </div>

                    <select
                      className="input"
                      value={classId || ""}
                      onChange={(e) => changeClass(s.id, e.target.value)}
                      disabled={saving}
                    >
                      <option value="">Trocar</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}