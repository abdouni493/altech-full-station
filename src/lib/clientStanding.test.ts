/**
 * ─── « LA DETTE DU CLIENT » NE DOIT AVOIR QU'UNE SEULE DÉFINITION ─────────────
 *
 * Le défaut constaté à l'écran : on ouvrait la Comptabilité d'une brigade, on
 * justifiait un manquant « au client », et le montant annoncé à côté de son nom
 * ne correspondait PAS à celui que sa fiche affichait dans l'écran Clients.
 *
 * La raison : deux chiffres portaient le même nom.
 *
 *   • l'assistant de création de brigade lisait `clients.debt` — un compteur
 *     tenu à la main, aveugle à la dette de reprise, à l'avance déjà versée et
 *     à toute comptabilité corrigée après coup ;
 *   • l'écran Clients, lui, affiche `clientLedger().netDebt` — la dette relue
 *     sur les PIÈCES du compte, avance imputée.
 *
 * Ces cas gèlent l'accord entre les deux : `clientStanding()` doit rendre, au
 * dinar près, le chiffre de l'écran Clients — dans les quatre situations qui
 * faisaient diverger le compteur.
 *
 *   npx tsx src/lib/clientStanding.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { clientLedgers, clientStanding } from './clientLedger';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

/**
 * Quatre clients, quatre façons dont le compteur `debt` ment :
 *
 *   CL1 — le compteur est simplement resté en arrière d'un bon ;
 *   CL2 — prépayé : il ne doit rien, l'avance couvre tout ;
 *   CL3 — repris avec une dette d'ouverture que le compteur ignore ;
 *   CL4 — avance partielle : elle éteint une partie de la dette.
 */
const app = {
  clients: [
    { id: 'CL1', name: 'Transport SARL', debt: 6_000, balance: 0, advanceBalance: 0, creditLimit: 12_000, transactionHistory: [] },
    { id: 'CL2', name: 'Ecole Ibn Badis', debt: 5_000, balance: 20_000, advanceBalance: 20_000, creditLimit: 0,
      transactionHistory: [{ id: 'TX3', date: '2026-08-01', type: 'RECHARGE', amount: 20_000, mode: 'ESPECES' }] },
    { id: 'CL3', name: 'Boulangerie El Nour', debt: 0, balance: 0, advanceBalance: 0, creditLimit: 0,
      openingDebt: 30_000, openingDate: '2026-01-05', transactionHistory: [] },
    { id: 'CL4', name: 'Taxi Amine', debt: 8_000, balance: 3_000, advanceBalance: 3_000, creditLimit: 0,
      transactionHistory: [{ id: 'TX4', date: '2026-08-02', type: 'RECHARGE', amount: 3_000, mode: 'ESPECES' }] },
  ],
  brigades: [
    { id: 'BR1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00.000Z', shift: 'Matin' },
    { id: 'BR2', date: '2026-08-12', startDatetime: '2026-08-12T06:00:00.000Z', shift: 'Soir' },
  ],
  brigadeAccountings: [
    {
      id: 'A1', brigadeId: 'BR1',
      justifications: [
        { id: 'J1', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL1', amount: 6_000 },
        { id: 'J2', justificationType: 'CLIENT', paymentMode: 'AVANCE', clientId: 'CL2', amount: 5_000 },
        { id: 'J5', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL4', amount: 8_000 },
      ],
    },
    {
      id: 'A2', brigadeId: 'BR2',
      // Le bon que le compteur de CL1 n'a jamais enregistré — une comptabilité
      // rouverte et corrigée après coup.
      justifications: [{ id: 'J4', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL1', amount: 4_000 }],
    },
  ],
  shopSales: [], fuelSales: [],
  expenses: [], purchases: [], suppliers: [], treasuryTransactions: [],
  pompistes: [], brigadeChefs: [], gerants: [], magasinWorkers: [],
};

const ledgers = clientLedgers(app);
const clientOf = (id: string) => app.clients.find(c => c.id === id)!;
const standing = (id: string) => clientStanding(clientOf(id), ledgers[id]);

console.log("\nLe chiffre affiché est celui de l'écran Clients");
for (const c of app.clients) {
  check(`${c.name} — même dette que sa fiche`, standing(c.id).debt, ledgers[c.id].netDebt);
}

console.log('\nLes quatre écarts que le compteur creusait');
check('CL1 — le bon oublié du compteur compte (6 000 + 4 000)', standing('CL1').debt, 10_000);
check("CL1 — le compteur, lui, en annonçait 6 000", clientOf('CL1').debt, 6_000);
check('CL2 — prépayé : il ne doit rien', standing('CL2').debt, 0);
check("CL2 — son avance reste visible", standing('CL2').advance, 20_000);
check('CL3 — la dette de reprise est bien une dette', standing('CL3').debt, 30_000);
check('CL4 — 8 000 dus − 3 000 d\'avance', standing('CL4').debt, 5_000);

console.log('\nLe reste sous plafond suit la dette relue, pas le compteur');
check('CL1 — 12 000 de plafond − 10 000 dus', standing('CL1').restCredit, 2_000);
check('sans plafond, aucune borne', Number.isFinite(standing('CL2').restCredit), false);

console.log("\nSans journal, on retombe sur le compteur plutôt que sur zéro");
const blind = clientStanding(clientOf('CL1'), undefined);
check('la dette approchée vaut mieux qu\'un client faussement soldé', blind.debt, 6_000);
check('et le repli se signale', blind.fromDocuments, false);
check('le compte relu, lui, se revendique', standing('CL1').fromDocuments, true);

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
