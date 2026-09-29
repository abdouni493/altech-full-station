import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileBarChart, Globe2, Fuel, ChevronRight, Printer, Calendar, TrendingUp, ShoppingCart,
  CreditCard, CircleDollarSign, Boxes, Users, Truck, AlertTriangle, CalendarClock, Store, Coffee,
  UtensilsCrossed, Wrench, UsersRound, PiggyBank, Landmark, Target, Clock, Car, Banknote, Layers,
  Droplets, Wallet, Hash, X, Trash2, Flame, Undo2, Scale, Moon, LineChart,
  ClipboardList, PackageX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, matchesSearch } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizLineItem, isReversedSale, formatQty } from '@/src/lib/bizConfig';
import { applyRestock, describeRestock, restockPlan } from '@/src/lib/bizRestock';
import { useBizAll, useBiz } from '@/src/store/BizContext';
import { useAppState, useAppDispatch, CAISSE_ID } from '@/src/store/AppContext';
import { removeBizExpenseLedger } from '@/src/lib/bizExpenseLedger';
import { money, formatDate, Modal, Badge, Confirm, Table } from '@/src/components/biz/Kit';
import { computeModuleReport, computeCarburantReport, consolidate, within, PartReport, GlobalReport } from '@/src/lib/bizReporting';
import { computeWorkforce, WorkforceReport, WorkforceWorker } from '@/src/lib/workforceReporting';
import { computeTreasuryReport, TreasuryReport } from '@/src/lib/treasuryReporting';
import { computeStockValuation, StockValuation } from '@/src/lib/stockValuation';
import { computeWorkingCapital, WorkingCapitalReport } from '@/src/lib/workingCapital';
import { summarizeInventaires } from '@/src/lib/inventaire';
import {
  computeCarburantAnalytics, computeModuleAnalytics, consolidateAnalytics,
  pickGranularity, Granularity,
} from '@/src/lib/bizAnalytics';
import { ZakatConfig, ZakatInputs, loadZakatConfig } from '@/src/lib/zakat';
import ReportView from '@/src/components/biz/ReportView';
import WorkforceView from '@/src/components/biz/WorkforceView';
import TreasuryView from '@/src/components/biz/TreasuryView';
import WorkingCapitalView from '@/src/components/biz/WorkingCapitalView';
import StockValueView from '@/src/components/biz/StockValueView';
import ZakatView from '@/src/components/biz/ZakatView';
import InventaireReportView, { collectLosses } from '@/src/components/biz/InventaireReportView';
import GlobalAnalyticsView from '@/src/components/biz/GlobalAnalyticsView';
import CaisseDetailModal from '@/src/components/biz/CaisseDetailModal';
import {
  ModuleFiche, GlobalFiche, PurchasesFiche, PAY_MODE_LABEL, printFiche,
  FuelPurchaseDetail, FuelTypeGroup, payInfoOf, groupPurchasesByFuelType,
} from '@/src/components/biz/ReportFiche';
import { deleteFuelPurchase, tankDeltasOf, describeTankDeltas, litersOf } from '@/src/lib/fuelPurchase';
import { unpaidSupplierInvoices, purchasePaid, purchaseRest } from '@/src/lib/supplierDebt';
import { toast } from 'react-hot-toast';

type ActiveKey =
  | 'global' | 'analyses' | 'carburant' | 'employes' | 'tresorerie'
  | 'fonds' | 'stock' | 'zakat' | 'inventaires' | ModuleKey;

const SECTIONS: { id: ActiveKey; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'global', label: 'Vue globale', icon: Globe2, hint: 'Rapport consolidé' },
  { id: 'analyses', label: 'Analyses', icon: LineChart, hint: 'Graphiques, tendances & classements' },
  { id: 'fonds', label: 'Fonds de roulement', icon: Scale, hint: 'Caisses, banques, créances, stock − dettes' },
  { id: 'stock', label: 'Valeur du stock', icon: Boxes, hint: "Au prix d'achat et au prix de vente" },
  { id: 'inventaires', label: 'Inventaires', icon: ClipboardList, hint: 'Comptages, décalages et pertes' },
  { id: 'zakat', label: 'Zakât', icon: Moon, hint: 'Calcul paramétrable de la zakât' },
  { id: 'employes', label: 'Employés & Personnel', icon: UsersRound, hint: 'Tous les employés, en détail' },
  { id: 'tresorerie', label: 'Caisse & Banques', icon: PiggyBank, hint: 'Trésorerie et journal complet' },
  { id: 'carburant', label: 'Carburant', icon: Fuel, hint: 'Rapport détaillé' },
  { id: 'restaurant', label: 'Restaurant', icon: UtensilsCrossed, hint: 'Rapport détaillé' },
  { id: 'cafeteria', label: 'Cafétéria', icon: Coffee, hint: 'Rapport détaillé' },
  { id: 'lavage', label: 'Lavage & Vidange', icon: Wrench, hint: 'Rapport détaillé' },
];

/** Sections that are a per-activity `PartReport` (the others have their own view). */
const PART_SECTIONS: ActiveKey[] = ['carburant', 'restaurant', 'cafeteria', 'lavage'];

// ─── Card drill-downs ─────────────────────────────────────────────────────────
/**
 * Les cartes KPI qui ouvrent une liste détaillée (les Achats ont leur propre
 * modale, plus riche). AUCUNE carte n'annonce plus un montant sans donner accès
 * aux opérations qui le composent : un chiffre qu'on ne peut pas vérifier n'est
 * pas un chiffre, c'est une affirmation.
 */
type CardKey =
  | 'salesTotal' | 'expenses' | 'netGain' | 'stockValue' | 'destructions'
  | 'clientDebt' | 'supplierDebt' | 'alerts' | 'returns' | 'pertes'
  | 'banks' | 'flux' | 'workers' | 'salaries' | 'brigades' | 'works'
  | 'workingCapital' | 'stockSell' | 'cogs';

/** One line of a card's underlying list. `onDelete` is absent for derived rows. */
interface DetailRow {
  id: string;
  date?: string;
  label: string;
  sub?: string;
  badge?: { text: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' };
  amount: number;
  amountTone?: 'green' | 'red' | 'blue' | 'amber' | 'slate';
  onDelete?: () => void;
  confirmMessage?: string;
}
interface CardDetail {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  rows: DetailRow[];
  total: number;
  totalLabel: string;
  note?: string;
}

export default function GeneralReports() {
  const biz = useBizAll();
  const app = useAppState();
  const dispatch = useAppDispatch();
  const restaurantBiz = useBiz('restaurant');
  const cafeteriaBiz = useBiz('cafeteria');
  const lavageBiz = useBiz('lavage');
  const settings = app.settings;
  const globalFicheRef = useRef<HTMLDivElement>(null);
  const moduleFicheRef = useRef<HTMLDivElement>(null);
  const purchasesFicheRef = useRef<HTMLDivElement>(null);

  const firstDay = new Date(); firstDay.setDate(1);
  const [from, setFrom] = useState(firstDay.toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [range, setRange] = useState({ from, to });
  const [active, setActive] = useState<ActiveKey>('global');
  const [showPurchases, setShowPurchases] = useState(false);
  // Which KPI card's drill-down is open (every card is clickable → its detail list).
  const [activeCard, setActiveCard] = useState<CardKey | null>(null);
  /** Détail du solde de la caisse générale — ouvert depuis sa carte. */
  const [showCaisse, setShowCaisse] = useState(false);
  /** Découpage du temps des analyses — automatique tant qu'on n'y touche pas. */
  const [grain, setGrain] = useState<Granularity | undefined>(undefined);
  /** Réglages de zakât — conservés sur ce poste d'une session à l'autre. */
  const [zakatConfig, setZakatConfig] = useState<ZakatConfig>(() => loadZakatConfig());

  const reports: Record<'carburant' | 'restaurant' | 'cafeteria' | 'lavage', PartReport> = useMemo(() => ({
    carburant: computeCarburantReport(app, range.from, range.to),
    // Le grand livre est passé aux parties commerciales : sans lui, leur caisse
    // ignorait les virements partis de leur coffre vers la banque. Les dépenses
    // de la station, elles, sont réparties selon l'activité qui les supporte —
    // sans quoi une dépense de la Cafétéria pesait sur le Carburant.
    restaurant: computeModuleReport(biz.restaurant, 'restaurant', range.from, range.to, app.treasuryTransactions, app.expenses),
    cafeteria: computeModuleReport(biz.cafeteria, 'cafeteria', range.from, range.to, app.treasuryTransactions, app.expenses),
    lavage: computeModuleReport(biz.lavage, 'lavage', range.from, range.to, app.treasuryTransactions, app.expenses),
  }), [biz, app, range]);

  const global: GlobalReport = useMemo(
    () => consolidate([reports.carburant, reports.restaurant, reports.cafeteria, reports.lavage], range.from, range.to),
    [reports, range],
  );

  // Ces annotations ne sont pas décoratives : `@types/react` n'est pas installé,
  // donc tout ce que rend un hook vaut `any` et rien de ce qui en sort n'est
  // vérifié. C'est ainsi qu'un `parts[].workers` — un champ qui n'a jamais
  // existé — a traversé la compilation pour planter à l'écran. Nommer le type
  // rebranche le compilateur sur tout ce qui lit ces rapports.
  const workforce: WorkforceReport = useMemo(() => computeWorkforce(app, biz, range.from, range.to), [app, biz, range]);
  const treasury: TreasuryReport = useMemo(() => computeTreasuryReport(app, biz, range.from, range.to), [app, biz, range]);

  // ── Valeur du stock — les deux valorisations, activité par activité ──
  const stockValuation: StockValuation = useMemo(() => computeStockValuation(app, biz), [app, biz]);

  // ── Inventaires — les comptages de chaque partie et leurs décalages ──
  // Chaque inventaire porte déjà son rapport d'écarts figé : on ne fait que les
  // rassembler, pour que cet écran ne puisse pas contredire celui de la partie.
  const inventaireParts = useMemo(() => [
    summarizeInventaires(biz.restaurant, 'restaurant', MODULES.restaurant.label, MODULES.restaurant.emoji),
    summarizeInventaires(biz.cafeteria, 'cafeteria', MODULES.cafeteria.label, MODULES.cafeteria.emoji),
    summarizeInventaires(biz.lavage, 'lavage', MODULES.lavage.label, MODULES.lavage.emoji),
  ], [biz]);
  const inventaireLosses = useMemo(() => collectLosses(inventaireParts), [inventaireParts]);
  const inventaireLossTotal = useMemo(
    () => inventaireParts.reduce((s, p) => s + p.lossValue, 0), [inventaireParts]);

  // ── Fonds de roulement — bâti SUR la trésorerie et les rapports déjà calculés,
  //    pour qu'il ne puisse jamais annoncer un autre chiffre qu'eux. ──
  const workingCapital: WorkingCapitalReport = useMemo(
    () => computeWorkingCapital(treasury, global.parts, stockValuation),
    [treasury, global.parts, stockValuation]);

  // ── Analyses — une par activité, plus leur consolidation ──
  const analytics = useMemo(() => {
    const g = grain || pickGranularity(range.from, range.to);
    const parts = [
      computeCarburantAnalytics(app, range.from, range.to, g),
      computeModuleAnalytics(biz.restaurant, 'restaurant', range.from, range.to, g, app.expenses),
      computeModuleAnalytics(biz.cafeteria, 'cafeteria', range.from, range.to, g, app.expenses),
      computeModuleAnalytics(biz.lavage, 'lavage', range.from, range.to, g, app.expenses),
    ];
    return { parts, global: consolidateAnalytics(parts, range.from, range.to, g) };
  }, [app, biz, range, grain]);

  // ── Zakât — l'assiette est prise dans l'application, jamais ressaisie ──
  const zakatInputs = useMemo<ZakatInputs>(() => ({
    caisse: workingCapital.cashTotal,
    banques: workingCapital.bankTotal,
    stock: stockValuation.parts.map(p => ({
      key: p.key as 'carburant' | 'restaurant' | 'cafeteria' | 'lavage',
      label: p.label, emoji: p.emoji, buyValue: p.buyValue, sellValue: p.sellValue,
    })),
    creances: workingCapital.receivablesTotal,
    dettesFournisseurs: workingCapital.payablesTotal,
  }), [workingCapital, stockValuation]);

  // Detailed fuel purchases of the period — the "Achats carburant" drill-down and
  // its printable fiche. Unlike the aggregate report, each achat keeps its full
  // payment breakdown (mode, n° de chèque / bordereau, compte débité).
  const fuelPurchases = useMemo<FuelPurchaseDetail[]>(() => {
    const suppliers: any[] = app.suppliers || [];
    const tanks: any[] = app.tanks || [];
    const bankAccounts: any[] = app.bankAccounts || [];
    const acctLabel = (id?: string) =>
      !id || id === CAISSE_ID ? 'Espèces (caisse)' : (bankAccounts.find(a => a.id === id)?.name || 'Compte bancaire');
    // Nom lisible d'une cuve, pris sur la cuve ACTUELLE quand elle existe encore
    // (le libellé figé dans la ligne d'achat peut dater d'un ancien nom).
    const cuveLabel = (i: any) => {
      const tank = tanks.find(t => t.id === i.tankId);
      return tank ? `${tank.name}${tank.type ? ` (${tank.type})` : ''}` : (i.productName || 'Cuve');
    };
    // Type de carburant d'une ligne, pris sur la cuve — sert à regrouper les achats.
    const cuveType = (i: any): string => tanks.find(t => t.id === i.tankId)?.type || 'AUTRE';
    return (app.purchases || [])
      .filter((p: any) => within(p.date, range.from, range.to))
      // Only fuel purchases (they always carry a cuve), like the Achats Carburant screen.
      .filter((p: any) => (p.items || []).some((i: any) => !!i.tankId) || !!p.tankId)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((p: any): FuelPurchaseDetail => ({
        id: p.id,
        ref: p.invoiceNumber || p.blNumber || p.id.slice(0, 8).toUpperCase(),
        invoiceNumber: p.invoiceNumber,
        blNumber: p.blNumber,
        date: p.date,
        supplier: suppliers.find(s => s.id === p.supplierId)?.name || '—',
        status: p.status || '—',
        items: (p.items || []).map((i: any) => ({
          name: cuveLabel(i),
          qty: i.quantity || 0,
          unitPrice: i.buyPrice || 0,
          total: i.total ?? (i.quantity || 0) * (i.buyPrice || 0),
          type: cuveType(i),
        })),
        cuves: Array.from(new Set((p.items || []).filter((i: any) => i.tankId).map(cuveLabel))).join(', '),
        subtotal: p.subtotal || 0,
        discountAmount: p.discountAmount || 0,
        tvaAmount: p.tvaAmount || 0,
        total: p.total || 0,
        // Payé / reste RECALCULÉS sur les règlements enregistrés : les colonnes
        // figées de l'achat pouvaient annoncer un reste d'un millième de dinar
        // (arrondi de TVA) ou une valeur d'une version antérieure.
        paid: purchasePaid(p),
        rest: Math.max(0, purchaseRest(p)),
        liters: (p.items || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0),
        payments: (p.payments || []).map((pay: any) => ({
          mode: pay.mode,
          amount: pay.amount || 0,
          chequeNumber: pay.chequeNumber,
          bordereauNumber: pay.bordereauNumber,
          account: acctLabel(pay.accountId),
          date: pay.date,
          notes: pay.notes,
        })),
      }));
  }, [app, range]);

  // Underlying list behind every KPI card. Rows carry their own delete action so
  // the user can drill in and remove an entry (a sale, an expense, a product…);
  // derived rows (bénéfice net, alertes) are shown read-only.
  const cardDetails = useMemo<Record<CardKey, CardDetail>>(() => {
    const bizOf = (k: ModuleKey) => (k === 'restaurant' ? restaurantBiz : k === 'cafeteria' ? cafeteriaBiz : lavageBiz);
    /**
     * Supprimer une dépense emporte la ligne de trésorerie qu'elle avait
     * écrite : sans elle, le compte débité resterait amputé d'un argent que
     * plus aucune dépense ne justifie.
     */
    const deleteAppExpense = (id: string) => {
      (app.treasuryTransactions || [])
        .filter((t: any) => t.refType === 'expense' && t.refId === id)
        .forEach((t: any) => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
      dispatch({ type: 'DELETE_EXPENSE', payload: id });
    };
    const deleteBizExpense = (k: ModuleKey, id: string) => {
      removeBizExpenseLedger(dispatch, app.treasuryTransactions, id);
      bizOf(k).remove('expenses', id);
    };
    const stateOf = (k: ModuleKey) => biz[k];
    const clientName = (id?: string) => app.clients?.find((c: any) => c.id === id)?.name;
    const byDateDesc = (a: DetailRow, b: DetailRow) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();

    // ── Ventes totales — brigades + magasin (carburant) + biz sales/reparations ──
    // La vente de carburant, c'est la BRIGADE. Cette liste lisait `fuelSales`,
    // une table que plus aucun écran n'alimente : le carburant y pesait zéro,
    // alors qu'il est de loin la première recette de la station.
    const salesRows: DetailRow[] = [];
    reports.carburant.fuelBrigades.forEach(b => salesRows.push({
      id: `bri-${b.id}`, date: b.date,
      label: `⛽ Brigade ${b.shift} — ${b.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`,
      sub: [
        `Chef ${b.chefName}`,
        `espèces ${money(b.cash)}`,
        b.tpe ? `TPE ${money(b.tpe)}` : undefined,
        b.credit ? `bons clients ${money(b.credit)}` : undefined,
        Math.abs(b.rest) > 0.01 ? `manquant ${money(b.rest)}` : undefined,
      ].filter(Boolean).join(' · '),
      badge: { text: b.closed ? 'Clôturée' : 'En cours', tone: b.closed ? 'success' : 'warning' },
      amount: b.revenue, amountTone: 'green',
    }));
    (app.shopSales || []).filter((s: any) => within(s.date, range.from, range.to)).forEach((s: any) => salesRows.push({
      id: `shop-${s.id}`, date: s.date,
      label: `🛒 Magasin — ${(s.items || []).length} article(s)`,
      sub: clientName(s.clientId) || 'Comptoir', amount: s.total || 0, amountTone: 'green',
      onDelete: () => dispatch({ type: 'DELETE_SHOP_SALE', payload: s.id }),
      confirmMessage: `Supprimer cette vente magasin de ${money(s.total || 0)} ?`,
    }));
    // Supprimer une vente ou une intervention depuis ce rapport fait le MÊME
    // retour de marchandise que l'écran d'origine : les articles vendus et les
    // pièces posées reviennent en stock avant que la ligne ne disparaisse.
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => reports[k].sales.forEach(s => {
      const isRep = s.kind !== 'Vente';
      const api = bizOf(k);
      const st = stateOf(k);
      const lines: BizLineItem[] = isRep
        ? (st.reparations.find(r => r.id === s.id)?.usedProducts || [])
        : (st.sales.find(x => x.id === s.id)?.items || []);
      const reversed = !isRep && !!st.sales.find(x => x.id === s.id && isReversedSale(x));
      const impact = reversed ? '' : describeRestock(st, lines);
      salesRows.push({
        id: `${k}-${s.id}`, date: s.date,
        label: `${reports[k].emoji} ${s.kind}${s.ref ? ' · ' + s.ref : ''}`,
        sub: s.client || 'Comptoir', amount: s.total, amountTone: 'green',
        onDelete: () => {
          if (!reversed) applyRestock(api, restockPlan(st, lines));
          api.remove(isRep ? 'reparations' : 'sales', s.id);
        },
        confirmMessage: `Supprimer « ${s.ref || s.kind} » (${money(s.total)}) ?\n\n`
          + (reversed
            ? 'Cette vente a déjà été retournée ou échangée : sa marchandise est revenue en stock.'
            : 'Les quantités seront REMISES en stock.\n\n' + (impact || 'Aucune quantité à remettre en stock.')),
      });
    }));
    salesRows.sort(byDateDesc);

    // ── Retours & échanges — ventes ANNULÉES, déjà retirées des lignes ci-dessus ──
    // La marchandise est revenue en stock : ces ventes ne comptent plus dans le CA
    // ni dans les gains. On les liste à part pour que l'écart se lise noir sur blanc.
    const returnRows: DetailRow[] = [];
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => reports[k].returns.forEach(rt => returnRows.push({
      id: `${k}-ret-${rt.id}`, date: rt.date,
      label: `${reports[k].emoji} ${rt.kind} · ${rt.ref}`,
      sub: [
        rt.client,
        `${money(rt.refunded)} rendu(s) au client`,
        `${money(rt.restockedCost)} de marchandise remise en stock`,
        rt.reason,
      ].filter(Boolean).join(' · '),
      badge: { text: rt.kind, tone: rt.kind === 'Retour' ? 'neutral' : 'info' },
      amount: rt.total, amountTone: 'slate',
    })));
    returnRows.sort(byDateDesc);

    // ── Dépenses + salaires — dépenses supprimables, salaires en lecture seule ──
    // Chaque activité porte SES dépenses : celles saisies chez elle, et celles
    // que l'écran « Dépenses » de la station lui a imputées. Les deux ne se
    // suppriment pas au même endroit (`origin`), et confondre les deux chemins
    // laissait la ligne revenir au rechargement suivant.
    const expenseRows: DetailRow[] = [];
    /** Badge « comment c'est payé » — le tiroir de l'activité, ou la banque. */
    const payBadge = (e: { paidInCash?: boolean }): DetailRow['badge'] =>
      e.paidInCash === false ? { text: 'Banque', tone: 'info' } : { text: 'Espèces', tone: 'neutral' };
    reports.carburant.expenses.forEach(e => {
      if (e.kind !== 'Dépense') return;
      expenseRows.push({
        id: `carb-${e.id}`, date: e.date, label: `⛽ ${e.label}`, sub: e.description, amount: e.amount, amountTone: 'red',
        badge: payBadge(e),
        onDelete: () => deleteAppExpense(e.id),
        confirmMessage: `Supprimer la dépense « ${e.label} » (${money(e.amount)}) ?`,
      });
    });
    reports.carburant.expenses.filter(e => e.kind !== 'Dépense').forEach(e => expenseRows.push({
      id: `carb-${e.kind}-${e.id}`, date: e.date, label: `⛽ ${e.kind} — ${e.label}`, sub: e.description,
      amount: e.amount, amountTone: 'amber', badge: { text: e.kind, tone: 'info' },
    }));
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => reports[k].expenses.forEach(e => {
      if (e.kind === 'Dépense') expenseRows.push({
        id: `${k}-${e.id}`, date: e.date, label: `${reports[k].emoji} ${e.label}`, sub: e.description, amount: e.amount, amountTone: 'red',
        badge: payBadge(e),
        // Une dépense de la station imputée à cette partie se supprime dans la
        // station ; celle saisie dans la partie, dans son blob.
        onDelete: e.origin === 'app'
          ? () => deleteAppExpense(e.id)
          : () => deleteBizExpense(k, e.id),
        confirmMessage: `Supprimer la dépense « ${e.label} » (${money(e.amount)}) ?`,
      });
      else if (e.kind === 'Salaire') expenseRows.push({
        id: `${k}-${e.id}`, date: e.date, label: `${reports[k].emoji} Salaire — ${e.label}`, sub: e.description, amount: e.amount, amountTone: 'amber',
        badge: { text: 'Salaire', tone: 'info' },
      });
    }));
    expenseRows.sort(byDateDesc);

    // ── Bénéfice net — décomposition par activité (lecture seule) ──
    // Le sous-titre déroule le calcul complet : ce qui a été vendu, ce que la
    // marchandise a coûté, puis les charges — c'est là que se lit l'écart entre
    // le prix de vente d'un produit et le gain qu'il rapporte vraiment.
    const netRows: DetailRow[] = global.parts.map(p => ({
      id: p.key, label: `${p.emoji} ${p.label}`,
      sub: `Ventes ${money(p.salesTotal)} − coût marchandises ${money(p.cogs)} = marge ${money(p.grossMargin)}`
        + ` − charges ${money(p.expensesTotal + p.salariesPaid)}`
        + (p.destroyedValue > 0 ? ` − destructions ${money(p.destroyedValue)}` : '')
        + (p.lossValue > 0 ? ` − pertes ${money(p.lossValue)}` : ''),
      amount: p.netGain, amountTone: p.netGain >= 0 ? 'green' : 'red',
    }));

    // ── Destructions — marchandise perdue (stock + comptoir), avec son détail ──
    const destructionRows: DetailRow[] = [];
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => reports[k].destructions.forEach(d => destructionRows.push({
      id: `${k}-${d.id}`, date: d.date,
      label: `${reports[k].emoji} ${d.name}`,
      sub: [
        `${d.qty} ${d.unit || ''} × ${money(d.unitPrice)}`.trim(),
        d.reason,
        d.createdBy ? `par ${d.createdBy}` : undefined,
      ].filter(Boolean).join(' · '),
      badge: { text: d.source === 'stock' ? 'Stock' : 'Comptoir', tone: d.source === 'stock' ? 'info' : 'neutral' },
      amount: d.value, amountTone: 'red',
      onDelete: () => bizOf(k).remove('destructions', d.id),
      confirmMessage: `Retirer la destruction de « ${d.name} » (${money(d.value)}) de l'historique ? Le stock n'est pas modifié.`,
    })));
    destructionRows.sort(byDateDesc);

    // ── Valeur du stock — cuves ET produits, valorisés au prix d'achat ──
    // Les litres dormant dans les cuves — le premier actif de la station —
    // étaient absents de cette liste : seuls les produits boutique y figuraient.
    const stockRows: DetailRow[] = [];
    reports.carburant.stockLines.forEach(l => {
      const isTank = l.id.startsWith('tank-');
      const productId = l.id;
      stockRows.push({
        id: `carb-${l.id}`, label: `⛽ ${l.name}`,
        sub: `${l.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${l.unit || ''} × ${money(l.buyPrice)}`,
        badge: isTank ? { text: 'Cuve', tone: 'info' } : undefined,
        amount: l.value, amountTone: 'blue',
        // Une cuve ne se supprime pas depuis un rapport : elle se gère depuis
        // l'écran Cuves, où le niveau et les mouvements sont tenus.
        onDelete: isTank ? undefined : () => dispatch({ type: 'DELETE_PRODUCT', payload: productId }),
        confirmMessage: `Supprimer le produit « ${l.name} » ? Il disparaîtra de l'inventaire.`,
      });
    });
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => (stateOf(k).products || []).forEach((p: any) => stockRows.push({
      id: `${k}-${p.id}`, label: `${reports[k].emoji} ${p.name}`,
      sub: `${(p.currentQty || 0).toLocaleString('fr-FR')} ${p.unit || ''} × ${money(p.purchasePrice || 0)}`,
      amount: (p.currentQty || 0) * (p.purchasePrice || 0), amountTone: 'blue',
      onDelete: () => bizOf(k).remove('products', p.id),
      confirmMessage: `Supprimer le produit « ${p.name} » ?`,
    })));
    stockRows.sort((a, b) => b.amount - a.amount);

    // ── Comptes bancaires — un par ligne, avec ce que la période a fait bouger ──
    const bankRows: DetailRow[] = treasury.accounts.map(a => ({
      id: `bank-${a.id}`,
      label: `🏛️ ${a.name}`,
      sub: [
        a.accountNumber ? `N° ${a.accountNumber}` : undefined,
        `début de période ${money(a.openingBalance)}`,
        `+${money(a.credit)} reçus · −${money(a.debit)} sortis`,
        `${a.movesCount} mouvement(s) au total`,
      ].filter(Boolean).join(' · '),
      badge: { text: `${a.moves.length} sur la période`, tone: 'info' },
      amount: a.balance, amountTone: a.balance >= 0 ? 'green' : 'red',
    }));

    // ── Journal consolidé de la période — chaque opération de la station ──
    // Une opération réglée en banque garde son montant, mais elle n'est ni un
    // encaissement ni un décaissement d'espèces : aucun tiroir ne s'est ouvert.
    const fluxRows: DetailRow[] = treasury.movements.map(m => ({
      id: `flux-${m.id}`, date: m.date,
      label: `${m.partLabel} — ${m.label}`,
      sub: [m.nature, m.accounts, m.reference].filter(Boolean).join(' · '),
      badge: m.bank
        ? { text: 'Banque', tone: 'info' as const }
        : { text: m.amount >= 0 ? 'Encaissement' : 'Décaissement', tone: m.amount >= 0 ? 'success' as const : 'danger' as const },
      amount: m.bank ? m.gross : m.amount,
      amountTone: m.bank ? 'slate' : m.amount >= 0 ? 'green' : 'red',
    }));

    // ── Employés — le dossier de chacun, toutes activités confondues ──
    // Les employés forment une liste PLATE sur le rapport, chacun portant sa
    // partie (`part` / `partLabel` / `partEmoji`) ; `parts`, lui, ne porte que
    // des totaux par activité — aucun employé n'y est rattaché.
    const workerRows: DetailRow[] = (workforce.workers || []).map(w => ({
      id: `wf-${w.part}-${w.id}`,
      label: `${w.partEmoji} ${w.name}`,
      sub: [
        w.role,
        w.speciality,
        `salaire ${money(w.salaryAmount)}/${w.salaryType}`,
        `versé ${money(w.paymentsTotal)}`,
        w.acomptesTotal ? `acomptes ${money(w.acomptesTotal)}` : undefined,
        w.absencesCount ? `${w.absencesCount} absence(s)` : undefined,
      ].filter(Boolean).join(' · '),
      badge: w.hasAccount && w.accountActive
        ? { text: 'Compte actif', tone: 'success' as const }
        : { text: w.partLabel, tone: 'info' as const },
      amount: w.dueNow, amountTone: w.dueNow > 0 ? 'red' : 'slate',
    }));

    // ── Salaires versés — chaque paiement, employé par employé ──
    const salaryRows: DetailRow[] = (workforce.workers || []).flatMap(w =>
      (w.payments || []).map(pay => ({
        id: `pay-${w.id}-${pay.id}`, date: pay.date,
        label: `${w.partEmoji} ${w.name}`,
        sub: [pay.label, pay.description, pay.mode].filter(Boolean).join(' · '),
        badge: { text: w.partLabel, tone: 'info' as const },
        amount: pay.amount, amountTone: 'green' as const,
      })))
      .sort(byDateDesc);

    // ── Brigades couvertes — la vente de carburant, brigade par brigade ──
    const brigadeRows: DetailRow[] = reports.carburant.fuelBrigades.map(b => ({
      id: `brg-${b.id}`, date: b.date,
      label: `⛽ Brigade ${b.shift} — ${b.chefName}`,
      sub: [
        `${b.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`,
        b.byFuel.map(f => `${f.type} ${f.liters.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L`).join(', '),
        `espèces ${money(b.cash)}`,
        b.tpe ? `TPE ${money(b.tpe)}` : undefined,
        b.credit ? `bons ${money(b.credit)}` : undefined,
        Math.abs(b.rest) > 0.01 ? `manquant ${money(b.rest)}` : 'soldée',
      ].filter(Boolean).join(' · '),
      badge: { text: b.closed ? 'Clôturée' : 'En cours', tone: b.closed ? 'success' : 'warning' },
      amount: b.revenue, amountTone: 'green',
    }));

    // ── Travaux lavage / vidange + sessions cafétéria ──
    const workRows: DetailRow[] = [];
    reports.lavage.sales.filter(s => s.kind !== 'Vente').forEach(s => workRows.push({
      id: `work-${s.id}`, date: s.date,
      label: `🔧 ${s.kind} · ${s.ref}`, sub: s.client || 'Comptoir',
      badge: s.rest > 0 ? { text: `reste ${money(s.rest)}`, tone: 'warning' } : { text: 'Payé', tone: 'success' },
      amount: s.total, amountTone: 'green',
    }));
    reports.restaurant.sales.forEach(s => workRows.push({
      id: `rst-${s.id}`, date: s.date,
      label: `🍽️ ${s.kind} · ${s.ref}`, sub: s.client || 'Salle',
      amount: s.total, amountTone: 'green',
    }));
    reports.cafeteria.sales.forEach(s => workRows.push({
      id: `caf-${s.id}`, date: s.date,
      label: `☕ ${s.kind} · ${s.ref}`, sub: s.client || 'Comptoir',
      amount: s.total, amountTone: 'green',
    }));
    workRows.sort(byDateDesc);

    // ── Fonds de roulement — chaque terme du calcul, bloc par bloc ──
    const wcRows: DetailRow[] = [
      workingCapital.cash, workingCapital.banks, workingCapital.receivables,
      workingCapital.stock, workingCapital.payables,
    ].flatMap(b => b.rows.map(row => ({
      id: `wc-${b.key}-${row.id}`,
      date: row.date,
      label: `${row.emoji || '•'} ${row.label}`,
      sub: [b.label, row.sub].filter(Boolean).join(' · '),
      badge: row.informational
        ? { text: 'indicatif — hors total', tone: 'neutral' as const }
        : { text: b.sign > 0 ? 'ajouté' : 'retranché', tone: b.sign > 0 ? 'success' as const : 'danger' as const },
      amount: b.sign > 0 ? row.amount : -row.amount,
      amountTone: row.informational ? 'slate' as const : b.sign > 0 ? 'green' as const : 'red' as const,
    })));

    // ── Stock au prix de vente — la marge qui dort en réserve ──
    const stockSellRows: DetailRow[] = stockValuation.parts.flatMap(p =>
      p.sections.flatMap(sec => sec.lines.filter(l => l.sellValue !== 0 || l.buyValue !== 0).map(l => ({
        id: `sv-${p.key}-${sec.key}-${l.id}`,
        label: `${p.emoji} ${l.name}`,
        sub: [
          sec.label,
          `${l.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${l.unit || ''}`.trim(),
          `achat ${money(l.buyPrice)} → vente ${money(l.sellPrice)}`,
          `marge ${money(l.margin)}`,
        ].filter(Boolean).join(' · '),
        amount: l.sellValue, amountTone: 'blue' as const,
      })))).sort((a, b) => b.amount - a.amount);

    // ── Coût des marchandises vendues — par produit, toutes activités ──
    const cogsRows: DetailRow[] = global.parts.flatMap(p =>
      p.salesByProduct.filter(x => x.cost !== 0).map(x => ({
        id: `cogs-${p.key}-${x.name}`,
        label: `${p.emoji} ${x.name}`,
        sub: `${x.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${x.unit || ''} vendus · CA ${money(x.revenue)} · gain ${money(x.gain)}`,
        amount: x.cost, amountTone: 'amber' as const,
      }))).sort((a, b) => b.amount - a.amount);

    // ── Dettes clients ──
    // Le reste dû vient du rapport Carburant, qui le reconstruit sur les PIÈCES
    // du client (bons de brigade, factures magasin, règlements). La carte lisait
    // la colonne `clients.debt` — un compteur que l'écran Clients n'utilise plus :
    // un règlement encaissé laissait donc le rapport sur l'ancien encours.
    const clientDebtRows: DetailRow[] = [];
    reports.carburant.clientDebts.forEach(d => {
      // La DETTE INITIALE saisie à l'ouverture de la fiche est dite en toutes
      // lettres : elle ne s'appuie sur aucun bon ni aucune facture, et sans ce
      // repère on cherchait en vain le document qui l'expliquerait.
      const client = (app.clients || []).find((c: any) => c.id === d.id);
      const opening = Math.max(0, Number(client?.openingDebt) || 0);
      // Et l'AVANCE, dite elle aussi : `d.rest` est déjà net de ce que la
      // station détient pour ce client, mais un total qu'on ne peut pas
      // recomposer à partir de sa propre sous-ligne n'est pas vérifiable.
      const advance = Math.max(0, Number(client?.openingAdvance) || 0);
      clientDebtRows.push({
        id: `carb-${d.id}`, label: `👤 ${d.name}`, date: d.date || undefined,
        sub: [
          d.total ? `${money(d.total)} à crédit` : '',
          d.paid ? `${money(d.paid)} réglés` : '',
          opening > 0 ? `dont ${money(opening)} de dette initiale` : '',
          advance > 0 ? `${money(advance)} d'avance déduits` : '',
        ].filter(Boolean).join(' · ') || 'd’après les pièces du compte',
        amount: d.rest, amountTone: 'red',
        onDelete: () => dispatch({ type: 'DELETE_CLIENT', payload: d.id }),
        confirmMessage: `Supprimer le client « ${d.name} » et tout son historique ? Cette action est définitive.`,
      });
    });
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => reports[k].clientDebts.forEach(d => clientDebtRows.push({
      id: `${k}-${d.id}`, label: `${reports[k].emoji} ${d.name}`, date: d.date || undefined,
      sub: d.ref === 'REPRISE'
        ? `Dette initiale à l'ouverture du compte — ${money(d.total)}${d.paid ? `, ${money(d.paid)} déjà réglés` : ''}`
        : d.ref === 'AVANCE'
          ? `Avance versée à l'ouverture du compte — ${money(-d.total)} détenus, imputés sur ce qu'il doit`
          : [d.ref, d.total ? `${money(d.total)} facturés` : '', d.paid ? `${money(d.paid)} réglés` : ''].filter(Boolean).join(' · '),
      amount: d.rest, amountTone: d.ref === 'AVANCE' ? 'green' : 'red',
    })));
    clientDebtRows.sort((a, b) => b.amount - a.amount);

    // ── Dettes fournisseurs — UNE LIGNE PAR FACTURE NON SOLDÉE ──
    // La carte lisait la colonne `suppliers.balance`, que l'écran Achats
    // Carburant n'alimente pas : elle affichait 0 en permanence. Chaque ligne
    // est désormais une facture réelle, avec son n°, sa date, son total et ce
    // qui a déjà été réglé — le chiffre de la carte se vérifie donc à la ligne.
    const supplierDebtRows: DetailRow[] = unpaidSupplierInvoices(app).map(inv => ({
      id: `carb-${inv.source}-${inv.id}`,
      date: inv.date,
      label: `🚚 ${inv.supplierName}`,
      sub: [
        inv.source === 'bl' ? `Bon de livraison ${inv.ref}`
          : `Facture ${inv.ref}${inv.fuel ? ' (carburant)' : ''}`,
        `Total ${money(inv.total)} · payé ${money(inv.paid)}`,
        inv.appointmentDate ? `rendez-vous de paiement le ${formatDate(inv.appointmentDate)}` : undefined,
      ].filter(Boolean).join(' · '),
      badge: inv.paid > 0
        ? { text: 'Dette partielle', tone: 'warning' as const }
        : { text: 'Dette', tone: 'danger' as const },
      amount: inv.rest, amountTone: 'red',
    }));
    (['restaurant', 'cafeteria', 'lavage'] as const).forEach(k => reports[k].supplierDebts.forEach(d => supplierDebtRows.push({
      id: `${k}-${d.id}`, label: `${reports[k].emoji} ${d.name}`, sub: d.ref, amount: d.rest, amountTone: 'red',
    })));
    supplierDebtRows.sort((a, b) => b.amount - a.amount);

    // ── Alertes — stock bas + péremptions (lecture seule) ──
    const alertRows: DetailRow[] = [];
    global.parts.forEach(p => {
      p.stockAlerts.forEach(a => alertRows.push({
        id: `stk-${p.key}-${a.id}`, label: `${p.emoji} ${a.name}`,
        sub: `Stock ${a.currentQty} ${a.unit || ''} ≤ min ${a.minQty}`, amount: a.value, amountTone: 'amber',
        badge: { text: 'Stock bas', tone: 'warning' },
      }));
      p.expiryAlerts.forEach(a => alertRows.push({
        id: `exp-${p.key}-${a.id}`, label: `${p.emoji} ${a.name}`,
        sub: `${a.status === 'expired' ? 'Expiré' : 'Expire bientôt'} · ${formatDate(a.expirationDate)}`,
        amount: a.value, amountTone: 'red', badge: { text: a.status === 'expired' ? 'Expiré' : 'Bientôt', tone: 'danger' },
      }));
    });

    // ── Pertes d'inventaire — la marchandise qui manquait au comptage ──
    // Une perte n'est PAS une destruction : personne ne l'a déclarée cassée ou
    // périmée, elle a simplement disparu entre deux comptages. C'est cette somme
    // qui peut être imputée aux employés depuis leur écran de paie.
    const perteRows: DetailRow[] = inventaireLosses.map(l => ({
      id: l.id, date: l.inventaire.date,
      label: `${l.emoji} ${l.productName}`,
      sub: [
        `Inventaire ${l.inventaire.ref}`,
        `compté ${formatQty(l.countedQty)} ${l.unit || ''} contre ${formatQty(l.systemQty)} annoncé(s)`.trim(),
        `manque ${formatQty(Math.abs(l.ecart))} ${l.unit || ''} × ${money(l.purchasePrice)}`.trim(),
        l.inventaire.chargeWorkers === false ? 'non imputé aux employés' : undefined,
      ].filter(Boolean).join(' · '),
      badge: { text: l.partLabel, tone: 'danger' },
      amount: l.value, amountTone: 'red',
    }));

    return {
      pertes:       { title: 'Pertes d\'inventaire', icon: PackageX, subtitle: 'Marchandise manquante constatée au comptage', rows: perteRows, total: inventaireLossTotal, totalLabel: 'Total des pertes', note: 'Le manquant est valorisé au prix d\'achat du produit. Ces lignes sont calculées par les inventaires — pour les corriger, reprenez le comptage depuis l\'écran Inventaire de la partie concernée. Les inventaires dont l\'imputation est activée apparaissent dans la paie des employés concernés.' },
      salesTotal:   { title: 'Ventes totales', icon: TrendingUp, subtitle: 'Détail de toutes les ventes de la période', rows: salesRows, total: global.salesTotal, totalLabel: 'Total ventes', note: global.counts.returns ? `${global.counts.returns} vente(s) retournée(s) ou échangée(s) ne figurent pas ici : leur marchandise est revenue en stock. Voir la carte « Retours & échanges ».` : undefined },
      returns:      { title: 'Retours & échanges', icon: Undo2, subtitle: 'Ventes annulées — marchandise revenue en stock', rows: returnRows, total: global.returnsTotal, totalLabel: 'CA annulé', note: `Ces ventes sont exclues du chiffre d'affaires et des gains : les articles ont été remis en stock (${money(global.restockedCost)} de coût de revient) et ${money(global.refundedTotal)} ont été rendus aux clients. Annulez un retour depuis l'écran Ventes de la partie concernée.` },
      expenses:     { title: 'Dépenses + salaires', icon: CreditCard, subtitle: 'Dépenses et salaires de la période', rows: expenseRows, total: global.expensesTotal + global.salariesPaid, totalLabel: 'Total charges', note: 'Les salaires sont calculés par la paie — supprimez-les depuis la fiche employé.' },
      netGain:      { title: 'Total des gains', icon: CircleDollarSign, subtitle: 'Décomposition par activité', rows: netRows, total: global.netGain, totalLabel: 'Gain net', note: `Ventes ${money(global.salesTotal)} − coût des marchandises vendues ${money(global.cogs)} = marge brute ${money(global.grossMargin)}, moins les dépenses, salaires, destructions et pertes. Le gain d'un produit fabriqué est son prix de vente MOINS le coût de ses ingrédients — jamais le prix de vente entier. Lignes calculées — non supprimables.` },
      stockValue:   { title: 'Valeur du stock', icon: Boxes, subtitle: "Produits en stock valorisés au prix d'achat", rows: stockRows, total: global.stockValue, totalLabel: 'Valeur totale' },
      destructions: { title: 'Destructions', icon: Flame, subtitle: 'Marchandise perdue (périmée, cassée, volée) — stock & comptoir', rows: destructionRows, total: global.destroyedValue, totalLabel: 'Coût total des pertes', note: 'Le coût des destructions est déduit du bénéfice net. Supprimer une ligne ne remet PAS la quantité en stock — utilisez « Récupérer » depuis la Gestion de stock.' },
      clientDebt:   { title: 'Dettes clients', icon: Users, subtitle: 'Encours clients (toutes dates)', rows: clientDebtRows, total: global.clientDebtTotal, totalLabel: 'Total encours', note: "Le reste dû de chaque client est reconstruit sur ses PIÈCES — bons de brigade, factures, interventions, règlements — et sur la DETTE INITIALE saisie à l'ouverture de sa fiche. L'AVANCE qu'il a versée vient en déduction : c'est son argent, pas une créance de la station. Ni l'une ni l'autre ne s'appuie sur un document — elles se corrigent depuis l'écran Clients de l'activité concernée (« Dette initiale »)." },
      supplierDebt: { title: 'Dettes fournisseurs', icon: Truck, subtitle: 'Encours fournisseurs (toutes dates)', rows: supplierDebtRows, total: global.supplierDebtTotal, totalLabel: 'Total encours' },
      alerts:       { title: 'Alertes', icon: AlertTriangle, subtitle: 'Stock bas et péremptions', rows: alertRows, total: alertRows.reduce((s, r) => s + r.amount, 0), totalLabel: 'Valeur concernée', note: 'Alertes calculées — non supprimables.' },
      banks:        { title: 'Comptes bancaires', icon: Landmark, subtitle: 'Solde de chaque compte et ce que la période y a fait', rows: bankRows, total: treasury.bankTotal, totalLabel: 'Total en banque', note: `Sur la période : ${money(treasury.bankOpening)} au départ, +${money(treasury.bankIn)} reçus, −${money(treasury.bankOut)} sortis. Le solde d'un compte est son solde d'ouverture plus TOUS ses mouvements, quelle que soit la période affichée. Ouvrez « Caisse & Banques » pour l'historique complet d'un compte.` },
      flux:         { title: 'Journal de la période', icon: Layers, subtitle: 'Chaque opération de la station, toutes activités confondues', rows: fluxRows, total: treasury.net, totalLabel: 'Flux net', note: `+${money(treasury.inflow)} encaissés et −${money(treasury.outflow)} décaissés EN ESPÈCES sur ${treasury.counts.movements} opération(s), dont ${treasury.counts.ledgerLines} issues du grand livre. ${money(treasury.bankMoves)} ont bougé en banque sans passer par un tiroir (virements, achats et dépenses réglés par la banque, TPE). Un document qui a déjà écrit sa ligne au grand livre (achat réglé, dépense payée, brigade clôturée) n'est compté qu'une fois.` },
      workers:      { title: 'Employés de la station', icon: UsersRound, subtitle: 'Tous les employés, toutes activités confondues', rows: workerRows, total: workforce.totals.dueNow, totalLabel: 'Reste à régler', note: `${workforce.totals.workers} employé(s), dont ${workforce.totals.withAccount} avec un compte actif. Le montant de chaque ligne est ce qu'il reste à lui verser aujourd'hui. Ouvrez « Employés & Personnel » pour le dossier complet de chacun.` },
      salaries:     { title: 'Salaires versés', icon: Banknote, subtitle: 'Chaque paiement de la période', rows: salaryRows, total: workforce.totals.salariesPaid, totalLabel: 'Total versé', note: `${money(workforce.totals.acomptes)} d'acomptes ont par ailleurs été avancés sur la période. Les salaires se corrigent depuis la fiche de l'employé concerné.` },
      brigades:     { title: 'Brigades — les ventes de carburant', icon: Fuel, subtitle: 'Chaque brigade, ses litres et ce qui est rentré', rows: brigadeRows, total: reports.carburant.fuelBrigades.reduce((s, b) => s + b.revenue, 0), totalLabel: "Chiffre d'affaires", note: `${reports.carburant.fuelLiters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L vendus. Le chiffre d'affaires du carburant vient des BRIGADES : les pistolets donnent les litres, la comptabilité de clôture dit ce qui est rentré en espèces, par TPE, en bons clients, et ce qui manque. Corrigez une brigade depuis l'écran Brigades.` },
      works:        { title: 'Travaux & prestations', icon: Car, subtitle: 'Lavages, vidanges et ventes restaurant / cafétéria de la période', rows: workRows, total: workRows.reduce((s, r) => s + r.amount, 0), totalLabel: 'Total facturé' },
      workingCapital: { title: 'Fonds de roulement', icon: Scale, subtitle: 'Chaque terme du calcul, ligne par ligne', rows: wcRows, total: workingCapital.workingCapital, totalLabel: 'Fonds de roulement', note: `Trésorerie ${money(workingCapital.treasuryTotal)} + créances ${money(workingCapital.receivablesTotal)} + stock ${money(workingCapital.stockValue)} − dettes ${money(workingCapital.payablesTotal)}. La trésorerie, ce sont les caisses (${money(workingCapital.cashTotal)}) et les comptes bancaires (${money(workingCapital.bankTotal)}). Les caisses sont les cinq tiroirs de l'écran Caisse Générale : ${money(workingCapital.activitiesCash)} dans les activités et ${money(workingCapital.financeCash)} en Finance. Le tiroir commun du grand livre en contient ${money(workingCapital.drawerCash)} — l'argent que les activités y ont déposé y dort aussi, et leurs caisses le portent déjà.` },
      stockSell:    { title: 'Stock au prix de vente', icon: TrendingUp, subtitle: "Ce que la réserve rapportera si tout part au prix affiché", rows: stockSellRows, total: stockValuation.sellValue, totalLabel: 'Valeur de vente', note: `Au prix d'achat la même réserve vaut ${money(stockValuation.buyValue)} : l'écart, ${money(stockValuation.margin)}, est une marge LATENTE — elle n'existe que si la marchandise se vend.` },
      cogs:         { title: 'Coût des marchandises vendues', icon: Layers, subtitle: 'Ce que les ventes de la période ont réellement coûté', rows: cogsRows, total: global.cogs, totalLabel: 'Coût total', note: `Ventes ${money(global.salesTotal)} − coût des marchandises ${money(global.cogs)} = marge brute ${money(global.grossMargin)}. C'est la part du prix de vente qui n'est PAS un gain : les litres achetés, les ingrédients, le prix d'achat des articles.` },
    };
  }, [global, reports, app, biz, range, dispatch, restaurantBiz, cafeteriaBiz, lavageBiz, inventaireLosses, inventaireLossTotal,
    treasury, workforce, workingCapital, stockValuation]);

  const activeReport: PartReport | null = PART_SECTIONS.includes(active)
    ? reports[active as 'carburant' | ModuleKey]
    : null;

  /**
   * Les employés de l'activité affichée, mais SEULEMENT quand c'est une activité
   * de service (Lavage & Vidange) : son rapport déplie alors, employé par
   * employé, les travaux de la période. Les pompistes et la cafétéria n'ont pas
   * de travaux nominatifs — leur activité se lit dans « Employés & Personnel ».
   */
  const serviceWorkers: WorkforceWorker[] = useMemo(() => {
    const key = active as ModuleKey;
    if (!MODULES[key]?.isService) return [];
    return workforce.workers.filter(w => w.part === key);
  }, [workforce, active]);
  const activeInfo = SECTIONS.find(s => s.id === active)!;
  const ActiveIcon = activeInfo.icon;

  /**
   * Deleting an achat from this report does the SAME full rollback as the Achats
   * Carburant screen: the litres delivered are taken back out of the cuves and
   * the règlements are refunded to the caisse / bank accounts. Dropping the row
   * alone used to leave the cuve levels permanently inflated.
   */
  const deletePurchase = (id: string) => {
    const purchase = (app.purchases || []).find((p: any) => p.id === id);
    if (!purchase) return;
    const deltas = deleteFuelPurchase(purchase, app, dispatch);
    const liters = litersOf(purchase);
    toast.success(deltas.length
      ? `Achat supprimé — ${liters.toLocaleString('fr-FR')} L retirés des cuves`
      : 'Achat supprimé');
  };

  /** Cuve levels an achat deletion would restore, shown in the confirm dialog. */
  const purchaseImpact = (id: string) => {
    const purchase = (app.purchases || []).find((p: any) => p.id === id);
    if (!purchase) return '';
    return describeTankDeltas(tankDeltasOf(purchase, -1), app.tanks || []);
  };

  const generate = () => setRange({ from, to });
  // The two cross-cutting sections have no dedicated printable sheet: they fall
  // back to the consolidated one, which already carries their headline numbers.
  const handlePrint = () => printFiche(activeReport ? moduleFicheRef.current : globalFicheRef.current);
  const handlePrintPurchases = () => printFiche(purchasesFicheRef.current);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">Rapports Généraux</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Bilan consolidé et détaillé de toutes les activités : carburant, restaurant, cafétéria et lavage & vidange.</p>
        </div>
        <button onClick={handlePrint} className="btn-primary h-14 px-10 text-[11px] uppercase tracking-[0.25em] italic font-black flex items-center gap-3 shrink-0">
          <Printer className="w-4 h-4" /> Imprimer {activeReport ? 'la fiche' : 'la fiche globale'}
        </button>
      </div>

      {/* Date range */}
      <div className="card-glass p-4 flex flex-wrap items-end gap-3">
        <div><label className="label-field">Date début</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field !w-auto" /></div>
        <div><label className="label-field">Date fin</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field !w-auto" /></div>
        <button className="btn-secondary" onClick={generate}><FileBarChart className="w-4 h-4" /> Générer</button>
        <span className="ml-auto text-xs text-slate-400 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(range.from)} → {formatDate(range.to)}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* ── Nav « Rapports Consolidés » ──────────────────────────────────────
            Elle se tenait en `sticky` sans jamais borner sa hauteur : passé une
            dizaine de sections, son bas passait SOUS le pied de page et devenait
            inatteignable. Elle se comporte maintenant comme la barre latérale de
            l'application — sa hauteur ne dépasse jamais l'écran, seule sa LISTE
            défile, et l'entête comme le pied restent en place. Le contenu, lui,
            défile normalement avec la page. */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl overflow-hidden shadow-xl flex flex-col lg:sticky lg:top-2 lg:max-h-[calc(100vh-5.5rem)]"
            style={{ background: 'linear-gradient(170deg, #001233 0%, #001f5c 35%, #003087 70%, #002470 100%)' }}>
            <div className="px-5 py-4 flex items-center gap-3 border-b border-white/10 shrink-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shrink-0" style={{ background: 'linear-gradient(135deg, #FFB800 0%, #e6a000 100%)' }}><FileBarChart className="w-5 h-5 text-[#001f5c]" /></div>
              <div className="min-w-0">
                <p className="text-white font-black text-sm leading-none truncate">Rapports</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,184,0,0.65)' }}>Consolidés</p>
              </div>
              <span className="ml-auto text-[10px] font-black tabular-nums text-white/30 shrink-0">{SECTIONS.length}</span>
            </div>
            {/* Seule cette liste défile — `min-h-0` est ce qui autorise un enfant
                flex à rétrécir sous sa hauteur naturelle et donc à défiler. */}
            <nav className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3 space-y-1">
              {SECTIONS.map(s => {
                const Icon = s.icon; const isActive = active === s.id;
                const rep = PART_SECTIONS.includes(s.id) ? reports[s.id as 'carburant' | ModuleKey] : null;
                // Chaque section porte SON chiffre : le gain d'une activité, la
                // trésorerie, le fonds de roulement… Une pastille vide ne dirait
                // rien, et un montant faux serait pire.
                const badge = rep
                  ? { text: money(rep.netGain).replace(' DA', ''), cls: rep.netGain >= 0 ? 'text-emerald-300' : 'text-red-300' }
                  : s.id === 'employes'
                    ? { text: `${workforce.totals.workers}`, cls: 'text-blue-200' }
                    : s.id === 'tresorerie'
                      ? { text: money(treasury.grandTotal).replace(' DA', ''), cls: treasury.grandTotal >= 0 ? 'text-emerald-300' : 'text-red-300' }
                      : s.id === 'fonds'
                        ? { text: money(workingCapital.workingCapital).replace(' DA', ''), cls: workingCapital.workingCapital >= 0 ? 'text-emerald-300' : 'text-red-300' }
                        : s.id === 'stock'
                          ? { text: money(stockValuation.buyValue).replace(' DA', ''), cls: 'text-amber-300' }
                          : s.id === 'inventaires'
                            ? { text: money(inventaireLossTotal).replace(' DA', ''), cls: inventaireLossTotal > 0 ? 'text-red-300' : 'text-emerald-300' }
                          : s.id === 'zakat'
                            ? { text: money(zakatInputs.caisse + zakatInputs.banques).replace(' DA', ''), cls: 'text-violet-200' }
                          : s.id === 'analyses'
                            ? { text: `${analytics.global.trendPct >= 0 ? '+' : ''}${analytics.global.trendPct.toFixed(0)}%`, cls: analytics.global.trendPct >= 0 ? 'text-emerald-300' : 'text-red-300' }
                            : s.id === 'global'
                              ? { text: money(global.netGain).replace(' DA', ''), cls: global.netGain >= 0 ? 'text-emerald-300' : 'text-red-300' }
                              : null;
                return (
                  <button key={s.id} onClick={() => setActive(s.id)} title={s.hint}
                    className={cn('w-full rounded-xl px-2.5 py-2 flex items-center gap-2.5 transition-all text-left group',
                      isActive
                        ? 'bg-[#FFB800] shadow-lg shadow-black/20'
                        : 'hover:bg-white/10 active:bg-white/15')}>
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                      isActive ? 'bg-[#001f5c]/15' : 'bg-white/[0.07] group-hover:bg-white/15')}>
                      <Icon className={cn('w-4 h-4', isActive ? 'text-[#001f5c]' : 'text-blue-200')} />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[13px] font-bold leading-tight truncate',
                        isActive ? 'text-[#001f5c]' : 'text-blue-50')}>{s.label}</span>
                      <span className={cn('block text-[10px] leading-tight truncate mt-0.5',
                        isActive ? 'text-[#001f5c]/60' : 'text-blue-300/50')}>{s.hint}</span>
                    </span>
                    {badge && (
                      <span className={cn('text-[10px] font-black tabular-nums shrink-0 px-1.5 py-0.5 rounded',
                        isActive ? 'text-[#001f5c] bg-black/10' : badge.cls)}>{badge.text}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            {/* Pied — les deux totaux que le gérant garde sous les yeux */}
            <div className="px-4 py-3.5 border-t border-white/10 space-y-2.5 shrink-0" style={{ background: 'rgba(0,0,0,0.2)' }}>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Gain net total</p>
                <p className={cn('text-xl font-black tabular-nums leading-tight', global.netGain >= 0 ? 'text-emerald-400' : 'text-red-400')}>{money(global.netGain)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
                  <p className="text-[9px] font-black uppercase tracking-wide text-white/40">Trésorerie</p>
                  <p className={cn('text-[12px] font-black tabular-nums leading-tight', treasury.grandTotal >= 0 ? 'text-[#FFB800]' : 'text-red-400')}>{money(treasury.grandTotal)}</p>
                </div>
                <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
                  <p className="text-[9px] font-black uppercase tracking-wide text-white/40">Employés</p>
                  <p className="text-[12px] font-black tabular-nums text-white leading-tight">{workforce.totals.workers}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Contenu ──────────────────────────────────────────────────────────
            Plus de hauteur imposée ni de zone à défilement interne : la section
            s'étend sur toute sa longueur et c'est la PAGE qui défile. On ne se
            retrouve donc plus à faire glisser une petite fenêtre à l'intérieur
            d'une grande. Seul l'entête reste collé pour dire où l'on est. */}
        <div className="lg:col-span-3 min-w-0">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden" style={{ boxShadow: 'var(--shadow-xl)' }}>
            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white px-6 lg:px-8 py-5 flex items-center gap-4 sticky top-0 z-10">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}><ActiveIcon className="w-4 h-4 text-yellow-400" /></div>
              <div className="min-w-0">
                <h2 className="font-black text-sm uppercase tracking-widest italic leading-none truncate">{activeInfo.label}</h2>
                <p className="text-[10px] text-blue-200 mt-0.5 font-bold truncate">{activeInfo.hint}</p>
              </div>
              <span className="ml-auto text-[10px] font-bold text-blue-200/70 tabular-nums whitespace-nowrap hidden sm:block">
                {formatDate(range.from)} → {formatDate(range.to)}
              </span>
            </div>
            <div className="p-5 sm:p-6 lg:p-8">
              <AnimatePresence mode="wait">
                <motion.div key={active} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {active === 'global' && <GlobalOverview global={global} workforce={workforce} treasury={treasury} workingCapital={workingCapital} stock={stockValuation} inventaires={inventaireParts} inventaireLossTotal={inventaireLossTotal} onSelect={setActive} onOpenPurchases={() => setShowPurchases(true)} onOpenCard={setActiveCard} onOpenCaisse={() => setShowCaisse(true)} />}
                  {active === 'analyses' && <GlobalAnalyticsView parts={analytics.parts} global={analytics.global} onGranularity={setGrain} />}
                  {active === 'fonds' && <WorkingCapitalView report={workingCapital} />}
                  {active === 'stock' && <StockValueView valuation={stockValuation} />}
                  {active === 'inventaires' && <InventaireReportView parts={inventaireParts} />}
                  {active === 'zakat' && <ZakatView inputs={zakatInputs} config={zakatConfig} onConfig={setZakatConfig} />}
                  {active === 'employes' && <WorkforceView report={workforce} />}
                  {active === 'tresorerie' && <TreasuryView report={treasury} />}
                  {activeReport && <ReportView report={activeReport} serviceWorkers={serviceWorkers} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Achats carburant — détail complet + impression */}
      <PurchasesDetailModal
        open={showPurchases}
        onClose={() => setShowPurchases(false)}
        purchases={fuelPurchases}
        range={range}
        onPrint={handlePrintPurchases}
        onDelete={deletePurchase}
        impactOf={purchaseImpact}
      />

      {/* Drill-down d'une carte KPI — liste détaillée + suppression */}
      <CardDetailModal
        detail={activeCard ? cardDetails[activeCard] : null}
        onClose={() => setActiveCard(null)}
      />

      {/* Le solde de la caisse générale, expliqué mouvement par mouvement */}
      <CaisseDetailModal
        open={showCaisse}
        onClose={() => setShowCaisse(false)}
        detail={treasury.caisseDetail}
        from={range.from}
        to={range.to}
      />

      {/* Off-screen printable fiches */}
      <GlobalFiche ref={globalFicheRef} global={global} settings={settings} />
      {activeReport && <ModuleFiche ref={moduleFicheRef} report={activeReport} settings={settings} />}
      <PurchasesFiche ref={purchasesFicheRef} purchases={fuelPurchases} from={range.from} to={range.to} settings={settings} />
    </div>
  );
}

// ─── Global overview ─────────────────────────────────────────────────────────
function OverviewCard({ icon: Icon, label, value, sub, tone = 'blue', onClick, cta }: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: string; onClick?: () => void; cta?: string; key?: React.Key }) {
  const tones: Record<string, string> = { blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-yellow-500', purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600', slate: 'from-slate-500 to-slate-600' };
  const inner = (
    <>
      <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}><Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} /></div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
      {onClick && (
        <p className="text-[11px] font-black text-[#003087] mt-1.5 flex items-center gap-1">
          {cta || 'Voir le détail'} <ChevronRight className="w-3 h-3" />
        </p>
      )}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick}
        className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm text-left w-full transition-all hover:border-[#003087]/40 hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#003087]/20 cursor-pointer">
        {inner}
      </button>
    );
  }
  return <div className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm">{inner}</div>;
}

/**
 * Bandeau de tête du rapport global : les trois totaux de la période — ventes,
 * dépenses, gain — suivis du calcul qui mène de l'un à l'autre.
 *
 * Le gain affiché n'est JAMAIS le montant encaissé : une part vendue 30 DA dont
 * les ingrédients ont coûté 12 DA rapporte 18 DA. Le coût des marchandises est
 * donc montré explicitement entre les ventes et la marge.
 */
function ResultBand({ salesTotal, cogs, grossMargin, chargesTotal, destroyedValue, lossValue, netGain, salesCount, onOpenCard }: {
  salesTotal: number; cogs: number; grossMargin: number; chargesTotal: number;
  destroyedValue: number; lossValue: number; netGain: number; salesCount: number;
  onOpenCard: (k: CardKey) => void;
}) {
  const positive = netGain >= 0;
  const steps: { label: string; value: number; sign: '' | '−' | '='; tone: string }[] = [
    { label: 'Ventes encaissées', value: salesTotal, sign: '', tone: 'text-emerald-700' },
    { label: 'Coût des marchandises vendues', value: cogs, sign: '−', tone: 'text-amber-700' },
    { label: 'Marge brute', value: grossMargin, sign: '=', tone: 'text-blue-700' },
    { label: 'Dépenses + salaires', value: chargesTotal, sign: '−', tone: 'text-red-600' },
    ...(destroyedValue > 0 ? [{ label: 'Destructions', value: destroyedValue, sign: '−' as const, tone: 'text-red-600' }] : []),
    ...(lossValue > 0 ? [{ label: 'Pertes de production', value: lossValue, sign: '−' as const, tone: 'text-red-600' }] : []),
    { label: 'Gain net', value: netGain, sign: '=', tone: positive ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="space-y-3">
      {/* Les trois totaux */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={() => onOpenCard('salesTotal')}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <TrendingUp className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total des ventes</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(salesTotal)}</p>
          <p className="text-[11px] text-emerald-100 mt-0.5">{salesCount} opération(s) — voir le détail →</p>
        </button>

        <button onClick={() => onOpenCard('expenses')}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
          <div className="flex items-center gap-2 text-red-100">
            <CreditCard className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total des dépenses</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(chargesTotal)}</p>
          <p className="text-[11px] text-red-100 mt-0.5">Dépenses + salaires — voir le détail →</p>
        </button>

        <button onClick={() => onOpenCard('netGain')}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: positive ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
          <div className="flex items-center gap-2" style={{ color: positive ? 'rgba(255,184,0,0.85)' : '#fecaca' }}>
            <CircleDollarSign className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total des gains</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5" style={{ color: positive ? '#FFB800' : '#fff' }}>{money(netGain)}</p>
          <p className="text-[11px] mt-0.5" style={{ color: positive ? 'rgba(255,255,255,0.7)' : '#fecaca' }}>
            Bénéfice réel, coût des produits déduit →
          </p>
        </button>
      </div>

      {/* Le calcul, étape par étape */}
      <div className="card-glass p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Comment le gain est calculé</p>
        <div className="flex flex-wrap items-stretch gap-2">
          {steps.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <span className="self-center text-slate-300 font-black text-lg px-0.5">{s.sign}</span>}
              <div className={cn('rounded-xl px-3 py-2 flex-1 min-w-[130px]', s.sign === '=' ? 'bg-slate-100' : 'bg-slate-50')}>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">{s.label}</p>
                <p className={cn('font-black tabular-nums text-sm mt-0.5', s.tone)}>{money(s.value)}</p>
              </div>
            </React.Fragment>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 italic mt-3">
          Un produit vendu {money(30)} qui a coûté {money(12)} à fabriquer ou à acheter rapporte {money(18)} :
          c'est ce montant-là qui alimente « Total des gains », jamais le prix de vente entier.
        </p>
      </div>
    </div>
  );
}

/**
 * Les dépenses de la période, activité par activité — avec, pour chacune, ce
 * qui est sorti de son tiroir en espèces, ce qui est parti d'un compte
 * bancaire, et ce qu'il reste dans sa caisse.
 *
 * C'est la lecture directe de la règle : une dépense payée en espèces sort de
 * la caisse de l'activité qui la supporte, jamais de la caisse générale.
 */
function PartExpensesBand({ parts, treasury: tr, onOpenCard, onSelect }: {
  parts: PartReport[];
  treasury: TreasuryReport;
  onOpenCard: (k: CardKey) => void;
  onSelect: (k: ActiveKey) => void;
}) {
  const rows = parts.map(p => {
    const own = p.expenses.filter(e => e.kind === 'Dépense');
    const cash = own.filter(e => e.paidInCash !== false).reduce((s, e) => s + e.amount, 0);
    const bank = own.reduce((s, e) => s + e.amount, 0) - cash;
    const caisse = tr.partBalances.find(b => b.key === p.key)?.balance ?? p.caisseBalance;
    return { ...p, count: own.length, cash, bank, caisse };
  });
  const total = rows.reduce((s, r) => s + r.expensesTotal, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-[#FFB800]" /> Dépenses par activité
        </h3>
        <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onOpenCard('expenses')}>
          Chaque dépense →
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {rows.map(r => (
          <button key={r.key} onClick={() => onSelect(r.key as ActiveKey)}
            className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-all hover:border-[#003087]/40 hover:-translate-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{r.emoji} {r.label}</span>
              <span className="text-[10px] text-slate-400">{r.count} dépense(s)</span>
            </div>
            <p className="text-2xl font-black tabular-nums text-red-600 mt-1">{money(r.expensesTotal)}</p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-xl bg-slate-50 p-2">
                <p className="text-[10px] uppercase font-bold text-slate-400">Espèces (sa caisse)</p>
                <p className="font-black tabular-nums text-sm text-slate-700">{money(r.cash)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <p className="text-[10px] uppercase font-bold text-slate-400">Banque</p>
                <p className="font-black tabular-nums text-sm text-slate-700">{money(r.bank)}</p>
              </div>
            </div>
            <p className={cn('text-[11px] font-black tabular-nums mt-2', r.caisse >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              Caisse {r.label} : {money(r.caisse)}
            </p>
            {r.salariesPaid > 0 && (
              <p className="text-[11px] text-amber-600 tabular-nums">+ {money(r.salariesPaid)} de salaires versés</p>
            )}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 italic">
        Total des dépenses de la période : {money(total)}. Une dépense payée en espèces sort de la caisse de
        l'activité qui la supporte ; réglée par la banque, elle est débitée du compte choisi.
      </p>
    </div>
  );
}

function GlobalOverview({ global: g, workforce: wf, treasury: tr, workingCapital: wc, stock: sv, inventaires: invs, inventaireLossTotal, onSelect, onOpenPurchases, onOpenCard, onOpenCaisse }: {
  global: GlobalReport;
  workforce: ReturnType<typeof computeWorkforce>;
  treasury: ReturnType<typeof computeTreasuryReport>;
  workingCapital: ReturnType<typeof computeWorkingCapital>;
  stock: ReturnType<typeof computeStockValuation>;
  inventaires: ReturnType<typeof summarizeInventaires>[];
  inventaireLossTotal: number;
  onSelect: (k: ActiveKey) => void;
  onOpenPurchases: () => void;
  onOpenCard: (k: CardKey) => void;
  /** Ouvre le détail complet du solde de la caisse générale. */
  onOpenCaisse: () => void;
}) {
  const chargesTotal = g.expensesTotal + g.salariesPaid;
  return (
    <div className="space-y-8">
      {/* Les trois chiffres que le gérant vient chercher : ce qui est entré, ce
          qui est sorti, et ce qui reste réellement dans la poche. */}
      <ResultBand
        salesTotal={g.salesTotal} cogs={g.cogs} grossMargin={g.grossMargin}
        chargesTotal={chargesTotal} destroyedValue={g.destroyedValue} lossValue={g.lossValue}
        netGain={g.netGain} salesCount={g.counts.sales}
        onOpenCard={onOpenCard}
      />

      {/* KPI cards — chaque carte est cliquable et ouvre le détail de son calcul */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OverviewCard icon={TrendingUp} tone="green" label="Ventes totales" value={money(g.salesTotal)} sub={`${g.counts.sales} opérations`} onClick={() => onOpenCard('salesTotal')} cta="Voir le détail" />
        {/* Achats de la période : ce qui a été facturé, ce qui a été réglé, et ce
            qui reste dû. La carte n'annonçait que le total facturé — impossible
            d'y lire qu'une partie n'était pas payée. */}
        <OverviewCard icon={ShoppingCart} tone="purple" label="Achats totaux" value={money(g.purchasesTotal)}
          sub={`${g.counts.purchases} facture(s) · payé ${money(g.purchasesPaid)}`
            + (g.purchasesDebt > 0 ? ` · dette ${money(g.purchasesDebt)}` : ' · soldées')}
          onClick={onOpenPurchases} cta="Détail par carburant" />
        <OverviewCard icon={CreditCard} tone="red" label="Dépenses + salaires" value={money(chargesTotal)} sub={`Dépenses ${money(g.expensesTotal)} · salaires ${money(g.salariesPaid)}`} onClick={() => onOpenCard('expenses')} cta="Voir le détail" />
        {/* Le coût des marchandises vendues : la part du prix de vente qui n'est
            pas un gain (les ingrédients, le prix d'achat, les litres achetés). */}
        <OverviewCard icon={Layers} tone="amber" label="Coût marchandises" value={money(g.cogs)} sub={`Marge brute ${money(g.grossMargin)}`} onClick={() => onOpenCard('cogs')} cta="Détail par produit" />
        <OverviewCard icon={Boxes} tone="amber" label="Valeur du stock" value={money(g.stockValue)} sub={`${g.counts.products} produits`} onClick={() => onOpenCard('stockValue')} cta="Voir le détail" />
        <OverviewCard icon={Flame} tone="red" label="Destructions" value={money(g.destroyedValue)} sub="marchandise perdue" onClick={() => onOpenCard('destructions')} cta="Voir le détail" />
        {/* Pertes d'inventaire : la marchandise qui manquait au comptage, que
            personne n'a déclarée cassée ou périmée. C'est elle qui peut être
            retenue sur la paie des employés concernés. */}
        <OverviewCard icon={PackageX} tone="red" label="Pertes d'inventaire" value={money(inventaireLossTotal)}
          sub={`${invs.reduce((s, p) => s + p.inventaires.filter(i => !!i.comparison).length, 0)} inventaire(s) comparé(s)`}
          onClick={() => onOpenCard('pertes')} cta="Voir le détail" />
        <OverviewCard icon={Users} tone="red" label="Dettes clients" value={money(g.clientDebtTotal)} onClick={() => onOpenCard('clientDebt')} cta="Voir le détail" />
        <OverviewCard icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(g.supplierDebtTotal)}
          sub="Factures non soldées, toutes dates" onClick={() => onOpenCard('supplierDebt')} cta="Voir le détail" />
        <OverviewCard icon={AlertTriangle} tone="cyan" label="Alertes" value={`${g.stockAlerts + g.expiryAlerts}`} sub={`${g.stockAlerts} stock · ${g.expiryAlerts} exp.`} onClick={() => onOpenCard('alerts')} cta="Voir le détail" />
        {/* Ventes annulées : elles ne sont NI dans le CA NI dans les gains.
            La carte n'apparaît que s'il y en a eu sur la période. */}
        {g.counts.returns > 0 && (
          <OverviewCard icon={Undo2} tone="slate" label="Retours & échanges" value={money(g.returnsTotal)}
            sub={`${g.counts.returns} vente(s) annulée(s) · ${money(g.refundedTotal)} remboursé(s)`}
            onClick={() => onOpenCard('returns')} cta="Voir le détail" />
        )}
      </div>

      {/* Qui paie quoi — chaque activité avec SES dépenses et le tiroir qui les
          a payées. La question n'avait jusqu'ici aucune réponse à l'écran : les
          dépenses étaient un total unique, sans activité derrière. */}
      <PartExpensesBand parts={g.parts} treasury={tr} onOpenCard={onOpenCard} onSelect={onSelect} />

      {/* Ce que la station possède vraiment : le fonds de roulement, la valeur du
          stock aux deux prix, et l'accès direct au calcul de la zakât. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><Scale className="w-5 h-5 text-[#FFB800]" /> Situation financière</h3>
          <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onSelect('fonds')}>Fonds de roulement →</button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <OverviewCard icon={Scale} tone={wc.workingCapital >= 0 ? 'green' : 'red'} label="Fonds de roulement"
            value={money(wc.workingCapital)}
            sub={`Trésorerie ${money(wc.treasuryTotal)} + créances + stock ${money(wc.stockValue)} − dettes`}
            onClick={() => onOpenCard('workingCapital')} cta="Chaque ligne du calcul" />
          <OverviewCard icon={Boxes} tone="amber" label="Stock au prix d'achat" value={money(sv.buyValue)}
            sub={`${sv.count} référence(s)`} onClick={() => onOpenCard('stockValue')} cta="Voir le détail" />
          <OverviewCard icon={TrendingUp} tone="blue" label="Stock au prix de vente" value={money(sv.sellValue)}
            sub={`Marge latente ${money(sv.margin)}`} onClick={() => onOpenCard('stockSell')} cta="Voir le détail" />
          <OverviewCard icon={Moon} tone="purple" label="Zakât" value="Calculer"
            sub="Assiette, nisâb et taux paramétrables" onClick={() => onSelect('zakat')} cta="Ouvrir le calcul" />
        </div>
      </div>

      {/* Trésorerie — raccourci vers la section dédiée */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><PiggyBank className="w-5 h-5 text-[#FFB800]" /> Trésorerie de la station</h3>
          <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onSelect('tresorerie')}>Tout le détail →</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Le solde de la caisse ouvre son propre calcul : ouverture, entrées,
              sorties, puis chaque mouvement. Un découvert passe au rouge et le
              dit — affiché en doré comme les autres, il ne s'expliquait pas. */}
          <button onClick={onOpenCaisse} className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
            style={{ background: tr.caisseBalance < 0 ? 'linear-gradient(135deg,#7f1d1d,#b91c1c)' : 'linear-gradient(135deg,#001f5c,#003087)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className={cn('flex items-center gap-2', tr.caisseBalance < 0 ? 'text-red-100' : 'text-blue-200')}>
                <PiggyBank className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Caisse générale</span>
              </div>
              {tr.caisseBalance < 0 && <span className="badge badge-danger shrink-0">Découvert</span>}
            </div>
            <p className={cn('text-3xl font-black tabular-nums mt-1.5', tr.caisseBalance < 0 ? 'text-white' : 'text-[#FFB800]')}>{money(tr.caisseBalance)}</p>
            <p className={cn('text-[11px] mt-0.5 tabular-nums', tr.caisseBalance < 0 ? 'text-red-100' : 'text-blue-200')}>
              Ouverture {money(tr.caisseOpening)} · +{money(tr.caisseIn)} · −{money(tr.caisseOut)}
            </p>
            <p className={cn('text-[11px] font-black mt-1.5 flex items-center gap-1', tr.caisseBalance < 0 ? 'text-white' : 'text-[#FFB800]')}>
              Voir le détail du calcul <ChevronRight className="w-3 h-3" />
            </p>
          </button>
          <button onClick={() => onOpenCard('banks')} className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
            <div className="flex items-center gap-2 text-emerald-100"><Landmark className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total en banque</span></div>
            <p className="text-3xl font-black tabular-nums mt-1.5">{money(tr.bankTotal)}</p>
            <p className="text-[11px] text-emerald-100 mt-0.5 tabular-nums">
              Ouverture {money(tr.bankOpening)} · +{money(tr.bankIn)} · −{money(tr.bankOut)}
            </p>
            <p className="text-[11px] font-black mt-1.5 flex items-center gap-1 text-emerald-100">
              {tr.counts.accounts} compte(s) — voir le détail <ChevronRight className="w-3 h-3" />
            </p>
          </button>
          <button onClick={() => onOpenCard('flux')} className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#4c1d95,#6d28d9)' }}>
            <div className="flex items-center gap-2 text-violet-200"><Layers className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Flux net de la période</span></div>
            <p className="text-3xl font-black tabular-nums mt-1.5">{money(tr.net)}</p>
            <p className="text-[11px] text-violet-200 mt-0.5 tabular-nums">+{money(tr.inflow)} · −{money(tr.outflow)}</p>
            <p className="text-[11px] font-black mt-1.5 flex items-center gap-1 text-violet-200">
              {tr.counts.movements} opérations — voir le journal <ChevronRight className="w-3 h-3" />
            </p>
          </button>
        </div>
      </div>

      {/* Personnel — raccourci vers la section dédiée */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><UsersRound className="w-5 h-5 text-[#FFB800]" /> Personnel de la station</h3>
          <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onSelect('employes')}>Dossier de chaque employé →</button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <OverviewCard icon={UsersRound} tone="blue" label="Employés" value={String(wf.totals.workers)} sub={`${wf.totals.withAccount} compte(s) actif(s)`} onClick={() => onOpenCard('workers')} cta="Voir le détail" />
          <OverviewCard icon={Banknote} tone="green" label="Salaires versés" value={money(wf.totals.salariesPaid)} sub={`${money(wf.totals.acomptes)} d'acomptes`} onClick={() => onOpenCard('salaries')} cta="Chaque paiement" />
          <OverviewCard icon={Target} tone="purple" label="Brigades couvertes" value={String(wf.totals.brigades)} sub={`${wf.totals.liters.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L vendus`} onClick={() => onOpenCard('brigades')} cta="Voir les brigades" />
          <OverviewCard icon={Car} tone="cyan" label="Travaux lavage / vidange" value={String(wf.totals.works)} sub={`${wf.totals.sessions} sessions cafétéria`} onClick={() => onOpenCard('works')} cta="Voir le détail" />
        </div>
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="table-head">Activité</th><th className="table-head text-right">Employés</th>
                <th className="table-head text-right">Salaires versés</th><th className="table-head text-right">Acomptes</th>
                <th className="table-head text-right">Absences</th><th className="table-head text-right">Activité</th>
                <th className="table-head text-right">Parts à régler</th>
              </tr></thead>
              <tbody>
                {wf.parts.map(p => (
                  <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect('employes')}>
                    <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
                    <td className="table-cell tabular-nums text-right font-bold">{p.count}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.salariesPaid)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(p.acomptes)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{money(p.absences)}</td>
                    <td className="table-cell tabular-nums text-right text-blue-700">{p.activityValue} {p.activityLabel.toLowerCase()}</td>
                    <td className={cn('table-cell tabular-nums text-right font-black', p.dueNow > 0 ? 'text-red-600' : 'text-slate-400')}>{money(p.dueNow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Comparatif par activité — le coût des marchandises est affiché à côté des
          ventes pour que le gain de chaque activité se lise de bout en bout. */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><FileBarChart className="w-5 h-5 text-[#FFB800]" /> Comparatif par activité</h3>
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="table-head">Activité</th><th className="table-head text-right">Ventes</th><th className="table-head text-right">Achats</th>
                <th className="table-head text-right">Coût marchand.</th>
                {/* Dépenses et salaires séparés : les deux étaient additionnés
                    dans une seule colonne, impossible d'y lire ce que l'activité
                    avait réellement dépensé. */}
                <th className="table-head text-right">Dépenses</th><th className="table-head text-right">Salaires</th>
                <th className="table-head text-right">Marge brute</th>
                <th className="table-head text-right">Dettes clients</th><th className="table-head text-right">Gain net</th><th className="table-head" />
              </tr></thead>
              <tbody>
                {g.parts.map(p => (
                  <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect(p.key as ActiveKey)}>
                    <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.salesTotal)}</td>
                    <td className="table-cell tabular-nums text-right">{money(p.purchasesTotal)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(p.cogs)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{money(p.expensesTotal)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-600">{money(p.salariesPaid)}</td>
                    <td className="table-cell tabular-nums text-right text-blue-700">{money(p.grossMargin)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-600">{money(p.clientDebtTotal)}</td>
                    <td className={cn('table-cell tabular-nums text-right font-black', p.netGain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.netGain)}</td>
                    <td className="table-cell text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
                  </tr>
                ))}
                <tr className="bg-blue-50/60">
                  <td className="table-cell font-black text-[#002d87]">TOTAL</td>
                  <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(g.salesTotal)}</td>
                  <td className="table-cell tabular-nums text-right font-black">{money(g.purchasesTotal)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(g.cogs)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-red-600">{money(g.expensesTotal)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-amber-600">{money(g.salariesPaid)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(g.grossMargin)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-amber-600">{money(g.clientDebtTotal)}</td>
                  <td className={cn('table-cell tabular-nums text-right font-black', g.netGain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(g.netGain)}</td>
                  <td className="table-cell" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 italic">Cliquez une activité pour afficher son rapport détaillé (ventes, achats, dettes, alertes, employés…).</p>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[['Produits', g.counts.products], ['Clients', g.counts.clients], ['Fournisseurs', g.counts.suppliers], ['Ventes', g.counts.sales], ['Achats', g.counts.purchases], ['Employés', g.counts.workers]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-slate-100 p-3 text-center"><p className="text-2xl font-black text-[#002d87] tabular-nums">{v as number}</p><p className="text-[11px] font-bold uppercase text-slate-400">{k}</p></div>
        ))}
      </div>
    </div>
  );
}

// ─── Card drill-down — detail list of one KPI card, with per-row delete ────────
const AMOUNT_TONE: Record<string, string> = {
  green: 'text-emerald-600', red: 'text-red-600', blue: 'text-blue-700', amber: 'text-amber-600', slate: 'text-slate-700',
};

function CardDetailModal({ detail, onClose }: { detail: CardDetail | null; onClose: () => void }) {
  const [confirmRow, setConfirmRow] = useState<DetailRow | null>(null);
  /** Recherche libre — certaines listes dépassent la centaine de lignes. */
  const [query, setQuery] = useState('');
  // Drop any pending confirmation (and the search) when the opened card changes.
  useEffect(() => { setConfirmRow(null); setQuery(''); }, [detail]);

  const rows = useMemo(() => {
    if (!detail) return [] as DetailRow[];
    if (!query.trim()) return detail.rows;
    return detail.rows.filter((r: DetailRow) =>
      matchesSearch(query, r.label, r.sub, r.badge?.text));
  }, [detail, query]);

  if (!detail) return null;
  const Icon = detail.icon;
  const deletable = detail.rows.some(r => r.onDelete);
  // Le total du filtre, à côté du total général : on voit ce que la recherche
  // pèse dans l'ensemble sans avoir à faire l'addition soi-même.
  const shownTotal = rows.reduce((s, r) => s + r.amount, 0);
  const filtered = rows.length !== detail.rows.length;
  const credits = detail.rows.filter(r => r.amount > 0).length;
  const debits = detail.rows.filter(r => r.amount < 0).length;

  return (
    <Modal open onClose={onClose} icon={Icon} size="2xl" fullHeight
      title={detail.title} subtitle={detail.subtitle || `${detail.rows.length} ligne(s)`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-2 text-sm font-black text-[#002d87]">
            <span className="text-slate-400 font-bold text-xs uppercase tracking-wide">{detail.totalLabel}</span> {money(detail.total)}
          </span>
          {filtered && (
            <span className="flex items-center gap-2 text-xs font-black text-[#003087]">
              <span className="text-slate-400 font-bold uppercase tracking-wide">Filtré</span>
              {rows.length} ligne(s) · {money(shownTotal)}
            </span>
          )}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
      </>}>
      <div className="space-y-4">
        {/* Bandeau de tête : ce que la liste contient, en un coup d'œil */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-info">{detail.rows.length} ligne(s)</span>
          {credits > 0 && <span className="badge badge-success">{credits} en entrée</span>}
          {debits > 0 && <span className="badge badge-danger">{debits} en sortie</span>}
          {deletable && <span className="badge badge-warning">Lignes supprimables</span>}
          {detail.rows.length > 8 && (
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher dans la liste…"
              className="input-field !w-auto ml-auto !h-9 text-xs min-w-[200px]" />
          )}
        </div>

        {detail.note && <p className="text-[11px] text-slate-400 italic px-1 leading-relaxed">{detail.note}</p>}

        {detail.rows.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
            <FileBarChart className="w-10 h-10 mx-auto mb-3 text-slate-200" />
            <p className="text-sm font-bold text-slate-400">Aucune ligne sur cette période.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
            <FileBarChart className="w-10 h-10 mx-auto mb-3 text-slate-200" />
            <p className="text-sm font-bold text-slate-400">Aucune ligne ne correspond à « {query} ».</p>
          </div>
        ) : (
          <Table head={<>
            <th className="table-head">Date</th>
            <th className="table-head">Libellé</th>
            <th className="table-head text-right">Montant</th>
            {deletable && <th className="table-head text-right">Action</th>}
          </>}>
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="table-cell whitespace-nowrap text-slate-500">{r.date ? formatDate(r.date) : '—'}</td>
                <td className="table-cell">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-700">{r.label}</span>
                    {r.badge && <Badge tone={r.badge.tone}>{r.badge.text}</Badge>}
                  </div>
                  {r.sub && <div className="text-[11px] text-slate-400 leading-relaxed">{r.sub}</div>}
                </td>
                <td className={cn('table-cell text-right tabular-nums font-black', AMOUNT_TONE[r.amountTone || 'slate'])}>{money(r.amount)}</td>
                {deletable && (
                  <td className="table-cell text-right">
                    {r.onDelete
                      ? <button onClick={() => setConfirmRow(r)} title="Supprimer"
                          className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all"><Trash2 className="w-4 h-4" /></button>
                      : <span className="text-[10px] text-slate-300 italic pr-2">calculé</span>}
                  </td>
                )}
              </tr>
            ))}
            <tr className="bg-blue-50/60">
              <td className="table-cell" />
              <td className="table-cell font-black text-[#002d87]">
                {filtered ? `TOTAL AFFICHÉ — ${rows.length} sur ${detail.rows.length} ligne(s)` : `TOTAL — ${detail.totalLabel.toLowerCase()}`}
              </td>
              <td className="table-cell text-right tabular-nums font-black text-[#002d87]">{money(filtered ? shownTotal : detail.total)}</td>
              {deletable && <td className="table-cell" />}
            </tr>
          </Table>
        )}
      </div>

      <Confirm open={!!confirmRow} title="Confirmer la suppression"
        message={confirmRow?.confirmMessage || 'Supprimer cette ligne ?'}
        onConfirm={() => { confirmRow?.onDelete?.(); setConfirmRow(null); }}
        onCancel={() => setConfirmRow(null)} />
    </Modal>
  );
}

// ─── Achats carburant — détail complet (drill-down du carte « Achats totaux ») ──
const PURCHASE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  'Payé': 'success',
  'Dette partielle': 'warning', 'Dette': 'danger',
  // Libellés historiques des mêmes situations.
  'Partiel': 'warning', 'À payer': 'danger',
  'En attente livraison': 'neutral',
};
const PAY_MODE_TONE: Record<string, string> = {
  ESPECES: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  CHEQUE: 'text-blue-700 bg-blue-50 border-blue-200',
  VIREMENT: 'text-purple-700 bg-purple-50 border-purple-200',
};

/** Habillage (couleurs) d'un carburant dans le détail à l'écran. */
const FUEL_TONE: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  ESSENCE: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: '#16a34a' },
  GASOIL:  { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: '#d97706' },
  GPL:     { text: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', dot: '#7c3aed' },
  DIESEL:  { text: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200', dot: '#0e7490' },
  SUPER:   { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: '#dc2626' },
  AUTRE:   { text: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200', dot: '#475569' },
};

/**
 * Une section de carburant dans le détail « Achats totaux » : l'entête avec ses
 * totaux, le récapitulatif des règlements par mode, puis la liste de ses achats.
 * Chaque ligne se déroule pour montrer ses règlements un par un (compte débité,
 * n° de chèque / bordereau) — l'information de paiement que le gérant recherche.
 */
function FuelTypeSection({ group: g, expanded, onToggle, onDelete }: {
  group: FuelTypeGroup;
  expanded: string | null;
  onToggle: (key: string) => void;
  onDelete: (id: string) => void;
  key?: React.Key;
}) {
  const tone = FUEL_TONE[g.type] || FUEL_TONE.AUTRE;
  return (
    <section className="rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
      {/* Entête du carburant */}
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 border-b', tone.bg, tone.border)}>
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: tone.dot }}>
            <Fuel className="w-4 h-4" />
          </span>
          <div>
            <p className={cn('font-black text-sm leading-none', tone.text)}>{g.label}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide mt-0.5">
              {g.count} achat(s) · {g.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">Total {money(g.total)}</span>
          <span className="text-emerald-600">Payé {money(g.paid)}</span>
          {g.rest > 0 && <span className="text-red-600">Reste {money(g.rest)}</span>}
        </div>
      </div>

      {/* Récapitulatif des règlements par mode — pour ce carburant */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 bg-white border-b border-slate-100">
        {Object.entries(g.paymentsByMode).map(([mode, agg]) => (
          <span key={mode} className={cn('badge border', PAY_MODE_TONE[mode] || 'text-slate-600 bg-white border-slate-200')}>
            {PAY_MODE_LABEL[mode] || mode} · {money(agg.amount)} ({agg.count})
          </span>
        ))}
        {g.rest > 0 && <span className="badge badge-danger">Dette {money(g.rest)}</span>}
        {Object.keys(g.paymentsByMode).length === 0 && g.rest <= 0 && (
          <span className="text-[11px] text-slate-400 italic">Aucun règlement enregistré.</span>
        )}
      </div>

      {/* Liste des achats de ce carburant */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="table-head">N° achat</th>
            <th className="table-head">Date</th>
            <th className="table-head">Fournisseur</th>
            <th className="table-head">Cuve</th>
            <th className="table-head text-right">Quantité</th>
            <th className="table-head">Paiement</th>
            <th className="table-head text-right">Total</th>
            <th className="table-head text-right">Payé</th>
            <th className="table-head text-right">Reste</th>
            <th className="table-head">Statut</th>
            <th className="table-head text-right">Action</th>
          </tr></thead>
          <tbody>
            {g.slices.map((s, i) => {
              const key = `${g.type}:${s.id}`;
              const isOpen = expanded === key;
              return (
                <React.Fragment key={key}>
                  <tr className="hover:bg-slate-50 cursor-pointer border-t border-slate-100" onClick={() => onToggle(key)}>
                    <td className="table-cell font-black text-[#002d87] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <ChevronRight className={cn('w-3.5 h-3.5 text-slate-300 transition-transform', isOpen && 'rotate-90')} />
                        {s.ref}
                        {s.multiType && <span title="Achat multi-carburants — réparti au prorata de la valeur livrée" className="text-[10px] font-black text-amber-500">*</span>}
                      </span>
                    </td>
                    <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(s.date)}</td>
                    <td className="table-cell">{s.supplier}</td>
                    <td className="table-cell text-xs text-slate-500 max-w-[170px]">{s.cuves || '—'}</td>
                    <td className="table-cell text-right tabular-nums font-bold">{s.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</td>
                    <td className="table-cell">
                      <div className="flex flex-wrap gap-1">
                        {s.payments.length === 0
                          ? <span className="badge badge-danger">Dette</span>
                          : Array.from(new Set(s.payments.map(pay => pay.mode))).map(mode => (
                            <span key={mode} className={cn('badge border', PAY_MODE_TONE[mode] || 'text-slate-600 bg-white border-slate-200')}>
                              {PAY_MODE_LABEL[mode] || mode}
                            </span>
                          ))}
                      </div>
                      {s.payments.length > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]">{payInfoOf(s)}</div>
                      )}
                    </td>
                    <td className="table-cell text-right tabular-nums font-black">{money(s.total)}</td>
                    <td className="table-cell text-right tabular-nums text-emerald-600">{money(s.paid)}</td>
                    <td className="table-cell text-right tabular-nums text-red-600">{money(s.rest)}</td>
                    <td className="table-cell"><Badge tone={PURCHASE_STATUS_TONE[s.status] || 'neutral'}>{s.status}</Badge></td>
                    <td className="table-cell text-right">
                      <button onClick={e => { e.stopPropagation(); onDelete(s.id); }} title="Supprimer cet achat"
                        className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td colSpan={11} className="bg-slate-50/70 px-4 py-4">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1">
                          <CreditCard className="w-3.5 h-3.5" /> Règlements & modes de paiement
                        </p>
                        {s.payments.length === 0 ? (
                          <p className="text-xs text-slate-400 italic px-1">Aucun règlement — achat enregistré en dette.</p>
                        ) : (
                          <div className="space-y-2">
                            {s.payments.map((pay, j) => (
                              <div key={j} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                                <span className={cn('badge border', PAY_MODE_TONE[pay.mode] || 'text-slate-600 bg-white border-slate-200')}>
                                  {PAY_MODE_LABEL[pay.mode] || pay.mode}
                                </span>
                                <span className="text-xs text-slate-500 flex items-center gap-1"><Wallet className="w-3 h-3" />{pay.account}</span>
                                {pay.chequeNumber && <span className="badge badge-info"><Hash className="w-3 h-3" />Chèque n° {pay.chequeNumber}</span>}
                                {pay.bordereauNumber && <span className="badge badge-neutral"><Hash className="w-3 h-3" />Bordereau n° {pay.bordereauNumber}</span>}
                                <span className="text-xs text-slate-400">{formatDate(pay.date)}</span>
                                <span className="ml-auto font-black tabular-nums text-[#002d87]">{money(pay.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {s.multiType && (
                          <p className="text-[10px] text-amber-600 italic mt-2">
                            Achat couvrant plusieurs carburants — les montants de cette section sont la part {g.label} de l'achat, répartie au prorata de la valeur livrée.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Sous-total du carburant */}
            <tr className="bg-blue-50/60 border-t border-slate-200">
              <td className="table-cell font-black text-[#002d87]" colSpan={4}>TOTAL {g.label}</td>
              <td className="table-cell text-right tabular-nums font-black">{g.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</td>
              <td className="table-cell" />
              <td className="table-cell text-right tabular-nums font-black text-[#002d87]">{money(g.total)}</td>
              <td className="table-cell text-right tabular-nums font-black text-emerald-600">{money(g.paid)}</td>
              <td className="table-cell text-right tabular-nums font-black text-red-600">{money(g.rest)}</td>
              <td className="table-cell" colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Drill-down of the « Achats totaux » card: the fuel purchases of the period,
 * GROUPED BY FUEL TYPE. Each carburant (Essence, Gasoil, …) is its own section
 * with its totals, its règlements-by-mode recap and the list of its achats — and
 * for each achat, the payment mode and its references. What is on screen is what
 * the printed fiche (`PurchasesFiche`) carries, section for section.
 */
function PurchasesDetailModal({ open, onClose, purchases, range, onPrint, onDelete, impactOf }: {
  open: boolean;
  onClose: () => void;
  purchases: FuelPurchaseDetail[];
  range: { from: string; to: string };
  onPrint: () => void;
  onDelete: (id: string) => void;
  /** Cuve levels the deletion of an achat would restore (confirmation dialog). */
  impactOf: (id: string) => string;
}) {
  const [toDelete, setToDelete] = useState<FuelPurchaseDetail | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => groupPurchasesByFuelType(purchases), [purchases]);
  const totals = useMemo(() => purchases.reduce(
    (a, p) => ({ total: a.total + p.total, paid: a.paid + p.paid, rest: a.rest + p.rest, liters: a.liters + p.liters }),
    { total: 0, paid: 0, rest: 0, liters: 0 },
  ), [purchases]);
  // Deleting works on the whole achat (all its cuves) — look the full purchase up
  // by id so the confirmation shows its real total and litres, even for a slice.
  const requestDelete = (id: string) => setToDelete(purchases.find(p => p.id === id) || null);

  return (
    <Modal open={open} onClose={onClose} icon={ShoppingCart} size="2xl" fullHeight
      title="Achats Carburant — par type de carburant"
      subtitle={`Du ${formatDate(range.from)} au ${formatDate(range.to)} · ${purchases.length} achat(s) · ${groups.length} carburant(s)`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-slate-400 uppercase tracking-widest">{totals.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</span>
          <span className="text-[#002d87]">Total {money(totals.total)}</span>
          <span className="text-emerald-600">Payé {money(totals.paid)}</span>
          {totals.rest > 0 && <span className="text-red-600">Reste {money(totals.rest)}</span>}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={onPrint} disabled={purchases.length === 0}>
          <Printer className="w-4 h-4" /> Imprimer la liste
        </button>
      </>}>
      <div className="space-y-5">
        {/* Bandeau des totaux — toutes activités carburant confondues */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          {[
            { icon: ShoppingCart, label: 'Achats', value: String(purchases.length), tone: 'from-[#003087] to-[#0044bb]' },
            { icon: Droplets, label: 'Volume acheté', value: `${totals.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`, tone: 'from-purple-500 to-purple-600' },
            { icon: TrendingUp, label: 'Total achats', value: money(totals.total), tone: 'from-amber-500 to-yellow-500' },
            { icon: Wallet, label: 'Payé', value: money(totals.paid), tone: 'from-emerald-500 to-emerald-600' },
            { icon: CircleDollarSign, label: 'Reste (dette)', value: money(totals.rest), tone: 'from-red-500 to-red-600' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-slate-100 p-3 bg-white shadow-sm">
              <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br text-white flex items-center justify-center mb-2', s.tone)}><s.icon className="w-4 h-4" /></div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
              <p className="text-base font-black text-[#002d87] tabular-nums leading-tight">{s.value}</p>
            </div>
          ))}
        </div>

        {purchases.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
            <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-slate-200" />
            <p className="text-sm font-bold text-slate-400">Aucun achat carburant sur cette période.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-slate-400 italic px-1">
              Chaque carburant a sa propre section : son total d'achats, ses règlements par mode, et le détail de chaque achat. Cliquez une ligne pour dérouler ses règlements un par un.
            </p>
            <div className="space-y-5">
              {groups.map(g => (
                <FuelTypeSection key={g.type} group={g}
                  expanded={expanded}
                  onToggle={key => setExpanded(expanded === key ? null : key)}
                  onDelete={requestDelete} />
              ))}
            </div>
          </>
        )}
      </div>

      <Confirm open={!!toDelete} title="Supprimer l'achat"
        message={`Achat « ${toDelete?.ref || ''} » de ${money(toDelete?.total || 0)}.\n\nLes ${
          (toDelete?.liters || 0).toLocaleString('fr-FR')
        } L livrés seront RETIRÉS des cuves et les règlements annulés (l'argent revient en caisse / en banque).${
          toDelete && impactOf(toDelete.id) ? `\n\n${impactOf(toDelete.id)}` : ''
        }\n\nCette action est définitive.`}
        onConfirm={() => { if (toDelete) onDelete(toDelete.id); setToDelete(null); }}
        onCancel={() => setToDelete(null)} />
    </Modal>
  );
}
