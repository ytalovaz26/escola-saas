// Acessos e senhas: regras puras, rotas reais com Supabase em memória e garantias do código.
// Executar com: node --test tests/access-passwords.test.mjs — sem banco, sem rede, dados fictícios.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./helpers/loader.mjs", import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ficticio.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-ficticia";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-secreta-ficticia";

const { state, reset, addUser, issueToken } = await import("./helpers/fakeState.mjs");
const policy = await import("../src/lib/auth/passwordPolicy.ts");
const roles = await import("../src/lib/auth/schoolRoles.ts");
const first = await import("../src/lib/auth/firstAccess.ts");
const me = await import("../src/app/api/me/route.ts");
const changePassword = await import("../src/app/api/account/change-password/route.ts");
const staffCreate = await import("../src/app/api/school/staff/create/route.ts");
const teachersCreate = await import("../src/app/api/school/teachers/create/route.ts");
const teachersDeactivate = await import("../src/app/api/school/teachers/deactivate/route.ts");
const createParent = await import("../src/app/api/admin/create-parent/route.ts");
const { requireStaff } = await import("../src/lib/requireStaff.ts");
const { requireTeacher } = await import("../src/lib/requireTeacher.ts");
const { requireParent } = await import("../src/lib/requireParent.ts");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(REPO, rel), "utf8");
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Cenário fictício: duas escolas, todos os perfis, Admin Master.
// ---------------------------------------------------------------------------
let S; // ids e tokens
function seed() {
  reset();
  const A = "escola-a";
  const B = "escola-b";
  state.tables.schools.push({ id: A, name: "Escola Fictícia A" }, { id: B, name: "Escola Fictícia B" });
  const mk = (email, extra) => addUser({ email, password: "SenhaAtual1", ...extra });
  const ids = {
    diretorA: mk("diretor.a@ficticio.test"),
    coordA: mk("coord.a@ficticio.test"),
    secA: mk("sec.a@ficticio.test"),
    profA: mk("prof.a@ficticio.test"),
    paiA: mk("pai.a@ficticio.test"),
    paiNovoA: mk("pai.novo.a@ficticio.test"),
    diretorB: mk("diretor.b@ficticio.test"),
    paiB: mk("pai.b@ficticio.test"),
    admin: mk("admin.master@ficticio.test"),
    orfao: mk("orfao@ficticio.test"),
  };
  const link = (user, school, role) =>
    state.tables.school_users.push({ id: `su-${user}`, user_id: user, school_id: school, role, is_active: true, created_at: "2026-01-01" });
  link(ids.diretorA, A, "diretor");
  link(ids.coordA, A, "coordenador");
  link(ids.secA, A, "secretaria");
  link(ids.profA, A, "professor");
  link(ids.diretorB, B, "diretor");
  state.tables.parents.push(
    { id: "p-a", user_id: ids.paiA, school_id: A, first_login_completed: true },
    { id: "p-novo-a", user_id: ids.paiNovoA, school_id: A, first_login_completed: false },
    { id: "p-b", user_id: ids.paiB, school_id: B, first_login_completed: true }
  );
  state.tables.platform_admins.push({ user_id: ids.admin });
  const tok = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, issueToken(v)]));
  S = { A, B, ids, tok };
}
beforeEach(seed);

function req(url, token, body, method = body === undefined ? "GET" : "POST") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(handler, ...args) {
  const res = await handler(req(...args));
  return { status: res.status, json: await res.json() };
}
const user = (id) => state.users.get(id);
const userByEmail = (email) => [...state.users.values()].find((u) => u.email === email);

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------
test("política de senha: tamanho, letra, número, confirmação, diferente da atual, sem cortar espaços", () => {
  const v = (n, c = n, cur) => policy.validateNewPassword({ newPassword: n, confirmPassword: c, currentPassword: cur });
  assert.equal(v("Escola2026"), null);
  assert.match(v("Ab1"), /pelo menos 8/);
  assert.match(v("somenteletras"), /número/);
  assert.match(v("12345678"), /letra/);
  assert.match(v("Escola2026", "Escola2027"), /confirmação/);
  assert.match(v("Escola2026", "Escola2026", "Escola2026"), /diferente/);
  assert.match(v(" Escola2026"), /espaço/);
  assert.match(v("a1".repeat(40)), /no máximo 72/);
  assert.equal(v("Mãe çedilha 9"), null, "acentos contam como letra e espaço interno é permitido");
  assert.equal(policy.validateTemporaryPassword(""), null, "vazio = convite");
  assert.match(policy.validateTemporaryPassword("abc"), /senha temporária/);
});

test("papéis: nomes reais (pt) e equivalentes em inglês; gestão = diretor, coordenação, secretaria, admin", () => {
  for (const r of ["diretor", "Director", " coordenador ", "coordinator", "secretaria", "secretary", "admin"]) {
    assert.equal(roles.isSchoolManagementRole(r), true, r);
  }
  for (const r of ["professor", "teacher", "responsavel", "", null, "platform_admin"]) {
    assert.equal(roles.isSchoolManagementRole(r), false, String(r));
  }
});

test("hierarquia: só o diretor atribui 'diretor'; coordenação/secretaria atribuem os demais; professor nada", () => {
  assert.equal(roles.canAssignRole("diretor", "diretor"), true);
  assert.equal(roles.canAssignRole("coordenador", "diretor"), false);
  assert.equal(roles.canAssignRole("secretaria", "diretor"), false);
  for (const t of ["coordenador", "secretaria", "professor"]) {
    assert.equal(roles.canAssignRole("coordenador", t), true);
    assert.equal(roles.canAssignRole("secretaria", t), true);
    assert.equal(roles.canAssignRole("professor", t), false);
  }
  assert.equal(roles.canAssignRole("diretor", "admin"), false, "ninguém atribui papel fora da lista");
  assert.equal(roles.canAssignRole("diretor", "platform_admin"), false);
  const m = (req, cur, next, self = false) =>
    roles.canManageExistingMember({ requesterRole: req, requesterUserId: "u1", targetUserId: self ? "u1" : "u2", currentTargetRole: cur, newTargetRole: next });
  assert.equal(m("coordenador", "diretor", "professor"), false, "coordenação não rebaixa diretor");
  assert.equal(m("secretaria", "professor", "coordenador"), true);
  assert.equal(m("diretor", "professor", "coordenador", true), false, "ninguém altera o próprio vínculo");
});

test("conta existente: só reaproveita conta desta escola (ou sem vínculo); outra escola/Admin Master = conflito", () => {
  const d = (links, kind = "staff") => roles.decideExistingAccount({ isPlatformAdmin: false, staffSchoolIds: [], parentSchoolIds: [], ...links }, "A", kind);
  assert.equal(d({}), "allow", "conta sem vínculo");
  assert.equal(d({ staffSchoolIds: ["A"] }), "allow");
  assert.equal(d({ staffSchoolIds: ["B"] }), "conflict");
  assert.equal(d({ staffSchoolIds: ["A", "B"] }), "conflict");
  assert.equal(d({ parentSchoolIds: ["B"] }), "conflict");
  assert.equal(d({ isPlatformAdmin: true }), "conflict");
  assert.equal(d({ parentSchoolIds: ["A"] }), "conflict", "responsável não vira equipe por esta via");
  assert.equal(d({ parentSchoolIds: ["A"] }, "parent"), "allow");
  assert.equal(d({ staffSchoolIds: ["A"] }, "parent"), "conflict", "equipe não vira responsável por esta via");
});

test("primeiro acesso e sessão de recuperação (claim amr)", () => {
  assert.equal(first.mustChangePassword({ app_metadata: { must_change_password: true } }), true);
  assert.equal(first.mustChangePassword({ app_metadata: { must_change_password: "true" } }), false);
  assert.equal(first.mustChangePassword({ app_metadata: {} }), false, "usuários antigos não são afetados");
  assert.deepEqual(first.withMustChangePassword({ provider: "email" }, true), { provider: "email", must_change_password: true });
  const payload = (method, ts) => ({ amr: [{ method, timestamp: ts }] });
  assert.equal(first.isRecentEmailProofSession(payload("recovery", now() - 60), now()), true);
  assert.equal(first.isRecentEmailProofSession(payload("invite", now() - 60), now()), true);
  assert.equal(first.isRecentEmailProofSession(payload("recovery", now() - 7200), now()), false, "link antigo");
  assert.equal(first.isRecentEmailProofSession(payload("password", now()), now()), false);
  assert.equal(first.isRecentEmailProofSession(null, now()), false);
  const tok = issueToken("x", [{ method: "recovery", timestamp: 123 }]);
  assert.deepEqual(first.decodeJwtPayload(tok).amr, [{ method: "recovery", timestamp: 123 }]);
  assert.equal(first.decodeJwtPayload("lixo"), null);
  assert.equal(first.currentPasswordRequired({ mustChange: false, emailProof: false }), true);
  assert.equal(first.currentPasswordRequired({ mustChange: true, emailProof: false }), false);
  assert.equal(first.currentPasswordRequired({ mustChange: false, emailProof: true }), false);
});

// ---------------------------------------------------------------------------
// Login: identificação do perfil e redirecionamento (/api/me)
// ---------------------------------------------------------------------------
test("login de cada perfil leva ao painel correto", async () => {
  const dest = async (k) => (await call(me.GET, "/api/me", S.tok[k])).json.redirectTo;
  assert.equal(await dest("diretorA"), "/school");
  assert.equal(await dest("coordA"), "/school", "coordenação usa o painel do diretor");
  assert.equal(await dest("secA"), "/school", "secretaria usa o painel do diretor");
  assert.equal(await dest("profA"), "/teacher");
  assert.equal(await dest("paiA"), "/parent");
  assert.equal(await dest("paiNovoA"), "/parent/complete-profile");
  assert.equal(await dest("admin"), "/admin-master");
  assert.equal((await call(me.GET, "/api/me", "token-invalido")).status, 401);
  assert.equal((await call(me.GET, "/api/me", null)).status, 401);
});

test("primeiro acesso: /api/me manda para a definição de senha e os helpers bloqueiam as APIs", async () => {
  user(S.ids.profA).app_metadata.must_change_password = true;
  user(S.ids.secA).app_metadata.must_change_password = true;
  user(S.ids.paiA).app_metadata.must_change_password = true;
  const r = await call(me.GET, "/api/me", S.tok.profA);
  assert.equal(r.json.redirectTo, first.FIRST_ACCESS_PATH);
  assert.equal(r.json.mustChangePassword, true);
  const blocked = async (p) => {
    const g = await p;
    assert.equal(g.ok, false);
    assert.equal(g.res.status, 403);
    assert.equal((await g.res.json()).code, "PASSWORD_CHANGE_REQUIRED");
  };
  await blocked(requireTeacher(req("/x", S.tok.profA)));
  await blocked(requireStaff(req("/x", S.tok.secA), ["secretaria"]));
  await blocked(requireParent(req("/x", S.tok.paiA)));
  const ok = await requireStaff(req("/x", S.tok.diretorA), ["diretor"]);
  assert.equal(ok.ok, true, "usuário antigo sem marca segue normal");
});

// ---------------------------------------------------------------------------
// Alteração de senha
// ---------------------------------------------------------------------------
const CP = "/api/account/change-password";

test("alteração de senha exige a senha atual correta e altera só a própria conta", async () => {
  let r = await call(changePassword.POST, CP, S.tok.coordA, { newPassword: "NovaSenha9", confirmPassword: "NovaSenha9" });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "CURRENT_PASSWORD_REQUIRED");

  r = await call(changePassword.POST, CP, S.tok.coordA, { currentPassword: "errada123", newPassword: "NovaSenha9", confirmPassword: "NovaSenha9" });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "CURRENT_PASSWORD_INVALID");
  assert.equal(user(S.ids.coordA).password, "SenhaAtual1", "senha errada não altera nada");

  // Tentativa de apontar outra conta no corpo é ignorada: o alvo vem só do token.
  r = await call(changePassword.POST, CP, S.tok.coordA, {
    userId: S.ids.diretorA,
    user_id: S.ids.diretorA,
    email: "diretor.a@ficticio.test",
    currentPassword: "SenhaAtual1",
    newPassword: "NovaSenha9",
    confirmPassword: "NovaSenha9",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(user(S.ids.coordA).password, "NovaSenha9");
  assert.equal(user(S.ids.diretorA).password, "SenhaAtual1", "senha de terceiros intacta");
  assert.ok(state.signOuts.some((s) => s.scope === "others"), "outras sessões encerradas");
  assert.ok(state.signOuts.some((s) => s.scope === "local"), "sessão temporária da verificação encerrada");
});

test("alteração de senha: validações e sessão obrigatória", async () => {
  assert.equal((await call(changePassword.POST, CP, null, { newPassword: "NovaSenha9", confirmPassword: "NovaSenha9" })).status, 401);
  assert.equal((await call(changePassword.POST, CP, "token-falso", { newPassword: "NovaSenha9", confirmPassword: "NovaSenha9" })).status, 401);
  const weak = await call(changePassword.POST, CP, S.tok.diretorA, { currentPassword: "SenhaAtual1", newPassword: "fraca", confirmPassword: "fraca" });
  assert.equal(weak.status, 400);
  const same = await call(changePassword.POST, CP, S.tok.diretorA, { currentPassword: "SenhaAtual1", newPassword: "SenhaAtual1", confirmPassword: "SenhaAtual1" });
  assert.match(same.json.error, /diferente/);
  const g = await call(changePassword.GET, CP, S.tok.diretorA);
  assert.equal(g.json.requiresCurrentPassword, true);
  assert.equal(g.json.mustChangePassword, false);
});

test("primeiro acesso: define a senha sem a atual e a marca é removida", async () => {
  user(S.ids.profA).app_metadata.must_change_password = true;
  const g = await call(changePassword.GET, CP, S.tok.profA);
  assert.equal(g.json.requiresCurrentPassword, false);
  const r = await call(changePassword.POST, CP, S.tok.profA, { newPassword: "MinhaSenha7", confirmPassword: "MinhaSenha7" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(user(S.ids.profA).password, "MinhaSenha7");
  assert.equal(user(S.ids.profA).app_metadata.must_change_password, false);
  assert.equal((await call(me.GET, "/api/me", S.tok.profA)).json.redirectTo, "/teacher");
});

test("recuperação de senha: sessão recente do link dispensa a senha atual; sessão antiga não", async () => {
  const recent = issueToken(S.ids.paiA, [{ method: "recovery", timestamp: now() - 30 }]);
  let r = await call(changePassword.POST, CP, recent, { newPassword: "Recuperada5", confirmPassword: "Recuperada5" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(user(S.ids.paiA).password, "Recuperada5");

  const old = issueToken(S.ids.paiB, [{ method: "recovery", timestamp: now() - 7200 }]);
  r = await call(changePassword.POST, CP, old, { newPassword: "Recuperada5", confirmPassword: "Recuperada5" });
  assert.equal(r.json.code, "CURRENT_PASSWORD_REQUIRED");
  assert.equal(user(S.ids.paiB).password, "SenhaAtual1");
});

// ---------------------------------------------------------------------------
// Cadastro de equipe pela gestão
// ---------------------------------------------------------------------------
const SC = "/api/school/staff/create";

test("secretaria e coordenação cadastram equipe; conta nova nasce marcada para o primeiro acesso", async () => {
  const r = await call(staffCreate.POST, SC, S.tok.secA, {
    email: "Nova.Prof@ficticio.test",
    full_name: "Professora Nova",
    role: "professor",
    temp_password: "Temporaria1",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const u = userByEmail("nova.prof@ficticio.test");
  assert.equal(u.app_metadata.must_change_password, true);
  assert.ok(state.tables.school_users.some((l) => l.user_id === u.id && l.school_id === S.A && l.role === "professor"));
  assert.ok(!JSON.stringify(state.tables).includes("Temporaria1"), "senha temporária não é gravada em tabela");

  const inv = await call(staffCreate.POST, SC, S.tok.coordA, { email: "convite@ficticio.test", full_name: "Convidada", role: "secretaria" });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.equal(userByEmail("convite@ficticio.test").app_metadata.must_change_password, true, "convite também exige definir senha");
});

test("elevação de privilégio: coordenação/secretaria não criam diretor; professor não cria ninguém", async () => {
  for (const k of ["coordA", "secA"]) {
    const r = await call(staffCreate.POST, SC, S.tok[k], { email: `novo.dir.${k}@ficticio.test`, full_name: "X", role: "diretor", temp_password: "Temporaria1" });
    assert.equal(r.status, 403, k);
  }
  assert.equal((await call(staffCreate.POST, SC, S.tok.profA, { email: "x@ficticio.test", full_name: "X", role: "professor" })).status, 403);
  assert.equal((await call(staffCreate.POST, SC, S.tok.paiA, { email: "x@ficticio.test", full_name: "X", role: "professor" })).status, 403);
  const r = await call(staffCreate.POST, SC, S.tok.diretorA, { email: "x@ficticio.test", full_name: "X", role: "platform_admin" });
  assert.equal(r.status, 400, "papel fora da lista");
  assert.equal(state.tables.platform_admins.length, 1, "ninguém vira Admin Master");
  assert.equal(userByEmail("novo.dir.coordA@ficticio.test"), undefined);
});

test("tomada de conta impedida: e-mail de outra escola, de responsável ou do Admin Master não é alterado", async () => {
  for (const email of ["diretor.b@ficticio.test", "pai.b@ficticio.test", "admin.master@ficticio.test", "pai.a@ficticio.test"]) {
    const r = await call(staffCreate.POST, SC, S.tok.diretorA, { email, full_name: "Invasor", role: "professor", temp_password: "Invasao123" });
    assert.equal(r.status, 409, email);
    assert.equal(userByEmail(email).password, "SenhaAtual1", `senha de ${email} intacta`);
    assert.equal(userByEmail(email).app_metadata.must_change_password, undefined);
  }
  assert.ok(!state.tables.school_users.some((l) => l.user_id === S.ids.diretorB && l.school_id === S.A), "diretor B não foi vinculado à escola A");
  const t = await call(teachersCreate.POST, "/api/school/teachers/create", S.tok.secA, { email: "diretor.b@ficticio.test", full_name: "X", temp_password: "Invasao123" });
  assert.equal(t.status, 409);
  assert.equal(user(S.ids.diretorB).password, "SenhaAtual1");
});

test("membro da própria escola: nova senha temporária respeita a hierarquia", async () => {
  const ok = await call(staffCreate.POST, SC, S.tok.diretorA, { email: "prof.a@ficticio.test", full_name: "Prof A", role: "professor", temp_password: "Redefinida1" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(user(S.ids.profA).password, "Redefinida1");
  assert.equal(user(S.ids.profA).app_metadata.must_change_password, true);

  const no = await call(staffCreate.POST, SC, S.tok.coordA, { email: "diretor.a@ficticio.test", full_name: "Dir A", role: "professor", temp_password: "Rebaixado1" });
  assert.equal(no.status, 403, "coordenação não rebaixa nem redefine o diretor");
  assert.equal(user(S.ids.diretorA).password, "SenhaAtual1");

  const self = await call(staffCreate.POST, SC, S.tok.secA, { email: "sec.a@ficticio.test", full_name: "Sec", role: "coordenador" });
  assert.equal(self.status, 400, "não altera o próprio acesso");

  const orphan = await call(staffCreate.POST, SC, S.tok.diretorA, { email: "orfao@ficticio.test", full_name: "Órfão", role: "secretaria", temp_password: "Temporaria1" });
  assert.equal(orphan.status, 200, "conta sem vínculo pode ser reaproveitada");
});

test("senha temporária fraca é recusada antes de criar a conta", async () => {
  const r = await call(staffCreate.POST, SC, S.tok.diretorA, { email: "fraca@ficticio.test", full_name: "X", role: "professor", temp_password: "123456" });
  assert.equal(r.status, 400);
  assert.equal(userByEmail("fraca@ficticio.test"), undefined);
});

// ---------------------------------------------------------------------------
// Cadastro de responsável e isolamento entre escolas
// ---------------------------------------------------------------------------
const CPAR = "/api/admin/create-parent";

test("responsável: gestão da própria escola cadastra; professor e outra escola não", async () => {
  const ok = await call(createParent.POST, CPAR, S.tok.secA, { schoolId: S.A, fullName: "Mãe Nova", email: "mae.nova@ficticio.test", passwordTemp: "Temporaria1" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const u = userByEmail("mae.nova@ficticio.test");
  assert.equal(u.app_metadata.must_change_password, true);
  assert.ok(state.tables.parents.some((p) => p.user_id === u.id && p.school_id === S.A));

  assert.equal((await call(createParent.POST, CPAR, S.tok.profA, { schoolId: S.A, fullName: "X", email: "x1@ficticio.test", passwordTemp: "Temporaria1" })).status, 403);
  assert.equal((await call(createParent.POST, CPAR, S.tok.diretorB, { schoolId: S.A, fullName: "X", email: "x2@ficticio.test", passwordTemp: "Temporaria1" })).status, 403, "diretor B não cadastra na escola A");
  assert.equal(userByEmail("x2@ficticio.test"), undefined);
});

test("responsável: e-mail de outra escola ou de equipe é recusado sem alterar a senha", async () => {
  for (const email of ["pai.b@ficticio.test", "prof.a@ficticio.test", "diretor.b@ficticio.test", "admin.master@ficticio.test"]) {
    const r = await call(createParent.POST, CPAR, S.tok.diretorA, { schoolId: S.A, fullName: "X", email, passwordTemp: "Invasao123" });
    assert.equal(r.status, 409, email);
    assert.equal(userByEmail(email).password, "SenhaAtual1");
  }
  const same = await call(createParent.POST, CPAR, S.tok.coordA, { schoolId: S.A, fullName: "Pai A", email: "pai.a@ficticio.test", passwordTemp: "NovaTemp12" });
  assert.equal(same.status, 200, "responsável da própria escola pode receber nova senha temporária");
  assert.equal(user(S.ids.paiA).app_metadata.must_change_password, true);
});

test("isolamento: a secretaria da escola A não desativa professor da escola B", async () => {
  state.tables.school_users.push({ id: "su-prof-b", user_id: "prof-b", school_id: S.B, role: "professor", is_active: true, created_at: "2026-01-01" });
  const r = await call(teachersDeactivate.POST, "/api/school/teachers/deactivate", S.tok.secA, { user_id: "prof-b" });
  assert.equal(r.status, 200);
  assert.equal(state.tables.school_users.find((l) => l.id === "su-prof-b").is_active, true, "vínculo da escola B intacto");
  const own = await call(teachersDeactivate.POST, "/api/school/teachers/deactivate", S.tok.secA, { user_id: S.ids.profA });
  assert.equal(own.status, 200);
  assert.equal(state.tables.school_users.find((l) => l.user_id === S.ids.profA).is_active, false);
  assert.equal((await call(teachersDeactivate.POST, "/api/school/teachers/deactivate", S.tok.profA, { user_id: S.ids.profA })).status, 403);
});

test("requireStaff devolve sempre a escola do próprio vínculo (base do isolamento por school_id)", async () => {
  const a = await requireStaff(req("/x", S.tok.secA), roles.SCHOOL_MANAGEMENT_ROLES.slice());
  assert.equal(a.ok && a.schoolId, S.A);
  const t = await requireStaff(req("/x", S.tok.profA), ["diretor", "coordenador", "secretaria"]);
  assert.equal(t.ok, false, "professor fora da gestão");
  const p = await requireStaff(req("/x", S.tok.paiA), ["diretor"]);
  assert.equal(p.ok, false, "responsável não é equipe");
});

// ---------------------------------------------------------------------------
// Garantias estáticas do código
// ---------------------------------------------------------------------------
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const apiRoutes = walk(path.join(REPO, "src", "app", "api")).filter((f) => f.endsWith("route.ts"));
const rel = (f) => path.relative(REPO, f).split(path.sep).join("/");

test("paridade no servidor: toda lista de papéis com coordenação inclui a secretaria (exceto financeiro e dev)", () => {
  const offenders = [];
  for (const f of apiRoutes) {
    const r = rel(f);
    if (/\/api\/(dev|school\/finance)\//.test(r)) continue;
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/requireStaff\(\s*req\s*,\s*(\[[^\]]*\]|[A-Z_]+)/g)) {
      let list = m[1];
      if (!list.startsWith("[")) list = (s.match(new RegExp(`const ${list}\\s*=\\s*(\\[[^\\]]*\\])`)) || [, ""])[1];
      if (/coordenador|coordinator/.test(list) && !/secretaria|secretary/.test(list)) offenders.push(r);
    }
  }
  assert.deepEqual(offenders, []);
});

test("financeiro não foi alterado por esta atualização", () => {
  const s = read("src/app/api/school/finance/route.ts");
  assert.doesNotMatch(s, /isSchoolManagementRole|lib\/auth\//);
  assert.match(read("src/app/school/layout.tsx"), /label: "Financeiro",[\s\S]{0,200}roles: \["diretor", "secretaria", "admin"\]/);
});

test("menu do painel: todos os itens de gestão para diretor, coordenação e secretaria", () => {
  const s = read("src/app/school/layout.tsx");
  const items = [...s.matchAll(/label: "([^"]+)",[\s\S]*?roles: ([^\n]+)/g)].map((m) => [m[1], m[2]]);
  assert.ok(items.length >= 15);
  for (const [label, rolesExpr] of items) {
    if (label === "Financeiro") continue;
    const ok =
      /MANAGEMENT_ROLES/.test(rolesExpr) ||
      ["diretor", "coordenador", "secretaria", "admin"].every((r) => rolesExpr.includes(`"${r}"`));
    assert.ok(ok, `${label}: ${rolesExpr}`);
  }
  assert.match(s, /MANAGEMENT_ROLES: RoleKey\[\] = \["diretor", "coordenador", "secretaria", "admin"\]/);
});

test("rotas que criam contas checam vínculos antes de mexer em conta existente e marcam o primeiro acesso", () => {
  for (const f of ["src/app/api/school/staff/create/route.ts", "src/app/api/school/teachers/create/route.ts", "src/app/api/admin/create-parent/route.ts"]) {
    const s = read(f);
    const decide = s.indexOf("decideExistingAccount(");
    const firstAccountUpdate = s.indexOf("updateUserById(");
    assert.ok(decide > 0 && firstAccountUpdate > 0 && decide < firstAccountUpdate, `${f}: decisão antes de alterar conta existente`);
    assert.match(s, /withMustChangePassword\([^)]*true\)/, f);
    assert.doesNotMatch(s, /\.(insert|update|upsert)\(\{[^}]*(temp_password|passwordTemp|tempPassword)/, `${f}: senha temporária não vai para tabela`);
  }
  assert.match(read("src/app/api/admin/create-director/route.ts"), /must_change_password: true/);
});

test("helpers de autorização, /api/me e layouts aplicam o primeiro acesso", () => {
  for (const f of ["src/lib/requireStaff.ts", "src/lib/requireTeacher.ts", "src/lib/requireParent.ts"]) {
    assert.match(read(f), /blockedByFirstAccess\(u\.user\)/, f);
  }
  assert.match(read("src/app/api/me/route.ts"), /redirectTo = FIRST_ACCESS_PATH/);
  for (const f of ["src/app/school/layout.tsx", "src/app/teacher/layout.tsx", "src/app/parent/_layout/ParentLayout.tsx"]) {
    const s = read(f);
    assert.match(s, /mustChangePassword\)?[\s\S]{0,80}router\.replace\(FIRST_ACCESS_PATH\)/, f);
    assert.match(s, /\/account\/change-password|CHANGE_PASSWORD_HREF/, `${f}: opção visível de alterar senha`);
  }
});

test("alteração de senha usa só o usuário do token e nunca grava pelo navegador a senha de terceiros", () => {
  const s = read("src/app/api/account/change-password/route.ts");
  assert.match(s, /updateUserById\(user\.id/);
  assert.doesNotMatch(s, /body\??\.(userId|user_id|email)/);
  const page = read("src/app/account/change-password/page.tsx");
  assert.doesNotMatch(page, /auth\.updateUser\(/, "tela de alteração passa pelo servidor");
});
