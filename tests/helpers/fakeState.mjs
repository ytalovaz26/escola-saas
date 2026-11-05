// Estado em memória compartilhado pelos dublês do Supabase (somente testes, dados fictícios).
import { randomUUID } from "node:crypto";

export const state = {
  tables: {},
  users: new Map(), // id -> { id, email, password, app_metadata, user_metadata }
  tokens: new Map(), // token -> { userId }
  signOuts: [],
  invites: [],
  signedUrls: [],
};

export function reset() {
  state.tables = {
    schools: [],
    school_users: [],
    parents: [],
    platform_admins: [],
    profiles: [],
    teacher_classes: [],
    students: [],
    student_parents: [],
    student_classes: [],
    classes: [],
    enrollment_documents: [],
  };
  state.users.clear();
  state.tokens.clear();
  state.signOuts = [];
  state.invites = [];
  state.signedUrls = [];
}
reset();

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

// Token no formato JWT (assinatura fictícia): o código só decodifica o payload DEPOIS de o
// dublê de auth.getUser aceitar o token, como acontece com o Supabase real.
export function issueToken(userId, amr = [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }]) {
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: userId, amr, session_id: randomUUID() })}.assinatura-ficticia`;
  state.tokens.set(token, { userId });
  return token;
}

export function addUser({ email, password = "SenhaInicial1", app_metadata = {}, user_metadata = {} }) {
  const id = randomUUID();
  state.users.set(id, { id, email, password, app_metadata: { ...app_metadata }, user_metadata: { ...user_metadata } });
  return id;
}

export function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return JSON.parse(JSON.stringify(rest));
}
