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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<string | null>(null);
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

  async function getAccessToken() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      throw new Error(sessionError?.message || "Not authenticated");
    }

    return sessionData.session.access_token;
  }

  async function loadAll() {
    setError(null);

    try {
      const token = await getAccessToken();

      const [cRes, sRes, linksRes] = await Promise.all([
        fetch("/api/school/classes", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/school/students", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/school/class-students/list", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const cJson = await safeJson(cRes);
      const sJson = await safeJson(sRes);
      const linksJson = await safeJson(linksRes);

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

      if (!linksRes.ok || !linksJson?.ok) {
        setError((prev) => prev || linksJson?.error || "Erro ao carregar vínculos.");
        setLinks([]);
      } else {
        setLinks(linksJson.links || []);
      }

      const classFromUrl = searchParams.get("classId");
      if (classFromUrl) {
        setFilterClassId(classFromUrl);
      }
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao carregar dados.";
      setError(msg);

      if (msg === "Not authenticated" || String(msg).toLowerCase().includes("sessão")) {
        router.replace("/login");
      }
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

      const token = await getAccessToken();

      const res = await fetch("/api/school/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          birth_date: birthDate || null,
          registration_number: registrationNumber.trim() || null,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok || !json?.student?.id) {
        setError(json?.error || "Erro ao cadastrar aluno.");
        return;
      }

      const studentId = json.student.id as string;

      const assignRes = await fetch("/api/school/class-students/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: studentId,
          class_id: selectedClassId,
        }),
      });

      const assignJson = await safeJson(assignRes);

      if (!assignRes.ok || !assignJson?.ok) {
        setError(assignJson?.error || "Aluno criado, mas houve erro ao vincular à turma.");
        await loadAll();
        return;
      }

      setFullName("");
      setBirthDate("");
      setRegistrationNumber("");

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao cadastrar aluno.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeClass(studentId: string, classId: string) {
    if (!classId) return;

    try {
      setSaving(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/school/class-students/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: studentId,
          class_id: classId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao trocar turma.");
        return;
      }

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao trocar turma.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setSaving(false);
    }
  }

  async function unassignStudent(studentId: string, studentName: string) {
    const confirmed = window.confirm(
      `Deseja remover o aluno "${studentName}" da turma atual?`
    );

    if (!confirmed) return;

    try {
      setUnassigningId(studentId);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/school/class-students/unassign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: studentId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao remover aluno da turma.");
        return;
      }

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao remover vínculo da turma.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setUnassigningId(null);
    }
  }

  async function deleteStudent(studentId: string, studentName: string) {
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir o aluno "${studentName}"?`
    );

    if (!confirmed) return;

    try {
      setDeletingId(studentId);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch(`/api/school/students/${studentId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(
          json?.error ||
            "Não foi possível excluir o aluno. Se ele possui histórico, remova o vínculo da turma antes."
        );
        return;
      }

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao excluir aluno.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setDeletingId(null);
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

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
                    <div className="text-sm text-slate-600 min-w-[140px]">
                      {cls?.name || "Sem turma"}
                    </div>

                    <select
                      className="input"
                      value={classId || ""}
                      onChange={(e) => changeClass(s.id, e.target.value)}
                      disabled={saving || deletingId === s.id || unassigningId === s.id}
                    >
                      <option value="">Trocar</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    {classId ? (
                      <button
                        type="button"
                        onClick={() => unassignStudent(s.id, s.full_name)}
                        disabled={saving || deletingId === s.id || unassigningId === s.id}
                        className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        {unassigningId === s.id ? "Removendo..." : "Remover da turma"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => deleteStudent(s.id, s.full_name)}
                      disabled={saving || deletingId === s.id || unassigningId === s.id}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                    >
                      {deletingId === s.id ? "Excluindo..." : "Excluir"}
                    </button>
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