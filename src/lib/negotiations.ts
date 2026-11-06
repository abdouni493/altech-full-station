/**
 * ─── NÉGOCIATION DES TPE / TAG ───────────────────────────────────────────────
 * Les TPE et TAG justifiés à la création d'une brigade arrivent sur le compte
 * bancaire du terminal. La « négociation » est le moment où ces opérations sont
 * réglées : l'utilisateur sélectionne, sur un compte, les opérations encore non
 * négociées ; leur total est viré du compte vers la caisse Carburant (une ligne
 * TRANSFER du grand livre — comptée dans la caisse Carburant et la caisse
 * générale), et la négociation est gardée dans l'historique du compte.
 *
 * Un élément négociable = une opération détaillée, ou la justification entière
 * quand elle a été saisie en montant global. Sa clé est stable :
 * `justificationId` ou `justificationId:operationId`.
 */
import { supabase } from './supabase';
import type { BrigadeAccounting, Brigade, Pompiste } from '../store/AppContext';
import type { JustifOperation } from './justifOps';

export interface NegotiableItem {
  key: string;
  type: 'TPE' | 'TAG';
  bankAccountId: string;
  brigadeId: string;
  brigadeDate: string;
  justificationId: string;
  opId?: string;
  pompisteId?: string;
  pompisteName?: string;
  amount: number;
  cardNumber?: string;
  operationNumber?: string;
  fuelType?: string;
  quantity?: number;
  tagType?: string;
  productName?: string;
  description?: string;
  detailed: boolean;
}

export interface Negotiation {
  id: string;
  bankAccountId: string;
  date: string;
  amount: number;
  itemKeys: string[];
  /** Copie figée des éléments négociés (pour l'historique). */
  items: NegotiableItem[];
  notes?: string;
  reference?: string;
  /** Ligne TRANSFER du grand livre écrite pour cette négociation. */
  txId?: string;
  createdBy?: string;
  createdAt: string;
}

const TABLE = 'bank_negotiations';

/** Tous les éléments TPE / TAG d'un compte (négociés ou non). */
export function negotiableItems(
  accountings: BrigadeAccounting[], brigades: Brigade[], pompistes: Pompiste[], bankAccountId?: string,
): NegotiableItem[] {
  const out: NegotiableItem[] = [];
  for (const a of accountings || []) {
    const b = brigades.find(x => x.id === a.brigadeId);
    const date = b?.endDatetime || b?.date || '';
    for (const j of a.justifications || []) {
      if (j.justificationType !== 'TPE' && j.justificationType !== 'TAG') continue;
      if (!j.bankAccountId || (bankAccountId && j.bankAccountId !== bankAccountId)) continue;
      const base = {
        type: j.justificationType, bankAccountId: j.bankAccountId, brigadeId: a.brigadeId, brigadeDate: date,
        justificationId: j.id, pompisteId: j.pompisteId,
        pompisteName: pompistes.find(p => p.id === j.pompisteId)?.name,
      } as const;
      const ops: JustifOperation[] = j.entryMode === 'DETAIL' ? (j.operations || []) : [];
      if (ops.length) {
        ops.forEach(o => out.push({
          ...base, key: `${j.id}:${o.id}`, opId: o.id, amount: Number(o.amount) || 0,
          cardNumber: o.cardNumber, operationNumber: o.operationNumber, fuelType: o.fuelType,
          quantity: o.quantity, tagType: o.tagType, productName: o.productName, description: o.description,
          detailed: true,
        }));
      } else if ((j.amount || 0) > 0) {
        out.push({
          ...base, key: j.id, amount: Number(j.amount) || 0, fuelType: j.fuelType, tagType: j.tagType,
          description: j.notes || j.clientName, detailed: false,
        });
      }
    }
  }
  return out.sort((x, y) => new Date(y.brigadeDate).getTime() - new Date(x.brigadeDate).getTime());
}

export const negotiatedKeys = (negs: Negotiation[]): Set<string> =>
  new Set(negs.flatMap(n => n.itemKeys || []));

const mapNeg = (r: any): Negotiation => ({
  id: r.id, bankAccountId: r.bank_account_id, date: r.date, amount: +(r.amount ?? 0),
  itemKeys: r.item_keys || [], items: r.items || [], notes: r.notes ?? undefined,
  reference: r.reference ?? undefined, txId: r.tx_id ?? undefined,
  createdBy: r.created_by ?? undefined, createdAt: r.created_at,
});

export async function loadNegotiations(): Promise<Negotiation[]> {
  try {
    const { data } = await supabase.from(TABLE).select('*');
    return ((data as any[]) || []).map(mapNeg)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch { return []; }
}

export async function saveNegotiation(n: Negotiation): Promise<void> {
  await supabase.from(TABLE).upsert({
    id: n.id, bank_account_id: n.bankAccountId, date: n.date, amount: n.amount,
    item_keys: n.itemKeys, items: n.items, notes: n.notes ?? null, reference: n.reference ?? null,
    tx_id: n.txId ?? null, created_by: n.createdBy ?? null, created_at: n.createdAt,
  }, { onConflict: 'id' });
}

export async function deleteNegotiation(id: string): Promise<void> {
  await supabase.from(TABLE).delete().eq('id', id);
}
