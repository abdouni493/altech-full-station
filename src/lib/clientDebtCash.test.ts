/**
 * ─── Ce qu'un règlement de client doit faire, partout ──────────────────────────
 *
 * Trois défauts constatés à l'écran, un cas de vérification chacun :
 *
 *   • CAFÉTÉRIA / LAVAGE — un client qui vient solder aujourd'hui une facture de
 *     mars faisait entrer l'argent … en mars. La caisse du mois en cours ne
 *     bougeait pas d'un dinar, alors que les billets étaient bien dans le
 *     tiroir. Chaque versement doit donc porter SA date (`docPaymentSlices`),
 *     sans jamais changer le total du tiroir ;
 *
 *   • CARBURANT — le rapport lisait la colonne `clients.debt`, un compteur tenu
 *     à la main que l'écran Clients n'utilise plus depuis qu'il relit les pièces.
 *     Les deux écrans annonçaient donc deux encours différents pour le même
 *     client, et un règlement encaissé ne faisait pas bouger le rapport ;
 *
 *   • et le solde d'une caisse doit toujours être exactement la somme des lignes
 *     censées l'expliquer — un chiffre qu'aucune liste ne justifie n'est qu'une
 *     affirmation.
 *
 *   npx tsx src/lib/clientDebtCash.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { docPaymentSlices, moduleCaisseMovements, computeCarburantReport } from './bizReporting';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

// ─── 1. Un versement entre au tiroir LE JOUR où il est encaissé ───────────────
console.log("Un règlement entre en caisse le jour où il est reçu");
{
  // Facture de mars, réglée pour moitié sur place et soldée le 19 août.
  const sale = {
    id: 'S1', ref: 'V-001', date: '2026-03-04', clientId: 'C1', clientName: 'Atelier Nord',
    total: 10_000, paid: 10_000, rest: 0, status: 'payée', items: [],
    payments: [
      { id: 'P1', date: '2026-03-04', amount: 4_000, mode: 'Espèces' },
      { id: 'P2', date: '2026-08-19', amount: 6_000, mode: 'Espèces' },
    ],
  };
  const slices = docPaymentSlices(sale as any, 10_000);
  check('un mouvement par versement', slices.length, 2);
  check("le premier reste à la date de la facture", slices[0].date, '2026-03-04');
  check("le second porte le jour de l'encaissement", slices[1].date, '2026-08-19');
  check('le total du tiroir est inchangé', slices.reduce((s, l) => s + l.amount, 0), 10_000);

  // Un document ancien n'a qu'un cumul : il garde l'ancienne lecture, une ligne
  // unique à sa date — c'est tout ce que l'on sait de lui.
  const legacy = { id: 'S2', date: '2026-02-01', paid: 2_500 };
  const one = docPaymentSlices(legacy as any, 2_500);
  check("sans versement daté, une seule ligne", one.length, 1);
  check('… à la date du document', one[0].date, '2026-02-01');

  // Une vente RETOURNÉE n'a pas laissé au tiroir ce qu'elle avait encaissé :
  // ses versements ne la décrivent plus, on ne les déplie pas.
  const returned = {
    id: 'S3', date: '2026-05-02', paid: 8_000,
    payments: [{ id: 'P3', date: '2026-05-02', amount: 8_000 }],
  };
  const net = docPaymentSlices(returned as any, 3_000);
  check("un retour garde son net, en une ligne", net.length, 1);
  check('… pour le montant réellement resté', net[0].amount, 3_000);
}

// ─── 2. La caisse d'une partie compte ce règlement, sans le déplacer ──────────
console.log("");
console.log("La caisse de la partie encaisse le règlement à sa date");
{
  const st: any = {
    caisse: [], purchases: [], expenses: [], workers: [], products: [], clients: [], suppliers: [],
    reparations: [{
      id: 'R1', ref: 'I-001', date: '2026-03-10', clientId: 'C1', clientName: 'Atelier Nord',
      kind: 'lavage', total: 5_000, paid: 5_000, rest: 0, status: 'done',
      payments: [
        { id: 'RP1', date: '2026-03-10', amount: 1_000, mode: 'Espèces' },
        { id: 'RP2', date: '2026-08-19', amount: 4_000, mode: 'Espèces' },
      ],
    }],
    sales: [],
  };
  const rows = moduleCaisseMovements(st, 'lavage' as any, [], []);
  const solde = rows.reduce((s, r) => s + r.amount, 0);
  check('le tiroir contient bien les 5 000 DA', solde, 5_000);
  check('en deux mouvements, un par versement', rows.length, 2);
  check("celui d'août est daté d'août",
    rows.filter(r => r.date.startsWith('2026-08')).reduce((s, r) => s + r.amount, 0), 4_000);
}

// ─── 3. Les dettes clients du Carburant se lisent sur les pièces ──────────────
console.log("");
console.log("Le rapport Carburant réclame ce que disent les pièces");
{
  // La fiche annonce 0 (le compteur n'a jamais été tenu), les brigades disent
  // 9 000 à crédit dont 4 000 déjà réglés : le rapport doit réclamer 5 000.
  const app: any = {
    clients: [{
      id: 'C1', name: 'Transport SARL', debt: 0, balance: 0, advanceBalance: 0,
      transactionHistory: [{ id: 'T1', date: '2026-08-18', type: 'PAYMENT', amount: 4_000, mode: 'ESPECES' }],
    }],
    brigades: [{ id: 'B1', date: '2026-08-01', startDatetime: '2026-08-01T06:00:00.000Z', shift: 'Matin' }],
    brigadeAccountings: [{
      id: 'A1', brigadeId: 'B1', cashReceived: 0,
      justifications: [{ id: 'J1', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'C1', amount: 9_000, fuelType: 'GASOIL', liters: 60 }],
    }],
    products: [], suppliers: [], shopSales: [], fuelSales: [], purchases: [], expenses: [],
    treasuryTransactions: [], settings: {}, pumpNozzles: [], pumps: [], tanks: [],
  };
  const report = computeCarburantReport(app, '', '');
  check('un seul client débiteur', report.clientDebts.length, 1);
  check('il doit ce que ses pièces disent', report.clientDebts[0].rest, 5_000);
  check('le total du rapport suit', report.clientDebtTotal, 5_000);

  // Une fois la dette soldée, le client disparaît de la liste — même si la
  // colonne `debt` de sa fiche, elle, n'a jamais été remise à zéro.
  const settled = JSON.parse(JSON.stringify(app));
  settled.clients[0].debt = 9_000;
  settled.clients[0].transactionHistory.push({ id: 'T2', date: '2026-08-19', type: 'PAYMENT', amount: 5_000, mode: 'ESPECES' });
  const after = computeCarburantReport(settled, '', '');
  check('compte soldé, plus aucune dette réclamée', after.clientDebtTotal, 0);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
