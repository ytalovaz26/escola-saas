// Segurança professor ↔ turma: professor desvinculado (teacher_classes.is_active = false),
// professor de outra turma e professor de outra escola NÃO acessam dados da turma; professor
// ativo mantém o acesso. Rotas reais com Supabase em memória e dados FICTÍCIOS.
// Executar: node --test tests/teacher-class-access.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./helpers/loader.mjs", import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ficticio.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-ficticia";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-secreta-ficticia";
globalThis.fetch = async () => {
  throw new Error("rede bloqueada nos testes");
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { state, reset, addUser, issueToken } = await import("./helpers/fakeState.mjs");
const { supabaseAdmin } = await import("./helpers/fakeSupabaseAdmin.mjs");
const access = await import("../src/lib/teacherClassAccess.ts");
const route = (p) => import(`../src/app/api/${p}/route.ts`);

const M = {
  diary: await route("teacher/class-diary"),
  diaryUpdate: await route("teacher/class-diary/update"),
  diaryDelete: await route("teacher/class-diary/delete"),
  diaryReport: await route("teacher/class-diary/report"),
  roster: await route("teacher/attendance/roster"),
  save: await route("teacher/attendance/save"),
  session: await route("teacher/attendance/session"),
  histDaily: await route("teacher/attendance/history/daily"),
  histMonthly: await route("teacher/attendance/history/monthly"),
  attReport: await route("teacher/attendance/report"),
  attReportMonth: await route("teacher/attendance/report-month"),
  sessCreate: await route("teacher/attendance/sessions/create"),
  sessList: await route("teacher/attendance/sessions/list"),
  attList: await route("teacher/attendance/list"),
  attMark: await route("teacher/attendance/mark"),
  genRoster: await route("attendance/roster"),
  genSave: await route("attendance/save"),
  classStudents: await route("teacher/class-students"),
  students: await route("teacher/students"),
  classInfo: await route("teacher/classes/[classId]"),
  classStudentList: await route("teacher/classes/[classId]/students/list"),
  assign: await route("teacher/classes/[classId]/students/assign"),
  unassign: await route("teacher/classes/[classId]/students/unassign"),
  classesList: await route("teacher/classes/list"),
  calendar: await route("teacher/calendar"),
  schoolTeacherClasses: await route("school/teachers/classes/list"),
  gradesGrid: await route("teacher/grades/grid"),
  gradesList: await route("teacher/grades/list"),
  gradesSave: await route("teacher/grades/save"),
  gradesSaveGrid: await route("teacher/grades/save-grid"),
  gradesReport: await route("teacher/grades/report"),
  classGradesReport: await route("teacher/classes/grades/report"),
  devStudents: await route("dev/enroll/students"),
  devClasses: await route("dev/enroll/classes"),
};

// ---------------------------------------------------------------------------
// Registro das tabelas consultadas (para provar que nada pessoal é lido antes da validação)
// ---------------------------------------------------------------------------
const PII_TABLES = new Set([
  "students", "student_classes", "class_students", "profiles", "attendance", "attendance_records",
  "attendance_marks", "attendance_sessions", "grades", "class_diaries", "class_diary_entries",
]);
const originalFrom = supabaseAdmin.from;
const originalRpc = supabaseAdmin.rpc;
let touched = [];
supabaseAdmin.from = (table) => {
  touched.push(table);
  return originalFrom(table);
};
supabaseAdmin.rpc = async (name, args) => {
  touched.push(`rpc:${name}`);
  const s = state.tables.student_classes.filter((r) => r.class_id === args?.p_class_id && r.is_active);
  return { data: s.map((r) => ({ student_id: r.student_id })), error: null };
};

// ---------------------------------------------------------------------------
// Cenário fictício: Escola Alfa (turmas A1, A2) e Escola Beta (turma B1)
// ---------------------------------------------------------------------------
const NOMES = { A1: "Aluno Ficticio Alfa Um", A2: "Aluna Ficticia Alfa Dois", B1: "Aluno Ficticio Beta Um" };
let S;
function seed() {
  reset();
  state.tables.class_students = [];
  const mk = (email, name) => addUser({ email, user_metadata: { full_name: name } });
  const ids = {
    dirA: mk("dir.alfa@ficticio.test", "Diretora Alfa"),
    profAtivo: mk("prof.ativo@ficticio.test", "Professor Ativo"),
    profDesv: mk("prof.desv@ficticio.test", "Professora Desvinculada"),
    profOutra: mk("prof.outra@ficticio.test", "Professor Outra Turma"),
    profB: mk("prof.beta@ficticio.test", "Professor Beta"),
  };
  const su = (u, school, role) =>
    state.tables.school_users.push({ id: `su-${u}`, user_id: u, school_id: school, role, is_active: true, created_at: "2026-01-01" });
  su(ids.dirA, "alfa", "diretor");
  su(ids.profAtivo, "alfa", "professor");
  su(ids.profDesv, "alfa", "professor");
  su(ids.profOutra, "alfa", "professor");
  su(ids.profB, "beta", "professor");
  state.tables.schools.push({ id: "alfa", name: "Escola Alfa" }, { id: "beta", name: "Escola Beta" });
  state.tables.classes.push(
    { id: "A1", school_id: "alfa", name: "1º Ano A", grade: "1º", shift: "Manhã", created_at: "2026-01-01" },
    { id: "A2", school_id: "alfa", name: "2º Ano A", grade: "2º", shift: "Tarde", created_at: "2026-01-01" },
    { id: "B1", school_id: "beta", name: "1º Ano B", grade: "1º", shift: "Manhã", created_at: "2026-01-01" }
  );
  state.tables.teacher_classes.push(
    { id: "tc-ativo", school_id: "alfa", class_id: "A1", teacher_user_id: ids.profAtivo, is_active: true, created_at: "2026-02-01" },
    { id: "tc-desv", school_id: "alfa", class_id: "A1", teacher_user_id: ids.profDesv, is_active: false, created_at: "2026-02-01" },
    { id: "tc-outra", school_id: "alfa", class_id: "A2", teacher_user_id: ids.profOutra, is_active: true, created_at: "2026-02-01" },
    { id: "tc-beta", school_id: "beta", class_id: "B1", teacher_user_id: ids.profB, is_active: true, created_at: "2026-02-01" },
    // Vínculo inconsistente (escola do vínculo ≠ escola da turma): não pode abrir a turma A1.
    { id: "tc-forjado", school_id: "beta", class_id: "A1", teacher_user_id: ids.profB, is_active: true, created_at: "2026-02-01" }
  );
  for (const [cls, school] of [["A1", "alfa"], ["A2", "alfa"], ["B1", "beta"]]) {
    const sid = `aluno-${cls}`;
    state.tables.students.push({ id: sid, school_id: school, full_name: NOMES[cls], registration_number: `M-${cls}`, created_at: "2026-01-01" });
    state.tables.student_classes.push({ id: `sc-${cls}`, school_id: school, class_id: cls, student_id: sid, is_active: true, created_at: "2026-01-01" });
    state.tables.class_students.push({ id: `cs-${cls}`, school_id: school, class_id: cls, student_id: sid, is_active: true, created_at: "2026-01-01" });
    state.tables.profiles.push({ user_id: sid, full_name: NOMES[cls] });
  }
  state.tables.class_diaries = [
    { id: "diario-ativo", school_id: "alfa", class_id: "A1", teacher_user_id: ids.profAtivo, subject_name: "Português", term_label: "1º bimestre", reference_month: "2026-11", created_at: "2026-11-01" },
    { id: "diario-desv", school_id: "alfa", class_id: "A1", teacher_user_id: ids.profDesv, subject_name: "Ciências", term_label: "1º bimestre", reference_month: "2026-11", created_at: "2026-11-01" },
    { id: "diario-beta", school_id: "beta", class_id: "B1", teacher_user_id: ids.profB, subject_name: "Português", term_label: "1º bimestre", reference_month: "2026-11", created_at: "2026-11-01" },
  ];
  state.tables.class_diary_entries = [
    { id: "ent-ativo", diary_id: "diario-ativo", school_id: "alfa", class_id: "A1", teacher_user_id: ids.profAtivo, lesson_date: "2026-11-05", content_taught: "Leitura de fábulas sobre " + NOMES.A1 },
    { id: "ent-beta", diary_id: "diario-beta", school_id: "beta", class_id: "B1", teacher_user_id: ids.profB, lesson_date: "2026-11-05", content_taught: "Aula fictícia Beta" },
    { id: "ent-desv", diary_id: "diario-desv", school_id: "alfa", class_id: "A1", teacher_user_id: ids.profDesv, lesson_date: "2026-11-05", content_taught: "Observação de " + NOMES.A1 },
  ];
  state.tables.grades = [{ id: "nota-1", school_id: "alfa", class_id: "A1", student_id: "aluno-A1", term: "1", subject: "Português", score: 9 }];
  state.tables.attendance_sessions = [
    { id: "sess-desv", id_uuid: "sess-desv", school_id: "alfa", class_id: "A1", teacher_id: ids.profDesv, teacher_user_id: ids.profDesv, lesson: 1, session_date: "2026-11-04", lesson_date: "2026-11-04", lesson_number: 1 },
  ];
  state.tables.attendance_marks = [];
  state.tables.attendance_records = [];
  state.tables.attendance = [];
  state.tables.school_calendar_blocks = [];
  state.tables.school_class_schedule = [];
  state.tables.class_subjects = [
    { id: "cs-port-A1", school_id: "alfa", class_id: "A1", subject_id: "port", subjects: { id: "port", name: "Português" } },
    { id: "cs-port-B1", school_id: "beta", class_id: "B1", subject_id: "port", subjects: { id: "port", name: "Português" } },
  ];
  state.tables.subjects = [];
  S = { ids, tok: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, issueToken(v)])) };
}
beforeEach(() => {
  seed();
  touched = [];
});

async function call(mod, method, url, token, { body, ctx } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const res = await mod[method](req, ctx);
  const type = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  const text = type.includes("pdf") ? "" : buf.toString("utf8");
  return { status: res.status, type, text, json: type.includes("json") ? JSON.parse(text || "null") : null };
}

// Rotas de turma: (classId) => chamada. Áreas: diário, chamada, alunos, notas, documentos.
const D = "2026-11-04";
const CLASS_ROUTES = {
  "diário: ler": (c, t) => call(M.diary, "GET", `/x?classId=${c}&referenceMonth=2026-11`, t),
  "diário: lançar": (c, t) => call(M.diary, "POST", "/x", t, { body: { classId: c, subjectName: "Português", referenceMonth: "2026-11", lessonDate: D, contentTaught: "Conteúdo fictício" } }),
  "diário: editar (PUT)": (c, t) => call(M.diary, "PUT", "/x", t, { body: { classId: c, entryId: "ent-ativo", subjectName: "Português", referenceMonth: "2026-11", lessonDate: D, contentTaught: "Editado" } }),
  "diário: excluir (DELETE)": (c, t) => call(M.diary, "DELETE", "/x", t, { body: { classId: c, entryId: "ent-ativo" } }),
  "documento: PDF do diário": (c, t) => call(M.diaryReport, "GET", `/x?classId=${c}&lessonDate=2026-11-05&referenceMonth=2026-11&subjectName=Português`, t),
  "chamada: lista do dia": (c, t) => call(M.roster, "GET", `/x?classId=${c}&date=${D}`, t),
  "chamada: salvar": (c, t) => call(M.save, "POST", "/x", t, { body: { classId: c, date: D, items: [{ studentId: `aluno-${c}`, status: "present" }] } }),
  "chamada: apagar": (c, t) => call(M.save, "DELETE", `/x?classId=${c}&date=${D}`, t),
  "chamada: sessão": (c, t) => call(M.session, "GET", `/x?classId=${c}&date=${D}&lesson=1`, t),
  "chamada: histórico diário": (c, t) => call(M.histDaily, "GET", `/x?classId=${c}&from=2026-11-01&to=2026-11-30`, t),
  "chamada: histórico mensal": (c, t) => call(M.histMonthly, "GET", `/x?classId=${c}&from=2026-11-01&to=2026-11-30`, t),
  "chamada: criar sessão (legado)": (c, t) => call(M.sessCreate, "POST", "/x", t, { body: { classId: c, date: D, lesson: 1 } }),
  "chamada: listar sessões (legado)": (c, t) => call(M.sessList, "GET", `/x?classId=${c}`, t),
  "chamada: lista geral (/api/attendance/roster)": (c, t) => call(M.genRoster, "GET", `/x?classId=${c}&date=${D}`, t),
  "chamada: salvar geral (/api/attendance/save)": (c, t) => call(M.genSave, "POST", "/x", t, { body: { classId: c, date: D, items: [{ studentId: `aluno-${c}`, status: "present" }] } }),
  "documento: PDF chamada diária": (c, t) => call(M.attReport, "GET", `/x?classId=${c}&date=${D}`, t),
  "documento: PDF chamada mensal": (c, t) => call(M.attReportMonth, "GET", `/x?classId=${c}&month=2026-11`, t),
  "alunos: class-students": (c, t) => call(M.classStudents, "GET", `/x?classId=${c}`, t),
  "alunos: students": (c, t) => call(M.students, "GET", `/x?classId=${c}`, t),
  "alunos: dados da turma": (c, t) => call(M.classInfo, "GET", "/x", t, { ctx: { params: Promise.resolve({ classId: c }) } }),
  "alunos: lista da turma (legado)": (c, t) => call(M.classStudentList, "GET", "/x", t, { ctx: { params: { classId: c } } }),
  "alunos: incluir na turma": (c, t) => call(M.assign, "POST", "/x", t, { body: { studentId: `aluno-${c}` }, ctx: { params: { classId: c } } }),
  "alunos: retirar da turma": (c, t) => call(M.unassign, "POST", "/x", t, { body: { studentId: `aluno-${c}` }, ctx: { params: { classId: c } } }),
  "notas: grade": (c, t) => call(M.gradesGrid, "GET", `/x?classId=${c}&term=1`, t),
  "notas: lista": (c, t) => call(M.gradesList, "GET", `/x?classId=${c}&term=1&subject=Português`, t),
  "notas: salvar": (c, t) => call(M.gradesSave, "POST", "/x", t, { body: { classId: c, term: "1", subject: "Português", items: [{ studentId: `aluno-${c}`, score: 8 }] } }),
  "notas: salvar grade": (c, t) => call(M.gradesSaveGrid, "POST", "/x", t, { body: { classId: c, term: "1", items: [{ student_id: `aluno-${c}`, grades: { port: 8 } }] } }),
  "documento: PDF de notas": (c, t) => call(M.gradesReport, "GET", `/x?classId=${c}&term=1&studentId=aluno-${c}`, t),
  "documento: PDF de notas (turmas)": (c, t) => call(M.classGradesReport, "GET", `/x?classId=${c}&term=1&studentId=aluno-${c}`, t),
};

const DENIED = access.TEACHER_CLASS_DENIED_MESSAGE;
const piiTouched = () => touched.filter((t) => PII_TABLES.has(t) || t.startsWith("rpc:"));

function assertDenied(r, label) {
  assert.equal(r.status, 403, `${label}: esperado 403, veio ${r.status} ${r.text.slice(0, 120)}`);
  assert.equal(r.json?.ok, false, `${label}: ok`);
  assert.equal(r.json?.error, DENIED, `${label}: mensagem da negação`);
  assert.ok(!r.json?.details, `${label}: sem detalhes internos`);
  for (const nome of Object.values(NOMES)) assert.ok(!r.text.includes(nome), `${label}: vazou dado pessoal`);
}

// ---------------------------------------------------------------------------
// Matriz: 29 operações de turma (diário, chamada, alunos, notas, documentos)
// ---------------------------------------------------------------------------
test("professor com vínculo ativo mantém acesso a todas as operações da turma", async () => {
  for (const [name, fn] of Object.entries(CLASS_ROUTES)) {
    seed();
    const r = await fn("A1", S.tok.profAtivo);
    assert.equal(r.status, 200, `${name}: ${r.status} ${r.text.slice(0, 160)}`);
  }
});

test("professor DESVINCULADO recebe 403 em todas as operações, sem ler dados pessoais", async () => {
  for (const [name, fn] of Object.entries(CLASS_ROUTES)) {
    seed();
    touched = [];
    const r = await fn("A1", S.tok.profDesv);
    assertDenied(r, name);
    assert.deepEqual(piiTouched(), [], `${name}: consultou dados pessoais antes de validar`);
  }
});

test("professor de OUTRA turma da mesma escola recebe 403", async () => {
  for (const [name, fn] of Object.entries(CLASS_ROUTES)) {
    seed();
    touched = [];
    const r = await fn("A1", S.tok.profOutra);
    assertDenied(r, name);
    assert.deepEqual(piiTouched(), [], `${name}: consultou dados pessoais antes de validar`);
  }
});

test("professor de OUTRA escola recebe 403, mesmo com vínculo inconsistente apontando para a turma", async () => {
  for (const [name, fn] of Object.entries(CLASS_ROUTES)) {
    seed();
    touched = [];
    const r = await fn("A1", S.tok.profB);
    if (name.includes("salvar geral")) {
      // /api/attendance/save confere a turma na escola da sessão antes (404, sem dado pessoal).
      assert.equal(r.status, 404, name);
      assert.ok(!r.text.includes(NOMES.A1));
      continue;
    }
    assert.equal(r.status, 403, `${name}: ${r.status}`);
    for (const nome of Object.values(NOMES)) assert.ok(!r.text.includes(nome), `${name}: vazou dado pessoal`);
    assert.deepEqual(piiTouched(), [], `${name}: consultou dados pessoais antes de validar`);
  }
});

test("professor da Escola Beta acessa normalmente a própria turma (multiescola)", async () => {
  for (const [name, fn] of Object.entries(CLASS_ROUTES)) {
    // Dependem de registros prévios da Alfa (lançamento/chamada salva); cobertos nos testes da Alfa.
    if (name.includes("editar (PUT)") || name.includes("excluir (DELETE)") || name.includes("chamada: apagar")) continue;
    seed();
    const r = await fn("B1", S.tok.profB);
    assert.equal(r.status, 200, `${name}: ${r.status} ${r.text.slice(0, 160)}`);
    assert.ok(!r.text.includes(NOMES.A1) && !r.text.includes(NOMES.A2), `${name}: dado da Alfa na resposta da Beta`);
  }
});

// ---------------------------------------------------------------------------
// Revogação imediata e casos específicos
// ---------------------------------------------------------------------------
test("desvincular corta o acesso na requisição seguinte; reativar devolve", async () => {
  const ops = ["alunos: class-students", "chamada: lista do dia", "notas: grade", "documento: PDF chamada diária", "diário: ler"];
  for (const op of ops) assert.equal((await CLASS_ROUTES[op]("A1", S.tok.profAtivo)).status, 200, op);
  state.tables.teacher_classes.find((r) => r.id === "tc-ativo").is_active = false; // gestão desvincula
  for (const op of ops) assertDenied(await CLASS_ROUTES[op]("A1", S.tok.profAtivo), op);
  state.tables.teacher_classes.find((r) => r.id === "tc-ativo").is_active = true; // gestão reativa
  for (const op of ops) assert.equal((await CLASS_ROUTES[op]("A1", S.tok.profAtivo)).status, 200, op);
});

test("vínculo sem is_active = true (nulo/ausente) não autoriza", async () => {
  const link = state.tables.teacher_classes.find((r) => r.id === "tc-ativo");
  link.is_active = null;
  assertDenied(await CLASS_ROUTES["alunos: class-students"]("A1", S.tok.profAtivo), "is_active nulo");
  delete link.is_active;
  assertDenied(await CLASS_ROUTES["alunos: class-students"]("A1", S.tok.profAtivo), "is_active ausente");
});

test("diário do próprio professor desvinculado: não lê, não edita, não exclui, não gera PDF", async () => {
  const t = S.tok.profDesv;
  const before = JSON.stringify(state.tables.class_diary_entries);
  assertDenied(await call(M.diary, "PUT", "/x", t, { body: { classId: "A1", entryId: "ent-desv", subjectName: "Ciências", referenceMonth: "2026-11", lessonDate: D, contentTaught: "Alterado" } }), "PUT class-diary");
  assertDenied(await call(M.diaryUpdate, "PUT", "/x", t, { body: { entryId: "ent-desv", content_taught: "Alterado" } }), "class-diary/update");
  assertDenied(await call(M.diaryDelete, "DELETE", "/x?entryId=ent-desv", t), "class-diary/delete");
  assertDenied(await call(M.diary, "DELETE", "/x", t, { body: { classId: "A1", entryId: "ent-desv" } }), "DELETE class-diary");
  assertDenied(await call(M.diaryReport, "GET", "/x?classId=A1&lessonDate=2026-11-05&referenceMonth=2026-11&diaryId=diario-desv", t), "PDF do diário");
  assert.equal(JSON.stringify(state.tables.class_diary_entries), before, "lançamentos não podem mudar");
});

test("diário do professor ativo: editar e excluir pelas rotas dedicadas continuam funcionando", async () => {
  const t = S.tok.profAtivo;
  const up = await call(M.diaryUpdate, "PUT", "/x", t, { body: { entryId: "ent-ativo", content_taught: "Conteúdo revisado" } });
  assert.equal(up.status, 200, up.text);
  assert.equal(state.tables.class_diary_entries.find((e) => e.id === "ent-ativo").content_taught, "Conteúdo revisado");
  const del = await call(M.diaryDelete, "DELETE", "/x?entryId=ent-ativo", t);
  assert.equal(del.status, 200, del.text);
  assert.ok(!state.tables.class_diary_entries.some((e) => e.id === "ent-ativo"));
  // Lançamento de outro professor: não encontrado (não revela existência).
  assert.equal((await call(M.diaryDelete, "DELETE", "/x?entryId=ent-desv", t)).status, 404);
});

test("sessão de chamada (legado) de professor desvinculado: não lista nem marca presença", async () => {
  const t = S.tok.profDesv;
  assertDenied(await call(M.attList, "GET", "/x?sessionId=sess-desv", t), "attendance/list");
  assertDenied(await call(M.attMark, "POST", "/x", t, { body: { sessionId: "sess-desv", studentId: "aluno-A1", present: true } }), "attendance/mark");
  assert.equal(state.tables.attendance_marks.length, 0);
});

// ---------------------------------------------------------------------------
// Listas do professor e rotas fora de /api/teacher
// ---------------------------------------------------------------------------
test("listas de turmas mostram só vínculos ativos da escola da sessão", async () => {
  const ids = async (mod, tok) => ((await call(mod, "GET", "/x", tok)).json?.classes || []).map((c) => c.classId || c.class_id || c.id);
  assert.deepEqual(await ids(M.classesList, S.tok.profAtivo), ["A1"]);
  assert.deepEqual(await ids(M.classesList, S.tok.profDesv), []);
  assert.deepEqual(await ids(M.schoolTeacherClasses, S.tok.profAtivo), ["A1"]);
  assert.deepEqual(await ids(M.schoolTeacherClasses, S.tok.profDesv), []);
  assert.deepEqual(await ids(M.classesList, S.tok.profB), ["B1"], "vínculo inconsistente (Beta→A1) não aparece");
  const cal = async (tok) => ((await call(M.calendar, "GET", "/x?startDate=2026-11-02&days=7", tok)).json?.classes || []).map((c) => c.id);
  assert.deepEqual(await cal(S.tok.profAtivo), ["A1"]);
  assert.deepEqual(await cal(S.tok.profDesv), []);
  assert.deepEqual(await cal(S.tok.profB), ["B1"]);
});

test("gestão continua acessando a chamada de qualquer turma da própria escola", async () => {
  assert.equal((await call(M.genRoster, "GET", `/x?classId=A1&date=${D}`, S.tok.dirA)).status, 200);
  assert.equal((await call(M.genRoster, "GET", `/x?classId=A2&date=${D}`, S.tok.dirA)).status, 200);
  const save = await call(M.genSave, "POST", "/x", S.tok.dirA, { body: { classId: "A2", date: D, items: [{ studentId: "aluno-A2", status: "present" }] } });
  assert.equal(save.status, 200, save.text);
  assert.equal((await call(M.attReportMonth, "GET", "/x?classId=A2&month=2026-11", S.tok.dirA)).status, 200);
});

test("ferramenta de matrícula (dev/enroll) não lista alunos/turmas da escola inteira para professor", async () => {
  assert.equal((await call(M.devStudents, "GET", "/x", S.tok.profAtivo)).status, 403);
  assert.equal((await call(M.devClasses, "GET", "/x", S.tok.profAtivo)).status, 403);
  const dir = await call(M.devStudents, "GET", "/x", S.tok.dirA);
  assert.equal(dir.status, 200);
  assert.ok(dir.text.includes(NOMES.A1) && !dir.text.includes(NOMES.B1));
});

test("sem token: 401 em todas as operações, sem dados", async () => {
  for (const [name, fn] of Object.entries(CLASS_ROUTES)) {
    seed();
    const r = await fn("A1", null);
    assert.equal(r.status, 401, name);
    assert.ok(!r.text.includes(NOMES.A1), name);
  }
});

test("requisições simultâneas de professores ativos e desvinculados não se misturam", async () => {
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(CLASS_ROUTES["alunos: class-students"]("A1", S.tok.profAtivo).then((r) => ["ativo", r]));
    jobs.push(CLASS_ROUTES["alunos: class-students"]("A1", S.tok.profDesv).then((r) => ["desv", r]));
    jobs.push(CLASS_ROUTES["alunos: class-students"]("B1", S.tok.profB).then((r) => ["beta", r]));
    jobs.push(CLASS_ROUTES["alunos: class-students"]("A1", S.tok.profB).then((r) => ["beta-em-A1", r]));
  }
  for (const [who, r] of await Promise.all(jobs)) {
    if (who === "ativo" || who === "beta") assert.equal(r.status, 200, who);
    else assertDenied(r, who);
  }
});

// ---------------------------------------------------------------------------
// Regra central (unidade)
// ---------------------------------------------------------------------------
test("regra central: parâmetros ausentes, escola divergente e turma de outra escola negam", async () => {
  const { checkTeacherClassAccess } = access;
  const t = S.ids.profAtivo;
  assert.deepEqual(await checkTeacherClassAccess({ schoolId: "alfa", teacherUserId: t, classId: "A1" }), { ok: true });
  for (const p of [
    { schoolId: "", teacherUserId: t, classId: "A1" },
    { schoolId: "alfa", teacherUserId: "", classId: "A1" },
    { schoolId: "alfa", teacherUserId: t, classId: "" },
    { schoolId: "alfa", teacherUserId: t, classId: "  " },
    { schoolId: "beta", teacherUserId: t, classId: "A1" },
    { schoolId: "alfa", teacherUserId: t, classId: "A2" },
    { schoolId: "beta", teacherUserId: S.ids.profB, classId: "A1" }, // vínculo forjado
  ]) {
    assert.deepEqual(await checkTeacherClassAccess(p), { ok: false, status: 403, error: DENIED }, JSON.stringify(p));
  }
  state.tables.classes = state.tables.classes.filter((c) => c.id !== "A1"); // turma removida
  assert.equal((await checkTeacherClassAccess({ schoolId: "alfa", teacherUserId: t, classId: "A1" })).ok, false);
});

test("regra central: falha de banco devolve 500 genérico, sem detalhes internos", async () => {
  const saved = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    const q = saved(table);
    if (table === "teacher_classes") q.then = (res) => res({ data: null, error: { message: "relation secreta xyz" } });
    return q;
  };
  try {
    const r = await CLASS_ROUTES["alunos: class-students"]("A1", S.tok.profAtivo);
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secreta") && !r.text.includes(NOMES.A1));
  } finally {
    supabaseAdmin.from = saved;
  }
});

test("estático: nenhuma rota consulta teacher_classes por conta própria; todas usam a regra central", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const teacherRoutes = walk(path.join(ROOT, "src/app/api/teacher")).filter((f) => f.endsWith("route.ts"));
  for (const f of teacherRoutes) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    assert.ok(!src.includes('from("teacher_classes")'), `${rel} consulta teacher_classes diretamente`);
    if (/classId|sessionId|entryId/.test(src)) assert.ok(src.includes("@/lib/teacherClassAccess"), `${rel} não usa a regra central`);
  }
  for (const rel of ["src/app/api/attendance/roster/route.ts", "src/app/api/attendance/save/route.ts", "src/app/api/school/teachers/classes/list/route.ts"]) {
    assert.ok(fs.readFileSync(path.join(ROOT, rel), "utf8").includes("@/lib/teacherClassAccess"), rel);
  }
});
