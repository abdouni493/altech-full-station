import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Users, Plus, Search, Filter, MoreVertical, Edit2, Trash2, Eye,
  Wallet, UserX, DollarSign, History as HistoryIcon, Shield, Contact,
  Briefcase, ShieldAlert, Printer, X, CreditCard, MapIcon, User as UserIcon,
  Save, Smartphone, Lock, Fuel, Loader, AlertCircle, Check, ArrowRight, Building2,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId, matchesSearch } from "@/src/lib/utils";
import { useAppState, useAppDispatch, useModulePermission, GerantWorker, Track, BrigadeChef } from "../store/AppContext";
import { provisionWorkerAccount } from "../lib/supabase";
import { emptyPermissions } from "../lib/permissionDefaults";

// Username must be 3-32 chars: lowercase letters, digits, dot, underscore, hyphen
const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import PermissionsModal from "../components/PermissionsModal";
import WorkerPaymentModal, { WorkerPaymentResult } from "../components/WorkerPaymentModal";
import WorkerDetailsModal from "../components/WorkerDetailsModal";
import { WEEKDAYS, DEFAULT_WORK_DAYS } from "../lib/workerPay";
import { ViewToggle, Table, Badge, RowActions, ActionBtn } from "@/src/components/biz/Kit";

// For now, we'll reuse Pompiste interface as Gerant type
type Gerant = GerantWorker;

const Gerants = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gerants, tracks, brigadeChefs, fuelSales, settings, currentUserRole } = useAppState();
  const perm = useModulePermission('Gérants');
  const dispatch = useAppDispatch();

  const currentMonth = new Date().toISOString().slice(0, 7);

  // Toolbar: recherche libre + filtre de statut
  const [search, setSearch] = useState("");
  // Tableau par défaut : la paie se lit en colonnes — salaire, acomptes, statut
  // du mois. Les fiches en cartes restent à un clic.
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [statusFilter, setStatusFilter] = useState<'tous' | 'Actif' | 'Inactif'>('tous');

  const visibleGerants: Gerant[] = useMemo(() => gerants.filter((g: Gerant) =>
    (statusFilter === 'tous' || g.status === statusFilter) &&
    matchesSearch(search, g.name, g.cin, g.phone, g.email)
  ), [gerants, search, statusFilter]);

  // Modals state
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [selectedGerant, setSelectedGerant] = useState<Gerant | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  // Activate account modal
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activatingGerant, setActivatingGerant] = useState<Gerant | null>(null);
  const [activatePassword, setActivatePassword] = useState("");
  const [activateLoading, setActivateLoading] = useState(false);

  // Form state
  const [form, setForm] = useState<Partial<Gerant>>({
    name: "",
    cin: "",
    phone: "",
    email: "",
    address: "",
    baseSalary: 5000,
    salaryType: 'mois',
    workDays: DEFAULT_WORK_DAYS,
    cnasDate: "",
    status: "Actif",
    hireDate: new Date().toISOString().split('T')[0]
  });
  const toggleWorkDay = (idx: number) => setForm(f => {
    const cur = f.workDays && f.workDays.length ? f.workDays : DEFAULT_WORK_DAYS;
    return { ...f, workDays: cur.includes(idx) ? cur.filter(d => d !== idx) : [...cur, idx] };
  });
  const payPaidDays = useMemo(() => (selectedGerant?.paymentRecord || []).flatMap(p => p.paidDays || []), [selectedGerant]);
  const payPaidMonths = useMemo(() => (selectedGerant?.paymentRecord || []).flatMap(p => p.paidMonths || []), [selectedGerant]);
  const detailGerant = selectedGerant ? (gerants.find(g => g.id === selectedGerant.id) || selectedGerant) : null;

  // Modal form states
  const [advanceForm, setAdvanceForm] = useState({ amount: 0, date: new Date().toISOString().split('T')[0], description: "" });
  const [absenceForm, setAbsenceForm] = useState({ cost: 0, date: new Date().toISOString().split('T')[0], description: "" });
  const [paymentForm, setPaymentForm] = useState({ month: "", mode: 'Espèces', chequeNumber: "", notes: "" });
  const [historyTab, setHistoryTab] = useState<'acomptes' | 'absences' | 'paiements'>('acomptes');
  const [permissionsTab, setPermissionsTab] = useState<Record<string, Record<string, boolean>>>({});

  // Generate unpaid months
  const unpaidMonths = useMemo(() => {
    if (!selectedGerant) return [];
    const now = new Date();
    const months: string[] = [];
    const paidSet = new Set((selectedGerant.paymentRecord || [])
      .filter(p => p.isPaid)
      .map(p => p.month)
    );
    
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = date.toISOString().slice(0, 7); // YYYY-MM format
      if (!paidSet.has(month)) months.push(month);
    }
    return months.sort();
  }, [selectedGerant]);

  // Calculate payment amounts
  const currentMonthForPayment = new Date().toISOString().slice(0, 7);
  const paymentCalc = useMemo(() => {
    if (!selectedGerant) return null;
    
    const monthAcomptes = (selectedGerant.acomptes || []).filter(a => 
      !a.isPaid && a.date.startsWith(currentMonthForPayment)
    );
    const monthAbsences = (selectedGerant.absences || []).filter(a => 
      !a.isPaid && a.date.startsWith(currentMonthForPayment)
    );
    
    const totalAcomptes = monthAcomptes.reduce((sum, a) => sum + a.amount, 0);
    const totalAbsences = monthAbsences.reduce((sum, a) => sum + a.cost, 0);
    const net = selectedGerant.baseSalary - totalAcomptes - totalAbsences;
    
    return {
      monthAcomptes,
      monthAbsences,
      totalAcomptes,
      totalAbsences,
      net
    };
  }, [selectedGerant]);

  const handleSave = async () => {
    if (!form.name || !form.cin) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Nom et CIN obligatoires" } });
      return;
    }

    if (form.hasAccess) {
      if (!form.username) {
        dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Nom d'utilisateur requis pour l'accès application" } });
        return;
      }
      if (!USERNAME_REGEX.test(form.username)) {
        dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Identifiant invalide (3-32 caractères, minuscules, chiffres, . _ -)" } });
        return;
      }
      if (!selectedGerant && !form.password) {
        dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Mot de passe requis pour créer le compte d'accès" } });
        return;
      }
    }

    let finalAuthUserId = selectedGerant?.authUserId;
    let finalHasAccess = !!form.hasAccess;

    if (selectedGerant) {
      if (form.hasAccess && !selectedGerant.authUserId && form.username && form.password) {
        const result = await provisionWorkerAccount({
          action: 'create',
          workerType: 'gerant',
          workerId: selectedGerant.id,
          username: form.username,
          password: form.password,
          name: form.name,
          email: form.email,
        });
        if (result.ok) {
          finalAuthUserId = result.auth_user_id;
        } else {
          finalHasAccess = false;
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Compte d'accès non créé: ${(result as {ok:false;error:string}).error}` } });
        }
      }
      else if (form.hasAccess && selectedGerant.authUserId && form.username && form.password) {
        const result = await provisionWorkerAccount({
          action: 'update_password',
          workerType: 'gerant',
          workerId: selectedGerant.id,
          username: form.username,
          password: form.password,
          email: form.email,
        });
        if (!result.ok) {
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Mot de passe non mis à jour: ${(result as {ok:false;error:string}).error}` } });
        }
      }
      else if (!form.hasAccess && selectedGerant.authUserId) {
        const result = await provisionWorkerAccount({
          action: 'delete',
          workerType: 'gerant',
          workerId: selectedGerant.id,
        });
        if (result.ok) {
          finalAuthUserId = undefined;
        } else {
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Compte d'accès non supprimé: ${(result as {ok:false;error:string}).error}` } });
        }
      }

      dispatch({ type: 'UPDATE_GERANT', payload: { ...selectedGerant, ...form, hasAccess: finalHasAccess, authUserId: finalAuthUserId } as Gerant });
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Gérant mis à jour" } });
    } else {
      const newGerantId = newId();

      if (form.hasAccess && form.username && form.password) {
        const result = await provisionWorkerAccount({
          action: 'create',
          workerType: 'gerant',
          workerId: newGerantId,
          username: form.username,
          password: form.password,
          name: form.name,
          email: form.email,
        });
        if (result.ok) {
          finalAuthUserId = result.auth_user_id;
        } else {
          finalHasAccess = false;
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Compte d'accès non créé: ${(result as {ok:false;error:string}).error}` } });
        }
      }

      const newGerant: Gerant = {
        ...form as Gerant,
        id: newGerantId,
        hasAccess: finalHasAccess,
        authUserId: finalAuthUserId,
        paymentRecord: [],
        acomptes: [],
        absences: [],
        permissions: emptyPermissions(),
      };
      dispatch({ type: 'ADD_GERANT', payload: newGerant });
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Gérant recruté" } });
    }
    setShowModal(false);
  };

  const handleDeleteGerant = async () => {
    if (!selectedGerant) return;

    try {
      // Clean up auth account first (if exists)
      if (selectedGerant.username) {
        const delResult = await provisionWorkerAccount({
          action: 'delete',
          workerType: 'gerant',
          workerId: selectedGerant.id,
        });
        if (!delResult.ok) {
          console.warn('[handleDeleteGerant] Auth deletion failed:', (delResult as {ok:false;error:string}).error);
          dispatch({ type: 'ADD_TOAST', payload: { type: 'warning', message: `Compte d'authentification non supprimé: ${(delResult as {ok:false;error:string}).error}` } });
        }
      }
    } catch (err) {
      console.error('[handleDeleteGerant] Auth cleanup error:', err);
      dispatch({ type: 'ADD_TOAST', payload: { type: 'warning', message: "Erreur lors de la suppression du compte d'authentification" } });
    }

    // Delete worker record from app state
    dispatch({ type: 'DELETE_GERANT', payload: selectedGerant.id });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Gérant supprimé avec succès" } });
    setShowConfirmDelete(false);
  };

  const handleActivateGerantAccount = async () => {
    if (!activatingGerant || !activatePassword) return;
    if (!activatingGerant.username) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Aucun identifiant défini pour ce gérant" } });
      return;
    }
    setActivateLoading(true);
    const result = await provisionWorkerAccount({
      action: 'create',
      workerType: 'gerant',
      workerId: activatingGerant.id,
      username: activatingGerant.username,
      password: activatePassword,
      name: activatingGerant.name,
      email: activatingGerant.email,
    });
    setActivateLoading(false);
    if (result.ok) {
      if (result.auth_user_id) {
        dispatch({ type: 'UPDATE_GERANT', payload: { ...activatingGerant, authUserId: result.auth_user_id } });
      }
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Compte activé pour ${activatingGerant.name}` } });
      setShowActivateModal(false);
      setActivatingGerant(null);
      setActivatePassword("");
    } else {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Activation échouée: ${(result as {ok:false;error:string}).error}` } });
    }
  };

  const handleAddAdvance = () => {
    if (!selectedGerant) return;
    const acompte = { id: newId(), ...advanceForm, isPaid: false };
    const acomptes = [...(selectedGerant.acomptes || []), acompte];
    setSelectedGerant({ ...selectedGerant, acomptes });
    dispatch({ type: 'UPDATE_WORKER_ACOMPTE', payload: { workerType: 'gerant', workerId: selectedGerant.id, acompte } });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Acompte enregistré" } });
    setShowAdvanceModal(false);
    setAdvanceForm({ amount: 0, date: new Date().toISOString().split('T')[0], description: "" });
  };

  const handleAddAbsence = () => {
    if (!selectedGerant) return;
    const absence = { id: newId(), ...absenceForm, isPaid: false };
    const absences = [...(selectedGerant.absences || []), absence];
    setSelectedGerant({ ...selectedGerant, absences });
    dispatch({ type: 'UPDATE_WORKER_ABSENCE', payload: { workerType: 'gerant', workerId: selectedGerant.id, absence } });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Absence enregistrée" } });
    setShowAbsenceModal(false);
    setAbsenceForm({ cost: 0, date: new Date().toISOString().split('T')[0], description: "" });
  };

  const handleSavePayment = (res: WorkerPaymentResult) => {
    if (!selectedGerant) return;
    const selAc = new Set(res.selectedAcompteIds);
    const selAb = new Set(res.selectedAbsenceIds);
    const monthKey = res.selectedMonths[0] || currentMonthForPayment;

    const record = {
      id: newId(),
      month: monthKey,
      baseSalary: res.breakdown.base,
      totalAcomptes: res.breakdown.acomptes,
      totalAbsences: res.breakdown.absences,
      bonusDecalage: 0,
      retenueDecalage: 0,
      netSalary: res.net,
      amount: res.net,
      paymentDate: res.date,
      paymentMode: res.mode,
      chequeNumber: res.chequeNumber || undefined,
      notes: res.notes || undefined,
      isPaid: true,
      paidDays: res.selectedDays,
      paidMonths: res.selectedMonths,
      primeType: res.prime?.type,
      primeValue: res.prime?.value,
      primeAmount: res.prime?.amount,
    };

    const updatedAcomptes = (selectedGerant.acomptes || []).map(a => selAc.has(a.id) ? { ...a, isPaid: true, monthPaid: monthKey } : a);
    const updatedAbsences = (selectedGerant.absences || []).map(a => selAb.has(a.id) ? { ...a, isPaid: true, monthPaid: monthKey } : a);

    (selectedGerant.acomptes || []).forEach(a => {
      if (selAc.has(a.id) && !a.isPaid) dispatch({ type: 'UPDATE_WORKER_ACOMPTE', payload: { workerType: 'gerant', workerId: selectedGerant.id, acompte: { ...a, isPaid: true, monthPaid: monthKey } } });
    });
    (selectedGerant.absences || []).forEach(a => {
      if (selAb.has(a.id) && !a.isPaid) dispatch({ type: 'UPDATE_WORKER_ABSENCE', payload: { workerType: 'gerant', workerId: selectedGerant.id, absence: { ...a, isPaid: true, monthPaid: monthKey } } });
    });

    dispatch({ type: 'ADD_WORKER_PAYMENT', payload: { workerType: 'gerant', workerId: selectedGerant.id, payment: record } });

    setSelectedGerant({
      ...selectedGerant,
      acomptes: updatedAcomptes,
      absences: updatedAbsences,
      paymentRecord: [...(selectedGerant.paymentRecord || []), record]
    });

    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: 'Paiement enregistré' } });
    setShowPaymentModal(false);
  };

  const resetForm = () => {
    setForm({ name: "", cin: "", phone: "", email: "", address: "", baseSalary: 5000, salaryType: 'mois', workDays: DEFAULT_WORK_DAYS, cnasDate: "", status: "Actif", hireDate: new Date().toISOString().split('T')[0] });
    setSelectedGerant(null);
  };

  const modules = [
    { name: 'Brigades', icon: '📅' },
    { name: 'Ventes Carburant', icon: '⛽' },
    { name: 'Vente Magasin', icon: '🛒' },
    { name: 'Cuves', icon: '🛢️' },
    { name: 'Pompes', icon: '🔌' },
    { name: 'Pistes', icon: '🛣️' },
    { name: 'Livraisons', icon: '📦' },
    { name: 'Produits', icon: '🏷️' },
    { name: 'Achats', icon: '🛍️' },
    { name: 'Inventaire', icon: '📋' },
    { name: 'Clients', icon: '👥' },
    { name: 'Fournisseurs', icon: '🚚' },
    { name: 'Chefs Brigade', icon: '👮' },
    { name: 'Gérants', icon: '💼' },
    { name: 'Employés Magasin', icon: '🧑‍🌾' },
    { name: 'Dépenses', icon: '💸' },
    { name: 'Fiche Journalière', icon: '📝' },
    { name: 'Statistiques', icon: '📊' },
    { name: 'Rapports', icon: '📈' },
    { name: 'Paramètres', icon: '⚙️' }
  ];

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 italic text-left">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[#002d87] uppercase italic tracking-tighter leading-none">Gestion des Gérants</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Gérez vos gérants de station et leur paie.</p>
        </div>
        {perm.creer && (
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="h-14 px-8 bg-gradient-to-r from-[#001f5c] via-[#002d85] to-[#001f5c] text-[#FFB800] border border-blue-900 hover:border-[#FFB800] rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-blue-950/20 hover:scale-105 transition-all flex items-center gap-3 italic"
        >
          <Plus className="w-5 h-5 text-[#FFB800]" /> AJOUTER UN GÉRANT
        </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="p-6 border border-slate-100 rounded-3xl flex flex-wrap items-center justify-between gap-6 bg-white shadow-sm italic">
        <div className="relative flex-1 min-w-[260px] max-w-lg">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
          <input
            type="text"
            placeholder="Rechercher par nom, CIN ou téléphone..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="w-full pl-14 pr-12 h-14 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner text-[#002d87] placeholder-slate-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="Effacer la recherche"
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-[#002d87] hover:bg-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="h-14 px-6 bg-slate-50 rounded-2xl flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-100 shadow-sm">
          <Filter className="w-4 h-4 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as 'tous' | 'Actif' | 'Inactif')}
            className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest text-[#002d87] cursor-pointer"
          >
            <option value="tous">Tous les statuts</option>
            <option value="Actif">Actifs</option>
            <option value="Inactif">Inactifs</option>
          </select>
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {visibleGerants.length} / {gerants.length} gérant(s)
        </p>
        <ViewToggle view={viewMode} onChange={setViewMode} />
      </div>

      {visibleGerants.length === 0 ? (
        gerants.length > 0
          ? <EmptyState icon={Search} title="Aucun résultat" description="Aucun gérant ne correspond à cette recherche." actionLabel="Réinitialiser" action={() => { setSearch(""); setStatusFilter('tous'); }} />
          : <EmptyState icon={Users} title="Aucun gérant" description="Commencez par ajouter votre premier gérant" actionLabel="Ajouter" action={() => { resetForm(); setShowModal(true); }} />
      ) : viewMode === "table" ? (
        /* ── Les gérants en tableau — mêmes chiffres que la carte, alignés. */
        <Table head={<>
          <th className="table-head">Gérant</th><th className="table-head">CIN</th>
          <th className="table-head">Téléphone</th><th className="table-head">Compte</th>
          <th className="table-head text-right">Salaire</th><th className="table-head text-right">Acomptes du mois</th>
          <th className="table-head">Ce mois</th><th className="table-head">Statut</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {visibleGerants.map((g: Gerant) => {
            const currentMonthAcomptes = (g.acomptes || []).filter(a => !a.isPaid && a.date.startsWith(currentMonth)).reduce((sum, a) => sum + a.amount, 0);
            const isMonthPaid = (g.paymentRecord || []).some(pr => pr.month === currentMonth && pr.isPaid);
            return (
              <tr key={g.id} className={g.status === "Actif" ? undefined : "opacity-60"}>
                <td className="table-cell font-bold text-[#002d87] uppercase tracking-tight">{g.name}</td>
                <td className="table-cell whitespace-nowrap">{g.cin || "—"}</td>
                <td className="table-cell whitespace-nowrap">{g.phone || "—"}</td>
                <td className="table-cell">
                  {g.hasAccess && g.authUserId
                    ? <Badge tone="success">Actif</Badge>
                    : g.hasAccess && g.username
                      ? <button className="text-[11px] font-black text-amber-700 hover:underline"
                        onClick={() => { setActivatingGerant(g); setActivatePassword(""); setShowActivateModal(true); }}>À activer</button>
                      : <span className="text-slate-400">Aucun</span>}
                </td>
                <td className="table-cell tabular-nums text-right font-bold">{g.baseSalary.toLocaleString()} DA</td>
                <td className="table-cell tabular-nums text-right">
                  {currentMonthAcomptes > 0
                    ? <span className="font-black text-red-600">{currentMonthAcomptes.toLocaleString()} DA</span>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="table-cell">{isMonthPaid ? <Badge tone="success">Payé</Badge> : <Badge tone="warning">À payer</Badge>}</td>
                <td className="table-cell"><Badge tone={g.status === "Actif" ? "success" : "danger"}>{g.status}</Badge></td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir les détails" onClick={() => { setSelectedGerant(g); setShowDetailModal(true); }} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setSelectedGerant(g); setForm(g); setShowModal(true); }} />}
                    <ActionBtn icon={Wallet} tone="amber" title="Acompte" onClick={() => { setSelectedGerant(g); setShowAdvanceModal(true); }} />
                    <ActionBtn icon={UserX} tone="slate" title="Absence" onClick={() => { setSelectedGerant(g); setShowAbsenceModal(true); }} />
                    <ActionBtn icon={DollarSign} tone="green" title="Paiement" onClick={() => { setSelectedGerant(g); setShowPaymentModal(true); }} />
                    <ActionBtn icon={HistoryIcon} tone="slate" title="Historique" onClick={() => { setSelectedGerant(g); setShowHistoryModal(true); }} />
                    {currentUserRole === 'admin' && <ActionBtn icon={Shield} tone="red" title="Permissions" onClick={() => { setSelectedGerant(g); setShowPermissionsModal(true); }} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => { setSelectedGerant(g); setShowConfirmDelete(true); }} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleGerants.map((g: Gerant) => {
          const currentMonthAcomptes = (g.acomptes || []).filter(a => !a.isPaid && a.date.startsWith(currentMonth)).reduce((sum, a) => sum + a.amount, 0);
          const isMonthPaid = (g.paymentRecord || []).some(pr => pr.month === currentMonth && pr.isPaid);

          return (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={cn(
              "group relative bg-white rounded-3xl border hover:shadow-2xl transition-all p-6 space-y-4 italic flex flex-col",
              g.status === "Actif" ? "border-[#002d87]/10 hover:border-[#002d87]/30" : "border-slate-100 hover:border-slate-200"
            )}
          >
            {/* Gradient Top Border */}
            <div className={cn("h-2 absolute top-0 left-0 right-0 rounded-t-3xl", g.status === "Actif" ? "bg-gradient-to-r from-[#002d87] via-[#003087] to-[#FFB800]" : "bg-slate-300")} />
            
            {/* Status Indicator */}
            <div className="absolute top-4 left-4">
              <span className={cn("text-[9px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm", 
                g.status === "Actif" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                {g.status === "Actif" ? "Actif" : "Inactif"}
              </span>
            </div>

            {/* Menu Button */}
            <div className="absolute top-4 right-4">
              <motion.button
                onClick={() => setActionMenuOpen(actionMenuOpen === g.id ? null : g.id)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-primary transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
              >
                <MoreVertical className="w-5 h-5" />
              </motion.button>

              {/* Dropdown Menu */}
              <AnimatePresence>
                {actionMenuOpen === g.id && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-56 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 overflow-hidden"
                  >
                    <div className="divide-y divide-slate-100">
                      <button onClick={() => { setSelectedGerant(g); setShowDetailModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <Eye className="w-4 h-4 text-slate-500" /> Voir Détails
                      </button>
                      {perm.modifier && (
                      <button onClick={() => { setSelectedGerant(g); setForm(g); setShowModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                      </button>
                      )}
                      <button onClick={() => { setSelectedGerant(g); setShowAdvanceModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <Wallet className="w-4 h-4 text-amber-500" /> Acompte
                      </button>
                      <button onClick={() => { setSelectedGerant(g); setShowAbsenceModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <UserX className="w-4 h-4 text-orange-500" /> Absence
                      </button>
                      <button onClick={() => { setSelectedGerant(g); setShowPaymentModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-green-600 hover:bg-green-50 flex items-center gap-3 transition-colors">
                        <DollarSign className="w-4 h-4" /> Paiement
                      </button>
                      <button onClick={() => { setSelectedGerant(g); setShowHistoryModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <HistoryIcon className="w-4 h-4 text-purple-500" /> Historique
                      </button>
                      {currentUserRole === 'admin' && (
                        <button onClick={() => { setSelectedGerant(g); setShowPermissionsModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                          <Shield className="w-4 h-4 text-red-500" /> Permissions
                        </button>
                      )}
                      {perm.supprimer && (
                      <button onClick={() => { setSelectedGerant(g); setShowConfirmDelete(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors">
                        <Trash2 className="w-4 h-4" /> Supprimer
                      </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Avatar & Info */}
            <div className="flex flex-col items-center text-center gap-4 pt-4">
              <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center font-black text-lg text-white shadow-lg", 
                g.status === "Actif" ? "bg-gradient-to-br from-primary to-blue-600" : "bg-slate-300")}>
                {g.name[0]}
              </div>
              <div className="flex-1">
                <p className="font-black text-slate-800 uppercase tracking-tight text-sm mb-1">{g.name}</p>
                <p className="text-[10px] text-slate-500 font-bold">CIN: {g.cin}</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {g.hasAccess && g.authUserId && (
                <span className="text-[9px] font-bold px-2.5 py-1 bg-green-100 text-green-700 rounded-full flex items-center gap-1 italic">
                  <Lock className="w-3 h-3" /> Compte actif
                </span>
              )}
              {g.hasAccess && !g.authUserId && g.username && (
                <button onClick={() => { setActivatingGerant(g); setActivatePassword(""); setShowActivateModal(true); }} className="text-[9px] font-bold px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full flex items-center gap-1 italic hover:bg-amber-200 transition-colors">
                  <Zap className="w-3 h-3" /> Activer
                </button>
              )}
              {g.hasAccess && !g.username && (
                <span className="text-[9px] font-bold px-2.5 py-1 bg-slate-100 text-slate-500 rounded-full flex items-center gap-1 italic">
                  <Lock className="w-3 h-3" /> Accès
                </span>
              )}
            </div>

            {/* Key Metrics */}
            <div className="pt-4 border-t border-slate-100 grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Salaire</p>
                <p className="text-[11px] font-black text-primary italic">{g.baseSalary.toLocaleString()} DA</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Acomptes</p>
                <p className="text-[11px] font-black text-red-500 italic">{currentMonthAcomptes.toLocaleString()} DA</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Mois Courant</p>
                <span className={cn("text-[8px] font-black uppercase px-1.5 py-0.5 rounded italic", 
                  isMonthPaid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                  {isMonthPaid ? "Payé" : "à Payer"}
                </span>
              </div>
            </div>
          </motion.div>
        );
        })}
      </div>
      )}

      {/* Edit/Create Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl relative z-10 flex flex-col h-[var(--modal-max-h)] overflow-hidden">
              <div className="p-8 bg-gradient-to-r from-[#002d87] via-[#003087] to-[#002d87] text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#FFB800] rounded-2xl flex items-center justify-center text-[#002d87] font-black"><Building2 className="w-6 h-6" /></div>
                  <h3 className="font-black uppercase tracking-wider italic">{selectedGerant ? "Modifier Gérant" : "Nouveau Gérant"}</h3>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all"><X className="w-6 h-6" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Nom</label>
                    <input type="text" className="input-field italic uppercase font-black text-xs" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">CIN</label>
                    <input type="text" className="input-field italic uppercase font-black text-xs" value={form.cin} onChange={e => setForm({...form, cin: e.target.value})} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Téléphone</label>
                    <input type="text" className="input-field italic font-black text-xs" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Email</label>
                    <input type="email" className="input-field italic font-black text-xs" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Adresse</label>
                  <input type="text" className="input-field italic font-black text-xs" value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Type de paie</label>
                    <select className="input-field italic uppercase font-black text-[10px]" value={form.salaryType || 'mois'} onChange={e => setForm({...form, salaryType: e.target.value as 'jour' | 'mois'})}>
                      <option value="mois">Mensuel</option>
                      <option value="jour">Journalier</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">{form.salaryType === 'jour' ? 'Salaire / Jour (DA)' : 'Salaire / Mois (DA)'}</label>
                    <input type="number" className="input-field italic font-black text-lg" value={form.baseSalary} onChange={e => setForm({...form, baseSalary: parseFloat(e.target.value)})} />
                  </div>
                </div>

                {form.salaryType === 'jour' && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Jours de travail (les autres sont repos)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map(d => {
                        const on = (form.workDays && form.workDays.length ? form.workDays : DEFAULT_WORK_DAYS).includes(d.idx);
                        return (
                          <button type="button" key={d.idx} onClick={() => toggleWorkDay(d.idx)}
                            className={cn('px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all', on ? 'bg-[#002d87] text-white shadow' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-100')}>
                            {d.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Statut</label>
                    <select className="input-field italic uppercase font-black text-[10px]" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                      <option value="Actif">Actif</option>
                      <option value="Congé">En Congé</option>
                      <option value="Inactif">Inactif</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date d'Embauche</label>
                    <input type="date" className="input-field italic font-black text-xs" value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date de déclaration CNAS</label>
                  <input type="date" className="input-field italic font-black text-xs" value={form.cnasDate || ''} onChange={e => setForm({...form, cnasDate: e.target.value})} />
                </div>

                {/* System Access Section */}
                <div className="p-6 bg-gradient-to-br from-[#002d87]/5 to-[#FFB800]/5 rounded-2xl border-2 border-[#002d87]/10 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                        <Lock className="w-5 h-5 text-[#002d87]" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-[#002d87] uppercase italic tracking-widest">Accès Application</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Autoriser la connexion</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setForm({...form, hasAccess: !form.hasAccess})} className={cn("w-12 h-6 rounded-full transition-colors relative shadow-inner", form.hasAccess ? "bg-green-500" : "bg-slate-300")}>
                      <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm", form.hasAccess ? "left-7" : "left-1")} />
                    </button>
                  </div>
                  <AnimatePresence>
                    {form.hasAccess && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#002d87]/10">
                          <div className="space-y-2">
                            <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Nom d'utilisateur</label>
                            <input type="text" className="input-field italic font-black text-xs bg-white" placeholder="Identifiant unique" value={form.username || ''} onChange={e => setForm({...form, username: e.target.value})} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Mot de passe</label>
                            <input type="text" className="input-field italic font-black text-xs bg-white" placeholder="Mot de passe" value={form.password || ''} onChange={e => setForm({...form, password: e.target.value})} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="p-8 bg-slate-50 border-t flex gap-4 shrink-0">
                <button onClick={() => setShowModal(false)} className="px-8 py-3 text-[10px] font-black uppercase text-slate-400 italic">Annuler</button>
                <button onClick={handleSave} className="flex-1 h-12 bg-primary text-secondary rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 italic"><Save className="w-4 h-4" /> Sauvegarder</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal (shared) */}
      {showDetailModal && detailGerant && (
        <WorkerDetailsModal
          open onClose={() => setShowDetailModal(false)}
          name={detailGerant.name} role="Gérant"
          statusLabel={detailGerant.status} statusTone={detailGerant.status === 'Actif' ? 'green' : 'red'}
          info={[
            { label: 'CIN', value: detailGerant.cin || '—' },
            { label: 'Téléphone', value: detailGerant.phone || '—' },
            { label: 'Email', value: detailGerant.email || '—' },
            { label: 'Adresse', value: detailGerant.address || '—' },
            { label: 'Type de paie', value: detailGerant.salaryType === 'jour' ? 'Journalier' : 'Mensuel' },
            { label: detailGerant.salaryType === 'jour' ? 'Salaire / jour' : 'Salaire / mois', value: `${(detailGerant.baseSalary || 0).toLocaleString()} DA` },
            ...(detailGerant.salaryType === 'jour' ? [{ label: 'Jours travaillés', value: (detailGerant.workDays && detailGerant.workDays.length ? detailGerant.workDays : DEFAULT_WORK_DAYS).map(idx => WEEKDAYS.find(w => w.idx === idx)?.short).filter(Boolean).join(', ') }] : []),
            { label: 'Déclaration CNAS', value: detailGerant.cnasDate ? new Date(detailGerant.cnasDate).toLocaleDateString('fr-DZ') : '—' },
            { label: "Date d'embauche", value: detailGerant.hireDate ? new Date(detailGerant.hireDate).toLocaleDateString('fr-DZ') : '—' },
            { label: 'Compte', value: detailGerant.hasAccess ? (detailGerant.authUserId ? 'Actif' : 'À activer') : 'Aucun' },
            { label: 'Identifiant', value: detailGerant.username || '—' },
          ]}
          payments={(detailGerant.paymentRecord || []).slice().sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')).map(p => ({ id: p.id, date: p.paymentDate, amount: p.netSalary, title: p.month, subtitle: [p.paymentMode, p.chequeNumber && `Chèque ${p.chequeNumber}`].filter(Boolean).join(' · '), notes: p.notes }))}
          acomptes={(detailGerant.acomptes || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(a => ({ id: a.id, date: a.date, amount: a.amount, description: a.description, paid: a.isPaid }))}
          absences={(detailGerant.absences || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(a => ({ id: a.id, date: a.date, cost: a.cost, description: a.description, paid: a.isPaid }))}
          canEdit={perm.modifier} canDelete={perm.supprimer}
          onSaveAcompte={a => { const o = (detailGerant.acomptes || []).find(x => x.id === a.id); dispatch({ type: 'UPDATE_WORKER_ACOMPTE', payload: { workerType: 'gerant', workerId: detailGerant.id, acompte: { ...(o as any), id: a.id, date: a.date, amount: a.amount, description: a.description } } }); }}
          onDeleteAcompte={id => dispatch({ type: 'DELETE_WORKER_ACOMPTE', payload: { workerType: 'gerant', workerId: detailGerant.id, acompteId: id } })}
          onSaveAbsence={a => { const o = (detailGerant.absences || []).find(x => x.id === a.id); dispatch({ type: 'UPDATE_WORKER_ABSENCE', payload: { workerType: 'gerant', workerId: detailGerant.id, absence: { ...(o as any), id: a.id, date: a.date, cost: a.cost, description: a.description } } }); }}
          onDeleteAbsence={id => dispatch({ type: 'DELETE_WORKER_ABSENCE', payload: { workerType: 'gerant', workerId: detailGerant.id, absenceId: id } })}
          onSavePayment={p => { const o = (detailGerant.paymentRecord || []).find(x => x.id === p.id); dispatch({ type: 'ADD_WORKER_PAYMENT', payload: { workerType: 'gerant', workerId: detailGerant.id, payment: { ...(o as any), id: p.id, paymentDate: p.date, netSalary: p.amount, amount: p.amount, notes: p.notes } } }); }}
          onDeletePayment={id => dispatch({ type: 'DELETE_WORKER_PAYMENT', payload: { workerType: 'gerant', workerId: detailGerant.id, paymentId: id } })}
        />
      )}

      {/* Advance Modal */}
      <AnimatePresence>
        {showAdvanceModal && selectedGerant && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAdvanceModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-6 bg-gradient-to-r from-[#002d87] via-[#003087] to-[#002d87] text-white flex items-center justify-between">
                <h3 className="font-black text-[#FFB800] uppercase tracking-widest italic flex items-center gap-2"><Wallet className="w-4 h-4 text-[#FFB800]" /> NOUVEL ACOMPTE</h3>
                <button onClick={() => setShowAdvanceModal(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Montant (DA)</label>
                  <input type="number" className="input-field italic font-black text-lg" value={advanceForm.amount} onChange={e => setAdvanceForm({...advanceForm, amount: parseFloat(e.target.value)})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date</label>
                  <input type="date" className="input-field italic font-black text-xs" value={advanceForm.date} onChange={e => setAdvanceForm({...advanceForm, date: e.target.value})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Description (Optionnel)</label>
                  <textarea className="input-field italic font-black text-xs" value={advanceForm.description} onChange={e => setAdvanceForm({...advanceForm, description: e.target.value})} rows={3} />
                </div>
              </div>

              <div className="p-6 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-4 shrink-0">
                <button onClick={() => setShowAdvanceModal(false)} className="flex-1 text-[10px] font-black uppercase text-[#002d87] italic hover:text-[#003087] transition-colors border-2 border-[#002d87] rounded-lg py-3 hover:bg-white bg-gradient-to-r from-white to-yellow-50">Annuler</button>
                <button onClick={handleAddAdvance} className="flex-[2] bg-gradient-to-r from-[#002d87] to-[#003087] hover:shadow-lg text-white font-black uppercase tracking-widest rounded-lg py-3 transition-all transform hover:-translate-y-0.5 text-[10px]">ENREGISTRER</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Absence Modal */}
      <AnimatePresence>
        {showAbsenceModal && selectedGerant && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAbsenceModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-6 bg-gradient-to-r from-[#002d87] via-[#003087] to-[#002d87] text-white flex items-center justify-between">
                <h3 className="font-black text-[#FFB800] uppercase tracking-widest italic flex items-center gap-2"><UserX className="w-4 h-4 text-[#FFB800]" /> NOUVELLE ABSENCE</h3>
                <button onClick={() => setShowAbsenceModal(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Coût/Retenue (DA)</label>
                  <input type="number" className="input-field italic font-black text-lg" value={absenceForm.cost} onChange={e => setAbsenceForm({...absenceForm, cost: parseFloat(e.target.value)})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date</label>
                  <input type="date" className="input-field italic font-black text-xs" value={absenceForm.date} onChange={e => setAbsenceForm({...absenceForm, date: e.target.value})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Description</label>
                  <input type="text" className="input-field italic font-black text-xs" value={absenceForm.description} onChange={e => setAbsenceForm({...absenceForm, description: e.target.value})} placeholder="Maladie, sans justificatif..." />
                </div>
              </div>

              <div className="p-6 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-4 shrink-0">
                <button onClick={() => setShowAbsenceModal(false)} className="flex-1 text-[10px] font-black uppercase text-[#002d87] italic hover:text-[#003087] transition-colors border-2 border-[#002d87] rounded-lg py-3 hover:bg-white bg-gradient-to-r from-white to-yellow-50">Annuler</button>
                <button onClick={handleAddAbsence} className="flex-[2] bg-gradient-to-r from-[#002d87] to-[#003087] hover:shadow-lg text-white font-black uppercase tracking-widest rounded-lg py-3 transition-all transform hover:-translate-y-0.5 text-[10px]">ENREGISTRER</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Modal (shared component) */}
      {showPaymentModal && selectedGerant && (
        <WorkerPaymentModal
          open
          onClose={() => setShowPaymentModal(false)}
          worker={{
            name: selectedGerant.name,
            role: 'Gérant',
            salaryType: selectedGerant.salaryType || 'mois',
            salaryAmount: selectedGerant.baseSalary,
            workDays: selectedGerant.workDays,
            startDate: selectedGerant.hireDate,
          }}
          acomptes={(selectedGerant.acomptes || []).filter(a => !a.isPaid).map(a => ({ id: a.id, date: a.date, amount: a.amount, description: a.description, paid: !!a.isPaid }))}
          absences={(selectedGerant.absences || []).filter(a => !a.isPaid).map(a => ({ id: a.id, date: a.date, cost: a.cost, description: a.description, paid: !!a.isPaid }))}
          paidDays={payPaidDays}
          paidMonths={payPaidMonths}
          modes={['Espèces', 'Chèque', 'Virement']}
          history={(selectedGerant.paymentRecord || []).slice().reverse().slice(0, 4).map(p => ({ label: p.month, date: p.paymentDate, amount: p.netSalary }))}
          onConfirm={handleSavePayment}
        />
      )}

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && selectedGerant && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowHistoryModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-8 bg-gradient-to-r from-[#002d87] via-[#003087] to-[#002d87] text-white flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-[#FFB800] rounded-xl flex items-center justify-center text-[#002d87] font-black"><HistoryIcon className="w-7 h-7" /></div>
                  <div>
                    <h2 className="text-2xl font-black uppercase">Historique</h2>
                    <p className="text-white/80 text-sm">{selectedGerant.name}</p>
                  </div>
                </div>
                <button onClick={() => setShowHistoryModal(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
              </div>

              {/* Tabs */}
              <div className="flex border-b bg-slate-50">
                {(['acomptes', 'absences', 'paiements'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setHistoryTab(tab)}
                    className={`flex-1 py-4 px-6 font-black uppercase text-[10px] tracking-widest transition-all ${
                      historyTab === tab
                        ? 'text-[#002d87] border-b-4 border-[#FFB800] bg-white'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tab === 'acomptes' ? 'Acomptes' : tab === 'absences' ? 'Absences' : 'Paiements'}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
                {historyTab === 'acomptes' && (
                  <div className="space-y-3">
                    {selectedGerant.acomptes && selectedGerant.acomptes.length > 0 ? (
                      selectedGerant.acomptes.map((a, i) => (
                        <div key={i} className="p-4 bg-gradient-to-br from-red-50 to-red-50/50 rounded-xl border-2 border-red-100 flex justify-between items-center">
                          <div>
                            <p className="font-black text-red-700">{a.amount.toLocaleString()} DA</p>
                            <p className="text-[9px] text-slate-500 italic">{new Date(a.date).toLocaleDateString('fr-FR')}</p>
                          </div>
                          <span className={`text-sm font-black px-3 py-1 rounded-lg ${a.isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {a.isPaid ? 'Payé' : 'En attente'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-400">
                        <p className="text-sm font-bold">Aucun acompte enregistré</p>
                      </div>
                    )}
                  </div>
                )}

                {historyTab === 'absences' && (
                  <div className="space-y-3">
                    {selectedGerant.absences && selectedGerant.absences.length > 0 ? (
                      selectedGerant.absences.map((a, i) => (
                        <div key={i} className="p-4 bg-gradient-to-br from-orange-50 to-orange-50/50 rounded-xl border-2 border-orange-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-orange-700">{a.cost.toLocaleString()} DA - {a.description || 'Sans description'}</p>
                              <p className="text-[9px] text-slate-500 italic mt-1">{new Date(a.date).toLocaleDateString('fr-FR')}</p>
                            </div>
                            <span className={`text-sm font-black px-3 py-1 rounded-lg ${a.isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {a.isPaid ? 'Payé' : 'En attente'}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-400">
                        <p className="text-sm font-bold">Aucune absence enregistrée</p>
                      </div>
                    )}
                  </div>
                )}

                {historyTab === 'paiements' && (
                  <div className="space-y-3">
                    {selectedGerant.paymentRecord && selectedGerant.paymentRecord.length > 0 ? (
                      selectedGerant.paymentRecord.map((p, i) => (
                        <div key={i} className="p-4 bg-gradient-to-br from-green-50 to-green-50/50 rounded-xl border-2 border-green-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-green-700">{p.amount.toLocaleString()} DA</p>
                              <p className="text-[9px] text-slate-500 italic mt-1">{new Date(p.date).toLocaleDateString('fr-FR')} ⬢ {p.method}</p>
                            </div>
                            <span className="text-sm font-black px-3 py-1 rounded-lg bg-green-100 text-green-700">Payé</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-400">
                        <p className="text-sm font-bold">Aucun paiement enregistré</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 bg-slate-50 border-t flex gap-3 shrink-0">
                <button 
                  onClick={() => setShowHistoryModal(false)} 
                  className="flex-1 text-[10px] font-black uppercase text-slate-600 hover:text-slate-700 transition-colors border border-slate-300 rounded-xl py-3 hover:bg-slate-100"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Permissions Modal */}
      {selectedGerant && (
        <PermissionsModal
          isOpen={showPermissionsModal}
          onClose={() => setShowPermissionsModal(false)}
          workerName={selectedGerant.name}
          workerRole="gerant"
          currentPermissions={selectedGerant.permissions || {}}
          onSave={(newPermissions) => {
            dispatch({
              type: 'UPDATE_GERANT',
              payload: {
                ...selectedGerant,
                permissions: newPermissions
              }
            });
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                type: 'success',
                message: "Permissions du gérant sauvegardées avec succès."
              }
            });
            setShowPermissionsModal(false);
          }}
        />
      )}

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={showConfirmDelete}
        title="Supprimer Gérant"
        message={`Êtes-vous sûr de vouloir supprimer ${selectedGerant?.name}? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        danger={true}
        onConfirm={handleDeleteGerant}
        onCancel={() => setShowConfirmDelete(false)}
      />

      {/* Activate Account Modal */}
      <AnimatePresence>
        {showActivateModal && activatingGerant && (
          <div className="modal-shell z-[70]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowActivateModal(false); setActivatePassword(""); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center justify-between">
                <h3 className="font-black uppercase tracking-widest italic flex items-center gap-2"><Zap className="w-4 h-4" /> ACTIVER LE COMPTE</h3>
                <button onClick={() => { setShowActivateModal(false); setActivatePassword(""); }} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-600 font-bold">
                  Créer un compte d'accès pour <span className="text-blue-900">{activatingGerant.name}</span>
                  {' '}(<code className="text-xs bg-slate-100 px-1 rounded">{activatingGerant.username}</code>)
                </p>
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Mot de passe</label>
                  <input type="password" className="input-field italic font-black text-sm" placeholder="Minimum 6 caractères" value={activatePassword} onChange={e => setActivatePassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleActivateGerantAccount()} autoFocus />
                </div>
              </div>
              <div className="p-6 bg-gradient-to-r from-slate-50 to-amber-50 border-t border-slate-200 flex gap-4">
                <button onClick={() => { setShowActivateModal(false); setActivatePassword(""); }} className="flex-1 text-[10px] font-black uppercase text-slate-600 border border-slate-300 rounded-lg py-3 hover:bg-slate-100">Annuler</button>
                <button onClick={handleActivateGerantAccount} disabled={activateLoading || activatePassword.length < 6} className="flex-[2] bg-gradient-to-r from-amber-500 to-amber-600 disabled:opacity-50 text-white font-black uppercase tracking-widest rounded-lg py-3 text-[10px] flex items-center justify-center gap-2 hover:shadow-lg">
                  {activateLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {activateLoading ? 'ACTIVATION...' : 'ACTIVER'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default Gerants;

