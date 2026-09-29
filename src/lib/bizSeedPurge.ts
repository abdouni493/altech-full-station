/**
 * ─── Nettoyage du jeu de démonstration retiré ──────────────────────────────────
 *
 * Les parties Cafétéria et Lavage ont longtemps démarré sur un jeu de données
 * constant. Il a disparu du code, mais il dort encore dans les copies déjà
 * enregistrées : celle du navigateur ET la ligne `biz_store` de Supabase. Ce
 * module l'en retire — sans jamais couper les liens de ce que la station a
 * réellement saisi.
 *
 * Il est appelé par `migrate()` (`src/store/BizContext.tsx`), qui s'applique aux
 * DEUX copies, à chaque chargement comme à chaque enregistrement.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { MERGE_COLLECTIONS, nowIso, stampItem } from './bizSync';

/**
 * Empreinte des lignes du jeu de démonstration retiré : `cafeteria-prod-3`,
 * `lavage-rep-1`, `cafeteria-cli-2`… Toutes suivaient ce moule, alors que la
 * moindre ligne créée dans l'application porte un identifiant tiré au hasard
 * (`newId()` → UUID). La distinction est donc sans ambiguïté : rien de ce qui a
 * été saisi par un utilisateur ne peut correspondre à ce motif.
 *
 * `restaurant` et `magasin` en font partie : ces deux parties ont été retirées,
 * mais le `fold()` de `migrate()` a reversé leurs lignes — identifiants compris
 * — dans Cafétéria et Lavage, où elles s'affichent encore.
 */
export const SEED_ID =
  /^(?:cafeteria|lavage|restaurant|magasin)-(?:acp|cat|cli|cmp|csh|dst|exp|fic|mrq|prod|prd|pur|rep|role|sale|srv|sup|wrk)-\d+/;

const isSeedRow = (x: any): boolean => !!x?.id && SEED_ID.test(x.id);

/**
 * Identifiant d'une ligne de démonstration REPRISE par la station (voir
 * `purgeSeedRows`). Il se déduit de l'ancien, donc deux postes qui reprennent la
 * même ligne chacun de leur côté tombent sur le même identifiant : la fusion y
 * voit une seule ligne au lieu d'en créer deux. Et comme `SEED_ID` est ancré au
 * début, une ligne reprise n'est plus jamais reconnue comme constante.
 */
const adoptedId = (seedId: string): string => `station-${seedId}`;

/** Un accès rapide du point de vente s'écrit `produit:<id>`. */
const pinnedId = (key: string): string => key.slice(key.indexOf(':') + 1);

/** Tout ce qui, en profondeur, ressemble à un identifiant de démonstration. */
function collectSeedRefs(v: any, out: Set<string>): void {
  if (typeof v === 'string') { if (SEED_ID.test(v)) out.add(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectSeedRefs(x, out); return; }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) collectSeedRefs(v[k], out);
}

/** Réécrit en profondeur les identifiants repris. Rend une copie. */
function rewriteIds(v: any, map: Map<string, string>): any {
  if (typeof v === 'string') return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map(x => rewriteIds(x, map));
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = rewriteIds(v[k], map);
    return out;
  }
  return v;
}

/**
 * Retire les lignes de démonstration d'une partie — SANS jamais laisser une
 * ligne de la station pointer dans le vide.
 *
 * POURQUOI CE NETTOYAGE : ces lignes revenaient après avoir été supprimées. Un
 * poste ouvert sans copie locale repartait du jeu constant, le fusionnait avec
 * la copie du serveur, puis la lui renvoyait — annulant la suppression faite
 * ailleurs. Le jeu constant n'existe plus, mais il dort encore dans les copies
 * déjà enregistrées : celle du navigateur ET celle de Supabase. `migrate`
 * s'applique aux deux, donc les deux sont assainies.
 *
 * POURQUOI « REPRENDRE » PLUTÔT QUE TOUT EFFACER : les catégories, marques,
 * clients… proposés d'origine ont servi. Une catégorie de démonstration choisie
 * dans la liste déroulante à la création d'un vrai produit n'est plus une donnée
 * de démonstration : c'est la catégorie de ce produit. L'effacer sèchement — ce
 * que faisait la première version de ce nettoyage — vidait la liste des
 * catégories et laissait les produits rattachés à rien.
 *
 * Donc : une ligne de démonstration encore DÉSIGNÉE par une ligne de la station
 * est reprise (nouvel identifiant, mêmes données, toutes les références
 * suivies) ; les autres partent. On remonte les chaînes jusqu'au bout — une
 * vente désigne un produit, qui désigne sa catégorie — pour ne pas garder un
 * maillon sans le suivant.
 *
 * Les pierres tombales couvrent les identifiants d'origine : tant qu'un poste
 * tourne encore sur l'ancienne version et repousse le jeu constant, la fusion le
 * rejette au lieu de le réafficher.
 */
export function purgeSeedRows(mod: any): void {
  const listOf = (coll: string): any[] => (Array.isArray(mod[coll]) ? mod[coll] : []);
  const pins: any[] = Array.isArray(mod.posPinned) ? mod.posPinned : [];

  // Une fois le nettoyage passé, plus rien ne correspond : `migrate` tourne à
  // chaque enregistrement, il ne doit pas payer une inspection complète à vie.
  const hasSeed = MERGE_COLLECTIONS.some(c => listOf(c).some(isSeedRow))
    || pins.some(k => typeof k === 'string' && SEED_ID.test(pinnedId(k)));
  if (!hasSeed) return;

  // 1. Ce que les lignes DE LA STATION désignent encore.
  const referenced = new Set<string>();
  for (const coll of MERGE_COLLECTIONS) {
    for (const row of listOf(coll)) if (!isSeedRow(row)) collectSeedRefs(row, referenced);
  }
  for (const k of pins) if (typeof k === 'string' && SEED_ID.test(pinnedId(k))) referenced.add(pinnedId(k));

  // 2. …en remontant les chaînes : garder une vente sans son produit, ou un
  //    produit sans sa catégorie, ne réparerait rien.
  const keep = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const coll of MERGE_COLLECTIONS) {
      for (const row of listOf(coll)) {
        if (!isSeedRow(row) || keep.has(row.id) || !referenced.has(row.id)) continue;
        keep.add(row.id);
        collectSeedRefs(row, referenced);
        changed = true;
      }
    }
  }

  // 3. Les lignes retenues sont REPRISES par la station ; les autres partent.
  const at = nowIso();
  const adopted = new Map<string, string>();
  const killed: string[] = [];
  for (const coll of MERGE_COLLECTIONS) {
    const list = mod[coll];
    if (!Array.isArray(list)) continue;
    const next: any[] = [];
    for (const row of list) {
      if (!isSeedRow(row)) { next.push(row); continue; }
      killed.push(row.id);          // l'identifiant d'origine disparaît des deux côtés
      if (!keep.has(row.id)) continue;
      const fresh = adoptedId(row.id);
      adopted.set(row.id, fresh);
      next.push(stampItem({ ...row, id: fresh }, at));
    }
    mod[coll] = next;
  }

  // 4. Toutes les références suivent la reprise, où qu'elles soient imbriquées.
  if (adopted.size) {
    for (const coll of MERGE_COLLECTIONS) {
      if (Array.isArray(mod[coll])) mod[coll] = rewriteIds(mod[coll], adopted);
    }
  }

  // 5. Accès rapides du point de vente : repris, ou retirés faute de cible.
  if (pins.length) {
    const nextPins = pins
      .map((k: any) => {
        if (typeof k !== 'string') return null;
        const id = pinnedId(k);
        if (!SEED_ID.test(id)) return k;
        const fresh = adopted.get(id);
        return fresh ? `${k.slice(0, k.indexOf(':'))}:${fresh}` : null;
      })
      .filter((k: string | null): k is string => k !== null);
    if (nextPins.length !== pins.length || nextPins.some((k, i) => k !== pins[i])) {
      mod.posPinned = nextPins;
      mod.posPinnedUpd = at;
    }
  }

  if (!killed.length) return;
  const tombs: Record<string, string> = { ...(mod.deletedIds || {}) };
  for (const id of killed) if (!tombs[id]) tombs[id] = at;
  mod.deletedIds = tombs;
}

/** Nom réduit à sa forme comparable — « Café & Thé » et « cafe the » se rejoignent. */
function nameKey(s: string): string {
  return (s || '').trim().toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Rebranche un produit (ou une fiche) dont la catégorie ou la marque ne pointe
 * plus sur rien.
 *
 * La première version du nettoyage effaçait les catégories d'origine sans
 * regarder qui s'en servait : les produits qui en portaient une se sont
 * retrouvés rattachés à un identifiant mort, et la liste des catégories est
 * revenue vide. `purgeSeedRows` ne fait plus ce dégât, mais il est déjà fait
 * chez qui a ouvert l'application entre-temps — et la catégorie effacée n'existe
 * plus nulle part pour être reprise.
 *
 * Elle est donc RECONSTRUITE à partir de la seule trace qui reste, et c'est une
 * trace de la station : le nom que chaque produit garde en propre
 * (`categoryName`). Rien n'est réinventé ici — ce qui est recréé, c'est ce que
 * l'utilisateur avait choisi. L'identifiant se déduit du nom, donc deux postes
 * qui réparent chacun de leur côté retombent sur la même ligne.
 */
export function relinkOrphanRefs(mod: any): void {
  const at = nowIso();

  const relink = (coll: 'categories' | 'marques', prefix: string, rows: any[], idKey: string, nmKey: string) => {
    const list: any[] = Array.isArray(mod[coll]) ? mod[coll] : [];
    const ids = new Set(list.map(x => x?.id));
    const byName = new Map<string, any>(list.map(x => [nameKey(x?.name), x]));
    let touched = false;

    for (const row of rows) {
      const name = (row?.[nmKey] || '').trim();
      if (!name) continue;                                  // aucune catégorie choisie
      if (row[idKey] && ids.has(row[idKey])) continue;       // le lien tient toujours
      const key = nameKey(name);
      if (!key) continue;
      let target = byName.get(key);
      if (!target) {
        target = stampItem({ id: `${prefix}-${key}`, name }, at);
        list.push(target); ids.add(target.id); byName.set(key, target);
      }
      row[idKey] = target.id;
      row[nmKey] = target.name;
      Object.assign(row, stampItem(row, at));
      touched = true;
    }
    if (touched) mod[coll] = list;
  };

  const products: any[] = Array.isArray(mod.products) ? mod.products : [];
  const fiches: any[] = Array.isArray(mod.fiches) ? mod.fiches : [];
  relink('categories', 'categorie', [...products, ...fiches], 'categoryId', 'categoryName');
  relink('marques', 'marque', products, 'marqueId', 'marqueName');
}
