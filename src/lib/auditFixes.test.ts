/**
 * Les corrections de décalages trouvées par l'audit (tests/audit) — chacune
 * protégée par un cas.
 *
 *   npx tsx src/lib/auditFixes.test.ts
 */
import { within, localDayKey } from './period';
import { pompisteCashOf } from './brigadeCalc';
import { consolidate } from './bizReporting';
import { financeCashBalance } from '../store/AppContext';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001 : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

console.log('1. Période : journées locales, mêmes bornes partout');
check('un jour « AAAA-MM-JJ » est lui-même', localDayKey('2026-11-06'), '2026-11-06');
check('un jour saisi puis converti en ISO garde sa date', localDayKey('2026-11-06T00:00:00.000Z'), '2026-11-06');
check('le premier jour est inclus', within('2026-11-01', '2026-11-01', '2026-11-30'), true);
check('le dernier jour est inclus', within('2026-11-30', '2026-11-01', '2026-11-30'), true);
check('le lendemain est exclu', within('2026-12-01', '2026-11-01', '2026-11-30'), false);
const late = new Date(2026, 10, 30, 23, 30).toISOString();
check('23 h 30 le dernier jour (heure locale) est inclus', within(late, '2026-11-01', '2026-11-30'), true);
const early = new Date(2026, 10, 1, 0, 30).toISOString();
check('00 h 30 le premier jour (heure locale) est inclus', within(early, '2026-11-01', '2026-11-30'), true);

console.log('2. Espèces d\'un pompiste : les bons ne sont pas comptés deux fois');
const rec = { collected: { cash: 900, bons: 100, cheques: 0 }, totalCollected: 1000 };
check('bons justifiés à part ⇒ seules les espèces', pompisteCashOf(rec, 100), 900);
check('ancienne clôture sans justification ⇒ bons encaissés', pompisteCashOf(rec, 0), 1000);
check('récapitulatif de l\'assistant (cashReceived)', pompisteCashOf({ cashReceived: 750 }, 50), 750);

console.log('3. Rapports Généraux : les dépenses de la Finance pèsent dans le résultat');
const part: any = { salesTotal: 1000, purchasesTotal: 0, purchasesPaid: 0, expensesTotal: 100, salariesPaid: 0, cogs: 400, grossMargin: 600,
  clientDebtTotal: 0, clientAdvanceTotal: 0, supplierDebtTotal: 0, stockValue: 0, destroyedValue: 0, lossValue: 0, netGain: 500,
  returnsTotal: 0, refundedTotal: 0, restockedCost: 0, stockAlerts: [], expiryAlerts: [],
  counts: { products: 0, clients: 0, suppliers: 0, sales: 0, purchases: 0, workers: 0, returns: 0 } };
const g = consolidate([part], '', '', [{ id: 'e', amount: 60 }]);
check('dépenses = parties + Finance', g.expensesTotal, 160);
check('gain net = parties − Finance', g.netGain, 440);

console.log('4. Caisse Finance : seulement les lignes sans activité');
const txs: any[] = [
  { id: '1', kind: 'DEPOSIT', amount: 200, accountTo: 'CAISSE', part: 'systeme' },
  { id: '2', kind: 'TRANSFER', amount: 40, accountFrom: 'CAISSE_CAFETERIA', accountTo: 'CAISSE', part: 'cafeteria' },
  { id: '3', kind: 'EXPENSE', amount: 30, accountFrom: 'CAISSE', part: 'systeme' },
];
check('200 déposés − 30 dépensés (le dépôt de la cafétéria reste à elle)', financeCashBalance(txs), 170);

console.log(`\n${passed} cas passés, ${failed} en échec.`);
if (failed) process.exitCode = 1;
