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

type SchoolMeal = {
  id: string;
  school_id: string;
  meal_date: string;
  meal_type: MealType;
  meal_type_label: string;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const mealTypeOptions: Array<{ value: MealType; label: string; emoji: string }> = [
  { value: "breakfast", label: "Café da manhã", emoji: "☕" },
  { value: "morning_snack", label: "Lanche da manhã", emoji: "🍎" },
  { value: "lunch", label: "Almoço", emoji: "🍽️" },
  { value: "afternoon_snack", label: "Lanche da tarde", emoji: "🥪" },
  { value: "dinner", label: "Jantar", emoji: "🌙" },
  { value: "other", label: "Outro", emoji: "📌" },
];

function cleanText(value: unknown) {
  return String(value || "").trim();
}

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

function formatShortDateBR(dateYmd: string) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!y || !m || !d) return dateYmd;

  return `${pad2(d)}/${pad2(m)}/${y}`;
}

function mealTypeLabel(type: MealType) {
  return mealTypeOptions.find((item) => item.value === type)?.label || "Cardápio";
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

export default function SchoolMenuPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [baseDate, setBaseDate] = useState(todayYMD());

  const [meals, setMeals] = useState<SchoolMeal[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [mealDate, setMealDate] = useState(todayYMD());
  const [mealType, setMealType] = useState<MealType>("lunch");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    const map = new Map<string, SchoolMeal[]>();

    for (const meal of meals) {
      const key = meal.meal_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(meal);
    }

    for (const [key, list] of map.entries()) {
      map.set(
        key,
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

      const res = await fetch(`/api/school/menu?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao carregar cardápio.");
        setMeals([]);
        return;
      }

      setMeals(Array.isArray(json.meals) ? json.meals : []);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar cardápio.");
      setMeals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  function resetForm() {
    setEditingId(null);
    setMealDate(baseDate);
    setMealType("lunch");
    setTitle("");
    setDescription("");
  }

  function startEdit(meal: SchoolMeal) {
    setEditingId(meal.id);
    setMealDate(meal.meal_date);
    setMealType(meal.meal_type);
    setTitle(meal.title);
    setDescription(meal.description || "");
    setSuccess(null);
    setError(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveMeal() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const safeTitle = cleanText(title);
      const safeDescription = cleanText(description);

      if (!mealDate) {
        setError("Informe a data do cardápio.");
        return;
      }

      if (!safeTitle) {
        setError("Informe o título do cardápio.");
        return;
      }

      const token = await getToken();
      if (!token) return;

      const method = editingId ? "PUT" : "POST";

      const res = await fetch("/api/school/menu", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          id: editingId,
          mealDate,
          mealType,
          title: safeTitle,
          description: safeDescription || null,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao salvar cardápio.");
        return;
      }

      setSuccess(editingId ? "Cardápio atualizado com sucesso." : "Cardápio cadastrado com sucesso.");
      resetForm();
      await loadMeals();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao salvar cardápio.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMeal(meal: SchoolMeal) {
    const ok = window.confirm(`Deseja remover este item do cardápio?\n\n${meal.title}`);

    if (!ok) return;

    setError(null);
    setSuccess(null);

    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`/api/school/menu?id=${encodeURIComponent(meal.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao remover cardápio.");
        return;
      }

      setSuccess("Cardápio removido com sucesso.");
      await loadMeals();
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao remover cardápio.");
    }
  }

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
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                Alimentação escolar
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Cardápio escolar
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                Cadastre e acompanhe as refeições servidas na escola. O cardápio será
                exibido para os responsáveis no portal dos pais.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadMeals}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
              >
                Recarregar
              </button>

              <button
                type="button"
                onClick={() => router.push("/school")}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
              >
                Voltar ao painel
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-4 md:p-6">
          <StatCard
            label="Itens"
            value={meals.length}
            help="Total de refeições cadastradas no período."
          />

          <StatCard
            label="Dias"
            value={totalDaysWithMeal}
            help="Quantidade de dias com algum cardápio."
          />

          <StatCard
            label="Período"
            value={`${formatShortDateBR(range.from)} - ${formatShortDateBR(range.to)}`}
            help="Intervalo atualmente exibido."
          />

          <StatCard
            label="Próximo"
            value={nextMeal ? mealTypeLabel(nextMeal.meal_type) : "—"}
            help={nextMeal ? `${nextMeal.title} • ${formatShortDateBR(nextMeal.meal_date)}` : "Nenhuma refeição futura no período."}
          />
        </div>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      {success ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {success}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {editingId ? "Editar cardápio" : "Cadastrar refeição"}
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Preencha a data, o tipo da refeição e a descrição do cardápio.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Data
              </label>

              <input
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Tipo de refeição
              </label>

              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as MealType)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
              >
                {mealTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.emoji} {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Título
              </label>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Arroz, feijão, frango e salada"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
                maxLength={180}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Descrição / observações
              </label>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Acompanha suco natural. Sem fritura. Opção especial para alunos com restrição alimentar deve ser alinhada com a coordenação."
                className="min-h-[160px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                disabled={saving}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={saveMeal}
                disabled={saving}
                className="flex-1 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {saving
                  ? "Salvando..."
                  : editingId
                    ? "Salvar alterações"
                    : "Cadastrar cardápio"}
              </button>

              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Visualização
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Navegue por dia, semana ou mês para conferir o cardápio cadastrado.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
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
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Período
                </div>

                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatShortDateBR(range.from)} até {formatShortDateBR(range.to)}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
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
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Tipos cadastráveis
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
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Cardápios cadastrados
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                Lista agrupada por data no período selecionado.
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
                Nenhum cardápio cadastrado
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Cadastre uma refeição para este período e ela aparecerá aqui.
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

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {items.map((meal) => (
                      <article
                        key={meal.id}
                        className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
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
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(meal)}
                              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                              Editar
                            </button>

                            <button
                              type="button"
                              onClick={() => removeMeal(meal)}
                              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}