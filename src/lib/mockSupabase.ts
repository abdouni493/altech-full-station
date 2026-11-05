/**
 * ─── CLIENT DE DONNÉES LOCAL (MODE DÉMO, SANS BASE) ────────────────────────────
 * Remplace le client Supabase. Toutes les lectures et écritures se font dans une
 * base EN MÉMOIRE pré-remplie avec un jeu de données constant (`demoData.ts`),
 * pour tester toutes les interfaces sans aucune connexion réseau.
 *
 * L'API reproduit le sous-ensemble de supabase-js utilisé par l'application :
 *   • `from(table)` : select / insert / upsert / update / delete + filtres
 *     (eq, neq, gt, gte, lt, lte, in, is, like, ilike, contains, match, not, or,
 *     filter), order, limit, range, single, maybeSingle ;
 *   • `rpc(nom, params)` : les fonctions serveur appelées par l'application ;
 *   • `auth` : connexion par email / nom d'utilisateur, session, déconnexion ;
 *   • `storage` : les fichiers restent dans le navigateur (data-URL) ;
 *   • `channel` : le « temps réel » diffuse les écritures locales.
 *
 * Les modifications sont conservées dans le localStorage du navigateur ; le
 * bouton « Réinitialiser les données démo » de la page de connexion (ou
 * `resetDemoDatabase()`) remet le jeu constant d'origine.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { buildDemoTables, DEMO_ACCOUNTS, DemoAccount } from './demoData';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const DB_STORAGE_KEY = 'altech-demo-db-v2';
const USERS_STORAGE_KEY = 'altech-demo-users-v2';

const clone = <T,>(v: T): T => {
  if (v === undefined || v === null) return v;
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
};

const uuid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

// ─── Stockage ──────────────────────────────────────────────────────────────────

function loadTables(): Tables {
  try {
    const raw = globalThis.localStorage?.getItem(DB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Tables;
    }
  } catch { /* stockage indisponible : on repart du jeu constant */ }
  return buildDemoTables();
}

function loadUsers(): DemoAccount[] {
  try {
    const raw = globalThis.localStorage?.getItem(USERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as DemoAccount[];
    }
  } catch { /* idem */ }
  return clone(DEMO_ACCOUNTS);
}

let tables: Tables = loadTables();
let users: DemoAccount[] = loadUsers();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      globalThis.localStorage?.setItem(DB_STORAGE_KEY, JSON.stringify(tables));
      globalThis.localStorage?.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    } catch (e) {
      console.warn('[demo-db] sauvegarde locale impossible :', (e as Error)?.message);
    }
  }, 300);
}

/** Remet le jeu de données constant d'origine (et les comptes démo). */
export function resetDemoDatabase() {
  tables = buildDemoTables();
  users = clone(DEMO_ACCOUNTS);
  try {
    globalThis.localStorage?.removeItem(DB_STORAGE_KEY);
    globalThis.localStorage?.removeItem(USERS_STORAGE_KEY);
  } catch { /* rien */ }
}

const table = (name: string): Row[] => {
  if (!tables[name]) tables[name] = [];
  return tables[name];
};

// ─── Temps réel (local) ─────────────────────────────────────────────────────────

type Listener = { table?: string; event: string; cb: (payload: any) => void };
const channels = new Set<MockChannel>();

class MockChannel {
  listeners: Listener[] = [];
  constructor(public name: string) {}
  on(_type: string, filter: any, cb: (payload: any) => void) {
    this.listeners.push({ table: filter?.table, event: filter?.event || '*', cb });
    return this;
  }
  subscribe(cb?: (status: string) => void) {
    channels.add(this);
    if (cb) setTimeout(() => cb('SUBSCRIBED'), 0);
    return this;
  }
  unsubscribe() { channels.delete(this); return Promise.resolve('ok'); }
}

function emit(tableName: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE', newRow: Row | null, oldRow: Row | null) {
  const payload = { eventType, new: clone(newRow) ?? {}, old: clone(oldRow) ?? {}, table: tableName, schema: 'public' };
  setTimeout(() => {
    channels.forEach(ch => ch.listeners.forEach(l => {
      if (l.table && l.table !== tableName) return;
      if (l.event !== '*' && l.event !== eventType) return;
      try { l.cb(payload); } catch (e) { console.warn('[demo-db] listener', e); }
    }));
  }, 0);
}

// ─── Filtres ───────────────────────────────────────────────────────────────────

type Pred = (r: Row) => boolean;

const likeToRegex = (pattern: string, flags = '') =>
  new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', flags);

const eqLoose = (a: any, b: any) => {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
};
const cmp = (a: any, b: any) => {
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na - nb;
  return String(a).localeCompare(String(b));
};

function makePred(col: string, op: string, val: any): Pred {
  switch (op) {
    case 'eq': return r => eqLoose(r[col], val);
    case 'neq': return r => !eqLoose(r[col], val);
    case 'gt': return r => r[col] != null && cmp(r[col], val) > 0;
    case 'gte': return r => r[col] != null && cmp(r[col], val) >= 0;
    case 'lt': return r => r[col] != null && cmp(r[col], val) < 0;
    case 'lte': return r => r[col] != null && cmp(r[col], val) <= 0;
    case 'in': {
      const list: any[] = Array.isArray(val)
        ? val
        : String(val).replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      return r => list.some(v => eqLoose(r[col], v));
    }
    case 'is': {
      if (val === null || val === 'null') return r => r[col] === null || r[col] === undefined;
      if (val === true || val === 'true') return r => r[col] === true;
      if (val === false || val === 'false') return r => r[col] === false;
      return r => r[col] === val;
    }
    case 'like': return r => r[col] != null && likeToRegex(val).test(String(r[col]));
    case 'ilike': return r => r[col] != null && likeToRegex(val, 'i').test(String(r[col]));
    case 'contains': return r => {
      const v = r[col];
      if (Array.isArray(v)) return (Array.isArray(val) ? val : [val]).every(x => v.includes(x));
      if (v && typeof v === 'object' && val && typeof val === 'object') {
        return Object.entries(val).every(([k, x]) => eqLoose(v[k], x));
      }
      return false;
    };
    default: return () => true;
  }
}

/** Parse a PostgREST `or` string: "a.eq.1,b.is.null". */
function parseOr(expr: string): Pred {
  const parts = expr.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  const preds = parts.map(p => {
    const [col, op, ...rest] = p.split('.');
    let value: any = rest.join('.');
    if (op === 'not') {
      const [op2, ...rest2] = rest;
      const inner = makePred(col, op2, rest2.join('.'));
      return (r: Row) => !inner(r);
    }
    return makePred(col, op, value);
  });
  return r => preds.some(p => p(r));
}

// ─── Constructeur de requêtes ──────────────────────────────────────────────────

type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

const DEFAULT_TS_COLUMNS = ['created_at'];

class QueryBuilder implements PromiseLike<any> {
  private op: Op = 'select';
  private columns = '*';
  private payload: any = null;
  private onConflict = 'id';
  private ignoreDuplicates = false;
  private preds: Pred[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleMode: 'single' | 'maybe' | null = null;
  private returnRows = false;
  private countMode: string | null = null;
  private headOnly = false;

  constructor(private tableName: string) {}

  select(columns = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.columns = columns || '*';
    } else {
      this.returnRows = true;
      this.columns = columns || '*';
    }
    if (opts?.count) this.countMode = opts.count;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(rows: any, _opts?: any) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert'; this.payload = rows;
    if (opts?.onConflict) this.onConflict = opts.onConflict;
    if (opts?.ignoreDuplicates) this.ignoreDuplicates = true;
    return this;
  }
  update(patch: any) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(c: string, v: any) { this.preds.push(makePred(c, 'eq', v)); return this; }
  neq(c: string, v: any) { this.preds.push(makePred(c, 'neq', v)); return this; }
  gt(c: string, v: any) { this.preds.push(makePred(c, 'gt', v)); return this; }
  gte(c: string, v: any) { this.preds.push(makePred(c, 'gte', v)); return this; }
  lt(c: string, v: any) { this.preds.push(makePred(c, 'lt', v)); return this; }
  lte(c: string, v: any) { this.preds.push(makePred(c, 'lte', v)); return this; }
  in(c: string, v: any[]) { this.preds.push(makePred(c, 'in', v)); return this; }
  is(c: string, v: any) { this.preds.push(makePred(c, 'is', v)); return this; }
  like(c: string, v: string) { this.preds.push(makePred(c, 'like', v)); return this; }
  ilike(c: string, v: string) { this.preds.push(makePred(c, 'ilike', v)); return this; }
  contains(c: string, v: any) { this.preds.push(makePred(c, 'contains', v)); return this; }
  match(obj: Record<string, any>) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
  not(c: string, op: string, v: any) { const p = makePred(c, op, v); this.preds.push(r => !p(r)); return this; }
  or(expr: string) { this.preds.push(parseOr(expr)); return this; }
  filter(c: string, op: string, v: any) {
    if (op.startsWith('not.')) return this.not(c, op.slice(4), v);
    this.preds.push(makePred(c, op, v)); return this;
  }
  textSearch(c: string, q: string) { return this.ilike(c, `%${q}%`); }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  abortSignal(_s: any) { return this; }
  returns() { return this; }
  throwOnError() { return this; }

  private matches(r: Row) { return this.preds.every(p => p(r)); }

  private project(rows: Row[]): Row[] {
    const cols = (this.columns || '*').trim();
    if (cols === '*' || cols.includes('(') || cols.includes('*')) return rows.map(r => clone(r));
    const keys = cols.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [name, alias] = s.split(':').map(x => x.trim());
      return alias ? { from: alias, to: name } : { from: name, to: name };
    });
    return rows.map(r => {
      const out: Row = {};
      keys.forEach(k => { out[k.to] = clone(r[k.from]); });
      return out;
    });
  }

  private sortRows(rows: Row[]): Row[] {
    if (!this.orders.length) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.orders) {
        const av = a[o.col], bv = b[o.col];
        const an = av === null || av === undefined, bn = bv === null || bv === undefined;
        if (an && bn) continue;
        if (an || bn) {
          const nullsFirst = o.nullsFirst ?? !o.asc;
          return (an ? -1 : 1) * (nullsFirst ? 1 : -1);
        }
        const c = cmp(av, bv);
        if (c !== 0) return o.asc ? c : -c;
      }
      return 0;
    });
  }

  private finish(rows: Row[]) {
    let data: any = rows;
    let count: number | null = this.countMode ? rows.length : null;
    if (this.singleMode) {
      if (rows.length === 0) {
        if (this.singleMode === 'single') {
          return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: null, hint: null }, count, status: 406, statusText: 'Not Acceptable' };
        }
        data = null;
      } else {
        data = rows[0];
      }
    }
    if (this.headOnly) data = null;
    return { data, error: null, count, status: 200, statusText: 'OK' };
  }

  private run() {
    const t = table(this.tableName);
    const now = new Date().toISOString();

    if (this.op === 'select') {
      let rows = t.filter(r => this.matches(r));
      const total = rows.length;
      rows = this.sortRows(rows);
      if (this.rangeFrom !== null) rows = rows.slice(this.rangeFrom, (this.rangeTo ?? rows.length - 1) + 1);
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      const res = this.finish(this.project(rows));
      if (this.countMode) res.count = total;
      return res;
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const list: Row[] = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(Boolean);
      const keys = this.onConflict.split(',').map(s => s.trim()).filter(Boolean);
      const affected: Row[] = [];
      for (const input of list) {
        const row: Row = clone(input);
        const hasKeys = keys.every(k => row[k] !== undefined && row[k] !== null);
        const existingIdx = hasKeys ? t.findIndex(r => keys.every(k => eqLoose(r[k], row[k]))) : -1;
        if (existingIdx >= 0) {
          if (this.op === 'insert') {
            return { data: null, error: { message: `duplicate key value violates unique constraint "${this.tableName}_pkey"`, code: '23505', details: null, hint: null }, count: null, status: 409, statusText: 'Conflict' };
          }
          if (this.ignoreDuplicates) continue;
          const old = t[existingIdx];
          const merged: Row = { ...old, ...row, updated_at: now };
          if (this.tableName === 'biz_store') merged.rev = (Number(old.rev) || 0) + 1;
          t[existingIdx] = merged;
          affected.push(merged);
          emit(this.tableName, 'UPDATE', merged, old);
        } else {
          if (row.id === undefined && !keys.some(k => k !== 'id')) row.id = uuid();
          for (const c of DEFAULT_TS_COLUMNS) if (row[c] === undefined) row[c] = now;
          if (this.tableName === 'biz_store' && row.rev === undefined) row.rev = 1;
          t.push(row);
          affected.push(row);
          emit(this.tableName, 'INSERT', row, null);
        }
      }
      persist();
      return this.finish(this.returnRows ? this.project(affected) : []);
    }

    if (this.op === 'update') {
      const affected: Row[] = [];
      for (let i = 0; i < t.length; i++) {
        if (!this.matches(t[i])) continue;
        const old = t[i];
        const next = { ...old, ...clone(this.payload) };
        t[i] = next;
        affected.push(next);
        emit(this.tableName, 'UPDATE', next, old);
      }
      if (affected.length) persist();
      return this.finish(this.returnRows ? this.project(affected) : []);
    }

    // delete
    const removed: Row[] = [];
    tables[this.tableName] = t.filter(r => {
      if (this.matches(r)) { removed.push(r); return false; }
      return true;
    });
    removed.forEach(r => emit(this.tableName, 'DELETE', null, r));
    if (removed.length) persist();
    return this.finish(this.returnRows ? this.project(removed) : []);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return new Promise(resolve => setTimeout(resolve, 0))
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
  catch(onrejected?: (reason: any) => any) { return this.then(undefined, onrejected); }
  finally(cb?: () => void) { return this.then(v => { cb?.(); return v; }, e => { cb?.(); throw e; }); }
}

// ─── Authentification ──────────────────────────────────────────────────────────

const AUTH_KEY = 'station-auth-token';
type AuthCb = (event: string, session: any) => void;
const authListeners = new Set<AuthCb>();

function makeSession(u: DemoAccount) {
  return {
    access_token: `demo-token-${u.id}`,
    refresh_token: `demo-refresh-${u.id}`,
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    user: { id: u.id, email: u.email, user_metadata: { name: u.name, username: u.username }, app_metadata: {}, aud: 'authenticated', role: 'authenticated' },
  };
}

function readSession(): any | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.user?.id || !users.some(u => u.id === s.user.id)) return null;
    return s;
  } catch { return null; }
}

function setSession(s: any | null, event: string) {
  try {
    if (s) globalThis.localStorage?.setItem(AUTH_KEY, JSON.stringify(s));
    else globalThis.localStorage?.removeItem(AUTH_KEY);
  } catch { /* rien */ }
  setTimeout(() => authListeners.forEach(cb => { try { cb(event, s); } catch { /* rien */ } }), 0);
}

const currentUserId = (): string | null => readSession()?.user?.id ?? null;

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const id = (email || '').trim().toLowerCase();
    const u = users.find(x => (x.email.toLowerCase() === id || x.username.toLowerCase() === id) && x.password === password);
    if (!u) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } };
    const s = makeSession(u);
    setSession(s, 'SIGNED_IN');
    return { data: { user: s.user, session: s }, error: null };
  },
  async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
  async getSession() { return { data: { session: readSession() }, error: null }; },
  async getUser() { return { data: { user: readSession()?.user ?? null }, error: null }; },
  async updateUser(attrs: { password?: string; email?: string }) {
    const uid = currentUserId();
    const u = users.find(x => x.id === uid);
    if (!u) return { data: { user: null }, error: { message: 'Non connecté' } };
    if (attrs.password) u.password = attrs.password;
    if (attrs.email) u.email = attrs.email;
    persist();
    return { data: { user: readSession()?.user }, error: null };
  },
  async refreshSession() { return { data: { session: readSession() }, error: null }; },
  onAuthStateChange(cb: AuthCb) {
    authListeners.add(cb);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
  },
};

// ─── RPC ───────────────────────────────────────────────────────────────────────

const WORKER_TABLES: Record<string, { table: string; role: string }> = {
  pompiste: { table: 'pompistes', role: 'pompiste' },
  chef_brigade: { table: 'brigade_chefs', role: 'chef_brigade' },
  gerant: { table: 'gerants', role: 'gerant' },
  magasin: { table: 'magasin_workers', role: 'magasin' },
};

function findWorkerByAuth(uid: string): { row: Row; role: string } | null {
  for (const { table: tn, role } of Object.values(WORKER_TABLES)) {
    const row = table(tn).find(r => r.auth_user_id === uid);
    if (row) return { row, role };
  }
  return null;
}

function upsertAuthUser(params: { authId?: string; username?: string | null; password?: string | null; name?: string | null; email?: string | null }): DemoAccount {
  const username = (params.username || '').trim().toLowerCase();
  let u = params.authId ? users.find(x => x.id === params.authId) : undefined;
  if (!u) {
    u = { id: uuid(), email: params.email || `${username || 'user'}@station.local`, username, password: params.password || '', name: params.name || username };
    users.push(u);
  } else {
    if (params.password) u.password = params.password;
    if (username) u.username = username;
    if (params.email) u.email = params.email;
  }
  return u;
}

async function rpc(name: string, p: Record<string, any> = {}): Promise<{ data: any; error: any }> {
  await new Promise(r => setTimeout(r, 0));
  const uid = currentUserId();
  const ok = (data: any) => ({ data: clone(data), error: null });

  switch (name) {
    case 'admin_exists':
      return ok(table('admin_profiles').length > 0);

    case 'email_for_username': {
      const u = users.find(x => x.username.toLowerCase() === String(p.p_username || '').toLowerCase());
      return ok(u?.email ?? null);
    }

    case 'get_my_role': {
      if (!uid) return ok(null);
      const admin = table('admin_profiles').find(r => r.id === uid);
      if (admin) return ok(admin.role || 'admin');
      const w = findWorkerByAuth(uid);
      if (w) return ok(w.role);
      if (table('module_workers').some(r => r.auth_user_id === uid)) return ok('module_worker');
      return ok(null);
    }

    case 'get_my_worker': {
      if (!uid) return ok(null);
      return ok(findWorkerByAuth(uid)?.row ?? null);
    }

    case 'get_my_module_worker': {
      if (!uid) return ok(null);
      return ok(table('module_workers').find(r => r.auth_user_id === uid) ?? null);
    }

    case 'create_admin_account': {
      const u = upsertAuthUser({ username: p.p_username, password: p.p_password, name: p.p_name, email: p.p_email });
      table('admin_profiles').push({ id: u.id, name: p.p_name, username: p.p_username, email: p.p_email, role: 'admin', created_at: new Date().toISOString() });
      persist();
      return ok({ ok: true, user_id: u.id });
    }

    case 'provision_worker_account': {
      const meta = WORKER_TABLES[p.p_worker_type];
      if (!meta) return ok({ ok: false, error: 'Type d\'employé inconnu' });
      const row = table(meta.table).find(r => r.id === p.p_worker_id);
      if (!row) return ok({ ok: false, error: 'Employé introuvable' });
      if (p.p_action === 'delete') {
        users = users.filter(x => x.id !== row.auth_user_id);
        Object.assign(row, { auth_user_id: null, has_access: false });
        persist();
        return ok({ ok: true });
      }
      const u = upsertAuthUser({ authId: row.auth_user_id, username: p.p_username, password: p.p_password, name: p.p_name ?? row.name, email: p.p_email });
      Object.assign(row, { auth_user_id: u.id, has_access: true, username: u.username });
      persist();
      emit(meta.table, 'UPDATE', row, row);
      return ok({ ok: true, auth_user_id: u.id });
    }

    case 'provision_module_worker_account': {
      const t = table('module_workers');
      let row = t.find(r => r.id === p.p_worker_id);
      if (p.p_action === 'delete') {
        if (row) users = users.filter(x => x.id !== row!.auth_user_id);
        tables.module_workers = t.filter(r => r.id !== p.p_worker_id);
        persist();
        return ok({ ok: true });
      }
      const u = upsertAuthUser({ authId: row?.auth_user_id, username: p.p_username, password: p.p_password, name: p.p_name, email: p.p_email });
      const next = {
        ...(row || {}), id: p.p_worker_id, module_key: p.p_module_key, name: p.p_name ?? row?.name,
        role_name: p.p_role_name ?? row?.role_name ?? null, phone: p.p_phone ?? row?.phone ?? null,
        email: u.email, username: u.username, auth_user_id: u.id, has_account: true,
        permissions: p.p_permissions ?? row?.permissions ?? {}, updated_at: new Date().toISOString(),
        created_at: row?.created_at ?? new Date().toISOString(),
      };
      if (row) Object.assign(row, next); else t.push(next);
      persist();
      return ok({ ok: true, auth_user_id: u.id });
    }

    case 'save_module_worker_permissions': {
      const row = table('module_workers').find(r => r.id === p.p_worker_id);
      if (row) { row.permissions = p.p_permissions || {}; persist(); }
      return ok({ ok: true });
    }

    case 'biz_store_save': {
      const t = table('biz_store');
      const row = t.find(r => r.id === p.p_id);
      const now = new Date().toISOString();
      if (row) {
        row.state = clone(p.p_state);
        row.rev = (Number(row.rev) || 0) + 1;
        row.updated_at = now;
      } else {
        t.push({ id: p.p_id, state: clone(p.p_state), rev: 1, updated_at: now });
      }
      const rev = (t.find(r => r.id === p.p_id) as Row).rev;
      const meta = table('biz_store_meta');
      const m = meta.find(r => r.id === p.p_id);
      if (m) m.rev = rev; else meta.push({ id: p.p_id, rev });
      persist();
      return ok({ ok: true, rev });
    }

    case 'adjust_tank_level': {
      const tank = table('tanks').find(r => r.id === p.p_tank_id);
      if (tank) {
        const old = { ...tank };
        tank.current = (Number(tank.current) || 0) + (Number(p.p_delta) || 0);
        persist();
        emit('tanks', 'UPDATE', tank, old);
      }
      return ok(tank?.current ?? null);
    }

    case 'adjust_armoire_stock': {
      const t = table('armoire_stock');
      let row = t.find(r => r.armoire_id === p.p_armoire_id && r.product_id === p.p_product_id
        && (r.module_key ?? null) === (p.p_module_key ?? null));
      if (!row) {
        row = { id: uuid(), armoire_id: p.p_armoire_id, product_id: p.p_product_id, module_key: p.p_module_key ?? null, quantity: 0, empty_quantity: 0, created_at: new Date().toISOString() };
        t.push(row);
      }
      row.quantity = (Number(row.quantity) || 0) + (Number(p.p_delta) || 0);
      row.empty_quantity = (Number(row.empty_quantity) || 0) + (Number(p.p_empty_delta) || 0);
      persist();
      emit('armoire_stock', 'UPDATE', row, null);
      return ok(null);
    }

    case 'public_station_identity': {
      const s = table('station_settings')[0] || {};
      return ok({ name: s.name, logo_url: s.logo_url, magasin1_name: s.magasin1_name, magasin2_name: s.magasin2_name, magasin2_enabled: s.magasin2_enabled });
    }

    default:
      console.info(`[demo-db] RPC « ${name} » simulée (aucun effet).`);
      return ok(null);
  }
}

// ─── Stockage de fichiers ───────────────────────────────────────────────────────

const storage = {
  from(_bucket: string) {
    return {
      async upload(path: string, _file: any, _opts?: any) { return { data: { path }, error: null }; },
      getPublicUrl(path: string) { return { data: { publicUrl: path } }; },
      async remove(_paths: string[]) { return { data: [], error: null }; },
      async list() { return { data: [], error: null }; },
      async download() { return { data: null, error: { message: 'Indisponible en mode démo' } }; },
      async createSignedUrl(path: string) { return { data: { signedUrl: path }, error: null }; },
    };
  },
};

// ─── Client ────────────────────────────────────────────────────────────────────

export function createMockClient() {
  return {
    from: (tableName: string) => new QueryBuilder(tableName),
    rpc: (name: string, params?: Record<string, any>) => rpc(name, params),
    auth,
    storage,
    channel: (name: string) => new MockChannel(name),
    removeChannel: (ch: MockChannel) => { channels.delete(ch); return Promise.resolve('ok'); },
    removeAllChannels: () => { channels.clear(); return Promise.resolve([]); },
    functions: { invoke: async () => ({ data: null, error: { message: 'Indisponible en mode démo' } }) },
  };
}
