/**
 * ─── Vérification de la planche d'étiquettes d'un achat ────────────────────────
 *
 * L'écran sert un moment précis : la livraison est arrivée, la facture est
 * saisie, et il faut étiqueter la marchandise avant de la mettre en rayon.
 * Trois façons de le rater, toutes invisibles tant qu'on n'a pas gâché un
 * rouleau :
 *
 *   1. un produit de la facture manque à l'appel — on découvre le trou au
 *      moment de coller, avec le carton déjà ouvert ;
 *   2. le nombre d'étiquettes ne suit pas la quantité reçue, et il faut
 *      recompter douze lignes à la main ;
 *   3. le PRIX imprimé est celui du catalogue alors que la facture vient d'en
 *      décider un autre — le rayon repart au tarif d'hier le jour même où on
 *      le change.
 *
 * Et un produit sans code-barres doit RESTER VISIBLE : le faire disparaître
 * donnerait une planche incomplète sans jamais dire pourquoi.
 *
 * Le rendu se fait hors navigateur : `createPortal` est rendu transparent et un
 * `document` minimal est posé, sinon la boîte — qui s'affiche dans un portail —
 * ne rendrait rien et tous les cas passeraient à vide.
 *
 *   npx tsx src/components/biz/PurchaseLabelsModal.test.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createRequire } from 'module';

// ── Le décor minimal d'un navigateur, AVANT d'importer la boîte ──────────────
const require_ = createRequire(import.meta.url);
require_('react-dom').createPortal = (children: any) => children;
(globalThis as any).document = { body: {} };

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const PurchaseLabelsModal = (await import('./PurchaseLabelsModal')).default;
const { defaultCopies } = await import('./PurchaseLabelsModal');

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
};
const eq = (label: string, got: any, want: any) =>
  check(`${label}${got === want ? '' : ` — attendu ${want}, obtenu ${got}`}`, got === want);
const section = (t: string) => console.log(`\n${t}`);

const flat = (s: string) => s
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ');

// ─── Une facture de trois lignes, dont une sans code-barres ───────────────────
const products = [
  { id: 'p1', name: 'Huile 5W40', barcode: '6100000000001', salePrice: 2400, currentQty: 0, principalQty: 0, minQty: 0, purchasePrice: 0 },
  { id: 'p2', name: 'Filtre à air', barcode: '6100000000002', salePrice: 900, currentQty: 0, principalQty: 0, minQty: 0, purchasePrice: 0 },
  { id: 'p3', name: 'Bougie NGK', barcode: '', salePrice: 350, currentQty: 0, principalQty: 0, minQty: 0, purchasePrice: 0 },
];
const purchase = {
  id: 'a1', ref: 'ACH-0007', date: '2026-03-04', supplierId: 's1', supplierName: 'Sonelgaz Pièces',
  total: 30000, paid: 30000, rest: 0,
  items: [
    // La facture redécide le prix de vente : c'est LUI qui doit s'imprimer.
    { productId: 'p1', productName: 'Huile 5W40', qty: 6, unitPrice: 1800, salePrice: 2600 },
    { productId: 'p2', productName: 'Filtre à air', qty: 2, unitPrice: 600 },
    { productId: 'p3', productName: 'Bougie NGK', qty: 4, unitPrice: 200 },
  ],
};
const biz: any = {
  module: 'lavage',
  state: { products },
  updateAndConfirm: async () => ({ ok: true }),
};

const render = (canEdit: boolean) => flat(renderToStaticMarkup(
  <PurchaseLabelsModal open onClose={() => {}} purchase={purchase as any} biz={biz} canEdit={canEdit} /> as any));

section("La facture ouvre TOUS ses produits");
{
  const html = render(true);
  check('la référence de la facture est rappelée', html.includes('ACH-0007'));
  check('le premier produit est listé', html.includes('Huile 5W40'));
  check('le deuxième aussi', html.includes('Filtre à air'));
  check('et celui SANS code-barres reste visible', html.includes('Bougie NGK'));
  check('chaque code-barres est montré', html.includes('6100000000001') && html.includes('6100000000002'));
  check('le produit sans code est signalé, pas escamoté',
    html.includes('Aucun') && html.includes("n'ont pas de code-barres"));
  check('et on peut lui en attribuer un sur-le-champ', html.includes('Générer'));
}

section("Ce qui est coché, et combien d'étiquettes");
{
  const html = render(true);
  /**
   * Les deux produits étiquetables partent cochés, avec la quantité reçue pour
   * nombre d'étiquettes : 6 + 2 = 8. Celui sans code-barres ne compte pas.
   */
  check('les produits étiquetables sont cochés d\'avance', html.includes('2 produit(s) · 8 étiquette(s)'));
  check('le bouton annonce ce qui va sortir', html.includes('Imprimer 8 étiquettes'));
  check('une ligne sans code-barres ne peut pas être cochée', html.includes('disabled'));
}

section("Le prix imprimé");
{
  const html = render(true);
  /**
   * 2 600 DA vient de la LIGNE D'ACHAT, 2 400 du catalogue. C'est l'achat qui
   * (re)décide du prix de vente : étiqueter à 2 400 remettrait en rayon
   * l'ancien tarif le jour même où on le change.
   */
  check('le prix décidé sur la facture prime', html.includes('2 600') || html.includes('2 600'));
  check('et l\'ancien prix du catalogue ne s\'imprime pas',
    !html.includes('2 400') && !html.includes('2 400'));
  check('un produit sans prix sur la facture garde celui du catalogue',
    html.includes('900'));
}

section("Sans droit de modification");
{
  const html = render(false);
  check('le bouton « Générer » disparaît', !html.includes('Générer'));
  check('mais le manque est toujours dit', html.includes("n'ont pas de code-barres"));
  check('et on renvoie vers la Gestion de stock', html.includes('Gestion de stock'));
}

section("Le nombre d'étiquettes proposé");
{
  eq('la quantité reçue fait le nombre d\'étiquettes', defaultCopies(6), 6);
  // 2,5 bidons livrés, ce sont 3 contenants à étiqueter : on arrondit au-dessus.
  eq('une quantité fractionnaire s\'arrondit au-dessus', defaultCopies(2.5), 3);
  eq('zéro reçu propose quand même une étiquette', defaultCopies(0), 1);
  // Une saisie à 400 ne doit pas engager tout le rouleau sans qu'on l'ait voulu.
  eq('une quantité énorme est plafonnée', defaultCopies(4000), 99);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
process.exit(failed === 0 ? 0 : 1);
