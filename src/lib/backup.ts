/**
 * ─── Sauvegarde COMPLÈTE de la station ─────────────────────────────────────────
 *
 *  CE QUE L'ANCIENNE SAUVEGARDE NE FAISAIT PAS
 *  Le bouton « Exporter .JSON » sérialisait l'état React d'`AppContext`. Trois
 *  trous, tous silencieux :
 *
 *    • les parties commerciales (Cafétéria, Lavage) vivent dans un AUTRE magasin
 *      (`biz_store`) — produits, ventes, achats, employés, inventaires : RIEN de
 *      tout cela n'était dans le fichier ;
 *    • l'état React ne garde que les 500 dernières lignes de `fuel_sales`,
 *      `shop_sales`, `purchases`, `client_transactions` — l'historique plus
 *      ancien était tronqué sans le moindre avertissement ;
 *    • les sous-tables (postes de bon de livraison, paiements, justificatifs,
 *      acomptes, absences, salaires…) ne remontent pas toutes dans l'état.
 *
 *    Et la restauration, elle, ne réécrivait QUE la mémoire du navigateur : rien
 *    n'était envoyé à la base, donc le premier rafraîchissement effaçait la
 *    « restauration » réussie.
 *
 *  CE QUE FAIT CE MODULE
 *  La sauvegarde ne lit plus l'écran : elle lit la BASE, table par table, sans
 *  aucune limite de lignes, et y ajoute le blob des parties commerciales. Le
 *  fichier produit est donc l'image complète de la station.
 *
 *  RÈGLE ABSOLUE DE LA RESTAURATION : elle n'EFFACE JAMAIS RIEN.
 *  Chaque ligne du fichier est réécrite (`upsert` sur l'`id`) ; une ligne
 *  présente aujourd'hui mais absente du fichier est LAISSÉE EN PLACE. Une
 *  restauration ne peut donc pas faire disparaître le travail fait depuis. Seule
 *  la suppression explicite d'un écran, confirmée par l'utilisateur, retire une
 *  donnée.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { supabase, loadBizStoreSnapshot, saveBizStore } from './supabase';
import { BizState, ModuleKey } from './bizConfig';
import { MERGE_COLLECTIONS, MODULE_KEYS, STAMP } from './bizSync';

// ─── Tables sauvegardées ───────────────────────────────────────────────────────
/**
 * TOUTES les tables métier, PARENTS D'ABORD.
 *
 * L'ordre n'est pas cosmétique : à la restauration, un poste d'achat ne peut être
 * réécrit qu'après son achat, un versement qu'après sa brigade. Ajouter une table
 * ici est la SEULE chose à faire pour qu'elle entre dans les sauvegardes.
 */
export interface BackupTableSpec {
  table: string;
  label: string;
  /** Table de liaison : un doublon (paire déjà présente) ne doit pas faire échouer. */
  junction?: boolean;
}

export const BACKUP_TABLES: BackupTableSpec[] = [
  // Paramètres et infrastructure
  { table: 'station_settings',                 label: 'Paramètres de la station' },
  // Le profil d'un administrateur, PAS son compte de connexion : mots de passe et
  // comptes vivent dans le schéma `auth` de Supabase, hors d'atteinte de
  // l'application. La restauration de cette table n'aboutit donc que si le compte
  // existe encore — la clé étrangère l'exige, et le rapport le dira.
  { table: 'admin_profiles',                   label: 'Profils administrateurs (hors mots de passe)' },
  { table: 'tracks',                           label: 'Pistes' },
  { table: 'tanks',                            label: 'Cuves' },
  { table: 'pumps',                            label: 'Pompes' },
  { table: 'pump_nozzles',                     label: 'Pistolets' },
  { table: 'drivers',                          label: 'Chauffeurs' },
  // Catalogue
  { table: 'product_brands',                   label: 'Marques' },
  { table: 'products',                         label: 'Produits (station-service)' },
  // Personnel
  { table: 'pompistes',                        label: 'Pompistes' },
  { table: 'brigade_chefs',                    label: 'Chefs de brigade' },
  { table: 'gerants',                          label: 'Gérants' },
  { table: 'magasin_workers',                  label: 'Employés magasin' },
  { table: 'chef_pompiste_assignments',        label: 'Affectations chef → pompiste', junction: true },
  { table: 'worker_acomptes',                  label: 'Acomptes du personnel' },
  { table: 'worker_absences',                  label: 'Absences du personnel' },
  { table: 'worker_payment_records',           label: 'Salaires versés' },
  { table: 'pompiste_decalage_history',        label: 'Historique des décalages' },
  // Tiers
  { table: 'clients',                          label: 'Clients' },
  { table: 'client_transactions',              label: 'Transactions clients' },
  { table: 'client_appointments',              label: 'Rendez-vous clients' },
  { table: 'suppliers',                        label: 'Fournisseurs' },
  { table: 'supplier_appointments',            label: 'Rendez-vous fournisseurs' },
  { table: 'supplier_debt_payments',           label: 'Règlements fournisseurs' },
  // Brigades
  { table: 'brigades',                         label: 'Brigades' },
  { table: 'brigade_pompiste_assignments',     label: 'Affectations brigade → pompiste', junction: true },
  { table: 'brigade_accounting',               label: 'Clôtures de brigade' },
  { table: 'brigade_accounting_justifications',label: 'Justificatifs de clôture' },
  { table: 'brigade_versements',               label: 'Versements de brigade' },
  { table: 'brigade_decalage_alerts',          label: 'Alertes de décalage' },
  // Trésorerie
  { table: 'bank_accounts',                    label: 'Comptes bancaires' },
  { table: 'cash_accounts',                    label: 'Caisses' },
  { table: 'treasury_transactions',            label: 'Mouvements de trésorerie' },
  { table: 'tpe_transactions',                 label: 'Transactions TPE' },
  // Ventes
  { table: 'fuel_sales',                       label: 'Ventes carburant' },
  { table: 'shop_sales',                       label: 'Ventes boutique' },
  { table: 'shop_sale_items',                  label: 'Lignes de vente boutique' },
  // Achats et livraisons
  { table: 'expenses',                         label: 'Dépenses' },
  { table: 'purchases',                        label: 'Achats' },
  { table: 'purchase_items',                   label: 'Lignes d\'achat' },
  { table: 'purchase_payments',                label: 'Paiements d\'achat' },
  { table: 'delivery_notes',                   label: 'Bons de livraison' },
  { table: 'delivery_note_items',              label: 'Lignes de bon de livraison' },
  { table: 'delivery_note_photos',             label: 'Photos de bon de livraison' },
  { table: 'delivery_note_payments',           label: 'Paiements de bon de livraison' },
  { table: 'fuel_invoices',                    label: 'Factures carburant' },
  { table: 'fuel_invoice_bls',                 label: 'BL rattachés aux factures', junction: true },
  { table: 'fuel_receipts',                    label: 'Reçus carburant' },
  { table: 'fuel_receipt_invoices',            label: 'Factures rattachées aux reçus', junction: true },
  // Clôtures et journal
  { table: 'inventories',                      label: 'Inventaires station-service' },
  { table: 'daily_reports',                    label: 'Rapports journaliers' },
  { table: 'permission_templates',             label: 'Modèles de permissions' },
  { table: 'activity_log',                     label: 'Journal d\'activité' },
  { table: 'client_feedbacks',                 label: 'Retours clients (page publique /client)' },
  // Parties commerciales — Cafétéria & Lavage
  { table: 'biz_sessions',                     label: 'Sessions de caisse (Restaurant / Cafétéria / Lavage)' },
  // Le catalogue a sa propre table depuis le 2026-08-15. Le blob en garde une
  // copie, mais c'est CETTE table qui fait autorité au chargement : l'oublier
  // ici sauvegarderait un catalogue périmé sans que rien ne le signale.
  { table: 'biz_products',                     label: 'Catalogue produits (Restaurant / Cafétéria / Lavage)' },
  { table: 'biz_store',                        label: 'Données Restaurant, Cafétéria & Lavage (ventes, achats, employés…)' },
  // Messages WhatsApp aux clients (migration 2026-08-22). Le journal se
  // sauvegarde ; la file d'attente aussi, parce qu'une restauration faite après
  // une panne de poste doit rendre les messages qui n'étaient pas encore partis.
  { table: 'whatsapp_messages',                label: 'Journal des messages WhatsApp' },
  { table: 'whatsapp_outbox',                  label: 'Messages WhatsApp en attente' },
];

/** Le blob des parties commerciales : restauré par FUSION, jamais en écrasement. */
const BIZ_STORE_TABLE = 'biz_store';

// ─── Forme du fichier ──────────────────────────────────────────────────────────

export interface BackupTableReport {
  table: string;
  label: string;
  rows: number;
  /** Table absente de cette base (migration non passée) — ce n'est pas une erreur. */
  missing?: boolean;
  error?: string;
}

export interface BackupBundle {
  format: 'stationpro-backup';
  /** 1 = ancien export de l'état React. 2 = sauvegarde complète lue en base. */
  version: 2;
  createdAt: string;
  stationName?: string;
  /** Nom de table → toutes ses lignes, telles qu'elles sont en base. */
  tables: Record<string, Record<string, unknown>[]>;
  report: BackupTableReport[];
  totals: { tables: number; rows: number };
}

/** Une sauvegarde version 1 (ancien format) reste lisible : on sait la détecter. */
export function isLegacyBundle(raw: any): boolean {
  return !!raw && typeof raw === 'object' && raw.format !== 'stationpro-backup';
}

export function isBackupBundle(raw: any): raw is BackupBundle {
  return !!raw && raw.format === 'stationpro-backup' && !!raw.tables && typeof raw.tables === 'object';
}

// ─── Lecture ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

/**
 * Table absente de la base — la migration correspondante n'a pas été passée.
 * Reconnu sur le CODE d'erreur : un refus RLS nomme lui aussi la table et ne doit
 * surtout pas être confondu avec une table qui n'existe pas.
 */
function isMissingTable(err?: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST202') return true;
  return /relation .* does not exist|could not find the table/i.test(err.message || '');
}

/**
 * Toutes les lignes d'une table, sans plafond.
 *
 * PostgREST rend 1000 lignes au maximum : on pagine. L'ordre sur `id` est
 * indispensable — sans lui, deux pages successives peuvent se recouvrir ou
 * sauter des lignes, et la sauvegarde serait incomplète sans rien signaler.
 */
async function fetchWholeTable(
  table: string,
): Promise<{ rows: Record<string, unknown>[]; missing?: boolean; error?: string }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table).select('*').order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (isMissingTable(error)) return { rows: [], missing: true };
      return { rows, error: error.message };
    }
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows };
}

export type ProgressFn = (step: string, done: number, total: number) => void;

/**
 * Lit la station entière depuis la base.
 *
 * Une table manquante ou refusée n'interrompt PAS la sauvegarde : elle est
 * inscrite au rapport et le reste est sauvé. Une sauvegarde partielle mais
 * annoncée vaut infiniment mieux qu'une sauvegarde annulée.
 */
export async function createFullBackup(
  opts: { stationName?: string; onProgress?: ProgressFn } = {},
): Promise<BackupBundle> {
  const { stationName, onProgress } = opts;
  const tables: Record<string, Record<string, unknown>[]> = {};
  const report: BackupTableReport[] = [];
  let totalRows = 0;

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const spec = BACKUP_TABLES[i];
    onProgress?.(spec.label, i, BACKUP_TABLES.length);

    const res = await fetchWholeTable(spec.table);
    if (res.missing) {
      report.push({ table: spec.table, label: spec.label, rows: 0, missing: true });
      continue;
    }
    tables[spec.table] = res.rows;
    totalRows += res.rows.length;
    report.push({ table: spec.table, label: spec.label, rows: res.rows.length, error: res.error });
  }

  onProgress?.('Terminé', BACKUP_TABLES.length, BACKUP_TABLES.length);

  return {
    format: 'stationpro-backup',
    version: 2,
    createdAt: new Date().toISOString(),
    stationName,
    tables,
    report,
    totals: { tables: Object.keys(tables).length, rows: totalRows },
  };
}

// ─── Export JSON ───────────────────────────────────────────────────────────────

export function bundleToJson(bundle: BackupBundle): string {
  return JSON.stringify(bundle, null, 2);
}

// ─── Export SQL ────────────────────────────────────────────────────────────────

/** Une valeur JavaScript écrite en littéral PostgreSQL. */
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'object') return `${quote(JSON.stringify(v))}::jsonb`;
  return quote(String(v));
}

/** Chaîne SQL : l'apostrophe se double, rien d'autre (standard_conforming_strings). */
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Le fichier `.sql` : le MÊME contenu que le JSON, mais rejouable à la main dans
 * l'éditeur SQL de Supabase, sans l'application. C'est le filet de dernier
 * recours — si l'application ne démarre plus, la station se remonte avec ça.
 *
 * Chaque ligne est un `insert … on conflict (id) do update` : rejouer le fichier
 * deux fois donne le même résultat qu'une fois, et AUCUN `delete` n'y figure.
 */
export function bundleToSql(bundle: BackupBundle): string {
  const out: string[] = [];
  const stamp = bundle.createdAt;

  out.push('-- ═══════════════════════════════════════════════════════════════════');
  out.push('--  SAUVEGARDE STATIONPRO');
  out.push(`--  Station : ${bundle.stationName || '(sans nom)'}`);
  out.push(`--  Date    : ${stamp}`);
  out.push(`--  Contenu : ${bundle.totals.tables} tables, ${bundle.totals.rows} lignes`);
  out.push('--');
  out.push('--  À rejouer dans : Supabase → SQL Editor → coller → Run.');
  out.push('--  Ce fichier ne SUPPRIME rien : chaque ligne est réécrite si elle');
  out.push('--  existe, ajoutée sinon. Les données absentes du fichier restent');
  out.push('--  intactes. Il peut être rejoué autant de fois que voulu.');
  out.push('--');
  out.push('--  NON INCLUS : les comptes de connexion et mots de passe (schéma');
  out.push('--  `auth` de Supabase) et les fichiers images (le stockage garde les');
  out.push('--  images, ce fichier n\'en porte que les liens).');
  out.push('-- ═══════════════════════════════════════════════════════════════════');
  out.push('');
  out.push('begin;');
  out.push('');

  for (const spec of BACKUP_TABLES) {
    const rows = bundle.tables[spec.table];
    if (!rows) {
      out.push(`-- ${spec.label} : table absente de cette sauvegarde.`);
      out.push('');
      continue;
    }
    if (!rows.length) {
      out.push(`-- ${spec.label} (${spec.table}) : aucune ligne.`);
      out.push('');
      continue;
    }

    // Toutes les colonnes rencontrées : une ligne peut en omettre une que la
    // suivante porte (colonne ajoutée par une migration en cours de route).
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const others = cols.filter(c => c !== 'id');

    out.push(`-- ── ${spec.label} (${spec.table}) — ${rows.length} ligne(s) ──`);
    out.push(`insert into public.${ident(spec.table)} (${cols.map(ident).join(', ')}) values`);
    out.push(
      rows.map(r => `  (${cols.map(c => sqlLiteral(r[c])).join(', ')})`).join(',\n') + '',
    );
    if (spec.junction || !cols.includes('id')) {
      // Table de liaison : la paire existe déjà ou non, il n'y a rien à mettre à jour.
      out.push('on conflict do nothing;');
    } else if (!others.length) {
      out.push('on conflict (id) do nothing;');
    } else {
      out.push('on conflict (id) do update set');
      out.push(others.map(c => `  ${ident(c)} = excluded.${ident(c)}`).join(',\n') + ';');
    }
    out.push('');
  }

  out.push('commit;');
  out.push('');
  return out.join('\n');
}

// ─── Restauration ──────────────────────────────────────────────────────────────

export interface RestoreReport {
  table: string;
  label: string;
  written: number;
  skipped?: boolean;
  error?: string;
}

export interface RestoreOutcome {
  ok: boolean;
  report: RestoreReport[];
  totalWritten: number;
  /** Message global quand la restauration n'a pas pu démarrer du tout. */
  error?: string;
}

const CHUNK = 200;

/**
 * Réécrit les lignes d'une table par paquets.
 *
 * `upsert` sur l'`id` : la ligne du fichier remplace celle d'aujourd'hui quand
 * les deux existent, et une ligne d'aujourd'hui ABSENTE du fichier n'est jamais
 * touchée. Aucun `delete` n'est émis, ici ni ailleurs.
 */
async function restoreTable(
  spec: BackupTableSpec, rows: Record<string, unknown>[],
): Promise<RestoreReport> {
  const base: RestoreReport = { table: spec.table, label: spec.label, written: 0 };
  if (!rows.length) return base;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(spec.table).upsert(chunk as any, {
      onConflict: 'id',
      // Une paire déjà affectée porte un autre `id` : on la laisse telle quelle
      // plutôt que de faire échouer tout le paquet sur la contrainte d'unicité.
      ignoreDuplicates: !!spec.junction,
    });
    if (error) {
      if (isMissingTable(error)) return { ...base, skipped: true };
      return { ...base, error: error.message };
    }
    base.written += chunk.length;
  }
  return base;
}

/**
 * Remet le contenu Cafétéria / Lavage du fichier DANS l'état actuel.
 *
 * Le principe est celui de `mergeBizState`, avec une différence voulue : une
 * ligne du fichier que l'état actuel a oubliée REVIENT, même si une pierre
 * tombale la disait supprimée. C'est le sens même d'une restauration — l'ancien
 * comportement (« la suppression gagne toujours ») rendait le fichier inutile
 * pour retrouver ce qu'on venait d'effacer par erreur.
 *
 * Dans l'autre sens, rien de ce qui existe aujourd'hui n'est retiré : une ligne
 * absente du fichier reste en place, et sur une ligne présente des deux côtés la
 * version la plus récemment écrite l'emporte.
 */
export function mergeBackupIntoBiz(current: any, backup: any): BizState {
  const out: any = {};

  for (const key of MODULE_KEYS) {
    const cur = (current?.[key] || {}) as any;
    const bak = (backup?.[key] || {}) as any;
    const mod: any = { ...cur };

    const restoredIds = new Set<string>();

    for (const coll of MERGE_COLLECTIONS) {
      const curRows: any[] = Array.isArray(cur[coll]) ? cur[coll] : [];
      const bakRows: any[] = Array.isArray(bak[coll]) ? bak[coll] : [];

      const map = new Map<string, any>();
      for (const r of curRows) if (r?.id) map.set(r.id, r);

      for (const r of bakRows) {
        if (!r?.id) continue;
        const prev = map.get(r.id);
        if (!prev) {
          // Absente aujourd'hui : le fichier la fait revenir.
          map.set(r.id, r);
          restoredIds.add(r.id);
          continue;
        }
        const a = prev[STAMP] || prev.updatedAt || '';
        const b = r[STAMP] || r.updatedAt || '';
        if (b > a) map.set(r.id, r);
      }
      mod[coll] = [...map.values()];
    }

    // Les lignes ramenées par le fichier ne doivent plus être considérées comme
    // supprimées, sinon la prochaine fusion les ferait disparaître à nouveau.
    const tombs: Record<string, string> = { ...(cur.deletedIds || {}) };
    for (const id of restoredIds) delete tombs[id];
    mod.deletedIds = tombs;

    // Accès rapides du point de vente : on garde ceux d'aujourd'hui s'il y en a.
    mod.posPinned = Array.isArray(cur.posPinned) && cur.posPinned.length
      ? cur.posPinned
      : (Array.isArray(bak.posPinned) ? bak.posPinned : []);

    out[key] = mod;
  }

  return out as BizState;
}

/**
 * Rejoue une sauvegarde dans la base.
 *
 * Ordre imposé par `BACKUP_TABLES` (parents avant enfants) et `biz_store` traité
 * à part, par fusion. Une table en échec n'arrête pas les autres : le rapport
 * dit exactement ce qui est passé et ce qui ne l'est pas.
 */
export async function restoreBundle(
  bundle: BackupBundle,
  onProgress?: ProgressFn,
): Promise<RestoreOutcome> {
  const report: RestoreReport[] = [];
  let totalWritten = 0;

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const spec = BACKUP_TABLES[i];
    const rows = bundle.tables[spec.table];
    onProgress?.(spec.label, i, BACKUP_TABLES.length);
    if (!rows || !rows.length) continue;

    if (spec.table === BIZ_STORE_TABLE) {
      const res = await restoreBizStore(rows);
      report.push({ table: spec.table, label: spec.label, written: res.ok ? 1 : 0, error: res.error });
      if (res.ok) totalWritten += 1;
      continue;
    }

    const res = await restoreTable(spec, rows);
    report.push(res);
    totalWritten += res.written;
  }

  onProgress?.('Terminé', BACKUP_TABLES.length, BACKUP_TABLES.length);
  return { ok: report.every(r => !r.error), report, totalWritten };
}

/** Fusionne le blob du fichier avec celui du serveur, puis l'enregistre. */
async function restoreBizStore(rows: Record<string, unknown>[]): Promise<{ ok: boolean; error?: string }> {
  const backupRow = rows.find(r => (r as any).id === 'biz-v1') || rows[0];
  const backupState = (backupRow as any)?.state;
  if (!backupState || typeof backupState !== 'object') return { ok: true };

  const snapshot = await loadBizStoreSnapshot();
  const merged = mergeBackupIntoBiz(snapshot?.state ?? {}, backupState);

  const res = await saveBizStore(merged, snapshot?.rev ?? null);
  if (res.ok) return { ok: true };
  if (res.conflict) {
    // Un autre poste a écrit pendant la restauration : on refusionne sur SA
    // version et on rejoue une fois — le fichier ne perd rien pour autant.
    const again = mergeBackupIntoBiz(res.remote?.state ?? {}, backupState);
    const retry = await saveBizStore(again, res.remote?.rev ?? null);
    return retry.ok ? { ok: true } : { ok: false, error: retry.error || 'Conflit persistant' };
  }
  return { ok: false, error: res.error };
}

// ─── Téléchargement ────────────────────────────────────────────────────────────

/**
 * Écrit un fichier côté navigateur.
 *
 * Un `Blob` et non une `data:` URI : l'ancienne sauvegarde encodait tout le JSON
 * dans l'URL, ce que les navigateurs refusent au-delà de quelques mégaoctets —
 * la station qui en avait le plus besoin était justement celle qui n'y arrivait
 * plus.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Laisse au navigateur le temps de démarrer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Horodatage utilisable dans un nom de fichier : `2026-08-10_14-32-05`. */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Nom de fichier propre pour une station donnée. */
export function backupFilename(ext: 'json' | 'sql', stationName?: string): string {
  // NFD sépare « é » en « e » + accent, puis on ne garde que l'ASCII : le nom de
  // fichier reste lisible sur n'importe quel système.
  const slug = (stationName || 'station')
    .normalize('NFD').replace(/[^\x20-\x7e]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'station';
  return `stationpro_${slug}_${fileStamp()}.${ext}`;
}

// ─── Reprise d'une sauvegarde de l'ANCIEN format ───────────────────────────────

/**
 * Les fichiers déjà en circulation sont des états React (`{ clients: [...],
 * tanks: [...] }`, en camelCase). On sait encore les lire pour ne pas les rendre
 * inutiles, mais ils ne portent ni les parties commerciales ni les sous-tables :
 * l'appelant DOIT le dire à l'utilisateur.
 */
export const LEGACY_KEY_TO_TABLE: Record<string, string> = {
  tanks: 'tanks',
  pumps: 'pumps',
  tracks: 'tracks',
  drivers: 'drivers',
  clients: 'clients',
  suppliers: 'suppliers',
  expenses: 'expenses',
  pompistes: 'pompistes',
  gerants: 'gerants',
  brigades: 'brigades',
  inventories: 'inventories',
};

/** Nombre de lignes qu'un ancien fichier contient, pour l'annoncer avant d'agir. */
export function legacyRowCount(raw: any): number {
  return Object.keys(LEGACY_KEY_TO_TABLE)
    .reduce((n, k) => n + (Array.isArray(raw?.[k]) ? raw[k].length : 0), 0);
}
