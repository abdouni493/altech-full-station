/**
 * ─── Vérification de l'activité Carburant ──────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement faussé l'application :
 *
 *   • la recette du carburant était lue dans `fuel_sales`, une table que plus
 *     aucun écran n'écrit : la vente à la pompe comptait pour ZÉRO dinar pendant
 *     que les achats, eux, comptaient pour leur montant entier — d'où le
 *     « Solde caisse −973 867,40 DA » ;
 *   • le solde de caisse retranchait le montant payé de CHAQUE achat, chèques et
 *     virements compris : de l'argent jamais passé par le tiroir creusait un
 *     découvert imaginaire ;
 *   • un règlement client en espèces n'entrait nulle part ;
 *   • le détail par carburant doit additionner EXACTEMENT le chiffre d'affaires
 *     affiché, sinon la carte « CA » et le tableau « ventes par produit » se
 *     contredisent à l'écran.
 *
 *   npx tsx src/lib/carburantSales.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { computeCarburantSales, computeCarburantCash, derivedPumpStats } from './carburantSales';
import {
  computeCarburantReport, computeModuleReport, moduleCaisseBalance, moduleCaisseMovements,
} from './bizReporting';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

const FROM = '2026-08-01', TO = '2026-08-31';

/**
 * Une station d'une brigade : 1 000 L de gasoil à 45 DA et 500 L d'essence à
 * 50 DA, soit 70 000 DA facturés. Le pompiste a rendu 50 000 DA en espèces,
 * 12 000 DA sont passés au TPE, 6 000 DA sont partis en bon client, et il
 * manque 2 000 DA.
 */
const app = {
  settings: {
    fuelPrices: { GASOIL: 45, ESSENCE: 50 },
    fuelBuyPrices: { GASOIL: 40, ESSENCE: 44 },
  },
  tanks: [
    { id: 'T1', name: 'Cuve 1', type: 'GASOIL', current: 10_000 },
    { id: 'T2', name: 'Cuve 2', type: 'ESSENCE', current: 4_000 },
  ],
  pumps: [{ id: 'P1', name: 'Pompe 1' }, { id: 'P2', name: 'Pompe 2' }],
  pumpNozzles: [],
  pompistes: [{ id: 'PO1', name: 'Ali' }],
  brigadeChefs: [{ id: 'C1', name: 'Karim' }],
  brigades: [{
    id: 'BR1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00.000Z',
    shift: 'Matin', chefId: 'C1', status: 'Clôturée',
  }],
  brigadeAccountings: [{
    id: 'A1', brigadeId: 'BR1', status: 'completed',
    totalDue: 70_000, cashReceived: 50_000, rest: 2_000,
    nozzleSummary: [
      { nozzleId: 'N1', pumpId: 'P1', pumpName: 'Pompe 1', fuelType: 'GASOIL', liters: 1_000, price: 45, revenue: 45_000 },
      { nozzleId: 'N2', pumpId: 'P2', pumpName: 'Pompe 2', fuelType: 'ESSENCE', liters: 500, price: 50, revenue: 25_000 },
    ],
    pompisteSummary: {
      PO1: { theoretical: 70_000, cashReceived: 50_000, justifTotal: 18_000, ecart: 2_000, litersSold: 1_500 },
    },
    justifications: [
      { id: 'J1', justificationType: 'TPE', amount: 12_000, bankAccountId: 'B1' },
      { id: 'J2', justificationType: 'CLIENT', amount: 6_000, clientId: 'CL1' },
    ],
  }],
  // Un achat de 100 000 DA : 30 000 réglés en espèces, 70 000 par chèque.
  purchases: [{
    id: 'PU1', date: '2026-08-12', supplierId: 'S1', invoiceNumber: 'F-1',
    total: 100_000, amountPaid: 100_000, rest: 0,
    items: [{ tankId: 'T1', productName: 'Gasoil', quantity: 2_500, buyPrice: 40, total: 100_000 }],
    payments: [
      { id: 'PY1', date: '2026-08-12', amount: 30_000, mode: 'ESPECES', accountId: 'CAISSE' },
      { id: 'PY2', date: '2026-08-12', amount: 70_000, mode: 'CHEQUE', accountId: 'B1' },
    ],
  }],
  // Les dépenses de la station : chacune imputée à l'activité qui la supporte.
  //   E1 — Carburant, en espèces  → sort de la caisse Carburant
  //   E2 — Carburant, par banque  → ne touche aucune caisse
  //   E3 — Cafétéria, en espèces  → sort de la caisse Cafétéria, PAS du Carburant
  //   E4 — Finance, en espèces    → sort de la caisse générale seule
  expenses: [
    { id: 'E1', date: '2026-08-15', amount: 5_000, category: 'Entretien', accountId: 'CAISSE_CARBURANT', part: 'carburant' },
    { id: 'E2', date: '2026-08-16', amount: 8_000, category: 'Loyer', accountId: 'B1', part: 'carburant' },
    { id: 'E3', date: '2026-08-17', amount: 1_500, category: 'Gaz', accountId: 'CAISSE_CAFETERIA', part: 'cafeteria' },
    { id: 'E4', date: '2026-08-18', amount: 2_000, category: 'Frais bancaires', accountId: 'CAISSE', part: 'systeme' },
  ],
  clients: [{
    id: 'CL1', name: 'Transport SARL', debt: 6_000,
    transactionHistory: [
      { id: 'TX1', date: '2026-08-20', type: 'PAYMENT', amount: 3_000, mode: 'ESPECES' },
      { id: 'TX2', date: '2026-08-21', type: 'PAYMENT', amount: 1_000, mode: 'CHEQUE' },
    ],
  }],
  suppliers: [{ id: 'S1', name: 'Naftal' }],
  bankAccounts: [{ id: 'B1', name: 'BNA', initialBalance: 0 }],
  shopSales: [],
  products: [],
  treasuryTransactions: [
    // 10 000 DA de la caisse Carburant versés en banque.
    { id: 'T5', date: '2026-08-25', kind: 'TRANSFER', amount: 10_000, accountFrom: 'CAISSE_CARBURANT', accountTo: 'B1', part: 'carburant' },
    // Un dépôt saisi dans la Caisse Générale, imputé au CARBURANT.
    { id: 'T6', date: '2026-08-26', kind: 'DEPOSIT', amount: 40_000, accountTo: 'CAISSE', part: 'carburant' },
    // Un retrait imputé au Carburant.
    { id: 'T7', date: '2026-08-27', kind: 'WITHDRAW', amount: 6_000, accountFrom: 'CAISSE', part: 'carburant' },
    // Un dépôt imputé à la CAFÉTÉRIA : il ne doit rien faire au Carburant.
    { id: 'T8', date: '2026-08-27', kind: 'DEPOSIT', amount: 9_000, accountTo: 'CAISSE', part: 'cafeteria' },
    // Un dépôt « Finance » : il reste dans la caisse générale, sans activité.
    { id: 'T9', date: '2026-08-27', kind: 'DEPOSIT', amount: 7_000, accountTo: 'CAISSE', part: 'systeme' },
    // Argent déplacé du coffre Carburant vers la caisse générale, toujours
    // imputé au Carburant : l'activité n'a rien gagné ni perdu.
    { id: 'T10', date: '2026-08-28', kind: 'TRANSFER', amount: 5_000, accountFrom: 'CAISSE_CARBURANT', accountTo: 'CAISSE', part: 'carburant' },
  ],
  pompisteDecalage: [],
};

console.log('\nLes brigades SONT la vente de carburant');
const sales = computeCarburantSales(app, FROM, TO);
check('une brigade sur la période', sales.counts.brigades, 1);
check("chiffre d'affaires", sales.revenue, 70_000);
check('litres vendus', sales.liters, 1_500);
check('coût des litres (1000×40 + 500×44)', sales.cost, 62_000);
check('espèces remises', sales.cash, 50_000);
check('TPE encaissé', sales.tpe, 12_000);
check('bons clients', sales.credit, 6_000);
check('manquant', sales.rest, 2_000);
check('encaissé = espèces + TPE', sales.collected, 62_000);

console.log('\nLe détail par carburant rend EXACTEMENT le total');
check('deux carburants', sales.byFuel.length, 2);
check('la somme des carburants = le CA',
  sales.byFuel.reduce((s, f) => s + f.revenue, 0), sales.revenue);
check('la somme des litres = le volume',
  sales.byFuel.reduce((s, f) => s + f.liters, 0), sales.liters);
check('gasoil : 1000 L à 45 DA', sales.byFuel.find(f => f.type === 'GASOIL')?.revenue, 45_000);

console.log('\nChaque pompe porte ses propres litres');
const perPump = derivedPumpStats(app, FROM, TO);
check('Pompe 1 — 1 000 L', perPump.P1?.liters, 1_000);
check('Pompe 2 — 500 L', perPump.P2?.liters, 500);

console.log('\nLa caisse ne compte que les ESPÈCES');
const cash = computeCarburantCash(app);
// 50 000 encaissés + 3 000 réglés en espèces par le client + 40 000 déposés
// − 30 000 d'achat en espèces − 5 000 de dépense en espèces
// − 10 000 virés en banque − 6 000 retirés.
check('solde de la caisse Carburant', cash.balance, 42_000);
check('espèces des brigades', cash.brigadeCash, 50_000);
check('règlements clients en espèces (le chèque est exclu)', cash.clientCash, 3_000);
check("l'achat réglé par chèque ne vide pas le tiroir", cash.purchasesCash, 30_000);
check('la dépense payée en banque non plus', cash.expensesCash, 5_000);
check('entrées − sorties = solde', cash.inflow - cash.outflow, cash.balance);

console.log("\nChaque activité paie ses dépenses avec SON argent");
check("la dépense de la Cafétéria ne vide pas la caisse Carburant",
  cash.lines.some(l => l.id === 'exp-E3'), false);
check("celle de la Finance non plus",
  cash.lines.some(l => l.id === 'exp-E4'), false);
check('seule la dépense Carburant en espèces y figure',
  cash.lines.filter(l => l.nature === 'Dépense').map(l => l.id), ['exp-E1']);

console.log("\nUne dépense justifiée SUR une brigade ne sort d'aucune caisse");
// Le pompiste l'a payée avec les espèces de la brigade : `cashReceived` est
// déjà plus bas d'autant. La retrancher ici sortirait le même argent deux fois.
const appBrigadeExp = {
  ...app,
  expenses: [
    ...app.expenses,
    {
      id: 'EB1', date: '2026-08-09', category: 'Entretien', amount: 7_000,
      description: 'Achat eau', part: 'carburant', accountId: 'CAISSE_CARBURANT',
      brigadeId: 'B1', brigadeJustificationId: 'EB1', pompisteId: 'P1',
    },
  ],
};
const cashBrigadeExp = computeCarburantCash(appBrigadeExp);
check('le solde de la caisse ne bouge pas', cashBrigadeExp.balance, cash.balance);
check("elle n'apparaît pas parmi les sorties de caisse",
  cashBrigadeExp.lines.some(l => l.id === 'exp-EB1'), false);

console.log("\nUn dépôt imputé à une activité entre bien dans SA caisse");
check('le dépôt Carburant est compté', cash.deposits, 40_000);
check('le retrait Carburant est compté', cash.withdrawals, 6_000);
check('le virement en banque vide la caisse', cash.transfers, -10_000);
check('le dépôt Cafétéria ne touche pas le Carburant',
  cash.lines.some(l => l.id === 'T8'), false);
check('le dépôt Finance non plus',
  cash.lines.some(l => l.id === 'T9'), false);
check("déplacer l'argent du coffre vers la caisse générale ne change rien",
  cash.lines.some(l => l.id === 'T10'), false);
check('chaque ligne se relit', cash.lines.reduce((s, l) => s + l.amount, 0), cash.balance);

console.log('\nLe rapport Carburant part des mêmes chiffres');
const r = computeCarburantReport(app, FROM, TO);
check("chiffre d'affaires du rapport", r.salesTotal, 70_000);
check('ventes encaissées', r.salesPaid, 62_000);
check('coût des marchandises vendues', r.cogs, 62_000);
check('marge brute', r.grossMargin, 8_000);
check('dépenses de la période', r.expensesTotal, 13_000);
check('gain net = marge − dépenses − salaires', r.netGain, 8_000 - 13_000);
check('le solde de caisse est CELUI de la Caisse Générale', r.caisseBalance, cash.balance);
check('une vente listée par brigade', r.counts.sales, 1);
check('le stock compte les CUVES (10 000×40 + 4 000×44)', r.stockValue, 576_000);
check('le solde se relit ligne à ligne',
  r.caisseMovements.reduce((s, m) => s + m.amount, 0), r.caisseBalance);

console.log('\nLes parties commerciales suivent la même règle');
/** Une cafétéria qui a vendu 2 000 DA et acheté 500 DA de marchandise. */
const cafeteria: any = {
  caisse: [{ id: 'C1', type: 'deposit', amount: 1_000, date: '2026-08-05' }],
  sales: [{ id: 'S1', ref: 'V-1', date: '2026-08-06', clientName: 'Comptoir', total: 2_000, paid: 2_000, rest: 0, items: [] }],
  reparations: [],
  purchases: [{ id: 'P1', ref: 'A-1', date: '2026-08-07', supplierName: 'Superette', total: 500, paid: 500, rest: 0, items: [] }],
  expenses: [],
  workers: [],
  products: [], clients: [], suppliers: [], destructions: [], productions: [], comptoir: [], fiches: [],
};
// 1 000 déposés + 2 000 encaissés − 500 d'achat = 2 500, puis les 9 000 du
// dépôt imputé à la Cafétéria depuis la Caisse Générale.
check('sans le grand livre : documents seuls',
  moduleCaisseBalance(cafeteria, 'cafeteria', []), 2_500);
check('le dépôt imputé à la Cafétéria entre dans sa caisse',
  moduleCaisseBalance(cafeteria, 'cafeteria', app.treasuryTransactions), 11_500);
check("le dépôt Carburant n'entre pas dans la Cafétéria",
  moduleCaisseMovements(cafeteria, 'cafeteria', app.treasuryTransactions).some(m => m.id === 'T6'), false);
check('le Lavage, lui, ne reçoit rien',
  moduleCaisseBalance({ ...cafeteria, caisse: [], sales: [], purchases: [] } as any, 'lavage', app.treasuryTransactions), 0);

console.log('\nLa dépense de la station imputée à une partie sort de SA caisse');
// Les 11 500 précédents, moins les 1 500 de la dépense E3 imputée à la Cafétéria.
check('E3 vide la caisse Cafétéria',
  moduleCaisseBalance(cafeteria, 'cafeteria', app.treasuryTransactions, app.expenses), 10_000);
check("les dépenses des autres activités ne l'atteignent pas",
  moduleCaisseMovements(cafeteria, 'cafeteria', app.treasuryTransactions, app.expenses)
    .filter(m => m.nature === 'Dépense').map(m => m.id), ['app-exp-E3']);
check('et elle pèse dans le rapport de la Cafétéria',
  computeModuleReport(cafeteria, 'cafeteria', FROM, TO, app.treasuryTransactions, app.expenses).expensesTotal,
  1_500);
check("le rapport Carburant ne la compte pas", r.expensesTotal, 13_000);

console.log("\nUne dépense de partie réglée par la banque ne vide pas le tiroir");
/** Même cafétéria, avec deux dépenses à elle : une en espèces, une en banque. */
const cafeteriaExp: any = {
  ...cafeteria,
  expenses: [
    { id: 'BX1', name: 'Café en grains', amount: 800, date: '2026-08-08', accountId: 'CAISSE_CAFETERIA' },
    { id: 'BX2', name: 'Assurance', amount: 3_000, date: '2026-08-09', accountId: 'B1' },
  ],
};
check('seule la dépense en espèces sort de la caisse',
  moduleCaisseBalance(cafeteriaExp, 'cafeteria', app.treasuryTransactions, app.expenses), 10_000 - 800);
check('les deux comptent dans le rapport de la partie',
  computeModuleReport(cafeteriaExp, 'cafeteria', FROM, TO, app.treasuryTransactions, app.expenses).expensesTotal,
  800 + 3_000 + 1_500);

// ─── Les salaires du personnel carburant sortent bien de SA caisse ───────────
// Le défaut : la Cafétéria et le Lavage retiraient les salaires de leurs
// employés de leur tiroir, le Carburant payait les siens avec un argent qui
// restait indéfiniment en caisse. Un salaire réglé par chèque, lui, ne touche
// pas les espèces ; un ACOMPTE est de l'argent déjà remis en main propre, et le
// salaire net l'a déjà déduit — les deux lignes ne comptent pas le même billet.
console.log("\nLe personnel carburant est payé avec l'argent de la caisse Carburant");
const appStaff = {
  ...app,
  pompistes: [{
    id: 'W1', name: 'Ali',
    paymentRecord: [
      { id: 'PR1', month: '2026-07', netSalary: 25_000, paymentDate: '2026-08-01', paymentMode: 'Espèces', isPaid: true },
      { id: 'PR2', month: '2026-08', netSalary: 30_000, paymentDate: '2026-08-28', paymentMode: 'Chèque', isPaid: true },
    ],
    acomptes: [{ id: 'AC1', date: '2026-08-15', amount: 4_000, description: 'Avance', isPaid: false }],
  }],
  brigadeChefs: [{
    id: 'W2', name: 'Karim',
    paymentRecord: [{ id: 'PR3', month: '2026-07', netSalary: 35_000, paymentDate: '2026-08-02', paymentMode: 'Espèces', isPaid: true }],
    acomptes: [],
  }],
};
const cashStaff = computeCarburantCash(appStaff);
check('les salaires réglés en espèces sortent du tiroir', cashStaff.salariesCash, 25_000 + 35_000);
check('le salaire réglé par chèque ne le touche pas',
  cashStaff.lines.some(l => l.id === 'sal-PR2'), false);
check("l'acompte remis en main propre sort aussi", cashStaff.acomptesCash, 4_000);
check('le solde en tient compte', cashStaff.balance, cash.balance - 25_000 - 35_000 - 4_000);
check('chaque ligne se relit toujours',
  cashStaff.lines.reduce((s, l) => s + l.amount, 0), cashStaff.balance);

console.log("\nLes acomptes d'une partie commerciale suivent la même règle");
const cafeteriaStaff: any = {
  ...cafeteria,
  workers: [{
    id: 'BW1', name: 'Nadia',
    payments: [{ id: 'BP1', period: '2026-07', amount: 20_000, date: '2026-08-03' }],
    acomptes: [{ id: 'BA1', date: '2026-08-10', amount: 2_000, description: 'Avance', paid: false }],
    absences: [],
  }],
};
check('salaire ET acompte vident le tiroir de la partie',
  moduleCaisseBalance(cafeteriaStaff, 'cafeteria', app.treasuryTransactions, app.expenses),
  10_000 - 20_000 - 2_000);

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
