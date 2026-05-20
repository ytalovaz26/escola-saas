"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ClassOption = {
  id: string;
  name: string;
  rawName?: string;
  grade?: string | null;
  section?: string | null;
  shift?: string | null;
};

type TeacherOption = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
};

type SubjectOption = {
  id: string;
  name: string;
};

type ScheduleRow = {
  id: string;
  schoolId: string;
  classId: string;
  className: string;
  teacherUserId: string;
  teacherName: string;
  teacherEmail: string | null;
  subjectId: string | null;
  subjectName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  room: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Options = {
  classes: ClassOption[];
  teachers: TeacherOption[];
  subjects: SubjectOption[];
};

const WEEKDAYS = [
  { value: 0, label: "Domingo", short: "Dom" },
  { value: 1, label: "Segunda-feira", short: "Seg" },
  { value: 2, label: "Terça-feira", short: "Ter" },
  { value: 3, label: "Quarta-feira", short: "Qua" },
  { value: 4, label: "Quinta-feira", short: "Qui" },
  { value: 5, label: "Sexta-feira", short: "Sex" },
  { value: 6, label: "Sábado", short: "Sáb" },
];

function cleanText(value: unknown) {
  return String(value || "").trim();
}

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor." };
  }
}

function weekdayLabel(value: number) {
  return WEEKDAYS.find((item) => item.value === value)?.label || "Dia";
}

function weekdayShort(value: number) {
  return WEEKDAYS.find((item) => item.value === value)?.short || "Dia";
}

function groupedByWeekday(schedule: ScheduleRow[]) {
  return WEEKDAYS.map((day) => ({
    ...day,
    items: schedule.filter((row) => Number(row.weekday) === day.value),
  }));
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[30px] border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
        📅
      </div>

      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>

      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function InfoBadge({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "blue" | "green" | "amber";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-white text-slate-700";

  return (
    <div className={`rounded-[24px] border p-5 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>

      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

function ScheduleCard({
  row,
  onDelete,
  deletingId,
}: {
  row: ScheduleRow;
  onDelete: (row: ScheduleRow) => void;
  deletingId: string | null;
}) {
  const deleting = deletingId === row.id;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              {weekdayShort(row.weekday)}
            </span>

            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              {row.startTime} - {row.endTime}
            </span>

            {row.room ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                Sala: {row.room}
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 break-words text-lg font-bold text-slate-950">
            {row.subjectName || "Aula sem disciplina definida"}
          </h3>

          <p className="mt-2 break-words text-sm leading-6 text-slate-500">
            Turma: <span className="font-semibold text-slate-700">{row.className}</span>
          </p>

          <p className="mt-1 break-words text-sm leading-6 text-slate-500">
            Professor:{" "}
            <span className="font-semibold text-slate-700">{row.teacherName}</span>
            {row.teacherEmail ? (
              <span className="text-slate-400"> • {row.teacherEmail}</span>
            ) : null}
          </p>

          {row.notes ? (
            <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              {row.notes}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onDelete(row)}
          disabled={deleting}
          className="shrink-0 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
        >
          {deleting ? "Removendo..." : "Remover"}
        </button>
      </div>
    </div>
  );
}

export default function SchoolSchedulePage() {
  const router = useRouter();

  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [options, setOptions] = useState<Options>({
    classes: [],
    teachers: [],
    subjects: [],
  });

  const [classId, setClassId] = useState("");
  const [teacherUserId, setTeacherUserId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("07:50");
  const [room, setRoom] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const grouped = useMemo(() => groupedByWeekday(schedule), [schedule]);

  const totalTeachers = useMemo(() => {
    return new Set(schedule.map((row) => row.teacherUserId)).size;
  }, [schedule]);

  const totalClasses = useMemo(() => {
    return new Set(schedule.map((row) => row.classId)).size;
  }, [schedule]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  function applyResponse(json: any) {
    setSchedule(Array.isArray(json?.schedule) ? json.schedule : []);

    if (json?.options) {
      setOptions({
        classes: Array.isArray(json.options.classes) ? json.options.classes : [],
        teachers: Array.isArray(json.options.teachers) ? json.options.teachers : [],
        subjects: Array.isArray(json.options.subjects) ? json.options.subjects : [],
      });

      if (!classId && json.options.classes?.[0]?.id) {
        setClassId(json.options.classes[0].id);
      }

      if (!teacherUserId && json.options.teachers?.[0]?.userId) {
        setTeacherUserId(json.options.teachers[0].userId);
      }

      if (!subjectId && json.options.subjects?.[0]?.id) {
        setSubjectId(json.options.subjects[0].id);
      }
    }
  }

  async function loadSchedule() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getToken();

      if (!token) return;

      const res = await fetch("/api/school/schedule?includeOptions=1", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar grade de horários.");
        return;
      }

      applyResponse(json);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar grade.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getToken();

      if (!token) return;

      if (!classId) {
        setError("Selecione uma turma.");
        return;
      }

      if (!teacherUserId) {
        setError("Selecione um professor.");
        return;
      }

      if (!startTime || !endTime) {
        setError("Informe o horário inicial e final.");
        return;
      }

      const res = await fetch("/api/school/schedule", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          classId,
          teacherUserId,
          subjectId: subjectId || null,
          weekday: Number(weekday),
          startTime,
          endTime,
          room: cleanText(room) || null,
          notes: cleanText(notes) || null,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao criar horário.");
        return;
      }

      applyResponse(json);
      setMessage("Horário cadastrado com sucesso.");
      setRoom("");
      setNotes("");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao criar horário.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: ScheduleRow) {
    const confirmed = window.confirm(
      `Remover este horário?\n\n${weekdayLabel(row.weekday)} • ${row.startTime} - ${row.endTime}\n${row.className}`
    );

    if (!confirmed) return;

    setDeletingId(row.id);
    setError(null);
    setMessage(null);

    try {
      const token = await getToken();

      if (!token) return;

      const res = await fetch(`/api/school/schedule?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao remover horário.");
        return;
      }

      applyResponse(json);
      setMessage("Horário removido com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao remover horário.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[40px] border border-slate-200 bg-slate-950 p-6 text-white shadow-xl md:p-8">
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: "rgb(var(--brand-rgb))" }}
        />

        <div className="absolute -bottom-28 left-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
              Grade oficial da escola
            </div>

            <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight md:text-5xl">
              Horários de aula
            </h1>

            <p className="mt-3 max-w-3xl break-words text-sm leading-7 text-slate-300 md:text-base">
              Cadastre a grade oficial por turma, professor, disciplina, dia da semana
              e horário. Depois essa rotina aparecerá automaticamente para o professor
              e, futuramente, para os responsáveis.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/school")}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
            >
              Voltar ao painel
            </button>

            <button
              type="button"
              onClick={loadSchedule}
              className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Recarregar
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <InfoBadge label="Horários ativos" value={schedule.length} tone="blue" />
        <InfoBadge label="Turmas na grade" value={totalClasses} tone="green" />
        <InfoBadge label="Professores" value={totalTeachers} tone="amber" />
        <InfoBadge label="Disciplinas" value={options.subjects.length} />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Novo horário
          </div>

          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            Cadastrar aula na grade
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Selecione turma, professor e os dados do horário. A disciplina é opcional,
            mas recomendada.
          </p>

          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Turma
              </label>

              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
                required
              >
                <option value="">Selecione uma turma</option>
                {options.classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Professor
              </label>

              <select
                value={teacherUserId}
                onChange={(e) => setTeacherUserId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
                required
              >
                <option value="">Selecione um professor</option>
                {options.teachers.map((teacher) => (
                  <option key={teacher.userId} value={teacher.userId}>
                    {teacher.name}
                    {teacher.email ? ` • ${teacher.email}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Disciplina
              </label>

              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
              >
                <option value="">Sem disciplina definida</option>
                {options.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Dia da semana
              </label>

              <select
                value={weekday}
                onChange={(e) => setWeekday(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
                required
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Início
                </label>

                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Fim
                </label>

                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Sala/local
              </label>

              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Ex: Sala 03, laboratório, quadra..."
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Observações
              </label>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações internas sobre este horário..."
                rows={4}
                className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-600 focus:ring-4 focus:ring-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Cadastrar horário"}
            </button>
          </form>

          <div className="mt-5 rounded-3xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800">
            A grade cadastrada aqui será usada para alimentar a agenda do professor e,
            depois, a rotina do aluno no portal dos pais.
          </div>
        </div>

        <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Grade semanal
              </div>

              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                Horários cadastrados
              </h2>
            </div>

            <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
              {schedule.length} horário(s)
            </div>
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="h-32 animate-pulse rounded-[28px] bg-slate-100"
                  />
                ))}
              </div>
            ) : schedule.length === 0 ? (
              <EmptyState
                title="Nenhum horário cadastrado"
                description="Cadastre o primeiro horário usando o formulário ao lado. Depois esta grade será exibida na agenda do professor."
              />
            ) : (
              <div className="space-y-6">
                {grouped.map((day) => {
                  if (day.items.length === 0) return null;

                  return (
                    <div key={day.value} className="rounded-[30px] bg-slate-50 p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold text-slate-950">
                            {day.label}
                          </h3>

                          <p className="text-sm text-slate-500">
                            {day.items.length} horário(s) cadastrado(s)
                          </p>
                        </div>

                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                          {day.short}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {day.items.map((row) => (
                          <ScheduleCard
                            key={row.id}
                            row={row}
                            onDelete={handleDelete}
                            deletingId={deletingId}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}