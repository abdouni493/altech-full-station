/**
 * ─── Cuves — ce que les documents ont fait passer par chaque cuve ───────────────
 *
 * `tanks.current` est LE niveau : il ne bouge que par delta (achat +, brigade −)
 * via la RPC `adjust_tank_level`, appelée au moment même où l'achat est
 * enregistré ou la brigade clôturée. Le niveau suit donc les documents sans
 * qu'on ait jamais à le « réaligner » après coup.
 *
 * Ce module ne recalcule plus un niveau concurrent : il donne seulement le
 * DÉTAIL du mouvement — combien d'achats sont entrés, combien les brigades ont
 * débité — pour que la carte d'une cuve explique son contenu sans obliger à
 * ouvrir l'historique.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import type { Brigade, DeliveryNote, Pump, PumpNozzle, Purchase, Tank } from '../store/AppContext';
import { brigadeTankConsumption } from './brigadeTanks';
import { tankQuantitiesOf } from './fuelPurchase';

/** Les collections dont dépend le mouvement d'une cuve. */
export interface TankLedgerSource {
  purchases?: Purchase[];
  deliveryNotes?: DeliveryNote[];
  brigades?: Brigade[];
  pumpNozzles?: PumpNozzle[];
  pumps?: Pump[];
}

/** Le mouvement d'une cuve, décomposé pièce par pièce. */
export interface TankLedger {
  /** Litres livrés par les achats carburant. */
  purchased: number;
  /** Litres livrés par les anciens bons de livraison (écran remplacé). */
  delivered: number;
  /** Litres débités par les pistolets pendant les brigades. */
  consumed: number;
}

/**
 * Litres apportés à chaque cuve par un bon de livraison. Un BL peut alimenter
 * plusieurs cuves via ses `items` ; les BL anciens ne portent qu'un `tankId` et
 * un volume uniques. Un BL rattaché à un achat n'est PAS compté : ses litres
 * sont déjà ceux de l'achat, les additionner doublerait la livraison.
 */
function deliveryQuantitiesOf(note: DeliveryNote): Record<string, number> {
  const byTank: Record<string, number> = {};
  const items = note.items || [];
  if (items.length > 0) {
    items.forEach(i => {
      if (!i?.tankId) return;
      byTank[i.tankId] = (byTank[i.tankId] || 0) + (Number(i.liters) || 0);
    });
    return byTank;
  }
  if (note.tankId && (Number(note.liters) || 0) > 0) byTank[note.tankId] = Number(note.liters) || 0;
  return byTank;
}

/**
 * Le mouvement de TOUTES les cuves, en un seul passage sur les documents —
 * l'écran Cuves en affiche cinq ou dix, il ne doit pas relire les achats une
 * fois par cuve.
 */
export function tankLedgers(tanks: Tank[], data: TankLedgerSource): Record<string, TankLedger> {
  const purchased: Record<string, number> = {};
  const delivered: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  (data.purchases || []).forEach(p => {
    Object.entries(tankQuantitiesOf(p)).forEach(([tankId, liters]) => {
      purchased[tankId] = (purchased[tankId] || 0) + liters;
    });
  });

  // Les BL déjà facturés par un achat sont ignorés : l'achat les porte déjà.
  const billedNoteIds = new Set(
    (data.purchases || []).map(p => p.linkedDeliveryNoteId).filter(Boolean) as string[]);
  (data.deliveryNotes || []).forEach(note => {
    if (billedNoteIds.has(note.id)) return;
    Object.entries(deliveryQuantitiesOf(note)).forEach(([tankId, liters]) => {
      delivered[tankId] = (delivered[tankId] || 0) + liters;
    });
  });

  const nozzles = data.pumpNozzles || [];
  const pumps = data.pumps || [];
  (data.brigades || []).forEach(b => {
    Object.entries(brigadeTankConsumption(b, nozzles, pumps)).forEach(([tankId, liters]) => {
      consumed[tankId] = (consumed[tankId] || 0) + liters;
    });
  });

  const out: Record<string, TankLedger> = {};
  tanks.forEach(t => {
    out[t.id] = {
      purchased: purchased[t.id] || 0,
      delivered: delivered[t.id] || 0,
      consumed: consumed[t.id] || 0,
    };
  });
  return out;
}
