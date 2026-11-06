/**
 * ─── L'AVANCE D'OUVERTURE D'UN COMPTE CLIENT ──────────────────────────────────
 *
 * Le pendant de `clientOpening.test.ts`, de l'autre côté du compte. Ce que ces
 * cas protègent, parce que c'est exactement ce qui était cassé :
 *
 *   • l'avance saisie à la création d'une fiche était écrite en base, affichée
 *     sur le formulaire, et IGNORÉE partout ailleurs — sur les parties
 *     Cafétéria et Lavage, aucun écran ne la lisait ;
 *   • comptée comme un RÈGLEMENT, elle gonflait le « total encaissé » de la
 *     carte et du dossier, et la fenêtre d'encaissement réclamait ensuite une
 *     seconde fois l'argent que le client avait déjà versé ;
 *   • la dette et l'avance vivaient dans deux colonnes qui ne se rencontraient
 *     jamais : un client prépayé figurait parmi les débiteurs — sur sa carte,
 *     dans la Caisse Générale et dans les rapports — pour son propre argent ;
 *   • corriger l'avance d'une fiche existante doit compter exactement comme la
 *     saisir à la création.
 *
 *   npx tsx src/lib/clientAdvance.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { clientLedger, clientLedgers } from './clientLedger';
import { fuelClientStatement, bizClientStatement } from './clientStatement';
import { clientNetPosition, openingAdvance, computeModuleReport, moduleCaisseBalance } from './bizReporting';
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

// ─── 1. Carburant — un compte ouvert sur une avance, rien de consommé ────────
section('Carburant — client créé « sur avance » avec 50 000 DA');
{
  const client: any = {
    id: 'c1', name: 'STE Prépayée', paymentMode: 'ADVANCE',
    debt: 0, balance: 50000, advanceBalance: 50000,
    openingAdvance: 50000, openingDate: '2026-08-01',
    transactionHistory: [],
  };
  const app: any = { clients: [client], brigades: [], brigadeAccountings: [], shopSales: [], fuelSales: [] };

  const l = clientLedger(app, 'c1');
  check("l'avance est une LIGNE de l'historique", l.entries.length, 1);
  check('et elle porte sa propre nature', l.entries[0].kind, 'avance');
  check('elle vaut ce qui a été saisi', l.entries[0].paid, 50000);
  check("elle crédite le compte d'avance", l.advanceFromDocuments, 50000);
  check('elle ne crée aucune dette', l.debtFromDocuments, 0);
  check("elle n'est PAS un règlement de dette", l.paid, 0);
  check("l'avance reste entière au client", l.advanceLeft, 50000);
  check('un client prépayé ne doit rien', l.netDebt, 0);

  const st = fuelClientStatement(app, client);
  check("le relevé montre la ligne d'avance", st.allLines.filter(x => x.kind === 'avance').length, 1);
  check("le total encaissé n'inclut pas la reprise", st.totals.paid, 0);
  check('aucun règlement au tableau des règlements', st.payments.length, 0);
  check("l'avance de reprise est comptée à part", st.totals.advanceOpening, 50000);
  check("elle n'est pas un document facturé", st.totals.documents, 0);
  check("solde d'avance à la clôture", st.advanceHeld, 50000);
  check('rien à réclamer', st.netDebt, 0);
}

// ─── 2. Carburant — l'avance s'impute sur ce que le client doit ──────────────
section("Carburant — 50 000 DA d'avance, 60 000 DA de bons à crédit");
{
  const client: any = {
    id: 'c2', name: 'Transport Mixte', paymentMode: 'ADVANCE',
    debt: 60000, balance: 50000, advanceBalance: 50000,
    openingAdvance: 50000, openingDate: '2026-08-01', transactionHistory: [],
  };
  const app: any = {
    clients: [client],
    brigades: [{ id: 'b1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00', shift: 'Matin' }],
    brigadeAccountings: [{
      id: 'a1', brigadeId: 'b1',
      justifications: [{ id: 'j1', clientId: 'c2', amount: 60000, liters: 1000, fuelType: 'GASOIL', paymentMode: 'CREDIT' }],
    }],
    shopSales: [], fuelSales: [],
  };

  const l = clientLedger(app, 'c2');
  check('la dette brute reste celle des pièces', l.debtFromDocuments, 60000);
  check("l'avance détenue est intacte", l.advanceHeld, 50000);
  check('on ne peut lui réclamer que la différence', l.netDebt, 10000);
  check("il ne lui reste plus rien d'avance", l.advanceLeft, 0);

  // La liste entière passe par le chemin groupé : elle doit dire la même chose.
  check('la liste des comptes impute aussi', clientLedgers(app)['c2'].netDebt, 10000);

  const st = fuelClientStatement(app, client);
  check('le relevé réclame le net', st.netDebt, 10000);
  check('et garde la dette brute lisible', st.closingDebt, 60000);
}

// ─── 3. Carburant — une avance CORRIGÉE après coup compte pareil ─────────────
section('Carburant — reprise corrigée sur une fiche existante');
{
  // Ce que l'écran écrit quand on porte l'avance de 0 à 30 000 : la reprise ET
  // les deux compteurs de la fiche, par DIFFÉRENCE (jamais en écrasant).
  const before: any = {
    id: 'c3', name: 'Ex-comptant', paymentMode: 'CREDIT',
    debt: 12000, balance: 0, advanceBalance: 0,
    openingAdvance: 0, openingDebt: 0, transactionHistory: [],
  };
  const wasAdv = Math.max(0, before.openingAdvance || 0);
  const advance = 30000;
  const after: any = {
    ...before,
    openingAdvance: advance, openingDate: '2026-08-20',
    balance: Math.max(0, before.balance + (advance - wasAdv)),
    advanceBalance: Math.max(0, (before.advanceBalance ?? before.balance) + (advance - wasAdv)),
  };

  const app: any = {
    clients: [after],
    brigades: [{ id: 'b1', date: '2026-08-05', startDatetime: '2026-08-05T06:00:00', shift: 'Matin' }],
    brigadeAccountings: [{
      id: 'a1', brigadeId: 'b1',
      justifications: [{ id: 'j1', clientId: 'c3', amount: 12000, liters: 200, fuelType: 'GASOIL', paymentMode: 'CREDIT' }],
    }],
    shopSales: [], fuelSales: [],
  };

  const l = clientLedger(app, 'c3');
  check('la correction entre au journal', l.entries.filter(e => e.kind === 'avance').length, 1);
  check("la dette d'avant reste due", l.debtFromDocuments, 12000);
  check("l'avance l'éteint entièrement", l.netDebt, 0);
  check('et il lui reste le solde', l.advanceLeft, 18000);
  check('les deux compteurs de la fiche bougent ensemble', after.balance, after.advanceBalance);
}

// ─── 4. Cafétéria — l'avance d'ouverture, enfin lue ──────────────────────────
section('Cafétéria — avance initiale de 20 000, vente à crédit de 5 000');
{
  const client: any = {
    id: 'k1', name: 'Prépayé Café', createdAt: '2026-08-01T08:00:00',
    openingDebt: 0, openingAdvance: 20000, openingDate: '2026-08-01',
  };
  const state: any = {
    ...EMPTY_MODULE(),
    clients: [client],
    sales: [{
      id: 's1', ref: 'V-1', clientId: 'k1', clientName: 'Prépayé Café', date: '2026-08-10T10:00:00',
      items: [{ productName: 'Café', qty: 10, unitPrice: 500 }],
      total: 5000, paid: 0, rest: 5000, status: 'crédit', payments: [],
    }],
  };

  const st = bizClientStatement(state, client, 'Cafétéria');
  check("l'avance est une ligne du journal", st.allLines.filter(l => l.kind === 'avance').length, 1);
  check('et elle OUVRE le compte', st.allLines[st.allLines.length - 1].kind, 'avance');
  check("elle n'est pas comptée comme un encaissement", st.totals.paid, 0);
  check('aucun règlement au tableau des règlements', st.payments.length, 0);
  check('la vente reste due sur le papier', st.closingDebt, 5000);
  check("mais l'avance la couvre", st.netDebt, 0);
  check('et il reste 15 000 au client', st.advanceLeft, 15000);

  const pos = clientNetPosition(client, 5000);
  check('la position nette du client', pos.net, 0);
  check("l'avance imputée", pos.applied, 5000);
  check('ce qui lui reste', pos.left, 15000);

  // Le rapport de la partie ne réclame plus ce qu'il détient déjà.
  const report = computeModuleReport(state, 'cafeteria' as any, '2026-01-01', '2026-12-31');
  check('la créance de la partie est éteinte', report.clientDebtTotal, 0);
  check("et l'avance détenue est dite", report.clientAdvanceTotal, 15000);
  const avanceRow = report.clientDebts.find(d => d.ref === 'AVANCE');
  check('une ligne AVANCE explique la déduction', avanceRow?.rest, -5000);

  // Une reprise n'a fait entrer aucun billet : le tiroir ne bouge pas.
  check('le tiroir de la partie reste à zéro', moduleCaisseBalance(state, 'cafeteria' as any), 0);
}

// ─── 5. Lavage — avance et dette de reprise sur la même fiche ────────────────
section("Lavage — 8 000 de dette reprise et 3 000 d'avance");
{
  const client: any = {
    id: 'w1', name: 'Garage Sud', createdAt: '2026-07-01T08:00:00',
    openingDebt: 8000, openingAdvance: 3000, openingDate: '2026-07-01',
    openingPayments: [{ id: 'p1', date: '2026-07-20T10:00:00', amount: 2000, mode: 'Espèces' }],
  };
  const state: any = { ...EMPTY_MODULE(), clients: [client] };

  const st = bizClientStatement(state, client, 'Lavage & Réparation');
  check('les deux reprises figurent au journal',
    st.allLines.filter(l => l.kind === 'ouverture' || l.kind === 'avance').length, 2);
  check('le règlement de la reprise, lui, est bien un encaissement', st.totals.paid, 2000);
  check('dette brute après ce règlement', st.closingDebt, 6000);
  check("l'avance en éteint 3 000", st.netDebt, 3000);
  check("il ne lui reste rien d'avance", st.advanceLeft, 0);

  const pos = clientNetPosition(client, 0);
  check('la reprise non soldée fait la créance brute', pos.gross, 6000);
  check('avance imputée', pos.applied, 3000);
  check('reste réclamable', pos.net, 3000);

  // Le règlement encaissé, LUI, entre bien au tiroir — la reprise, non.
  check('seul le règlement entre en caisse', moduleCaisseBalance(state, 'lavage' as any), 2000);
}

// ─── 6b. Cafétéria — un trop-perçu devient une avance ────────────────────────
section('Cafétéria — dette de 1 000, le client règle 2 500');
{
  // L'état APRÈS le passage de `settleDebt` : la vente à crédit est soldée, et
  // les 1 500 DA en trop sont portés à `advancePayments` (le dépôt d'avance).
  const client: any = {
    id: 'k2', name: 'Client Généreux', createdAt: '2026-08-01T08:00:00',
    openingDebt: 0, openingAdvance: 0, openingDate: '2026-08-01',
    advancePayments: [{ id: 'ad1', date: '2026-08-12T11:00:00', amount: 1500, mode: 'Espèces' }],
  };
  const state: any = {
    ...EMPTY_MODULE(),
    clients: [client],
    sales: [{
      id: 's2', ref: 'V-2', clientId: 'k2', clientName: 'Client Généreux', date: '2026-08-10T10:00:00',
      items: [{ productName: 'Sandwich', qty: 5, unitPrice: 200 }],
      total: 1000, paid: 1000, rest: 0, status: 'payée',
      payments: [{ id: 'sp1', date: '2026-08-12T11:00:00', amount: 1000, mode: 'Espèces' }],
    }],
  };

  const st = bizClientStatement(state, client, 'Cafétéria');
  check('le dépôt d’avance est une ligne du journal',
    st.allLines.filter(l => l.kind === 'recharge').length, 1);
  check('encaissé = 1 000 de la vente + 1 500 d’avance', st.totals.paid, 2500);
  check('plus aucune dette', st.netDebt, 0);
  check('le client détient 1 500 d’avance', st.advanceLeft, 1500);

  const pos = clientNetPosition(client, 0);
  check('la position nette : rien à réclamer', pos.net, 0);
  check('avance disponible', pos.left, 1500);

  const report = computeModuleReport(state, 'cafeteria' as any, '2026-01-01', '2026-12-31');
  check('la partie ne réclame plus rien', report.clientDebtTotal, 0);
  check('elle détient 1 500 d’avance', report.clientAdvanceTotal, 1500);

  // Les 2 500 sont bien entrés au tiroir : le règlement ET le trop-perçu.
  check('le tiroir compte l’intégralité versée', moduleCaisseBalance(state, 'cafeteria' as any), 2500);
}

// ─── 6. Le lecteur de l'avance ───────────────────────────────────────────────
section("L'avance se lit toujours, même mal renseignée");
{
  check("pas d'avance sur une fiche vierge", openingAdvance({}), 0);
  check('un montant négatif ne crée pas une dette', openingAdvance({ openingAdvance: -900 }), 0);
  const pos = clientNetPosition({ openingAdvance: 5000 }, -100);
  check('une créance négative ne se retourne pas en avoir', pos.gross, 0);
  check("l'avance reste entière", pos.left, 5000);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
