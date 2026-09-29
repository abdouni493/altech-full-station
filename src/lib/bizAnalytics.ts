/**
 * ─── Moteur d'analyse ──────────────────────────────────────────────────────────
 * Transforme une période en COURBES et en CLASSEMENTS, pour les trois activités
 * de la station comme pour chacun de leurs produits :
 *
 *   • une série temporelle (jour / semaine / mois choisis automatiquement selon
 *     la longueur de la période) : ventes, coût des marchandises, marge, achats,
 *     dépenses, résultat ;
 *   • un classement par produit avec sa PROPRE série — cliquer un produit ouvre
 *     sa courbe à lui ;
 *   • les productions (cafétéria) : ce qui a été fabriqué, ce que ça a coûté,
 *     les pertes, et ce que la vente en a tiré ;
 *   • ce qui se vend BIEN et ce qui ne se vend PAS — y compris les produits qui
 *     dorment en stock sans la moindre vente sur la période.
 *
 * Les coûts viennent de `makeCostResolver` : les analyses et les rapports
 * s'appuient sur exactement le même coût de revient, donc sur le même gain.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  ModuleState, ModuleKey, MODULES, isReversedSale, prestationsOf,
} from './bizConfig';
import { makeCostResolver, appExpensesOfPart } from './bizReporting';
import { within } from './period';
import { computeCarburantSales } from './carburantSales';
import { expensePartOf } from '../store/AppContext';

// ─── Découpage du temps ──────────────────────────────────────────────────────
export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: 'Par jour', week: 'Par semaine', month: 'Par mois',
};

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // lundi
  return x;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Le découpage qui garde le graphique lisible : ~10 à 60 points. */
export function pickGranularity(from: string, to: string): Granularity {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  const days = Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86_400_000) + 1) : 30;
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

interface Bucket { key: string; label: string; date: string }

/** Tous les intervalles de la période, y compris ceux sans la moindre vente. */
function buildBuckets(from: string, to: string, g: Granularity): Bucket[] {
  const start = new Date(from || Date.now());
  const end = new Date(to || Date.now());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const out: Bucket[] = [];
  let cursor = g === 'day' ? startOfDay(start) : g === 'week' ? startOfWeek(start) : startOfMonth(start);
  const last = startOfDay(end).getTime();
  let guard = 0;
  while (cursor.getTime() <= last && guard++ < 800) {
    out.push({ key: bucketKey(cursor, g), label: bucketLabel(cursor, g), date: cursor.toISOString() });
    const next = new Date(cursor);
    if (g === 'day') next.setDate(next.getDate() + 1);
    else if (g === 'week') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    cursor = next;
  }
  return out;
}

function bucketKey(d: Date, g: Granularity): string {
  if (g === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const base = g === 'week' ? startOfWeek(d) : startOfDay(d);
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

function bucketLabel(d: Date, g: Granularity): string {
  if (g === 'month') return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  if (g === 'week') return `sem. ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** Intervalle auquel appartient une date — `null` si elle est illisible. */
function keyOfDate(dateStr: string, g: Granularity): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return bucketKey(d, g);
}

// ─── Points de série ─────────────────────────────────────────────────────────
/** Un intervalle vu par un produit : ce qu'il a vendu et rapporté. */
export interface SeriesPoint {
  key: string;
  label: string;
  date: string;
  qty: number;
  revenue: number;
  cost: number;
  gain: number;
  count: number;
}

/** Un intervalle vu par une activité entière — achats et dépenses compris. */
export interface TimePoint extends SeriesPoint {
  purchases: number;
  expenses: number;
  /** marge − dépenses : le résultat de l'intervalle. */
  net: number;
}

const emptySeries = (b: Bucket[]): SeriesPoint[] =>
  b.map(x => ({ ...x, qty: 0, revenue: 0, cost: 0, gain: 0, count: 0 }));
const emptyTimeline = (b: Bucket[]): TimePoint[] =>
  b.map(x => ({ ...x, qty: 0, revenue: 0, cost: 0, gain: 0, count: 0, purchases: 0, expenses: 0, net: 0 }));

// ─── Résultats ───────────────────────────────────────────────────────────────
export type ProductKind = 'catalogue' | 'production' | 'fiche' | 'prestation' | 'carburant' | 'boutique' | 'autre';

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  catalogue: 'Produit du stock',
  production: 'Production (comptoir)',
  fiche: 'Fiche technique',
  prestation: 'Prestation',
  carburant: 'Carburant',
  boutique: 'Boutique',
  autre: 'Autre',
};

export interface ProductAnalytics {
  id: string;
  name: string;
  /** Code-barres — la recherche accepte le nom OU le code. */
  code?: string;
  category?: string;
  unit?: string;
  kind: ProductKind;
  qty: number;
  revenue: number;
  cost: number;
  gain: number;
  /** Gain ÷ chiffre d'affaires, en %. */
  marginPct: number;
  /** Part du chiffre d'affaires de l'activité, en %. */
  share: number;
  /** Nombre de lignes de vente portant ce produit sur la période. */
  operations: number;
  firstSale?: string;
  lastSale?: string;
  /** Reste en stock aujourd'hui (produits du catalogue). */
  stockQty?: number;
  stockValue?: number;
  /** Ventes moyennes par intervalle du graphique. */
  avgPerPoint: number;
  points: SeriesPoint[];
}

/** Un produit du catalogue qui n'a rien vendu de la période. */
export interface DeadStockRow {
  id: string;
  name: string;
  code?: string;
  category?: string;
  unit?: string;
  stockQty: number;
  stockValue: number;
  /** Prix de vente affiché — le manque à gagner si tout restait invendu. */
  potentialValue: number;
  raw?: boolean;
}

export interface ProductionAnalytics {
  name: string;
  unit?: string;
  runs: number;
  produced: number;
  cost: number;
  value: number;
  costPerUnit: number;
  lossQty: number;
  lossValue: number;
  sentToComptoir: number;
  /** Ventes du même produit sur la période (comptoir / vente directe). */
  soldQty: number;
  soldRevenue: number;
  soldGain: number;
  /** produced − sold : ce qui reste sur les bras. */
  unsold: number;
  points: SeriesPoint[];
}

export interface CategoryAnalytics {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  gain: number;
  share: number;
  products: number;
}

export interface PartAnalytics {
  key: string;
  label: string;
  emoji: string;
  from: string;
  to: string;
  granularity: Granularity;
  points: TimePoint[];
  products: ProductAnalytics[];
  productions: ProductionAnalytics[];
  categories: CategoryAnalytics[];
  /** Ce qui se vend le mieux (chiffre d'affaires décroissant). */
  best: ProductAnalytics[];
  /** Ce qui se vend le moins — vendu au moins une fois, mais tout en bas. */
  worst: ProductAnalytics[];
  /** En stock et jamais vendu sur la période. */
  dead: DeadStockRow[];
  totals: {
    sales: number; cost: number; margin: number;
    purchases: number; expenses: number; net: number;
    qty: number; operations: number; products: number;
  };
  bestPoint?: TimePoint;
  worstPoint?: TimePoint;
  avgPerPoint: number;
  /** Évolution entre la 1ʳᵉ et la 2ᵈᵉ moitié de la période, en %. */
  trendPct: number;
  /** Chiffre d'affaires de la 1ʳᵉ / 2ᵈᵉ moitié — sert à expliquer la tendance. */
  firstHalf: number;
  secondHalf: number;
}

// ─── Accumulateur interne ────────────────────────────────────────────────────
interface Acc {
  id: string; name: string; code?: string; category?: string; unit?: string; kind: ProductKind;
  qty: number; revenue: number; cost: number; operations: number;
  first?: string; last?: string;
  byKey: Map<string, { qty: number; revenue: number; cost: number; count: number }>;
}

const touch = (m: Map<string, Acc>, id: string, seed: () => Omit<Acc, 'qty' | 'revenue' | 'cost' | 'operations' | 'byKey'>): Acc => {
  let a = m.get(id);
  if (!a) {
    a = { ...seed(), qty: 0, revenue: 0, cost: 0, operations: 0, byKey: new Map() };
    m.set(id, a);
  }
  return a;
};

function record(a: Acc, date: string, key: string | null, qty: number, revenue: number, cost: number) {
  a.qty += qty;
  a.revenue += revenue;
  a.cost += cost;
  a.operations += 1;
  if (!a.first || date < a.first) a.first = date;
  if (!a.last || date > a.last) a.last = date;
  if (!key) return;
  const b = a.byKey.get(key) || { qty: 0, revenue: 0, cost: 0, count: 0 };
  b.qty += qty; b.revenue += revenue; b.cost += cost; b.count += 1;
  a.byKey.set(key, b);
}

function toProduct(a: Acc, buckets: Bucket[], totalRevenue: number): ProductAnalytics {
  const points: SeriesPoint[] = buckets.map(b => {
    const v = a.byKey.get(b.key);
    return {
      ...b,
      qty: v?.qty || 0, revenue: v?.revenue || 0, cost: v?.cost || 0,
      gain: (v?.revenue || 0) - (v?.cost || 0), count: v?.count || 0,
    };
  });
  const gain = a.revenue - a.cost;
  return {
    id: a.id, name: a.name, code: a.code, category: a.category, unit: a.unit, kind: a.kind,
    qty: a.qty, revenue: a.revenue, cost: a.cost, gain,
    marginPct: a.revenue !== 0 ? (gain / a.revenue) * 100 : 0,
    share: totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0,
    operations: a.operations,
    firstSale: a.first, lastSale: a.last,
    avgPerPoint: points.length ? a.revenue / points.length : 0,
    points,
  };
}

/** Rangs, tendances et moyennes communs à toutes les activités. */
function finalize(
  base: Omit<PartAnalytics, 'best' | 'worst' | 'bestPoint' | 'worstPoint' | 'avgPerPoint' | 'trendPct' | 'firstHalf' | 'secondHalf'>,
): PartAnalytics {
  const sold = base.products.filter(p => p.qty > 0 || p.revenue > 0);
  const byRevenue = [...sold].sort((a, b) => b.revenue - a.revenue);
  const points = base.points;
  const half = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, half).reduce((s, p) => s + p.revenue, 0);
  const secondHalf = points.slice(half).reduce((s, p) => s + p.revenue, 0);
  const withSales = points.filter(p => p.revenue > 0);

  return {
    ...base,
    best: byRevenue.slice(0, 8),
    worst: [...byRevenue].reverse().slice(0, 8),
    bestPoint: points.length ? points.reduce((m, p) => (p.revenue > m.revenue ? p : m), points[0]) : undefined,
    worstPoint: withSales.length ? withSales.reduce((m, p) => (p.revenue < m.revenue ? p : m), withSales[0]) : undefined,
    avgPerPoint: points.length ? base.totals.sales / points.length : 0,
    trendPct: firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : (secondHalf > 0 ? 100 : 0),
    firstHalf, secondHalf,
  };
}

// ─── Analyse d'une partie commerciale (Cafétéria / Lavage) ───────────────────
export function computeModuleAnalytics(
  st: ModuleState, key: ModuleKey, from: string, to: string, granularity?: Granularity,
  /** Dépenses de la station imputées à cette partie — ce sont ses charges. */
  appExpenses: any[] = [],
): PartAnalytics {
  const cfg = MODULES[key];
  const g = granularity || pickGranularity(from, to);
  const buckets = buildBuckets(from, to, g);
  const { unitCostOf, unitOf, categoryOf, barcodeOf, kindOf } = makeCostResolver(st);

  const timeline = new Map(emptyTimeline(buckets).map(p => [p.key, p]));
  const bump = (dateStr: string, patch: Partial<TimePoint>) => {
    const k = keyOfDate(dateStr, g);
    if (!k) return;
    const p = timeline.get(k);
    if (!p) return;
    for (const [field, v] of Object.entries(patch)) {
      (p as any)[field] += v as number;
    }
  };

  const acc = new Map<string, Acc>();
  const sales = st.sales.filter(s => within(s.date, from, to) && !isReversedSale(s));
  const reps = (st.reparations || []).filter(r => within(r.date, from, to));

  // ── Ventes du point de vente ──
  sales.forEach(s => {
    const k = keyOfDate(s.date, g);
    s.items.forEach(it => {
      const revenue = it.total ?? it.qty * it.unitPrice;
      const cost = unitCostOf(it) * (it.qty || 0);
      const kind = kindOf(it);
      const a = touch(acc, it.productId || it.productName, () => ({
        id: it.productId || it.productName,
        name: it.productName,
        code: barcodeOf(it),
        category: categoryOf(it),
        unit: unitOf(it),
        kind: kind as ProductKind,
      }));
      record(a, s.date, k, it.qty || 0, revenue, cost);
      bump(s.date, { revenue, cost, gain: revenue - cost, qty: it.qty || 0, count: 1 });
    });
  });

  // ── Interventions : les produits consommés, puis la main-d'œuvre ──
  reps.forEach(r => {
    const k = keyOfDate(r.date, g);
    (r.usedProducts || []).forEach(it => {
      const revenue = it.total ?? it.qty * it.unitPrice;
      const cost = unitCostOf(it) * (it.qty || 0);
      const a = touch(acc, it.productId || it.productName, () => ({
        id: it.productId || it.productName,
        name: it.productName,
        code: barcodeOf(it),
        category: categoryOf(it),
        unit: unitOf(it),
        kind: kindOf(it) as ProductKind,
      }));
      record(a, r.date, k, it.qty || 0, revenue, cost);
      bump(r.date, { revenue, cost, gain: revenue - cost, qty: it.qty || 0, count: 1 });
    });
    // Une prestation n'a pas de marchandise derrière elle : elle est marge pure.
    prestationsOf(r).forEach(p => {
      const name = p.kind === 'lavage' ? 'Prestations — Lavage' : 'Prestations — Vidange';
      const a = touch(acc, name, () => ({
        id: name, name, category: 'Main-d\'œuvre', unit: 'prestation', kind: 'prestation' as ProductKind,
      }));
      const amount = Number(p.amount) || 0;
      record(a, r.date, k, 1, amount, 0);
      bump(r.date, { revenue: amount, gain: amount, qty: 1, count: 1 });
    });
  });

  // ── Achats & dépenses de la période ──
  st.purchases.filter(p => within(p.date, from, to))
    .forEach(p => bump(p.date, { purchases: p.total || 0 }));
  st.expenses.filter(e => within(e.date, from, to))
    .forEach(e => bump(e.date, { expenses: e.amount || 0 }));
  // Les dépenses de la station imputées à cette partie sont les siennes.
  appExpensesOfPart(key, appExpenses).filter((e: any) => within(e.date, from, to))
    .forEach((e: any) => bump(e.date, { expenses: Number(e.amount) || 0 }));
  st.workers.forEach(w => (w.payments || [])
    .filter(pay => within(pay.date, from, to))
    .forEach(pay => bump(pay.date, { expenses: pay.amount || 0 })));

  const points = buckets.map(b => {
    const p = timeline.get(b.key)!;
    return { ...p, net: p.revenue - p.cost - p.expenses };
  });

  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0);
  const products = Array.from(acc.values())
    .map(a => toProduct(a, buckets, totalRevenue))
    .sort((a, b) => b.revenue - a.revenue);

  // Le reste en stock, greffé sur le classement : un produit qui ne se vend pas
  // mais qui dort en quantité est l'information que le gérant vient chercher.
  const stockByName = new Map(st.products.map(p => [p.name, p]));
  products.forEach(p => {
    const prod = st.products.find(x => x.id === p.id) || stockByName.get(p.name);
    if (!prod) return;
    p.stockQty = prod.currentQty;
    p.stockValue = prod.currentQty * prod.purchasePrice;
    if (!p.code) p.code = prod.barcode;
  });

  const soldNames = new Set(products.filter(p => p.qty > 0).map(p => p.name));
  const dead: DeadStockRow[] = st.products
    .filter(p => !soldNames.has(p.name) && p.currentQty > 0)
    .map(p => ({
      id: p.id, name: p.name, code: p.barcode, category: p.categoryName, unit: p.unit,
      stockQty: p.currentQty,
      stockValue: p.currentQty * p.purchasePrice,
      potentialValue: p.currentQty * (p.isRawMaterial ? p.purchasePrice : p.salePrice),
      raw: p.isRawMaterial,
    }))
    .sort((a, b) => b.stockValue - a.stockValue);

  // ── Productions de la période ──
  const prodAcc = new Map<string, ProductionAnalytics & { byKey: Map<string, SeriesPoint> }>();
  (st.productions || []).filter(p => within(p.date, from, to)).forEach(p => {
    const k = keyOfDate(p.date, g);
    let row = prodAcc.get(p.name);
    if (!row) {
      row = {
        name: p.name, unit: p.unit, runs: 0, produced: 0, cost: 0, value: 0, costPerUnit: 0,
        lossQty: 0, lossValue: 0, sentToComptoir: 0,
        soldQty: 0, soldRevenue: 0, soldGain: 0, unsold: 0,
        points: [], byKey: new Map(emptySeries(buckets).map(x => [x.key, x])),
      };
      prodAcc.set(p.name, row);
    }
    row.runs += 1;
    row.produced += p.outputQuantity || 0;
    row.cost += p.totalCost || 0;
    row.value += p.totalValue || 0;
    row.lossQty += p.lossQuantity || 0;
    row.lossValue += p.lossValue || 0;
    row.sentToComptoir += p.sentToComptoir || 0;
    const pt = k ? row.byKey.get(k) : undefined;
    if (pt) { pt.qty += p.outputQuantity || 0; pt.revenue += p.totalValue || 0; pt.cost += p.totalCost || 0; pt.count += 1; }
  });
  const productions: ProductionAnalytics[] = Array.from(prodAcc.values()).map(row => {
    const sold = products.find(p => p.name === row.name);
    const points = buckets.map(b => {
      const pt = row.byKey.get(b.key)!;
      return { ...pt, gain: pt.revenue - pt.cost };
    });
    const { byKey, ...rest } = row;
    return {
      ...rest,
      points,
      costPerUnit: row.produced > 0 ? row.cost / row.produced : 0,
      soldQty: sold?.qty || 0,
      soldRevenue: sold?.revenue || 0,
      soldGain: sold?.gain || 0,
      unsold: (row.produced || 0) - (sold?.qty || 0),
    };
  }).sort((a, b) => b.produced - a.produced);

  const categories = groupByCategory(products);
  const totals = totalsOf(points, products);

  return finalize({
    key, label: cfg.label, emoji: cfg.emoji, from, to, granularity: g,
    points, products, productions, categories, dead, totals,
  });
}

// ─── Analyse de la partie Carburant ──────────────────────────────────────────
export function computeCarburantAnalytics(
  app: any, from: string, to: string, granularity?: Granularity,
): PartAnalytics {
  const g = granularity || pickGranularity(from, to);
  const buckets = buildBuckets(from, to, g);
  const timeline = new Map(emptyTimeline(buckets).map(p => [p.key, p]));
  const bump = (dateStr: string, patch: Partial<TimePoint>) => {
    const k = keyOfDate(dateStr, g);
    if (!k) return;
    const p = timeline.get(k);
    if (!p) return;
    for (const [field, v] of Object.entries(patch)) (p as any)[field] += v as number;
  };

  const products: any[] = app?.products || [];
  const prodById = new Map(products.map(p => [p.id, p]));
  const acc = new Map<string, Acc>();

  // ── Carburant à la pompe — les BRIGADES ──
  // La table `fuel_sales` n'est plus écrite : les analyses lisaient donc une
  // table vide et la courbe du carburant restait plate à zéro pendant que les
  // achats, eux, creusaient le résultat. La vente de carburant, c'est la brigade.
  computeCarburantSales(app, from, to).brigades.forEach(b => {
    const k = keyOfDate(b.date, g);
    b.byFuel.forEach(f => {
      const a = touch(acc, `fuel-${f.type}`, () => ({
        id: `fuel-${f.type}`, name: f.type, category: 'Carburant', unit: 'L', kind: 'carburant' as ProductKind,
      }));
      record(a, b.date, k, f.liters, f.revenue, f.cost);
    });
    bump(b.date, { revenue: b.revenue, cost: b.cost, gain: b.revenue - b.cost, qty: b.liters, count: 1 });
  });

  // ── Boutique de la station ──
  (app?.shopSales || []).filter((s: any) => within(s.date, from, to)).forEach((s: any) => {
    const k = keyOfDate(s.date, g);
    (s.items || []).forEach((i: any) => {
      const prod = prodById.get(i.productId);
      const revenue = (i.quantity || 0) * (i.price || 0);
      const cost = (i.quantity || 0) * (prod?.buyPrice || 0);
      const a = touch(acc, `shop-${i.productId || i.productName}`, () => ({
        id: `shop-${i.productId || i.productName}`,
        name: i.productName,
        code: prod?.barcode || prod?.ref,
        category: prod?.category || 'Boutique',
        unit: prod?.unit,
        kind: 'boutique' as ProductKind,
      }));
      record(a, s.date, k, i.quantity || 0, revenue, cost);
      bump(s.date, { revenue, cost, gain: revenue - cost, qty: i.quantity || 0, count: 1 });
    });
  });

  (app?.purchases || []).filter((p: any) => within(p.date, from, to))
    .forEach((p: any) => bump(p.date, { purchases: p.total || 0 }));
  // Les dépenses du CARBURANT seulement : celles imputées à la Cafétéria ou au
  // Lavage pèsent sur LEUR courbe, pas sur celle du carburant.
  (app?.expenses || [])
    .filter((e: any) => expensePartOf(e) === 'carburant' && within(e.date, from, to))
    .forEach((e: any) => bump(e.date, { expenses: e.amount || 0 }));

  const points = buckets.map(b => {
    const p = timeline.get(b.key)!;
    return { ...p, net: p.revenue - p.cost - p.expenses };
  });
  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0);
  const list = Array.from(acc.values())
    .map(a => toProduct(a, buckets, totalRevenue))
    .sort((a, b) => b.revenue - a.revenue);

  list.forEach(p => {
    const prod = products.find(x => `shop-${x.id}` === p.id);
    if (!prod) return;
    p.stockQty = prod.stock;
    p.stockValue = (prod.stock || 0) * (prod.buyPrice || 0);
  });

  const soldIds = new Set(list.filter(p => p.qty > 0).map(p => p.id));
  const dead: DeadStockRow[] = products
    .filter(p => !soldIds.has(`shop-${p.id}`) && (p.stock || 0) > 0)
    .map(p => ({
      id: p.id, name: p.name, code: p.barcode || p.ref, category: p.category, unit: p.unit,
      stockQty: p.stock || 0,
      stockValue: (p.stock || 0) * (p.buyPrice || 0),
      potentialValue: (p.stock || 0) * (p.sellingPrice || 0),
    }))
    .sort((a, b) => b.stockValue - a.stockValue);

  return finalize({
    key: 'carburant', label: 'Carburant', emoji: '⛽', from, to, granularity: g,
    points, products: list, productions: [],
    categories: groupByCategory(list), dead,
    totals: totalsOf(points, list),
  });
}

// ─── Helpers partagés ────────────────────────────────────────────────────────
function groupByCategory(products: ProductAnalytics[]): CategoryAnalytics[] {
  const m = new Map<string, CategoryAnalytics>();
  let total = 0;
  products.forEach(p => {
    const name = p.category || 'Sans catégorie';
    const c = m.get(name) || { name, qty: 0, revenue: 0, cost: 0, gain: 0, share: 0, products: 0 };
    c.qty += p.qty; c.revenue += p.revenue; c.cost += p.cost; c.gain += p.gain; c.products += 1;
    m.set(name, c);
    total += p.revenue;
  });
  return Array.from(m.values())
    .map(c => ({ ...c, share: total > 0 ? (c.revenue / total) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

function totalsOf(points: TimePoint[], products: ProductAnalytics[]): PartAnalytics['totals'] {
  const sales = points.reduce((s, p) => s + p.revenue, 0);
  const cost = points.reduce((s, p) => s + p.cost, 0);
  const purchases = points.reduce((s, p) => s + p.purchases, 0);
  const expenses = points.reduce((s, p) => s + p.expenses, 0);
  return {
    sales, cost, margin: sales - cost, purchases, expenses,
    net: sales - cost - expenses,
    qty: points.reduce((s, p) => s + p.qty, 0),
    operations: points.reduce((s, p) => s + p.count, 0),
    products: products.filter(p => p.qty > 0).length,
  };
}

/** Somme de plusieurs activités sur la même période — la vue globale. */
export function consolidateAnalytics(parts: PartAnalytics[], from: string, to: string, granularity: Granularity): PartAnalytics {
  const buckets: Bucket[] = parts[0]?.points.map(p => ({ key: p.key, label: p.label, date: p.date })) || [];
  const points: TimePoint[] = buckets.map((b, i) => {
    const cells = parts.map(p => p.points[i]).filter(Boolean);
    const add = (f: (x: TimePoint) => number) => cells.reduce((s, c) => s + f(c), 0);
    return {
      ...b,
      qty: add(c => c.qty), revenue: add(c => c.revenue), cost: add(c => c.cost),
      gain: add(c => c.gain), count: add(c => c.count),
      purchases: add(c => c.purchases), expenses: add(c => c.expenses), net: add(c => c.net),
    };
  });
  // Deux activités peuvent vendre un article du même nom : on les garde
  // distinctes, préfixées de leur emoji, pour que le classement reste lisible.
  const products = parts
    .flatMap(p => p.products.map(x => ({ ...x, id: `${p.key}:${x.id}`, name: `${p.emoji} ${x.name}` })))
    .sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0);
  products.forEach(p => { p.share = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0; });

  const dead = parts.flatMap(p => p.dead.map(d => ({ ...d, id: `${p.key}:${d.id}`, name: `${p.emoji} ${d.name}` })))
    .sort((a, b) => b.stockValue - a.stockValue);

  return finalize({
    key: 'global', label: 'Toutes les activités', emoji: '🏢', from, to, granularity,
    points, products,
    productions: parts.flatMap(p => p.productions),
    categories: groupByCategory(products),
    dead,
    totals: totalsOf(points, products),
  });
}
