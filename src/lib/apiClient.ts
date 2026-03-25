// src/lib/apiClient.ts
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type ApiFetchOptions = RequestInit & {
  requireAuth?: boolean; // se true, falha se não tiver session
};

export async function getAccessTokenOrNull(): Promise<string | null> {
  const supabase = supabaseBrowser();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiFetch(input: string, options: ApiFetchOptions = {}) {
  const { requireAuth, headers, ...rest } = options;

  const token = await getAccessTokenOrNull();

  if (requireAuth && !token) {
    return new Response(JSON.stringify({ ok: false, error: "Not authenticated." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mergedHeaders: HeadersInit = {
    "Content-Type": "application/json",
    ...(headers || {}),
  };

  if (token) {
    (mergedHeaders as any)["Authorization"] = `Bearer ${token}`;
  }

  return fetch(input, {
    ...rest,
    headers: mergedHeaders,
  });
}

export async function apiMe() {
  const res = await apiFetch("/api/me", { method: "GET", requireAuth: true });
  const data = await res.json().catch(() => null);
  return { res, data };
}
