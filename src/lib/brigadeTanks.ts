/**
 * ─── Brigades — ce que la brigade retire des cuves ──────────────────────────────
 *
 * Le niveau d'une cuve n'a que deux sources légitimes :
 *
 *   • un ACHAT CARBURANT le fait MONTER (`lib/fuelPurchase.ts`) ;
 *   • une BRIGADE le fait BAISSER — des litres du volume débité par ses
 *     pistolets, et de rien d'autre.
 *
 * Jusqu'ici la clôture d'une brigade ÉCRASAIT le niveau avec une valeur absolue
 * déduite de la jauge saisie en degrés. Sans table de conversion renseignée, la
 * conversion degrés → litres rendait 0 : toutes les cuves tombaient à zéro à la
 * première brigade, et les litres livrés par les achats disparaissaient au
 * rechargement suivant. Le niveau est désormais ajusté par DELTA, comme pour les
 * achats — jamais réécrit en valeur absolue.
 *
 * La jauge saisie garde son rôle : elle sert au calcul du décalage (comparaison
 * entre ce que les pistolets ont débité et ce que la cuve a réellement perdu),
 * mais elle ne pilote plus le stock.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import type { Pump, PumpNozzle } from '../store/AppContext';
import { nozzleTankId } from '../store/AppContext';
import type { TankDelta } from './fuelPurchase';

/** Les seules données d'une brigade dont dépend la consommation des cuves. */
export interface BrigadeNozzleRefs {
  startNozzleIndices?: Record<string, number>;
  endNozzleIndices?: Record<string, number>;
}

/**
 * Litres débités pendant la brigade, cuve par cuve : pour chaque pistolet, la
 * différence entre son index de fin et son index de début, portée au crédit de
 * la cuve à laquelle il est raccordé. Un index de fin inférieur à l'index de
 * début (saisie erronée) compte pour zéro — un pistolet ne remplit pas la cuve.
 */
export function brigadeTankConsumption(
  brigade: BrigadeNozzleRefs | null | undefined,
  nozzles: PumpNozzle[],
  pumps: Pump[],
): Record<string, number> {
  const byTank: Record<string, number> = {};
  if (!brigade) return byTank;
  const starts = brigade.startNozzleIndices || {};
  const ends = brigade.endNozzleIndices || {};
  for (const nozzle of nozzles) {
    const start = starts[nozzle.id];
    const end = ends[nozzle.id];
    if (start === undefined || end === undefined) continue;
    const liters = Math.max(0, (Number(end) || 0) - (Number(start) || 0));
    if (liters <= 0) continue;
    const tankId = nozzleTankId(nozzle, pumps);
    if (!tankId) continue;
    byTank[tankId] = (byTank[tankId] || 0) + liters;
  }
  return byTank;
}

/** Volume total retiré des cuves par la brigade, toutes cuves confondues. */
export function brigadeLiters(
  brigade: BrigadeNozzleRefs | null | undefined,
  nozzles: PumpNozzle[],
  pumps: Pump[],
): number {
  return Object.values(brigadeTankConsumption(brigade, nozzles, pumps)).reduce((s, n) => s + n, 0);
}

/**
 * Deltas à appliquer aux cuves pour passer de l'état `before` à l'état `after`.
 *
 *   • création    → `before = null` : la consommation entière est RETIRÉE ;
 *   • modification → seule la DIFFÉRENCE des deux consommations est appliquée ;
 *   • suppression → `after = null` : les litres sont RENDUS aux cuves.
 *
 * Les consommations étant retranchées, le delta rendu est l'opposé de l'écart.
 */
export function brigadeTankDeltas(
  before: BrigadeNozzleRefs | null | undefined,
  after: BrigadeNozzleRefs | null | undefined,
  nozzles: PumpNozzle[],
  pumps: Pump[],
): TankDelta[] {
  const usedBefore = brigadeTankConsumption(before, nozzles, pumps);
  const usedAfter = brigadeTankConsumption(after, nozzles, pumps);
  return Array.from(new Set([...Object.keys(usedBefore), ...Object.keys(usedAfter)]))
    .map(tankId => ({
      tankId,
      // Consommer RETIRE : un surcroît de consommation est un delta négatif.
      deltaLiters: (usedBefore[tankId] || 0) - (usedAfter[tankId] || 0),
    }))
    .filter(d => Math.abs(d.deltaLiters) > 0.0001);
}
