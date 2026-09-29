/**
 * ─── Le scanner rend toujours de quoi saisir un code ───────────────────────────
 *
 * Ce que ces cas protègent :
 *
 *   • la CAMÉRA n'est pas garantie. Elle exige https (ou localhost), une
 *     autorisation, et un navigateur qui sait décoder. Sur le poste de la
 *     station, l'un des trois peut manquer n'importe quel jour. La fenêtre doit
 *     alors rester utilisable : le champ de saisie manuelle — celui où écrit
 *     aussi la douchette USB — est rendu QUOI QU'IL ARRIVE, avant même que la
 *     caméra ait répondu. Sans lui, le caissier se retrouverait devant un
 *     rectangle noir sans pouvoir encaisser.
 *   • fermée, la fenêtre ne rend rien : elle est montée en permanence au point
 *     de vente (`open={scanning}`), et un reste d'affichage y couvrirait le
 *     panier.
 *
 * Le rendu se fait hors navigateur : `createPortal` est rendu transparent et un
 * `document` minimal est posé — sans quoi la fenêtre, qui part dans un portail,
 * ne rendrait rien et tous les cas passeraient à vide.
 *
 *   npx tsx src/components/BarcodeScannerModal.test.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
require_('react-dom').createPortal = (children: any) => children;
(globalThis as any).document = { body: {} };

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const BarcodeScannerModal = (await import('./BarcodeScannerModal')).default;

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
};

const flat = (s: string) => s
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const render = (props: any) => flat(renderToStaticMarkup(
  <BarcodeScannerModal open onClose={() => {}} onDetect={() => {}} {...props} />,
));

console.log('\n─── La fenêtre ouverte ───');
const html = render({ title: 'Scanner un article', subtitle: 'Devant la caméra' });
check('son titre s\'affiche', html.includes('Scanner un article'));
check('son sous-titre aussi', html.includes('Devant la caméra'));
check('la caméra est en cours d\'ouverture', html.includes('Ouverture de la caméra'));
check('le viseur est là', html.includes('<video'));
check('la saisie manuelle est TOUJOURS offerte', html.includes('Ou saisissez le code'));
check('et la douchette USB est nommée', html.includes('douchette USB'));

console.log('\n─── Le retour de la dernière lecture ───');
const withResult = render({ lastResult: 'Eau minérale ajoutée au panier' });
check('ce qu\'a fait l\'écran appelant se lit dans la fenêtre',
  withResult.includes('Eau minérale ajoutée au panier'));
check('rien ne s\'affiche quand il n\'y a rien à dire',
  !render({}).includes('Eau minérale'));

console.log('\n─── La fenêtre fermée ───');
const closed = flat(renderToStaticMarkup(
  <BarcodeScannerModal open={false} onClose={() => {}} onDetect={() => {}} />,
));
check('ne rend rien du tout', closed.trim() === '');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
