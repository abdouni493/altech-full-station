/**
 * ─── LE CLIENT DE LA PASSERELLE EVOLUTION ──────────────────────────────────────
 *
 * Un seul fichier détient la clé de la passerelle, et il ne tourne QUE sur le
 * serveur. Le navigateur ne parle jamais à la passerelle : il parle à
 * `/api/whatsapp/*`, qui parle à la passerelle.
 *
 * ─── LA REPRISE SUR ECONNRESET, ET POURQUOI ELLE EST DÉCLARÉE PAR APPEL ────────
 *
 * L'hébergeur est serverless : la fonction est GELÉE entre deux requêtes, et son
 * pool de connexions garde des sockets que la passerelle a fermées entre-temps.
 * La première requête d'une fonction réveillée tombe donc sur une socket morte
 * (`ECONNRESET`) — sans que rien ne soit cassé nulle part.
 *
 * On ne peut pas déduire du verbe HTTP si un appel est rejouable :
 * `/instance/create` est un POST parfaitement idempotent — et c'est justement le
 * bouton sur lequel la réception tombe. `/message/sendText` ne l'est pas du
 * tout : un message posté deux fois chez un client est PIRE qu'un envoi manqué,
 * que la file d'attente rattrape de toute façon.
 *
 * L'idempotence est donc déclarée appel par appel, et la reprise se donne un
 * BUDGET DE TEMPS plutôt qu'un seuil de délai : la demande de QR attend 30 s et
 * ne doit pas être écartée de la reprise alors qu'elle en a largement le temps.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { GatewayEnv, gatewayEnv } from './env.js';

/** Erreur portant la CAUSE SYSTÈME jusqu'à l'écran — jamais la clé API. */
export class GatewayError extends Error {
  /** `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `HTTP_401`… */
  code: string;
  /** Statut HTTP quand la passerelle a répondu ; 0 si elle n'a pas répondu. */
  status: number;
  /** Vrai quand la passerelle n'a pas répondu du tout — le poste est-il allumé ? */
  unreachable: boolean;
  host: string;

  constructor(message: string, opts: { code: string; status?: number; unreachable?: boolean; host?: string }) {
    super(message);
    this.name = 'GatewayError';
    this.code = opts.code;
    this.status = opts.status ?? 0;
    this.unreachable = opts.unreachable ?? false;
    this.host = opts.host || '';
  }
}

/** Cause système d'une erreur réseau, extraite de la chaîne de causes de fetch. */
function systemCode(err: any): string {
  let e = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e.code === 'string' && e.code) return e.code;
    e = e.cause;
  }
  return 'NETWORK_ERROR';
}

/** Ce qu'il faut FAIRE, par cause — la phrase que l'écran de réglages affiche. */
export function remedyFor(code: string): string {
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return "L'adresse de la passerelle ne résout pas. Vérifiez EVOLUTION_BASE_URL, et que le nœud Tailscale est bien publié (le Funnel doit être accordé par les ACL — « tailscale funnel status » ne fait pas foi).";
    case 'ECONNREFUSED':
      return 'La machine répond mais rien n\'écoute : les conteneurs Docker sont-ils démarrés sur le poste ?';
    case 'ECONNRESET':
      return 'La connexion a été coupée en cours de route. Souvent passager — réessayez ; si cela persiste, le poste vient peut-être de sortir de veille.';
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      return 'La passerelle n\'a pas répondu à temps. Le poste est-il allumé, éveillé et connecté à Internet ?';
    case 'HTTP_401':
    case 'HTTP_403':
      return 'La clé API a été refusée : EVOLUTION_API_KEY doit valoir exactement AUTHENTICATION_API_KEY de la passerelle.';
    case 'HTTP_404':
      return "L'instance n'existe pas encore sur la passerelle. Cliquez « Initialiser l'instance ».";
    default:
      return 'Vérifiez que le poste qui héberge la passerelle est allumé et connecté.';
  }
}

interface CallOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /**
   * Cet appel peut-il être REJOUÉ sans conséquence ? Déclaré ici, jamais déduit
   * du verbe : voir l'en-tête de ce fichier.
   */
  idempotent?: boolean;
  /** Budget total accordé à l'appel, reprises comprises. */
  budgetMs?: number;
  env?: GatewayEnv;
}

/** Les deux reprises, en millisecondes — courtes : on répare une socket morte. */
const RETRY_DELAYS = [250, 900];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function call<T = any>(path: string, opts: CallOpts = {}): Promise<T> {
  const env = opts.env || gatewayEnv();
  const budget = opts.budgetMs ?? 15_000;
  const started = Date.now();
  let host = '';
  try { host = new URL(env.baseUrl).host; } catch { /* base url invalide : signalée plus bas */ }

  if (!env.baseUrl || !env.apiKey) {
    throw new GatewayError(
      'La passerelle WhatsApp n\'est pas configurée (EVOLUTION_BASE_URL / EVOLUTION_API_KEY).',
      { code: 'NOT_CONFIGURED', host });
  }

  let lastErr: any = null;
  for (let attempt = 0; ; attempt++) {
    // Ce qu'il reste du budget sert de délai d'attente à CETTE tentative.
    const left = budget - (Date.now() - started);
    if (left <= 0) break;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(left, budget));
    try {
      const res = await fetch(`${env.baseUrl}${path}`, {
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.apiKey,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ac.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }

      if (!res.ok) {
        // Une réponse, même en erreur, prouve que la passerelle est JOIGNABLE :
        // ce n'est pas le cas « le poste est éteint », et la file d'attente ne
        // doit pas s'en saisir comme telle.
        const detail = parsed?.response?.message || parsed?.message || parsed?.error || '';
        throw new GatewayError(
          `La passerelle a refusé la demande (HTTP ${res.status})${detail ? ` — ${Array.isArray(detail) ? detail.join(', ') : detail}` : ''}.`,
          { code: `HTTP_${res.status}`, status: res.status, host });
      }
      return parsed as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof GatewayError) throw err;

      const code = err?.name === 'AbortError' ? 'ETIMEDOUT' : systemCode(err);
      lastErr = new GatewayError(
        `La passerelle WhatsApp est injoignable (${code}).`,
        { code, unreachable: true, host });

      // Un appel NON idempotent n'est jamais rejoué : la première tentative a
      // pu partir. Un message posté deux fois chez un client est pire qu'un
      // envoi manqué, que la file d'attente rattrape.
      if (!opts.idempotent) throw lastErr;
      if (attempt >= RETRY_DELAYS.length) break;
      const wait = RETRY_DELAYS[attempt];
      if (Date.now() - started + wait >= budget) break;
      await sleep(wait);
    }
  }
  throw lastErr || new GatewayError('La passerelle WhatsApp est injoignable.', { code: 'NETWORK_ERROR', unreachable: true, host });
}

// ─── Les opérations ────────────────────────────────────────────────────────────

export interface SessionState {
  state: 'open' | 'connecting' | 'close';
  linkedNumber: string | null;
  profileName: string | null;
}

/** État de la session — `close` quand l'instance n'existe pas encore. */
export async function sessionState(env?: GatewayEnv): Promise<SessionState> {
  const e = env || gatewayEnv();
  try {
    const res = await call<any>(`/instance/connectionState/${encodeURIComponent(e.instance)}`, {
      idempotent: true, budgetMs: 12_000, env: e,
    });
    const raw = res?.instance?.state || res?.state || 'close';
    let linked: string | null = null;
    let profile: string | null = null;
    try {
      const list = await call<any>('/instance/fetchInstances', { idempotent: true, budgetMs: 10_000, env: e });
      const rows: any[] = Array.isArray(list) ? list : (list?.instances || []);
      const mine = rows
        .map(r => r?.instance || r)
        .find((r: any) => r?.instanceName === e.instance || r?.name === e.instance);
      const owner = mine?.owner || mine?.ownerJid || mine?.number || '';
      linked = owner ? String(owner).split('@')[0] || null : null;
      profile = mine?.profileName || mine?.profilePicName || null;
    } catch {
      // Le numéro lié n'est qu'un confort d'affichage : son absence ne doit pas
      // faire passer une session parfaitement ouverte pour une panne.
    }
    return { state: raw === 'open' || raw === 'connecting' ? raw : 'close', linkedNumber: linked, profileName: profile };
  } catch (err: any) {
    if (err instanceof GatewayError && err.status === 404) {
      return { state: 'close', linkedNumber: null, profileName: null };
    }
    throw err;
  }
}

/** Le webhook actuellement ENREGISTRÉ sur la passerelle — l'URL et son jeton. */
export async function currentWebhook(env?: GatewayEnv): Promise<{ url: string; token: string } | null> {
  const e = env || gatewayEnv();
  try {
    const res = await call<any>(`/webhook/find/${encodeURIComponent(e.instance)}`, {
      idempotent: true, budgetMs: 10_000, env: e,
    });
    const w = res?.webhook || res;
    const url = w?.url || '';
    const auth = w?.headers?.Authorization || w?.headers?.authorization || '';
    return { url, token: String(auth).replace(/^Bearer\s+/i, '') };
  } catch (err: any) {
    if (err instanceof GatewayError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

/** Charge utile du webhook, identique partout où on l'enregistre. */
function webhookPayload(url: string, token: string) {
  return {
    webhook: {
      enabled: true,
      url,
      byEvents: false,
      base64: false,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
    },
  };
}

/**
 * Crée l'instance. IDEMPOTENT : « already in use » est avalé, parce que c'est le
 * résultat attendu au deuxième appel — et parce que ce bouton doit rester
 * cliquable sur une session déjà ouverte pour corriger un webhook périmé.
 */
export async function createInstance(url: string, env?: GatewayEnv): Promise<void> {
  const e = env || gatewayEnv();
  try {
    await call('/instance/create', {
      method: 'POST', idempotent: true, budgetMs: 25_000, env: e,
      body: {
        instanceName: e.instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
        ...webhookPayload(url, e.webhookToken),
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const exists = err instanceof GatewayError
      && (err.status === 403 || err.status === 409 || /already/i.test(msg) || /in use/i.test(msg));
    if (!exists) throw err;
  }
}

/**
 * Réécrit le webhook SANS toucher à la session. C'est le geste d'exploitation
 * qui répare le cas le plus muet du montage : jeton régénéré chez l'hébergeur,
 * passerelle restée sur l'ancien, chaque accusé de remise refusé en 401 pendant
 * que l'écran affiche « prête ».
 */
export async function setWebhook(url: string, env?: GatewayEnv): Promise<void> {
  const e = env || gatewayEnv();
  await call(`/webhook/set/${encodeURIComponent(e.instance)}`, {
    method: 'POST', idempotent: true, budgetMs: 15_000, env: e,
    body: webhookPayload(url, e.webhookToken),
  });
}

export interface ConnectResult { qrBase64: string | null; pairingCode: string | null }

/** Demande un QR / code d'appairage. Long (jusqu'à 30 s) mais rejouable. */
export async function connectInstance(env?: GatewayEnv): Promise<ConnectResult> {
  const e = env || gatewayEnv();
  const res = await call<any>(`/instance/connect/${encodeURIComponent(e.instance)}`, {
    idempotent: true, budgetMs: 40_000, env: e,
  });
  const base64 = res?.base64 || res?.qrcode?.base64 || null;
  const code = res?.pairingCode || res?.qrcode?.pairingCode || null;
  const qr = base64
    ? (String(base64).startsWith('data:') ? String(base64) : `data:image/png;base64,${base64}`)
    : null;
  return { qrBase64: qr, pairingCode: code ? String(code) : null };
}

export async function restartInstance(env?: GatewayEnv): Promise<void> {
  const e = env || gatewayEnv();
  await call(`/instance/restart/${encodeURIComponent(e.instance)}`, {
    method: 'POST', idempotent: true, budgetMs: 20_000, env: e,
  });
}

export async function logoutInstance(env?: GatewayEnv): Promise<void> {
  const e = env || gatewayEnv();
  await call(`/instance/logout/${encodeURIComponent(e.instance)}`, {
    method: 'DELETE', idempotent: true, budgetMs: 20_000, env: e,
  });
}

export interface SentMessage { gatewayId: string | null }

/**
 * Envoie UN message. **Jamais rejoué** — voir l'en-tête : la file d'attente
 * rattrape un envoi manqué, rien ne rattrape un message envoyé deux fois.
 */
export async function sendText(msisdn: string, body: string, env?: GatewayEnv): Promise<SentMessage> {
  const e = env || gatewayEnv();
  const res = await call<any>(`/message/sendText/${encodeURIComponent(e.instance)}`, {
    method: 'POST', idempotent: false, budgetMs: 25_000, env: e,
    body: { number: msisdn, text: body },
  });
  const id = res?.key?.id || res?.messageId || res?.id || null;
  return { gatewayId: id ? String(id) : null };
}
