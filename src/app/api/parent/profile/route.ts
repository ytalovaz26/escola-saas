import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function normalizeNullableText(value: unknown) {
  const v = String(value ?? "").trim();
  return v.length > 0 ? v : null;
}

async function getAuthenticatedParent(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false as const,
      response: jsonError("Missing Authorization Bearer token.", 401),
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: jsonError("Invalid token/session.", 401),
    };
  }

  const userId = String(userData.user.id);

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from("parents")
    .select("id, school_id, user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (parentErr) {
    return {
      ok: false as const,
      response: jsonError("parents lookup failed: " + parentErr.message, 500),
    };
  }

  if (!parent?.id) {
    return {
      ok: false as const,
      response: jsonError("Not a parent.", 403),
    };
  }

  return {
    ok: true as const,
    parent,
    userId,
  };
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthenticatedParent(req);
    if (!auth.ok) return auth.response;

    const { data: parent, error: parentErr } = await supabaseAdmin
      .from("parents")
      .select(`
        id,
        school_id,
        full_name,
        phone,
        cpf,
        phone_secondary,
        zip_code,
        street,
        street_number,
        address_complement,
        neighborhood,
        city,
        state,
        photo_url,
        first_login_completed,
        profile_updated_at,
        created_at
      `)
      .eq("id", auth.parent.id)
      .maybeSingle();

    if (parentErr) {
      return jsonError("parents lookup failed: " + parentErr.message, 500);
    }

    if (!parent?.id) {
      return jsonError("Not a parent.", 403);
    }

    return NextResponse.json({
      ok: true,
      parent: {
        id: String(parent.id),
        schoolId: parent.school_id ? String(parent.school_id) : null,
        fullName: parent.full_name ?? null,
        phone: parent.phone ?? null,
        cpf: parent.cpf ?? null,
        phoneSecondary: parent.phone_secondary ?? null,
        zipCode: parent.zip_code ?? null,
        street: parent.street ?? null,
        streetNumber: parent.street_number ?? null,
        addressComplement: parent.address_complement ?? null,
        neighborhood: parent.neighborhood ?? null,
        city: parent.city ?? null,
        state: parent.state ?? null,
        photoUrl: parent.photo_url ?? null,
        firstLoginCompleted: !!parent.first_login_completed,
        profileUpdatedAt: parent.profile_updated_at ?? parent.created_at ?? null,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/parent/profile", 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedParent(req);
    if (!auth.ok) return auth.response;

    let body: any = null;

    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = {
      cpf: normalizeNullableText(body?.cpf),
      phone_secondary: normalizeNullableText(body?.phoneSecondary),
      zip_code: normalizeNullableText(body?.zipCode),
      street: normalizeNullableText(body?.street),
      street_number: normalizeNullableText(body?.streetNumber),
      address_complement: normalizeNullableText(body?.addressComplement),
      neighborhood: normalizeNullableText(body?.neighborhood),
      city: normalizeNullableText(body?.city),
      state: normalizeNullableText(body?.state),
      photo_url: normalizeNullableText(body?.photoUrl),
      first_login_completed: true,
      profile_updated_at: new Date().toISOString(),
    };

    if (!payload.cpf) return jsonError("CPF é obrigatório.", 400);
    if (!payload.zip_code) return jsonError("CEP é obrigatório.", 400);
    if (!payload.street) return jsonError("Rua é obrigatória.", 400);
    if (!payload.street_number) return jsonError("Número é obrigatório.", 400);
    if (!payload.neighborhood) return jsonError("Bairro é obrigatório.", 400);
    if (!payload.city) return jsonError("Cidade é obrigatória.", 400);
    if (!payload.state) return jsonError("Estado é obrigatório.", 400);

    const { error: updateErr } = await supabaseAdmin
      .from("parents")
      .update(payload)
      .eq("id", auth.parent.id);

    if (updateErr) {
      return jsonError("Falha ao atualizar cadastro: " + updateErr.message, 500);
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      parentId: String(auth.parent.id),
      photoUrl: payload.photo_url,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/parent/profile", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthenticatedParent(req);
    if (!auth.ok) return auth.response;

    let body: any = null;

    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const photoUrl = normalizeNullableText(body?.photoUrl);

    const { error: updateErr } = await supabaseAdmin
      .from("parents")
      .update({
        photo_url: photoUrl,
        profile_updated_at: new Date().toISOString(),
      })
      .eq("id", auth.parent.id);

    if (updateErr) {
      return jsonError("Falha ao atualizar foto: " + updateErr.message, 500);
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      parentId: String(auth.parent.id),
      photoUrl,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in PATCH /api/parent/profile", 500);
  }
}