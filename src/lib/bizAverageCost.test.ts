/**
 * ─── Vérification du coût moyen pondéré ────────────────────────────────────────
 * Le calcul du CUMP décide de la valeur du stock et de la marge affichée sur
 * chaque vente : une erreur ici se propage partout et ne se voit qu'au bilan.
 * Ces cas se rejouent sans navigateur ni base :
 *
 *   npx tsx src/lib/bizAverageCost.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  weightedAverageCost, snapshotFor, reverseAverageCost, effectiveAvgCost, roundCost,
} from './bizAverageCost';

let failed = 0;
let passed = 0;

function check(label: string, actual: number, expected: number, tolerance = 0.001) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { passed++; console.log(`  ✓ ${label}  → ${actual}`); }
  else { failed++; console.error(`  ✗ ${label}  → attendu ${expected}, obtenu ${actual}`); }
}

const product = (currentQty: number, averageCost?: number, purchasePrice = 0) =>
  ({ currentQty, averageCost, purchasePrice });

console.log('\nTest 1 — 100 × 100 DA puis 50 × 130 DA');
{
  const snap = snapshotFor(product(100, 100), 50, 130);
  check('nouveau coût moyen', snap.resultAvgCost, 110);
  check('stock après', snap.resultStockQty, 150);
  check("ce n'est PAS la moyenne des prix (115)", snap.resultAvgCost === 115 ? 1 : 0, 0);
}

console.log('\nTest 2 — stock vide puis 100 × 150 DA');
{
  const snap = snapshotFor(product(0), 100, 150);
  check('coût moyen = prix payé', snap.resultAvgCost, 150);
  check('stock après', snap.resultStockQty, 100);
}

console.log('\nTest 3 — 200 à 80 DA puis 100 × 120 DA');
{
  const snap = snapshotFor(product(200, 80), 100, 120);
  check('coût moyen', snap.resultAvgCost, 93.333);
  check('stock après', snap.resultStockQty, 300);
}

console.log('\nTest 4 — plusieurs produits sur une même facture (chacun pour soi)');
{
  const a = snapshotFor(product(0), 100, 100);
  const b = snapshotFor(product(50, 150), 50, 250);
  const c = snapshotFor(product(10, 500), 20, 500);
  check('produit A', a.resultAvgCost, 100);
  check('produit B', b.resultAvgCost, 200);
  check('produit C (même prix ⇒ inchangé)', c.resultAvgCost, 500);
}

console.log('\nTest 5 — trois achats successifs du même produit');
{
  const s1 = snapshotFor(product(0), 100, 100);
  check('après achat 1', s1.resultAvgCost, 100);
  const s2 = snapshotFor(product(s1.resultStockQty, s1.resultAvgCost), 50, 130);
  check('après achat 2', s2.resultAvgCost, 110);
  const s3 = snapshotFor(product(s2.resultStockQty, s2.resultAvgCost), 50, 160);
  check('après achat 3', s3.resultAvgCost, 122.5);
  check('stock final', s3.resultStockQty, 200);
}

console.log('\nTest 6 — prix et quantités décimaux');
{
  const snap = snapshotFor(product(10, 100.25), 5.5, 110.75);
  const expected = (10 * 100.25 + 5.5 * 110.75) / 15.5;
  check('coût moyen décimal', snap.resultAvgCost, roundCost(expected));
  const third = snapshotFor(product(2, 100), 1, 116.125);
  check('trois décimales conservées', third.resultAvgCost, 105.375);
}

console.log('\nTest 7 — annulation de la réception');
{
  // 100 à 100 DA, puis 50 à 130 DA ⇒ 150 à 110 DA. On annule la seconde.
  const back = reverseAverageCost(150, 110, { purchaseQty: 50, purchaseUnitCost: 130, prevAvgCost: 100 });
  check('stock repris', back.qty, 100);
  check('coût moyen revenu', back.avgCost, 100);

  // Reprise qui viderait le stock : on retombe sur le coût moyen d'avant.
  const empty = reverseAverageCost(50, 110, { purchaseQty: 50, purchaseUnitCost: 130, prevAvgCost: 100 });
  check('stock vidé → coût précédent', empty.avgCost, 100);
}

console.log('\nTest 8 — cas limites qui ne doivent JAMAIS produire de valeur absurde');
{
  check('quantité reçue nulle', weightedAverageCost(100, 100, 0, 130), 100);
  check('quantité reçue négative', weightedAverageCost(100, 100, -10, 130), 100);
  check('stock négatif (vente à découvert) → repart du prix payé', weightedAverageCost(-5, 100, 15, 130), 130);
  check('coût précédent absent', weightedAverageCost(100, 0, 50, 130), 130 * 50 / 150);
  check('tout à zéro', weightedAverageCost(0, 0, 0, 0), 0);
  check('valeurs non numériques', weightedAverageCost(NaN as any, undefined as any, 10, 50), 50);
  check('repli sur le prix d\'achat quand averageCost est absent',
    effectiveAvgCost({ averageCost: undefined, purchasePrice: 77 }), 77);
  const negStock = snapshotFor(product(-5, 100), 15, 130);
  check('stock réel reste le vrai (−5 + 15)', negStock.resultStockQty, 10);
}

console.log('\nTest 9 — une vieille facture garde ses chiffres');
{
  // La photo figée sur la ligne ne dépend d'aucun état courant : elle est
  // recopiée telle quelle, quels que soient les achats venus après.
  const invoice1 = snapshotFor(product(0), 100, 100);
  const invoice2 = snapshotFor(product(100, 100), 50, 130);
  const invoice3 = snapshotFor(product(150, 110), 50, 160);
  check('facture 1 inchangée', invoice1.resultAvgCost, 100);
  check('facture 2 inchangée', invoice2.resultAvgCost, 110);
  check('facture 3', invoice3.resultAvgCost, 122.5);
}

console.log(`\n${passed} vérification(s) réussie(s), ${failed} échec(s).\n`);
process.exit(failed === 0 ? 0 : 1);
