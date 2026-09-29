/**
 * ─── Ce que ces cas protègent ─────────────────────────────────────────────────
 *
 * Un QR code faux ne se voit pas : il ressemble trait pour trait à un QR code
 * juste. On ne s'en aperçoit qu'au comptoir, téléphone en main, devant une
 * affiche déjà imprimée et collée.
 *
 * Le cœur du fichier est donc un LECTEUR : il reprend la matrice produite,
 * retrouve le niveau de correction et le masque dans le champ « format », défait
 * le masque, relit les modules en zigzag, désentrelace les blocs, VÉRIFIE que le
 * reste de Reed-Solomon de chaque bloc est nul — un lecteur réel s'en sert pour
 * corriger, ici il sert de preuve — puis rend le texte. Exactement le chemin que
 * suit l'appareil photo d'un client.
 *
 * S'y ajoute ce qu'un aller-retour ne peut pas prouver tout seul, parce qu'une
 * erreur symétrique passerait des deux côtés :
 *
 *   • le vecteur Reed-Solomon publié de « HELLO WORLD » (version 1-M) : si le
 *     corps de Galois était faux, le reste ne tomberait pas sur ces dix octets ;
 *   • les capacités de la norme (versions 1 et 40, quatre niveaux) : une table
 *     recopiée de travers déplacerait tout le reste sans bruit ;
 *   • la position des motifs d'alignement, comparée à la table publiée.
 *
 *   npx tsx src/lib/qrcode.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  encodeQr, qrSvg, qrPath, rsDivisor, rsRemainder, numDataCodewords, blockStructure,
  alignmentPatternPositions, byteModeCountBits, utf8Bytes, utf8Decode, EC_LEVELS,
  type EcLevel, type QrCode,
} from './qrcode';

let passed = 0, failed = 0;
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n      attendu : ${JSON.stringify(want)}\n      obtenu  : ${JSON.stringify(got)}`); }
};
const checkThrows = (label: string, fn: () => unknown) => {
  try { fn(); failed++; console.log(`  ✗ ${label} — aucune erreur levée`); }
  catch { passed++; console.log(`  ✓ ${label}`); }
};

// ─── LE LECTEUR ───────────────────────────────────────────────────────────────
// Écrit à l'envers du graveur, et sans lui emprunter autre chose que les tables
// de la norme : ce qu'il retrouve, un téléphone le retrouve aussi.

/** Les modules qui ne portent PAS de données : repères, séparateurs, synchro, alignement, format, version. */
function functionMap(size: number, version: number): boolean[][] {
  const f: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => { if (x >= 0 && x < size && y >= 0 && y < size) f[y][x] = true; };

  // Les trois coins, séparateurs et zones de format compris.
  const zones: [number, number, number, number][] = [
    [0, 0, 9, 9],
    [size - 8, 0, 8, 9],
    [0, size - 8, 9, 8],
  ];
  for (const [x0, y0, w, h] of zones) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) mark(x0 + dx, y0 + dy);
  }
  // Bandes de synchronisation.
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // Motifs d'alignement, hors coins.
  const pos = alignmentPatternPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(pos[i] + dx, pos[j] + dy);
    }
  }
  // Information de version.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      mark(a, b); mark(b, a);
    }
  }
  return f;
}

/** Relit le champ « format » : niveau de correction et masque, tels qu'un lecteur les voit. */
function readFormat(modules: boolean[][]): { ecLevel: EcLevel; mask: number } {
  const size = modules.length;
  const bit = (x: number, y: number, i: number) => (modules[y][x] ? 1 : 0) << i;
  let raw = 0;
  for (let i = 0; i <= 5; i++) raw |= bit(8, i, i);
  raw |= bit(8, 7, 6);
  raw |= bit(8, 8, 7);
  raw |= bit(7, 8, 8);
  for (let i = 9; i < 15; i++) raw |= bit(14 - i, 8, i);

  // La seconde copie doit dire la même chose, sinon le symbole est incohérent.
  let copy = 0;
  for (let i = 0; i < 8; i++) copy |= bit(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) copy |= bit(8, size - 15 + i, i);
  if (raw !== copy) throw new Error('Les deux copies du format se contredisent.');

  const bits = raw ^ 0x5412;
  const data = bits >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  if ((((data << 10) | rem) & 0x7FFF) !== bits) throw new Error('Format illisible (BCH invalide).');

  const ecl = (['M', 'L', 'H', 'Q'] as EcLevel[])[data >>> 3];
  return { ecLevel: ecl, mask: data & 7 };
}

/** Défait le masque sur les modules de données. */
function unmask(modules: boolean[][], isFunction: boolean[][], mask: number): boolean[][] {
  const size = modules.length;
  const out = modules.map(row => row.slice());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) out[y][x] = !out[y][x];
    }
  }
  return out;
}

/** Le texte contenu dans un symbole — le chemin complet, du module au caractère. */
function decodeQr(qr: QrCode): { text: string; ecLevel: EcLevel; mask: number } {
  const size = qr.size;
  const version = (size - 17) / 4;
  const isFunction = functionMap(size, version);
  const { ecLevel, mask } = readFormat(qr.modules);
  const plain = unmask(qr.modules, isFunction, mask);

  // Relecture en zigzag → flux de codets entrelacés.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x]) bits.push(plain[y][x] ? 1 : 0);
      }
    }
  }
  const { numBlocks, blockEccLen, rawCodewords, numShortBlocks, shortBlockLen } = blockStructure(version, ecLevel);
  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length && stream.length < rawCodewords; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    stream.push(v);
  }

  // Désentrelacement : l'ordre inverse de celui du graveur, trou de bourrage compris.
  const blocks: number[][] = Array.from({ length: numBlocks }, () => new Array<number>(shortBlockLen + 1).fill(-1));
  let k = 0;
  for (let i = 0; i < shortBlockLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) blocks[j][i] = stream[k++];
    }
  }
  for (let j = 0; j < numShortBlocks; j++) blocks[j].splice(shortBlockLen - blockEccLen, 1);

  // Chaque bloc doit être un mot de code valide : son reste de Reed-Solomon est nul.
  const divisor = rsDivisor(blockEccLen);
  const data: number[] = [];
  blocks.forEach((block, j) => {
    if (rsRemainder(block, divisor).some(v => v !== 0)) {
      throw new Error(`Bloc ${j} corrompu : le reste de Reed-Solomon n'est pas nul.`);
    }
    data.push(...block.slice(0, block.length - blockEccLen));
  });

  // Lecture du segment : mode octets, longueur, contenu.
  let pos = 0;
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1);
    return v;
  };
  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`Mode inattendu : ${mode.toString(2)}`);
  const len = take(byteModeCountBits(version));
  const bytes: number[] = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { text: utf8Decode(bytes), ecLevel, mask };
}

// ─── LES CAS ──────────────────────────────────────────────────────────────────

console.log('\n── Corps de Galois et Reed-Solomon ──');
// Vecteur publié : « HELLO WORLD » en version 1-M donne ces codets de données…
const helloData = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
check('reste RS de « HELLO WORLD » (1-M)', rsRemainder(helloData, rsDivisor(10)),
  [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
check('un mot de code complet a un reste nul',
  rsRemainder(helloData.concat([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]), rsDivisor(10)),
  new Array(10).fill(0));
check('le générateur de degré 2 vaut x² + 3x + 2', rsDivisor(2), [3, 2]);

console.log('\n── Tables de la norme ──');
check('capacités version 1', (['L', 'M', 'Q', 'H'] as EcLevel[]).map(l => numDataCodewords(1, l)), [19, 16, 13, 9]);
check('capacités version 40', (['L', 'M', 'Q', 'H'] as EcLevel[]).map(l => numDataCodewords(40, l)), [2956, 2334, 1666, 1276]);
check('capacité version 10-Q', numDataCodewords(10, 'Q'), 154);
check('alignement version 1', alignmentPatternPositions(1), []);
check('alignement version 2', alignmentPatternPositions(2), [6, 18]);
check('alignement version 7', alignmentPatternPositions(7), [6, 22, 38]);
check('alignement version 20', alignmentPatternPositions(20), [6, 34, 62, 90]);
check('alignement version 32', alignmentPatternPositions(32), [6, 34, 60, 86, 112, 138]);
check('alignement version 40', alignmentPatternPositions(40), [6, 30, 58, 86, 114, 142, 170]);

console.log('\n── UTF-8 ──');
check('accents et symboles font l\'aller-retour', utf8Decode(utf8Bytes('Café — 25 DA ✓ محطة')), 'Café — 25 DA ✓ محطة');
check('une adresse ASCII fait un octet par caractère', utf8Bytes('https://a.dz').length, 12);

console.log('\n── Aller-retour : le symbole se relit ──');
const cases: { label: string; text: string; ecl: EcLevel }[] = [
  { label: 'adresse courte',            text: 'https://rclmc.dz', ecl: 'L' },
  { label: 'lien de suivi client',      text: 'https://station-rclmc-mosta.vercel.app/client?id=42', ecl: 'M' },
  { label: 'adresse accentuée',         text: 'https://rclmc.dz/reçu?station=Mostaganem&année=2026', ecl: 'Q' },
  { label: 'numéro de téléphone',       text: 'tel:+213555123456', ecl: 'H' },
  { label: 'lien WhatsApp',             text: 'https://wa.me/213555123456?text=Bonjour', ecl: 'M' },
  { label: 'adresse longue (v10+)',     text: 'https://station-rclmc-mosta.vercel.app/client?id=42&token=' + 'a1b2c3d4'.repeat(24), ecl: 'M' },
  { label: 'adresse très longue (v20+)', text: 'https://rclmc.dz/x?' + 'k=0123456789&'.repeat(60), ecl: 'L' },
];
for (const { label, text, ecl } of cases) {
  const qr = encodeQr(text, { ecLevel: ecl });
  const read = decodeQr(qr);
  check(`${label} — texte relu`, read.text, text);
  check(`${label} — format relu`, [read.ecLevel, read.mask], [qr.ecLevel, qr.mask]);
  check(`${label} — taille cohérente`, qr.size, qr.version * 4 + 17);
}

console.log('\n── Les huit masques se relisent tous ──');
for (let m = 0; m < 8; m++) {
  const qr = encodeQr('https://rclmc.dz/pompe/3', { ecLevel: 'M', mask: m });
  check(`masque ${m}`, [decodeQr(qr).text, qr.mask], ['https://rclmc.dz/pompe/3', m]);
}

console.log('\n── Version, niveau, bornes ──');
check('une adresse courte tient en version 1', encodeQr('https://rclmc.dz', { ecLevel: 'L', boost: false }).version, 1);
check('le niveau monte gratuitement quand la place reste', encodeQr('abc', { ecLevel: 'L' }).ecLevel, 'H');
check('sans « boost », le niveau demandé est respecté', encodeQr('abc', { ecLevel: 'L', boost: false }).ecLevel, 'L');
check('2953 octets tiennent en version 40-L', encodeQr('a'.repeat(2953), { ecLevel: 'L', boost: false }).version, 40);
checkThrows('2954 octets ne tiennent nulle part', () => encodeQr('a'.repeat(2954), { ecLevel: 'L' }));
checkThrows('un texte vide est refusé', () => encodeQr(''));
check('les quatre niveaux sont proposés à l\'écran', EC_LEVELS.map(l => l.value), ['L', 'M', 'Q', 'H']);

console.log('\n── Repères de coin, marge et SVG ──');
const sample = encodeQr('https://rclmc.dz', { ecLevel: 'M' });
check('le coin haut-gauche est un repère plein', sample.modules[0].slice(0, 7), [true, true, true, true, true, true, true]);
check('le repère est cerné de clair', sample.modules[7].slice(0, 8), new Array(8).fill(false));
check('le module toujours sombre est là', sample.modules[sample.size - 8][8], true);
const svg = qrSvg(sample, { scale: 10, margin: 4 });
const side = sample.size + 8;
check('le SVG annonce sa boîte', svg.includes(`viewBox="0 0 ${side} ${side}"`), true);
check('le SVG annonce ses pixels', svg.includes(`width="${side * 10}"`), true);
check('le SVG porte un fond blanc par défaut', svg.includes('fill="#FFFFFF"'), true);
check('sans fond, le SVG est transparent', qrSvg(sample, { light: null }).includes('<rect'), false);
check('le tracé décale bien de la marge', qrPath(sample, 4).startsWith('M4 4h1v1h-1z'), true);

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} cas passés, ${failed} en échec.\n`);
process.exit(failed === 0 ? 0 : 1);
