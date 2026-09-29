/**
 * ─── Le mode de règlement d'un client, jusque dans le rapport ─────────────────
 *
 * Le rapport général savait dire QUI avait payé et COMBIEN, jamais PAR QUEL
 * MOYEN. Deux clients ayant versé la même somme s'affichaient à l'identique,
 * que l'un ait posé des billets sur le comptoir et l'autre signé un chèque
 * encaissé trois semaines plus tard — alors que seul le premier a rempli le
 * tiroir. Trois choses à vérifier :
 *
 *   • chaque règlement de la période porte son mode, en clair ;
 *   • les ESPÈCES se comptent en CLIENTS, pas en pièces : un client venu régler
 *     trois fois dans le mois reste un seul client ;
 *   • et un chèque ne fait toujours PAS monter la caisse — la liste des
 *     règlements et le solde du tiroir ne parlent pas du même argent.
 *
 *   npx tsx src/lib/clientPaymentModes.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  clientPaymentsOf, clientCashSummary, clientPaymentsByMode, computeCarburantReport,
} from './bizReporting';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

const app: any = {
  settings: { fuelBuyPrices: {} },
  clients: [
    {
      id: 'C1', name: 'Transport Nord', transactionHistory: [
        { id: 't1', type: 'PAYMENT', date: '2026-09-03', amount: 40000, mode: 'ESPECES', receiptNumber: 'R-1' },
        { id: 't2', type: 'PAYMENT', date: '2026-09-17', amount: 10000, mode: 'ESPECES' },
        { id: 't3', type: 'PAYMENT', date: '2026-08-02', amount: 90000, mode: 'ESPECES' }, // hors période
      ],
    },
    {
      id: 'C2', name: 'Garage Sud', transactionHistory: [
        { id: 't4', type: 'PAYMENT', date: '2026-09-09', amount: 200000, mode: 'CHEQUE', receiptNumber: 'CH-77' },
        { id: 't5', type: 'RECHARGE', date: '2026-09-10', amount: 50000, mode: 'ESPECES' },
      ],
    },
    {
      id: 'C3', name: 'Taxi Ouest', transactionHistory: [
        { id: 't6', type: 'PAYMENT', date: '2026-09-11', amount: 15000, mode: 'TPE' },
        { id: 't7', type: 'CREDIT', date: '2026-09-12', amount: 7000 }, // une consommation, pas un règlement
      ],
    },
  ],
  tanks: [], products: [], suppliers: [], purchases: [], expenses: [],
  brigades: [], brigadeAccountings: [], treasuryTransactions: [],
  pompistes: [], brigadeChefs: [], gerants: [], magasinWorkers: [],
};

const FROM = '2026-09-01', TO = '2026-09-30';

console.log("Chaque règlement de la période porte son mode");
{
  const rows = clientPaymentsOf(app, FROM, TO);
  check('5 règlements retenus sur la période', rows.length, 5);
  check('la consommation à crédit n\'est pas un règlement', rows.filter(r => r.clientId === 'C3').length, 1);
  check('le règlement d\'août est hors période', rows.some(r => r.date === '2026-08-02'), false);
  const cheque = rows.find(r => r.id === 'pay-t4');
  check('le chèque est nommé', cheque?.modeLabel, 'Chèque');
  check('le chèque garde sa référence', cheque?.reference, 'CH-77');
  check('la recharge est distinguée du règlement', rows.find(r => r.id === 'rec-t5')?.kind, 'Recharge');
  check('le TPE est nommé', rows.find(r => r.id === 'pay-t6')?.modeLabel, 'Carte / TPE');
  check('la liste est du plus récent au plus ancien', rows[0].date, '2026-09-17');
}

console.log("Les espèces se comptent en CLIENTS, pas en pièces");
{
  const rows = clientPaymentsOf(app, FROM, TO);
  const cash = clientCashSummary(rows);
  check('2 clients ont payé en espèces', cash.clients, 2);
  check('3 règlements en espèces', cash.payments, 3);
  check('100 000 DA encaissés en billets', cash.total, 100000);

  const byMode = clientPaymentsByMode(rows);
  check('le chèque est le plus gros mode', byMode[0].label, 'Chèque');
  check('le total du chèque', byMode[0].total, 200000);
  check('les espèces comptent 2 clients', byMode.find(m => m.label === 'Espèces')?.clients, 2);
}

console.log("Un chèque ne remplit pas le tiroir");
{
  const r = computeCarburantReport(app, FROM, TO);
  check('le rapport porte les règlements de la période', r.clientPayments.length, 5);
  // La caisse ne retient que les espèces : 40 000 + 10 000 + 50 000 (recharge),
  // plus les 90 000 d'août — le SOLDE couvre toutes les dates.
  check('le tiroir ne voit que les espèces', r.caisseBalance, 190000);
  const modes = new Set(r.caisseMovements.map(m => m.mode).filter(Boolean));
  check('chaque ligne de client porte son mode', [...modes], ['ESPECES']);
  check('aucun chèque en caisse', r.caisseMovements.some(m => m.label.includes('Garage Sud') && m.amount === 200000), false);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
process.exit(failed ? 1 : 0);
