/**
 * ─── Le travail des employés du Lavage & Vidange ───────────────────────────────
 * Ce que ces cas protègent, parce que c'est là-dessus qu'un employé est PAYÉ et
 * que le rapport général le déplie désormais employé par employé :
 *
 *   • un employé n'est payé que sur LES PRESTATIONS QU'IL A FAITES — pas sur la
 *     facture entière : les produits sortis du stock et le travail d'un collègue
 *     ne gonflent pas sa part ;
 *   • une intervention à deux ne se compte pas deux fois dans le total de
 *     l'atelier, alors qu'elle compte bien pour chacun des deux ;
 *   • une ancienne fiche sans affectation par prestation compte, elle, sur son
 *     total entier — sans quoi le travail disparaîtrait de sa paie ;
 *   • la période FILTRE ce qu'on lit, mais le reste dû couvre toutes les dates :
 *     un travail d'un mois passé jamais réglé doit rester réclamable ;
 *   • un travail déjà réglé par un paiement quitte le « à payer » sans quitter
 *     la liste — il s'y lit « Réglé ».
 *
 *   npx tsx src/lib/serviceWorkforce.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, BizReparation, BizWorker } from './bizConfig';
import { computeWorkforce, WorkforceWorker } from './workforceReporting';

let failures = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — attendu ${want}, obtenu ${got}`}`);
};

// ─── L'atelier ────────────────────────────────────────────────────────────────
const worker = (id: string, name: string, percentage: number, payments: any[] = []): BizWorker => ({
  id, name, roleName: 'Laveur', paid: true,
  salaryType: 'pourcentage', salaryAmount: 0, percentage,
  hasAccount: false, startDate: '2026-01-01',
  permissions: {}, acomptes: [], absences: [], payments,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** Une intervention, avec ses prestations nominatives et ses produits. */
const rep = (o: Partial<BizReparation> & { id: string; date: string }): BizReparation => ({
  ref: o.id.toUpperCase(), kind: 'lavage', clientName: 'Client de passage',
  car: {} as any, serviceTotal: 0, usedProducts: [], total: 0, paid: 0, rest: 0,
  status: 'finalized', workers: [], ...o,
} as BizReparation);

const karim = worker('w1', 'Karim', 20);
const samir = worker('w2', 'Samir', 10, [
  // Le lavage de la 3e intervention lui a déjà été réglé.
  { id: 'pay1', period: 'août 2026', amount: 100, date: '2026-08-20', workIds: ['r3'] },
]);

const reparations: BizReparation[] = [
  // 1 · Karim seul : un lavage à 1 000 + un produit à 500. Sa base = 1 000.
  rep({
    id: 'r1', date: '2026-09-03', kind: 'lavage', workers: ['w1'],
    prestations: [{ id: 'p1', kind: 'lavage', label: 'Lavage complet', amount: 1000, workerIds: ['w1'] }],
    usedProducts: [{ productId: 'x', productName: 'Shampoing', qty: 1, unitPrice: 500, total: 500 }],
    serviceTotal: 1000, total: 1500, paid: 1500, rest: 0,
  }),
  // 2 · À deux : Karim lave (800), Samir vidange (1 200). Facture 2 000.
  rep({
    id: 'r2', date: '2026-09-05', kind: 'mixte', workers: ['w1', 'w2'],
    prestations: [
      { id: 'p2', kind: 'lavage', label: 'Lavage', amount: 800, workerIds: ['w1'] },
      { id: 'p3', kind: 'reparation', label: 'Vidange 5W40', amount: 1200, workerIds: ['w2'] },
    ],
    serviceTotal: 2000, total: 2000, paid: 1000, rest: 1000,
  }),
  // 3 · Samir, déjà réglée par son paiement.
  rep({
    id: 'r3', date: '2026-09-08', kind: 'lavage', workers: ['w2'],
    prestations: [{ id: 'p4', kind: 'lavage', label: 'Lavage', amount: 1000, workerIds: ['w2'] }],
    serviceTotal: 1000, total: 1000, paid: 1000, rest: 0,
  }),
  // 4 · Ancienne fiche : aucun employé sur la prestation, seulement sur la tête.
  rep({
    id: 'r4', date: '2026-09-09', kind: 'lavage', workers: ['w1'],
    serviceTotal: 0, total: 600, paid: 600, rest: 0,
  }),
  // 5 · Hors période, jamais réglée : elle ne se LIT pas, mais elle est DUE.
  rep({
    id: 'r5', date: '2026-07-11', kind: 'lavage', workers: ['w1'],
    prestations: [{ id: 'p5', kind: 'lavage', label: 'Lavage', amount: 500, workerIds: ['w1'] }],
    serviceTotal: 500, total: 500, paid: 500, rest: 0,
  }),
  // 6 · En attente : annoncée, pas encore payable.
  rep({
    id: 'r6', date: '2026-09-10', kind: 'reparation', workers: ['w2'], status: 'pending',
    prestations: [{ id: 'p6', kind: 'reparation', label: 'Vidange', amount: 2000, workerIds: ['w2'] }],
    serviceTotal: 2000, total: 2000, paid: 0, rest: 2000,
  }),
];

const empty = { products: [], sales: [], purchases: [], clients: [], suppliers: [], workers: [], expenses: [] };
const biz = {
  lavage: { ...empty, workers: [karim, samir], reparations, sessions: [] } as unknown as BizState,
  cafeteria: { ...empty, reparations: [], sessions: [] } as unknown as BizState,
};

const report = computeWorkforce({}, biz as any, '2026-09-01', '2026-09-30');
const of = (name: string): WorkforceWorker => report.workers.find(w => w.name === name)!;
const K = of('Karim');
const S = of('Samir');

console.log('\nCe que la période montre');
// r1, r2, r4 — r5 est de juillet.
check('Karim — travaux de la période', K.worksCount, 3);
check('Samir — travaux de la période', S.worksCount, 3);

console.log('\nLa base retenue : ses prestations, jamais la facture entière');
// 1 000 (r1, produit exclu) + 800 (r2, la vidange de Samir exclue) + 600 (r4, fiche sans affectation)
check('Karim — base', K.worksBase, 2400);
// 1 200 (r2) + 1 000 (r3) + 2 000 (r6, en attente)
check('Samir — base', S.worksBase, 4200);
check('Karim — part 20 %', K.earned, 480);
check('Samir — part 10 %', S.earned, 420);

console.log('\nLe montant facturé compte la facture, lui');
check('Karim — facturé', K.worksAmount, 1500 + 2000 + 600);
check('Samir — facturé', S.worksAmount, 2000 + 1000 + 2000);

console.log('\nCe qui reste à leur payer — toutes dates confondues');
// Karim : r1 (200) + r2 (160) + r4 (120) + r5 de juillet (100) = 580.
check('Karim — reste dû', K.dueNow, 580);
// Samir : r2 (120) seulement — r3 est réglée, r6 n'est pas finalisée.
check('Samir — reste dû', S.dueNow, 120);

console.log('\nUn travail réglé le reste, et le dit');
const r3 = S.works.find(w => w.id === 'r3')!;
check('r3 — réglée', r3.settled, true);
check('r3 — date du règlement', r3.settledOn, '2026-08-20');
const r2forSamir = S.works.find(w => w.id === 'r2')!;
check('r2 — pas encore réglée', r2forSamir.settled, false);

console.log('\nChacun ne voit surligné que CE QU\'IL a fait');
const r2forKarim = K.works.find(w => w.id === 'r2')!;
check('r2 — Karim voit les 2 prestations', r2forKarim.prestations.length, 2);
check('r2 — une seule est la sienne', r2forKarim.prestations.filter(p => p.mine).length, 1);
check('r2 — c\'est le lavage', r2forKarim.prestations.find(p => p.mine)!.label, 'Lavage');
check('r2 — sa base', r2forKarim.base, 800);
check('r2 — sa part', r2forKarim.share, 160);
check('r2 — la part de Samir', r2forSamir.share, 120);

console.log('\nUne ancienne fiche sans affectation compte sur son total');
const r4 = K.works.find(w => w.id === 'r4')!;
check('r4 — aucune prestation', r4.prestations.length, 0);
check('r4 — base = total', r4.base, 600);
check('r4 — part sur le total', r4.share, 120);

console.log('\nLes détails que la fiche affiche');
const r1 = K.works.find(w => w.id === 'r1')!;
check('r1 — produit utilisé listé', r1.products.length, 1);
check('r1 — valeur du produit', r1.products[0].total, 500);
check('r2 — reste dû par le client', r2forKarim.rest, 1000);
check('r6 — état', S.works.find(w => w.id === 'r6')!.status, 'En attente');

console.log('\nLe total de l\'atelier ne compte pas deux fois un travail à deux');
// r1, r2, r3, r4, r6 — cinq interventions distinctes sur la période, même si la
// somme des `worksCount` de l'équipe en annonce six.
const distinct = new Set([...K.works, ...S.works].map(w => w.id));
check('interventions distinctes', distinct.size, 5);
check('somme des compteurs', K.worksCount + S.worksCount, 6);

console.log(failures === 0 ? '\nTout est vert.' : `\n${failures} cas en échec.`);
process.exit(failures === 0 ? 0 : 1);
