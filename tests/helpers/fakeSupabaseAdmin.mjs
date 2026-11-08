// Dublê de "@/lib/supabaseAdmin" para testes: banco e Auth em memória.
import { randomUUID } from "node:crypto";
import { state, publicUser, issueToken } from "./fakeState.mjs";

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.op = "select";
    this.payload = null;
    this.sort = null;
    this.max = null;
  }
  select() {
    if (this.op === "update") this.returning = true;
    return this;
  }
  eq(col, val) {
    this.filters.push((r) => String(r[col]) === String(val));
    return this;
  }
  neq(col, val) {
    this.filters.push((r) => String(r[col]) !== String(val));
    return this;
  }
  is(col, val) {
    this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
    return this;
  }
  gte(col, val) {
    this.filters.push((r) => String(r[col]) >= String(val));
    return this;
  }
  lte(col, val) {
    this.filters.push((r) => String(r[col]) <= String(val));
    return this;
  }
  in(col, vals) {
    this.filters.push((r) => vals.map(String).includes(String(r[col])));
    return this;
  }
  order(col, opts = {}) {
    this.sort = { col, asc: opts.ascending !== false };
    return this;
  }
  limit(n) {
    this.max = n;
    return this;
  }
  insert(payload) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  maybeSingle() {
    return this.exec("maybe");
  }
  single() {
    return this.exec("single");
  }
  then(resolve, reject) {
    return this.exec("many").then(resolve, reject);
  }
  async exec(mode) {
    const rows = (state.tables[this.table] ||= []);
    if (this.op === "insert") {
      const items = [].concat(this.payload).map((p) => ({ id: p.id ?? randomUUID(), created_at: new Date().toISOString(), ...p }));
      rows.push(...items);
      return { data: mode === "many" ? items : items[0], error: null };
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      matched.forEach((r) => Object.assign(r, this.payload));
      if (!this.returning) return { data: null, error: null };
      if (mode === "maybe") return { data: matched[0] ?? null, error: null };
      if (mode === "single") return matched[0] ? { data: matched[0], error: null } : { data: null, error: { message: "no rows" } };
      return { data: matched, error: null };
    }
    if (this.sort) {
      const { col, asc } = this.sort;
      matched = [...matched].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.max != null) matched = matched.slice(0, this.max);
    if (mode === "maybe") return { data: matched[0] ?? null, error: null };
    if (mode === "single") return matched[0] ? { data: matched[0], error: null } : { data: null, error: { message: "no rows" } };
    return { data: matched, error: null };
  }
}

function findByEmail(email) {
  return [...state.users.values()].find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}

export const supabaseAdmin = {
  from: (table) => new Query(table),
  storage: {
    from: (bucket) => ({
      async createSignedUrl(path, expiresIn, opts) {
        state.signedUrls.push({ bucket, path, expiresIn, download: opts?.download ?? null });
        const dl = opts?.download ? `&download=${encodeURIComponent(opts.download)}` : "";
        return { data: { signedUrl: `https://ficticio.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=temporario${dl}` }, error: null };
      },
      async download() {
        return { data: null, error: { message: "sem arquivos nos testes" } };
      },
    }),
  },
  rpc: async () => ({ data: null, error: { message: "rpc não usada nestes testes" } }),
  auth: {
    async getUser(token) {
      const t = state.tokens.get(token);
      const u = t && state.users.get(t.userId);
      return u ? { data: { user: publicUser(u) }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
    },
    admin: {
      async getUserById(id) {
        const u = state.users.get(id);
        return u ? { data: { user: publicUser(u) }, error: null } : { data: { user: null }, error: { message: "not found" } };
      },
      async updateUserById(id, attrs) {
        const u = state.users.get(id);
        if (!u) return { data: { user: null }, error: { message: "not found" } };
        if (attrs.password !== undefined) {
          if (String(attrs.password).length < 6) return { data: { user: null }, error: { message: "Password should be at least 6 characters" } };
          u.password = attrs.password;
        }
        if (attrs.app_metadata) u.app_metadata = { ...u.app_metadata, ...attrs.app_metadata }; // GoTrue mescla
        if (attrs.user_metadata) u.user_metadata = { ...u.user_metadata, ...attrs.user_metadata };
        return { data: { user: publicUser(u) }, error: null };
      },
      async createUser({ email, password, app_metadata = {}, user_metadata = {} }) {
        if (findByEmail(email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
        const id = randomUUID();
        state.users.set(id, { id, email, password, app_metadata: { ...app_metadata }, user_metadata: { ...user_metadata } });
        return { data: { user: publicUser(state.users.get(id)) }, error: null };
      },
      async inviteUserByEmail(email, opts = {}) {
        if (findByEmail(email)) return { data: { user: null }, error: { message: "already registered" } };
        const id = randomUUID();
        state.users.set(id, { id, email, password: null, app_metadata: {}, user_metadata: { ...(opts.data || {}) } });
        state.invites.push(email);
        return { data: { user: publicUser(state.users.get(id)) }, error: null };
      },
      async listUsers({ page = 1, perPage = 50 } = {}) {
        const all = [...state.users.values()].map(publicUser);
        return { data: { users: all.slice((page - 1) * perPage, page * perPage) }, error: null };
      },
      async signOut(token, scope) {
        state.signOuts.push({ token, scope });
        if (scope === "local") state.tokens.delete(token);
        return { error: null };
      },
    },
  },
};

// Usado pelo dublê de supabase-js (login com senha).
export function signInWithPassword(email, password) {
  const u = findByEmail(email);
  if (!u || u.password !== password) return { data: { session: null }, error: { message: "Invalid login credentials" } };
  return { data: { session: { access_token: issueToken(u.id) } }, error: null };
}
