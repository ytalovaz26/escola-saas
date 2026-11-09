// src/lib/teacherClassAccess.ts
// Regra ÚNICA de autorização professor ↔ turma, validada no servidor a cada requisição.
//
// Um professor só acessa uma turma quando existe vínculo em teacher_classes que seja:
//   - da escola autorizada na sessão (school_id vindo do guard, nunca do navegador);
//   - do próprio usuário autenticado (teacher_user_id);
//   - ATIVO (is_active = true) — desvincular na gestão corta o acesso na próxima requisição;
// e a turma pertence a essa mesma escola (classes.school_id).
//
// Toda rota que expõe dados de turma/alunos a professor deve chamar esta verificação
// ANTES de consultar qualquer dado pessoal. Sem autorização: HTTP 403, sem detalhes.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const TEACHER_CLASS_DENIED_MESSAGE = "Professor sem vínculo ativo com esta turma.";
const VALIDATION_FAILED_MESSAGE = "Erro ao validar vínculo professor-turma.";

function clean(v: unknown) {
  return String(v ?? "").trim();
}

export function isTeacherRole(role: unknown) {
  const r = clean(role).toLowerCase();
  return r === "professor" || r === "teacher";
}

/**
 * Consulta base dos vínculos ATIVOS do professor na escola.
 * Único lugar que define o que é "vínculo válido"; listas e verificações partem daqui.
 */
export function activeTeacherClassLinks(schoolId: string, teacherUserId: string, columns = "class_id") {
  return supabaseAdmin
    .from("teacher_classes")
    .select(columns)
    .eq("school_id", schoolId)
    .eq("teacher_user_id", teacherUserId)
    .eq("is_active", true);
}

export type TeacherClassAccess = { ok: true } | { ok: false; status: 403 | 500; error: string };

const DENIED: TeacherClassAccess = { ok: false, status: 403, error: TEACHER_CLASS_DENIED_MESSAGE };

/** Verifica se o professor tem vínculo ativo com a turma, na escola da sessão. */
export async function checkTeacherClassAccess(params: {
  schoolId: string | null | undefined;
  teacherUserId: string | null | undefined;
  classId: string | null | undefined;
}): Promise<TeacherClassAccess> {
  const schoolId = clean(params.schoolId);
  const teacherUserId = clean(params.teacherUserId);
  const classId = clean(params.classId);
  if (!schoolId || !teacherUserId || !classId) return DENIED;

  const { data: links, error: linkErr } = await activeTeacherClassLinks(schoolId, teacherUserId, "id")
    .eq("class_id", classId)
    .limit(1);
  if (linkErr) {
    console.warn("[teacher-class-access]", { reason: "falha_vinculo" });
    return { ok: false, status: 500, error: VALIDATION_FAILED_MESSAGE };
  }
  if (!links || links.length === 0) return DENIED;

  // Defesa em profundidade: a turma precisa ser da mesma escola do vínculo.
  const { data: cls, error: clsErr } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (clsErr) {
    console.warn("[teacher-class-access]", { reason: "falha_turma" });
    return { ok: false, status: 500, error: VALIDATION_FAILED_MESSAGE };
  }
  if (!cls) return DENIED;

  return { ok: true };
}

/** Igual a checkTeacherClassAccess, devolvendo a resposta HTTP de negação (ou null se autorizado). */
export async function requireTeacherClassAccess(params: {
  schoolId: string | null | undefined;
  teacherUserId: string | null | undefined;
  classId: string | null | undefined;
}): Promise<NextResponse | null> {
  const access = await checkTeacherClassAccess(params);
  if (access.ok) return null;
  return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
}

/** Dos IDs informados, só os de turmas que pertencem à escola. Lança erro em falha de consulta. */
export async function classIdsOfSchool(schoolId: string, classIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(classIds.map(clean).filter(Boolean)));
  if (!clean(schoolId) || ids.length === 0) return new Set();
  const { data, error } = await supabaseAdmin.from("classes").select("id").eq("school_id", clean(schoolId)).in("id", ids);
  if (error) throw new Error("Falha ao validar turmas da escola.");
  return new Set(((data as any[]) || []).map((row) => clean(row?.id)).filter(Boolean));
}

/** IDs das turmas com vínculo ATIVO do professor na escola (turma da mesma escola). Lança erro em falha. */
export async function listActiveTeacherClassIds(schoolId: string, teacherUserId: string): Promise<string[]> {
  if (!clean(schoolId) || !clean(teacherUserId)) return [];
  const { data, error } = await activeTeacherClassLinks(clean(schoolId), clean(teacherUserId), "class_id");
  if (error) throw new Error("Falha ao buscar turmas vinculadas ao professor.");
  const linked = ((data as any[]) || []).map((row) => clean(row?.class_id)).filter(Boolean);
  const inSchool = await classIdsOfSchool(schoolId, linked);
  return Array.from(new Set(linked.filter((id) => inSchool.has(id))));
}
