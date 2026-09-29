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
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return false;
  return (!from || d >= new Date(from).getTime()) && (!to || d <= new Date(to + 'T23:59:59').getTime());
};

/** Jours restants avant une date — `Infinity` quand il n'y en a pas. */
export const daysUntil = (dateStr?: string): number => {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.ceil((t - Date.now()) / 86_400_000);
};
