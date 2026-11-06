/**
 * Vérifie que le scénario (`scenario.cjs`) a fait bouger CHAQUE chiffre de
 * l'application d'exactement ce qu'il devait — sur tous les écrans à la fois.
 *
 *   npx tsx tests/audit/deltas.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
import { computeCarburantCash, computeCarburantSales } from '../../src/lib/carburantSales';
import { computeCarburantReport, computeModuleReport, consolidate } from '../../src/lib/bizReporting';
import { computeTreasuryReport } from '../../src/lib/treasuryReporting';
import { clientLedgers } from '../../src/lib/clientLedger';
import { totalSupplierDebt } from '../../src/lib/supplierDebt';
import { bankBalanceOf, financeCashBalance } from '../../src/store/AppContext';
import { activeModuleKeys, applyMagasinSettings } from '../../src/lib/bizConfig';
import { computeCarburantPeriodReport } from '../../src/lib/carburantReport';

const load = (f: string) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
const before = load('before.json'), after = load('after.json'), exp = load('expected.json');
applyMagasinSettings(after.app.settings);
const F = '2000-01-01', T = '2100-12-31';
let fails = 0, checks = 0;
const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eq = (label: string, got: number, want: number) => {
  checks++;
  const ok = Math.abs(got - want) <= 0.01;
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label} : ${fmt(got)}${ok ? '' : ` — attendu ${fmt(want)}`}`);
};

const snap = (s: any) => {
  const { app, biz } = s;
  const tr = computeTreasuryReport(app, biz, F, T);
  const parts = [computeCarburantReport(app, F, T), ...activeModuleKeys().map(k => computeModuleReport(biz[k], k, F, T, app.treasuryTransactions, app.expenses))];
  const g = consolidate(parts, F, T, (app.expenses || []).filter((e: any) => (e.part || 'carburant') === 'systeme'));
  const led = clientLedgers(app);
  const cs = computeCarburantSales(app, F, T);
  const cr = computeCarburantPeriodReport(app, F, T);
  return {
    carburantCash: computeCarburantCash(app).balance,
    carburantCashTreasury: tr.partBalances.find(p => p.key === 'carburant')!.balance,
    financeCash: financeCashBalance(app.treasuryTransactions),
    financeCashTreasury: tr.financeCash,
    cashTotal: tr.cashTotal, grandTotal: tr.grandTotal,
    banks: Object.fromEntries(app.bankAccounts.map((b: any) => [b.id, bankBalanceOf(b, app.treasuryTransactions)])),
    clientNet: Object.fromEntries(app.clients.map((c: any) => [c.id, led[c.id]?.netDebt ?? 0])),
    clientCol: Object.fromEntries(app.clients.map((c: any) => [c.id, c.debt ?? 0])),
    tanks: Object.fromEntries(app.tanks.map((t: any) => [t.id, t.current])),
    supplierDebt: totalSupplierDebt(app),
    expenses: g.expensesTotal,
    netGain: g.netGain,
    invoices: (app.shopSales || []).filter((s: any) => s.invoice?.kind === 'CARBURANT').reduce((a: number, s: any) => a + s.total, 0),
    purchases: (app.purchases || []).reduce((a: number, p: any) => a + p.total, 0),
    tpeGeneral: cs.tpe, tpeCarbReport: cr.tpe + cr.tag,
  };
};
const A = snap(before), B = snap(after);
const d = (k: keyof typeof A) => (B as any)[k] - (A as any)[k];

console.log('\n■ Caisses');
eq('Caisse Carburant (Caisse Générale)', d('carburantCash'), exp.carburantCash);
eq('Caisse Carburant (Rapports Généraux)', d('carburantCashTreasury'), exp.carburantCash);
eq('Caisse Finance (Caisse Générale)', d('financeCash'), exp.financeCash);
eq('Caisse Finance (Rapports Généraux)', d('financeCashTreasury'), exp.financeCash);
const bankDelta = Object.values(exp.bank as Record<string, number>).reduce((a, b) => a + b, 0);
const partsDelta = Object.values((exp.partCash || {}) as Record<string, number>).reduce((a, b) => a + b, 0);
eq('Toutes les caisses', d('cashTotal'), exp.carburantCash + exp.financeCash + partsDelta);
eq('Trésorerie totale', d('grandTotal'), exp.carburantCash + exp.financeCash + partsDelta + bankDelta);
console.log('\n■ Banques');
for (const id of Object.keys(B.banks)) eq(`Compte ${id}`, B.banks[id] - A.banks[id], exp.bank[id] || 0);
console.log('\n■ Clients');
for (const id of Object.keys(B.clientNet)) {
  eq(`Dette client ${id} (journal)`, B.clientNet[id] - A.clientNet[id], exp.clientDebt[id] || 0);
  eq(`Dette client ${id} (fiche)`, B.clientCol[id] - A.clientCol[id], exp.clientDebt[id] || 0);
}
console.log('\n■ Stocks des cuves');
for (const id of Object.keys(B.tanks)) eq(`Cuve ${id}`, B.tanks[id] - A.tanks[id], exp.tank[id] || 0);
console.log('\n■ Fournisseurs, dépenses, ventes');
eq('Dette fournisseurs', d('supplierDebt'), exp.supplierDebt);
eq('Dépenses (Rapports Généraux)', d('expenses'), exp.expenses);
eq('Factures Ventes Carburant', d('invoices'), exp.invoices);
eq('Achats', d('purchases'), exp.purchases);
eq('TPE/TAG (Rapports Généraux)', d('tpeGeneral'), exp.tpe);
eq('TPE/TAG (Rapports Carburant)', d('tpeCarbReport'), exp.tpe);

console.log('\n■ Caisses des parties');
for (const [k, v] of Object.entries((exp.partCash || {}) as Record<string, number>)) {
  const pb = (x: any) => computeTreasuryReport(x.app, x.biz, F, T).partBalances.find(p => p.key === k)!.balance;
  eq(`Caisse ${k} (Caisse Générale ↔ Rapports Généraux)`, pb(after) - pb(before), v);
  const mr = (x: any) => computeModuleReport(x.biz[k], k as any, F, T, x.app.treasuryTransactions, x.app.expenses).caisseBalance;
  eq(`Caisse ${k} (rapport de la partie)`, mr(after) - mr(before), v);
}

console.log('\n■ Ventes & stock des parties');
for (const [k, v] of Object.entries((exp.moduleSales || {}) as Record<string, number>)) {
  const mr = (x: any) => computeModuleReport(x.biz[k], k as any, F, T, x.app.treasuryTransactions, x.app.expenses);
  eq(`CA ${k} (rapport de la partie)`, mr(after).salesTotal - mr(before).salesTotal, v);
  const gl = (x: any) => consolidate([computeCarburantReport(x.app, F, T), ...activeModuleKeys().map(m => computeModuleReport(x.biz[m], m, F, T, x.app.treasuryTransactions, x.app.expenses))], F, T).salesTotal;
  eq(`CA global (Rapports Généraux)`, gl(after) - gl(before), v + exp.invoices);
}
for (const [k, prods] of Object.entries((exp.moduleStock || {}) as Record<string, Record<string, number>>)) {
  for (const [pid, dq] of Object.entries(prods)) {
    const q = (x: any) => (x.biz[k].products || []).find((pp: any) => pp.id === pid)?.currentQty ?? 0;
    eq(`Stock ${k}/${pid}`, q(after) - q(before), dq);
  }
}

// ─── Ce que les ÉCRANS affichent réellement ────────────────────────────────
const scr = fs.existsSync(path.join(HERE, 'screens.json')) ? load('screens.json') : null;
if (scr) {
  console.log('\n■ Chiffres affichés à l\'écran');
  const tr = computeTreasuryReport(after.app, after.biz, F, T);
  eq('Caisse Générale — Trésorerie totale (écran)', scr.cgTresorerie, tr.grandTotal);
  eq('Caisse Générale — Solde caisse générale (écran)', scr.cgSolde, tr.activitiesCash);
  eq('Rapports Généraux — Trésorerie (écran)', scr.grTresorerie, tr.grandTotal);
  const year = String(new Date().getFullYear());
  const cr = computeCarburantPeriodReport(after.app, `${year}-01-01`, after.app ? new Date().toISOString().slice(0, 10) : T);
  eq('Rapports Carburant — Ventes carburant (écran)', scr.rcVentes, cr.fuelSales);
}

if (fs.existsSync(path.join(HERE, 'reloaded.json'))) {
  console.log('\n■ Après rechargement (tout est bien enregistré)');
  const R = snap(load('reloaded.json'));
  const flat = (o: any, pre = ''): [string, number][] => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, Number(v)] as [string, number]]);
  const rb = new Map(flat(R));
  for (const [k, v] of flat(B)) eq(`${k} identique après rechargement`, rb.get(k) ?? NaN, v);
}

console.log(`\n${checks} contrôles — ${fails} écart(s)`);
if (fails) process.exitCode = 1;
