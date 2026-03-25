"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: true;
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  redirectTo: string;
};

type ClassRow = { id: string; name: string; created_at: string };
type StudentRow = { id: string; full_name: string; registration_number: string | null; created_at: string };
type MessageRow = { id: string; title: string; status: string; created_at: string };

export default function SchoolMessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("published");

  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  const [creating, setCreating] = useState(false);

  const selectedCount = useMemo(
    () => selectedClassIds.length + selectedStudentIds.length,
    [selectedClassIds, selectedStudentIds]
  );

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const me = (await res.json()) as MePayload;

        if (!res.ok || !me?.ok) {
          setError("Falha ao validar sessão.");
          return;
        }

        if (me.isPlatformAdmin) {
          router.replace("/admin-master");
          return;
        }

        const r = me.school?.role || null;
        const sid = me.school?.schoolId || null;

        if (!sid) {
          setError("Usuário sem escola vinculada.");
          return;
        }

        if (r !== "diretor" && r !== "coordenador") {
          router.replace("/school");
          return;
        }

        setRole(r);
        setSchoolId(sid);

        await Promise.all([loadClasses(sid), loadStudents(sid), loadMessages(sid)]);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function loadClasses(sid: string) {
    const { data, error } = await supabase
      .from("classes")
      .select("id,name,created_at")
      .eq("school_id", sid)
      .order("created_at", { ascending: false });

    if (error) {
      setError("Erro ao carregar turmas: " + error.message);
      return;
    }
    setClasses((data ?? []) as ClassRow[]);
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
    setStudents((data ?? []) as StudentRow[]);
  }

  async function loadMessages(sid: string) {
    const { data, error } = await supabase
      .from("messages")
      .select("id,title,status,created_at")
      .eq("school_id", sid)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setError("Erro ao carregar comunicados: " + error.message);
      return;
    }
    setMessages((data ?? []) as MessageRow[]);
  }

  function toggleInList(id: string, list: string[], setList: (v: string[]) => void) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function createMessage() {
    if (!schoolId) return;

    if (!title.trim()) return alert("Informe o título.");
    if (!body.trim()) return alert("Informe a mensagem.");
    if (selectedClassIds.length === 0 && selectedStudentIds.length === 0) {
      return alert("Selecione pelo menos 1 turma ou 1 aluno.");
    }

    try {
      setCreating(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/school/messages/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schoolId,
          title: title.trim(),
          body: body.trim(),
          status,
          classIds: selectedClassIds,
          studentIds: selectedStudentIds,
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
        alert("Erro ao criar comunicado: " + (json?.error || "desconhecido"));
        return;
      }

      setTitle("");
      setBody("");
      setSelectedClassIds([]);
      setSelectedStudentIds([]);

      await loadMessages(schoolId);
      alert("Comunicado criado ✅");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <main className="p-6">Carregando...</main>;
  if (error) return <main className="p-6 text-red-600">Erro: {error}</main>;

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Comunicados (Mural)</h1>
            <p className="text-sm text-gray-600 mt-1">
              Perfil: <span className="font-medium">{role}</span> • Escola:{" "}
              <span className="font-mono text-xs">{schoolId}</span>
            </p>
          </div>
          <button onClick={() => router.push("/school")} className="rounded-xl border px-4 py-2">
            Voltar
          </button>
        </header>

        {/* Criar comunicado */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <h2 className="font-semibold">Novo comunicado</h2>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">Título *</div>
              <input
                className="border rounded-xl p-3 w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Reunião de Pais - Sexta-feira"
              />
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Mensagem *</div>
              <textarea
                className="border rounded-xl p-3 w-full min-h-[120px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Digite o comunicado..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-600 mb-1">Status</div>
                <select className="border rounded-xl p-3 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="published">Publicado</option>
                  <option value="draft">Rascunho</option>
                </select>
              </div>

              <div className="rounded-2xl border bg-gray-50 p-3">
                <div className="text-xs text-gray-600">Alvos selecionados</div>
                <div className="text-sm mt-1">
                  Turmas: <b>{selectedClassIds.length}</b> • Alunos: <b>{selectedStudentIds.length}</b> • Total:{" "}
                  <b>{selectedCount}</b>
                </div>
              </div>
            </div>
          </div>

          {/* Seleção de alvos */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-2xl p-4">
              <div className="font-medium">Enviar para Turmas</div>
              <div className="text-xs text-gray-600 mt-1">Selecione uma ou mais turmas.</div>

              <div className="mt-3 max-h-60 overflow-auto space-y-2">
                {classes.length === 0 ? (
                  <div className="text-sm text-gray-600">Nenhuma turma cadastrada.</div>
                ) : (
                  classes.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedClassIds.includes(c.id)}
                        onChange={() => toggleInList(c.id, selectedClassIds, setSelectedClassIds)}
                      />
                      <span>{c.name}</span>
                      <span className="text-[11px] text-gray-400 font-mono">{c.id.slice(0, 8)}…</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="border rounded-2xl p-4">
              <div className="font-medium">Enviar para Alunos Específicos</div>
              <div className="text-xs text-gray-600 mt-1">Selecione um ou mais alunos.</div>

              <div className="mt-3 max-h-60 overflow-auto space-y-2">
                {students.length === 0 ? (
                  <div className="text-sm text-gray-600">Nenhum aluno cadastrado.</div>
                ) : (
                  students.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.includes(s.id)}
                        onChange={() => toggleInList(s.id, selectedStudentIds, setSelectedStudentIds)}
                      />
                      <span className="truncate">
                        {s.full_name}
                        {s.registration_number ? ` • ${s.registration_number}` : ""}
                      </span>
                      <span className="text-[11px] text-gray-400 font-mono">{s.id.slice(0, 8)}…</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <button
            onClick={createMessage}
            disabled={creating}
            className="mt-4 rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-60"
          >
            {creating ? "Publicando..." : "Publicar comunicado"}
          </button>
        </section>

        {/* Lista */}
        <section className="mt-6 bg-white rounded-2xl shadow p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Últimos comunicados</h2>
              <p className="text-xs text-gray-600 mt-1">Mostra os 50 mais recentes.</p>
            </div>
            <button onClick={() => schoolId && loadMessages(schoolId)} className="rounded-xl border px-4 py-2 text-sm">
              Atualizar
            </button>
          </div>

          {messages.length === 0 ? (
            <div className="text-sm text-gray-600 mt-4">Nenhum comunicado ainda.</div>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Título</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Criado em</th>
                    <th className="py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="py-2 font-medium">{m.title}</td>
                      <td className="py-2">{m.status}</td>
                      <td className="py-2">{new Date(m.created_at).toLocaleString("pt-BR")}</td>
                      <td className="py-2 font-mono text-xs">{m.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
