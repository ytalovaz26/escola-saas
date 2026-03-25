"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type MeResponse =
  | {
      ok: true;
      user: { id: string; email: string | null };
      isPlatformAdmin: boolean;
      school?: { schoolId: string; role: string };
    }
  | { ok: false; error?: string; redirectTo?: string };

type ClassItem = { id: string; name: string | null; grade: string | null; shift: string | null };
type StudentItem = { id: string; full_name: string | null; email: string | null };

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function classLabel(c: ClassItem) {
  const parts: string[] = [];
  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(`Série: ${c.grade}`);
  if (c.shift) parts.push(`Turno: ${c.shift}`);
  return parts.join(" • ") || c.id;
}

export default function DevEnrollPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canUse = useMemo(() => {
    const role = normRole((me as any)?.school?.role);
    return ["diretor", "director", "admin", "secretaria", "coordenador", "professor", "teacher"].includes(role);
  }, [me]);

  async function forceLogoutToLogin() {
    try {
      await supabase.auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  async function load() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);

      const token = data.session?.access_token;
      if (!token) {
        setErr("Sessão não encontrada ou expirada. Clique em 'Sair e ir para login' e faça login novamente.");
        return;
      }

      // 1) /api/me
      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meJson = (await meRes.json().catch(() => null)) as MeResponse | null;

      if (!meRes.ok || !meJson?.ok) {
        const status = meRes.status;
        const detail = meJson?.error || "Falha ao validar usuário em /api/me.";
        setErr(`[${status}] ${detail}`);
        return;
      }

      setMe(meJson);

      if ((meJson as any).isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      if (!meJson.school?.schoolId) {
        setErr("Usuário sem escola vinculada (school_id).");
        return;
      }

      // 2) classes + students
      const [cRes, sRes] = await Promise.all([
        fetch("/api/dev/enroll/classes", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/dev/enroll/students", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);

      const cJson = await cRes.json().catch(() => null);
      const sJson = await sRes.json().catch(() => null);

      if (!cRes.ok) {
        setErr(`[${cRes.status}] ${cJson?.error || "Erro ao carregar turmas (classes)."}`);
        return;
      }
      if (!sRes.ok) {
        setErr(`[${sRes.status}] ${sJson?.error || "Erro ao carregar alunos (students)."}`);
        return;
      }

      setClasses(cJson?.classes || []);
      setStudents(sJson?.students || []);
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function enroll() {
    setErr(null);
    setMsg(null);

    if (!classId || !studentId) {
      setErr("Selecione turma e aluno.");
      return;
    }

    setBusy(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setErr("Sessão não encontrada. Faça login novamente.");
        return;
      }

      const res = await fetch("/api/dev/enroll/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId, studentId }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(`[${res.status}] ${json?.error || "Erro ao matricular."}`);
        return;
      }

      setMsg(json?.reused ? "Matrícula reativada com sucesso ✅" : "Aluno matriculado com sucesso ✅");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="p-6">Carregando…</div>;

  if (err) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">DEV · Matrícula de Alunos</h1>
        <div className="text-red-700">{err}</div>
        <div className="flex gap-2">
          <button className="border px-3 py-2" onClick={forceLogoutToLogin}>
            Sair e ir para login
          </button>
          <button className="border px-3 py-2" onClick={load}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!canUse) return <div className="p-6">Acesso restrito a diretor/secretaria/coordenador/professor.</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">DEV · Matrícula de Alunos</h1>

      {msg && <div className="text-green-700">{msg}</div>}

      <div className="space-y-2">
        <label className="block text-sm">Turma</label>
        <select className="border p-2" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Selecione a turma</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-sm">Aluno</label>
        <select className="border p-2" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Selecione o aluno</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name || s.email || s.id}
            </option>
          ))}
        </select>
      </div>

      <button className="bg-black text-white px-4 py-2 disabled:opacity-60" disabled={busy} onClick={enroll}>
        {busy ? "Matriculando..." : "Matricular"}
      </button>
    </div>
  );
}
