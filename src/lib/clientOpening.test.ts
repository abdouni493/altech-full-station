/**
 * ─── La dette (et l'avance) d'OUVERTURE d'un compte client ─────────────────────
 *
 * Ce que ces cas protègent, parce que c'est exactement ce qui était cassé :
 *
 *   • à la création d'une fiche, l'« encours initial » et le « versement initial
 *     d'avance » n'étaient écrits QUE dans les colonnes `debt` / `balance`. Or
 *     tous les écrans lisent le compte sur ses PIÈCES (`clientLedger`) : aucune
 *     pièce ne portait la reprise, l'historique s'ouvrait donc vide, la carte
 *     annonçait 0 et le rapport général ne comptait pas la créance ;
 *   • la ligne d'ouverture doit être la PREMIÈRE du journal : placée ailleurs,
 *     le solde affiché après chaque opération repartirait d'un mauvais point ;
 *   • un règlement rembourse la reprise comme n'importe quelle dette ;
 *   • côté Cafétéria / Lavage, la reprise vit sur la fiche et se solde par ses
 *     propres versements — qui doivent entrer dans le tiroir de la partie, sans
 *     quoi le client paie et la caisse ne bouge pas.
 *
 *   npx tsx src/lib/clientOpening.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { clientLedger, clientLedgers, clientOpening } from './clientLedger';
import { fuelClientStatement, bizClientStatement } from './clientStatement';
import { openingDebtRest, moduleCaisseMovements, computeModuleReport } from './bizReporting';
import { EMPTY_MODULE } from './bizSeed';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}\n      attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};
const section = (t: string) => console.log(`\n${t}`);

// ─── 1. Carburant : la reprise entre au journal ───────────────────────────────
section("Carburant — un client repris avec 40 000 DA d'ardoise");
{
  const client = {
    id: 'c1', name: 'Transport Belaid', paymentMode: 'CREDIT',
    debt: 46000, balance: 0, advanceBalance: 0,
    openingDebt: 40000, openingDate: '2026-01-01',
    transactionHistory: [
      { id: 't1', date: '2026-03-05T09:00:00', type: 'PAYMENT', amount: 4000, mode: 'ESPECES' },
    ],
  };
  const app = {
    clients: [client],
    brigades: [{ id: 'b1', date: '2026-02-10', startDatetime: '2026-02-10T06:00:00', shift: 'Matin' }],
    brigadeAccountings: [{
      id: 'a1', brigadeId: 'b1',
      justifications: [{ id: 'j1', clientId: 'c1', amount: 10000, liters: 200, fuelType: 'GASOIL', pricePerLiter: 50, paymentMode: 'CREDIT' }],
    }],
    shopSales: [], fuelSales: [],
  };

  const l = clientLedger(app, 'c1');
  const opening = l.entries.filter(e => e.kind === 'ouverture');

  check("la reprise est une ligne du journal", opening.length, 1);
  check("elle porte le montant saisi à la création", opening[0]?.charged, 40000);
  check("elle est la PLUS ANCIENNE ligne du compte", l.entries[l.entries.length - 1].kind, 'ouverture');
  check("consommé = reprise + bon", l.charged, 50000);
  check("à crédit = reprise + bon", l.chargedOnCredit, 50000);
  check("réglé", l.paid, 4000);
  check("reste dû d'après les pièces", l.debtFromDocuments, 46000);
  // Le compteur de la fiche et les pièces racontent enfin la même histoire :
  // c'est cet écart qui affichait un avertissement sur chaque client repris.
  check("plus aucun écart avec le compteur de la fiche", l.debtGap, 0);

  // La liste entière passe par le chemin groupé : elle doit dire la même chose.
  const all = clientLedgers(app);
  check("la liste des comptes compte aussi la reprise", all['c1'].debtFromDocuments, 46000);

  // …et le relevé imprimable également.
  const st = fuelClientStatement(app, client);
  check("le relevé porte la ligne d'ouverture", st.allLines.filter(x => x.kind === 'ouverture').length, 1);
  check("reste dû du relevé", st.closingDebt, 46000);
  check("le relevé s'ouvre sur la reprise", st.allLines[st.allLines.length - 1].kind, 'ouverture');
}

// ─── 2. Carburant : l'avance d'ouverture ──────────────────────────────────────
section('Carburant — un compte prépayé ouvert avec 20 000 DA');
{
  const client = {
    id: 'c2', name: 'STE Nour', paymentMode: 'ADVANCE',
    debt: 0, balance: 20000, advanceBalance: 12000,
    openingAdvance: 20000, openingDate: '2026-01-01',
    transactionHistory: [],
  };
  const app = {
    clients: [client],
    brigades: [{ id: 'b1', date: '2026-02-10', startDatetime: '2026-02-10T06:00:00', shift: 'Matin' }],
    brigadeAccountings: [{
      id: 'a1', brigadeId: 'b1',
      justifications: [{ id: 'j1', clientId: 'c2', amount: 8000, liters: 160, fuelType: 'GASOIL', pricePerLiter: 50, paymentMode: 'AVANCE' }],
    }],
    shopSales: [], fuelSales: [],
  };

  const l = clientLedger(app, 'c2');
  check("le versement d'ouverture est compté comme un dépôt", l.recharged, 20000);
  check('le bon a consommé 8 000 sur cette avance', l.chargedOnAdvance, 8000);
  check("l'avance d'après les pièces = colonne de la fiche", l.advanceFromDocuments, 12000);
  check("un compte prépayé ne doit rien", l.debtFromDocuments, 0);
}

// ─── 3. Cafétéria / Lavage : la reprise vit sur la fiche ──────────────────────
section('Cafétéria — une ardoise reprise, réglée à moitié');
{
  const client: any = {
    id: 'k1', name: 'Café Central', createdAt: '2026-01-01T08:00:00',
    openingDebt: 12000, openingDate: '2026-01-01',
    openingPayments: [{ id: 'p1', date: '2026-02-15T11:00:00', amount: 5000, mode: 'Espèces' }],
  };
  const state: any = {
    ...EMPTY_MODULE(),
    clients: [client],
    sales: [{
      id: 's1', ref: 'V-1', clientId: 'k1', clientName: 'Café Central', date: '2026-02-01T10:00:00',
      items: [{ productName: 'Café', qty: 10, unitPrice: 50 }],
      total: 500, paid: 200, rest: 300, status: 'crédit',
      payments: [{ id: 'sp1', date: '2026-02-01T10:00:00', amount: 200, mode: 'Espèces' }],
    }],
  };

  const st = bizClientStatement(state, client, 'Cafétéria');
  check("la reprise ouvre le journal", st.allLines[st.allLines.length - 1].kind, 'ouverture');
  check('consommé = reprise + vente', st.totals.charged, 12500);
  check('encaissé = 5 000 sur la reprise + 200 sur la vente', st.totals.paid, 5200);
  check('reste dû', st.closingDebt, 7300);
  check('deux lignes de règlement au relevé', st.payments.length, 2);

  const rest = openingDebtRest(client);
  check('reste de la seule reprise', rest.rest, 7000);

  // Le tiroir de la partie doit voir l'argent de la reprise entrer.
  const cash = moduleCaisseMovements(state, 'cafeteria' as any);
  const openLine = cash.find(m => m.id === 'open-pay-p1');
  check("le règlement de la reprise entre en caisse", openLine?.amount, 5000);

  // Et le rapport de la partie doit réclamer ce qui reste dessus.
  const report = computeModuleReport(state, 'cafeteria' as any, '2026-01-01', '2026-12-31');
  const reprise = report.clientDebts.find(d => d.ref === 'REPRISE');
  check('la reprise figure parmi les créances', reprise?.rest, 7000);
  check('la créance totale de la partie', report.clientDebtTotal, 7300);
}

// ─── 4. Le lecteur de la reprise ──────────────────────────────────────────────
section('La reprise se lit toujours, même mal renseignée');
{
  check('un client sans reprise ne doit rien', clientOpening({}).debt, 0);
  check('un montant négatif ne crée pas un avoir', clientOpening({ openingDebt: -500 }).debt, 0);
  check("sans date, l'ouverture reste la première ligne", clientOpening({ openingDebt: 100 }).date, '1970-01-01');
  check('la date de reprise prime sur la création', clientOpening({ openingDebt: 100, openingDate: '2026-01-01', createdAt: '2026-05-05' }).date, '2026-01-01');
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
