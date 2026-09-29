/**
 * ─── LE CÔTÉ NAVIGATEUR DE L'ENVOI WHATSAPP ────────────────────────────────────
 *
 * Ce module ne parle JAMAIS à la passerelle. Il parle à `/api/whatsapp/*`, qui
 * est le seul endroit détenant la clé. Aucune des variables de la passerelle ne
 * porte le préfixe `VITE_` : ce préfixe est ce qui ferait entrer la clé dans le
 * paquet JavaScript téléchargé par chaque visiteur.
 *
 * La lecture du JOURNAL, elle, passe par Supabase comme le reste de
 * l'application — c'est une lecture protégée par RLS, elle n'expose rien.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from './supabase';
import { MessageStatus, SendOutcome } from './whatsappCore';

// ─── Appels aux routes serveur ─────────────────────────────────────────────────

/**
 * DEMO VERSION — there is no WhatsApp gateway and no server behind this build.
 * The routes are answered here: the session reads as connected and every
 * message is logged as sent in the in-memory `whatsapp_messages` table, so the
 * « Messages clients » screens can be tried end to end.
 */
const DEMO_STATUS = {
  configured: true, storageConfigured: true, state: 'open', connected: true,
  linkedNumber: '213 550 12 34 56', profileName: 'Station Altech (démo)', instanceMasked: 'demo-••••',
  baseUrlHost: 'demo.local', webhook: 'verified', webhookConfigured: true, expectedWebhookUrl: null,
  ignoredEnv: null, ignoredReason: null, pending: 0, qrBase64: null, pairingCode: null, error: null,
};

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path === 'status' || path === 'session') return DEMO_STATUS as T;
  if (path === 'outbox') return { pending: 0, storageConfigured: true } as T;
  if (path === 'outbox/flush') return { sent: 0, deferred: 0, failed: 0, expired: 0, pending: 0, storageConfigured: true } as T;
  if (path === 'send') {
    const now = new Date().toISOString();
    const reports = [];
    for (const r of (body.recipients || []) as SendRecipient[]) {
      const id = `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await supabase.from('whatsapp_messages').insert({
        id, module_key: r.moduleKey ?? null, client_id: r.clientId ?? null, recipient_phone: r.phone,
        recipient_name: r.name ?? null, body: r.body, kind: r.kind ?? 'libre', rappel_kind: r.rappelKind ?? null,
        car_label: r.carLabel ?? null, status: 'sent', error: null, created_at: now, sent_at: now,
        created_by: body.createdBy ?? null,
      });
      reports.push({ name: r.name || r.phone, phone: r.phone, outcome: 'sent' as SendOutcome, messageId: id });
    }
    return { reports, counts: { sent: reports.length, queued: 0, failed: 0 }, persisted: true } as T;
  }
  return {} as T;
}

/** Ce que `/status` rend — aucun champ ne porte de secret. */
export interface WhatsAppStatus {
  configured: boolean;
  storageConfigured: boolean;
  state: 'open' | 'connecting' | 'close';
  connected: boolean;
  linkedNumber: string | null;
  profileName: string | null;
  instanceMasked: string | null;
  baseUrlHost: string | null;
  webhook: 'unknown' | 'missing' | 'wrong-url' | 'token-mismatch' | 'verified';
  webhookConfigured: boolean;
  expectedWebhookUrl: string | null;
  ignoredEnv: string | null;
  ignoredReason: string | null;
  pending: number;
  qrBase64: string | null;
  pairingCode: string | null;
  error: string | null;
  remedy?: string | null;
  code?: string | null;
}

export const fetchStatus = () => api<WhatsAppStatus>('status');

export type SessionAction = 'setup' | 'connect' | 'restart' | 'logout';

export const sessionAction = (action: SessionAction) =>
  api<WhatsAppStatus>('session', { method: 'POST', body: JSON.stringify({ action }) });

/** Un destinataire d'un envoi — le texte est DÉJÀ composé et relu. */
export interface SendRecipient {
  phone: string;
  name?: string;
  clientId?: string;
  carLabel?: string;
  body: string;
  moduleKey?: string;
  /** `libre` (message écrit à la main) ou `rappel`. */
  kind?: 'libre' | 'rappel';
  rappelKind?: 'lavage' | 'reparation';
}

export interface SendReport {
  name: string;
  phone: string;
  outcome: SendOutcome;
  messageId: string;
  error?: string;
}

export interface SendResult {
  reports: SendReport[];
  counts: { sent: number; queued: number; failed: number };
  persisted: boolean;
}

export const sendMessages = (recipients: SendRecipient[], createdBy?: string) =>
  api<SendResult>('send', { method: 'POST', body: JSON.stringify({ recipients, createdBy }) });

export interface OutboxState { pending: number; storageConfigured: boolean }

export const outboxState = () => api<OutboxState>('outbox');

export interface FlushResult {
  sent: number; deferred: number; failed: number; expired: number; pending: number;
  storageConfigured: boolean;
}

export const flushOutbox = () => api<FlushResult>('outbox/flush', { method: 'POST' });

// ─── Le journal, lu depuis Supabase ────────────────────────────────────────────

export interface MessageRow {
  id: string;
  moduleKey: string | null;
  clientId: string | null;
  recipientPhone: string;
  recipientName: string | null;
  body: string;
  kind: string | null;
  rappelKind: string | null;
  carLabel: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdBy: string | null;
}

function mapMessage(r: any): MessageRow {
  return {
    id: r.id,
    moduleKey: r.module_key ?? null,
    clientId: r.client_id ?? null,
    recipientPhone: r.recipient_phone,
    recipientName: r.recipient_name ?? null,
    body: r.body ?? '',
    kind: r.kind ?? null,
    rappelKind: r.rappel_kind ?? null,
    carLabel: r.car_label ?? null,
    status: (r.status || 'queued') as MessageStatus,
    error: r.error ?? null,
    createdAt: r.created_at,
    sentAt: r.sent_at ?? null,
    deliveredAt: r.delivered_at ?? null,
    readAt: r.read_at ?? null,
    createdBy: r.created_by ?? null,
  };
}

/**
 * Les derniers messages d'une partie.
 *
 * Rend une liste VIDE plutôt que de lever quand la table n'existe pas encore :
 * la migration SQL peut ne pas être passée sur un poste, et l'écran doit alors
 * s'ouvrir en disant ce qu'il manque — pas planter.
 */
export async function loadMessages(moduleKey: string, limit = 200): Promise<{ rows: MessageRow[]; missing: boolean }> {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('*')
    .eq('module_key', moduleKey)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    const code = (error as any).code || '';
    const missing = code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || '');
    if (missing) return { rows: [], missing: true };
    throw new Error(error.message);
  }
  return { rows: ((data as any[]) || []).map(mapMessage), missing: false };
}
