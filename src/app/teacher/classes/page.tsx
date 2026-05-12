"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MePayload = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
  isPlatformAdmin?: boolean;
  user?: { id: string; email: string | null };
  school?: { schoolId: string; role: string };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
};

type TeacherClassItem = {
  assignmentId: string;
  classId: string;
  createdAt: string | null;
  name: string | null;
  grade: string | null;
  shift: string | null;
};

type BrandingResp = any;

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function formatDateBR(value?: string | null) {
  if (!value) return "—";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classLabel(c: TeacherClassItem) {
  const parts: string[] = [];

  if (c.name) parts.push(c.name);
  if (c.grade) parts.push(c.grade);
  if (c.shift) parts.push(c.shift);

  return parts.join(" • ") || c.classId;
}

function shiftLabel(shift?: string | null) {
  const safe = String(shift || "").trim();
  return safe || "Turno não informado";
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "TU";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function safeJsonParse(text: string) {
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
  icon,
}: {
  label: string;
  value: string;
  help: string;
  icon: string;
}) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          {label}
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-lg">
          {icon}
        </div>
      </div>

      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="rounded-[36px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[28px] bg-slate-100 text-3xl">
        🏫
      </div>

      <h2 className="mt-5 text-xl font-semibold text-slate-900">
        Nenhuma turma vinculada
      </h2>

      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
        Seu usuário professor ainda não possui vínculo ativo com turmas. Peça para a direção ou
        coordenação vincular seu professor às turmas corretas.
      </p>

      <button
        type="button"
        onClick={onRefresh}
        className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Atualizar turmas
      </button>
    </div>
  );
}

function ClassCard({
  item,
  onOpenStudents,
  onOpenAttendance,
  onOpenDiary,
}: {
  item: TeacherClassItem;
  onOpenStudents: () => void;
  onOpenAttendance: () => void;
  onOpenDiary: () => void;
}) {
  const title = classLabel(item);
  const initials = getInitials(item.name || item.grade || "Turma");

  return (
    <article className="group relative overflow-hidden rounded-[36px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl">
      <div className="absolute -right-20 -top-20 h-44 w-44 rounded-full bg-slate-100 blur-2xl transition group-hover:bg-slate-200" />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[28px] bg-slate-950 text-lg font-bold text-white shadow-sm">
              {initials}
            </div>

            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {shiftLabel(item.shift)}
              </div>

              <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
                {title}
              </h2>

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {item.name ? (
                  <span className="rounded-full bg-slate-50 px-3 py-1">
                    Turma: {item.name}
                  </span>
                ) : null}

                {item.grade ? (
                  <span className="rounded-full bg-slate-50 px-3 py-1">
                    Série: {item.grade}
                  </span>
                ) : null}

                <span className="rounded-full bg-slate-50 px-3 py-1">
                  Vinculado em: {formatDateBR(item.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Ações da turma
          </div>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Acesse alunos, registre presença e lance o diário pedagógico desta turma.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onOpenStudents}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Ver alunos
          </button>

          <button
            type="button"
            onClick={onOpenAttendance}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Fazer chamada
          </button>

          <button
            type="button"
            onClick={onOpenDiary}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Diário
          </button>
        </div>

        <div className="mt-4 break-all rounded-2xl bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-400">
          ID da turma: <span className="font-mono">{item.classId}</span>
        </div>
      </div>
    </article>
  );
}

export default function TeacherClassesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);

  const [branding, setBranding] = useState<{
    name?: string | null;
    logoUrl?: string | null;
  } | null>(null);

  const canAccess = useMemo(() => {
    const r = normRole(me?.school?.role);
    return r === "professor" || r === "teacher";
  }, [me?.school?.role]);

  const totalClasses = classes.length;

  const uniqueShifts = useMemo(() => {
    return Array.from(
      new Set(classes.map((item) => String(item.shift || "").trim()).filter(Boolean))
    );
  }, [classes]);

  const uniqueGrades = useMemo(() => {
    return Array.from(
      new Set(classes.map((item) => String(item.grade || "").trim()).filter(Boolean))
    );
  }, [classes]);

  async function getTokenOrRedirect() {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();

    if (sessErr) throw new Error(sessErr.message);

    const token = sessionData.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const token = await getTokenOrRedirect();
      if (!token) return;

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meText = await meRes.text();
      const meJson = safeJsonParse(meText) as MePayload | null;

      if (!meRes.ok || !meJson?.ok) {
        setError(meJson?.error || "Falha ao validar sessão (/api/me).");
        return;
      }

      if (meJson.isPlatformAdmin) {
        router.replace("/admin-master");
        return;
      }

      const role = normRole(meJson?.school?.role);

      if (!(role === "professor" || role === "teacher")) {
        router.replace(meJson?.redirectTo || "/login");
        return;
      }

      setMe(meJson);

      const bRes = await fetch("/api/school/branding", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const bText = await bRes.text();
      const bJson = safeJsonParse(bText) as BrandingResp | null;

      if (bRes.ok && bJson?.ok) {
        const school = bJson.school || bJson;
        const name = school?.brand_name ?? school?.name ?? null;
        const logoUrl = school?.brand_logo_url ?? school?.logo_url ?? null;

        setBranding({ name, logoUrl });
      } else {
        setBranding({
          name: meJson?.branding?.brandName || null,
          logoUrl: meJson?.branding?.brandLogoUrl || null,
        });
      }

      const res = await fetch("/api/teacher/classes/list", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const text = await res.text();
      const json = safeJsonParse(text);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar turmas do professor.");
        setClasses([]);
        return;
      }

      setSchoolId(json.schoolId ?? meJson?.school?.schoolId ?? null);
      setClasses((json.classes ?? []) as TeacherClassItem[]);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado.");
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-5">
            <div className="h-10 w-72 rounded-2xl bg-slate-200" />
            <div className="h-4 w-96 rounded-2xl bg-slate-100" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-32 rounded-[32px] bg-slate-100" />
              <div className="h-32 rounded-[32px] bg-slate-100" />
              <div className="h-32 rounded-[32px] bg-slate-100" />
            </div>
            <div className="h-80 rounded-[34px] bg-slate-100" />
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[32px] border border-red-200 bg-white p-8 shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-red-50 text-2xl">
            ⚠️
          </div>

          <h1 className="mt-5 text-xl font-semibold text-slate-900">
            Não foi possível carregar suas turmas
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>

          <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => router.replace("/teacher")}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Voltar ao início
            </button>

            <button
              type="button"
              onClick={load}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Acesso negado</h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            Esta página é exclusiva para professores.
          </p>

          <button
            type="button"
            onClick={() => router.replace("/login")}
            className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Ir para login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[40px] border border-slate-200 bg-slate-950 p-5 text-white shadow-xl md:p-8">
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
        />
        <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            {branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt="Logo da escola"
                className="h-24 w-24 rounded-[30px] border border-white/15 bg-white/10 object-contain p-2"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-[30px] border border-white/15 bg-white/10 text-2xl font-bold text-white">
                {getInitials(branding?.name || "Turmas")}
              </div>
            )}

            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Portal do Professor
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
                Minhas turmas
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
                Acesse as turmas vinculadas ao seu usuário, registre chamada, visualize alunos e
                lance o diário pedagógico.
              </p>

              <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full bg-white/10 px-3 py-1">
                  Escola: {branding?.name || "Minha escola"}
                </span>

                <span className="rounded-full bg-white/10 px-3 py-1">
                  Escola ID: <span className="font-mono">{schoolId ?? me?.school?.schoolId ?? "—"}</span>
                </span>

                <span className="rounded-full bg-white/10 px-3 py-1">
                  {totalClasses} turma(s) vinculada(s)
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/teacher")}
              className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Voltar ao início
            </button>

            <button
              type="button"
              onClick={load}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
            >
              Atualizar turmas
            </button>

            <button
              type="button"
              onClick={logout}
              className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Sair
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Turmas vinculadas"
          value={String(totalClasses)}
          help="Total de turmas ativas disponíveis para sua rotina docente."
          icon="🏫"
        />

        <MetricCard
          label="Séries"
          value={String(uniqueGrades.length || "—")}
          help="Quantidade de séries diferentes nas turmas vinculadas."
          icon="🎓"
        />

        <MetricCard
          label="Turnos"
          value={String(uniqueShifts.length || "—")}
          help="Turnos identificados nas suas turmas atuais."
          icon="🕒"
        />
      </section>

      <section className="rounded-[36px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Rotina docente
            </div>

            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
              Turmas disponíveis
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Escolha uma turma para acessar alunos, chamada ou diário pedagógico.
            </p>
          </div>

          <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
            {totalClasses} resultado(s)
          </div>
        </div>

        <div className="mt-6">
          {classes.length === 0 ? (
            <EmptyState onRefresh={load} />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {classes.map((c) => (
                <ClassCard
                  key={c.assignmentId || c.classId}
                  item={c}
                  onOpenStudents={() => router.push(`/teacher/classes/${c.classId}`)}
                  onOpenAttendance={() =>
                    router.push(`/teacher/classes/${c.classId}/attendance`)
                  }
                  onOpenDiary={() => router.push(`/teacher/classes/${c.classId}/diary`)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}