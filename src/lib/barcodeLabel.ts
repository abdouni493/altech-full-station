/**
 * ─── L'ÉTIQUETTE CODE-BARRES, TAILLÉE POUR LE ROULEAU ──────────────────────────
 *
 * Ce qui sortait de l'imprimante, et pourquoi.
 *
 * Le rouleau de la station fait 40 mm de large sur 20 mm de haut : une vignette
 * COUCHÉE. Mais entre la page que le navigateur décrit et le papier que le
 * pilote croit avoir, il y a quatre façons de se tromper — droit, un quart de
 * tour à droite, la tête en bas, un quart de tour à gauche. Le pilote Seagull
 * du XP-350B, réglé sur un support « USER », fait tourner l'image dès que
 * l'orientation annoncée ne correspond pas à la sienne. Résultat au comptoir :
 * le nom, les chiffres et le prix sortent en travers de l'étiquette et coupés
 * net sur le côté, la moitié du rouleau reste blanche.
 *
 * Une case à cocher « pivoter » ne couvrait que deux cas sur quatre, et une
 * fois cochée par erreur elle restait cochée : l'étiquette sortait debout pour
 * de bon. D'où, ici :
 *
 *   • le SENS D'IMPRESSION est un vrai réglage à quatre positions — 0°, 90°,
 *     180°, 270° — et il vaut 0° par défaut : HORIZONTALE, dans le sens de la
 *     lecture, comme le rouleau. Quel que soit le tour que fait le pilote, une
 *     des quatre positions le rattrape ;
 *   • la page suit le sens choisi : `@page{size:40mm 20mm}` à plat,
 *     `@page{size:20mm 40mm}` sur un quart de tour. Plus de contradiction entre
 *     la page et le support, donc plus de rotation-surprise ;
 *   • le réglage se retient par poste (`localStorage`). La clé porte un numéro
 *     de version : l'ancien « pivoté » enregistré par la version précédente ne
 *     ressuscite pas, seul le format du rouleau est repris ;
 *   • la vignette est une GRILLE À TROIS RANGÉES — nom · barres · pied (code à
 *     gauche, prix à droite). Le pied sur une seule ligne rend près de 3 mm de
 *     hauteur aux barres sur un 40 × 20, et des barres hautes se lisent du
 *     premier coup ;
 *   • toutes les tailles dérivent de la hauteur de l'étiquette, donc un 58 × 40
 *     n'est pas un 40 × 20 avec du vide autour ;
 *   • le nom et le pied se réduisent jusqu'à tenir dans leur boîte — mesuré une
 *     fois les polices chargées, et re-mesuré juste avant l'impression.
 *
 * Le module ne connaît ni le DOM ni React : il rend du HTML, et se teste.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/** Dimensions d'une vignette, en millimètres. */
export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

/** Le rouleau utilisé en station : 40 mm de large, 20 mm de haut. */
export const LABEL_40_20: LabelSize = { widthMm: 40, heightMm: 20 };

/**
 * Les rouleaux qu'on trouve chez les fournisseurs. Le premier est le format par
 * défaut ; les autres sont là pour qu'un changement de bobine ne demande pas
 * une reprise du code.
 */
export const LABEL_PRESETS: { label: string; size: LabelSize }[] = [
  { label: '40 × 20 mm', size: { widthMm: 40, heightMm: 20 } },
  { label: '40 × 30 mm', size: { widthMm: 40, heightMm: 30 } },
  { label: '50 × 25 mm', size: { widthMm: 50, heightMm: 25 } },
  { label: '50 × 30 mm', size: { widthMm: 50, heightMm: 30 } },
  { label: '58 × 40 mm', size: { widthMm: 58, heightMm: 40 } },
  { label: '60 × 40 mm', size: { widthMm: 60, heightMm: 40 } },
  { label: '30 × 20 mm', size: { widthMm: 30, heightMm: 20 } },
  { label: '100 × 50 mm', size: { widthMm: 100, heightMm: 50 } },
];

/**
 * Le sens dans lequel le dessin est posé sur la page, en degrés.
 *
 * 0° est le bon réglage quand le pilote respecte la page qu'on lui envoie —
 * c'est le défaut, et c'est ce que le rouleau 40 × 20 demande. Les trois autres
 * positions existent pour rattraper un pilote qui tourne l'image de son côté.
 */
export type LabelRotation = 0 | 90 | 180 | 270;

/** Les quatre positions, telles qu'elles s'affichent dans la fenêtre d'aperçu. */
export const LABEL_ROTATIONS: { value: LabelRotation; label: string }[] = [
  { value: 0, label: 'Horizontale — dans le sens du rouleau' },
  { value: 90, label: "Quart de tour à droite (elle sortait couchée vers la gauche)" },
  { value: 180, label: 'Demi-tour — la tête en bas' },
  { value: 270, label: "Quart de tour à gauche (elle sortait couchée vers la droite)" },
];

/**
 * Ramène n'importe quelle valeur enregistrée à une des quatre positions.
 * L'ancien réglage booléen (`true` = « pivoter ») devient 90° : un appelant qui
 * passe encore un booléen obtient le sens qu'il demandait.
 */
export function normalizeRotation(v: unknown): LabelRotation {
  const n = typeof v === 'boolean' ? (v ? 90 : 0) : Math.round(Number(v) || 0);
  const m = ((n % 360) + 360) % 360;
  return (m === 90 || m === 180 || m === 270 ? m : 0) as LabelRotation;
}

/**
 * La marge de la vignette, en PROPORTION de ses côtés — 2,5 % en largeur, 3 %
 * en hauteur. Une marge en millimètres fixes mangerait tout un 30 × 20 et se
 * perdrait sur un 100 × 50 ; en proportion, le dessin est le même partout.
 * Ces deux nombres sont la seule source : le CSS les reprend, `moduleWidthMm`
 * aussi, et l'avertissement « code trop dense » reste donc vrai.
 */
export const PAD_X_RATIO = 0.025;
export const PAD_Y_RATIO = 0.03;

/** Ce qu'on retient d'un poste à l'autre : format du rouleau, sens, copies. */
export interface LabelOptions {
  size?: LabelSize;
  /** Sens d'impression en degrés — voir `LabelRotation`. */
  rotate?: LabelRotation | number | boolean;
  /** Nombre de vignettes identiques à sortir d'affilée. */
  copies?: number;
}

/** Ce qu'une étiquette montre d'un produit. */
export interface BarcodeLabelProduct {
  name?: string;
  barcode?: string;
  salePrice?: number;
}

/**
 * Code 128 — une trame de 6 modules par valeur (0-106), commune aux jeux A, B
 * et C. Chaque trame est barre/espace/barre/espace/barre/espace ; le symbole
 * d'arrêt (106) porte une barre terminale supplémentaire. Table standard,
 * lisible par toutes les douchettes.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_SWITCH_B = 100;
const CODE128_SWITCH_C = 99;
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_STOP = 106;
/** Zone de silence exigée par la norme, de chaque côté du symbole. */
const QUIET_MODULES = 10;

/** Longueur de la suite de chiffres qui commence en `i`. */
function digitRun(s: string, i: number): number {
  let n = 0;
  while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++;
  return n;
}

/**
 * Les VALEURS Code 128 d'un texte, jeu B et jeu C mélangés.
 *
 * Le jeu C encode DEUX chiffres par symbole. Les codes de la station font
 * treize chiffres (`genBarcode`) : en jeu B seul, le symbole pesait 198
 * modules, soit 0,19 mm par module une fois étalé sur 40 mm — la limite basse
 * de ce qu'une douchette d'entrée de gamme sait lire. Le même code en jeu C
 * tombe à 143 modules, donc 0,27 mm : le symbole passe de « ça devrait
 * marcher » à « ça se lit du premier coup ».
 *
 * La bascule se décide au compte de symboles, pas à vue de nez : deux chiffres
 * en C en économisent un, entrer coûte un symbole (gratuit au départ, où la
 * bascule remplace le symbole de début) et revenir en B en coûte un autre s'il
 * reste quelque chose derrière. On ne bascule que si le solde est POSITIF —
 * une égalité resterait en jeu B, plus simple à relire.
 */
export function code128Values(text: string): number[] | null {
  // Code 128 (jeux B/C) n'encode que l'ASCII imprimable (32-126).
  const clean = String(text ?? '').replace(/[^\x20-\x7E]/g, '');
  if (!clean) return null;

  const codes: number[] = [];
  let mode: 'B' | 'C' | null = null;
  let i = 0;

  while (i < clean.length) {
    const run = digitRun(clean, i);
    const even = run - (run % 2);        // le jeu C avale les chiffres par PAIRES
    const entryCost = mode === 'C' || i === 0 ? 0 : 1;
    const exitCost = i + even < clean.length ? 1 : 0;
    const wantC = even >= 2 && even / 2 - entryCost - exitCost > 0;

    if (wantC) {
      if (mode !== 'C') { codes.push(mode === null ? CODE128_START_C : CODE128_SWITCH_C); mode = 'C'; }
      for (let k = 0; k < even; k += 2) codes.push(parseInt(clean.substr(i + k, 2), 10));
      i += even;
    } else {
      if (mode !== 'B') { codes.push(mode === null ? CODE128_START_B : CODE128_SWITCH_B); mode = 'B'; }
      codes.push(clean.charCodeAt(i) - 32);
      i += 1;
    }
  }

  // Somme de contrôle : le symbole de départ pèse 1, puis chaque symbole pèse
  // son rang. Le reste modulo 103 est le caractère de contrôle.
  let checksum = codes[0];
  for (let k = 1; k < codes.length; k++) checksum += codes[k] * k;
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);
  return codes;
}

/**
 * La suite des largeurs barre/espace du symbole, en modules, zones de silence
 * comprises. `null` quand le texte n'a rien d'encodable.
 */
export function code128Widths(text: string): { widths: number[]; modules: number } | null {
  const codes = code128Values(text);
  if (!codes) return null;

  const widths = codes
    .map(c => CODE128_PATTERNS[c])
    .join('')
    .split('')
    .map(d => parseInt(d, 10));
  const modules = widths.reduce((s, w) => s + w, 0) + QUIET_MODULES * 2;
  return { widths, modules };
}

/** Les barres noires du symbole, en unités de module, zone de silence incluse. */
function barRects(widths: number[], unit: number, height: number): string {
  let x = QUIET_MODULES * unit;
  let isBar = true;
  let rects = '';
  for (const w of widths) {
    const width = w * unit;
    if (isBar) rects += `<rect x="${round(x)}" y="0" width="${round(width)}" height="${height}"/>`;
    x += width;
    isBar = !isBar;
  }
  return rects;
}

const round = (n: number) => Math.round(n * 1000) / 1000;


/**
 * Code-barres à taille FIXE, en pixels — pour un aperçu à l'écran ou un
 * document qui n'est pas une étiquette.
 */
export function barcodeSVG(text: string, moduleWidth = 2, height = 70): string {
  const bars = code128Widths(text);
  if (!bars) return '';
  const total = bars.modules * moduleWidth;
  return `<svg width="${round(total)}" height="${height}" viewBox="0 0 ${round(total)} ${height}"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`
    + `<rect x="0" y="0" width="${round(total)}" height="${height}" fill="#fff"/>`
    + `<g fill="#000">${barRects(bars.widths, moduleWidth, height)}</g></svg>`;
}

/**
 * Code-barres d'ÉTIQUETTE : aucune largeur figée, il remplit la boîte que le
 * CSS lui donne. C'est ce qui le fait tenir dans la vignette quel que soit le
 * nombre de caractères — un code à rallonge resserre ses barres au lieu de
 * déborder.
 *
 * `preserveAspectRatio="none"` étire uniquement en X : toutes les barres
 * gardent leurs proportions les unes par rapport aux autres, donc le symbole
 * reste lisible.
 */
export function barcodeLabelSVG(text: string): string {
  const bars = code128Widths(text);
  if (!bars) return '';
  const H = 100; // hauteur du repère interne ; la hauteur réelle vient du CSS
  return `<svg viewBox="0 0 ${bars.modules} ${H}" preserveAspectRatio="none"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`
    + `<rect x="0" y="0" width="${bars.modules}" height="${H}" fill="#fff"/>`
    + `<g fill="#000">${barRects(bars.widths, 1, H)}</g></svg>`;
}

/**
 * Largeur d'un module une fois l'étiquette imprimée, en millimètres. En dessous
 * d'environ 0,19 mm, une douchette d'entrée de gamme commence à buter sur le
 * symbole : la fenêtre d'impression le signale plutôt que de laisser découvrir
 * le problème au comptoir.
 *
 * La marge par défaut est celle qu'applique réellement la feuille :
 * `PAD_X_RATIO` de la largeur, soit 1 mm sur un rouleau de 40 mm.
 */
export function moduleWidthMm(
  text: string,
  size: LabelSize = LABEL_40_20,
  paddingMm: number = size.widthMm * PAD_X_RATIO,
): number {
  const bars = code128Widths(text);
  if (!bars) return 0;
  return (size.widthMm - paddingMm * 2) / bars.modules;
}

/** En deçà de cette largeur de module, le symbole devient difficile à lire. */
export const MIN_MODULE_MM = 0.19;

/**
 * Le prix tel qu'il se lit sur une vignette : sans décimales quand elles valent
 * zéro. « 250 DA » se lit d'un coup d'œil, « 250,00 DA » mange trois caractères
 * de large pour ne rien apprendre.
 */
export function labelPrice(price?: number): string {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return '';
  const whole = Math.abs(price - Math.round(price)) < 0.005;
  const n = price.toLocaleString('fr-DZ', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${n} DA`;
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/**
 * Où le poste retient son rouleau : format, sens, nombre de copies.
 *
 * Le numéro de version compte. La v1 enregistrait un « pivoté » booléen qu'un
 * essai malheureux laissait coché pour toujours — l'étiquette sortait debout à
 * chaque impression, sans que rien sur l'écran de saisie ne le laisse deviner.
 * En v2, seul le FORMAT est repris de l'ancien réglage ; le sens repart
 * d'horizontale, celui du rouleau.
 */
export const LABEL_PREFS_KEY = 'etiquette.format.v2';
/** L'ancienne clé, relue une seule fois pour ne pas reperdre le format choisi. */
export const LABEL_PREFS_KEY_V1 = 'etiquette.format.v1';


/** Une vignette du lot : un produit, et le nombre d'exemplaires voulu. */
export interface BarcodeLabelItem extends BarcodeLabelProduct {
  /**
   * Exemplaires de CETTE vignette — la quantité reçue, par exemple. Le réglage
   * « copies » de la fenêtre les MULTIPLIE, il ne les remplace pas : on choisit
   * ses quantités dans l'application, et on double tout le lot d'un clic si
   * l'imprimante a bavé.
   */
  copies?: number;
}

/**
 * La page d'impression d'UNE étiquette — le chemin de tous les écrans qui
 * étiquettent un produit à l'unité (fiche produit, formulaire de saisie).
 */
export function barcodeLabelHTML(
  product: BarcodeLabelProduct,
  sizeOrOptions: LabelSize | LabelOptions = LABEL_40_20,
): string {
  return barcodeLabelsHTML([product], sizeOrOptions);
}

/**
 * La page d'impression complète — une vignette, ou TOUT UN LOT.
 *
 * À l'écran elle montre les étiquettes AGRANDIES — une vignette de 40 × 20 mm
 * est illisible sur un moniteur — avec les trois réglages qui décident de ce
 * qui sort vraiment : le sens, le format du rouleau, le nombre de copies. À
 * l'imprimante, seules les vignettes partent, exactement à leur taille.
 *
 * Le LOT existe pour la réception d'un achat. Une facture apporte douze
 * produits, et il faut douze planches d'étiquettes avant de remplir le rayon :
 * les ouvrir une par une, c'est douze fenêtres, douze dialogues d'impression et
 * autant d'occasions de se tromper de rouleau en chemin. Ici chaque produit
 * garde son propre nombre d'exemplaires — la quantité reçue — et tout part sur
 * la même bande.
 *
 * Le format et le sens vivent dans des VARIABLES CSS et dans une règle `@page`
 * réécrite à la volée : changer de rouleau ne redemande pas la page, l'aperçu
 * suit immédiatement, et le choix est retenu pour l'étiquette suivante. Le
 * nombre de copies, lui, n'est retenu que pour une étiquette SEULE : sur un lot
 * il vaut multiplicateur, et le reprendre d'une session à l'autre sortirait
 * trois fois trop de papier sans rien annoncer.
 *
 * La fenêtre ne déclenche PLUS l'impression toute seule. Le dialogue s'ouvrait
 * par-dessus les réglages, donc par-dessus le seul endroit où corriger un
 * mauvais sens : on voyait le problème sans pouvoir l'atteindre. Le bouton
 * « Imprimer » prend le focus au chargement — une touche Entrée suffit.
 */
export function barcodeLabelsHTML(
  items: BarcodeLabelItem[],
  sizeOrOptions: LabelSize | LabelOptions = LABEL_40_20,
): string {
  const opts: LabelOptions = 'widthMm' in (sizeOrOptions as LabelSize)
    ? { size: sizeOrOptions as LabelSize }
    : (sizeOrOptions as LabelOptions);
  const size = opts.size || LABEL_40_20;
  const rotate = normalizeRotation(opts.rotate);
  const copies = Math.max(1, Math.min(50, Math.round(opts.copies || 1)));

  // Une liste vide garde une vignette : la fenêtre dit « code illisible »
  // plutôt que de s'ouvrir sur du blanc, ce qui ne s'explique pas.
  const list: BarcodeLabelItem[] = items && items.length ? items : [{}];
  const multi = list.length > 1;

  const labels = list.map(item => {
    const code = String(item.barcode ?? '').trim();
    return {
      code,
      svg: barcodeLabelSVG(code),
      name: escapeHtml(item.name || ''),
      price: escapeHtml(labelPrice(item.salePrice)),
      copies: Math.max(1, Math.min(99, Math.round(item.copies || 1))),
      modules: code128Widths(code)?.modules ?? 0,
    };
  });

  // L'avertissement « code trop dense » vaut pour le lot entier : c'est le code
  // le PLUS long qui décide si les barres deviennent illisibles sur ce rouleau.
  const modules = labels.reduce((m, l) => Math.max(m, l.modules), 0);
  const W = size.widthMm;
  const H = size.heightMm;
  // La page envoyée à l'imprimante : les côtés s'échangent sur un quart de tour.
  const quarter = rotate === 90 || rotate === 270;
  const PW = quarter ? H : W;
  const PH = quarter ? W : H;

  const presetOptions = LABEL_PRESETS.map(p =>
    `<option value="${p.size.widthMm}x${p.size.heightMm}"`
    + `${p.size.widthMm === W && p.size.heightMm === H ? ' selected' : ''}>${p.label}</option>`
  ).join('');
  const rotationOptions = LABEL_ROTATIONS.map(r =>
    `<option value="${r.value}"${r.value === rotate ? ' selected' : ''}>${escapeHtml(r.label)}</option>`
  ).join('');

  const pageTitle = multi
    ? `Étiquettes — ${labels.length} produits`
    : `Étiquette ${escapeHtml(labels[0].code)}`;

  const stages = labels.map(l => `
      <div class="item">
        <div class="stage">
          <div class="sheet">
            <div class="label">
              ${l.svg ? `
              <div class="name" data-fit="height">${l.name || '&nbsp;'}</div>
              <div class="bars">${l.svg}</div>
              <div class="foot${l.price ? '' : ' solo'}" data-fit="width">
                <span class="code">${escapeHtml(l.code)}</span>${l.price ? `<span class="price">${l.price}</span>` : ''}
              </div>`
              : `<div class="empty">Code-barres illisible</div>`}
            </div>
          </div>
        </div>${multi ? '\n        <p class="cap screen-only"></p>' : ''}
      </div>`).join('');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle}</title>
<style id="page-size">@page{size:${PW}mm ${PH}mm;margin:0}</style>
<style>
  *{margin:0;padding:0;box-sizing:border-box}

  /* ── Toute la vignette dérive de ces quatre nombres ─────────────────────────
     "--lw"/"--lh" sont le DESSIN (toujours à l'endroit), "--pw"/"--ph" la PAGE
     envoyée à l'imprimante (côtés échangés sur un quart de tour). Les tailles
     de texte et les marges sont des fractions de la hauteur : un 58 × 40 n'est
     pas un 40 × 20 entouré de vide, c'est le même dessin en plus grand. */
  :root{
    --lw:${W}mm; --lh:${H}mm;
    --pw:${PW}mm; --ph:${PH}mm;
    --pad-x:calc(var(--lw) * ${PAD_X_RATIO});
    --pad-y:calc(var(--lh) * ${PAD_Y_RATIO});
    --fs-name:calc(var(--lh) * 0.135);
    --fs-foot:calc(var(--lh) * 0.115);
    --zoom:2.8;
    color-scheme:light;
  }
  html,body{background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#0f172a}

  /* ── La page physique, et la vignette dedans ──────────────────────────────
     ".sheet" fait EXACTEMENT la taille de la page : c'est lui qui garantit
     qu'une vignette tournée retombe dans ses clous plutôt que de déborder. */
  .sheet{
    position:relative;
    width:var(--pw);height:var(--ph);
    background:#fff;overflow:hidden;
    break-after:page;page-break-after:always;
  }
  /* La dernière copie ne pousse pas une page blanche derrière elle. */
  .sheet:last-child{break-after:auto;page-break-after:auto}
  /* …sauf s'il reste un produit derrière : la règle du dessus ne parle que de
     la dernière copie d'UN produit, pas de la dernière du lot. */
  #sheets .item:not(:last-child) .sheet:last-child{break-after:page;page-break-after:always}

  .label{
    position:absolute;top:0;left:0;
    width:var(--lw);height:var(--lh);
    padding:var(--pad-y) var(--pad-x);
    background:#fff;color:#000;
    overflow:hidden;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;

    /* Trois rangées : nom · barres · pied. Le nom et le pied prennent leur
       hauteur ("auto"), les barres prennent tout le reste ("minmax(0,1fr)",
       qui sait descendre à zéro sans jamais pousser ses voisines). Chaque
       rangée est ASSIGNÉE explicitement : une étiquette sans nom laisse sa
       place aux barres au lieu de décaler tout le dessin d'un cran. */
    display:grid;
    grid-template-rows:auto minmax(0,1fr) auto;
    align-content:stretch;
  }

  /* ── Le sens d'impression ─────────────────────────────────────────────────
     La vignette tourne DANS sa page, dont les côtés ont déjà été échangés au
     besoin. Chaque transformation se lit de droite à gauche : on déplace
     d'abord la vignette de sa propre taille, puis on tourne — elle retombe
     pile sur la page, coin sur coin, sans un dixième de millimètre de fuite. */
  body[data-rotate="90"]  .label{transform-origin:0 0;transform:rotate(90deg) translateY(-100%)}
  body[data-rotate="180"] .label{transform-origin:0 0;transform:rotate(180deg) translate(-100%,-100%)}
  body[data-rotate="270"] .label{transform-origin:0 0;transform:rotate(-90deg) translateX(-100%)}

  /* Le nom : gras, deux lignes au plus, et une hauteur PLAFONNÉE. Sans ce
     plafond, un nom à rallonge prendrait sur la hauteur des barres. */
  .name{
    grid-row:1;
    font-weight:900;font-size:var(--fs-name);line-height:1.06;
    letter-spacing:-0.02em;text-align:center;
    max-height:calc(var(--lh) * 0.28);
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
    overflow:hidden;overflow-wrap:anywhere;
  }
  /* Les barres remplissent la rangée que la grille leur laisse. Le SVG est en
     absolu : c'est la seule façon fiable de remplir une boîte dont la hauteur
     vient de "1fr". */
  .bars{
    grid-row:2;
    position:relative;min-height:0;
    margin:calc(var(--lh) * 0.02) 0 calc(var(--lh) * 0.015);
  }
  .bars svg{position:absolute;top:0;left:0;width:100%;height:100%;display:block}

  /* Le pied, sur UNE seule ligne : le code à gauche, le prix à droite. Deux
     rangées empilées coûtaient près de 3 mm sur un rouleau de 20 mm de haut —
     3 mm que les barres n'avaient pas, et des barres courtes se lisent mal.
     Les deux textes ne se replient pas ("flex:none" + "nowrap") : ils
     débordent donc franchement quand ils sont trop larges, ce qui est
     précisément ce que la mesure ci-dessous sait voir et corriger. */
  .foot{
    grid-row:3;
    display:flex;align-items:baseline;justify-content:space-between;
    gap:calc(var(--lw) * 0.03);
    font-size:var(--fs-foot);line-height:1.15;
    white-space:nowrap;overflow:hidden;
  }
  .foot.solo{justify-content:center}
  .foot .code{
    flex:none;font-family:'Courier New',Courier,monospace;font-weight:700;
    letter-spacing:0.06em;
  }
  .foot .price{flex:none;font-weight:900;font-size:1.45em}
  .empty{
    grid-row:1 / -1;align-self:center;
    font-size:calc(var(--lh) * 0.12);font-weight:700;text-align:center;
  }

  /* ── Écran : les vignettes agrandies, et les réglages qui les commandent ── */
  @media screen{
    body{
      min-height:100vh;padding:22px 16px 32px;
      display:flex;flex-direction:column;align-items:center;gap:14px;
    }
    h1{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#64748b;text-align:center}
    #dims{font:700 15px/1.3 Arial,Helvetica,sans-serif;color:#0f172a;text-align:center;margin-top:-8px}

    /* Le lot s'étale en galerie — une vignette par produit, autant de rangées
       qu'il en faut : une facture de vingt références se relit d'un coup d'œil
       avant d'engager le rouleau. */
    #sheets{display:flex;flex-wrap:wrap;gap:18px 16px;justify-content:center;max-width:100%}
    .item{display:flex;flex-direction:column;align-items:center;gap:5px}
    .cap{
      font:900 11px/1 Arial,Helvetica,sans-serif;color:#475569;
      background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:4px 10px;
    }

    /* La scène fait la taille de la PAGE, au grossissement près : ce qui se
       voit à l'écran est le rectangle qui sortira, bord pour bord. */
    .stage{
      width:calc(var(--pw) * var(--zoom));height:calc(var(--ph) * var(--zoom));
      box-shadow:0 12px 32px rgba(15,23,42,.20);border-radius:3px;background:#fff;
      outline:1px dashed #94a3b8;outline-offset:3px;
      overflow:hidden;flex:none;
    }
    .stage .sheet{transform:scale(var(--zoom));transform-origin:top left}
    /* Une seule vignette par produit à l'écran : les copies ne concernent que
       le papier. */
    .stage .sheet:not(:first-child){display:none}

    .panel{
      display:flex;flex-wrap:wrap;gap:12px 16px;justify-content:center;align-items:flex-end;
      background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 18px;
      box-shadow:0 2px 10px rgba(15,23,42,.06);max-width:640px;width:100%;
    }
    .panel label{
      display:flex;flex-direction:column;gap:6px;
      font:700 10px/1 Arial,Helvetica,sans-serif;
      text-transform:uppercase;letter-spacing:.1em;color:#64748b;
    }
    .panel .wide{flex:1 1 100%;min-width:0}
    .panel select,.panel input[type=number]{
      font:700 13px/1.2 Arial,Helvetica,sans-serif;color:#0f172a;
      border:1px solid #cbd5e1;border-radius:9px;padding:9px 10px;background:#fff;
      max-width:100%;
    }
    .panel select:focus,.panel input:focus{outline:2px solid #001f5c;outline-offset:1px}

    /* Les copies au pas de un : au comptoir on ajoute une étiquette, on ne
       tape pas un nombre. */
    .stepper{display:flex;align-items:stretch;gap:6px}
    .stepper button{
      width:32px;padding:0;font-size:17px;line-height:1;border-radius:9px;
      background:#e2e8f0;color:#0f172a;letter-spacing:0;
    }
    .stepper button:hover{background:#cbd5e1}
    .stepper input[type=number]{width:64px;text-align:center;-moz-appearance:textfield}
    .stepper input::-webkit-outer-spin-button,
    .stepper input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}

    .warn{
      max-width:560px;font-size:12px;line-height:1.5;text-align:center;font-weight:700;
      color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;
    }
    .warn[hidden]{display:none}

    /* La liste de contrôle du dialogue d'impression. Les cinq réglages qui
       décident si l'étiquette sort juste sont dans CE dialogue, pas dans la
       page : autant les avoir sous les yeux au moment de le remplir. */
    .help{
      max-width:560px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;
      padding:12px 18px;font-size:12px;line-height:1.7;color:#475569;
    }
    .help summary{
      cursor:pointer;font-weight:700;color:#0f172a;text-transform:uppercase;
      font-size:10px;letter-spacing:.1em;
    }
    .help ol{margin:10px 0 0 18px}
    .help b{color:#0f172a}

    .actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
    button{
      font:700 12px/1 Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;
      padding:14px 26px;border-radius:11px;border:0;cursor:pointer;
      background:#001f5c;color:#FFB800;
    }
    button:hover{background:#003087}
    button.ghost{background:#e2e8f0;color:#334155}
    button.ghost:hover{background:#cbd5e1}
  }

  /* ── Impression : les vignettes, et rien d'autre ───────────────────────── */
  @media print{
    html,body{background:#fff;padding:0;margin:0;display:block}
    .screen-only{display:none!important}
    #sheets,.item{display:block}
    .stage{
      width:auto;height:auto;box-shadow:none;border-radius:0;
      outline:0;overflow:visible;
    }
    .stage .sheet{transform:none}
  }
</style></head>
<body data-rotate="${rotate}">
  <h1 class="screen-only">${multi ? 'Aperçu des étiquettes' : "Aperçu de l'étiquette"}</h1>
  <p class="screen-only" id="dims"></p>

  <div id="sheets">${stages}
  </div>

  <div class="panel screen-only">
    <label class="wide">Sens d'impression
      <select id="rot">${rotationOptions}</select>
    </label>
    <label>Format du rouleau
      <select id="fmt">${presetOptions}</select>
    </label>
    <label>${multi ? 'Copies (× chaque produit)' : 'Copies'}
      <span class="stepper">
        <button type="button" class="ghost" id="less" title="Une de moins">&minus;</button>
        <input type="number" id="cop" min="1" max="50" step="1" value="${copies}">
        <button type="button" class="ghost" id="more" title="Une de plus">+</button>
      </span>
    </label>
  </div>

  <p class="warn screen-only" id="warn" hidden></p>

  <details class="help screen-only" open>
    <summary>Réglages du dialogue d'impression</summary>
    <ol>
      <li><b>Destination</b> : votre étiqueteuse (XPrinter…), pas une imprimante A4.</li>
      <li><b>Taille du papier</b> : le format « USER » du pilote, réglé sur <b id="paper"></b>.</li>
      <li><b>Marges</b> : <b>Aucune</b>.</li>
      <li><b>Échelle</b> : <b>100&nbsp;%</b> — surtout pas « Ajuster à la largeur de la page ».</li>
      <li><b>Décochez</b> « Imprimer les en-têtes et pieds de page ».</li>
    </ol>
  </details>

  <div class="actions screen-only">
    <button type="button" id="print">Imprimer</button>
    <button type="button" class="ghost" id="close">Fermer</button>
  </div>

  <script>
  (function () {
    var PREFS = ${JSON.stringify(LABEL_PREFS_KEY)};
    var PREFS_V1 = ${JSON.stringify(LABEL_PREFS_KEY_V1)};
    var MODULES = ${modules};
    var PAD_X = ${PAD_X_RATIO};
    var MIN_MODULE = ${MIN_MODULE_MM};
    /** Exemplaires voulus produit par produit, dans l'ordre des vignettes. */
    var ITEMS = ${JSON.stringify(labels.map(l => l.copies))};
    var MULTI = ${multi};

    var root = document.documentElement;
    var pageStyle = document.getElementById("page-size");
    var sheets = document.getElementById("sheets");
    var fmt = document.getElementById("fmt");
    var rot = document.getElementById("rot");
    var cop = document.getElementById("cop");

    var state = { w: ${W}, h: ${H}, rotate: ${rotate}, copies: ${copies} };

    function clean(deg) {
      var n = Math.round(Number(deg) || 0), m = ((n % 360) + 360) % 360;
      return (m === 90 || m === 180 || m === 270) ? m : 0;
    }

    // ── Le réglage retenu sur le poste ─────────────────────────────────────
    // Le format d'un rouleau ne change pas d'une étiquette à l'autre : réglé
    // une fois, il vaut pour toutes les suivantes.
    //
    // De l'ancien réglage (v1) on ne reprend QUE le format. Son "pivoté"
    // booléen, coché un jour pour essayer, faisait sortir toutes les étiquettes
    // debout jusqu'à ce que quelqu'un pense à le décocher : le sens repart
    // d'horizontale, celui du rouleau.
    //
    // Le nombre de copies n'est repris que pour une étiquette SEULE. Sur un lot
    // c'est un multiplicateur : un "3" enregistré au comptoir la semaine
    // dernière sortirait trois fois la facture entière sans rien annoncer.
    var prefCopies = 1;
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS) || "null");
      if (saved && saved.w > 0 && saved.h > 0) {
        state.w = saved.w;
        state.h = saved.h;
        state.rotate = clean(saved.rotate);
        prefCopies = Math.max(1, Math.min(50, saved.copies || 1));
        if (!MULTI) state.copies = prefCopies;
      } else {
        var old = JSON.parse(localStorage.getItem(PREFS_V1) || "null");
        if (old && old.w > 0 && old.h > 0) { state.w = old.w; state.h = old.h; }
      }
    } catch (e) { /* navigation privée, stockage bloqué : on garde le défaut */ }

    function save() {
      try {
        localStorage.setItem(PREFS, JSON.stringify({
          w: state.w, h: state.h, rotate: state.rotate,
          copies: MULTI ? prefCopies : state.copies,
        }));
      } catch (e) {}
    }

    // ── Réduire un texte jusqu'à ce qu'il tienne dans sa boîte ─────────────
    // Mesuré en PIXELS à partir de la taille calculée : marche donc pour
    // n'importe quel format, sans table de correspondance en millimètres.
    //
    // Le nom se mesure BRIDE DESSERRÉE. Tant que "-webkit-line-clamp" tient,
    // le navigateur coupe le texte à deux lignes et annonce une hauteur qui
    // rentre toujours : on ne verrait jamais qu'il déborde, et un nom long
    // sortirait tronqué par des points de suspension au lieu de rétrécir.
    // On relâche la bride le temps de la mesure, puis on la remet.
    //
    // Et on vise DEUX LIGNES À LA TAILLE COURANTE, pas le "max-height" du CSS :
    // celui-ci vaut deux lignes à la taille de DÉPART, donc presque trois une
    // fois le texte réduit — le nom aurait passé la mesure pour se faire
    // couper juste après par la bride.
    var LINES = 2;
    function fit(el) {
      if (!el) return;
      el.style.fontSize = "";
      var base = parseFloat(getComputedStyle(el).fontSize);
      if (!(base > 0)) return;
      var byWidth = el.getAttribute("data-fit") === "width";
      if (!byWidth) el.style.webkitLineClamp = "unset";

      var over = function () {
        if (byWidth) return el.scrollWidth > el.clientWidth + 1;
        var cs = getComputedStyle(el);
        var lh = parseFloat(cs.lineHeight);
        if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.2;
        return el.scrollHeight > LINES * lh + 1;
      };

      var size = base, floor = base * 0.62, step = base * 0.04, guard = 0;
      while (over() && size > floor && guard++ < 40) {
        size -= step;
        el.style.fontSize = size + "px";
      }
      if (!byWidth) el.style.webkitLineClamp = "";
    }
    function fitAll() {
      var nodes = sheets.querySelectorAll("[data-fit]");
      for (var i = 0; i < nodes.length; i++) fit(nodes[i]);
    }

    // ── Appliquer l'état : page, variables CSS, copies, avertissement ──────
    function apply() {
      var quarter = state.rotate === 90 || state.rotate === 270;
      var pw = quarter ? state.h : state.w;
      var ph = quarter ? state.w : state.h;

      // Une règle @page ne lit pas les variables CSS : on la réécrit.
      pageStyle.textContent = "@page{size:" + pw + "mm " + ph + "mm;margin:0}";
      root.style.setProperty("--lw", state.w + "mm");
      root.style.setProperty("--lh", state.h + "mm");
      root.style.setProperty("--pw", pw + "mm");
      root.style.setProperty("--ph", ph + "mm");
      // L'aperçu vise ~112 mm de large et ~150 mm de haut à l'écran : assez
      // grand pour relire un prix, assez petit pour tenir dans la fenêtre quel
      // que soit le rouleau — y compris un 20 × 40 debout. Un lot se contente
      // de moins : l'intérêt est d'en voir plusieurs à la fois.
      var zoom = Math.min((MULTI ? 74 : 112) / pw, (MULTI ? 98 : 150) / ph);
      root.style.setProperty("--zoom", Math.max(1.2, Math.min(6, Math.round(zoom * 100) / 100)));
      document.body.setAttribute("data-rotate", String(state.rotate));

      // Autant de pages que de copies, toutes identiques à la première — et ce
      // produit par produit : chacun garde la quantité qu'on lui a donnée.
      var stages = sheets.querySelectorAll(".stage");
      var total = 0;
      for (var i = 0; i < stages.length; i++) {
        var st = stages[i];
        var want = Math.max(1, Math.min(500, (ITEMS[i] || 1) * state.copies));
        var first = st.firstElementChild;
        while (st.children.length > want) st.removeChild(st.lastElementChild);
        while (st.children.length < want) st.appendChild(first.cloneNode(true));
        var cap = st.parentNode.querySelector(".cap");
        if (cap) cap.textContent = "\\u00D7 " + want;
        total += want;
      }

      var turned = state.rotate ? " \\u00B7 " + state.rotate + "\\u00B0" : "";
      var many = MULTI
        ? " \\u00B7 " + stages.length + " produits \\u00B7 " + total + " \\u00E9tiquettes"
        : (total > 1 ? " \\u00B7 " + total + " copies" : "");
      document.getElementById("dims").textContent =
        state.w + " \\u00D7 " + state.h + " mm" + turned + many;
      document.getElementById("paper").textContent = pw + " \\u00D7 " + ph + " mm";

      // Les barres sont-elles encore lisibles à cette largeur ?
      var warn = document.getElementById("warn");
      var mm = MODULES ? (state.w - state.w * PAD_X * 2) / MODULES : 0;
      if (mm > 0 && mm < MIN_MODULE) {
        warn.hidden = false;
        warn.textContent = "Code très long : les barres ne font que " + mm.toFixed(2)
          + " mm de large sur " + state.w + " mm. Certaines douchettes peineront \\u2014 "
          + "un rouleau plus large, ou un code plus court, se lit mieux.";
      } else {
        warn.hidden = true;
      }

      fitAll();
    }

    // ── Les commandes ─────────────────────────────────────────────────────
    fmt.addEventListener("change", function () {
      var d = fmt.value.split("x");
      state.w = parseFloat(d[0]);
      state.h = parseFloat(d[1]);
      save(); apply();
    });
    rot.addEventListener("change", function () {
      state.rotate = clean(rot.value); save(); apply();
    });
    function setCopies(n) {
      state.copies = Math.max(1, Math.min(50, n || 1));
      cop.value = state.copies;
      save(); apply();
    }
    cop.addEventListener("change", function () { setCopies(parseInt(cop.value, 10)); });
    document.getElementById("less").addEventListener("click", function () { setCopies(state.copies - 1); });
    document.getElementById("more").addEventListener("click", function () { setCopies(state.copies + 1); });

    var printBtn = document.getElementById("print");
    printBtn.addEventListener("click", function () { fitAll(); window.print(); });
    document.getElementById("close").addEventListener("click", function () { window.close(); });

    // Un rouleau hors liste (format retenu d'une autre session) : on l'ajoute
    // au menu plutôt que de le perdre au premier affichage.
    function syncControls() {
      var want = state.w + "x" + state.h;
      fmt.value = want;
      if (fmt.value !== want) {
        var o = document.createElement("option");
        o.value = want;
        o.textContent = state.w + " \\u00D7 " + state.h + " mm";
        fmt.appendChild(o);
        fmt.value = want;
      }
      rot.value = String(state.rotate);
      cop.value = state.copies;
    }

    syncControls();
    apply();

    // Les polices arrivent parfois après le premier calcul : on remesure une
    // fois qu'elles sont là, puis encore juste avant l'impression — sinon un
    // nom mesuré en police de secours déborde sur le papier.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
    window.addEventListener("beforeprint", fitAll);

    // Le dialogue ne s'ouvre plus tout seul : il se posait par-dessus les
    // réglages, donc par-dessus le seul endroit où corriger un mauvais sens.
    // Le bouton prend le focus — une touche Entrée et l'étiquette part.
    window.addEventListener("load", function () {
      fitAll();
      window.focus();
      printBtn.focus();
    });
  })();
  </script>
</body></html>`;
}
