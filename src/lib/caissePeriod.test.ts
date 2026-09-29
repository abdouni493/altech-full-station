/**
 * ─── La Caisse d'une partie compte comme son rapport ───────────────────────────
 *
 * L'écran Caisse d'une partie et les Rapports (celui de la partie comme les
 * Rapports Généraux) annonçaient deux vérités différentes sur les mêmes
 * données. Trois causes, que ces cas verrouillent une par une :
 *
 *   1. LA FENÊTRE — le filtre de période d'un écran (`inPeriod`) et la fenêtre
 *      `from`/`to` que prennent les moteurs de calcul étaient écrits deux fois.
 *      Un écran pouvait lister les mouvements d'un mois et afficher au-dessus
 *      les totaux d'un autre ;
 *   2. LES VENTES — « Ventes encaissées » ne lisait que les factures du point
 *      de vente et ignorait les INTERVENTIONS, c'est-à-dire toute la recette
 *      d'un atelier de lavage ;
 *   3. LA PÉRIODE — achats, dépenses et salaires étaient sommés sur TOUTES les
 *      dates sous un filtre de période qui laissait croire le contraire.
 *
 * Et, parce que la Caisse déplie désormais le travail des employés, on vérifie
 * que ce qu'elle en lit est EXACTEMENT ce que lit le rapport général.
 *
 *   npx tsx src/lib/caissePeriod.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { ModuleState, BizReparation, BizWorker } from './bizConfig';
import { computeModuleReport } from './bizReporting';
import { computeWorkforce, computeBizWorkforce } from './workforceReporting';
import { within } from './period';
import { periodRange, inPeriod, Period } from '@/src/components/biz/Kit';

let passed = 0, failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (label: string, got: number, want: number) =>
  check(label, Math.abs(got - want) < 0.005, `attendu ${want}, obtenu ${got}`);
const section = (t: string) => console.log(`\n${t}`);

// ─── L'atelier : un mois de travail, et une pièce hors période ───────────────
const worker = (id: string, name: string, percentage: number): BizWorker => ({
  id, name, roleName: 'Laveur', paid: true,
  salaryType: 'pourcentage', salaryAmount: 0, percentage,
  hasAccount: false, startDate: '2026-01-01',
  permissions: {}, acomptes: [], absences: [],
  payments: [{ id: 'pay1', period: 'août 2026', amount: 3_000, date: '2026-08-28' }],
  createdAt: '2026-01-01T00:00:00.000Z',
} as BizWorker);

const rep = (o: Partial<BizReparation> & { id: string; date: string }): BizReparation => ({
  ref: o.id.toUpperCase(), kind: 'lavage', clientName: 'Client de passage',
  car: {} as any, serviceTotal: 0, usedProducts: [], total: 0, paid: 0, rest: 0,
  status: 'finalized', workers: [], ...o,
} as BizReparation);

const st: ModuleState = {
  categories: [], marques: [], roles: [], products: [], sales: [],
  clients: [], suppliers: [], productions: [], fiches: [], comptoir: [],
  destructions: [], sessions: [], payRequests: [], inventaires: [], posPinned: [],
  messageTemplates: [], rappels: [],
  workers: [worker('w1', 'Karim', 20)],
  reparations: [
    // Dans la période : 5 000 facturés, 4 000 encaissés.
    rep({
      id: 'r1', date: '2026-09-05', workers: ['w1'],
      prestations: [{ id: 'p1', kind: 'lavage', label: 'Lavage complet', amount: 5_000, workerIds: ['w1'] }],
      serviceTotal: 5_000, total: 5_000, paid: 4_000, rest: 1_000,
    }),
    // Hors période : elle ne doit peser sur AUCUN chiffre de septembre.
    rep({
      id: 'r0', date: '2026-08-12', workers: ['w1'],
      prestations: [{ id: 'p0', kind: 'lavage', label: 'Lavage simple', amount: 900, workerIds: ['w1'] }],
      serviceTotal: 900, total: 900, paid: 900, rest: 0,
    }),
  ],
  purchases: [
    { id: 'a1', ref: 'ACH-1', date: '2026-09-02', supplierName: 'Huiles SPA', items: [], total: 2_000, paid: 2_000, rest: 0 } as any,
    { id: 'a0', ref: 'ACH-0', date: '2026-07-20', supplierName: 'Huiles SPA', items: [], total: 9_000, paid: 9_000, rest: 0 } as any,
  ],
  expenses: [
    { id: 'd1', name: 'Électricité', category: 'Charges', amount: 700, date: '2026-09-08' } as any,
    { id: 'd0', name: 'Électricité', category: 'Charges', amount: 400, date: '2026-06-08' } as any,
  ],
  caisse: [{ id: 'c1', type: 'deposit', amount: 10_000, date: '2026-09-01', description: 'Fonds' } as any],
};

const FROM = '2026-09-01', TO = '2026-09-30';
const report = computeModuleReport(st, 'lavage', FROM, TO);

section('1 · La fenêtre de la période est écrite une seule fois');
// Toute date lue par le filtre d'un écran l'est aussi par la fenêtre que les
// moteurs reçoivent — sinon la liste et les totaux du même écran divergent.
const dates = [
  '2020-01-01T10:00:00.000Z', '2026-06-08T10:00:00.000Z', '2026-09-05T18:30:00.000Z',
  new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString(),
];
const periods: Period[] = ['all', 'today', 'week', 'month', 'year', 'custom'];
let drift = 0;
periods.forEach(p => dates.forEach(d => {
  const r = periodRange(p, FROM, TO);
  if (inPeriod(d, p, FROM, TO) !== within(d, r.from, r.to)) drift++;
}));
check('le filtre d\'écran et la fenêtre des rapports lisent la même période', drift === 0, `${drift} écart(s)`);
check('« tout » n\'a aucune borne', periodRange('all').from === '' && periodRange('all').to === '');
check('une période relative n\'a pas de borne haute', periodRange('month').to === '');
check('une période saisie est reprise telle quelle',
  periodRange('custom', FROM, TO).from === FROM && periodRange('custom', FROM, TO).to === TO);

section('2 · Les interventions sont de la recette, pas un hors-bilan');
// C'est le chiffre que la Caisse affichait faux : elle ne sommait que `sales`.
eq('le chiffre d\'affaires porte l\'intervention', report.salesTotal, 5_000);
eq('l\'encaissement aussi', report.salesPaid, 4_000);
eq('les factures du point de vente seules en diraient 0',
  st.sales.reduce((s: number, x: any) => s + x.paid, 0), 0);
check('l\'opération est comptée', report.counts.sales === 1);

section('3 · Chaque chiffre de la période s\'arrête aux bornes');
eq('achats payés — sans celui de juillet', report.purchasesPaid, 2_000);
eq('dépenses — sans celle de juin', report.expensesTotal, 700);
eq('salaires versés — celui d\'août est hors période', report.salariesPaid, 0);

section('4 · Le solde de caisse, lui, couvre TOUTES les dates');
// Un tiroir ne se vide pas parce qu'on change le filtre d'écran : le solde est
// la somme de tous ses mouvements, la période ne sert qu'à les lire.
const sumAll = report.caisseMovements.reduce((s, m) => s + m.amount, 0);
eq('le solde est la somme de ses mouvements', report.caisseBalance, sumAll);
// 10 000 déposés + 4 000 + 900 encaissés − 2 000 − 9 000 d'achats − 700 − 400
// de dépenses − 3 000 de salaire.
eq('et il compte aussi ce qui est hors période', report.caisseBalance, -200);
eq('entrées', report.caisseFlow.in, 14_900);
eq('sorties', report.caisseFlow.out, 15_100);

section('5 · Le travail des employés se lit pareil des deux côtés');
const fromCaisse = computeBizWorkforce(st, 'lavage', FROM, TO);
const fromGeneral = computeWorkforce({}, { lavage: st, cafeteria: st } as any, FROM, TO)
  .workers.filter(w => w.part === 'lavage');
check('le même nombre d\'employés', fromCaisse.length === fromGeneral.length);
eq('la même part générée', fromCaisse[0].earned, fromGeneral[0].earned);
eq('le même nombre de travaux', fromCaisse[0].worksCount, fromGeneral[0].worksCount);
// 20 % des 5 000 de la prestation de septembre.
eq('la part est celle de SA prestation', fromCaisse[0].earned, 1_000);
// Le reste dû ne connaît pas la période : le lavage d'août reste à payer.
eq('le reste dû couvre toutes les dates', fromCaisse[0].dueNow, 1_180);

console.log(failed === 0
  ? `\nTout est vert — ${passed} cas.`
  : `\n${failed} cas en échec sur ${passed + failed}.`);
process.exit(failed === 0 ? 0 : 1);
