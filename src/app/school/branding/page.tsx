"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SchoolBrandingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/school/settings/branding");
  }, [router]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          Redirecionando...
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Abrindo a página de personalização da escola.
        </p>
      </div>
    </main>
  );
}