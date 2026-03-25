"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyRole } from "@/lib/authz";

type School = { id: string; name: string; created_at: string };

type SchoolUserRow = {
  school_id: string;
  user_id: string;
  role: any; // enum do postgres aparece como "any" no TS sem types gerados
  is_active: boolean;
  created_at: string;
};

export default function AdminMasterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [schools, setSchools] = useState<School[]>([]);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");

  // criar diretor
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [directorEmail, setDirectorEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [creatingDirector, setCreatingDirector] = useState(false);

  // vínculo por escola (diretores/staff)
  const [schoolUsersBySchool, setSchoolUsersBySchool] = useState<
    Record<string, SchoolUserRow[]>
  >({});
  const [loadingUsers, setLoadingUsers] = useState(false);

  const selectedSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) || null,
    [schools, selectedSchoolId]
  );

  const filteredSchools = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return schools;
    return schools.filter((s) => s.name.toLowerCase().includes(t) || s.id.toLowerCase().includes(t));
  }, [schools, q]);

  useEffect(() => {
    (async () => {
      const role = await getMyRole();
      if (role !== "admin_master") {
        router.replace("/login");
        return;
      }
      await loadSchools();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sempre que a lista de escolas mudar, carregamos os vínculos
  useEffect(() => {
    if (schools.length === 0) return;
    // carrega em background, sem travar a tela
    loadSchoolUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools.map((s) => s.id).join("|")]);

  async function loadSchools() {
    const { data, error } = await supabase
      .from("schools")
      .select("id,name,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      alert("Erro ao carregar escolas: " + error.message);
      return;
    }

    const list = (data ?? []) as School[];
    setSchools(list);
    if (!selectedSchoolId && list?.[0]?.id) setSelectedSchoolId(list[0].id);
  }

  async function loadSchoolUsers() {
    setLoadingUsers(true);

    // Busca todos os vínculos e agrupa por school_id
    const { data, error } = await supabase
      .from("school_users")
      .select("school_id,user_id,role,is_active,created_at")
      .order("created_at", { ascending: false });

    setLoadingUsers(false);

    if (error) {
      // Se der erro aqui, quase sempre é RLS/policy
      alert("Erro ao carregar vínculos (school_users): " + error.message);
      return;
    }

    const rows = (data ?? []) as SchoolUserRow[];
    const grouped: Record<string, SchoolUserRow[]> = {};

    for (const r of rows) {
      if (!grouped[r.school_id]) grouped[r.school_id] = [];
      grouped[r.school_id].push(r);
    }

    setSchoolUsersBySchool(grouped);
  }

  async function createSchool() {
    if (!name.trim()) return;

    const { error } = await supabase.from("schools").insert({ name: name.trim() });
    if (error) {
      alert("Erro ao criar escola: " + error.message);
      return;
    }
    setName("");
    await loadSchools();
  }

  async function createDirector() {
    try {
      if (!selectedSchoolId) return alert("Selecione uma escola.");
      if (!directorEmail.trim()) return alert("Informe o e-mail do diretor.");
      if (!tempPassword.trim() || tempPassword.trim().length < 6)
        return alert("Senha temporária precisa ter pelo menos 6 caracteres.");

      setCreatingDirector(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        alert("Sessão inválida. Faça login de novo.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/admin/create-director", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          email: directorEmail.trim(),
          passwordTemp: tempPassword.trim(),
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { error: text };
      }

      if (!res.ok) {
        alert("Erro ao criar diretor: " + (json?.error || "desconhecido"));
        return;
      }

      alert(
        `Diretor criado/vinculado!\n\nEscola: ${selectedSchool?.name}\nEmail: ${directorEmail}\nSenha temporária: ${tempPassword}\n\n(Oriente a trocar a senha no primeiro login)\n\ncreated=${String(
          json?.created
        )}\nuserId=${String(json?.userId)}`
      );

      setDirectorEmail("");
      setTempPassword("");

      // recarrega vínculos para refletir na tela
      await loadSchoolUsers();
    } finally {
      setCreatingDirector(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main style={{ padding: 24 }}>Carregando...</main>;

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin Master</h1>
        <button onClick={logout}>Sair</button>
      </header>

      {/* Criar escola */}
      <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd" }}>
        <h2>Criar escola</h2>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            placeholder="Nome da escola"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={createSchool}>Criar</button>
        </div>
      </section>

      {/* Criar diretor */}
      <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd" }}>
        <h2>Criar diretor (login + vínculo)</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 8 }}>
          <label>
            Escola
            <select
              value={selectedSchoolId}
              onChange={(e) => setSelectedSchoolId(e.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            >
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            E-mail do diretor
            <input
              value={directorEmail}
              onChange={(e) => setDirectorEmail(e.target.value)}
              placeholder="diretor@escola.com"
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>

          <label>
            Senha temporária
            <input
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              placeholder="ex: Diretor@123"
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>

          <button onClick={createDirector} style={{ padding: 10 }} disabled={creatingDirector}>
            {creatingDirector ? "Criando..." : "Criar diretor"}
          </button>
        </div>
      </section>

      {/* Escolas */}
      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Escolas cadastradas</h2>

          <input
            placeholder="Buscar escola..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ padding: 8, minWidth: 260 }}
          />
        </div>

        {filteredSchools.length === 0 ? (
          <p style={{ marginTop: 12 }}>{schools.length === 0 ? "Nenhuma escola ainda." : "Nenhum resultado."}</p>
        ) : (
          <ul style={{ marginTop: 12 }}>
            {filteredSchools.map((s) => {
              const links = schoolUsersBySchool[s.id] ?? [];
              const activeLinks = links.filter((x) => x.is_active);
              const directors = activeLinks.filter((x) => String(x.role) === "director");

              return (
                <li key={s.id} style={{ padding: 12, borderBottom: "1px solid #eee" }}>
                  <strong>{s.name}</strong>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{s.id}</div>
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    Vínculos: <b>{links.length}</b> | Ativos: <b>{activeLinks.length}</b> | Diretores ativos:{" "}
                    <b>{directors.length}</b>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Diretores / vínculos */}
      <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Diretores e vínculos (school_users)</h2>
          <button onClick={loadSchoolUsers} disabled={loadingUsers}>
            {loadingUsers ? "Atualizando..." : "Atualizar vínculos"}
          </button>
        </div>

        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          Aqui você enxerga os vínculos por escola. Depois vamos puxar e-mail/nome via tabela <b>profiles</b>.
        </p>

        {schools.length === 0 ? (
          <p style={{ marginTop: 12 }}>Crie uma escola para começar.</p>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {schools.map((s) => {
              const rows = schoolUsersBySchool[s.id] ?? [];
              return (
                <div key={s.id} style={{ border: "1px solid #eee", padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{s.id}</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      vínculos: <b>{rows.length}</b>
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <p style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>Nenhum vínculo ainda.</p>
                  ) : (
                    <ul style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      {rows.map((r) => (
                        <li key={r.user_id + r.created_at} style={{ border: "1px solid #f0f0f0", padding: 10 }}>
                          <div style={{ fontSize: 13 }}>
                            <b>user_id:</b> {r.user_id}
                          </div>
                          <div style={{ fontSize: 13 }}>
                            <b>role:</b> {String(r.role)}
                          </div>
                          <div style={{ fontSize: 13 }}>
                            <b>ativo:</b> {String(r.is_active)}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                            criado em: {new Date(r.created_at).toLocaleString()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
