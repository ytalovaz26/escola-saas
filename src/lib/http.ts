// src/lib/http.ts
import { NextResponse } from "next/server";

export type ApiOk<T> = { ok: true } & T;
export type ApiFail = { ok: false; error: string; code?: string; details?: any };

export function jsonOk<T extends Record<string, any>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data } as ApiOk<T>, { status });
}

export function jsonFail(
  status: number,
  error: string,
  opts?: { code?: string; details?: any }
) {
  const payload: ApiFail = { ok: false, error };
  if (opts?.code) payload.code = opts.code;
  if (opts?.details !== undefined) payload.details = opts.details;
  return NextResponse.json(payload, { status });
}

/**
 * Log mínimo (sem vazar dados sensíveis). Use em rotas críticas.
 */
export function logRouteError(route: string, err: unknown, extra?: Record<string, any>) {
  const msg =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack?.slice(0, 400) }
      : { message: String(err) };

  console.error(`[API:${route}]`, {
    ...msg,
    ...(extra || {}),
  });
}

export function parseJsonSafe<T = any>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readJsonBody(req: Request) {
  const raw = await req.text();
  if (!raw) return { raw: "", json: null as any };
  return { raw, json: parseJsonSafe(raw) };
}