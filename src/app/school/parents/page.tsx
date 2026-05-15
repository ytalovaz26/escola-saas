// src/app/school/parents/page.tsx
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
  photo_url: string | null;
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

function normalizeRole(role: string | null | undefined) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function canManageParents(role: string | null | undefined) {
  const r = normalizeRole(role);

  return (
    r === "diretor" ||
    r === "director" ||
    r === "coordenador" ||
    r === "coordinator" ||
    r === "secretaria" ||
    r === "secretary" ||
    r === "admin"
  );
}

function initialsFromName(name: string) {
  const safe = String(name || "").trim();
  if (!safe) return "RP";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function isHttpUrl(url: string) {
  return url.startsWith("https://") || url.startsWith("http://");
}

function ParentAvatar({
  parent,
  size = "md",
  onOpen,
}: {
  parent: ParentRow;
  size?: "sm" | "md" | "lg";
  onOpen?: () => void;
}) {
  const photoUrl = String(parent.photo_url || "").trim();

  const sizeClasses =
    size === "lg"
      ? "h-16 w-16 text-base"
      : size === "sm"
        ? "h-11 w-11 text-xs"
        : "h-12 w-12 text-xs";

  if (photoUrl && isHttpUrl(photoUrl)) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${sizeClasses} group relative shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-sm transition hover:scale-[1.03] hover:shadow-md`}
        title="Clique para ampliar a foto"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={`Foto de ${parent.full_name}`}
          className="h-full w-full object-cover"
        />

        <span className="absolute inset-0 hidden items-center justify-center bg-slate-950/35 text-[10px] font-semibold text-white group-hover:flex">
          Ver
        </span>
      </button>
    );
  }

  return (
    <div
      className={`${sizeClasses} flex shrink-0 items-center justify-center rounded-full bg-slate-900 font-bold text-white shadow-sm`}
    >
      {initialsFromName(parent.full_name)}
    </div>
  );
}

export default function ParentsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [parents, setParents] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);

  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [linking, setLinking] = useState(false);

  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);

  const [photoPreview, setPhotoPreview] = useState<{
    url: string;
    name: string;
  } | null>(null);

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

  const totalParents = parents.length;
  const totalLinkedChildren = links.filter((l) => l.is_active).length;
  const totalWithLogin = parents.filter((p) => Boolean(p.user_id)).length;

  function friendlyLinkError(msg: string) {
    const lower = (msg || "").toLowerCase();

    if (
      lower.includes("duplicate key") ||
      lower.includes("unique") ||
      lower.includes("conflict")
    ) {
      return "Esse responsável já está vinculado a esse aluno ou existe um vínculo antigo que precisa ser reativado.";
    }

    return msg;
  }

  async function getAccessToken() {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  }

  async function loadParents(sid: string) {
    const { data, error } = await supabase
      .from("parents")
      .select("id,school_id,user_id,full_name,phone,photo_url,created_at")
      .eq("school_id", sid)
      .order("created_at", { ascending: false });

    if (error) {
      setError("Erro ao carregar responsáveis: " + error.message);
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

    setError(null);
    await Promise.all([loadParents(schoolId), loadStudents(schoolId), loadLinks(schoolId)]);
  }

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const token = await getAccessToken();

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
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

        const r = payload.school?.role || null;
        const sid = payload.school?.schoolId || null;

        setRole(r);

        if (!canManageParents(r)) {
          router.replace(payload.redirectTo || "/school");
          return;
        }

        if (!sid) {
          setError("Usuário sem escola vinculada.");
          return;
        }

        setSchoolId(sid);

        await Promise.all([loadParents(sid), loadStudents(sid), loadLinks(sid)]);
      } catch (e: any) {
        setError(e?.message || "Erro inesperado ao carregar responsáveis.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function createParent() {
    if (!schoolId) return;

    if (!parentName.trim()) return alert("Informe o nome do responsável.");
    if (!parentEmail.trim()) return alert("Informe o e-mail do responsável.");

    if (!tempPassword.trim() || tempPassword.trim().length < 6) {
      return alert("Senha temporária precisa ter pelo menos 6 caracteres.");
    }

    try {
      setCreating(true);
      setError(null);

      const token = await getAccessToken();

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
        `Responsável criado com sucesso.\n\nNome: ${parentName}\nEmail: ${parentEmail}\nSenha temporária: ${tempPassword}\n\nOriente a troca da senha no primeiro login.`
      );

      setParentName("");
      setParentPhone("");
      setParentEmail("");
      setTempPassword("");

      await refreshAll();
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
      setError(null);

      const { error } = await supabase.from("student_parents").upsert(
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

  async function unlinkParentFromStudent(parentId: string, studentId: string) {
    if (!schoolId) return;

    const p = parentById.get(parentId);
    const s = studentById.get(studentId);

    const ok = confirm(
      `Confirma desvincular?\n\nResponsável: ${p?.full_name || parentId}\nAluno: ${
        s?.full_name || studentId
      }`
    );

    if (!ok) return;

    try {
      const key = `${parentId}:${studentId}`;
      setUnlinkingKey(key);
      setError(null);

      const token = await getAccessToken();

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

      setLinks((prev) =>
        prev.filter((l) => !(l.parent_id === parentId && l.student_id === studentId))
      );

      await loadLinks(schoolId);
      alert("Desvinculado com sucesso ✅");
    } finally {
      setUnlinkingKey(null);
    }
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-64 rounded-xl bg-slate-200" />
            <div className="h-4 w-80 rounded-xl bg-slate-100" />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-sm"
            />
          ))}
        </section>

        <section className="h-96 animate-pulse rounded-[28px] border border-slate-200 bg-white shadow-sm" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Não foi possível carregar</h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => router.push("/school")}
              className="inline-flex justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:opacity-90"
            >
              Voltar ao painel
            </button>

            <button
              onClick={refreshAll}
              className="inline-flex justify-center rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-7 text-white md:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Relacionamento Escolar
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                Pais e Responsáveis
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
                Cadastre responsáveis com login, vincule aos alunos e mantenha a base
                de relacionamento escolar organizada e pronta para crescer.
              </p>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
              Perfil atual: <span className="font-semibold">{role || "—"}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Escola vinculada
            </div>

            <div className="mt-3 break-all font-mono text-xs text-slate-700">
              {schoolId}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Responsáveis cadastrados
            </div>

            <div className="mt-3 text-3xl font-semibold text-slate-900">
              {totalParents}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Base ativa
            </div>

            <div className="mt-3 text-sm leading-6 text-slate-700">
              Com login: <span className="font-semibold">{totalWithLogin}</span>
              <br />
              Vínculos ativos:{" "}
              <span className="font-semibold">{totalLinkedChildren}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Cadastrar responsável
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Crie o acesso do responsável com e-mail e senha temporária.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
            Login pronto para uso
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Nome completo *
            </label>

            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="Ex: Maria Aparecida Souza"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Telefone
            </label>

            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="Ex: (64) 9xxxx-xxxx"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              E-mail *
            </label>

            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="responsavel@exemplo.com"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Senha temporária *
            </label>

            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
              placeholder="Ex: Mae@1234"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={createParent}
            disabled={creating}
            className="inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {creating ? "Criando responsável..." : "Criar responsável"}
          </button>

          <button
            type="button"
            onClick={() => {
              setParentName("");
              setParentPhone("");
              setParentEmail("");
              setTempPassword("");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Limpar campos
          </button>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Vincular responsável ao aluno
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Reative vínculos antigos automaticamente quando o par responsável ↔️ aluno já
            existir.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Responsável
            </label>

            <select
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
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
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Aluno
            </label>

            <select
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
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

        <div className="mt-5">
          <button
            onClick={linkParentToStudent}
            disabled={linking || parents.length === 0 || students.length === 0}
            className="inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {linking ? "Vinculando..." : "Vincular responsável"}
          </button>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Responsáveis cadastrados
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Visualize logins criados, vínculos ativos e gerencie desvinculações com
              segurança.
            </p>
          </div>

          <button
            onClick={refreshAll}
            className="inline-flex rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            disabled={!schoolId}
          >
            Atualizar dados
          </button>
        </div>

        {parents.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <div className="text-sm font-medium text-slate-700">
              Nenhum responsável cadastrado
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Cadastre o primeiro responsável para iniciar a base de relacionamento escolar.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 xl:hidden">
              {parents.map((p) => {
                const kids = childrenByParentId.get(p.id) ?? [];

                return (
                  <div
                    key={p.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50 p-5"
                  >
                    <div className="flex items-start gap-3">
                      <ParentAvatar
                        parent={p}
                        onOpen={() => {
                          if (p.photo_url) {
                            setPhotoPreview({
                              url: p.photo_url,
                              name: p.full_name,
                            });
                          }
                        }}
                      />

                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {p.full_name}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {p.user_id ? "Login criado ✅" : "Sem login"}
                        </div>

                        <div className="mt-1 break-all font-mono text-[11px] text-slate-500">
                          {p.id}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">
                        Contato
                      </div>

                      <div className="mt-1 text-sm text-slate-700">{p.phone ?? "—"}</div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">
                        Filhos vinculados
                      </div>

                      {kids.length === 0 ? (
                        <div className="mt-2 text-sm text-slate-500">
                          Nenhum vínculo ativo.
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {kids.map((k) => {
                            const key = `${p.id}:${k.id}`;
                            const busy = unlinkingKey === key;

                            return (
                              <div
                                key={k.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-900">
                                    {k.full_name}
                                  </div>

                                  <div className="text-xs text-slate-500">
                                    {k.registration_number
                                      ? k.registration_number
                                      : "Sem matrícula"}
                                  </div>
                                </div>

                                <button
                                  className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-60"
                                  disabled={busy}
                                  onClick={() => unlinkParentFromStudent(p.id, k.id)}
                                >
                                  {busy ? "..." : "Desvincular"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 hidden overflow-hidden rounded-3xl border border-slate-200 xl:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px]">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-left">
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Responsável
                      </th>

                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Contato
                      </th>

                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Filhos vinculados
                      </th>

                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Ações
                      </th>

                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        ID
                      </th>
                    </tr>
                  </thead>

                  <tbody className="bg-white">
                    {parents.map((p) => {
                      const kids = childrenByParentId.get(p.id) ?? [];

                      return (
                        <tr
                          key={p.id}
                          className="border-b border-slate-100 align-top last:border-b-0"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-start gap-3">
                              <ParentAvatar
                                parent={p}
                                size="sm"
                                onOpen={() => {
                                  if (p.photo_url) {
                                    setPhotoPreview({
                                      url: p.photo_url,
                                      name: p.full_name,
                                    });
                                  }
                                }}
                              />

                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">
                                  {p.full_name}
                                </div>

                                <div className="mt-1 text-xs text-slate-500">
                                  {p.user_id ? "Login criado ✅" : "Sem login"}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-700">
                            {p.phone ?? "—"}
                          </td>

                          <td className="px-5 py-4">
                            {kids.length === 0 ? (
                              <span className="text-sm text-slate-500">
                                Nenhum vínculo ativo
                              </span>
                            ) : (
                              <div className="space-y-2">
                                {kids.map((k) => (
                                  <div
                                    key={k.id}
                                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                                  >
                                    <span className="font-medium text-slate-900">
                                      {k.full_name}
                                    </span>

                                    {k.registration_number
                                      ? ` • ${k.registration_number}`
                                      : ""}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            {kids.length === 0 ? (
                              <span className="text-sm text-slate-400">—</span>
                            ) : (
                              <div className="space-y-2">
                                {kids.map((k) => {
                                  const key = `${p.id}:${k.id}`;
                                  const busy = unlinkingKey === key;

                                  return (
                                    <button
                                      key={k.id}
                                      className="block rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => unlinkParentFromStudent(p.id, k.id)}
                                    >
                                      {busy
                                        ? "Desvinculando..."
                                        : `Desvincular ${k.full_name}`}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="break-all font-mono text-[11px] text-slate-500">
                              {p.id}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {photoPreview ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Visualização da foto
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {photoPreview.name}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPhotoPreview(null)}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Fechar
              </button>
            </div>

            <div className="bg-slate-100 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview.url}
                alt={photoPreview.name}
                className="max-h-[75vh] w-full rounded-3xl object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}