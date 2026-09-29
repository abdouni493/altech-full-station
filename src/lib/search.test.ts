/**
 * ─── Vérification de la barre de recherche ─────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement empêché de retrouver
 * quelqu'un à l'écran :
 *
 *   • les noms sont saisis comme sur la carte d'identité (« Benaïssa », « Saïd »)
 *     mais personne ne tape les accents : sans mise à plat, la recherche ne
 *     rendait AUCUN résultat sur un employé pourtant présent dans la liste ;
 *   • un nom composé se tape rarement dans le même ordre que sa fiche : « aissa
 *     ben » doit trouver « Ben Aïssa » ;
 *   • un téléphone est enregistré avec des espaces (« 05 55 12 34 56 ») et se
 *     tape d'un bloc ;
 *   • une requête vide ne filtre rien — c'est l'état d'une barre au repos ;
 *   • un champ absent (`undefined`) ne doit jamais faire tomber le filtre.
 *
 *   npx tsx src/lib/search.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { normalizeSearch, matchesSearch } from './utils';

let failures = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — attendu ${want}, obtenu ${got}`}`);
};

console.log('normalizeSearch');
check('accents retirés', normalizeSearch('Benaïssa'), 'benaissa');
check('espaces réduits', normalizeSearch('  Ben   Aïssa  '), 'ben aissa');
check('undefined → chaîne vide', normalizeSearch(undefined), '');

console.log('\nmatchesSearch — un employé nommé « Ben Aïssa », CIN 1122334455, tél 05 55 12 34 56');
const nom = 'Ben Aïssa', cin = '1122334455', tel = '05 55 12 34 56';

check('sans accent', matchesSearch('benaissa', 'Benaïssa'), true);
check('avec accent', matchesSearch('Aïssa', nom), true);
check('mots dans le désordre', matchesSearch('aissa ben', nom), true);
check('casse ignorée', matchesSearch('BEN', nom), true);
check('requête vide = tout passe', matchesSearch('', nom), true);
check('requête d\'espaces = tout passe', matchesSearch('   ', nom), true);
check('nom absent de la fiche', matchesSearch('kaddour', nom, cin, tel), false);

check('téléphone tapé d\'un bloc', matchesSearch('0555123456', nom, tel), true);
check('téléphone tapé avec ses espaces', matchesSearch('05 55 12', nom, tel), true);
check('CIN complet', matchesSearch(cin, nom, cin, tel), true);
check('numéro inconnu', matchesSearch('0699887766', nom, cin, tel), false);

console.log('\nmatchesSearch — champs manquants et faux positifs');
check('champs undefined', matchesSearch('ben', undefined, nom, undefined), true);
check('tous les champs vides', matchesSearch('ben', undefined, null, ''), false);
check(
  'les chiffres de deux champs ne se recollent pas',
  // CIN finit par « 55 », téléphone commence par « 05 » : « 5505 » n'existe
  // dans aucun des deux et ne doit pas être inventé en les mettant bout à bout.
  matchesSearch('5505', cin, tel),
  false,
);
check('un mot doit être trouvé, pas seulement un autre', matchesSearch('ben kaddour', nom, cin, tel), false);
check('mots croisant deux champs', matchesSearch('ben 0555', nom, tel), true);

console.log(failures === 0 ? '\nTout est vert.' : `\n${failures} cas en échec.`);
if (failures > 0) process.exit(1);
