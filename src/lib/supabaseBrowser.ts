import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

// Se você tiver o tipo Database, use:
// import type { Database } from "@/types/supabase";

export function supabaseBrowser() {
  // return createClientComponentClient<Database>();
  return createClientComponentClient();
}
