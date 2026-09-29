/**
 * ─── Brigades — le calcul, écrit UNE seule fois ────────────────────────────────
 *
 * Fiche de brigade, écran Brigades, comptabilité, détail, rapport journalier :
 * cinq écrans montraient les mêmes chiffres, chacun avec sa propre arithmétique.
 * Ils ne tombaient pas d'accord, pour trois raisons :
 *
 *   1. LE PRIX ÉTAIT PRIS SUR LA POMPE. `Pump.type` n'est qu'un MIROIR du premier
 *      pistolet (`Pumps.tsx > syncPumpFromNozzles`). Une pompe qui porte un
 *      pistolet gasoil et un pistolet essence facturait donc TOUT au premier
 *      carburant — et quand la pompe n'avait pas de type, un littéral `'SUPER'`
 *      ou `'DIESEL'` prenait le relais, inventant un prix. Ici, chaque pistolet
 *      est valorisé au carburant de SA PROPRE cuve (`nozzleTankId`), et un
 *      pistolet sans cuve est signalé (`missingFuelType`) au lieu d'être deviné.
 *
 *   2. LE REGROUPEMENT PASSAIT PAR LES PISTES. Les pistes ont été retirées de
 *      l'application : `Pump.trackId` n'est plus jamais écrit et le wizard
 *      enregistre `trackId: ''`. Tout regroupement « par piste » rendait donc une
 *      liste VIDE — d'où une fiche sans détail par pistolet et un récapitulatif
 *      financier à zéro. Le regroupement se fait désormais par POMPISTE, via
 *      `brigade.pompistePumpAssignments`, avec repli sur les pistes pour les
 *      brigades anciennes.
 *
 *   3. LES SIGNES SE CONTREDISAIENT. Le décalage valait `nozzleDiff - cuveDiff`
 *      ici et `cuveDiff - nozzleDiff` là : les mêmes litres s'affichaient en
 *      retour-cuve sur un écran et en vente-directe sur l'autre. La convention
 *      est fixée une fois pour toutes ci-dessous.
 *
 * Convention de décalage, valable partout :
 *
 *     cuveDiff   = niveau début − niveau fin     (ce que la CUVE a perdu)
 *     nozzleDiff = Σ (index fin − index début)   (ce que les PISTOLETS ont débité)
 *     difference = nozzleDiff − cuveDiff
 *
 *       difference > 0 → les pistolets ont débité plus que la cuve n'a baissé
 *                        → RETOUR_CUVE
 *       difference < 0 → la cuve a baissé plus que les pistolets n'ont débité
 *                        → VENTE_DIRECTE
 *
 * Une cuve dont la jauge de fin n'a PAS été relevée (`measured === false`) n'a
 * rien à comparer : son décalage vaut 0 et elle est marquée non relevée, pour ne
 * pas transformer chaque litre vendu en faux retour-cuve.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import type {
  Brigade, Pump, PumpNozzle, Tank, Pompiste, StationSettings, FuelType,
} from '../store/AppContext';
import { nozzleTankId, pumpsInCreationOrder, nozzlesInCreationOrder } from '../store/AppContext';

/**
 * Un index saisi à la main arrive parfois en `NaN` (`parseFloat("12,")`) ou en
 * chaîne (JSON de la base). `NaN` traverse `??` sans être arrêté et contamine
 * ensuite tous les totaux — le théorique, les écarts, la caisse. Toute valeur
 * qui entre dans un calcul de brigade passe donc par ici.
 */
export const toNum = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Tout ce dont le calcul d'une brigade a besoin, hors la brigade elle-même. */
export interface BrigadeCalcContext {
  pumps: Pump[];
  tanks: Tank[];
  pumpNozzles: PumpNozzle[];
  pompistes: Pompiste[];
  settings: StationSettings;
}

/** Une ligne = un pistolet sur une brigade. */
export interface BrigadeNozzleRow {
  nozzle: PumpNozzle;
  pump?: Pump;
  tank?: Tank;
  /** Carburant de la CUVE du pistolet — jamais celui de la pompe. */
  fuelType?: FuelType;
  /** Pistolet raccordé à aucune cuve : son prix est inconnu, pas supposé. */
  missingFuelType: boolean;
  startIdx: number;
  endIdx: number;
  /** Écart signé — négatif = saisie incohérente (index de fin sous celui de début). */
  rawDelta: number;
  /** Litres retenus pour la vente : jamais négatifs. */
  liters: number;
  /** Index de fin sous l'index de début : la ligne est à corriger. */
  inverted: boolean;
  price: number;
  amount: number;
}

/** Le carburant d'un pistolet, tiré de SA cuve (repli : la cuve de sa pompe). */
export function nozzleFuelType(
  nozzle: PumpNozzle, pumps: Pump[], tanks: Tank[],
): FuelType | undefined {
  const tankId = nozzleTankId(nozzle, pumps);
  return tanks.find(t => t.id === tankId)?.type;
}

/**
 * Les pistolets qui comptent pour cette brigade, dans l'ordre d'affichage
 * (pompes de la plus ancienne à la plus récente, pistolets dans leur ordre de
 * création). Priorité aux pistolets explicitement retenus par la brigade, puis
 * à ceux dont un index de début a été relevé ; les pistes ne servent plus qu'aux
 * brigades enregistrées avant leur retrait.
 */
export function brigadeActiveNozzles(
  brigade: Pick<Brigade, 'activeNozzleIds' | 'startNozzleIndices' | 'startIndices' | 'pompisteAssignments' | 'pompistePumpAssignments'>,
  ctx: Pick<BrigadeCalcContext, 'pumps' | 'pumpNozzles'>,
): PumpNozzle[] {
  const { pumps, pumpNozzles } = ctx;

  const pick = (nozzles: PumpNozzle[]) => {
    const byPump = new Map<string, PumpNozzle[]>();
    nozzles.forEach(n => {
      const list = byPump.get(n.pumpId) || [];
      list.push(n);
      byPump.set(n.pumpId, list);
    });
    const ordered: PumpNozzle[] = [];
    pumpsInCreationOrder(pumps).forEach(p => {
      const list = byPump.get(p.id);
      if (list) { ordered.push(...nozzlesInCreationOrder(list)); byPump.delete(p.id); }
    });
    // Pistolets dont la pompe a disparu : conservés en fin de liste plutôt
    // qu'escamotés — leurs litres appartiennent quand même à la brigade.
    byPump.forEach(list => ordered.push(...nozzlesInCreationOrder(list)));
    return ordered;
  };

  const activeIds = brigade.activeNozzleIds || [];
  if (activeIds.length > 0) {
    const wanted = new Set(activeIds);
    return pick(pumpNozzles.filter(n => wanted.has(n.id)));
  }

  const startIndices = brigade.startNozzleIndices || {};
  if (Object.keys(startIndices).length > 0) {
    return pick(pumpNozzles.filter(n => startIndices[n.id] !== undefined));
  }

  // Brigades d'avant les index par pistolet : on repart des pompes relevées.
  const legacyPumpIds = new Set(Object.keys(brigade.startIndices || {}));
  const legacyTrackIds = (brigade.pompisteAssignments || [])
    .filter(a => a.present && a.trackId)
    .map(a => a.trackId);
  if (legacyTrackIds.length > 0) {
    pumps.filter(p => p.trackId && legacyTrackIds.includes(p.trackId))
      .forEach(p => legacyPumpIds.add(p.id));
  }
  if (legacyPumpIds.size === 0) return pick(pumpNozzles);
  return pick(pumpNozzles.filter(n => legacyPumpIds.has(n.pumpId)));
}

/**
 * Index de début / de fin d'un pistolet sur une brigade. Le repli sur l'index de
 * la POMPE ne vaut que pour les brigades antérieures aux index par pistolet ; à
 * défaut de tout relevé de fin, le pistolet n'a rien débité (fin = début).
 */
export function nozzleIndices(
  brigade: Pick<Brigade, 'startNozzleIndices' | 'endNozzleIndices' | 'startIndices' | 'endIndices'>,
  nozzle: PumpNozzle,
  endOverride?: number,
): { startIdx: number; endIdx: number } {
  const rawStart = brigade.startNozzleIndices?.[nozzle.id];
  const startIdx = rawStart !== undefined && rawStart !== null
    ? toNum(rawStart)
    : toNum(brigade.startIndices?.[nozzle.pumpId], toNum(nozzle.startIndex));

  if (endOverride !== undefined && endOverride !== null && Number.isFinite(endOverride)) {
    return { startIdx, endIdx: toNum(endOverride, startIdx) };
  }
  const rawEnd = brigade.endNozzleIndices?.[nozzle.id];
  const endIdx = rawEnd !== undefined && rawEnd !== null
    ? toNum(rawEnd, startIdx)
    : toNum(brigade.endIndices?.[nozzle.pumpId], startIdx);

  return { startIdx, endIdx };
}

/**
 * Les lignes par pistolet de la brigade : index relevés, litres débités, et le
 * montant au prix du carburant PROPRE à ce pistolet.
 *
 * `endOverrides` permet aux écrans de comptabilité de rejouer le calcul avec un
 * index de fin corrigé, sans dupliquer l'arithmétique.
 */
export function brigadeNozzleRows(
  brigade: Brigade,
  ctx: BrigadeCalcContext,
  endOverrides?: Record<string, number | undefined>,
): BrigadeNozzleRow[] {
  const { pumps, tanks, settings } = ctx;
  return brigadeActiveNozzles(brigade, ctx).map(nozzle => {
    const pump = pumps.find(p => p.id === nozzle.pumpId);
    const tank = tanks.find(t => t.id === nozzleTankId(nozzle, pumps));
    const fuelType = tank?.type;
    const { startIdx, endIdx } = nozzleIndices(brigade, nozzle, endOverrides?.[nozzle.id]);
    const rawDelta = endIdx - startIdx;
    const liters = Math.max(0, rawDelta);
    const price = fuelType ? toNum(settings.fuelPrices?.[fuelType]) : 0;
    return {
      nozzle, pump, tank, fuelType,
      missingFuelType: !fuelType,
      startIdx, endIdx, rawDelta, liters,
      inverted: rawDelta < -0.0001,
      price,
      amount: liters * price,
    };
  });
}

/** Un carburant, tel qu'il pèse dans un regroupement de pistolets. */
export interface BrigadeFuelLine {
  fuelType: FuelType | 'INCONNU';
  liters: number;
  price: number;
  amount: number;
  nozzleCount: number;
}

/** Répartition par carburant d'un lot de lignes — le détail que réclame la fiche. */
export function fuelBreakdown(rows: BrigadeNozzleRow[]): BrigadeFuelLine[] {
  const byFuel = new Map<string, BrigadeFuelLine>();
  rows.forEach(r => {
    const key = r.fuelType || 'INCONNU';
    const line = byFuel.get(key) || {
      fuelType: key as FuelType | 'INCONNU', liters: 0, price: r.price, amount: 0, nozzleCount: 0,
    };
    line.liters += r.liters;
    line.amount += r.amount;
    line.nozzleCount += 1;
    // Prix affiché : celui du carburant. Il est identique pour toutes les lignes
    // d'un même carburant, sauf prix manquant — on garde alors le premier connu.
    if (!line.price && r.price) line.price = r.price;
    byFuel.set(key, line);
  });
  return [...byFuel.values()].sort((a, b) => b.amount - a.amount);
}

/** Une pompe, avec ses pistolets et son détail par carburant. */
export interface BrigadePumpGroup {
  pump?: Pump;
  nozzles: BrigadeNozzleRow[];
  byFuel: BrigadeFuelLine[];
  totalLiters: number;
  totalAmount: number;
}

/** Un pompiste, avec les pompes qu'il tenait sur cette brigade. */
export interface BrigadePompisteGroup {
  pompisteId: string;
  pompiste?: Pompiste;
  /** Nom affichable, y compris pour le lot « non attribué ». */
  name: string;
  present: boolean;
  /** Lot fourre-tout des pistolets rattachés à aucun pompiste. */
  unassigned: boolean;
  pumps: BrigadePumpGroup[];
  nozzles: BrigadeNozzleRow[];
  byFuel: BrigadeFuelLine[];
  totalLiters: number;
  totalAmount: number;
  /** Théorique enregistré sur la brigade ; à défaut, le montant recalculé. */
  theoretical: number;
  /** Vrai quand le théorique vient du recalcul et non de la brigade. */
  theoreticalRecomputed: boolean;
  collected: number;
  justified: number;
  /** Théorique − espèces − justifié : ce qui manque encore. */
  ecart: number;
}

const groupPumps = (rows: BrigadeNozzleRow[], pumps: Pump[]): BrigadePumpGroup[] => {
  const byPump = new Map<string, BrigadeNozzleRow[]>();
  rows.forEach(r => {
    const key = r.pump?.id || r.nozzle.pumpId || '_';
    byPump.set(key, [...(byPump.get(key) || []), r]);
  });
  const order = pumpsInCreationOrder(pumps).map(p => p.id);
  return [...byPump.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib);
    })
    .map(([pumpId, nozzles]) => ({
      pump: pumps.find(p => p.id === pumpId),
      nozzles,
      byFuel: fuelBreakdown(nozzles),
      totalLiters: nozzles.reduce((s, r) => s + r.liters, 0),
      totalAmount: nozzles.reduce((s, r) => s + r.amount, 0),
    }));
};

/**
 * Les pistolets rangés par pompiste, puis par pompe, puis par carburant.
 *
 * Les pompes tenues par un pompiste viennent de `pompistePumpAssignments` ; pour
 * les brigades d'avant le retrait des pistes, on retombe sur la piste du
 * pompiste. Les pistolets qui ne se rattachent à personne ne sont pas jetés :
 * ils forment un lot « Non attribué », sans quoi leurs litres disparaîtraient du
 * récapitulatif financier sans que rien ne le signale.
 */
export function brigadePompisteGroups(
  brigade: Brigade,
  ctx: BrigadeCalcContext,
  rows: BrigadeNozzleRow[],
  justifiedByPompiste: Record<string, number> = {},
): BrigadePompisteGroup[] {
  const { pumps, pompistes } = ctx;
  const assignments = brigade.pompisteAssignments || [];

  /** Pompes tenues par un pompiste : assignations directes, sinon la piste. */
  const pumpIdsOf = (pompisteId: string): string[] => {
    const direct = (brigade.pompistePumpAssignments || [])
      .find(a => a.pompisteId === pompisteId)?.pumpIds;
    if (direct && direct.length > 0) return direct;
    const trackId = assignments.find(a => a.pompisteId === pompisteId)?.trackId
      || pompistes.find(p => p.id === pompisteId)?.trackId;
    if (!trackId) return [];
    return pumps.filter(p => p.trackId === trackId).map(p => p.id);
  };

  // Ordre : celui des assignations de la brigade, en repli sur pompisteIds.
  const orderedIds: string[] = [];
  assignments.forEach(a => { if (!orderedIds.includes(a.pompisteId)) orderedIds.push(a.pompisteId); });
  (brigade.pompisteIds || []).forEach(id => { if (!orderedIds.includes(id)) orderedIds.push(id); });

  const claimed = new Set<string>();
  const groups: BrigadePompisteGroup[] = orderedIds.map(pompisteId => {
    const assignment = assignments.find(a => a.pompisteId === pompisteId);
    const present = assignment ? assignment.present : true;
    const pumpIds = new Set(pumpIdsOf(pompisteId));
    const mine = rows.filter(r => {
      const pumpId = r.pump?.id || r.nozzle.pumpId;
      if (!pumpIds.has(pumpId) || claimed.has(r.nozzle.id)) return false;
      claimed.add(r.nozzle.id);
      return true;
    });
    const pompiste = pompistes.find(p => p.id === pompisteId);
    const totalAmount = mine.reduce((s, r) => s + r.amount, 0);
    const stored = brigade.pompisteData?.[pompisteId];
    // Le théorique enregistré fait foi : il tient compte des retours-cuve
    // déduits à la clôture. Sans lui, on retombe sur le montant recalculé.
    const hasStored = stored?.theoretical !== undefined && stored?.theoretical !== null;
    const theoretical = hasStored ? toNum(stored!.theoretical) : totalAmount;
    const collected = toNum(stored?.totalCollected);
    const justified = toNum(justifiedByPompiste[pompisteId]);
    return {
      pompisteId,
      pompiste,
      name: pompiste?.name || (assignment?.chefActingAsPompiste ? 'Chef (pompiste)' : '—'),
      present,
      unassigned: false,
      pumps: groupPumps(mine, pumps),
      nozzles: mine,
      byFuel: fuelBreakdown(mine),
      totalLiters: mine.reduce((s, r) => s + r.liters, 0),
      totalAmount,
      theoretical,
      theoreticalRecomputed: !hasStored,
      collected,
      justified,
      ecart: theoretical - collected - justified,
    };
  });

  const orphans = rows.filter(r => !claimed.has(r.nozzle.id) && r.liters > 0);
  if (orphans.length > 0) {
    const totalAmount = orphans.reduce((s, r) => s + r.amount, 0);
    groups.push({
      pompisteId: '_unassigned',
      pompiste: undefined,
      name: 'Non attribué',
      present: true,
      unassigned: true,
      pumps: groupPumps(orphans, pumps),
      nozzles: orphans,
      byFuel: fuelBreakdown(orphans),
      totalLiters: orphans.reduce((s, r) => s + r.liters, 0),
      totalAmount,
      theoretical: totalAmount,
      theoreticalRecomputed: true,
      collected: 0,
      justified: 0,
      ecart: totalAmount,
    });
  }

  return groups;
}

export type DecalageType = 'CORRECT' | 'RETOUR_CUVE' | 'VENTE_DIRECTE';

/** Comparaison cuve / pistolets pour une cuve. */
export interface BrigadeTankRow {
  tank: Tank;
  startDeg: number;
  startL: number;
  endDeg: number;
  endL: number;
  /** Jauge de fin réellement relevée ? Sinon rien n'est comparable. */
  measured: boolean;
  /** Litres perdus par la cuve d'après la jauge. */
  cuveDiff: number;
  /** Litres débités par les pistolets de CETTE cuve. */
  nozzleDiff: number;
  /** `nozzleDiff − cuveDiff` — voir la convention en tête de fichier. */
  difference: number;
  amount: number;
  type: DecalageType;
  /** Écart sous le seuil, ou cas désactivé dans les réglages : rien à signaler. */
  suppressed: boolean;
}

/**
 * Le décalage cuve par cuve. Les pistolets sont rattachés à leur cuve par
 * `nozzleTankId` — et non par la cuve de leur pompe, qui n'est qu'un miroir du
 * PREMIER pistolet et attribuait donc à la mauvaise cuve tous les pistolets
 * d'une pompe qui en sert plusieurs.
 */
export function brigadeTankRows(
  brigade: Brigade,
  ctx: BrigadeCalcContext,
  rows: BrigadeNozzleRow[],
): BrigadeTankRow[] {
  const { tanks, settings } = ctx;
  const posSeuil = toNum(settings.decalagePositifSeuil);
  const negSeuil = toNum(settings.decalageNegatifSeuil);
  const venteDirecteActif = settings.decalagePositifActif !== false;
  const retourCuveActif = settings.decalageNegatifActif !== false;

  return tanks
    .filter(t => brigade.startTankLevels?.[t.id] !== undefined)
    .map(t => {
      const start = brigade.startTankLevels![t.id];
      const end = brigade.endTankLevels?.[t.id];
      const startL = toNum(start?.liters);
      const endL = toNum(end?.liters);
      // `measured` absent = brigade enregistrée avant le drapeau : on la traite
      // comme un relevé, c'était alors toujours le cas.
      const measured = end?.measured !== false && end !== undefined;
      const cuveDiff = startL - endL;
      const nozzleDiff = rows
        .filter(r => r.tank?.id === t.id)
        .reduce((s, r) => s + r.liters, 0);
      const difference = measured ? nozzleDiff - cuveDiff : 0;
      const price = toNum(settings.fuelPrices?.[t.type]);

      let type: DecalageType = 'CORRECT';
      let suppressed = !measured;
      if (difference > 0) {
        if (retourCuveActif && difference >= (negSeuil || 0.000001)) { type = 'RETOUR_CUVE'; suppressed = false; }
        else suppressed = true;
      } else if (difference < 0) {
        if (venteDirecteActif && Math.abs(difference) >= (posSeuil || 0.000001)) { type = 'VENTE_DIRECTE'; suppressed = false; }
        else suppressed = true;
      }

      return {
        tank: t,
        startDeg: toNum(start?.degrees),
        startL,
        endDeg: toNum(end?.degrees),
        endL,
        measured,
        cuveDiff,
        nozzleDiff,
        difference,
        amount: Math.abs(difference) * price,
        type,
        suppressed,
      };
    });
}

/** Totaux d'une brigade — la seule addition dont les écrans ont besoin. */
export interface BrigadeTotals {
  liters: number;
  /** Montant recalculé depuis les index, au prix de chaque carburant. */
  computedAmount: number;
  theoretical: number;
  collected: number;
  justified: number;
  /** Théorique − espèces − justifié. */
  netBalance: number;
  byFuel: BrigadeFuelLine[];
}

export function brigadeTotals(
  rows: BrigadeNozzleRow[],
  groups: BrigadePompisteGroup[],
): BrigadeTotals {
  const liters = rows.reduce((s, r) => s + r.liters, 0);
  const computedAmount = rows.reduce((s, r) => s + r.amount, 0);
  const theoretical = groups.reduce((s, g) => s + g.theoretical, 0);
  const collected = groups.reduce((s, g) => s + g.collected, 0);
  const justified = groups.reduce((s, g) => s + g.justified, 0);
  return {
    liters, computedAmount, theoretical, collected, justified,
    netBalance: theoretical - collected - justified,
    byFuel: fuelBreakdown(rows),
  };
}

/** Total justifié par pompiste, depuis les justifications d'une comptabilité. */
export function justifiedByPompiste(
  justifications: Array<{ pompisteId?: string; amount?: number }> | undefined,
): Record<string, number> {
  const map: Record<string, number> = {};
  (justifications || []).forEach(j => {
    const key = j.pompisteId || '_unassigned';
    map[key] = (map[key] || 0) + toNum(j.amount);
  });
  return map;
}
