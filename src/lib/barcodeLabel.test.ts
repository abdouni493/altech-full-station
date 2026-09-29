/**
 * ─── Ce que ces cas protègent ─────────────────────────────────────────────────
 *
 * L'étiquette d'un produit part sur un rouleau de 40 × 20 mm. Deux façons de la
 * rater, toutes deux invisibles tant qu'on n'a pas gâché une bobine :
 *
 *   1. la page n'annonce pas sa taille — le navigateur imprime en A4 et la
 *      vignette sort minuscule au milieu d'une feuille ;
 *   2. le symbole est correct « en théorie » mais illisible en pratique, parce
 *      que ses barres, écrasées sur 40 mm, tombent sous ce qu'une douchette
 *      sait distinguer.
 *
 * Le cœur du fichier est un DÉCODEUR : il relit le symbole produit et
 * reconstitue le texte, exactement comme une douchette. C'est la seule preuve
 * sérieuse que la bascule jeu B / jeu C — celle qui fait tenir treize chiffres
 * dans 40 mm — encode bien ce qu'on croit, et pas un code voisin qui scannerait
 * faux au comptoir.
 *
 *   npx tsx src/lib/barcodeLabel.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  code128Values, code128Widths, barcodeSVG, barcodeLabelSVG,
  moduleWidthMm, labelPrice, barcodeLabelHTML, barcodeLabelsHTML, MIN_MODULE_MM,
  LABEL_40_20, LABEL_PRESETS, LABEL_PREFS_KEY, LABEL_PREFS_KEY_V1,
  LABEL_ROTATIONS, PAD_X_RATIO, normalizeRotation,
} from './barcodeLabel';

let passed = 0, failed = 0;
const check = (label: string, got: any, want: any) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n      attendu ${JSON.stringify(want)}\n      obtenu  ${JSON.stringify(got)}`); }
};
const ok = (label: string, got: boolean) => check(label, got, true);

// ─── Le décodeur, côté douchette ──────────────────────────────────────────────
/**
 * Rejoue le symbole comme le ferait un lecteur : contrôle de la somme, puis
 * lecture des valeurs en suivant les bascules de jeu. Rend `null` si le symbole
 * ne tient pas debout.
 */
function decode(text: string): string | null {
  const codes = code128Values(text);
  if (!codes) return null;

  const stop = codes.pop();
  if (stop !== 106) return null;                       // le symbole d'arrêt

  const control = codes.pop()!;
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  if (sum % 103 !== control) return null;              // somme de contrôle

  const start = codes.shift()!;
  if (start !== 104 && start !== 105) return null;     // départ jeu B ou jeu C
  let mode: 'B' | 'C' = start === 104 ? 'B' : 'C';

  let out = '';
  for (const v of codes) {
    if (v === 99) { mode = 'C'; continue; }            // bascule vers le jeu C
    if (v === 100) { mode = 'B'; continue; }           // bascule vers le jeu B
    if (mode === 'C') {
      if (v < 0 || v > 99) return null;
      out += String(v).padStart(2, '0');               // deux chiffres d'un coup
    } else {
      if (v < 0 || v > 94) return null;
      out += String.fromCharCode(v + 32);
    }
  }
  return out;
}

// ─── L'encodage ───────────────────────────────────────────────────────────────
console.log('\n── Le symbole se relit à l\'identique ──');
for (const sample of [
  'A', 'AB', 'Wikipedia', '6130000123456', '12345678', '1234567', '123',
  'REF-42', 'ABC123456DEF', '00', '9', 'X1Y2Z3', 'A12B34C56',
]) check(`« ${sample} »`, decode(sample), sample);

check('les caractères non encodables sont écartés avant l\'encodage',
  decode('Café 1L'), 'Caf 1L');

console.log('\n── La somme de contrôle et les jeux ──');
// « Wikipedia » est l'exemple de référence de la norme : contrôle = 88.
check('le contrôle de « Wikipedia » vaut 88', code128Values('Wikipedia')!.slice(-2)[0], 88);
check('un texte se lit en jeu B', code128Values('Wikipedia')![0], 104);
check('un code tout en chiffres démarre en jeu C', code128Values('6130000123456')![0], 105);
check('trois chiffres seuls ne valent pas la bascule', code128Values('123')![0], 104);
check('quatre chiffres, si', code128Values('1234')![0], 105);

console.log('\n── Les largeurs de barres ──');
const CODE = '6130000123456';                     // ce que `genBarcode` produit
const bars = code128Widths(CODE)!;
check('autant de trames que de symboles',
  bars.widths.length, (code128Values(CODE)!.length - 1) * 6 + 7);
check('le compte de modules suit la norme',
  bars.modules, bars.widths.reduce((s, w) => s + w, 0) + 20);
check('treize chiffres pèsent 143 modules, zones de silence comprises', bars.modules, 143);
ok('le jeu C allège vraiment : treize lettres pèsent plus lourd',
  bars.modules < code128Widths('ABCDEFGHIJKLM')!.modules);
check('un texte sans rien d\'encodable ne rend pas de symbole', code128Widths('éé'), null);
check('une chaîne vide non plus', code128Widths(''), null);

console.log('\n── La lisibilité sur 40 mm ──');
ok(`les barres du code station font ${moduleWidthMm(CODE).toFixed(3)} mm`,
  moduleWidthMm(CODE) >= MIN_MODULE_MM);
ok('un code plus court reste confortable', moduleWidthMm('61300001') >= MIN_MODULE_MM);
ok('une étiquette plus large donne des barres plus larges',
  moduleWidthMm(CODE, { widthMm: 58, heightMm: 30 }) > moduleWidthMm(CODE));

console.log('\n── Le prix tel qu\'il se lit sur la vignette ──');
check('un prix rond perd ses décimales', labelPrice(250), '250 DA');
check('un prix à virgule les garde', labelPrice(249.5), '249,50 DA');
check('pas de prix, pas de ligne', labelPrice(0), '');
check('un prix absent non plus', labelPrice(undefined), '');
check('un prix aberrant est ignoré', labelPrice(NaN), '');

console.log('\n── La page d\'impression ──');
const html = barcodeLabelHTML({ name: 'Huile moteur 5W40', barcode: CODE, salePrice: 2400 });
ok('la page annonce le format du rouleau', html.includes('@page{size:40mm 20mm;margin:0}'));
ok('la vignette fait exactement 40 × 20 mm', html.includes('--lw:40mm; --lh:20mm;'));
ok('la page fait la même taille que la vignette, sans pivot', html.includes('--pw:40mm; --ph:20mm;'));
ok('le nom du produit est en gras', /\.name\{[^}]*font-weight:900/.test(html));
ok('le nom apparaît sur l\'étiquette', html.includes('Huile moteur 5W40'));
ok('le code humain est imprimé sous les barres', html.includes(`>${CODE}<`));
ok('le prix est là, sans décimales inutiles', /2\s?400 DA/.test(html));
ok('les barres s\'étirent à la largeur utile', html.includes('preserveAspectRatio="none"'));
ok('l\'aperçu et les consignes ne partent pas à l\'imprimante',
  html.includes('.screen-only{display:none!important}'));
ok('rien ne déborde de la vignette', /\.label\{[^}]*overflow:hidden/.test(html));
ok('un nom à rallonge est borné à deux lignes', html.includes('-webkit-line-clamp:2'));

/**
 * Le cœur de la mise en page : TROIS rangées, dont une seule élastique. Le nom
 * et le pied prennent leur hauteur, les barres prennent le reste et savent
 * descendre à zéro. C'est ce qui rend impossible qu'une rangée en recouvre une
 * autre — le défaut qu'on voyait sortir de l'imprimante.
 *
 * Trois et non quatre : le code et le prix partagent la même ligne de pied.
 * Sur un rouleau de 20 mm de haut, la rangée économisée rend près de 3 mm aux
 * barres, et des barres hautes se scannent du premier coup.
 */
ok('la vignette est une grille de trois rangées',
  html.includes('grid-template-rows:auto minmax(0,1fr) auto'));
ok('seules les barres sont élastiques',
  (/grid-template-rows:[^;]*/.exec(html)![0].match(/minmax\(0,1fr\)/g) || []).length === 1)
ok('le nom ne peut pas manger la hauteur des barres',
  /\.name\{[^}]*max-height:calc\(var\(--lh\)/.test(html));
/**
 * Chaque rangée est ASSIGNÉE. Sans ça, une étiquette sans nom verrait ses
 * barres tomber dans la rangée "auto" du nom — dessin écrasé en haut, moitié
 * basse vide — au lieu de récupérer la place laissée libre.
 */
ok('le nom occupe la première rangée', /\.name\{[^}]*grid-row:1/.test(html));
ok('les barres occupent la rangée élastique', /\.bars\{[^}]*grid-row:2/.test(html));
ok('le pied occupe la dernière rangée', /\.foot\{[^}]*grid-row:3/.test(html));
ok('le code et le prix tiennent sur la même ligne',
  /\.foot\{[^}]*display:flex[^}]*justify-content:space-between/.test(html));
ok('ni le code ni le prix ne se replient', /\.foot\{[^}]*white-space:nowrap/.test(html));
ok('le pied se mesure en largeur pour rétrécir au lieu de déborder',
  /class="foot"[^>]*data-fit="width"/.test(html));
ok('chaque vignette occupe sa propre page',
  /\.sheet\{[^}]*break-after:page/.test(html));
ok('la dernière copie ne pousse pas de page blanche',
  html.includes('.sheet:last-child{break-after:auto;page-break-after:auto}'));
/**
 * Le nom RÉTRÉCIT, il ne se fait pas couper. La mesure doit donc se faire
 * bride desserrée : avec "-webkit-line-clamp" en place, le navigateur annonce
 * une hauteur qui rentre toujours et le nom sortirait avec des points de
 * suspension. Et elle vise deux lignes À LA TAILLE COURANTE, pas le plafond
 * CSS — qui vaut deux lignes à la taille de DÉPART, donc presque trois une
 * fois le texte réduit.
 */
ok('le nom se mesure bride desserrée', html.includes('el.style.webkitLineClamp = \"unset\"'));
ok('la bride est remise après la mesure', html.includes('el.style.webkitLineClamp = ""'));
ok('la cible est deux lignes à la taille courante',
  html.includes('el.scrollHeight > LINES * lh + 1'));
ok('le plafond CSS reste le garde-fou si le script ne tourne pas',
  /\.name\{[^}]*max-height:calc/.test(html));

/**
 * Les polices arrivent parfois après le premier calcul : un nom mesuré en
 * police de secours déborde sur le papier. On remesure quand elles sont là,
 * puis encore juste avant que la page parte à l'imprimante.
 */
ok('la mesure est refaite quand les polices sont chargées', html.includes('document.fonts.ready.then(fitAll)'));
ok('et encore juste avant l\'impression', html.includes('addEventListener("beforeprint", fitAll)'));


console.log('\n── Le sens d\'impression ──');
/**
 * Le défaut d'origine : `@page{size:40mm 20mm}` annonce une page PAYSAGE, le
 * pilote de l'étiqueteuse est en PORTRAIT, et il fait tourner l'image — les
 * 40 mm de dessin s'écrasent sur les 20 mm du pas d'étiquette et tout sort
 * coupé au même endroit.
 *
 * La case à cocher qui a suivi ne réglait que la moitié du problème : elle
 * couvrait deux orientations sur quatre, et une fois cochée par erreur elle
 * restait cochée — l'étiquette sortait debout pour de bon. Quatre positions,
 * 0° par défaut, et n'importe quel tour de pilote se rattrape.
 */
check('rien, ou n\'importe quoi, vaut horizontale', [
  normalizeRotation(undefined), normalizeRotation(null), normalizeRotation('nord'),
  normalizeRotation(0), normalizeRotation(360), normalizeRotation(45),
], [0, 0, 0, 0, 0, 0]);
check('les quatre positions passent telles quelles',
  [90, 180, 270].map(normalizeRotation), [90, 180, 270]);
check('un angle négatif retombe sur son équivalent',
  [normalizeRotation(-90), normalizeRotation(-180)], [270, 180]);
check('l\'ancien réglage booléen devient un quart de tour',
  [normalizeRotation(true), normalizeRotation(false)], [90, 0]);

ok('l\'étiquette sort HORIZONTALE par défaut', html.includes('<body data-rotate="0">'));
ok('et sa page reste à plat, comme le rouleau', html.includes('@page{size:40mm 20mm;margin:0}'));

/**
 * Les deux quarts de tour échangent les côtés de la PAGE ; le demi-tour, non.
 * Le dessin, lui, garde toujours ses 40 × 20 : c'est la page qui s'adapte au
 * pilote, jamais la vignette qui s'écrase.
 */
for (const [deg, page] of [[90, '20mm 40mm'], [180, '40mm 20mm'], [270, '20mm 40mm']] as const) {
  const turned = barcodeLabelHTML({ name: 'Huile', barcode: CODE, salePrice: 2400 },
    { size: LABEL_40_20, rotate: deg });
  ok(`à ${deg}°, la page mesure ${page}`, turned.includes(`@page{size:${page};margin:0}`));
  ok(`à ${deg}°, le dessin garde ses 40 × 20`, turned.includes('--lw:40mm; --lh:20mm;'));
  ok(`à ${deg}°, le sens est armé dès le chargement`, turned.includes(`<body data-rotate="${deg}">`));
}
/**
 * Chaque transformation se lit de droite à gauche — on déplace la vignette de
 * sa propre taille, PUIS on tourne. C'est ce qui la fait retomber coin sur coin
 * dans sa page : une rotation sans ce déplacement la projetterait hors du
 * papier, et il ne sortirait rien du tout.
 */
ok('le quart de tour à droite retombe dans la page',
  html.includes('body[data-rotate="90"]  .label{transform-origin:0 0;transform:rotate(90deg) translateY(-100%)}'));
ok('le demi-tour aussi',
  html.includes('body[data-rotate="180"] .label{transform-origin:0 0;transform:rotate(180deg) translate(-100%,-100%)}'));
ok('le quart de tour à gauche aussi',
  html.includes('body[data-rotate="270"] .label{transform-origin:0 0;transform:rotate(-90deg) translateX(-100%)}'));
ok('les quatre sens sont proposés dans la fenêtre',
  LABEL_ROTATIONS.every(r => html.includes(`<option value="${r.value}"`)));
check('le premier sens proposé est l\'horizontale', LABEL_ROTATIONS[0].value, 0);

/**
 * L'ancien réglage enregistré ne doit PAS ressusciter : un « pivoté » coché un
 * jour pour essayer faisait sortir toutes les étiquettes debout, sans que rien
 * sur l'écran de saisie ne le laisse deviner. La v2 relit l'ancienne clé pour
 * le seul format du rouleau.
 */
ok('le réglage du poste a changé de version', String(LABEL_PREFS_KEY) !== String(LABEL_PREFS_KEY_V1));
ok('la page lit d\'abord la clé courante', html.includes(`var PREFS = "${LABEL_PREFS_KEY}"`));
ok('et l\'ancienne seulement en repli', html.includes(`var PREFS_V1 = "${LABEL_PREFS_KEY_V1}"`));
ok('l\'ancienne clé n\'est relue que pour le format',
  /old\.w > 0 && old\.h > 0\) \{ state\.w = old\.w; state\.h = old\.h; \}/.test(html));

/**
 * Et la fenêtre n'appelle plus le dialogue d'impression toute seule : il se
 * posait par-dessus les réglages, donc par-dessus le seul endroit où corriger
 * un mauvais sens. On voyait le problème sans pouvoir l'atteindre.
 */
ok('le dialogue ne s\'ouvre plus tout seul', !/window\.focus\(\);\s*window\.print\(\)/.test(html));
ok('c\'est le bouton qui imprime',
  html.includes('printBtn.addEventListener("click", function () { fitAll(); window.print(); });'));
ok('et il a le focus au chargement', html.includes('printBtn.focus();'));

console.log('\n── Les copies ──');
const three = barcodeLabelHTML({ name: 'Huile', barcode: CODE }, { copies: 3 });
ok('le nombre de copies part avec la page', /copies: 3 \}/.test(three));
check('une demande absurde est ramenée dans les clous',
  /copies: (\d+) \}/.exec(barcodeLabelHTML({ barcode: CODE }, { copies: 900 }))![1], '50');
check('zéro copie vaut une copie',
  /copies: (\d+) \}/.exec(barcodeLabelHTML({ barcode: CODE }, { copies: 0 }))![1], '1');

console.log('\n── Les autres rouleaux ──');
const big = barcodeLabelHTML({ name: 'Huile', barcode: CODE }, { size: { widthMm: 58, heightMm: 40 } });
ok('un 58 × 40 annonce sa taille', big.includes('@page{size:58mm 40mm;margin:0}'));
ok('les tailles de texte suivent la hauteur du rouleau',
  big.includes('--fs-name:calc(var(--lh) * 0.135)'));
ok('la marge suit la largeur du rouleau', big.includes(`--pad-x:calc(var(--lw) * ${PAD_X_RATIO})`));
ok('tous les formats du menu sont proposés',
  LABEL_PRESETS.every(p => html.includes(`value="${p.size.widthMm}x${p.size.heightMm}"`)));
ok('le format du rouleau se retient sur le poste', html.includes(LABEL_PREFS_KEY));

/**
 * La marge du CSS et celle de `moduleWidthMm` doivent être LA MÊME, sinon
 * l'avertissement « code trop dense » ment : il rassure sur des barres plus
 * larges que celles qui sortent vraiment.
 */
check('la marge annoncée est celle qui est appliquée',
  moduleWidthMm(CODE, LABEL_40_20), (40 - 40 * PAD_X_RATIO * 2) / code128Widths(CODE)!.modules);

const noPrice = barcodeLabelHTML({ name: 'Sans prix', barcode: CODE });
ok('sans prix, rien ne s\'imprime à sa place', !noPrice.includes('class="price"'));
ok('et le code se recentre au lieu de rester collé à gauche',
  noPrice.includes('class="foot solo"') && /\.foot\.solo\{justify-content:center\}/.test(noPrice));

const nasty = barcodeLabelHTML({ name: '<script>alert(1)</script>', barcode: CODE });
ok('un nom mal intentionné est échappé', !nasty.includes('<script>alert(1)'));

console.log('\n── Le SVG ──');
ok('le SVG d\'étiquette n\'impose aucune largeur',
  !/^<svg[^>]*\swidth="/.test(barcodeLabelSVG(CODE)));
ok('le SVG à taille fixe, lui, porte sa largeur',
  /^<svg[^>]*\swidth="\d/.test(barcodeSVG(CODE)));
check('un code vide ne rend rien', barcodeLabelSVG(''), '');
ok('les barres sont dessinées en noir', barcodeLabelSVG(CODE).includes('<g fill="#000">'));
ok('la zone de silence est réservée à gauche', barcodeLabelSVG(CODE).includes('<rect x="10"'));

console.log('\n── La planche d\'étiquettes d\'un achat ──');
/**
 * Une facture apporte plusieurs références d'un coup, et il faut les étiqueter
 * AVANT de remplir le rayon. Les sortir une par une, c'est autant de fenêtres,
 * autant de dialogues d'impression, et un rouleau qu'on finit par régler de
 * travers en chemin. La planche les met toutes sur la même bande.
 */
const CODE_B = '6100000000002';
const CODE_C = '6100000000003';
const lot = barcodeLabelsHTML([
  { name: 'Huile 5W40', barcode: CODE, salePrice: 2400, copies: 3 },
  { name: 'Filtre à air', barcode: CODE_B, salePrice: 900, copies: 2 },
  { name: 'Bougie', barcode: CODE_C, copies: 1 },
]);
ok('les trois produits sont sur la même planche',
  lot.includes(`>${CODE}<`) && lot.includes(`>${CODE_B}<`) && lot.includes(`>${CODE_C}<`));
check('chaque produit a sa vignette', (lot.match(/class="stage"/g) || []).length, 3);
check('et chacun garde SA quantité', /var ITEMS = (\[[^\]]*\])/.exec(lot)![1], '[3,2,1]');
ok('la page se sait être un lot', lot.includes('var MULTI = true;'));
ok('le réglage de copies devient un multiplicateur', lot.includes('Copies (× chaque produit)'));
/**
 * Le multiplicateur ne se reprend PAS du poste : un « 3 » réglé au comptoir la
 * semaine dernière sortirait trois fois la facture entière sans rien annoncer.
 * Le format du rouleau et le sens, eux, restent repris — ils ne changent pas
 * d'une étiquette à l'autre.
 */
ok('le multiplicateur repart de 1, quoi qu\'ait retenu le poste',
  lot.includes('if (!MULTI) state.copies = prefCopies;'));
ok('et le lot ne réécrit pas les copies enregistrées',
  lot.includes('copies: MULTI ? prefCopies : state.copies,'));
/**
 * Chaque produit repart sur SA page. Sans cette règle, la dernière copie d'un
 * produit et la première du suivant se disputeraient la même étiquette.
 */
ok('un produit qui en suit un autre repart sur sa page',
  lot.includes('#sheets .item:not(:last-child) .sheet:last-child{break-after:page;page-break-after:always}'));
check('l\'avertissement « code dense » regarde le code le plus long du lot',
  /var MODULES = (\d+);/.exec(lot)![1],
  String(Math.max(code128Widths(CODE)!.modules, code128Widths(CODE_B)!.modules,
    code128Widths(CODE_C)!.modules)));

/** Une étiquette seule ne change pas d'un iota : c'est la même page qu'avant. */
check('une étiquette seule passe toujours par le même chemin',
  barcodeLabelsHTML([{ name: 'Huile moteur 5W40', barcode: CODE, salePrice: 2400 }]), html);
ok('et elle ne se croit pas un lot', html.includes('var MULTI = false;'));
ok('une liste vide rend quand même une page', barcodeLabelsHTML([]).includes('Code-barres illisible'));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
process.exit(failed === 0 ? 0 : 1);
