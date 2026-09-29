/**
 * ─── LES RÉGLAGES DE LA PASSERELLE, LUS CÔTÉ SERVEUR UNIQUEMENT ────────────────
 *
 * Aucune de ces variables ne porte le préfixe `VITE_` : ce préfixe est ce qui
 * fait entrer une valeur dans le paquet JavaScript envoyé au navigateur. La clé
 * de la passerelle publiée dans le navigateur de chaque visiteur, c'est la
 * passerelle offerte à qui la lit — donc le numéro WhatsApp de la station entre
 * les mains d'un inconnu.
 *
 * `EVOLUTION_WEBHOOK_URL` mérite une explication à part, parce qu'elle a déjà
 * coûté une mise en service : voir `webhookUrl()` plus bas.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface GatewayEnv {
  baseUrl: string;
  apiKey: string;
  instance: string;
  webhookToken: string;
}

const trim = (v: string | undefined): string => (v || '').trim();

/** Sans slash final : `SERVER_URL` est comparé AU CARACTÈRE PRÈS par le webhook. */
export const stripSlash = (u: string): string => u.replace(/\/+$/, '');

/**
 * Ce que la passerelle exige pour qu'un envoi soit seulement tentable.
 *
 * ─── POURQUOI `TUNNEL_PUBLIC_URL` FAIT OFFICE DE REPLI ─────────────────────────
 * L'adresse de la passerelle est écrite à DEUX endroits : `TUNNEL_PUBLIC_URL`
 * dans `evolution/.env` (elle devient le `SERVER_URL` du conteneur) et
 * `EVOLUTION_BASE_URL` côté application. Ces deux valeurs doivent être
 * identiques AU CARACTÈRE PRÈS : la première est estampillée dans le champ
 * `server_url` de chaque webhook, la seconde est ce à quoi l'application le
 * compare. Un slash final en trop d'un seul côté, et tous les accusés de remise
 * repartent en 403.
 *
 * Deux valeurs qui doivent rester égales finissent toujours par diverger. Sur le
 * poste de développement, où le même fichier sert aux deux, on lit donc
 * `TUNNEL_PUBLIC_URL` à défaut d'`EVOLUTION_BASE_URL` : il n'y a plus qu'une
 * seule valeur à tenir juste. Chez l'hébergeur, `EVOLUTION_BASE_URL` reste la
 * variable à renseigner — le conteneur, lui, n'y est pas.
 */
export function gatewayEnv(): GatewayEnv {
  return {
    baseUrl: stripSlash(trim(process.env.EVOLUTION_BASE_URL) || trim(process.env.TUNNEL_PUBLIC_URL)),
    apiKey: trim(process.env.EVOLUTION_API_KEY),
    instance: trim(process.env.EVOLUTION_INSTANCE) || 'station',
    webhookToken: trim(process.env.EVOLUTION_WEBHOOK_TOKEN),
  };
}

/** Les quatre valeurs minimales sont-elles là ? */
export function isConfigured(env: GatewayEnv = gatewayEnv()): boolean {
  return !!(env.baseUrl && env.apiKey && env.instance);
}

/** Hôte seul — c'est tout ce que l'écran de réglages a le droit d'afficher. */
export function baseUrlHost(env: GatewayEnv = gatewayEnv()): string | null {
  if (!env.baseUrl) return null;
  try { return new URL(env.baseUrl).host; } catch { return null; }
}

/** Nom d'instance masqué : `benzaoui` → `•••••aoui`. */
export function maskInstance(name: string): string | null {
  if (!name) return null;
  if (name.length <= 4) return '•'.repeat(name.length);
  return '•'.repeat(name.length - 4) + name.slice(-4);
}

/** Une origine locale ne peut pas être le domaine public de l'application. */
function isLocalOrigin(u: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\[::1\])(:|\/|$)/i.test(u);
}

export interface WebhookResolution {
  url: string;
  /**
   * La variable qui a été ÉCARTÉE, s'il y en a une. L'écran de réglages la
   * nomme : une 400 muette ne dit pas quelle ligne du `.env` est fautive.
   */
  ignored?: string;
  reason?: string;
}

/**
 * ─── L'ADRESSE OÙ LA PASSERELLE DOIT RAPPELER ──────────────────────────────────
 *
 * Elle se DÉDUIT du domaine sur lequel l'application tourne, et non d'une
 * variable. Motif, vécu deux fois :
 *
 *   • le webhook est stocké SUR LA PASSERELLE, pas dans l'application. Il
 *     survit donc aux déménagements et continue de pointer vers l'ancienne
 *     adresse — les messages partent, aucun accusé ne revient, et rien nulle
 *     part ne signale d'erreur ;
 *   • recopier un `.env` local vers l'hébergeur en bloc emporte
 *     `EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3000`, l'adresse du
 *     poste de développement vue depuis le conteneur. La mise en service échoue
 *     alors sur une 400 qui ne désigne rien.
 *
 * Toute valeur locale ou non-HTTPS est donc ÉCARTÉE en production, et NOMMÉE
 * dans le diagnostic. Une variable mal recopiée ne casse plus rien ; elle se
 * voit.
 */
export function webhookUrl(requestHost?: string, forwardedProto?: string): WebhookResolution {
  const explicit = stripSlash(trim(process.env.EVOLUTION_WEBHOOK_URL));
  const site = stripSlash(
    trim(process.env.PUBLIC_SITE_URL) ||
    trim(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''),
  );

  const proto = forwardedProto || (requestHost && /^localhost|^127\./.test(requestHost) ? 'http' : 'https');
  const derived = requestHost ? stripSlash(`${proto}://${requestHost}`) : '';

  const path = '/api/whatsapp/webhook';
  const local = derived ? isLocalOrigin(derived) : false;

  // En développement (l'application elle-même tourne en local), une adresse
  // locale est LÉGITIME : c'est la seule que la passerelle puisse joindre.
  if (local) {
    return { url: `${explicit || derived}${path}` };
  }

  if (explicit && !isLocalOrigin(explicit) && explicit.startsWith('https://')) {
    return { url: `${explicit}${path}` };
  }
  if (explicit) {
    const base = site || derived;
    return {
      url: `${base}${path}`,
      ignored: 'EVOLUTION_WEBHOOK_URL',
      reason: `La valeur « ${explicit} » n'est pas une adresse publique HTTPS : le domaine de l'application a été utilisé à la place. Retirez cette variable des réglages de l'hébergeur.`,
    };
  }
  return { url: `${site || derived}${path}` };
}
