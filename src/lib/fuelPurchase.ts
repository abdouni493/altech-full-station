/**
 * ─── Achats carburant — impact sur les cuves ────────────────────────────────────
 * Un achat carburant REMPLIT des cuves. Le niveau de chaque cuve doit donc suivre
 * l'achat pendant toute sa vie :
 *
 *   • création    → + la quantité livrée
 *   • modification → ± la DIFFÉRENCE entre les anciennes et les nouvelles lignes
 *   • suppression → − la quantité livrée (la livraison n'a jamais eu lieu)
 *
 * Ces règles sont regroupées ici pour que les deux écrans qui suppriment un achat
 * (Achats Carburant et le détail « Achats totaux » des Rapports Généraux) fassent
 * exactement la même chose : rétablir les cuves ET annuler les mouvements de
 * trésorerie de l'achat.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import type { Purchase, TreasuryTransaction } from '../store/AppContext';
import { supplierBalance, supplierStats } from './supplierDebt';

export interface TankDelta { tankId: string; deltaLiters: number }

/** Minimal shape of a cuve — only what a rollback message needs. */
interface TankLike { id: string; name?: string; type?: string; current?: number }

/**
 * Litres apportés par cet achat, cuve par cuve.
 * Les achats anciens ne portaient qu'un seul `tankId` sur l'entête : dans ce cas
 * tout le volume des lignes est attribué à cette cuve.
 */
export function tankQuantitiesOf(purchase: Pick<Purchase, 'items' | 'tankId'> | null | undefined): Record<string, number> {
  const byTank: Record<string, number> = {};
  const items = purchase?.items || [];
  items.forEach(i => {
    if (!i?.tankId) return;
    byTank[i.tankId] = (byTank[i.tankId] || 0) + (Number(i.quantity) || 0);
  });
  if (Object.keys(byTank).length === 0 && purchase?.tankId) {
    const total = items.reduce((s, i) => s + (Number(i?.quantity) || 0), 0);
    if (total > 0) byTank[purchase.tankId] = total;
  }
  return byTank;
}

/** Volume total de l'achat, toutes cuves confondues. */
export function litersOf(purchase: Pick<Purchase, 'items' | 'tankId'> | null | undefined): number {
  return Object.values(tankQuantitiesOf(purchase)).reduce((s, n) => s + n, 0);
}

/**
 * Deltas à appliquer aux cuves pour APPLIQUER l'achat (`sign = 1`) ou pour
 * l'ANNULER (`sign = -1`, suppression).
 */
export function tankDeltasOf(
  purchase: Pick<Purchase, 'items' | 'tankId'> | null | undefined,
  sign: 1 | -1,
): TankDelta[] {
  return Object.entries(tankQuantitiesOf(purchase))
    .map(([tankId, liters]) => ({ tankId, deltaLiters: sign * liters }))
    .filter(d => Math.abs(d.deltaLiters) > 0.0001);
}

/**
 * Deltas faisant passer les cuves de l'état `before` à l'état `after` — utilisé
 * à la modification d'un achat, où seule la différence doit être appliquée.
 */
export function tankDeltasBetween(
  before: Pick<Purchase, 'items' | 'tankId'> | null | undefined,
  after: Pick<Purchase, 'items' | 'tankId'> | null | undefined,
): TankDelta[] {
  const oldByTank = tankQuantitiesOf(before);
  const newByTank = tankQuantitiesOf(after);
  return Array.from(new Set([...Object.keys(oldByTank), ...Object.keys(newByTank)]))
    .map(tankId => ({ tankId, deltaLiters: (newByTank[tankId] || 0) - (oldByTank[tankId] || 0) }))
    .filter(d => Math.abs(d.deltaLiters) > 0.0001);
}

/**
 * Phrase lisible décrivant l'effet des deltas sur les cuves, pour les messages de
 * confirmation et les toasts : « Cuve 1 (Essence) : 12 000 L → 7 000 L ».
 */
export function describeTankDeltas(deltas: TankDelta[], tanks: TankLike[]): string {
  return deltas.map(d => {
    const tank = tanks.find(t => t.id === d.tankId);
    const name = tank ? `${tank.name || 'Cuve'}${tank.type ? ` (${tank.type})` : ''}` : 'Cuve';
    const before = Number(tank?.current) || 0;
    const after = Math.max(0, before + d.deltaLiters);
    return `${name} : ${before.toLocaleString('fr-FR')} L → ${after.toLocaleString('fr-FR')} L`;
  }).join(' · ');
}

/**
 * Supprime définitivement un achat carburant :
 *   1. les litres livrés sont RETIRÉS des cuves concernées ;
 *   2. les mouvements de trésorerie de l'achat sont annulés (l'argent revient
 *      dans la caisse / sur le compte bancaire) ;
 *   3. la dette du fournisseur est RECALCULÉE sans cet achat — sans quoi une
 *      facture impayée supprimée continuait d'être réclamée ;
 *   4. l'achat lui-même est supprimé.
 *
 * `app` doit porter `treasuryTransactions`, `purchases`, `suppliers` et
 * `deliveryNotes` : le solde fournisseur est reconstruit sur ces documents.
 * Retourne les deltas appliqués aux cuves pour que l'appelant puisse l'annoncer.
 */
export function deleteFuelPurchase(
  purchase: Purchase,
  app: { treasuryTransactions?: TreasuryTransaction[]; purchases?: any[]; suppliers?: any[]; deliveryNotes?: any[] },
  dispatch: (action: any) => void,
): TankDelta[] {
  const deltas = tankDeltasOf(purchase, -1);
  if (deltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: deltas });

  (app?.treasuryTransactions || [])
    .filter(t => t.refType === 'purchase' && t.refId === purchase.id)
    .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));

  const supplier = (app?.suppliers || []).find(s => s.id === purchase.supplierId);
  if (supplier) {
    const without = { ...app, purchases: (app?.purchases || []).filter(p => p.id !== purchase.id) };
    const balance = supplierBalance(without, supplier.id);
    const totalPurchases = supplierStats(without, supplier.id).totalPurchased;
    if (Math.abs((supplier.balance || 0) - balance) > 0.01
      || Math.abs((supplier.totalPurchases || 0) - totalPurchases) > 0.01) {
      dispatch({ type: 'UPDATE_SUPPLIER', payload: { ...supplier, balance, totalPurchases } });
    }
  }

  dispatch({ type: 'DELETE_PURCHASE', payload: purchase.id });
  return deltas;
}
