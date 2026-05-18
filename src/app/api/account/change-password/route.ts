import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonOk(body: any = {}, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function validatePassword(password: string) {
  if (!password) {
    return "Informe a nova senha.";
  }

  if (password.length < 8) {
    return "A nova senha precisa ter pelo menos 8 caracteres.";
  }

  if (password.length > 72) {
    return "A nova senha precisa ter no máximo 72 caracteres.";
  }

  const hasLetter = /[A-Za-zÀ-ÿ]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!hasLetter || !hasNumber) {
    return "A nova senha precisa conter pelo menos uma letra e um número.";
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError("Missing Authorization Bearer token.", 401);
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user) {
      return jsonError("Sessão inválida. Faça login novamente.", 401, {
        details: userErr?.message,
      });
    }

    const body = await req.json().catch(() => null);

    const newPassword = cleanText(body?.newPassword || body?.password);
    const confirmPassword = cleanText(body?.confirmPassword || body?.passwordConfirmation);

    const validationError = validatePassword(newPassword);

    if (validationError) {
      return jsonError(validationError, 400);
    }

    if (newPassword !== confirmPassword) {
      return jsonError("A confirmação de senha não confere.", 400);
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      userData.user.id,
      {
        password: newPassword,
      }
    );

    if (updateErr) {
      return jsonError("Falha ao alterar senha: " + updateErr.message, 500);
    }

    return jsonOk({
      message: "Senha alterada com sucesso.",
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro interno ao alterar senha.", 500);
  }
}