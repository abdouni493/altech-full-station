/**
 * ─── Coût moyen pondéré (CUMP) des produits ────────────────────────────────────
 * Quand le même produit est racheté à des prix différents, son coût de revient
 * n'est ni le premier prix payé ni le dernier : c'est la MOYENNE PONDÉRÉE PAR LES
 * QUANTITÉS de tout ce qui est encore en stock.
 *
 *   nouveau coût moyen = (stock précédent × coût moyen précédent
 *                         + quantité reçue × prix d'achat de la réception)
 *                        ÷ (stock précédent + quantité reçue)
 *
 * 100 unités à 100 DA puis 50 unités à 130 DA donnent 110 DA — jamais 115 DA,
 * qui serait la moyenne des deux prix sans tenir compte des quantités.
 *
 * ── Pourquoi cette option est facultative ──────────────────────────────────────
 * L'application a toujours écrasé `purchasePrice` avec le dernier prix payé.
 * Basculer tout le monde d'office changerait la valeur du stock, les marges du
 * point de vente et les rapports de toutes les parties, sans prévenir. La
 * fonction ne s'applique donc qu'aux achats dont l'utilisateur a coché l'option :
 * un achat sans le drapeau se comporte EXACTEMENT comme avant.
 *
 * ── Le stock négatif de cette application ──────────────────────────────────────
 * Le point de vente vend à découvert : `currentQty` peut être NÉGATIF. Une
 * moyenne pondérée sur une quantité négative n'a aucun sens (elle peut diverger
 * ou changer de signe), donc le stock précédent est ramené à 0 pour le CALCUL du
 * coût — la réception repart alors de son propre prix. La quantité réelle, elle,
 * garde sa valeur négative : c'est le stock qui se rattrape (−5 + 15 = 10).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizProduct, BizPurchase, BizLineItem } from './bizConfig';

/**
 * Arrondi monétaire au millième. Trois décimales couvrent les prix réellement
 * saisis dans la station (105,375 DA) tout en coupant la dérive binaire de la
 * virgule flottante : sans lui, (100×100 + 50×130) / 150 s'affiche parfois
 * 109,99999999999999.
 */
export const roundCost = (n: number): number =>
  Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;

/** Nombre exploitable, quelle que soit la saisie (vide, texte, NaN, ±∞). */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Coût moyen ACTUEL d'un produit.
 *
 * `averageCost` n'existe que sur les produits déjà passés par un achat au coût
 * moyen. Pour tous les autres — donc pour toutes les données existantes — le
 * repli est `purchasePrice`, le dernier prix payé : c'est la meilleure valeur
 * connue, et elle est exacte tant qu'il n'y a eu qu'un seul prix d'achat.
 */
export const effectiveAvgCost = (
  p: Pick<BizProduct, 'averageCost' | 'purchasePrice'>,
): number => roundCost(num(p.averageCost ?? p.purchasePrice));

/**
 * Photo du calcul au moment où une réception est validée. Elle est recopiée sur
 * la ligne d'achat pour que la facture reste lisible des années plus tard, même
 * après vingt autres achats : rouvrir un vieux bon ne recalcule JAMAIS rien.
 */
export interface AvgCostSnapshot {
  /** Stock avant la réception (peut être négatif : vente à découvert). */
  prevStockQty: number;
  /** Coût moyen avant la réception. */
  prevAvgCost: number;
  /** Quantité reçue par cette ligne. */
  purchaseQty: number;
  /** Prix d'achat unitaire payé au fournisseur sur cette ligne. */
  purchaseUnitCost: number;
  /** Valeur de la réception : quantité × prix unitaire. */
  purchaseTotalCost: number;
  /** Stock après la réception. */
  resultStockQty: number;
  /** Coût moyen après la réception. */
  resultAvgCost: number;
}

/**
 * Le calcul, seul et sans dépendance — c'est lui que vérifient les tests.
 *
 * `prevQty` négatif est traité comme 0 (voir l'en-tête du fichier) et une
 * quantité reçue nulle ou négative laisse le coût moyen intact : une ligne à 0
 * ne doit pas pouvoir effacer la valorisation d'un stock existant.
 */
export function weightedAverageCost(
  prevQty: number,
  prevAvgCost: number,
  addQty: number,
  addUnitCost: number,
): number {
  const q0 = Math.max(0, num(prevQty));
  const c0 = Math.max(0, num(prevAvgCost));
  const q1 = num(addQty);
  const c1 = Math.max(0, num(addUnitCost));

  // Rien n'entre en stock : la moyenne ne bouge pas.
  if (q1 <= 0) return roundCost(c0);
  // Stock parti de zéro (ou en négatif) : la réception fixe seule le coût.
  if (q0 <= 0) return roundCost(c1);

  return roundCost((q0 * c0 + q1 * c1) / (q0 + q1));
}

/**
 * Calcule ce qu'une ligne d'achat fait au coût moyen d'un produit, sans rien
 * écrire : la photo renvoyée sert à la fois à l'aperçu affiché pendant la
 * saisie et à ce qui sera figé sur la facture.
 */
export function snapshotFor(
  product: Pick<BizProduct, 'currentQty' | 'averageCost' | 'purchasePrice'>,
  qty: number,
  unitCost: number,
): AvgCostSnapshot {
  const prevStockQty = num(product.currentQty);
  const prevAvgCost = effectiveAvgCost(product);
  const purchaseQty = num(qty);
  const purchaseUnitCost = num(unitCost);

  return {
    prevStockQty,
    prevAvgCost,
    purchaseQty,
    purchaseUnitCost,
    purchaseTotalCost: roundCost(purchaseQty * purchaseUnitCost),
    resultStockQty: roundCost(prevStockQty + purchaseQty),
    resultAvgCost: weightedAverageCost(prevStockQty, prevAvgCost, purchaseQty, purchaseUnitCost),
  };
}

/** L'achat a-t-il été enregistré au coût moyen ? (absent ⇒ non, comme avant) */
export const usesAverageCost = (p: Pick<BizPurchase, 'useAverageCost'>): boolean =>
  !!p.useAverageCost;

/** La ligne porte-t-elle une photo de calcul exploitable ? */
export function lineSnapshot(it: BizLineItem): AvgCostSnapshot | null {
  if (it.resultAvgCost === undefined || it.prevAvgCost === undefined) return null;
  const purchaseQty = num(it.qty);
  const purchaseUnitCost = num(it.unitPrice);
  return {
    prevStockQty: num(it.prevStockQty),
    prevAvgCost: num(it.prevAvgCost),
    purchaseQty,
    purchaseUnitCost,
    purchaseTotalCost: roundCost(purchaseQty * purchaseUnitCost),
    resultStockQty: num(it.resultStockQty),
    resultAvgCost: num(it.resultAvgCost),
  };
}

/**
 * Annulation d'une réception au coût moyen.
 *
 * On retire du stock la VALEUR que cette réception y avait apportée, puis on
 * remet la moyenne sur ce qui reste :
 *
 *   valeur restante = stock actuel × coût moyen actuel − quantité × prix payé
 *   nouveau coût    = valeur restante ÷ (stock actuel − quantité)
 *
 * C'est la contrepartie exacte de l'ajout quand cet achat est le dernier ; quand
 * d'autres achats ont suivi, c'est la reprise standard d'un mouvement en moyenne
 * pondérée (on ne peut pas « défaire » une moyenne autrement sans rejouer tout
 * l'historique, ce que les ventes intercalées rendraient de toute façon faux).
 *
 * Deux garde-fous ramènent au coût moyen d'AVANT l'achat plutôt que d'inventer
 * une valeur : plus rien en stock après la reprise, ou valeur restante négative
 * (marchandise déjà vendue à un coût plus élevé).
 */
export function reverseAverageCost(
  currentQty: number,
  currentAvgCost: number,
  snap: Pick<AvgCostSnapshot, 'purchaseQty' | 'purchaseUnitCost' | 'prevAvgCost'>,
): { qty: number; avgCost: number } {
  const qty = roundCost(num(currentQty) - num(snap.purchaseQty));
  const remainingValue =
    num(currentQty) * num(currentAvgCost) - num(snap.purchaseQty) * num(snap.purchaseUnitCost);

  if (qty <= 0 || remainingValue < 0) {
    return { qty, avgCost: roundCost(Math.max(0, num(snap.prevAvgCost))) };
  }
  return { qty, avgCost: roundCost(remainingValue / qty) };
}

/**
 * Écrit sur une ligne d'achat la photo du calcul. Les champs restent optionnels
 * dans le modèle : une ligne enregistrée sans l'option (ou avant son existence)
 * ne porte rien et s'affiche comme avant.
 */
export function stampLine(it: BizLineItem, snap: AvgCostSnapshot): BizLineItem {
  return {
    ...it,
    prevStockQty: snap.prevStockQty,
    prevAvgCost: snap.prevAvgCost,
    resultStockQty: snap.resultStockQty,
    resultAvgCost: snap.resultAvgCost,
  };
}
