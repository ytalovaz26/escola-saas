// Hook de carregamento SÓ PARA TESTES: resolve "@/..." para src/ e troca o Supabase por
// dublês em memória (sem rede, sem banco). Nunca usado pela aplicação.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOCKS = {
  "@/lib/supabaseAdmin": path.join(ROOT, "tests", "helpers", "fakeSupabaseAdmin.mjs"),
  "@supabase/supabase-js": path.join(ROOT, "tests", "helpers", "fakeSupabaseJs.mjs"),
};

export async function resolve(specifier, context, next) {
  if (MOCKS[specifier]) return { url: pathToFileURL(MOCKS[specifier]).href, shortCircuit: true };
  if (specifier === "next/server") return next("next/server.js", context);
  // Import relativo sem extensão dentro de src/ (padrão do Next): tenta .ts/.tsx.
  if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
      if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  if (specifier.startsWith("@/")) {
    const base = path.join(ROOT, "src", specifier.slice(2));
    for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
      if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
