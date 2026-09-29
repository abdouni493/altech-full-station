/**
 * ─── LES RAPPELS DE PASSAGE ────────────────────────────────────────────────────
 *
 *  CE QUE C'EST
 *  Une voiture lavée le 3 janvier doit repasser vers le 3 février ; une révision
 *  faite en janvier se refait six mois plus tard. Cet écart — un délai par
 *  NATURE d'intervention, réglé par la station — transforme l'historique des
 *  interventions en une liste de clients à rappeler.
 *
 *  POURQUOI RIEN N'EST STOCKÉ
 *  Une alerte n'est pas une donnée : c'est une LECTURE des interventions à la
 *  lumière des délais du jour. La stocker obligerait à tout recalculer dès qu'on
 *  change un délai, et une intervention corrigée ou supprimée laisserait une
 *  alerte fantôme que plus rien ne rattacherait à quoi que ce soit.
 *
 *  Ce qui est stocké, c'est ce que l'utilisateur en a FAIT : « lue » ou
 *  « message parti » (collection `rappels`, voir `BizRappel`). L'identifiant est
 *  DÉTERMINISTE — `intervention:nature:véhicule` — pour que deux postes qui
 *  traitent la même alerte n'en fassent pas deux lignes.
 *
 *  LA RÈGLE QUI ÉVITE LE HARCÈLEMENT
 *  On ne rappelle un client que sur son DERNIER passage pour une nature donnée
 *  et un véhicule donné. Un client qui lave sa voiture toutes les semaines
 *  depuis un an ne doit pas recevoir cinquante-deux rappels : ses cinquante et
 *  une visites précédentes sont périmées par la dernière.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizCar, BizContact, BizRappel, BizRappelConfig, BizReparation,
  DEFAULT_RAPPEL_CONFIG, carLabel, prestationsOf,
} from './bizConfig';

/** Une alerte prête à être affichée — entièrement déduite, jamais enregistrée. */
export interface RappelAlert {
  /** `${reparationId}:${kind}:${carKey}` — la clé qui suit l'alerte partout. */
  id: string;
  reparationId: string;
  /** Référence lisible de l'intervention d'origine (LAV-0012…). */
  ref: string;
  kind: 'lavage' | 'reparation';
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  car: BizCar;
  carKey: string;
  carText: string;
  /** Date du passage qui a déclenché le rappel, `YYYY-MM-DD`. */
  lastVisit: string;
  /** Date à laquelle le rappel devient dû, `YYYY-MM-DD`. */
  dueDate: string;
  /** Négatif = en retard, 0 = aujourd'hui, positif = à venir. */
  daysLeft: number;
  /** Le rappel est dû aujourd'hui ou l'était déjà. */
  due: boolean;
  /** Dernier kilométrage connu du véhicule, quand il y en a un. */
  kilometrage?: number;
}

/** Journée locale d'une date ISO, `YYYY-MM-DD` — jamais l'UTC, qui décale d'un jour. */
export function dayOf(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` + n jours, en restant sur des journées locales. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

/** Nombre de journées entières entre deux `YYYY-MM-DD` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, (am || 1) - 1, ad || 1);
  const db = Date.UTC(by, (bm || 1) - 1, bd || 1);
  return Math.round((db - da) / 86_400_000);
}

/**
 * Clé du véhicule d'une intervention.
 *
 * L'identifiant du parc quand il existe ; à défaut, l'immatriculation ; à
 * défaut, la marque et le modèle en minuscules. Une voiture sans le moindre
 * signe distinctif donne la chaîne vide — le rappel porte alors sur le client
 * seul, ce qui reste utile.
 */
export function carKeyOf(car: BizCar | undefined | null): string {
  if (!car) return '';
  if (car.id) return car.id;
  const plate = (car.immatriculation || '').trim().toLowerCase().replace(/\s+/g, '');
  if (plate) return `plate:${plate}`;
  const label = [car.marque, car.name].filter(Boolean).join(' ').trim().toLowerCase();
  return label ? `car:${label}` : '';
}

/** L'identifiant déterministe d'une alerte — le même sur tous les postes. */
export function rappelId(reparationId: string, kind: 'lavage' | 'reparation', carKey: string): string {
  return `${reparationId}:${kind}:${carKey}`;
}

/** Les natures réellement présentes dans une intervention. */
function kindsOf(rep: BizReparation): ('lavage' | 'reparation')[] {
  const lines = prestationsOf(rep);
  const set = new Set<'lavage' | 'reparation'>();
  for (const l of lines) set.add(l.kind);
  if (set.size === 0) {
    // Intervention sans prestation (produits seuls) : sa nature globale fait foi.
    if (rep.kind === 'lavage' || rep.kind === 'reparation') set.add(rep.kind);
  }
  return [...set];
}

/**
 * Le délai réglé pour une nature. `0` ou moins ⇒ cette nature ne rappelle pas.
 *
 * Un délai PROPRE AU VÉHICULE (`car.rappelLavageDays` / `car.rappelReparationDays`,
 * posé sur la fiche du client) l'emporte sur le délai de la partie : il permet de
 * régler la cadence voiture par voiture. Un `0` porté par le véhicule coupe donc
 * SA nature pour LUI seul, sans toucher au réglage général.
 */
function delayFor(cfg: BizRappelConfig, kind: 'lavage' | 'reparation', car?: BizCar | null): number {
  const own = kind === 'lavage' ? car?.rappelLavageDays : car?.rappelReparationDays;
  if (typeof own === 'number' && Number.isFinite(own)) return own;
  return kind === 'lavage' ? cfg.lavageDays : cfg.reparationDays;
}

export interface BuildRappelsInput {
  reparations: BizReparation[];
  clients: BizContact[];
  /** Ce que l'utilisateur a déjà traité — lues et envoyées. */
  handled: BizRappel[];
  config?: BizRappelConfig;
  /** Journée de référence, `YYYY-MM-DD`. Aujourd'hui par défaut. */
  today?: string;
  /**
   * Fenêtre d'anticipation : un rappel dû dans moins de N jours est déjà
   * affiché, pour qu'on puisse préparer l'envoi. `0` ⇒ uniquement les échus.
   */
  lookaheadDays?: number;
}

/**
 * Construit la liste des rappels à afficher.
 *
 * Sont ÉCARTÉS, dans cet ordre :
 *   1. les interventions non finalisées (une intervention en cours ou annulée
 *      n'annonce aucun prochain passage) ;
 *   2. les natures dont le délai est nul ou négatif, et tous les rappels si
 *      l'option est coupée ;
 *   3. les passages périmés par un passage PLUS RÉCENT du même véhicule pour la
 *      même nature — c'est la règle qui évite d'écrire cinquante fois au même
 *      client ;
 *   4. les alertes déjà traitées (lues ou envoyées) ;
 *   5. les rappels encore lointains, au-delà de la fenêtre d'anticipation.
 */
export function buildRappels(input: BuildRappelsInput): RappelAlert[] {
  const cfg = input.config || DEFAULT_RAPPEL_CONFIG;
  const today = input.today || dayOf(new Date().toISOString());
  const lookahead = input.lookaheadDays ?? 7;
  if (!cfg.enabled) return [];

  const handled = new Set((input.handled || []).map(r => r.id));
  const clientById = new Map(input.clients.map(c => [c.id, c] as const));

  // ── 1 & 3. Le DERNIER passage par (véhicule, nature) ───────────────────────
  // On parcourt tout l'historique et on ne retient, pour chaque couple, que
  // l'intervention la plus récente. Les précédentes sont périmées par elle.
  const latest = new Map<string, {
    rep: BizReparation; kind: 'lavage' | 'reparation'; day: string; carKey: string;
    /** Le véhicule de la FICHE (quand l'intervention s'y rattache) : c'est lui
     *  qui porte le délai propre au véhicule et le kilométrage à jour. */
    parcCar?: BizCar;
  }>();

  for (const rep of input.reparations || []) {
    if (rep.status !== 'finalized') continue;
    const day = dayOf(rep.date);
    if (!day) continue;
    // Un rappel s'adresse à quelqu'un : sans client identifié, personne à qui
    // écrire — l'alerte n'aurait aucune suite possible.
    if (!rep.clientId) continue;
    const carKey = carKeyOf(rep.car);
    // Le véhicule de la fiche du client, quand l'intervention s'y rattache par
    // son id : il porte l'éventuel délai de rappel PROPRE À CE VÉHICULE.
    const client = clientById.get(rep.clientId);
    const parcCar = (client?.cars || []).find(c => c.id && c.id === rep.car?.id);
    for (const kind of kindsOf(rep)) {
      if (delayFor(cfg, kind, parcCar) <= 0) continue;
      const key = `${rep.clientId}|${carKey}|${kind}`;
      const prev = latest.get(key);
      if (!prev || day > prev.day) latest.set(key, { rep, kind, day, carKey, parcCar });
    }
  }

  // ── 2, 4 & 5. Ce qui reste devient une alerte ──────────────────────────────
  const out: RappelAlert[] = [];
  for (const { rep, kind, day, carKey, parcCar } of latest.values()) {
    const id = rappelId(rep.id, kind, carKey);
    if (handled.has(id)) continue;

    const dueDate = addDays(day, delayFor(cfg, kind, parcCar));
    const daysLeft = daysBetween(today, dueDate);
    if (daysLeft > lookahead) continue;

    const client = rep.clientId ? clientById.get(rep.clientId) : undefined;
    // Le kilométrage le plus frais : celui de la fiche du client s'il a été
    // relevé depuis, sinon celui figé sur l'intervention.
    const km = parcCar?.kilometrage ?? rep.car?.kilometrage;

    out.push({
      id,
      reparationId: rep.id,
      ref: rep.ref,
      kind,
      clientId: rep.clientId,
      clientName: client?.name || rep.clientName,
      clientPhone: client?.phone,
      car: parcCar || rep.car || {},
      carKey,
      carText: carLabel(parcCar || rep.car) || '',
      lastVisit: day,
      dueDate,
      daysLeft,
      due: daysLeft <= 0,
      kilometrage: typeof km === 'number' ? km : undefined,
    });
  }

  // Le plus urgent d'abord : les retards en tête, puis les échéances proches.
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.clientName.localeCompare(b.clientName));
}

/** Combien de rappels sont ÉCHUS — c'est ce chiffre qui pastille la barre latérale. */
export function countDue(alerts: RappelAlert[]): number {
  return alerts.filter(a => a.due).length;
}
