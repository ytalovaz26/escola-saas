"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AcademicSettings = {
  id?: string;
  schoolId?: string;
  academicYear: number;
  periodsCount: number;
  minimumPassingGrade: number;
  minimumAttendancePercentage: number;
  gradingScaleMax: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type AcademicPeriod = {
  id?: string;
  schoolId?: string;
  academicYear: number;
  periodNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type GetSettingsResponse = {
  ok: boolean;
  exists?: boolean;
  academicYear?: number;
  settings?: AcademicSettings | null;
  defaults?: AcademicSettings;
  error?: string;
  details?: string;
};

type SaveSettingsResponse = {
  ok: boolean;
  createdOrUpdated?: boolean;
  settings?: AcademicSettings;
  error?: string;
  details?: string;
};

type GetPeriodsResponse = {
  ok: boolean;
  academicYear?: number;
  periods?: AcademicPeriod[];
  error?: string;
  details?: string;
};

type SavePeriodsResponse = {
  ok: boolean;
  createdOrUpdated?: boolean;
  academicYear?: number;
  periods?: AcademicPeriod[];
  error?: string;
  details?: string;
};

function currentYear() {
  return new Date().getFullYear();
}

function defaultSettings(year = currentYear()): AcademicSettings {
  return {
    academicYear: year,
    periodsCount: 4,
    minimumPassingGrade: 6,
    minimumAttendancePercentage: 75,
    gradingScaleMax: 10,
    isActive: true,
  };
}

function defaultPeriodName(periodNumber: number, periodsCount: number) {
  if (periodsCount === 2) {
    return `${periodNumber}º Semestre`;
  }

  if (periodsCount === 3) {
    return `${periodNumber}º Trimestre`;
  }

  if (periodsCount === 4) {
    return `${periodNumber}º Bimestre`;
  }

  return `${periodNumber}º Período`;
}

function buildDefaultPeriods(
  academicYear: number,
  periodsCount: number
): AcademicPeriod[] {
  return Array.from({ length: periodsCount }, (_, index) => {
    const periodNumber = index + 1;

    return {
      academicYear,
      periodNumber,
      name: defaultPeriodName(periodNumber, periodsCount),
      startDate: "",
      endDate: "",
      isActive: true,
    };
  });
}

function normalizePeriodsForCount(
  currentPeriods: AcademicPeriod[],
  academicYear: number,
  periodsCount: number
) {
  return Array.from({ length: periodsCount }, (_, index) => {
    const periodNumber = index + 1;

    const existing = currentPeriods.find(
      (period) => period.periodNumber === periodNumber
    );

    if (existing) {
      return {
        ...existing,
        academicYear,
        periodNumber,
      };
    }

    return {
      academicYear,
      periodNumber,
      name: defaultPeriodName(periodNumber, periodsCount),
      startDate: "",
      endDate: "",
      isActive: true,
    };
  });
}

function formatDate(date: string) {
  if (!date) return "Data não definida";

  const [year, month, day] = date.split("-");

  if (!year || !month || !day) {
    return date;
  }

  return `${day}/${month}/${year}`;
}

export default function AcademicSettingsPage() {
  const [settings, setSettings] =
    useState<AcademicSettings>(defaultSettings());

  const [periods, setPeriods] = useState<AcademicPeriod[]>(
    buildDefaultPeriods(currentYear(), 4)
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function getToken() {
    const { data, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const token = data.session?.access_token;

    if (!token) {
      throw new Error("Sessão não encontrada.");
    }

    return token;
  }

  async function loadAcademicYear(year?: number) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const token = await getToken();
      const academicYear = year ?? settings.academicYear ?? currentYear();

      if (
        !Number.isInteger(academicYear) ||
        academicYear < 2000 ||
        academicYear > 2200
      ) {
        throw new Error("Informe um ano letivo válido.");
      }

      const [settingsResponse, periodsResponse] = await Promise.all([
        fetch(
          `/api/school/academic-settings?academicYear=${academicYear}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          }
        ),
        fetch(
          `/api/school/academic-periods?academicYear=${academicYear}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          }
        ),
      ]);

      const settingsData =
        (await settingsResponse.json()) as GetSettingsResponse;

      const periodsData =
        (await periodsResponse.json()) as GetPeriodsResponse;

      if (!settingsResponse.ok || !settingsData.ok) {
        throw new Error(
          settingsData.error ||
            settingsData.details ||
            "Não foi possível carregar as configurações acadêmicas."
        );
      }

      if (!periodsResponse.ok || !periodsData.ok) {
        throw new Error(
          periodsData.error ||
            periodsData.details ||
            "Não foi possível carregar os períodos acadêmicos."
        );
      }

      let loadedSettings: AcademicSettings;

      if (settingsData.exists && settingsData.settings) {
        loadedSettings = settingsData.settings;
      } else if (settingsData.defaults) {
        loadedSettings = {
          ...defaultSettings(academicYear),
          ...settingsData.defaults,
          academicYear,
        };
      } else {
        loadedSettings = defaultSettings(academicYear);
      }

      setSettings(loadedSettings);

      const loadedPeriods = Array.isArray(periodsData.periods)
        ? periodsData.periods
        : [];

      if (loadedPeriods.length > 0) {
        setPeriods(
          normalizePeriodsForCount(
            loadedPeriods,
            academicYear,
            loadedSettings.periodsCount
          )
        );
      } else {
        setPeriods(
          buildDefaultPeriods(
            academicYear,
            loadedSettings.periodsCount
          )
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao carregar configurações acadêmicas."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAcademicYear(currentYear());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField<K extends keyof AcademicSettings>(
    field: K,
    value: AcademicSettings[K]
  ) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));

    setMessage("");
    setError("");
  }

  function updateAcademicYear(value: number) {
    setSettings((current) => ({
      ...current,
      academicYear: value,
    }));

    setPeriods((current) =>
      current.map((period) => ({
        ...period,
        academicYear: value,
      }))
    );

    setMessage("");
    setError("");
  }

  function updatePeriodsCount(value: number) {
    setSettings((current) => ({
      ...current,
      periodsCount: value,
    }));

    setPeriods((current) =>
      normalizePeriodsForCount(
        current,
        settings.academicYear,
        value
      )
    );

    setMessage("");
    setError("");
  }

  function updatePeriod<K extends keyof AcademicPeriod>(
    periodNumber: number,
    field: K,
    value: AcademicPeriod[K]
  ) {
    setPeriods((current) =>
      current.map((period) =>
        period.periodNumber === periodNumber
          ? {
              ...period,
              [field]: value,
            }
          : period
      )
    );

    setMessage("");
    setError("");
  }

  function validateBeforeSave() {
    if (
      !Number.isInteger(settings.academicYear) ||
      settings.academicYear < 2000 ||
      settings.academicYear > 2200
    ) {
      throw new Error("Informe um ano letivo válido.");
    }

    if (
      !Number.isInteger(settings.periodsCount) ||
      settings.periodsCount < 1 ||
      settings.periodsCount > 12
    ) {
      throw new Error(
        "A quantidade de períodos deve estar entre 1 e 12."
      );
    }

    if (
      !Number.isFinite(settings.gradingScaleMax) ||
      settings.gradingScaleMax <= 0
    ) {
      throw new Error("A nota máxima deve ser maior que zero.");
    }

    if (
      !Number.isFinite(settings.minimumPassingGrade) ||
      settings.minimumPassingGrade < 0 ||
      settings.minimumPassingGrade > settings.gradingScaleMax
    ) {
      throw new Error(
        `A média mínima deve estar entre 0 e ${settings.gradingScaleMax}.`
      );
    }

    if (
      !Number.isFinite(settings.minimumAttendancePercentage) ||
      settings.minimumAttendancePercentage < 0 ||
      settings.minimumAttendancePercentage > 100
    ) {
      throw new Error(
        "A frequência mínima deve estar entre 0% e 100%."
      );
    }

    if (periods.length !== settings.periodsCount) {
      throw new Error(
        "A quantidade de períodos cadastrados não corresponde à configuração do ano letivo."
      );
    }

    const ordered = [...periods].sort(
      (a, b) => a.periodNumber - b.periodNumber
    );

    for (let index = 0; index < ordered.length; index += 1) {
      const period = ordered[index];

      if (!period.name.trim()) {
        throw new Error(
          `Informe o nome do ${period.periodNumber}º período.`
        );
      }

      if (!period.startDate) {
        throw new Error(
          `Informe a data inicial de "${period.name}".`
        );
      }

      if (!period.endDate) {
        throw new Error(
          `Informe a data final de "${period.name}".`
        );
      }

      if (period.endDate < period.startDate) {
        throw new Error(
          `A data final de "${period.name}" não pode ser anterior à data inicial.`
        );
      }
    }

    const byDate = [...periods].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );

    for (let index = 1; index < byDate.length; index += 1) {
      const previous = byDate[index - 1];
      const current = byDate[index];

      if (current.startDate <= previous.endDate) {
        throw new Error(
          `Os períodos "${previous.name}" e "${current.name}" possuem datas sobrepostas.`
        );
      }
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      validateBeforeSave();

      const token = await getToken();

      /*
       * Primeiro salvamos a configuração geral porque a API de períodos
       * valida periods_count diretamente em school_academic_settings.
       */
      const settingsResponse = await fetch(
        "/api/school/academic-settings",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            academicYear: settings.academicYear,
            periodsCount: settings.periodsCount,
            minimumPassingGrade: settings.minimumPassingGrade,
            minimumAttendancePercentage:
              settings.minimumAttendancePercentage,
            gradingScaleMax: settings.gradingScaleMax,
            isActive: settings.isActive,
          }),
        }
      );

      const settingsData =
        (await settingsResponse.json()) as SaveSettingsResponse;

      if (!settingsResponse.ok || !settingsData.ok) {
        throw new Error(
          settingsData.error ||
            settingsData.details ||
            "Não foi possível salvar as configurações acadêmicas."
        );
      }

      /*
       * Somente após a configuração geral existir, salvamos os períodos.
       */
      const periodsResponse = await fetch(
        "/api/school/academic-periods",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            academicYear: settings.academicYear,
            periods: periods.map((period) => ({
              periodNumber: period.periodNumber,
              name: period.name.trim(),
              startDate: period.startDate,
              endDate: period.endDate,
              isActive: period.isActive,
            })),
          }),
        }
      );

      const periodsData =
        (await periodsResponse.json()) as SavePeriodsResponse;

      if (!periodsResponse.ok || !periodsData.ok) {
        throw new Error(
          periodsData.error ||
            periodsData.details ||
            "As regras gerais foram salvas, mas não foi possível salvar os períodos acadêmicos."
        );
      }

      if (settingsData.settings) {
        setSettings(settingsData.settings);
      }

      if (periodsData.periods) {
        setPeriods(periodsData.periods);
      }

      setMessage(
        "Configurações e períodos acadêmicos salvos com sucesso."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao salvar configurações acadêmicas."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-8 w-72 rounded-xl bg-slate-200" />
          <div className="mt-3 h-4 w-96 max-w-full rounded-xl bg-slate-100" />

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="h-32 rounded-2xl bg-slate-100" />
            <div className="h-32 rounded-2xl bg-slate-100" />
            <div className="h-32 rounded-2xl bg-slate-100" />
            <div className="h-32 rounded-2xl bg-slate-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-950 px-6 py-7 text-white md:px-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Gestão acadêmica
          </div>

          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
            Configurações Acadêmicas
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            Defina o ano letivo, os períodos avaliativos, suas datas,
            critérios de aprovação e frequência mínima da escola.
          </p>
        </div>

        <div className="p-5 md:p-8">
          {error ? (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {message}
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-900">
                Ano letivo
              </label>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Selecione o ano acadêmico que deseja configurar.
              </p>

              <div className="mt-4 flex gap-2">
                <input
                  type="number"
                  min={2000}
                  max={2200}
                  value={settings.academicYear}
                  onChange={(event) =>
                    updateAcademicYear(Number(event.target.value))
                  }
                  className="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
                />

                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() =>
                    void loadAcademicYear(settings.academicYear)
                  }
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Carregar
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-900">
                Quantidade de períodos
              </label>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                O sistema criará os campos correspondentes abaixo.
              </p>

              <select
                value={settings.periodsCount}
                onChange={(event) =>
                  updatePeriodsCount(Number(event.target.value))
                }
                className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (count) => (
                    <option key={count} value={count}>
                      {count} {count === 1 ? "período" : "períodos"}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-900">
                Nota máxima
              </label>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Valor máximo utilizado na escala de notas da escola.
              </p>

              <input
                type="number"
                min={0.1}
                step={0.1}
                value={settings.gradingScaleMax}
                onChange={(event) =>
                  updateField(
                    "gradingScaleMax",
                    Number(event.target.value)
                  )
                }
                className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
              />
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-900">
                Média mínima para aprovação
              </label>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Nota mínima exigida para aprovação acadêmica.
              </p>

              <input
                type="number"
                min={0}
                max={settings.gradingScaleMax}
                step={0.1}
                value={settings.minimumPassingGrade}
                onChange={(event) =>
                  updateField(
                    "minimumPassingGrade",
                    Number(event.target.value)
                  )
                }
                className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
              />
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 lg:col-span-2">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-slate-900">
                    Frequência mínima
                  </label>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Percentual mínimo de presença exigido para aprovação.
                  </p>

                  <div className="relative mt-4">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={settings.minimumAttendancePercentage}
                      onChange={(event) =>
                        updateField(
                          "minimumAttendancePercentage",
                          Number(event.target.value)
                        )
                      }
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-12 text-slate-900 outline-none transition focus:border-slate-500"
                    />

                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                      %
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Status do ano letivo
                  </div>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Define se esta configuração acadêmica está ativa.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      updateField("isActive", !settings.isActive)
                    }
                    className={[
                      "mt-4 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
                      settings.isActive
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-slate-300 bg-white",
                    ].join(" ")}
                  >
                    <div>
                      <div
                        className={[
                          "text-sm font-semibold",
                          settings.isActive
                            ? "text-emerald-800"
                            : "text-slate-700",
                        ].join(" ")}
                      >
                        {settings.isActive
                          ? "Ano letivo ativo"
                          : "Ano letivo inativo"}
                      </div>

                      <div className="mt-0.5 text-xs text-slate-500">
                        {settings.isActive
                          ? "Configuração habilitada para utilização."
                          : "Configuração temporariamente desativada."}
                      </div>
                    </div>

                    <div
                      className={[
                        "relative h-7 w-12 shrink-0 rounded-full transition",
                        settings.isActive
                          ? "bg-emerald-500"
                          : "bg-slate-300",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all",
                          settings.isActive
                            ? "left-6"
                            : "left-1",
                        ].join(" ")}
                      />
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Calendário acadêmico
                </div>

                <h2 className="mt-1 text-xl font-semibold text-slate-900">
                  Períodos letivos de {settings.academicYear}
                </h2>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Informe o nome e as datas reais de cada período. Essas
                  datas serão utilizadas posteriormente por notas,
                  boletins, diário de classe e histórico escolar.
                </p>
              </div>

              <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                {settings.periodsCount}{" "}
                {settings.periodsCount === 1 ? "período" : "períodos"}
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {periods.map((period) => (
                <div
                  key={period.periodNumber}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Período {period.periodNumber}
                      </div>

                      <div className="mt-1 text-base font-semibold text-slate-900">
                        {period.name || `${period.periodNumber}º Período`}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updatePeriod(
                          period.periodNumber,
                          "isActive",
                          !period.isActive
                        )
                      }
                      className={[
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                        period.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500",
                      ].join(" ")}
                    >
                      {period.isActive ? "Ativo" : "Inativo"}
                    </button>
                  </div>

                  <div className="mt-5">
                    <label className="text-xs font-semibold text-slate-600">
                      Nome do período
                    </label>

                    <input
                      type="text"
                      maxLength={100}
                      value={period.name}
                      placeholder="Ex.: 1º Bimestre"
                      onChange={(event) =>
                        updatePeriod(
                          period.periodNumber,
                          "name",
                          event.target.value
                        )
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    />
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-slate-600">
                        Data de início
                      </label>

                      <input
                        type="date"
                        value={period.startDate}
                        onChange={(event) =>
                          updatePeriod(
                            period.periodNumber,
                            "startDate",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600">
                        Data de término
                      </label>

                      <input
                        type="date"
                        value={period.endDate}
                        onChange={(event) =>
                          updatePeriod(
                            period.periodNumber,
                            "endDate",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                      />
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    {period.startDate && period.endDate
                      ? `${formatDate(period.startDate)} até ${formatDate(
                          period.endDate
                        )}`
                      : "Defina as datas de início e término deste período."}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Resumo das regras
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
                    Ano {settings.academicYear}
                  </span>

                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
                    {settings.periodsCount} períodos
                  </span>

                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
                    Média {settings.minimumPassingGrade}
                  </span>

                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
                    Frequência{" "}
                    {settings.minimumAttendancePercentage}%
                  </span>

                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
                    Escala 0–{settings.gradingScaleMax}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => void saveSettings()}
                className="w-full rounded-2xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 xl:w-auto"
              >
                {saving
                  ? "Salvando..."
                  : "Salvar configurações acadêmicas"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}