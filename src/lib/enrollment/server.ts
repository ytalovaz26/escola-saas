// src/lib/enrollment/server.ts
// Matrícula digital — acesso ao banco e ao Storage (somente servidor, service_role).
// Toda autorização é feita aqui, a partir da sessão do usuário; nada vindo do
// navegador define escola, responsável ou vínculo.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonFail } from "@/lib/http";
import { ENROLLMENT_BUCKET, SIGNED_URL_SECONDS, isUuid } from "./rules";

export type ParentLink = { studentId: string; parentId: string; schoolId: string };
export type ParentAccount = { id: string; schoolId: string; row: Record<string, unknown> };

export const PARENT_COLUMNS =
  "id, school_id, user_id, full_name, phone, cpf, phone_secondary, zip_code, street, street_number, address_complement, neighborhood, city, state, first_login_completed";

function bearer(req: Request): string | null {
  const m = String(req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
  return m?.[1] || null;
}

export async function getSessionUserId(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

// Todos os cadastros de responsável do usuário (um por escola) e os vínculos ATIVOS
// com alunos, sempre dentro da mesma escola do cadastro.
export async function loadParentContext(userId: string): Promise<{ accounts: ParentAccount[]; links: ParentLink[] }> {
  const { data: parents, error } = await supabaseAdmin.from("parents").select(PARENT_COLUMNS).eq("user_id", userId);
  if (error) throw new Error("Falha ao carregar o cadastro do responsável.");
  const accounts: ParentAccount[] = (parents || [])
    .filter((p: any) => p?.id && p?.school_id)
    .map((p: any) => ({ id: String(p.id), schoolId: String(p.school_id), row: p }));
  if (!accounts.length) return { accounts, links: [] };

  const { data: rows, error: linkErr } = await supabaseAdmin
    .from("student_parents")
    .select("student_id, parent_id, school_id")
    .in("parent_id", accounts.map((a) => a.id))
    .eq("is_active", true);
  if (linkErr) throw new Error("Falha ao carregar os vínculos com alunos.");

  const bySchool = new Map(accounts.map((a) => [a.id, a.schoolId]));
  const links: ParentLink[] = (rows || [])
    .filter((r: any) => r?.student_id && bySchool.get(String(r.parent_id)) === String(r.school_id))
    .map((r: any) => ({ studentId: String(r.student_id), parentId: String(r.parent_id), schoolId: String(r.school_id) }));
  return { accounts, links };
}

const NOT_ALLOWED = () => jsonFail(403, "Acesso não autorizado a este aluno.");

// Exige sessão de responsável com vínculo ATIVO ao aluno; o aluno precisa ser da mesma escola.
export async function requireParentForStudent(req: Request, studentId: unknown) {
  const userId = await getSessionUserId(req);
  if (!userId) return { ok: false as const, res: jsonFail(401, "Sessão inválida. Faça login novamente.") };
  if (!isUuid(studentId)) return { ok: false as const, res: NOT_ALLOWED() };

  const { links } = await loadParentContext(userId);
  const link = links.find((l) => l.studentId === studentId);
  if (!link) return { ok: false as const, res: NOT_ALLOWED() };

  const { data: student, error } = await supabaseAdmin
    .from("students")
    .select("id, school_id")
    .eq("id", studentId)
    .eq("school_id", link.schoolId)
    .maybeSingle();
  if (error) return { ok: false as const, res: jsonFail(500, "Falha ao validar o aluno.") };
  if (!student) return { ok: false as const, res: NOT_ALLOWED() };

  return { ok: true as const, userId, parentId: link.parentId, schoolId: link.schoolId, studentId };
}

// URL TEMPORÁRIA (SIGNED_URL_SECONDS). Com downloadName, o navegador baixa o arquivo com
// esse nome em vez de abri-lo. Nunca há URL pública permanente.
export async function createSignedDocumentUrl(storagePath: string, downloadName?: string): Promise<string | null> {
  const bucket = supabaseAdmin.storage.from(ENROLLMENT_BUCKET);
  const { data, error } = downloadName
    ? await bucket.createSignedUrl(storagePath, SIGNED_URL_SECONDS, { download: downloadName })
    : await bucket.createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export const STAFF_DOCUMENT_ROLES = ["diretor", "director", "coordenador", "coordinator", "secretaria", "secretary", "admin"];

export const DOCUMENT_COLUMNS =
  "id, school_id, student_id, parent_id, doc_type, original_filename, mime_type, size_bytes, status, rejection_reason, uploaded_at, reviewed_at, storage_path";
