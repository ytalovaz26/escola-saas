// Dublê de "@supabase/supabase-js" para testes: só o login com senha usado na verificação
// da senha atual.
import { signInWithPassword } from "./fakeSupabaseAdmin.mjs";

export function createClient() {
  return {
    auth: {
      signInWithPassword: async ({ email, password }) => signInWithPassword(email, password),
    },
  };
}
