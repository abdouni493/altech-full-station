/**
 * ─── TAXES RÉUTILISABLES (TVA + autres taxes) ────────────────────────────────
 * Une taxe créée une fois (nom + montant fixe OU pourcentage) est enregistrée
 * comme « modèle » : à la prochaine opération il suffit de l'activer, elle est
 * prête avec sa valeur. Les modèles sont partagés par les achats carburant et
 * les ventes carburant.
 *
 * Une taxe en pourcentage s'applique sur la base HT (après remise) ; une taxe
 * fixe s'ajoute telle quelle. TVA et taxes s'additionnent au total.
 */
import { supabase } from './supabase';
import { newId } from './utils';

export type TaxKind = 'percent' | 'amount';

export interface TaxPreset {
  id: string;
  name: string;
  kind: TaxKind;
  value: number;
  createdAt?: string;
}

/** Une taxe appliquée sur un document (copie figée du modèle). */
export interface AppliedTax {
  id: string;
  presetId?: string;
  name: string;
  kind: TaxKind;
  value: number;
  /** Montant réellement ajouté au total. */
  amount: number;
}

const TABLE = 'tax_presets';

export function taxAmount(base: number, kind: TaxKind, value: number): number {
  const v = Number(value) || 0;
  if (kind === 'percent') return Math.round((Number(base) || 0) * v) / 100;
  return v;
}

/** Recalcule les montants des taxes pour une base donnée. */
export function computeTaxes(base: number, taxes: AppliedTax[]): AppliedTax[] {
  return (taxes || []).map(t => ({ ...t, amount: taxAmount(base, t.kind, t.value) }));
}

export const sumTaxes = (taxes: AppliedTax[] | undefined): number =>
  (taxes || []).reduce((s, t) => s + (Number(t.amount) || 0), 0);

export const taxLabel = (t: Pick<AppliedTax, 'name' | 'kind' | 'value'>): string =>
  t.kind === 'percent' ? `${t.name} (${t.value}%)` : t.name;

const mapPreset = (r: any): TaxPreset => ({
  id: r.id, name: r.name, kind: r.kind === 'amount' ? 'amount' : 'percent',
  value: +(r.value ?? 0), createdAt: r.created_at,
});

export async function loadTaxPresets(): Promise<TaxPreset[]> {
  try {
    const { data } = await supabase.from(TABLE).select('*').order('created_at', { ascending: true });
    return ((data as any[]) || []).map(mapPreset);
  } catch { return []; }
}

export async function saveTaxPreset(p: Omit<TaxPreset, 'id'> & { id?: string }): Promise<TaxPreset> {
  const row = { id: p.id || newId(), name: p.name.trim(), kind: p.kind, value: Number(p.value) || 0, created_at: p.createdAt || new Date().toISOString() };
  await supabase.from(TABLE).upsert(row, { onConflict: 'id' });
  return mapPreset(row);
}

export async function deleteTaxPreset(id: string): Promise<void> {
  await supabase.from(TABLE).delete().eq('id', id);
}
