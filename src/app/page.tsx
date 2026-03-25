"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyRole } from "@/lib/authz";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }

      const role = await getMyRole();

      if (role === "admin_master") router.replace("/admin-master");
      else if (role === "diretor") router.replace("/director");
      else if (role === "coordenador") router.replace("/coordinator");
      else if (role === "professor") router.replace("/teacher");
      else if (role === "parent") router.replace("/parent");
      else router.replace("/login"); // fallback
    })();
  }, [router]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Carregando...</h1>
    </main>
  );
}
