/**
 * ─── Brouillons de produits ────────────────────────────────────────────────────
 *
 *  À QUOI ÇA SERT
 *  Un produit créé est d'abord écrit ICI, dans le navigateur, AVANT toute
 *  tentative d'enregistrement sur le serveur. Le brouillon n'est effacé que
 *  lorsque le serveur a CONFIRMÉ la création. Tant qu'il reste, c'est la preuve
 *  que quelque chose n'est pas passé :
 *
 *      en attente  le serveur n'a pas encore répondu
 *      échec       le serveur a refusé ou était injoignable
 *      perdu       au redémarrage, le produit n'est plus dans le catalogue
 *
 *  L'écran « Gestion de stock » affiche ces brouillons dans son onglet
 *  « Brouillons » avec un bouton qui les renvoie dans le catalogue.
 *
 *  POURQUOI EN DEHORS DU STORE
 *  Justement parce que c'est le store qui peut échouer. Le brouillon vit dans
 *  son propre espace `localStorage`, écrit de façon SYNCHRONE au moment du clic :
 *  ni un rafraîchissement immédiat, ni une coupure réseau, ni un écrasement par
 *  un autre poste ne peuvent le faire disparaître.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizProduct, ModuleKey } from './bizConfig';

const STORAGE_KEY = 'stationpro_product_drafts_v1';

export type DraftStatus = 'pending' | 'failed' | 'lost' | 'synced';

export interface ProductDraft {
  /** Identifiant du brouillon (≠ id du produit). */
  id: string;
  moduleKey: ModuleKey;
  /** Le produit complet, tel qu'il a été saisi. */
  product: BizProduct;
  status: DraftStatus;
  /** Première tentative. */
  createdAt: string;
  /** Dernière tentative d'enregistrement. */
  lastTriedAt?: string;
  attempts: number;
  /** Message du serveur quand l'enregistrement a échoué. */
  error?: string;
  /** Qui a saisi le produit. */
  createdBy?: string;
  /** D'où venait la saisie : gestion de stock ou formulaire d'achat. */
  origin?: 'stock' | 'purchase';
}

// ─── Persistance ───────────────────────────────────────────────────────────────

function readAll(): ProductDraft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(d => d?.id && d?.product?.id) : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: ProductDraft[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* quota — le brouillon en mémoire reste affiché */ }
  emit();
}

// ─── Abonnement (les brouillons vivent hors de React) ──────────────────────────

const listeners = new Set<() => void>();
let cache: ProductDraft[] | null = null;

function emit() {
  cache = null;
  listeners.forEach(l => { try { l(); } catch { /* l'erreur d'un écouteur n'est pas la nôtre */ } });
}

if (typeof window !== 'undefined') {
  // Un autre onglet a touché aux brouillons : le nôtre se remet à jour.
  window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) emit(); });
}

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Instantané stable (même référence tant que rien ne change) — pour `useSyncExternalStore`. */
export function getDraftsSnapshot(): ProductDraft[] {
  if (!cache) cache = readAll();
  return cache;
}

// ─── Lecture ───────────────────────────────────────────────────────────────────

/** Brouillons NON confirmés d'une partie, du plus récent au plus ancien. */
export function listDrafts(moduleKey: ModuleKey): ProductDraft[] {
  return getDraftsSnapshot()
    .filter(d => d.moduleKey === moduleKey && d.status !== 'synced')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ─── Écriture ──────────────────────────────────────────────────────────────────

/**
 * Enregistre un brouillon AVANT toute tentative réseau. Appelé au clic sur
 * « Créer » : à partir de cet instant, le produit ne peut plus être perdu.
 */
export function saveDraft(input: {
  moduleKey: ModuleKey;
  product: BizProduct;
  createdBy?: string;
  origin?: ProductDraft['origin'];
}): ProductDraft {
  const draft: ProductDraft = {
    id: `draft-${input.product.id}`,
    moduleKey: input.moduleKey,
    product: input.product,
    status: 'pending',
    createdAt: new Date().toISOString(),
    lastTriedAt: new Date().toISOString(),
    attempts: 1,
    createdBy: input.createdBy,
    origin: input.origin,
  };
  const all = readAll().filter(d => d.id !== draft.id);
  writeAll([draft, ...all]);
  return draft;
}

/** Le serveur a confirmé : le brouillon n'a plus de raison d'être. */
export function resolveDraft(draftId: string): void {
  const all = readAll();
  const next = all.filter(d => d.id !== draftId);
  if (next.length !== all.length) writeAll(next);
}

/** L'enregistrement a échoué — le brouillon reste, avec la raison. */
export function failDraft(draftId: string, error?: string): void {
  patchDraft(draftId, d => ({
    ...d,
    status: 'failed',
    error: error || 'Enregistrement impossible',
    lastTriedAt: new Date().toISOString(),
  }));
}

/** Nouvelle tentative en cours. */
export function retryDraft(draftId: string): void {
  patchDraft(draftId, d => ({
    ...d,
    status: 'pending',
    error: undefined,
    attempts: d.attempts + 1,
    lastTriedAt: new Date().toISOString(),
  }));
}

/** L'utilisateur abandonne le brouillon. */
export function discardDraft(draftId: string): void {
  resolveDraft(draftId);
}

/** Met à jour le produit d'un brouillon (correction avant renvoi). */
export function updateDraftProduct(draftId: string, product: BizProduct): void {
  patchDraft(draftId, d => ({ ...d, product }));
}

function patchDraft(draftId: string, fn: (d: ProductDraft) => ProductDraft): void {
  const all = readAll();
  const idx = all.findIndex(d => d.id === draftId);
  if (idx < 0) return;
  const next = [...all];
  next[idx] = fn(all[idx]);
  writeAll(next);
}

// ─── Réconciliation ────────────────────────────────────────────────────────────

/**
 * Confronte les brouillons à la réalité : le catalogue chargé d'un côté, ce que
 * la base a réellement accepté de l'autre.
 *
 *  • produit présent ET sa ligne est en base → le brouillon a fait son travail,
 *    il part ;
 *  • produit présent mais sa ligne attend encore d'être écrite → le brouillon
 *    RESTE : être dans le catalogue de ce poste ne prouve rien ;
 *  • produit absent du catalogue             → « perdu » : c'est exactement le
 *    symptôme « j'ai créé un produit, j'ai rafraîchi, il n'y était plus ». Le
 *    brouillon reste sous les yeux de l'utilisateur avec son bouton de renvoi.
 *
 * `isConfirmed` se prononce PRODUIT PAR PRODUIT depuis que les fiches ont leur
 * propre table : une fiche bien écrite n'a plus à attendre que TOUT le reste
 * (ventes, caisse, dépenses…) soit enregistré pour que son brouillon disparaisse.
 *
 * Un brouillon tout juste créé (< 20 s) est laissé tranquille : son
 * enregistrement est probablement encore en vol.
 */
export function reconcileDrafts(
  moduleKey: ModuleKey,
  productIds: Set<string>,
  /** Vrai quand la base a accusé réception de CE produit. */
  isConfirmed: (productId: string) => boolean,
): void {
  const all = readAll();
  const graceLimit = new Date(Date.now() - 20_000).toISOString();
  let changed = false;

  const next: ProductDraft[] = [];
  for (const d of all) {
    if (d.moduleKey !== moduleKey) { next.push(d); continue; }

    if (productIds.has(d.product.id)) {
      // Confirmé : le produit est dans le catalogue ET sa ligne a été acceptée
      // par la base. Vrai aussi après un échec rattrapé tout seul par une
      // tentative suivante : l'alerte s'efface d'elle-même au lieu de rester à
      // tort.
      if (isConfirmed(d.product.id)) { changed = true; continue; }
      next.push(d);
      continue;
    }

    // Absent du catalogue.
    if (d.status === 'pending' && d.createdAt > graceLimit) { next.push(d); continue; }
    if (d.status !== 'lost') {
      changed = true;
      next.push({ ...d, status: 'lost', error: d.error || 'Le produit n\'est plus dans le catalogue' });
      continue;
    }
    next.push(d);
  }

  if (changed) writeAll(next);
}

/** Libellés affichés dans l'onglet « Brouillons ». */
export const DRAFT_STATUS_META: Record<Exclude<DraftStatus, 'synced'>, { label: string; hint: string }> = {
  pending: {
    label: 'En attente',
    hint: 'Enregistrement en cours — le serveur n\'a pas encore confirmé.',
  },
  failed: {
    label: 'Échec',
    hint: 'Le serveur a refusé l\'enregistrement ou était injoignable.',
  },
  lost: {
    label: 'Perdu',
    hint: 'Le produit n\'était plus dans le catalogue au redémarrage.',
  },
};
