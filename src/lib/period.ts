/**
 * ─── La fenêtre de temps d'un rapport, écrite une seule fois ────────────────────
 * `within` décidait autrefois de l'appartenance à une période dans
 * `bizReporting`, que presque tous les moteurs de calcul importent. Le carburant
 * ayant maintenant son propre moteur (`carburantSales`), lequel est lu PAR
 * `bizReporting`, garder la règle là-bas aurait noué les deux fichiers l'un à
 * l'autre. Elle vit donc ici : personne ne dépend de personne, et une seule
 * définition de « dans la période » traverse toute l'application.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/**
 * Une date tombe-t-elle dans `[from, to]` ? Les bornes vides ne filtrent rien, et
 * `to` couvre la journée ENTIÈRE : un mouvement de 18 h le dernier jour de la
 * période en fait partie.
 */
export const within = (dateStr: string, from: string, to: string): boolean => {
  const day = localDayKey(dateStr);
  if (!day) return false;
  const f = from ? String(from).slice(0, 10) : '';
  const t = to ? String(to).slice(0, 10) : '';
  return (!f || day >= f) && (!t || day <= t);
};

/**
 * Le JOUR CALENDAIRE local (« AAAA-MM-JJ ») d'une date enregistrée.
 *
 * Les bornes d'une période sont des journées locales ; les comparer à des
 * horodatages UTC (début lu en UTC, fin lue en heure locale) faisait tomber une
 * opération de 00 h 30 dans la veille — et un rapport du jour ne retrouvait pas
 * le chiffre de la caisse. Trois formes sont rencontrées :
 *   • « AAAA-MM-JJ » : c'est déjà le jour ;
 *   • « …T00:00:00.000Z » : un jour saisi au calendrier puis converti en ISO —
 *     c'est sa partie date qui fait foi, quel que soit le fuseau ;
 *   • tout autre horodatage : son jour dans le fuseau de la station.
 */
export function localDayKey(dateStr?: string | null): string {
  if (!dateStr) return '';
  const s = String(dateStr);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** La date du jour, en heure LOCALE (jamais en UTC). */
export const todayLocal = (): string => localDayKey(new Date().toISOString());

/** Jours restants avant une date — `Infinity` quand il n'y en a pas. */
export const daysUntil = (dateStr?: string): number => {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.ceil((t - Date.now()) / 86_400_000);
};
