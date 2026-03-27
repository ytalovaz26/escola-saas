import { Suspense } from "react";
import PageContent from "./PageContent";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <PageContent />
    </Suspense>
  );
}