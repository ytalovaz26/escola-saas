"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
  school?: { schoolId: string; role: string };
  user?: { id: string; email: string | null };
};

type StaffRow = {
  id: string;
  userId: string;
  schoolId: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  fullName: string | null;
  email: string | null;
};

type RoleKey = "diretor" | "coordenador" | "secretaria" | "professor" | "admin" | "unknown";

function normalizeRole(role?: string): RoleKey {
  const r = String(role || "").trim().toLowerCase();

  if (r === "diretor" || r === "director") return "diretor";
  if (r === "coordenador" || r === "coordinator") return "coordenador";
  if (r === "secretaria" || r === "secretary") return "secretaria";
  if (r === "professor" || r === "teacher") return "professor";
  if (r === "admin") return "admin";

  return "unknown";
}

function canManageStaff(role?: string) {
  const r = normalizeRole(role);
  return r === "diretor" || r === "coordenador" || r === "admin";
}

function roleLabel(role: string) {
  const r = normalizeRole(role);

  if (r === "diretor") return "Diretor";
  if (r === "coordenador") return "Coordenador";
  if (r === "secretaria") return "Secretaria";
  if (r === "professor") return "Professor";
  if (r === "admin") return "Administrador";

  return role || "—";
}

function roleBadgeClass(role: string) {
  const r = normalizeRole(role);

  if (r === "diretor") return "border-slate-300 bg-slate-900 text-white";
  if (r === "coordenador") return "border-blue-200 bg-blue-50 text-blue-700";
  if (r === "secretaria") return "border-violet-200 bg-violet-50 text-violet-700";
  if (r === "professor") return "border-emerald-200 bg-emerald-50 text-emerald-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function roleHelp(role: string) {
  const r = normalizeRole(role);

  if (r === "diretor") return "Acesso administrativo amplo à gestão escolar.";
  if (r === "coordenador") return "Acesso pedagógico para acompanhar turmas, professores e boletins.";
  if (r === "secretaria") return "Acesso operacional para alunos, responsáveis, matrículas e financeiro.";
  if (r === "professor") return "Acesso ao portal docente e às turmas vinculadas.";

  return "Função escolar vinculada à instituição.";
}

function initials(name?: string | null) {
  const safe = String(name || "").trim();

  if (!safe) return "EQ";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function MetricCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-slate-900">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

export default function SchoolStaffPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<MePayload | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("coordenador");
  const [tempPassword, setTempPassword] = useState("");

  const currentRole = normalizeRole(me?.school?.role);
  const allowedToManage = canManageStaff(me?.school?.role);

  const summary = useMemo(() => {
    return {
      total: staff.length,
      diretores: staff.filter((x) => normalizeRole(x.role) === "diretor").length,
      coordenadores: staff.filter((x) => normalizeRole(x.role) === "coordenador").length,
      secretarias: staff.filter((x) => normalizeRole(x.role) === "secretaria").length,
      professores: staff.filter((x) => normalizeRole(x.role) === "professor").length,
    };
  }, [staff]);

  const sortedStaff = useMemo(() => {
    const order: Record<RoleKey, number> = {
      diretor: 1,
      coordenador: 2,
      secretaria: 3,
      professor: 4,
      admin: 0,
      unknown: 9,
    };

    return [...staff].sort((a, b) => {
      const roleA = order[normalizeRole(a.role)] ?? 9;
      const roleB = order[normalizeRole(b.role)] ?? 9;

      if (roleA !== roleB) return roleA - roleB;

      const nameA = String(a.fullName || a.email || "").toLowerCase();
      const nameB = String(b.fullName || b.email || "").toLowerCase();

      return nameA.localeCompare(nameB);
    });
  }, [staff]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadMe(token: string) {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await safeJson(res)) as MePayload | null;

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Falha ao validar sessão.");
    }

    if (!json?.school?.schoolId) {
      router.replace(json?.redirectTo || "/login");
      return null;
    }

    const r = normalizeRole(json?.school?.role);

    if (r !== "diretor" && r !== "coordenador" && r !== "admin") {
      setMe(json);
      setError("Acesso restrito. Apenas diretor e coordenador podem gerenciar equipe escolar.");
      return json;
    }

    setMe(json);
    return json;
  }

  async function loadStaff() {
    try {
      setLoading(true);
      setError(null);

      const token = await getToken();
      if (!token) return;

      const mePayload = await loadMe(token);

      if (!mePayload || !canManageStaff(mePayload?.school?.role)) {
        setStaff([]);
        return;
      }

      const res = await fetch("/api/school/staff/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar equipe.");
        return;
      }

      setStaff((json.staff ?? []) as StaffRow[]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar equipe.");
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }

  async function createStaff() {
    try {
      setSaving(true);
      setError(null);

      if (!allowedToManage) {
        setError("Você não tem permissão para criar colaboradores.");
        return;
      }

      if (!fullName.trim()) {
        setError("Informe o nome completo.");
        return;
      }

      if (!email.trim()) {
        setError("Informe o e-mail.");
        return;
      }

      if (!role.trim()) {
        setError("Selecione uma função.");
        return;
      }

      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/school/staff/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          role,
          temp_password: tempPassword.trim() || undefined,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao criar colaborador.");
        return;
      }

      setFullName("");
      setEmail("");
      setRole("coordenador");
      setTempPassword("");

      await loadStaff();
      alert("Colaborador criado/vinculado com sucesso ✅");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao criar colaborador.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <main className="min-h-[60vh]">
        <div className="animate-pulse space-y-5">
          <div className="h-48 rounded-[32px] bg-slate-200" />
          <div className="h-80 rounded-[32px] bg-slate-100" />
        </div>
      </main>
    );
  }

  if (!allowedToManage) {
    return (
      <main className="min-h-[70vh]">
        <div className="mx-auto max-w-3xl">
          <section className="rounded-[32px] border border-amber-200 bg-white p-8 shadow-sm">
            <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              Acesso restrito
            </div>

            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              Equipe escolar
            </h1>

            <p className="mt-3 text-sm leading-6 text-slate-600">
              Esta área é exclusiva para diretor e coordenador. Seu perfil atual é{" "}
              <span className="font-semibold">{roleLabel(currentRole)}</span>.
            </p>

            {error ? (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Voltar ao painel
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[60vh]">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Gestão da equipe
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Equipe escolar
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  Cadastre diretores, coordenadores, secretarias e professores vinculados
                  à escola.
                </p>

                <p className="mt-3 text-xs text-slate-300">
                  Seu perfil atual: {roleLabel(me?.school?.role || "")}
                </p>
              </div>

              <button
                type="button"
                onClick={loadStaff}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Recarregar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-5 md:p-6">
            <MetricCard
              label="Total"
              value={String(summary.total)}
              help="Total de colaboradores ativos vinculados à escola."
            />

            <MetricCard
              label="Diretores"
              value={String(summary.diretores)}
              help="Perfis com acesso administrativo amplo."
            />

            <MetricCard
              label="Coordenadores"
              value={String(summary.coordenadores)}
              help="Gestão pedagógica e operacional."
            />

            <MetricCard
              label="Secretaria"
              value={String(summary.secretarias)}
              help="Operação administrativa e atendimento."
            />

            <MetricCard
              label="Professores"
              value={String(summary.professores)}
              help="Equipe docente vinculada à escola."
            />
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Criar colaborador</h2>
              <p className="mt-1 text-sm text-slate-500">
                Use senha temporária para acesso imediato ou deixe vazio para convite por e-mail.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              Diretor e coordenador podem criar equipe. Secretaria não gerencia esta área.
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nome completo"
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
            />

            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@escola.com"
              type="email"
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
            />

            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="coordenador">Coordenador</option>
              <option value="secretaria">Secretaria</option>
              <option value="professor">Professor</option>
              <option value="diretor">Diretor</option>
            </select>

            <input
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              placeholder="Senha temporária"
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
            />
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={createStaff}
              disabled={saving || !fullName.trim() || !email.trim() || !role.trim()}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Criando..." : "Criar colaborador"}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Colaboradores cadastrados
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Equipe ativa vinculada à escola.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {staff.length} registro(s)
              </div>
            </div>
          </div>

          {staff.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              Nenhum colaborador cadastrado.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 md:p-6 xl:grid-cols-2">
              {sortedStaff.map((item) => (
                <article
                  key={item.id}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                      {initials(item.fullName || item.email)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">
                            {item.fullName || "Sem nome"}
                          </h3>
                          <p className="mt-1 break-all text-sm text-slate-500">
                            {item.email || "Sem e-mail"}
                          </p>
                        </div>

                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${roleBadgeClass(
                            item.role
                          )}`}
                        >
                          {roleLabel(item.role)}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-slate-500">
                        {roleHelp(item.role)}
                      </p>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Status
                          </div>
                          <div className="mt-1 text-sm font-medium text-slate-900">
                            {item.isActive ? "Ativo" : "Inativo"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Criado em
                          </div>
                          <div className="mt-1 text-sm text-slate-700">
                            {formatDateTimeBR(item.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 break-all font-mono text-[11px] text-slate-400">
                        {item.userId}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}