"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ClassRow = {
  id: string;
  name: string;
  grade: string | null;
  shift: string | null;
};

type StudentRow = {
  id: string;
  full_name: string;
  birth_date: string | null;
  registration_number: string | null;
  student_photo_url?: string | null;
};

type StudentActiveClassRow = {
  student_id: string;
  class_id: string;
};

type StudentExtraForm = {
  gender: string;
  cpf: string;
  rg: string;
  birthCertificate: string;
  motherName: string;
  fatherName: string;
  medicalNotes: string;
  allergies: string;
  continuousMedication: string;
  foodRestrictions: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  authorizedPickupNotes: string;
  generalNotes: string;
};

type StudentProfilePayload = {
  ok: true;
  saved?: boolean;
  student: {
    id: string;
    schoolId: string;
    fullName: string | null;
    birthDate: string | null;
    registrationNumber: string | null;
    legacyClassId: string | null;
    createdAt: string | null;
    studentPhotoUrl?: string | null;
    photoUrl?: string | null;
    studentPhotoUploadedAt?: string | null;
    studentPhotoUploadedBy?: string | null;
    studentProfileUpdatedAt?: string | null;

    gender?: string | null;
    cpf?: string | null;
    rg?: string | null;
    birthCertificate?: string | null;
    motherName?: string | null;
    fatherName?: string | null;
    medicalNotes?: string | null;
    allergies?: string | null;
    continuousMedication?: string | null;
    foodRestrictions?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    authorizedPickupNotes?: string | null;
    generalNotes?: string | null;
  };
  activeClass: {
    id: string;
    name: string | null;
    grade: string | null;
    shift: string | null;
    createdAt: string | null;
    link: {
      id: string;
      startedAt: string | null;
      endedAt: string | null;
      createdAt: string | null;
      isActive: boolean;
    } | null;
  } | null;
  parents: Array<{
    id: string;
    linkId: string | null;
    linkedAt: string | null;
    schoolId: string | null;
    userId: string | null;
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
    addressText: string | null;
  }>;
};

function initials(name: string) {
  const safe = String(name || "").trim();
  if (!safe) return "AL";
  const parts = safe.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "AL";
}

function initialsFromName(name: string | null | undefined) {
  const safe = String(name || "").trim();
  if (!safe) return "RP";
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "RP";
}

function formatDateBR(value?: string | null) {
  if (!value) return "—";
  const clean = String(value).slice(0, 10);
  const [y, m, d] = clean.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return formatDateBR(value);
  }
}

function field(value?: string | null) {
  const safe = String(value || "").trim();
  return safe || "—";
}

function rawField(value?: string | null) {
  return String(value || "").trim();
}

function getStudentPhotoUrl(profile: StudentProfilePayload | null) {
  if (!profile) return null;
  return profile.student.studentPhotoUrl || profile.student.photoUrl || null;
}

function emptyExtraForm(): StudentExtraForm {
  return {
    gender: "",
    cpf: "",
    rg: "",
    birthCertificate: "",
    motherName: "",
    fatherName: "",
    medicalNotes: "",
    allergies: "",
    continuousMedication: "",
    foodRestrictions: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    authorizedPickupNotes: "",
    generalNotes: "",
  };
}

function formFromProfile(profile: StudentProfilePayload | null): StudentExtraForm {
  if (!profile) return emptyExtraForm();

  return {
    gender: rawField(profile.student.gender),
    cpf: rawField(profile.student.cpf),
    rg: rawField(profile.student.rg),
    birthCertificate: rawField(profile.student.birthCertificate),
    motherName: rawField(profile.student.motherName),
    fatherName: rawField(profile.student.fatherName),
    medicalNotes: rawField(profile.student.medicalNotes),
    allergies: rawField(profile.student.allergies),
    continuousMedication: rawField(profile.student.continuousMedication),
    foodRestrictions: rawField(profile.student.foodRestrictions),
    emergencyContactName: rawField(profile.student.emergencyContactName),
    emergencyContactPhone: rawField(profile.student.emergencyContactPhone),
    authorizedPickupNotes: rawField(profile.student.authorizedPickupNotes),
    generalNotes: rawField(profile.student.generalNotes),
  };
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

function InfoBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-800">
        {field(value)}
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        className="input w-full"
        value={value}
        placeholder={placeholder || label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TextAreaInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <textarea
        className="input min-h-[92px] w-full resize-y"
        value={value}
        placeholder={placeholder || label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [links, setLinks] = useState<StudentActiveClassRow[]>([]);

  const [filterClassId, setFilterClassId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profileLoadingId, setProfileLoadingId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<StudentProfilePayload | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [editingExtra, setEditingExtra] = useState(false);
  const [extraForm, setExtraForm] = useState<StudentExtraForm>(emptyExtraForm());
  const [savingExtra, setSavingExtra] = useState(false);
  const [extraMessage, setExtraMessage] = useState<string | null>(null);

  const activeMap = useMemo(() => {
    const map = new Map<string, string>();
    links.forEach((l) => map.set(l.student_id, l.class_id));
    return map;
  }, [links]);

  const classMap = useMemo(() => {
    const map = new Map<string, ClassRow>();
    classes.forEach((c) => map.set(c.id, c));
    return map;
  }, [classes]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let list = students;

    if (filterClassId) {
      list = list.filter((s) => activeMap.get(s.id) === filterClassId);
    }

    if (q) {
      list = list.filter((s) => {
        const name = String(s.full_name || "").toLowerCase();
        const reg = String(s.registration_number || "").toLowerCase();
        return name.includes(q) || reg.includes(q);
      });
    }

    return list;
  }, [students, filterClassId, activeMap, searchTerm]);

  async function getAccessToken() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      throw new Error(sessionError?.message || "Not authenticated");
    }

    return sessionData.session.access_token;
  }

  async function loadAll() {
    setError(null);

    try {
      const token = await getAccessToken();

      const [cRes, sRes, linksRes] = await Promise.all([
        fetch("/api/school/classes", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/school/students", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/school/class-students/list", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const cJson = await safeJson(cRes);
      const sJson = await safeJson(sRes);
      const linksJson = await safeJson(linksRes);

      if (!cRes.ok || !cJson?.ok) {
        setError(cJson?.error || "Erro ao carregar turmas.");
        setClasses([]);
      } else {
        const loadedClasses = cJson.classes || [];
        setClasses(loadedClasses);

        if (!selectedClassId && loadedClasses[0]?.id) {
          setSelectedClassId(loadedClasses[0].id);
        }
      }

      if (!sRes.ok || !sJson?.ok) {
        const errMsg = String(sJson?.error || "");
        if (!errMsg.toLowerCase().includes("classid")) {
          setError((prev) => prev || errMsg || "Erro ao carregar alunos.");
        }
        setStudents([]);
      } else {
        setStudents(sJson.students || []);
      }

      if (!linksRes.ok || !linksJson?.ok) {
        setError((prev) => prev || linksJson?.error || "Erro ao carregar vínculos.");
        setLinks([]);
      } else {
        setLinks(linksJson.links || []);
      }

      const classFromUrl = searchParams.get("classId");
      if (classFromUrl) {
        setFilterClassId(classFromUrl);
      }
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao carregar dados.";
      setError(msg);

      if (msg === "Not authenticated" || String(msg).toLowerCase().includes("sessão")) {
        router.replace("/login");
      }
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadAll();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createStudent() {
    if (!fullName.trim()) {
      setError("Informe o nome completo do aluno.");
      return;
    }

    if (!selectedClassId) {
      setError("Selecione a turma do aluno.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/school/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          birth_date: birthDate || null,
          registration_number: registrationNumber.trim() || null,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok || !json?.student?.id) {
        setError(json?.error || "Erro ao cadastrar aluno.");
        return;
      }

      const studentId = json.student.id as string;

      const assignRes = await fetch("/api/school/class-students/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: studentId,
          class_id: selectedClassId,
        }),
      });

      const assignJson = await safeJson(assignRes);

      if (!assignRes.ok || !assignJson?.ok) {
        setError(assignJson?.error || "Aluno criado, mas houve erro ao vincular à turma.");
        await loadAll();
        return;
      }

      setFullName("");
      setBirthDate("");
      setRegistrationNumber("");

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao cadastrar aluno.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeClass(studentId: string, classId: string) {
    if (!classId) return;

    try {
      setSaving(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/school/class-students/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: studentId,
          class_id: classId,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao trocar turma.");
        return;
      }

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao trocar turma.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setSaving(false);
    }
  }

  async function unassignStudent(studentId: string, studentName: string) {
    const confirmed = window.confirm(`Deseja remover o aluno "${studentName}" da turma atual?`);
    if (!confirmed) return;

    try {
      setUnassigningId(studentId);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/school/class-students/unassign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ student_id: studentId }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Erro ao remover aluno da turma.");
        return;
      }

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao remover vínculo da turma.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setUnassigningId(null);
    }
  }

  async function deleteStudent(studentId: string, studentName: string) {
    const confirmed = window.confirm(`Tem certeza que deseja excluir o aluno "${studentName}"?`);
    if (!confirmed) return;

    try {
      setDeletingId(studentId);
      setError(null);

      const token = await getAccessToken();
      const activeClassId = activeMap.get(studentId);

      if (activeClassId) {
        const unassignRes = await fetch("/api/school/class-students/unassign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ student_id: studentId }),
        });

        const unassignJson = await safeJson(unassignRes);

        if (!unassignRes.ok || !unassignJson?.ok) {
          setError(
            unassignJson?.error ||
              "Não foi possível remover o aluno da turma antes de excluir."
          );
          return;
        }
      }

      const res = await fetch(`/api/school/students/${studentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(
          json?.error ||
            "Não foi possível excluir o aluno. Se ele possui histórico, remova o vínculo da turma antes."
        );
        return;
      }

      await loadAll();
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao excluir aluno.";
      setError(msg);

      if (msg === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function openStudentProfile(studentId: string) {
    setProfileError(null);
    setPhotoMessage(null);
    setExtraMessage(null);
    setEditingExtra(false);
    setSelectedProfile(null);
    setExtraForm(emptyExtraForm());

    try {
      setProfileLoadingId(studentId);

      const token = await getAccessToken();

      const res = await fetch(`/api/school/students/${studentId}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setProfileError(json?.error || "Erro ao carregar ficha do aluno.");
        return;
      }

      const profile = json as StudentProfilePayload;
      setSelectedProfile(profile);
      setExtraForm(formFromProfile(profile));
    } catch (e: any) {
      setProfileError(e?.message || "Erro inesperado ao carregar ficha do aluno.");

      if (e?.message === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setProfileLoadingId(null);
    }
  }

  function closeStudentProfile() {
    setSelectedProfile(null);
    setProfileError(null);
    setProfileLoadingId(null);
    setPhotoMessage(null);
    setUploadingPhoto(false);
    setGeneratingPdf(false);
    setEditingExtra(false);
    setExtraMessage(null);
    setSavingExtra(false);
    setExtraForm(emptyExtraForm());
  }

  function updateExtraForm<K extends keyof StudentExtraForm>(key: K, value: StudentExtraForm[K]) {
    setExtraForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEditingExtra() {
    setExtraForm(formFromProfile(selectedProfile));
    setExtraMessage(null);
    setProfileError(null);
    setEditingExtra(true);
  }

  function cancelEditingExtra() {
    setExtraForm(formFromProfile(selectedProfile));
    setEditingExtra(false);
    setExtraMessage(null);
  }

  async function saveStudentExtraProfile() {
    if (!selectedProfile?.student?.id) return;

    try {
      setSavingExtra(true);
      setProfileError(null);
      setExtraMessage(null);

      const token = await getAccessToken();

      const res = await fetch(`/api/school/students/${selectedProfile.student.id}/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify(extraForm),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setProfileError(json?.error || "Erro ao salvar dados complementares do aluno.");
        return;
      }

      const updatedProfile = json as StudentProfilePayload;

      setSelectedProfile(updatedProfile);
      setExtraForm(formFromProfile(updatedProfile));
      setEditingExtra(false);
      setExtraMessage("Dados complementares atualizados com sucesso.");
    } catch (e: any) {
      setProfileError(e?.message || "Erro inesperado ao salvar dados complementares.");

      if (e?.message === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setSavingExtra(false);
    }
  }

  async function uploadStudentPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file || !selectedProfile?.student?.id) return;

    if (!file.type.startsWith("image/")) {
      setProfileError("Selecione um arquivo de imagem.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileError("A foto deve ter no máximo 5MB.");
      return;
    }

    try {
      setUploadingPhoto(true);
      setProfileError(null);
      setPhotoMessage(null);

      const token = await getAccessToken();

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/school/students/${selectedProfile.student.id}/photo`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setProfileError(json?.error || "Erro ao enviar foto do aluno.");
        return;
      }

      const photoUrl = String(json.photoUrl || "");

      setSelectedProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          student: {
            ...prev.student,
            studentPhotoUrl: photoUrl,
            photoUrl,
          },
        };
      });

      setStudents((prev) =>
        prev.map((s) =>
          s.id === selectedProfile.student.id ? { ...s, student_photo_url: photoUrl } : s
        )
      );

      setPhotoMessage("Foto do aluno atualizada com sucesso.");
    } catch (e: any) {
      setProfileError(e?.message || "Erro inesperado ao enviar foto do aluno.");

      if (e?.message === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function generateStudentProfilePdf() {
    if (!selectedProfile?.student?.id) return;

    try {
      setGeneratingPdf(true);
      setProfileError(null);

      const token = await getAccessToken();
      const url = `/api/school/students/${selectedProfile.student.id}/profile-pdf`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const json = await safeJson(res);
        setProfileError(json?.error || "Erro ao gerar PDF da ficha do aluno.");
        return;
      }

      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);

      window.open(objectUrl, "_blank", "noopener,noreferrer");

      setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 60_000);
    } catch (e: any) {
      setProfileError(e?.message || "Erro inesperado ao gerar PDF da ficha do aluno.");

      if (e?.message === "Not authenticated") {
        router.replace("/login");
      }
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) {
    return (
      <main className="p-6">
        <div className="h-32 animate-pulse rounded-3xl bg-white" />
      </main>
    );
  }

  const selectedStudentPhotoUrl = getStudentPhotoUrl(selectedProfile);

  return (
    <main className="space-y-6">
      <section className="rounded-[28px] bg-gradient-to-r from-slate-900 to-slate-700 p-6 text-white">
        <h1 className="text-3xl font-semibold">Gestão de Alunos</h1>
        <p className="mt-2 text-sm text-slate-200">
          Controle completo dos alunos, turmas e responsáveis vinculados.
        </p>
      </section>

      {error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </section>
      ) : null}

      {profileError ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {profileError}
        </section>
      ) : null}

      <section className="rounded-3xl border bg-white p-6">
        <h2 className="mb-4 font-semibold">Cadastrar aluno</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <input
            placeholder="Nome completo"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />

          <select
            className="input"
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
          >
            <option value="">Selecione a turma</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.grade ? ` • ${c.grade}` : ""}
                {c.shift ? ` • ${c.shift}` : ""}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="input"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />

          <input
            placeholder="Matrícula"
            className="input"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
          />
        </div>

        <button
          onClick={createStudent}
          disabled={saving}
          className="btn btn-primary mt-4 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Cadastrar aluno"}
        </button>
      </section>

      <section className="rounded-3xl border bg-white p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Buscar aluno
            </label>
            <input
              className="input w-full"
              placeholder="Digite nome ou matrícula"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Filtrar por turma
            </label>
            <select
              className="input w-full"
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
            >
              <option value="">Todas as turmas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.grade ? ` • ${c.grade}` : ""}
                  {c.shift ? ` • ${c.shift}` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={loadAll}
            disabled={saving}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Atualizar
          </button>
        </div>

        <div className="mt-4 text-sm text-slate-500">
          Exibindo <span className="font-semibold text-slate-800">{filtered.length}</span> aluno(s).
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border bg-white">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-500">Nenhum aluno encontrado</div>
        ) : (
          <div className="divide-y">
            {filtered.map((s) => {
              const classId = activeMap.get(s.id);
              const cls = classMap.get(classId || "");

              return (
                <div
                  key={s.id}
                  className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex items-center gap-4">
                    {s.student_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.student_photo_url}
                        alt="Foto do aluno"
                        className="h-12 w-12 rounded-xl border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
                        {initials(s.full_name)}
                      </div>
                    )}

                    <div>
                      <div className="font-semibold">{s.full_name}</div>
                      <div className="text-xs text-slate-500">
                        {s.registration_number || "Sem matrícula"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {cls?.name || "Sem turma"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      onClick={() => openStudentProfile(s.id)}
                      disabled={profileLoadingId === s.id}
                      className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                    >
                      {profileLoadingId === s.id ? "Carregando..." : "Ficha completa"}
                    </button>

                    <select
                      className="input"
                      value={classId || ""}
                      onChange={(e) => changeClass(s.id, e.target.value)}
                      disabled={saving || deletingId === s.id || unassigningId === s.id}
                    >
                      <option value="">Trocar</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    {classId ? (
                      <button
                        type="button"
                        onClick={() => unassignStudent(s.id, s.full_name)}
                        disabled={saving || deletingId === s.id || unassigningId === s.id}
                        className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        {unassigningId === s.id ? "Removendo..." : "Remover da turma"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => deleteStudent(s.id, s.full_name)}
                      disabled={saving || deletingId === s.id || unassigningId === s.id}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                    >
                      {deletingId === s.id ? "Excluindo..." : "Excluir"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedProfile ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="my-6 w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-6 text-white">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  {selectedStudentPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedStudentPhotoUrl}
                      alt="Foto do aluno"
                      className="h-24 w-24 rounded-3xl border border-white/20 object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/20 bg-white/10 text-2xl font-bold">
                      {initials(field(selectedProfile.student.fullName))}
                    </div>
                  )}

                  <div>
                    <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
                      Ficha completa do aluno
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold">
                      {field(selectedProfile.student.fullName)}
                    </h2>
                    <p className="mt-1 text-sm text-slate-200">
                      Dados oficiais da escola + dados preenchidos pelos responsáveis.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeStudentProfile}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="space-y-6 p-5 md:p-6">
              <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Foto e documentos</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      A direção pode atualizar a foto, preencher dados complementares e gerar o PDF oficial.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={uploadStudentPhoto}
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingPhoto || generatingPdf || savingExtra}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                      {uploadingPhoto ? "Enviando foto..." : "Enviar foto do aluno"}
                    </button>

                    <button
                      type="button"
                      onClick={startEditingExtra}
                      disabled={uploadingPhoto || generatingPdf || savingExtra}
                      className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Editar dados complementares
                    </button>

                    <button
                      type="button"
                      onClick={generateStudentProfilePdf}
                      disabled={generatingPdf || uploadingPhoto || savingExtra}
                      className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      {generatingPdf ? "Gerando PDF..." : "Gerar PDF da ficha"}
                    </button>
                  </div>
                </div>

                {photoMessage ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {photoMessage}
                  </div>
                ) : null}

                {extraMessage ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {extraMessage}
                  </div>
                ) : null}
              </section>

              <section>
                <h3 className="text-lg font-semibold text-slate-900">Dados oficiais do aluno</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <InfoBox label="Nome completo" value={selectedProfile.student.fullName} />
                  <InfoBox label="Matrícula" value={selectedProfile.student.registrationNumber} />
                  <InfoBox label="Nascimento" value={formatDateBR(selectedProfile.student.birthDate)} />
                  <InfoBox label="Cadastro" value={formatDateTimeBR(selectedProfile.student.createdAt)} />
                </div>
              </section>

              {editingExtra ? (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        Editar dados complementares
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Estes dados alimentam a ficha completa e o PDF oficial do aluno.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={cancelEditingExtra}
                        disabled={savingExtra}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        onClick={saveStudentExtraProfile}
                        disabled={savingExtra}
                        className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {savingExtra ? "Salvando..." : "Salvar dados"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <TextInput
                      label="Sexo"
                      value={extraForm.gender}
                      onChange={(value) => updateExtraForm("gender", value)}
                    />
                    <TextInput
                      label="CPF"
                      value={extraForm.cpf}
                      onChange={(value) => updateExtraForm("cpf", value)}
                    />
                    <TextInput
                      label="RG"
                      value={extraForm.rg}
                      onChange={(value) => updateExtraForm("rg", value)}
                    />
                    <TextInput
                      label="Certidão de nascimento"
                      value={extraForm.birthCertificate}
                      onChange={(value) => updateExtraForm("birthCertificate", value)}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <TextInput
                      label="Nome da mãe"
                      value={extraForm.motherName}
                      onChange={(value) => updateExtraForm("motherName", value)}
                    />
                    <TextInput
                      label="Nome do pai"
                      value={extraForm.fatherName}
                      onChange={(value) => updateExtraForm("fatherName", value)}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <TextAreaInput
                      label="Observações médicas / alertas"
                      value={extraForm.medicalNotes}
                      onChange={(value) => updateExtraForm("medicalNotes", value)}
                      placeholder="Ex.: asma, uso de bombinha, restrições de atividade física..."
                    />
                    <TextAreaInput
                      label="Alergias"
                      value={extraForm.allergies}
                      onChange={(value) => updateExtraForm("allergies", value)}
                      placeholder="Ex.: medicamento, alimentos, picadas..."
                    />
                    <TextAreaInput
                      label="Medicação contínua"
                      value={extraForm.continuousMedication}
                      onChange={(value) => updateExtraForm("continuousMedication", value)}
                    />
                    <TextAreaInput
                      label="Restrições alimentares"
                      value={extraForm.foodRestrictions}
                      onChange={(value) => updateExtraForm("foodRestrictions", value)}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <TextInput
                      label="Contato de emergência"
                      value={extraForm.emergencyContactName}
                      onChange={(value) => updateExtraForm("emergencyContactName", value)}
                    />
                    <TextInput
                      label="Telefone de emergência"
                      value={extraForm.emergencyContactPhone}
                      onChange={(value) => updateExtraForm("emergencyContactPhone", value)}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <TextAreaInput
                      label="Autorizados para buscar / observações de retirada"
                      value={extraForm.authorizedPickupNotes}
                      onChange={(value) => updateExtraForm("authorizedPickupNotes", value)}
                    />
                    <TextAreaInput
                      label="Observações gerais"
                      value={extraForm.generalNotes}
                      onChange={(value) => updateExtraForm("generalNotes", value)}
                    />
                  </div>
                </section>
              ) : (
                <section>
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        Dados complementares
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Informações adicionais usadas na ficha oficial do aluno.
                      </p>
                    </div>

                    <div className="text-xs text-slate-500">
                      Atualizado em:{" "}
                      {formatDateTimeBR(selectedProfile.student.studentProfileUpdatedAt)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <InfoBox label="Sexo" value={selectedProfile.student.gender} />
                    <InfoBox label="CPF" value={selectedProfile.student.cpf} />
                    <InfoBox label="RG" value={selectedProfile.student.rg} />
                    <InfoBox
                      label="Certidão"
                      value={selectedProfile.student.birthCertificate}
                    />
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InfoBox label="Nome da mãe" value={selectedProfile.student.motherName} />
                    <InfoBox label="Nome do pai" value={selectedProfile.student.fatherName} />
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InfoBox
                      label="Observações médicas / alertas"
                      value={selectedProfile.student.medicalNotes}
                    />
                    <InfoBox label="Alergias" value={selectedProfile.student.allergies} />
                    <InfoBox
                      label="Medicação contínua"
                      value={selectedProfile.student.continuousMedication}
                    />
                    <InfoBox
                      label="Restrições alimentares"
                      value={selectedProfile.student.foodRestrictions}
                    />
                    <InfoBox
                      label="Contato de emergência"
                      value={selectedProfile.student.emergencyContactName}
                    />
                    <InfoBox
                      label="Telefone de emergência"
                      value={selectedProfile.student.emergencyContactPhone}
                    />
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InfoBox
                      label="Autorizados para buscar / retirada"
                      value={selectedProfile.student.authorizedPickupNotes}
                    />
                    <InfoBox
                      label="Observações gerais"
                      value={selectedProfile.student.generalNotes}
                    />
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-lg font-semibold text-slate-900">Turma atual</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <InfoBox label="Turma" value={selectedProfile.activeClass?.name} />
                  <InfoBox label="Série" value={selectedProfile.activeClass?.grade} />
                  <InfoBox label="Turno" value={selectedProfile.activeClass?.shift} />
                  <InfoBox
                    label="Vínculo desde"
                    value={formatDateBR(selectedProfile.activeClass?.link?.startedAt)}
                  />
                </div>
              </section>

              <section>
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      Responsáveis vinculados
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Informações vindas do cadastro completo preenchido no Portal dos Pais.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                    {selectedProfile.parents.length} responsável(is)
                  </div>
                </div>

                {selectedProfile.parents.length === 0 ? (
                  <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    Nenhum responsável vinculado a este aluno.
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4">
                    {selectedProfile.parents.map((parent) => (
                      <div
                        key={parent.id}
                        className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start">
                          {parent.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={parent.photoUrl}
                              alt="Foto do responsável"
                              className="h-16 w-16 rounded-2xl border border-slate-200 object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white">
                              {initialsFromName(parent.fullName)}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div>
                                <div className="text-base font-semibold text-slate-900">
                                  {field(parent.fullName)}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {parent.firstLoginCompleted
                                    ? "Cadastro completo preenchido ✅"
                                    : "Cadastro ainda não finalizado pelo responsável"}
                                </div>
                              </div>

                              <div className="text-xs text-slate-500">
                                Atualizado em: {formatDateTimeBR(parent.profileUpdatedAt)}
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                              <InfoBox label="Telefone" value={parent.phone} />
                              <InfoBox label="CPF" value={parent.cpf} />
                              <InfoBox label="Telefone secundário" value={parent.phoneSecondary} />
                              <InfoBox label="CEP" value={parent.zipCode} />
                              <InfoBox
                                label="Cidade/UF"
                                value={`${field(parent.city)} / ${field(parent.state)}`}
                              />
                              <InfoBox label="Bairro" value={parent.neighborhood} />
                            </div>

                            <div className="mt-3">
                              <InfoBox label="Endereço completo" value={parent.addressText} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}