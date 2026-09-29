/**
 * ─── Le panneau « Travaux des employés » du rapport Lavage & Vidange ───────────
 *
 * Le rapport de l'atelier annonçait un chiffre d'affaires sans jamais dire qui
 * l'avait fait, alors que ces employés sont payés au POURCENTAGE de leurs
 * propres travaux. Le panneau répond à la question — et trois façons de le rater
 * ne se verraient qu'à l'écran, trop tard :
 *
 *   1. il ne rend rien du tout : `@types/react` est absent de ce projet, donc un
 *      `tsc` vert ne prouve pas qu'un composant s'affiche ;
 *   2. il affiche l'employé mais pas SES interventions — celles qu'on vient
 *      vérifier avant de le payer ;
 *   3. il montre à un employé la part d'un collègue, ou la facture entière au
 *      lieu de sa seule prestation : le montant lu serait faux et payé tel quel.
 *
 * Le rendu se fait hors navigateur : `createPortal` est rendu transparent et un
 * `document` minimal est posé avant l'import, sinon rien ne rendrait.
 *
 *   npx tsx src/components/biz/ServiceWorksPanel.test.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createRequire } from 'module';

// ── Le décor minimal d'un navigateur, AVANT d'importer le panneau ────────────
const require_ = createRequire(import.meta.url);
require_('react-dom').createPortal = (children: any) => children;
(globalThis as any).document = { body: {} };

const { renderToStaticMarkup } = await import('react-dom/server');
const React = (await import('react')).default;
const { ServiceWorksPanel } = await import('./WorkforceView');
const { computeWorkforce } = await import('@/src/lib/workforceReporting');

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
};
const section = (t: string) => console.log(`\n${t}`);
const flat = (s: string) => s
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/g, '/')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ─── Un atelier de deux employés sur une journée ──────────────────────────────
const worker = (id: string, name: string, percentage: number): any => ({
  id, name, roleName: 'Laveur', paid: true, workerKind: 'both',
  salaryType: 'pourcentage', salaryAmount: 0, percentage,
  phone: '0555112233', hasAccount: false, startDate: '2026-01-01',
  permissions: {}, acomptes: [], absences: [], payments: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const reparations: any[] = [
  {
    id: 'r1', ref: 'LAV-0001', kind: 'mixte', date: '2026-09-05',
    clientName: 'Ahmed Belkacem',
    car: { marque: 'Renault', name: 'Clio 4', immatriculation: '12345-116-27' },
    prestations: [
      { id: 'p1', kind: 'lavage', label: 'Lavage complet', amount: 800, workerIds: ['w1'] },
      { id: 'p2', kind: 'reparation', label: 'Vidange 5W40', amount: 1200, workerIds: ['w2'] },
    ],
    usedProducts: [{ productId: 'x1', productName: 'Huile Total 5W40', qty: 4, unitPrice: 900, total: 3600 }],
    serviceTotal: 2000, subtotal: 5600, discountAmount: 600, discountType: 'amount', discountValue: 600,
    total: 5000, paid: 3000, rest: 2000, status: 'finalized', workers: ['w1', 'w2'],
  },
  {
    id: 'r2', ref: 'LAV-0002', kind: 'lavage', date: '2026-09-06',
    clientName: 'Client de passage', car: {},
    prestations: [{ id: 'p3', kind: 'lavage', label: 'Lavage simple', amount: 500, workerIds: ['w1'] }],
    usedProducts: [], serviceTotal: 500, total: 500, paid: 500, rest: 0,
    status: 'finalized', workers: ['w1'],
  },
];

const empty = { products: [], sales: [], purchases: [], clients: [], suppliers: [], workers: [], expenses: [] };
const biz: any = {
  lavage: { ...empty, workers: [worker('w1', 'Karim Saadi', 20), worker('w2', 'Samir Toumi', 15)], reparations, sessions: [] },
  cafeteria: { ...empty, reparations: [], sessions: [] },
};

const report = computeWorkforce({}, biz, '2026-09-01', '2026-09-30');
const crew = report.workers.filter((w: any) => w.part === 'lavage');
const html = flat(renderToStaticMarkup(
  React.createElement(ServiceWorksPanel, { workers: crew, from: '2026-09-01', to: '2026-09-30' }) as any));

section('Le panneau rend, et nomme son équipe');
check('deux employés attendus', crew.length === 2);
check('Karim Saadi est affiché', html.includes('Karim Saadi'));
check('Samir Toumi est affiché', html.includes('Samir Toumi'));
check('son taux est dit', html.includes('20 %') && html.includes('15 %'));

section("Le total de l'atelier ne compte pas deux fois un travail à deux");
// r1 (à deux) + r2 = 2 interventions distinctes, jamais 3.
check('2 interventions', html.includes('Interventions') && / 2 /.test(html));
// Part : Karim 20 % de (800 + 500) = 260 ; Samir 15 % de 1 200 = 180 → 440.
check("la part de l'équipe est la somme des deux", html.includes('440'));

section('Chaque employé voit SES interventions, pas la facture des autres');
check('la référence de la première est là', html.includes('LAV-0001'));
check('la deuxième aussi', html.includes('LAV-0002'));
check('le client est nommé', html.includes('Ahmed Belkacem'));
check('le véhicule est dit', html.includes('Clio 4') && html.includes('12345-116-27'));

section('Les montants de chacun, jusqu\'au détail');
// Karim : base 800 + 500 = 1 300, part 260. Samir : base 1 200, part 180.
check('la base de Karim', html.includes('1 300'));
check('sa part', html.includes('260'));
check('la base de Samir', html.includes('1 200'));
check('sa part', html.includes('180'));

section('Les petits détails que la fiche doit porter');
check('la prestation de chacun est nommée', html.includes('Lavage complet') && html.includes('Vidange 5W40'));
check('la répartition par nature', html.includes('Lavages') && html.includes('Vidanges'));
check('les états de règlement', html.includes('À payer'));
// Valeur du stock sorti sur ses interventions : 3 600 pour l'un comme pour
// l'autre, les deux ayant travaillé sur la même vidange.
check('le stock sorti est chiffré', html.includes('3 600'));
check('la remise accordée est chiffrée', html.includes('Remises accordées'));
check('ce que ses clients doivent encore', html.includes('Reste dû par les clients') && html.includes('2 000'));
check("l'intervention qui a consommé du stock le dit", html.includes('1 produit(s)'));

section('Le dernier détail reste à un clic, et le panneau le dit');
// Le nom du produit, le payé et le reste de CHAQUE intervention se lisent en
// dépliant la ligne : la table porterait sinon quinze colonnes.
check('le nom du produit est derrière le clic', !html.includes('Huile Total 5W40'));
check('le panneau indique où le trouver', html.includes('Cliquez une intervention'));

section('Un atelier sans personne ne casse rien');
const none = flat(renderToStaticMarkup(
  React.createElement(ServiceWorksPanel, { workers: [], from: '2026-09-01', to: '2026-09-30' }) as any));
check('il le dit au lieu de planter', none.includes('Aucun employé'));

console.log(failed === 0 ? `\nTout est vert — ${passed} cas.` : `\n${failed} cas en échec.`);
process.exit(failed === 0 ? 0 : 1);
