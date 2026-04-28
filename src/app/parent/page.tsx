"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type MePayload = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: {
    parentId: string;
    schoolId: string;
    firstLoginCompleted?: boolean;
    profileUpdatedAt?: string | null;
  };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

type ParentProfilePayload = {
  ok: true;
  parent: {
    id: string;
    schoolId: string | null;
    fullName: string | null;
    phone: string | null;
    cpf: string | null;
    phoneSecondary: string | null;
    zipCode: string | null;
    street: string | null;
    streetNumber: string | null;
    addressComplement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    photoUrl: string | null;
    firstLoginCompleted: boolean;
    profileUpdatedAt: string | null;
  };
};

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function isHttpUrl(url: string) {
  return url.startsWith("https://") || url.startsWith("http://");
}

function withCacheBuster(url: string) {
  const hasQuery = url.includes("?");
  return url + (hasQuery ? "&" : "?") + "v=" + Date.now();
}

function getInitials(name?: string | null) {
  const safe = String(name || "").trim();
  if (!safe) return "PR";

  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function StatCard({
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

function QuickAccessCard({
  eyebrow,
  title,
  description,
  onClick,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: string;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {eyebrow}
        </div>

        {badge ? (
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-2 text-xl font-semibold text-slate-900">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>

      <div className="mt-5 text-sm font-semibold text-slate-700 group-hover:text-slate-900">
        Abrir módulo →
      </div>
    </button>
  );
}

function FeatureInfoCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Recurso disponível
      </div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
    </div>
  );
}

function Avatar({
  photoUrl,
  fallbackText,
}: {
  photoUrl?: string | null;
  fallbackText: string;
}) {
  const [broken, setBroken] = useState(false);

  const validPhoto = photoUrl && isHttpUrl(photoUrl) ? withCacheBuster(photoUrl) : null;

  if (validPhoto && !broken) {
    return (
      <img
        src={validPhoto}
        alt="Foto do responsável"
        className="h-24 w-24 rounded-3xl border border-white/15 bg-white/10 object-cover shadow-sm"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/15 bg-white/10 text-xl font-bold text-white shadow-sm">
      {fallbackText}
    </div>
  );
}

export default function ParentHomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);
  const [profile, setProfile] = useState<ParentProfilePayload["parent"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const brandTitle = useMemo(() => {
    const name = me?.branding?.brandName?.trim();
    return name || "Portal do Responsável";
  }, [me]);

  const responsibleName = useMemo(() => {
    return profile?.fullName?.trim() || me?.user?.email || "Responsável";
  }, [profile?.fullName, me?.user?.email]);

  const responsibleInitials = useMemo(() => {
    return getInitials(profile?.fullName || me?.user?.email || "Responsável");
  }, [profile?.fullName, me?.user?.email]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const text = await res.text();
        const json: any = safeJson(text);

        if (!res.ok || !json?.ok) {
          setError(json?.error || "Falha ao validar sessão.");
          return;
        }

        if (!json?.parent?.parentId) {
          router.replace(json?.redirectTo || "/login");
          return;
        }

        setMe(json as MePayload);

        const profileRes = await fetch("/api/parent/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const profileText = await profileRes.text();
        const profileJson: any = safeJson(profileText);

        if (profileRes.ok && profileJson?.ok) {
          setProfile(profileJson.parent || null);
        }
      } catch (e: any) {
        setError(e?.message || "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="animate-pulse space-y-4">
              <div className="h-10 w-64 rounded-xl bg-slate-200" />
              <div className="h-4 w-80 rounded-xl bg-slate-100" />
              <div className="h-28 rounded-3xl bg-slate-100" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-32 rounded-3xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
            <div className="h-32 rounded-3xl bg-slate-100" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="h-56 rounded-3xl bg-slate-100" />
            <div className="h-56 rounded-3xl bg-slate-100" />
            <div className="h-56 rounded-3xl bg-slate-100" />
            <div className="h-56 rounded-3xl bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="text-red-700 font-medium">Erro</div>
          <div className="mt-2 text-sm text-red-600">{error}</div>
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white"
          >
            Voltar ao login
          </button>
        </div>
      </main>
    );
  }

  if (!me?.parent?.parentId) return null;

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-col gap-5 md:flex-row md:items-center">
                <Avatar
                  photoUrl={profile?.photoUrl}
                  fallbackText={responsibleInitials}
                />

                <div className="min-w-0">
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                    Portal do Responsável
                  </div>

                  <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                    {brandTitle}
                  </h1>

                  <p className="mt-2 text-sm text-slate-200 md:text-base">
                    Bem-vindo, {responsibleName}. Acompanhe a rotina escolar com mais
                    transparência, agilidade e segurança.
                  </p>

                  <p className="mt-3 text-xs text-slate-300">
                    Conta: {me.user.email ?? "Responsável"} • Escola ID:{" "}
                    <span className="font-mono">{me.parent.schoolId}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => router.push("/parent/children")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Meus filhos
                </button>

                <button
                  onClick={() => router.push("/parent/complete-profile")}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Atualizar meus dados
                </button>

                <button
                  onClick={logout}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Sair
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:p-6">
            <StatCard
              label="Acompanhamento"
              value="Ativo"
              help="O responsável já pode consultar presença e boletim dos alunos vinculados."
            />

            <StatCard
              label="Cadastro"
              value={profile?.profileUpdatedAt ? "Atualizado" : "Pendente"}
              help="Mantenha seus dados corretos para fortalecer a comunicação com a escola."
            />

            <StatCard
              label="Experiência"
              value="Premium"
              help="Portal preparado para uso profissional em mobile e desktop."
            />
          </div>
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Acesso rápido
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Os módulos mais importantes para o acompanhamento escolar da família.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <QuickAccessCard
              eyebrow="Área do aluno"
              title="Meus filhos"
              description="Veja os alunos vinculados à sua conta e entre em cada painel individual."
              onClick={() => router.push("/parent/children")}
              badge="Disponível"
            />

            <QuickAccessCard
              eyebrow="Rotina escolar"
              title="Agenda"
              description="Consulte eventos, compromissos e datas importantes da escola."
              onClick={() => router.push("/parent/calendar")}
              badge="Disponível"
            />

            <QuickAccessCard
              eyebrow="Comunicação"
              title="Comunicados"
              description="Acompanhe avisos, recados e publicações oficiais da escola."
              onClick={() => router.push("/parent/messages")}
              badge="Disponível"
            />

            <QuickAccessCard
              eyebrow="Financeiro"
              title="Mensalidades"
              description="Veja status, vencimentos e valores relacionados ao financeiro escolar."
              onClick={() => router.push("/parent/invoices")}
              badge="Disponível"
            />
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                O que você já pode consultar
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                O portal já entrega uma base sólida para o responsável acompanhar
                desempenho, frequência e relacionamento com a escola.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Ambiente seguro e vinculado à escola
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FeatureInfoCard
              title="Presença diária"
              description="Consulte a frequência do aluno por data, com status por aula e observações."
            />

            <FeatureInfoCard
              title="Presença mensal"
              description="Acompanhe o histórico do mês em calendário, com visão clara dos registros."
            />

            <FeatureInfoCard
              title="Boletim escolar"
              description="Veja notas, média, situação e gere o boletim em PDF com padrão profissional."
            />

            <FeatureInfoCard
              title="Atualização cadastral"
              description="Mantenha telefone, endereço, CPF e foto sempre atualizados no sistema."
            />
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Próxima evolução do portal</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            A próxima camada premium do sistema pode incluir chat escolar, cardápio,
            transparência financeira mais profunda, autorizações digitais, histórico
            de comunicados por aluno e mais integração entre família e escola.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <b>Comunicação:</b> chat com professores, coordenação, direção e setores da escola.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <b>Rotina:</b> agenda detalhada, cardápio, eventos, tarefas e avisos segmentados.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <b>Financeiro:</b> segunda via, comprovantes, histórico e visão mais transparente.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}