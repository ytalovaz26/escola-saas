// Dublê de "@supabase/supabase-js" para testes: login com senha (verificação da senha atual)
// e consultas no mesmo banco em memória (RLS não é simulada).
import { signInWithPassword, supabaseAdmin } from "./fakeSupabaseAdmin.mjs";

export function createClient() {
  return {
    from: (table) => supabaseAdmin.from(table),
    auth: {
      signInWithPassword: async ({ email, password }) => signInWithPassword(email, password),
    },
  };
}
