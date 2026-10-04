import React, { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { 
  Plus, 
  Search, 
  Filter, 
  TrendingDown, 
  Calendar, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  X, 
  Camera, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  CreditCard, 
  Banknote,
  Landmark,
  RefreshCcw,
  ArrowRight,
  PieChart as PieChartIcon,
  BarChart as BarChartIcon,
  Layers,
  Eye,
  Settings2,
  ChevronRight,
  ArrowUpRight,
  Printer,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  User,
  List,
  LayoutGrid
} from "lucide-react";
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend
} from "recharts";
import ChartBox from "../components/ChartBox";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId, matchesSearch } from "@/src/lib/utils";
import {
  useAppState, useAppDispatch, useModulePermission,
  TreasuryTransaction, TreasuryPart, CAISSE_ID, CASH_ACCOUNT_LABEL,
  bankBalanceOf, caisseBalanceOf, cashAccountOfPart, expensePartOf, isCashAccount,
} from "@/src/store/AppContext";
import { useBizAll } from "@/src/store/BizContext";
import { carburantCashBalance } from "@/src/lib/carburantSales";
import { moduleCaisseBalance } from "@/src/lib/bizReporting";
import { toast } from "react-hot-toast";

/** Instrument used to pay — independent of the account the money leaves. */
const PAYMENT_MODES = ["Espèces", "Virement", "Chèque", "TPE", "Prélèvement"] as const;

/**
 * Les activités auxquelles une dépense peut être imputée. Le choix n'est pas
 * un classement : il décide de QUELLE caisse sortent les espèces.
 */
const PARTS: { key: TreasuryPart; label: string; short: string; tone: string }[] = [
  { key: 'carburant', label: 'Carburant', short: '⛽ Carburant', tone: '#003087' },
  { key: 'restaurant', label: 'Restaurant', short: '🍽️ Restaurant', tone: '#be123c' },
  { key: 'cafeteria', label: 'Cafétéria', short: '☕ Cafétéria', tone: '#b45309' },
  { key: 'lavage', label: 'Magasin', short: '🛒 Magasin', tone: '#0e7490' },
  { key: 'systeme', label: 'Finance (caisse générale)', short: '🏛️ Finance', tone: '#4c1d95' },
];
const PART_LABEL: Record<string, string> = Object.fromEntries(PARTS.map(p => [p.key, p.label]));

const Expenses = () => {
  const { t } = useTranslation();
  const state = useAppState();
  const {
    expenses, settings, bankAccounts, treasuryTransactions, currentUserName,
    brigades = [], brigadeChefs = [], pompistes = [],
  } = state;
  const perm = useModulePermission('Dépenses');
  const dispatch = useAppDispatch();
  const biz = useBizAll();

  // Live soldes so the payment-method list shows what each account really holds.
  const accounts = useMemo(
    () => bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, treasuryTransactions) })),
    [bankAccounts, treasuryTransactions],
  );

  /**
   * Ce que chaque caisse contient RÉELLEMENT — le même calcul que l'écran
   * Caisse Générale, pour que la dépense soit saisie en connaissance de cause :
   * l'utilisateur voit le tiroir qu'il s'apprête à vider.
   */
  const partCash = useMemo<Record<string, number>>(() => {
    // Une partie non encore chargée n'a pas de caisse : mieux vaut 0 qu'un écran
    // blanc, la saisie de la dépense n'en dépend pas.
    const ofModule = (key: 'restaurant' | 'cafeteria' | 'lavage') =>
      biz?.[key] ? moduleCaisseBalance(biz[key], key, treasuryTransactions, expenses) : 0;
    return {
      carburant: carburantCashBalance(state),
      restaurant: ofModule('restaurant'),
      cafeteria: ofModule('cafeteria'),
      lavage: ofModule('lavage'),
      systeme: caisseBalanceOf(treasuryTransactions),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, biz, treasuryTransactions, expenses]);

  /**
   * ─── LA BRIGADE QUI A PRODUIT LA DÉPENSE ───────────────────────────────────
   *
   * Une brigade peut justifier son reste « par dépense » : le pompiste a payé
   * quelque chose avec les espèces de la brigade. Cette dépense-là arrive donc
   * ici toute seule — et sans dire d'où elle vient, elle serait indistinguable
   * d'une saisie manuelle. On lit sa fiche pour l'afficher sur sa carte.
   *
   * Elle ne sort d'AUCUNE caisse : la brigade a remis son montant en moins
   * (voir `lib/brigadeExpenses.ts` et `isBrigadeExpense`).
   */
  const brigadeOf = (e: any) => {
    if (!e?.brigadeId) return null;
    const b = brigades.find(x => x.id === e.brigadeId);
    const pompiste = pompistes.find(p => p.id === e.pompisteId)?.name;
    const chef = b ? brigadeChefs.find(c => c.id === b.chefId)?.name : undefined;
    return {
      brigade: b,
      label: b ? `Brigade ${b.shift || ''} du ${new Date(b.date).toLocaleDateString('fr-FR')}`.replace('  ', ' ')
        : 'Brigade supprimée',
      chef, pompiste,
    };
  };

  /** Label of the account an expense was paid from. */
  const accountLabel = (id?: string) =>
    !id ? 'Caisse générale'
      : (CASH_ACCOUNT_LABEL[id] || bankAccounts.find(a => a.id === id)?.name || 'Compte supprimé');

  const [showModal, setShowModal] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<any>(null);
  const [activeView, setActiveView] = useState("list");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Les dépenses s'ouvrent en tableau : la lecture la plus dense. « Cartes » et
  // « Analyses » restent à portée du sélecteur.
  const [viewMode, setViewMode] = useState<"table" | "grid" | "analytics">("table");

  // Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [partFilter, setPartFilter] = useState<"all" | TreasuryPart>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // Form State
  const emptyForm = () => ({
    description: "",
    category: "",
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    mode: "Espèces",
    paymentMode: "Espèces",
    chequeNumber: "",
    bordereauNumber: "",
    // Par défaut, la dépense est portée par le Carburant et payée avec SES
    // espèces — jamais avec celles de la caisse générale.
    part: "carburant" as TreasuryPart,
    accountId: cashAccountOfPart("carburant"),
    paidBy: "Caisse",
    recipient: "",
    status: "Validé",
    receipt: null
  });
  const [formData, setFormData] = useState<any>(emptyForm);

  /**
   * Les dépenses de la période SANS le filtre de partie : c'est sur elles que
   * se lit la bande « qui a dépensé quoi ». La filtrer par partie aurait mis
   * toutes les autres activités à zéro dès qu'on en sélectionne une.
   */
  const scopedExpenses = useMemo(() => {
    return expenses.filter(e => {
      const matchesQuery = matchesSearch(searchQuery, e.description, e.category, e.recipient, e.chequeNumber, e.bordereauNumber);
      const matchesCategory = categoryFilter === "all" || e.category === categoryFilter;
      const matchesDateFrom = !dateFrom || new Date(e.date) >= new Date(dateFrom);
      const matchesDateTo = !dateTo || new Date(e.date) <= new Date(dateTo);
      const matchesMin = !minAmount || e.amount >= parseFloat(minAmount);
      const matchesMax = !maxAmount || e.amount <= parseFloat(maxAmount);

      return matchesQuery && matchesCategory && matchesDateFrom && matchesDateTo && matchesMin && matchesMax;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, searchQuery, categoryFilter, dateFrom, dateTo, minAmount, maxAmount]);

  const filteredExpenses = useMemo(
    () => (partFilter === "all" ? scopedExpenses : scopedExpenses.filter(e => expensePartOf(e) === partFilter)),
    [scopedExpenses, partFilter]);

  const totalFiltered = useMemo(() => {
    return filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
  }, [filteredExpenses]);

  /**
   * Ce que chaque activité a dépensé sur la période filtrée, et ce qu'elle a
   * réellement sorti de sa caisse. Le total seul ne disait pas qui payait.
   */
  const byPart = useMemo(() => PARTS.map(p => {
    const rows = scopedExpenses.filter(e => expensePartOf(e) === p.key);
    return {
      ...p,
      count: rows.length,
      total: rows.reduce((s, e) => s + (e.amount || 0), 0),
      cash: rows.filter(e => !e.accountId || isCashAccount(e.accountId)).reduce((s, e) => s + (e.amount || 0), 0),
      balance: partCash[p.key] || 0,
    };
  }), [scopedExpenses, partCash]);

  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      counts[e.category] = (counts[e.category] || 0) + e.amount;
    });
    const colors = ["#003049", "#d62828", "#f77f00", "#fcbf49", "#eae2b7", "#2a9d8f", "#264653"];
    return Object.entries(counts).map(([name, value], i) => ({
      name,
      value,
      color: colors[i % colors.length]
    })).sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

  const barData = useMemo(() => {
    const last6Months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        last6Months.push({
            month: d.toLocaleString('default', { month: 'short' }),
            monthNum: d.getMonth(),
            year: d.getFullYear(),
            amount: 0
        });
    }

    expenses.forEach(e => {
        const d = new Date(e.date);
        const match = last6Months.find(m => m.monthNum === d.getMonth() && m.year === d.getFullYear());
        if (match) match.amount += e.amount;
    });

    return last6Months;
  }, [expenses]);

  const topCategories = useMemo(() => {
    const now = new Date();
    const thisMonth = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const counts: Record<string, number> = {};
    thisMonth.forEach(e => {
        counts[e.category] = (counts[e.category] || 0) + e.amount;
    });
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
  }, [expenses]);

  // Monthly comparison
  const monthlyComparison = useMemo(() => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const thisMonthTotal = expenses
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
      })
      .reduce((acc, e) => acc + e.amount, 0);

    const lastMonthTotal = expenses
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === lastMonth.getMonth() && d.getFullYear() === lastMonth.getFullYear();
      })
      .reduce((acc, e) => acc + e.amount, 0);

    const difference = thisMonthTotal - lastMonthTotal;
    const percentChange = lastMonthTotal === 0 ? 0 : ((difference / lastMonthTotal) * 100);

    return {
      thisMonth: thisMonthTotal,
      lastMonth: lastMonthTotal,
      difference,
      percentChange
    };
  }, [expenses]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, receipt: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddCategory = () => {
    const newCat = window.prompt("Nom de la nouvelle catégorie :");
    if (newCat && !settings.expenseCategories.includes(newCat)) {
      dispatch({
        type: "SET_SETTINGS",
        payload: { ...settings, expenseCategories: [...settings.expenseCategories, newCat] }
      });
      setFormData({ ...formData, category: newCat });
      toast.success(`Catégorie "${newCat}" ajoutée ✓`);
    }
  };

  const handleSave = () => {
    if (!formData.description || !formData.amount || !formData.category) {
        toast.error("Veuillez remplir tous les champs requis");
        return;
    }

    const amount = parseFloat(formData.amount);
    const part: TreasuryPart = formData.part || 'carburant';
    // Payée en espèces, la dépense sort de la caisse de SON activité : la
    // caisse générale n'est débitée que pour une dépense de la Finance.
    const accountId = isCashAccount(formData.accountId) || !formData.accountId
      ? cashAccountOfPart(part)
      : formData.accountId;
    const paidCash = isCashAccount(accountId);
    const id = selectedExpense?.id || newId();
    const payload = {
        ...formData,
        amount,
        accountId,
        part,
        paymentMode: formData.paymentMode || (paidCash ? "Espèces" : "Virement"),
        id
    };

    if (selectedExpense) {
        dispatch({ type: "UPDATE_EXPENSE", payload });
    } else {
        dispatch({ type: "ADD_EXPENSE", payload });
    }

    // Trésorerie — the money leaves the caisse or the chosen bank account, so the
    // expense shows up in that account's historique and moves its solde.
    // Rewriting the line of this expense keeps the soldes exact after an edit.
    treasuryTransactions
      .filter(t => t.refType === 'expense' && t.refId === id)
      .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
    // Une dépense née d'une brigade n'écrit AUCUNE ligne de trésorerie : son
    // montant manque déjà aux espèces remises par la brigade. Lui en donner une
    // ferait sortir le même argent une seconde fois (`lib/brigadeExpenses.ts`).
    if (amount > 0 && !payload.brigadeId) {
      const tx: TreasuryTransaction = {
        id: newId(),
        date: new Date(formData.date).toISOString(),
        kind: 'EXPENSE',
        amount,
        description: `Dépense ${formData.category} — ${formData.description}`
          + (formData.recipient ? ` (${formData.recipient})` : ''),
        accountFrom: accountId,
        // La ligne appartient à l'activité qui paie : c'est ce qui fait sortir
        // l'argent de SA caisse, et non plus de la caisse générale.
        part,
        refType: 'expense', refId: id,
        chequeNumber: formData.chequeNumber || undefined,
        bordereauNumber: formData.bordereauNumber || undefined,
        createdBy: currentUserName,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
    }

    toast.success(selectedExpense
      ? `Dépense mise à jour ✓ — ${accountLabel(accountId)} mis à jour`
      : `Dépense enregistrée ✓ — débitée de ${accountLabel(accountId)}`);

    setShowModal(false);
    setSelectedExpense(null);
    setFormData(emptyForm());
  };

  const handleDelete = (id: string) => {
    setExpenseToDelete(id);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (expenseToDelete) {
      // The ledger line goes with the expense so the account solde is restored.
      treasuryTransactions
        .filter(t => t.refType === 'expense' && t.refId === expenseToDelete)
        .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
      dispatch({ type: "DELETE_EXPENSE", payload: expenseToDelete });
      toast.success("Dépense supprimée ✓ — solde du compte rétabli");
      setShowDeleteConfirm(false);
      setExpenseToDelete(null);
      setOpenMenuId(null);
    }
  };

  const handlePrint = (expense: any) => {
    // Create print layout
    const printWindow = window.open('', '', 'height=600,width=800');
    if (!printWindow) {
      toast.error("Impossible d'ouvrir la fenêtre d'impression");
      return;
    }

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Reçu Dépense - ${expense.description}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 20px; }
            .receipt { max-width: 400px; margin: 0 auto; border: 1px solid #ccc; padding: 30px; }
            .header { text-align: center; border-bottom: 2px solid #003049; padding-bottom: 20px; margin-bottom: 30px; }
            .station-name { font-size: 18px; font-weight: bold; color: #003049; }
            .section { margin-bottom: 25px; }
            .section-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 10px; letter-spacing: 1px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; }
            .label { color: #666; }
            .value { font-weight: bold; color: #003049; }
            .amount-section { border-top: 2px solid #003049; border-bottom: 2px solid #003049; padding: 15px 0; margin-bottom: 25px; text-align: center; }
            .amount { font-size: 28px; font-weight: bold; color: #003049; }
            .currency { font-size: 14px; }
            .receipt-image { width: 100%; max-height: 150px; margin: 20px 0; border: 1px solid #ddd; }
            .signature-line { border-top: 1px solid #333; width: 100%; margin-top: 40px; padding-top: 5px; text-align: center; font-size: 10px; color: #666; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="receipt">
            <div class="header">
              <div class="station-name">${settings?.name || 'STATION NAFTAL'}</div>
              <div style="font-size: 10px; color: #666; margin-top: 5px;">${settings?.address || 'MAROC'}</div>
            </div>

            <div class="section">
              <div class="section-title">Détails de la Dépense</div>
              <div class="row">
                <span class="label">Catégorie:</span>
                <span class="value">${expense.category}</span>
              </div>
              <div class="row">
                <span class="label">Description:</span>
                <span class="value">${expense.description}</span>
              </div>
              <div class="row">
                <span class="label">Date:</span>
                <span class="value">${new Date(expense.date).toLocaleDateString('fr-FR')}</span>
              </div>
              <div class="row">
                <span class="label">Mode Paiement:</span>
                <span class="value">${expense.paymentMode || expense.mode}</span>
              </div>
              <div class="row">
                <span class="label">Partie concernée:</span>
                <span class="value">${PART_LABEL[expensePartOf(expense)] || 'Carburant'}</span>
              </div>
              <div class="row">
                <span class="label">Compte débité:</span>
                <span class="value">${accountLabel(expense.accountId || cashAccountOfPart(expensePartOf(expense)))}</span>
              </div>
              ${expense.chequeNumber ? `<div class="row"><span class="label">N° Chèque:</span><span class="value">${expense.chequeNumber}</span></div>` : ''}
              ${expense.bordereauNumber ? `<div class="row"><span class="label">N° Bordereau:</span><span class="value">${expense.bordereauNumber}</span></div>` : ''}
              ${expense.paidBy ? `<div class="row"><span class="label">Payé par:</span><span class="value">${expense.paidBy}</span></div>` : ''}
              ${expense.recipient ? `<div class="row"><span class="label">Reçu de:</span><span class="value">${expense.recipient}</span></div>` : ''}
            </div>

            <div class="amount-section">
              <div class="amount">${expense.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div class="currency">DZD</div>
            </div>

            ${expense.receipt ? `<img src="${expense.receipt}" class="receipt-image" alt="Justificatif" />` : ''}

            <div class="signature-line">Signature / Validation</div>
          </div>
        </body>
      </html>
    `;
    
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
    setOpenMenuId(null);
  };

  const handleEdit = (expense: any) => {
    setSelectedExpense(expense);
    // Expenses saved before the bank accounts existed were paid in cash, and
    // those saved before the parts existed were carried by the Carburant.
    const part = expensePartOf(expense);
    setFormData({
      ...emptyForm(),
      ...expense,
      part,
      accountId: expense.accountId && !isCashAccount(expense.accountId)
        ? expense.accountId
        : cashAccountOfPart(part),
      bordereauNumber: expense.bordereauNumber || "",
      chequeNumber: expense.chequeNumber || "",
    });
    setShowModal(true);
  };

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 italic text-left">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">
            Gestion des Dépenses
          </h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">
            Gérez les frais fixes, salaires et entretiens de la station.
          </p>
        </div>
        <div className="flex gap-2">
           <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 italic">
             {([
               { id: "table", label: "Tableau", icon: List },
               { id: "grid", label: "Cartes", icon: LayoutGrid },
               { id: "analytics", label: "Analyses", icon: BarChartIcon },
             ] as const).map(opt => (
               <button
                 key={opt.id}
                 onClick={() => setViewMode(opt.id)}
                 className={cn(
                   "px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-2",
                   viewMode === opt.id ? "bg-blue-900 text-white shadow" : "text-slate-500 hover:bg-slate-50",
                 )}
               >
                 <opt.icon className="w-4 h-4" /> {opt.label}
               </button>
             ))}
           </div>
           {perm.creer && (
           <button
            onClick={() => { setSelectedExpense(null); setFormData(emptyForm()); setShowModal(true); }}
            className="h-14 px-8 bg-gradient-to-r from-[#001f5c] via-[#002d85] to-[#001f5c] text-[#FFB800] border border-blue-900 hover:border-[#FFB800] rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-blue-950/20 hover:scale-105 transition-all flex items-center gap-3 italic"
           >
            <Plus className="w-5 h-5 text-[#FFB800]" /> NOUVELLE DÉPENSE
           </button>
           )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode !== "analytics" ? (
          <motion.div key="list" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
               <div className="bg-gradient-to-br from-[#001f5c] via-[#003087] to-[#002470] text-white p-8 rounded-[2rem] shadow-xl relative overflow-hidden border border-blue-700">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFB800]/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl pointer-events-none" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFB800]/80 italic">Total pour la période</p>
                  <p className="text-3xl font-black mt-2 italic tracking-tighter">{totalFiltered.toLocaleString()} <span className="text-sm font-bold opacity-60">DA</span></p>
               </div>
               <div className="bg-white p-8 rounded-[2rem] border border-slate-100 flex flex-col justify-center shadow-sm">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic mb-1">Catégorie Principale</p>
                  <p className="text-xl font-black text-blue-900 uppercase italic">{pieData[0]?.name || "N/A"}</p>
               </div>
               <div className="bg-white p-8 rounded-[2rem] border border-slate-100 flex flex-col justify-center shadow-sm">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic mb-1">Nb. Opérations</p>
                  <p className="text-xl font-black text-blue-900 uppercase italic">{filteredExpenses.length}</p>
               </div>
               <div className="bg-white p-8 rounded-[2rem] border border-slate-100 flex flex-col justify-center shadow-sm">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic mb-1">Moyenne par opération</p>
                  <p className="text-xl font-black text-blue-900 uppercase italic">
                    {(filteredExpenses.length > 0 ? Math.round(totalFiltered / filteredExpenses.length) : 0).toLocaleString()} DA
                  </p>
               </div>
            </div>

            {/* Ce que chaque activité a dépensé, et ce qui reste dans sa caisse.
                Une dépense en espèces sort du tiroir de SON activité : cette
                bande est la lecture directe de cette règle. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {byPart.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPartFilter(partFilter === p.key ? 'all' : p.key)}
                  className={cn(
                    "bg-white p-5 rounded-[2rem] border text-left transition-all shadow-sm",
                    partFilter === p.key ? "border-blue-900 ring-2 ring-blue-900/10" : "border-slate-100 hover:border-blue-200",
                  )}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest italic" style={{ color: p.tone }}>{p.short}</p>
                  <p className="text-xl font-black text-blue-900 italic tracking-tighter mt-1">{p.total.toLocaleString('fr-FR')} DA</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    {p.count} dépense(s) · {p.cash.toLocaleString('fr-FR')} DA en espèces
                  </p>
                  <p className={cn("text-[10px] font-black tabular-nums mt-1", p.balance >= 0 ? "text-emerald-600" : "text-red-600")}>
                    Caisse : {p.balance.toLocaleString('fr-FR')} DA
                  </p>
                </button>
              ))}
            </div>

            {/* Filters */}
            <div className="p-6 border border-slate-100 rounded-3xl flex flex-wrap items-center justify-between gap-6 bg-white shadow-sm italic">
              <div className="flex items-center gap-4 flex-1 min-w-[300px]">
                <div className="relative flex-1">
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                  <input 
                    type="text" 
                    placeholder="Description, catégorie, bénéficiaire, n° chèque..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-14 pr-6 h-14 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner text-blue-900 placeholder-slate-400"
                  />
                </div>
                <select 
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="input-field h-14 w-40 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner px-6 text-blue-900 italic"
                >
                  <option value="all">Toutes les catégories</option>
                  {settings.expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={partFilter}
                  onChange={(e) => setPartFilter(e.target.value as any)}
                  className="input-field h-14 w-44 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner px-6 text-blue-900 italic"
                >
                  <option value="all">Toutes les parties</option>
                  {PARTS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>

              <div className="flex gap-2 shrink-0">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-slate-450 uppercase tracking-widest ml-1">Début</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 font-semibold text-xs outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-slate-450 uppercase tracking-widest ml-1">Fin</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 font-semibold text-xs outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800" />
                </div>
                <button 
                  onClick={() => { setSearchQuery(""); setCategoryFilter("all"); setDateFrom(""); setDateTo(""); setMinAmount(""); setMaxAmount(""); }}
                  className="text-[10px] font-black text-blue-900 uppercase tracking-widest hover:underline h-10 flex items-center"
                >
                  Réinitialiser
                </button>
              </div>
            </div>

            {/* Table view — the dense default */}
            {viewMode === "table" && (
              filteredExpenses.length > 0 ? (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden not-italic">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          {["Date", "Description", "Catégorie", "Partie", "Compte débité", "Mode", "Montant", ""].map((h, i) => (
                            <th key={h || i} className={cn("px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest", i === 6 ? "text-right" : "text-left")}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredExpenses.map(expense => {
                          const part = expensePartOf(expense);
                          const acct = expense.accountId || cashAccountOfPart(part);
                          return (
                            <tr key={expense.id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-4 py-3 text-[11px] font-bold text-slate-500 whitespace-nowrap">{new Date(expense.date).toLocaleDateString('fr-FR')}</td>
                              <td className="px-4 py-3">
                                <p className="font-black text-blue-900 uppercase tracking-tight text-xs">{expense.description}</p>
                                {expense.recipient && <p className="text-[10px] text-slate-400 font-bold">{expense.recipient}</p>}
                                {(() => {
                                  const bi = brigadeOf(expense);
                                  if (!bi) return null;
                                  return (
                                    <p className="mt-1 inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                                      ⛽ {bi.label}
                                      {bi.pompiste ? ` · ${bi.pompiste}` : ''}
                                      {bi.chef ? ` · Chef ${bi.chef}` : ''}
                                    </p>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[9px] font-black uppercase px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{expense.category}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[9px] font-black uppercase text-slate-500">{PARTS.find(p => p.key === part)?.short || 'Carburant'}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                                  {isCashAccount(acct) ? <Banknote className="w-3.5 h-3.5 text-slate-400" /> : <Landmark className="w-3.5 h-3.5 text-slate-400" />}
                                  <span className="truncate max-w-[160px]">{accountLabel(acct)}</span>
                                </span>
                              </td>
                              <td className="px-4 py-3 text-[11px] font-bold text-slate-500">{expense.paymentMode || expense.mode}</td>
                              <td className="px-4 py-3 text-right font-black text-blue-900 tabular-nums whitespace-nowrap">{expense.amount.toLocaleString('fr-FR')} DA</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  {perm.modifier && (
                                    <button onClick={() => handleEdit(expense)} title="Modifier" className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-colors"><Edit2 className="w-4 h-4" /></button>
                                  )}
                                  {perm.imprimer && (
                                    <button onClick={() => handlePrint(expense)} title="Imprimer" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"><Printer className="w-4 h-4" /></button>
                                  )}
                                  {perm.supprimer && (
                                    <button onClick={() => handleDelete(expense.id)} title="Supprimer" className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 bg-white rounded-3xl border border-slate-100">
                  <TrendingDown className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-350 font-black uppercase tracking-[0.3em] text-xs">Aucune dépense trouvée avec ces filtres</p>
                </div>
              )
            )}

            {/* Cards Grid */}
            {viewMode === "grid" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredExpenses.length > 0 ? (
                filteredExpenses.map((expense, index) => (
                  <motion.div
                    key={expense.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.03 }}
                    className={cn(
                      "group relative bg-white rounded-3xl border hover:shadow-2xl transition-all p-6 space-y-4 italic flex flex-col",
                      openMenuId === expense.id ? "z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl" : "z-10 border-slate-100 hover:border-blue-200 shadow-sm"
                    )}
                  >
                    {/* Top Gradient Border */}
                    <div className="h-2 absolute top-0 left-0 right-0 rounded-t-3xl bg-gradient-to-r from-blue-900 via-blue-800 to-yellow-400" />
                    
                    {/* Category + part badges — qui a payé se lit sur la carte */}
                    <div className="absolute top-4 left-4 flex items-center gap-1.5">
                      <span className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block bg-blue-50 text-blue-700 border-blue-100">
                        {expense.category}
                      </span>
                      <span className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block bg-slate-50 text-slate-600 border-slate-200">
                        {PARTS.find(p => p.key === expensePartOf(expense))?.short || 'Carburant'}
                      </span>
                    </div>

                    {/* Actions Dropdown Button */}
                    <div className="absolute top-4 right-4">
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === expense.id ? null : expense.id);
                        }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-blue-900 transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </motion.button>

                      {/* Action Menu */}
                      <AnimatePresence>
                        {openMenuId === expense.id && (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 mt-2 w-52 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[60] overflow-hidden"
                          >
                            <div className="divide-y divide-slate-100">
                              {perm.modifier && (
                              <button
                                onClick={() => { handleEdit(expense); setOpenMenuId(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                              >
                                <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                              </button>
                              )}
                              {perm.imprimer && (
                              <button
                                onClick={() => { handlePrint(expense); setOpenMenuId(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                              >
                                <Printer className="w-4 h-4 text-slate-500" /> Imprimer
                              </button>
                              )}
                              {perm.supprimer && (
                              <button
                                onClick={() => { handleDelete(expense.id); setOpenMenuId(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" /> Supprimer
                              </button>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Description and Date */}
                    <div className="flex flex-col items-start text-left gap-3 pt-6">
                      <div>
                        <h4 className="font-black text-blue-900 uppercase tracking-tight text-sm mb-1 line-clamp-2">{expense.description}</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{new Date(expense.date).toLocaleDateString('fr-FR')}</p>
                      </div>
                    </div>

                    {/* Payment Info Panel */}
                    <div className="space-y-2 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50/50 p-4 rounded-2xl border border-slate-100/50">
                      <div className="flex items-center gap-2.5">
                        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                        <span>{expense.paymentMode || expense.mode}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {isCashAccount(expense.accountId) || !expense.accountId
                          ? <Banknote className="w-3.5 h-3.5 text-slate-400" />
                          : <Landmark className="w-3.5 h-3.5 text-slate-400" />}
                        <span className="truncate">
                          {accountLabel(expense.accountId || cashAccountOfPart(expensePartOf(expense)))}
                        </span>
                      </div>
                      {expense.recipient && (
                        <div className="flex items-center gap-2.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="truncate">{expense.recipient}</span>
                        </div>
                      )}
                      {(() => {
                        const bi = brigadeOf(expense);
                        if (!bi) return null;
                        return (
                          <div className="pt-2 mt-1 border-t border-slate-200/70 space-y-1 text-emerald-700">
                            <p className="text-[9px] font-black uppercase tracking-widest">Justifiée sur une brigade</p>
                            <p className="normal-case tracking-normal font-bold text-[10px]">{bi.label}</p>
                            {(bi.pompiste || bi.chef) && (
                              <p className="normal-case tracking-normal text-[10px] text-slate-500">
                                {[bi.pompiste && `Pompiste ${bi.pompiste}`, bi.chef && `Chef ${bi.chef}`].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            <p className="normal-case tracking-normal text-[9px] text-slate-400">
                              Payée sur les espèces de la brigade — la caisse n'est pas débitée une seconde fois.
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Amount Footer */}
                    <div className="pt-2 mt-auto border-t border-slate-100 flex justify-between items-center">
                      <div className="flex flex-col">
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Montant</p>
                        <p className="text-[14px] font-black text-blue-900 italic">{expense.amount.toLocaleString()} DA</p>
                      </div>
                      {expense.receipt && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-[7px] font-black text-green-700 uppercase">Justificatif</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="col-span-full">
                  <div className="text-center py-12">
                    <TrendingDown className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-350 font-black uppercase tracking-[0.3em] text-xs">Aucune dépense trouvée avec ces filtres</p>
                  </div>
                </div>
              )}
            </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="analytics" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-8">
                   <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black text-blue-900 uppercase tracking-[0.2em] italic">Répartition par Catégorie</h3>
                      <PieChartIcon className="w-6 h-6 text-slate-200" />
                   </div>
                   <ChartBox height={300}>
                        <PieChart>
                           <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={5}
                              dataKey="value"
                           >
                              {pieData.map((entry, index) => (
                               <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                           </Pie>
                           <Tooltip 
                             contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                             itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                           />
                           <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                   </ChartBox>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-8">
                   <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black text-blue-900 uppercase tracking-[0.2em] italic">Évolution Mensuelle</h3>
                      <TrendingDown className="w-6 h-6 text-red-500" />
                   </div>
                   <ChartBox height={300}>
                        <BarChart data={barData}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                           <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94A3B8' }} />
                           <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94A3B8' }} />
                           <Tooltip 
                             cursor={{ fill: '#F8FAFC' }}
                             contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                           />
                           <Bar dataKey="amount" fill="#003087" radius={[8, 8, 0, 0]} />
                        </BarChart>
                   </ChartBox>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="p-10 bg-gradient-to-br from-[#001f5c] via-[#003087] to-[#002470] border border-blue-800 rounded-[2.5rem] text-white flex flex-col justify-center gap-2 relative overflow-hidden group shadow-lg">
                   <div className="absolute top-0 right-0 p-8 bg-[#FFB800] opacity-5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500 pointer-events-none" />
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#FFB800] italic">Moyenne mensuelle (6 mois)</p>
                   <p className="text-4xl font-black text-white italic tracking-tighter">
                     {(barData.reduce((acc, b) => acc + b.amount, 0) / barData.length).toLocaleString()} 
                     <span className="text-sm ml-1 text-slate-400 font-bold">DA</span>
                   </p>
                </div>
                <div className="p-10 bg-white border border-slate-100 rounded-[2.5rem] flex flex-col justify-center gap-2 relative overflow-hidden group shadow-sm">
                   <div className="absolute bottom-0 right-0 p-8 bg-blue-900 opacity-5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500 pointer-events-none" />
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] italic">Comparaison Mois Courant</p>
                   <div className="flex items-center gap-4 mt-2">
                      <div>
                        <p className="text-3xl font-black text-blue-900 italic tracking-tighter">{monthlyComparison.thisMonth.toLocaleString()} DA</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Ce mois</p>
                      </div>
                      <div className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg font-black text-[11px] uppercase tracking-widest",
                        monthlyComparison.difference >= 0 
                          ? "bg-red-105 text-red-600" 
                          : "bg-green-105 text-green-600"
                      )}>
                        {monthlyComparison.difference >= 0 ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                        <span>{Math.abs(monthlyComparison.percentChange).toFixed(1)}%</span>
                      </div>
                   </div>
                   <p className="text-[9px] text-slate-400 italic mt-2">vs. {monthlyComparison.lastMonth.toLocaleString()} DA (mois dernier)</p>
                </div>
             </div>

             {/* Top Categories */}
             <div className="p-10 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm">
                <h3 className="text-xs font-black text-blue-900 uppercase tracking-[0.2em] italic mb-6">Top 3 Catégories ce Mois</h3>
                <div className="space-y-3">
                  {topCategories.map(([name, val], idx) => (
                    <div key={name} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-900/30 transition-all">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-blue-900 text-white flex items-center justify-center font-black text-xs">{idx + 1}</span>
                        <span className="font-black text-blue-900 uppercase tracking-wider">{name}</span>
                      </div>
                      <span className="font-black text-blue-950 text-lg tracking-tighter">{val.toLocaleString()} DA</span>
                    </div>
                  ))}
                  {topCategories.length === 0 && (
                    <p className="text-center text-slate-400 italic py-8">Aucune dépense ce mois</p>
                  )}
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="modal-shell z-[70]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDeleteConfirm(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] relative z-10 p-8 shadow-2xl border border-slate-100 space-y-6 text-center"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-red-100 mx-auto text-red-650 shadow-md">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="font-black text-lg text-slate-800 uppercase italic">Supprimer la Dépense</h3>
                <p className="text-slate-500 text-xs font-semibold italic">Êtes-vous sûr de vouloir supprimer cette dépense ? Cette action est définitive et mettra à jour le solde associé.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 px-4 bg-white text-slate-750 rounded-xl font-black text-xs uppercase hover:bg-slate-100 transition-all border-2 border-slate-200">Annuler</button>
                <button onClick={handleConfirmDelete} className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md transition-all">Supprimer</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Expense Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-xl rounded-[2.5rem] relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden shadow-2xl border border-slate-100"
            >
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-lg font-black uppercase italic tracking-wide">
                    {selectedExpense ? "✏️ Modifier Dépense" : "💰 Saisir une Dépense"}
                  </h3>
                  <p className="text-xs text-white/60 mt-0.5 font-bold">Veuillez renseigner les informations de la dépense</p>
                </div>
                <button onClick={() => setShowModal(false)} className="hover:bg-white/20 p-2 rounded-lg transition-all"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <section className="space-y-6">
                  {/* Une dépense de brigade est le REFLET de sa justification :
                      la corriger ici ne tient que jusqu'au prochain
                      enregistrement de la brigade, qui la réécrit. */}
                  {(() => {
                    const bi = brigadeOf(selectedExpense);
                    if (!bi) return null;
                    return (
                      <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 not-italic">
                        <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Dépense justifiée sur une brigade</p>
                        <p className="text-xs font-bold text-emerald-900 mt-1">
                          {bi.label}{bi.pompiste ? ` · Pompiste ${bi.pompiste}` : ''}{bi.chef ? ` · Chef ${bi.chef}` : ''}
                        </p>
                        <p className="text-[10px] font-semibold text-emerald-700/80 mt-1.5">
                          Elle a été payée sur les espèces de la brigade : aucune caisse n'est débitée ici.
                          Corrigez-la de préférence dans la comptabilité de la brigade — un nouvel
                          enregistrement de celle-ci réécrira cette ligne.
                        </p>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Informations Principales</h4>
                    <button onClick={handleAddCategory} className="text-[10px] font-black text-blue-900 uppercase tracking-widest flex items-center gap-1.5 hover:underline">
                      <Plus className="w-3.5 h-3.5 text-amber-550" /> Nouvelle Catégorie
                    </button>
                  </div>
                  <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                           <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Catégorie</label>
                           <select
                            className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800"
                            value={formData.category}
                            onChange={e => setFormData({ ...formData, category: e.target.value })}
                           >
                              <option value="">Sélectionner...</option>
                              {settings.expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                           </select>
                           {/* Delete chip for selected category */}
                           {formData.category && (
                             <div className="flex items-center gap-1.5 mt-1">
                               <span className="text-[9px] font-black bg-yellow-100 text-yellow-800 px-2.5 py-1 rounded-full flex items-center gap-1 italic uppercase">
                                 {formData.category}
                                 <button
                                   onClick={() => {
                                     dispatch({ type: 'SET_SETTINGS', payload: { ...settings, expenseCategories: settings.expenseCategories.filter(c => c !== formData.category) } });
                                     setFormData({ ...formData, category: "" });
                                   }}
                                   className="hover:text-red-600 transition-colors"
                                   title="Supprimer cette catégorie"
                                 ><X className="w-3 h-3" /></button>
                               </span>
                             </div>
                           )}
                        </div>
                        <div className="space-y-1.5">
                           <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Date</label>
                           <input 
                            type="date" className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800" 
                            value={formData.date}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                           />
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Description / Motif</label>
                        <input 
                          type="text" className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-850" placeholder="Ex: Réparation tuyau cuve..." 
                          value={formData.description}
                          onChange={e => setFormData({ ...formData, description: e.target.value })}
                        />
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Montant (DA)</label>
                        <input 
                          type="number" className="w-full h-12 px-4 bg-slate-50 border-2 border-slate-200 rounded-xl text-base font-black focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-850" placeholder="0.00" 
                          value={formData.amount}
                          onChange={e => setFormData({ ...formData, amount: e.target.value })}
                        />
                     </div>
                     {/* Partie concernée — ce choix décide de QUELLE caisse
                         sortent les espèces : celle de l'activité qui paie. */}
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Partie concernée (qui paie)</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {PARTS.map(p => {
                            const on = (formData.part || 'carburant') === p.key;
                            return (
                              <button
                                key={p.key}
                                type="button"
                                onClick={() => setFormData({
                                  ...formData,
                                  part: p.key,
                                  // Un paiement en espèces suit l'activité choisie ;
                                  // un paiement bancaire garde son compte.
                                  accountId: isCashAccount(formData.accountId) || !formData.accountId
                                    ? cashAccountOfPart(p.key)
                                    : formData.accountId,
                                })}
                                className={cn(
                                  "rounded-xl p-2.5 text-left border transition-all",
                                  on ? "border-blue-900 bg-blue-50 ring-2 ring-blue-900/10" : "border-slate-200 bg-white hover:border-slate-300",
                                )}
                              >
                                <p className={cn("text-[10px] font-black leading-tight", on ? "text-blue-900" : "text-slate-500")}>{p.short}</p>
                                <p className={cn("text-[10px] font-black tabular-nums mt-0.5", (partCash[p.key] || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>
                                  {(partCash[p.key] || 0).toLocaleString('fr-FR')} DA
                                </p>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 pl-1">
                          La dépense pèse dans le rapport de cette activité, et ses espèces sortent de SA caisse.
                        </p>
                     </div>

                     {/* Payment method — the caisse of the chosen part or one of
                         the bank accounts. The chosen account is debited and the
                         dépense appears in its historique. */}
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Mode de paiement / Compte débité</label>
                        <select
                         className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800"
                         value={isCashAccount(formData.accountId) || !formData.accountId
                           ? cashAccountOfPart(formData.part || 'carburant')
                           : formData.accountId}
                         onChange={e => {
                           const accountId = e.target.value;
                           setFormData({
                             ...formData,
                             accountId,
                             // Espèces only makes sense for a cash box.
                             paymentMode: isCashAccount(accountId)
                               ? "Espèces"
                               : (formData.paymentMode && formData.paymentMode !== "Espèces" ? formData.paymentMode : "Virement"),
                           });
                         }}
                        >
                           <option value={cashAccountOfPart(formData.part || 'carburant')}>
                             Espèces — {accountLabel(cashAccountOfPart(formData.part || 'carburant'))} ({(partCash[formData.part || 'carburant'] || 0).toLocaleString('fr-FR')} DA)
                           </option>
                           {accounts.length > 0 && (
                             <optgroup label="Comptes bancaires">
                               {accounts.map(a => (
                                 <option key={a.id} value={a.id}>{a.name} — {a.balance.toLocaleString('fr-FR')} DA</option>
                               ))}
                             </optgroup>
                           )}
                        </select>
                        {accounts.length === 0 && (
                          <p className="text-[9px] font-bold text-slate-400 pl-1">
                            Aucun compte bancaire — créez-en un dans « Comptes Bancaires » pour payer par banque.
                          </p>
                        )}
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                           <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Type d'opération</label>
                           <select
                            className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800"
                            value={formData.paymentMode}
                            onChange={e => setFormData({ ...formData, paymentMode: e.target.value })}
                           >
                              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                           </select>
                        </div>
                        <div className="space-y-1.5">
                           <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Payé par</label>
                           <select
                            className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-800"
                            value={formData.paidBy}
                            onChange={e => setFormData({ ...formData, paidBy: e.target.value })}
                           >
                              <option value="Caisse">Caisse</option>
                              <option value="Chef de Brigade">Chef de Brigade</option>
                              <option value="Admin">Admin</option>
                           </select>
                        </div>
                     </div>

                     {(!isCashAccount(formData.accountId || cashAccountOfPart(formData.part))
                       || ["Chèque", "Virement", "Prélèvement"].includes(formData.paymentMode)) && (
                       <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-1.5">
                           <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Numéro de Chèque</label>
                           <input
                            type="text" className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-850" placeholder="Optionnel"
                            value={formData.chequeNumber}
                            onChange={e => setFormData({ ...formData, chequeNumber: e.target.value })}
                           />
                         </div>
                         <div className="space-y-1.5">
                           <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Numéro de Bordereau</label>
                           <input
                            type="text" className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-850" placeholder="Optionnel"
                            value={formData.bordereauNumber}
                            onChange={e => setFormData({ ...formData, bordereauNumber: e.target.value })}
                           />
                         </div>
                       </div>
                     )}

                     {/* Effect on the debited account — le tiroir qui va se vider */}
                     {(() => {
                       const account = isCashAccount(formData.accountId) || !formData.accountId
                         ? cashAccountOfPart(formData.part || 'carburant')
                         : formData.accountId;
                       const before = isCashAccount(account)
                         ? (partCash[formData.part || 'carburant'] || 0)
                         : (accounts.find(a => a.id === account)?.balance || 0);
                       // Modifier une dépense déjà enregistrée : son ancien montant
                       // revient dans le compte avant d'en ressortir.
                       const givenBack = selectedExpense
                         && (selectedExpense.accountId || cashAccountOfPart(expensePartOf(selectedExpense))) === account
                         ? (selectedExpense.amount || 0) : 0;
                       const after = before - (parseFloat(formData.amount) || 0) + givenBack;
                       return (
                         <div className="rounded-2xl bg-slate-50 border border-slate-150 p-4 flex items-center justify-between gap-3">
                           <div className="min-w-0">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Compte débité</p>
                             <p className="text-xs font-black text-blue-900 truncate">{accountLabel(account)}</p>
                             <p className="text-[9px] font-bold text-slate-400 truncate">Imputée à {PART_LABEL[formData.part || 'carburant']}</p>
                           </div>
                           <div className="text-right shrink-0">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Solde après</p>
                             <p className={cn("text-xs font-black tabular-nums", after < 0 ? "text-red-600" : "text-blue-900")}>
                               {after.toLocaleString('fr-FR')} DA
                             </p>
                             {after < 0 && (
                               <p className="text-[9px] font-bold text-red-500">Ce compte passera à découvert.</p>
                             )}
                           </div>
                         </div>
                       );
                     })()}
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">Reçu de (Bénéficiaire/Prestataire)</label>
                        <input 
                          type="text" className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-900 focus:bg-white italic transition-all text-slate-850" placeholder="Ex: Électricien Ahmed..." 
                          value={formData.recipient}
                          onChange={e => setFormData({ ...formData, recipient: e.target.value })}
                        />
                     </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 italic">Justificatif</h4>
                  <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                  {formData.receipt ? (
                    <div className="relative group rounded-2xl overflow-hidden border border-slate-150 italic shadow-inner">
                      <img src={formData.receipt} alt="Reçu" className="w-full h-48 object-cover transition-transform group-hover:scale-105" />
                      <div className="absolute inset-0 bg-slate-900/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                         <button onClick={() => fileInputRef.current?.click()} className="p-3 bg-white rounded-xl text-blue-900 shadow-lg hover:scale-110 transition-all"><RefreshCcw className="w-5 h-5" /></button>
                         <button onClick={() => setFormData({ ...formData, receipt: null })} className="p-3 bg-white rounded-xl text-red-500 shadow-lg hover:scale-110 transition-all"><X className="w-5 h-5" /></button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-32 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3 hover:bg-slate-50 transition-all text-slate-400 group italic shadow-inner"
                    >
                       <Camera className="w-8 h-8 opacity-30 group-hover:scale-110 transition-transform" />
                       <span className="text-[10px] font-black uppercase tracking-widest">Scanner ou Joindre Photo</span>
                    </button>
                   )}
                </section>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-200 flex gap-3 shrink-0 italic">
                 <button onClick={() => setShowModal(false)} className="flex-1 py-3 px-4 bg-white text-slate-700 rounded-xl font-black text-xs uppercase hover:bg-slate-100 transition-all border-2 border-slate-200">✕ Annuler</button>
                 <button onClick={handleSave} className="flex-[2] bg-gradient-to-r from-blue-900 to-blue-800 text-white font-black uppercase tracking-widest rounded-xl py-3 transition-all text-xs flex items-center justify-center gap-2 border border-blue-700 shadow-md shadow-blue-900/10 hover:shadow-lg">{selectedExpense ? "✓ MODIFIER LA DÉPENSE" : "✓ ENREGISTRER LA DÉPENSE"}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
};

export default Expenses;
