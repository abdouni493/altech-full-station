/**
 * ─── Le relevé de compte d'un client, sur la période qu'on lui demande ─────────
 *
 * Trois écrans montrent l'historique d'un client — Carburant, Cafétéria,
 * Lavage & Vidange — et les trois lisaient des données différentes, avec des
 * colonnes différentes, sans jamais pouvoir sortir un document imprimable.
 *
 * Ce module ramène les trois à UNE seule forme, le `ClientStatement` :
 *
 *      identité du client
 *      + dette et avance à l'OUVERTURE de la période
 *      + le journal des opérations de la période (avec le détail des articles)
 *      + les règlements encaissés, mode par mode
 *      + les totaux, et la dette à la CLÔTURE
 *
 * Deux points valent d'être dits :
 *
 *  • Le journal est TOUJOURS construit sur toute la durée de vie du compte.
 *    La période ne coupe que ce qui s'AFFICHE ; ce qui la précède reste compté
 *    dans le solde d'ouverture. Sans cela, un relevé « du 1er au 31 » afficherait
 *    une dette de clôture fausse.
 *
 *  • Les règlements d'une vente de partie (cafétéria / lavage) n'existaient
 *    qu'en cumul dans `paid` : impossible de savoir QUAND l'argent est entré.
 *    Les documents portent maintenant des versements datés (`payments`), et les
 *    anciens sont lus comme un versement unique à la date du document — signalé
 *    comme reconstruit plutôt qu'inventé en silence.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { clientLedger, clientOpening, ClientEntry, advanceAvailable } from './clientLedger';
import { BizSale, BizReparation, BizContact, BizDocPayment, ModuleState, prestationsOf } from './bizConfig';

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type StatementKind =
  | 'ouverture' | 'avance'
  | 'bon' | 'magasin' | 'vente' | 'intervention' | 'reglement' | 'recharge' | 'retour';

export const KIND_LABEL: Record<StatementKind, string> = {
  ouverture: 'Dette initiale',
  avance: 'Avance initiale',
  bon: 'Bon carburant',
  magasin: 'Vente magasin',
  vente: 'Vente',
  intervention: 'Intervention',
  reglement: 'Règlement',
  recharge: "Recharge d'avance",
  retour: 'Retour / échange',
};

/** Couleur d'impression d'une nature d'opération sur la fiche. */
export const KIND_COLOR: Record<StatementKind, string> = {
  ouverture: '#b45309',
  // Les deux reprises se lisent en paire : la dette en ambre, l'avance en
  // sarcelle — proche du vert des règlements sans se confondre avec eux, parce
  // que ce n'en est justement pas un.
  avance: '#0d9488',
  bon: '#1d4ed8', magasin: '#0e7490', vente: '#0e7490', intervention: '#7c3aed',
  reglement: '#15803d', recharge: '#047857', retour: '#b45309',
};

export interface StatementItem {
  name: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  total: number;
}

/** Une opération du compte, quelle que soit l'activité d'où elle vient. */
export interface StatementLine {
  id: string;
  date: string;
  kind: StatementKind;
  kindLabel: string;
  /** Numéro du document (facture, bon, intervention…). */
  ref?: string;
  label: string;
  mode?: string;
  reference?: string;
  notes?: string;
  status?: string;
  /** Ce que l'opération a coûté au client — 0 sur un règlement. */
  charged: number;
  /** Ce que le client a versé sur cette opération. */
  paid: number;
  /** Reste dû sur le document. */
  rest: number;
  /** Effet sur la dette : > 0 elle se creuse, < 0 elle se rembourse. */
  debtEffect: number;
  /** Effet sur l'avance : > 0 rechargée, < 0 consommée. */
  advanceEffect: number;
  /** Résumé de la quantité — « 42,5 L », « 3 article(s) »… */
  qtyLabel?: string;
  /** Le détail article par article du document. */
  items?: StatementItem[];
  /** `true` quand la ligne est reconstruite d'un document sans détail daté. */
  inferred?: boolean;
}

/** Un encaissement, isolé pour le tableau des règlements du relevé. */
export interface StatementPayment {
  id: string;
  /**
   * La LIGNE du journal d'où vient ce versement. Un tableau de règlements qui
   * ne sait pas de quelle pièce il descend ne peut ni la corriger, ni la
   * supprimer, ni en réimprimer le reçu — c'est ce qui manquait pour rendre
   * l'historique modifiable.
   */
  lineId: string;
  /** Nature de la ligne d'origine — un règlement, ou une recharge d'avance. */
  kind: StatementKind;
  date: string;
  label: string;
  mode: string;
  reference?: string;
  amount: number;
  /** `true` quand le versement est reconstruit d'un ancien document non daté. */
  inferred?: boolean;
}

export interface StatementParty {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  type?: string;
  paymentMode?: string;
}

export interface ClientStatement {
  client: StatementParty;
  /** « Carburant », « Cafétéria », « Lavage & Vidange ». */
  partLabel: string;
  /** Bornes demandées, `''` quand la borne est ouverte. */
  from: string;
  to: string;
  /** Le journal ENTIER du compte, toutes périodes confondues. */
  allLines: StatementLine[];
  /** Les opérations de la période affichée. */
  lines: StatementLine[];
  /** Les règlements de la période, mode par mode. */
  payments: StatementPayment[];
  /** Dette accumulée AVANT le premier jour de la période. */
  openingDebt: number;
  /** Avance disponible avant la période. */
  openingAdvance: number;
  /** Dette une fois la période passée. */
  closingDebt: number;
  closingAdvance: number;
  /** L'avance encore détenue à la clôture — jamais négative. */
  advanceHeld: number;
  /**
   * Ce que le client doit RÉELLEMENT à la clôture : sa dette, moins l'argent
   * que la station détient déjà pour lui. Sans cette imputation, un client
   * prépayé apparaissait débiteur de ce qu'il avait pourtant payé d'avance.
   */
  netDebt: number;
  /** Ce qui lui reste d'avance une fois sa dette imputée dessus. */
  advanceLeft: number;
  totals: {
    /** Total consommé sur la période. */
    charged: number;
    /** Total encaissé sur la période. */
    paid: number;
    /** Reste dû sur les documents de la période. */
    rest: number;
    /** Part de la consommation portée à crédit. */
    credit: number;
    /** Part de la consommation prise sur l'avance. */
    advanceUsed: number;
    advanceRecharged: number;
    /**
     * L'avance de REPRISE de la période — comptée à part des recharges, parce
     * qu'elle n'a fait entrer aucun argent dans le tiroir : le client l'avait
     * versée avant que la station ne tienne ce compte.
     */
    advanceOpening: number;
    /** Mouvement net de la dette sur la période. */
    debtMovement: number;
    /** Nombre de documents (hors règlements et recharges). */
    documents: number;
  };
  byKind: { kind: StatementKind; label: string; count: number; charged: number; paid: number; rest: number }[];
  byMode: { mode: string; count: number; amount: number }[];
}

// ─── Bornes de période ────────────────────────────────────────────────────────
/**
 * Une date `YYYY-MM-DD` borne le JOUR ENTIER : `to` inclut ses 23 h 59.
 * Une borne vide n'exclut rien — c'est ainsi que « tout l'historique » se dit.
 */
export function inRange(dateStr: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const t = new Date(dateStr).getTime();
  // Une date illisible ne peut pas être située : elle ne sort du relevé que
  // lorsqu'une borne est demandée.
  if (!Number.isFinite(t)) return false;
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

/** Strictement AVANT la période — ce qui alimente le solde d'ouverture. */
function isBefore(dateStr: string, from?: string): boolean {
  if (!from) return false;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return false;
  return t < new Date(`${from}T00:00:00`).getTime();
}

const qtyFmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

// ─── Carburant ────────────────────────────────────────────────────────────────
/** Traduit une ligne du grand livre client carburant en ligne de relevé. */
function fuelLine(e: ClientEntry): StatementLine {
  const kind: StatementKind =
    e.kind === 'ouverture' ? 'ouverture'
      : e.kind === 'avance' ? 'avance'
        : e.kind === 'bon' ? 'bon'
          : e.kind === 'magasin' ? 'magasin'
            : e.kind === 'reglement' ? 'reglement'
              : e.kind === 'recharge' ? 'recharge'
                : 'vente';

  const qtyLabel = e.liters
    ? `${qtyFmt(e.liters)} L`
    : (e.items && e.items.length ? `${e.items.length} article(s)` : undefined);

  return {
    id: e.id,
    date: e.date,
    kind,
    kindLabel: KIND_LABEL[kind],
    ref: e.ref,
    label: e.label,
    mode: e.mode,
    reference: e.reference,
    notes: e.notes,
    charged: e.charged,
    // Un bon à crédit n'encaisse rien ; une facture magasin encaisse ce qui a
    // été réglé sur place ; un règlement encaisse son montant.
    paid: (e.kind === 'reglement' || e.kind === 'recharge' || e.kind === 'avance')
      ? e.paid : num(e.paidOnDocument),
    rest: num(e.rest ?? ((e.kind === 'bon' || e.kind === 'ouverture') ? Math.max(0, e.debtEffect) : 0)),
    debtEffect: e.debtEffect,
    advanceEffect: e.advanceEffect,
    qtyLabel,
    items: e.items,
  };
}

/** Le relevé d'un client CARBURANT, reconstruit sur ses pièces. */
export function fuelClientStatement(
  app: any, client: any, from = '', to = '',
): ClientStatement {
  const ledger = clientLedger(app, client?.id || '');
  const lines = ledger.entries.map(fuelLine);
  return assemble({
    client: {
      id: client?.id || '',
      name: client?.name || '',
      phone: client?.phone,
      address: client?.address,
      type: client?.type,
      paymentMode: client?.paymentMode,
    },
    partLabel: 'Carburant',
    from, to, allLines: lines,
    // L'avance vit sur la fiche client : c'est le solde d'AUJOURD'HUI, donc la
    // clôture. L'ouverture se déduit en remontant les mouvements de la période.
    currentAdvance: advanceAvailable(client),
  });
}

// ─── Cafétéria / Lavage ───────────────────────────────────────────────────────
/**
 * Les versements d'un document de partie, rendus comme des LIGNES du journal.
 *
 * Un règlement est une opération à part entière, pas une colonne d'un document :
 * c'est ce qui permet au compte de se relire tout seul — chaque vente creuse la
 * dette de son total, chaque versement la rembourse du sien, et le solde tombe
 * juste quelle que soit la période demandée.
 *
 * Les documents enregistrés avant que les versements ne soient datés n'ont que
 * leur cumul `paid` : il est alors lu comme UN versement à la date du document,
 * et signalé comme reconstruit plutôt que présenté comme une certitude.
 */
function paymentLines(
  doc: { id: string; ref?: string; date: string; paid?: number; payments?: any[] },
): StatementLine[] {
  const mk = (
    id: string, date: string, amount: number, mode: string,
    reference?: string, inferred?: boolean,
  ): StatementLine => ({
    id,
    date,
    kind: 'reglement',
    kindLabel: KIND_LABEL.reglement,
    ref: doc.ref,
    label: `Règlement ${doc.ref || ''}`.trim(),
    mode,
    reference,
    notes: inferred ? 'Date reprise du document' : undefined,
    charged: 0,
    paid: amount,
    rest: 0,
    debtEffect: -amount,
    advanceEffect: 0,
    inferred,
  });

  const list = Array.isArray(doc.payments) ? doc.payments.filter(p => num(p?.amount) > 0) : [];
  if (list.length) {
    return list.map((p: any, i: number) =>
      mk(`${doc.id}-pay-${p.id || i}`, p.date || doc.date, num(p.amount), p.mode || 'Espèces', p.reference));
  }
  const paid = num(doc.paid);
  if (paid <= 0) return [];
  return [mk(`${doc.id}-pay-0`, doc.date, paid, 'Espèces', undefined, true)];
}

/** Une vente de point de vente / facture de partie. */
function saleLine(s: BizSale): StatementLine {
  const reversed = s.status === 'retournée' || s.status === 'échangée';
  const items: StatementItem[] = (s.items || []).map(it => ({
    name: it.productName,
    qty: num(it.qty),
    unitPrice: num(it.unitPrice),
    total: num(it.qty) * num(it.unitPrice),
  }));
  const rest = reversed ? 0 : num(s.rest);
  return {
    id: `sale-${s.id}`,
    date: s.date,
    kind: reversed ? 'retour' : 'vente',
    kindLabel: reversed ? KIND_LABEL.retour : KIND_LABEL.vente,
    ref: s.ref,
    label: reversed
      ? `Vente ${s.status} — ${items.length} article(s)`
      : `Vente — ${items.length} article(s)`,
    status: s.status,
    notes: [
      s.returnReason,
      reversed && num(s.refundedAmount) ? `Remboursé ${num(s.refundedAmount).toLocaleString('fr-FR')} DA` : '',
    ].filter(Boolean).join(' · ') || undefined,
    // Une vente annulée n'a rien coûté au client : la marchandise est revenue et
    // l'argent avec elle. Elle reste au journal — pour justifier l'écart avec ce
    // qui a été encaissé — mais ne bouge NI la dette NI la caisse.
    charged: reversed ? 0 : num(s.total),
    paid: 0,
    rest,
    // Le total entre au compte ; ce sont les lignes de règlement qui le soldent.
    debtEffect: reversed ? 0 : num(s.total),
    advanceEffect: 0,
    qtyLabel: `${items.length} article(s)`,
    items,
  };
}

/** Une intervention lavage / vidange. */
function repLine(r: BizReparation): StatementLine {
  const canceled = r.status === 'canceled';
  const items: StatementItem[] = [
    ...prestationsOf(r).map(p => ({
      name: p.label || (p.kind === 'lavage' ? 'Lavage' : 'Vidange'),
      qty: 1,
      unitPrice: num(p.amount),
      total: num(p.amount),
    })),
    ...(r.usedProducts || []).map(u => ({
      name: u.productName,
      qty: num(u.qty),
      unitPrice: num(u.unitPrice),
      total: num(u.total ?? num(u.qty) * num(u.unitPrice)),
    })),
  ];
  const car = [r.car?.marque, r.car?.name, r.car?.immatriculation].filter(Boolean).join(' ');
  const rest = canceled ? 0 : num(r.rest);
  return {
    id: `rep-${r.id}`,
    date: r.date,
    kind: 'intervention',
    kindLabel: r.kind === 'lavage' ? 'Lavage' : r.kind === 'mixte' ? 'Lavage + Vidange' : 'Vidange',
    ref: r.ref,
    label: [r.problem || 'Intervention', car].filter(Boolean).join(' — '),
    status: r.status,
    charged: canceled ? 0 : num(r.total),
    paid: 0,
    rest,
    debtEffect: canceled ? 0 : num(r.total),
    advanceEffect: 0,
    qtyLabel: `${items.length} ligne(s)`,
    items,
  };
}

/**
 * L'OUVERTURE du compte d'un client de partie, rendue en lignes de journal.
 *
 * Une cafétéria ou un lavage reprend des comptes qui existaient avant le
 * logiciel : « ce client me doit déjà 12 000 DA ». Ce montant n'avait aucun
 * endroit où vivre — la fiche ne portait qu'un nom, un téléphone et une adresse
 * — si bien qu'il fallait inventer une fausse vente pour le faire apparaître.
 *
 * Il est maintenant porté par la fiche (`openingDebt`), avec ses propres
 * règlements (`openingPayments`) : la dette de reprise se solde comme n'importe
 * quelle facture, à sa date et par son mode de paiement.
 */
function openingLines(client: BizContact | null): StatementLine[] {
  const op = clientOpening(client as any);
  const out: StatementLine[] = [];
  if (op.debt <= 0 && op.advance <= 0) return out;

  const settled = (client?.openingPayments || [])
    .filter((p: BizDocPayment) => num(p?.amount) > 0);
  const paid = settled.reduce((t: number, p: BizDocPayment) => t + num(p.amount), 0);

  if (op.debt > 0) {
    out.push({
      id: `open-debt-${client?.id || ''}`,
      date: op.date,
      kind: 'ouverture',
      kindLabel: KIND_LABEL.ouverture,
      label: 'Dette initiale — ouverture du compte',
      notes: op.notes,
      charged: op.debt,
      paid: 0,
      rest: Math.max(0, op.debt - paid),
      debtEffect: op.debt,
      advanceEffect: 0,
    });
    for (const p of settled) {
      out.push({
        id: `open-pay-${p.id}`,
        date: p.date || op.date,
        kind: 'reglement',
        kindLabel: KIND_LABEL.reglement,
        label: 'Règlement de la dette initiale',
        mode: p.mode || 'Espèces',
        reference: p.reference,
        notes: p.notes,
        charged: 0,
        paid: num(p.amount),
        rest: 0,
        debtEffect: -num(p.amount),
        advanceEffect: 0,
      });
    }
  }

  if (op.advance > 0) {
    out.push({
      id: `open-adv-${client?.id || ''}`,
      date: op.date,
      kind: 'avance',
      kindLabel: KIND_LABEL.avance,
      label: "Avance initiale — ouverture du compte",
      mode: 'Ouverture',
      notes: op.notes,
      charged: 0,
      paid: op.advance,
      rest: 0,
      debtEffect: 0,
      advanceEffect: op.advance,
    });
  }
  return out;
}

/**
 * Les DÉPÔTS D'AVANCE d'un client de partie, rendus en lignes de journal.
 *
 * Le trop-perçu d'un règlement (ou une avance déposée d'elle-même) est de
 * l'argent qui entre vraiment au tiroir — à la différence de l'avance de
 * reprise, versée avant le logiciel. Il est donc porté comme une RECHARGE : il
 * crédite l'avance du client (`advanceEffect > 0`) et compte parmi les
 * encaissements de la période, exactement comme au Carburant.
 */
function advanceDepositLines(client: BizContact | null): StatementLine[] {
  return (client?.advancePayments || [])
    .filter((p: BizDocPayment) => num(p?.amount) > 0)
    .map((p: BizDocPayment) => ({
      id: `adv-${p.id}`,
      date: p.date || (client as any)?.openingDate || '',
      kind: 'recharge' as StatementKind,
      kindLabel: KIND_LABEL.recharge,
      label: "Dépôt d'avance",
      mode: p.mode || 'Espèces',
      reference: p.reference,
      notes: p.notes,
      charged: 0,
      paid: num(p.amount),
      rest: 0,
      debtEffect: 0,
      advanceEffect: num(p.amount),
    }));
}

/** Le relevé d'un client d'une partie (Cafétéria, Lavage & Vidange). */
export function bizClientStatement(
  state: ModuleState, client: BizContact | null, partLabel: string, from = '', to = '',
): ClientStatement {
  const lines: StatementLine[] = [...openingLines(client), ...advanceDepositLines(client)];
  const id = client?.id || '';

  for (const s of (state?.sales || [])) {
    if (!id || s.clientId !== id) continue;
    lines.push(saleLine(s));
    // Une vente annulée a rendu l'argent : son encaissement et son
    // remboursement s'annulent, ils n'ont rien à faire au journal.
    if (s.status !== 'retournée' && s.status !== 'échangée') lines.push(...paymentLines(s));
  }
  for (const r of (state?.reparations || [])) {
    if (!id || r.clientId !== id) continue;
    lines.push(repLine(r));
    if (r.status !== 'canceled') lines.push(...paymentLines(r));
  }

  const op = clientOpening(client as any);
  // Ce que le client détient AUJOURD'HUI : l'avance de reprise plus tous les
  // dépôts (trop-perçus) faits depuis. Aucune vente de partie ne s'impute encore
  // sur l'avance ligne par ligne ; ce qu'il doit par ailleurs s'impute dessus au
  // niveau du COMPTE (`netDebt` / `advanceLeft`), là où les deux soldes se
  // rencontrent enfin.
  const deposited = (client?.advancePayments || [])
    .reduce((t, p) => t + Math.max(0, num(p?.amount)), 0);
  const heldAdvance = op.advance + deposited;
  return assemble({
    client: { id, name: client?.name || '', phone: client?.phone, address: client?.address },
    partLabel,
    from, to, allLines: lines,
    currentAdvance: heldAdvance > 0 ? heldAdvance : undefined,
  });
}

// ─── Assemblage commun ────────────────────────────────────────────────────────
/**
 * Ce qui n'est PAS un document du compte : ni marchandise, ni prestation. Un
 * règlement solde une pièce, une recharge alimente un prépayé, une avance de
 * reprise reporte un solde — aucun des trois ne se compte comme une opération
 * facturée.
 */
const NON_DOCUMENT = new Set<StatementKind>(['reglement', 'recharge', 'avance']);

function assemble(input: {
  client: StatementParty;
  partLabel: string;
  from: string;
  to: string;
  allLines: StatementLine[];
  /** Solde d'avance d'aujourd'hui, quand l'activité en tient un. */
  currentAdvance?: number;
}): ClientStatement {
  const { from, to } = input;
  const allLines = [...input.allLines].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const before = allLines.filter(l => isBefore(l.date, from));
  const lines = (from || to) ? allLines.filter(l => inRange(l.date, from, to)) : allLines;

  const openingDebt = before.reduce((s, l) => s + l.debtEffect, 0);
  const debtMovement = lines.reduce((s, l) => s + l.debtEffect, 0);

  const charged = lines.reduce((s, l) => s + l.charged, 0);
  const rest = lines.reduce((s, l) => s + l.rest, 0);
  const credit = lines.reduce((s, l) => s + Math.max(0, l.debtEffect), 0);
  const advanceUsed = -lines.reduce((s, l) => s + Math.min(0, l.advanceEffect), 0);
  const advanceRecharged = lines.reduce((s, l) => s + Math.max(0, l.advanceEffect), 0);
  const advanceOpening = lines
    .filter(l => l.kind === 'avance')
    .reduce((s, l) => s + Math.max(0, l.advanceEffect), 0);

  // Les règlements sont les lignes du journal qui portent de l'argent entrant —
  // pour toutes les activités, sans exception : c'est ce qui garantit que le
  // total encaissé du tableau des règlements est bien celui du journal.
  //
  // L'AVANCE DE REPRISE est la seule exception, et c'est elle qui faussait le
  // compte : le client l'a bien versée, mais avant que la station ne tienne ce
  // compte — aucun billet n'est entré au tiroir le jour de la saisie. Comptée
  // parmi les encaissements, elle gonflait le « total encaissé » de la carte,
  // du dossier et de la fenêtre d'encaissement, et le même argent était compté
  // une seconde fois le jour où le client venait vraiment payer. Elle reste au
  // journal, au crédit du compte, mais hors du tableau des règlements.
  const payments: StatementPayment[] = lines
    .filter(l => l.paid !== 0 && l.kind !== 'avance')
    .map(l => ({
      id: `${l.id}-pay`,
      lineId: l.id,
      kind: l.kind,
      date: l.date,
      label: l.kind === 'recharge' ? "Recharge d'avance" : (l.ref ? `Règlement ${l.ref}` : l.label),
      mode: l.mode || 'Espèces',
      reference: l.reference,
      amount: l.paid,
      inferred: l.inferred,
    }));
  payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const paid = payments.reduce((s, p) => s + p.amount, 0);

  // Récapitulatif par nature.
  const kinds = new Map<StatementKind, { count: number; charged: number; paid: number; rest: number }>();
  for (const l of lines) {
    const cur = kinds.get(l.kind) || { count: 0, charged: 0, paid: 0, rest: 0 };
    cur.count += 1; cur.charged += l.charged; cur.paid += l.paid; cur.rest += l.rest;
    kinds.set(l.kind, cur);
  }
  const byKind = [...kinds.entries()]
    .map(([kind, v]) => ({ kind, label: KIND_LABEL[kind], ...v }))
    .sort((a, b) => b.charged - a.charged);

  // Récapitulatif par mode de règlement.
  const modes = new Map<string, { count: number; amount: number }>();
  for (const p of payments) {
    const key = p.mode || 'Espèces';
    const cur = modes.get(key) || { count: 0, amount: 0 };
    cur.count += 1; cur.amount += p.amount;
    modes.set(key, cur);
  }
  const byMode = [...modes.entries()]
    .map(([mode, v]) => ({ mode, ...v }))
    .sort((a, b) => b.amount - a.amount);

  // L'avance : la fiche client porte le solde d'AUJOURD'HUI, donc celui d'APRÈS
  // la période. On remonte les mouvements postérieurs pour retrouver la clôture,
  // puis ceux de la période pour l'ouverture.
  const inPeriodIds = new Set(lines.map(l => l.id));
  const beforeIds = new Set(before.map(l => l.id));
  const advanceAfter = allLines
    .filter(l => !inPeriodIds.has(l.id) && !beforeIds.has(l.id))
    .reduce((s, l) => s + l.advanceEffect, 0);
  const currentAdvance = num(input.currentAdvance);
  const closingAdvance = input.currentAdvance === undefined ? 0 : currentAdvance - advanceAfter;
  const openingAdvance = closingAdvance - (advanceRecharged - advanceUsed);

  // ── L'IMPUTATION DE L'AVANCE SUR LA DETTE ─────────────────────────────────
  // Les deux soldes vivaient côte à côte sans jamais se rencontrer : la station
  // réclamait 5 000 DA à un client dont elle détenait déjà 20 000 DA d'avance.
  // C'est le même compte : ce qui est détenu éteint ce qui est dû, et seul le
  // reliquat — d'un côté ou de l'autre — est un vrai solde.
  const closingDebt = openingDebt + debtMovement;
  const advanceHeld = Math.max(0, closingAdvance);
  const netDebt = Math.max(0, closingDebt - advanceHeld);
  const advanceLeft = Math.max(0, advanceHeld - Math.max(0, closingDebt));

  return {
    client: input.client,
    partLabel: input.partLabel,
    from, to,
    allLines,
    lines,
    payments,
    openingDebt,
    openingAdvance,
    closingDebt,
    closingAdvance,
    advanceHeld,
    netDebt,
    advanceLeft,
    totals: {
      charged, paid, rest, credit, advanceUsed, advanceRecharged, debtMovement,
      advanceOpening,
      documents: lines.filter(l => !NON_DOCUMENT.has(l.kind)).length,
    },
    byKind,
    byMode,
  };
}

/** Libellé lisible d'une période, pour l'en-tête du relevé. */
export function periodLabel(from: string, to: string): string {
  const d = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR');
  if (from && to) return `Du ${d(from)} au ${d(to)}`;
  if (from) return `Depuis le ${d(from)}`;
  if (to) return `Jusqu'au ${d(to)}`;
  return 'Historique complet du compte';
}
