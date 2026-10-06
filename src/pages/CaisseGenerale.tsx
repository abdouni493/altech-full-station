/**
 * ─── Caisse Générale (Finance) ──────────────────────────────────────────────────
 * Single place where the money of the whole station is read and moved.
 *
 *  • Solde de la caisse générale — les ESPÈCES de la station : la somme des
 *    caisses Carburant, Cafétéria et Magasin. Rien de ce qui dort en banque n'y
 *    entre, pour que ce chiffre réponde à « qu'y a-t-il dans les tiroirs ? ».
 *  • Trésorerie totale — toutes les caisses (Finance comprise) PLUS les comptes
 *    bancaires : le seul chiffre qui réunit tout l'argent de la station.
 *  • Caisse de chaque partie — Carburant, Cafétéria and Magasin, each
 *    computed from its own documents ; la quatrième carte est celle de la
 *    Finance, c.-à-d. la part du tiroir commun qui n'appartient à aucune activité.
 *  • Journal des opérations — every movement of the station in one list: achats,
 *    ventes, virements, dépôts, retraits, dépenses, encaissements de brigade.
 *  • Actions — dépôt / retrait (montant, description, date) and virement: the
 *    user picks WHICH caisse the money leaves (générale, Carburant, Cafétéria,
 *    Lavage) and WHERE it goes (a bank account or another caisse). The movement
 *    is a single ledger line, so it also shows up in the destination account's
 *    historique with the right sign.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, Plus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Layers,
  Fuel, Coffee, Droplets, Landmark, UtensilsCrossed, Trash2, Edit2, ShoppingCart, Receipt,
  CreditCard, Target, Wallet, TrendingUp, TrendingDown, ArrowRight, Check,
  HandCoins, Search, Users, Flag, X, Store,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  TreasuryTransaction, TreasuryPart, CAISSE_ID, CAISSE_PART_ID, CASH_ACCOUNT_LABEL,
  accountLabelOf, isCashAccount, bankBalanceOf, caisseBalanceOf, dedupeLedger,
  cashAccountOfPart, expensePartOf, isBrigadeExpense, cashEffectOf, treasuryEffectOf,
  activeTreasuryPartList,
} from '../store/AppContext';
import { useBizAll } from '../store/BizContext';
import { MODULES, ModuleKey, bizExpensePaidInCash, netCashOfSale } from '../lib/bizConfig';
import { computeCarburantCash } from '../lib/carburantSales';
import { moduleCaisseMovements, docPaymentSlices, openingDebtRest, clientNetPosition } from '../lib/bizReporting';
import { clientLedgers, clientOpening } from '../lib/clientLedger';
import { fuelClientStatement, bizClientStatement, KIND_COLOR } from '../lib/clientStatement';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Confirm,
  Table, ViewToggle, CardGrid, GlassCard, RowActions, ActionBtn,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '../components/biz/Kit';
import { TX_LABEL } from './BankAccounts';

const todayISO = () => new Date().toISOString().split('T')[0];

/**
 * Un mouvement d'UNE caisse : la ligne élémentaire dont la somme FAIT le solde
 * affiché. Carburant, Cafétéria, Lavage et Finance rendent tous cette forme, si
 * bien qu'aucune carte de cet écran ne peut annoncer un chiffre que sa propre
 * liste ne justifie pas.
 */
interface CashLine {
  id: string;
  date: string;
  nature: string;
  label: string;
  /** Signé sur la caisse : > 0 = espèces entrées, < 0 = espèces sorties. */
  amount: number;
  reference?: string;
}

const sumLines = (rows: CashLine[]): number => rows.reduce((s, r) => s + r.amount, 0);

/** One row of the consolidated journal. */
interface Movement {
  id: string;
  date: string;
  label: string;
  nature: string;
  part: TreasuryPart;
  /**
   * Effet sur les ESPÈCES de la station : > 0 = argent entré dans un tiroir.
   * Vaut 0 quand l'opération s'est jouée entièrement en banque — un règlement
   * par virement bancaire ne vide aucune caisse.
   */
  amount: number;
  /** Montant de l'opération, toujours positif : ce qui a bougé, où que ce soit. */
  gross: number;
  /** L'argent a bougé sur un compte bancaire, pas dans un tiroir. */
  bank: boolean;
  /** Virement d'un tiroir de la station vers un autre : rien n'est sorti. */
  internal?: boolean;
  /** Ledger lines can be edited/deleted; document lines are read-only here. */
  tx?: TreasuryTransaction;
  account?: string;
}

/** Un mouvement d'espèces pur — montant signé, rien en banque. */
const cashRow = (m: Omit<Movement, 'gross' | 'bank'>): Movement =>
  ({ ...m, gross: Math.abs(m.amount), bank: false });

/** Le personnel payé par l'activité Carburant (même découpage que l'Effectif). */
const FUEL_STAFF_KEYS = ['pompistes', 'brigadeChefs', 'gerants', 'magasinWorkers'] as const;

/** Un salaire sans mode de règlement est réputé payé en espèces. */
const salaryPaidInCash = (mode?: string): boolean => {
  const m = String(mode || '').trim().toUpperCase();
  return m === '' || m === 'ESPÈCES' || m === 'ESPECES' || m === 'CASH' || m === 'LIQUIDE';
};

const PART_META: Record<TreasuryPart, { label: string; icon: React.ElementType; tone: string }> = {
  carburant: { label: 'Carburant', icon: Fuel, tone: '#003087' },
  restaurant: { label: 'Restaurant', icon: UtensilsCrossed, tone: '#be123c' },
  cafeteria: { label: 'Cafétéria', icon: Coffee, tone: '#b45309' },
  // Les deux magasins portent le nom choisi dans Paramètres → Magasins.
  get lavage() { return { label: MODULES.lavage.label, icon: Droplets, tone: '#0e7490' }; },
  get magasin2() { return { label: MODULES.magasin2.label, icon: Store, tone: '#7c3aed' }; },
  systeme: { label: 'Finance', icon: Landmark, tone: '#4c1d95' },
};

/** Les activités qui ont une caisse, dans l'ordre d'affichage (second magasin s'il existe). */
type ActivityPart = Exclude<TreasuryPart, 'systeme'>;
const activityParts = (): ActivityPart[] =>
  activeTreasuryPartList().filter((p): p is ActivityPart => p !== 'systeme');
/** Toutes les caisses affichées, Finance comprise. */
const shownParts = (): TreasuryPart[] => activeTreasuryPartList();

const NATURE_ICON: Record<string, React.ElementType> = {
  'Dépôt': ArrowDownCircle, 'Retrait': ArrowUpCircle, 'Virement': ArrowLeftRight,
  'Achat': ShoppingCart, 'Vente': Receipt, 'Dépense': CreditCard,
  'Brigade': Target, 'TPE': CreditCard, 'Salaire': Wallet, 'Ajustement': Layers,
  'Acompte': HandCoins, 'Règlement client': Receipt, 'Recharge client': Wallet,
};

export default function CaisseGenerale() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Caisse Générale');
  const biz = useBizAll();

  const {
    bankAccounts, treasuryTransactions, purchases, expenses,
    brigadeAccountings, brigades, currentUserName,
  } = state;

  const [period, setPeriod] = useState<Period>('month');
  // Tableau par défaut : le journal se relit ligne à ligne, colonne par
  // colonne. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [partFilter, setPartFilter] = useState<'all' | TreasuryPart>('all');
  const [natureFilter, setNatureFilter] = useState<string>('all');
  const [txForm, setTxForm] = useState<null | 'new' | TreasuryTransaction>(null);
  const [transferring, setTransferring] = useState(false);
  const [toDelete, setToDelete] = useState<TreasuryTransaction | null>(null);
  /** Caisse dont on déroule le calcul, ligne par ligne. */
  const [detailPart, setDetailPart] = useState<TreasuryPart | null>(null);
  /** Le client dont on déplie le compte depuis le tableau des créances. */
  const [debtClient, setDebtClient] = useState<{ id: string; part: TreasuryPart } | null>(null);
  const [debtSearch, setDebtSearch] = useState('');
  const [showAllDebtors, setShowAllDebtors] = useState(false);

  // ── Balances ───────────────────────────────────────────────────────────────
  /** Ce que contient PHYSIQUEMENT le tiroir commun, tous propriétaires confondus. */
  const caisse = useMemo(() => caisseBalanceOf(treasuryTransactions), [treasuryTransactions]);
  const accounts = useMemo(
    () => bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, treasuryTransactions) })),
    [bankAccounts, treasuryTransactions]);
  const totalBank = accounts.reduce((s, a) => s + a.balance, 0);

  /**
   * Les mouvements de CHAQUE caisse, dans la définition qui fait autorité pour
   * elle : `lib/carburantSales` pour le Carburant, `lib/bizReporting` pour la
   * Cafétéria et le Lavage, le grand livre pour la Finance. Les mêmes fonctions
   * servent aux Rapports Généraux — les deux écrans ne peuvent donc pas
   * annoncer deux soldes différents.
   *
   * Tout ce que cette page affiche d'une caisse — son solde, ses entrées, ses
   * sorties, son détail — est tiré de CETTE liste. Les soldes étaient jusqu'ici
   * calculés d'un côté et les flux de l'autre (depuis le journal consolidé) :
   * les deux ne se répondaient pas, et un chiffre n'expliquait jamais l'autre.
   */
  const partLines = useMemo<Record<TreasuryPart, CashLine[]>>(() => {
    /**
     * La Finance ne tient pas de documents : sa caisse, c'est la part du tiroir
     * commun qui n'appartient à aucune activité. Un mouvement imputé à une
     * activité en est exclu — il est DÉJÀ dans la caisse de celle-ci, et
     * l'additionner ici compterait deux fois le même billet.
     */
    const financeLines: CashLine[] = treasuryTransactions
      .filter(t => (t.part || 'systeme') === 'systeme'
        && (t.accountTo === CAISSE_ID) !== (t.accountFrom === CAISSE_ID))
      .map(t => ({
        id: t.id,
        date: t.date,
        nature: TX_LABEL[t.kind] || t.kind,
        label: t.description || TX_LABEL[t.kind] || t.kind,
        amount: t.accountTo === CAISSE_ID ? (Number(t.amount) || 0) : -(Number(t.amount) || 0),
        reference: t.chequeNumber || t.bordereauNumber,
      }));
    const bizLines = (key: ModuleKey): CashLine[] => {
      const m = biz[key];
      // `expenses` : les dépenses de la station imputées à cette partie sortent
      // de SA caisse quand elles sont payées en espèces.
      return m ? moduleCaisseMovements(m, key, treasuryTransactions, expenses) : [];
    };
    return {
      carburant: computeCarburantCash(state).lines,
      restaurant: bizLines('restaurant'),
      cafeteria: bizLines('cafeteria'),
      lavage: bizLines('lavage'),
      magasin2: bizLines('magasin2'),
      systeme: financeLines,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, biz, treasuryTransactions, expenses]);

  const partBalances = useMemo(() => ({
    carburant: sumLines(partLines.carburant),
    restaurant: sumLines(partLines.restaurant),
    cafeteria: sumLines(partLines.cafeteria),
    lavage: sumLines(partLines.lavage),
    magasin2: sumLines(partLines.magasin2),
    systeme: sumLines(partLines.systeme),
  }), [partLines]);

  /** L'argent du tiroir commun qui n'appartient à AUCUNE activité. */
  const financeCash = partBalances.systeme;

  /**
   * Le solde de la caisse générale = les ESPÈCES des trois activités réunies
   * (Carburant + Restaurant + Cafétéria + Lavage). Rien de ce qui dort en banque n'entre
   * ici : ce chiffre répond à « combien y a-t-il dans les tiroirs ? ».
   */
  const caissesActivites = activityParts().reduce((t, k) => t + partBalances[k], 0);
  /** Toutes les caisses de la station, le tiroir de la Finance compris. */
  const caissesTotal = caissesActivites + financeCash;
  /** Toute la trésorerie : les caisses ET les comptes bancaires. */
  const grandTotal = caissesTotal + totalBank;

  /**
   * Ce que chaque caisse a encaissé et décaissé SUR LA PÉRIODE, lu sur ses
   * propres lignes. Le reste du solde vient d'avant (ou d'après) la fenêtre
   * regardée : les trois termes se recomposent donc exactement, et la carte
   * d'une caisse explique enfin le chiffre qu'elle affiche.
   */
  const partFlow = useMemo(() => {
    const out = {} as Record<TreasuryPart, {
      in: number; out: number; count: number; outside: number; lines: CashLine[];
    }>;
    (Object.keys(PART_META) as TreasuryPart[]).forEach(key => {
      const rows = (partLines[key] || []).filter(r => inPeriod(r.date, period, from, to));
      const inTotal = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const outTotal = rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);
      out[key] = {
        in: inTotal,
        out: outTotal,
        count: rows.length,
        outside: partBalances[key] - (inTotal - outTotal),
        lines: rows.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      };
    });
    return out;
  }, [partLines, partBalances, period, from, to]);

  // ── Consolidated journal ───────────────────────────────────────────────────
  const movements = useMemo<Movement[]>(() => {
    const out: Movement[] = [];
    const accName = (id?: string) => (id ? accountLabelOf(id, accounts, '') || undefined : undefined);
    // Même dédoublonnage que les soldes : une brigade ré-enregistrée pouvait
    // laisser deux encaissements au grand livre. Sans ce filtre, le journal
    // l'affichait deux fois et gonflait les encaissements de la période.
    const ledger = dedupeLedger(treasuryTransactions);

    // 1. Treasury ledger — the only rows that move the caisses of the station.
    //    Le signe vient des DEUX COMPTES de la ligne, jamais de sa nature : un
    //    achat ou une dépense réglé par virement bancaire a débité la banque, et
    //    n'a jamais vidé un tiroir. Le compter ici comme une sortie d'espèces
    //    faisait payer le même montant deux fois à l'écran.
    for (const t of ledger) {
      const nature = TX_LABEL[t.kind] || t.kind;
      const amount = cashEffectOf(t);
      // Un virement d'un tiroir vers un AUTRE tiroir ne fait sortir aucune
      // espèce de la station : le billet a changé de poche. Le compter en
      // décaissement gonflait les sorties de la période d'un argent qui n'était
      // jamais parti — et le « flux net » avec. Il reste bien sûr une sortie
      // pour la caisse SOURCE et une entrée pour la caisse d'arrivée : c'est la
      // liste de chaque caisse (ci-dessus) qui le dit, pas ce total-là.
      const internal = isCashAccount(t.accountFrom) && isCashAccount(t.accountTo);
      out.push({
        id: t.id,
        date: t.date,
        label: t.description || nature,
        nature,
        part: t.part,
        amount: internal ? 0 : amount,
        gross: Math.abs(amount || treasuryEffectOf(t) || t.amount),
        bank: !internal && amount === 0,
        internal,
        tx: t,
        account: [accName(t.accountFrom), accName(t.accountTo)].filter(Boolean).join(' → ') || undefined,
      });
    }

    // 2. Fuel part documents — only those that have NOT written a ledger line of
    //    their own, otherwise the same money would be listed twice.
    const ledgered = new Set(
      ledger.filter(t => t.refType && t.refId).map(t => `${t.refType}:${t.refId}`));
    for (const p of purchases) {
      if (ledgered.has(`purchase:${p.id}`)) continue;
      const supplier = state.suppliers.find(s => s.id === p.supplierId);
      // Un achat d'avant les règlements détaillés est réputé payé en espèces —
      // même convention que la caisse Carburant (`lib/carburantSales`).
      out.push(cashRow({
        id: `pur-${p.id}`, date: p.date, nature: 'Achat', part: 'carburant',
        label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${supplier?.name || 'Fournisseur'}`,
        amount: -(p.amountPaid || 0),
      }));
    }
    for (const e of expenses) {
      if (ledgered.has(`expense:${e.id}`)) continue;
      // Une dépense de brigade n'est passée par AUCUNE caisse : la brigade a
      // remis son montant en moins (`lib/brigadeExpenses.ts`).
      if (isBrigadeExpense(e)) continue;
      // Payée depuis un compte bancaire, elle n'a rien pris à la caisse.
      const paidInCash = !e.accountId || isCashAccount(e.accountId);
      const amount = -(e.amount || 0);
      out.push({
        // La dépense est imputée à l'activité qui la paie : c'est elle qui la
        // porte dans son rapport et dont la caisse se vide.
        id: `exp-${e.id}`, date: e.date, nature: 'Dépense', part: expensePartOf(e),
        label: `${e.category || 'Dépense'} — ${e.description || ''}`.trim(),
        amount: paidInCash ? amount : 0,
        gross: Math.abs(amount), bank: !paidInCash,
        account: accName(e.accountId || cashAccountOfPart(expensePartOf(e))),
      });
    }
    for (const a of brigadeAccountings) {
      // Une brigade clôturée a DÉJÀ écrit sa ligne au grand livre : la repousser
      // ici comptait ses espèces une seconde fois dans le journal et gonflait les
      // encaissements de la période. Même règle que pour les achats et dépenses.
      if (ledgered.has(`brigade:${a.brigadeId}`)) continue;
      const br = brigades.find(b => b.id === a.brigadeId);
      out.push(cashRow({
        // La brigade est datée de son DÉBUT, comme partout ailleurs : la caler
        // sur `date` seul la faisait basculer d'une période à l'autre selon
        // l'écran qui la lisait.
        id: `bri-${a.id}`, date: br?.startDatetime || br?.date || new Date().toISOString(),
        nature: 'Brigade', part: 'carburant',
        label: `Encaissement brigade ${br ? `${br.shift} du ${formatDate(br.date)}` : ''}`.trim(),
        amount: a.cashReceived || 0,
      }));
    }

    // Salaires et acomptes du personnel carburant — ils sortent de la caisse de
    // l'activité (`lib/carburantSales`), le journal doit donc les montrer, sans
    // quoi le tiroir se vidait à l'écran sans qu'aucune ligne ne l'explique.
    for (const key of FUEL_STAFF_KEYS) {
      for (const w of ((state as any)[key] || []) as any[]) {
        for (const p of (w.paymentRecord || [])) {
          if (p.isPaid === false) continue;
          const amount = Number(p.netSalary ?? p.amount) || 0;
          if (!amount) continue;
          const cash = salaryPaidInCash(p.paymentMode);
          out.push({
            id: `sal-${p.id}`, date: p.paymentDate, nature: 'Salaire', part: 'carburant',
            label: `Salaire ${w.name || 'Employé'}${p.month ? ` — ${p.month}` : ''}`,
            amount: cash ? -amount : 0,
            gross: amount, bank: !cash,
            account: cash ? CASH_ACCOUNT_LABEL[CAISSE_PART_ID.carburant] : undefined,
          });
        }
        for (const a of (w.acomptes || [])) {
          const amount = Number(a.amount) || 0;
          if (!amount) continue;
          out.push(cashRow({
            id: `aco-${a.id}`, date: a.date, nature: 'Acompte', part: 'carburant',
            label: `Acompte ${w.name || 'Employé'}${a.description ? ` — ${a.description}` : ''}`,
            amount: -amount,
          }));
        }
      }
    }

    // Argent remis par les clients — règlements de dette ET recharges d'avance —
    // encaissé en espèces sans ligne au grand livre (saisies anciennes). La
    // caisse Carburant les compte, le journal les ignorait.
    for (const c of (state.clients || [])) {
      for (const t of (c.transactionHistory || [])) {
        if (t.type !== 'PAYMENT' && t.type !== 'RECHARGE') continue;
        if (ledgered.has(`client_payment:${t.id}`)) continue;
        const mode = String(t.mode || 'ESPECES').toUpperCase();
        if (mode !== 'ESPECES' && mode !== 'CASH') continue;
        const amount = Number(t.amount) || 0;
        if (!amount) continue;
        const isRecharge = t.type === 'RECHARGE';
        out.push(cashRow({
          id: `cli-${t.id}`, date: t.date, part: 'carburant',
          nature: isRecharge ? 'Recharge client' : 'Règlement client',
          label: isRecharge ? `Recharge avance — ${c.name}` : `Règlement dette — ${c.name}`,
          amount,
        }));
      }
    }

    // 3. Business parts (Cafétéria / Lavage) — sales, interventions, purchases…
    (Object.keys(MODULES) as ModuleKey[]).forEach(key => {
      const m = biz[key];
      if (!m) return;
      const part = key as TreasuryPart;
      // `netCashOfSale` : une vente RETOURNÉE n'a laissé dans le tiroir que ce
      // qui n'a pas été remboursé, une vente ÉCHANGÉE rien du tout (c'est la
      // vente de remplacement qui porte l'encaissement). Le journal comptait
      // `paid` en entier : il encaissait deux fois un échange, et gardait
      // l'argent d'un retour que la caisse, elle, avait bien rendu.
      // `docPaymentSlices` : chaque versement entre au journal LE JOUR où il a été
      // encaissé. Un client qui solde aujourd'hui une facture de mars faisait
      // auparavant entrer l'argent à la date de la facture — la caisse du mois en
      // cours ne bougeait pas, alors que les billets étaient bien dans le tiroir.
      m.sales.forEach(s => docPaymentSlices(s, netCashOfSale(s)).forEach(l => out.push(cashRow({
        id: `${key}-sale-${l.id}`, date: l.date, nature: 'Vente', part,
        label: `Vente ${s.ref} — ${s.clientName}`
          + (s.status === 'retournée' ? ' (retournée)' : s.status === 'échangée' ? ' (échangée)' : ''),
        amount: l.amount,
      }))));
      m.reparations.forEach(r => docPaymentSlices(r, r.paid).forEach(l => out.push(cashRow({
        id: `${key}-rep-${l.id}`, date: l.date, nature: 'Vente', part,
        label: `Prestation ${r.ref} — ${r.clientName}`,
        amount: l.amount,
      }))));
      // Un règlement encaissé sur la DETTE INITIALE d'un client de partie est de
      // l'argent qui entre dans le tiroir, au même titre qu'un règlement de
      // facture. Il ne s'appuie sur aucun document : sans cette ligne, le
      // journal ignorait l'argent d'une ardoise reprise que le client venait
      // pourtant de solder (même règle que `moduleCaisseMovements`).
      m.clients.forEach(c => ((c as any).openingPayments || [])
        .filter((x: any) => Number(x?.amount) > 0)
        .forEach((x: any) => out.push(cashRow({
          id: `${key}-open-${x.id}`, date: x.date || (c as any).openingDate || c.createdAt,
          nature: 'Règlement client', part,
          label: `Règlement dette initiale — ${c.name}`, amount: Number(x.amount) || 0,
        }))));
      m.purchases.forEach(p => out.push(cashRow({
        id: `${key}-pur-${p.id}`, date: p.date, nature: 'Achat', part,
        label: `Achat ${p.ref} — ${p.supplierName}`, amount: -p.paid,
      })));
      // Une dépense de partie réglée par la BANQUE a écrit sa propre ligne au
      // grand livre : la repousser ici compterait le même argent deux fois.
      m.expenses.filter(e => !ledgered.has(`biz_expense:${e.id}`)).forEach(e => {
        const paidInCash = bizExpensePaidInCash(e);
        return out.push({
          id: `${key}-exp-${e.id}`, date: e.date, nature: 'Dépense', part,
          label: `${e.name}${e.description ? ` — ${e.description}` : ''}`,
          amount: paidInCash ? -e.amount : 0,
          gross: Math.abs(e.amount), bank: !paidInCash,
          account: paidInCash
            ? CASH_ACCOUNT_LABEL[cashAccountOfPart(part)]
            : accName(e.accountId) || CASH_ACCOUNT_LABEL[cashAccountOfPart(part)],
        });
      });
      m.caisse.forEach(c => out.push(cashRow({
        id: `${key}-csh-${c.id}`, date: c.date,
        nature: c.type === 'deposit' ? 'Dépôt' : 'Retrait', part,
        label: c.description || (c.type === 'deposit' ? 'Dépôt de caisse' : 'Retrait de caisse'),
        amount: c.type === 'deposit' ? c.amount : -c.amount,
      })));
      m.workers.forEach(w => w.payments.forEach(pay => out.push(cashRow({
        id: `${key}-pay-${pay.id}`, date: pay.date, nature: 'Salaire', part,
        label: `Salaire ${w.name} — ${pay.period}`, amount: -pay.amount,
      }))));
      // L'acompte est de l'argent déjà remis : il quitte le tiroir le jour où
      // il a été donné, et le salaire net l'a déjà déduit.
      m.workers.forEach(w => (w.acomptes || []).filter(a => a.amount > 0).forEach(a => out.push(cashRow({
        id: `${key}-aco-${a.id}`, date: a.date, nature: 'Acompte', part,
        label: `Acompte ${w.name}${a.description ? ` — ${a.description}` : ''}`, amount: -a.amount,
      }))));
    });

    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treasuryTransactions, purchases, expenses, brigadeAccountings, brigades, biz, accounts, state]);

  /**
   * ─── CE QUE LES CLIENTS DOIVENT, ACTIVITÉ PAR ACTIVITÉ ─────────────────────
   *
   * Cet écran ne parlait que d'argent DÉJÀ rentré. La créance — l'argent que la
   * station a livré mais pas encore encaissé — n'y figurait nulle part : il
   * fallait ouvrir trois écrans Clients l'un après l'autre pour savoir ce qu'on
   * attendait, et aucun des trois ne comptait la dette de reprise saisie à
   * l'ouverture d'une fiche.
   *
   * Les trois activités sont lues à la MÊME source que leur écran Clients : les
   * pièces pour le Carburant (`clientLedgers`), les documents et la reprise pour
   * la Cafétéria et le Lavage. Un chiffre affiché ici se retrouve donc, au
   * dinar près, dans le dossier du client.
   */
  const clientDebts = useMemo(() => {
    const rows: {
      id: string; name: string; part: TreasuryPart; partLabel: string;
      charged: number; paid: number; rest: number;
      opening: number; openingRest: number; ops: number; last: string;
      /**
       * L'avance que la station détient ENCORE pour ce client, une fois sa
       * dette imputée dessus. Elle n'était lue nulle part : un client prépayé
       * figurait ici parmi les débiteurs, pour un argent qu'il avait déjà versé.
       */
      advance: number;
    }[] = [];

    // ── Carburant ──────────────────────────────────────────────────────────
    const ledgers = clientLedgers(state);
    for (const c of (state.clients || [])) {
      const l = ledgers[c.id];
      if (!l) continue;
      const op = clientOpening(c as any);
      rows.push({
        id: c.id, name: c.name, part: 'carburant', partLabel: 'Carburant',
        charged: l.charged, paid: l.paid,
        // La dette NETTE : ce que la station peut réellement réclamer.
        rest: l.netDebt,
        advance: l.advanceLeft,
        opening: op.debt,
        // La reprise est la plus ancienne dette du compte : elle se solde en
        // premier, ce qui reste dessus est donc ce qu'aucun règlement n'a couvert.
        openingRest: Math.max(0, op.debt - Math.min(op.debt, l.paid)),
        ops: l.entries.length,
        last: l.lastDate,
      });
    }

    // ── Cafétéria / Lavage ─────────────────────────────────────────────────
    // Les documents sont regroupés par client EN UNE passe : appeler le relevé
    // complet une fois par client relirait toutes les ventes de la partie
    // autant de fois qu'elle a de clients.
    for (const key of (Object.keys(MODULES) as ModuleKey[])) {
      const m = biz[key];
      if (!m) continue;
      const agg = new Map<string, { charged: number; paid: number; rest: number; ops: number; last: string }>();
      const touch = (id: string) => {
        const cur = agg.get(id) || { charged: 0, paid: 0, rest: 0, ops: 0, last: '' };
        agg.set(id, cur);
        return cur;
      };
      const stamp = (cur: { last: string }, date: string) => {
        if (date && (!cur.last || new Date(date).getTime() > new Date(cur.last).getTime())) cur.last = date;
      };
      for (const sale of (m.sales || [])) {
        if (!sale.clientId) continue;
        const cur = touch(sale.clientId);
        const reversed = sale.status === 'retournée' || sale.status === 'échangée';
        if (!reversed) {
          cur.charged += Number(sale.total) || 0;
          cur.paid += Number(sale.paid) || 0;
          cur.rest += Number(sale.rest) || 0;
        }
        cur.ops += 1; stamp(cur, sale.date);
      }
      for (const r of (m.reparations || [])) {
        if (!r.clientId) continue;
        const cur = touch(r.clientId);
        if (r.status !== 'canceled') {
          cur.charged += Number(r.total) || 0;
          cur.paid += Number(r.paid) || 0;
          cur.rest += Number(r.rest) || 0;
        }
        cur.ops += 1; stamp(cur, r.date);
      }
      for (const c of (m.clients || [])) {
        const cur = agg.get(c.id) || { charged: 0, paid: 0, rest: 0, ops: 0, last: '' };
        const o = openingDebtRest(c as any);
        // L'avance versée à l'ouverture s'impute sur ce qu'il doit : le reste
        // réclamable est la différence, et le reliquat lui appartient encore.
        const pos = clientNetPosition(c as any, cur.rest);
        rows.push({
          id: c.id, name: c.name, part: key as TreasuryPart, partLabel: MODULES[key].label,
          charged: cur.charged + o.debt,
          paid: cur.paid + o.paid,
          rest: pos.net,
          advance: pos.left,
          opening: o.debt, openingRest: o.rest,
          ops: cur.ops + (o.debt > 0 ? 1 : 0) + (pos.advance > 0 ? 1 : 0),
          last: cur.last,
        });
      }
    }

    return rows.sort((a, b) => b.rest - a.rest);
  }, [state, biz]);

  const debtTotals = useMemo(() => ({
    rest: clientDebts.reduce((t, r) => t + r.rest, 0),
    opening: clientDebts.reduce((t, r) => t + r.openingRest, 0),
    /** L'argent des clients que la station détient — une dette envers eux. */
    advance: clientDebts.reduce((t, r) => t + r.advance, 0),
    debtors: clientDebts.filter(r => r.rest > 0.004).length,
    byPart: activityParts().map(k => ({
      part: k,
      rest: clientDebts.filter(r => r.part === k).reduce((t, r) => t + r.rest, 0),
    })),
  }), [clientDebts]);

  /** Les créances affichées : les débiteurs, filtrés par le champ de recherche. */
  const visibleDebts = useMemo(() => {
    const q = debtSearch.trim().toLowerCase();
    // Un client en avance n'est pas « rien » : il a un solde, du bon côté. Il
    // reste donc visible sans avoir à déplier toute la base.
    const base = clientDebts.filter(r => (showAllDebtors ? true : r.rest > 0.004 || r.advance > 0.004));
    return q ? base.filter(r => r.name.toLowerCase().includes(q) || r.partLabel.toLowerCase().includes(q)) : base;
  }, [clientDebts, debtSearch, showAllDebtors]);

  /**
   * Le compte COMPLET du client déplié — construit à la demande, pour le seul
   * client qu'on regarde. Le construire pour tous d'avance relirait toutes les
   * brigades de la station à chaque rendu de cet écran.
   */
  const debtStatement = useMemo(() => {
    if (!debtClient) return null;
    if (debtClient.part === 'carburant') {
      const c = (state.clients || []).find(x => x.id === debtClient.id);
      return c ? fuelClientStatement(state, c) : null;
    }
    const m = biz[debtClient.part as ModuleKey];
    const c = m?.clients?.find((x: any) => x.id === debtClient.id);
    return (m && c) ? bizClientStatement(m, c, MODULES[debtClient.part as ModuleKey].label) : null;
  }, [debtClient, state, biz]);

  const natures = useMemo(
    () => Array.from(new Set(movements.map(m => m.nature))).sort(),
    [movements]);

  /** Tout ce qui a bougé sur la période, avant les filtres d'affichage. */
  const inRange = useMemo(
    () => movements.filter(m => inPeriod(m.date, period, from, to)),
    [movements, period, from, to]);

  const filtered = useMemo(() => inRange.filter(m =>
    (partFilter === 'all' || m.part === partFilter) &&
    (natureFilter === 'all' || m.nature === natureFilter)
  ), [inRange, partFilter, natureFilter]);

  /**
   * Ce que chaque activité a dépensé sur la période — la question à laquelle
   * cet écran ne répondait pas : il affichait un solde par caisse sans jamais
   * dire ce que chacune avait payé.
   */
  const partSpending = useMemo(() => {
    const blank = () => ({ expenses: 0, count: 0, bank: 0 });
    const out: Record<string, ReturnType<typeof blank>> = {};
    for (const p of Object.keys(PART_META)) out[p] = blank();
    for (const m of inRange) {
      const e = out[m.part] || (out[m.part] = blank());
      if (m.bank) e.bank += m.gross;
      // Une dépense reste une dépense de l'activité, réglée en espèces ou par
      // la banque : c'est ce qu'elle a coûté, pas ce qui est sorti du tiroir.
      if (m.nature === 'Dépense') { e.expenses += m.gross; e.count += 1; }
    }
    return out;
  }, [inRange]);

  const flow = useMemo(() => {
    const inTotal = filtered.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const outTotal = filtered.filter(m => m.amount < 0).reduce((s, m) => s - m.amount, 0);
    // Ce qui a bougé sans passer par un tiroir : achats et dépenses réglés
    // depuis un compte bancaire, encaissements TPE.
    const bankTotal = filtered.filter(m => m.bank).reduce((s, m) => s + m.gross, 0);
    // L'argent passé d'un tiroir à l'autre : il n'a quitté ni la station ni les
    // espèces, mais il explique pourquoi une caisse a baissé et une autre monté.
    const internalTotal = filtered.filter(m => m.internal).reduce((s, m) => s + m.gross, 0);
    return { inTotal, outTotal, net: inTotal - outTotal, bankTotal, internalTotal };
  }, [filtered]);

  const del = () => {
    if (!toDelete) return;
    dispatch({ type: 'DELETE_TREASURY_TX', payload: toDelete.id });
    toast.success('Transaction supprimée');
    setToDelete(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={PiggyBank} title="Caisse Générale" subtitle="Finance — trésorerie consolidée de la station"
        actions={perm.creer ? <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setTransferring(true)}>
            <ArrowLeftRight className="w-4 h-4" /> Virement d'une caisse
          </button>
          <button className="btn-primary" onClick={() => setTxForm('new')}>
            <Plus className="w-4 h-4" /> Dépôt / Retrait
          </button>
        </div> : undefined} />

      {/* Hero — trois lectures de l'argent de la station, dans cet ordre :
          ce qu'il y a dans les TIROIRS, ce qui dort en BANQUE, et le TOUT.
          Le solde de la caisse générale ne mélange plus les deux : il ne répond
          qu'à « combien d'espèces la station détient-elle ? ». */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <div className="flex items-center gap-2 text-blue-200">
            <PiggyBank className="w-5 h-5" />
            <span className="text-sm font-bold uppercase tracking-wide">Solde caisse générale</span>
          </div>
          <p className={`text-4xl font-black tabular-nums mt-2 ${caissesActivites >= 0 ? 'text-[#FFB800]' : 'text-red-300'}`}>
            {money(caissesActivites)}
          </p>
          <p className="text-[11px] text-blue-200 mt-1">
            Somme des caisses de toutes les activités ({activityParts().map(k => PART_META[k].label).join(", ")}) — <strong>espèces uniquement</strong>.
            L'argent placé en banque n'entre pas dans ce solde.
          </p>
          {/* L'addition est écrite en toutes lettres : trois caisses, un total.
              Chaque terme est cliquable et s'ouvre ligne par ligne. */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {activityParts().map(k => (
              <button key={k} onClick={() => setDetailPart(k)}
                className="rounded-xl bg-white/10 hover:bg-white/20 transition-colors px-2.5 py-2 text-left">
                <p className="text-[10px] uppercase text-blue-200 font-bold truncate">{PART_META[k].label}</p>
                <p className={`font-black tabular-nums text-sm ${partBalances[k] >= 0 ? '' : 'text-red-300'}`}>
                  {money(partBalances[k])}
                </p>
                <p className="text-[9px] text-blue-300 tabular-nums">
                  {partFlow[k].count} mouvement(s)
                </p>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-blue-300 tabular-nums mt-2 leading-snug">
            {money(partBalances.carburant)} + {money(partBalances.restaurant)} + {money(partBalances.cafeteria)} + {money(partBalances.lavage)} = {money(caissesActivites)}
          </p>
        </div>

        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <Landmark className="w-5 h-5" />
            <span className="text-sm font-bold uppercase tracking-wide">Total en banque</span>
          </div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(totalBank)}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {accounts.length === 0
              ? <span className="text-[11px] text-emerald-100">Aucun compte bancaire</span>
              : accounts.map(a => (
                <div key={a.id} className="rounded-xl bg-white/10 px-3 py-2">
                  <p className="text-[10px] uppercase text-emerald-100 font-bold truncate max-w-[140px]">{a.name}</p>
                  <p className="font-black tabular-nums text-sm">{money(a.balance)}</p>
                </div>
              ))}
          </div>
        </div>

        {/* Le seul chiffre qui réunit tout : toutes les caisses ET la banque.
            Le tiroir de la Finance y est compté à part des quatre activités,
            sinon l'argent qu'une activité a déposé dans la caisse générale
            serait compté deux fois (voir `financeCash`). */}
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #3b0764, #6d28d9)' }}>
          <div className="flex items-center gap-2 text-purple-200">
            <Wallet className="w-5 h-5" />
            <span className="text-sm font-bold uppercase tracking-wide">Trésorerie totale</span>
          </div>
          <p className={`text-4xl font-black tabular-nums mt-2 ${grandTotal >= 0 ? 'text-white' : 'text-red-300'}`}>
            {money(grandTotal)}
          </p>
          <p className="text-[11px] text-purple-200 mt-1">
            Tout l'argent de la station : les caisses <strong>et</strong> les comptes bancaires.
          </p>
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="text-[11px] uppercase font-bold text-purple-200">Toutes les caisses</span>
              <span className="font-black tabular-nums text-sm">{money(caissesTotal)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="text-[11px] uppercase font-bold text-purple-200">Comptes bancaires</span>
              <span className="font-black tabular-nums text-sm">{money(totalBank)}</span>
            </div>
            <p className="text-[10px] text-purple-300 tabular-nums pl-1">
              Caisses = {money(caissesActivites)} (activités) + {money(financeCash)} (Finance)
            </p>
          </div>
        </div>
      </div>

      {/* Caisse of each part — avec ce que l'activité a dépensé sur la période.
          Chaque activité paie ses dépenses en espèces avec SON argent : la
          caisse générale n'est plus débitée à sa place.

          La quatrième carte est celle de la FINANCE, pas le tiroir commun : elle
          ne montre que l'argent qui n'appartient à aucune activité. Elle portait
          jusqu'ici le solde entier du tiroir — donc aussi l'argent des trois
          autres cartes, qui se retrouvait compté deux fois dès qu'on les
          additionnait. Les quatre cartes font maintenant exactement le total
          « Toutes les caisses » affiché en haut. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${shownParts().length > 5 ? 'lg:grid-cols-3 2xl:grid-cols-6' : 'lg:grid-cols-5'} gap-4`}>
        {shownParts().map(key => {
          const meta = PART_META[key]; const Icon = meta.icon;
          const val = partBalances[key];
          const spent = partSpending[key] || { expenses: 0, count: 0, bank: 0 };
          const f = partFlow[key];
          return (
            <div key={key}
              className={`card-glass p-5 text-left transition-all ${partFilter === key ? 'ring-2 ring-[#003087]' : ''}`}>
              <div className="flex items-center gap-2" style={{ color: meta.tone }}>
                <Icon className="w-5 h-5" />
                <span className="text-xs font-bold uppercase">Caisse {meta.label}</span>
              </div>
              <p className={`text-2xl font-black tabular-nums mt-2 ${val >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(val)}</p>

              {/* Le solde, décomposé : ce qui vient d'avant la période, ce que
                  la période a fait entrer, ce qu'elle a fait sortir. Les trois
                  termes se recomposent exactement — c'est la même liste de
                  mouvements qui donne le solde et ces flux. */}
              <div className="mt-2 rounded-xl bg-slate-50 px-2.5 py-2 text-[11px] tabular-nums space-y-0.5">
                <div className="flex items-center justify-between text-slate-500">
                  <span>Hors période</span><span className="font-bold">{money(f.outside)}</span>
                </div>
                <div className="flex items-center justify-between text-emerald-600">
                  <span>+ Entrées</span><span className="font-bold">{money(f.in)}</span>
                </div>
                <div className="flex items-center justify-between text-red-500">
                  <span>− Sorties</span><span className="font-bold">{money(f.out)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-0.5 text-slate-700">
                  <span className="font-bold">= Solde</span>
                  <span className="font-black">{money(val)}</span>
                </div>
              </div>

              <p className="text-[11px] font-bold text-red-500 mt-1.5 tabular-nums">
                Dépenses : {money(spent.expenses)} ({spent.count})
              </p>
              {spent.bank > 0 && (
                <p className="text-[11px] font-bold text-cyan-600 mt-0.5 tabular-nums">
                  Dont {money(spent.bank)} réglés par la banque
                </p>
              )}
              {/* Ce que le tiroir commun contient réellement — l'argent des
                  activités qui y a été déposé y dort aussi. */}
              {key === 'systeme' && Math.abs(caisse - financeCash) >= 0.01 && (
                <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                  Tiroir commun : {money(caisse)} (dont l'argent des activités déposé ici)
                </p>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => setDetailPart(key)}
                  className="text-[10px] font-black uppercase tracking-wider text-[#003087] hover:underline flex items-center gap-1">
                  <Search className="w-3 h-3" /> Détail du calcul
                </button>
                <button onClick={() => setPartFilter(partFilter === key ? 'all' : key)}
                  className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-600 ml-auto">
                  {partFilter === key ? 'Tout le journal' : 'Filtrer le journal'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Créances clients ──────────────────────────────────────────────
          L'écran ne parlait que d'argent DÉJÀ rentré : il fallait ouvrir les
          trois écrans Clients l'un après l'autre pour savoir ce que la station
          attendait encore — et aucun ne comptait la dette de reprise saisie à
          l'ouverture d'une fiche. Les quatre activités sont ici, à la même source
          que leur propre écran, reprise comprise, et chaque ligne se déplie sur
          l'historique complet du compte. */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Users className="w-5 h-5" /> Créances clients
          </h3>
          <span className="text-[11px] font-bold text-slate-400">
            {debtTotals.debtors} client(s) débiteur(s) — encours toutes dates
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
              <input value={debtSearch} onChange={e => setDebtSearch(e.target.value)}
                placeholder="Filtrer par client ou activité…"
                className="h-10 w-56 pl-9 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#002d87] outline-none focus:bg-white focus:border-[#003087] transition-all" />
              {debtSearch && (
                <button onClick={() => setDebtSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-red-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button onClick={() => setShowAllDebtors(v => !v)}
              className="h-10 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 transition-all">
              {showAllDebtors ? 'Débiteurs seuls' : 'Tous les clients'}
            </button>
          </div>
        </div>

        <div className="px-5 py-3 grid grid-cols-2 lg:grid-cols-4 gap-3 border-b border-slate-100 bg-slate-50/60">
          <div className="rounded-xl bg-white border border-red-100 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total à recouvrer</p>
            <p className="text-xl font-black tabular-nums text-red-600">{money(debtTotals.rest)}</p>
          </div>
          {debtTotals.byPart.map(b => (
            <div key={b.part} className="rounded-xl bg-white border border-slate-100 px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{PART_META[b.part].label}</p>
              <p className={`text-xl font-black tabular-nums ${b.rest > 0 ? 'text-[#002d87]' : 'text-slate-300'}`}>{money(b.rest)}</p>
            </div>
          ))}
        </div>

        {debtTotals.advance > 0 && (
          <div className="px-5 py-2.5 flex items-start gap-2.5 bg-teal-50 border-b border-teal-100">
            <Wallet className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <p className="text-[11px] font-semibold text-teal-900 leading-relaxed">
              La station détient <b>{money(debtTotals.advance)}</b> d'<b>avances clients</b> —
              de l'argent déjà versé, qui n'est PAS une créance : il vient en déduction de ce
              que ces clients doivent, et le total à recouvrer ci-dessus en tient compte.
            </p>
          </div>
        )}

        {debtTotals.opening > 0 && (
          <div className="px-5 py-2.5 flex items-start gap-2.5 bg-amber-50 border-b border-amber-100">
            <Flag className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] font-semibold text-amber-900 leading-relaxed">
              Dont <b>{money(debtTotals.opening)}</b> de <b>dettes initiales</b> — des ardoises reprises
              à l'ouverture des fiches, qui n'étaient comptées nulle part avant.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50">
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-5 py-2.5">Client</th>
                <th className="px-5 py-2.5">Activité</th>
                <th className="px-5 py-2.5 text-right">Consommé</th>
                <th className="px-5 py-2.5 text-right">Réglé</th>
                <th className="px-5 py-2.5 text-right">Dette initiale</th>
                <th className="px-5 py-2.5 text-right">Avance détenue</th>
                <th className="px-5 py-2.5 text-right">Reste dû</th>
                <th className="px-5 py-2.5 text-center">Compte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDebts.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-xs font-bold text-slate-400">
                  {clientDebts.length === 0 ? 'Aucun client enregistré' : 'Aucun client ne doit quoi que ce soit'}
                </td></tr>
              ) : visibleDebts.slice(0, 60).map(r => (
                <tr key={`${r.part}-${r.id}`} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5 font-black text-[#002d87]">
                    {r.name}
                    <span className="block text-[10px] font-bold text-slate-400 normal-case">
                      {r.ops} opération(s){r.last ? ` · dernière ${formatDate(r.last)}` : ''}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge tone={r.part === 'carburant' ? 'primary' : r.part === 'cafeteria' ? 'warning' : r.part === 'restaurant' ? 'danger' : 'info'}>
                      {r.partLabel}
                    </Badge>
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-bold text-slate-600">{money(r.charged)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-bold text-emerald-600">{money(r.paid)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-bold">
                    {r.opening > 0
                      ? <span className="text-amber-600">{money(r.opening)}
                          {r.openingRest > 0.004 && r.openingRest < r.opening && (
                            <span className="block text-[10px] text-amber-500">reste {money(r.openingRest)}</span>
                          )}
                        </span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-bold">
                    {r.advance > 0.004
                      ? <span className="text-teal-600">{money(r.advance)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-5 py-2.5 text-right tabular-nums font-black ${r.rest > 0.004 ? 'text-red-600' : 'text-slate-300'}`}>
                    {money(r.rest)}
                  </td>
                  <td className="px-5 py-2.5 text-center">
                    <button onClick={() => setDebtClient({ id: r.id, part: r.part })}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-[#002d87] hover:text-white text-[10px] font-black uppercase tracking-wider text-slate-600 transition-all">
                      Historique
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr className="text-[#002d87] font-black">
                <td colSpan={5} className="px-5 py-3 uppercase text-[10px] tracking-widest">
                  Total à recouvrer{visibleDebts.length > 60 ? ` — ${visibleDebts.length - 60} ligne(s) au-delà des 60 premières` : ''}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-red-600">
                  {money(visibleDebts.reduce((t, r) => t + r.rest, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div className="card-glass p-4 space-y-3">
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <div className="flex flex-wrap items-center gap-3">
          <Select value={partFilter} onChange={e => setPartFilter(e.target.value as any)} className="!w-auto min-w-[190px]">
            <option value="all">Toutes les parties</option>
            {shownParts().map(p => <option key={p} value={p}>{PART_META[p].label}</option>)}
          </Select>
          <Select value={natureFilter} onChange={e => setNatureFilter(e.target.value)} className="!w-auto min-w-[170px]">
            <option value="all">Toutes les natures</option>
            {natures.map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} opération(s)</span>
        </div>
      </div>

      {/* Flow — les trois premiers chiffres ne parlent que d'ESPÈCES, comme les
          soldes ci-dessus ; les deux derniers disent ce qui a bougé sans jamais
          entrer ni sortir des tiroirs de la station. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={TrendingUp} label="Encaissements espèces" value={`+${money(flow.inTotal)}`} tone="green" />
        <StatCard icon={TrendingDown} label="Décaissements espèces" value={`−${money(flow.outTotal)}`} tone="red" />
        <StatCard icon={Layers} label="Flux net espèces" value={money(flow.net)} tone={flow.net >= 0 ? 'blue' : 'red'}
          sub="Encaissements − décaissements" />
        <StatCard icon={Landmark} label="Réglé par la banque" value={money(flow.bankTotal)} tone="amber"
          sub="Aucun tiroir ouvert" />
        <StatCard icon={ArrowLeftRight} label="Virements internes" value={money(flow.internalTotal)} tone="slate"
          sub="D'une caisse à une autre" />
      </div>

      {/* Journal */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Layers className="w-5 h-5" /> Journal des opérations
          </h3>
          <ViewToggle view={view} onChange={setView} />
        </div>
        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">Aucune opération sur la période</p>
        ) : view === 'grid' ? (
          /* ── Le journal en cartes ───────────────────────────────────────
             La même opération, lue d'un bloc : sa nature, sa partie, son
             libellé et le sens dans lequel l'argent a bougé. */
          <div className="p-4">
            <CardGrid>
              {filtered.slice(0, 400).map(m => {
                const Icon = NATURE_ICON[m.nature] || Layers;
                return (
                  <GlassCard key={m.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-black text-slate-800 flex items-center gap-1.5">
                          <Icon className="w-4 h-4 text-[#003087]" />{m.nature}
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(m.date)}</p>
                      </div>
                      <Badge tone="neutral">{PART_META[m.part].label}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 mt-2 line-clamp-2">{m.label || '—'}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{m.account || '—'}</p>
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <span className={`font-black tabular-nums ${m.bank || m.internal ? 'text-slate-500' : m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {m.internal || m.bank
                          ? <span className="inline-flex items-center gap-1.5">
                            {money(m.gross)}
                            <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide ${m.internal ? 'bg-slate-100 text-slate-600' : 'bg-cyan-50 text-cyan-700'}`}>
                              {m.internal ? 'Interne' : 'Banque'}
                            </span>
                          </span>
                          : <>{m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}</>}
                      </span>
                      {m.tx && (m.tx.kind === 'DEPOSIT' || m.tx.kind === 'WITHDRAW' || m.tx.kind === 'TRANSFER') ? (
                        <RowActions>
                          {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setTxForm(m.tx!)} />}
                          {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(m.tx!)} />}
                        </RowActions>
                      ) : <span className="text-[11px] text-slate-300">document</span>}
                    </div>
                  </GlassCard>
                );
              })}
            </CardGrid>
          </div>
        ) : (
          <Table head={<>
            <th className="table-head">Date</th><th className="table-head">Nature</th>
            <th className="table-head">Partie</th><th className="table-head">Description</th>
            <th className="table-head">Comptes</th>
            <th className="table-head text-right">Montant</th>
            <th className="table-head text-right">Actions</th>
          </>}>
            {filtered.slice(0, 400).map(m => {
              const Icon = NATURE_ICON[m.nature] || Layers;
              return (
                <tr key={m.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                      <Icon className="w-3.5 h-3.5" /> {m.nature}
                    </span>
                  </td>
                  <td className="table-cell"><Badge tone="neutral">{PART_META[m.part].label}</Badge></td>
                  <td className="table-cell max-w-[280px]">{m.label || '—'}</td>
                  <td className="table-cell text-[11px] text-slate-400">{m.account || '—'}</td>
                  {/* Une opération réglée en banque garde son montant, mais il
                      n'est pas signé : aucun tiroir ne s'est ouvert. */}
                  <td className={`table-cell text-right tabular-nums font-bold ${m.bank || m.internal ? 'text-slate-500' : m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {m.internal ? (
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        {money(m.gross)}
                        <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-wide">Interne</span>
                      </span>
                    ) : m.bank ? (
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        {money(m.gross)}
                        <span className="px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-700 text-[9px] font-black uppercase tracking-wide">Banque</span>
                      </span>
                    ) : (
                      <>{m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}</>
                    )}
                  </td>
                  <td className="table-cell text-right">
                    {m.tx && (m.tx.kind === 'DEPOSIT' || m.tx.kind === 'WITHDRAW' || m.tx.kind === 'TRANSFER') ? (
                      <div className="flex items-center justify-end gap-1">
                        {perm.modifier && (
                          <button onClick={() => setTxForm(m.tx!)} title="Modifier"
                            className="w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 flex items-center justify-center">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {perm.supprimer && (
                          <button onClick={() => setToDelete(m.tx!)} title="Supprimer"
                            className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : <span className="text-[11px] text-slate-300">document</span>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {txForm && (
        <CashTxModal
          initial={txForm === 'new' ? null : txForm}
          createdBy={currentUserName}
          onClose={() => setTxForm(null)}
          onSave={tx => {
            dispatch({ type: txForm === 'new' ? 'ADD_TREASURY_TX' : 'UPDATE_TREASURY_TX', payload: tx });
            toast.success(txForm === 'new' ? 'Transaction enregistrée' : 'Transaction modifiée');
            setTxForm(null);
          }}
        />
      )}

      {transferring && (
        <CaisseTransferModal
          accounts={accounts}
          // Le solde PROPRE de la Finance, pas le contenu du tiroir commun :
          // l'argent qu'une activité y a déposé reste le sien, et c'est SA caisse
          // qu'il faut choisir en source pour l'envoyer en banque.
          caisseBalance={financeCash}
          partBalances={partBalances}
          createdBy={currentUserName}
          onClose={() => setTransferring(false)}
          onSave={tx => {
            dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
            toast.success('Virement enregistré');
            setTransferring(false);
          }}
        />
      )}

      {detailPart && (
        <CaisseDetailModal
          part={detailPart}
          balance={partBalances[detailPart]}
          flow={partFlow[detailPart]}
          allLines={partLines[detailPart]}
          onClose={() => setDetailPart(null)}
        />
      )}

      {/* ── L'historique d'un client, déplié sur place ──────────────────────
          Le tableau ci-dessus dit COMBIEN ; celui-ci dit POURQUOI — chaque
          opération du compte, dette initiale de reprise en tête, avec le solde
          après chacune. */}
      <Modal open={!!debtClient} onClose={() => setDebtClient(null)} icon={Users} size="3xl"
        title={debtStatement ? `Compte de ${debtStatement.client.name}` : 'Compte client'}
        subtitle={debtStatement ? `${debtStatement.partLabel} — ${debtStatement.allLines.length} opération(s)` : undefined}
        footer={<button className="btn-ghost" onClick={() => setDebtClient(null)}>Fermer</button>}>
        {!debtStatement ? (
          <p className="text-xs font-bold text-slate-400 py-6 text-center">Compte introuvable</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-[10px] uppercase font-black text-slate-400">Consommé</p>
                <p className="font-black text-[#002d87] tabular-nums">{money(debtStatement.totals.charged)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-[10px] uppercase font-black text-slate-400">Encaissé</p>
                <p className="font-black text-emerald-600 tabular-nums">{money(debtStatement.totals.paid)}</p>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                <p className="text-[10px] uppercase font-black text-slate-400">Reste dû</p>
                <p className="font-black text-red-600 tabular-nums">{money(debtStatement.closingDebt)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                <p className="text-[10px] uppercase font-black text-slate-400">Dette initiale</p>
                <p className="font-black text-amber-600 tabular-nums">
                  {money(debtStatement.allLines.filter(l => l.kind === 'ouverture').reduce((t, l) => t + l.charged, 0))}
                </p>
              </div>
            </div>

            <div className="max-h-[52vh] overflow-y-auto custom-scrollbar rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Nature</th>
                    <th className="px-4 py-2.5">Désignation</th>
                    <th className="px-4 py-2.5 text-right">Débit</th>
                    <th className="px-4 py-2.5 text-right">Crédit</th>
                    <th className="px-4 py-2.5 text-right">Solde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {debtStatement.allLines.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs font-bold text-slate-400">
                      Aucune opération sur ce compte
                    </td></tr>
                  ) : (() => {
                    // Le solde APRÈS chaque ligne : un journal qui n'aligne que
                    // des montants ne se vérifie pas.
                    const lines = debtStatement.allLines;
                    const running: Record<string, number> = {};
                    let acc = 0;
                    for (let i = lines.length - 1; i >= 0; i--) { acc += lines[i].debtEffect; running[lines[i].id] = acc; }
                    return lines.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-medium">{formatDate(l.date)}</td>
                        <td className="px-4 py-2.5 font-black whitespace-nowrap" style={{ color: KIND_COLOR[l.kind] }}>{l.kindLabel}</td>
                        <td className="px-4 py-2.5 text-slate-600 font-semibold">
                          {l.label}
                          {l.ref && <span className="text-slate-300"> · {l.ref}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-700">
                          {l.charged > 0 ? money(l.charged) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-600">
                          {l.paid > 0 ? money(l.paid) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-black ${running[l.id] > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {money(running[l.id] || 0)}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!toDelete} title="Supprimer la transaction"
        message="Cette opération sera retirée de la caisse générale. Confirmer ?"
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Le solde d'une caisse, déroulé jusqu'à la ligne ──────────────────────────
/**
 * Le chiffre affiché sur une carte ne se discutait pas mais ne se vérifiait pas
 * non plus. Cet écran montre les mouvements QUI FONT ce solde — la liste même
 * dont la somme a été prise, groupée par nature puis détaillée — pour qu'un
 * tiroir qui a baissé dise pourquoi.
 */
function CaisseDetailModal({ part, balance, flow, allLines, onClose }: {
  part: TreasuryPart;
  balance: number;
  flow: { in: number; out: number; count: number; outside: number; lines: CashLine[] };
  /** TOUTES les lignes du solde, toutes dates confondues — la liste dont la
   *  somme FAIT le chiffre affiché. C'est ici qu'un écart se traque. */
  allLines: CashLine[];
  onClose: () => void;
}) {
  const meta = PART_META[part];
  const [nature, setNature] = useState<string | null>(null);
  /**
   * Sur quoi porte le détail : la période filtrée, ou TOUT l'historique. Le
   * solde d'un tiroir est cumulatif — un écart peut venir d'une saisie de mois
   * passés qu'un filtre « ce mois-ci » cache dans le seul « Hors période ». Pour
   * réconcilier avec l'argent réellement présent, il faut pouvoir tout dérouler.
   */
  const [scope, setScope] = useState<'period' | 'all'>('period');

  // Le jeu de lignes regardé, trié du plus récent au plus ancien.
  const view = useMemo(() => {
    const rows = scope === 'all'
      ? [...allLines].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      : flow.lines;
    const inTotal = rows.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const outTotal = rows.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0);
    // « Hors vue » : la part du solde que ces lignes n'expliquent pas. Nulle en
    // mode « tout l'historique » (le solde EST la somme de toutes les lignes).
    const outside = scope === 'all' ? 0 : flow.outside;
    return { rows, inTotal, outTotal, outside };
  }, [scope, allLines, flow]);

  /** Les mouvements regardés, regroupés par nature et par sens. */
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; direction: 'in' | 'out'; count: number; total: number }>();
    for (const l of view.rows) {
      const direction: 'in' | 'out' = l.amount >= 0 ? 'in' : 'out';
      const key = `${l.nature}|${direction}`;
      const g = map.get(key) || { key, label: l.nature, direction, count: 0, total: 0 };
      g.count += 1;
      g.total += Math.abs(l.amount);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [view.rows]);

  const lines = nature ? view.rows.filter(l => `${l.nature}|${l.amount >= 0 ? 'in' : 'out'}` === nature) : view.rows;

  /**
   * Le solde APRÈS chaque ligne, du plus ancien au plus récent : un journal de
   * caisse qui n'aligne que des montants ne se vérifie pas. On part du « Hors
   * vue » (ce qui précède la fenêtre regardée) puis on cumule — la dernière
   * ligne retombe donc exactement sur le solde affiché.
   */
  const running = useMemo(() => {
    const out: Record<string, number> = {};
    let acc = view.outside;
    for (let i = view.rows.length - 1; i >= 0; i--) { acc += view.rows[i].amount; out[view.rows[i].id] = acc; }
    return out;
  }, [view]);

  const scopeLabel = scope === 'all' ? "tout l'historique" : 'la période';

  return (
    <Modal open onClose={onClose} icon={meta.icon} size="2xl" fullHeight
      title={`Caisse ${meta.label}`}
      subtitle={`${view.rows.length} mouvement(s) sur ${scopeLabel} — le détail du solde affiché`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-emerald-600">Entrées +{money(view.inTotal)}</span>
          <span className="text-red-600">Sorties −{money(view.outTotal)}</span>
          <span className={balance >= 0 ? 'text-[#002d87]' : 'text-red-600'}>Solde {money(balance)}</span>
        </div>
        <button className="btn-primary" onClick={onClose}>Fermer</button>
      </>}>
      <div className="space-y-5">
        {/* Choix de la fenêtre : la période filtrée, ou tout l'historique. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fenêtre</span>
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
            {([['period', 'La période'], ['all', "Tout l'historique"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setScope(k)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-all ${scope === k ? 'bg-white text-[#003087] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {lbl}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-400">
            {scope === 'all'
              ? "Toutes dates confondues : la somme de ces lignes FAIT le solde affiché."
              : "Le solde décomposé sur la période — bascule sur « Tout l'historique » pour dérouler chaque ligne."}
          </span>
        </div>

        {/* Le calcul, écrit en entier : rien à recomposer de tête. */}
        <div className="card-glass p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
            Comment ce solde est calculé
          </p>
          <div className="flex flex-wrap items-stretch gap-2">
            {[
              { label: scope === 'all' ? 'Point de départ' : 'Hors période', value: view.outside, sign: '', tone: 'text-slate-700' },
              { label: scope === 'all' ? 'Total des entrées' : 'Entrées de la période', value: view.inTotal, sign: '+', tone: 'text-emerald-600' },
              { label: scope === 'all' ? 'Total des sorties' : 'Sorties de la période', value: view.outTotal, sign: '−', tone: 'text-red-600' },
              { label: 'Solde actuel', value: balance, sign: '=', tone: balance >= 0 ? 'text-emerald-600' : 'text-red-600' },
            ].map(s => (
              <React.Fragment key={s.label}>
                {s.sign && <span className="self-center text-slate-300 font-black text-lg px-0.5 shrink-0">{s.sign}</span>}
                <div className={`rounded-xl px-3 py-2 flex-1 min-w-[128px] ${s.sign === '=' ? 'bg-slate-100' : 'bg-slate-50'}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">{s.label}</p>
                  <p className={`font-black tabular-nums text-sm mt-0.5 ${s.tone}`}>{money(s.value)}</p>
                </div>
              </React.Fragment>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 italic mt-3">
            {part === 'systeme'
              ? "La caisse de la Finance ne compte que les mouvements du tiroir commun qui ne sont imputés à aucune activité : l'argent qu'une activité y dépose reste dans SA caisse."
              : `Tout ce que l'activité a encaissé et décaissé EN ESPÈCES, où que l'argent se trouve — son propre coffre comme la caisse générale. Un règlement par chèque ou par virement n'y figure pas : aucun tiroir ne s'est ouvert.`}
          </p>
        </div>

        {/* Par nature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wide text-[#002d87] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#FFB800]" /> Détail par nature d'opération
            </h4>
            {nature && (
              <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => setNature(null)}>
                Voir toutes les natures
              </button>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8 italic">Aucun mouvement sur {scopeLabel}.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {groups.map(g => {
                const Icon = NATURE_ICON[g.label] || Layers;
                const on = nature === g.key;
                const isIn = g.direction === 'in';
                return (
                  <button key={g.key} onClick={() => setNature(on ? null : g.key)}
                    className={`rounded-2xl border p-3 text-left transition-all bg-white ${on
                      ? 'border-[#003087] ring-2 ring-[#003087]/20 shadow-md'
                      : 'border-slate-100 shadow-sm hover:border-[#003087]/40'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0 ${isIn ? 'bg-emerald-500' : 'bg-red-500'}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-700 truncate">{g.label}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {isIn ? 'Entrée' : 'Sortie'} · {g.count} op.
                        </p>
                      </div>
                    </div>
                    <p className={`text-lg font-black tabular-nums mt-1.5 ${isIn ? 'text-emerald-600' : 'text-red-600'}`}>
                      {isIn ? '+' : '−'}{money(g.total)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Ligne par ligne — avec, hors filtre de nature, le solde du tiroir
            APRÈS chaque opération : c'est là qu'un écart se repère à l'œil. */}
        <div>
          {lines.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8 italic">Aucun mouvement sur {scopeLabel}.</p>
          ) : (
            <Table head={<>
              <th className="table-head">Date</th>
              <th className="table-head">Nature</th>
              <th className="table-head">Description</th>
              <th className="table-head text-right">Effet sur la caisse</th>
              {!nature && <th className="table-head text-right">Solde après</th>}
            </>}>
              {lines.slice(0, 400).map(l => {
                const Icon = NATURE_ICON[l.nature] || Layers;
                return (
                  <tr key={l.id}>
                    <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(l.date)}</td>
                    <td className="table-cell">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600 whitespace-nowrap">
                        <Icon className="w-3.5 h-3.5" /> {l.nature}
                      </span>
                    </td>
                    <td className="table-cell max-w-[320px]">
                      <span className="block truncate" title={l.label}>{l.label}</span>
                      {l.reference && <span className="text-[10px] text-slate-400">{l.reference}</span>}
                    </td>
                    <td className={`table-cell text-right tabular-nums font-bold whitespace-nowrap ${l.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {l.amount >= 0 ? '+' : '−'}{money(Math.abs(l.amount))}
                    </td>
                    {!nature && (
                      <td className={`table-cell text-right tabular-nums font-black whitespace-nowrap ${running[l.id] >= 0 ? 'text-[#002d87]' : 'text-red-600'}`}>
                        {money(running[l.id] || 0)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </Table>
          )}
          {lines.length > 400 && (
            <p className="text-center text-[11px] text-slate-400 italic mt-2">
              400 premières lignes affichées sur {lines.length}.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Dépôt / Retrait ───────────────────────────────────────────────────────────
function CashTxModal({
  initial, createdBy, onClose, onSave,
}: {
  initial: TreasuryTransaction | null;
  createdBy?: string;
  onClose: () => void;
  onSave: (tx: TreasuryTransaction) => void;
}) {
  const isEdit = !!initial;
  const isTransfer = initial?.kind === 'TRANSFER';
  const [kind, setKind] = useState<'DEPOSIT' | 'WITHDRAW'>(
    initial && initial.kind === 'WITHDRAW' ? 'WITHDRAW' : 'DEPOSIT');
  const [amount, setAmount] = useState(String(initial?.amount ?? ''));
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : todayISO());
  const [description, setDescription] = useState(initial?.description || '');
  const [part, setPart] = useState<TreasuryPart>(initial?.part || 'systeme');

  const value = Number(amount) || 0;

  const save = () => {
    if (value <= 0) { toast.error('Montant requis'); return; }
    onSave({
      id: initial?.id || newId(),
      date: new Date(date).toISOString(),
      // Editing a virement keeps its nature and its two accounts untouched.
      kind: isTransfer ? 'TRANSFER' : kind,
      amount: value,
      description: description.trim() || undefined,
      accountFrom: isTransfer ? initial!.accountFrom : (kind === 'WITHDRAW' ? CAISSE_ID : undefined),
      accountTo: isTransfer ? initial!.accountTo : (kind === 'DEPOSIT' ? CAISSE_ID : undefined),
      part,
      createdBy: initial?.createdBy || createdBy,
      createdAt: initial?.createdAt || new Date().toISOString(),
    });
  };

  return (
    <Modal open onClose={onClose} icon={PiggyBank} size="md"
      title={isEdit ? 'Modifier la transaction' : 'Dépôt / Retrait de caisse'}
      subtitle="Montant, description et date"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0}>{isEdit ? 'Enregistrer' : 'Valider'}</button>
      </>}>
      <div className="space-y-4">
        {!isTransfer && (
          <div className="flex gap-2">
            <button onClick={() => setKind('DEPOSIT')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${kind === 'DEPOSIT' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <ArrowDownCircle className="w-4 h-4" /> Dépôt (entrée)
            </button>
            <button onClick={() => setKind('WITHDRAW')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${kind === 'WITHDRAW' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <ArrowUpCircle className="w-4 h-4" /> Retrait (sortie)
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)" required><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        {/* Ce choix n'est plus un simple classement : il décide à QUELLE caisse
            d'activité le montant est imputé. Le libellé promettait un rangement
            dans le journal, et l'argent n'arrivait effectivement nulle part. */}
        <Field label="Partie concernée"
          hint={part === 'systeme'
            ? "L'argent entre ou sort de la caisse générale, sans être imputé à une activité."
            : `L'argent entre ou sort de la caisse générale ET compte dans la caisse ${PART_META[part].label}.`}>
          <Select value={part} onChange={e => setPart(e.target.value as TreasuryPart)}>
            {shownParts().map(p => <option key={p} value={p}>{PART_META[p].label}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Motif de l'opération" /></Field>
      </div>
    </Modal>
  );
}

// ─── Virement : d'une caisse vers un compte bancaire (ou une autre caisse) ─────
/**
 * The user chooses BOTH sides of the movement:
 *   • la caisse source — générale, Carburant, Cafétéria ou Magasin
 *   • la destination   — n'importe quel compte bancaire, ou une autre caisse
 *
 * One single `TRANSFER` line is written, so the money leaves the chosen caisse
 * and shows up in the historique of the destination account with the same
 * amount — the two soldes can never disagree.
 */
function CaisseTransferModal({
  accounts, caisseBalance, partBalances, createdBy, onClose, onSave,
}: {
  accounts: { id: string; name: string; balance: number }[];
  caisseBalance: number;
  partBalances: Record<ActivityPart, number>;
  createdBy?: string;
  onClose: () => void;
  onSave: (tx: TreasuryTransaction) => void;
}) {
  /** Every cash box the money can leave, with its live solde. */
  const sources = useMemo(() => ([
    { id: CAISSE_ID, label: CASH_ACCOUNT_LABEL[CAISSE_ID], part: 'systeme' as TreasuryPart, icon: PiggyBank, balance: caisseBalance },
    ...activityParts().map(k => ({
      id: CAISSE_PART_ID[k],
      label: PART_META[k].label,
      part: k as TreasuryPart,
      icon: PART_META[k].icon,
      balance: partBalances[k],
    })),
  ]), [caisseBalance, partBalances]);

  const [fromId, setFromId] = useState<string>(CAISSE_ID);
  const [toId, setToId] = useState<string>(accounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const value = Number(amount) || 0;
  const source = sources.find(s => s.id === fromId)!;
  const otherCaisses = sources.filter(s => s.id !== fromId);
  const targetBank = accounts.find(a => a.id === toId);
  const targetCaisse = otherCaisses.find(s => s.id === toId);
  const targetLabel = targetBank?.name || targetCaisse?.label || '';
  const targetBalance = targetBank?.balance ?? targetCaisse?.balance ?? 0;
  const overdraft = value > source.balance;

  // Changing the source must never leave the destination pointing at itself.
  const pickSource = (id: string) => {
    setFromId(id);
    if (toId === id) setToId(accounts[0]?.id || sources.find(s => s.id !== id)!.id);
  };

  const save = () => {
    if (!toId) { toast.error('Choisissez la destination du virement'); return; }
    if (value <= 0) { toast.error('Montant requis'); return; }
    onSave({
      id: newId(),
      date: new Date(date).toISOString(),
      kind: 'TRANSFER',
      amount: value,
      description: description.trim() || `Virement ${source.label} → ${targetLabel}`,
      accountFrom: fromId,
      accountTo: toId,
      // The movement belongs to the activity whose caisse pays.
      part: source.part,
      createdBy,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal open onClose={onClose} icon={ArrowLeftRight} size="lg"
      title="Virement d'une caisse" subtitle="Choisissez la caisse source et la destination"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0 || !toId}>Valider le virement</button>
      </>}>
      <div className="space-y-5">
        {/* 1. Which caisse the money leaves */}
        <div>
          <label className="label-field">1. Caisse source</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {sources.map(s => {
              const Icon = s.icon; const on = s.id === fromId;
              return (
                <button key={s.id} onClick={() => pickSource(s.id)}
                  className={`rounded-xl p-3 text-left border transition-all ${on
                    ? 'border-[#003087] bg-[#003087]/5 ring-2 ring-[#003087]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-4 h-4 ${on ? 'text-[#003087]' : 'text-slate-400'}`} />
                    {on && <Check className="w-3 h-3 text-[#003087] ml-auto" />}
                  </div>
                  <p className={`text-[11px] font-bold mt-1.5 leading-tight ${on ? 'text-[#002d87]' : 'text-slate-500'}`}>{s.label}</p>
                  <p className={`text-sm font-black tabular-nums ${s.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(s.balance)}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Where it goes */}
        <Field label="2. Destination du virement" required
          hint="Un compte bancaire, ou une autre caisse de la station.">
          <Select value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {accounts.length > 0 && (
              <optgroup label="Comptes bancaires">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}
              </optgroup>
            )}
            <optgroup label="Caisses de la station">
              {otherCaisses.map(s => <option key={s.id} value={s.id}>{s.label} — {money(s.balance)}</option>)}
            </optgroup>
          </Select>
        </Field>

        {accounts.length === 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            Aucun compte bancaire enregistré. Créez-en un depuis « Comptes Bancaires » pour virer l'argent en banque.
          </div>
        )}

        {/* 3. Amount */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Montant (DA)" required>
            <div className="flex gap-2">
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
              <button className="btn-outline !px-3 shrink-0 text-xs whitespace-nowrap"
                onClick={() => setAmount(String(Math.max(0, source.balance)))}
                title="Virer la totalité du solde de la caisse">Tout</button>
            </div>
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>

        <Field label="Description">
          <Textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder={`Virement ${source.label} → ${targetLabel || '…'}`} />
        </Field>

        {overdraft && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            Le montant dépasse le solde de « {source.label} » — la caisse passera en négatif.
          </div>
        )}

        {/* Recap */}
        <div className="rounded-2xl bg-[#001f5c] text-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold text-blue-200 truncate">{source.label}</p>
              <p className="font-black tabular-nums text-sm">{money(source.balance)}</p>
              <p className="text-[11px] text-red-300 tabular-nums">→ {money(source.balance - value)}</p>
            </div>
            <div className="shrink-0 flex flex-col items-center">
              <ArrowRight className="w-5 h-5 text-[#FFB800]" />
              <span className="text-[11px] font-black tabular-nums text-[#FFB800]">{money(value)}</span>
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-[10px] uppercase font-bold text-blue-200 truncate">{targetLabel || 'Destination'}</p>
              <p className="font-black tabular-nums text-sm">{money(targetBalance)}</p>
              <p className="text-[11px] text-emerald-300 tabular-nums">→ {money(targetBalance + value)}</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
