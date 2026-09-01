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

type GetResponse = {
  ok: boolean;
  exists?: boolean;
  academicYear?: number;
  settings?: AcademicSettings | null;
  defaults?: AcademicSettings;
  error?: string;
  details?: string;
};

type SaveResponse = {
  ok: boolean;
  createdOrUpdated?: boolean;
  settings?: AcademicSettings;
  error?: string;
  details?: string;
};

function currentYear() {
  return new Date().getFullYear();
}

function defaultSettings(): AcademicSettings {
  return {
    academicYear: currentYear(),
    periodsCount: 4,
    minimumPassingGrade: 6,
    minimumAttendancePercentage: 75,
    gradingScaleMax: 10,
    isActive: true,
  };
}

export default function AcademicSettingsPage() {
  const [settings, setSettings] =
    useState<AcademicSettings>(defaultSettings());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function getToken() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message);
    }

    const token = data.session?.access_token;

    if (!token) {
      throw new Error("Sessão não encontrada.");
    }

    return token;
  }

  async function loadSettings(year?: number) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const token = await getToken();

      const academicYear = year ?? settings.academicYear ?? currentYear();

      const response = await fetch(
        `/api/school/academic-settings?academicYear=${academicYear}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data = (await response.json()) as GetResponse;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
            data.details ||
            "Não foi possível carregar as configurações acadêmicas."
        );
      }

      if (data.exists && data.settings) {
        setSettings(data.settings);
        return;
      }

      if (data.defaults) {
        setSettings({
          ...defaultSettings(),
          ...data.defaults,
          academicYear,
        });
        return;
      }

      setSettings({
        ...defaultSettings(),
        academicYear,
      });
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
    void loadSettings(currentYear());
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

  async function saveSettings() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
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

      const token = await getToken();

      const response = await fetch("/api/school/academic-settings", {
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
      });

      const data = (await response.json()) as SaveResponse;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
            data.details ||
            "Não foi possível salvar as configurações."
        );
      }

      if (data.settings) {
        setSettings(data.settings);
      }

      setMessage("Configurações acadêmicas salvas com sucesso.");
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
            Defina as regras gerais utilizadas pelo sistema para o ano
            letivo, períodos, notas e frequência escolar.
          </p>
        </div>

        <div className="p-5 md:p-8">
          {error ? (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-900">
                Ano letivo
              </label>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Ano acadêmico ao qual estas regras serão aplicadas.
              </p>

              <div className="mt-4 flex gap-2">
                <input
                  type="number"
                  min={2000}
                  max={2200}
                  value={settings.academicYear}
                  onChange={(event) =>
                    updateField(
                      "academicYear",
                      Number(event.target.value)
                    )
                  }
                  className="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
                />

                <button
                  type="button"
                  onClick={() => void loadSettings(settings.academicYear)}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  Carregar
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-900">
                Períodos letivos
              </label>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Quantidade de etapas avaliativas do ano letivo.
              </p>

              <select
                value={settings.periodsCount}
                onChange={(event) =>
                  updateField(
                    "periodsCount",
                    Number(event.target.value)
                  )
                }
                className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
              >
                <option value={1}>1 período</option>
                <option value={2}>2 períodos</option>
                <option value={3}>3 períodos</option>
                <option value={4}>4 períodos</option>
                <option value={5}>5 períodos</option>
                <option value={6}>6 períodos</option>
                <option value={7}>7 períodos</option>
                <option value={8}>8 períodos</option>
                <option value={9}>9 períodos</option>
                <option value={10}>10 períodos</option>
                <option value={11}>11 períodos</option>
                <option value={12}>12 períodos</option>
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
                    Percentual mínimo de presença exigido para o aluno.
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

          <div className="mt-7 rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Resumo das regras
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                    Ano {settings.academicYear}
                  </span>

                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                    {settings.periodsCount} períodos
                  </span>

                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                    Média {settings.minimumPassingGrade}
                  </span>

                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                    Frequência{" "}
                    {settings.minimumAttendancePercentage}%
                  </span>

                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                    Escala 0–{settings.gradingScaleMax}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => void saveSettings()}
                className="w-full rounded-2xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
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