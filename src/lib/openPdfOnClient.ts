export type OpenPdfOptions = {
  fileName?: string;
  successMessage?: string;
};

function safeFileName(value?: string) {
  return String(value || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_\.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function openPdfFromResponse(
  res: Response,
  options?: OpenPdfOptions
): Promise<void> {
  if (!res.ok) {
    throw new Error("Resposta inválida ao gerar PDF.");
  }

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const rawName = options?.fileName || "documento.pdf";
  const fileName = safeFileName(rawName).endsWith(".pdf")
    ? safeFileName(rawName)
    : `${safeFileName(rawName)}.pdf`;

  const a = document.createElement("a");
  a.href = blobUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.download = fileName;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => {
    window.URL.revokeObjectURL(blobUrl);
  }, 60000);
}