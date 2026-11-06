/**
 * ─── Historique d'un produit ───────────────────────────────────────────────────
 * Tout ce qui est arrivé à UN produit, du premier bon d'achat à la dernière
 * vente : chaque entrée, chaque sortie, avec sa date, son document d'origine,
 * son prix et le gain qu'elle a dégagé.
 *
 * Cinq mouvements possibles :
 *   • ACHAT       — une facture fournisseur l'a fait entrer en stock ;
 *   • VENTE       — un ticket du point de vente l'a fait sortir ;
 *   • INTERVENTION — un lavage / une réparation l'a consommé et facturé ;
 *   • PRODUCTION  — une fabrication l'a consommé comme ingrédient ;
 *   • DESTRUCTION — il a été perdu (périmé, cassé, volé).
 *
 * Chaque mouvement transporte SON document complet : le bon d'achat ou le bon de
 * vente peut donc s'ouvrir depuis l'historique, avec toutes ses lignes.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  ModuleState, BizProduct, BizPurchase, BizSale, BizReparation,
  isReversedSale, prestationsOf, discountOf,
} from './bizConfig';
import { makeCostResolver } from './bizReporting';

export type MovementKind = 'purchase' | 'sale' | 'reparation' | 'production' | 'destruction';

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  purchase: 'Achat',
  sale: 'Vente',
  reparation: 'Intervention',
  production: 'Production',
  destruction: 'Destruction',
};

/** Une ligne du document ouvert depuis l'historique. */
export interface DocumentLine {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  /** La ligne du produit dont on consulte l'historique — mise en évidence. */
  target: boolean;
}

/** Un bon d'achat ou un bon de vente, tel qu'il s'ouvre en détail. */
export interface ProductDocument {
  kind: 'purchase' | 'sale' | 'reparation';
  title: string;
  ref: string;
  date: string;
  partyLabel: string;
  partyName: string;
  lines: DocumentLine[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  rest: number;
  status?: string;
  createdBy?: string;
  /** Véhicule, pour une intervention de lavage / réparation. */
  car?: string;
  note?: string;
}

export interface ProductMovement {
  id: string;
  kind: MovementKind;
  ref: string;
  date: string;
  /** Fournisseur, client, ou l'origine du mouvement. */
  party: string;
  /** Entrée en stock ou sortie. */
  direction: 'in' | 'out';
  qty: number;
  unitPrice: number;
  total: number;
  /** Coût de revient unitaire retenu pour la sortie. */
  unitCost: number;
  /** Gain de la ligne — uniquement sur les sorties facturées. */
  gain: number;
  status?: string;
  note?: string;
  /** Le mouvement est neutralisé (vente retournée / échangée, destruction récupérée). */
  canceled?: boolean;
  /** Le document complet, quand il y en a un à ouvrir. */
  doc: ProductDocument | null;
}

export interface ProductHistory {
  productId: string;
  productName: string;
  barcode?: string;
  unit?: string;
  movements: ProductMovement[];
  totals: {
    purchaseCount: number;
    purchasedQty: number;
    purchasedValue: number;
    avgBuyPrice: number;

    saleCount: number;
    soldQty: number;
    soldValue: number;
    soldCost: number;
    gain: number;
    marginPct: number;
    avgSellPrice: number;

    destroyedQty: number;
    destroyedValue: number;
    consumedQty: number;
    consumedValue: number;

    stockQty: number;
    stockValue: number;
    /** Quantité entrée − quantité sortie, tous mouvements confondus. */
    netQty: number;
  };
}

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** La ligne parle-t-elle bien de ce produit ? (id d'abord, nom en secours) */
const isTarget = (it: { productId?: string; productName?: string }, p: BizProduct): boolean =>
  (!!it.productId && it.productId === p.id) || (!!it.productName && it.productName === p.name);

function purchaseDoc(p: BizPurchase, target: BizProduct): ProductDocument {
  const subtotal = p.items.reduce((s, it) => s + (it.total ?? it.qty * it.unitPrice), 0);
  return {
    kind: 'purchase',
    title: 'Bon d\'achat',
    ref: p.ref,
    date: p.date,
    partyLabel: 'Fournisseur',
    partyName: p.supplierName || '—',
    lines: p.items.map(it => ({
      name: it.productName,
      qty: num(it.qty),
      unitPrice: num(it.unitPrice),
      total: num(it.total ?? it.qty * it.unitPrice),
      target: isTarget(it, target),
    })),
    subtotal,
    discount: 0,
    total: num(p.total),
    paid: num(p.paid),
    rest: num(p.rest),
    status: p.rest > 0 ? 'Crédit' : 'Payé',
    createdBy: p.createdBy,
  };
}

function saleDoc(s: BizSale, target: BizProduct): ProductDocument {
  return {
    kind: 'sale',
    title: 'Bon de vente',
    ref: s.ref,
    date: s.date,
    partyLabel: 'Client',
    partyName: s.clientName || 'Client de passage',
    lines: s.items.map(it => ({
      name: it.productName,
      qty: num(it.qty),
      unitPrice: num(it.unitPrice),
      total: num(it.total ?? it.qty * it.unitPrice),
      target: isTarget(it, target),
    })),
    subtotal: num(s.subtotal),
    discount: num(s.reduction),
    total: num(s.total),
    paid: num(s.paid),
    rest: num(s.rest),
    status: s.status,
    createdBy: s.workerName || s.createdBy,
    note: s.returnReason,
  };
}

function reparationDoc(r: BizReparation, target: BizProduct): ProductDocument {
  const prestations = prestationsOf(r).map(p => ({
    name: `${p.kind === 'lavage' ? 'Lavage' : 'Réparation'} — ${p.label}`,
    qty: 1, unitPrice: num(p.amount), total: num(p.amount), target: false,
  }));
  const products = (r.usedProducts || []).map(it => ({
    name: it.productName,
    qty: num(it.qty),
    unitPrice: num(it.unitPrice),
    total: num(it.total ?? it.qty * it.unitPrice),
    target: isTarget(it, target),
  }));
  const subtotal = num(r.subtotal) || [...prestations, ...products].reduce((s, l) => s + l.total, 0);
  return {
    kind: 'reparation',
    title: r.kind === 'lavage' ? 'Bon de lavage' : r.kind === 'reparation' ? 'Bon de réparation' : 'Bon lavage + réparation',
    ref: r.ref,
    date: r.date,
    partyLabel: 'Client',
    partyName: r.clientName || 'Client de passage',
    lines: [...prestations, ...products],
    subtotal,
    discount: num(r.discountAmount) || discountOf(subtotal, r.discountType, r.discountValue),
    total: num(r.total),
    paid: num(r.paid),
    rest: num(r.rest),
    status: r.status,
    createdBy: r.createdBy,
    car: [r.car?.marque, r.car?.name, r.car?.immatriculation].filter(Boolean).join(' · ') || undefined,
    note: r.problem,
  };
}

/**
 * Reconstitue l'histoire complète d'un produit à partir de l'état de sa partie.
 * Les ventes ANNULÉES (retournées / échangées) apparaissent, barrées : la
 * marchandise est revenue, elles ne comptent ni dans le chiffre d'affaires ni
 * dans le gain — comme dans les rapports.
 */
export function computeProductHistory(st: ModuleState, product: BizProduct): ProductHistory {
  const { unitCostOf } = makeCostResolver(st);
  const movements: ProductMovement[] = [];

  // ── Achats ──
  (st.purchases || []).forEach(p => {
    (p.items || []).forEach((it, i) => {
      if (!isTarget(it, product)) return;
      movements.push({
        id: `pur-${p.id}-${i}`,
        kind: 'purchase',
        ref: p.ref,
        date: p.date,
        party: p.supplierName || '—',
        direction: 'in',
        qty: num(it.qty),
        unitPrice: num(it.unitPrice),
        total: num(it.total ?? it.qty * it.unitPrice),
        unitCost: num(it.unitPrice),
        gain: 0,
        status: p.rest > 0 ? 'Crédit' : 'Payé',
        note: it.salePrice !== undefined ? `Prix de vente fixé à ${num(it.salePrice)} DA` : undefined,
        doc: purchaseDoc(p, product),
      });
    });
  });

  // ── Ventes du point de vente ──
  (st.sales || []).forEach(s => {
    const canceled = isReversedSale(s);
    (s.items || []).forEach((it, i) => {
      if (!isTarget(it, product)) return;
      const qty = num(it.qty);
      const total = num(it.total ?? it.qty * it.unitPrice);
      const unitCost = unitCostOf(it);
      movements.push({
        id: `sal-${s.id}-${i}`,
        kind: 'sale',
        ref: s.ref,
        date: s.date,
        party: s.clientName || 'Client de passage',
        direction: 'out',
        qty,
        unitPrice: num(it.unitPrice),
        total,
        unitCost,
        gain: canceled ? 0 : total - unitCost * qty,
        status: s.status,
        canceled,
        note: canceled ? (s.returnReason || 'Vente annulée — marchandise revenue en stock') : undefined,
        doc: saleDoc(s, product),
      });
    });
  });

  // ── Interventions (lavage / réparation) ──
  (st.reparations || []).forEach(r => {
    (r.usedProducts || []).forEach((it, i) => {
      if (!isTarget(it, product)) return;
      const qty = num(it.qty);
      const total = num(it.total ?? it.qty * it.unitPrice);
      const unitCost = unitCostOf(it);
      movements.push({
        id: `rep-${r.id}-${i}`,
        kind: 'reparation',
        ref: r.ref,
        date: r.date,
        party: r.clientName || 'Client de passage',
        direction: 'out',
        qty,
        unitPrice: num(it.unitPrice),
        total,
        unitCost,
        gain: total - unitCost * qty,
        status: r.status,
        doc: reparationDoc(r, product),
      });
    });
  });

  // ── Consommations en production ──
  (st.productions || []).forEach(p => {
    (p.ingredients || []).forEach((ing, i) => {
      if (ing.productId !== product.id && ing.productName !== product.name) return;
      movements.push({
        id: `prd-${p.id}-${i}`,
        kind: 'production',
        ref: p.name,
        date: p.date,
        party: p.createdBy || 'Production',
        direction: 'out',
        qty: num(ing.quantityUsed),
        unitPrice: num(ing.unitCost),
        total: num(ing.lineCost),
        unitCost: num(ing.unitCost),
        gain: 0,
        note: `Ingrédient de « ${p.name} » — ${num(p.outputQuantity)} ${p.unit || ''} produits`.trim(),
        doc: null,
      });
    });
  });

  // ── Destructions ──
  (st.destructions || []).forEach(d => {
    if (d.productId !== product.id && d.productName !== product.name) return;
    movements.push({
      id: `des-${d.id}`,
      kind: 'destruction',
      ref: d.reason || 'Perte',
      date: d.date,
      party: d.createdBy || '—',
      direction: 'out',
      qty: num(d.qty),
      unitPrice: num(d.unitPrice),
      total: num(d.value),
      unitCost: num(d.unitCost ?? d.unitPrice),
      gain: 0,
      status: d.recovered ? 'Récupérée' : 'Détruit',
      canceled: !!d.recovered,
      note: d.notes,
      doc: null,
    });
  });

  movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Totaux ──
  const purchases = movements.filter(m => m.kind === 'purchase');
  const sales = movements.filter(m => (m.kind === 'sale' || m.kind === 'reparation') && !m.canceled);
  const destroyed = movements.filter(m => m.kind === 'destruction' && !m.canceled);
  const consumed = movements.filter(m => m.kind === 'production');

  const purchasedQty = purchases.reduce((s, m) => s + m.qty, 0);
  const purchasedValue = purchases.reduce((s, m) => s + m.total, 0);
  const soldQty = sales.reduce((s, m) => s + m.qty, 0);
  const soldValue = sales.reduce((s, m) => s + m.total, 0);
  const soldCost = sales.reduce((s, m) => s + m.unitCost * m.qty, 0);
  const gain = soldValue - soldCost;

  return {
    productId: product.id,
    productName: product.name,
    barcode: product.barcode,
    unit: product.unit,
    movements,
    totals: {
      purchaseCount: purchases.length,
      purchasedQty,
      purchasedValue,
      avgBuyPrice: purchasedQty > 0 ? purchasedValue / purchasedQty : num(product.purchasePrice),

      saleCount: sales.length,
      soldQty,
      soldValue,
      soldCost,
      gain,
      marginPct: soldValue !== 0 ? (gain / soldValue) * 100 : 0,
      avgSellPrice: soldQty > 0 ? soldValue / soldQty : num(product.salePrice),

      destroyedQty: destroyed.reduce((s, m) => s + m.qty, 0),
      destroyedValue: destroyed.reduce((s, m) => s + m.total, 0),
      consumedQty: consumed.reduce((s, m) => s + m.qty, 0),
      consumedValue: consumed.reduce((s, m) => s + m.total, 0),

      stockQty: num(product.currentQty),
      stockValue: num(product.currentQty) * num(product.purchasePrice),
      netQty: purchasedQty
        - soldQty
        - destroyed.reduce((s, m) => s + m.qty, 0)
        - consumed.reduce((s, m) => s + m.qty, 0),
    },
  };
}
