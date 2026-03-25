"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
};

type ParentRow = {
  id: string;
  school_id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  created_at: string;
};

type StudentRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
  created_at: string;
};

type LinkRow = {
  id: string;
  parent_id: string;
  student_id: string;
  is_active: boolean;
  created_at: string;
};

export default function ParentsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [parents, setParents] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);

  // criar pai
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [creating, setCreating] = useState(false);

  // vincular
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [linking, setLinking] = useState(false);

  // desvincular
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);

  const parentById = useMemo(() => {
    const map = new Map<string, ParentRow>();
    for (const p of parents) map.set(p.id, p);
    return map;
  }, [parents]);

  const studentById = useMemo(() => {
    const map = new Map<string, StudentRow>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, StudentRow[]>();
    for (const l of links) {
      if (!l.is_active) continue;
      const s = studentById.get(l.student_id);
      if (!s) continue;
      const arr = map.get(l.parent_id) ?? [];
      arr.push(s);
      map.set(l.parent_id, arr);
    }
    return map;
  }, [links, studentById]);

  function friendlyLinkError(msg: string) {
    const lower = (msg || "").toLowerCase();
    if (lower.includes("duplicate key") || lower.includes("unique") || lower.includes("conflict")) {
      return "Esse responsável já está vinculado a esse aluno (ou existe um vínculo antigo que precisa ser reativado).";
    }
    return msg;
  }

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = { ok: false, error: text || "Resposta inválida do servidor" };
        }

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao validar sessão/perfil.");
          return;
        }

        const payload = json as MePayload;

        if (payload.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        const r = payload.school?.role;
        setRole(r || null);

        if (r !== "diretor" && r !== "coordenador") {
          router.replace("/school");
          return;
        }

        const sid = payload.school?.schoolId;
        if (!sid) {
          setError("Usuário sem escola vinculada.");
          return;
        }

        setSchoolId(sid);

        await Promise.all([loadParents(sid), loadStudents(sid), loadLinks(sid)]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadParents(sid: string) {
    const { data, error } = await supabase
      .from("parents")
      .select("id,school_id,user_id,full_name,phone,created_at")
      .eq("school_id", sid)
      .order("created_at", { ascending: false });

    if (error) {
      setError("Erro ao carregar pais: " + error.message);
      return;
    }

    const list = (data ?? []) as ParentRow[];
    setParents(list);

    if (!selectedParentId && list[0]?.id) setSelectedParentId(list[0].id);
  }

  async function loadStudents(sid: string) {
    const { data, error } = await supabase
      .from("students")
      .select("id,full_name,registration_number,created_at")
      .eq("school_id", sid)
      .order("created_at", { ascending: false });

    if (error) {
      setError("Erro ao carregar alunos: " + error.message);
      return;
    }

    const list = (data ?? []) as StudentRow[];
    setStudents(list);

    if (!selectedStudentId && list[0]?.id) setSelectedStudentId(list[0].id);
  }

  async function loadLinks(sid: string) {
    const { data, error } = await supabase
      .from("student_parents")
      .select("id,parent_id,student_id,is_active,created_at")
      .eq("school_id", sid)
      .eq("is_active", true);

    if (error) {
      setError("Erro ao carregar vínculos: " + error.message);
      return;
    }
    setLinks((data ?? []) as LinkRow[]);
  }

  async function refreshAll() {
    if (!schoolId) return;
    await Promise.all([loadParents(schoolId), loadStudents(schoolId), loadLinks(schoolId)]);
  }

  async function createParent() {
    if (!schoolId) return;

    if (!parentName.trim()) return alert("Informe o nome do responsável.");
    if (!parentEmail.trim()) return alert("Informe o e-mail do responsável.");
    if (!tempPassword.trim() || tempPassword.trim().length < 6)
      return alert("Senha temporária precisa ter pelo menos 6 caracteres.");

    try {
      setCreating(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        alert("Sessão inválida. Faça login novamente.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/admin/create-parent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schoolId,
          fullName: parentName.trim(),
          phone: parentPhone.trim() || null,
          email: parentEmail.trim(),
          passwordTemp: tempPassword.trim(),
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: text || "Resposta inválida" };
      }

      if (!res.ok || !json?.ok) {
        alert("Erro ao criar responsável: " + (json?.error || "desconhecido"));
        return;
      }

      alert(
        `Responsável criado/vinculado ao Auth!\n\nNome: ${parentName}\nEmail: ${parentEmail}\nSenha temporária: ${tempPassword}\n\n(Oriente a trocar a senha no primeiro login)`
      );

      setParentName("");
      setParentPhone("");
      setParentEmail("");
      setTempPassword("");

      await loadParents(schoolId);
    } finally {
      setCreating(false);
    }
  }

  async function linkParentToStudent() {
    if (!schoolId) return;
    if (!selectedParentId) return alert("Selecione um responsável.");
    if (!selectedStudentId) return alert("Selecione um aluno.");

    try {
      setLinking(true);

      /**
       * ✅ FIX 409 (Conflict)
       * Seu banco tem UNIQUE(student_id, parent_id).
       * Quando você "desvincula", você faz soft delete (is_active=false).
       * Ao vincular novamente, o INSERT dá 409. O correto é UPSERT reativando o vínculo.
       */
      const { error } = await supabase
        .from("student_parents")
        .upsert(
          {
            school_id: schoolId,
            parent_id: selectedParentId,
            student_id: selectedStudentId,
            is_active: true,
          },
          {
            onConflict: "student_id,parent_id",
          }
        );

      if (error) {
        alert("Erro ao vincular: " + friendlyLinkError(error.message));
        return;
      }

      await loadLinks(schoolId);
      alert("Vínculo criado/reativado com sucesso ✅");
    } finally {
      setLinking(false);
    }
  }

  // ✅ Corrigido para NÃO depender de RPC is_platform_admin(...)
  // Chama a API que valida diretor/coordenador e faz soft delete (is_active=false).
  async function unlinkParentFromStudent(parentId: string, studentId: string) {
    if (!schoolId) return;

    const p = parentById.get(parentId);
    const s = studentById.get(studentId);

    const ok = confirm(
      `Confirma desvincular?\n\nResponsável: ${p?.full_name || parentId}\nAluno: ${s?.full_name || studentId}`
    );
    if (!ok) return;

    try {
      const key = `${parentId}:${studentId}`;
      setUnlinkingKey(key);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        alert("Sessão inválida. Faça login novamente.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/admin/unlink-student-parent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schoolId,
          parentId,
          studentId,
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: text || "Resposta inválida" };
      }

      if (!res.ok || !json?.ok) {
        alert("Erro ao desvincular: " + (json?.error || "desconhecido"));
        return;
      }

      // remove local (rápido) e confirma com reload depois
      setLinks((prev) => prev.filter((l) => !(l.parent_id === parentId && l.student_id === studentId)));
      await loadLinks(schoolId);

      alert("Desvinculado com sucesso ✅");
    } finally {
      setUnlinkingKey(null);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main className="p-6">Carregando...</main>;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-semibold">Erro</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
          <button
            onClick={() => router.push("/school")}
            className="mt-4 w-full rounded-xl bg-gray-900 text-white p-3"
          >
            Voltar ao painel
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Pais / Responsáveis</h1>
            <p className="text-sm text-gray-600 mt-1">
              Perfil: <span className="font-medium">{role}</span> • Escola:{" "}
              <span className="font-mono text-xs">{schoolId}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => router.push("/school")} className="rounded-xl border px-4 py-2">
              Painel
            </button>
            <button onClick={logout} className="rounded-xl bg-gray-900 text-white px-4 py-2">
              Sair
            </button>
          </div>
        </header>

        {/* Criar pai */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Cadastrar responsável (login)</h2>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">Nome completo *</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: Maria Aparecida Souza"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Telefone</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: (64) 9xxxx-xxxx"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">E-mail *</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="responsavel@exemplo.com"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Senha temporária *</div>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Ex: Mae@1234"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={createParent}
            disabled={creating}
            className="mt-4 rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-60"
          >
            {creating ? "Criando..." : "Criar responsável"}
          </button>
        </section>

        {/* Vincular */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Vincular responsável → aluno</h2>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">Responsável</div>
              <select
                className="border rounded-xl p-3 w-full"
                value={selectedParentId}
                onChange={(e) => setSelectedParentId(e.target.value)}
              >
                {parents.length === 0 ? (
                  <option value="">Cadastre um responsável primeiro</option>
                ) : (
                  parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} {p.phone ? `• ${p.phone}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Aluno</div>
              <select
                className="border rounded-xl p-3 w-full"
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                {students.length === 0 ? (
                  <option value="">Cadastre um aluno primeiro</option>
                ) : (
                  students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} {s.registration_number ? `• ${s.registration_number}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <button
            onClick={linkParentToStudent}
            disabled={linking || parents.length === 0 || students.length === 0}
            className="mt-4 rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-60"
          >
            {linking ? "Vinculando..." : "Vincular"}
          </button>
        </section>

        {/* Lista */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-semibold">Responsáveis cadastrados</h2>
              <p className="text-xs text-gray-500 mt-1">Mostra também os alunos vinculados (ativos).</p>
            </div>

            <button onClick={refreshAll} className="rounded-xl border px-4 py-2 text-sm" disabled={!schoolId}>
              Atualizar
            </button>
          </div>

          {parents.length === 0 ? (
            <p className="text-sm text-gray-600 mt-3">Nenhum responsável ainda.</p>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Responsável</th>
                    <th className="py-2">Contato</th>
                    <th className="py-2">Filhos vinculados</th>
                    <th className="py-2">Ações</th>
                    <th className="py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {parents.map((p) => {
                    const kids = childrenByParentId.get(p.id) ?? [];

                    return (
                      <tr key={p.id} className="border-b align-top">
                        <td className="py-2">
                          <div className="font-medium">{p.full_name}</div>
                          <div className="text-xs text-gray-500">{p.user_id ? "Login criado ✅" : "Sem login"}</div>
                        </td>
                        <td className="py-2">{p.phone ?? "—"}</td>
                        <td className="py-2">
                          {kids.length === 0 ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            <ul className="list-disc pl-5">
                              {kids.map((k) => {
                                const key = `${p.id}:${k.id}`;
                                const busy = unlinkingKey === key;

                                return (
                                  <li key={k.id} className="flex items-center gap-2">
                                    <span>
                                      {k.full_name}
                                      {k.registration_number ? ` (${k.registration_number})` : ""}
                                    </span>
                                    <button
                                      className="text-xs rounded-lg border px-2 py-1 disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => unlinkParentFromStudent(p.id, k.id)}
                                      title="Desvincular"
                                    >
                                      {busy ? "..." : "Desvincular"}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="text-xs text-gray-500">{kids.length > 0 ? "Desvincule ao lado" : "—"}</div>
                        </td>
                        <td className="py-2 font-mono text-xs">{p.id}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
