import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
