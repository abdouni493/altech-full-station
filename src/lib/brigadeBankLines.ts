/**
 * ─── Une justification TPE / TAG est de l'argent ARRIVÉ EN BANQUE ──────────────
 *
 * Quand un pompiste justifie son écart par un passage au terminal (TPE) ou par
 * un bon TAG, l'argent n'est pas resté dans sa poche : il est entré sur le
 * COMPTE BANCAIRE du terminal. Tous les écrans qui parlent de carburant le
 * disent déjà — `carburantSales.ts` compte ces justifications dans « encaissé »,
 * au même titre que les espèces (« justifications TAG / TPE → la banque »).
 *
 * Le grand livre, lui, ne le disait pas :
 *
 *   • un TAG ne portait AUCUN compte bancaire — l'argent n'entrait nulle part ;
 *   • un TPE en portait un, mais l'assistant de brigade oubliait de le recharger
 *     à la MODIFICATION : rouvrir une brigade pour corriger un chiffre effaçait
 *     les lignes de banque de toutes ses justifications, et le solde du compte
 *     redescendait du montant du TPE ;
 *   • la fenêtre « Comptabilité brigade », elle, n'en écrivait jamais une seule.
 *
 * Ce fichier est désormais le SEUL endroit qui décide de ces lignes. Les trois
 * écrans (assistant de brigade, comptabilité, réparation depuis les Comptes
 * Bancaires) construisent exactement les mêmes, ce qui rend l'enregistrement
 * REJOUABLE : on efface les lignes que la brigade avait écrites, on réécrit
 * celles que ses justifications valent aujourd'hui, et le solde de chaque compte
 * suit sans jamais compter deux fois.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { TreasuryTransaction } from '../store/AppContext';
import { newId, normalizeSearch } from './utils';

/** Ce dont on a besoin d'une justification pour savoir si elle va en banque. */
export interface BankJustificationLike {
  id: string;
  amount: number;
  justificationType?: string | null;
  /** Le compte bancaire du terminal — sans lui, rien n'entre nulle part. */
  bankAccountId?: string | null;
  pompisteId?: string | null;
  clientName?: string | null;
  notes?: string | null;
}

/** `refType` porté par toutes les lignes qu'une brigade écrit au grand livre. */
export const BRIGADE_REF_TYPE = 'brigade';

/**
 * Une justification encaissée en banque : TPE (terminal) ou TAG (bon).
 * C'est la MÊME règle que `carburantSales.ts`, qui range les deux dans
 * « encaissé » — les deux doivent donc arriver sur un compte.
 */
export const isBankJustification = (
  j: Pick<BankJustificationLike, 'justificationType'>,
): boolean => j.justificationType === 'TAG' || j.justificationType === 'TPE';

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ─── Retrouver le compte d'une justification qui l'a perdu ────────────────────
/**
 * Le texte réduit à ses mots, bordé d'espaces — « TPE TAC/MDN » devient
 * ` tpe tac mdn `. Les bornes sont ce qui rend la recherche fiable : chercher
 * ` bea ` dans ` tpe beaulieu ` échoue, comme il se doit.
 */
const wordKey = (s: unknown): string =>
  ` ${normalizeSearch(s).replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * Le compte bancaire que NOMME un libellé de justification.
 *
 * Réenregistrer une brigade RÉÉCRIT ses justifications en base (l'ancienne
 * ligne est supprimée puis réinsérée avec `bank_account_id`). Tant que
 * l'assistant ne rechargeait pas ce compte, une simple correction le remettait
 * donc à NULL **dans la base** : le compte n'était pas seulement absent du grand
 * livre, il était effacé de la pièce elle-même. C'est ce qui est arrivé aux
 * brigades des 21 et 22 août 2026 — et pourquoi les reconstruire à partir du
 * seul `bankAccountId` ne rendait rien.
 *
 * Il reste pourtant une trace : le LIBELLÉ. Le bouton « + TPE <compte> » de
 * l'assistant écrit « TPE Naftal card » dans `clientName` et dans `notes`, et ce
 * texte-là a survécu à la réécriture. On y relit donc le nom du compte.
 *
 * La comparaison se fait sur des MOTS ENTIERS : « Bea » ne doit pas se
 * reconnaître dans « Beaulieu ». Le compte au nom le plus long l'emporte (entre
 * « Bea » et « Bea Pro », c'est le second qui est désigné), et une égalité
 * parfaite entre deux comptes différents ne désigne personne — mieux vaut le
 * signaler que créditer le mauvais compte.
 */
export function bankAccountFromLabel(
  label: string | null | undefined,
  accounts: { id: string; name: string }[] | undefined,
): string | undefined {
  const hay = wordKey(label || '');
  if (hay.trim() === '' || !accounts?.length) return undefined;

  let best: { id: string; len: number } | undefined;
  let tied = false;
  for (const a of accounts) {
    const needle = wordKey(a.name);
    if (needle.trim() === '' || !hay.includes(needle)) continue;
    const len = needle.trim().length;
    if (!best || len > best.len) { best = { id: a.id, len }; tied = false; }
    else if (len === best.len && a.id !== best.id) tied = true;
  }
  return best && !tied ? best.id : undefined;
}

/**
 * Le compte d'une justification : celui qu'elle porte, sinon celui que son
 * libellé nomme. Rendre `undefined` veut dire « on ne sait pas » — et on ne
 * devine JAMAIS au hasard (pas de « premier compte de la liste »), sans quoi
 * l'argent d'un terminal atterrirait sur le compte d'un autre.
 */
export function accountOfJustification(
  j: BankJustificationLike,
  accounts?: { id: string; name: string }[],
): string | undefined {
  if (j.bankAccountId) return j.bankAccountId;
  return bankAccountFromLabel(j.clientName || j.notes, accounts);
}

/**
 * Les justifications qui DEVRAIENT créditer un compte mais n'en désignent aucun.
 *
 * C'est le trou silencieux d'origine : la justification comptait dans « encaissé »
 * du rapport Carburant, et pas un dinar n'entrait en banque. L'assistant s'en
 * sert pour refuser l'enregistrement plutôt que de perdre l'argent en silence.
 */
export function unbankedJustifications<T extends BankJustificationLike>(
  justifications: T[],
  accounts?: { id: string; name: string }[],
): T[] {
  return (justifications || []).filter(
    j => isBankJustification(j) && num(j.amount) > 0 && !accountOfJustification(j, accounts));
}

/**
 * Les lignes du grand livre que CETTE brigade a écrites pour ses TPE / TAG.
 * Ce sont elles qu'on efface avant de réécrire — jamais la ligne d'espèces
 * (`kind: 'BRIGADE'`), qui appartient à la caisse et se gère à part.
 */
export function brigadeBankLineIds(
  txs: TreasuryTransaction[] | undefined,
  brigadeId: string,
): string[] {
  return (txs || [])
    .filter(t => t.refType === BRIGADE_REF_TYPE && t.refId === brigadeId && t.kind === 'TPE')
    .map(t => t.id);
}

export interface BrigadeBankLinesInput {
  brigadeId: string;
  /** Horodatage porté par la ligne : la fin de la brigade, sinon sa journée. */
  date: string;
  /** La journée couverte, telle qu'elle s'écrit dans le libellé. */
  label?: string;
  justifications: BankJustificationLike[];
  /** Nom du pompiste, pour que la ligne se lise dans l'historique du compte. */
  pompisteName?: (pompisteId?: string | null) => string | undefined;
  createdBy?: string;
  /**
   * Les comptes de la station. Ils servent à DEUX choses : retrouver le compte
   * d'une justification qui a perdu le sien (son libellé le nomme encore), et
   * éviter d'écrire dans la description un détail qui ne fait que répéter le nom
   * du compte qu'on est en train de créditer.
   */
  accounts?: { id: string; name: string }[];
  /** Injectable pour les tests — un identifiant par ligne. */
  makeId?: () => string;
}

/**
 * Une ligne de banque PAR justification encaissée.
 *
 * Une ligne par justification, et non un total par compte : l'historique du
 * compte doit pouvoir montrer d'où vient chaque dinar (quel pompiste, quel
 * terminal), et une justification corrigée ne doit pas obliger à recalculer un
 * agrégat pour retrouver son montant.
 */
export function brigadeBankLines(input: BrigadeBankLinesInput): TreasuryTransaction[] {
  const { brigadeId, date, label, justifications, pompisteName, createdBy, accounts } = input;
  const makeId = input.makeId || newId;
  const at = new Date().toISOString();
  const out: TreasuryTransaction[] = [];

  for (const j of justifications || []) {
    if (!isBankJustification(j) || num(j.amount) <= 0) continue;
    const accountId = accountOfJustification(j, accounts);
    if (!accountId) continue;

    const who = pompisteName?.(j.pompisteId) || '';
    const what = j.justificationType === 'TAG' ? 'TAG' : 'TPE';
    // Le libellé de la justification n'est ajouté que s'il APPREND quelque
    // chose : « TPE Naftal card » dans l'historique du compte Naftal card ne
    // ferait que répéter l'en-tête de l'écran qu'on est en train de lire.
    const account = accounts?.find(a => a.id === accountId);
    const own = (j.clientName || j.notes || '').trim();
    const echoesAccount = !!account && wordKey(own).includes(wordKey(account.name));
    const detail = [who, echoesAccount ? '' : own].filter(Boolean).join(' — ');

    out.push({
      id: makeId(),
      date,
      kind: 'TPE' as const,
      amount: num(j.amount),
      description: `${what} brigade du ${label || date}${detail ? ` — ${detail}` : ''}`,
      accountTo: accountId,
      part: 'carburant' as const,
      refType: BRIGADE_REF_TYPE,
      refId: brigadeId,
      createdBy,
      createdAt: at,
    });
  }
  return out;
}

// ─── Réparation des brigades déjà enregistrées ────────────────────────────────
/**
 * Ce qu'il manque au grand livre pour que les comptes bancaires disent la vérité
 * sur les brigades DÉJÀ saisies.
 *
 * Les brigades enregistrées avant cette correction ont leurs justifications mais
 * pas leurs lignes de banque : ce sont elles que l'utilisateur cherchait dans
 * l'historique de son compte sans les y trouver. On compare, compte par compte,
 * ce que les justifications valent et ce que le grand livre porte déjà, et on ne
 * crée QUE la différence — relancer la réparation deux fois ne double rien.
 */
export interface BrigadeRepairSource {
  brigadeId: string;
  date: string;
  label?: string;
  justifications: BankJustificationLike[];
  createdBy?: string;
}

export interface BrigadeBankRepair {
  /** Les lignes à ajouter au grand livre. */
  add: TreasuryTransaction[];
  /** Nombre de brigades concernées, pour le message rendu à l'utilisateur. */
  brigades: number;
  /** Total remis en banque. */
  amount: number;
  /** Justifications encaissées qui ne désignent aucun compte : rien à réparer. */
  unbanked: number;
  /**
   * Les justifications dont le compte a été RETROUVÉ dans leur libellé, par
   * brigade : `{ brigadeId → { justificationId → bankAccountId } }`.
   *
   * L'écran s'en sert pour réécrire le compte sur la PIÈCE elle-même, et pas
   * seulement au grand livre. Sans cela, la prochaine modification de la
   * brigade repartirait d'une justification toujours sans compte et referait
   * disparaître la ligne.
   */
  recovered: Map<string, Map<string, string>>;
}

export function repairBrigadeBankLines(
  sources: BrigadeRepairSource[],
  txs: TreasuryTransaction[] | undefined,
  opts: {
    pompisteName?: (id?: string | null) => string | undefined;
    /** Sans eux, une justification qui a perdu son compte reste irréparable. */
    accounts?: { id: string; name: string }[];
    makeId?: () => string;
  } = {},
): BrigadeBankRepair {
  const existing = (txs || []).filter(
    t => t.refType === BRIGADE_REF_TYPE && t.kind === 'TPE');
  const add: TreasuryTransaction[] = [];
  const recovered = new Map<string, Map<string, string>>();
  let brigades = 0;
  let unbanked = 0;

  for (const src of sources) {
    unbanked += unbankedJustifications(src.justifications, opts.accounts).length;

    // Les comptes relus dans le libellé — à réécrire sur la pièce.
    const found = new Map<string, string>();
    for (const j of src.justifications || []) {
      if (!isBankJustification(j) || j.bankAccountId || num(j.amount) <= 0) continue;
      const id = bankAccountFromLabel(j.clientName || j.notes, opts.accounts);
      if (id) found.set(j.id, id);
    }
    if (found.size) recovered.set(src.brigadeId, found);
    // Ce que la brigade a DÉJÀ porté sur chaque compte.
    const already = new Map<string, number>();
    for (const t of existing) {
      if (t.refId !== src.brigadeId || !t.accountTo) continue;
      already.set(t.accountTo, (already.get(t.accountTo) || 0) + num(t.amount));
    }
    // Ce qu'elle devrait porter, d'après ses justifications.
    const wanted = brigadeBankLines({
      brigadeId: src.brigadeId,
      date: src.date,
      label: src.label,
      justifications: src.justifications,
      pompisteName: opts.pompisteName,
      createdBy: src.createdBy,
      accounts: opts.accounts,
      makeId: opts.makeId,
    });

    let touched = false;
    for (const line of wanted) {
      const account = line.accountTo as string;
      const covered = already.get(account) || 0;
      if (covered >= line.amount - 0.001) {
        // Déjà en banque : on décompte cette ligne et on passe à la suivante.
        already.set(account, covered - line.amount);
        continue;
      }
      const missing = line.amount - Math.max(0, covered);
      already.set(account, 0);
      add.push({ ...line, amount: missing });
      touched = true;
    }
    if (touched) brigades += 1;
  }

  return {
    add,
    brigades,
    amount: add.reduce((s, t) => s + t.amount, 0),
    unbanked,
    recovered,
  };
}
