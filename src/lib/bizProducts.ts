/**
 * ─── Les produits vont DIRECTEMENT en base, une ligne par produit ──────────────
 *
 *  LE PROBLÈME CORRIGÉ ICI
 *  Tout ce que contiennent les parties commerciales tenait dans UNE ligne JSON
 *  (`biz_store`) réécrite EN ENTIER à la moindre modification. Cette ligne pèse
 *  aujourd'hui 665 Ko — dont 567 Ko rien que pour l'historique des ventes de la
 *  Cafétéria. Créer un produit de 800 octets envoyait donc 665 Ko sur le lien de
 *  la station : au-delà de huit secondes la requête était abandonnée, et l'écran
 *  affichait « Le serveur refuse les enregistrements — TimeoutError ». La base
 *  était pourtant en parfait état : c'est le POIDS de l'envoi qui échouait.
 *
 *  CE QUE FAIT CE MODULE
 *  Le catalogue a sa propre table (`public.biz_products`, migration
 *  `2026-08-15_biz_products_table.sql`) : une ligne par produit, ~800 octets.
 *  Créer, modifier ou supprimer un produit est désormais une écriture minuscule
 *  qui revient en quelques centaines de millisecondes et dont on connaît le
 *  VERDICT — c'est lui qui décide si le brouillon peut être effacé.
 *
 *  CE QUI RESTE COMME AVANT
 *  Le blob continue de porter une copie des produits. La table fait AUTORITÉ
 *  (ses lignes sont appliquées par-dessus au chargement), mais la copie du blob
 *  reste le filet : sauvegarde, restauration, et une base où la migration n'est
 *  pas encore passée continuent de fonctionner exactement comme avant.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from './supabase';
import { BizProduct, BizState, ModuleKey, isModuleKey } from './bizConfig';
import { isMissingTable } from './bizSessions';
import { MODULE_KEYS, SyncModuleState, mergeRows } from './bizSync';

/** Ligne de `public.biz_products` — seules ces trois colonnes sont écrites. */
interface BizProductRow {
  id: string;
  module_key: string;
  /** La fiche complète, telle que l'application la lit (`_upd` compris). */
  data: BizProduct;
}

/** Envoi le plus gros accepté d'un coup — au-delà, l'écriture est découpée. */
const CHUNK = 100;

/** Ce qu'une écriture de produit(s) rend à l'appelant. */
export interface ProductWriteResult {
  ok: boolean;
  error?: string;
  /** La table n'existe pas encore : l'appelant retombe sur le blob. */
  missingTable?: boolean;
  /**
   * Les fiches que la base a refusées, quand les autres sont bien passées. Sans
   * ce détail, une seule ligne malade retiendrait tout le catalogue en attente —
   * y compris les produits créés ensuite, qui n'y sont pour rien.
   */
  failedIds?: string[];
}

/**
 * Panne de transport (réseau coupé, serveur muet) par opposition à un refus
 * portant sur la ligne elle-même. La distinction décide s'il vaut la peine de
 * réessayer ligne par ligne : sur un réseau coupé, ce serait cent requêtes
 * vouées à expirer l'une après l'autre.
 */
function isTransportError(message?: string): boolean {
  return /timeout|n'a pas répondu|abort|failed to fetch|networkerror|load failed|réseau|injoignable/i
    .test(message || '');
}

/** Ce qu'une lecture du catalogue rend à l'appelant. */
export type ProductsLoadResult =
  | { status: 'ok'; products: Record<ModuleKey, BizProduct[]> }
  /** Migration non passée — le blob reste la seule source. */
  | { status: 'missing' }
  /** Réseau ou base indisponible : ne RIEN conclure, surtout pas « vide ». */
  | { status: 'error'; error: string };

/**
 * Message lisible à afficher à l'utilisateur. Une erreur Supabase brute
 * (« FetchError », « AbortError ») ne dit rien à un gérant de station : ce qui
 * lui sert, c'est de savoir s'il doit réessayer, appeler, ou attendre.
 */
export function readableError(err: { code?: string; message?: string } | null | undefined): string {
  const msg = err?.message || 'Erreur inconnue';
  if (err?.code === '42501' || /row-level security/i.test(msg)) {
    return "Votre compte n'a pas le droit d'écrire dans le catalogue.";
  }
  if (/timeout|n'a pas répondu|aborted/i.test(msg)) {
    return "Le serveur n'a pas répondu à temps — le produit est gardé et sera renvoyé.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Serveur injoignable — vérifiez la connexion du poste.';
  }
  return msg;
}

// ─── Lecture ───────────────────────────────────────────────────────────────────

/**
 * Tout le catalogue des deux parties. La distinction entre « table absente » et
 * « lecture en échec » est essentielle : la première autorise le repli sur le
 * blob, la seconde ne doit JAMAIS faire croire que le catalogue est vide.
 */
export async function loadBizProducts(): Promise<ProductsLoadResult> {
  try {
    const { data, error } = await supabase
      .from('biz_products').select('id, module_key, data');
    if (error) {
      if (isMissingTable(error)) return { status: 'missing' };
      return { status: 'error', error: readableError(error) };
    }
    const out = Object.fromEntries(MODULE_KEYS.map(k => [k, [] as BizProduct[]])) as Record<ModuleKey, BizProduct[]>;
    for (const row of (data || []) as BizProductRow[]) {
      const key = row.module_key as ModuleKey;
      if (!isModuleKey(key)) continue;
      const product = rowToProduct(row);
      if (product) out[key].push(product);
    }
    return { status: 'ok', products: out };
  } catch (e: any) {
    return { status: 'error', error: readableError(e) };
  }
}

/** La fiche portée par une ligne — son `id` fait foi sur celui du JSON. */
function rowToProduct(row: BizProductRow): BizProduct | null {
  const data = row?.data;
  if (!data || typeof data !== 'object') return null;
  return { ...(data as BizProduct), id: row.id };
}

// ─── Écriture ──────────────────────────────────────────────────────────────────

export interface ProductRowInput { module: ModuleKey; product: BizProduct }

/**
 * Écrit une ou plusieurs fiches. Les colonnes lisibles de la table (nom, stock,
 * prix…) sont déduites du JSON par un déclencheur : on n'envoie que la fiche.
 */
export async function saveBizProducts(rows: ProductRowInput[]): Promise<ProductWriteResult> {
  if (!rows.length) return { ok: true };

  const failedIds: string[] = [];
  let firstError: string | undefined;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await upsertRows(slice);
    if (res.missingTable) return res;
    if (res.ok) continue;

    // Le lot est refusé. Si ce n'est pas le réseau, une seule fiche est
    // probablement en cause : on les repasse une par une pour que les autres
    // arrivent quand même, et pour savoir laquelle bloque.
    if (slice.length > 1 && !isTransportError(res.error)) {
      for (const row of slice) {
        const one = await upsertRows([row]);
        if (one.missingTable) return one;
        if (one.ok) continue;
        failedIds.push(row.product.id);
        firstError = firstError || one.error;
      }
      continue;
    }

    slice.forEach(r => failedIds.push(r.product.id));
    firstError = firstError || res.error;
  }

  return failedIds.length ? { ok: false, error: firstError, failedIds } : { ok: true };
}

async function upsertRows(rows: ProductRowInput[]): Promise<ProductWriteResult> {
  try {
    const payload: BizProductRow[] = rows.map(r => ({
      id: r.product.id,
      module_key: r.module,
      data: r.product,
    }));
    const { error } = await supabase
      .from('biz_products').upsert(payload as any, { onConflict: 'id' });
    if (!error) return { ok: true };
    if (isMissingTable(error)) return { ok: false, missingTable: true, error: 'Table des produits absente' };
    return { ok: false, error: readableError(error) };
  } catch (e: any) {
    return { ok: false, error: readableError(e) };
  }
}

/** Retire des fiches. La pierre tombale du blob reste, elle, la trace durable. */
export async function deleteBizProducts(ids: string[]): Promise<ProductWriteResult> {
  if (!ids.length) return { ok: true };

  const failedIds: string[] = [];
  let firstError: string | undefined;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    try {
      const { error } = await supabase.from('biz_products').delete().in('id', slice);
      if (!error) continue;
      if (isMissingTable(error)) return { ok: false, missingTable: true, error: 'Table des produits absente' };
      slice.forEach(id => failedIds.push(id));
      firstError = firstError || readableError(error);
    } catch (e: any) {
      slice.forEach(id => failedIds.push(id));
      firstError = firstError || readableError(e);
    }
  }

  return failedIds.length ? { ok: false, error: firstError, failedIds } : { ok: true };
}

// ─── Fusion dans l'état de l'application ───────────────────────────────────────

/**
 * Applique le catalogue de la base par-dessus l'état courant, ligne par ligne :
 *
 *   • une fiche présente des deux côtés → la version écrite le plus récemment ;
 *   • une fiche que la base seule connaît (créée sur un autre poste) → ajoutée ;
 *   • une fiche que ce poste seul connaît (pas encore envoyée) → CONSERVÉE ;
 *   • une fiche supprimée (pierre tombale du blob) → jamais ressuscitée.
 *
 * Rend le MÊME objet quand rien ne change : sans cela, chaque notification temps
 * réel d'un autre poste salirait l'état et déclencherait un réenregistrement
 * complet du blob pour rien.
 */
export function mergeRemoteProducts(
  state: BizState,
  remote: Record<ModuleKey, BizProduct[]>,
): BizState {
  const next: any = { ...state };
  let changed = false;

  for (const key of MODULE_KEYS) {
    const mod = state[key] as SyncModuleState | undefined;
    if (!mod) continue;
    const base = Array.isArray(mod.products) ? mod.products : [];
    const merged = mergeRows(base, remote[key] || [], mod.deletedIds);
    if (sameProducts(base, merged)) continue;
    changed = true;
    next[key] = { ...mod, products: merged };
  }

  return changed ? (next as BizState) : state;
}

/** Deux listes identiques — même contenu, dans le même ordre. */
function sameProducts(a: BizProduct[], b: BizProduct[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i]?.id !== b[i]?.id) return false;
    if ((a[i] as any)?._upd !== (b[i] as any)?._upd) return false;
  }
  return true;
}

/**
 * Les fiches de ce poste que la base n'a pas (ou plus à jour ici) — c'est le
 * rattrapage d'après démarrage : ce qui a été créé pendant une panne réseau, ou
 * juste avant la fermeture du navigateur, repart tout seul.
 */
export function productsMissingFromRemote(
  state: BizState,
  remote: Record<ModuleKey, BizProduct[]>,
): ProductRowInput[] {
  const out: ProductRowInput[] = [];
  for (const key of MODULE_KEYS) {
    const mod = state[key] as SyncModuleState | undefined;
    if (!mod) continue;
    const byId = new Map((remote[key] || []).map(p => [p.id, p]));
    for (const local of (Array.isArray(mod.products) ? mod.products : [])) {
      if (!local?.id) continue;
      const known = byId.get(local.id);
      const localStamp = (local as any)._upd || '';
      const knownStamp = (known as any)?._upd || '';
      if (!known || localStamp > knownStamp) out.push({ module: key, product: local });
    }
  }
  return out;
}
