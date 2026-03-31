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
  const parts = name.split(" ");
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace("/login");

      const token = data.session.access_token;

      const [cRes, sRes] = await Promise.all([
        fetch("/api/school/classes", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/school/students", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const cJson = await cRes.json();
      const sJson = await sRes.json();

      setClasses(cJson.classes || []);
      setStudents(sJson.students || []);

      const { data: linksData } = await supabase
        .from("student_classes")
        .select("student_id,class_id")
        .eq("is_active", true);

      setLinks(linksData || []);

      const classFromUrl = searchParams.get("classId");
      if (classFromUrl) setFilterClassId(classFromUrl);

      setLoading(false);
    })();
  }, []);

  async function createStudent() {
    if (!fullName || !selectedClassId) return;

    setSaving(true);

    const { data } = await supabase
      .from("students")
      .insert({
        full_name: fullName,
        birth_date: birthDate || null,
        registration_number: registrationNumber || null,
      })
      .select("id")
      .single();

    await supabase.rpc("set_active_class", {
      p_student_id: data.id,
      p_class_id: selectedClassId,
    });

    window.location.reload();
  }

  async function changeClass(studentId: string, classId: string) {
    await supabase.rpc("set_active_class", {
      p_student_id: studentId,
      p_class_id: classId,
    });

    window.location.reload();
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
      {/* HERO */}
      <section className="rounded-[28px] bg-gradient-to-r from-slate-900 to-slate-700 text-white p-6">
        <h1 className="text-3xl font-semibold">Gestão de Alunos</h1>
        <p className="text-sm mt-2 text-slate-200">
          Controle completo dos alunos e suas turmas com histórico automático.
        </p>
      </section>

      {/* CADASTRO */}
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

        <button onClick={createStudent} className="btn btn-primary mt-4">
          {saving ? "Salvando..." : "Cadastrar aluno"}
        </button>
      </section>

      {/* FILTRO */}
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
            </option>
          ))}
        </select>
      </section>

      {/* LISTA */}
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
                <div key={s.id} className="p-5 flex justify-between items-center">
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

                  <div className="flex items-center gap-3">
                    <div className="text-sm text-slate-600">
                      {cls?.name || "Sem turma"}
                    </div>

                    <select
                      className="input"
                      value={classId || ""}
                      onChange={(e) => changeClass(s.id, e.target.value)}
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