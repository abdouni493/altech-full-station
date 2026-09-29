/**
 * ─── Un encaissement de brigade ne compte qu'une fois ──────────────────────────
 *
 * Ré-enregistrer la comptabilité d'une brigade pouvait laisser au grand livre
 * l'ANCIENNE ligne d'espèces à côté de la nouvelle : deux encaissements pour la
 * même brigade, et la caisse — donc toute la trésorerie — gonflée d'autant. Vu
 * en production sur la brigade du 29/08 (comptée 1 220 425 ET 1 221 725) :
 * +1 220 425 de trop dans la caisse générale.
 *
 * `dedupeLedger` ne garde, par brigade, que la ligne d'espèces la plus récente.
 * Ce qu'il ne doit JAMAIS toucher :
 *   • les lignes TAG/TPE d'une brigade — même `refId`, mais nature distincte ;
 *   • les règlements MULTIPLES d'un même achat — autant de vrais versements.
 *
 *   npx tsx src/lib/dedupeLedger.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { dedupeLedger, ledgerNetFor, CAISSE_ID, TreasuryTransaction } from '../store/AppContext';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

const tx = (o: Partial<TreasuryTransaction>): TreasuryTransaction => ({
  id: o.id!, date: o.date || '2026-08-29T14:00:00', kind: o.kind || 'BRIGADE',
  amount: o.amount || 0, accountFrom: o.accountFrom, accountTo: o.accountTo,
  part: o.part || 'carburant', refType: o.refType, refId: o.refId,
  createdBy: 'test', createdAt: o.createdAt || '2026-08-29T13:00:00Z',
});

// 1. Brigade ré-enregistrée : deux lignes d'espèces, la plus récente fait foi.
{
  const txs = [
    tx({ id: 'old', kind: 'BRIGADE', amount: 1220425, accountTo: CAISSE_ID, refType: 'brigade', refId: 'B1', createdAt: '2026-08-29T13:46:13Z' }),
    tx({ id: 'new', kind: 'BRIGADE', amount: 1221725, accountTo: CAISSE_ID, refType: 'brigade', refId: 'B1', createdAt: '2026-08-29T13:57:46Z' }),
  ];
  const kept = dedupeLedger(txs);
  check('doublon brigade : une seule ligne reste', kept.length, 1);
  check('doublon brigade : la PLUS RÉCENTE est gardée', kept[0].id, 'new');
  check('doublon brigade : la caisse ne double pas', ledgerNetFor(CAISSE_ID, txs), 1221725);
}

// 2. Une brigade écrit son espèces ET ses lignes TAG/TPE, tout sous le même
//    refId. Les TPE (nature distincte) ne sont pas des doublons.
{
  const txs = [
    tx({ id: 'cash', kind: 'BRIGADE', amount: 900000, accountTo: CAISSE_ID, refType: 'brigade', refId: 'B2', createdAt: '2026-09-01T13:00:00Z' }),
    tx({ id: 'tpe1', kind: 'TPE', amount: 12900, accountTo: 'BANK', refType: 'brigade', refId: 'B2', createdAt: '2026-09-01T13:00:00Z' }),
    tx({ id: 'tpe2', kind: 'TPE', amount: 4300, accountTo: 'BANK', refType: 'brigade', refId: 'B2', createdAt: '2026-09-01T13:00:00Z' }),
  ];
  const kept = dedupeLedger(txs);
  check('brigade + TAG/TPE : rien n\'est écarté', kept.length, 3);
  check('brigade + TAG/TPE : la caisse garde l\'espèces', ledgerNetFor(CAISSE_ID, txs), 900000);
  check('brigade + TAG/TPE : la banque garde ses crédits', ledgerNetFor('BANK', txs), 17200);
}

// 3. Un achat réglé en plusieurs fois : chaque versement est réel, aucun n'est
//    un doublon même si tous portent le même refId.
{
  const txs = [
    tx({ id: 'p1', kind: 'PURCHASE', amount: 235899.36, accountFrom: 'BANK', refType: 'purchase', refId: 'P1', createdAt: '2026-09-02T10:00:00Z' }),
    tx({ id: 'p2', kind: 'PURCHASE', amount: 329490, accountFrom: 'BANK', refType: 'purchase', refId: 'P1', createdAt: '2026-09-06T10:00:00Z' }),
  ];
  const kept = dedupeLedger(txs);
  check('achat multi-règlements : les deux versements restent', kept.length, 2);
  check('achat multi-règlements : la banque est bien débitée en entier', ledgerNetFor('BANK', txs), -565389.36);
}

// 4. Aucun doublon : la liste passe telle quelle (même référence d'objet).
{
  const txs = [tx({ id: 'a', kind: 'DEPOSIT', amount: 1000, accountTo: CAISSE_ID })];
  check('sans doublon : liste inchangée', dedupeLedger(txs) === txs, true);
}

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed > 0) process.exit(1);
