// Texto e formatos brasileiros para PDFs (PDFKit, fontes Helvetica internas).
// Módulo puro, testado em tests/school-students-update.test.mjs.

// As fontes Helvetica internas do PDFKit usam WinAnsi (Windows-1252). Caracteres fora desse
// repertório viram lixo no PDF; preservamos acentos do português e a pontuação suportada.
// (Mesma regra já usada no diário de classe.)
const SUBSTITUTIONS: Record<string, string> = {
  "­": "", "​": "", "‌": "", "‍": "",
  "⁠": "", "﻿": "", "︎": "", "️": "",
  "‐": "-", "‑": "-", "‒": "-", "−": "-",
  " ": " ", " ": " ", " ": " ",
  "→": " -> ", "←": " <- ",
  "✓": "", "✔": "", "●": "•",
};
const WIN_ANSI_EXTRA = new Set(Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"));

// U+2028 / U+2029 (separadores de linha/parágrafo) viram quebra de linha.
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");

export function normalizePdfText(value: unknown, opts: { keepLineBreaks?: boolean } = {}): string {
  const lines = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(LINE_SEPARATORS, "\n")
    .split("\n")
    .map((line) =>
      Array.from(line)
        .map((ch) => {
          if (Object.prototype.hasOwnProperty.call(SUBSTITUTIONS, ch)) return SUBSTITUTIONS[ch];
          const code = ch.codePointAt(0) ?? 0;
          if (ch === "\t") return " ";
          if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) return ch;
          return " ";
        })
        .join("")
        .replace(/[ ]{2,}/g, " ")
        .trim()
    );
  if (opts.keepLineBreaks) {
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return lines.filter(Boolean).join(" ").trim();
}

export const EMPTY = "Não informado";

export function orEmpty(value: unknown, empty = EMPTY): string {
  const s = normalizePdfText(value);
  return s || empty;
}

// "2026-03-07" ou "2026-03-07T10:00:00Z" -> "07/03/2026" (sem conversão de fuso: é data civil).
export function brDate(value: unknown, empty = "—"): string {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s ? normalizePdfText(s) : empty;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const DATE_TIME_BR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// Data e hora no horário de Brasília (o servidor da Vercel roda em UTC).
export function brDateTime(value: unknown, empty = "—"): string {
  if (value === null || value === undefined || value === "") return empty;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return empty;
  return DATE_TIME_BR.format(d).replace(",", "");
}

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

// Telefone brasileiro: (11) 98765-4321 / (11) 3456-7890; mantém o original se não reconhecer.
export function formatPhoneBR(value: unknown, empty = EMPTY): string {
  const raw = normalizePdfText(value);
  if (!raw) return empty;
  let d = digits(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

export function formatCpf(value: unknown, empty = EMPTY): string {
  const raw = normalizePdfText(value);
  if (!raw) return empty;
  const d = digits(raw);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : raw;
}

export function formatCep(value: unknown, empty = EMPTY): string {
  const raw = normalizePdfText(value);
  if (!raw) return empty;
  const d = digits(raw);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : raw;
}

// Endereço em uma linha — mesma composição usada na ficha exibida na tela.
export function buildAddressText(parent: {
  street?: unknown;
  street_number?: unknown;
  address_complement?: unknown;
  neighborhood?: unknown;
  city?: unknown;
  state?: unknown;
  zip_code?: unknown;
}): string | null {
  const t = (v: unknown) => normalizePdfText(v);
  const parts: string[] = [];
  const street = t(parent.street);
  const number = t(parent.street_number);
  if (street) parts.push(number ? `${street}, ${number}` : street);
  const complement = t(parent.address_complement);
  if (complement) parts.push(complement);
  const neighborhood = t(parent.neighborhood);
  if (neighborhood) parts.push(neighborhood);
  const cityUf = [t(parent.city), t(parent.state)].filter(Boolean).join(" / ");
  if (cityUf) parts.push(cityUf);
  const zip = t(parent.zip_code);
  if (zip) parts.push(`CEP ${formatCep(zip)}`);
  return parts.length ? parts.join(", ") : null;
}

export function safeFileName(value: string): string {
  return (
    String(value || "aluno")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 80) || "aluno"
  );
}
