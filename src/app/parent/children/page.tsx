"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ChildRow = {
  id: string;
  full_name: string;
  registration_number: string | null;
  birth_date?: string | null;
  student_photo_url?: string | null;
  studentProfileUpdatedAt?: string | null;
  relationship: string | null;
  active_class: null | {
    class_id: string;
    started_at: string;
    ended_at: string | null;
    class: null | {
      id: string;
      name: string;
      grade: string | null;
      shift: string | null;
    };
  };
};

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function initials(name?: string | null) {
  const safe = String(name || "").trim();

  if (!safe) return "AL";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function classLabel(child: ChildRow) {
  const cls = child.active_class?.class;

  if (!cls) return "Sem turma ativa";

  const parts: string[] = [];

  if (cls.name) parts.push(cls.name);
  if (cls.grade) parts.push(cls.grade);
  if (cls.shift) parts.push(cls.shift);

  return parts.join(" • ") || "Turma ativa";
}

function StudentAvatar({
  child,
  size = "md",
}: {
  child: ChildRow;
  size?: "md" | "lg";
}) {
  const photoUrl = String(child.student_photo_url || "").trim();

  const sizeClasses =
    size === "lg"
      ? "h-20 w-20 text-xl"
      : "h-14 w-14 text-sm";

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`Foto de ${child.full_name}`}
        className={`${sizeClasses} shrink-0 rounded-full border border-slate-200 object-cover shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} flex shrink-0 items-center justify-center rounded-full bg-slate-900 font-semibold text-white shadow-sm`}
    >
      {initials(child.full_name)}
    </div>
  );
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
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>

      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  primary = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-2xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        primary
          ? "bg-slate-900 text-white hover:opacity-90"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function PremiumCard({
  child,
  onOpen,
  onDaily,
  onMonthly,
  onReport,
  onStudentCard,
  generatingCard,
}: {
  child: ChildRow;
  onOpen: () => void;
  onDaily: () => void;
  onMonthly: () => void;
  onReport: () => void;
  onStudentCard: () => void;
  generatingCard: boolean;
}) {
  const hasClass = !!child.active_class?.class;

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <StudentAvatar child={child} />

            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-slate-900">
                {child.full_name}
              </h2>

              <div className="mt-1 text-sm text-slate-600">
                {child.registration_number
                  ? `Matrícula: ${child.registration_number}`
                  : "Sem matrícula"}
                {child.relationship ? ` • ${child.relationship}` : ""}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                  Aluno vinculado
                </span>

                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                    hasClass
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {hasClass ? "Turma ativa" : "Sem turma ativa"}
                </span>

                {child.student_photo_url ? (
                  <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    Foto cadastrada
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    Sem foto
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="break-all font-mono text-[11px] text-slate-400 md:max-w-[200px]">
            {child.id}
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Turma atual
            </div>

            <div className="mt-2 text-base font-semibold text-slate-900">
              {classLabel(child)}
            </div>

            <div className="mt-2 text-sm leading-6 text-slate-500">
              Acesse rapidamente presença, histórico mensal, boletim e carteirinha
              escolar deste aluno.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ActionButton label="Abrir aluno" onClick={onOpen} />
            <ActionButton label="Presença diária" onClick={onDaily} />
            <ActionButton label="Presença mensal" onClick={onMonthly} />
            <ActionButton
              label={generatingCard ? "Gerando carteirinha..." : "Gerar carteirinha"}
              onClick={onStudentCard}
              disabled={generatingCard}
            />
            <ActionButton label="Ver boletim" onClick={onReport} primary />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParentChildrenPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generatingCardStudentId, setGeneratingCardStudentId] = useState<string | null>(null);

  const totalChildren = useMemo(() => children.length, [children]);

  const activeClassCount = useMemo(
    () => children.filter((child) => !!child.active_class?.class).length,
    [children]
  );

  const noClassCount = useMemo(
    () => children.filter((child) => !child.active_class?.class).length,
    [children]
  );

  async function getAccessToken() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      throw new Error(sessionError?.message || "Not authenticated");
    }

    return sessionData.session.access_token;
  }

  async function generateStudentCardPdf(studentId: string) {
    if (!studentId) return;

    try {
      setError(null);
      setGeneratingCardStudentId(studentId);

      const token = await getAccessToken();

      const res = await fetch(`/api/parent/students/${studentId}/student-card-pdf`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const json = await safeJson(res);
        setError(json?.error || "Erro ao gerar carteirinha do aluno.");
        return;
      }

      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);

      window.open(objectUrl, "_blank", "noopener,noreferrer");

      setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 60_000);
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao gerar carteirinha do aluno.";
      setError(msg);

      if (msg === "Not authenticated" || String(msg).toLowerCase().includes("sessão")) {
        router.replace("/login");
      }
    } finally {
      setGeneratingCardStudentId(null);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const token = await getAccessToken();

        const res = await fetch("/api/parent/children", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const json = await safeJson(res);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao carregar seus filhos.");

          if (res.status === 401) {
            router.replace("/login");
          }

          return;
        }

        setChildren((json.children ?? []) as ChildRow[]);
      } catch (e: any) {
        const msg = e?.message || "Erro inesperado";
        setError(msg);

        if (msg === "Not authenticated" || String(msg).toLowerCase().includes("sessão")) {
          router.replace("/login");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-60 rounded-xl bg-slate-200" />
              <div className="h-4 w-80 rounded-xl bg-slate-100" />
              <div className="h-32 rounded-3xl bg-slate-100" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-32 rounded-3xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error && children.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Erro</h1>

          <p className="mt-2 text-sm text-slate-600">{error}</p>

          <button
            onClick={() => router.push("/parent")}
            className="mt-4 w-full rounded-2xl bg-slate-900 p-3 text-white"
          >
            Voltar
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  Área do responsável
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                  Meus filhos
                </h1>

                <p className="mt-2 max-w-3xl text-sm text-slate-200">
                  Acompanhe presença, boletim, carteirinha e rotina escolar de cada aluno
                  vinculado à sua conta.
                </p>
              </div>

              <button
                onClick={() => router.push("/parent")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:opacity-90"
              >
                Voltar ao portal
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <MetricCard
              label="Alunos vinculados"
              value={String(totalChildren)}
              help="Quantidade de filhos disponíveis para acompanhamento no portal."
            />

            <MetricCard
              label="Com turma ativa"
              value={String(activeClassCount)}
              help="Alunos com vínculo escolar ativo neste momento."
            />

            <MetricCard
              label="Sem turma ativa"
              value={String(noClassCount)}
              help="Alunos que ainda não possuem turma ativa vinculada."
            />
          </div>
        </section>

        {error ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {error}
          </section>
        ) : null}

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Painéis dos alunos
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Entre em cada aluno para consultar frequência, boletim, histórico e carteirinha
              escolar.
            </p>
          </div>

          {children.length === 0 ? (
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Nenhum aluno vinculado a este responsável.
                <br />
                Peça para a escola vincular você a um aluno.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {children.map((child) => (
                <PremiumCard
                  key={child.id}
                  child={child}
                  onOpen={() => router.push(`/parent/students/${child.id}`)}
                  onDaily={() => router.push(`/parent/students/${child.id}/daily`)}
                  onMonthly={() => router.push(`/parent/students/${child.id}/monthly`)}
                  onReport={() => router.push(`/parent/students/${child.id}/report-card`)}
                  onStudentCard={() => generateStudentCardPdf(child.id)}
                  generatingCard={generatingCardStudentId === child.id}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}