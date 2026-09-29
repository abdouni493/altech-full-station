/**
 * ─── Retrouver une pièce détachée ──────────────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun est une vente perdue au comptoir :
 *
 *   • un client n'annonce JAMAIS le nom de rayon d'une pièce. Il lit un numéro
 *     sur l'ancienne pièce, ou il annonce sa voiture. Les deux doivent sortir le
 *     produit ;
 *   • un numéro s'écrit avec des espaces dans le catalogue (« 7701 478 261 ») et
 *     se tape d'un bloc : sans forme compacte, la référence enregistrée reste
 *     introuvable ;
 *   • « clio 4 2015 » croise le modèle et l'année de DEUX champs différents —
 *     c'est exactement ce que le magasinier tape ;
 *   • la boîte se cherche aussi bien en « auto » qu'en « automatique » ;
 *   • un produit sans référence ni véhicule (toute la Cafétéria) continue de se
 *     chercher par son nom, comme avant.
 *
 *   npx tsx src/lib/productSearch.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizProduct, productSearchFields, productRefLabel, productCarLabel, expandYears,
} from './bizConfig';
import { matchesSearch } from './utils';

let failures = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — attendu ${want}, obtenu ${got}`}`);
};

/** La recherche telle que la font les trois écrans (stock, achats, POS). */
const finds = (p: BizProduct, query: string) => matchesSearch(query, ...productSearchFields(p));

const base = {
  principalQty: 0, currentQty: 0, minQty: 0, purchasePrice: 0, salePrice: 0,
  createdAt: '2026-08-25T00:00:00.000Z',
};

// Un filtre à huile de Clio 4, tel qu'il serait saisi dans la Gestion de stock.
const filtre: BizProduct = {
  ...base,
  id: 'p1',
  name: 'Filtre à huile',
  barcode: '6112233445566',
  refs: [
    { id: 'r1', ref: '7701 478 261', brand: 'Renault', note: 'origine' },
    { id: 'r2', ref: 'W 75/3', brand: 'Mann' },
  ],
  cars: [
    { id: 'c1', marque: 'Renault', name: 'Clio 4', year: '2012-2019', gearbox: 'auto' },
    { id: 'c2', marque: 'Dacia', name: 'Logan', year: '2013', gearbox: 'manuelle' },
  ],
};

/** Un café de la Cafétéria : ni référence, ni véhicule. */
const cafe: BizProduct = { ...base, id: 'p2', name: 'Café expresso', barcode: '6199887766554' };

console.log('Recherche par RÉFÉRENCE');
check('référence telle qu\'écrite', finds(filtre, '7701 478 261'), true);
check('référence tapée d\'un bloc', finds(filtre, '7701478261'), true);
check('référence en fin de numéro', finds(filtre, '478'), true);
check('deuxième référence, séparateurs retirés', finds(filtre, 'w753'), true);
check('deuxième référence telle qu\'écrite', finds(filtre, 'W 75/3'), true);
check('marque de la référence', finds(filtre, 'mann'), true);
check('référence d\'une autre pièce', finds(filtre, '8200123456'), false);

console.log('\nRecherche par VÉHICULE');
check('marque du véhicule', finds(filtre, 'renault'), true);
check('modèle', finds(filtre, 'clio'), true);
check('marque + modèle', finds(filtre, 'renault clio 4'), true);
check('modèle + année DANS la plage 2012-2019', finds(filtre, 'clio 2015'), true);
check('modèle + première année de la plage', finds(filtre, 'clio 2012'), true);
check('modèle + dernière année de la plage', finds(filtre, 'clio 2019'), true);
check('modèle + année HORS plage', finds(filtre, 'clio 2021'), false);
check('année exacte du second véhicule', finds(filtre, 'logan 2013'), true);
check('deuxième véhicule du même produit', finds(filtre, 'dacia logan'), true);
check('boîte tapée « auto »', finds(filtre, 'clio auto'), true);
check('boîte tapée « automatique »', finds(filtre, 'clio automatique'), true);
check('boîte manuelle', finds(filtre, 'logan manuelle'), true);
check('véhicule que la pièce n\'équipe pas', finds(filtre, 'peugeot 208'), false);

console.log('\nCe qui ne change pas');
check('nom du produit', finds(filtre, 'filtre huile'), true);
check('code-barres', finds(filtre, '6112233445566'), true);
check('produit sans référence ni véhicule — par son nom', finds(cafe, 'expresso'), true);
check('produit sans référence — une référence ne le sort pas', finds(cafe, '7701478261'), false);
check('barre au repos : tout passe', finds(cafe, ''), true);

console.log('\nPlages d\'années dépliées');
check('plage classique', expandYears('2012-2019').join(','),
  '2012-2019,2012,2013,2014,2015,2016,2017,2018,2019');
check('année seule', expandYears('2015').join(','), '2015');
check('plage ouverte court jusqu\'à l\'année en cours',
  expandYears('2024-').includes(String(new Date().getFullYear())), true);
check('plage inversée laissée telle quelle', expandYears('2019-2012').join(','), '2019-2012');
check('plage absurde laissée telle quelle', expandYears('1900-2026').join(','), '1900-2026');
check('texte libre laissé tel quel', expandYears('à partir de 2012').join(','), 'à partir de 2012');
check('vide', expandYears('').length, 0);

console.log('\nÉtiquettes lisibles');
check('référence', productRefLabel(filtre.refs![0]), 'Renault — 7701 478 261');
check('référence sans marque', productRefLabel({ id: 'x', ref: 'ABC' }), 'ABC');
check('véhicule', productCarLabel(filtre.cars![0]), 'Renault Clio 4 • 2012-2019 • Boîte automatique');
check('véhicule sans boîte', productCarLabel({ id: 'x', marque: 'Renault', name: 'Symbol' }), 'Renault Symbol');
check('véhicule absent', productCarLabel(undefined), '');

console.log(failures === 0 ? '\nTout est vert.' : `\n${failures} cas en échec.`);
if (failures > 0) process.exit(1);
