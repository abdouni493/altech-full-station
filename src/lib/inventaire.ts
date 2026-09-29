/**
 * ─── Inventaire physique — comparaison, correction et pertes ───────────────────
 *
 * Un inventaire répond à une seule question : « ce que j'ai en rayon
 * correspond-il à ce que l'application annonce ? ». Ce fichier tient toute la
 * logique de cette confrontation, sans une ligne de React, pour qu'elle soit la
 * MÊME partout — écran d'inventaire, rapports généraux et paie des employés.
 *
 * Le vocabulaire, une fois pour toutes :
 *   • DÉCALAGE (`ecart`) = compté − application.
 *   • Décalage NÉGATIF  → il manque de la marchandise : c'est une PERTE, et
 *     c'est elle qui peut être imputée aux employés de la partie.
 *   • Décalage POSITIF  → il y en a plus que prévu : un GAIN (erreur de saisie,
 *     réception jamais enregistrée, retour non pointé…).
 *
 * Tout est valorisé au PRIX D'ACHAT du produit, jamais au prix de vente : une
 * marchandise manquante coûte ce qu'elle a coûté, pas ce qu'elle aurait rapporté.
 *
 * La CORRECTION aligne le stock de l'application sur le comptage. Elle est
 * irréversible pour l'utilisateur, donc elle prend d'abord une SAUVEGARDE des
 * quantités d'avant : `restoreBackupLines` sait les remettre en place.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizInventaire, BizInventaireBackupLine, BizInventaireComparison, BizInventaireEcart,
  BizInventaireLine, BizProduct, ModuleState, roundQty,
} from './bizConfig';

/** Quantité comptée d'une ligne, en unités principales (celles du stock). */
export function countedQtyOf(line: BizInventaireLine): number {
  if (line.sellByDetail && line.detailCapacity && line.detailCapacity > 0 && line.detailQty !== undefined) {
    return roundQty((Number(line.detailQty) || 0) / line.detailCapacity);
  }
  return roundQty(Number(line.countedQty) || 0);
}

/** Libellé de la quantité comptée — « 10 L sur un bidon de 50 L » se lit ainsi. */
export function countedLabelOf(line: BizInventaireLine): string {
  const main = countedQtyOf(line);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  if (line.sellByDetail && line.detailQty !== undefined && line.detailCapacity) {
    return `${fmt(Number(line.detailQty) || 0)} ${line.detailUnit || 'L'} (${fmt(main)} ${line.unit || 'unité'})`;
  }
  return `${fmt(main)} ${line.unit || ''}`.trim();
}

/**
 * Confronte un comptage au stock ACTUEL de l'application.
 *
 * Le stock est relu au moment de la comparaison, jamais celui figé à la saisie :
 * entre le comptage et la confrontation, des ventes ont pu passer, et c'est bien
 * l'état du jour qu'il faut corriger.
 *
 * Un produit disparu du catalogue depuis le comptage est traité comme un stock à
 * zéro : tout ce qui a été compté est alors un « gain » qui saute aux yeux — ce
 * qui est exactement ce qu'on veut voir dans ce cas-là.
 */
export function buildComparison(
  inv: Pick<BizInventaire, 'lines'>,
  products: BizProduct[],
  by?: string,
): BizInventaireComparison {
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [p.name, p]));

  const lines: BizInventaireEcart[] = (inv.lines || []).map(l => {
    const prod = byId.get(l.productId) || byName.get(l.productName);
    const counted = countedQtyOf(l);
    const systemQty = roundQty(prod ? Number(prod.currentQty) || 0 : 0);
    const ecart = roundQty(counted - systemQty);
    const purchasePrice = Number(prod?.purchasePrice ?? l.purchasePrice) || 0;
    return {
      productId: prod?.id || l.productId,
      productName: prod?.name || l.productName,
      categoryName: prod?.categoryName || l.categoryName,
      unit: prod?.unit || l.unit,
      countedQty: counted,
      systemQty,
      ecart,
      purchasePrice,
      value: roundQty(ecart * purchasePrice),
      kind: ecart < 0 ? 'perte' : ecart > 0 ? 'gain' : 'exact',
    };
  });

  const losses = lines.filter(l => l.kind === 'perte');
  const gains = lines.filter(l => l.kind === 'gain');
  const lossQty = roundQty(losses.reduce((s, l) => s - l.ecart, 0));
  const lossValue = roundQty(losses.reduce((s, l) => s - l.value, 0));
  const gainQty = roundQty(gains.reduce((s, l) => s + l.ecart, 0));
  const gainValue = roundQty(gains.reduce((s, l) => s + l.value, 0));

  return {
    at: new Date().toISOString(),
    by,
    lines,
    lossQty, lossValue, gainQty, gainValue,
    netValue: roundQty(gainValue - lossValue),
    productsCounted: lines.length,
    productsWithEcart: losses.length + gains.length,
  };
}

/**
 * Sauvegarde des quantités AVANT correction — prise juste avant d'écrire, sur
 * les produits réellement concernés par un écart.
 */
export function buildBackup(
  comparison: BizInventaireComparison,
  products: BizProduct[],
): { at: string; lines: BizInventaireBackupLine[] } {
  const byId = new Map(products.map(p => [p.id, p]));
  const lines: BizInventaireBackupLine[] = comparison.lines
    .filter(l => l.ecart !== 0)
    .map(l => {
      const p = byId.get(l.productId);
      return {
        productId: l.productId,
        productName: p?.name || l.productName,
        currentQty: roundQty(Number(p?.currentQty) || 0),
        principalQty: roundQty(Number(p?.principalQty) || 0),
      };
    });
  return { at: new Date().toISOString(), lines };
}

/** Ce qu'une correction va écrire, produit par produit — calculé, rien d'écrit. */
export interface CorrectionDelta {
  product: BizProduct;
  before: number;
  after: number;
  ecart: number;
  value: number;
  kind: 'perte' | 'gain';
}

export function correctionDeltas(
  comparison: BizInventaireComparison,
  products: BizProduct[],
): CorrectionDelta[] {
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [p.name, p]));
  const out: CorrectionDelta[] = [];
  for (const l of comparison.lines) {
    if (l.ecart === 0) continue;
    const product = byId.get(l.productId) || byName.get(l.productName);
    if (!product) continue;   // produit supprimé du catalogue : rien à corriger
    out.push({
      product,
      before: roundQty(Number(product.currentQty) || 0),
      after: roundQty(l.countedQty),
      ecart: l.ecart,
      value: l.value,
      kind: l.ecart < 0 ? 'perte' : 'gain',
    });
  }
  return out;
}

/**
 * Aligne le stock de l'application sur le comptage.
 *
 * Le reste en stock (`currentQty`) prend la quantité COMPTÉE — c'est le rayon
 * qui fait foi. Le cumul reçu (`principalQty`) suit le même mouvement mais ne
 * descend jamais sous le nouveau reste : il représente ce qui est entré, il
 * n'aurait aucun sens en dessous de ce qui reste.
 */
export function applyCorrection(
  deltas: CorrectionDelta[],
  update: (coll: 'products', item: BizProduct) => void,
) {
  for (const d of deltas) {
    const principal = d.ecart > 0
      ? roundQty(Math.max(d.product.principalQty, d.after))
      : roundQty(Math.max(d.after, d.product.principalQty + d.ecart));
    update('products', { ...d.product, currentQty: d.after, principalQty: principal });
  }
}

/** Remet les quantités d'avant une correction — le retour en arrière. */
export function restoreBackupLines(
  backup: { lines: BizInventaireBackupLine[] } | undefined,
  products: BizProduct[],
  update: (coll: 'products', item: BizProduct) => void,
): number {
  if (!backup?.lines?.length) return 0;
  const byId = new Map(products.map(p => [p.id, p]));
  let restored = 0;
  for (const b of backup.lines) {
    const p = byId.get(b.productId);
    if (!p) continue;
    update('products', { ...p, currentQty: b.currentQty, principalQty: b.principalQty });
    restored++;
  }
  return restored;
}

/** Phrase de confirmation listant ce que la correction va écrire. */
export function describeCorrection(deltas: CorrectionDelta[]): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return deltas.map(d => {
    const sign = d.ecart < 0 ? '−' : '+';
    return `• ${d.product.name} : ${fmt(d.before)} → ${fmt(d.after)} ${d.product.unit || ''}`.trimEnd()
      + `   (${sign}${fmt(Math.abs(d.ecart))}, ${d.kind === 'perte' ? 'manquant' : 'surplus'})`;
  }).join('\n');
}

// ─── Vue d'ensemble des inventaires d'une partie ──────────────────────────────

export interface InventaireSummary {
  key: string;
  label: string;
  emoji: string;
  inventaires: BizInventaire[];
  /** Comptages terminés mais jamais comparés. */
  pendingComparison: number;
  compared: number;
  corrected: number;
  drafts: number;
  lossValue: number;
  gainValue: number;
  netValue: number;
  /** Pertes des inventaires IMPUTABLES aux employés (mattering activé). */
  chargeableLossValue: number;
}

export function summarizeInventaires(
  state: Pick<ModuleState, 'inventaires'>,
  key: string, label: string, emoji: string,
): InventaireSummary {
  const inventaires = [...(state.inventaires || [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const withComparison = inventaires.filter(i => !!i.comparison);
  return {
    key, label, emoji, inventaires,
    drafts: inventaires.filter(i => i.status === 'draft').length,
    pendingComparison: inventaires.filter(i => i.status === 'completed').length,
    compared: inventaires.filter(i => i.status === 'compared').length,
    corrected: inventaires.filter(i => i.status === 'corrected').length,
    lossValue: roundQty(withComparison.reduce((s, i) => s + (i.comparison!.lossValue || 0), 0)),
    gainValue: roundQty(withComparison.reduce((s, i) => s + (i.comparison!.gainValue || 0), 0)),
    netValue: roundQty(withComparison.reduce((s, i) => s + (i.comparison!.netValue || 0), 0)),
    chargeableLossValue: roundQty(withComparison
      .filter(i => i.chargeWorkers !== false)
      .reduce((s, i) => s + (i.comparison!.lossValue || 0), 0)),
  };
}

/**
 * Inventaires à proposer dans l'écran de paie d'un employé « concerné par les
 * inventaires » : ceux qui ont un décalage manquant, dont l'imputation est
 * activée, qui ne sont pas déjà réglés par un paiement, et que l'utilisateur n'a
 * pas écartés pour cet employé.
 */
export function chargeableInventairesFor(
  inventaires: BizInventaire[],
  opts: { settledIds?: string[]; dismissedIds?: string[] } = {},
): BizInventaire[] {
  const settled = new Set(opts.settledIds || []);
  const dismissed = new Set(opts.dismissedIds || []);
  return inventaires
    .filter(i => !!i.comparison && i.chargeWorkers !== false)
    .filter(i => (i.comparison!.lossValue || 0) > 0)
    .filter(i => !settled.has(i.id) && !dismissed.has(i.id))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Montant réellement retenu sur un salaire au titre des inventaires.
 * `percent` prend une part du total des manquants, `amount` est une somme fixe.
 * La retenue ne dépasse jamais le total des manquants sélectionnés.
 */
export function inventoryDeduction(
  lossTotal: number,
  active: boolean,
  type: 'percent' | 'amount',
  value: number,
): number {
  if (!active || lossTotal <= 0) return 0;
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  const raw = type === 'percent' ? (lossTotal * Math.min(v, 100)) / 100 : v;
  return roundQty(Math.max(0, Math.min(lossTotal, raw)));
}
