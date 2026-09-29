/**
 * ─── Ce que ces cas protègent ─────────────────────────────────────────────────
 *
 * Un gérant rouvre la brigade du 20 août pour corriger un bon client. À
 * l'enregistrement, les vingt pistolets de la station RECULENT sur les index du
 * 20 août : la brigade du 25 repart d'un compteur du passé, ses litres, son
 * théorique et son écart de caisse sont faux, et rien à l'écran n'explique
 * pourquoi.
 *
 * La règle : seule la DERNIÈRE brigade à avoir relevé un pistolet détient son
 * compteur. Le reste de la fiche (pompistes, horaires, espèces, justifications)
 * reste librement modifiable.
 *
 *   npx tsx src/lib/nozzleIndexes.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { nozzleIndexOwner, ownsNozzleIndex, nozzleIndexFixes, brigadeIndexOrder } from './nozzleIndexes';

let passed = 0, failed = 0;
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n      attendu ${JSON.stringify(want)}\n      obtenu  ${JSON.stringify(got)}`); }
};

const nozzle = (id: string, lastIndex: number) => ({
  id, pumpId: 'P1', name: id, lastIndex, startIndex: 0, status: 'Actif' as const,
});

// Trois brigades qui se suivent sur le même pistolet A1.
const b20 = { id: 'B20', date: '2026-08-20', createdAt: '2026-08-20T14:00:00Z', endNozzleIndices: { A1: 1000, A3: 500 } };
const b22 = { id: 'B22', date: '2026-08-22', createdAt: '2026-08-22T14:00:00Z', endNozzleIndices: { A1: 1200 } };
const b25 = { id: 'B25', date: '2026-08-25', createdAt: '2026-08-25T14:00:00Z', endNozzleIndices: { A1: 1500, A3: 900 } };
const brigades = [b25, b20, b22]; // ordre d'arrivée quelconque, comme du serveur

console.log('\n── Qui détient le compteur ──');
check('la dernière brigade détient A1', nozzleIndexOwner(brigades, 'A1')?.id, 'B25');
check('A3 ignore la brigade qui ne l\'a pas relevé', nozzleIndexOwner(brigades, 'A3')?.id, 'B25');
check('un pistolet jamais relevé n\'appartient à personne', nozzleIndexOwner(brigades, 'B9'), null);

console.log('\n── Le droit de déplacer le compteur ──');
check('la dernière brigade peut', ownsNozzleIndex(brigades, 'B25', 'A1'), true);
check('une brigade ancienne rouverte ne peut PAS', ownsNozzleIndex(brigades, 'B20', 'A1'), false);
check('celle du milieu non plus', ownsNozzleIndex(brigades, 'B22', 'A1'), false);
check('un pistolet vierge est libre', ownsNozzleIndex(brigades, 'B20', 'B9'), true);
// Une brigade toute neuve porte la date de création la plus récente : elle
// gagne le classement et reste libre de poser le compteur.
const fresh = { id: 'NEW', date: '2026-08-26', createdAt: '2026-08-26T09:00:00Z', endNozzleIndices: { A1: 1700 } };
check('une création prend la main', ownsNozzleIndex([...brigades, fresh], 'NEW', 'A1'), true);

console.log('\n── La liste des écarts à réparer ──');
// A1 a reculé sur l'index du 20 août, A3 est juste, B9 n'a aucune référence.
const nozzles = [nozzle('A1', 1000), nozzle('A3', 900), nozzle('B9', 42)];
check('seul le compteur qui a dérivé sort',
  nozzleIndexFixes(brigades, nozzles).map(f => [f.nozzleId, f.current, f.expected, f.drift]),
  [['A1', 1000, 1500, 500]]);
check('la brigade de référence est nommée',
  nozzleIndexFixes(brigades, nozzles).map(f => [f.brigadeId, f.brigadeDate]),
  [['B25', '2026-08-25']]);
check('un compteur exact ne propose rien',
  nozzleIndexFixes(brigades, [nozzle('A1', 1500)]).length, 0);
check('un centième d\'écart reste du bruit, pas une réparation',
  nozzleIndexFixes(brigades, [nozzle('A1', 1500.0005)]).length, 0);
check('un pistolet jamais relevé n\'est jamais écrasé',
  nozzleIndexFixes(brigades, [nozzle('B9', 42)]).length, 0);

console.log('\n── Le classement, sans date de création ──');
// Les fiches anciennes n'ont pas de `created_at` : elles se rangent sur leur
// fin de service, sinon sur la journée couverte.
check('repli sur la fin de service',
  brigadeIndexOrder({ id: 'X', endDatetime: '2026-08-21T22:00:00Z' }),
  Date.parse('2026-08-21T22:00:00Z'));
check('repli ultime sur la journée',
  brigadeIndexOrder({ id: 'X', date: '2026-08-21' }),
  Date.parse('2026-08-21'));
check('une fiche sans aucune date ne prend jamais la main',
  brigadeIndexOrder({ id: 'X' }), 0);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
process.exit(failed === 0 ? 0 : 1);
