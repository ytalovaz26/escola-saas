import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next") || "/reset-password";

  const redirectUrl = new URL(next, url.origin);

  if (code) {
    redirectUrl.searchParams.set("code", code);
  }

  if (token_hash) {
    redirectUrl.searchParams.set("token_hash", token_hash);
  }

  if (type) {
    redirectUrl.searchParams.set("type", type);
  }

  return NextResponse.redirect(redirectUrl);
}
