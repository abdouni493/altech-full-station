/**
 * ─── Vérification du calcul des brigades ───────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement faussé la fiche :
 *
 *   • deux pistolets d'une MÊME pompe, sur deux carburants différents, doivent
 *     être facturés chacun à SON prix — la pompe n'a pas de carburant propre ;
 *   • le regroupement doit tenir sans piste (elles ont été retirées) ;
 *   • une saisie illisible ne doit pas propager NaN dans les totaux ;
 *   • le décalage garde partout le même signe : pistolets − cuve ;
 *   • une cuve sans jauge de fin relevée n'invente pas de décalage.
 *
 *   npx tsx src/lib/brigadeCalc.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  toNum, brigadeNozzleRows, brigadePompisteGroups, brigadeTankRows, brigadeTotals, fuelBreakdown,
} from './brigadeCalc';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

// ─── Décor : une pompe qui sert DEUX carburants ────────────────────────────────
const tanks: any[] = [
  { id: 'cuve-gasoil', name: 'Cuve Gasoil', type: 'GASOIL', capacity: 30000, current: 20000, degrees: 0, alertThreshold: 0 },
  { id: 'cuve-essence', name: 'Cuve Essence', type: 'ESSENCE', capacity: 20000, current: 15000, degrees: 0, alertThreshold: 0 },
];
// `tankId`/`type` de la pompe ne reflètent que son PREMIER pistolet : c'est
// exactement le miroir trompeur qui faisait tout facturer au même carburant.
const pumps: any[] = [
  { id: 'pompe-1', number: 'P01', name: 'Pompe 1', tankId: 'cuve-gasoil', type: 'GASOIL', lastIndex: 0, status: 'Actif', createdAt: '2026-01-01' },
  { id: 'pompe-2', number: 'P02', name: 'Pompe 2', tankId: 'cuve-essence', type: 'ESSENCE', lastIndex: 0, status: 'Actif', createdAt: '2026-01-02' },
];
const pumpNozzles: any[] = [
  { id: 'p1-gasoil', pumpId: 'pompe-1', name: 'P1 Gasoil', tankId: 'cuve-gasoil', lastIndex: 0, startIndex: 0, status: 'Actif', createdAt: '2026-01-01' },
  { id: 'p1-essence', pumpId: 'pompe-1', name: 'P1 Essence', tankId: 'cuve-essence', lastIndex: 0, startIndex: 0, status: 'Actif', createdAt: '2026-01-01' },
  { id: 'p2-essence', pumpId: 'pompe-2', name: 'P2 Essence', tankId: 'cuve-essence', lastIndex: 0, startIndex: 0, status: 'Actif', createdAt: '2026-01-02' },
];
const pompistes: any[] = [
  { id: 'pmp-a', name: 'Ali' },
  { id: 'pmp-b', name: 'Karim' },
];
const settings: any = {
  fuelPrices: { GASOIL: 29, ESSENCE: 45, SUPER: 60, GPL: 9, DIESEL: 29 },
  decalagePositifSeuil: 0, decalageNegatifSeuil: 0,
};
const ctx: any = { pumps, tanks, pumpNozzles, pompistes, settings };

/** Brigade type : Ali tient la pompe 1, Karim la pompe 2. Aucune piste. */
const brigade: any = {
  id: 'brg-1', date: '2026-08-15', shift: 'Matin', chefId: 'chef-1',
  status: 'Clôturée', isActive: false,
  activeNozzleIds: ['p1-gasoil', 'p1-essence', 'p2-essence'],
  startNozzleIndices: { 'p1-gasoil': 1000, 'p1-essence': 500, 'p2-essence': 2000 },
  endNozzleIndices:   { 'p1-gasoil': 1100, 'p1-essence': 560, 'p2-essence': 2080 },
  startTankLevels: {
    'cuve-gasoil':  { degrees: 100, liters: 20000 },
    'cuve-essence': { degrees: 80,  liters: 15000 },
  },
  endTankLevels: {
    'cuve-gasoil':  { degrees: 99, liters: 19900, measured: true },
    'cuve-essence': { degrees: 79, liters: 14860, measured: true },
  },
  pompisteAssignments: [
    { pompisteId: 'pmp-a', trackId: '', present: true },
    { pompisteId: 'pmp-b', trackId: '', present: true },
  ],
  pompistePumpAssignments: [
    { pompisteId: 'pmp-a', pumpIds: ['pompe-1'] },
    { pompisteId: 'pmp-b', pumpIds: ['pompe-2'] },
  ],
};

console.log('\nTest 1 — la différence des index, pistolet par pistolet');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  check('trois pistolets relevés', rows.length, 3);
  const g = rows.find(r => r.nozzle.id === 'p1-gasoil')!;
  const e = rows.find(r => r.nozzle.id === 'p1-essence')!;
  check('P1 gasoil : 1100 − 1000', g.liters, 100);
  check('P1 essence : 560 − 500', e.liters, 60);
  check('aucun index inversé', rows.filter(r => r.inverted).length, 0);
}

console.log('\nTest 2 — chaque pistolet à SON carburant, dans la MÊME pompe');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  const g = rows.find(r => r.nozzle.id === 'p1-gasoil')!;
  const e = rows.find(r => r.nozzle.id === 'p1-essence')!;
  check('le pistolet gasoil est en GASOIL', g.fuelType, 'GASOIL');
  // Le bug : la pompe étant typée GASOIL, ce pistolet était facturé à 29.
  check('le pistolet essence de la même pompe est en ESSENCE', e.fuelType, 'ESSENCE');
  check('gasoil : 100 L × 29', g.amount, 2900);
  check('essence : 60 L × 45', e.amount, 2700);
  check('la pompe 1 ne mélange pas les prix', g.price !== e.price, true);
}

console.log('\nTest 3 — un pistolet sans cuve n\'a pas de prix inventé');
{
  const orphan = { id: 'p3', pumpId: 'pompe-3', name: 'Orphelin', lastIndex: 0, startIndex: 0, status: 'Actif' };
  const localCtx: any = { ...ctx, pumpNozzles: [...pumpNozzles, orphan] };
  const b = { ...brigade,
    activeNozzleIds: [...brigade.activeNozzleIds, 'p3'],
    startNozzleIndices: { ...brigade.startNozzleIndices, p3: 10 },
    endNozzleIndices: { ...brigade.endNozzleIndices, p3: 40 } };
  const row = brigadeNozzleRows(b, localCtx).find(r => r.nozzle.id === 'p3')!;
  check('litres bien comptés', row.liters, 30);
  // Avant : un littéral 'SUPER'/'DIESEL' donnait un montant plausible mais faux.
  check('carburant signalé comme manquant', row.missingFuelType, true);
  check('montant nul plutôt qu\'inventé', row.amount, 0);
}

console.log('\nTest 4 — regroupement par pompiste, sans aucune piste');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  const groups = brigadePompisteGroups(brigade, ctx, rows);
  check('deux pompistes', groups.length, 2);
  const ali = groups.find(g => g.pompisteId === 'pmp-a')!;
  const karim = groups.find(g => g.pompisteId === 'pmp-b')!;
  check('Ali : 100 L gasoil + 60 L essence', ali.totalLiters, 160);
  check('Ali : 2900 + 2700', ali.totalAmount, 5600);
  check('Ali sert deux carburants', ali.byFuel.length, 2);
  check('Karim : 80 L essence', karim.totalLiters, 80);
  check('Karim : 80 × 45', karim.totalAmount, 3600);
  check('aucun lot « non attribué »', groups.filter(g => g.unassigned).length, 0);
}

console.log('\nTest 5 — aucun litre ne disparaît du total');
{
  // Karim perd son affectation : ses litres doivent rester visibles quelque part,
  // au lieu de s'évaporer du récapitulatif financier.
  const b = { ...brigade, pompistePumpAssignments: [{ pompisteId: 'pmp-a', pumpIds: ['pompe-1'] }] };
  const rows = brigadeNozzleRows(b, ctx);
  const groups = brigadePompisteGroups(b, ctx, rows);
  const orphanGroup = groups.find(g => g.unassigned)!;
  check('un lot « non attribué » apparaît', !!orphanGroup, true);
  check('il porte les 80 L orphelins', orphanGroup.totalLiters, 80);
  const totals = brigadeTotals(rows, groups);
  check('le total garde les 240 L', totals.liters, 240);
  check('le total garde les 9200 DA', totals.computedAmount, 9200);
}

console.log('\nTest 6 — le décalage : pistolets − cuve, partout le même signe');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  const tankRows = brigadeTankRows(brigade, ctx, rows);
  const gasoil = tankRows.find(t => t.tank.id === 'cuve-gasoil')!;
  const essence = tankRows.find(t => t.tank.id === 'cuve-essence')!;
  check('cuve gasoil : 20000 − 19900', gasoil.cuveDiff, 100);
  check('pistolets gasoil : 100 L', gasoil.nozzleDiff, 100);
  check('gasoil équilibré', gasoil.difference, 0);
  check('gasoil CORRECT', gasoil.type, 'CORRECT');
  // La cuve essence a perdu 140 L, les pistolets n'en ont débité que 60 + 80.
  check('cuve essence : 15000 − 14860', essence.cuveDiff, 140);
  check('pistolets essence : 60 + 80', essence.nozzleDiff, 140);
  check('essence équilibrée', essence.difference, 0);
}

console.log('\nTest 7 — retour cuve et vente directe ne s\'inversent pas');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  // Les pistolets ont débité PLUS que la cuve n'a baissé → retour cuve.
  const retour = brigadeTankRows(
    { ...brigade, endTankLevels: { ...brigade.endTankLevels, 'cuve-gasoil': { degrees: 99, liters: 19950, measured: true } } },
    ctx, rows).find(t => t.tank.id === 'cuve-gasoil')!;
  check('écart +50 (pistolets > cuve)', retour.difference, 50);
  check('classé RETOUR_CUVE', retour.type, 'RETOUR_CUVE');
  check('valorisé 50 × 29', retour.amount, 1450);

  // La cuve a baissé PLUS que les pistolets n'ont débité → vente directe.
  const vente = brigadeTankRows(
    { ...brigade, endTankLevels: { ...brigade.endTankLevels, 'cuve-gasoil': { degrees: 98, liters: 19850, measured: true } } },
    ctx, rows).find(t => t.tank.id === 'cuve-gasoil')!;
  check('écart −50 (cuve > pistolets)', vente.difference, -50);
  check('classé VENTE_DIRECTE', vente.type, 'VENTE_DIRECTE');
}

console.log('\nTest 8 — sans jauge de fin, aucun décalage inventé');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  const b = { ...brigade, endTankLevels: {
    'cuve-gasoil':  { degrees: 100, liters: 19900, measured: false },
    'cuve-essence': { degrees: 80,  liters: 14860, measured: false },
  } };
  const tankRows = brigadeTankRows(b, ctx, rows);
  check('cuve marquée non relevée', tankRows[0].measured, false);
  check('écart forcé à 0', tankRows[0].difference, 0);
  check('aucune alerte levée', tankRows.filter(t => !t.suppressed).length, 0);
}

console.log('\nTest 9 — une saisie illisible ne contamine pas les totaux');
{
  // `parseFloat("12,")` rend NaN, et NaN traverse `??` sans être arrêté : il
  // effaçait litres, théorique et écart de caisse d'un bout à l'autre.
  const b = { ...brigade, endNozzleIndices: { ...brigade.endNozzleIndices, 'p1-gasoil': NaN } };
  const rows = brigadeNozzleRows(b, ctx);
  const g = rows.find(r => r.nozzle.id === 'p1-gasoil')!;
  check('index illisible → retombe sur le début', g.endIdx, 1000);
  check('litres à 0, pas NaN', g.liters, 0);
  const totals = brigadeTotals(rows, brigadePompisteGroups(b, ctx, rows));
  check('total finis', Number.isFinite(totals.computedAmount), true);
  check('total = essence seule (2700 + 3600)', totals.computedAmount, 6300);

  check('toNum sur NaN', toNum(NaN, 7), 7);
  check('toNum sur une chaîne JSON', toNum('1234.5'), 1234.5);
  check('toNum sur null', toNum(null, 3), 3);
  check('toNum sur du texte', toNum('abc', 1), 1);
}

console.log('\nTest 10 — index de fin sous l\'index de début');
{
  const b = { ...brigade, endNozzleIndices: { ...brigade.endNozzleIndices, 'p1-gasoil': 900 } };
  const g = brigadeNozzleRows(b, ctx).find(r => r.nozzle.id === 'p1-gasoil')!;
  check('litres ramenés à 0', g.liters, 0);
  check('écart brut conservé', g.rawDelta, -100);
  // Signalé, et non ramené à 0 en silence : la saisie est à corriger.
  check('ligne marquée inversée', g.inverted, true);
}

console.log('\nTest 11 — ventilation par carburant');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  const byFuel = fuelBreakdown(rows);
  check('deux carburants', byFuel.length, 2);
  const essence = byFuel.find(f => f.fuelType === 'ESSENCE')!;
  const gasoil = byFuel.find(f => f.fuelType === 'GASOIL')!;
  check('essence : 60 + 80 L', essence.liters, 140);
  check('essence : 140 × 45', essence.amount, 6300);
  check('essence sur deux pistolets', essence.nozzleCount, 2);
  check('gasoil : 100 L', gasoil.liters, 100);
  check('gasoil : 100 × 29', gasoil.amount, 2900);
  const totals = brigadeTotals(rows, brigadePompisteGroups(brigade, ctx, rows));
  check('la somme des carburants fait le total', essence.amount + gasoil.amount, totals.computedAmount);
}

console.log('\nTest 12 — le théorique enregistré fait foi sur le recalcul');
{
  const rows = brigadeNozzleRows(brigade, ctx);
  // Le théorique de clôture tient compte des retours-cuve déduits : il ne doit
  // pas être écrasé par un recalcul brut des index.
  const b = { ...brigade, pompisteData: {
    'pmp-a': { litersSold: 160, theoretical: 5000, collected: { cash: 4800, bons: 0, cheques: 0 }, totalCollected: 4800, decalage: -200, pricePerLiter: 31.25 },
  } };
  const groups = brigadePompisteGroups(b, ctx, rows, { 'pmp-a': 100 });
  const ali = groups.find(g => g.pompisteId === 'pmp-a')!;
  check('théorique repris de la brigade', ali.theoretical, 5000);
  check('marqué comme non recalculé', ali.theoreticalRecomputed, false);
  check('espèces reprises', ali.collected, 4800);
  check('écart = 5000 − 4800 − 100', ali.ecart, 100);
  const karim = groups.find(g => g.pompisteId === 'pmp-b')!;
  check('sans donnée enregistrée, on recalcule', karim.theoreticalRecomputed, true);
  check('Karim recalculé à 3600', karim.theoretical, 3600);
}

console.log('\nTest 13 — brigade ancienne : repli sur les pistes');
{
  const legacyPumps: any[] = [
    { id: 'lp1', number: 'L1', name: 'Legacy 1', tankId: 'cuve-gasoil', type: 'GASOIL', trackId: 'piste-1', lastIndex: 0, status: 'Actif' },
  ];
  const legacyNozzles: any[] = [
    { id: 'ln1', pumpId: 'lp1', name: 'LN1', lastIndex: 0, startIndex: 0, status: 'Actif' },
  ];
  const legacyCtx: any = { ...ctx, pumps: legacyPumps, pumpNozzles: legacyNozzles };
  const legacy: any = {
    id: 'old', date: '2025-01-01', status: 'Clôturée',
    startNozzleIndices: { ln1: 500 }, endNozzleIndices: { ln1: 700 },
    pompisteAssignments: [{ pompisteId: 'pmp-a', trackId: 'piste-1', present: true }],
    startTankLevels: {}, endTankLevels: {},
  };
  const rows = brigadeNozzleRows(legacy, legacyCtx);
  check('le pistolet est retrouvé', rows.length, 1);
  // Sans cuve propre, il hérite de celle de sa pompe (`nozzleTankId`).
  check('carburant hérité de la pompe', rows[0].fuelType, 'GASOIL');
  check('200 L × 29', rows[0].amount, 5800);
  const groups = brigadePompisteGroups(legacy, legacyCtx, rows);
  check('rattaché par sa piste', groups[0].totalLiters, 200);
  check('aucun orphelin', groups.filter(g => g.unassigned).length, 0);
}

console.log(`\n${passed} vérification(s) réussie(s), ${failed} échec(s).\n`);
process.exit(failed === 0 ? 0 : 1);
