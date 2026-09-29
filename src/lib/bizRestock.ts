/**
 * ─── Retour de marchandise en stock (Cafétéria / Lavage) ───────────────────────
 *
 * TOUT ce qui sort du stock doit pouvoir y revenir, et par le même chemin.
 * Une vente, une intervention de lavage / vidange ou un bon d'achat qu'on
 * SUPPRIME est une opération qui n'a jamais eu lieu : la marchandise qu'elle
 * avait fait sortir (ou entrer) doit retrouver sa place, sinon le catalogue
 * annonce un stock que la partie n'a pas — ou cache celui qu'elle a.
 *
 * Auparavant, seuls le « Retour produit » d'une vente et la suppression d'un bon
 * d'achat rendaient quoi que ce soit. Supprimer une vente ou une intervention
 * effaçait la ligne et laissait la marchandise dehors pour toujours.
 *
 * Le point de vente vend TROIS choses, et chacune revient ailleurs :
 *   • un produit du catalogue          → sa quantité remonte en Gestion de stock ;
 *   • une production du comptoir       → la quantité remonte sur sa ligne de
 *     comptoir (recréée si elle avait disparu, une fois écoulée) ;
 *   • une fiche technique en vente directe → ce sont ses INGRÉDIENTS qui
 *     reviennent en stock, puisque ce sont eux qui en étaient sortis à la vente.
 *
 * Les quantités sont CUMULÉES avant d'être écrites : deux lignes qui touchent la
 * même matière première (deux fiches qui partagent un ingrédient) repartiraient
 * sinon du même stock lu au début, et la seconde écraserait la première.
 *
 * Le stock peut repasser en NÉGATIF : c'est voulu, le point de vente vend à
 * découvert et le manque se rattrape au prochain achat.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { newId } from './utils';
import { BizFiche, BizLineItem, ModuleState, formatQty, roundQty } from './bizConfig';

/** Ce que des lignes rendent — calculé d'abord, écrit ensuite. */
export interface RestockPlan {
  /** productId → quantité à rendre au catalogue (négatif = sortie). */
  stock: Map<string, number>;
  /** id de ligne comptoir → quantité à rendre au comptoir. */
  comptoir: Map<string, number>;
  /** Production dont la ligne de comptoir n'existe plus : elle sera recréée. */
  orphans: BizLineItem[];
}

/** API minimale de `useBiz(moduleKey)` dont ce module a besoin. */
export interface RestockApi {
  state: ModuleState;
  update: (coll: 'products' | 'comptoir', item: any) => void;
  add: (coll: 'comptoir', item: any) => void;
}

export const bumpQty = (m: Map<string, number>, id: string, qty: number) =>
  m.set(id, (m.get(id) || 0) + qty);

/** D'où sortait une ligne vendue — donc où sa quantité doit revenir. */
export type SaleOrigin =
  | { kind: 'product'; id: string }
  | { kind: 'comptoir'; id: string }
  | { kind: 'fiche'; fiche: BizFiche }
  | null;

/**
 * L'IDENTIFIANT d'abord, sur les trois collections, AVANT tout rapprochement par
 * nom : une production mise au comptoir porte le nom de sa fiche technique, et
 * chercher par nom trop tôt renverrait une fiche vendue en direct vers cette
 * ligne de comptoir au lieu de rendre ses ingrédients au stock.
 */
export function originOf(state: ModuleState, l: BizLineItem): SaleOrigin {
  const { products, comptoir, fiches } = state;
  const id = l.productId;
  if (products.some(p => p.id === id)) return { kind: 'product', id };
  if (comptoir.some(c => c.id === id)) return { kind: 'comptoir', id };
  const f = fiches.find(x => x.id === id);
  if (f) return { kind: 'fiche', fiche: f };

  // Repli par nom — pour les lignes d'avant les identifiants stables.
  const pn = products.find(x => x.name === l.productName);
  if (pn) return { kind: 'product', id: pn.id };
  const cn = comptoir.find(x => x.productName === l.productName);
  if (cn) return { kind: 'comptoir', id: cn.id };
  const fn = fiches.find(x => x.name === l.productName);
  if (fn) return { kind: 'fiche', fiche: fn };
  return null;
}

/** Plan de retour pour des lignes vendues — rien n'est encore écrit. */
export function restockPlan(state: ModuleState, lines: BizLineItem[]): RestockPlan {
  const plan: RestockPlan = { stock: new Map(), comptoir: new Map(), orphans: [] };

  (lines || []).forEach(l => {
    const qty = Number(l.qty) || 0;
    if (qty === 0) return;
    const origin = originOf(state, l);
    if (!origin) { plan.orphans.push(l); return; }
    if (origin.kind === 'product') { bumpQty(plan.stock, origin.id, qty); return; }
    if (origin.kind === 'comptoir') { bumpQty(plan.comptoir, origin.id, qty); return; }

    const f = origin.fiche;
    const per = Math.max(1, f.outputQuantity);
    f.ingredients.forEach(ing => {
      // Un semi-fini (autre fiche) n'a pas de ligne de stock : rien à rendre.
      if (ing.sourceType === 'fiche') return;
      bumpQty(plan.stock, ing.productId, (ing.quantityUsed * qty) / per);
    });
  });

  return plan;
}

/** Écrit un plan. Chaque produit n'est touché qu'UNE fois, delta déjà cumulé. */
export function applyRestock(api: RestockApi, plan: RestockPlan) {
  const { products, comptoir } = api.state;
  plan.stock.forEach((qty, productId) => {
    if (!qty) return;
    const p = products.find(x => x.id === productId);
    if (p) api.update('products', { ...p, currentQty: roundQty(p.currentQty + qty) });
  });
  plan.comptoir.forEach((qty, lineId) => {
    if (!qty) return;
    const c = comptoir.find(x => x.id === lineId);
    if (c) api.update('comptoir', { ...c, qty: roundQty(c.qty + qty) });
  });
  // Production dont la ligne de comptoir n'existe plus : on la recrée avec le
  // coût figé sur la vente, comme le fait la récupération d'une destruction.
  plan.orphans.forEach(l => api.add('comptoir', {
    id: newId(), productName: l.productName, qty: roundQty(Number(l.qty) || 0),
    unitPrice: l.unitPrice, purchasePrice: l.unitCost || 0,
    date: new Date().toISOString(),
  }));
}

/** Raccourci : calcule et applique en une fois. */
export function restockLines(api: RestockApi, lines: BizLineItem[]) {
  applyRestock(api, restockPlan(api.state, lines));
}

/**
 * Où une ligne revient — sert à dire à l'utilisateur, AVANT qu'il ne confirme,
 * quelle quantité va réapparaître et sur quel écran.
 */
export function restockTargetOf(
  state: ModuleState, l: BizLineItem,
): { label: string; detail: string } {
  const { products, comptoir } = state;
  const origin = originOf(state, l);
  if (!origin) return { label: 'Comptoir (ligne recréée)', detail: formatQty(Number(l.qty) || 0) };

  if (origin.kind === 'product') {
    const p = products.find(x => x.id === origin.id);
    return { label: 'Gestion de stock', detail: `${formatQty(Number(l.qty) || 0)} ${p?.unit || ''}`.trim() };
  }
  if (origin.kind === 'comptoir') {
    const c = comptoir.find(x => x.id === origin.id);
    return { label: 'Comptoir', detail: `${formatQty(Number(l.qty) || 0)} ${c?.unit || ''}`.trim() };
  }

  const f = origin.fiche;
  const per = Math.max(1, f.outputQuantity);
  const ings = f.ingredients.filter(i => i.sourceType !== 'fiche');
  return {
    label: 'Gestion de stock (ingrédients)',
    detail: ings.length
      ? ings.map(i => `${i.productName} ${formatQty((i.quantityUsed * (Number(l.qty) || 0)) / per)} ${i.unit || ''}`.trim()).join(' • ')
      : 'aucun ingrédient de stock',
  };
}

/**
 * Phrase de confirmation listant ce qui va revenir en stock, ligne par ligne.
 * L'utilisateur voit AVANT de valider ce que chaque produit va devenir — même
 * mécanique que la suppression d'un bon d'achat, en sens inverse.
 */
export function describeRestock(state: ModuleState, lines: BizLineItem[]): string {
  const plan = restockPlan(state, lines);
  const out: string[] = [];

  plan.stock.forEach((qty, productId) => {
    if (!qty) return;
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    const after = roundQty(p.currentQty + qty);
    out.push(`• ${p.name} : +${formatQty(qty)}${p.unit ? ` ${p.unit}` : ''}`
      + `   (${formatQty(p.currentQty)} → ${formatQty(after)})`);
  });
  plan.comptoir.forEach((qty, lineId) => {
    if (!qty) return;
    const c = state.comptoir.find(x => x.id === lineId);
    if (!c) return;
    const after = roundQty(c.qty + qty);
    out.push(`• ${c.productName} (comptoir) : +${formatQty(qty)}${c.unit ? ` ${c.unit}` : ''}`
      + `   (${formatQty(c.qty)} → ${formatQty(after)})`);
  });
  plan.orphans.forEach(l => {
    out.push(`• ${l.productName} : ${formatQty(Number(l.qty) || 0)} — ligne de comptoir recréée`);
  });

  return out.join('\n');
}

/** Total des quantités remises en stock — pour le message de succès. */
export function totalRestocked(plan: RestockPlan): number {
  let total = 0;
  plan.stock.forEach(q => { total += q; });
  plan.comptoir.forEach(q => { total += q; });
  plan.orphans.forEach(l => { total += Number(l.qty) || 0; });
  return roundQty(total);
}
