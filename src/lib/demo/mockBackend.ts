/**
 * ─── DEMO BACKEND (in-memory, no database) ─────────────────────────────────────
 * A drop-in stand-in for the supabase-js client used by the demo build. It keeps
 * every table in memory, seeded with constant demo data (`./seed`), and answers
 * the exact query-builder, auth, RPC, storage and realtime calls the app makes.
 *
 * Nothing leaves the browser: every button still works (create, edit, delete,
 * pay, print…), but the changes live only until the page is reloaded, at which
 * point the constant demo data is restored.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { buildSeed, DEMO_ACCOUNTS, DemoAccount } from './seed';

type Row = Record<string, any>;
type Result = { data: any; error: any; count?: number | null; status?: number };

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const genId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ─── Tables ─────────────────────────────────────────────────────────────────────
let TABLES: Record<string, Row[]> | null = null;
function tables(): Record<string, Row[]> {
  if (!TABLES) TABLES = buildSeed();
  return TABLES;
}
function table(name: string): Row[] {
  const t = tables();
  if (!t[name]) t[name] = [];
  return t[name];
}

/** Tables whose primary key is not a single `id` column. */
const COMPOSITE_KEYS: Record<string, string[]> = {
  chef_pompiste_assignments: ['chef_id', 'pompiste_id'],
  brigade_pompiste_assignments: ['brigade_id', 'pompiste_id'],
  fuel_invoice_bls: ['invoice_id', 'delivery_note_id'],
  fuel_receipt_invoices: ['receipt_id', 'invoice_id'],
};
const keyCols = (tbl: string, onConflict?: string) =>
  onConflict ? onConflict.split(',').map(s => s.trim()) : (COMPOSITE_KEYS[tbl] || ['id']);

// ─── Filters ────────────────────────────────────────────────────────────────────
type Pred = (row: Row) => boolean;

const cmp = (a: any, b: any) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a), nb = Number(b);
  if (typeof a !== 'string' || typeof b !== 'string') {
    if (Number.isFinite(na) && Number.isFinite(nb)) return na < nb ? -1 : 1;
  }
  return String(a) < String(b) ? -1 : 1;
};
const likeToRe = (pattern: string, flags = '') =>
  new RegExp('^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', flags);
const eqLoose = (a: any, b: any) => a === b || (a != null && b != null && String(a) === String(b));

function opPred(col: string, op: string, val: any): Pred {
  switch (op) {
    case 'eq': return r => eqLoose(r[col], val);
    case 'neq': return r => !eqLoose(r[col], val);
    case 'gt': return r => cmp(r[col], val) > 0;
    case 'gte': return r => cmp(r[col], val) >= 0;
    case 'lt': return r => cmp(r[col], val) < 0;
    case 'lte': return r => cmp(r[col], val) <= 0;
    case 'like': return r => likeToRe(val).test(String(r[col] ?? ''));
    case 'ilike': return r => likeToRe(val, 'i').test(String(r[col] ?? ''));
    case 'is': return r => (val === null ? r[col] === null || r[col] === undefined : r[col] === val);
    case 'in': {
      const list = Array.isArray(val) ? val
        : String(val).replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      return r => list.some(v => eqLoose(r[col], v));
    }
    case 'cs': case 'contains': return r => {
      const v = r[col];
      if (Array.isArray(val)) return Array.isArray(v) && val.every(x => v.includes(x));
      if (val && typeof val === 'object') return !!v && Object.entries(val).every(([k, x]) => eqLoose(v[k], x));
      return String(v ?? '').includes(String(val));
    };
    default: return () => true;
  }
}

/** Parses a PostgREST `or` expression such as `a.eq.1,b.ilike.%x%`. */
function orPred(expr: string): Pred {
  const parts = expr.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  const preds = parts.map(p => {
    const [col, op, ...rest] = p.split('.');
    return opPred(col, op, rest.join('.'));
  });
  return r => preds.some(pr => pr(r));
}

// ─── Query builder ──────────────────────────────────────────────────────────────
class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private rows: Row[] = [];
  private changes: Row = {};
  private preds: Pred[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private lim?: number;
  private rng?: [number, number];
  private singleMode: 'none' | 'maybe' | 'one' = 'none';
  private returning = false;
  private onConflict?: string;
  private countMode = false;
  private headOnly = false;

  constructor(private tbl: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') { this.returning = true; return this; }
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(rows: any, _o?: any) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: any, o?: { onConflict?: string }) {
    this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.onConflict = o?.onConflict; return this;
  }
  update(changes: Row, _o?: any) { this.op = 'update'; this.changes = changes || {}; return this; }
  delete(_o?: any) { this.op = 'delete'; return this; }

  eq(c: string, v: any) { this.preds.push(opPred(c, 'eq', v)); return this; }
  neq(c: string, v: any) { this.preds.push(opPred(c, 'neq', v)); return this; }
  gt(c: string, v: any) { this.preds.push(opPred(c, 'gt', v)); return this; }
  gte(c: string, v: any) { this.preds.push(opPred(c, 'gte', v)); return this; }
  lt(c: string, v: any) { this.preds.push(opPred(c, 'lt', v)); return this; }
  lte(c: string, v: any) { this.preds.push(opPred(c, 'lte', v)); return this; }
  like(c: string, v: any) { this.preds.push(opPred(c, 'like', v)); return this; }
  ilike(c: string, v: any) { this.preds.push(opPred(c, 'ilike', v)); return this; }
  is(c: string, v: any) { this.preds.push(opPred(c, 'is', v)); return this; }
  in(c: string, v: any[]) { this.preds.push(opPred(c, 'in', v)); return this; }
  contains(c: string, v: any) { this.preds.push(opPred(c, 'cs', v)); return this; }
  match(obj: Row) { Object.entries(obj || {}).forEach(([k, v]) => this.preds.push(opPred(k, 'eq', v))); return this; }
  filter(c: string, op: string, v: any) { this.preds.push(opPred(c, op, v)); return this; }
  not(c: string, op: string, v: any) { const p = opPred(c, op, v); this.preds.push(r => !p(r)); return this; }
  or(expr: string) { this.preds.push(orPred(expr)); return this; }

  order(col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ col, asc: o?.ascending ?? true, nullsFirst: o?.nullsFirst }); return this;
  }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.rng = [from, to]; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  // `single()` is resolved leniently: an empty result is `null`, never an error.
  single() { this.singleMode = 'one'; return this; }
  returns() { return this; }
  abortSignal(_s?: AbortSignal) { return this; }
  throwOnError() { return this; }

  private matches(r: Row) { return this.preds.every(p => p(r)); }

  private shape(rows: Row[]): Result {
    const data = this.singleMode !== 'none' ? (rows[0] ?? null) : rows;
    return { data: clone(data), error: null, count: this.countMode ? rows.length : null, status: 200 };
  }

  private run(): Result {
    const arr = table(this.tbl);
    const now = new Date().toISOString();

    if (this.op === 'insert' || this.op === 'upsert') {
      const written: Row[] = [];
      const keys = keyCols(this.tbl, this.onConflict);
      for (const raw of this.rows) {
        const r: Row = { ...clone(raw) };
        if (!COMPOSITE_KEYS[this.tbl] && (r.id === undefined || r.id === null)) r.id = genId();
        const idx = this.op === 'upsert'
          ? arr.findIndex(x => keys.every(k => eqLoose(x[k], r[k])))
          : -1;
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], ...r, updated_at: now };
          written.push(arr[idx]);
        } else {
          const row = { created_at: now, ...r };
          arr.push(row);
          written.push(row);
        }
      }
      if (this.tbl === 'biz_store') written.forEach(w => { w.rev = (Number(w.rev) || 0) + 1; });
      return this.returning || this.singleMode !== 'none' ? this.shape(written) : { data: null, error: null, status: 201 };
    }

    if (this.op === 'update') {
      const updated: Row[] = [];
      const patch = clone(this.changes);
      arr.forEach((row, i) => {
        if (!this.matches(row)) return;
        arr[i] = { ...row, ...patch, updated_at: now };
        updated.push(arr[i]);
      });
      return this.returning || this.singleMode !== 'none' ? this.shape(updated) : { data: null, error: null, status: 204 };
    }

    if (this.op === 'delete') {
      const removed: Row[] = [];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (this.matches(arr[i])) removed.push(...arr.splice(i, 1));
      }
      return this.returning ? this.shape(removed) : { data: null, error: null, status: 204 };
    }

    let rows = arr.filter(r => this.matches(r));
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.col], bv = b[o.col];
          const an = av === null || av === undefined, bn = bv === null || bv === undefined;
          if (an || bn) {
            if (an && bn) continue;
            const nullsFirst = o.nullsFirst ?? !o.asc;
            return an ? (nullsFirst ? -1 : 1) : (nullsFirst ? 1 : -1);
          }
          const c = cmp(av, bv);
          if (c !== 0) return o.asc ? c : -c;
        }
        return 0;
      });
    }
    const total = rows.length;
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.headOnly) return { data: null, error: null, count: total, status: 200 };
    const res = this.shape(rows);
    if (this.countMode) res.count = total;
    return res;
  }

  then<R1 = Result, R2 = never>(
    ok?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    ko?: ((e: any) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    let result: Result;
    try { result = this.run(); }
    catch (e: any) { result = { data: null, error: { message: e?.message || String(e) } }; }
    return Promise.resolve(result).then(ok, ko);
  }
  catch<R = never>(ko?: ((e: any) => R | PromiseLike<R>) | null) { return this.then(undefined, ko); }
  finally(f?: (() => void) | null) { return this.then(v => { f?.(); return v; }, e => { f?.(); throw e; }); }
}

// ─── Auth ───────────────────────────────────────────────────────────────────────
export const DEMO_AUTH_STORAGE_KEY = 'stationpro.auth';

type AuthListener = (event: string, session: any) => void;
const authListeners = new Set<AuthListener>();

function accounts(): DemoAccount[] {
  tables();
  return DEMO_ACCOUNTS;
}

function makeSession(acc: DemoAccount) {
  const user = {
    id: acc.userId,
    email: acc.email,
    user_metadata: { name: acc.name, role: acc.role },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  };
  return {
    access_token: `demo-token-${acc.userId}`,
    refresh_token: `demo-refresh-${acc.userId}`,
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    user,
  };
}

function readSession(): any | null {
  try {
    const raw = globalThis.localStorage?.getItem(DEMO_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.access_token && s?.user?.id ? s : null;
  } catch { return null; }
}
function writeSession(s: any | null) {
  try {
    if (s) globalThis.localStorage?.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(s));
    else globalThis.localStorage?.removeItem(DEMO_AUTH_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}
function emit(event: string, session: any) {
  setTimeout(() => authListeners.forEach(l => { try { l(event, session); } catch { /* listener */ } }), 0);
}
function currentAccount(): DemoAccount | null {
  const s = readSession();
  if (!s) return null;
  return accounts().find(a => a.userId === s.user.id) || null;
}

const authError = (message: string, status = 400) => ({ message, status, name: 'AuthApiError' });

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const id = String(email || '').trim().toLowerCase();
    const acc = accounts().find(a => a.email.toLowerCase() === id || a.username.toLowerCase() === id);
    if (!acc || acc.password !== password) {
      return { data: { user: null, session: null }, error: authError('Invalid login credentials') };
    }
    const session = makeSession(acc);
    writeSession(session);
    emit('SIGNED_IN', session);
    return { data: { user: session.user, session }, error: null };
  },
  async signOut() {
    writeSession(null);
    emit('SIGNED_OUT', null);
    return { error: null };
  },
  async getSession() {
    return { data: { session: readSession() }, error: null };
  },
  async getUser() {
    const s = readSession();
    return { data: { user: s?.user ?? null }, error: s ? null : authError('Not signed in', 401) };
  },
  async refreshSession() {
    const s = readSession();
    return { data: { session: s, user: s?.user ?? null }, error: null };
  },
  async updateUser(patch: { password?: string; email?: string; data?: Row }) {
    const acc = currentAccount();
    if (!acc) return { data: { user: null }, error: authError('Not signed in', 401) };
    if (patch.password) acc.password = patch.password;
    if (patch.email) acc.email = patch.email;
    return { data: { user: readSession()?.user }, error: null };
  },
  onAuthStateChange(cb: AuthListener) {
    authListeners.add(cb);
    const s = readSession();
    setTimeout(() => { try { cb('INITIAL_SESSION', s); } catch { /* listener */ } }, 0);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
  },
};

// ─── RPC ────────────────────────────────────────────────────────────────────────
function workerTableOf(type: string): string {
  return type === 'pompiste' ? 'pompistes'
    : type === 'chef_brigade' ? 'brigade_chefs'
      : type === 'gerant' ? 'gerants'
        : 'magasin_workers';
}

function provisionAccount(role: string, row: Row, username: string, password: string, email?: string) {
  const list = accounts();
  const existing = list.find(a => a.workerId === row.id);
  const userId = existing?.userId || genId();
  const acc: DemoAccount = {
    userId,
    role: role as DemoAccount['role'],
    name: row.name || username,
    username,
    email: email || `${username}@demo.stationpro.dz`,
    password,
    workerId: row.id,
    label: row.name || username,
  };
  if (existing) Object.assign(existing, acc); else list.push(acc);
  return userId;
}

const rpcHandlers: Record<string, (p: Row) => any> = {
  get_my_role: () => currentAccount()?.role ?? null,
  admin_exists: () => true,
  email_for_username: p => accounts().find(a => a.username.toLowerCase() === String(p.p_username || '').toLowerCase())?.email ?? null,
  create_admin_account: p => {
    const userId = genId();
    accounts().push({
      userId, role: 'admin', name: p.p_name, username: p.p_username, email: p.p_email,
      password: p.p_password, label: p.p_name,
    });
    table('admin_profiles').push({ id: userId, name: p.p_name, username: p.p_username, email: p.p_email, role: 'admin' });
    return { ok: true, user_id: userId };
  },
  get_my_worker: () => {
    const acc = currentAccount();
    if (!acc?.workerId) return null;
    const row = table(workerTableOf(acc.role)).find(r => r.id === acc.workerId);
    return row ? clone(row) : null;
  },
  get_my_module_worker: () => {
    const acc = currentAccount();
    if (!acc || acc.role !== 'module_worker') return null;
    const row = table('module_workers').find(r => r.id === acc.workerId);
    return row ? clone(row) : null;
  },
  provision_worker_account: p => {
    const tbl = workerTableOf(p.p_worker_type);
    const row = table(tbl).find(r => r.id === p.p_worker_id);
    if (!row) return { ok: false, error: 'Employé introuvable' };
    if (p.p_action === 'delete') {
      const i = accounts().findIndex(a => a.workerId === row.id);
      if (i >= 0) accounts().splice(i, 1);
      Object.assign(row, { has_access: false, auth_user_id: null });
      return { ok: true };
    }
    if (p.p_action === 'update_password') {
      const acc = accounts().find(a => a.workerId === row.id);
      if (acc && p.p_password) acc.password = p.p_password;
      return { ok: true, auth_user_id: acc?.userId };
    }
    const username = p.p_username || row.username || `user${accounts().length}`;
    const userId = provisionAccount(p.p_worker_type, row, username, p.p_password || 'demo123', p.p_email);
    Object.assign(row, { has_access: true, auth_user_id: userId, username });
    return { ok: true, auth_user_id: userId };
  },
  provision_module_worker_account: p => {
    const mw = table('module_workers');
    let row = mw.find(r => r.id === p.p_worker_id);
    if (p.p_action === 'delete') {
      const i = accounts().findIndex(a => a.workerId === p.p_worker_id);
      if (i >= 0) accounts().splice(i, 1);
      if (row) Object.assign(row, { has_account: false, auth_user_id: null });
      return { ok: true };
    }
    if (p.p_action === 'update_password') {
      const acc = accounts().find(a => a.workerId === p.p_worker_id);
      if (acc && p.p_password) acc.password = p.p_password;
      return { ok: true, auth_user_id: acc?.userId };
    }
    if (!row) {
      row = { id: p.p_worker_id, module_key: p.p_module_key, created_at: new Date().toISOString() };
      mw.push(row);
    }
    Object.assign(row, {
      module_key: p.p_module_key, name: p.p_name, role_name: p.p_role_name, phone: p.p_phone,
      email: p.p_email, username: p.p_username, permissions: p.p_permissions || {}, has_account: true,
    });
    const userId = provisionAccount('module_worker', row, p.p_username || `emp${mw.length}`, p.p_password || 'demo123', p.p_email);
    row.auth_user_id = userId;
    return { ok: true, auth_user_id: userId };
  },
  save_module_worker_permissions: p => {
    const row = table('module_workers').find(r => r.id === p.p_worker_id);
    if (row) row.permissions = p.p_permissions || {};
    return { ok: true };
  },
  biz_store_save: p => {
    const arr = table('biz_store');
    let row = arr.find(r => r.id === p.p_id);
    if (row && p.p_base_rev != null && row.rev != null && Number(row.rev) !== Number(p.p_base_rev)) {
      return { ok: false, conflict: true, state: clone(row.state), rev: row.rev };
    }
    if (!row) { row = { id: p.p_id, rev: 0 }; arr.push(row); }
    row.state = clone(p.p_state);
    row.rev = (Number(row.rev) || 0) + 1;
    row.updated_at = new Date().toISOString();
    return { ok: true, rev: row.rev };
  },
  adjust_tank_level: p => {
    const tank = table('tanks').find(t => String(t.id) === String(p.p_tank_id ?? p.tank_id));
    if (!tank) return null;
    const delta = Number(p.p_delta ?? p.delta) || 0;
    tank.current = Math.max(0, (Number(tank.current) || 0) + delta);
    return clone(tank);
  },
  public_station_identity: () => {
    const s = table('station_settings')[0] || {};
    return { name: s.name, logo_url: s.logo_url, address: s.address, phone: s.phone };
  },
};

async function rpc(name: string, params: Row = {}) {
  const fn = rpcHandlers[name];
  if (!fn) return { data: null, error: { message: `function ${name} does not exist (demo)` } };
  try { return { data: clone(fn(params || {})), error: null }; }
  catch (e: any) { return { data: null, error: { message: e?.message || String(e) } }; }
}

// ─── Storage ────────────────────────────────────────────────────────────────────
const stored = new Map<string, string>();
const storage = {
  from(bucket: string) {
    return {
      async upload(path: string, body: any, _o?: any) {
        let url = '';
        try {
          const blob = body instanceof Blob ? body : new Blob([body]);
          url = URL.createObjectURL(blob);
        } catch { /* non-browser */ }
        stored.set(`${bucket}/${path}`, url);
        return { data: { path }, error: null };
      },
      getPublicUrl(path: string) {
        return { data: { publicUrl: stored.get(`${bucket}/${path}`) || path } };
      },
      async remove(paths: string[]) {
        paths.forEach(p => stored.delete(`${bucket}/${p}`));
        return { data: paths, error: null };
      },
      async list() { return { data: [], error: null }; },
    };
  },
};

// ─── Realtime (no server → channels subscribe instantly and stay quiet) ────────
function channel(_name: string) {
  const ch: any = {
    on: () => ch,
    subscribe: (cb?: (status: string) => void) => {
      setTimeout(() => cb?.('SUBSCRIBED'), 0);
      return ch;
    },
    unsubscribe: async () => 'ok',
  };
  return ch;
}

// ─── Client ─────────────────────────────────────────────────────────────────────
export function createDemoClient() {
  return {
    from: (name: string) => new QueryBuilder(name),
    rpc,
    auth,
    storage,
    channel,
    removeChannel: async (_c: any) => 'ok',
    removeAllChannels: async () => [],
    getChannels: () => [],
    functions: { invoke: async () => ({ data: null, error: null }) },
  };
}

export { DEMO_ACCOUNTS };
