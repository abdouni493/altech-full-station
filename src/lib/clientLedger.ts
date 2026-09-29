/**
 * ─── Le compte d'un client, relu sur ses pièces ─────────────────────────────────
 *
 * L'écran Clients affichait un historique VIDE, et ce n'était pas un défaut
 * d'affichage : il lisait deux sources qui ne contiennent plus rien.
 *
 *   • `fuel_sales` — la table est morte, la vente de carburant passe par les
 *     BRIGADES depuis longtemps (voir `lib/carburantSales.ts`) ;
 *   • `shopSales.paymentMode === client.id` — une comparaison entre un mode de
 *     paiement et un identifiant de client, qui ne pouvait jamais être vraie.
 *
 * Ce que le client a réellement consommé vit dans les JUSTIFICATIONS des
 * brigades : quand un pompiste explique un manquant par « bon client », la
 * comptabilité de la brigade enregistre le client, le carburant, les litres et
 * le montant — à crédit (une dette de plus) ou sur son avance (son solde baisse).
 *
 * Ce module rassemble tout ce qui touche un client en UN journal :
 *
 *      bons carburant + ventes magasin + règlements + recharges d'avance
 *
 * — chaque ligne avec son effet sur la DETTE et sur l'AVANCE, pour que les deux
 * soldes affichés se vérifient au lieu d'être crus sur parole.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Ce qu'une ligne du compte client raconte. */
export type ClientEntryKind =
  /** Bon carburant pris sur une brigade. */
  | 'bon'
  /** Facture du magasin. */
  | 'magasin'
  /** Règlement d'une dette. */
  | 'reglement'
  /** Recharge du compte d'avance. */
  | 'recharge'
  /**
   * L'OUVERTURE du compte : ce que le client devait déjà le jour où sa fiche a
   * été créée. Ce n'est pas une vente — aucune marchandise n'est sortie — mais
   * c'est bien une dette, et tant qu'elle ne figurait nulle part au journal, le
   * montant saisi à la création restait invisible partout.
   */
  | 'ouverture'
  /**
   * L'AVANCE d'ouverture — le pendant exact de la ligne ci-dessus, du bon côté
   * du compte : ce que le client avait DÉJÀ versé le jour de la reprise.
   *
   * Elle portait jusqu'ici la nature `recharge`, et c'est ce qui faussait tout :
   * une recharge est de l'argent qui entre AUJOURD'HUI, elle compte donc dans
   * les règlements encaissés. La reprise, elle, n'encaisse rien — l'argent a été
   * reçu avant le logiciel, exactement comme la dette initiale a été contractée
   * avant lui. Confondues, l'écran annonçait un « total encaissé » gonflé de
   * chaque avance de reprise, et le même dinar était compté deux fois le jour où
   * le client venait vraiment payer.
   */
  | 'avance'
  /** Ligne d'historique ancienne, sans document rattaché. */
  | 'vente';

export interface ClientEntry {
  id: string;
  date: string;
  kind: ClientEntryKind;
  label: string;
  /** Ce que l'opération a coûté au client — 0 pour un règlement. */
  charged: number;
  /** Ce que le client a versé (règlement) ou déposé (recharge). */
  paid: number;
  /** Effet sur la DETTE : > 0 elle se creuse, < 0 elle se rembourse. */
  debtEffect: number;
  /** Effet sur l'AVANCE : > 0 rechargée, < 0 consommée. */
  advanceEffect: number;
  /** Espèces, chèque, virement, TPE… quand l'opération en porte un. */
  mode?: string;
  reference?: string;
  notes?: string;
  /** Détail carburant d'un bon. */
  liters?: number;
  fuelType?: string;
  pricePerLiter?: number;
  /** Reste dû sur une facture magasin. */
  rest?: number;
  /** Ce que le document a déjà encaissé (part réglée sur place). */
  paidOnDocument?: number;
  /** Numéro du document d'origine, quand il en porte un. */
  ref?: string;
  /**
   * Le détail article par article du document — c'est lui que le relevé
   * imprimé déplie sous chaque ligne : sans lui, un « Vente magasin — 4
   * article(s) » ne se vérifie pas.
   */
  items?: ClientEntryItem[];
}

/** Une ligne de détail d'un document du compte client. */
export interface ClientEntryItem {
  name: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  total: number;
}

export interface ClientLedger {
  entries: ClientEntry[];
  /** Total consommé, toutes origines confondues. */
  charged: number;
  /** Consommation portée à crédit — c'est elle qui crée la dette. */
  chargedOnCredit: number;
  /** Consommation prise sur l'avance du client. */
  chargedOnAdvance: number;
  /** Règlements de dette encaissés. */
  paid: number;
  /** Recharges du compte d'avance. */
  recharged: number;
  /** Ce que les documents disent de la dette : crédit consommé − règlements. */
  debtFromDocuments: number;
  /** Ce que les documents disent de l'avance : recharges − consommation. */
  advanceFromDocuments: number;
  /**
   * L'avance encore DÉTENUE — `advanceFromDocuments` sans jamais passer sous
   * zéro. Une avance négative ne veut rien dire : elle signale une consommation
   * qui a débordé le dépôt, et ce débordement est déjà porté par la dette.
   */
  advanceHeld: number;
  /**
   * Ce que le client doit RÉELLEMENT : sa dette, moins l'argent que la station
   * détient déjà pour lui.
   *
   * Les deux vivaient dans deux colonnes qui ne se rencontraient jamais : un
   * client repris avec 20 000 DA d'avance et qui prenait pour 5 000 DA
   * apparaissait « débiteur de 5 000 » sur sa carte, dans la Caisse Générale et
   * dans les rapports — alors que la station tenait déjà son argent. On lui
   * réclamait ce qu'il avait payé d'avance.
   */
  netDebt: number;
  /** Ce qui reste au client une fois sa dette imputée sur son avance. */
  advanceLeft: number;
  counts: { bons: number; magasin: number; reglements: number; recharges: number };
  /**
   * Ce que la colonne `clients.debt` annonce. Elle n'est qu'un COMPTEUR tenu au
   * fil de l'eau : chaque bon la monte, chaque règlement la baisse. Elle ne sait
   * rien d'une reprise d'ouverture ni d'une brigade corrigée après coup, d'où
   * l'écart ci-dessous — qu'on affiche plutôt que de le passer sous silence.
   */
  recordedDebt: number;
  /** Encours enregistré − dette d'après les pièces. */
  debtGap: number;
  /** Date de la première et de la dernière opération ('' quand le compte est vide). */
  firstDate: string;
  lastDate: string;
  /**
   * Les ombres d'historique écartées du journal — voir `SALE` plus bas. Un
   * nombre > 0 veut dire que le compte a été relu au lieu d'être doublé.
   */
  shadowsDropped: number;
}

/** Un bon de brigade concerne-t-il un vrai client (et pas un TAG / TPE) ? */
const isClientJustification = (j: any): boolean =>
  !!j?.clientId && (!j.justificationType || j.justificationType === 'CLIENT');

/**
 * Une opération a-t-elle été prise sur l'AVANCE du client plutôt qu'à crédit ?
 *
 * Deux écrans écrivent ce champ et ils n'emploient pas le même mot : la clôture
 * de brigade enregistre « AVANCE », la comptabilité de brigade recopie le mode
 * du client, qui s'écrit « ADVANCE ». Ne reconnaître que le premier revenait à
 * porter à la DETTE tous les bons saisis depuis la comptabilité pour un client
 * qui avait pourtant déjà payé d'avance.
 */
const onAdvance = (mode: any): boolean => {
  const m = String(mode ?? '').toUpperCase();
  return m === 'AVANCE' || m === 'ADVANCE';
};

/** Ce que le compte d'un client portait DÉJÀ le jour de son ouverture. */
export interface ClientOpening {
  /** Dette de reprise saisie à la création de la fiche. */
  debt: number;
  /** Premier versement d'avance, pour un compte prépayé. */
  advance: number;
  /** Date de la reprise — la création de la fiche, à défaut. */
  date: string;
  notes?: string;
}

/**
 * L'ouverture d'un compte, lue sur la fiche du client.
 *
 * La date compte autant que le montant : sans elle, la ligne d'ouverture se
 * placerait au milieu du journal (ou en tête, à la date d'aujourd'hui) et le
 * solde après chaque opération deviendrait faux. On retient, dans l'ordre : la
 * date de reprise saisie, la date de création de la fiche, puis — faute de
 * mieux — une date très ancienne, pour que l'ouverture reste la PREMIÈRE ligne.
 */
export function clientOpening(
  client: { openingDebt?: number; openingAdvance?: number; openingDate?: string; openingNotes?: string; createdAt?: string } | null | undefined,
): ClientOpening {
  const date = client?.openingDate || client?.createdAt || '1970-01-01';
  return {
    debt: Math.max(0, num(client?.openingDebt)),
    advance: Math.max(0, num(client?.openingAdvance)),
    date,
    notes: client?.openingNotes,
  };
}

/**
 * Le compte complet d'un client. `app` est l'état de l'application : on y lit
 * les brigades, leur comptabilité, les ventes magasin et l'historique du client.
 */
export function clientLedger(app: any, clientId: string): ClientLedger {
  const entries: ClientEntry[] = [];
  if (!clientId) return emptyLedger();

  const client = (app?.clients || []).find((c: any) => c.id === clientId);
  const brigades: any[] = app?.brigades || [];
  const accountings: any[] = app?.brigadeAccountings || [];

  // Retrouver la brigade d'une comptabilité par un `find` DANS la boucle
  // revenait à parcourir toute la table des brigades une fois par comptabilité :
  // sur une station qui en a des milliers, l'écran Clients se figeait à chaque
  // frappe. L'index se construit une seule fois.
  const brigadeById = new Map<string, any>();
  for (const b of brigades) brigadeById.set(b.id, b);

  // ─── 0. L'OUVERTURE DU COMPTE ───────────────────────────────────────────────
  //
  // Un client créé « à crédit » avec un encours de reprise, ou « sur avance »
  // avec un premier versement, arrivait au fichier avec un solde que RIEN
  // n'expliquait : le montant était écrit dans les colonnes `debt` / `balance`
  // et nulle part ailleurs. Le journal — la seule source que les écrans lisent
  // désormais — n'en savait donc rien : la carte annonçait 0, l'historique était
  // vide, et le rapport général ne comptait pas la créance.
  //
  // L'ouverture est maintenant une LIGNE du compte, comme les autres : datée,
  // affichée, imprimée, et modifiable. Elle porte la dette de reprise et, pour
  // un compte prépayé, le versement initial.
  const opening = clientOpening(client);
  if (opening.debt > 0) {
    entries.push({
      id: `open-debt-${clientId}`,
      date: opening.date,
      kind: 'ouverture',
      label: 'Dette initiale — ouverture du compte',
      charged: opening.debt,
      paid: 0,
      debtEffect: opening.debt,
      advanceEffect: 0,
      mode: 'CREDIT',
      notes: opening.notes,
    });
  }
  if (opening.advance > 0) {
    entries.push({
      id: `open-adv-${clientId}`,
      date: opening.date,
      kind: 'avance',
      label: "Avance initiale — ouverture du compte",
      charged: 0,
      paid: opening.advance,
      debtEffect: 0,
      advanceEffect: opening.advance,
      mode: 'OUVERTURE',
      notes: opening.notes,
    });
  }

  // 1. Bons carburant — les justifications « client » des brigades.
  for (const acc of accountings) {
    const brigade = brigadeById.get(acc.brigadeId);
    const date = brigade?.startDatetime || brigade?.date || '';
    for (const j of (acc.justifications || [])) {
      if (!isClientJustification(j) || j.clientId !== clientId) continue;
      const amount = num(j.amount);
      if (!amount) continue;
      const advance = onAdvance(j.paymentMode);
      const liters = num(j.liters);
      entries.push({
        id: `bon-${j.id}`,
        date,
        kind: 'bon',
        label: [
          'Bon carburant',
          j.fuelType,
          liters > 0 ? `${liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L` : '',
          brigade ? `brigade ${brigade.shift || ''}`.trim() : '',
        ].filter(Boolean).join(' · '),
        charged: amount,
        paid: 0,
        // Pris sur l'avance, le bon ne crée aucune dette : il consomme un
        // argent déjà versé. À crédit, c'est l'inverse.
        debtEffect: advance ? 0 : amount,
        advanceEffect: advance ? -amount : 0,
        mode: advance ? 'AVANCE' : 'CREDIT',
        notes: j.notes,
        liters: liters || undefined,
        fuelType: j.fuelType,
        pricePerLiter: num(j.pricePerLiter) || undefined,
        ref: brigade ? `BRG-${(brigade.date || date || '').slice(0, 10)}-${brigade.shift || ''}`.replace(/-$/, '') : undefined,
        items: liters > 0 ? [{
          name: j.fuelType || 'Carburant',
          qty: liters,
          unit: 'L',
          unitPrice: num(j.pricePerLiter) || (liters ? amount / liters : 0),
          total: amount,
        }] : undefined,
      });
    }
  }

  // 2. Ventes magasin — le filtre lisait `paymentMode`, jamais `clientId`.
  for (const s of (app?.shopSales || [])) {
    if (s.clientId !== clientId) continue;
    const total = num(s.total);
    const paidOnSale = num(s.amountPaid ?? s.total);
    const rest = num(s.rest ?? Math.max(0, total - paidOnSale));
    entries.push({
      id: `shop-${s.id}`,
      date: s.date,
      kind: 'magasin',
      label: `Vente magasin${(s.items || []).length ? ` — ${(s.items || []).length} article(s)` : ''}`,
      charged: total,
      paid: 0,
      // Seule la part NON réglée sur place devient une dette.
      debtEffect: rest,
      advanceEffect: onAdvance(s.paymentMode) ? -total : 0,
      mode: s.paymentMode,
      reference: s.bonNumber || s.chequeNumber,
      notes: s.notes,
      rest,
      paidOnDocument: paidOnSale,
      ref: s.bonNumber || undefined,
      items: (s.items || []).map((it: any) => ({
        name: it.productName || 'Article',
        qty: num(it.quantity),
        unitPrice: num(it.price),
        total: num(it.quantity) * num(it.price),
      })),
    });
  }

  // 3. Ventes carburant anciennes — la table n'est plus écrite, mais les lignes
  //    déjà enregistrées appartiennent toujours au compte du client.
  for (const s of (app?.fuelSales || [])) {
    if (s.clientId !== clientId) continue;
    const total = num(s.total ?? s.amount);
    if (!total) continue;
    entries.push({
      id: `fuel-${s.id}`,
      date: s.date,
      kind: 'vente',
      label: `Vente carburant${s.fuelType ? ` — ${s.fuelType}` : ''}`,
      charged: total,
      paid: 0,
      debtEffect: String(s.paymentMode || '').toUpperCase() === 'CREDIT' ? total : 0,
      advanceEffect: onAdvance(s.paymentMode) ? -total : 0,
      mode: s.paymentMode,
      liters: num(s.liters) || undefined,
      fuelType: s.fuelType,
      pricePerLiter: num(s.pricePerLiter) || undefined,
    });
  }

  // 4. Règlements, recharges — et les « ombres » de l'historique.
  //
  //    Une ligne `SALE` de `client_transactions` n'est PAS un document : c'est
  //    la copie que la comptabilité de brigade écrivait à côté de la
  //    justification qu'elle venait d'enregistrer. Comptée telle quelle, chaque
  //    bon carburant entrait DEUX fois dans le compte — une fois par sa pièce,
  //    une fois par son ombre — et la consommation affichée valait le double de
  //    la réalité. Pire pour un client sur avance : l'ombre était portée à la
  //    dette, si bien qu'un client qui n'avait jamais rien dû voyait apparaître
  //    une dette égale à tout ce qu'il avait consommé sur son propre argent.
  //
  //    On apparie donc chaque ombre au bon qu'elle recopie — même montant, à
  //    moins de 36 h l'un de l'autre, ce qui absorbe l'écart entre la date de la
  //    brigade et l'horodatage de sa nuit — et on ne garde au journal que celles
  //    qui ne retrouvent aucune pièce : celles-là sont de vraies consommations
  //    dont la brigade a disparu.
  const bonPieces = entries
    .filter(e => e.kind === 'bon')
    .map(e => ({ entry: e, matched: false }));
  const shadowOf = (date: string, amount: number) => {
    const t = new Date(date).getTime();
    return bonPieces.find(b => {
      if (b.matched || Math.abs(b.entry.charged - amount) > 0.01) return false;
      const bt = new Date(b.entry.date).getTime();
      if (!Number.isFinite(t) || !Number.isFinite(bt)) return true;
      return Math.abs(bt - t) <= 36 * 3600 * 1000;
    });
  };
  let shadowsDropped = 0;

  for (const t of (client?.transactionHistory || [])) {
    const amount = num(t.amount);
    if (!amount) continue;
    if (t.type === 'PAYMENT') {
      entries.push({
        id: `pay-${t.id}`,
        date: t.date,
        kind: 'reglement',
        label: 'Règlement de dette',
        charged: 0,
        paid: amount,
        debtEffect: -amount,
        advanceEffect: 0,
        mode: t.mode || 'ESPECES',
        reference: t.receiptNumber,
        notes: t.notes,
      });
    } else if (t.type === 'RECHARGE') {
      entries.push({
        id: `rec-${t.id}`,
        date: t.date,
        kind: 'recharge',
        label: "Recharge du compte d'avance",
        charged: 0,
        paid: amount,
        debtEffect: 0,
        advanceEffect: amount,
        mode: t.mode || 'ESPECES',
        reference: t.receiptNumber,
        notes: t.notes,
      });
    } else {
      // L'ombre d'un bon déjà au journal : la pièce a déjà tout dit.
      const piece = shadowOf(t.date, amount);
      if (piece) { piece.matched = true; shadowsDropped++; continue; }

      // Une consommation dont la brigade n'existe plus. Elle garde son effet
      // RÉEL : le mode enregistré est celui du compte au moment du bon, et une
      // consommation payée d'avance ou au comptant ne doit rien à personne.
      const fromAdvance = onAdvance(t.mode);
      const settled = ['CASH', 'ESPECES'].includes(String(t.mode || '').toUpperCase());
      entries.push({
        id: `tx-${t.id}`,
        date: t.date,
        kind: 'vente',
        label: t.notes || 'Consommation',
        charged: amount,
        paid: 0,
        debtEffect: fromAdvance || settled ? 0 : amount,
        advanceEffect: fromAdvance ? -amount : 0,
        mode: t.mode,
        reference: t.receiptNumber,
        notes: t.notes,
      });
    }
  }

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const sum = (f: (e: ClientEntry) => number) => entries.reduce((s, e) => s + f(e), 0);
  const chargedOnAdvance = -entries.reduce((s, e) => s + Math.min(0, e.advanceEffect), 0);
  const recharged = entries.reduce((s, e) => s + Math.max(0, e.advanceEffect), 0);
  const chargedOnCredit = entries.reduce((s, e) => s + Math.max(0, e.debtEffect), 0);
  const paid = sum(e => (e.kind === 'reglement' ? e.paid : 0));

  const debtFromDocuments = chargedOnCredit - paid;
  const advanceFromDocuments = recharged - chargedOnAdvance;
  // L'imputation, une bonne fois : l'avance détenue éteint la dette à
  // concurrence de ce qu'elle vaut, et ce qui survit d'un côté ou de l'autre
  // est le solde réel du compte.
  const advanceHeld = Math.max(0, advanceFromDocuments);
  const netDebt = Math.max(0, debtFromDocuments - advanceHeld);
  const advanceLeft = Math.max(0, advanceHeld - Math.max(0, debtFromDocuments));
  const recordedDebt = num(client?.debt);

  return {
    entries,
    charged: sum(e => e.charged),
    chargedOnCredit,
    chargedOnAdvance,
    paid,
    recharged,
    debtFromDocuments,
    advanceFromDocuments,
    advanceHeld,
    netDebt,
    advanceLeft,
    counts: {
      bons: entries.filter(e => e.kind === 'bon').length,
      magasin: entries.filter(e => e.kind === 'magasin').length,
      reglements: entries.filter(e => e.kind === 'reglement').length,
      // La reprise d'avance EST un dépôt sur le compte prépayé : la compter
      // ailleurs qu'ici laisserait la rubrique « Avance » annoncer zéro
      // mouvement sur un compte qui en porte un.
      recharges: entries.filter(e => e.kind === 'recharge' || e.kind === 'avance').length,
    },
    recordedDebt,
    debtGap: recordedDebt - debtFromDocuments,
    firstDate: entries.length ? entries[entries.length - 1].date : '',
    lastDate: entries.length ? entries[0].date : '',
    shadowsDropped,
  };
}

/**
 * L'avance dont le client dispose encore.
 *
 * Elle a longtemps vécu dans DEUX colonnes qui ne se parlaient pas : une
 * recharge créditait `balance`, un bon pris sur l'avance débitait
 * `advanceBalance`. Les deux bougent désormais ensemble et `advanceBalance` fait
 * foi — mais les clients enregistrés avant cette correction gardent deux valeurs
 * différentes, d'où `advanceColumnsDisagree` pour le dire à l'écran plutôt que
 * de choisir en silence.
 */
export function advanceAvailable(
  client: { balance?: number; advanceBalance?: number } | null | undefined,
): number {
  if (!client) return 0;
  const advance = client.advanceBalance ?? client.balance ?? 0;
  return Math.max(0, num(advance));
}

/** Écart entre les deux colonnes de l'avance — 0 quand elles s'accordent. */
export function advanceColumnsDisagree(
  client: { balance?: number; advanceBalance?: number } | null | undefined,
): number {
  if (!client || client.advanceBalance === undefined) return 0;
  return num(client.advanceBalance) - num(client.balance);
}

/**
 * ─── Ce qu'un client doit, TEL QUE L'ÉCRAN CLIENTS L'ANNONCE ──────────────────
 *
 * Deux chiffres se disputaient le mot « dette » :
 *
 *   • `clients.debt` — un COMPTEUR, monté à la main à chaque bon et descendu à
 *     chaque règlement. Il ne sait rien d'une reprise d'ouverture, ni d'une
 *     brigade corrigée après coup, ni de l'avance que la station détient déjà ;
 *   • `clientLedger().netDebt` — ce que les PIÈCES du compte disent, une fois
 *     l'avance imputée. C'est lui, et lui seul, que l'écran Clients affiche.
 *
 * Les deux écrans qui justifient une brigade « au client » lisaient le premier :
 * on y voyait 12 000 DA là où la fiche du client en annonçait 4 000, et rien
 * n'expliquait l'écart. Ils lisent désormais le même journal — d'où cette
 * fonction, pour que « la dette du client » n'ait plus qu'une définition dans
 * toute l'application.
 *
 * `ledger` absent (compte jamais relu), on retombe sur le compteur plutôt que
 * d'annoncer zéro : mieux vaut un chiffre approché qu'un client qui paraît
 * soldé alors qu'il doit.
 */
export interface ClientStanding {
  /** Reste dû, avance déduite — le chiffre « Dette » de l'écran Clients. */
  debt: number;
  /** Avance encore disponible, comme la fiche du client l'affiche. */
  advance: number;
  /** Ce qu'il reste à consommer sous le plafond (`Infinity` : pas de plafond). */
  restCredit: number;
  /** Le compte a-t-il été relu sur ses pièces ? Faux = repli sur les colonnes. */
  fromDocuments: boolean;
}

export function clientStanding(
  client: { debt?: number; balance?: number; advanceBalance?: number; creditLimit?: number } | null | undefined,
  ledger?: ClientLedger | null,
): ClientStanding {
  const debt = ledger ? Math.max(0, ledger.netDebt) : Math.max(0, num(client?.debt));
  const limit = num(client?.creditLimit);
  return {
    debt,
    advance: advanceAvailable(client),
    restCredit: limit > 0 ? limit - debt : Infinity,
    fromDocuments: !!ledger,
  };
}

function emptyLedger(): ClientLedger {
  return {
    entries: [],
    charged: 0, chargedOnCredit: 0, chargedOnAdvance: 0, paid: 0, recharged: 0,
    debtFromDocuments: 0, advanceFromDocuments: 0, advanceHeld: 0, netDebt: 0, advanceLeft: 0,
    counts: { bons: 0, magasin: 0, reglements: 0, recharges: 0 },
    recordedDebt: 0, debtGap: 0,
    firstDate: '', lastDate: '', shadowsDropped: 0,
  };
}

/**
 * Ce que CHAQUE client doit et détient, d'après ses pièces — pour les écrans qui
 * affichent la liste entière.
 *
 * Appeler `clientLedger` une fois par client ferait relire à chacun la TOTALITÉ
 * des comptabilités de brigade et des ventes magasin, pour n'en retenir que sa
 * poignée de lignes. Les pièces sont donc rangées par client une bonne fois, et
 * chaque compte ne reçoit que les siennes. Le résultat est identique — le
 * journal refiltre de toute façon — mais la liste ne dépend plus du produit
 * « nombre de clients × nombre de brigades ».
 */
export function clientLedgers(app: any): Record<string, ClientLedger> {
  const groupBy = <T,>(rows: T[], key: (r: T) => string | undefined) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const list = map.get(k);
      if (list) list.push(r); else map.set(k, [r]);
    }
    return map;
  };

  // Une comptabilité peut porter les bons de plusieurs clients : chacun reçoit
  // une copie de la comptabilité réduite à SES justifications.
  const accountingsByClient = new Map<string, any[]>();
  for (const acc of (app?.brigadeAccountings || [])) {
    const perClient = groupBy<any>(acc.justifications || [], j => (isClientJustification(j) ? j.clientId : undefined));
    for (const [clientId, justifications] of perClient) {
      const list = accountingsByClient.get(clientId);
      const slice = { ...acc, justifications };
      if (list) list.push(slice); else accountingsByClient.set(clientId, [slice]);
    }
  }

  const shopByClient = groupBy<any>(app?.shopSales || [], s => s.clientId);
  const fuelByClient = groupBy<any>(app?.fuelSales || [], s => s.clientId);

  const out: Record<string, ClientLedger> = {};
  for (const c of (app?.clients || [])) {
    out[c.id] = clientLedger({
      ...app,
      brigadeAccountings: accountingsByClient.get(c.id) || [],
      shopSales: shopByClient.get(c.id) || [],
      fuelSales: fuelByClient.get(c.id) || [],
    }, c.id);
  }
  return out;
}

/** Ce qu'une brigade ajoute au compte d'un client : à crédit, et sur son avance. */
export interface ClientChargeDelta {
  /** Montant qui creuse la DETTE (> 0) ou la rembourse (< 0). */
  credit: number;
  /** Montant pris sur l'AVANCE (> 0) ou rendu (< 0). */
  advance: number;
}

/**
 * ─── Ce qu'une comptabilité de brigade change AUX COMPTES CLIENTS ─────────────
 *
 * Les colonnes `debt` / `advance_balance` d'un client sont des compteurs : on
 * les fait bouger à la main, à chaque enregistrement. Deux écrans le faisaient,
 * et tous deux appliquaient la TOTALITÉ des justifications à chaque fois —
 * rouvrir une comptabilité pour corriger une virgule rajoutait donc une seconde
 * fois toute la consommation de la brigade, et la dette du client enflait sans
 * qu'aucune pièce ne l'explique.
 *
 * On ne reporte plus que la DIFFÉRENCE entre ce qui était déjà enregistré et ce
 * qu'on enregistre maintenant. Un enregistrement à l'identique ne bouge rien ;
 * une justification retirée rend au client ce qu'elle lui avait pris.
 *
 * Deux règles de tri, chacune pour une erreur constatée :
 *
 *  • les TAG et les TPE sont écartés — ils n'appartiennent à aucun client du
 *    fichier, et l'identifiant qui traînait parfois sur leur ligne suffisait à
 *    gonfler la dette de quelqu'un qui n'avait rien pris ;
 *  • c'est le mode de la JUSTIFICATION qui décide, pas celui de la fiche du
 *    client : un bon pris sur l'avance descend l'avance, tout le reste creuse
 *    la dette. Ce sont exactement les règles que le journal applique, sans quoi
 *    les compteurs et les pièces raconteraient deux histoires différentes.
 */
export function clientChargeDelta(
  before: { clientId?: string; amount?: number; justificationType?: string; paymentMode?: string }[] | undefined,
  after: typeof before,
): Map<string, ClientChargeDelta> {
  const totals = (list: typeof before) => {
    const by = new Map<string, ClientChargeDelta>();
    for (const j of (list || [])) {
      if (!j?.clientId) continue;
      if (j.justificationType && j.justificationType !== 'CLIENT') continue;
      const cur = by.get(j.clientId) || { credit: 0, advance: 0 };
      if (onAdvance(j.paymentMode)) cur.advance += num(j.amount);
      else cur.credit += num(j.amount);
      by.set(j.clientId, cur);
    }
    return by;
  };
  const was = totals(before);
  const now = totals(after);
  const zero: ClientChargeDelta = { credit: 0, advance: 0 };
  const delta = new Map<string, ClientChargeDelta>();
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = now.get(id) || zero;
    const b = was.get(id) || zero;
    const d = { credit: a.credit - b.credit, advance: a.advance - b.advance };
    if (Math.abs(d.credit) > 0.001 || Math.abs(d.advance) > 0.001) delta.set(id, d);
  }
  return delta;
}
