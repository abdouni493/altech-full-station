/**
 * ─── Ce que ces cas protègent ─────────────────────────────────────────────────
 *
 * Un pompiste justifie 12 000 DA au terminal. Le rapport Carburant les compte
 * dans « encaissé », l'historique du compte bancaire n'en montrait rien, et le
 * solde restait 12 000 DA en dessous de la réalité. Trois trous distincts :
 *
 *   • un TAG ne portait AUCUN compte bancaire — jamais de ligne ;
 *   • rouvrir une brigade pour la corriger effaçait ses lignes de banque et n'en
 *     réécrivait aucune, parce que le compte n'était pas rechargé dans le
 *     formulaire ;
 *   • la fenêtre « Comptabilité brigade » n'en écrivait pas une seule.
 *
 *   npx tsx src/lib/brigadeBankLines.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  brigadeBankLines, brigadeBankLineIds, isBankJustification,
  unbankedJustifications, repairBrigadeBankLines, bankAccountFromLabel,
} from './brigadeBankLines';

let passed = 0, failed = 0;
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n      attendu ${JSON.stringify(want)}\n      obtenu  ${JSON.stringify(got)}`); }
};

let n = 0;
const ids = () => `TX${++n}`;

const justifs = [
  { id: 'J1', justificationType: 'TPE', amount: 12_000, bankAccountId: 'B1', pompisteId: 'P1' },
  { id: 'J2', justificationType: 'TAG', amount: 4_000, bankAccountId: 'B2', pompisteId: 'P1' },
  { id: 'J3', justificationType: 'CLIENT', amount: 6_000, clientName: 'Transport Sud' },
  // Une justification encaissée sans compte : rien ne peut entrer nulle part.
  { id: 'J4', justificationType: 'TPE', amount: 900, pompisteId: 'P2' },
];

const names: Record<string, string> = { P1: 'Karim', P2: 'Nadir' };
const who = (id?: string | null) => (id ? names[id] : undefined);

console.log('\n─── Une justification encaissée va en banque ───');
check('TPE va en banque', isBankJustification({ justificationType: 'TPE' }), true);
check('TAG va en banque', isBankJustification({ justificationType: 'TAG' }), true);
check('un bon client, non', isBankJustification({ justificationType: 'CLIENT' }), false);

console.log('\n─── Les lignes du grand livre ───');
n = 0;
const lines = brigadeBankLines({
  brigadeId: 'BR1', date: '2026-08-20T22:00:00', label: '2026-08-20',
  justifications: justifs, pompisteName: who, createdBy: 'Admin', makeId: ids,
});
check('une ligne par justification encaissée avec compte', lines.length, 2);
check('le TPE crédite son compte', [lines[0].accountTo, lines[0].amount], ['B1', 12_000]);
check('le TAG crédite le sien', [lines[1].accountTo, lines[1].amount], ['B2', 4_000]);
check('nature TPE', lines[0].kind, 'TPE');
check('rattachée à la brigade', [lines[0].refType, lines[0].refId], ['brigade', 'BR1']);
check('imputée au carburant', lines[0].part, 'carburant');
check('le pompiste se lit dans l\'historique', lines[0].description, 'TPE brigade du 2026-08-20 — Karim');
check('aucune sortie de compte', lines.every(l => !l.accountFrom), true);
check('le bon client ne va PAS en banque', lines.some(l => l.amount === 6_000), false);
check('sans compte désigné, rien n\'entre', lines.some(l => l.amount === 900), false);
check('la justification sans compte est signalée',
  unbankedJustifications(justifs).map(j => j.id), ['J4']);

console.log('\n─── Réenregistrer une brigade ne double rien ───');
// Les lignes que la brigade a écrites sont EFFAÇÉES puis réécrites : c'est ce
// qui rend la modification sûre. Seules les siennes, et seulement les lignes de
// banque — jamais la ligne d'espèces, qui appartient à la caisse.
const ledger: any[] = [
  ...lines,
  { id: 'CASH', kind: 'BRIGADE', amount: 50_000, refType: 'brigade', refId: 'BR1', accountTo: 'CAISSE', part: 'carburant', date: '', createdAt: '' },
  { id: 'OTHER', kind: 'TPE', amount: 3_000, refType: 'brigade', refId: 'BR2', accountTo: 'B1', part: 'carburant', date: '', createdAt: '' },
];
check('seules les lignes bancaires de CETTE brigade s\'effacent',
  brigadeBankLineIds(ledger, 'BR1'), ['TX1', 'TX2']);

console.log('\n─── Rattraper les brigades déjà saisies ───');
n = 100;
const source = [{ brigadeId: 'BR1', date: '2026-08-20T22:00:00', label: '2026-08-20', justifications: justifs }];
// Grand livre vide : tout est à rattraper.
const cold = repairBrigadeBankLines(source, [], { pompisteName: who, makeId: ids });
check('les deux encaissements manquants sont proposés', cold.add.length, 2);
check('pour leur montant exact', cold.amount, 16_000);
check('une seule brigade concernée', cold.brigades, 1);
check('la justification sans compte est comptée à part', cold.unbanked, 1);

// Grand livre déjà complet : la réparation ne propose plus rien.
const warm = repairBrigadeBankLines(source, ledger, { pompisteName: who, makeId: ids });
check('relancer la réparation n\'ajoute rien', warm.add.length, 0);
check('et rien à créditer', warm.amount, 0);

// Une seule des deux lignes présente : seule l'autre est rattrapée.
const half = repairBrigadeBankLines(
  source,
  [{ id: 'TX1', kind: 'TPE', amount: 12_000, refType: 'brigade', refId: 'BR1', accountTo: 'B1', part: 'carburant', date: '', createdAt: '' } as any],
  { pompisteName: who, makeId: ids });
check('seul ce qui manque est ajouté', [half.add.length, half.amount], [1, 4_000]);
check('sur le bon compte', half.add[0].accountTo, 'B2');

// Un TPE corrigé à la hausse APRÈS coup : seule la différence entre en banque.
const grown = repairBrigadeBankLines(
  [{ brigadeId: 'BR1', date: '2026-08-20T22:00:00', justifications: [{ id: 'J1', justificationType: 'TPE', amount: 15_000, bankAccountId: 'B1' }] }],
  [{ id: 'TX1', kind: 'TPE', amount: 12_000, refType: 'brigade', refId: 'BR1', accountTo: 'B1', part: 'carburant', date: '', createdAt: '' } as any],
  { makeId: ids });
check('seule la différence est rattrapée', [grown.add.length, grown.amount], [1, 3_000]);

// ─── Le compte effacé de la pièce, relu dans son libellé ──────────────────────
/**
 * Le cas RÉEL des brigades des 21 et 22 août 2026.
 *
 * Réenregistrer une brigade réécrit ses justifications en base. Tant que
 * l'assistant ne rechargeait pas le compte, une simple correction remettait
 * `bank_account_id` à NULL **dans la base** — la pièce elle-même perdait le
 * compte, et reconstruire les lignes à partir de ce seul champ ne rendait rien.
 *
 * Ce qui a survécu, c'est le libellé écrit par le bouton « + TPE <compte> » :
 * « TPE Naftal card », « TPE Bea », « TPE TAC/MDN ». Ce sont les vrais comptes
 * de la station, et c'est là qu'on relit le compte.
 */
console.log('\n─── Le compte se relit dans le libellé ───');
const banks = [
  { id: 'B-NAF', name: 'Naftal card' },
  { id: 'B-BEA', name: 'Bea' },
  { id: 'B-TAC', name: 'TAC/MDN' },
  { id: 'B-NTX', name: 'NATIXIS' },
];
check('« TPE Naftal card » → Naftal card', bankAccountFromLabel('TPE Naftal card', banks), 'B-NAF');
check('« TPE Bea » → Bea', bankAccountFromLabel('TPE Bea', banks), 'B-BEA');
check('« TPE TAC/MDN » → TAC/MDN malgré la barre oblique',
  bankAccountFromLabel('TPE TAC/MDN', banks), 'B-TAC');
check('la casse et les accents ne comptent pas',
  bankAccountFromLabel('tpe natixis', banks), 'B-NTX');
// Le point qui protège de créditer le mauvais compte : « Bea » ne doit pas se
// reconnaître à l'intérieur d'un autre mot.
check('« Bea » ne se reconnaît pas dans « Beaulieu »',
  bankAccountFromLabel('TPE Beaulieu', banks), undefined);
check('un nom de client ne désigne aucun compte',
  bankAccountFromLabel('RATIAT NOUREDINE', banks), undefined);
check('un libellé vide non plus', bankAccountFromLabel('', banks), undefined);
check('sans comptes, rien à trouver', bankAccountFromLabel('TPE Bea', []), undefined);
// Deux comptes reconnus : le nom le plus long l'emporte, il est le plus précis.
check('« Bea Pro » l\'emporte sur « Bea »',
  bankAccountFromLabel('TPE Bea Pro', [...banks, { id: 'B-BP', name: 'Bea Pro' }]), 'B-BP');
// Deux comptes de même nom : on ne devine pas, on signale.
check('deux comptes homonymes ne désignent personne',
  bankAccountFromLabel('TPE Bea', [...banks, { id: 'B-BIS', name: 'Bea' }]), undefined);

console.log('\n─── La brigade du 21/08 se répare ───');
// Ses justifications telles qu'elles sont restées en base : le compte perdu,
// le libellé intact. (Montants réels du pompiste Nouredine.)
const aout21 = [{
  brigadeId: 'BR-21', date: '2026-08-21T14:00:00', label: '2026-08-21',
  justifications: [
    { id: 'j1', justificationType: 'TPE', amount: 23_369, clientName: 'TPE Naftal card', pompisteId: 'P1' },
    { id: 'j2', justificationType: 'TPE', amount: 3_000, clientName: 'TPE Bea', pompisteId: 'P1' },
    { id: 'j3', justificationType: 'TPE', amount: 1_880, clientName: 'TPE TAC/MDN', pompisteId: 'P1' },
    { id: 'j4', justificationType: 'CLIENT', amount: 14_000, clientName: 'RATIAT NOUREDINE', pompisteId: 'P1' },
  ],
}];
n = 200;
const fixed = repairBrigadeBankLines(aout21, [], { accounts: banks, pompisteName: who, makeId: ids });
check('les trois TPE sont rattachés', fixed.add.length, 3);
check('pour 28 249 DA', fixed.amount, 28_249);
check('chacun sur SON compte',
  fixed.add.map(t => [t.accountTo, t.amount]),
  [['B-NAF', 23_369], ['B-BEA', 3_000], ['B-TAC', 1_880]]);
check('plus rien d\'irrécupérable', fixed.unbanked, 0);
check('le bon client ne va toujours pas en banque',
  fixed.add.some(t => t.amount === 14_000), false);
// La pièce doit être réparée elle aussi, sinon la prochaine modification de la
// brigade referait disparaître les lignes qu'on vient de créer.
check('le compte retrouvé est rendu pour être réécrit sur la pièce',
  [...(fixed.recovered.get('BR-21') || new Map()).entries()],
  [['j1', 'B-NAF'], ['j2', 'B-BEA'], ['j3', 'B-TAC']]);
// Le libellé ne fait que répéter le nom du compte : l'historique du compte
// Naftal card n'a pas besoin qu'on lui redise « Naftal card ».
check('la description ne répète pas le nom du compte',
  fixed.add[0].description, 'TPE brigade du 2026-08-21 — Karim');

// Relancer la réparation après coup n'ajoute rien.
const again = repairBrigadeBankLines(aout21, fixed.add, { accounts: banks, pompisteName: who, makeId: ids });
check('rejouer la réparation ne double pas les lignes', again.add.length, 0);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
