/**
 * ─── Armoires : les produits des MAGASINS rangés sur la piste ──────────────────
 *
 * Une armoire reçoit ses produits par transfert depuis un magasin — le premier
 * (`lavage`) ou le second (`magasin2`). Les fiches produits restent celles du
 * magasin : ce fichier sait les retrouver, les chercher et les décrire, quel
 * que soit le magasin d'origine.
 *
 * Bouteilles de gaz (produits CONSIGNÉS) — convention appliquée partout :
 *   • `quantity`      = nombre TOTAL de contenants (pleins + vides) ;
 *   • `emptyQuantity` = combien parmi eux sont VIDES ;
 *   • pleins          = total − vides.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizState, BizProduct, MODULES, MAGASIN_KEYS, activeMagasinKeys,
  productSearchFields, isSellableProduct,
} from './bizConfig';
import type {
  MagasinKey, Armoire, ArmoireStockItem, StockTransfer, ArmoireSale, ArmoirePurchase,
} from '../store/AppContext';

/** Un produit d'un magasin, avec le magasin qui le porte. */
export interface MagasinProduct {
  product: BizProduct;
  moduleKey: MagasinKey;
}

/** Nom affiché d'un magasin (celui choisi dans Paramètres → Magasins). */
export const magasinLabel = (k?: MagasinKey | null): string => MODULES[k || 'lavage'].label;

/**
 * Les produits transférables des magasins ACTIFS — jamais les matières
 * premières, qui ne se vendent pas telles quelles.
 */
export function magasinProducts(biz: BizState, keys: MagasinKey[] = activeMagasinKeys() as MagasinKey[]): MagasinProduct[] {
  return keys.flatMap(k => ((biz?.[k]?.products || []) as BizProduct[])
    .filter(isSellableProduct)
    .map(product => ({ product, moduleKey: k })));
}

/** La fiche d'un produit, cherchée dans les DEUX magasins (même désactivé). */
export function findMagasinProduct(biz: BizState, productId?: string | null): MagasinProduct | undefined {
  if (!productId) return undefined;
  for (const k of MAGASIN_KEYS as MagasinKey[]) {
    const product = ((biz?.[k]?.products || []) as BizProduct[]).find(p => p.id === productId);
    if (product) return { product, moduleKey: k };
  }
  return undefined;
}

/** Le produit correspond-il à la recherche (nom, code-barres, références…) ? */
export function productMatches(p: BizProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return productSearchFields(p).some(f => f.toLowerCase().includes(q));
}

/** Recherche dans le catalogue des magasins — 20 résultats au plus. */
export function searchMagasinProducts(list: MagasinProduct[], query: string, limit = 20): MagasinProduct[] {
  if (!query.trim()) return [];
  return list.filter(x => productMatches(x.product, query)).slice(0, limit);
}

/** Pleines / vides d'une ligne de stock d'armoire. */
export function armoireSplit(row?: Pick<ArmoireStockItem, 'quantity' | 'emptyQuantity'> | null) {
  const total = row?.quantity || 0;
  const empty = row?.emptyQuantity || 0;
  return { total, empty, full: total - empty };
}

/** Les pompes rattachées à une armoire, en clair. */
export const armoirePumpIds = (a?: Pick<Armoire, 'pumpIds'> | null): string[] => a?.pumpIds || [];

/**
 * L'armoire d'un pompiste pendant sa brigade : celle qui dessert l'une des
 * pompes qu'il tient, sinon celle de sa piste, sinon aucune (toutes restent
 * proposées à la saisie).
 */
export function armoiresOfPompiste(
  armoires: Armoire[], pumpIds: string[], trackId?: string | null,
): Armoire[] {
  const byPump = armoires.filter(a => armoirePumpIds(a).some(id => pumpIds.includes(id)));
  if (byPump.length) return byPump;
  if (trackId) {
    const byTrack = armoires.filter(a => a.trackId === trackId);
    if (byTrack.length) return byTrack;
  }
  return [];
}

/** Tout ce qu'a vécu un produit dans une armoire, du plus récent au plus ancien. */
export interface ArmoireMovement {
  id: string;
  date: string;
  kind: 'Transfert' | 'Achat' | 'Remplissage' | 'Vente';
  /** Variation affichée : « +5 », « −2 », « 3 vidée(s) »… */
  qtyLabel: string;
  quantity: number;
  /** Bascule vide / plein, pour un produit consigné. */
  consigne?: string;
  detail: string;
  amount?: number;
}

export function armoireProductMovements(
  armoireId: string,
  productId: string,
  transfers: StockTransfer[],
  purchases: ArmoirePurchase[],
  sales: ArmoireSale[],
  pompisteName: (id?: string) => string,
): ArmoireMovement[] {
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('fr-FR');
  const out: ArmoireMovement[] = [];

  transfers.filter(t => t.armoireId === armoireId).forEach(t => (t.items || [])
    .filter(it => it.productId === productId)
    .forEach(it => out.push({
      id: `tr-${it.id}`, date: t.date, kind: 'Transfert', quantity: it.quantity,
      qtyLabel: `+${fmt(it.quantity)}`,
      consigne: it.consigneState === 'VIDE' ? 'Vides' : it.consigneState === 'PLEIN' ? 'Pleines' : undefined,
      detail: `Depuis ${magasinLabel(t.moduleKey)}${t.source === 'produits' ? ' · fiche produit' : ''}`,
    })));

  purchases.filter(p => p.armoireId === armoireId && p.productId === productId).forEach(p => out.push({
    id: `pu-${p.id}`, date: p.date, kind: p.consigneMode === 'REMPLISSAGE' ? 'Remplissage' : 'Achat', quantity: p.quantity,
    // Un remplissage ne fait entrer aucune bouteille : il en requalifie.
    qtyLabel: p.consigneMode === 'REMPLISSAGE' ? `${fmt(p.quantity)} remplie(s)` : `+${fmt(p.quantity)}`,
    consigne: p.consigneMode === 'REMPLISSAGE' ? 'Vide → Plein' : p.consigneMode === 'VIDE' ? 'Vides' : undefined,
    detail: `${pompisteName(p.pompisteId)}${p.supplierName ? ` · ${p.supplierName}` : ''}`,
    amount: p.total,
  }));

  sales.filter(s => s.armoireId === armoireId && s.productId === productId).forEach(s => out.push({
    id: `sa-${s.id}`, date: s.date, kind: 'Vente', quantity: s.quantity,
    qtyLabel: s.consigne ? `${fmt(s.quantity)} vidée(s)` : `−${fmt(s.quantity)}`,
    consigne: s.consigne ? 'Plein → Vide' : undefined,
    detail: pompisteName(s.pompisteId),
    amount: s.total,
  }));

  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
