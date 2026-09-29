/**
 * ─── L'INDEX VIVANT D'UN PISTOLET ─────────────────────────────────────────────
 *
 * `pump_nozzles.last_index` n'est pas une donnée de brigade : c'est le compteur
 * du pistolet, tel qu'il tourne aujourd'hui sur la piste. Il sert d'index de
 * DÉPART à la prochaine brigade, et rien d'autre ne le lit.
 *
 * La clôture d'une brigade y recopiait son index de fin — sans jamais demander
 * de QUELLE brigade il s'agissait. Rouvrir une brigade ancienne pour corriger un
 * versement ou une justification faisait alors RECULER les vingt pistolets sur
 * les index de ce jour-là : la brigade suivante repartait d'un compteur du
 * passé, et toutes les différences (litres, théorique, écart de caisse) étaient
 * fausses tant que personne ne remettait les index à la main.
 *
 * La règle tient en une phrase : **seule la DERNIÈRE brigade à avoir relevé un
 * pistolet détient son index vivant**. Une brigade antérieure rouverte reste
 * libre de corriger tout le reste — pompistes, horaires, espèces, bons — mais ne
 * déplace plus le compteur.
 *
 * Le même module sert à RÉPARER : `nozzleIndexFixes` compare le compteur de
 * chaque pistolet à l'index de fin de sa dernière brigade et rend la liste des
 * écarts, que l'écran Brigades propose de corriger d'un bouton.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import type { PumpNozzle } from '../store/AppContext';

/** Les seuls champs d'une brigade dont dépend l'index vivant d'un pistolet. */
export interface BrigadeIndexRef {
  id: string;
  date?: string;
  createdAt?: string;
  startDatetime?: string;
  startTimestamp?: string;
  endDatetime?: string;
  endTimestamp?: string;
  endNozzleIndices?: Record<string, number>;
}

/**
 * L'instant qui classe les brigades entre elles. Les index se CHAÎNENT dans
 * l'ordre de saisie — chaque brigade part du compteur laissé par la précédente —
 * donc `created_at` fait foi, avec les replis qui gardent leur place aux fiches
 * anciennes (même ordre que la liste de l'écran Brigades).
 */
export function brigadeIndexOrder(b: BrigadeIndexRef): number {
  const raw = b.createdAt || b.endDatetime || b.endTimestamp
    || b.startDatetime || b.startTimestamp || b.date;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Un index de fin réellement relevé (une saisie illisible n'en est pas un). */
function readEnd(b: BrigadeIndexRef, nozzleId: string): number | null {
  const raw = b.endNozzleIndices?.[nozzleId];
  if (raw === undefined || raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * La brigade qui détient l'index vivant d'un pistolet : la plus récente à en
 * avoir relevé un index de fin. `null` quand aucune ne l'a jamais relevé — le
 * compteur n'appartient alors à personne, et la première qui le relève le prend.
 */
export function nozzleIndexOwner(
  brigades: BrigadeIndexRef[],
  nozzleId: string,
): BrigadeIndexRef | null {
  let owner: BrigadeIndexRef | null = null;
  let ownerOrder = -Infinity;
  for (const b of brigades) {
    if (readEnd(b, nozzleId) === null) continue;
    const order = brigadeIndexOrder(b);
    if (order > ownerOrder) { owner = b; ownerOrder = order; }
  }
  return owner;
}

/**
 * Cette brigade a-t-elle le droit de déplacer le compteur de ce pistolet ?
 * Vrai pour la dernière brigade qui l'a relevé — et pour un pistolet que
 * personne n'a encore relevé.
 */
export function ownsNozzleIndex(
  brigades: BrigadeIndexRef[],
  brigadeId: string,
  nozzleId: string,
): boolean {
  const owner = nozzleIndexOwner(brigades, nozzleId);
  return !owner || owner.id === brigadeId;
}

/** Un pistolet dont le compteur ne correspond plus à sa dernière brigade. */
export interface NozzleIndexFix {
  nozzleId: string;
  nozzleName: string;
  pumpId: string;
  /** Ce que porte `pump_nozzles.last_index` aujourd'hui. */
  current: number;
  /** L'index de fin relevé par la dernière brigade — la valeur attendue. */
  expected: number;
  /** Écart signé : négatif quand le compteur a reculé. */
  drift: number;
  brigadeId: string;
  brigadeDate?: string;
}

/**
 * Les écarts à corriger, pistolet par pistolet. Un pistolet qu'aucune brigade
 * n'a relevé n'entre pas dans la liste : il n'existe aucune valeur de référence
 * à lui opposer, et l'écraser ferait perdre l'index posé à la main sur l'écran
 * Pompes.
 */
export function nozzleIndexFixes(
  brigades: BrigadeIndexRef[],
  nozzles: PumpNozzle[],
  tolerance = 0.001,
): NozzleIndexFix[] {
  const fixes: NozzleIndexFix[] = [];
  for (const n of nozzles) {
    const owner = nozzleIndexOwner(brigades, n.id);
    if (!owner) continue;
    const expected = readEnd(owner, n.id);
    if (expected === null) continue;
    const current = Number(n.lastIndex) || 0;
    if (Math.abs(current - expected) <= tolerance) continue;
    fixes.push({
      nozzleId: n.id, nozzleName: n.name, pumpId: n.pumpId,
      current, expected, drift: expected - current,
      brigadeId: owner.id, brigadeDate: owner.date,
    });
  }
  return fixes;
}
