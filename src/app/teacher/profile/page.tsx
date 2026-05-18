"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TeacherProfile = {
  userId: string;
  schoolId: string;
  role: string;
  email: string;
  fullName: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  photoUrl: string | null;
  initials: string;
};

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor." };
  }
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function initialsFromName(name?: string | null) {
  const safe = cleanText(name);

  if (!safe) return "PR";

  const parts = safe.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler imagem."));

    reader.readAsDataURL(file);
  });
}

function formatRole(role?: string | null) {
  const r = cleanText(role).toLowerCase();

  if (r === "teacher" || r === "professor") return "Professor";

  return role || "Professor";
}

function ProfileAvatar({
  name,
  photoUrl,
  previewUrl,
}: {
  name: string;
  photoUrl: string | null;
  previewUrl: string | null;
}) {
  const src = previewUrl || photoUrl;

  if (src) {
    return (
      <div className="h-32 w-32 overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Foto de ${name || "Professor"}`}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-32 w-32 items-center justify-center rounded-[36px] border border-slate-200 bg-slate-950 text-3xl font-bold text-white shadow-sm">
      {initialsFromName(name)}
    </div>
  );
}

function InfoBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>

      <div className="mt-2 break-words text-sm font-medium text-slate-700">
        {value || "—"}
      </div>
    </div>
  );
}

export default function TeacherProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<TeacherProfile | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyContactRelation, setEmergencyContactRelation] = useState("");

  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visiblePhotoUrl = removePhoto ? null : profile?.photoUrl || null;

  const hasChanges = useMemo(() => {
    if (!profile) return false;

    return (
      cleanText(fullName) !== cleanText(profile.fullName) ||
      cleanText(phone) !== cleanText(profile.phone) ||
      cleanText(address) !== cleanText(profile.address) ||
      cleanText(emergencyContactName) !== cleanText(profile.emergencyContactName) ||
      cleanText(emergencyContactPhone) !== cleanText(profile.emergencyContactPhone) ||
      cleanText(emergencyContactRelation) !== cleanText(profile.emergencyContactRelation) ||
      Boolean(photoDataUrl) ||
      removePhoto
    );
  }, [
    fullName,
    phone,
    address,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContactRelation,
    photoDataUrl,
    removePhoto,
    profile,
  ]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }

    return token;
  }

  function fillForm(nextProfile: TeacherProfile) {
    setProfile(nextProfile);
    setFullName(nextProfile.fullName || "");
    setPhone(nextProfile.phone || "");
    setAddress(nextProfile.address || "");
    setEmergencyContactName(nextProfile.emergencyContactName || "");
    setEmergencyContactPhone(nextProfile.emergencyContactPhone || "");
    setEmergencyContactRelation(nextProfile.emergencyContactRelation || "");

    setPhotoDataUrl("");
    setPreviewUrl(null);
    setRemovePhoto(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function loadProfile() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getToken();

      if (!token) return;

      const res = await fetch("/api/teacher/profile", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar perfil.");
        return;
      }

      const nextProfile = json.profile as TeacherProfile;

      fillForm(nextProfile);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao carregar perfil.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setError(null);
    setMessage(null);

    if (!fullName.trim()) {
      setError("Informe seu nome completo.");
      return;
    }

    try {
      setSaving(true);

      const token = await getToken();

      if (!token) return;

      const res = await fetch("/api/teacher/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          emergencyContactName: emergencyContactName.trim(),
          emergencyContactPhone: emergencyContactPhone.trim(),
          emergencyContactRelation: emergencyContactRelation.trim(),
          photoDataUrl: photoDataUrl || null,
          removePhoto,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao salvar perfil.");
        return;
      }

      const nextProfile = json.profile as TeacherProfile;

      fillForm(nextProfile);

      setMessage("Perfil atualizado com sucesso. Sua foto e seus dados foram salvos.");

      try {
        await supabase.auth.refreshSession();
      } catch {
        // Não bloqueia a experiência.
      }

      setTimeout(() => {
        loadProfile();
      }, 300);
    } catch (e: any) {
      setError(e?.message || "Erro inesperado ao salvar perfil.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setMessage(null);

    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem.");
      e.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("A imagem precisa ter no máximo 5MB.");
      e.target.value = "";
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);

      setPhotoDataUrl(dataUrl);
      setPreviewUrl(dataUrl);
      setRemovePhoto(false);
    } catch (err: any) {
      setError(err?.message || "Não foi possível carregar a imagem.");
    }
  }

  function clearSelectedPhoto() {
    setPhotoDataUrl("");
    setPreviewUrl(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function markRemovePhoto() {
    setPhotoDataUrl("");
    setPreviewUrl(null);
    setRemovePhoto(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <main className="space-y-6">
        <section className="rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-72 rounded-2xl bg-slate-200" />
            <div className="h-4 w-[480px] max-w-full rounded-2xl bg-slate-100" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.7fr_1.3fr]">
              <div className="h-80 rounded-[32px] bg-slate-100" />
              <div className="h-80 rounded-[32px] bg-slate-100" />
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-[32px] border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            Não foi possível carregar seus dados
          </h1>

          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
            {error || "Perfil não encontrado."}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={loadProfile}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Tentar novamente
            </button>

            <button
              type="button"
              onClick={() => router.push("/teacher")}
              className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Voltar ao painel
            </button>
          </div>
        </div>
      </main>
    );
  }

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
              Perfil docente
            </div>

            <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight md:text-5xl">
              Meus dados
            </h1>

            <p className="mt-3 max-w-3xl break-words text-sm leading-7 text-slate-300 md:text-base">
              Atualize seu nome, telefone, endereço, contato de emergência e foto de
              perfil. Essas informações ajudam a escola a manter seu cadastro docente
              completo.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/teacher")}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
            >
              Voltar ao painel
            </button>

            <button
              type="button"
              onClick={loadProfile}
              className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Recarregar
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Foto do professor
          </div>

          <div className="mt-5 flex flex-col items-center rounded-[32px] border border-slate-200 bg-slate-50 p-6 text-center">
            <ProfileAvatar
              name={fullName || profile.fullName}
              photoUrl={visiblePhotoUrl}
              previewUrl={previewUrl}
            />

            <div className="mt-5 break-words text-lg font-semibold text-slate-900">
              {fullName || profile.fullName || "Professor"}
            </div>

            <div className="mt-1 break-all text-sm text-slate-500">
              {profile.email || "—"}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="mt-5 flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Escolher foto
              </button>

              {previewUrl ? (
                <button
                  type="button"
                  onClick={clearSelectedPhoto}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
                >
                  Remover foto selecionada
                </button>
              ) : null}

              {profile.photoUrl && !removePhoto ? (
                <button
                  type="button"
                  onClick={markRemovePhoto}
                  className="w-full rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                >
                  Remover foto atual
                </button>
              ) : null}
            </div>

            <p className="mt-4 break-words text-xs leading-5 text-slate-500">
              Use uma foto nítida, preferencialmente de rosto. Tamanho máximo: 5MB.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3">
            <InfoBox label="E-mail de acesso" value={profile.email} />
            <InfoBox label="Função" value={formatRole(profile.role)} />
            <InfoBox label="Escola vinculada" value={profile.schoolId} />
          </div>
        </div>

        <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Informações pessoais
              </div>

              <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-900">
                Dados do perfil
              </h2>

              <p className="mt-2 break-words text-sm leading-6 text-slate-500">
                Mantenha seus dados atualizados para identificação e contato da escola.
              </p>
            </div>

            <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
              {formatRole(profile.role)}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Nome completo *
              </label>

              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                placeholder="Ex: Maria Joana da Silva"
                disabled={saving}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Telefone principal
              </label>

              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                placeholder="Ex: (64) 9xxxx-xxxx"
                disabled={saving}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Endereço completo
              </label>

              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="min-h-[96px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                placeholder="Rua, número, bairro, cidade e complemento"
                disabled={saving}
              />
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Contato adicional de emergência
              </div>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Informe uma pessoa que a escola pode acionar em uma situação urgente.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Nome do contato
                  </label>

                  <input
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                    placeholder="Ex: João da Silva"
                    disabled={saving}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Telefone do contato
                  </label>

                  <input
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                    placeholder="Ex: (64) 9xxxx-xxxx"
                    disabled={saving}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Parentesco ou observação
                  </label>

                  <input
                    value={emergencyContactRelation}
                    onChange={(e) => setEmergencyContactRelation(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                    placeholder="Ex: Esposo, esposa, mãe, irmão, amigo..."
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                E-mail
              </label>

              <input
                value={profile.email || ""}
                readOnly
                className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
              />

              <p className="mt-2 text-xs leading-5 text-slate-500">
                O e-mail é usado para login e não pode ser alterado por esta tela.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Escola vinculada
                </label>

                <input
                  value={profile.schoolId || "—"}
                  readOnly
                  className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-500 outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Função
                </label>

                <input
                  value={formatRole(profile.role)}
                  readOnly
                  className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
                />
              </div>
            </div>
          </div>

          {message ? (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={saveProfile}
              disabled={saving || !hasChanges}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>

            <button
              type="button"
              onClick={loadProfile}
              disabled={saving}
              className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar alterações
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}