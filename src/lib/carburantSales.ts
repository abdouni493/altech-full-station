/**
 * ─── L'activité Carburant, lue là où elle est RÉELLEMENT enregistrée ───────────
 *
 * La table `fuel_sales` n'est plus écrite par aucun écran de l'application :
 * plus rien ne l'alimente depuis que la vente de carburant passe par les
 * BRIGADES. Tout ce qui la lisait — le rapport Carburant, les analyses, la
 * synthèse financière — annonçait donc zéro litre et zéro dinar de carburant,
 * pendant que les achats de carburant, eux, comptaient pour leur montant entier.
 *
 * C'est exactement de là que venait le « Solde caisse −973 867,40 DA » : des
 * sorties (achats, dépenses) sans jamais les recettes qui les couvrent.
 *
 * Une vente de carburant, dans cette station, c'est une brigade :
 *
 *   • les PISTOLETS disent les litres et le chiffre d'affaires théorique —
 *     chaque pistolet au prix du carburant de SA cuve ;
 *   • la comptabilité de la brigade dit ce qui est réellement rentré :
 *       – espèces remises par les pompistes (`cashReceived`) → la caisse,
 *       – justifications TAG / TPE                            → la banque,
 *       – bons clients                                        → une créance,
 *       – reste inexpliqué (`rest`)                            → un manquant.
 *
 * Tout écran qui parle de carburant part d'ici, pour qu'aucun ne puisse annoncer
 * un chiffre que les brigades ne portent pas.
 *
 * ── La caisse de l'activité ───────────────────────────────────────────────────
 * `computeCarburantCash` donne la position de caisse du carburant, et c'est la
 * SEULE définition : la Caisse Générale, le rapport de trésorerie et le rapport
 * Carburant l'appellent tous les trois. Elle ne retient que l'argent qui a
 * vraiment bougé en ESPÈCES — un achat réglé par chèque n'a jamais vidé le
 * tiroir, et le soustraire de la caisse (ce que faisait l'ancien calcul) creusait
 * un découvert qui n'existait pas.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { expensePartOf, isBrigadeExpense, isCashAccount, nozzleTankId, partCashLedgerLines } from '../store/AppContext';
import { within } from './period';

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Un règlement sans compte désigné est un règlement en espèces (cas historique). */
const paidInCash = (accountId?: string): boolean => !accountId || isCashAccount(accountId);

// ─── Ventes ──────────────────────────────────────────────────────────────────
/** Ce qu'un carburant a vendu, coûté et rapporté sur la période. */
export interface FuelTypeSales {
  type: string;
  liters: number;
  /** Prix de vente moyen au litre, tel que les brigades l'ont facturé. */
  price: number;
  revenue: number;
  /** Prix d'achat du litre (réglages de la station). */
  buyPrice: number;
  cost: number;
  gain: number;
}

/** Ce qu'une POMPE a débité sur une brigade — les relevés de ses pistolets. */
export interface FuelPumpSales {
  pumpId: string;
  pumpName: string;
  liters: number;
  revenue: number;
  /** Nombre de pistolets relevés sur cette pompe. */
  nozzles: number;
}

/** Un pompiste sur une brigade — son théorique et ce qu'il a rendu. */
export interface FuelPompisteLine {
  id: string;
  name: string;
  liters: number;
  theoretical: number;
  cash: number;
  justified: number;
  /** théorique − espèces − justifié : ce qui manque encore. */
  ecart: number;
}

/** Une brigade = une « vente » de l'activité Carburant. */
export interface FuelBrigadeSale {
  id: string;
  ref: string;
  date: string;
  shift: string;
  chefName: string;
  status: string;
  closed: boolean;
  liters: number;
  /** Chiffre d'affaires de la brigade — retours-cuve déjà déduits. */
  revenue: number;
  cost: number;
  /** Espèces réellement remises — elles alimentent la caisse. */
  cash: number;
  /** TAG / TPE — encaissé sur un compte bancaire. */
  tpe: number;
  /** Bons clients — du chiffre d'affaires qui devient une créance. */
  credit: number;
  /** Dépenses de brigade — des espèces sorties pour une charge, justifiées. */
  expense: number;
  /** Manquant non justifié à la clôture. */
  rest: number;
  /**
   * Ventes de produits depuis les ARMOIRES (bouteilles de gaz, lubrifiants…)
   * pendant la brigade. Elles s'ajoutent à ce que les pompistes doivent rendre,
   * mais ne sont PAS du carburant : elles restent hors de `revenue` / `liters`.
   */
  productSales: number;
  /** Coût de revient de ces ventes (prix d'achat / de remplissage figé). */
  productCost: number;
  /** Achats de produits réglés sur la caisse de la brigade et rangés en armoire. */
  productPurchases: number;
  /** Détail des produits vendus depuis les armoires. */
  productLines: { name: string; qty: number; price: number; total: number; cost: number; consigne?: boolean }[];
  pompistes: FuelPompisteLine[];
  byFuel: FuelTypeSales[];
  byPump: FuelPumpSales[];
}

export interface CarburantSales {
  from: string;
  to: string;
  brigades: FuelBrigadeSale[];
  byFuel: FuelTypeSales[];
  liters: number;
  revenue: number;
  cost: number;
  gain: number;
  cash: number;
  tpe: number;
  credit: number;
  /** Dépenses de brigade justifiées sur la période. */
  expense: number;
  rest: number;
  /** Ventes de produits depuis les armoires (hors carburant). */
  productSales: number;
  productCost: number;
  /** Achats de produits réglés sur les caisses des brigades. */
  productPurchases: number;
  /** Ce qui est réellement rentré : espèces + TPE. Le crédit ne l'est pas encore. */
  collected: number;
  counts: { brigades: number; closed: number };
}

/** Additionne des lignes par carburant en gardant un prix moyen cohérent. */
const mergeFuelLines = (lines: FuelTypeSales[]): FuelTypeSales[] => {
  const byType = new Map<string, FuelTypeSales>();
  for (const l of lines) {
    const e = byType.get(l.type)
      || { type: l.type, liters: 0, price: 0, revenue: 0, buyPrice: l.buyPrice, cost: 0, gain: 0 };
    e.liters += l.liters;
    e.revenue += l.revenue;
    e.cost += l.cost;
    if (!e.buyPrice && l.buyPrice) e.buyPrice = l.buyPrice;
    byType.set(l.type, e);
  }
  return [...byType.values()]
    .map(e => ({ ...e, price: e.liters > 0 ? e.revenue / e.liters : 0, gain: e.revenue - e.cost }))
    .sort((a, b) => b.revenue - a.revenue);
};

/**
 * Les brigades de la période, converties en ventes de carburant.
 *
 * Le chiffre d'affaires retenu est celui que la comptabilité de la brigade a
 * FIGÉ (`totalDue`) : il tient compte des retours-cuve déduits à la clôture, ce
 * que la simple lecture des index de pistolets ne sait pas faire. La répartition
 * par carburant, elle, vient des pistolets — puis elle est ramenée au prorata sur
 * ce chiffre d'affaires, pour que le détail par carburant additionne EXACTEMENT
 * le total affiché. Sans ce calage, le tableau « ventes par produit » et la carte
 * « chiffre d'affaires » auraient annoncé deux montants différents.
 */
export function computeCarburantSales(app: any, from: string, to: string): CarburantSales {
  const brigades: any[] = app?.brigades || [];
  const accountings: any[] = app?.brigadeAccountings || [];
  const chefs: any[] = app?.brigadeChefs || [];
  const pompistes: any[] = app?.pompistes || [];
  const tanks: any[] = app?.tanks || [];
  const nozzles: any[] = app?.pumpNozzles || [];
  const pumps: any[] = app?.pumps || [];
  const sellPrices: Record<string, number> = app?.settings?.fuelPrices || {};
  const buyPrices: Record<string, number> = app?.settings?.fuelBuyPrices || {};

  /** La cuve d'un pistolet — la sienne, pas celle de sa pompe (qui n'en est qu'un miroir). */
  const tankOfNozzle = (n: any) => tanks.find(t => t.id === nozzleTankId(n, pumps));

  const rows: FuelBrigadeSale[] = brigades
    .filter(b => within(b.startDatetime || b.date, from, to))
    .sort((a, b) => new Date(b.startDatetime || b.date).getTime() - new Date(a.startDatetime || a.date).getTime())
    .map(b => {
      const acc = accountings.find(a => a.brigadeId === b.id);

      // ── Répartition par carburant, prise sur les pistolets ──
      // La comptabilité fige un `nozzleSummary` à la clôture : c'est lui qui fait
      // foi. À défaut (brigade encore ouverte), on relit les index de la brigade.
      const summary: any[] = acc?.nozzleSummary?.length
        ? acc.nozzleSummary
        : nozzles
          .filter((n: any) => (b.startNozzleIndices || {})[n.id] !== undefined)
          .map((n: any) => {
            const tank = tankOfNozzle(n);
            const start = num((b.startNozzleIndices || {})[n.id]);
            const end = num((b.endNozzleIndices || {})[n.id] ?? start);
            const liters = Math.max(0, end - start);
            const price = num(sellPrices[tank?.type]);
            const pump = pumps.find((p: any) => p.id === n.pumpId);
            return {
              fuelType: tank?.type, liters, price, revenue: liters * price,
              pumpId: n.pumpId, pumpName: pump?.name || pump?.number,
            };
          });

      const grossLines = mergeFuelLines(summary.map((s: any) => {
        const type = String(s.fuelType || 'CARBURANT');
        const liters = Math.max(0, num(s.liters));
        const price = num(s.price) || num(sellPrices[type]);
        return {
          type, liters, price,
          revenue: num(s.revenue) || liters * price,
          buyPrice: num(buyPrices[type]),
          cost: 0, gain: 0,
        };
      }));
      const grossRevenue = grossLines.reduce((s, l) => s + l.revenue, 0);

      // ── Produits vendus depuis les ARMOIRES pendant la brigade ──
      // Le dû figé de la comptabilité les inclut (le pompiste rend aussi cet
      // argent) : on les retire avant de caler les litres, sinon une bouteille
      // de gaz vendue gonflerait les litres de carburant au prorata.
      const productLines = ((b.armoireSales || []) as any[]).map(x => ({
        name: String(x.productName || 'Produit'),
        qty: num(x.quantity), price: num(x.price), total: num(x.total),
        cost: num(x.quantity) * num(x.unitCost), consigne: !!x.consigne,
      }));
      const productSales = productLines.reduce((s, l) => s + l.total, 0);
      const productCost = productLines.reduce((s, l) => s + l.cost, 0);

      // Le CA qui fait foi : celui de la comptabilité quand elle existe.
      const fuelDue = acc ? num(acc.totalDue) - productSales : 0;
      const revenue = acc && fuelDue > 0 ? fuelDue : grossRevenue;
      // Calage au prorata : le détail par carburant retombe sur le CA affiché.
      const ratio = grossRevenue > 0 ? revenue / grossRevenue : 1;
      const byFuel = grossLines.map(l => {
        const liters = l.liters * ratio;
        const lineRevenue = l.revenue * ratio;
        const cost = liters * l.buyPrice;
        return { ...l, liters, revenue: lineRevenue, cost, gain: lineRevenue - cost };
      });

      const liters = byFuel.reduce((s, l) => s + l.liters, 0);
      const cost = byFuel.reduce((s, l) => s + l.cost, 0);

      // Ce que chaque POMPE a débité — même calage au prorata que par carburant,
      // pour que la somme des pompes rende bien le chiffre d'affaires affiché.
      const pumpMap = new Map<string, FuelPumpSales>();
      summary.forEach((s: any) => {
        const pumpId = String(s.pumpId || '');
        if (!pumpId) return;
        const e = pumpMap.get(pumpId) || {
          pumpId,
          pumpName: s.pumpName || pumps.find((p: any) => p.id === pumpId)?.name || 'Pompe',
          liters: 0, revenue: 0, nozzles: 0,
        };
        e.liters += Math.max(0, num(s.liters)) * ratio;
        e.revenue += (num(s.revenue) || Math.max(0, num(s.liters)) * num(s.price)) * ratio;
        e.nozzles += 1;
        pumpMap.set(pumpId, e);
      });
      const byPump = [...pumpMap.values()].sort((a, b) => b.liters - a.liters);

      // ── Ce qui est rentré, par nature ──
      const justifs: any[] = acc?.justifications || [];
      const isBank = (j: any) => j.justificationType === 'TAG' || j.justificationType === 'TPE';
      const isExpense = (j: any) => j.justificationType === 'EXPENSE';
      // Un ACHAT de produit (rangé en armoire) n'est ni une banque, ni une
      // créance client : de l'argent de la caisse devenu de la marchandise.
      const isProductPurchase = (j: any) => j.justificationType === 'ACHAT_PRODUIT';
      const tpe = justifs.filter(isBank).reduce((s, j) => s + num(j.amount), 0);
      // Une dépense de brigade justifie le reste, mais ce n'est ni de la banque
      // ni une créance client : elle a sa propre part.
      const expense = justifs.filter(isExpense).reduce((s, j) => s + num(j.amount), 0);
      const productPurchases = justifs.filter(isProductPurchase).reduce((s, j) => s + num(j.amount), 0);
      const credit = justifs.filter(j => !isBank(j) && !isExpense(j) && !isProductPurchase(j)).reduce((s, j) => s + num(j.amount), 0);
      const cash = num(acc?.cashReceived);
      // Le manquant enregistré fait foi ; sinon on le recalcule.
      const rest = acc ? num(acc.rest) : revenue + productSales - cash - tpe - credit - expense - productPurchases;

      const summaries: Record<string, any> = acc?.pompisteSummary || b.pompisteData || {};
      const pompisteLines: FuelPompisteLine[] = Object.entries(summaries).map(([id, d]: [string, any]) => {
        const pCash = num(d?.cashReceived ?? d?.totalCollected ?? d?.collected?.cash);
        const pJust = num(d?.justifTotal);
        return {
          id,
          name: pompistes.find(p => p.id === id)?.name || 'Pompiste',
          liters: num(d?.litersSold),
          theoretical: num(d?.theoretical),
          cash: pCash,
          justified: pJust,
          ecart: num(d?.ecart ?? d?.decalage ?? (num(d?.theoretical) - pCash - pJust)),
        };
      });

      const date = b.startDatetime || b.date;
      return {
        id: b.id,
        ref: `${b.shift || 'Brigade'} · ${String(b.id || '').slice(0, 6).toUpperCase()}`,
        date,
        shift: b.shift || '—',
        chefName: chefs.find(c => c.id === b.chefId)?.name || '—',
        status: b.status || (acc?.status === 'completed' ? 'Clôturée' : 'En cours'),
        closed: b.status === 'Clôturée' || acc?.status === 'completed',
        liters, revenue, cost, cash, tpe, credit, expense, rest,
        productSales, productCost, productPurchases, productLines,
        pompistes: pompisteLines,
        byFuel, byPump,
      };
    });

  const sum = (f: (r: FuelBrigadeSale) => number) => rows.reduce((s, r) => s + f(r), 0);
  const revenue = sum(r => r.revenue);
  const cost = sum(r => r.cost);
  const cash = sum(r => r.cash);
  const tpe = sum(r => r.tpe);

  return {
    from, to,
    brigades: rows,
    byFuel: mergeFuelLines(rows.flatMap(r => r.byFuel)),
    liters: sum(r => r.liters),
    revenue, cost, gain: revenue - cost,
    cash, tpe,
    credit: sum(r => r.credit),
    expense: sum(r => r.expense),
    rest: sum(r => r.rest),
    productSales: sum(r => r.productSales),
    productCost: sum(r => r.productCost),
    productPurchases: sum(r => r.productPurchases),
    collected: cash + tpe,
    counts: { brigades: rows.length, closed: rows.filter(r => r.closed).length },
  };
}

// ─── Passerelle pour les écrans historiques ──────────────────────────────────
/**
 * Une vente de carburant à la forme de l'ancienne table `fuel_sales`.
 *
 * Le Tableau de bord, les Rapports et les Statistiques lisent tous
 * `app.fuelSales` : une table que plus rien n'alimente. Plutôt que de réécrire
 * ces trois écrans, on leur sert la même chose — mais reconstruite depuis les
 * brigades : une ligne par brigade ET par carburant, avec ses litres, son prix
 * et son montant. Leurs courbes et leurs totaux redeviennent donc vrais sans que
 * leur code change de forme.
 */
export interface DerivedFuelSale {
  id: string;
  date: string;
  brigadeId: string;
  /** Type de carburant — ces lignes n'ont pas de pompe unique. */
  fuelType: string;
  liters: number;
  pricePerLiter: number;
  total: number;
  paymentMode: string;
  shift?: string;
}

/**
 * Les ventes de carburant de la période, à plat. Sans bornes, c'est tout
 * l'historique — ce que faisait `app.fuelSales` du temps où elle était écrite.
 */
export function derivedFuelSales(app: any, from = '', to = ''): DerivedFuelSale[] {
  return computeCarburantSales(app, from, to).brigades.flatMap(b =>
    b.byFuel
      .filter(f => f.liters > 0 || f.revenue > 0)
      .map(f => ({
        id: `${b.id}-${f.type}`,
        date: b.date,
        brigadeId: b.id,
        fuelType: f.type,
        liters: f.liters,
        pricePerLiter: f.price,
        total: f.revenue,
        // Une brigade encaisse en espèces pour l'essentiel ; le détail exact des
        // modes vit dans sa comptabilité (`FuelBrigadeSale`).
        paymentMode: 'ESPECES',
        shift: b.shift,
      })));
}

/**
 * Volume et recette de CHAQUE POMPE sur la période, indexés par `pump.id`.
 * L'écran Rapports tenait ce compte depuis `fuel_sales.pumpId` : la table étant
 * vide, toutes ses pompes affichaient 0 L. Les relevés de pistolets des brigades
 * disent la même chose, en mieux — ils existent.
 */
export function derivedPumpStats(
  app: any, from = '', to = '',
): Record<string, { liters: number; revenue: number; txCount: number }> {
  const out: Record<string, { liters: number; revenue: number; txCount: number }> = {};
  computeCarburantSales(app, from, to).brigades.forEach(b => b.byPump.forEach(p => {
    const e = out[p.pumpId] || { liters: 0, revenue: 0, txCount: 0 };
    e.liters += p.liters;
    e.revenue += p.revenue;
    // Une « transaction » sur une pompe, c'est une brigade qui l'a relevée.
    e.txCount += 1;
    out[p.pumpId] = e;
  }));
  return out;
}

/**
 * Litres sortis de CHAQUE CUVE sur la période, indexés par `tank.id` — d'après
 * les pistolets qui y sont raccordés. Passer par `pump.tankId`, comme le faisait
 * la fiche journalière, rattachait à la mauvaise cuve tous les pistolets d'une
 * pompe qui en sert plusieurs (`Pump.tankId` n'est qu'un miroir du PREMIER).
 */
export function derivedTankSales(
  app: any, from = '', to = '',
): Record<string, { liters: number; revenue: number }> {
  const out: Record<string, { liters: number; revenue: number }> = {};
  const accountings: any[] = app?.brigadeAccountings || [];
  const brigades: any[] = app?.brigades || [];
  for (const b of brigades) {
    if (!within(b.startDatetime || b.date, from, to)) continue;
    const acc = accountings.find(a => a.brigadeId === b.id);
    for (const n of (acc?.nozzleSummary || [])) {
      const tankId = String(n.tankId || '');
      if (!tankId) continue;
      const e = out[tankId] || { liters: 0, revenue: 0 };
      e.liters += Math.max(0, num(n.liters));
      e.revenue += num(n.revenue) || Math.max(0, num(n.liters)) * num(n.price);
      out[tankId] = e;
    }
  }
  return out;
}

// ─── La caisse de l'activité Carburant ───────────────────────────────────────
/** Une ligne du calcul de la caisse Carburant — de quoi le relire à la ligne. */
export interface CarburantCashLine {
  id: string;
  date: string;
  nature: string;
  label: string;
  /** Signé sur la caisse : > 0 = espèces entrées, < 0 = espèces sorties. */
  amount: number;
  reference?: string;
  /**
   * Le mode de règlement inscrit sur la pièce, quand elle en porte un. Tout ce
   * qui figure ici est par construction encaissé en ESPÈCES : le dire sur la
   * ligne évite au gérant de le déduire, et rend la liste des clients lisible
   * telle quelle.
   */
  mode?: string;
}

export interface CarburantCash {
  balance: number;
  inflow: number;
  outflow: number;
  /** Les termes du calcul, pour que le solde s'explique d'un coup d'œil. */
  brigadeCash: number;
  clientCash: number;
  purchasesCash: number;
  expensesCash: number;
  /** Recharges d'avance déposées en espèces par les clients. */
  rechargeCash: number;
  /** Salaires du personnel carburant réglés en espèces. */
  salariesCash: number;
  /** Acomptes remis en main propre au personnel carburant. */
  acomptesCash: number;
  /** Dépôts saisis dans la Caisse Générale et imputés au Carburant. */
  deposits: number;
  /** Retraits imputés au Carburant. */
  withdrawals: number;
  /** Virements au départ / à l'arrivée des tiroirs du Carburant. */
  transfers: number;
  lines: CarburantCashLine[];
}

/**
 * Le personnel que l'activité Carburant paie : pompistes, chefs de brigade,
 * gérants et employés magasin. C'est le même découpage que le rapport Effectif
 * (`lib/workforceReporting`), où ces quatre familles sont rattachées au
 * Carburant — les deux écrans ne peuvent donc pas se contredire.
 */
const FUEL_STAFF_KEYS = ['pompistes', 'brigadeChefs', 'gerants', 'magasinWorkers'] as const;

/** Un salaire sans mode de règlement est réputé payé en espèces. */
const salaryPaidInCash = (mode?: string): boolean => {
  const m = String(mode || '').trim().toUpperCase();
  return m === '' || m === 'ESPÈCES' || m === 'ESPECES' || m === 'CASH' || m === 'LIQUIDE';
};

/**
 * La position de caisse de l'activité Carburant — la SEULE définition.
 *
 * Ne comptent que les mouvements réellement faits en ESPÈCES : un achat réglé
 * par chèque ou par virement n'a jamais vidé le tiroir. L'ancien calcul
 * retranchait le montant payé de CHAQUE achat, quel qu'en soit le mode, et
 * annonçait donc un découvert que rien dans la caisse ne justifiait.
 *
 * `opts.from` / `opts.to` restreignent le DÉTAIL affiché ; le solde, lui, reste
 * toujours celui de toutes les dates — ce qu'il y a dans le tiroir aujourd'hui
 * ne dépend pas de la fenêtre regardée.
 */
export function computeCarburantCash(app: any): CarburantCash {
  const txs: any[] = app?.treasuryTransactions || [];
  const accountings: any[] = app?.brigadeAccountings || [];
  const brigades: any[] = app?.brigades || [];
  const purchases: any[] = app?.purchases || [];
  const expenses: any[] = app?.expenses || [];
  const clients: any[] = app?.clients || [];
  const suppliers: any[] = app?.suppliers || [];

  const lines: CarburantCashLine[] = [];

  // 1. Encaissements des brigades — les espèces remises par les pompistes.
  for (const a of accountings) {
    const amount = num(a.cashReceived);
    if (!amount) continue;
    const b = brigades.find(x => x.id === a.brigadeId);
    lines.push({
      id: `bri-${a.id}`,
      date: b?.startDatetime || b?.date || '',
      nature: 'Brigade',
      label: `Encaissement brigade ${b?.shift || ''}`.trim(),
      amount,
    });
  }

  // 2. Argent remis par les clients, encaissé en ESPÈCES : règlements de dette
  //    ET recharges d'avance. Un règlement par chèque, virement ou TPE atterrit
  //    en banque : il ne fait pas monter la caisse.
  //
  //    La RECHARGE manquait : le client déposait une avance, la station gardait
  //    les billets, et aucune caisse ne bougeait — le tiroir était plus plein
  //    que tout ce que l'application savait compter.
  for (const c of clients) {
    for (const t of (c.transactionHistory || [])) {
      if (t.type !== 'PAYMENT' && t.type !== 'RECHARGE') continue;
      const mode = String(t.mode || 'ESPECES').toUpperCase();
      if (mode !== 'ESPECES' && mode !== 'CASH') continue;
      const amount = num(t.amount);
      if (!amount) continue;
      const isRecharge = t.type === 'RECHARGE';
      lines.push({
        id: `cli-${t.id}`,
        date: t.date,
        nature: isRecharge ? 'Recharge client' : 'Règlement client',
        label: isRecharge ? `Recharge avance — ${c.name}` : `Règlement dette — ${c.name}`,
        amount,
        reference: t.receiptNumber,
        mode: t.mode || 'ESPECES',
      });
    }
  }

  // 3. Achats carburant réglés en espèces — règlement par règlement.
  for (const p of purchases) {
    const supplier = suppliers.find(s => s.id === p.supplierId)?.name || 'Fournisseur';
    const payments: any[] = p.payments || [];
    if (payments.length === 0) {
      // Achat d'avant les règlements détaillés : son `amountPaid` est réputé
      // payé en espèces, comme le faisait l'écran Caisse Générale.
      const amount = num(p.amountPaid);
      if (amount) lines.push({
        id: `pur-${p.id}`, date: p.date, nature: 'Achat',
        label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${supplier}`.trim(),
        amount: -amount,
      });
      continue;
    }
    payments.filter(pay => paidInCash(pay.accountId)).forEach((pay, i) => {
      const amount = num(pay.amount);
      if (!amount) return;
      lines.push({
        id: `pur-${p.id}-${pay.id || i}`,
        date: pay.date || p.date,
        nature: 'Achat',
        label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${supplier}`.trim(),
        amount: -amount,
      });
    });
  }

  // 4. Dépenses du CARBURANT réglées en espèces.
  //    Une dépense imputée à la Cafétéria ou au Lavage sort de LEUR caisse :
  //    la retrancher ici vidait le tiroir du carburant d'un argent qu'il
  //    n'avait jamais sorti.
  for (const e of expenses) {
    if (expensePartOf(e) !== 'carburant') continue;
    // Une dépense née d'une justification de brigade est DÉJÀ retranchée : le
    // pompiste l'a réglée avant de remettre le reste, et `cashReceived` est
    // d'autant plus bas. La retirer ici sortirait le même argent deux fois.
    if (isBrigadeExpense(e)) continue;
    if (!paidInCash(e.accountId)) continue;
    const amount = num(e.amount);
    if (!amount) continue;
    lines.push({
      id: `exp-${e.id}`, date: e.date, nature: 'Dépense',
      label: `${e.category || 'Dépense'}${e.description ? ` — ${e.description}` : ''}`,
      amount: -amount,
      reference: e.chequeNumber || e.bordereauNumber,
    });
  }

  // 5. Salaires et acomptes du personnel carburant.
  //    Ils ne sortaient d'AUCUNE caisse : la Cafétéria et le Lavage retiraient
  //    bien les salaires de leurs employés de leur tiroir, le Carburant payait
  //    les siens avec de l'argent qui restait indéfiniment en caisse. Un salaire
  //    réglé par chèque ou par virement, lui, ne touche pas le tiroir.
  //    L'ACOMPTE est de l'argent déjà remis en main propre ; le salaire net,
  //    lui, en est déjà déduit — les additionner ne compte donc rien deux fois.
  for (const key of FUEL_STAFF_KEYS) {
    for (const w of (app?.[key] || []) as any[]) {
      for (const p of (w.paymentRecord || [])) {
        if (p.isPaid === false) continue;
        if (!salaryPaidInCash(p.paymentMode)) continue;
        const amount = num(p.netSalary ?? p.amount);
        if (!amount) continue;
        lines.push({
          id: `sal-${p.id}`,
          date: p.paymentDate,
          nature: 'Salaire',
          label: `Salaire ${w.name || 'Employé'}${p.month ? ` — ${p.month}` : ''}`,
          amount: -amount,
          reference: p.chequeNumber,
        });
      }
      for (const a of (w.acomptes || [])) {
        const amount = num(a.amount);
        if (!amount) continue;
        lines.push({
          id: `aco-${a.id}`,
          date: a.date,
          nature: 'Acompte',
          label: `Acompte ${w.name || 'Employé'}${a.description ? ` — ${a.description}` : ''}`,
          amount: -amount,
        });
      }
    }
  }

  // 6. Opérations manuelles imputées au Carburant : dépôts, retraits, virements.
  //    On ne regardait que le coffre `CAISSE_CARBURANT` — un dépôt saisi dans la
  //    Caisse Générale avec « Carburant » en partie concernée n'entrait donc
  //    NULLE PART, et la caisse de l'activité restait bloquée sur les seules
  //    espèces des brigades.
  for (const { tx: t, amount } of partCashLedgerLines('carburant', txs)) {
    lines.push({
      id: t.id, date: t.date,
      nature: t.kind === 'DEPOSIT' ? 'Dépôt' : t.kind === 'WITHDRAW' ? 'Retrait' : 'Virement',
      label: t.description
        || (t.kind === 'DEPOSIT' ? 'Dépôt de caisse'
          : t.kind === 'WITHDRAW' ? 'Retrait de caisse' : 'Virement de caisse'),
      amount,
      reference: t.chequeNumber || t.bordereauNumber,
    });
  }

  lines.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalOf = (nature: string) =>
    lines.filter(l => l.nature === nature).reduce((s, l) => s + l.amount, 0);

  return {
    balance: lines.reduce((s, l) => s + l.amount, 0),
    inflow: lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0),
    outflow: lines.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0),
    brigadeCash: totalOf('Brigade'),
    clientCash: totalOf('Règlement client'),
    rechargeCash: totalOf('Recharge client'),
    purchasesCash: -totalOf('Achat'),
    expensesCash: -totalOf('Dépense'),
    salariesCash: -totalOf('Salaire'),
    acomptesCash: -totalOf('Acompte'),
    deposits: totalOf('Dépôt'),
    withdrawals: -totalOf('Retrait'),
    transfers: totalOf('Virement'),
    lines,
  };
}

/** Le solde seul — le raccourci des écrans qui n'affichent pas le détail. */
export function carburantCashBalance(app: any): number {
  return computeCarburantCash(app).balance;
}
