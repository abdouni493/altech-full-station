/**
 * ─── Vérification du relevé de compte client ───────────────────────────────────
 * Ce que ces cas protègent, parce que chacun est un défaut réellement constaté :
 *
 *   • l'historique ne montrait que les dernières opérations — sans bornes, un
 *     relevé doit rendre la vie ENTIÈRE du compte, pas sa fin ;
 *   • borné à une période, il doit encore dire juste : ce qui précède la période
 *     n'est pas perdu, il devient la dette d'OUVERTURE, sinon la dette de
 *     clôture est fausse ;
 *   • les règlements d'une vente de partie n'existaient qu'en cumul dans `paid`.
 *     Reconstruits, ils ne doivent JAMAIS compter deux fois le même argent
 *     lorsqu'un versement daté vient s'ajouter au cumul ;
 *   • une vente retournée n'a rien coûté au client : la marchandise est revenue.
 *
 *   npx tsx src/lib/clientStatement.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { fuelClientStatement, bizClientStatement, inRange } from './clientStatement';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}\n      attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};
const section = (t: string) => console.log(`\n${t}`);

// ─── Décor commun ─────────────────────────────────────────────────────────────
const CLIENT = { id: 'c1', name: 'Transport Belaid', phone: '0550', paymentMode: 'CREDIT' };

/**
 * Un client carburant qui prend des bons sur trois brigades étalées sur trois
 * mois, et qui règle une fois au milieu.
 */
const fuelApp = {
  clients: [CLIENT],
  brigades: [
    { id: 'b1', date: '2026-01-10', startDatetime: '2026-01-10T06:00:00', shift: 'Matin' },
    { id: 'b2', date: '2026-02-14', startDatetime: '2026-02-14T06:00:00', shift: 'Soir' },
    { id: 'b3', date: '2026-03-20', startDatetime: '2026-03-20T06:00:00', shift: 'Matin' },
  ],
  brigadeAccountings: [
    { id: 'a1', brigadeId: 'b1', justifications: [{ id: 'j1', clientId: 'c1', amount: 10000, liters: 200, fuelType: 'GASOIL', pricePerLiter: 50, paymentMode: 'CREDIT' }] },
    { id: 'a2', brigadeId: 'b2', justifications: [{ id: 'j2', clientId: 'c1', amount: 6000, liters: 120, fuelType: 'GASOIL', pricePerLiter: 50, paymentMode: 'CREDIT' }] },
    { id: 'a3', brigadeId: 'b3', justifications: [{ id: 'j3', clientId: 'c1', amount: 4000, liters: 80, fuelType: 'GASOIL', pricePerLiter: 50, paymentMode: 'CREDIT' }] },
  ],
  shopSales: [],
  fuelSales: [],
};
const fuelClient = {
  ...CLIENT,
  transactionHistory: [
    { id: 't1', date: '2026-02-20T10:00:00', type: 'PAYMENT', amount: 5000, mode: 'ESPECES' },
  ],
};

section("Sans bornes, le relevé rend TOUT l'historique du compte");
{
  const st = fuelClientStatement({ ...fuelApp, clients: [fuelClient] }, fuelClient);
  check('les trois bons et le règlement sont là', st.lines.length, 4);
  check('total consommé', st.totals.charged, 20000);
  check('total encaissé', st.totals.paid, 5000);
  check('rien ne précède : dette d\'ouverture nulle', st.openingDebt, 0);
  check('dette de clôture = 20000 − 5000', st.closingDebt, 15000);
  check('le journal remonte à la première opération', st.allLines[st.allLines.length - 1].date.slice(0, 10), '2026-01-10');
  check('le détail litres × prix accompagne le bon', st.lines.find(l => l.kind === 'bon')?.items?.[0]?.qty, 80);
}

section('Borné à une période, ce qui précède devient la dette d\'ouverture');
{
  const st = fuelClientStatement({ ...fuelApp, clients: [fuelClient] }, fuelClient, '2026-02-01', '2026-02-28');
  check('seules les opérations de février sont listées', st.lines.length, 2);
  check('consommé en février', st.totals.charged, 6000);
  check('encaissé en février', st.totals.paid, 5000);
  check('janvier est reporté en ouverture', st.openingDebt, 10000);
  // 10000 (report) + 6000 (crédit de février) − 5000 (règlement) = 11000.
  check('dette de clôture au 28 février', st.closingDebt, 11000);
}

section('Les bornes incluent le jour entier, début comme fin');
{
  const st = fuelClientStatement({ ...fuelApp, clients: [fuelClient] }, fuelClient, '2026-02-14', '2026-02-14');
  check('le bon du 14 à 06h00 est bien dans la journée du 14', st.lines.length, 1);
  check('et le règlement du 20 en est exclu', st.totals.paid, 0);
  check('un règlement à 10h00 le jour de fin est inclus', inRange('2026-02-20T10:00:00', '2026-02-01', '2026-02-20'), true);
}

section('Un bon pris sur l\'AVANCE ne creuse aucune dette');
{
  const app = {
    ...fuelApp,
    brigadeAccountings: [
      { id: 'a1', brigadeId: 'b1', justifications: [{ id: 'j1', clientId: 'c1', amount: 10000, liters: 200, fuelType: 'GASOIL', paymentMode: 'AVANCE' }] },
    ],
  };
  const client = { ...CLIENT, paymentMode: 'ADVANCE', advanceBalance: 40000, transactionHistory: [] };
  const st = fuelClientStatement({ ...app, clients: [client] }, client);
  check('la consommation est bien comptée', st.totals.charged, 10000);
  check('mais aucune dette n\'est créée', st.closingDebt, 0);
  check('elle sort de l\'avance', st.totals.advanceUsed, 10000);
  check('solde d\'avance de clôture', st.closingAdvance, 40000);
  check('donc 50000 avant la période', st.openingAdvance, 50000);
}

// ─── Cafétéria / Lavage ───────────────────────────────────────────────────────
section('Partie : versements datés et versements reconstruits');
{
  const state: any = {
    sales: [
      // Facture moderne : ses encaissements sont datés.
      {
        id: 's1', ref: 'V-0001', clientId: 'c1', clientName: 'Belaid', date: '2026-03-02T09:00:00',
        items: [{ productId: 'p1', productName: 'Café', qty: 10, unitPrice: 50 }],
        subtotal: 500, reduction: 0, total: 500, paid: 300, rest: 200, status: 'crédit',
        payments: [
          { id: 'x1', date: '2026-03-02T09:00:00', amount: 100, mode: 'Espèces' },
          { id: 'x2', date: '2026-03-15T11:00:00', amount: 200, mode: 'Chèque', reference: 'CH-77' },
        ],
      },
      // Facture ancienne : elle n'a QUE son cumul.
      {
        id: 's2', ref: 'V-0002', clientId: 'c1', clientName: 'Belaid', date: '2026-03-05T09:00:00',
        items: [{ productId: 'p2', productName: 'Eau', qty: 4, unitPrice: 25 }],
        subtotal: 100, reduction: 0, total: 100, paid: 100, rest: 0, status: 'payée',
      },
      // Vente retournée : la marchandise est revenue, elle ne coûte rien.
      {
        id: 's3', ref: 'V-0003', clientId: 'c1', clientName: 'Belaid', date: '2026-03-08T09:00:00',
        items: [{ productId: 'p1', productName: 'Café', qty: 2, unitPrice: 50 }],
        subtotal: 100, reduction: 0, total: 100, paid: 100, rest: 0, status: 'retournée', refundedAmount: 100,
      },
    ],
    reparations: [],
  };
  const st = bizClientStatement(state, CLIENT as any, 'Cafétéria');

  check('documents ET reglements sont au journal', st.lines.length, 6);
  check('la vente retournée ne coûte rien', st.lines.find(l => l.id === 'sale-s3')?.charged, 0);
  check('total consommé hors retour', st.totals.charged, 600);
  check('trois versements : deux datés, un reconstruit', st.payments.length, 3);
  check('le versement reconstruit est signalé', st.payments.filter(p => p.inferred).length, 1);
  check('total encaissé = 100 + 200 + 100, le retour ne compte pas', st.totals.paid, 400);
  check('reste dû sur le compte', st.closingDebt, 200);
  check('par mode : le chèque est isolé', st.byMode.find(m => m.mode === 'Chèque')?.amount, 200);
  check('le détail article est porté', st.lines.find(l => l.id === 'sale-s1')?.items?.[0]?.total, 500);

  // Le mois de mars entier redonne exactement le compte complet…
  const mars = bizClientStatement(state, CLIENT as any, 'Cafétéria', '2026-03-01', '2026-03-31');
  check('mars entier = tout le compte', mars.closingDebt, st.closingDebt);

  // …et la seule première semaine laisse le chèque du 15 dehors.
  const semaine = bizClientStatement(state, CLIENT as any, 'Cafétéria', '2026-03-01', '2026-03-07');
  check('le chèque du 15 sort de la première semaine', semaine.totals.paid, 200);
  check('la facture du 8 aussi', semaine.lines.length, 4);
}

section('Une intervention porte ses prestations ET ses produits');
{
  const state: any = {
    sales: [],
    reparations: [{
      id: 'r1', ref: 'LAV-0001', kind: 'lavage', clientId: 'c1', clientName: 'Belaid',
      car: { marque: 'Renault', name: 'Clio', immatriculation: '12345-116-31' },
      serviceTotal: 800,
      prestations: [{ id: 'pr1', kind: 'lavage', label: 'Lavage complet', amount: 800, workerIds: [] }],
      usedProducts: [{ productId: 'p9', productName: 'Shampoing', qty: 2, unitPrice: 150, total: 300 }],
      total: 1100, paid: 600, rest: 500, status: 'finalized', date: '2026-04-01T08:00:00', workers: [],
    }],
  };
  const st = bizClientStatement(state, CLIENT as any, 'Lavage & Vidange');
  check('prestation + produit sont détaillés', st.lines[0].items?.length, 2);
  check('le total de l\'intervention', st.totals.charged, 1100);
  check('le reste dû', st.closingDebt, 500);
  check("l'immatriculation est au libellé", st.lines[0].label.includes('12345-116-31'), true);
}

section('Un compte vide reste lisible');
{
  const st = bizClientStatement({ sales: [], reparations: [] } as any, CLIENT as any, 'Cafétéria');
  check('aucune ligne', st.lines.length, 0);
  check('aucune dette', st.closingDebt, 0);
  check('aucun règlement', st.totals.paid, 0);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
