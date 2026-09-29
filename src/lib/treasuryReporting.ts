/**
 * ─── Treasury Reporting Engine ─────────────────────────────────────────────────
 * Consolidates the money of the whole station into a single report:
 *
 *  • Caisse générale — le solde faisant foi, calculé sur le grand livre.
 *  • Comptes bancaires — solde d'ouverture + tous les mouvements, avec entrées,
 *    sorties et l'historique complet de chaque compte.
 *  • Caisse de chaque partie — Carburant, Cafétéria, Lavage — reconstituée à
 *    partir de ses propres documents.
 *  • Journal consolidé — chaque opération de la station (achats, ventes,
 *    interventions, dépenses, salaires, virements, dépôts, retraits,
 *    encaissements de brigade), avec sa nature, sa partie et ses comptes.
 *
 * Same source of truth as the *Caisse Générale* and *Comptes Bancaires* screens,
 * so the general report can never disagree with them.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleKey, MODULES, netCashOfSale, bizExpensePaidInCash } from './bizConfig';
import { within } from './period';
import { computeCarburantCash } from './carburantSales';
import { moduleCaisseBalance, docPaymentSlices } from './bizReporting';
import { expensePartOf, isBrigadeExpense, cashEffectOf, treasuryEffectOf, partCashEffect } from '../store/AppContext';

export const CAISSE_ID = 'CAISSE';

/**
 * Les coffres de chaque activité (mêmes identifiants que `AppContext`). Un
 * virement au départ de l'un d'eux est une SORTIE d'espèces : sans eux, le
 * rapport comptait ces virements pour zéro et la caisse de l'activité restait
 * gonflée de l'argent déjà parti en banque.
 */
export const CAISSE_PART_ID = {
  carburant: 'CAISSE_CARBURANT',
  restaurant: 'CAISSE_RESTAURANT',
  cafeteria: 'CAISSE_CAFETERIA',
  lavage: 'CAISSE_LAVAGE',
} as const;

export const CASH_ACCOUNT_IDS: string[] = [CAISSE_ID, ...Object.values(CAISSE_PART_ID)];

export const CASH_ACCOUNT_LABEL: Record<string, string> = {
  [CAISSE_ID]: 'Caisse générale',
  [CAISSE_PART_ID.carburant]: 'Caisse Carburant',
  [CAISSE_PART_ID.restaurant]: 'Caisse Restaurant',
  [CAISSE_PART_ID.cafeteria]: 'Caisse Cafétéria',
  [CAISSE_PART_ID.lavage]: 'Caisse Lavage & Vidange',
};

const isCashAccount = (id?: string): boolean => !!id && CASH_ACCOUNT_IDS.includes(id);

export type TreasuryPartKey = 'carburant' | 'restaurant' | 'cafeteria' | 'lavage' | 'systeme';

/**
 * À QUI appartient l'argent DÉJÀ sur un compte bancaire le jour de sa création.
 *
 * Ce solde d'ouverture n'a aucune ligne de grand livre derrière lui : rien ne
 * dit quelle activité l'a versé. Il était donc rangé dans « Finance », une
 * activité qui ne vend rien et que personne ne consulte — 2,7 millions y
 * dormaient, invisibles. Le Carburant, qui provoque TOUS les mouvements de ces
 * comptes, affichait 2,2 millions en banque quand la station en avait 4,9.
 *
 * Ces comptes sont ceux de la station-service : leur solde de départ vient du
 * carburant, comme tout ce qui y passe ensuite. Il lui revient donc, et la
 * somme des parts fait toujours EXACTEMENT le solde du compte — aucun dinar
 * inventé, aucun perdu, aucune activité qui compterait l'argent d'une autre.
 */
export const BANK_OPENING_PART: TreasuryPartKey = 'carburant';

export const TX_LABEL: Record<string, string> = {
  DEPOSIT: 'Dépôt', WITHDRAW: 'Retrait', TRANSFER: 'Virement',
  PURCHASE: 'Achat', SALE: 'Vente', EXPENSE: 'Dépense',
  BRIGADE: 'Brigade', TPE: 'TPE', SALARY: 'Salaire', ADJUST: 'Ajustement',
};

/** Document qui a écrit la ligne — pour que le détail dise d'où vient l'argent. */
export const ORIGIN_LABEL: Record<string, string> = {
  purchase: 'Achat carburant', expense: 'Dépense', brigade: 'Brigade',
  client_payment: 'Règlement / recharge client',
  /** Dépense d'une partie (Cafétéria / Lavage) réglée par un compte bancaire. */
  biz_expense: 'Dépense de partie',
};

export const TREASURY_PART_LABEL: Record<TreasuryPartKey, string> = {
  carburant: 'Carburant', restaurant: 'Restaurant', cafeteria: 'Cafétéria', lavage: 'Lavage & Vidange', systeme: 'Finance',
};

// ─── Rows ────────────────────────────────────────────────────────────────────
export interface TreasuryMovement {
  id: string;
  date: string;
  nature: string;
  part: TreasuryPartKey;
  partLabel: string;
  label: string;
  /**
   * Effet sur les ESPÈCES de la station : > 0 = encaissement. Vaut 0 quand tout
   * s'est joué en banque — un règlement par virement ne vide aucun tiroir.
   */
  amount: number;
  /** Montant de l'opération, toujours positif : ce qui a bougé, où que ce soit. */
  gross: number;
  /** L'argent a bougé sur un compte bancaire, pas dans un tiroir. */
  bank: boolean;
  /**
   * Virement d'un tiroir de la station vers un AUTRE tiroir : le billet a changé
   * de poche, les espèces de la station n'ont pas bougé d'un dinar.
   */
  internal?: boolean;
  accounts?: string;
  reference?: string;
  /** True for ledger lines (editable in Caisse Générale), false for documents. */
  isLedger: boolean;
}

/**
 * La part d'UN compte bancaire qui revient à UNE activité.
 *
 * Un compte est commun, comme le tiroir : c'est la ligne du grand livre qui dit
 * de qui est le mouvement (`tx.part`). Ce qu'une activité a versé sur le compte
 * lui reste ; ce qu'elle en a réglé le quitte. Le solde d'ouverture du compte,
 * lui, n'a aucune ligne derrière lui : il revient à l'activité des comptes
 * (voir `BANK_OPENING_PART`).
 *
 * La somme des parts fait EXACTEMENT le solde du compte — aucun dinar n'est
 * compté deux fois, aucun n'est perdu.
 */
export interface TreasuryAccountPart {
  key: TreasuryPartKey;
  label: string;
  /** Part du solde qui revient à cette activité (négative si elle a plus réglé qu'elle n'a versé). */
  balance: number;
  /** Ce qu'elle a fait entrer / sortir du compte sur la période. */
  credit: number; debit: number;
  /** Mouvements de la période qui lui sont imputés. */
  count: number;
}

export interface TreasuryAccount {
  id: string; name: string; accountNumber?: string; notes?: string;
  initialBalance: number; balance: number;
  /** Le solde du compte, activité par activité — leur somme est `balance`. */
  parts: TreasuryAccountPart[];
  /**
   * Solde du compte la VEILLE du début de période — le point de départ dont
   * `credit` et `debit` expliquent l'écart avec `balance`. Sans lui, la carte
   * affichait un solde que rien à l'écran ne rattachait à la période choisie.
   */
  openingBalance: number;
  credit: number; debit: number; movesCount: number;
  /** Movements of this account over the period. */
  moves: { id: string; date: string; nature: string; label: string; counterpart: string; amount: number; reference?: string }[];
}

export interface TreasuryPartBalance {
  key: TreasuryPartKey; label: string;
  balance: number;
  inflow: number; outflow: number;
}

// ─── Caisse générale : le solde, expliqué mouvement par mouvement ────────────
/** Un mouvement qui touche la caisse générale, vu DEPUIS la caisse. */
export interface CaisseLine {
  id: string;
  date: string;
  nature: string;
  label: string;
  /** L'autre bout du mouvement : d'où l'argent vient, ou où il est parti. */
  counterpart: string;
  /** Signé sur la caisse : > 0 = espèces entrées, < 0 = espèces sorties. */
  amount: number;
  reference?: string;
  part: TreasuryPartKey;
  partLabel: string;
  /** Document d'origine (achat, dépense, brigade…) quand la ligne en a un. */
  origin?: string;
  /** Place du mouvement par rapport à la période lue. */
  bucket: 'avant' | 'periode' | 'apres';
}

/** Tous les mouvements de même nature et de même sens, additionnés. */
export interface CaisseGroup {
  key: string;
  label: string;
  direction: 'in' | 'out';
  count: number;
  /** Toujours positif — le sens est porté par `direction`. */
  total: number;
  lines: CaisseLine[];
}

/**
 * Le calcul complet du solde de la caisse générale :
 *
 *     ouverture + entrées − sorties = solde de fin de période
 *                        ( + mouvements postérieurs ) = solde d'aujourd'hui
 *
 * Chaque terme est décomposé par nature puis jusqu'à la ligne, pour qu'un solde
 * négatif se lise et s'explique au lieu d'être subi.
 */
export interface CaisseBreakdown {
  /** Solde de la caisse la veille du début de période. */
  opening: number;
  in: number;
  out: number;
  /** ouverture + entrées − sorties. */
  periodEnd: number;
  /** Mouvements POSTÉRIEURS à la période — ils comptent dans le solde réel. */
  after: number;
  /** Le solde d'aujourd'hui : `periodEnd + after`. */
  balance: number;
  groups: CaisseGroup[];
  lines: CaisseLine[];
  openingLines: CaisseLine[];
  afterLines: CaisseLine[];
  counts: { period: number; in: number; out: number; before: number; after: number };
}

export interface TreasuryReport {
  from: string; to: string;
  caisseBalance: number;
  bankTotal: number;
  grandTotal: number;
  /** Caisse générale à l'ouverture de la période, et ses flux sur la période. */
  caisseOpening: number;
  caisseIn: number;
  caisseOut: number;
  /** Le solde de la caisse générale expliqué jusqu'à la ligne. */
  caisseDetail: CaisseBreakdown;
  /** Total des comptes bancaires à l'ouverture de la période, et leurs flux. */
  bankOpening: number;
  bankIn: number;
  bankOut: number;
  accounts: TreasuryAccount[];
  partBalances: TreasuryPartBalance[];
  movements: TreasuryMovement[];
  /** Period flows on the consolidated journal — ESPÈCES uniquement. */
  inflow: number; outflow: number; net: number;
  /** Ce qui a bougé en BANQUE sur la période, sans jamais passer par un tiroir. */
  bankMoves: number;
  byNature: { nature: string; count: number; inflow: number; outflow: number; net: number }[];
  byPart: { part: TreasuryPartKey; label: string; inflow: number; outflow: number; net: number }[];
  counts: { accounts: number; movements: number; ledgerLines: number };
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const ledgerNetFor = (accountId: string, txs: any[]): number => {
  let net = 0;
  for (const t of txs) {
    if (t.accountTo === accountId) net += num(t.amount);
    if (t.accountFrom === accountId) net -= num(t.amount);
  }
  return net;
};

// ─── Entry point ─────────────────────────────────────────────────────────────
export function computeTreasuryReport(app: any, biz: BizState, from: string, to: string): TreasuryReport {
  const txs: any[] = app.treasuryTransactions || [];
  const bankAccounts: any[] = app.bankAccounts || [];
  const purchases: any[] = app.purchases || [];
  const expenses: any[] = app.expenses || [];
  const suppliers: any[] = app.suppliers || [];
  const brigades: any[] = app.brigades || [];
  const accountings: any[] = app.brigadeAccountings || [];

  // ── Balances (always the whole history — a solde is not a period figure) ──
  // Le solde reste le solde RÉEL, toutes dates confondues : ce qu'il y a dans la
  // caisse aujourd'hui ne dépend pas de la fenêtre regardée. Ce qui manquait,
  // c'est le lien avec la période — d'où l'ouverture et les flux ci-dessous, qui
  // rendent l'écart lisible : ouverture + entrées − sorties = solde.
  const caisseBalance = ledgerNetFor(CAISSE_ID, txs);
  /** Mouvements ANTÉRIEURS au début de la période (rien si aucune borne). */
  const beforeFrom = (t: any) => !!from && new Date(t.date).getTime() < new Date(from).getTime();
  const txsBefore = txs.filter(beforeFrom);
  const txsInRange = txs.filter(t => within(t.date, from, to));
  const caisseOpening = ledgerNetFor(CAISSE_ID, txsBefore);
  const caisseIn = txsInRange.filter(t => t.accountTo === CAISSE_ID).reduce((s, t) => s + num(t.amount), 0);
  const caisseOut = txsInRange.filter(t => t.accountFrom === CAISSE_ID).reduce((s, t) => s + num(t.amount), 0);
  const accName = (id?: string) => {
    if (!id) return 'Externe';
    return CASH_ACCOUNT_LABEL[id] || bankAccounts.find(a => a.id === id)?.name || '—';
  };
  const refOf = (t: any) =>
    [t.chequeNumber && `Chèque ${t.chequeNumber}`, t.bordereauNumber && `Bordereau ${t.bordereauNumber}`]
      .filter(Boolean).join(' • ') || undefined;

  // ── Le solde de la caisse, expliqué ───────────────────────────────────────
  // Le chiffre affiché ne se discute pas : c'est la somme des mouvements du
  // grand livre qui touchent la caisse. Ce qui manquait, c'est de pouvoir le
  // VÉRIFIER — d'où le découpage en trois temps (avant / pendant / après la
  // période) puis par nature, jusqu'à la ligne. Les trois temps forment une
  // partition de tous les mouvements de la caisse : leur somme est donc, par
  // construction, exactement le solde ci-dessus.
  const caisseLineOf = (t: any, bucket: CaisseLine['bucket']): CaisseLine => {
    const isIn = t.accountTo === CAISSE_ID;
    const nature = TX_LABEL[t.kind] || t.kind;
    const part = (t.part || 'systeme') as TreasuryPartKey;
    return {
      id: t.id, date: t.date, nature,
      label: t.description || nature,
      counterpart: accName(isIn ? t.accountFrom : t.accountTo),
      amount: isIn ? num(t.amount) : -num(t.amount),
      reference: refOf(t),
      part, partLabel: TREASURY_PART_LABEL[part] || TREASURY_PART_LABEL.systeme,
      origin: t.refType ? (ORIGIN_LABEL[t.refType] || t.refType) : undefined,
      bucket,
    };
  };
  const byDateDesc = (a: { date: string }, b: { date: string }) =>
    new Date(b.date).getTime() - new Date(a.date).getTime();
  /** Un mouvement ne touche la caisse que par UN seul de ses deux comptes. */
  const caisseTxs = txs.filter(t =>
    (t.accountTo === CAISSE_ID) !== (t.accountFrom === CAISSE_ID));
  const caisseOpeningLines = caisseTxs.filter(beforeFrom).map(t => caisseLineOf(t, 'avant')).sort(byDateDesc);
  const caissePeriodLines = caisseTxs.filter(t => within(t.date, from, to)).map(t => caisseLineOf(t, 'periode')).sort(byDateDesc);
  // Tout ce qui n'est ni avant ni dans la période lui est postérieur : ces
  // mouvements sont dans le solde réel sans être dans les flux de la période.
  // Sans eux, « ouverture + entrées − sorties » ne retombait pas sur le solde.
  const caisseAfterLines = caisseTxs
    .filter(t => !beforeFrom(t) && !within(t.date, from, to))
    .map(t => caisseLineOf(t, 'apres')).sort(byDateDesc);

  const groupMap = new Map<string, CaisseGroup>();
  for (const l of caissePeriodLines) {
    const direction: 'in' | 'out' = l.amount >= 0 ? 'in' : 'out';
    const key = `${l.nature}|${direction}`;
    const g = groupMap.get(key)
      || { key, label: l.nature, direction, count: 0, total: 0, lines: [] as CaisseLine[] };
    g.count += 1;
    g.total += Math.abs(l.amount);
    g.lines.push(l);
    groupMap.set(key, g);
  }
  const caisseAfter = caisseAfterLines.reduce((s, l) => s + l.amount, 0);
  const caisseDetail: CaisseBreakdown = {
    opening: caisseOpening,
    in: caisseIn, out: caisseOut,
    periodEnd: caisseOpening + caisseIn - caisseOut,
    after: caisseAfter,
    balance: caisseBalance,
    groups: Array.from(groupMap.values()).sort((a, b) => b.total - a.total),
    lines: caissePeriodLines,
    openingLines: caisseOpeningLines,
    afterLines: caisseAfterLines,
    counts: {
      period: caissePeriodLines.length,
      in: caissePeriodLines.filter(l => l.amount >= 0).length,
      out: caissePeriodLines.filter(l => l.amount < 0).length,
      before: caisseOpeningLines.length,
      after: caisseAfterLines.length,
    },
  };

  const accounts: TreasuryAccount[] = bankAccounts.map(a => {
    const all = txs.filter(t => t.accountFrom === a.id || t.accountTo === a.id);
    const inRange = all.filter(t => within(t.date, from, to));
    // ── À QUI est l'argent qui dort sur ce compte ? ──────────────────────────
    // Un compte bancaire est commun, comme le tiroir : l'écran ne savait donc
    // le rattacher qu'à la Finance, et une activité regardée seule affichait
    // 0,00 DA en banque alors qu'elle y avait versé ses recettes et réglé ses
    // fournisseurs. Chaque ligne du grand livre porte pourtant l'activité qui
    // l'a provoquée — c'est elle qui répartit le solde, sans en inventer un
    // dinar : la somme des parts est exactement le solde du compte.
    const parts: TreasuryAccountPart[] = (Object.keys(TREASURY_PART_LABEL) as TreasuryPartKey[])
      .map(key => {
        const own = all.filter(t => ((t.part || 'systeme') as TreasuryPartKey) === key);
        const ownRange = own.filter(t => within(t.date, from, to));
        return {
          key, label: TREASURY_PART_LABEL[key],
          // Le solde d'ouverture revient à l'activité des comptes (`BANK_OPENING_PART`) :
          // rangé dans « Finance », il disparaissait de tous les écrans.
          balance: (key === BANK_OPENING_PART ? num(a.initialBalance) : 0) + ledgerNetFor(a.id, own),
          credit: ownRange.filter(t => t.accountTo === a.id).reduce((s, t) => s + num(t.amount), 0),
          debit: ownRange.filter(t => t.accountFrom === a.id).reduce((s, t) => s + num(t.amount), 0),
          count: ownRange.length,
        };
      });
    return {
      id: a.id, name: a.name, accountNumber: a.accountNumber, notes: a.notes,
      initialBalance: num(a.initialBalance),
      balance: num(a.initialBalance) + ledgerNetFor(a.id, txs),
      parts,
      openingBalance: num(a.initialBalance) + ledgerNetFor(a.id, all.filter(beforeFrom)),
      credit: inRange.filter(t => t.accountTo === a.id).reduce((s, t) => s + num(t.amount), 0),
      debit: inRange.filter(t => t.accountFrom === a.id).reduce((s, t) => s + num(t.amount), 0),
      movesCount: all.length,
      moves: inRange
        .sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())
        .map(t => {
          const isIn = t.accountTo === a.id;
          return {
            id: t.id, date: t.date, nature: TX_LABEL[t.kind] || t.kind,
            label: t.description || TX_LABEL[t.kind] || t.kind,
            counterpart: accName(isIn ? t.accountFrom : t.accountTo),
            amount: isIn ? num(t.amount) : -num(t.amount),
            reference: refOf(t),
          };
        }),
    };
  });
  const bankTotal = accounts.reduce((s, a) => s + a.balance, 0);
  const bankOpening = accounts.reduce((s, a) => s + a.openingBalance, 0);
  const bankIn = accounts.reduce((s, a) => s + a.credit, 0);
  const bankOut = accounts.reduce((s, a) => s + a.debit, 0);

  // ── Consolidated journal ───────────────────────────────────────────────────
  const all: TreasuryMovement[] = [];
  const push = (m: Omit<TreasuryMovement, 'partLabel' | 'gross' | 'bank'> & { gross?: number; bank?: boolean }) =>
    all.push({
      gross: Math.abs(m.amount), bank: false,
      ...m, partLabel: TREASURY_PART_LABEL[m.part],
    });

  // 1. Treasury ledger — the only rows that move the caisses of the station.
  //    Le signe vient des DEUX COMPTES de la ligne, jamais de sa nature : un
  //    achat, une dépense ou un salaire réglé par VIREMENT BANCAIRE a débité la
  //    banque et n'a jamais vidé un tiroir. Le compter en décaissement d'espèces
  //    sortait le même montant deux fois du rapport (même règle que l'écran
  //    Caisse Générale, qui ne peut donc pas annoncer d'autres totaux).
  for (const t of txs) {
    const nature = TX_LABEL[t.kind] || t.kind;
    const amount = cashEffectOf(t);
    // Un virement d'un tiroir vers un autre ne fait sortir aucune espèce de la
    // station : le compter en décaissement gonflait les sorties de la période
    // d'un argent qui n'était jamais parti.
    const internal = isCashAccount(t.accountFrom) && isCashAccount(t.accountTo);
    push({
      id: t.id, date: t.date, nature, part: (t.part || 'systeme') as TreasuryPartKey,
      label: t.description || nature, amount: internal ? 0 : amount, isLedger: true,
      gross: Math.abs(amount || treasuryEffectOf(t) || num(t.amount)),
      bank: !internal && amount === 0,
      internal,
      accounts: [t.accountFrom && accName(t.accountFrom), t.accountTo && accName(t.accountTo)].filter(Boolean).join(' → ') || undefined,
      reference: refOf(t),
    });
  }

  // 2. Fuel-part documents — SEULEMENT ceux qui n'ont pas écrit leur propre
  //    ligne au grand livre, sinon le même argent est compté deux fois. Chaque
  //    achat réglé, chaque dépense payée et chaque brigade clôturée laisse déjà
  //    une ligne au grand livre : elles gonflaient les encaissements, les
  //    décaissements et le flux net du rapport (même règle que l'écran Caisse
  //    Générale, qui ne peut donc plus annoncer d'autres totaux).
  const ledgered = new Set(
    txs.filter(t => t.refType && t.refId).map(t => `${t.refType}:${t.refId}`));
  for (const p of purchases) {
    if (ledgered.has(`purchase:${p.id}`)) continue;
    push({
      id: `pur-${p.id}`, date: p.date, nature: 'Achat', part: 'carburant', isLedger: false,
      label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${suppliers.find(s => s.id === p.supplierId)?.name || 'Fournisseur'}`.trim(),
      amount: -num(p.amountPaid),
    });
  }
  for (const e of expenses) {
    if (ledgered.has(`expense:${e.id}`)) continue;
    // Une dépense de brigade n'a jamais touché un tiroir : son montant manque
    // déjà aux espèces remises par la brigade (`lib/brigadeExpenses.ts`).
    if (isBrigadeExpense(e)) continue;
    // Payée depuis un compte bancaire, elle n'a rien pris à la caisse.
    const paidInCash = !e.accountId || isCashAccount(e.accountId);
    push({
      // La dépense appartient à l'activité qui la supporte, pas au Carburant
      // par défaut : c'est ce classement qui décide de quelle caisse elle sort.
      id: `exp-${e.id}`, date: e.date, nature: 'Dépense',
      part: expensePartOf(e) as TreasuryPartKey, isLedger: false,
      label: `${e.category || 'Dépense'} — ${e.description || ''}`.trim(),
      amount: paidInCash ? -num(e.amount) : 0,
      gross: Math.abs(num(e.amount)), bank: !paidInCash,
    });
  }
  for (const a of accountings) {
    if (ledgered.has(`brigade:${a.brigadeId}`)) continue;
    const br = brigades.find(b => b.id === a.brigadeId);
    push({
      id: `bri-${a.id}`, date: br?.startDatetime || br?.date || new Date().toISOString(),
      nature: 'Brigade', part: 'carburant', isLedger: false,
      label: `Encaissement brigade ${br ? `${br.shift}` : ''}`.trim(),
      amount: num(a.cashReceived),
    });
  }

  // Salaires et acomptes du personnel carburant — ils sortent de la caisse de
  // l'activité (`lib/carburantSales`), le journal doit donc les porter, sans
  // quoi le solde d'une caisse baissait sans qu'aucune ligne ne l'explique.
  for (const key of ['pompistes', 'brigadeChefs', 'gerants', 'magasinWorkers']) {
    for (const w of ((app?.[key] || []) as any[])) {
      for (const p of (w.paymentRecord || [])) {
        if (p.isPaid === false) continue;
        const amount = num(p.netSalary ?? p.amount);
        if (!amount) continue;
        const mode = String(p.paymentMode || '').trim().toUpperCase();
        const cash = mode === '' || mode === 'ESPÈCES' || mode === 'ESPECES' || mode === 'CASH' || mode === 'LIQUIDE';
        push({
          id: `sal-${p.id}`, date: p.paymentDate, nature: 'Salaire',
          part: 'carburant', isLedger: false,
          label: `Salaire ${w.name || 'Employé'}${p.month ? ` — ${p.month}` : ''}`,
          amount: cash ? -amount : 0,
          gross: amount, bank: !cash,
        });
      }
      for (const a of (w.acomptes || [])) {
        const amount = num(a.amount);
        if (!amount) continue;
        push({
          id: `aco-${a.id}`, date: a.date, nature: 'Acompte',
          part: 'carburant', isLedger: false,
          label: `Acompte ${w.name || 'Employé'}${a.description ? ` — ${a.description}` : ''}`,
          amount: -amount,
        });
      }
    }
  }

  // Argent remis par les clients Carburant — règlements de dette ET recharges
  // d'avance encaissés en espèces. La caisse de l'activité les compte
  // (`computeCarburantCash`), le journal les ignorait : le solde de la caisse
  // Carburant était donc plus haut que la somme des lignes censées l'expliquer.
  // Celles qui ont déjà leur ligne au grand livre sont écartées, sinon le même
  // billet entrerait deux fois.
  for (const c of (app?.clients || [])) {
    for (const t of (c.transactionHistory || [])) {
      if (t.type !== 'PAYMENT' && t.type !== 'RECHARGE') continue;
      if (ledgered.has(`client_payment:${t.id}`)) continue;
      const mode = String(t.mode || 'ESPECES').toUpperCase();
      if (mode !== 'ESPECES' && mode !== 'CASH') continue;
      const amount = num(t.amount);
      if (!amount) continue;
      const isRecharge = t.type === 'RECHARGE';
      push({
        id: `cli-${t.id}`, date: t.date, part: 'carburant', isLedger: false,
        nature: isRecharge ? 'Recharge client' : 'Règlement client',
        label: isRecharge ? `Recharge avance — ${c.name}` : `Règlement dette — ${c.name}`,
        amount,
        reference: t.receiptNumber,
      });
    }
  }

  // 3. Business parts (Cafétéria / Lavage).
  (Object.keys(MODULES) as ModuleKey[]).forEach(key => {
    const m = biz[key];
    if (!m) return;
    const part = key as TreasuryPartKey;
    // `netCashOfSale` : une vente retournée n'a laissé dans le tiroir que ce qui
    // n'a pas été remboursé, une vente échangée rien du tout (le remplacement
    // porte l'encaissement). Le journal montre donc le mouvement RÉEL.
    // Et chaque versement est daté du jour où il est entré (`docPaymentSlices`),
    // pas de celui de la facture qu'il solde — sans quoi un règlement encaissé
    // aujourd'hui s'inscrivait dans une période déjà close.
    (m.sales || []).forEach(s => docPaymentSlices(s, netCashOfSale(s)).forEach(l => push({
      id: `${key}-sale-${l.id}`, date: l.date, nature: 'Vente', part, isLedger: false,
      label: `Vente ${s.ref} — ${s.clientName}`
        + (s.status === 'retournée' ? ' (retournée)' : s.status === 'échangée' ? ' (échangée)' : ''),
      amount: l.amount,
    })));
    (m.reparations || []).forEach(r => docPaymentSlices(r, num(r.paid)).forEach(l => push({
      id: `${key}-rep-${l.id}`, date: l.date, nature: 'Vente', part, isLedger: false,
      label: `${r.kind === 'lavage' ? 'Lavage' : r.kind === 'reparation' ? 'Vidange' : 'Lavage + Vidange'} ${r.ref} — ${r.clientName}`,
      amount: l.amount,
    })));
    (m.purchases || []).forEach(p => push({
      id: `${key}-pur-${p.id}`, date: p.date, nature: 'Achat', part, isLedger: false,
      label: `Achat ${p.ref} — ${p.supplierName}`, amount: -num(p.paid),
    }));
    // Une dépense de partie réglée par la BANQUE a écrit sa propre ligne au
    // grand livre : la repousser ici comptait le même argent deux fois.
    (m.expenses || []).filter(e => !ledgered.has(`biz_expense:${e.id}`)).forEach(e => {
      const paidInCash = bizExpensePaidInCash(e);
      push({
        id: `${key}-exp-${e.id}`, date: e.date, nature: 'Dépense', part, isLedger: false,
        label: `${e.name}${e.description ? ` — ${e.description}` : ''}`,
        amount: paidInCash ? -num(e.amount) : 0,
        gross: Math.abs(num(e.amount)), bank: !paidInCash,
      });
    });
    (m.caisse || []).forEach(c => push({
      id: `${key}-csh-${c.id}`, date: c.date, part, isLedger: false,
      nature: c.type === 'deposit' ? 'Dépôt' : 'Retrait',
      label: c.description || (c.type === 'deposit' ? 'Dépôt de caisse' : 'Retrait de caisse'),
      amount: c.type === 'deposit' ? num(c.amount) : -num(c.amount),
    }));
    (m.workers || []).forEach(w => (w.payments || []).forEach(pay => push({
      id: `${key}-pay-${pay.id}`, date: pay.date, nature: 'Salaire', part, isLedger: false,
      label: `Salaire ${w.name} — ${pay.period}`, amount: -num(pay.amount),
    })));
    // L'acompte est de l'argent déjà remis : il quitte le tiroir le jour où il a
    // été donné, et le salaire net l'a déjà déduit.
    (m.workers || []).forEach(w => (w.acomptes || []).filter(a => num(a.amount) > 0).forEach(a => push({
      id: `${key}-aco-${a.id}`, date: a.date, nature: 'Acompte', part, isLedger: false,
      label: `Acompte ${w.name}${a.description ? ` — ${a.description}` : ''}`, amount: -num(a.amount),
    })));
  });

  const movements = all
    .filter(m => within(m.date, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Cash position of each part (all dates — it is a solde) ────────────────
  // Le calcul vit dans `bizReporting.moduleCaisseBalance`, que l'écran Caisse
  // Générale et le rapport de la partie appellent aussi. La copie qui vivait
  // ici retranchait TOUTES les dépenses de la partie — y compris celles réglées
  // par virement, qui n'ont jamais vidé le tiroir — et additionnait en plus le
  // grand livre du coffre en entier, ce qui comptait une deuxième fois chaque
  // dépense en espèces. Trois écrans, trois soldes différents.
  const partBalance = (key: ModuleKey): number => {
    const m = biz[key];
    if (!m) return 0;
    return moduleCaisseBalance(m, key, txs, expenses);
  };
  // La caisse Carburant a UNE seule définition, partagée avec l'écran Caisse
  // Générale et le rapport Carburant (`lib/carburantSales`). Le calcul fait ici
  // retranchait le montant payé de CHAQUE achat, chèques et virements compris :
  // il annonçait un découvert que le tiroir n'avait jamais connu.
  const carburantBalance = computeCarburantCash(app).balance;

  /**
   * Les flux d'UNE activité sur la période.
   *
   * Un virement d'un tiroir vers un AUTRE tiroir ne compte pour rien au niveau
   * de la station — les espèces n'ont pas bougé — mais il est bien une sortie
   * pour la caisse qui donne et une entrée pour celle qui reçoit. La ligne du
   * journal étant unique, ces deux effets sont relus ici depuis le grand livre,
   * bout par bout : sans ça, la caisse d'une activité baissait sans qu'aucune
   * sortie ne l'explique.
   */
  const flowsOf = (key: TreasuryPartKey) => {
    const rows = movements.filter(m => m.part === key && !m.internal);
    let inflow = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    let outflow = rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);
    for (const t of txsInRange) {
      if (!isCashAccount(t.accountFrom) || !isCashAccount(t.accountTo)) continue;
      const effect = partCashEffect(key as any, t);
      if (effect > 0) inflow += effect; else if (effect < 0) outflow += -effect;
    }
    return { inflow, outflow };
  };

  const partBalances: TreasuryPartBalance[] = [
    { key: 'carburant', label: TREASURY_PART_LABEL.carburant, balance: carburantBalance, ...flowsOf('carburant') },
    { key: 'restaurant', label: TREASURY_PART_LABEL.restaurant, balance: partBalance('restaurant'), ...flowsOf('restaurant') },
    { key: 'cafeteria', label: TREASURY_PART_LABEL.cafeteria, balance: partBalance('cafeteria'), ...flowsOf('cafeteria') },
    { key: 'lavage', label: TREASURY_PART_LABEL.lavage, balance: partBalance('lavage'), ...flowsOf('lavage') },
    { key: 'systeme', label: TREASURY_PART_LABEL.systeme, balance: caisseBalance + bankTotal, ...flowsOf('systeme') },
  ];

  // ── Break-downs ───────────────────────────────────────────────────────────
  const natureMap = new Map<string, { count: number; inflow: number; outflow: number }>();
  movements.forEach(m => {
    const e = natureMap.get(m.nature) || { count: 0, inflow: 0, outflow: 0 };
    e.count += 1;
    if (m.amount >= 0) e.inflow += m.amount; else e.outflow += -m.amount;
    natureMap.set(m.nature, e);
  });
  const byNature = Array.from(natureMap.entries())
    .map(([nature, v]) => ({ nature, ...v, net: v.inflow - v.outflow }))
    .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));

  const byPart = (Object.keys(TREASURY_PART_LABEL) as TreasuryPartKey[]).map(part => {
    const f = flowsOf(part);
    return { part, label: TREASURY_PART_LABEL[part], inflow: f.inflow, outflow: f.outflow, net: f.inflow - f.outflow };
  });

  const inflow = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
  const outflow = movements.filter(m => m.amount < 0).reduce((s, m) => s - m.amount, 0);
  // Ce qui a bougé sans passer par un tiroir : achats, dépenses et salaires
  // réglés depuis un compte bancaire, encaissements TPE, virements internes.
  const bankMoves = movements.filter(m => m.bank).reduce((s, m) => s + m.gross, 0);

  return {
    from, to,
    caisseBalance, bankTotal, grandTotal: caisseBalance + bankTotal,
    caisseOpening, caisseIn, caisseOut, caisseDetail,
    bankOpening, bankIn, bankOut,
    accounts, partBalances, movements,
    inflow, outflow, net: inflow - outflow, bankMoves,
    byNature, byPart,
    counts: {
      accounts: accounts.length,
      movements: movements.length,
      ledgerLines: movements.filter(m => m.isLedger).length,
    },
  };
}
