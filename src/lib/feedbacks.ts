/**
 * ─── Retours clients — la boîte aux lettres publique de la station ─────────────
 *
 * Un client dépose son avis depuis la page publique `/client` (aucun compte, et
 * rien d'obligatoire hormis la partie visée et le message). L'avis est rattaché
 * à UNE partie : carburant, cafétéria ou lavage — et c'est l'écran « Retours
 * clients » de cette partie qui l'affiche.
 *
 * NOM ET TÉLÉPHONE FACULTATIFS
 *   Un avis peut arriver anonyme : le client pressé, ou celui qui ne veut pas se
 *   nommer, a quand même quelque chose à dire. Les coordonnées ne servent qu'à
 *   rappeler — leur absence n'empêche donc rien, elle prive juste la station de
 *   la réponse. Côté application, `fullName` et `phone` sont donc optionnels
 *   PARTOUT : jamais de `f.phone.trim()` sans garde.
 *
 * POURQUOI UNE TABLE À PART, ET PAS LE BLOB `biz_store`
 *   Le blob des parties commerciales n'est lisible et inscriptible que par un
 *   utilisateur CONNECTÉ. Un visiteur n'a pas de compte : il lui faut une table
 *   dont les règles RLS autorisent l'insertion à `anon` — et rien d'autre. Cette
 *   table ne sert qu'à ça, elle ne contient aucune donnée de la station.
 *
 *   Migration : supabase/migrations/2026-08-14_client_feedbacks.sql
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from './supabase';

/** Partie de la station visée par un avis. `fuel` = station-service. */
export type FeedbackPart = 'fuel' | 'restaurant' | 'cafeteria' | 'lavage';

export type FeedbackStatus = 'unread' | 'read';

export interface ClientFeedback {
  id: string;
  part: FeedbackPart;
  /** Absent quand le client n'a pas voulu se nommer. */
  fullName?: string;
  /** Absent quand le client ne souhaite pas être rappelé. */
  phone?: string;
  email?: string;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  readAt?: string;
  readBy?: string;
}

/** Ce que la page publique envoie — seuls `part` et `message` sont exigés. */
export interface FeedbackDraft {
  part: FeedbackPart;
  fullName?: string;
  phone?: string;
  email?: string;
  message: string;
}

/**
 * Comment nommer l'auteur d'un avis à l'écran. Centralisé ici pour que les
 * écrans internes disent tous la même chose d'un client resté anonyme.
 */
export const feedbackAuthor = (f: { fullName?: string }): string =>
  f.fullName?.trim() || 'Client anonyme';

/** Présentation d'une partie — partagée par la page publique et les écrans internes. */
export const FEEDBACK_PARTS: {
  id: FeedbackPart; label: string; short: string; emoji: string; hint: string;
}[] = [
  { id: 'fuel',      label: 'Carburant',            short: 'Carburant', emoji: '⛽', hint: 'Pompes, service à la piste, prix, propreté' },
  { id: 'restaurant', label: 'Restaurant',           short: 'Restaurant', emoji: '🍽️', hint: 'Plats, service en salle, accueil' },
  { id: 'cafeteria', label: 'Cafétéria',            short: 'Cafétéria', emoji: '☕', hint: 'Boissons, restauration, accueil au comptoir' },
  { id: 'lavage',    label: 'Lavage & Vidange',  short: 'Lavage',    emoji: '🧽', hint: 'Lavage du véhicule, vidange, mécanique' },
];

export const FEEDBACK_PART_META: Record<FeedbackPart, { label: string; short: string; emoji: string }> =
  Object.fromEntries(FEEDBACK_PARTS.map(p => [p.id, { label: p.label, short: p.short, emoji: p.emoji }])) as any;

/** Un identifiant de partie inconnu (base plus récente que ce build) est ignoré. */
export const isFeedbackPart = (v: unknown): v is FeedbackPart =>
  v === 'fuel' || v === 'restaurant' || v === 'cafeteria' || v === 'lavage';

// ─── Correspondance ligne ↔ objet ──────────────────────────────────────────────

interface FeedbackRow {
  id: string;
  part: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  message: string;
  status: string;
  created_at: string;
  read_at: string | null;
  read_by: string | null;
}

function rowToFeedback(r: FeedbackRow): ClientFeedback {
  return {
    id: r.id,
    part: (isFeedbackPart(r.part) ? r.part : 'fuel'),
    // Un champ vide vaut « non renseigné » : la base d'une station qui n'a pas
    // encore reçu la migration peut encore contenir des chaînes vides.
    fullName: r.full_name?.trim() || undefined,
    phone: r.phone?.trim() || undefined,
    email: r.email?.trim() || undefined,
    message: r.message,
    status: r.status === 'read' ? 'read' : 'unread',
    createdAt: r.created_at,
    readAt: r.read_at || undefined,
    readBy: r.read_by || undefined,
  };
}

/**
 * Table absente (migration non passée). Reconnu sur le CODE d'erreur : un refus
 * RLS nomme lui aussi la table et ne doit surtout pas être confondu avec elle.
 */
export function isMissingFeedbackTable(err?: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST202') return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(err.message || '');
}

/**
 * Base restée à la PREMIÈRE version de la table, où le nom et le téléphone
 * étaient obligatoires : un avis anonyme s'y heurte à une violation de
 * contrainte (23502 not null, 23514 check). Le visiteur n'a rien fait de mal —
 * il faut lui dire quoi faire, pas lui montrer le message de PostgreSQL.
 */
function isLegacyRequiredContact(err?: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const onContactColumn = /full_name|phone/i.test(err.message || '');
  return (err.code === '23502' || err.code === '23514') && onContactColumn;
}

// ─── Dépôt d'un avis (page publique, sans compte) ──────────────────────────────

/**
 * Enregistre l'avis d'un client. L'erreur est RENDUE, jamais avalée : la page
 * publique doit pouvoir dire « ce n'est pas parti, réessayez » plutôt que
 * d'afficher un remerciement pour un message perdu.
 *
 * Seuls la partie et le message sont exigés. Le nom et le téléphone ne sont
 * vérifiés QUE si le client en a saisi un : laisser le champ vide est un choix
 * légitime, y écrire « a » ou « 12 » est une faute de frappe qu'il vaut mieux
 * signaler tout de suite que découvrir en essayant de rappeler.
 */
export async function submitClientFeedback(
  draft: FeedbackDraft,
): Promise<{ ok: boolean; error?: string }> {
  const fullName = draft.fullName?.trim() || '';
  const phone = draft.phone?.trim() || '';
  const message = draft.message.trim();
  const email = draft.email?.trim();

  if (message.length < 3) return { ok: false, error: 'Décrivez votre retour en quelques mots.' };
  if (fullName && fullName.length < 2) {
    return { ok: false, error: 'Votre nom semble incomplet — complétez-le ou laissez le champ vide.' };
  }
  if (phone && phone.length < 4) {
    return { ok: false, error: 'Ce numéro semble incomplet — corrigez-le ou laissez le champ vide.' };
  }

  try {
    const { error } = await supabase.from('client_feedbacks').insert({
      part: draft.part,
      full_name: fullName ? fullName.slice(0, 120) : null,
      phone: phone ? phone.slice(0, 40) : null,
      email: email ? email.slice(0, 160) : null,
      message: message.slice(0, 4000),
      status: 'unread',
    });
    if (!error) return { ok: true };

    if (isMissingFeedbackTable(error)) {
      return {
        ok: false,
        error: "Le service de retours n'est pas encore activé sur cette station. Merci de contacter l'accueil.",
      };
    }
    if (isLegacyRequiredContact(error)) {
      return {
        ok: false,
        error: 'Cette station demande encore votre nom et votre téléphone : renseignez-les pour envoyer votre avis.',
      };
    }
    return { ok: false, error: error.message };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Envoi impossible — vérifiez votre connexion." };
  }
}

// ─── Lecture et traitement (personnel connecté) ────────────────────────────────

/**
 * Tous les avis, du plus récent au plus ancien. `null` quand la table n'existe
 * pas encore : l'appelant affiche alors un écran vide au lieu d'une erreur.
 */
export async function loadClientFeedbacks(): Promise<ClientFeedback[] | null> {
  try {
    const { data, error } = await supabase
      .from('client_feedbacks').select('*').order('created_at', { ascending: false });
    if (error) {
      if (!isMissingFeedbackTable(error)) console.warn('[client_feedbacks] load', error.message);
      return null;
    }
    return ((data || []) as FeedbackRow[]).map(rowToFeedback);
  } catch {
    return null;
  }
}

/** Marque un avis « lu » (ou le remet en « non lu »). */
export async function setFeedbackStatus(
  id: string, status: FeedbackStatus, by?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const patch: Record<string, unknown> = status === 'read'
      ? { status: 'read', read_by: by || null }       // `read_at` est horodaté par le serveur
      : { status: 'unread', read_at: null, read_by: null };
    const { error } = await supabase.from('client_feedbacks').update(patch).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

/** Marque d'un coup tous les avis non lus d'une partie. */
export async function markPartFeedbacksRead(
  part: FeedbackPart, by?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('client_feedbacks')
      .update({ status: 'read', read_by: by || null })
      .eq('part', part).eq('status', 'unread');
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

export async function deleteClientFeedback(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('client_feedbacks').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}
