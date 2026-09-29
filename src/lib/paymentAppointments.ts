/**
 * ─── Rendez-vous de paiement fournisseur ───────────────────────────────────────
 * Un achat carburant peut porter un « rendez-vous de paiement » : la date à
 * laquelle le reste dû doit être réglé. Tant que la dette existe, un rappel est
 * affiché en haut du tableau de bord.
 *
 * Ce module est la source unique qui décide si un rappel est dû et son urgence,
 * afin que l'écran des achats et le tableau de bord ne puissent pas diverger.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { Purchase } from '../store/AppContext';

export type ApptUrgency = 'overdue' | 'today' | 'soon' | 'later';

export interface PaymentAppointment {
  purchaseId: string;
  invoiceNumber?: string;
  blNumber?: string;
  supplierId?: string;
  /** Date du rendez-vous (YYYY-MM-DD). */
  date: string;
  /** Montant attendu — à défaut, le reste dû. */
  amount: number;
  /** Reste réellement dû aujourd'hui sur cet achat. */
  rest: number;
  notes?: string;
  /** Négatif = en retard, 0 = aujourd'hui, positif = à venir. */
  daysLeft: number;
  urgency: ApptUrgency;
}

/** Aujourd'hui à minuit — les comparaisons se font en jours pleins. */
const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Minuit LOCAL du jour saisi. `new Date('2026-07-29')` est interprété par
 * JavaScript comme minuit UTC : dans un fuseau négatif cela retombe la veille et
 * l'échéance serait annoncée avec un jour d'avance. On construit donc la date
 * composant par composant pour rester dans le fuseau de la station.
 */
function startOfLocalDay(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0).getTime();
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return NaN;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Jours pleins entre aujourd'hui et `dateStr` (négatif si la date est passée). */
export function daysUntilDate(dateStr: string): number {
  const t = startOfLocalDay(dateStr);
  if (Number.isNaN(t)) return 0;
  return Math.round((t - startOfToday()) / 86_400_000);
}

export const urgencyOf = (daysLeft: number): ApptUrgency =>
  daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= 7 ? 'soon' : 'later';

/**
 * Le rendez-vous d'un achat, ou `null` s'il n'y en a pas à rappeler :
 * désactivé, déjà réglé, sans date, ou dette entièrement soldée.
 */
export function appointmentOf(p: Purchase): PaymentAppointment | null {
  if (!p.appointmentActive || p.appointmentPaid) return null;
  if (!p.appointmentDate) return null;
  const rest = Number(p.rest) || 0;
  if (rest <= 0) return null;

  const daysLeft = daysUntilDate(p.appointmentDate);
  return {
    purchaseId: p.id,
    invoiceNumber: p.invoiceNumber,
    blNumber: p.blNumber,
    supplierId: p.supplierId,
    date: p.appointmentDate,
    amount: p.appointmentAmount != null && p.appointmentAmount > 0 ? p.appointmentAmount : rest,
    rest,
    notes: p.appointmentNotes,
    daysLeft,
    urgency: urgencyOf(daysLeft),
  };
}

/**
 * Tous les rendez-vous à rappeler, les plus urgents d'abord.
 * `horizonDays` limite aux échéances proches ; les retards sont toujours inclus.
 */
export function pendingAppointments(purchases: Purchase[], horizonDays = 30): PaymentAppointment[] {
  return purchases
    .map(appointmentOf)
    .filter((a): a is PaymentAppointment => !!a && a.daysLeft <= horizonDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || b.amount - a.amount);
}

/** Classe du badge « Kit » correspondant à l'urgence. */
export function apptTone(daysLeft: number): string {
  const u = urgencyOf(daysLeft);
  return u === 'overdue' ? 'badge-danger'
    : u === 'today' ? 'badge-warning'
      : u === 'soon' ? 'badge-warning'
        : 'badge-info';
}

/** Libellé court : « En retard », « Aujourd'hui », « Dans 3 j »… */
export function apptLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Retard ${Math.abs(daysLeft)} j —`;
  if (daysLeft === 0) return "Aujourd'hui —";
  if (daysLeft === 1) return 'Demain —';
  return `Dans ${daysLeft} j —`;
}
