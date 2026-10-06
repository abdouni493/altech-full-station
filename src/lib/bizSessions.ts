/**
 * ─── Sessions de travail — une par employé, totalement indépendante ────────────
 *
 * PROBLÈME CORRIGÉ ICI
 *   Avant, le point de vente prenait « la » session ouverte de la partie
 *   (`sessions.find(s => s.status === 'open')`). Résultat : si l'employé 1
 *   n'avait pas clôturé la sienne, l'employé 2 arrivait sur une caisse déjà
 *   ouverte au nom de l'employé 1, vendait dedans, et pouvait la clôturer.
 *   De plus les sessions vivaient dans le blob JSON partagé `biz_store` : deux
 *   postes connectés en même temps s'écrasaient mutuellement, donc l'ouverture
 *   de l'un effaçait celle de l'autre.
 *
 * CE QUE FAIT CE MODULE
 *   • Les sessions ont leur PROPRE table Supabase (`biz_sessions`) : une ligne
 *     par session, donc aucune écrasement possible entre deux postes.
 *   • Chaque ligne porte son propriétaire (`worker_id` + `auth_user_id`). Les
 *     règles RLS interdisent au serveur même de laisser un employé modifier la
 *     session d'un autre — l'administrateur reste au-dessus (supervision).
 *   • `isMySession()` est la seule définition d'appartenance utilisée par l'UI.
 *
 *   Migration : supabase/migrations/2026-08-04_biz_sessions_per_worker.sql
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from './supabase';
import { BizSession, ModuleKey, MODULE_KEYS, isModuleKey } from './bizConfig';

/** Row shape of `public.biz_sessions`. */
interface BizSessionRow {
  id: string;
  module_key: string;
  ref: string | null;
  worker_id: string | null;
  worker_name: string;
  opening_cash: number | string | null;
  opened_at: string;
  closed_at: string | null;
  closing_cash: number | string | null;
  status: string;
  notes: string | null;
  theoretical: number | string | null;
  credit: number | string | null;
  decalage: number | string | null;
  auth_user_id: string | null;
  opened_by_id: string | null;
  opened_by_name: string | null;
  closed_by_id: string | null;
  closed_by_name: string | null;
}

const num = (v: number | string | null | undefined): number | undefined =>
  v === null || v === undefined || v === '' ? undefined : Number(v);

function rowToSession(r: BizSessionRow): BizSession {
  return {
    id: r.id,
    ref: r.ref || '',
    workerId: r.worker_id || undefined,
    workerName: r.worker_name,
    openingCash: num(r.opening_cash) ?? 0,
    openedAt: r.opened_at,
    closedAt: r.closed_at || undefined,
    closingCash: num(r.closing_cash),
    status: r.status === 'closed' ? 'closed' : 'open',
    notes: r.notes || undefined,
    theoretical: num(r.theoretical),
    credit: num(r.credit),
    decalage: num(r.decalage),
    authUserId: r.auth_user_id || undefined,
    openedById: r.opened_by_id || undefined,
    openedByName: r.opened_by_name || undefined,
    closedById: r.closed_by_id || undefined,
    closedByName: r.closed_by_name || undefined,
  };
}

function sessionToRow(moduleKey: ModuleKey, s: BizSession): Record<string, unknown> {
  return {
    id: s.id,
    module_key: moduleKey,
    ref: s.ref || null,
    worker_id: s.workerId || null,
    worker_name: s.workerName,
    opening_cash: s.openingCash ?? 0,
    opened_at: s.openedAt,
    closed_at: s.closedAt ?? null,
    closing_cash: s.closingCash ?? null,
    status: s.status,
    notes: s.notes ?? null,
    theoretical: s.theoretical ?? null,
    credit: s.credit ?? null,
    decalage: s.decalage ?? null,
    opened_by_id: s.openedById ?? null,
    opened_by_name: s.openedByName ?? null,
    closed_by_id: s.closedById ?? null,
    closed_by_name: s.closedByName ?? null,
    // `auth_user_id` is left to the column default (auth.uid()) on insert so the
    // row is always stamped with the account that really opened it.
  };
}

/**
 * True while the table is missing (migration not run yet). Checked on the
 * Postgres / PostgREST code, never on the message alone: an RLS refusal also
 * names the table and must NOT be mistaken for an absent table.
 *
 * Partagé avec `bizProducts.ts` — deux copies de ce test finiraient par diverger,
 * et celle qui se tromperait ferait passer une panne pour une migration
 * manquante (donc un repli silencieux au lieu d'une erreur).
 */
export function isMissingTable(err?: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST202') return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(err.message || '');
}

/**
 * Every session of every part, or `null` when the table is not there yet — the
 * caller then keeps whatever the legacy JSON blob held, so an un-migrated
 * database keeps working exactly like before.
 */
export async function loadBizSessions(): Promise<Record<ModuleKey, BizSession[]> | null> {
  try {
    const { data, error } = await supabase
      .from('biz_sessions').select('*').order('opened_at', { ascending: false });
    if (error) {
      if (!isMissingTable(error)) console.warn('[biz_sessions] load', error.message);
      return null;
    }
    const out = Object.fromEntries(MODULE_KEYS.map(k => [k, [] as BizSession[]])) as Record<ModuleKey, BizSession[]>;
    ((data || []) as BizSessionRow[]).forEach(r => {
      const key = r.module_key as ModuleKey;
      if (isModuleKey(key)) out[key].push(rowToSession(r));
    });
    return out;
  } catch {
    return null;
  }
}

/**
 * Writes one session (open or close). Returns `ok:false` with a readable French
 * message — the DB refuses a second open session for the same employee and any
 * write on somebody else's session.
 */
export async function saveBizSession(
  moduleKey: ModuleKey, session: BizSession,
): Promise<{ ok: boolean; error?: string; offline?: boolean }> {
  try {
    const { error } = await supabase
      .from('biz_sessions').upsert(sessionToRow(moduleKey, session), { onConflict: 'id' });
    if (!error) return { ok: true };

    // L'ordre compte : un refus RLS nomme lui aussi la table.
    if (error.code === '23505' || /duplicate key|unique constraint/i.test(error.message)) {
      return { ok: false, error: "Une session est déjà ouverte pour cet employé — clôturez-la d'abord." };
    }
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return { ok: false, error: 'Cette session appartient à un autre employé : vous ne pouvez pas la modifier.' };
    }
    if (isMissingTable(error)) {
      // Table absente (migration non passée) : la session reste locale, comme avant.
      return { ok: true, offline: true };
    }
    return { ok: false, error: error.message };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

// ─── Appartenance ──────────────────────────────────────────────────────────────

/** Who the connected user is, from the point of view of a work session. */
export interface SessionIdentity {
  /** module worker id, or the admin's user id. */
  id?: string;
  name?: string;
  isAdmin: boolean;
}

/**
 * A session is *mine* when it was opened FOR me (`workerId`) or BY me
 * (`openedById` — the case of an admin who opens the drawer on their own post).
 * Nothing else: another employee's session is never picked up by the POS.
 */
export function isMySession(s: BizSession, me: SessionIdentity): boolean {
  if (!me.id) return false;
  return s.workerId === me.id || s.openedById === me.id;
}

/** The admin supervises: they may close a session an employee forgot to close. */
export function canCloseSession(s: BizSession, me: SessionIdentity): boolean {
  return me.isAdmin || isMySession(s, me);
}

/** My open session of the part, or `null` — never somebody else's. */
export function findMyOpenSession(sessions: BizSession[], me: SessionIdentity): BizSession | null {
  return sessions.find(s => s.status === 'open' && isMySession(s, me)) || null;
}

/** The other cashiers currently open (shown to the admin for supervision). */
export function otherOpenSessions(sessions: BizSession[], me: SessionIdentity): BizSession[] {
  return sessions.filter(s => s.status === 'open' && !isMySession(s, me));
}
