/**
 * ─── LES ROUTES WHATSAPP, ÉCRITES UNE SEULE FOIS ───────────────────────────────
 *
 * L'application tourne à deux endroits : derrière `server.ts` en développement,
 * et en fonction serverless chez l'hébergeur. Écrire les routes deux fois, c'est
 * garantir qu'elles divergeront — et une divergence ici se paie en messages non
 * partis ou en accusés refusés en 401, deux pannes parfaitement muettes.
 *
 * Ce module ne connaît donc ni Express ni l'hébergeur : il reçoit un chemin, une
 * méthode, un corps et des en-têtes, et rend un statut avec un corps JSON. Les
 * deux adaptateurs (`api/whatsapp/[...path].ts` et `server.ts`) ne font que
 * traduire.
 *
 *   POST /api/whatsapp/send           envoi (le SEUL chemin détenant la clé)
 *   POST /api/whatsapp/webhook        accusés de remise venant de la passerelle
 *   GET  /api/whatsapp/status         état de session, pour l'écran de réglages
 *   POST /api/whatsapp/session        setup | connect | restart | logout
 *   GET  /api/whatsapp/outbox         combien de messages attendent (comptage)
 *   POST /api/whatsapp/outbox/flush   vidage de la file
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  GatewayError, connectInstance, createInstance, currentWebhook, logoutInstance,
  remedyFor, restartInstance, sendText, sessionState, setWebhook,
} from './evolution.js';
import { baseUrlHost, gatewayEnv, isConfigured, maskInstance, webhookUrl } from './env.js';
import {
  EXPIRY_DAYS, MAX_ATTEMPTS, enqueue, expireOld, journal, markStatus, outboxDeferred,
  outboxFailed, outboxSent, pendingCount, storageConfigured, takePending,
} from './store.js';
import { PACING, SendOutcome, nextDelayMs, normalizePhone, sleep } from '../../src/lib/whatsappCore.js';

export interface RouteRequest {
  /** Chemin SANS le préfixe `/api/whatsapp`, ex. `send`, `outbox/flush`. */
  path: string;
  method: string;
  body: any;
  headers: Record<string, string | string[] | undefined>;
  /** Hôte du domaine sur lequel l'application répond — sert à dériver le webhook. */
  host?: string;
  proto?: string;
}

export interface RouteResponse {
  status: number;
  body: any;
}

const header = (h: RouteRequest['headers'], name: string): string => {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] || '') : (v || '');
};

const newId = () => `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * ─── LE BUDGET DE TEMPS D'UNE REQUÊTE ──────────────────────────────────────────
 *
 * Une fonction serverless est coupée net au bout de son délai maximal (60 s ici,
 * voir `vercel.json`). Or la temporisation anti-bannissement impose 3 à 7 s
 * ENTRE deux destinataires : dix destinataires ne tiennent pas dans une requête,
 * et accélérer pour les y faire tenir coûterait le numéro.
 *
 * La règle est donc : on envoie tant qu'il reste du temps, et **tout ce qui ne
 * tient pas part en FILE D'ATTENTE** — pas en échec. Le vidage reprend le reste
 * à la même cadence, sans que personne ait à recliquer. C'est la même mécanique
 * que « la passerelle est éteinte », pour une raison différente.
 */
const REQUEST_BUDGET_MS = 45_000;

/** L'erreur telle que l'écran doit la lire : cause système + manœuvre, jamais la clé. */
function errorBody(err: any) {
  if (err instanceof GatewayError) {
    return {
      error: err.message,
      code: err.code,
      host: err.host || null,
      remedy: remedyFor(err.code),
      unreachable: err.unreachable,
    };
  }
  return { error: String(err?.message || err), code: 'UNEXPECTED', remedy: null, unreachable: false };
}

// ─── /status ───────────────────────────────────────────────────────────────────

async function statusRoute(req: RouteRequest): Promise<RouteResponse> {
  const env = gatewayEnv();
  const resolved = webhookUrl(req.host, req.proto);
  const base = {
    configured: isConfigured(env),
    storageConfigured: storageConfigured(),
    instanceMasked: maskInstance(env.instance),
    baseUrlHost: baseUrlHost(env),
    expectedWebhookUrl: resolved.url,
    ignoredEnv: resolved.ignored || null,
    ignoredReason: resolved.reason || null,
    pending: await pendingCount(),
  };

  if (!base.configured) {
    return {
      status: 200,
      body: {
        ...base, state: 'close', connected: false, linkedNumber: null, profileName: null,
        webhook: 'unknown', webhookConfigured: false, qrBase64: null, pairingCode: null,
        error: "La passerelle n'est pas configurée : renseignez EVOLUTION_BASE_URL, EVOLUTION_API_KEY et EVOLUTION_INSTANCE chez l'hébergeur, puis redéployez.",
        remedy: null,
      },
    };
  }

  try {
    const s = await sessionState(env);
    /**
     * ─── « JETON VÉRIFIÉ » N'EST PAS « JETON PRÉSENT » ──────────────────────
     * L'écran se contentait de constater que `EVOLUTION_WEBHOOK_TOKEN` existait
     * côté serveur. Cela ne dit RIEN de ce que la passerelle, elle, enverra :
     * les deux divergent dès qu'on régénère la variable sans réenregistrer le
     * webhook. Chaque accusé part alors en 401 pendant que l'écran affiche
     * « prête ». On relit donc le webhook RÉELLEMENT enregistré.
     */
    let webhook: 'unknown' | 'missing' | 'wrong-url' | 'token-mismatch' | 'verified' = 'unknown';
    try {
      const w = await currentWebhook(env);
      if (!w || !w.url) webhook = 'missing';
      else if (w.url.replace(/\/+$/, '') !== resolved.url.replace(/\/+$/, '')) webhook = 'wrong-url';
      else if (!env.webhookToken || w.token !== env.webhookToken) webhook = 'token-mismatch';
      else webhook = 'verified';
    } catch { webhook = 'unknown'; }

    return {
      status: 200,
      body: {
        ...base,
        state: s.state,
        connected: s.state === 'open',
        linkedNumber: s.linkedNumber,
        profileName: s.profileName,
        webhook,
        webhookConfigured: webhook === 'verified',
        qrBase64: null,
        pairingCode: null,
        error: null,
        remedy: null,
      },
    };
  } catch (err) {
    const e = errorBody(err);
    return {
      status: 200,
      body: {
        ...base, state: 'close', connected: false, linkedNumber: null, profileName: null,
        webhook: 'unknown', webhookConfigured: false, qrBase64: null, pairingCode: null,
        error: e.error, remedy: e.remedy, code: e.code,
      },
    };
  }
}

// ─── /session ──────────────────────────────────────────────────────────────────

async function sessionRoute(req: RouteRequest): Promise<RouteResponse> {
  const env = gatewayEnv();
  if (!isConfigured(env)) {
    return { status: 400, body: { error: "La passerelle n'est pas configurée.", remedy: null } };
  }
  const action = String(req.body?.action || '');
  const resolved = webhookUrl(req.host, req.proto);

  /**
   * ─── UN DÉPLOIEMENT DE PRÉVISUALISATION NE DOIT PAS TOUCHER À LA PRODUCTION ──
   *
   * Il n'y a QU'UNE passerelle, QU'UNE instance et QU'UN emplacement de webhook,
   * et le webhook est stocké SUR LA PASSERELLE — pas dans l'application. Or les
   * variables d'environnement sont déclarées « Production and Preview » : chaque
   * déploiement de branche parle donc à la MÊME passerelle.
   *
   * Deux gestes y deviennent destructeurs pour la production :
   *
   *   • `setup` réécrirait le webhook vers l'adresse de la PRÉVISUALISATION.
   *     Les messages continueraient de partir, et plus aucun accusé de remise
   *     ne reviendrait en production — les statuts resteraient bloqués, sans
   *     la moindre erreur nulle part. C'est le piège le plus muet du montage,
   *     déjà rencontré au passage de localhost à la production ;
   *   • `logout` délierait le téléphone de la station.
   *
   * `connect` et `restart` restent autorisés : ils visent la même instance sans
   * rien réécrire de durable.
   */
  const isPreview = String(process.env.VERCEL_ENV || '') === 'preview';
  if (isPreview && (action === 'setup' || action === 'logout')) {
    return {
      status: 409,
      body: {
        error: `L'action « ${action} » est refusée depuis un déploiement de prévisualisation.`,
        remedy: action === 'setup'
          ? "Ce bouton réécrirait l'adresse du webhook vers CETTE prévisualisation : la production continuerait d'envoyer, mais ne recevrait plus aucun accusé de remise, sans qu'aucune erreur ne le signale. Faites-le depuis le domaine de production."
          : 'Ce bouton délierait le téléphone de la station, pour tout le monde. Faites-le depuis le domaine de production.',
      },
    };
  }

  try {
    let qr: { qrBase64: string | null; pairingCode: string | null } = { qrBase64: null, pairingCode: null };
    switch (action) {
      case 'setup':
        // Création PUIS enregistrement du webhook — et cet enchaînement doit
        // rester exécutable sur une session déjà ouverte : c'est précisément le
        // cas « webhook périmé » qui a besoin du bouton.
        await createInstance(resolved.url, env);
        await setWebhook(resolved.url, env);
        break;
      case 'connect':
        qr = await connectInstance(env);
        break;
      case 'restart':
        await restartInstance(env);
        break;
      case 'logout':
        await logoutInstance(env);
        break;
      default:
        return { status: 400, body: { error: `Action inconnue : « ${action} ».` } };
    }
    const st = await statusRoute(req);
    return { status: 200, body: { ...st.body, ...qr } };
  } catch (err) {
    return { status: 502, body: errorBody(err) };
  }
}

// ─── /send ─────────────────────────────────────────────────────────────────────

interface Recipient {
  phone: string;
  name?: string;
  clientId?: string;
  carLabel?: string;
  body: string;
  moduleKey?: string;
  kind?: string;
  rappelKind?: string;
}

export interface SendReport {
  name: string;
  phone: string;
  outcome: SendOutcome;
  messageId: string;
  error?: string;
}

async function sendRoute(req: RouteRequest): Promise<RouteResponse> {
  const env = gatewayEnv();
  if (!isConfigured(env)) {
    return { status: 400, body: { error: "La passerelle n'est pas configurée." } };
  }

  const list: Recipient[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  if (!list.length) return { status: 400, body: { error: 'Aucun destinataire.' } };
  if (list.length > PACING.maxPerRequest) {
    return {
      status: 400,
      body: { error: `Au maximum ${PACING.maxPerRequest} destinataires par envoi — au-delà, la temporisation ferait expirer la requête.` },
    };
  }

  const by = String(req.body?.createdBy || '') || null;
  const reports: SendReport[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const msisdn = normalizePhone(r.phone);
    const messageId = newId();
    const text = String(r.body || '').trim();

    if (!msisdn) {
      // Un numéro invalide est refusé TOUT DE SUITE, jamais mis en file : le
      // découvrir trois jours plus tard au fond d'un journal ne sert personne.
      reports.push({ name: r.name || r.phone, phone: r.phone, outcome: 'failed', messageId, error: 'Numéro de téléphone invalide.' });
      continue;
    }
    if (!text) {
      reports.push({ name: r.name || r.phone, phone: r.phone, outcome: 'failed', messageId, error: 'Message vide.' });
      continue;
    }

    const common = {
      id: messageId,
      module_key: r.moduleKey || null,
      client_id: r.clientId || null,
      recipient_phone: msisdn,
      recipient_name: r.name || null,
      body: text,
      kind: r.kind || 'libre',
      rappel_kind: r.rappelKind || null,
      car_label: r.carLabel || null,
      created_by: by,
    };

    // Plus assez de temps pour temporiser correctement : le reste part en file
    // plutôt que d'être expédié trop vite ou coupé en plein vol.
    if (i > 0 && Date.now() - startedAt > REQUEST_BUDGET_MS) {
      const queued = await enqueue({
        id: messageId, message_id: messageId, recipient_phone: msisdn,
        recipient_display: r.phone, recipient_name: r.name || null, body: text,
      });
      await journal({ ...common, status: queued ? 'queued' : 'failed', error: queued ? null : "File d'attente indisponible." });
      reports.push({
        name: r.name || msisdn, phone: msisdn,
        outcome: queued ? 'queued' : 'failed', messageId,
        error: queued ? undefined : "Trop de destinataires pour un seul envoi, et la file d'attente est indisponible.",
      });
      continue;
    }

    // La temporisation s'applique ENTRE les destinataires, jamais avant le
    // premier : un envoi isolé ne doit pas faire attendre l'utilisateur.
    if (i > 0) await sleep(nextDelayMs());

    try {
      const sent = await sendText(msisdn, text, env);
      await journal({ ...common, status: 'sent', gateway_id: sent.gatewayId, sent_at: new Date().toISOString() });
      reports.push({ name: r.name || msisdn, phone: msisdn, outcome: 'sent', messageId });
    } catch (err: any) {
      const info = errorBody(err);
      if (err instanceof GatewayError && err.unreachable) {
        // Passerelle éteinte : le message ATTEND, il n'est pas perdu.
        const queued = await enqueue({
          id: messageId, message_id: messageId, recipient_phone: msisdn,
          recipient_display: r.phone, recipient_name: r.name || null, body: text,
        });
        await journal({ ...common, status: queued ? 'queued' : 'failed', error: queued ? null : info.error });
        reports.push({
          name: r.name || msisdn, phone: msisdn,
          outcome: queued ? 'queued' : 'failed',
          messageId,
          error: queued ? undefined : `${info.error} (et la file d'attente est indisponible : ce message est perdu)`,
        });
      } else {
        // Refus propre au destinataire : le remettre en file le referait
        // refuser à l'identique.
        await journal({ ...common, status: 'failed', error: info.error });
        reports.push({ name: r.name || msisdn, phone: msisdn, outcome: 'failed', messageId, error: info.error });
      }
    }
  }

  const counts = {
    sent: reports.filter(r => r.outcome === 'sent').length,
    queued: reports.filter(r => r.outcome === 'queued').length,
    failed: reports.filter(r => r.outcome === 'failed').length,
  };
  return { status: 200, body: { reports, counts, persisted: storageConfigured() } };
}

// ─── /outbox et /outbox/flush ──────────────────────────────────────────────────

async function outboxRoute(): Promise<RouteResponse> {
  // Un COMPTAGE, et rien d'autre : cet écran reste ouvert des heures, et chaque
  // appel à la passerelle réveillerait le poste pour rien.
  return { status: 200, body: { pending: await pendingCount(), storageConfigured: storageConfigured() } };
}

async function flushRoute(): Promise<RouteResponse> {
  if (!storageConfigured()) {
    return { status: 200, body: { sent: 0, deferred: 0, failed: 0, expired: 0, pending: 0, storageConfigured: false } };
  }
  const expired = await expireOld();
  const rows = await takePending(PACING.maxPerFlush);
  let sent = 0, deferred = 0, failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Le budget épuisé, on s'arrête : ce qui reste est TOUJOURS en file et
    // repartira au prochain vidage. Rien n'est perdu, rien n'est accéléré.
    if (i > 0 && Date.now() - startedAt > REQUEST_BUDGET_MS) break;
    // Le rattrapage traite justement des LOTS accumulés : c'est le moment où
    // l'on ressemble le plus à un robot, donc le dernier endroit où accélérer.
    if (i > 0) await sleep(nextDelayMs());
    try {
      const res = await sendText(row.recipient_phone, row.body);
      await outboxSent(row.id);
      if (row.message_id) {
        await journal({
          id: row.message_id,
          recipient_phone: row.recipient_phone,
          recipient_name: row.recipient_name || null,
          body: row.body,
          status: 'sent',
          gateway_id: res.gatewayId,
          sent_at: new Date().toISOString(),
        });
      }
      sent++;
    } catch (err: any) {
      const info = errorBody(err);
      if (err instanceof GatewayError && err.unreachable) {
        // La passerelle est repartie en panne au milieu du lot : on s'arrête
        // là, et AUCUNE tentative n'est consommée.
        await outboxDeferred(row.id, info.error);
        deferred++;
        break;
      }
      await outboxFailed(row, info.error);
      failed++;
    }
  }

  return {
    status: 200,
    body: { sent, deferred, failed, expired, pending: await pendingCount(), storageConfigured: true, maxAttempts: MAX_ATTEMPTS, expiryDays: EXPIRY_DAYS },
  };
}

// ─── /webhook ──────────────────────────────────────────────────────────────────

/**
 * Les accusés de remise. DEUX contrôles, et pas un seul :
 *   • le `Bearer` — il prouve que l'appel vient bien de NOTRE passerelle ;
 *   • le champ `server_url` du corps — il doit valoir `EVOLUTION_BASE_URL` AU
 *     CARACTÈRE PRÈS. Un slash final en trop et tous les statuts partent en 403,
 *     c'est le piège 6.1 du montage.
 */
async function webhookRoute(req: RouteRequest): Promise<RouteResponse> {
  const env = gatewayEnv();
  const auth = header(req.headers, 'authorization').replace(/^Bearer\s+/i, '');
  if (!env.webhookToken || auth !== env.webhookToken) {
    return { status: 401, body: { error: 'Jeton absent ou invalide.' } };
  }
  const serverUrl = String(req.body?.server_url || '').replace(/\/+$/, '');
  if (serverUrl && env.baseUrl && serverUrl !== env.baseUrl) {
    return { status: 403, body: { error: 'server_url ne correspond pas à la passerelle déclarée.' } };
  }

  const event = String(req.body?.event || '').toUpperCase().replace(/\./g, '_');
  const data = req.body?.data;

  if (event === 'MESSAGES_UPDATE') {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const id = row?.keyId || row?.key?.id || row?.messageId;
      const raw = String(row?.status || row?.update?.status || '').toUpperCase();
      const status = raw === 'READ' || raw === 'PLAYED' ? 'read'
        : raw === 'DELIVERY_ACK' || raw === 'DELIVERED' ? 'delivered'
        : raw === 'SERVER_ACK' || raw === 'SENT' ? 'sent'
        : raw === 'ERROR' || raw === 'FAILED' ? 'failed'
        : null;
      if (id && status) await markStatus(String(id), status);
    }
  }
  // Les autres événements sont acceptés et ignorés : c'est ce qui permet à
  // `check-gateway.ps1` d'éprouver l'AUTHENTIFICATION avec un événement inconnu
  // sans rien écrire dans la base.
  return { status: 200, body: { ok: true } };
}

// ─── Le répartiteur ────────────────────────────────────────────────────────────

export async function handleWhatsApp(req: RouteRequest): Promise<RouteResponse> {
  const path = req.path.replace(/^\/+|\/+$/g, '');
  const method = req.method.toUpperCase();

  try {
    if (path === 'status' && method === 'GET') return await statusRoute(req);
    if (path === 'session' && method === 'POST') return await sessionRoute(req);
    if (path === 'send' && method === 'POST') return await sendRoute(req);
    if (path === 'webhook' && method === 'POST') return await webhookRoute(req);
    if (path === 'outbox' && method === 'GET') return await outboxRoute();
    if (path === 'outbox/flush' && method === 'POST') return await flushRoute();
    return { status: 404, body: { error: `Route inconnue : /api/whatsapp/${path}` } };
  } catch (err: any) {
    console.error('[whatsapp]', path, err?.message || err);
    return { status: 500, body: errorBody(err) };
  }
}
