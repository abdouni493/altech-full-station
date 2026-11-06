/**
 * ─── OPÉRATIONS TPE / TAG INDÉPENDANTES ──────────────────────────────────────
 * Une justification TPE ou TAG d'une brigade se saisit de deux façons :
 *   • `TOTAL`  : un montant global + une description ;
 *   • `DETAIL` : une liste d'opérations, chacune avec ses informations
 *                (TPE : n° de carte, nature, n° d'opération, quantité, montant ;
 *                 TAG : produit/carburant, type de tag, description, montant).
 * En mode détail, le montant de la justification est la somme des opérations :
 * c'est lui qui entre dans la justification du pompiste.
 *
 * Chaque opération (ou la justification entière en mode total) est un élément
 * « négociable » sur le compte bancaire concerné — voir `lib/negotiations.ts`.
 */
import { supabase } from './supabase';
import { newId } from './utils';

export type JustifEntryMode = 'TOTAL' | 'DETAIL';

export interface JustifOperation {
  id: string;
  // ── TPE ──
  cardNumber?: string;
  operationNumber?: string;
  // ── Commun ──
  /** `CARBURANT` (fuelType) ou `PRODUIT` (productName). TPE : toujours carburant. */
  productKind?: 'CARBURANT' | 'PRODUIT';
  fuelType?: string;
  productId?: string;
  productName?: string;
  /** Quantité (litres pour un carburant) — facultative. */
  quantity?: number;
  unitPrice?: number;
  amount: number;
  // ── TAG ──
  tagType?: string;
  description?: string;
}

export const opsTotal = (ops: JustifOperation[] | undefined): number =>
  (ops || []).reduce((s, o) => s + (Number(o.amount) || 0), 0);

export const emptyOperation = (fuelType?: string): JustifOperation => ({
  id: newId(), productKind: 'CARBURANT', fuelType, amount: 0,
});

/** Formate un n° de carte par groupes de 4 chiffres. */
export const formatCard = (v?: string): string =>
  (v || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

/** Toutes les cartes déjà saisies (les plus fréquentes d'abord). */
export function knownCardNumbers(accountings: { justifications?: { operations?: JustifOperation[] }[] }[]): string[] {
  const count = new Map<string, number>();
  for (const a of accountings || []) for (const j of a.justifications || []) for (const o of j.operations || []) {
    const c = (o.cardNumber || '').replace(/\s+/g, '');
    if (c) count.set(c, (count.get(c) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function suggestCards(all: string[], typed: string, max = 6): string[] {
  const t = (typed || '').replace(/\s+/g, '');
  if (!t) return all.slice(0, max);
  return all.filter(c => c.startsWith(t) && c !== t)
    .concat(all.filter(c => !c.startsWith(t) && c.includes(t) && c !== t))
    .slice(0, max);
}

// ─── Types de TAG (réutilisables) ───────────────────────────────────────────
export const DEFAULT_TAG_TYPES = ['Bon Naftal', 'Tag Naftal', 'Bon carburant', 'Carte entreprise'];
const TAG_TABLE = 'tag_types';

export async function loadTagTypes(): Promise<string[]> {
  try {
    const { data } = await supabase.from(TAG_TABLE).select('*');
    const custom = ((data as any[]) || []).map(r => String(r.name)).filter(Boolean);
    return [...new Set([...DEFAULT_TAG_TYPES, ...custom])];
  } catch { return DEFAULT_TAG_TYPES; }
}

export async function addTagType(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  await supabase.from(TAG_TABLE).insert({ id: newId(), name: n, created_at: new Date().toISOString() });
}
