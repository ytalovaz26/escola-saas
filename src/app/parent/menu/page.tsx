"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MealType =
  | "breakfast"
  | "morning_snack"
  | "lunch"
  | "afternoon_snack"
  | "dinner"
  | "other";

type ParentMeal = {
  id: string;
  school_id: string;
  meal_date: string;
  meal_type: MealType;
  meal_type_label: string;
  title: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ChildRow = {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  relationship: string | null;
};

const mealTypeOptions: Array<{ value: MealType; label: string; emoji: string }> = [
  { value: "breakfast", label: "Café da manhã", emoji: "☕" },
  { value: "morning_snack", label: "Lanche da manhã", emoji: "🍎" },
  { value: "lunch", label: "Almoço", emoji: "🍽️" },
  { value: "afternoon_snack", label: "Lanche da tarde", emoji: "🥪" },
  { value: "dinner", label: "Jantar", emoji: "🌙" },
  { value: "other", label: "Outro", emoji: "📌" },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateToYMD(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayYMD() {
  return dateToYMD(new Date());
}

function addDays(dateYmd: string, days: number) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateToYMD(date);
}

function startOfWeekMonday(dateYmd: string) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return dateToYMD(date);
}

function endOfWeekSunday(dateYmd: string) {
  return addDays(startOfWeekMonday(dateYmd), 6);
}

function startOfMonth(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  return dateToYMD(new Date(y, m - 1, 1));
}

function endOfMonth(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  return dateToYMD(new Date(y, m, 0));
}

function formatShortDateBR(dateYmd: string) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!y || !m || !d) return dateYmd;
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

function formatDateBR(dateYmd: string) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!y || !m || !d) return dateYmd;

  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function mealTypeEmoji(type: MealType) {
  return mealTypeOptions.find((item) => item.value === type)?.emoji || "🍽️";
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

function StatCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string | number;
  help: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-500">{help}</div>
    </div>
  );
}

export default function ParentMenuPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [baseDate, setBaseDate] = useState(todayYMD());

  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [meals, setMeals] = useState<ParentMeal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (viewMode === "day") {
      return {
        from: baseDate,
        to: baseDate,
      };
    }

    if (viewMode === "month") {
      return {
        from: startOfMonth(baseDate),
        to: endOfMonth(baseDate),
      };
    }

    return {
      from: startOfWeekMonday(baseDate),
      to: endOfWeekSunday(baseDate),
    };
  }, [baseDate, viewMode]);

  const groupedMeals = useMemo(() => {
    const map = new Map<string, ParentMeal[]>();

    for (const meal of meals) {
      if (!map.has(meal.meal_date)) map.set(meal.meal_date, []);
      map.get(meal.meal_date)!.push(meal);
    }

    for (const [date, list] of map.entries()) {
      map.set(
        date,
        [...list].sort((a, b) => {
          const order = mealTypeOptions.map((item) => item.value);
          return order.indexOf(a.meal_type) - order.indexOf(b.meal_type);
        })
      );
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [meals]);

  const nextMeal = useMemo(() => {
    const today = todayYMD();

    return [...meals]
      .filter((meal) => meal.meal_date >= today)
      .sort((a, b) => {
        const byDate = a.meal_date.localeCompare(b.meal_date);
        if (byDate !== 0) return byDate;

        const order = mealTypeOptions.map((item) => item.value);
        return order.indexOf(a.meal_type) - order.indexOf(b.meal_type);
      })[0];
  }, [meals]);

  const totalDaysWithMeal = useMemo(() => {
    return new Set(meals.map((meal) => meal.meal_date)).size;
  }, [meals]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function loadMeals() {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        mealType: "all",
      });

      const res = await fetch(`/api/parent/menu?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao carregar cardápio escolar.");
        setMeals([]);
        return;
      }

      setSchoolName(json.school?.name || null);
      setChildren(Array.isArray(json.children) ? json.children : []);
      setMeals(Array.isArray(json.meals) ? json.meals : []);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar cardápio escolar.");
      setMeals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  function goPrevious() {
    if (viewMode === "day") setBaseDate(addDays(baseDate, -1));
    else if (viewMode === "week") setBaseDate(addDays(baseDate, -7));
    else {
      const [y, m] = baseDate.split("-").map(Number);
      setBaseDate(dateToYMD(new Date(y, m - 2, 1)));
    }
  }

  function goNext() {
    if (viewMode === "day") setBaseDate(addDays(baseDate, 1));
    else if (viewMode === "week") setBaseDate(addDays(baseDate, 7));
    else {
      const [y, m] = baseDate.split("-").map(Number);
      setBaseDate(dateToYMD(new Date(y, m, 1)));
    }
  }

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden bg-slate-950 px-6 py-10 text-white md:px-8 md:py-12">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="absolute -bottom-24 left-20 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                Alimentação escolar
              </div>

              <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                Cardápio escolar
              </h1>

              <p className="mt-4 text-base leading-8 text-slate-200">
                Acompanhe as refeições cadastradas pela escola para o dia, semana ou mês.
              </p>

              <div className="mt-5 flex flex-wrap gap-2 text-sm text-slate-200">
                {schoolName ? (
                  <span className="rounded-full bg-white/10 px-3 py-1">
                    Escola: <strong>{schoolName}</strong>
                  </span>
                ) : null}

                <span className="rounded-full bg-white/10 px-3 py-1">
                  Filhos vinculados: <strong>{children.length}</strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadMeals}
                className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
              >
                Atualizar cardápio
              </button>

              <button
                type="button"
                onClick={() => router.push("/parent")}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
              >
                Voltar ao portal
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <StatCard
            label="Itens"
            value={meals.length}
            help="Refeições cadastradas no período."
          />

          <StatCard
            label="Dias"
            value={totalDaysWithMeal}
            help="Dias com cardápio publicado."
          />

          <StatCard
            label="Período"
            value={`${formatShortDateBR(range.from)} - ${formatShortDateBR(range.to)}`}
            help="Intervalo atualmente visualizado."
          />

          <StatCard
            label="Próximo"
            value={nextMeal ? nextMeal.meal_type_label : "—"}
            help={
              nextMeal
                ? `${nextMeal.title} • ${formatShortDateBR(nextMeal.meal_date)}`
                : "Nenhuma refeição futura neste período."
            }
          />
        </div>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Navegação do cardápio
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Escolha se deseja ver o cardápio do dia, da semana ou do mês.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {[
              ["day", "Dia"],
              ["week", "Semana"],
              ["month", "Mês"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setViewMode(value as any)}
                className={[
                  "rounded-2xl px-4 py-2 text-sm font-semibold transition",
                  viewMode === value
                    ? "bg-slate-950 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Período
            </div>

            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatShortDateBR(range.from)} até {formatShortDateBR(range.to)}
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Data base
              </label>

              <input
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goPrevious}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Anterior
              </button>

              <button
                type="button"
                onClick={() => setBaseDate(todayYMD())}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Hoje
              </button>

              <button
                type="button"
                onClick={goNext}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Próximo
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Tipos de refeição
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {mealTypeOptions.map((option) => (
                <span
                  key={option.value}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                >
                  {option.emoji} {option.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 md:px-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Cardápio publicado
                </h2>

                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Refeições cadastradas pela escola no período selecionado.
                </p>
              </div>

              <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                {meals.length} item(ns)
              </div>
            </div>
          </div>

          <div className="p-4 md:p-6">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                Carregando cardápio...
              </div>
            ) : groupedMeals.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="text-4xl">🍽️</div>

                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  Nenhum cardápio publicado
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  A escola ainda não cadastrou refeições para este período.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {groupedMeals.map(([date, items]) => (
                  <section
                    key={date}
                    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Data
                        </div>

                        <h3 className="mt-1 text-lg font-semibold capitalize text-slate-900">
                          {formatDateBR(date)}
                        </h3>
                      </div>

                      <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                        {items.length} refeição(ões)
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4">
                      {items.map((meal) => (
                        <article
                          key={meal.id}
                          className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                            {mealTypeEmoji(meal.meal_type)} {meal.meal_type_label}
                          </div>

                          <h4 className="mt-3 break-words text-base font-semibold text-slate-900">
                            {meal.title}
                          </h4>

                          {meal.description ? (
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                              {meal.description}
                            </p>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-slate-400">
                              Sem observações adicionais.
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}