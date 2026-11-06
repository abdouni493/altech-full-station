/**
 * ─── AUDIT DES CALCULS — toutes les interfaces ─────────────────────────────────
 *
 *   npx tsx tests/audit/audit.ts [snapshot.json]
 *
 * Relit un instantané de l'application réelle (`snapshot.cjs`) et recalcule,
 * avec le CODE MÊME de chaque écran, les chiffres que ces écrans affichent :
 * brigades, rapports Carburant, rapports des parties, Rapports Généraux, Caisse
 * Générale, comptes bancaires, clients, fournisseurs, achats, factures.
 *
 * Chaque chiffre qui apparaît sur deux écrans doit y être IDENTIQUE, et chaque
 * document doit s'additionner (total = lignes − remise + TVA + taxes, payé +
 * reste = total…). Le moindre écart (> 0,01 DA) est un « décalage » : il est
 * listé et le script sort en échec.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
import { computeCarburantSales, computeCarburantCash } from '../../src/lib/carburantSales';
import { computeCarburantPeriodReport } from '../../src/lib/carburantReport';
import {
  computeCarburantReport, computeModuleReport, moduleCaisseBalance, consolidate,
} from '../../src/lib/bizReporting';
import { computeTreasuryReport } from '../../src/lib/treasuryReporting';
import { clientLedgers } from '../../src/lib/clientLedger';
import { totalSupplierDebt, purchaseRest } from '../../src/lib/supplierDebt';
import {
  brigadeNozzleRows, brigadePompisteGroups, justifiedByPompiste,
} from '../../src/lib/brigadeCalc';
import { bankBalanceOf, caisseBalanceOf, isBrigadeExpense } from '../../src/store/AppContext';
import { activeModuleKeys, applyMagasinSettings } from '../../src/lib/bizConfig';
import { computeStockValuation } from '../../src/lib/stockValuation';
import { computeWorkingCapital } from '../../src/lib/workingCapital';

const file = process.argv[2] || path.join(HERE, 'snapshot.json');
const { app, biz } = JSON.parse(fs.readFileSync(file, 'utf8'));
applyMagasinSettings(app.settings);
const FROM = '2000-01-01', TO = '2100-12-31';
const EPS = 0.01;
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let checks = 0;
const issues: { area: string; label: string; a: number; b: number; detail?: string }[] = [];
let currentArea = '';
const area = (name: string) => { currentArea = name; console.log(`\n■ ${name}`); };
const eq = (label: string, a: number, b: number, detail?: string) => {
  checks++;
  if (Math.abs(n(a) - n(b)) > EPS) {
    issues.push({ area: currentArea, label, a: n(a), b: n(b), detail });
    console.log(`  ✗ ${label} : ${fmt(n(a))} ≠ ${fmt(n(b))}${detail ? ` — ${detail}` : ''}`);
  } else console.log(`  ✓ ${label} (${fmt(n(a))})`);
};
const ok = (label: string, cond: boolean, detail?: string) => {
  checks++;
  if (!cond) { issues.push({ area: currentArea, label, a: 0, b: 0, detail }); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  else console.log(`  ✓ ${label}`);
};
const sum = <T,>(l: T[], f: (x: T) => number) => (l || []).reduce((s, x) => s + n(f(x)), 0);

const ctx = { pumps: app.pumps, tanks: app.tanks, pumpNozzles: app.pumpNozzles, pompistes: app.pompistes, settings: app.settings };

// ─── 1. Brigades — chaque comptabilité doit s'équilibrer ──────────────────────
area('1. Brigades : comptabilité de chaque brigade');
for (const b of app.brigades || []) {
  const acc = (app.brigadeAccountings || []).find((a: any) => a.brigadeId === b.id);
  if (!acc) continue;
  const tag = `${b.date} ${b.shift}`;
  const justifs = acc.justifications || [];
  const rows = brigadeNozzleRows(b, ctx);
  const groups = brigadePompisteGroups(b, ctx, rows, justifiedByPompiste(justifs)).filter(g => !g.unassigned || g.totalLiters > 0);
  const products = sum(b.armoireSales || [], (s: any) => s.total)
    + sum((b.magasinProductMoves || []).filter((m: any) => m.kind === 'VENTE'), (m: any) => m.total);
  const fuel = sum(rows, r => r.amount);
  eq(`[${tag}] montant pistolets = total dû comptabilité`, fuel, acc.totalDue);
  eq(`[${tag}] théorique pompistes = carburant + produits`, sum(groups, g => g.theoretical), n(acc.totalDue) + products);
  eq(`[${tag}] espèces pompistes = espèces reçues`, sum(groups, g => g.collected), acc.cashReceived);
  eq(`[${tag}] justifié pompistes = Σ justifications`, sum(groups, g => g.justified), sum(justifs, (j: any) => j.amount));
  const ecart = sum(groups, g => g.ecart);
  eq(`[${tag}] décalage pompistes = reste comptabilité`, ecart, acc.rest);
  for (const g of groups) {
    const v = (b.versements || []).filter((x: any) => x.pompisteId === g.pompisteId);
    // espèces = montant tapé + versements horodatés : les versements n'en dépassent jamais le total.
    if (v.length) ok(`[${tag}] versements ${g.name} ≤ espèces`, sum(v, (x: any) => x.amount) <= g.collected + EPS, `${fmt(sum(v, (x: any) => x.amount))} > ${fmt(g.collected)}`);
  }
  for (const j of justifs) {
    if (j.entryMode === 'DETAIL' && (j.operations || []).length)
      eq(`[${tag}] opérations ${j.justificationType} = montant justification`, sum(j.operations, (o: any) => o.amount), j.amount);
  }
}

// ─── 2. Carburant : les trois rapports doivent dire la même chose ─────────────
area('2. Carburant : Rapports Carburant ↔ Rapports Généraux ↔ calcul brigades');
const cs = computeCarburantSales(app, FROM, TO);
const cr = computeCarburantPeriodReport(app, FROM, TO);
const gr = computeCarburantReport(app, FROM, TO);
eq('Litres vendus (Rapports Généraux ↔ Rapports Carburant)', cs.liters, cr.liters);
eq('Ventes carburant', cs.revenue, cr.fuelSales);
eq('Espèces remises', cs.cash, cr.cash);
eq('TPE + TAG', cs.tpe, cr.tpe + cr.tag);
eq('Crédit client', cs.credit, cr.credit);
eq('Dépenses brigade', cs.expense, cr.expense);
eq('Achats produits (brigade)', cs.productPurchases, cr.achat);
eq('Produits vendus (armoires + magasins)', cs.productSales, cr.armoireSales + cr.magasinSales);
eq('Décalage / manquant', cs.rest, cr.ecart);
eq('Litres Rapports Généraux', gr.fuelLiters, cs.liters);
const shopTotal = sum((app.shopSales || []), (s: any) => s.total);
eq('CA Rapports Généraux = carburant + produits + factures', gr.salesTotal, cs.revenue + cs.productSales + shopTotal);
eq('Achats carburant (Rapport Carburant) = achats carburant', cr.purchases, sum((app.purchases || []).filter((p: any) => p.items?.some((i: any) => i.tankId) || p.tankId), (p: any) => p.total));

// ─── 3. Caisses : Caisse Générale ↔ Rapports ↔ trésorerie ─────────────────────
area('3. Caisses : Caisse Générale ↔ Rapports Généraux ↔ Trésorerie');
const tr = computeTreasuryReport(app, biz, FROM, TO);
const partBal = (k: string) => tr.partBalances.find(p => p.key === k)?.balance ?? NaN;
const cc = computeCarburantCash(app);
eq('Caisse Carburant (Caisse Générale ↔ trésorerie)', cc.balance, partBal('carburant'));
eq('Caisse Carburant (Rapport Carburant)', gr.caisseBalance, cc.balance);
eq('Caisse Carburant : entrées − sorties = solde', cc.inflow - cc.outflow, cc.balance);
const moduleReports: any[] = [];
for (const k of activeModuleKeys()) {
  const st = (biz as any)[k];
  if (!st) continue;
  const mr = computeModuleReport(st, k, FROM, TO, app.treasuryTransactions, app.expenses);
  moduleReports.push(mr);
  const mb = moduleCaisseBalance(st, k, app.treasuryTransactions, app.expenses);
  eq(`Caisse ${mr.label} (Caisse Générale ↔ trésorerie)`, mb, partBal(k));
  eq(`Caisse ${mr.label} (rapport de la partie)`, mr.caisseBalance, mb);
  eq(`Caisse ${mr.label} : Σ mouvements = solde`, sum(mr.caisseMovements, (m: any) => m.amount), mr.caisseBalance);
  // Chaque document de la partie s'additionne.
  for (const s of st.sales || []) {
    eq(`${mr.label} vente ${s.ref || s.id} : payé + reste = total`, n(s.paid) + n(s.rest), s.total);
  }
  for (const r of st.reparations || []) {
    eq(`${mr.label} intervention ${r.ref || r.id} : payé + reste = total`, n(r.paid) + n(r.rest), r.total);
  }
  for (const p of st.purchases || []) {
    eq(`${mr.label} achat ${p.ref || p.id} : payé + reste = total`, n(p.paid) + n(p.rest), p.total);
  }
}
const drawer = caisseBalanceOf(app.treasuryTransactions);
const financeLines = (app.treasuryTransactions || []).filter((t: any) => (t.part || 'systeme') === 'systeme'
  && (t.accountTo === 'CAISSE') !== (t.accountFrom === 'CAISSE'));
const financeCash = sum(financeLines, (t: any) => (t.accountTo === 'CAISSE' ? t.amount : -t.amount));
eq('Caisse Finance (Caisse Générale ↔ trésorerie)', financeCash, partBal('systeme'));
const activities = tr.partBalances.filter(p => p.key !== 'systeme').reduce((s, p) => s + p.balance, 0);
eq('Solde caisse générale = Σ caisses des activités', activities, tr.activitiesCash);
eq('Toutes les caisses (Caisse Générale ↔ Rapports Généraux)', activities + financeCash, tr.cashTotal);
eq('Tiroir commun (grand livre) ↔ trésorerie', drawer, tr.caisseBalance);
ok('Tiroir commun cohérent (nombre fini)', Number.isFinite(drawer));

// ─── 4. Banques ───────────────────────────────────────────────────────────────
area('4. Comptes bancaires');
for (const a of app.bankAccounts || []) {
  const live = bankBalanceOf(a, app.treasuryTransactions);
  const t = tr.accounts.find(x => x.id === a.id);
  eq(`${a.name} : solde (Comptes Bancaires ↔ trésorerie)`, live, t?.balance ?? NaN);
  if (t) eq(`${a.name} : Σ parts par activité = solde`, sum(t.parts, p => p.balance), t.balance);
}
eq('Total banques', sum(app.bankAccounts || [], (a: any) => bankBalanceOf(a, app.treasuryTransactions)), tr.bankTotal);
eq('Trésorerie totale = toutes les caisses + banques', tr.grandTotal, tr.cashTotal + tr.bankTotal);

// ─── 5. Rapports Généraux : la consolidation ──────────────────────────────────
area('5. Rapports Généraux : consolidation des parties');
const financeExpenses = (app.expenses || []).filter((e: any) => (e.part || 'carburant') === 'systeme');
const global = consolidate([gr, ...moduleReports], FROM, TO, financeExpenses);
const parts = [gr, ...moduleReports];
for (const key of ['salesTotal', 'purchasesTotal', 'salariesPaid', 'grossMargin', 'clientDebtTotal', 'supplierDebtTotal', 'stockValue', 'cogs'] as const) {
  eq(`Global.${key} = Σ parties`, (global as any)[key], sum(parts, (p: any) => p[key]));
}
eq('Global.expensesTotal = Σ parties + Finance', global.expensesTotal, sum(parts, (p: any) => p.expensesTotal) + sum(financeExpenses, (e: any) => e.amount));
eq('Global.netGain = Σ parties − dépenses Finance', global.netGain, sum(parts, (p: any) => p.netGain) - sum(financeExpenses, (e: any) => e.amount));
for (const p of parts) {
  eq(`${p.label} : marge brute = CA − coût`, p.grossMargin, p.salesTotal - p.cogs);
  eq(`${p.label} : Σ lignes de ventes = CA`, sum(p.sales, (s: any) => s.total), p.salesTotal);
  eq(`${p.label} : Σ dépenses détaillées = total dépenses`, sum(p.expenses.filter((e: any) => e.kind === 'Dépense'), (e: any) => e.amount), p.expensesTotal);
  eq(`${p.label} : gain net = marge − dépenses − salaires − destructions − pertes`, p.netGain, p.grossMargin - p.expensesTotal - p.salariesPaid - n(p.destroyedValue) - n(p.lossValue));
  eq(`${p.label} : Σ dépenses par catégorie = total`, sum(p.expensesByCategory, (e: any) => e.amount), p.expensesTotal);
  eq(`${p.label} : Σ créances clients = encours`, sum(p.clientDebts, (d: any) => d.rest), p.clientDebtTotal);
  eq(`${p.label} : Σ dettes fournisseurs = encours`, sum(p.supplierDebts, (d: any) => d.rest), p.supplierDebtTotal);
  eq(`${p.label} : Σ lignes de stock = valeur du stock`, sum(p.stockLines, (l: any) => l.value), p.stockValue);
}
// Dépenses : chaque dépense de la station est comptée dans UNE partie, une seule fois.
const appExpenses = (app.expenses || []).reduce((s: number, e: any) => s + n(e.amount), 0);
const moduleOwn = moduleReports.reduce((s, p) => s + sum((biz as any)[p.key]?.expenses || [], (e: any) => e.amount), 0);
eq('Dépenses : Rapports Généraux = dépenses station + dépenses propres des parties', global.expensesTotal, appExpenses + moduleOwn);

// ─── 6. Clients ───────────────────────────────────────────────────────────────
area('6. Clients Carburant');
const ledgers = clientLedgers(app);
for (const c of app.clients || []) {
  const l = ledgers[c.id];
  if (!l) continue;
  eq(`${c.name} : Σ effets du journal = dette des documents`, sum(l.entries, e => e.debtEffect), l.debtFromDocuments);
  // L'écran Clients compare la colonne `debt` au journal : un écart s'affiche « Écart fiche ».
  eq(`${c.name} : dette de la fiche = dette des documents (pas d'« écart fiche »)`, c.debt, l.debtFromDocuments);
  if (c.advanceBalance !== undefined && (c.paymentMode === 'ADVANCE' || n(c.advanceBalance) || l.advanceFromDocuments))
    eq(`${c.name} : avance de la fiche = avance des documents`, c.advanceBalance, Math.max(0, l.advanceFromDocuments));
}
eq('Créances Carburant (Rapports Généraux ↔ fiches clients)', gr.clientDebtTotal, sum(Object.values(ledgers), (l: any) => l.netDebt));

// ─── 7. Fournisseurs & achats carburant ───────────────────────────────────────
area('7. Achats carburant & fournisseurs');
for (const p of app.purchases || []) {
  const items = sum(p.items || [], (i: any) => i.total);
  const sub = p.subtotal ?? items;
  if (p.subtotal !== undefined) eq(`Achat ${p.invoiceNumber || p.id} : Σ lignes = sous-total`, items, sub);
  const ht = n(sub) - n(p.discountAmount);
  const expected = ht + n(p.tvaAmount) + n(p.extraTaxesAmount);
  if (p.subtotal !== undefined) eq(`Achat ${p.invoiceNumber || p.id} : total = HT + TVA + taxes`, p.total, expected);
  eq(`Achat ${p.invoiceNumber || p.id} : Σ taxes = montant taxes`, sum(p.extraTaxes || [], (t: any) => t.amount), n(p.extraTaxesAmount));
  eq(`Achat ${p.invoiceNumber || p.id} : Σ règlements = payé`, sum(p.payments || [], (x: any) => x.amount), p.amountPaid);
  eq(`Achat ${p.invoiceNumber || p.id} : reste = total − payé`, purchaseRest(p), Math.max(0, n(p.total) - n(p.amountPaid)));
}
eq('Dette fournisseurs Carburant (Rapports Généraux ↔ écran Fournisseurs)', gr.supplierDebtTotal, totalSupplierDebt(app));

// ─── 8. Factures Ventes Carburant ─────────────────────────────────────────────
area('8. Factures Ventes Carburant');
for (const s of (app.shopSales || []).filter((x: any) => x.invoice?.kind === 'CARBURANT')) {
  const inv = s.invoice;
  const lines = sum(inv.lines, (l: any) => l.total);
  eq(`${inv.number} : chaque ligne = qté × prix`, lines, sum(inv.lines, (l: any) => Math.round(n(l.quantity) * n(l.price) * 100) / 100));
  eq(`${inv.number} : HT = lignes − remise`, s.subtotal, lines - n(inv.discountAmount));
  eq(`${inv.number} : TTC = HT + TVA + taxes`, s.total, n(s.subtotal) + n(s.tvaAmount) + n(inv.taxesAmount));
  eq(`${inv.number} : payé + reste = TTC`, n(s.amountPaid) + n(s.rest), s.total);
}

// ─── 9. Stock & fonds de roulement ────────────────────────────────────────────
area('9. Valeur du stock & fonds de roulement');
const sv = computeStockValuation(app, biz);
eq('Stock : Σ parties = total achat', sum(sv.parts, (p: any) => p.buyValue), (sv as any).totalBuy ?? sum(sv.parts, (p: any) => p.buyValue));
const wc = computeWorkingCapital(tr, global.parts, sv);
eq('Fonds de roulement : caisses = Caisse Générale', n((wc as any).cashTotal), tr.cashTotal);
eq('Fonds de roulement : trésorerie = Rapports Généraux', n((wc as any).cashTotal) + n((wc as any).bankTotal), tr.grandTotal);

// ─── Bilan ────────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════════`);
console.log(`${checks} contrôles — ${issues.length} décalage(s)`);
if (issues.length) {
  for (const i of issues) console.log(`  ✗ [${i.area}] ${i.label} : ${fmt(i.a)} ≠ ${fmt(i.b)}${i.detail ? ` (${i.detail})` : ''}`);
  process.exitCode = 1;
}
