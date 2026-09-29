/**
 * ─── Valeur du stock — au prix d'achat ET au prix de vente ─────────────────────
 * Une seule question, posée pour toute la station : « qu'est-ce que j'ai en
 * magasin, ce que ça m'a coûté, et ce que ça vaut si je le vends ? »
 *
 * Trois parties, chacune avec ses propres réserves :
 *   • Carburant  → les CUVES (litres × prix d'achat / prix de vente du carburant)
 *                  et le magasin de la station (produits boutique).
 *   • Cafétéria  → le catalogue (Gestion de stock) et le COMPTOIR (productions
 *                  déjà prêtes à la vente, valorisées à leur coût de revient).
 *   • Lavage     → le catalogue (pièces, produits de lavage).
 *
 * Chaque ligne porte les DEUX valorisations : `buyValue` (ce que la marchandise
 * a coûté — la seule qui entre dans un bilan) et `sellValue` (ce qu'elle
 * rapportera si tout part au prix affiché). Leur écart est la marge latente.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleKey, MODULES, ModuleState } from './bizConfig';

/** Une ligne de stock valorisée. */
export interface StockLine {
  id: string;
  name: string;
  /** Code-barres (catalogue) ou type de carburant (cuve) — sert à la recherche. */
  code?: string;
  category?: string;
  unit?: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  buyValue: number;
  sellValue: number;
  /** sellValue − buyValue : le gain qui dort dans le stock. */
  margin: number;
  /** Marge en % du prix d'achat. */
  marginPct: number;
  /** Sous seuil d'alerte (catalogue) ou sous le niveau d'alerte (cuve). */
  low?: boolean;
  minQty?: number;
  expirationDate?: string;
  /** Matière première : elle n'a pas de prix de vente propre. */
  raw?: boolean;
  /** Stock à découvert — la quantité est négative. */
  negative?: boolean;
}

/** Un ensemble homogène de lignes dans une partie (cuves, catalogue, comptoir…). */
export interface StockSection {
  key: string;
  label: string;
  hint: string;
  lines: StockLine[];
  buyValue: number;
  sellValue: number;
  margin: number;
  count: number;
  /** Quantité totale, quand elle a un sens (litres en cuve). */
  qty: number;
  unit?: string;
}

/** La réserve complète d'une activité. */
export interface StockPart {
  key: string;
  label: string;
  emoji: string;
  sections: StockSection[];
  buyValue: number;
  sellValue: number;
  margin: number;
  marginPct: number;
  count: number;
  /** Lignes sous seuil d'alerte, toutes sections confondues. */
  lowCount: number;
  negativeCount: number;
}

export interface StockValuation {
  parts: StockPart[];
  buyValue: number;
  sellValue: number;
  margin: number;
  marginPct: number;
  count: number;
  lowCount: number;
  negativeCount: number;
}

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

const lineOf = (l: Omit<StockLine, 'buyValue' | 'sellValue' | 'margin' | 'marginPct'>): StockLine => {
  const buyValue = l.qty * l.buyPrice;
  const sellValue = l.qty * l.sellPrice;
  return {
    ...l,
    buyValue,
    sellValue,
    margin: sellValue - buyValue,
    marginPct: buyValue > 0 ? ((sellValue - buyValue) / buyValue) * 100 : 0,
  };
};

const sectionOf = (key: string, label: string, hint: string, lines: StockLine[], unit?: string): StockSection => ({
  key, label, hint, lines, unit,
  buyValue: lines.reduce((s, l) => s + l.buyValue, 0),
  sellValue: lines.reduce((s, l) => s + l.sellValue, 0),
  margin: lines.reduce((s, l) => s + l.margin, 0),
  count: lines.length,
  qty: lines.reduce((s, l) => s + l.qty, 0),
});

const partOf = (key: string, label: string, emoji: string, sections: StockSection[]): StockPart => {
  const kept = sections.filter(s => s.count > 0);
  const buyValue = kept.reduce((s, x) => s + x.buyValue, 0);
  const sellValue = kept.reduce((s, x) => s + x.sellValue, 0);
  const all = kept.flatMap(s => s.lines);
  return {
    key, label, emoji, sections: kept,
    buyValue, sellValue, margin: sellValue - buyValue,
    marginPct: buyValue > 0 ? ((sellValue - buyValue) / buyValue) * 100 : 0,
    count: all.length,
    lowCount: all.filter(l => l.low).length,
    negativeCount: all.filter(l => l.negative).length,
  };
};

// ─── Carburant : cuves + magasin de la station ───────────────────────────────
export function computeCarburantStock(app: any): StockPart {
  const settings = app?.settings || {};
  const buyPrices: Record<string, number> = settings.fuelBuyPrices || {};
  const sellPrices: Record<string, number> = settings.fuelPrices || {};

  const cuves: StockLine[] = (app?.tanks || []).map((t: any) => {
    const qty = num(t.current);
    const alert = num(t.alertThreshold);
    return lineOf({
      id: `tank-${t.id}`,
      name: t.name || 'Cuve',
      code: t.type,
      category: 'Cuve',
      unit: 'L',
      qty,
      buyPrice: num(buyPrices[t.type]),
      sellPrice: num(sellPrices[t.type]),
      low: alert > 0 && qty <= alert,
      minQty: alert,
      negative: qty < 0,
    });
  });

  const boutique: StockLine[] = (app?.products || []).map((p: any) => {
    const qty = num(p.stock);
    const min = num(p.minStock);
    return lineOf({
      id: `prod-${p.id}`,
      name: p.name,
      code: p.barcode || p.ref,
      category: p.category,
      unit: p.unit,
      qty,
      buyPrice: num(p.buyPrice),
      sellPrice: num(p.sellingPrice),
      low: qty <= min,
      minQty: min,
      negative: qty < 0,
    });
  });

  return partOf('carburant', 'Carburant', '⛽', [
    sectionOf('cuves', 'Carburant en cuve', 'Litres restants × prix d\'achat / prix à la pompe', cuves, 'L'),
    sectionOf('boutique', 'Magasin de la station', 'Produits boutique du catalogue carburant', boutique),
  ]);
}

// ─── Partie commerciale : catalogue + comptoir ───────────────────────────────
export function computeModuleStock(st: ModuleState, key: ModuleKey): StockPart {
  const cfg = MODULES[key];

  const catalogue: StockLine[] = (st.products || []).map(p => lineOf({
    id: `p-${p.id}`,
    name: p.name,
    code: p.barcode,
    category: p.categoryName,
    unit: p.unit,
    qty: num(p.currentQty),
    buyPrice: num(p.purchasePrice),
    // Une matière première ne se vend pas telle quelle : sa « valeur de vente »
    // est son coût, sinon la marge latente serait inventée de toutes pièces.
    sellPrice: p.isRawMaterial ? num(p.purchasePrice) : num(p.salePrice),
    low: num(p.currentQty) <= num(p.minQty),
    minQty: num(p.minQty),
    expirationDate: p.hasExpiration ? p.expirationDate : undefined,
    raw: !!p.isRawMaterial,
    negative: num(p.currentQty) < 0,
  }));

  const comptoir: StockLine[] = (st.comptoir || []).map(c => lineOf({
    id: `c-${c.id}`,
    name: c.productName,
    category: c.categoryName || 'Comptoir',
    unit: c.unit,
    qty: num(c.qty),
    // Côté comptoir, `purchasePrice` est le COÛT DE REVIENT de la production et
    // `unitPrice` le prix de vente affiché.
    buyPrice: num(c.purchasePrice),
    sellPrice: num(c.unitPrice),
    negative: num(c.qty) < 0,
  }));

  return partOf(key, cfg.label, cfg.emoji, [
    sectionOf('catalogue', 'Catalogue (Gestion de stock)', 'Produits achetés et matières premières', catalogue),
    sectionOf('comptoir', 'Comptoir', 'Productions prêtes à la vente, au coût de revient', comptoir),
  ]);
}

// ─── Toute la station ────────────────────────────────────────────────────────
export function computeStockValuation(app: any, biz: BizState): StockValuation {
  const parts = [
    computeCarburantStock(app),
    computeModuleStock(biz.restaurant, 'restaurant'),
    computeModuleStock(biz.cafeteria, 'cafeteria'),
    computeModuleStock(biz.lavage, 'lavage'),
  ];
  const buyValue = parts.reduce((s, p) => s + p.buyValue, 0);
  const sellValue = parts.reduce((s, p) => s + p.sellValue, 0);
  return {
    parts,
    buyValue,
    sellValue,
    margin: sellValue - buyValue,
    marginPct: buyValue > 0 ? ((sellValue - buyValue) / buyValue) * 100 : 0,
    count: parts.reduce((s, p) => s + p.count, 0),
    lowCount: parts.reduce((s, p) => s + p.lowCount, 0),
    negativeCount: parts.reduce((s, p) => s + p.negativeCount, 0),
  };
}
