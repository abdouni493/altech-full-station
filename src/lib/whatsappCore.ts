/**
 * ─── LE NOYAU WHATSAPP — CE QUE LE NAVIGATEUR ET LE SERVEUR PARTAGENT ──────────
 *
 * Ce fichier ne parle NI au réseau, NI à la base, NI au navigateur. Il ne
 * contient que les règles qui doivent être identiques des deux côtés :
 *
 *   • la NORMALISATION d'un numéro. Un numéro écrit « 0550 12 34 56 » dans la
 *     fiche client et « +213 550 12 34 56 » dans une autre doit désigner le même
 *     destinataire, sinon le même client reçoit deux fois le même rappel ;
 *   • la TEMPORISATION entre deux envois. Le rattrapage de la file traite
 *     justement des lots accumulés : c'est le moment où l'on ressemble le plus à
 *     un robot, donc le dernier endroit où accélérer. Dupliquer ces constantes
 *     les laisserait diverger, et une divergence ici coûte le NUMÉRO — un compte
 *     WhatsApp banni l'est sans recours ;
 *   • le REMPLISSAGE d'un modèle de message.
 *
 * Le serveur (`api/_lib/*`) et l'application importent tous les deux d'ici.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ─── Numéros ───────────────────────────────────────────────────────────────────

/** Indicatif du pays de la station. L'Algérie : +213. */
export const COUNTRY_CODE = '213';

/**
 * Ramène un numéro à la forme que la passerelle attend : chiffres seuls,
 * indicatif pays compris, sans `+` ni espaces (`213550123456`).
 *
 * Rend `null` quand le numéro ne peut pas être un mobile joignable. C'est
 * VOULU : un numéro invalide doit être refusé à la mise en file, pas découvert
 * trois jours plus tard au fond d'un journal d'erreurs.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // On garde les chiffres, et le `+` seulement s'il ouvre la chaîne.
  let d = String(raw).trim().replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  d = d.replace(/\D/g, '');
  if (!d) return null;

  // « 00213… » — la forme internationale écrite à l'ancienne.
  if (d.startsWith('00')) d = d.slice(2);

  // Déjà à l'indicatif : « 213550123456 » (12 chiffres pour un mobile algérien).
  if (d.startsWith(COUNTRY_CODE) && d.length >= 11 && d.length <= 15) return d;

  // Forme nationale : « 0550123456 » → 10 chiffres commençant par 0.
  if (d.startsWith('0') && d.length === 10) return COUNTRY_CODE + d.slice(1);

  // Numéro donné sans son zéro : « 550123456 ».
  if (d.length === 9 && /^[5-7]/.test(d)) return COUNTRY_CODE + d;

  // Numéro étranger déjà complet — on ne présume pas de son plan de numérotation.
  if (d.length >= 11 && d.length <= 15) return d;

  return null;
}

/** Affichage lisible d'un numéro normalisé : `213550123456` → `+213 550 12 34 56`. */
export function displayPhone(msisdn: string | null | undefined): string {
  if (!msisdn) return '';
  if (msisdn.startsWith(COUNTRY_CODE) && msisdn.length === 12) {
    const n = msisdn.slice(3);
    return `+${COUNTRY_CODE} ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }
  return `+${msisdn}`;
}

// ─── Temporisation anti-bannissement ───────────────────────────────────────────
/**
 * WhatsApp bannit les comptes qui écrivent vite et à beaucoup de monde. Le
 * montage est auto-hébergé : personne ne viendra plaider le dossier, et un
 * numéro banni l'est SANS RECOURS.
 *
 * Ces bornes sont donc volontairement lentes, et le rattrapage de la file
 * les respecte à l'identique — c'est même là qu'elles comptent le plus.
 */
export const PACING = {
  /** Attente minimale entre deux destinataires, en millisecondes. */
  minDelayMs: 3_000,
  /** Attente maximale — un intervalle régulier au millième près fait robot. */
  maxDelayMs: 7_000,
  /** Destinataires acceptés en UN appel : au-delà, la file prend le relais. */
  maxPerRequest: 40,
  /** Messages sortis d'un seul vidage de la file. */
  maxPerFlush: 15,
};

/** Une attente tirée au hasard dans la fourchette — jamais deux fois la même. */
export function nextDelayMs(): number {
  const { minDelayMs, maxDelayMs } = PACING;
  return minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
}

/** `await sleep(ms)` — utilisé des deux côtés de l'envoi groupé. */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Modèles de message ────────────────────────────────────────────────────────

/** Ce qu'un jeton de modèle peut valoir au moment de l'envoi. */
export interface MessageVars {
  client?: string;
  vehicule?: string;
  marque?: string;
  modele?: string;
  immatriculation?: string;
  kilometrage?: string;
  derniere_visite?: string;
  prestation?: string;
  station?: string;
  telephone?: string;
}

/**
 * Remplace les `{jetons}` d'un modèle par leurs valeurs.
 *
 * Un jeton INCONNU est laissé tel quel plutôt que remplacé par du vide : mieux
 * vaut voir `{truc}` à la relecture — et le corriger — que d'envoyer une phrase
 * amputée sans s'en apercevoir. Un jeton connu mais VIDE, lui, disparaît, et
 * les espaces doubles qu'il laisse sont resserrés.
 */
export function renderTemplate(body: string, vars: MessageVars): string {
  const out = String(body || '').replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in vars)) return whole;
    const v = (vars as any)[key];
    return v == null ? '' : String(v);
  });
  return out
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

/** Les jetons encore non remplis d'un texte — sert à prévenir avant l'envoi. */
export function missingTokens(body: string): string[] {
  const found = String(body || '').match(/\{(\w+)\}/g) || [];
  return Array.from(new Set(found));
}

// ─── Messages professionnels proposés d'office ─────────────────────────────────
/**
 * ─── POURQUOI L'APPLICATION ÉCRIT LE PREMIER JET ───────────────────────────────
 *
 * Devant un champ vide, on écrit vite et mal : pas de salutation, pas de nom de
 * station, pas de moyen de répondre. Un client qui reçoit « votre vidange est à
 * refaire » d'un numéro inconnu bloque le numéro — et un numéro bloqué par
 * plusieurs personnes finit banni.
 *
 * L'application propose donc un texte complet et poli, que l'utilisateur MODIFIE
 * librement. Il n'est jamais envoyé sans avoir été vu.
 */
export function defaultRappelMessage(kind: 'lavage' | 'reparation', vars: MessageVars): string {
  const bonjour = vars.client ? `Bonjour ${vars.client},` : 'Bonjour,';
  const vehicule = vars.vehicule ? ` pour votre véhicule ${vars.vehicule}` : '';
  const depuis = vars.derniere_visite ? ` (dernier passage le ${vars.derniere_visite})` : '';
  const km = vars.kilometrage ? `\nDernier kilométrage relevé : ${vars.kilometrage} km.` : '';
  const signature = [
    '',
    vars.station ? `${vars.station}` : '',
    vars.telephone ? `Tél. : ${vars.telephone}` : '',
  ].filter(Boolean).join('\n');

  if (kind === 'lavage') {
    return [
      bonjour,
      '',
      `Il est temps de penser au prochain lavage${vehicule}${depuis}.${km}`,
      '',
      'Nous serons heureux de vous accueillir. Répondez à ce message pour convenir d\'un créneau.',
      signature,
    ].join('\n').trim();
  }
  return [
    bonjour,
    '',
    `Votre prochaine révision approche${vehicule}${depuis}.${km}`,
    '',
    'Un contrôle régulier évite les pannes coûteuses. Répondez à ce message pour convenir d\'un rendez-vous.',
    signature,
  ].join('\n').trim();
}

/** Modèles installés d'office la première fois qu'on ouvre l'écran Messages. */
export const STARTER_TEMPLATES: { name: string; usage: 'lavage' | 'reparation' | 'libre'; body: string }[] = [
  {
    name: 'Rappel de lavage',
    usage: 'lavage',
    body: [
      'Bonjour {client},',
      '',
      'Il est temps de penser au prochain lavage pour votre {vehicule}.',
      'Dernier passage : {derniere_visite}.',
      '',
      'Répondez à ce message pour convenir d\'un créneau.',
      '',
      '{station}',
      'Tél. : {telephone}',
    ].join('\n'),
  },
  {
    name: 'Rappel de révision',
    usage: 'reparation',
    body: [
      'Bonjour {client},',
      '',
      'Votre {vehicule} approche de sa prochaine révision (dernier passage : {derniere_visite}, {kilometrage} km).',
      '',
      'Un contrôle régulier évite les pannes coûteuses. Répondez pour convenir d\'un rendez-vous.',
      '',
      '{station}',
      'Tél. : {telephone}',
    ].join('\n'),
  },
  {
    name: 'Véhicule prêt',
    usage: 'libre',
    body: [
      'Bonjour {client},',
      '',
      'Votre {vehicule} est prête et vous attend.',
      '',
      'Merci de votre confiance.',
      '',
      '{station}',
      'Tél. : {telephone}',
    ].join('\n'),
  },
];

// ─── Statuts d'un message ──────────────────────────────────────────────────────

/**
 * Les trois issues d'un envoi, et pourquoi elles ne se confondent pas :
 *   • `sent`   — la passerelle l'a pris en charge ;
 *   • `queued` — la passerelle était injoignable : le message ATTEND, il n'est
 *                pas perdu. L'afficher en rouge ferait croire à une perte ;
 *   • `failed` — refus propre au destinataire (numéro sans compte WhatsApp…).
 */
export type SendOutcome = 'sent' | 'queued' | 'failed';

/** État de remise, tel que le webhook de la passerelle le fait progresser. */
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'En attente',
  sent: 'Envoyé',
  delivered: 'Remis',
  read: 'Lu',
  failed: 'Échec',
};
