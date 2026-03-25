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
      redirectTo?: string;
    }
  | { ok: false; error?: string; redirectTo?: string };

type ClassItem = {
  id: string;
  name: string | null;
  grade: string | null;
  shift: string | null;
};

type StudentItem = {
  id: string;
  full_name: string | null;
  email: string | null;
};

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

/**
 * ✅ Importante:
 * Seu painel pode estar logando via supabase-js (localStorage),
 * enquanto esta tela usa auth-helpers (cookies). Então aqui buscamos o token
 * de 2 formas: getSession() e fallback no localStorage "sb-*-auth-token".
 */
function getTokenFromLocalStorage(): string | null {
  if (typeof window === "undefined") return null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;

      // padrão do supabase-js: sb-<project-ref>-auth-token
      if (/^sb-[a-z0-9-]+-auth-token$/i.test(k)) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;

        const parsed = JSON.parse(raw);

        // formatos possíveis
        const token =
          parsed?.access_token ||
          parsed?.currentSession?.access_token ||
          parsed?.session?.access_token;

        if (typeof token === "string" && token.length > 20) return token;
      }
    }
  } catch {
    // ignora
  }

  return null;
}

export default function DevEnrollPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);

  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canUse = useMemo(() => {
    const role = normRole((me as any)?.school?.role);
    // DEV TOOL: permite diretor/secretaria/coordenador/professor
    return ["diretor", "director", "admin", "secretaria", "coordenador", "professor", "teacher"].includes(role);
  }, [me]);

  async function getToken(): Promise<string | null> {
    // 1) tenta via auth-helpers (cookie/session)
    const { data, error } = await supabase.auth.getSession();
    if (!error) {
      const token = data.session?.access_token;
      if (token) return token;
    }

    // 2) fallback: token do localStorage (supabase-js)
    const lsToken = getTokenFromLocalStorage();
    if (lsToken) return lsToken;

    return null;
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    try {
      const token = await getToken();
      if (!token) {
        setErr("Sessão não encontrada ou expirada. Clique em “Sair e ir para login” e faça login novamente.");
        return;
      }

      // 1) valida /api/me (usa o Bearer)
      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meJson = (await meRes.json().catch(() => null)) as MeResponse | null;

      if (!meRes.ok || !meJson?.ok) {
        const redirect = (meJson as any)?.redirectTo;
        // se backend sugerir rota, respeita
        if (redirect) router.replace(redirect);
        setErr((meJson as any)?.error || "Falha ao validar usuário em /api/me.");
        return;
      }

      // platform admin -> painel master
      if ((meJson as any).isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      // precisa ter escola vinculada
      const schoolId = (meJson as any)?.school?.schoolId;
      if (!schoolId) {
        setErr("Seu usuário está sem escola vinculada (school_id).");
        return;
      }

      setMe(meJson);

      // 2) turmas da escola do usuário (sem escolher escola)
      const cRes = await fetch("/api/dev/enroll/classes", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const cJson = await cRes.json().catch(() => null);

      if (!cRes.ok || !cJson?.ok) {
        setErr(cJson?.error || "Erro ao listar turmas.");
        return;
      }

      // 3) alunos da escola do usuário
      const sRes = await fetch("/api/dev/enroll/students", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const sJson = await sRes.json().catch(() => null);

      if (!sRes.ok || !sJson?.ok) {
        setErr(sJson?.error || "Erro ao listar alunos.");
        return;
      }

      const cls = (cJson.classes || []) as ClassItem[];
      const sts = (sJson.students || []) as StudentItem[];

      setClasses(cls);
      setStudents(sts);

      // auto seleção se houver só 1
      if (!classId && cls.length === 1) setClassId(cls[0].id);
      if (!studentId && sts.length === 1) setStudentId(sts[0].id);
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado no carregamento.");
    } finally {
      setLoading(false);
    }
  }

  async function enroll() {
    setErr(null);
    setMsg(null);

    if (!classId) return setErr("Selecione uma turma.");
    if (!studentId) return setErr("Selecione um aluno.");

    setBusy(true);
    try {
      const token = await getToken();
      if (!token) {
        setErr("Sessão não encontrada. Faça login novamente.");
        return;
      }

      const res = await fetch("/api/dev/enroll/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ classId, studentId }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Falha ao matricular.");
        return;
      }

      setMsg(json?.reused ? "Matrícula reativada com sucesso ✅" : "Matrícula criada com sucesso ✅");
    } catch (e: any) {
      setErr(e?.message || "Erro inesperado ao matricular.");
    } finally {
      setBusy(false);
    }
  }

  async function logoutAndGoLogin() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignora
    }
    router.replace("/login");
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <main className="p-6">Carregando…</main>;
  }

  if (err) {
    return (
      <main className="p-6 space-y-3">
        <h1 className="text-xl font-semibold">DEV · Matrícula de Alunos</h1>
        <p className="text-red-700">{err}</p>
        <div className="flex gap-2">
          <button onClick={logoutAndGoLogin} className="rounded border px-4 py-2">
            Sair e ir para login
          </button>
          <button onClick={loadAll} className="rounded bg-black text-white px-4 py-2">
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  if (!me || !me.ok) {
    return (
      <main className="p-6">
        <p>Sem sessão.</p>
      </main>
    );
  }

  if (!canUse) {
    return (
      <main className="p-6 space-y-2">
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p>Apenas diretor/secretaria/coordenador/professor.</p>
        <button onClick={() => router.replace((me as any)?.redirectTo || "/")} className="rounded bg-black text-white px-4 py-2">
          Voltar
        </button>
      </main>
    );
  }

  const schoolId = (me as any)?.school?.schoolId;

  return (
    <main className="p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">DEV · Matrícula de Alunos</h1>
        <p className="text-xs text-gray-600">
          Escola do usuário logado: <span className="font-mono">{schoolId}</span>
        </p>
        <p className="text-xs text-gray-600">(Aqui não existe seleção de escola — usa o school_id do seu perfil.)</p>
      </header>

      {msg && <div className="rounded border border-green-300 bg-green-50 p-3 text-green-800">{msg}</div>}

      <div className="space-y-2">
        <div className="space-y-1">
          <label className="block text-sm">Turma</label>
          <select className="border rounded px-3 py-2 w-full" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Selecione…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm">Aluno</label>
          <select className="border rounded px-3 py-2 w-full" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Selecione…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name || s.email || s.id}
              </option>
            ))}
          </select>
        </div>

        <button disabled={busy} onClick={enroll} className="rounded bg-black text-white px-4 py-2 disabled:opacity-60 w-full">
          {busy ? "Matriculando..." : "Matricular aluno na turma"}
        </button>

        <p className="text-xs text-gray-600">
          Isso cria/reativa uma linha em <span className="font-mono">class_students</span> com <span className="font-mono">is_active=true</span>.
        </p>
      </div>
    </main>
  );
}
