/**
 * ─── Shared worker-payroll engine ──────────────────────────────────────────────
 * Pure, framework-agnostic logic behind the single `WorkerPaymentModal` used by
 * every worker screen of the app (Pompistes, Gérants, Employés Magasin, and the
 * Lavage / Cafétéria parts). Each screen adapts its own data model to the
 * normalised shapes below, so the payment UI and its calculations stay identical
 * everywhere.
 *
 * Three ways an employee is paid:
 *   • `jour`        — a daily rate, billed per worked day (weekends/repos excluded).
 *   • `mois`        — a monthly salary, billed per unpaid month.
 *   • `pourcentage` — a share of every intervention they performed (Lavage).
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type SalaryType = 'jour' | 'mois' | 'pourcentage';
export type PrimeType = 'percent' | 'amount';

/** An advance already handed to the worker — deducted from the net when checked. */
export interface PayAcompte { id: string; date: string; amount: number; description?: string; paid: boolean }
/** An absence / retenue — deducted from the net when checked. */
export interface PayAbsence { id: string; date: string; cost: number; description?: string; paid: boolean }
/** A pompiste décalage against a brigade: added (BONUS) or removed (RETENUE). */
export interface PayDecalage { id: string; date: string; amount: number; type: 'BONUS' | 'RETENUE'; label?: string; paid?: boolean }
/** One unpaid intervention of a percentage-paid worker. */
export interface PayWork { id: string; label: string; sublabel?: string; date: string; base: number; share: number }

/**
 * Un inventaire dont les MANQUANTS peuvent être mis à la charge d'un employé
 * « concerné par les inventaires ». `lossValue` est le coût des produits qui
 * manquaient au comptage, valorisé au prix d'achat.
 */
export interface PayInventaire {
  id: string;
  label: string;
  sublabel?: string;
  date: string;
  lossValue: number;
  /** Nombre de produits en décalage négatif — affiché à titre indicatif. */
  productCount: number;
}

/** Weekdays, indexed like `Date.getDay()` (0 = Sunday … 6 = Saturday). */
export const WEEKDAYS: { idx: number; label: string; short: string }[] = [
  { idx: 6, label: 'Samedi', short: 'Sam' },
  { idx: 0, label: 'Dimanche', short: 'Dim' },
  { idx: 1, label: 'Lundi', short: 'Lun' },
  { idx: 2, label: 'Mardi', short: 'Mar' },
  { idx: 3, label: 'Mercredi', short: 'Mer' },
  { idx: 4, label: 'Jeudi', short: 'Jeu' },
  { idx: 5, label: 'Vendredi', short: 'Ven' },
];

/** Default working week in Algeria: Saturday → Thursday, Friday off. */
export const DEFAULT_WORK_DAYS = [6, 0, 1, 2, 3, 4];

const DAY_MS = 86_400_000;
/** Never list more than ~14 months of unpaid days to keep the modal usable. */
const MAX_LOOKBACK_DAYS = 430;

/** `YYYY-MM-DD` of a Date in local time (never UTC-shifted like toISOString). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a `YYYY-MM-DD` string to a local Date at midnight. */
export function parseDay(s: string): Date {
  const [y, m, d] = (s || '').split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/** French label of a day, e.g. "lun. 21 juil." */
export function dayLabel(iso: string): string {
  const d = parseDay(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-DZ', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('fr-DZ', { month: 'long', year: 'numeric' });
}

/**
 * Unpaid working days between the start date and today (system date), inclusive.
 * A day counts when its weekday is in `workDays` and it is not a repos day, not
 * an absence day, and not already settled by a previous payment.
 */
export function computeUnpaidWorkingDays(opts: {
  workDays?: number[];
  startDate?: string;
  paidDays?: string[];
  absenceDays?: string[];
  today?: Date;
}): string[] {
  const work = (opts.workDays && opts.workDays.length ? opts.workDays : DEFAULT_WORK_DAYS);
  const paid = new Set(opts.paidDays || []);
  const absent = new Set(opts.absenceDays || []);
  const today = opts.today ? new Date(opts.today) : new Date();
  today.setHours(0, 0, 0, 0);

  const earliest = new Date(today.getTime() - MAX_LOOKBACK_DAYS * DAY_MS);
  let cursor = parseDay(opts.startDate || '');
  if (isNaN(cursor.getTime()) || cursor < earliest) cursor = earliest;
  cursor.setHours(0, 0, 0, 0);

  const out: string[] = [];
  for (let t = cursor.getTime(); t <= today.getTime(); t += DAY_MS) {
    const d = new Date(t);
    if (!work.includes(d.getDay())) continue;      // repos / weekend
    const iso = isoDay(d);
    if (absent.has(iso)) continue;                 // absence day
    if (paid.has(iso)) continue;                   // already settled
    out.push(iso);
  }
  return out;
}

/**
 * Unpaid months between the start date and the current month, inclusive.
 * Months already settled by a previous payment are skipped.
 */
export function computeUnpaidMonths(opts: {
  startDate?: string;
  paidMonths?: string[];
  today?: Date;
}): string[] {
  const paid = new Set(opts.paidMonths || []);
  const today = opts.today ? new Date(opts.today) : new Date();
  const endY = today.getFullYear(), endM = today.getMonth();

  let start = parseDay(opts.startDate || '');
  if (isNaN(start.getTime())) start = new Date(endY, endM - 11, 1);
  // Never look back more than 24 months so the list stays sane.
  const floor = new Date(endY, endM - 23, 1);
  if (start < floor) start = floor;

  const out: string[] = [];
  let y = start.getFullYear(), m = start.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    if (!paid.has(key)) out.push(key);
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

/** Prime actually added to the net, from its type and raw value. */
export function primeAmount(base: number, type: PrimeType, value: number): number {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  return type === 'percent' ? (base * v) / 100 : v;
}

export interface NetInput {
  base: number;
  acomptes: number;
  absences: number;
  decalageBonus: number;
  decalageRetenue: number;
  prime: number;
  /**
   * Retenue au titre des inventaires — la part des manquants effectivement mise
   * à la charge de l'employé. Elle vaut 0 tant que la retenue n'est pas activée,
   * même quand des inventaires sont sélectionnés : sélectionner sert à CONSTATER
   * le décalage, activer la retenue est une décision séparée.
   */
  inventaire?: number;
}

/** base − acomptes − absences + bonus − retenue + prime − inventaire, floored at 0. */
export function computeNet(i: NetInput): number {
  return Math.max(0,
    i.base - i.acomptes - i.absences + i.decalageBonus - i.decalageRetenue + i.prime - (i.inventaire || 0));
}
