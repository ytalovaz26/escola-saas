import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const flow = url.searchParams.get("flow");
  const next = url.searchParams.get("next");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // 1) Se houver erro vindo do provider/auth, volta para o login com mensagem
  if (error || errorDescription) {
    const loginUrl = new URL("/login", url.origin);

    if (error) {
      loginUrl.searchParams.set("error", error);
    }

    if (errorDescription) {
      loginUrl.searchParams.set("error_description", errorDescription);
    }

    return NextResponse.redirect(loginUrl);
  }

  // 2) Fluxo de recuperação de senha
  if (type === "recovery" || tokenHash) {
    const resetUrl = new URL(next || "/reset-password", url.origin);

    if (code) {
      resetUrl.searchParams.set("code", code);
    }

    if (tokenHash) {
      resetUrl.searchParams.set("token_hash", tokenHash);
    }

    if (type) {
      resetUrl.searchParams.set("type", type);
    }

    return NextResponse.redirect(resetUrl);
  }

  // 3) Login com Google
  if (flow === "login_google") {
    const loginUrl = new URL("/login", url.origin);

    if (code) {
      loginUrl.searchParams.set("code", code);
    }

    return NextResponse.redirect(loginUrl);
  }

  // 4) Criação de diretor com Google
  if (flow === "director_signup_google") {
    const signupUrl = new URL("/login", url.origin);
    signupUrl.searchParams.set("mode", "signup");

    if (code) {
      signupUrl.searchParams.set("code", code);
    }

    return NextResponse.redirect(signupUrl);
  }

  // 5) Fallback padrão:
  // se veio code sem flow específico, manda pro login
  if (code) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("code", code);
    return NextResponse.redirect(loginUrl);
  }

  // 6) Último fallback
  return NextResponse.redirect(new URL("/login", url.origin));
}