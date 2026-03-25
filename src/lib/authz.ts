// src/lib/authz.ts
import { supabase } from "@/lib/supabaseClient";

export type AppRole = "admin_master" | "director" | "staff" | "unknown";

export async function getMyRole(): Promise<AppRole> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return "unknown";

  const userId = authData.user.id;

  // 1) Admin Master?
  const { data: pa, error: paErr } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!paErr && pa?.user_id) return "admin_master";

  // 2) Diretor/Staff? (pega um vínculo ativo)
  const { data: su, error: suErr } = await supabase
    .from("school_users")
    .select("role,is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (suErr || !su) return "unknown";

  const roleText = String(su.role);
  if (roleText === "director") return "director";
  return "staff";
}
