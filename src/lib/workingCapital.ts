/**
 * ─── Fonds de roulement ────────────────────────────────────────────────────────
 * Ce que la station possède vraiment, à l'instant T :
 *
 *      TRÉSORERIE ( caisse générale + comptes bancaires )
 *    + CRÉANCES   ( ce que les clients doivent encore )
 *    + STOCK      ( carburant en cuve + marchandise, AU PRIX D'ACHAT )
 *    − DETTES     ( ce que la station doit à ses fournisseurs )
 *    ─────────────────────────────────────────────────────────────────
 *    = FONDS DE ROULEMENT
 *
 * Le STOCK entre désormais DANS le total : le carburant qui dort dans les cuves
 * et la marchandise des parties commerciales ont été payés, ils appartiennent à
 * la station, et un gérant qui demande « qu'est-ce que je possède ? » veut les y
 * voir. Ils sont comptés à leur PRIX D'ACHAT — jamais au prix de vente : la
 * marge n'existe pas tant que rien n'est vendu.
 *
 * Le fonds de roulement PUREMENT FINANCIER (hors stock) reste calculé à part
 * (`financialWorkingCapital`) pour qui veut la trésorerie disponible seule.
 *
 * Chaque terme est détaillé jusqu'à la ligne : un compte bancaire par compte
 * (avec son solde d'ouverture et ses mouvements), la caisse de chaque activité,
 * chaque client débiteur avec sa facture, chaque fournisseur avec la sienne,
 * chaque cuve et chaque référence en stock.
 *
 * ── La TRÉSORERIE, activité par activité ──────────────────────────────────────
 * Les espèces de la station, ce sont les QUATRE TIROIRS de l'écran Caisse
 * Générale : Carburant, Cafétéria, Lavage — chacun reconstitué sur ses propres
 * documents — et la Finance, c.-à-d. la part du tiroir commun qui n'appartient à
 * aucune activité. Leur somme est le « Toutes les caisses » de cet écran-là.
 *
 * Chacun de ces tiroirs est ici une ligne COMPTÉE, rattachée à son activité.
 * L'écran ne retenait auparavant que le solde du tiroir commun au grand livre :
 * il annonçait donc, sur « Toutes les activités », un argent que la station
 * n'avait plus (les règlements en espèces passés par un document n'écrivent pas
 * tous une ligne au grand livre), et, dès qu'on filtrait sur une activité, une
 * trésorerie de ZÉRO — la seule ligne comptée appartenant à la Finance. Le
 * carburant affichait ainsi 0,00 DA de caisse pendant que la Caisse Générale en
 * montrait 1,9 million.
 *
 * Aucun calcul n'est réinventé ici : la caisse de chaque activité vient de ses
 * propres mouvements (`PartReport.caisseMovements`, la liste même qu'affiche la
 * Caisse Générale), les comptes bancaires et le tiroir de la Finance de
 * `treasuryReporting`, les dettes des `PartReport` et le stock de
 * `stockValuation` — les mêmes chiffres que les écrans Caisse Générale, Comptes
 * Bancaires, Clients, Fournisseurs et Valeur du stock.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { PartReport } from './bizReporting';
import { TreasuryReport, TreasuryAccount, BANK_OPENING_PART, TREASURY_PART_LABEL } from './treasuryReporting';
import { StockValuation } from './stockValuation';
import { within } from './period';

/**
 * Ce que la PÉRIODE lue a fait bouger dans une caisse ou sur un compte :
 *
 *     hors période + entrées − sorties = solde
 *
 * `outside` n'est pas un « solde d'ouverture » mais tout ce qui ne tombe pas
 * dans la fenêtre — avant ELLE COMME APRÈS. C'est ce qui rend l'égalité VRAIE
 * quoi qu'on choisisse comme dates : un versement postérieur à la période
 * comptait dans le solde sans compter dans les flux, et l'écart passait pour
 * une erreur de calcul.
 */
export interface WCFlow {
  outside: number;
  in: number;
  out: number;
  /** Nombre de mouvements tombant dans la période. */
  count: number;
}

/** Une ligne détaillée d'un bloc (un compte, un client, un fournisseur…). */
export interface WCRow {
  id: string;
  label: string;
  sub?: string;
  date?: string;
  amount: number;
  /** Partie d'origine, pour le regroupement et le filtrage à l'écran. */
  partKey?: string;
  partLabel?: string;
  emoji?: string;
  /**
   * Ce que la période a fait bouger sur CETTE ligne — porté par la ligne, et
   * non par le bloc, pour qu'un filtre par activité ne puisse plus afficher les
   * flux des lignes qu'il vient d'exclure.
   */
  flow?: WCFlow;
  /**
   * Ligne montrée mais NON additionnée. Plus aucune ligne de trésorerie ne
   * l'est — les caisses des activités sont comptées, comme sur l'écran Caisse
   * Générale. Le drapeau reste pour les blocs qui voudraient éclairer un total
   * sans y entrer.
   */
  informational?: boolean;
}

/** Un sous-ensemble homogène : « Comptes bancaires », « Dettes clients »… */
export interface WCBlock {
  key: string;
  label: string;
  hint: string;
  total: number;
  rows: WCRow[];
  /** Sens dans le calcul : +1 ajoute au fonds de roulement, −1 le retranche. */
  sign: 1 | -1;
  /** Précision affichée sous le détail du bloc. */
  note?: string;
  /**
   * Ce que la PÉRIODE choisie a fait bouger dans ce bloc — la somme des flux de
   * ses lignes RETENUES, pour que « hors période + entrées − sorties = total »
   * se vérifie à l'œil, filtre appliqué ou non.
   */
  flow?: WCFlow;
}

/** Résumé d'une activité — la ligne du tableau « Détail par activité ». */
export interface WCPart {
  key: string;
  label: string;
  emoji: string;
  /** Le tiroir de l'activité, lu sur ses mouvements — COMPTÉ dans le total. */
  cash: number;
  /**
   * SA part des comptes bancaires : ce qu'elle y a versé moins ce qu'elle en a
   * réglé. Les comptes sont COMMUNS — aucun n'appartient à une activité — mais
   * chaque ligne du grand livre dit de qui est le mouvement, et c'est elle qui
   * répartit les soldes. La somme de cette colonne est exactement le total en
   * banque de la station : aucun dinar inventé, aucun perdu.
   */
  bank: number;
  receivables: number;
  payables: number;
  /** Marchandise / carburant de l'activité, au prix d'achat. */
  stockValue: number;
  /** caisse + banque + créances − dettes (sans le stock) — le net financier. */
  net: number;
  /** caisse + banque + créances + stock − dettes — TOTAL réel de l'activité. */
  total: number;
}

export interface WorkingCapitalReport {
  from: string;
  to: string;

  /** Les cinq tiroirs : Carburant, Restaurant, Cafétéria, Lavage et Finance. */
  cash: WCBlock;
  /** Comptes bancaires, un par ligne. */
  banks: WCBlock;
  /** Encours clients (toutes dates) — de l'argent qui n'est pas encore rentré. */
  receivables: WCBlock;
  /** Carburant en cuve + marchandise en stock, au prix d'achat. */
  stock: WCBlock;
  /** Encours fournisseurs (toutes dates) — de l'argent déjà dépensé. */
  payables: WCBlock;

  /** Toutes les caisses de la station — les trois activités ET la Finance. */
  cashTotal: number;
  /** Les seules caisses des activités (Carburant + Cafétéria + Lavage). */
  activitiesCash: number;
  /** Le tiroir commun, part qui n'appartient à aucune activité. */
  financeCash: number;
  /**
   * Ce que contient PHYSIQUEMENT le tiroir commun au grand livre — l'argent
   * déposé par les activités y dort aussi. Montré pour expliquer l'écart, jamais
   * additionné : leurs caisses le portent déjà.
   */
  drawerCash: number;
  /** La part des comptes bancaires retenue par le filtre en cours. */
  bankTotal: number;
  /**
   * L'ARGENT RÉELLEMENT EN BANQUE, tous comptes confondus — jamais filtré.
   *
   * `bankTotal` est une PART : filtré sur une activité, il ne dit plus combien
   * la station possède en banque, et l'écran n'affichait alors nulle part ce
   * chiffre-là. Les deux sont montrés côte à côte : le total de tous les
   * comptes, et ce que l'activité regardée y détient. Seule la part entre dans
   * son fonds de roulement — additionner le total sur chaque activité
   * compterait le même argent quatre fois.
   */
  stationBankTotal: number;
  /** Trésorerie immédiate : caisses + banques. */
  treasuryTotal: number;
  receivablesTotal: number;
  payablesTotal: number;
  /** Marchandise en stock, au prix d'achat — COMPTÉE dans le fonds de roulement. */
  stockValue: number;
  /** Carburant en cuve seul (sous-ensemble de `stockValue`). */
  fuelStockValue: number;
  /** Marchandise des catalogues / comptoirs (sous-ensemble de `stockValue`). */
  goodsStockValue: number;
  /** Trésorerie + créances + stock − dettes. */
  workingCapital: number;
  /** Trésorerie + créances − dettes : le fonds de roulement HORS stock. */
  financialWorkingCapital: number;
  /** Créances − dettes : ce que le crédit accordé coûte (ou rapporte). */
  netCredit: number;

  /** Détail des comptes bancaires (mouvements de la période inclus). */
  accounts: TreasuryAccount[];
  /** Résumé par activité : trésorerie, créances, dettes, stock, net, total. */
  parts: WCPart[];
  /** Ratio de liquidité : (trésorerie + créances) ÷ dettes. */
  liquidityRatio: number | null;
  /** Couverture des dettes par TOUT l'actif circulant, stock compris. */
  coverageRatio: number | null;
}

/** Seules les lignes retenues comptent — les lignes informatives sont hors total. */
const sum = (rows: WCRow[]) => rows.reduce((s, r) => (r.informational ? s : s + r.amount), 0);

/**
 * Les flux d'une liste de mouvements, relus SUR ELLE. Le solde est donné, il ne
 * se discute pas : ce qui ne tombe pas dans la période en forme le reste, si
 * bien que « hors période + entrées − sorties » retombe toujours dessus.
 */
const flowOf = (
  lines: { date: string; amount: number }[], balance: number, from: string, to: string,
): WCFlow => {
  const period = lines.filter(l => within(l.date, from, to));
  const inflow = period.reduce((s, l) => (l.amount > 0 ? s + l.amount : s), 0);
  const outflow = period.reduce((s, l) => (l.amount < 0 ? s - l.amount : s), 0);
  return { outside: balance - (inflow - outflow), in: inflow, out: outflow, count: period.length };
};

/**
 * Les flux d'un bloc : ceux de ses lignes RETENUES, additionnés. Le bloc ne
 * porte donc jamais un mouvement qu'il n'affiche pas — c'est ce qui faisait
 * annoncer « +11 033 830 encaissés » à une carte filtrée sur le Carburant dont
 * le solde affiché était zéro.
 */
const flowSum = (rows: WCRow[]): WCFlow | undefined => {
  const counted = rows.filter(r => !r.informational && r.flow);
  if (!counted.length) return undefined;
  return counted.reduce<WCFlow>((a, r) => ({
    outside: a.outside + (r.flow as WCFlow).outside,
    in: a.in + (r.flow as WCFlow).in,
    out: a.out + (r.flow as WCFlow).out,
    count: a.count + (r.flow as WCFlow).count,
  }), { outside: 0, in: 0, out: 0, count: 0 });
};

const block = (
  key: string, label: string, hint: string, rows: WCRow[], sign: 1 | -1,
  note?: string,
): WCBlock => ({ key, label, hint, rows, total: sum(rows), sign, note, flow: flowSum(rows) });

/**
 * Assemble le fonds de roulement à partir des rapports déjà calculés — jamais à
 * partir des données brutes, pour qu'il ne puisse jamais diverger d'eux.
 */
export function computeWorkingCapital(
  treasury: TreasuryReport,
  parts: PartReport[],
  stock?: StockValuation,
): WorkingCapitalReport {
  const partMeta = new Map(parts.map(p => [p.key, { label: p.label, emoji: p.emoji }]));
  const metaOf = (key: string) => partMeta.get(key) || { label: key, emoji: '•' };

  // ── Caisses ───────────────────────────────────────────────────────────────
  // Une ligne par TIROIR, et chacune compte. Ce sont exactement les quatre
  // cartes de l'écran Caisse Générale, tirées des mêmes listes de mouvements :
  // les trois activités sur leurs propres documents (`caisseMovements`), la
  // Finance sur les lignes du grand livre qui ne portent aucune activité.
  //
  // Ce que ce bloc portait avant : le seul solde du TIROIR COMMUN au grand
  // livre. Deux dégâts, tous les deux visibles à l'écran. D'abord ce solde
  // n'est pas ce que la station détient — les règlements en espèces passés par
  // un document (achat, salaire) n'écrivent pas tous leur ligne au grand livre,
  // et le tiroir commun reste donc gonflé de sorties qu'il ignore. Ensuite,
  // cette unique ligne appartenant à la Finance, filtrer sur une activité ne
  // gardait plus rien : le Carburant annonçait 0,00 DA de trésorerie pendant
  // que la Caisse Générale lui comptait 1,9 million en tiroir.
  const cashRows: WCRow[] = parts.map(p => {
    const f = flowOf(p.caisseMovements || [], p.caisseBalance, treasury.from, treasury.to);
    return {
      id: `caisse-${p.key}`,
      label: `Caisse ${p.label}`,
      // Le solde seul ne disait pas d'où il venait ni ce que la période avait
      // changé. On déroule le calcul : hors période + entrées − sorties = solde.
      sub: `Hors période ${fmt(f.outside)} · +${fmt(f.in)} encaissés · −${fmt(f.out)} décaissés `
        + `· ${f.count} mouvement(s) sur la période`,
      amount: p.caisseBalance,
      partKey: p.key,
      partLabel: p.label,
      emoji: p.emoji || metaOf(p.key).emoji,
      flow: f,
    };
  });

  // La Finance ne tient aucun document : sa caisse, c'est la part du tiroir
  // commun qui n'appartient à aucune activité — les lignes du grand livre sans
  // partie. Le tiroir ENTIER contient en plus l'argent que les activités y ont
  // déposé, déjà compté dans leur caisse à elles : le reprendre ici compterait
  // deux fois les mêmes billets (c'est la règle de l'écran Caisse Générale).
  const caisseLines = [
    ...(treasury.caisseDetail?.openingLines || []),
    ...(treasury.caisseDetail?.lines || []),
    ...(treasury.caisseDetail?.afterLines || []),
  ];
  const financeLines = caisseLines.filter(l => (l.part || 'systeme') === 'systeme');
  const financeCash = financeLines.reduce((s, l) => s + l.amount, 0);
  const financeFlow = flowOf(financeLines, financeCash, treasury.from, treasury.to);
  cashRows.push({
    id: 'caisse-finance',
    label: 'Caisse Finance',
    sub: `Hors période ${fmt(financeFlow.outside)} · +${fmt(financeFlow.in)} encaissés `
      + `· −${fmt(financeFlow.out)} décaissés · ${financeFlow.count} mouvement(s) sur la période`,
    amount: financeCash,
    partKey: 'systeme',
    partLabel: 'Finance',
    emoji: '🏦',
    flow: financeFlow,
  });

  const activitiesCash = parts.reduce((s, p) => s + p.caisseBalance, 0);
  const drawerCash = treasury.caisseBalance;

  // ── Comptes bancaires ─────────────────────────────────────────────────────
  // Une ligne par COMPTE ET PAR ACTIVITÉ. Un compte est commun, comme le
  // tiroir : le rattacher en bloc à la Finance faisait afficher 0,00 DA de
  // banque à une activité qui y avait pourtant versé ses recettes et réglé ses
  // fournisseurs. C'est la ligne du grand livre qui dit à qui est le mouvement
  // (`tx.part`), et la somme des parts rend exactement le solde du compte —
  // le solde d'ouverture allant à l'activité des comptes (`BANK_OPENING_PART`).
  const bankRows: WCRow[] = treasury.accounts.flatMap(a => a.parts
    .filter(p => p.balance !== 0 || p.credit !== 0 || p.debit !== 0)
    .map(p => {
      // Le solde fait foi ; ce qui n'est pas dans la période en forme le reste —
      // y compris un mouvement POSTÉRIEUR, que le seul « solde de début de
      // période » ne savait pas expliquer.
      const f: WCFlow = {
        outside: p.balance - (p.credit - p.debit),
        in: p.credit, out: p.debit, count: p.count,
      };
      return {
        id: `bank-${a.id}-${p.key}`,
        label: a.name,
        sub: [
          a.accountNumber ? `N° ${a.accountNumber}` : null,
          p.key === BANK_OPENING_PART
            ? `Part ${p.label} : ce qu'elle y a versé moins ce qu'elle en a réglé, `
              + `solde d'ouverture du compte (${fmt(a.initialBalance)}) compris`
            : `Part ${p.label} : ce qu'elle y a versé, moins ce qu'elle en a réglé`,
          p.credit || p.debit
            ? `+${fmt(p.credit)} / −${fmt(p.debit)} sur la période`
            : 'aucun mouvement sur la période',
          `Solde du compte ${fmt(a.balance)} · ${a.movesCount} mouvement(s) au total`,
        ].filter(Boolean).join(' · '),
        amount: p.balance,
        partKey: p.key,
        partLabel: p.key === 'systeme' ? 'Finance' : p.label,
        emoji: '🏛️',
        flow: f,
      };
    }));

  // ── Créances clients — chaque facture impayée, partie par partie ──────────
  const receivableRows: WCRow[] = parts.flatMap(p => p.clientDebts.map(d => ({
    id: `rec-${p.key}-${d.id}`,
    label: d.name,
    // Une ligne AVANCE est une créance NÉGATIVE : l'argent du client, que la
    // station détient déjà. Décrite comme une facture, elle se lisait « Total
    // −20 000 · payé 0 » — un charabia sur ce qui est pourtant la seule ligne
    // du tableau qui joue dans l'autre sens.
    sub: d.ref === 'AVANCE'
      ? `Avance détenue ${fmt(-d.total)} — imputée sur ce qu'il doit`
      : [d.ref && d.ref !== '—' ? `Facture ${d.ref}` : null,
        d.total ? `Total ${fmt(d.total)} · payé ${fmt(d.paid)}` : null].filter(Boolean).join(' · ') || undefined,
    date: d.date || undefined,
    amount: d.rest,
    partKey: p.key,
    partLabel: p.label,
    emoji: p.emoji,
  }))).sort((a, b) => b.amount - a.amount);

  // ── Dettes fournisseurs ───────────────────────────────────────────────────
  const payableRows: WCRow[] = parts.flatMap(p => p.supplierDebts.map(d => ({
    id: `pay-${p.key}-${d.id}`,
    label: d.name,
    sub: [d.ref && d.ref !== '—' ? `Facture ${d.ref}` : null,
      d.total ? `Total ${fmt(d.total)} · payé ${fmt(d.paid)}` : null].filter(Boolean).join(' · ') || undefined,
    date: d.date || undefined,
    amount: d.rest,
    partKey: p.key,
    partLabel: p.label,
    emoji: p.emoji,
  }))).sort((a, b) => b.amount - a.amount);

  // ── Stock — carburant en cuve ET marchandise, au PRIX D'ACHAT ─────────────
  // Une ligne par cuve et par référence : le gérant retrouve exactement ce qui
  // compose la valeur, et d'où elle vient. Les lignes à valeur nulle (référence
  // à zéro) ne sont pas listées, elles n'apportent rien.
  const stockRows: WCRow[] = (stock?.parts || []).flatMap(p =>
    p.sections.flatMap(sec => sec.lines
      .filter(l => l.buyValue !== 0)
      .map(l => ({
        id: `stk-${p.key}-${sec.key}-${l.id}`,
        label: l.name,
        sub: [
          sec.label,
          `${l.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${l.unit || ''}`.trim()
            + ` × ${fmt(l.buyPrice)} (prix d'achat)`,
          l.negative ? 'stock à découvert' : l.low ? 'sous le seuil d\'alerte' : null,
        ].filter(Boolean).join(' · '),
        amount: l.buyValue,
        partKey: p.key,
        partLabel: p.label,
        emoji: p.emoji,
      })),
    ),
  ).sort((a, b) => b.amount - a.amount);

  const cash = block('cash', 'Caisses (espèces)',
    'Les quatre tiroirs de la station — les mêmes soldes que l\'écran Caisse Générale', cashRows, 1,
    `${fmt(activitiesCash)} dans les caisses des activités (Carburant, Restaurant, Cafétéria, Magasin) `
    + `et ${fmt(financeCash)} dans celle de la Finance, soit ${fmt(activitiesCash + financeCash)} d'espèces. `
    + 'Chaque tiroir est lu sur SES mouvements : ceux de l\'activité pour les trois premiers, les lignes du grand '
    + 'livre sans activité pour la Finance. '
    + `Le tiroir commun, lui, contient ${fmt(drawerCash)} au grand livre : l'argent que les activités y ont déposé y `
    + 'dort aussi, et leurs caisses le portent déjà — le rajouter ici compterait deux fois les mêmes billets.');
  const banks = block('banks', 'Comptes bancaires', 'Le solde de chaque compte, activité par activité', bankRows, 1,
    `Sur la période : ${fmt(treasury.bankOpening)} au départ, +${fmt(treasury.bankIn)} reçus, `
    + `−${fmt(treasury.bankOut)} sortis, soit ${fmt(treasury.bankTotal)} aujourd'hui sur ${treasury.accounts.length} compte(s). `
    + 'Un compte est COMMUN : c\'est la ligne du grand livre qui dit de quelle activité est le mouvement, et c\'est '
    + 'elle qui répartit le solde. La part d\'une activité, c\'est ce qu\'elle a versé sur le compte moins ce qu\'elle '
    + `en a réglé — elle est donc négative quand la station a payé ses achats pour elle. Le solde d'ouverture des `
    + `comptes n'a aucune ligne derrière lui : il revient au ${TREASURY_PART_LABEL[BANK_OPENING_PART]}, dont ces `
    + 'comptes sont ceux. La somme des parts fait exactement le total en banque.');
  const receivables = block('receivables', 'Créances clients', 'Ventes à crédit non encore encaissées', receivableRows, 1);
  const stockBlock = block('stock', 'Stock (carburant & marchandise)',
    'Litres en cuve et marchandise du catalogue, au prix d\'achat', stockRows, 1,
    'Compté au PRIX D\'ACHAT, jamais au prix de vente : la marge n\'existe qu\'une fois la marchandise vendue. '
    + 'Cette valeur entre bien dans le fonds de roulement — c\'est de l\'argent déjà dépensé qui appartient à la station.');
  const payables = block('payables', 'Dettes fournisseurs', 'Achats reçus et non encore réglés', payableRows, -1);

  const cashTotal = cash.total;
  const bankTotal = banks.total;
  const treasuryTotal = cashTotal + bankTotal;
  const stockValue = stock ? stock.buyValue : parts.reduce((s, p) => s + p.stockValue, 0);
  const fuelStockValue = (stock?.parts || [])
    .filter(p => p.key === 'carburant')
    .reduce((s, p) => s + p.buyValue, 0);
  const goodsStockValue = stockValue - fuelStockValue;

  const financialWorkingCapital = treasuryTotal + receivables.total - payables.total;
  const workingCapital = financialWorkingCapital + stockValue;

  const stockByPart = new Map((stock?.parts || []).map(p => [p.key, p.buyValue]));

  /** Ce que chaque activité détient en banque, tous comptes confondus. */
  const bankByPart = new Map<string, number>();
  for (const a of treasury.accounts) {
    for (const p of a.parts) bankByPart.set(p.key, (bankByPart.get(p.key) || 0) + p.balance);
  }

  // Le tableau par activité lit la MÊME caisse que le bloc de trésorerie —
  // celle des mouvements de l'activité. Il passait par `treasury.partBalances`,
  // un second chemin vers le même chiffre : deux chemins, deux occasions de
  // diverger, et un total qui ne recomposait plus les cartes du haut.
  const partRows: WCPart[] = parts.map(p => {
    const partCash = p.caisseBalance;
    const partBank = bankByPart.get(p.key) || 0;
    const rec = p.clientDebtTotal;
    const pay = p.supplierDebtTotal;
    const stk = stockByPart.get(p.key) ?? p.stockValue;
    return {
      key: p.key, label: p.label, emoji: p.emoji,
      cash: partCash,
      bank: partBank,
      receivables: rec,
      payables: pay,
      stockValue: stk,
      net: partCash + partBank + rec - pay,
      total: partCash + partBank + rec + stk - pay,
    };
  });

  // La Finance est une ligne du tableau comme les autres — avec sa part du
  // tiroir et sa part des comptes. Sans elle, le TOTAL du tableau ne rendait
  // pas le fonds de roulement affiché en haut, et rien ne disait où passait
  // l'écart.
  const financeBank = bankByPart.get('systeme') || 0;
  partRows.push({
    key: 'systeme', label: 'Finance', emoji: '🏦',
    cash: financeCash,
    bank: financeBank,
    receivables: 0, payables: 0, stockValue: 0,
    net: financeCash + financeBank,
    total: financeCash + financeBank,
  });

  return {
    from: treasury.from, to: treasury.to,
    cash, banks, receivables, stock: stockBlock, payables,
    cashTotal, activitiesCash, financeCash, drawerCash, bankTotal,
    stationBankTotal: bankTotal,
    treasuryTotal,
    receivablesTotal: receivables.total,
    payablesTotal: payables.total,
    stockValue, fuelStockValue, goodsStockValue,
    workingCapital,
    financialWorkingCapital,
    netCredit: receivables.total - payables.total,
    accounts: treasury.accounts,
    parts: partRows,
    liquidityRatio: payables.total > 0 ? (treasuryTotal + receivables.total) / payables.total : null,
    coverageRatio: payables.total > 0 ? (treasuryTotal + receivables.total + stockValue) / payables.total : null,
  };
}

/**
 * Restreint un rapport à UNE activité — c'est le filtre « par partie » de
 * l'écran. Chaque bloc ne garde que ses lignes, et tous les totaux sont
 * recalculés depuis ces lignes : rien n'est réécrit à la main, donc le filtre ne
 * peut pas afficher un total qui ne correspond pas à ce qu'il montre.
 *
 * `partKey` vaut `'all'` (aucun filtre) ou la clé d'une activité. La caisse
 * d'une activité la suit — c'est SA trésorerie, et l'écran serait faux sans
 * elle. Les comptes bancaires et le tiroir de la Finance, eux, n'appartiennent
 * à aucune activité : ils portent la clé `systeme` et ne restent que sur
 * « Toutes les activités » et sur « Finance ».
 */
export function filterWorkingCapital(
  report: WorkingCapitalReport,
  partKey: string,
): WorkingCapitalReport {
  if (!partKey || partKey === 'all') return report;

  const keep = (rows: WCRow[]) => rows.filter(r => (r.partKey || 'systeme') === partKey);
  const rebuild = (b: WCBlock): WCBlock => {
    const rows = keep(b.rows);
    // Les flux du bloc sont ceux de ses lignes retenues, recalculés : un bloc
    // filtré ne peut plus afficher les mouvements des lignes qu'il a exclues.
    return { ...b, rows, total: sum(rows), flow: flowSum(rows) };
  };

  // La note d'un bloc décrit ce qu'il contient : filtré, il ne contient plus la
  // même chose. Celle des caisses annonçait le détail de TOUTE la station sous
  // le solde d'une seule activité.
  const cash = { ...rebuild(report.cash), note: partKey === 'systeme'
    ? `Le tiroir de la Finance : la part du tiroir commun qui n'appartient à aucune activité. Le tiroir commun `
      + `contient ${fmt(report.drawerCash)} au grand livre — l'argent que les activités y ont déposé y dort aussi, `
      + 'et il est déjà compté dans leur caisse à elles.'
    : 'La caisse de cette activité, lue sur SES mouvements — la même liste, et le même solde, que l\'écran Caisse '
      + 'Générale. Le tiroir de la Finance et les comptes bancaires n\'appartiennent à aucune activité : ils ne '
      + 'figurent que sur « Toutes les activités » et sur « Finance ».' };
  // Le bloc filtré ne porte plus le total en banque mais une PART : la carte et
  // la fenêtre de détail doivent le dire, sinon le chiffre passe pour l'argent
  // de la station.
  const rebuiltBanks = rebuild(report.banks);
  // « — sa part » n'a de sens que si une part manque. Quand toute la banque
  // revient à l'activité regardée, la carte annonçait une part sous un montant
  // qui était en fait le total : deux mots pour un seul chiffre.
  const wholeBank = Math.abs(rebuiltBanks.total - report.stationBankTotal) < 0.005;
  const banks = { ...rebuiltBanks, label: wholeBank ? 'Comptes bancaires' : 'Comptes bancaires — sa part', note: (partKey === 'systeme'
    ? 'La Finance ne provoque aucun mouvement bancaire : sa part est vide, et c\'est normal. Le solde d\'ouverture '
      + `des comptes, qui y dormait sans que personne puisse le voir, revient désormais au `
      + `${TREASURY_PART_LABEL[BANK_OPENING_PART]}.`
    : partKey === BANK_OPENING_PART
      ? 'La part des comptes qui revient à cette activité : ce qu\'elle y a versé moins ce qu\'elle en a réglé, ET le '
        + 'solde d\'ouverture des comptes — ce sont les siens, et il n\'a aucune ligne de grand livre derrière lui.'
      : 'La part des comptes qui revient à cette activité : ce qu\'elle y a versé, moins ce qu\'elle en a réglé. Elle '
        + 'est négative quand la station a payé ses achats depuis la banque sans qu\'elle y ait versé autant.')
    + ` La station possède en tout ${fmt(report.stationBankTotal)} en banque, sur ${report.accounts.length} compte(s) : `
    + 'chaque compte est déroulé plus bas avec son solde ENTIER, et la part de cette activité indiquée dessous. Seule '
    + 'cette part entre dans le fonds de roulement de l\'activité — compter le total sur chacune reviendrait à compter '
    + 'le même argent quatre fois.' };
  const receivables = rebuild(report.receivables);
  const stockBlock = rebuild(report.stock);
  const payables = rebuild(report.payables);

  const cashTotal = cash.total;
  const bankTotal = banks.total;
  const treasuryTotal = cashTotal + bankTotal;
  const stockValue = stockBlock.total;
  const financialWorkingCapital = treasuryTotal + receivables.total - payables.total;
  // Les comptes restent déroulés, filtre ou non : leur solde ENTIER est le seul
  // endroit où se lit l'argent que la station possède vraiment en banque. Il
  // était retiré de l'écran filtré de peur qu'on le confonde avec la part de
  // l'activité — mais l'écran n'affichait alors plus du tout ce chiffre, et le
  // gérant devait revenir sur « Toutes les activités » pour le retrouver. Les
  // deux sont désormais montrés ensemble et nommés : le solde du compte, et
  // « dont <activité> ». Seule la part est additionnée dans les totaux.
  const accounts: TreasuryAccount[] = report.accounts;
  const parts = report.parts.filter(p => p.key === partKey);

  return {
    ...report,
    cash, banks, receivables, stock: stockBlock, payables,
    cashTotal, bankTotal, treasuryTotal,
    activitiesCash: partKey === 'systeme' ? 0 : cashTotal,
    financeCash: partKey === 'systeme' ? cashTotal : 0,
    receivablesTotal: receivables.total,
    payablesTotal: payables.total,
    stockValue,
    fuelStockValue: partKey === 'carburant' ? stockValue : 0,
    goodsStockValue: partKey === 'carburant' ? 0 : stockValue,
    workingCapital: financialWorkingCapital + stockValue,
    financialWorkingCapital,
    netCredit: receivables.total - payables.total,
    accounts,
    parts,
    liquidityRatio: payables.total > 0 ? (treasuryTotal + receivables.total) / payables.total : null,
    coverageRatio: payables.total > 0 ? (treasuryTotal + receivables.total + stockValue) / payables.total : null,
  };
}

/** Montant court, sans décimales — uniquement pour les sous-titres. */
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} DA`;
}
