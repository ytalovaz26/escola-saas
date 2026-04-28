"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfilePayload = {
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

type FormState = {
  cpf: string;
  phoneSecondary: string;
  zipCode: string;
  street: string;
  streetNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  photoUrl: string;
};

const PHOTO_BUCKET = "parent-profile-photos";

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || "Resposta inválida do servidor" };
  }
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "Ainda não atualizado";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11);

  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatPhoneBR(value: string) {
  const digits = onlyDigits(value).slice(0, 11);

  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  return digits
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/, "$1-$2");
}

function normalizeState(value: string) {
  return value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
}

function getFileExtension(fileName: string) {
  const parts = fileName.split(".");
  if (parts.length < 2) return "jpg";

  const ext = parts.pop()?.toLowerCase().trim() || "jpg";

  if (ext === "jpeg") return "jpg";
  if (["jpg", "png", "webp"].includes(ext)) return ext;

  return "jpg";
}

function isValidImageType(file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  return allowed.includes(file.type);
}

function withCacheBuster(url: string) {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  maxLength,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label} {required ? "*" : ""}
      </label>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      />
    </div>
  );
}

export default function ParentCompleteProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState<ProfilePayload["parent"] | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    cpf: "",
    phoneSecondary: "",
    zipCode: "",
    street: "",
    streetNumber: "",
    addressComplement: "",
    neighborhood: "",
    city: "",
    state: "",
    photoUrl: "",
  });

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const completionPercent = useMemo(() => {
    const requiredFields = [
      form.cpf,
      form.zipCode,
      form.street,
      form.streetNumber,
      form.neighborhood,
      form.city,
      form.state,
    ];

    const filled = requiredFields.filter((v) => String(v || "").trim().length > 0).length;
    return Math.round((filled / requiredFields.length) * 100);
  }, [form]);

  const isEditMode = !!profileLoaded?.firstLoginCompleted;

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      throw new Error("Sessão não encontrada.");
    }

    return token;
  }

  async function persistPhotoUrl(photoUrl: string) {
    const token = await getAccessToken();

    const res = await fetch("/api/parent/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        photoUrl,
      }),
    });

    const text = await res.text();
    const json: any = safeJson(text);

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Falha ao salvar foto no cadastro.");
    }
  }

  async function loadProfile() {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const meText = await meRes.text();
      const meJson: any = safeJson(meText);

      if (!meRes.ok || !meJson?.ok || !meJson?.parent?.parentId) {
        router.replace(meJson?.redirectTo || "/login");
        return;
      }

      const res = await fetch("/api/parent/profile", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const text = await res.text();
      const json: ProfilePayload | any = safeJson(text);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao carregar cadastro.");
        return;
      }

      const loadedParent = json.parent as ProfilePayload["parent"];

      setProfileLoaded(loadedParent);

      setForm({
        cpf: loadedParent?.cpf ? formatCpf(loadedParent.cpf) : "",
        phoneSecondary: loadedParent?.phoneSecondary
          ? formatPhoneBR(loadedParent.phoneSecondary)
          : "",
        zipCode: loadedParent?.zipCode ? formatCep(loadedParent.zipCode) : "",
        street: loadedParent?.street ?? "",
        streetNumber: loadedParent?.streetNumber ?? "",
        addressComplement: loadedParent?.addressComplement ?? "",
        neighborhood: loadedParent?.neighborhood ?? "",
        city: loadedParent?.city ?? "",
        state: loadedParent?.state ?? "",
        photoUrl: loadedParent?.photoUrl ?? "",
      });

      setPhotoPreview(loadedParent?.photoUrl ? withCacheBuster(loadedParent.photoUrl) : null);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar cadastro.");
    } finally {
      setLoading(false);
    }
  }

  async function lookupCep(rawCep: string) {
    const cep = onlyDigits(rawCep);

    if (cep.length !== 8) return;

    try {
      setLookingUpCep(true);

      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || json?.erro) {
        return;
      }

      setForm((prev) => ({
        ...prev,
        street: json.logradouro || prev.street,
        neighborhood: json.bairro || prev.neighborhood,
        city: json.localidade || prev.city,
        state: json.uf || prev.state,
        addressComplement: prev.addressComplement || json.complemento || prev.addressComplement,
      }));
    } catch {
      // Não quebra a experiência caso a busca de CEP falhe.
    } finally {
      setLookingUpCep(false);
    }
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    try {
      setError(null);

      const file = event.target.files?.[0];
      if (!file) return;

      if (!isValidImageType(file)) {
        setError("Formato inválido. Envie uma imagem JPG, PNG ou WEBP.");
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setError("A foto deve ter no máximo 5MB.");
        return;
      }

      if (!profileLoaded?.id || !profileLoaded?.schoolId) {
        setError("Não foi possível identificar o responsável para enviar a foto.");
        return;
      }

      setUploadingPhoto(true);

      const extension = getFileExtension(file.name);
      const filePath = `${profileLoaded.schoolId}/${profileLoaded.id}/profile-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message || "Falha ao enviar foto.");
      }

      const { data: publicData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(filePath);

      const publicUrl = publicData?.publicUrl || "";

      if (!publicUrl) {
        throw new Error("Não foi possível obter a URL da foto enviada.");
      }

      await persistPhotoUrl(publicUrl);

      setForm((prev) => ({
        ...prev,
        photoUrl: publicUrl,
      }));

      setPhotoPreview(withCacheBuster(publicUrl));

      setProfileLoaded((prev) =>
        prev
          ? {
              ...prev,
              photoUrl: publicUrl,
              profileUpdatedAt: new Date().toISOString(),
            }
          : prev
      );
    } catch (e: any) {
      setError(e?.message || "Erro ao enviar foto.");
    } finally {
      setUploadingPhoto(false);
      event.target.value = "";
    }
  }

  async function removePhoto() {
    try {
      setError(null);
      setUploadingPhoto(true);

      await persistPhotoUrl("");

      setForm((prev) => ({
        ...prev,
        photoUrl: "",
      }));

      setPhotoPreview(null);

      setProfileLoaded((prev) =>
        prev
          ? {
              ...prev,
              photoUrl: null,
              profileUpdatedAt: new Date().toISOString(),
            }
          : prev
      );
    } catch (e: any) {
      setError(e?.message || "Erro ao remover foto.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveProfile() {
    try {
      setSaving(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/parent/profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cpf: onlyDigits(form.cpf),
          phoneSecondary: onlyDigits(form.phoneSecondary),
          zipCode: onlyDigits(form.zipCode),
          street: form.street.trim(),
          streetNumber: form.streetNumber.trim(),
          addressComplement: form.addressComplement.trim(),
          neighborhood: form.neighborhood.trim(),
          city: form.city.trim(),
          state: normalizeState(form.state),
          photoUrl: form.photoUrl.trim(),
        }),
      });

      const text = await res.text();
      const json: any = safeJson(text);

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Falha ao salvar cadastro.");
        return;
      }

      router.replace("/parent");
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar cadastro.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cep = onlyDigits(form.zipCode);

    if (cep.length === 8) {
      lookupCep(cep);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.zipCode]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-48 rounded-[32px] bg-slate-200" />
            <div className="h-96 rounded-[32px] bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                  {isEditMode ? "Cadastro do responsável" : "Primeiro acesso"}
                </div>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  {isEditMode ? "Atualize seus dados" : "Complete seu cadastro"}
                </h1>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">
                  {isEditMode
                    ? "Mantenha seus dados sempre atualizados para facilitar a comunicação com a escola e garantir informações corretas no painel da direção."
                    : "Antes de acessar o portal, precisamos completar seus dados cadastrais para manter as informações da escola atualizadas."}
                </p>

                {profileLoaded ? (
                  <p className="mt-3 text-xs text-slate-300">
                    Última atualização: {formatDateTimeBR(profileLoaded.profileUpdatedAt)}
                  </p>
                ) : null}
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs uppercase tracking-wide text-slate-300">Progresso</div>
                <div className="mt-2 text-3xl font-semibold">{completionPercent}%</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Dados complementares
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Campos com * são obrigatórios nesta etapa.
              </p>
            </div>

            {isEditMode ? (
              <button
                type="button"
                onClick={() => router.push("/parent")}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Voltar ao portal
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mb-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white">
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt="Foto do responsável"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-slate-500">Sem foto</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">Foto do responsável</div>

                <p className="mt-1 text-sm text-slate-500">
                  Envie uma imagem em JPG, PNG ou WEBP com até 5MB. A foto será salva
                  automaticamente no cadastro.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
                    {uploadingPhoto ? "Enviando foto..." : "Selecionar foto"}
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handlePhotoChange}
                      disabled={uploadingPhoto || saving}
                    />
                  </label>

                  {form.photoUrl ? (
                    <button
                      type="button"
                      onClick={removePhoto}
                      disabled={uploadingPhoto || saving}
                      className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Remover foto
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="CPF"
              required
              value={form.cpf}
              onChange={(value) => setField("cpf", formatCpf(value))}
              placeholder="000.000.000-00"
              maxLength={14}
            />

            <Field
              label="Telefone secundário"
              value={form.phoneSecondary}
              onChange={(value) => setField("phoneSecondary", formatPhoneBR(value))}
              placeholder="(64) 99999-9999"
              maxLength={16}
            />

            <Field
              label="CEP"
              required
              value={form.zipCode}
              onChange={(value) => setField("zipCode", formatCep(value))}
              placeholder="75900-000"
              maxLength={9}
            />

            <Field
              label="Estado"
              required
              value={form.state}
              onChange={(value) => setField("state", normalizeState(value))}
              placeholder="GO"
              maxLength={2}
              disabled={lookingUpCep}
            />

            <div className="md:col-span-2">
              <Field
                label="Rua"
                required
                value={form.street}
                onChange={(value) => setField("street", value)}
                placeholder="Ex.: Rua das Palmeiras"
                maxLength={120}
                disabled={lookingUpCep}
              />
            </div>

            <Field
              label="Número"
              required
              value={form.streetNumber}
              onChange={(value) => setField("streetNumber", value)}
              placeholder="Ex.: 120"
              maxLength={20}
            />

            <Field
              label="Complemento"
              value={form.addressComplement}
              onChange={(value) => setField("addressComplement", value)}
              placeholder="Ex.: Casa, apto, bloco"
              maxLength={120}
              disabled={lookingUpCep}
            />

            <Field
              label="Bairro"
              required
              value={form.neighborhood}
              onChange={(value) => setField("neighborhood", value)}
              placeholder="Ex.: Centro"
              maxLength={120}
              disabled={lookingUpCep}
            />

            <Field
              label="Cidade"
              required
              value={form.city}
              onChange={(value) => setField("city", value)}
              placeholder="Ex.: Rio Verde"
              maxLength={120}
              disabled={lookingUpCep}
            />
          </div>

          <div className="mt-3 text-xs text-slate-500">
            {lookingUpCep
              ? "Buscando endereço pelo CEP..."
              : "Ao informar um CEP válido, o sistema tenta preencher endereço automaticamente."}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveProfile}
              disabled={saving || uploadingPhoto}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving
                ? "Salvando..."
                : isEditMode
                ? "Salvar alterações"
                : "Salvar e entrar no portal"}
            </button>

            {isEditMode ? (
              <button
                type="button"
                onClick={() => router.push("/parent")}
                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}