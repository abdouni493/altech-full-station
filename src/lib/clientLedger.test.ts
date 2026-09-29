/**
 * ─── Vérification du compte client ─────────────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement vidé l'écran Clients :
 *
 *   • la consommation d'un client vit dans les JUSTIFICATIONS des brigades, pas
 *     dans `fuel_sales` — table que plus rien n'alimente. L'historique lisait
 *     cette table morte et n'affichait donc jamais rien ;
 *   • les ventes magasin étaient filtrées sur `paymentMode === client.id`, une
 *     comparaison entre un mode de paiement et un identifiant : toujours fausse ;
 *   • un bon pris sur l'AVANCE ne crée aucune dette, un bon à CRÉDIT si — les
 *     confondre faisait réclamer deux fois le même argent ;
 *   • une recharge d'avance est de l'argent remis : elle doit monter la caisse.
 *
 *   npx tsx src/lib/clientLedger.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { clientLedger, clientLedgers, clientChargeDelta } from './clientLedger';
import { computeCarburantCash } from './carburantSales';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

/**
 * Un client à crédit qui a pris deux bons sur des brigades, une facture magasin
 * partiellement réglée, et qui a versé 4 000 DA. Un second client, lui, paie sur
 * son avance : ses bons ne créent aucune dette.
 */
const app = {
  clients: [
    {
      id: 'CL1', name: 'Transport SARL', debt: 9_000, balance: 0, advanceBalance: 0,
      transactionHistory: [
        { id: 'TX1', date: '2026-08-20', type: 'PAYMENT', amount: 3_000, mode: 'ESPECES' },
        { id: 'TX2', date: '2026-08-21', type: 'PAYMENT', amount: 1_000, mode: 'CHEQUE' },
      ],
    },
    {
      id: 'CL2', name: 'Ecole Ibn Badis', debt: 0, balance: 20_000, advanceBalance: 20_000,
      transactionHistory: [
        { id: 'TX3', date: '2026-08-01', type: 'RECHARGE', amount: 20_000, mode: 'ESPECES' },
      ],
    },
  ],
  brigades: [
    { id: 'BR1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00.000Z', shift: 'Matin' },
    { id: 'BR2', date: '2026-08-12', startDatetime: '2026-08-12T06:00:00.000Z', shift: 'Soir' },
  ],
  brigadeAccountings: [
    {
      id: 'A1', brigadeId: 'BR1',
      justifications: [
        { id: 'J1', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL1', amount: 6_000, fuelType: 'GASOIL', liters: 133, pricePerLiter: 45 },
        { id: 'J2', justificationType: 'CLIENT', paymentMode: 'AVANCE', clientId: 'CL2', amount: 5_000, fuelType: 'ESSENCE', liters: 100, pricePerLiter: 50 },
        // TAG / TPE : ce ne sont pas des clients du fichier, ils ne doivent
        // jamais atterrir dans le compte de quiconque.
        { id: 'J3', justificationType: 'TPE', amount: 12_000, clientName: 'Passage' },
      ],
    },
    {
      id: 'A2', brigadeId: 'BR2',
      justifications: [
        { id: 'J4', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL1', amount: 4_000, fuelType: 'GASOIL', liters: 89, pricePerLiter: 45 },
      ],
    },
  ],
  // Une facture magasin de 3 000 DA dont 1 000 restent dus.
  shopSales: [
    { id: 'SH1', date: '2026-08-15', clientId: 'CL1', total: 3_000, amountPaid: 2_000, rest: 1_000, paymentMode: 'CREDIT', items: [{ productName: 'Huile', quantity: 2, price: 1_500 }] },
    // Une vente réglée au comptant par quelqu'un d'autre : elle n'appartient
    // à aucun compte client.
    { id: 'SH2', date: '2026-08-16', total: 800, amountPaid: 800, rest: 0, paymentMode: 'ESPECES', items: [] },
  ],
  fuelSales: [],
  expenses: [], purchases: [], suppliers: [], treasuryTransactions: [],
  pompistes: [], brigadeChefs: [], gerants: [], magasinWorkers: [],
};

console.log('\nLe compte d\'un client à crédit');
const cl1 = clientLedger(app, 'CL1');
check('toutes ses opérations sont là', cl1.entries.length, 5);
check('deux bons carburant', cl1.counts.bons, 2);
check('une facture magasin', cl1.counts.magasin, 1);
check('deux règlements', cl1.counts.reglements, 2);
check('consommation totale (6 000 + 4 000 + 3 000)', cl1.charged, 13_000);
check('dont à crédit (les bons + le reste dû du magasin)', cl1.chargedOnCredit, 11_000);
check('rien pris sur une avance', cl1.chargedOnAdvance, 0);
check('réglé (les deux modes comptent comme règlement)', cl1.paid, 4_000);
check('dette d\'après les pièces', cl1.debtFromDocuments, 7_000);
check('le TAG/TPE n\'entre dans aucun compte',
  cl1.entries.some(e => e.id.includes('J3')), false);
check('la vente magasin sans client non plus',
  cl1.entries.some(e => e.id === 'shop-SH2'), false);
check('les lignes sont triées du plus récent au plus ancien',
  cl1.entries.map(e => e.date.slice(0, 10)),
  ['2026-08-21', '2026-08-20', '2026-08-15', '2026-08-12', '2026-08-10']);

console.log('\nUn bon pris sur l\'avance ne crée aucune dette');
const cl2 = clientLedger(app, 'CL2');
check('un bon et une recharge', cl2.entries.length, 2);
check('consommation', cl2.charged, 5_000);
check('aucune dette créée', cl2.chargedOnCredit, 0);
check('consommé sur son avance', cl2.chargedOnAdvance, 5_000);
check('rechargé', cl2.recharged, 20_000);
check('avance restante (20 000 − 5 000)', cl2.advanceFromDocuments, 15_000);
check('un règlement de dette n\'est pas une recharge', cl2.paid, 0);

console.log('\nUn client sans aucune opération');
check('journal vide, pas d\'erreur', clientLedger(app, 'INCONNU').entries.length, 0);

console.log('\nL\'argent remis par les clients entre en caisse');
const cash = computeCarburantCash(app);
// 3 000 réglés en espèces + 20 000 rechargés en espèces. Le règlement par
// chèque atterrit en banque et ne touche pas le tiroir.
check('règlements de dette en espèces', cash.clientCash, 3_000);
check('recharges d\'avance en espèces', cash.rechargeCash, 20_000);
check('le règlement par chèque reste en dehors',
  cash.lines.some(l => l.id === 'cli-TX2'), false);
check('solde de la caisse Carburant', cash.balance, 23_000);
check('chaque ligne se relit', cash.lines.reduce((s, l) => s + l.amount, 0), cash.balance);

/**
 * L'ombre d'un bon.
 *
 * La comptabilité de brigade écrivait, à côté de chaque justification, une
 * ligne « SALE » dans l'historique du client. Le journal comptait alors DEUX
 * fois le même bon : la pièce, puis sa copie. Et pour un client sur avance la
 * copie partait à la DETTE — une dette égale à tout ce qu'il avait déjà payé
 * d'avance.
 */
console.log("");
console.log("L'ombre d'un bon ne le compte pas deux fois");
{
  const withShadows = {
    ...app,
    clients: [
      {
        ...app.clients[0],
        transactionHistory: [
          ...app.clients[0].transactionHistory,
          // Les copies des deux bons de CL1, écrites à la clôture des brigades.
          { id: 'SH-J1', date: '2026-08-10', type: 'SALE', amount: 6_000, mode: 'CREDIT', notes: 'Brigade 2026-08-10 Matin' },
          { id: 'SH-J4', date: '2026-08-12', type: 'SALE', amount: 4_000, mode: 'CREDIT', notes: 'Brigade 2026-08-12 Soir' },
        ],
      },
      {
        ...app.clients[1],
        transactionHistory: [
          ...app.clients[1].transactionHistory,
          { id: 'SH-J2', date: '2026-08-10', type: 'SALE', amount: 5_000, mode: 'ADVANCE', notes: 'Brigade 2026-08-10 Matin' },
        ],
      },
    ],
  };
  const l1 = clientLedger(withShadows, 'CL1');
  check('le journal ne double pas', l1.entries.length, 5);
  check('les deux ombres sont écartées', l1.shadowsDropped, 2);
  check('la consommation reste celle des pièces', l1.charged, 13_000);
  check('la dette aussi', l1.debtFromDocuments, 7_000);

  const l2 = clientLedger(withShadows, 'CL2');
  check("l'ombre d'un bon sur avance est écartée", l2.shadowsDropped, 1);
  check('aucune dette inventée au client sur avance', l2.debtFromDocuments, 0);
  check('sa consommation reste celle de son bon', l2.charged, 5_000);
}

/**
 * Une consommation dont la brigade a disparu garde sa ligne — mais avec son
 * effet RÉEL : prise sur l'avance, elle ne doit rien à personne.
 */
console.log("");
console.log('Une consommation orpheline garde son effet réel');
{
  const orphan = {
    ...app,
    brigadeAccountings: [],
    clients: [{
      ...app.clients[1],
      transactionHistory: [
        { id: 'TX3', date: '2026-08-01', type: 'RECHARGE', amount: 20_000, mode: 'ESPECES' },
        { id: 'ORP', date: '2026-08-10', type: 'SALE', amount: 5_000, mode: 'ADVANCE', notes: 'Brigade effacée' },
      ],
    }],
  };
  const l = clientLedger(orphan, 'CL2');
  check('la ligne est conservée', l.entries.length, 2);
  check('rien à écarter, la pièce a disparu', l.shadowsDropped, 0);
  check("elle sort de l'avance", l.chargedOnAdvance, 5_000);
  check('et ne crée aucune dette', l.debtFromDocuments, 0);
}

console.log("");
console.log("L'encours enregistré se compare aux pièces");
{
  const l = clientLedger(app, 'CL1');
  check('la colonne `debt` est rendue telle quelle', l.recordedDebt, 9_000);
  check('et son écart avec les pièces est dit', l.debtGap, 2_000);
  check('première opération', l.firstDate.slice(0, 10), '2026-08-10');
  check('dernière opération', l.lastDate.slice(0, 10), '2026-08-21');
}

/**
 * Rouvrir une comptabilité de brigade ne doit reporter que la DIFFÉRENCE :
 * enregistrée à l'identique, elle ne bouge aucun compte.
 */
console.log("");
console.log('Une comptabilité rouverte ne recharge pas les comptes');
{
  const before = [
    { clientId: 'CL1', amount: 6_000, justificationType: 'CLIENT', paymentMode: 'CREDIT' },
    { clientId: '', amount: 12_000, justificationType: 'TPE' },
  ];
  check("enregistrement à l'identique : aucun mouvement",
    clientChargeDelta(before, before).size, 0);
  check('un bon porté de 6 000 à 8 000 ne reporte que 2 000',
    clientChargeDelta(before, [{ clientId: 'CL1', amount: 8_000, justificationType: 'CLIENT', paymentMode: 'CREDIT' }]).get('CL1')?.credit, 2_000);
  check('un bon retiré rend son montant au client',
    clientChargeDelta(before, []).get('CL1')?.credit, -6_000);
  check("un TPE n'entre dans le compte de personne",
    clientChargeDelta([], [{ clientId: 'CL9', amount: 3_000, justificationType: 'TPE' }]).size, 0);
  check('une première clôture reporte tout',
    clientChargeDelta(undefined, before).get('CL1')?.credit, 6_000);

  // Le mode de la JUSTIFICATION décide, pas la fiche du client — et les deux
  // écrans ne l'écrivent pas avec le même mot.
  check("un bon « AVANCE » descend l'avance, pas la dette",
    clientChargeDelta([], [{ clientId: 'CL2', amount: 5_000, justificationType: 'CLIENT', paymentMode: 'AVANCE' }]).get('CL2'),
    { credit: 0, advance: 5_000 });
  check("« ADVANCE » — l'autre orthographe — fait exactement pareil",
    clientChargeDelta([], [{ clientId: 'CL2', amount: 5_000, justificationType: 'CLIENT', paymentMode: 'ADVANCE' }]).get('CL2'),
    { credit: 0, advance: 5_000 });
  check('un bon sans mode reste une dette',
    clientChargeDelta([], [{ clientId: 'CL1', amount: 4_000, justificationType: 'CLIENT' }]).get('CL1'),
    { credit: 4_000, advance: 0 });
  check("passer un bon du crédit à l'avance rend la dette et prend sur l'avance",
    clientChargeDelta(
      [{ clientId: 'CL1', amount: 6_000, justificationType: 'CLIENT', paymentMode: 'CREDIT' }],
      [{ clientId: 'CL1', amount: 6_000, justificationType: 'CLIENT', paymentMode: 'AVANCE' }]).get('CL1'),
    { credit: -6_000, advance: 6_000 });
}

/**
 * Un bon saisi depuis la COMPTABILITÉ de brigade porte « ADVANCE » (le mode
 * recopié de la fiche client) là où la clôture écrit « AVANCE ». Ne reconnaître
 * que le second faisait apparaître une dette chez un client qui avait pourtant
 * déjà payé d'avance.
 */
console.log("");
console.log("Les deux orthographes de l'avance sont comprises au journal");
{
  const app2 = {
    clients: [{ id: 'CL2', name: 'Ecole', debt: 0, balance: 20_000, advanceBalance: 20_000, transactionHistory: [] }],
    brigades: [{ id: 'BR1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00.000Z', shift: 'Matin' }],
    brigadeAccountings: [{
      id: 'A1', brigadeId: 'BR1',
      justifications: [{ id: 'J1', justificationType: 'CLIENT', paymentMode: 'ADVANCE', clientId: 'CL2', amount: 5_000, fuelType: 'ESSENCE', liters: 100 }],
    }],
    shopSales: [], fuelSales: [],
  };
  const l = clientLedger(app2, 'CL2');
  check('aucune dette créée', l.debtFromDocuments, 0);
  check("le bon sort bien de l'avance", l.chargedOnAdvance, 5_000);
}

/**
 * La liste des clients construit tous les comptes d'un coup, en rangeant les
 * pièces par client au lieu de faire relire toute la base à chacun. Le résultat
 * doit rester rigoureusement identique compte par compte.
 */
console.log("");
console.log("Tous les comptes d'un coup disent la même chose qu'un par un");
{
  const all = clientLedgers(app);
  for (const id of ['CL1', 'CL2']) {
    const one = clientLedger(app, id);
    check(`${id} — mêmes opérations`, all[id].entries.map(e => e.id), one.entries.map(e => e.id));
    check(`${id} — même consommation`, all[id].charged, one.charged);
    check(`${id} — même dette`, all[id].debtFromDocuments, one.debtFromDocuments);
    check(`${id} — même avance`, all[id].advanceFromDocuments, one.advanceFromDocuments);
  }
  check('aucun client oublié', Object.keys(all).sort(), ['CL1', 'CL2']);
}

/**
 * ─── Un règlement encaissé remplit la caisse de SON activité, UNE fois ────────
 *
 * L'écran Clients écrit deux choses pour un même règlement : la ligne de
 * `client_transactions` (l'historique du client) et une ligne du grand livre qui
 * dit sur quel compte l'argent est tombé. La caisse Carburant lit la première ;
 * elle doit donc écarter la seconde, sinon le même billet entrerait deux fois.
 *
 * Et il tombe dans le coffre du CARBURANT — l'activité qui tient ce client —
 * et non dans le tiroir commun, où il n'appartenait à personne.
 */
console.log("");
console.log("Un règlement client entre dans la caisse Carburant, une seule fois");
{
  const withPayment = {
    clients: [{
      id: 'CL9', name: 'Transporteur', debt: 0, balance: 0, advanceBalance: 0,
      transactionHistory: [
        { id: 'PAY9', date: '2026-08-19', type: 'PAYMENT', amount: 12_000, mode: 'ESPECES' },
        { id: 'REC9', date: '2026-08-19', type: 'RECHARGE', amount: 3_000, mode: 'ESPECES' },
        // Réglé par chèque : l'argent est en banque, la caisse ne bouge pas.
        { id: 'PAY8', date: '2026-08-19', type: 'PAYMENT', amount: 50_000, mode: 'CHEQUE' },
      ],
    }],
    brigades: [], brigadeAccountings: [], purchases: [], expenses: [], suppliers: [],
    treasuryTransactions: [
      {
        id: 'TX-PAY9', date: '2026-08-19T10:00:00.000Z', kind: 'SALE', amount: 12_000,
        accountTo: 'CAISSE_CARBURANT', part: 'carburant',
        refType: 'client_payment', refId: 'PAY9', createdAt: '2026-08-19T10:00:00.000Z',
      },
      {
        id: 'TX-REC9', date: '2026-08-19T10:05:00.000Z', kind: 'SALE', amount: 3_000,
        accountTo: 'CAISSE_CARBURANT', part: 'carburant',
        refType: 'client_payment', refId: 'REC9', createdAt: '2026-08-19T10:05:00.000Z',
      },
    ],
  };
  const cash = computeCarburantCash(withPayment);
  check('le règlement en espèces monte la caisse', cash.clientCash, 12_000);
  check('la recharge en espèces aussi', cash.rechargeCash, 3_000);
  check('le chèque, lui, ne touche pas le tiroir', cash.balance, 15_000);
  check('aucune ligne en double', cash.lines.length, 2);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
