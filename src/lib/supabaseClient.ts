import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("[ENV] NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? "OK" : "MISSING");
console.log("[ENV] NEXT_PUBLIC_SUPABASE_ANON_KEY:", supabaseAnonKey ? "OK" : "MISSING");

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase env vars missing. Confira o .env.local.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
