/**
 * ─── LE QR CODE, FABRIQUÉ SUR PLACE ───────────────────────────────────────────
 *
 * La station affiche des adresses : le lien du suivi client, un formulaire, un
 * numéro. Les recopier au clavier depuis une affiche, c'est une faute de frappe
 * sur deux. D'où ce module : une adresse entre, un carré noir et blanc sort —
 * imprimable, collable sur la pompe ou le comptoir.
 *
 * Pourquoi l'écrire plutôt que l'installer :
 *
 *   • un générateur en ligne (api.qrserver, chart.google) envoie l'adresse de
 *     la station à un tiers, et ne répond plus quand la connexion tombe. Le
 *     poste du comptoir travaille souvent sans internet ;
 *   • le QR de WhatsApp, lui, arrive de la passerelle en base64 : ce n'est pas
 *     un générateur, c'est une image reçue. Rien à réutiliser de ce côté.
 *
 * Le module ne connaît ni le DOM ni React : il rend une matrice de booléens
 * (`true` = module sombre) et, si on veut, du SVG. Le PNG se dessine ailleurs,
 * là où il y a un canvas. Donc il se teste — et il l'est : `qrcode.test.ts`
 * RELIT le symbole produit, comme le ferait un téléphone, et vérifie qu'il
 * retrouve l'adresse de départ.
 *
 * Ce qui est couvert : le mode OCTETS (UTF-8), les versions 1 à 40, les quatre
 * niveaux de correction, les huit masques départagés par pénalité — soit tout
 * ce qu'une adresse demande. Les modes numérique et alphanumérique, qui ne
 * gagneraient que quelques modules sur une URL, ne sont pas implémentés.
 *
 *   npx tsx src/lib/qrcode.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */

/** Niveau de correction d'erreur : L ≈ 7 %, M ≈ 15 %, Q ≈ 25 %, H ≈ 30 % du symbole récupérable. */
export type EcLevel = 'L' | 'M' | 'Q' | 'H';

/** Les quatre niveaux, du plus léger au plus robuste, tels qu'on les propose à l'écran. */
export const EC_LEVELS: { value: EcLevel; label: string; hint: string }[] = [
  { value: 'L', label: 'L — 7 %', hint: 'Le plus petit symbole. Écran, PDF, rien qui ne s\'abîme.' },
  { value: 'M', label: 'M — 15 %', hint: 'Le réglage courant : lisible même un peu sali.' },
  { value: 'Q', label: 'Q — 25 %', hint: 'Affiche exposée, autocollant sur une pompe.' },
  { value: 'H', label: 'H — 30 %', hint: 'Le plus robuste, et le plus dense : reste lisible troué.' },
];

/** Un symbole fini : sa version (1 à 40), son côté en modules, et la matrice. */
export interface QrCode {
  /** 1 à 40. Détermine la taille : `size = version * 4 + 17`. */
  version: number;
  /** Côté du symbole, en modules (marge non comprise). */
  size: number;
  /** Niveau de correction réellement utilisé (il a pu être remonté, voir `encodeQr`). */
  ecLevel: EcLevel;
  /** Masque retenu, 0 à 7. */
  mask: number;
  /** `modules[y][x]` — `true` = module sombre. */
  modules: boolean[][];
}

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Codets de correction PAR BLOC, indexés [niveau][version]. Tables de la norme ISO/IEC 18004. */
const ECC_CODEWORDS_PER_BLOCK: Record<EcLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Nombre de blocs de correction, indexés [niveau][version]. */
const NUM_ERROR_CORRECTION_BLOCKS: Record<EcLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 5, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** Les deux bits que le champ « format » réserve à chaque niveau (ce n'est PAS l'ordre L < M < Q < H). */
const EC_FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Les quatre niveaux du plus léger au plus robuste — sert à remonter le niveau quand la place le permet. */
const EC_ORDER: EcLevel[] = ['L', 'M', 'Q', 'H'];

// Pénalités de la norme, pour départager les huit masques.
const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

/** Multiplication dans GF(2⁸), polynôme primitif 0x11D. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xFF;
}

/** Polynôme générateur de Reed-Solomon de degré `degree`, coefficients en ordre décroissant. */
export function rsDivisor(degree: number): number[] {
  if (degree < 1 || degree > 255) throw new RangeError('Degré de correction hors bornes.');
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1; // le polynôme constant 1
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** Codets de correction d'un bloc de données. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

/** Modules disponibles pour les données ET la correction, avant découpage en codets. */
function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36; // les deux blocs d'information de version
  }
  return result;
}

/** Nombre de codets de DONNÉES (correction déduite) d'une version à un niveau donné. */
export function numDataCodewords(ver: number, ecl: EcLevel): number {
  return Math.floor(numRawDataModules(ver) / 8)
    - ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
}

/** Taille du champ « longueur » en mode octets : 8 bits jusqu'à la version 9, 16 ensuite. */
export function byteModeCountBits(ver: number): number {
  return ver <= 9 ? 8 : 16;
}

/** Bits nécessaires pour loger `len` octets dans une version donnée, en-tête compris. */
function byteModeBits(len: number, ver: number): number {
  return 4 + byteModeCountBits(ver) + 8 * len;
}

/** Texte → octets UTF-8, sans dépendre de `TextEncoder` (le module doit tourner partout). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xC0 | (cp >>> 6), 0x80 | (cp & 0x3F));
    else if (cp < 0x10000) out.push(0xE0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3F), 0x80 | (cp & 0x3F));
    else out.push(0xF0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 0x3F), 0x80 | ((cp >>> 6) & 0x3F), 0x80 | (cp & 0x3F));
  }
  return out;
}

/** Octets UTF-8 → texte. Sert au décodage (les tests) autant qu'au reste. */
export function utf8Decode(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let cp: number, len: number;
    if (b < 0x80) { cp = b; len = 1; }
    else if ((b & 0xE0) === 0xC0) { cp = b & 0x1F; len = 2; }
    else if ((b & 0xF0) === 0xE0) { cp = b & 0x0F; len = 3; }
    else { cp = b & 0x07; len = 4; }
    for (let j = 1; j < len; j++) cp = (cp << 6) | (bytes[i + j] & 0x3F);
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

/**
 * Le découpage en blocs d'une version : combien de blocs, combien de codets de
 * correction chacun, et lesquels sont courts d'un codet.
 *
 * Exporté parce qu'un LECTEUR en a besoin autant qu'un graveur — c'est ce qui
 * permet aux tests de relire un symbole sans redire les tables de la norme.
 */
export function blockStructure(ver: number, ecl: EcLevel): {
  numBlocks: number; blockEccLen: number; rawCodewords: number; numShortBlocks: number; shortBlockLen: number;
} {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  return {
    numBlocks,
    blockEccLen,
    rawCodewords,
    numShortBlocks: numBlocks - (rawCodewords % numBlocks),
    shortBlockLen: Math.floor(rawCodewords / numBlocks),
  };
}

/** Découpe les codets en blocs, ajoute la correction, puis entrelace comme l'exige la norme. */
export function addEccAndInterleave(data: readonly number[], ver: number, ecl: EcLevel): number[] {
  if (data.length !== numDataCodewords(ver, ecl)) throw new RangeError('Longueur de données inattendue.');

  const { numBlocks, blockEccLen, numShortBlocks, shortBlockLen } = blockStructure(ver, ecl);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0); // trou de bourrage, retiré à l'entrelacement
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/** Position des centres des motifs d'alignement, pour une version donnée. */
export function alignmentPatternPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Vaut `true` si le bit `i` (poids faible = 0) de `x` est à 1. */
const getBit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** Le symbole en cours de dessin : la matrice, plus la carte de ce qui n'est PAS des données. */
interface Canvas {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

function newCanvas(size: number): Canvas {
  const grid = (): boolean[][] => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: grid(), isFunction: grid() };
}

function setFunctionModule(c: Canvas, x: number, y: number, isDark: boolean): void {
  c.modules[y][x] = isDark;
  c.isFunction[y][x] = true;
}

function drawFinderPattern(c: Canvas, x: number, y: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy)); // distance de Tchebychev
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < c.size && yy >= 0 && yy < c.size) {
        setFunctionModule(c, xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }
}

function drawAlignmentPattern(c: Canvas, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunctionModule(c, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/** Les 15 bits du champ « format » : niveau de correction + masque + BCH(15,5). */
function drawFormatBits(c: Canvas, ecl: EcLevel, mask: number): void {
  const data = (EC_FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  // Première copie, autour du repère haut-gauche.
  for (let i = 0; i <= 5; i++) setFunctionModule(c, 8, i, getBit(bits, i));
  setFunctionModule(c, 8, 7, getBit(bits, 6));
  setFunctionModule(c, 8, 8, getBit(bits, 7));
  setFunctionModule(c, 7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFunctionModule(c, 14 - i, 8, getBit(bits, i));

  // Seconde copie, répartie sur les deux autres repères.
  for (let i = 0; i < 8; i++) setFunctionModule(c, c.size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setFunctionModule(c, 8, c.size - 15 + i, getBit(bits, i));
  setFunctionModule(c, 8, c.size - 8, true); // le module toujours sombre
}

/** Les 18 bits d'information de version, à partir de la version 7. */
function drawVersionBits(c: Canvas, ver: number): void {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const color = getBit(bits, i);
    const a = c.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(c, a, b, color);
    setFunctionModule(c, b, a, color);
  }
}

function drawFunctionPatterns(c: Canvas, ver: number, ecl: EcLevel): void {
  // Bandes de synchronisation.
  for (let i = 0; i < c.size; i++) {
    setFunctionModule(c, 6, i, i % 2 === 0);
    setFunctionModule(c, i, 6, i % 2 === 0);
  }
  // Les trois repères de coin (le séparateur clair vient du dessin lui-même).
  drawFinderPattern(c, 3, 3);
  drawFinderPattern(c, c.size - 4, 3);
  drawFinderPattern(c, 3, c.size - 4);

  // Motifs d'alignement, sauf ceux qui tomberaient sur un repère de coin.
  const pos = alignmentPatternPositions(ver);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      drawAlignmentPattern(c, pos[i], pos[j]);
    }
  }

  drawFormatBits(c, ecl, 0); // valeur provisoire : le masque n'est pas encore choisi
  drawVersionBits(c, ver);
}

/** Pose les codets en zigzag, du coin bas-droit vers le haut-gauche. */
function drawCodewords(c: Canvas, data: readonly number[]): void {
  let i = 0; // position en BITS
  for (let right = c.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // la colonne 6 est une bande de synchronisation
    for (let vert = 0; vert < c.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? c.size - 1 - vert : vert;
        if (!c.isFunction[y][x] && i < data.length * 8) {
          c.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

/** Applique — ou retire, l'opération est son propre inverse — l'un des huit masques. */
function applyMask(c: Canvas, mask: number): void {
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: throw new RangeError('Masque inconnu.');
      }
      if (!c.isFunction[y][x] && invert) c.modules[y][x] = !c.modules[y][x];
    }
  }
}

function finderPenaltyCountPatterns(runHistory: readonly number[]): number {
  const n = runHistory[1];
  const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
  return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
    + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
}

function finderPenaltyAddHistory(runLength: number, runHistory: number[], size: number): void {
  if (runHistory[0] === 0) runLength += size; // la marge claire compte comme du blanc
  runHistory.pop();
  runHistory.unshift(runLength);
}

function finderPenaltyTerminate(runColor: boolean, runLength: number, runHistory: number[], size: number): number {
  if (runColor) { // une plage sombre en fin de ligne : on la referme
    finderPenaltyAddHistory(runLength, runHistory, size);
    runLength = 0;
  }
  runLength += size; // la marge claire de l'autre côté
  finderPenaltyAddHistory(runLength, runHistory, size);
  return finderPenaltyCountPatterns(runHistory);
}

/** Score de laideur d'un masque : plus il est bas, mieux le symbole se lit. */
function penaltyScore(c: Canvas): number {
  let result = 0;
  const size = c.size;

  // Plages monochromes et motifs qui imitent un repère de coin — en lignes, puis en colonnes.
  for (let y = 0; y < size; y++) {
    let runColor = false, runLen = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      if (c.modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) result += PENALTY_N1;
        else if (runLen > 5) result++;
      } else {
        finderPenaltyAddHistory(runLen, history, size);
        if (!runColor) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
        runColor = c.modules[y][x];
        runLen = 1;
      }
    }
    result += finderPenaltyTerminate(runColor, runLen, history, size) * PENALTY_N3;
  }
  for (let x = 0; x < size; x++) {
    let runColor = false, runLen = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      if (c.modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) result += PENALTY_N1;
        else if (runLen > 5) result++;
      } else {
        finderPenaltyAddHistory(runLen, history, size);
        if (!runColor) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
        runColor = c.modules[y][x];
        runLen = 1;
      }
    }
    result += finderPenaltyTerminate(runColor, runLen, history, size) * PENALTY_N3;
  }

  // Carrés 2 × 2 d'une seule couleur.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = c.modules[y][x];
      if (color === c.modules[y][x + 1] && color === c.modules[y + 1][x] && color === c.modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  // Déséquilibre entre sombre et clair.
  let dark = 0;
  for (const row of c.modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

/** Options de fabrication d'un symbole. */
export interface EncodeOptions {
  /** Niveau de correction souhaité — plancher si `boost` est actif. Défaut : `M`. */
  ecLevel?: EcLevel;
  /**
   * Remonte le niveau de correction tant que le symbole ne grandit pas.
   * Gratuit en place, gagné en robustesse : actif par défaut.
   */
  boost?: boolean;
  /** Force un masque 0-7 au lieu de prendre le moins pénalisé (sert aux tests). */
  mask?: number;
}

/**
 * Fabrique le symbole d'un texte — une adresse, en pratique.
 *
 * Lève si le texte ne tient dans aucune version : au-delà, ce n'est plus un QR
 * code qu'il faut, c'est un lien plus court.
 */
export function encodeQr(text: string, opts: EncodeOptions = {}): QrCode {
  const wanted: EcLevel = opts.ecLevel ?? 'M';
  const boost = opts.boost !== false;
  const data = utf8Bytes(text);
  if (data.length === 0) throw new RangeError('Rien à encoder.');

  // La plus petite version qui accepte les données au niveau demandé.
  let version = 0;
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    if (byteModeBits(data.length, v) <= numDataCodewords(v, wanted) * 8) { version = v; break; }
  }
  if (version === 0) {
    throw new RangeError(`Adresse trop longue pour un QR code (${data.length} octets au niveau ${wanted}).`);
  }

  // À version égale, un niveau plus haut ne coûte rien : on le prend.
  let ecLevel = wanted;
  if (boost) {
    for (const lvl of EC_ORDER.slice(EC_ORDER.indexOf(wanted) + 1)) {
      if (byteModeBits(data.length, version) <= numDataCodewords(version, lvl) * 8) ecLevel = lvl;
    }
  }

  // Flux de bits : en-tête de mode, longueur, données, terminateur, bourrage.
  const bits: number[] = [];
  const appendBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  appendBits(0b0100, 4);                               // mode octets
  appendBits(data.length, byteModeCountBits(version)); // longueur
  for (const b of data) appendBits(b, 8);

  const capacityBits = numDataCodewords(version, ecLevel) * 8;
  appendBits(0, Math.min(4, capacityBits - bits.length)); // terminateur
  appendBits(0, (8 - (bits.length % 8)) % 8);             // alignement sur l'octet
  for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

  const codewords = new Array<number>(bits.length / 8).fill(0);
  bits.forEach((bit, i) => { codewords[i >>> 3] |= bit << (7 - (i & 7)); });

  // Dessin.
  const size = version * 4 + 17;
  const canvas = newCanvas(size);
  drawFunctionPatterns(canvas, version, ecLevel);
  drawCodewords(canvas, addEccAndInterleave(codewords, version, ecLevel));

  // Le masque : celui qu'on impose, sinon le moins pénalisé des huit.
  let mask = opts.mask ?? -1;
  if (mask === -1) {
    let minPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(canvas, m);
      drawFormatBits(canvas, ecLevel, m);
      const p = penaltyScore(canvas);
      if (p < minPenalty) { mask = m; minPenalty = p; }
      applyMask(canvas, m); // le masque est son propre inverse
    }
  }
  applyMask(canvas, mask);
  drawFormatBits(canvas, ecLevel, mask);

  return { version, size, ecLevel, mask, modules: canvas.modules };
}

/** Options de rendu SVG. */
export interface SvgOptions {
  /** Côté d'un module, en unités SVG. Défaut : 8. */
  scale?: number;
  /** Marge claire autour du symbole, en modules. La norme en demande 4 : n'y touchez qu'en connaissance de cause. */
  margin?: number;
  /** Couleur des modules sombres. Défaut : noir. */
  dark?: string;
  /** Fond. `null` pour un SVG transparent. Défaut : blanc. */
  light?: string | null;
}

/** Le tracé des modules sombres, en coordonnées « modules » (un module = 1 unité). */
export function qrPath(qr: QrCode, margin = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    }
  }
  return parts.join('');
}

/** Le symbole en SVG autonome : ce qui se télécharge, s'imprime, et ne pixellise jamais. */
export function qrSvg(qr: QrCode, opts: SvgOptions = {}): string {
  const scale = opts.scale ?? 8;
  const margin = opts.margin ?? 4;
  const dark = opts.dark ?? '#000000';
  const light = opts.light === undefined ? '#FFFFFF' : opts.light;
  const side = qr.size + margin * 2;
  const px = side * scale;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">`,
    light ? `<rect width="${side}" height="${side}" fill="${light}"/>` : '',
    `<path d="${qrPath(qr, margin)}" fill="${dark}"/>`,
    '</svg>',
  ].filter(Boolean).join('\n');
}
