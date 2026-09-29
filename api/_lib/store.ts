/**
 * ─── LE JOURNAL D'ENVOI ET LA FILE D'ATTENTE ───────────────────────────────────
 *
 * Deux tables, et elles ne se confondent pas :
 *
 *   • `whatsapp_messages` — le JOURNAL : ce qui a été confié à la passerelle, à
 *     qui, et où en est la remise (`sent → delivered → read`). C'est lui que
 *     l'écran Messages affiche ;
 *   • `whatsapp_outbox`  — la FILE : ce qui n'a PAS PU partir, avec son texte,
 *     en attendant que la passerelle revienne.
 *
 * ─── POURQUOI LA FILE N'EST PAS UN RAFFINEMENT ─────────────────────────────────
 * La passerelle vit sur un poste de la station. Ce poste sera éteint, en veille
 * ou hors ligne un jour ou l'autre — c'est le prix assumé de la gratuité. Sans
 * file, chaque message émis pendant ce temps est PURELEMENT PERDU, et un rappel
 * automatique ne laisse rien derrière lui : personne ne revient l'envoyer à la
 * main. La file est ce qui rend l'hébergement sur un poste acceptable.
 *
 * ─── ÉCRITURE PAR LE SERVEUR, AVEC LA CLÉ DE SERVICE ───────────────────────────
 * Le webhook de la passerelle n'a aucune session utilisateur : il ne peut pas
 * écrire sous RLS. Ces deux tables sont donc écrites par le serveur avec
 * `SUPABASE_SERVICE_ROLE_KEY`. Si la variable manque, l'envoi DIRECT continue de
 * fonctionner mais rien n'est journalisé ni mis en file — et l'application le
 * DIT au lieu de le taire (`storageConfigured` dans `/status`).
 * ──────────────────────────────────────────────────────────────────────────────
 */

/**
 * ─── LES RÉGLAGES SONT LUS À L'APPEL, JAMAIS AU CHARGEMENT ─────────────────────
 *
 * Ces deux valeurs étaient des constantes de module. En ESM, les imports sont
 * évalués AVANT le corps du fichier qui les importe : le `dotenv.config()` de
 * `server.ts` tournait donc APRÈS que ce module ait déjà figé un
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` vide.
 *
 * Conséquence en développement : la persistance se déclarait indisponible alors
 * que le `.env` était parfaitement renseigné — donc pas de journal, et surtout
 * pas de file d'attente, silencieusement. Chez l'hébergeur le défaut ne se
 * voyait pas (les variables y sont posées avant le chargement de la fonction),
 * ce qui en faisait exactement le genre de panne qui n'apparaît qu'une fois sur
 * le poste de la station.
 *
 * Une lecture paresseuse supprime la dépendance à l'ordre d'initialisation —
 * c'est déjà ce que fait `gatewayEnv()` dans `env.ts`.
 */
const supabaseUrl = (): string =>
  (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = (): string => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** La persistance est-elle utilisable ? */
export function storageConfigured(): boolean {
  return !!(supabaseUrl() && serviceKey());
}

/** Un appel PostgREST authentifié par la clé de service. */
async function rest(path: string, init: RequestInit & { prefer?: string } = {}): Promise<any> {
  if (!storageConfigured()) throw new Error('SUPABASE_SERVICE_ROLE_KEY absente');
  const headers: Record<string, string> = {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    'Content-Type': 'application/json',
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`[supabase ${res.status}] ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ─── Le journal ────────────────────────────────────────────────────────────────

export interface JournalRow {
  id: string;
  module_key?: string | null;
  client_id?: string | null;
  recipient_phone: string;
  recipient_name?: string | null;
  body: string;
  kind?: string | null;
  rappel_kind?: string | null;
  car_label?: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  gateway_id?: string | null;
  error?: string | null;
  created_by?: string | null;
  sent_at?: string | null;
}

/** Écrit (ou réécrit) une ligne du journal. Ne lève JAMAIS. */
export async function journal(row: JournalRow): Promise<void> {
  if (!storageConfigured()) return;
  try {
    await rest('whatsapp_messages', {
      method: 'POST',
      body: JSON.stringify(row),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  } catch (err: any) {
    // Un journal qui n'a pas pu s'écrire ne doit pas transformer un message
    // PARTI en échec aux yeux de l'utilisateur.
    console.error('[whatsapp] journal', err?.message || err);
  }
}

/** Fait avancer le statut de remise d'un message, depuis le webhook. */
export async function markStatus(
  gatewayId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
): Promise<void> {
  if (!storageConfigured() || !gatewayId) return;
  const patch: Record<string, any> = { status };
  if (status === 'delivered') patch.delivered_at = new Date().toISOString();
  if (status === 'read') patch.read_at = new Date().toISOString();
  try {
    await rest(`whatsapp_messages?gateway_id=eq.${encodeURIComponent(gatewayId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      prefer: 'return=minimal',
    });
  } catch (err: any) {
    console.error('[whatsapp] markStatus', err?.message || err);
  }
}

// ─── La file d'attente ─────────────────────────────────────────────────────────

export interface OutboxRow {
  id: string;
  message_id?: string | null;
  recipient_phone: string;
  recipient_display?: string | null;
  recipient_name?: string | null;
  body: string;
  status: 'pending' | 'sent' | 'abandoned';
  attempts: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  created_at?: string;
}

/** Met un message en attente. Rend `false` si la file n'est pas disponible. */
export async function enqueue(row: Omit<OutboxRow, 'status' | 'attempts'>): Promise<boolean> {
  if (!storageConfigured()) return false;
  try {
    await rest('whatsapp_outbox', {
      method: 'POST',
      body: JSON.stringify({ ...row, status: 'pending', attempts: 0 }),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    return true;
  } catch (err: any) {
    console.error('[whatsapp] enqueue', err?.message || err);
    return false;
  }
}

/** Combien de messages attendent — un COMPTAGE, jamais un appel à la passerelle. */
export async function pendingCount(): Promise<number> {
  if (!storageConfigured()) return 0;
  try {
    const res = await fetch(`${supabaseUrl()}/rest/v1/whatsapp_outbox?status=eq.pending&select=id`, {
      headers: {
        apikey: serviceKey(),
        Authorization: `Bearer ${serviceKey()}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

/** Les plus anciens en attente d'abord — l'ordre dans lequel on rattrape. */
export async function takePending(limit: number): Promise<OutboxRow[]> {
  if (!storageConfigured()) return [];
  try {
    return await rest(`whatsapp_outbox?status=eq.pending&order=created_at.asc&limit=${limit}`) || [];
  } catch (err: any) {
    console.error('[whatsapp] takePending', err?.message || err);
    return [];
  }
}

async function patchOutbox(id: string, patch: Record<string, any>): Promise<void> {
  try {
    await rest(`whatsapp_outbox?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal',
    });
  } catch (err: any) {
    console.error('[whatsapp] patchOutbox', err?.message || err);
  }
}

export const outboxSent = (id: string) =>
  patchOutbox(id, { status: 'sent', sent_at: new Date().toISOString(), last_error: null });

/**
 * Un échec PROPRE AU DESTINATAIRE consomme une tentative (numéro sans compte
 * WhatsApp, refus de la passerelle). Au bout de trois, le message est abandonné
 * plutôt que réessayé sans fin.
 */
export const MAX_ATTEMPTS = 3;

export async function outboxFailed(row: OutboxRow, error: string): Promise<void> {
  const attempts = (row.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await patchOutbox(row.id, {
      status: 'abandoned', attempts, last_error: error,
      last_attempt_at: new Date().toISOString(),
      abandoned_at: new Date().toISOString(),
      abandoned_reason: `${MAX_ATTEMPTS} tentatives infructueuses — ${error}`,
    });
    return;
  }
  await patchOutbox(row.id, { attempts, last_error: error, last_attempt_at: new Date().toISOString() });
}

/**
 * Une passerelle INJOIGNABLE ne consomme JAMAIS de tentative : ce n'est pas la
 * faute du message. Sans cette règle, un week-end hors ligne épuiserait le
 * compteur de toute la file et ferait abandonner des messages parfaitement
 * valides.
 */
export const outboxDeferred = (id: string, error: string) =>
  patchOutbox(id, { last_error: error, last_attempt_at: new Date().toISOString() });

/** Durée au-delà de laquelle un message en attente n'a plus de sens. */
export const EXPIRY_DAYS = 7;

/**
 * Périme ce qui a trop attendu. Un rappel de passage vieux d'une semaine peut
 * être devenu FAUX — le client est peut-être déjà repassé entre-temps. Mieux
 * vaut ne rien envoyer qu'envoyer une information périmée.
 */
export async function expireOld(): Promise<number> {
  if (!storageConfigured()) return 0;
  const limit = new Date(Date.now() - EXPIRY_DAYS * 86_400_000).toISOString();
  try {
    const rows = await rest(
      `whatsapp_outbox?status=eq.pending&created_at=lt.${encodeURIComponent(limit)}&select=id`,
    ) || [];
    for (const r of rows) {
      await patchOutbox(r.id, {
        status: 'abandoned',
        abandoned_at: new Date().toISOString(),
        abandoned_reason: `En attente depuis plus de ${EXPIRY_DAYS} jours — l'information a pu devenir fausse.`,
      });
    }
    return rows.length;
  } catch {
    return 0;
  }
}
