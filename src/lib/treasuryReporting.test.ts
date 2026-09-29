/**
 * ─── Vérification du rapport de trésorerie ─────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement faussé le rapport :
 *
 *   • un achat réglé, une dépense payée et une brigade clôturée écrivent DÉJÀ
 *     leur ligne au grand livre : les recompter depuis leur document doublait
 *     les encaissements, les décaissements et le flux net ;
 *   • le solde de la caisse doit toujours se relire : ouverture + entrées
 *     − sorties + mouvements postérieurs = solde affiché, sans reste ;
 *   • un virement au départ de la caisse d'une activité est une SORTIE — il
 *     comptait pour zéro, et cette caisse restait pleine d'un argent déjà parti ;
 *   • un virement d'un TIROIR VERS UN AUTRE ne sort rien de la station : le
 *     compter en décaissement d'espèces gonflait les sorties de la période d'un
 *     argent qui n'avait fait que changer de poche. Il reste bien une sortie
 *     pour la caisse source et une entrée pour la caisse d'arrivée.
 *
 *   npx tsx src/lib/treasuryReporting.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { computeTreasuryReport, CAISSE_ID, CAISSE_PART_ID } from './treasuryReporting';
import { BizState } from './bizConfig';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

const FROM = '2026-08-01', TO = '2026-08-31';

/** Une station dont chaque document a bien écrit sa ligne au grand livre. */
const app = {
  bankAccounts: [{ id: 'B1', name: 'BNA', initialBalance: 1000 }],
  treasuryTransactions: [
    // Avant la période — c'est l'ouverture.
    { id: 't4', date: '2026-07-20T09:00:00.000Z', kind: 'DEPOSIT', amount: 2000, accountTo: CAISSE_ID, part: 'systeme' },
    // Pendant la période.
    { id: 't1', date: '2026-08-05T18:00:00.000Z', kind: 'BRIGADE', amount: 5000, accountTo: CAISSE_ID, part: 'carburant', refType: 'brigade', refId: 'br1' },
    { id: 't2', date: '2026-08-06T10:00:00.000Z', kind: 'PURCHASE', amount: 8000, accountFrom: CAISSE_ID, part: 'carburant', refType: 'purchase', refId: 'p1' },
    { id: 't3', date: '2026-08-07T10:00:00.000Z', kind: 'EXPENSE', amount: 500, accountFrom: CAISSE_ID, part: 'carburant', refType: 'expense', refId: 'e1' },
    { id: 't5', date: '2026-08-08T10:00:00.000Z', kind: 'TRANSFER', amount: 1000, accountFrom: CAISSE_PART_ID.carburant, accountTo: 'B1', part: 'carburant' },
    // Après la période — dans le solde, hors des flux.
    { id: 't6', date: '2026-09-10T10:00:00.000Z', kind: 'WITHDRAW', amount: 300, accountFrom: CAISSE_ID, part: 'systeme' },
  ],
  purchases: [{ id: 'p1', date: '2026-08-06T10:00:00.000Z', amountPaid: 8000, supplierId: 's1' }],
  expenses: [{ id: 'e1', date: '2026-08-07T10:00:00.000Z', amount: 500, category: 'Entretien' }],
  suppliers: [{ id: 's1', name: 'Naftal' }],
  brigades: [{ id: 'br1', date: '2026-08-05T06:00:00.000Z', shift: 'Matin' }],
  brigadeAccountings: [{ id: 'a1', brigadeId: 'br1', cashReceived: 5000 }],
};
const biz = {} as BizState;

const r = computeTreasuryReport(app, biz, FROM, TO);

console.log('\nSolde de la caisse générale');
// 2000 déposés + 5000 de brigade − 8000 d'achat − 500 de dépense − 300 retirés.
check('solde réel, toutes dates', r.caisseBalance, -1800);
check('ouverture (avant le 1er août)', r.caisseOpening, 2000);
check('entrées de la période', r.caisseIn, 5000);
check('sorties de la période', r.caisseOut, 8500);

console.log('\nLe détail explique le solde, sans reste');
const d = r.caisseDetail;
check('solde de fin de période', d.periodEnd, -1500);
check('mouvements postérieurs', d.after, -300);
check('ouverture + entrées − sorties + postérieurs = solde', d.opening + d.in - d.out + d.after, r.caisseBalance);
check('chaque mouvement est classé une seule fois',
  d.openingLines.length + d.lines.length + d.afterLines.length, 5);
check('mouvements de la période', d.counts.period, 3);
check('natures listées (Brigade, Achat, Dépense)', d.groups.length, 3);
check('le total des natures rend les flux',
  d.groups.reduce((s, g) => s + (g.direction === 'in' ? g.total : -g.total), 0), d.in - d.out);
check('le virement de la caisse Carburant ne touche pas la caisse générale',
  d.lines.some(l => l.id === 't5'), false);

console.log('\nLe journal ne compte pas deux fois le même argent');
// 4 lignes du grand livre sur la période — les documents (achat, dépense,
// brigade) ont déjà écrit la leur et ne sont pas repoussés.
check('opérations de la période', r.counts.movements, 4);
check('toutes issues du grand livre', r.counts.ledgerLines, 4);
check('encaissements', r.inflow, 5000);
check('décaissements (8000 + 500 + 1000 virés)', r.outflow, 9500);
check('flux net', r.net, -4500);

console.log('\nCaisses des activités');
const carburant = r.partBalances.find(p => p.key === 'carburant')!;
// 5000 encaissés − 8000 d'achat − 500 de dépense − 1000 virés en banque.
check('la caisse Carburant est vidée par son virement', carburant.balance, -4500);
check('le virement compte comme un décaissement de la partie', carburant.outflow, 9500);
check('total en banque', r.bankTotal, 2000);

// ─── Ce qui est réglé PAR LA BANQUE ne vide aucun tiroir ─────────────────────
// Le défaut : le journal signait chaque ligne sur sa NATURE (« un achat, une
// dépense, un salaire, donc de l'argent qui sort de la caisse »). Un versement
// bancaire débitait donc le compte — correctement — ET la caisse, du même
// montant, alors qu'aucun tiroir ne s'était ouvert.
console.log('\nUn règlement par virement bancaire ne touche pas les espèces');
const appBank = {
  bankAccounts: [{ id: 'B1', name: 'BNA', initialBalance: 100000 }],
  treasuryTransactions: [
    { id: 'c1', date: '2026-08-02T08:00:00.000Z', kind: 'BRIGADE', amount: 20000, accountTo: CAISSE_ID, part: 'carburant', refType: 'brigade', refId: 'br1' },
    // Réglés depuis la BANQUE : le compte baisse, la caisse ne bouge pas.
    { id: 'b1', date: '2026-08-03T10:00:00.000Z', kind: 'PURCHASE', amount: 30000, accountFrom: 'B1', part: 'carburant', refType: 'purchase', refId: 'p1' },
    { id: 'b2', date: '2026-08-04T10:00:00.000Z', kind: 'EXPENSE', amount: 4000, accountFrom: 'B1', part: 'cafeteria', refType: 'biz_expense', refId: 'be1' },
    // Un encaissement TPE arrive en banque, pas dans le tiroir.
    { id: 'b3', date: '2026-08-05T10:00:00.000Z', kind: 'TPE', amount: 6000, accountTo: 'B1', part: 'carburant', refType: 'brigade', refId: 'br1' },
    // Virement entre deux tiroirs : lu depuis le tiroir SOURCE, celui que la
    // ligne porte et d'où l'argent est bien parti.
    { id: 'b4', date: '2026-08-06T10:00:00.000Z', kind: 'TRANSFER', amount: 5000, accountFrom: CAISSE_ID, accountTo: CAISSE_PART_ID.cafeteria, part: 'systeme' },
  ],
  purchases: [{ id: 'p1', date: '2026-08-03T10:00:00.000Z', amountPaid: 30000, supplierId: 's1' }],
  expenses: [],
  suppliers: [{ id: 's1', name: 'Naftal' }],
  brigades: [{ id: 'br1', date: '2026-08-02T06:00:00.000Z', shift: 'Matin' }],
  brigadeAccountings: [{ id: 'a1', brigadeId: 'br1', cashReceived: 20000 }],
};
const rb = computeTreasuryReport(appBank, biz, FROM, TO);
check('la caisse générale ne garde que les espèces de la brigade', rb.caisseBalance, 15000);
check('le compte bancaire porte l\'achat, la dépense et le TPE', rb.bankTotal, 72000);
check('encaissements espèces (la brigade seule)', rb.inflow, 20000);
// Le virement va d'un tiroir de la station vers un autre : rien n'est sorti.
check('aucun décaissement d\'espèces', rb.outflow, 0);
check('flux net espèces (la brigade seule)', rb.net, 20000);
const internalRows = rb.movements.filter(m => m.internal);
check('le virement entre tiroirs est marqué « interne »', internalRows.length, 1);
check('son montant reste lisible', internalRows[0]?.gross, 5000);
// … mais la caisse qui donne s'est bien vidée, et celle qui reçoit remplie.
const financePart = rb.partBalances.find(p => p.key === 'systeme')!;
const cafeteriaPart = rb.partBalances.find(p => p.key === 'cafeteria')!;
check('sortie pour la caisse source', financePart.outflow, 5000);
check('entrée pour la caisse d\'arrivée', cafeteriaPart.inflow, 5000);
const bankRows = rb.movements.filter(m => m.bank);
check('achat, dépense et TPE sont marqués « banque »', bankRows.length, 3);
check('leur montant reste lisible', bankRows.reduce((s, m) => s + m.gross, 0), 40000);
check('ils ne comptent pour rien dans les espèces', bankRows.reduce((s, m) => s + m.amount, 0), 0);
check('total des mouvements bancaires de la période', rb.bankMoves, 40000);

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
