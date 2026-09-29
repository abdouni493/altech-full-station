import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { 
  Users, 
  Plus, 
  Calendar, 
  Clock, 
  X, 
  CheckCircle2, 
  User, 
  Fuel, 
  Database,
  TrendingUp,
  FileText,
  Printer,
  ChevronDown,
  Check,
  AlertCircle,
  ArrowRight,
  Droplets,
  DollarSign,
  UserCog,
  Sun,
  Sunset,
  Moon,
  Store,
  Building2,
  MoreVertical,
  Pencil,
  Eye as EyeIcon,
  Play,
  Pause,
  CheckCircle,
  Trash2,
  LoaderCircle,
  Search
,
  Wrench as WrenchIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId, matchesSearch } from "@/src/lib/utils";
import { useAppState, useAppDispatch, useModulePermission, Brigade, Pump, Tank, Pompiste, Client, BrigadeDecalageAlert, BrigadeAccounting, BrigadeAccountingJustification, nozzleTankId, pumpTankIds, pumpsInCreationOrder, nozzlesInCreationOrder, CAISSE_ID } from "../store/AppContext";
import { useNavigate } from "react-router-dom";
import { brigadeTankConsumption, brigadeTankDeltas, brigadeLiters } from "../lib/brigadeTanks";
import { ownsNozzleIndex } from "../lib/nozzleIndexes";
import { toNum } from "../lib/brigadeCalc";
import { clientChargeDelta, clientLedgers, clientStanding, ClientLedger, ClientStanding } from "../lib/clientLedger";
import { brigadeBankLines, isBankJustification, accountOfJustification } from "../lib/brigadeBankLines";
import { planBrigadeExpenses, BRIGADE_EXPENSE_CATEGORY } from "../lib/brigadeExpenses";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import { ViewToggle, Table as KitTable, Badge as KitBadge, RowActions, ActionBtn } from "@/src/components/biz/Kit";
import Skeleton from "../components/Skeleton";
import BrigadeDetailModal from "../components/BrigadeDetailModal";
import BrigadeAccountingModal from "../components/BrigadeAccountingModal";
import BrigadeFicheModal from "../components/BrigadeFicheModal";

/**
 * ─── L'ORDRE DE LA LISTE : la dernière brigade créée en tête ───────────────────
 *
 * L'écran affichait `[...brigades].reverse()`. Ce n'était pas un tri : la liste
 * arrive déjà du serveur avec la plus récente en premier (`created_at` en ordre
 * décroissant), donc la retourner mettait la PLUS ANCIENNE en tête — et une
 * brigade créée dans la session, simplement ajoutée en fin de tableau, remontait
 * par accident. Deux comportements contradictoires selon la provenance.
 *
 * On trie donc explicitement sur l'instant de création, avec les replis qui
 * gardent les fiches anciennes à leur place : `created_at` posé par la base,
 * sinon l'heure d'ouverture, sinon la journée couverte.
 */
const brigadeCreatedAt = (b: Brigade): number => {
  const raw = b.createdAt || b.startDatetime || b.startTimestamp || b.date;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Un montant en dinars, au dinar près — le format des chiffres de l'assistant. */
const money0 = (v: number): string =>
  `${(Number.isFinite(v) ? v : 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA`;

/** Comparateur « la plus récente d'abord ». */
const byNewestFirst = (a: Brigade, b: Brigade): number => brigadeCreatedAt(b) - brigadeCreatedAt(a);

/**
 * Une justification saisie à l'étape 7 de l'assistant.
 *
 * Le type est nommé ici, et non écrit dans le `useState` : les listes tirées de
 * `Object.entries` / `Object.values` retombaient sinon sur `unknown`, et rien
 * n'aurait relevé un oubli sur ces objets — à commencer par le compte bancaire
 * d'un TPE, dont l'absence vidait déjà le solde d'un compte en silence.
 */
interface WizardJustification {
  /**
   * `EXPENSE` — une DÉPENSE payée sur les espèces de la brigade : un nom, une
   * catégorie facultative et un montant. Elle justifie le reste comme un bon,
   * et devient une vraie ligne de l'écran Dépenses (`lib/brigadeExpenses.ts`).
   * Elle a remplacé l'avance client, que le gérant ne saisissait plus ici.
   */
  type: 'TAG' | 'TPE' | 'CLIENT_CREDIT' | 'CLIENT_AVANCE' | 'EXPENSE';
  id: string;
  /** Pour un TAG / TPE : le compte bancaire crédité à l'enregistrement. */
  bankAccountId?: string;
  /** Pour une DÉPENSE : son nom, tel qu'il s'écrira dans l'écran Dépenses. */
  expenseName?: string;
  /** Pour une DÉPENSE : sa catégorie — facultative. */
  expenseCategory?: string;
  description: string;
  liters: number;
  amount: number;
  byLiters?: boolean;   // when true, amount = liters × prix du carburant sélectionné
  fuelType?: string;    // carburant choisi pour le calcul par litres
  clientId?: string;
  clientName?: string;
}

const Brigades = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const appState = useAppState();
  const { brigades, pumps, tanks, pompistes, brigadeChefs, settings, currentUserRole, currentUserId, currentUserName, workers, gerants, magasinWorkers, tracks, pumpNozzles = [], brigadeAccountings = [], shopSales = [], clients = [], bankAccounts = [], treasuryTransactions = [], expenses = [] } = appState;
  const perm = useModulePermission('Brigades');
  const dispatch = useAppDispatch();

  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showClotureModal, setShowClotureModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [selectedBrigade, setSelectedBrigade] = useState<Brigade | null>(null);
  const [editingBrigade, setEditingBrigade] = useState<Brigade | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'print'>('info');
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [activateIndices, setActivateIndices] = useState<Record<string, number>>({});
  const [activateTankLevels, setActivateTankLevels] = useState<Record<string, { degrees: number; liters: number }>>({});
  const [deactivateTankLevels, setDeactivateTankLevels] = useState<Record<string, { degrees: number; liters: number }>>({});
  const [activateStep, setActivateStep] = useState(1);
  const [deactivateStep, setDeactivateStep] = useState(1);

  // Per-nozzle activation state
  const [activateNozzleIndices, setActivateNozzleIndices] = useState<Record<string, number>>({});
  const [activeNozzleIds, setActiveNozzleIds] = useState<string[]>([]);
  const [nozzleIndexErrors, setNozzleIndexErrors] = useState<Record<string, boolean>>({});
  const [nozzleShake, setNozzleShake] = useState<Record<string, boolean>>({});

  // Per-nozzle cloture state
  const [endNozzleIndices, setEndNozzleIndices] = useState<Record<string, number>>({});
  const [nozzleEndErrors, setNozzleEndErrors] = useState<Record<string, boolean>>({});
  const [tankEndErrors, setTankEndErrors] = useState<Record<string, boolean>>({});

  // Creation wizard extra state
  const [pompistePresence, setPompistePresence] = useState<Record<string, 'present' | 'absent'>>({});
  // Which pompes each pompiste holds during this brigade (several per pompiste).
  const [pompistePumps, setPompistePumps] = useState<Record<string, string[]>>({});
  // Pompistes retained for this brigade (the chef no longer drives the list).
  const [wizPompisteIds, setWizPompisteIds] = useState<string[]>([]);
  // Cash instalments ("versements espèce") per pompiste, timed to the minute.
  const [versements, setVersements] = useState<Record<string, Array<{
    id: string; amount: number; at: string; notes?: string;
  }>>>({});
  const [chefAsPompiste, setChefAsPompiste] = useState(false);
  const [chefPisteId, setChefPisteId] = useState('');
  const [canReactivate, setCanReactivate] = useState(false);

  // Accounting modal state
  const [showAccountingModal, setShowAccountingModal] = useState(false);

  // Fiche modal state
  const [showFicheModal, setShowFicheModal] = useState(false);

  /**
   * ─── LE COMPTE DES CLIENTS, RELU SUR LEURS PIÈCES ───────────────────────────
   *
   * Justifier une brigade « au client » demandait de savoir ce que ce client
   * doit. Les deux écrans qui le font — l'assistant de création (étape
   * Comptabilité) et la fenêtre Comptabilité d'une brigade déjà fermée —
   * lisaient la colonne `clients.debt` : un compteur, qui ignore la dette de
   * reprise, l'avance déjà versée et toute brigade corrigée après coup. Le
   * caissier voyait donc ici un montant que la fiche du client démentait.
   *
   * Le journal du client fait foi, exactement comme sur l'écran Clients. On ne
   * le relit que quand une des deux fenêtres est ouverte : le calcul parcourt
   * toutes les comptabilités de la station, et la liste des brigades n'en a
   * aucun besoin.
   */
  const clientAccounts: Record<string, ClientLedger> = useMemo(
    () => ((showModal || showAccountingModal) ? clientLedgers(appState) : {}),
    [showModal, showAccountingModal, clients, brigadeAccountings, brigades, shopSales],
  );

  /** Ce qu'un client doit et détient — le même chiffre que l'écran Clients. */
  const standingOf = (c: Client): ClientStanding => clientStanding(c, clientAccounts[c.id]);

  // Filters
  const [filterChef, setFilterChef] = useState('');
  const [filterPompiste, setFilterPompiste] = useState('');
  const [searchId, setSearchId] = useState('');
  // Tableau par défaut : l'historique des brigades se balaie en lignes — date,
  // poste, chef, état, montant comptabilisé. Les cartes restent à un clic.
  const [brigadeView, setBrigadeView] = useState<'grid' | 'table'>('table');
  const [filterDate, setFilterDate] = useState('');        // exact day (YYYY-MM-DD)
  const [filterStartDate, setFilterStartDate] = useState(''); // période — du
  const [filterEndDate, setFilterEndDate] = useState('');     // période — au

  // Shared brigade history filter predicate (id / chef / pompiste / date / période).
  // b.date is 'YYYY-MM-DD' so string comparison is chronologically correct.
  const matchesBrigadeFilters = (b: Brigade) => {
    if (!matchesSearch(searchId, b.id)) return false;
    if (filterChef && b.chefId !== filterChef) return false;
    if (filterPompiste && !b.pompisteIds?.includes(filterPompiste)) return false;
    const d = b.date || '';
    if (filterDate) {
      if (d !== filterDate) return false;            // exact date overrides the période
    } else {
      if (filterStartDate && d < filterStartDate) return false;
      if (filterEndDate && d > filterEndDate) return false;
    }
    return true;
  };
  const hasActiveFilters = !!(filterChef || filterPompiste || searchId || filterDate || filterStartDate || filterEndDate);
  const clearBrigadeFilters = () => {
    setFilterChef(''); setFilterPompiste(''); setSearchId('');
    setFilterDate(''); setFilterStartDate(''); setFilterEndDate('');
  };
  
  const [step, setStep] = useState(1);
  const [chefId, setChefId] = useState("");
  const [selectedPompisteIds, setSelectedPompisteIds] = useState<string[]>([]);
  const [shiftType, setShiftType] = useState<'Matin' | 'Soir' | 'Nuit'>('Matin');
  const [shiftDate, setShiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("14:00");
  const [startIndices, setStartIndices] = useState<Record<string, number>>({});
  const [startTankLevels, setStartTankLevels] = useState<Record<string, { degrees: number; liters: number }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  const shiftTimes = {
    'Matin': { start: '06:00', end: '14:00' },
    'Soir': { start: '14:00', end: '22:00' },
    'Nuit': { start: '22:00', end: '06:00' }
  };

  useEffect(() => {
    const times = shiftTimes[shiftType];
    setStartTime(times.start);
    setEndTime(times.end);
  }, [shiftType]);

  const activePompisteIds = useMemo(() => {
    const activeBrigades = brigades.filter(b => b.status === 'Ouverte');
    const allActiveIds = activeBrigades.flatMap(b => b.pompisteIds || []);
    return new Set(allActiveIds);
  }, [brigades]);
  const [endIndices, setEndIndices] = useState<Record<string, number>>({});
  const [endTankLevels, setEndTankLevels] = useState<Record<string, { degrees: number; liters: number }>>({});
  const [pompisteEncaissements, setPompisteEncaissements] = useState<Record<string, { cash: number; bons: number; cheques: number; pricePerLiter: number }>>({});

  // ─── New 7-step wizard state ──────────────────────────────────────────────
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [startHour, setStartHour] = useState('06');
  const [startMinute, setStartMinute] = useState('00');
  const [endHour, setEndHour] = useState('14');
  const [endMinute, setEndMinute] = useState('00');
  // End levels (user-set for end of brigade)
  const [wizEndTankLevels, setWizEndTankLevels] = useState<Record<string, number>>({}); // degrees value
  const [wizEndNozzleIndices, setWizEndNozzleIndices] = useState<Record<string, number>>({});
  // Step 7 comptabilité
  const [pompistePayments, setPompistePayments] = useState<Record<string, number>>({}); // cash given
  const [pompisteJustifications, setPompisteJustifications] =
    useState<Record<string, WizardJustification[]>>({});
  // Step 7 client search / new-client UI (per pompiste)
  const [justifClientSearch, setJustifClientSearch] = useState<Record<string, string>>({});
  /**
   * Le brouillon de la dépense en cours de saisie, par pompiste — les mêmes
   * champs que l'écran Dépenses : un nom, une catégorie facultative, un
   * montant. Il n'entre dans la liste des justifications qu'une fois ajouté.
   */
  const [expenseDraft, setExpenseDraft] =
    useState<Record<string, { name: string; category: string; amount: string }>>({});
  const [showNewClientForm, setShowNewClientForm] = useState<string | null>(null);
  const [newClientDraft, setNewClientDraft] = useState({ name: '', phone: '', type: 'PARTICULIER' as Client['type'], paymentMode: 'CASH' as Client['paymentMode'] });

  const activeBrigade = brigades.find(b => b.status === "Ouverte");

  const [elapsed, setElapsed] = useState("00:00:00");
   
  useEffect(() => {
    if (!activeBrigade?.startTimestamp) return;
    const interval = setInterval(() => {
      const diff = Date.now() - new Date(activeBrigade.startTimestamp!).getTime();
      const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeBrigade]);

  // Helper: Convert degrees to liters
  const convertDegreesToLiters = (tankId: string, degrees: number) => {
    const table = settings.conversionTables?.[tankId];
    if (!table || table.length === 0) return degrees * 100; // Fallback
    const sorted = [...table].sort((a, b) => a.degree - b.degree);
    const match = sorted.find(row => row.degree >= degrees);
    return match ? match.liters : (sorted.length > 0 ? sorted[sorted.length - 1].liters : 0);
  };

  // GPL cuves are read as a percentage of capacity (gauge), not via the degrees
  // conversion table. For GPL: value entered = % → liters = capacity × %/100.
  const isGplTank = (tankId: string) => tanks.find(t => t.id === tankId)?.type === 'GPL';
  const tankLevelToLiters = (tankId: string, value: number) => {
    if (value === undefined || value === null || isNaN(value as any)) return 0;
    const tank = tanks.find(t => t.id === tankId);
    if (tank && tank.type === 'GPL') return tank.capacity * (value / 100);
    return convertDegreesToLiters(tankId, value);
  };
  // ─── Start baselines ───────────────────────────────────────────────────────
  // When creating, the "start" reference is the live system value. When editing
  // an existing brigade, it must be that brigade's own recorded start references
  // (the live values already reflect this brigade's end), so the comparison &
  // sales recompute correctly.
  const startTankLiters = (t: Tank) => toNum(editingBrigade ? (editingBrigade.startTankLevels?.[t.id]?.liters ?? t.current) : t.current);
  const startTankDegrees = (t: Tank) => toNum(editingBrigade ? (editingBrigade.startTankLevels?.[t.id]?.degrees ?? t.degrees) : t.degrees);
  const startNozzleIdx = (n: { id: string; lastIndex: number }) => toNum(editingBrigade ? (editingBrigade.startNozzleIndices?.[n.id] ?? n.lastIndex) : n.lastIndex);
  /**
   * Index de fin d'un pistolet tel que saisi. `parseFloat` rend `NaN` sur une
   * frappe incomplète ("12,"), et `NaN` traverse `??` sans être arrêté : il
   * contaminait alors les litres, le théorique et jusqu'à l'écart de caisse.
   * Toute lecture de la saisie passe par ici.
   */
  const endNozzleIdx = (n: { id: string; lastIndex: number }) => {
    const typed = wizEndNozzleIndices[n.id];
    return Number.isFinite(typed) ? (typed as number) : startNozzleIdx(n);
  };

  // ─── Wizard derived data ──────────────────────────────────────────────────
  // Brigade pompiste assignments built from the current wizard selections.
  // The brigade now starts from the pompistes themselves: each selected pompiste
  // holds one or more pompes. `trackId` is kept empty for backward compatibility
  // with brigades recorded before the pistes were removed.
  const wizAssignments = useMemo<NonNullable<Brigade['pompisteAssignments']>>(() =>
    wizPompisteIds.map(pid => ({
      pompisteId: pid,
      trackId: '',
      present: (pompistePresence[pid] || 'present') === 'present',
      chefActingAsPompiste: false,
    })),
    [wizPompisteIds, pompistePresence]);

  /** Pompes held by one pompiste on this brigade. */
  const pumpsOf = (pompisteId: string) => pompistePumps[pompisteId] || [];
  /** Active pistolets of the pompes held by one pompiste. */
  const nozzlesOf = (pompisteId: string) => {
    const ids = new Set(pumpsOf(pompisteId));
    return pumpNozzles.filter(n => n.status === 'Actif' && ids.has(n.pumpId));
  };

  const presentAssignments = useMemo(() => wizAssignments.filter(a => a.present), [wizAssignments]);

  // Step 5 validation: end levels must be coherent.
  const tankEndError = (tankId: string): boolean => {
    const deg = wizEndTankLevels[tankId];
    if (deg === undefined || deg === null) return false;
    const tank = tanks.find(t => t.id === tankId);
    if (!tank) return false;
    return tankLevelToLiters(tankId, deg) > startTankLiters(tank) + 0.001;
  };
  const nozzleEndError = (nozzleId: string): boolean => {
    const end = wizEndNozzleIndices[nozzleId];
    if (end === undefined || end === null) return false;
    const noz = pumpNozzles.find(n => n.id === nozzleId);
    if (!noz) return false;
    // Une saisie illisible ("12,") rend NaN : la signaler, plutôt que la laisser
    // filer dans les totaux, où elle efface tout ce qu'elle touche.
    if (!Number.isFinite(end)) return true;
    return end < startNozzleIdx(noz) - 0.001;
  };
  const hasStep5Errors = useMemo(() => {
    const tankErr = tanks.some(t => tankEndError(t.id));
    const activeNozzles = pumpNozzles.filter(n => n.status === 'Actif');
    const nozErr = activeNozzles.some(n => nozzleEndError(n.id));
    return tankErr || nozErr;
  }, [tanks, pumpNozzles, wizEndTankLevels, wizEndNozzleIndices]);

  // Step 6: décalage comparison per tank (nozzleDiff vs cuveDiff).
  const decalageAlerts = useMemo(() => {
    const posSeuil = settings.decalagePositifSeuil ?? 0;
    const negSeuil = settings.decalageNegatifSeuil ?? 0;
    // Active flags decide whether a case is *tracked* at all (controlled from the
    // Dashboard "Paramètres de Décalage" button). Default = active.
    const venteDirecteActif = settings.decalagePositifActif !== false; // cuve a baissé plus
    const retourCuveActif = settings.decalageNegatifActif !== false;   // pistolets ont débité plus
    return tanks.map(tank => {
      const startLiters = startTankLiters(tank);
      const endDeg = wizEndTankLevels[tank.id];
      // The cuve level is no longer part of the brigade wizard. Without a real
      // end reading there is NOTHING to compare, so the cuve reading must not be
      // read as "0 litre sorti" — that would turn every litre sold into a bogus
      // retour-cuve and wipe the pompistes' theoretical takings.
      const hasCuveReading = endDeg !== undefined && endDeg !== null;
      const endLiters = hasCuveReading ? tankLevelToLiters(tank.id, endDeg) : startLiters;
      const cuveDecalage = startLiters - endLiters; // liters that left the tank per cuve measurement
      // A pistolet belongs to a cuve directly (the pompe no longer carries one).
      const tankNozzles = pumpNozzles.filter(n => n.status === 'Actif' && nozzleTankId(n, pumps) === tank.id);
      // Litres débités : comme partout ailleurs, une saisie inversée compte pour
      // zéro — un pistolet ne remplit pas la cuve.
      const nozzleDecalage = tankNozzles.reduce((s, n) => s + Math.max(0, endNozzleIdx(n) - startNozzleIdx(n)), 0);
      const difference = hasCuveReading ? nozzleDecalage - cuveDecalage : 0;
      const price = settings.fuelPrices[tank.type] || 0;
      const amount = Math.abs(difference) * price;
      let type: 'CORRECT' | 'RETOUR_CUVE' | 'VENTE_DIRECTE' = 'CORRECT';
      let suppressed = !hasCuveReading;
      if (difference > 0) {
        // pistolets ont débité plus que la cuve n'a baissé → possible retour cuve
        if (retourCuveActif && difference >= (negSeuil || 0.000001)) { type = 'RETOUR_CUVE'; suppressed = false; }
        else { type = 'CORRECT'; suppressed = true; }
      } else if (difference < 0) {
        // la cuve a baissé plus que les pistolets n'ont débité → possible vente directe
        if (venteDirecteActif && Math.abs(difference) >= (posSeuil || 0.000001)) { type = 'VENTE_DIRECTE'; suppressed = false; }
        else { type = 'CORRECT'; suppressed = true; }
      }
      return { tankId: tank.id, tankName: tank.name, type, nozzleDecalage, cuveDecalage, difference, amount, suppressed };
    });
  }, [tanks, pumps, pumpNozzles, wizEndTankLevels, wizEndNozzleIndices, settings, editingBrigade]);

  // Per-tank RETOUR_CUVE liters (returned to tank, not sold) for excluding from sales.
  const retourCuveByTank = useMemo(() => {
    const m: Record<string, number> = {};
    decalageAlerts.forEach(a => { if (a.type === 'RETOUR_CUVE') m[a.tankId] = a.difference; });
    return m;
  }, [decalageAlerts]);

  // Step 7: per-pompiste theoretical sales summary.
  const pompisteSales = useMemo(() => {
    // total active-nozzle throughput per tank (for proportional retour-cuve attribution)
    const tankThroughput: Record<string, number> = {};
    tanks.forEach(tank => {
      const tankNozzles = pumpNozzles.filter(n => n.status === 'Actif' && nozzleTankId(n, pumps) === tank.id);
      tankThroughput[tank.id] = tankNozzles.reduce((s, n) => s + Math.max(0, endNozzleIdx(n) - startNozzleIdx(n)), 0);
    });
    return presentAssignments.map(a => {
      const myPumpIds = pumpsOf(a.pompisteId);
      const myPumps = pumps.filter(p => myPumpIds.includes(p.id));
      const myNozzles = nozzlesOf(a.pompisteId);
      // Each pistolet is priced with the carburant of ITS OWN cuve, so a pompiste
      // holding pompes of several fuel types is computed exactly per type.
      let litersSold = 0;
      let theoretical = 0;
      const byFuel: Record<string, { liters: number; price: number; amount: number }> = {};
      myNozzles.forEach(n => {
        const tankId = nozzleTankId(n, pumps);
        const fuel = (tanks.find(t => t.id === tankId)?.type || 'DIESEL') as Tank['type'];
        const price = settings.fuelPrices[fuel] || 0;
        let nLiters = Math.max(0, endNozzleIdx(n) - startNozzleIdx(n));
        // subtract proportional retour-cuve share for this nozzle's tank
        if (tankId && retourCuveByTank[tankId] && tankThroughput[tankId] > 0) {
          nLiters -= retourCuveByTank[tankId] * (nLiters / tankThroughput[tankId]);
        }
        nLiters = Math.max(0, nLiters);
        litersSold += nLiters;
        theoretical += nLiters * price;
        if (!byFuel[fuel]) byFuel[fuel] = { liters: 0, price, amount: 0 };
        byFuel[fuel].liters += nLiters;
        byFuel[fuel].amount += nLiters * price;
      });
      const fuelKeys = Object.keys(byFuel);
      const primaryFuel = (fuelKeys[0] || 'DIESEL') as Tank['type'];
      const mixedFuel = fuelKeys.length > 1;
      const pricePerLiter = !mixedFuel
        ? (byFuel[primaryFuel]?.price ?? settings.fuelPrices[primaryFuel] ?? 0)
        : (litersSold > 0 ? theoretical / litersSold : 0); // weighted avg for display only
      const pompisteName = pompistes.find(p => p.id === a.pompisteId)?.name || '—';
      return {
        pompisteId: a.pompisteId,
        name: pompisteName,
        trackId: '',
        trackName: myPumps.map(p => p.name || p.number).join(', ') || '—',
        pumpNames: myPumps.map(p => p.name || p.number),
        fuelType: fuelKeys.length ? fuelKeys.join(' + ') : primaryFuel,
        primaryFuel,
        byFuel,
        mixedFuel,
        litersSold,
        pricePerLiter,
        theoretical,
      };
    });
  }, [presentAssignments, pompistePumps, pumps, pumpNozzles, tanks, wizEndNozzleIndices, settings, retourCuveByTank, pompistes, editingBrigade]);

  /**
   * Les justifications TPE / TAG qui n'ont pas encore choisi leur compte.
   *
   * Une justification encaissée compte pour de l'argent RENTRÉ dans le rapport
   * Carburant. Sans compte bancaire désigné, aucune ligne n'entre au grand
   * livre : la recette existait à l'écran et nulle part en banque. On refuse
   * donc l'enregistrement plutôt que de perdre l'argent en silence.
   */
  const unbankedJustifs = useMemo(() => {
    if (bankAccounts.length === 0) return [] as { pompiste: string; label: string }[];
    const entries = Object.entries(pompisteJustifications) as [string, WizardJustification[]][];
    return entries.flatMap(([pid, list]) =>
      (list || [])
        .filter(j => isBankJustification({ justificationType: j.type }) && (j.amount || 0) > 0
          // Le libellé peut encore nommer le compte : n'est bloquant que ce qui
          // reste VRAIMENT introuvable.
          && !accountOfJustification({ id: j.id, amount: j.amount, bankAccountId: j.bankAccountId, clientName: j.description }, bankAccounts))
        .map(j => ({
          pompiste: pompistes.find(p => p.id === pid)?.name || 'Pompiste',
          label: j.description || j.type,
        })));
  }, [pompisteJustifications, bankAccounts, pompistes]);

  const handleStartBrigade = (forcedStatus?: 'Clôturée' | 'En attente') => {
    if (unbankedJustifs.length > 0) {
      const first = unbankedJustifs[0];
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message:
        `Choisissez le compte bancaire de la justification « ${first.label} » (${first.pompiste})`
        + (unbankedJustifs.length > 1 ? ` — ${unbankedJustifs.length} justifications sans compte` : '') } });
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      const chef = brigadeChefs.find(c => c.id === chefId);
      const chefPompisteIds = chef?.pompisteIds || [];

      // 1-2. Build datetimes
      const startDatetime = `${startDate}T${startHour.padStart(2, '0')}:${startMinute.padStart(2, '0')}:00`;
      const endDatetime = `${endDate}T${endHour.padStart(2, '0')}:${endMinute.padStart(2, '0')}:00`;
      // 3. shiftDate from startDate
      const sDate = startDate;
      // 4. derive shiftType for backward compat
      const sh = parseInt(startHour, 10);
      const sType: 'Matin' | 'Soir' | 'Nuit' = sh >= 6 && sh < 14 ? 'Matin' : sh >= 14 && sh < 22 ? 'Soir' : 'Nuit';

      const assignments = wizAssignments;
      const presentIds = assignments.filter(a => a.present && !a.chefActingAsPompiste).map(a => a.pompisteId);

      // Edit vs create
      const isEdit = !!editingBrigade;
      const existingAccounting = isEdit ? brigadeAccountings.find(a => a.brigadeId === editingBrigade!.id) : undefined;

      // 6-7. start references — live system values when creating, the brigade's
      // own recorded start references when editing (helpers handle this).
      const startNozzleIndices: Record<string, number> = {};
      const startTankLevels: Record<string, { degrees: number; liters: number }> = {};
      pumpNozzles.forEach(n => { startNozzleIndices[n.id] = startNozzleIdx(n); });
      tanks.forEach(t => { startTankLevels[t.id] = { degrees: startTankDegrees(t), liters: startTankLiters(t) }; });

      // 8-9. end references
      const endNozzleIndices: Record<string, number> = {};
      pumpNozzles.forEach(n => { endNozzleIndices[n.id] = endNozzleIdx(n); });

      // Litres réellement débités par les pistolets, cuve par cuve — c'est LA
      // seule chose qu'une brigade retire du stock.
      const usedByTank = brigadeTankConsumption(
        { startNozzleIndices, endNozzleIndices }, pumpNozzles, pumps);

      // Niveau de fin enregistré sur la brigade. `measured` distingue la jauge
      // relevée à la main (qui sert au décalage) du niveau simplement déduit du
      // volume débité : sans ce drapeau, rouvrir une brigade sans relevé faisait
      // apparaître un relevé fantôme égal au niveau de départ, donc un décalage
      // inventé de toutes pièces.
      const endTankLevelsObj: Record<string, { degrees: number; liters: number; measured?: boolean }> = {};
      tanks.forEach(t => {
        const deg = wizEndTankLevels[t.id];
        // For GPL the stored `degrees` value is the gauge percentage.
        endTankLevelsObj[t.id] = deg !== undefined
          ? { degrees: deg, liters: tankLevelToLiters(t.id, deg), measured: true }
          : {
            degrees: startTankDegrees(t),
            liters: Math.max(0, startTankLiters(t) - (usedByTank[t.id] || 0)),
            measured: false,
          };
      });

      const brigadeId = isEdit ? editingBrigade!.id : newId();

      // ── Comptabilité: per-pompiste data + justifications ──────────────────
      const pompisteData: NonNullable<Brigade['pompisteData']> = {};
      const decalageSummary: Record<string, any> = {};
      const accJustifications: BrigadeAccountingJustification[] = [];
      const accountingId = existingAccounting?.id || newId();
      let totalTheoretical = 0;
      let totalCash = 0;
      let totalJustif = 0;

      pompisteSales.forEach(s => {
        // Cash handed over = the single amount typed, PLUS every "versement
        // espèce" recorded for that pompiste (each one timed to the minute).
        const versed = (versements[s.pompisteId] || []).reduce((sum, v) => sum + (v.amount || 0), 0);
        const typed = pompistePayments[s.pompisteId];
        const cash = (typed || 0) + versed;
        const justifs = pompisteJustifications[s.pompisteId] || [];
        const justifTotal = justifs.reduce((sum, j) => sum + (j.amount || 0), 0);
        const ecartRestant = s.theoretical - cash - justifTotal;
        totalTheoretical += s.theoretical;
        totalCash += cash;
        totalJustif += justifTotal;

        pompisteData[s.pompisteId] = {
          litersSold: s.litersSold,
          theoretical: s.theoretical,
          collected: { cash, bons: 0, cheques: 0 },
          totalCollected: cash,
          decalage: -ecartRestant, // negative = shortfall
          pricePerLiter: s.pricePerLiter,
        };

        if (Math.abs(ecartRestant) > 0.01) {
          decalageSummary[s.pompisteId] = { money: ecartRestant, liters: 0 };
        }

        // map justifications into accounting justifications.
        // Each justification carries its own carburant/price when computed by litres;
        // otherwise the amount was entered directly (liters 0, price 0).
        justifs.forEach(j => {
          const jFuel = j.fuelType || s.primaryFuel;
          const jPrice = j.byLiters ? (settings.fuelPrices[jFuel as any] || 0) : 0;
          const jLiters = j.byLiters ? (j.liters || 0) : 0;
          if (j.type === 'TAG' || j.type === 'TPE') {
            // TAG comme TPE : l'argent est entré en BANQUE, sur le compte du
            // terminal choisi. Les lignes du grand livre sont écrites plus bas,
            // depuis ces justifications (voir `brigadeBankLines`), pour qu'une
            // création et une modification suivent exactement la même règle.
            accJustifications.push({
              id: j.id, accountingId, clientId: '', amount: j.amount,
              justificationType: j.type, clientName: j.description || j.clientName,
              notes: j.description, fuelType: jFuel, liters: jLiters, pricePerLiter: jPrice,
              trackId: s.trackId, pompisteId: s.pompisteId,
              bankAccountId: j.bankAccountId,
            });
          } else if (j.type === 'EXPENSE') {
            // Une DÉPENSE n'a ni client ni banque : son nom vit dans
            // `clientName`, sa précision dans `notes` — les colonnes existantes.
            // Elle deviendra une vraie ligne de l'écran Dépenses plus bas.
            accJustifications.push({
              id: j.id, accountingId, clientId: '', amount: j.amount,
              justificationType: 'EXPENSE',
              clientName: (j.expenseName || '').trim() || BRIGADE_EXPENSE_CATEGORY,
              expenseCategory: j.expenseCategory,
              notes: j.description || undefined,
              fuelType: jFuel, liters: jLiters, pricePerLiter: jPrice,
              trackId: s.trackId, pompisteId: s.pompisteId,
            });
          } else {
            accJustifications.push({
              id: j.id, accountingId, clientId: j.clientId || '', amount: j.amount,
              justificationType: 'CLIENT', paymentMode: j.type === 'CLIENT_AVANCE' ? 'AVANCE' : 'CREDIT',
              clientName: j.clientName, notes: j.description, fuelType: jFuel, liters: jLiters,
              pricePerLiter: jPrice, trackId: s.trackId, pompisteId: s.pompisteId,
            });
          }
        });
      });

      const totalRest = totalTheoretical - totalCash - totalJustif;
      // "A-t-on saisi de l'argent ?" — un montant tapé OU au moins un versement.
      const hasAnyCash = presentAssignments.some(a =>
        pompistePayments[a.pompisteId] !== undefined || (versements[a.pompisteId] || []).length > 0);

      // Determine explicit status or fallback to cash heuristic
      const finalStatus: 'Clôturée' | 'En attente' = forcedStatus || (hasAnyCash ? 'Clôturée' : 'En attente');

      // ── Create / update the brigade ────────────────────────────
      const newBrigade: Brigade = {
        ...(isEdit ? editingBrigade! : {} as Brigade),
        id: brigadeId,
        // La base pose son propre `created_at` ; on l'inscrit aussi ici pour que
        // la brigade tout juste saisie prenne SA place en tête de liste sans
        // attendre le prochain chargement.
        createdAt: isEdit ? editingBrigade!.createdAt : new Date().toISOString(),
        date: sDate,
        shift: sType,
        chefId: chefId || undefined,
        status: finalStatus,
        isActive: false,
        startDatetime,
        endDatetime,
        startTimestamp: startDatetime,
        endTimestamp: endDatetime,
        startTime: `${startHour.padStart(2, '0')}:${startMinute.padStart(2, '0')}`,
        endTime: `${endHour.padStart(2, '0')}:${endMinute.padStart(2, '0')}`,
        pompisteIds: presentIds,
        pompisteAssignments: assignments,
        // Which pompes each pompiste held (several per pompiste are allowed).
        pompistePumpAssignments: presentAssignments.map(a => ({
          pompisteId: a.pompisteId, pumpIds: pumpsOf(a.pompisteId),
        })),
        // Versements espèce horodatés à la minute, conservés sur la brigade.
        versements: presentAssignments.flatMap(a =>
          (versements[a.pompisteId] || []).map(v => ({
            id: v.id, pompisteId: a.pompisteId, amount: v.amount, at: v.at, notes: v.notes,
          }))),
        startIndices: {},
        endIndices: {},
        startTankLevels,
        endTankLevels: endTankLevelsObj,
        startNozzleIndices,
        endNozzleIndices,
        activeNozzleIds: pumpNozzles.filter(n => n.status === 'Actif').map(n => n.id),
        pompisteData,
        canReactivate: false,
        notes: currentUserName ? `Créé par: ${currentUserName}` : (isEdit ? editingBrigade!.notes : undefined),
      };
      dispatch({ type: isEdit ? 'UPDATE_BRIGADE' : 'ADD_BRIGADE', payload: newBrigade });

      // 5. Create / update the linked accounting record
      const accounting: BrigadeAccounting = {
        id: accountingId,
        brigadeId,
        totalDue: totalTheoretical,
        cashReceived: totalCash,
        rest: totalRest,
        tankSummary: tanks.map(t => {
          const startL = startTankLevels[t.id]?.liters || 0;
          const endL = endTankLevelsObj[t.id]?.liters || 0;
          // Un pistolet appartient à SA cuve. Passer par `pump.tankId` — qui n'est
          // qu'un miroir du PREMIER pistolet de la pompe — rattachait à la mauvaise
          // cuve tous les pistolets d'une pompe qui en sert plusieurs.
          const tankNozzles = pumpNozzles.filter(n => n.status === 'Actif' && nozzleTankId(n, pumps) === t.id);
          const nozzleDiff = tankNozzles.reduce((s, n) => s + Math.max(0, toNum(endNozzleIndices[n.id]) - toNum(startNozzleIndices[n.id])), 0);
          // Sans jauge de fin relevée, il n'y a rien à comparer : l'écart vaut 0.
          const measured = endTankLevelsObj[t.id]?.measured !== false;
          const cuveDiff = startL - endL;
          const ecart = measured ? nozzleDiff - cuveDiff : 0;
          const price = settings.fuelPrices[t.type] || 0;
          return {
            tankId: t.id,
            name: t.name,
            fuelType: t.type,
            start: startTankLevels[t.id],
            end: endTankLevelsObj[t.id],
            measured,
            diff: cuveDiff,
            nozzleDiff,
            ecart,
            ecartMoney: Math.abs(ecart) * price,
          };
        }),
        nozzleSummary: pumpNozzles.filter(n => n.status === 'Actif').map(n => {
          const pump = pumps.find(p => p.id === n.pumpId);
          // Le prix suit le carburant de la cuve DU PISTOLET, jamais celui de la
          // pompe : deux pistolets d'une même pompe peuvent servir deux carburants.
          const tank = tanks.find(t => t.id === nozzleTankId(n, pumps));
          const startIdx = toNum(startNozzleIndices[n.id]);
          const endIdx = toNum(endNozzleIndices[n.id], startIdx);
          const liters = Math.max(0, endIdx - startIdx);
          const price = tank ? (settings.fuelPrices[tank.type] || 0) : 0;
          return {
            nozzleId: n.id,
            nozzleName: n.name,
            pumpId: pump?.id,
            pumpName: pump?.name,
            tankId: tank?.id,
            tankName: tank?.name,
            fuelType: tank?.type,
            start: startIdx,
            end: endIdx,
            startIdx,
            endIdx,
            liters,
            price,
            revenue: liters * price,
          };
        }),
        pompisteSummary: Object.fromEntries(
          pompisteSales.map(s => {
            // Les VERSEMENTS horodatés sont de l'argent remis, au même titre que
            // le montant tapé en fin de brigade. Les oublier ici faisait dire au
            // rapport Carburant qu'un pompiste devait encore tout ce qu'il avait
            // déjà versé — un manquant inventé, alors que la caisse, elle,
            // comptait bien les deux (`totalCash`).
            const versed = (versements[s.pompisteId] || []).reduce((sum, v) => sum + (v.amount || 0), 0);
            const cash = (pompistePayments[s.pompisteId] || 0) + versed;
            const justifs = pompisteJustifications[s.pompisteId] || [];
            const justifTotal = justifs.reduce((sum, j) => sum + (j.amount || 0), 0);
            return [s.pompisteId, {
              theoretical: s.theoretical,
              cashReceived: cash,
              justifTotal,
              ecart: s.theoretical - cash - justifTotal,
              litersSold: s.litersSold,
              trackId: s.trackId,
              trackName: s.trackName,
            }];
          })
        ),
        decalageSummary,
        cuveVerifications: existingAccounting?.cuveVerifications || {},
        nozzleVerifications: existingAccounting?.nozzleVerifications || {},
        restAssignedAmount: existingAccounting?.restAssignedAmount || 0,
        restAssignedWorkerType: existingAccounting?.restAssignedWorkerType,
        restAssignedWorkerId: existingAccounting?.restAssignedWorkerId,
        status: finalStatus === 'Clôturée' ? 'completed' : 'draft',
        createdBy: currentUserName || existingAccounting?.createdBy,
        justifications: accJustifications,
      };
      dispatch({ type: (isEdit && existingAccounting) ? 'UPDATE_BRIGADE_ACCOUNTING' : 'ADD_BRIGADE_ACCOUNTING', payload: accounting });

      // ── Les dépenses justifiées deviennent de VRAIES dépenses ───────────────
      // Le pompiste a payé sur les espèces de la brigade : la charge doit peser
      // dans le résultat du Carburant et se retrouver dans l'écran Dépenses,
      // avec la brigade qui l'a produite. Elle ne sort d'AUCUNE caisse — la
      // brigade a déjà remis son montant en moins (`lib/brigadeExpenses.ts`).
      {
        const plan = planBrigadeExpenses(accJustifications, expenses, {
          brigadeId, date: sDate, shift: sType, createdBy: currentUserName,
          pompisteName: pid => pompistes.find(x => x.id === pid)?.name,
        });
        plan.remove.forEach(id => dispatch({ type: 'DELETE_EXPENSE', payload: id }));
        plan.add.forEach(e => dispatch({ type: 'ADD_EXPENSE', payload: e }));
        plan.update.forEach(e => dispatch({ type: 'UPDATE_EXPENSE', payload: e }));
      }

      // ── TPE / TAG : l'argent justifié entre sur le compte bancaire choisi ────
      // Les lignes de la brigade sont réécrites à chaque enregistrement pour que
      // les soldes restent exacts même après modification. Une ligne par
      // justification : l'historique du compte montre alors QUI a encaissé quoi.
      treasuryTransactions
        .filter(t => t.refType === 'brigade' && t.refId === brigadeId)
        .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
      brigadeBankLines({
        brigadeId,
        date: endDatetime,
        label: sDate,
        justifications: accJustifications,
        pompisteName: pid => pompistes.find(x => x.id === pid)?.name,
        createdBy: currentUserName,
        accounts: bankAccounts,
      }).forEach(tx => dispatch({ type: 'ADD_TREASURY_TX', payload: tx }));
      // Les espèces réellement remises alimentent la caisse générale.
      if (totalCash > 0) {
        dispatch({
          type: 'ADD_TREASURY_TX',
          payload: {
            id: newId(), date: endDatetime, kind: 'BRIGADE', amount: totalCash,
            description: `Encaissement brigade du ${sDate}`,
            accountTo: CAISSE_ID, part: 'carburant',
            refType: 'brigade', refId: brigadeId,
            createdBy: currentUserName, createdAt: new Date().toISOString(),
          },
        });
      }

      // 10. Décalage alerts (non-suppressed) for admin dashboard.
      // On edit, clear the brigade's previous alerts first so they don't pile up.
      if (isEdit) dispatch({ type: 'DELETE_BRIGADE_DECALAGE_ALERTS_BY_BRIGADE', payload: brigadeId });
      const workersInfo = [
        ...(chef ? [{ id: chef.id, name: chef.name, role: 'chef_brigade' }] : []),
        ...assignments.filter(a => a.present).map(a => {
          const p = pompistes.find(x => x.id === a.pompisteId);
          return { id: a.pompisteId, name: p?.name || (a.chefActingAsPompiste ? (chef?.name || 'Chef') : '—'), role: a.chefActingAsPompiste ? 'chef_brigade' : 'pompiste' };
        }),
      ];
      decalageAlerts.filter(a => !a.suppressed && a.type !== 'CORRECT').forEach(al => {
        const alert: BrigadeDecalageAlert = {
          id: newId(),
          brigadeId,
          brigadeDate: sDate,
          startDatetime,
          endDatetime,
          chefId: chefId || undefined,
          chefName: chef?.name,
          alertType: al.type,
          tankId: al.tankId,
          tankName: al.tankName,
          decalageLiters: Math.abs(al.difference),
          decalageAmount: al.amount,
          workersInfo,
          isDismissed: false,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_BRIGADE_DECALAGE_ALERT', payload: alert });
      });

      // 11. Cuves — on RETIRE les litres débités par les pistolets, on ne réécrit
      //     JAMAIS le niveau en valeur absolue. Une écriture absolue déduite de
      //     la jauge remettait les cuves à zéro dès que la table de conversion
      //     était vide, et effaçait les litres apportés par les achats. À la
      //     modification, seule la DIFFÉRENCE avec le volume déjà retiré par
      //     cette brigade est appliquée — comme pour un achat carburant.
      const tankDeltas = brigadeTankDeltas(
        isEdit ? editingBrigade : null,
        { startNozzleIndices, endNozzleIndices },
        pumpNozzles, pumps);
      if (tankDeltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: tankDeltas });

      // 12. L'index de fin devient le dernier index du pistolet : c'est lui qui
      //     servira d'index de DÉBUT à la brigade suivante. Une valeur non
      //     numérique ne doit jamais y arriver, sans quoi la brigade suivante
      //     partirait d'un index invalide et sa différence serait fausse.
      //
      //     Mais SEULE la dernière brigade à avoir relevé un pistolet déplace
      //     son compteur. Rouvrir une brigade ancienne pour corriger un
      //     versement y recopiait ses index de fin : les vingt pistolets
      //     RECULAIENT sur les index de ce jour-là, et la brigade suivante
      //     repartait d'un compteur du passé. Une correction ancienne garde
      //     désormais ses index pour elle — voir `lib/nozzleIndexes.ts`.
      //     Le classement se fait sur la liste TELLE QU'ELLE EST APRÈS cet
      //     enregistrement : sans la fiche qu'on vient de saisir, une création
      //     n'aurait jamais le droit de déplacer un compteur.
      const brigadesAfterSave = [...brigades.filter(b => b.id !== brigadeId), newBrigade];
      pumpNozzles.forEach(n => {
        const end = endNozzleIndices[n.id];
        if (!Number.isFinite(end) || end === n.lastIndex) return;
        if (!ownsNozzleIndex(brigadesAfterSave, brigadeId, n.id)) return;
        dispatch({ type: 'UPDATE_NOZZLE', payload: { ...n, lastIndex: end } });
      });

      // ── Report sur les comptes clients ────────────────────────────────────
      // On applique la DIFFÉRENCE avec ce que cette brigade avait déjà porté aux
      // comptes : à la création elle vaut la totalité des bons, à la correction
      // elle ne vaut que ce qui a changé. Une justification retirée rend au
      // client ce qu'elle lui avait pris — auparavant l'édition ne touchait rien
      // du tout, et un bon corrigé restait facturé au montant d'origine.
      clientChargeDelta(existingAccounting?.justifications, accJustifications)
        .forEach((delta, clientId) => {
          const client = clients.find(c => c.id === clientId);
          if (!client) return;
          // Les deux colonnes de l'avance descendent ensemble : la recharge
          // crédite `balance` côté Clients, la consommation ne touchait que
          // `advanceBalance`, et le client gardait à l'écran une avance qu'il
          // avait déjà dépensée.
          dispatch({
            type: 'UPDATE_CLIENT',
            payload: {
              ...client,
              debt: Math.max(0, (client.debt || 0) + delta.credit),
              advanceBalance: Math.max(0, (client.advanceBalance ?? client.balance ?? 0) - delta.advance),
              balance: Math.max(0, (client.balance || 0) - delta.advance),
            },
          });
        });

      // Absences only on first creation — on edit they are left untouched to
      // avoid double-counting them.
      if (!isEdit) {
        // Record absences for absent pompistes
        assignments.filter(a => !a.present && !a.chefActingAsPompiste).forEach(a => {
          const pompiste = pompistes.find(p => p.id === a.pompisteId);
          if (pompiste) {
            dispatch({
              type: 'UPDATE_POMPISTE',
              payload: {
                ...pompiste,
                absences: [...(pompiste.absences || []), {
                  id: newId(), date: sDate, cost: 0,
                  description: `Absent brigade ${sDate} ${sType}`, isPaid: false,
                }],
              },
            });
          }
        });
      }

      // Le message dit ce que les cuves ont pris : c'est le seul endroit où le
      // stock bouge, l'utilisateur doit pouvoir le vérifier tout de suite.
      const litersOut = Object.values(usedByTank).reduce((s, n) => s + n, 0);
      const cuveMsg = litersOut > 0
        ? ` — ${litersOut.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L retirés des cuves`
        : '';
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: (isEdit ? "Brigade mise à jour avec succès !" : "Brigade créée et clôturée avec succès !") + cuveMsg } });
      setShowModal(false);
      setEditingBrigade(null);
      resetForm();
      setIsSubmitting(false);
    }, 600);
  };

  // Preload the full 7-step wizard with an existing brigade for editing.
  const loadBrigadeIntoWizard = (b: Brigade) => {
    const acc = brigadeAccountings.find(a => a.brigadeId === b.id);
    setEditingBrigade(b);
    setChefId(b.chefId || "");

    // Pompistes retained + presence, from the stored assignments.
    const presence: Record<string, 'present' | 'absent'> = {};
    const ids: string[] = [];
    (b.pompisteAssignments || []).forEach(a => {
      presence[a.pompisteId] = a.present ? 'present' : 'absent';
      ids.push(a.pompisteId);
    });
    (b.pompisteIds || []).forEach(pid => { if (!presence[pid]) { presence[pid] = 'present'; ids.push(pid); } });
    setPompistePresence(presence);
    setWizPompisteIds(Array.from(new Set(ids)));
    // Pompes held by each pompiste (empty for brigades recorded before the change).
    const pumpMap: Record<string, string[]> = {};
    ((b as any).pompistePumpAssignments || []).forEach((x: any) => {
      if (x?.pompisteId) pumpMap[x.pompisteId] = x.pumpIds || [];
    });
    setPompistePumps(pumpMap);
    setVersements({});

    // datetimes (string-split to avoid timezone drift)
    const splitDT = (iso?: string) => {
      if (iso && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
        const [datePart, timePart] = iso.split('T');
        const [hh, mm] = timePart.split(':');
        return { date: datePart, hh, mm };
      }
      return null;
    };
    const sStart = splitDT(b.startDatetime) || { date: b.date, hh: (b.startTime || '06:00').split(':')[0], mm: (b.startTime || '06:00').split(':')[1] };
    const sEnd = splitDT(b.endDatetime) || { date: b.date, hh: (b.endTime || '14:00').split(':')[0], mm: (b.endTime || '14:00').split(':')[1] };
    setStartDate(sStart.date); setStartHour(sStart.hh); setStartMinute(sStart.mm);
    setEndDate(sEnd.date); setEndHour(sEnd.hh); setEndMinute(sEnd.mm);

    // end tank levels (degrees value; for GPL this is the gauge %)
    // Seuls les relevés RÉELLEMENT saisis sont rechargés : un niveau simplement
    // déduit du volume débité (`measured === false`) n'est pas un relevé, et le
    // remettre dans le formulaire créerait un décalage qui n'a jamais existé.
    // Les brigades enregistrées avant ce drapeau n'en ont pas : elles sont
    // rechargées comme avant, pour ne pas perdre leur relevé.
    const endTanks: Record<string, number> = {};
    Object.entries(b.endTankLevels || {}).forEach(([tid, lvl]: [string, any]) => {
      if (lvl?.measured === false) return;
      if (lvl && lvl.degrees !== undefined && lvl.degrees !== null) endTanks[tid] = lvl.degrees;
    });
    setWizEndTankLevels(endTanks);
    setWizEndNozzleIndices({ ...(b.endNozzleIndices || {}) });

    // payments + justifications from the accounting record
    const payments: Record<string, number> = {};
    Object.entries(b.pompisteData || {}).forEach(([pid, d]: [string, any]) => {
      payments[pid] = d?.collected?.cash ?? d?.totalCollected ?? 0;
    });
    setPompistePayments(payments);

    const justifMap: Record<string, WizardJustification[]> = {};
    (acc?.justifications || []).forEach(j => {
      // Une pièce sans pompiste — la fenêtre Comptabilité en écrit pour les
      // dépenses — était purement PERDUE ici : rouvrir la brigade dans
      // l'assistant l'effaçait, et le reste redevenait un manquant. On la
      // rattache au premier pompiste du lot plutôt que de la jeter.
      const pid = j.pompisteId || (b.pompisteIds || [])[0] || '';
      if (!pid) return;
      const type = j.justificationType === 'TAG' ? 'TAG'
        : j.justificationType === 'TPE' ? 'TPE'
        : j.justificationType === 'EXPENSE' ? 'EXPENSE'
        : (j.paymentMode === 'AVANCE' ? 'CLIENT_AVANCE' : 'CLIENT_CREDIT');
      const byLiters = (j.liters || 0) > 0;
      (justifMap[pid] = justifMap[pid] || []).push({
        id: j.id,
        type: type as any,
        // Le compte bancaire du terminal DOIT revenir avec la justification.
        // Sans lui, réenregistrer la brigade effaçait ses lignes de banque puis
        // n'en réécrivait aucune : le solde du compte perdait le montant du TPE
        // à chaque simple correction, sans qu'aucune pièce ne l'explique.
        //
        // Le LIBELLÉ sert de filet quand la colonne a déjà été perdue : une
        // brigade réenregistrée avant cette correction a vu son
        // `bank_account_id` remis à NULL en base, mais « TPE Naftal card » est
        // resté écrit dans la pièce. Rouvrir une telle brigade la répare donc
        // d'elle-même.
        bankAccountId: accountOfJustification(j, bankAccounts),
        // Une DÉPENSE garde son nom dans `clientName` et sa précision dans
        // `notes` : les deux repartent dans leurs champs respectifs.
        expenseName: type === 'EXPENSE' ? (j.clientName || '') : undefined,
        expenseCategory: type === 'EXPENSE' ? (j.expenseCategory || undefined) : undefined,
        description: j.notes || ((type === 'TAG' || type === 'TPE') ? (j.clientName || '') : ''),
        liters: j.liters || 0,
        amount: j.amount || 0,
        byLiters,
        fuelType: j.fuelType,
        clientId: j.clientId || undefined,
        clientName: j.clientName,
      });
    });
    setPompisteJustifications(justifMap);

    setJustifClientSearch({});
    setExpenseDraft({});
    setShowNewClientForm(null);
    setStep(1);
    setActionMenuOpen(null);
    setShowModal(true);
  };

  const resetForm = () => {
    setStep(1);
    setChefId("");
    setSelectedPompisteIds([]);
    setStartIndices({});
    setStartTankLevels({});
    setShiftType('Matin');
    setShiftDate(new Date().toISOString().split('T')[0]);
    setActionMenuOpen(null);
    setActivateStep(1);
    setDeactivateStep(1);
    setPompistePresence({});
    setPompistePumps({});
    setWizPompisteIds([]);
    setVersements({});
    setCanReactivate(false);
    // New 7-step wizard resets
    const today = new Date().toISOString().split('T')[0];
    setStartDate(today);
    setEndDate(today);
    setStartHour('06'); setStartMinute('00');
    setEndHour('14'); setEndMinute('00');
    setWizEndTankLevels({});
    setWizEndNozzleIndices({});
    setPompistePayments({});
    setPompisteJustifications({});
    setJustifClientSearch({});
    setExpenseDraft({});
    setShowNewClientForm(null);
    setNewClientDraft({ name: '', phone: '', type: 'PARTICULIER', paymentMode: 'CASH' });
  };

  const handleSaveEditBrigade = () => {
    if (!editingBrigade) return;
    
    const updatedBrigade: Brigade = {
      ...editingBrigade,
      chefId: chefId || undefined,
      shift: shiftType,
      date: shiftDate,
      startTime,
      endTime
    };

    dispatch({ type: 'UPDATE_BRIGADE', payload: updatedBrigade });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Brigade mise à jour" } });
    setShowEditModal(false);
    setEditingBrigade(null);
    resetForm();
  };

  const handleClotureSubmit = () => {
    if (!activeBrigade) return;

    // 1. Calculate and Update Pompistes Payment Records
    activeBrigade.pompisteIds?.forEach(pid => {
      const data = pompisteBilan[pid];
      if (data && data.decalage !== 0) {
        const pompiste = pompistes.find(p => p.id === pid);
        if (pompiste) {
          const newPayment = {
            date: new Date().toISOString(),
            amount: Math.abs(data.decalage),
            type: (data.decalage > 0 ? "BONUS_DECALAGE" : "RETENUE_DECALAGE") as any
          };
          dispatch({ 
            type: 'UPDATE_POMPISTE', 
            payload: { 
              ...pompiste, 
              paymentRecord: [...(pompiste.paymentRecord || []), newPayment] 
            } 
          });
        }
      }
    });

    // 2. Cuves — même règle que l'assistant : on RETIRE le volume débité par les
    //    pistolets, on ne réécrit pas le niveau à partir de la jauge.
    const clotureDeltas = brigadeTankDeltas(
      null,
      { startNozzleIndices: activeBrigade.startNozzleIndices, endNozzleIndices: wizEndNozzleIndices },
      pumpNozzles, pumps);
    if (clotureDeltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: clotureDeltas });

    // 3. Update Pumps
    Object.entries(endIndices).forEach(([pumpId, index]) => {
      const pump = pumps.find(p => p.id === pumpId);
      if (pump) {
        dispatch({ type: 'UPDATE_PUMP', payload: { ...pump, lastIndex: index, currentBrigadeStartIndex: undefined } });
      }
    });

    // 4. Update Brigade Status
    const closedBrigade: Brigade = {
      ...activeBrigade,
      status: 'Clôturée',
      endIndices,
      endTankLevels,
      pompisteData: pompisteBilan,
      endTimestamp: new Date().toISOString()
    };
    dispatch({ type: 'UPDATE_BRIGADE', payload: closedBrigade });

    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Brigade clôturée avec succès" } });
    setShowClotureModal(false);
    
    // Suggest seeing the daily report
    if (confirm("Voulez-vous voir la fiche journalière ?")) {
      navigate(`/daily-report?date=${activeBrigade.date}`);
    }
  };

  const activePompistesInBrigade = useMemo(() => {
    if (!activeBrigade) return [];
    return pompistes.filter(p => activeBrigade.pompisteIds?.includes(p.id));
  }, [activeBrigade, pompistes]);

  const activePumpsForCloture = useMemo(() => {
    if (!activeBrigade) return [];
    const trackIds = activePompistesInBrigade.map(p => p.trackId).filter(Boolean);
    return pumps.filter(p => trackIds.includes(p.trackId));
  }, [activeBrigade, activePompistesInBrigade, pumps]);

  const activePumpsForSelection = useMemo(() => {
    const trackIds = pompistes.filter(p => selectedPompisteIds.includes(p.id)).map(p => p.trackId).filter(Boolean);
    return pumps.filter(p => trackIds.includes(p.trackId));
  }, [selectedPompisteIds, pompistes, pumps]);

  const pompisteBilan = useMemo(() => {
    const data: Record<string, any> = {};
    activePompistesInBrigade.forEach(pompiste => {
      const pPumps = activePumpsForCloture.filter(p => p.trackId === pompiste.trackId);
      const litersSold = pPumps.reduce((acc, pump) => {
        const start = activeBrigade?.startIndices?.[pump.id] || 0;
        const end = endIndices[pump.id] || start;
        return acc + (end - start);
      }, 0);

      const enc = pompisteEncaissements[pompiste.id] || { cash: 0, bons: 0, cheques: 0, pricePerLiter: settings.fuelPrices[pPumps[0]?.type] || 0 };
      const theoretical = litersSold * enc.pricePerLiter;
      const totalCollected = enc.cash + enc.bons + enc.cheques;
      const decalage = totalCollected - theoretical;

      data[pompiste.id] = {
        litersSold,
        theoretical,
        collected: { cash: enc.cash, bons: enc.bons, cheques: enc.cheques },
        totalCollected,
        decalage,
        pricePerLiter: enc.pricePerLiter
      };
    });
    return data;
  }, [activeBrigade, activePompistesInBrigade, activePumpsForCloture, endIndices, pompisteEncaissements, settings.fuelPrices]);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 italic text-left">
      {/* Main Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">
            {currentUserRole === 'gerant' ? 'Brigades - Vue Gérant' : 'Journal des Brigades'}
          </h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">
            {currentUserRole === 'gerant' 
              ? 'Historique des brigades et détails des rotations' 
              : 'Historique des rotations et relevés d\'index.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {perm.creer && (
            <button onClick={() => { setEditingBrigade(null); resetForm(); setShowModal(true); }} className="h-14 px-8 bg-gradient-to-r from-[#001f5c] via-[#002d85] to-[#001f5c] text-[#FFB800] border border-blue-900 hover:border-[#FFB800] rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-blue-950/20 hover:scale-105 transition-all flex items-center gap-3 italic">
              <Plus className="w-5 h-5 text-[#FFB800]" /> CRÉER NOUVELLE BRIGADE
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input placeholder="🔍 Rechercher par ID..." value={searchId} onChange={e => setSearchId(e.target.value)}
            className="pl-9 pr-4 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold w-56 focus:border-yellow-400 outline-none transition-colors" />
        </div>
        <select value={filterChef} onChange={e => setFilterChef(e.target.value)}
          className="px-4 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold focus:border-yellow-400 outline-none bg-white">
          <option value="">Tous les Chefs</option>
          {brigadeChefs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterPompiste} onChange={e => setFilterPompiste(e.target.value)}
          className="px-4 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold focus:border-yellow-400 outline-none bg-white">
          <option value="">Tous les Pompistes</option>
          {pompistes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Date exacte */}
        <div className="flex flex-col">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 ml-1">Date exacte</label>
          <input type="date" value={filterDate}
            onChange={e => { setFilterDate(e.target.value); if (e.target.value) { setFilterStartDate(''); setFilterEndDate(''); } }}
            className="px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold focus:border-yellow-400 outline-none bg-white disabled:opacity-50" />
        </div>

        {/* Période Du → Au */}
        <div className="flex flex-col">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 ml-1">Période — Du</label>
          <input type="date" value={filterStartDate} disabled={!!filterDate}
            onChange={e => setFilterStartDate(e.target.value)}
            className="px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold focus:border-yellow-400 outline-none bg-white disabled:opacity-50 disabled:cursor-not-allowed" />
        </div>
        <div className="flex flex-col">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 ml-1">Au</label>
          <input type="date" value={filterEndDate} disabled={!!filterDate} min={filterStartDate || undefined}
            onChange={e => setFilterEndDate(e.target.value)}
            className="px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold focus:border-yellow-400 outline-none bg-white disabled:opacity-50 disabled:cursor-not-allowed" />
        </div>

        {hasActiveFilters && (
          <button onClick={clearBrigadeFilters}
            className="px-3 py-2.5 text-xs text-red-500 font-black hover:underline self-end">✕ Effacer filtres</button>
        )}
      </div>

      {/* Vue Gérant — désactivée, gérée par le bloc unifié ci-dessous */}
      {false && (() => {
        const filteredBrigades = brigades.filter(matchesBrigadeFilters).sort(byNewestFirst);
        return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBrigades.length > 0 ? filteredBrigades.map((b) => {
              const chef = brigadeChefs.find(c => c.id === b.chefId);
              const pompistesList = pompistes.filter(p => b.pompisteIds?.includes(p.id));
              const tanksList = tanks.filter(t => Object.keys(b.startTankLevels || {}).includes(t.id));
              
              return (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="card-glass p-6 rounded-2xl border border-slate-50 hover:border-primary/30 transition-all group"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-sm font-black text-primary uppercase mb-1">{b.date}</h3>
                      <p className="text-[10px] text-slate-400 font-bold">{b.id}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn("px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap", b.status === "Ouverte" ? "bg-green-100 text-green-700" : b.status === "Planifiée" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400")}>
                        {b.status === "Ouverte" ? "En cours" : b.status}
                      </span>
                      
                      <div className="relative inline-block">
                        <button
                          onClick={() => setActionMenuOpen(actionMenuOpen === b.id ? null : b.id)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-slate-300 group-hover:text-primary transition-all"
                          aria-label="Menu"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>

                        <AnimatePresence>
                          {actionMenuOpen === b.id && (
                            <motion.div
                              initial={{ opacity: 0, y: -8, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -8, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="absolute right-0 mt-2 w-52 bg-white border border-slate-100 rounded-xl shadow-lg z-50 overflow-hidden"
                            >
                              <div className="divide-y divide-slate-100">
                                <button
                                  onClick={() => { setSelectedBrigade(b); setShowDetail(true); setDetailTab('info'); setActionMenuOpen(null); }}
                                  className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                                >
                                  <EyeIcon className="w-4 h-4" /> Voir Détails
                                </button>
                                {b.status === 'Clôturée' && (currentUserRole === 'admin' || currentUserRole === 'gerant') && (
                                  <button
                                    onClick={() => { setSelectedBrigade(b); setShowAccountingModal(true); setActionMenuOpen(null); }}
                                    className="w-full px-4 py-3 text-left text-sm font-bold text-emerald-600 hover:bg-emerald-50 flex items-center gap-2 transition-colors"
                                  >
                                    <DollarSign className="w-4 h-4" /> Comptabilité
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* Chef Info */}
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                    <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-xs">
                      {chef?.name[0]}
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-700">{chef?.name}</p>
                      <p className="text-[9px] text-slate-400">{b.shift}</p>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="space-y-3 mb-4">
                    {/* Pompistes */}
                    <div>
                      <p className="text-[9px] font-bold text-slate-400 uppercase mb-2">Agents ({pompistesList.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {pompistesList.slice(0, 3).map(p => (
                          <span key={p.id} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-[9px] font-bold">{p.name.split(' ')[0]}</span>
                        ))}
                        {pompistesList.length > 3 && (
                          <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[9px] font-bold">+{pompistesList.length - 3}</span>
                        )}
                      </div>
                    </div>

                    {/* Cuves */}
                    {tanksList.length > 0 && (
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mb-2">Cuves ({tanksList.length})</p>
                        <div className="flex flex-wrap gap-1">
                          {tanksList.map(t => (
                            <span key={t.id} className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-[9px] font-bold">{t.name}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Shift Info */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <div className="p-2 bg-slate-50 rounded">
                        <p className="text-[8px] font-bold text-slate-400 uppercase">Horaires</p>
                        <p className="text-[10px] font-black text-slate-700">{b.startTime} - {b.endTime}</p>
                      </div>
                      {b.pompisteData && (
                        <div className="p-2 bg-slate-50 rounded">
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Décalage</p>
                          <p className={cn("text-[10px] font-black", Object.values(b.pompisteData).some((d: any) => d.decalage < 0) ? "text-red-600" : "text-green-600")}>
                            {Object.values(b.pompisteData).reduce((acc: number, d: any) => acc + (d.decalage || 0), 0).toLocaleString()} DZD
                          </p>
                        </div>
                      )}
                    </div>
                  </div>


                </motion.div>
              );
            }) : (
              <div className="col-span-full">
                <EmptyState icon={Users} title="Aucune brigade" description="L'historique est vide pour le moment" />
              </div>
            )}
          </div>
        </motion.div>
        );
      })()}

      {/* Grille de Brigades — toutes les rôles */}
      {(() => {
        const filteredBrigades = brigades.filter(matchesBrigadeFilters).sort(byNewestFirst);
        return (
        <div className="space-y-6">
          {/* Result count + active date/période summary */}
          <div className="flex items-center justify-between flex-wrap gap-2 px-1">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">
              {filteredBrigades.length} brigade{filteredBrigades.length !== 1 ? 's' : ''}{hasActiveFilters ? ' (filtrées)' : ''}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {(filterDate || filterStartDate || filterEndDate) && (
                <span className="px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg text-[10px] font-black text-blue-700 uppercase tracking-wider">
                  {filterDate
                    ? `📅 ${filterDate}`
                    : `📅 ${filterStartDate || '…'} → ${filterEndDate || '…'}`}
                </span>
              )}
              <ViewToggle view={brigadeView} onChange={setBrigadeView} />
            </div>
          </div>
          {filteredBrigades.length > 0 && brigadeView === 'table' ? (
            /* ── L'historique des brigades en tableau ─────────────────────
               Ce qu'on vient y chercher : quel jour, quel poste, quel chef,
               combien de pompistes, et ce que la comptabilité en a tiré. */
            <KitTable head={<>
              <th className="table-head">Brigade</th><th className="table-head">Date</th>
              <th className="table-head">Poste</th><th className="table-head">Horaires</th>
              <th className="table-head">Chef</th><th className="table-head text-right">Pompistes</th>
              <th className="table-head text-right">Litres</th><th className="table-head text-right">Encaissé</th>
              <th className="table-head">État</th><th className="table-head text-right">Actions</th>
            </>}>
              {filteredBrigades.map(b => {
                const brigadeChef = brigadeChefs.find(c => c.id === b.chefId);
                const pompisteCount = (pompistes.filter(p => b.pompisteIds?.includes(p.id)) || []).length;
                const accounting = brigadeAccountings.find(a => a.brigadeId === b.id);
                const data = Object.values(b.pompisteData || {}) as any[];
                const liters = data.reduce((s: number, d: any) => s + (d.litersSold || 0), 0);
                const collected = data.reduce((s: number, d: any) => s + (d.totalCollected || 0), 0);
                const endDatePart = b.endDatetime?.split('T')[0];
                const displayDate = (endDatePart && endDatePart !== b.date) ? endDatePart : b.date;
                return (
                  <tr key={b.id}>
                    <td className="table-cell font-mono text-xs text-slate-500">{b.id.slice(0, 8)}</td>
                    <td className="table-cell font-black text-slate-800 whitespace-nowrap">{displayDate}</td>
                    <td className="table-cell">{b.shift}</td>
                    <td className="table-cell whitespace-nowrap text-slate-500">
                      {b.startTime && b.endTime ? `${b.startTime} → ${b.endTime}` : '—'}
                    </td>
                    <td className="table-cell">{brigadeChef?.name || 'Non assigné'}</td>
                    <td className="table-cell tabular-nums text-right">{pompisteCount}</td>
                    <td className="table-cell tabular-nums text-right">
                      {liters > 0 ? `${liters.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L` : '—'}
                    </td>
                    <td className="table-cell tabular-nums text-right font-bold text-emerald-600">
                      {collected > 0 ? collected.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' DZD' : '—'}
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-wrap gap-1">
                        <KitBadge tone={b.status === 'Clôturée' ? 'primary' : b.status === 'En attente' ? 'warning' : 'neutral'}>{b.status}</KitBadge>
                        {accounting?.status === 'completed' && <KitBadge tone="success">Comptabilisée</KitBadge>}
                      </div>
                    </td>
                    <td className="table-cell text-right">
                      <RowActions>
                        <ActionBtn icon={EyeIcon} tone="blue" title="Voir les détails" onClick={() => { setSelectedBrigade(b); setShowDetail(true); setDetailTab('info'); }} />
                        <ActionBtn icon={FileText} tone="slate" title="Fiche de brigade" onClick={() => { setSelectedBrigade(b); setShowFicheModal(true); }} />
                        {perm.modifier && <ActionBtn icon={Pencil} tone="amber" title="Modifier" onClick={() => { resetForm(); loadBrigadeIntoWizard(b); }} />}
                        {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => { setSelectedBrigade(b); setShowConfirmDelete(true); }} />}
                      </RowActions>
                    </td>
                  </tr>
                );
              })}
            </KitTable>
          ) : filteredBrigades.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredBrigades.map((b, index) => {
                const brigadeChef = brigadeChefs.find(c => c.id === b.chefId);
                const pompisteList = pompistes.filter(p => b.pompisteIds?.includes(p.id)) || [];
                const pompisteCount = pompisteList.length;
                
                const getShiftColor = (shift: string) => {
                  switch(shift) {
                    case 'Matin': return 'from-amber-50 to-orange-50';
                    case 'Soir': return 'from-orange-50 to-red-50';
                    case 'Nuit': return 'from-indigo-50 to-blue-50';
                    default: return 'from-slate-50 to-slate-100';
                  }
                };

                return (
                  <motion.div
                    key={b.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.06 }}
                    className="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-lg transition-all group relative overflow-hidden"
                  >
                    {/* Top accent — app blue/gold scheme */}
                    <div className="h-2 absolute top-0 left-0 right-0 bg-gradient-to-r from-blue-900 via-blue-700 to-yellow-400" />

                    <div className="p-5">
                      {/* Header with Brigade ID and Date */}
                      {(() => {
                        const accounting = brigadeAccountings.find(a => a.brigadeId === b.id);
                        const fmtTime = (iso?: string, fallback?: string) => {
                          if (iso) { const d = new Date(iso); if (!isNaN(d.getTime())) return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
                          return fallback || '';
                        };
                        const startStr = fmtTime(b.startDatetime, b.startTime);
                        const endStr = fmtTime(b.endDatetime, b.endTime);
                        const creator = accounting?.createdBy || (b.notes?.startsWith('Créé par:') ? b.notes.replace('Créé par:', '').trim() : '');
                        // Card shows a single date: the end date when the brigade spans
                        // two calendar days, otherwise the (identical) start date.
                        const endDatePart = b.endDatetime?.split('T')[0];
                        const displayDate = (endDatePart && endDatePart !== b.date) ? endDatePart : b.date;
                        return (
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">{b.id.slice(0, 8)}</p>
                          <p className="text-2xl font-black text-slate-800 italic">{displayDate}</p>
                          {(startStr || endStr) && (
                            <p className="text-[10px] font-bold text-slate-500 mt-0.5">🕐 {startStr} → {endStr}</p>
                          )}
                          {creator && <p className="text-[10px] font-bold text-blue-600 mt-0.5">Créé par: {creator}</p>}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {accounting?.status === 'completed' && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[9px] font-black rounded-full">✓ Comptabilisée</span>}
                            {accounting && accounting.totalDue > 0 && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-black rounded-full">{accounting.totalDue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</span>}
                          </div>
                        </div>

                        {/* Status badge + Three dots menu */}
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tighter whitespace-nowrap",
                              b.status === "Clôturée"
                                ? "bg-blue-900 text-yellow-400 border border-blue-700"
                                : b.status === "En attente"
                                ? "bg-amber-100 text-amber-900 border border-amber-300 font-black"
                                : "bg-slate-100 text-slate-500 border border-slate-200"
                            )}
                          >
                            {b.status}
                          </span>

                          <div className="relative inline-block">
                            <button
                              onClick={() => setActionMenuOpen(actionMenuOpen === b.id ? null : b.id)}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-300 group-hover:text-primary transition-all"
                              aria-label="Menu"
                            >
                              <MoreVertical className="w-5 h-5" />
                            </button>

                            <AnimatePresence>
                              {actionMenuOpen === b.id && (
                                <motion.div
                                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                                  transition={{ duration: 0.15 }}
                                  className="absolute right-0 mt-2 w-52 bg-white border border-slate-100 rounded-xl shadow-lg z-50 overflow-hidden"
                                >
                                  <div className="divide-y divide-slate-100">
                                    {perm.modifier && (
                                      <button
                                        onClick={() => { resetForm(); loadBrigadeIntoWizard(b); }}
                                        className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                                      >
                                        <Pencil className="w-4 h-4" /> Modifier
                                      </button>
                                    )}

                                    <button
                                      onClick={() => { setSelectedBrigade(b); setShowDetail(true); setDetailTab('info'); setActionMenuOpen(null); }}
                                      className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                                    >
                                      <EyeIcon className="w-4 h-4" /> Voir Détails
                                    </button>

                                    <button
                                      onClick={() => { setSelectedBrigade(b); setShowFicheModal(true); setActionMenuOpen(null); }}
                                      className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                                    >
                                      <FileText className="w-4 h-4" /> Fiche
                                    </button>

                                    {perm.supprimer && (
                                      <button
                                        onClick={() => { setSelectedBrigade(b); setShowConfirmDelete(true); setActionMenuOpen(null); }}
                                        className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                                      >
                                        <Trash2 className="w-4 h-4" /> Supprimer
                                      </button>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                        );
                      })()}

                      {/* Shift pill with time */}
                      {(() => {
                        const config = {
                          Matin: { icon: Sun, className: "text-amber-600 bg-amber-50 border-amber-200", label: "Matin" },
                          Soir: { icon: Sunset, className: "text-orange-600 bg-orange-50 border-orange-200", label: "Soir" },
                          Nuit: { icon: Moon, className: "text-indigo-600 bg-indigo-50 border-indigo-200", label: "Nuit" },
                        }[(b.shift as any) || 'Matin'] || { icon: Sun, className: "text-amber-600 bg-amber-50", label: b.shift };
                        const Icon = (config as any).icon as any;
                        return (
                          <div className="flex items-center gap-2 mb-4">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border",
                                (config as any).className
                              )}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              {(config as any).label}
                            </span>
                            {b.startTime && b.endTime && (
                              <span className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200">
                                🕐 {b.startTime}–{b.endTime}
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      {/* Chef Section */}
                      <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-2xl border border-blue-100">
                        <p className="text-[9px] font-black text-slate-500 uppercase mb-2 tracking-widest">👨‍💼 Chef de Brigade</p>
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 bg-blue-500 text-white rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 shadow-md">
                            {brigadeChef?.name ? brigadeChef.name[0] : '—'}
                          </div>
                          <div className="flex-1">
                            <p className="font-black text-slate-800 text-sm">{brigadeChef?.name || 'Non assigné'}</p>
                            <p className="text-[10px] text-slate-500 font-bold">{brigadeChef?.phone || 'N/A'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Pompistes Section */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">⛽ Pompistes ({pompisteCount})</p>
                        </div>
                        {pompisteList.length > 0 ? (
                          <div className="space-y-2">
                            {pompisteList.map(p => (
                              <div key={p.id} className="flex items-center gap-2 p-2.5 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-100 hover:shadow-sm transition-all">
                                <div className="w-8 h-8 bg-green-500 text-white rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0">
                                  {p.name[0]}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-black text-slate-800 truncate">{p.name}</p>
                                  <p className="text-[9px] text-slate-500">{p.phone || 'N/A'}</p>
                                </div>
                                {p.status === 'Actif' && <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full whitespace-nowrap">✓ Actif</span>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-3 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                            <p className="text-[10px] text-slate-400 font-bold">Aucun pompiste assigné</p>
                          </div>
                        )}
                      </div>

                      {/* Stats row for clôturée brigades */}
                      {b.status === 'Clôturée' && b.pompisteData && (
                        <div className="mt-4 grid grid-cols-3 gap-2 pt-4 border-t border-slate-100">
                          <div className="p-3 bg-gradient-to-b from-slate-50 to-slate-100 rounded-xl border border-slate-200">
                            <p className="text-[9px] font-black text-slate-500 uppercase">Agents</p>
                            <p className="text-lg font-black text-slate-700 mt-1">{Object.keys(b.pompisteData).length}</p>
                          </div>
                          <div className="p-3 bg-gradient-to-b from-blue-50 to-blue-100 rounded-xl border border-blue-200">
                            <p className="text-[9px] font-black text-blue-600 uppercase">Litres</p>
                            <p className="text-lg font-black text-blue-700 mt-1">{Number(Object.values(b.pompisteData).reduce((s: any, d: any) => s + d.litersSold, 0)).toFixed(0)}L</p>
                          </div>
                          <div className="p-3 bg-gradient-to-b from-green-50 to-green-100 rounded-xl border border-green-200">
                            <p className="text-[9px] font-black text-green-600 uppercase">Montant</p>
                            <p className="text-lg font-black text-green-700 mt-1">{((Object.values(b.pompisteData).reduce((s: any, d: any) => s + (d.totalCollected || 0), 0) as number) / 1000).toFixed(0)}K</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <div className="card-glass overflow-hidden shadow-xl border-slate-50">
              <EmptyState
                icon={Users}
                title={hasActiveFilters ? "Aucun résultat" : "Aucune brigade"}
                description={hasActiveFilters ? "Aucune brigade ne correspond aux filtres sélectionnés" : "L'historique est vide pour le moment"}
                {...(hasActiveFilters
                  ? { actionLabel: "✕ Effacer filtres", action: clearBrigadeFilters }
                  : (currentUserRole !== 'gerant' ? { actionLabel: "Ouvrir Brigade", action: () => { setEditingBrigade(null); resetForm(); setShowModal(true); } } : {}))}
              />
            </div>
          )}
        </div>
        );
      })()}

      {/* Edit Brigade Modal */}
      <AnimatePresence>
        {showEditModal && editingBrigade && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowEditModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            {/* Même géométrie que l'assistant : plus large sur un écran de PC,
                sans jamais déborder sur un téléphone. */}
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-3xl xl:max-w-5xl rounded-2xl sm:rounded-[2rem] relative z-10 overflow-hidden flex flex-col h-auto shadow-2xl border border-blue-200 max-h-[var(--modal-max-h)]">
              {/* Header - Blue gradient matching create modal */}
              <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white px-4 py-3.5 sm:px-6 sm:py-5 flex justify-between items-center gap-3 shrink-0">
                <div className="min-w-0">
                  <h3 className="font-black text-[11px] sm:text-sm uppercase tracking-widest truncate">✏️ Modifier Brigade</h3>
                  <p className="hidden sm:block text-[11px] text-blue-200 font-bold mt-1">Mise à jour des informations</p>
                </div>
                <button onClick={() => { setShowEditModal(false); setEditingBrigade(null); }} className="hover:bg-blue-700/50 p-2 rounded-lg transition-all shrink-0"><X className="w-5 h-5 sm:w-6 sm:h-6" /></button>
              </div>

              {/* Content */}
              <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 overflow-y-auto custom-scrollbar flex-1">
                {/* Step 1: Chef & Shift Selection */}
                <div className="space-y-4">
                  {/* Chef Selection */}
                  <div className="space-y-2 p-4 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border-2 border-blue-200">
                    <label className="text-[10px] font-black text-blue-900 uppercase tracking-widest pl-1">👨‍💼 Chef de Brigade</label>
                    <select 
                      className="input-field h-12 font-black italic border-2 border-blue-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40" 
                      value={chefId} 
                      onChange={e => setChefId(e.target.value)}
                    >
                      <option value="">Sélectionner un chef...</option>
                      {brigadeChefs.filter(c => c.status === 'Actif').map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Shift Type */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-blue-900 uppercase tracking-widest pl-1">⏰ Type de Shift</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['Matin', 'Soir', 'Nuit'].map((type: any) => (
                        <motion.button
                          key={type}
                          onClick={() => setShiftType(type)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className={cn("py-3 rounded-xl border-2 transition-all font-black text-xs uppercase",
                            shiftType === type
                              ? "border-yellow-400 bg-gradient-to-br from-blue-900/10 to-yellow-400/10 shadow-md"
                              : "border-slate-200 hover:border-yellow-300 bg-white hover:bg-slate-50"
                          )}
                        >
                          {type === 'Matin' && '🌅'} {type === 'Soir' && '🌆'} {type === 'Nuit' && '🌙'} {type}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Step 2: Date & Times */}
                <div className="space-y-4 pt-4 border-t border-slate-200">
                  {/* Date */}
                  <div className="space-y-2 p-4 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border-2 border-blue-200">
                    <label className="text-[10px] font-black text-blue-900 uppercase tracking-widest pl-1">📅 Date</label>
                    <input 
                      type="date" 
                      className="input-field h-12 font-black italic border-2 border-blue-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40" 
                      value={shiftDate}
                      onChange={e => setShiftDate(e.target.value)}
                    />
                  </div>

                  {/* Horaires */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="space-y-2 p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border-2 border-green-200">
                      <label className="text-[10px] font-black text-green-700 uppercase tracking-widest pl-1">🕐 Heure de Début</label>
                      <input 
                        type="time" 
                        className="input-field h-12 font-black italic border-2 border-green-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40" 
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2 p-4 bg-gradient-to-br from-red-50 to-pink-50 rounded-2xl border-2 border-red-200">
                      <label className="text-[10px] font-black text-red-700 uppercase tracking-widest pl-1">🕕 Heure de Fin</label>
                      <input 
                        type="time" 
                        className="input-field h-12 font-black italic border-2 border-red-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40" 
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Pompistes Selection */}
                {chefId && (
                  <div className="space-y-4 pt-4 border-t border-slate-200">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <label className="text-[10px] font-black text-blue-900 uppercase tracking-widest">👥 Pompistes de {brigadeChefs.find(c => c.id === chefId)?.name}</label>
                      <span className="text-xs font-black text-white bg-gradient-to-r from-blue-900 to-blue-800 px-3 py-1 rounded-full shrink-0">{selectedPompisteIds.length} sélectionné(s)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {(() => {
                        const chef = brigadeChefs.find(c => c.id === chefId);
                        const chefPompisteIds = chef?.pompisteIds || [];
                        const chefPompistes = pompistes.filter(p => chefPompisteIds.includes(p.id) && p.status === 'Actif');
                        
                        if (chefPompistes.length === 0) {
                          return (
                            <div className="sm:col-span-2 xl:col-span-3 p-4 text-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                              <p className="text-sm text-slate-400 italic">Aucun pompiste assigné</p>
                            </div>
                          );
                        }

                        return chefPompistes.map((p) => (
                          <motion.button
                            key={p.id}
                            onClick={() => setSelectedPompisteIds(prev => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                            whileHover={{ scale: 1.01 }}
                            className={cn(
                              "p-3 rounded-xl border-2 transition-all flex items-center justify-between",
                              selectedPompisteIds.includes(p.id)
                                ? "border-yellow-400 bg-gradient-to-br from-yellow-50 to-yellow-100 shadow-md"
                                : "border-slate-200 hover:border-yellow-300 bg-white hover:bg-yellow-50"
                            )}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-black text-xs text-white flex-shrink-0", selectedPompisteIds.includes(p.id) ? "bg-gradient-to-br from-yellow-500 to-yellow-600" : "bg-gradient-to-br from-slate-600 to-slate-700")}>
                                {p.name[0]}
                              </div>
                              <div className="text-left">
                                <p className={cn("text-xs font-black", selectedPompisteIds.includes(p.id) ? "text-yellow-900" : "text-slate-800")}>{p.name}</p>
                                <p className="text-[9px] text-slate-500">Piste: {p.trackId || 'N/A'}</p>
                              </div>
                            </div>
                            <div className={cn("w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0", selectedPompisteIds.includes(p.id) ? "bg-gradient-to-r from-yellow-400 to-yellow-500 border-yellow-500" : "border-slate-300 bg-white")}>
                              {selectedPompisteIds.includes(p.id) && <Check className="w-2 h-2 text-yellow-600" />}
                            </div>
                          </motion.button>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-slate-50 to-blue-50 border-t border-slate-200 flex gap-2 sm:gap-3 shrink-0">
                <button
                  onClick={() => { setShowEditModal(false); setEditingBrigade(null); }}
                  className="flex-[1] py-3 px-4 bg-white text-slate-700 rounded-xl font-black text-xs uppercase hover:bg-slate-100 transition-all border-2 border-slate-200 hover:border-slate-300"
                >
                  ✕ Annuler
                </button>
                <button
                  onClick={handleSaveEditBrigade}
                  className="flex-[2] bg-gradient-to-r from-blue-900 to-blue-800 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-xl py-3 transition-all transform hover:-translate-y-0.5 text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30 border border-blue-700"
                >
                  ✓ Enregistrer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Creation Modal */}
      <AnimatePresence>
        {showModal && (() => {
          const chef = brigadeChefs.find(c => c.id === chefId);
          const chefPompisteIds = chef?.pompisteIds || [];
          const chefPompistes = pompistes.filter(p => chefPompisteIds.includes(p.id) && p.status === 'Actif');
          const presentCount = chefPompisteIds.filter(pid => (pompistePresence[pid] || 'present') === 'present').length;
          const absentCount = chefPompisteIds.filter(pid => pompistePresence[pid] === 'absent').length;
          const anyAbsent = absentCount > 0;

          // Auto-fill from last brigade
          const lastBrigade = [...brigades]
            .filter(b => b.endTime)
            .sort((a, b) => new Date(b.endTimestamp || b.date).getTime() - new Date(a.endTimestamp || a.date).getTime())[0];

          // The chef de brigade is no longer selected: a brigade starts from the
          // pompistes and the pompes each of them holds.
          const STEPS = [
            { num: 1, label: 'Pompistes',    icon: Users },
            { num: 2, label: 'Pompes',       icon: WrenchIcon },
            { num: 3, label: 'Planning',     icon: Calendar },
            { num: 4, label: 'Départ',       icon: Database },
            { num: 5, label: 'Index fin',    icon: Droplets },
            { num: 6, label: 'Comptabilité', icon: DollarSign },
          ];

          // Pompes and pistolets are always walked from the first created to the
          // last, so the wizard reads in the same order as the "Pompes" screen.
          const orderedPumps = pumpsInCreationOrder(pumps);
          const orderedNozzlesOfPump = (pumpId: string) =>
            nozzlesInCreationOrder(pumpNozzles.filter(n => n.pumpId === pumpId));

          // A pompe may not be held by two pompistes at once.
          const pumpUsage: Record<string, number> = {};
          presentAssignments.forEach(a => pumpsOf(a.pompisteId).forEach(id => { pumpUsage[id] = (pumpUsage[id] || 0) + 1; }));
          const step2MissingPump = presentAssignments.some(a => pumpsOf(a.pompisteId).length === 0);
          const step2DuplicatePump = Object.values(pumpUsage).some(n => n > 1);
          const step2Valid = presentAssignments.length > 0 && !step2MissingPump && !step2DuplicatePump;

          // A brigade can be saved WITHOUT the cash each pompiste handed over: it
          // is then kept "En attente" until the amounts are entered.
          const anyPaymentFilled = presentAssignments.some(a => pompistePayments[a.pompisteId] !== undefined)
            || presentAssignments.some(a => (versements[a.pompisteId] || []).length > 0);
          const canGoNext = step === 1 ? presentAssignments.length > 0 :
                            step === 2 ? step2Valid :
                            step === 3 ? (!!startDate && !!endDate) :
                            step === 4 ? true :
                            step === 5 ? !hasStep5Errors : true;

          return (
            <div className="modal-shell z-[60]">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowModal(false); setEditingBrigade(null); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
              {/* L'assistant occupe toute la hauteur utile et s'élargit avec
                  l'écran : les six étapes n'ont plus à tenir dans une colonne
                  étroite sur un poste de bureau, et rien ne déborde sur mobile. */}
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-5xl xl:max-w-7xl rounded-2xl sm:rounded-[2rem] relative z-10 overflow-hidden flex flex-col h-[var(--modal-max-h)] shadow-2xl border border-slate-100">
                {/* Header — same navy/yellow identity as every other modal */}
                <div className="px-4 py-3.5 sm:px-6 sm:py-5 text-white flex justify-between items-center gap-3 shrink-0 border-b-2 border-[#FFB800]/55"
                  style={{ background: 'linear-gradient(120deg, #001233 0%, #001f5c 45%, #003087 100%)' }}>
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className="modal-title-icon"><Users className="w-4 h-4" /></div>
                    <div className="min-w-0">
                      <h3 className="font-black text-[11px] sm:text-sm uppercase tracking-widest truncate">{editingBrigade ? 'Modifier Brigade' : 'Nouvelle Brigade'}</h3>
                      <p className="hidden sm:block text-[11px] text-blue-200 font-bold mt-0.5 truncate">{editingBrigade ? `Édition de la brigade ${editingBrigade.id.slice(0, 8)}` : "Création complète d'une brigade clôturée"}</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowModal(false); setEditingBrigade(null); }} className="modal-close shrink-0"><X className="w-5 h-5" /></button>
                </div>

                {/* Progress Bar — sur mobile, six pastilles et six libellés ne
                    tenaient pas : l'étape en cours s'y annonce en toutes lettres
                    au-dessus d'une barre de progression. */}
                <div className="px-4 sm:px-8 pt-3 sm:pt-6 pb-3 sm:pb-4 border-b border-slate-100 shrink-0">
                  <div className="sm:hidden">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-black uppercase tracking-widest text-[#002d87] flex items-center gap-1.5">
                        {React.createElement(STEPS[step - 1]?.icon || Users, { className: 'w-3.5 h-3.5' })}
                        {STEPS[step - 1]?.label}
                      </p>
                      <span className="text-[10px] font-black text-slate-400">Étape {step} / {STEPS.length}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={false}
                        animate={{ width: `${(step / STEPS.length) * 100}%` }}
                        className="h-full rounded-full bg-gradient-to-r from-[#FFB800] to-[#e6a000]"
                      />
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center justify-between">
                    {STEPS.map((s, idx) => {
                      const Icon = s.icon;
                      const isActive = step === s.num;
                      const isCompleted = step > s.num;
                      return (
                        <React.Fragment key={s.num}>
                          <div className="flex flex-col items-center flex-1">
                            <motion.div
                              initial={false}
                              animate={{ scale: isActive ? 1.1 : 1 }}
                              className={cn("w-9 h-9 rounded-full flex items-center justify-center font-black text-xs mb-1.5 transition-all",
                                isActive || isCompleted
                                  ? "bg-gradient-to-br from-[#FFB800] to-[#e6a000] text-[#001f5c] shadow-lg shadow-[#FFB800]/40"
                                  : "bg-slate-100 text-slate-400")}
                            >
                              {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                            </motion.div>
                            <p className={cn("text-[9px] font-black text-center uppercase tracking-wider", isActive ? "text-[#002d87]" : "text-slate-400")}>{s.label}</p>
                          </div>
                          {idx < STEPS.length - 1 && (
                            <motion.div
                              initial={false}
                              animate={{ background: step > s.num ? '#FFB800' : '#E5E7EB' }}
                              className="h-1.5 flex-1 mx-2 mb-5 rounded-full"
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">

                  {/* STEP 1: Pompistes de la brigade */}
                  {step === 1 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black text-[#002d87] uppercase tracking-widest pl-1">
                          Pompistes travaillant sur cette brigade
                        </label>
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-[10px] font-black">
                          {presentAssignments.length} sélectionné(s)
                        </span>
                      </div>

                      {presentAssignments.length === 0 && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-700">
                          Sélectionnez au moins un pompiste pour continuer.
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {pompistes.filter(p => p.status === 'Actif').map(p => {
                          const on = wizPompisteIds.includes(p.id);
                          return (
                            <motion.button
                              key={p.id}
                              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                              onClick={() => setWizPompisteIds(prev => on ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                              className={cn("p-4 rounded-2xl border-2 transition-all text-left",
                                on ? "border-[#FFB800] bg-[#fff8e6] shadow-md" : "border-slate-200 hover:border-[#FFB800] bg-white")}
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn("w-11 h-11 rounded-full flex items-center justify-center font-black text-lg flex-shrink-0",
                                  on ? "bg-gradient-to-br from-[#FFB800] to-[#e6a000] text-[#001f5c]" : "bg-gradient-to-br from-[#001f5c] to-[#003087] text-[#FFB800]")}>
                                  {p.name[0]}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={cn("text-sm font-black truncate", on ? "text-[#002d87]" : "text-slate-800")}>{p.name}</p>
                                  <p className="text-[10px] text-slate-500">Tel: {p.phone || 'N/A'}</p>
                                  {on && (
                                    <p className="text-[10px] font-bold text-[#002d87] mt-0.5">
                                      {pumpsOf(p.id).length} pompe(s) affectée(s)
                                    </p>
                                  )}
                                </div>
                                {on && <CheckCircle className="w-5 h-5 text-[#e6a000] flex-shrink-0" />}
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>

                      {pompistes.filter(p => p.status === 'Actif').length === 0 && (
                        <div className="p-6 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                          <p className="text-sm text-slate-400 italic">Aucun pompiste actif</p>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* STEP 2: Pompes tenues par chaque pompiste (plusieurs possibles) */}
                  {step === 2 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                      <label className="text-[10px] font-black text-[#002d87] uppercase tracking-widest pl-1">
                        Pompes de chaque pompiste
                      </label>

                      {!step2Valid && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[11px] font-bold text-red-700">
                          {step2MissingPump
                            ? "Chaque pompiste doit tenir au moins une pompe."
                            : "Une même pompe ne peut pas etre tenue par deux pompistes."}
                        </div>
                      )}

                      <div className="space-y-3">
                        {wizPompisteIds.map(pid => {
                          const pompiste = pompistes.find(x => x.id === pid);
                          const mine = pumpsOf(pid);
                          const presence = pompistePresence[pid] || 'present';
                          const isAbsent = presence === 'absent';
                          return (
                            <div key={pid} className={cn("p-4 rounded-2xl border-2", isAbsent ? "border-red-200 bg-red-50/50 opacity-75" : "border-slate-200 bg-white")}>
                              <div className="flex items-center gap-3 mb-3">
                                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-black flex-shrink-0",
                                  isAbsent ? "bg-red-400 text-white" : "bg-gradient-to-br from-[#001f5c] to-[#003087] text-[#FFB800]")}>
                                  {pompiste?.name?.[0] || '?'}
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm font-black text-slate-800">{pompiste?.name || '—'}</p>
                                  <p className="text-[10px] text-slate-500">{mine.length} pompe(s) - {nozzlesOf(pid).length} pistolet(s)</p>
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={() => setPompistePresence(prev => ({ ...prev, [pid]: 'present' }))}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
                                      presence === 'present' ? "bg-green-500 text-white shadow-sm" : "bg-slate-100 text-slate-400 hover:bg-green-100")}>Présent</button>
                                  <button onClick={() => setPompistePresence(prev => ({ ...prev, [pid]: 'absent' }))}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
                                      presence === 'absent' ? "bg-red-500 text-white shadow-sm" : "bg-slate-100 text-slate-400 hover:bg-red-100")}>Absent</button>
                                </div>
                              </div>

                              {!isAbsent && (
                                <div>
                                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
                                    Pompes tenues (plusieurs possibles) — de la première créée à la dernière
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {orderedPumps.map(pump => {
                                      const on = mine.includes(pump.id);
                                      const takenByOther = !on && Object.keys(pompistePumps)
                                        .some(other => other !== pid && (pompistePumps[other] || []).includes(pump.id));
                                      const cuves = pumpTankIds(pump.id, pumpNozzles, pumps)
                                        .map(id => tanks.find(t => t.id === id)?.name).filter(Boolean).join(', ');
                                      return (
                                        <button
                                          key={pump.id}
                                          disabled={takenByOther}
                                          onClick={() => setPompistePumps(prev => ({
                                            ...prev,
                                            [pid]: on ? mine.filter(x => x !== pump.id) : [...mine, pump.id],
                                          }))}
                                          className={cn("px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all text-left",
                                            on ? "bg-[#001f5c] text-white border-[#001f5c] shadow-sm"
                                               : takenByOther ? "bg-slate-100 text-slate-300 border-slate-100 cursor-not-allowed"
                                               : "bg-white text-slate-600 border-slate-200 hover:border-[#003087]")}
                                          title={takenByOther ? "Déjà tenue par un autre pompiste" : undefined}
                                        >
                                          {pump.number} · {pump.name}
                                          <span className={cn("block text-[9px] font-medium", on ? "text-[#FFB800]" : "text-slate-400")}>
                                            {cuves || 'aucune cuve'}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {pumps.length === 0 && <p className="text-xs text-slate-400 italic">Aucune pompe configurée.</p>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 3: Planning — Start/End datetime */}
                  {step === 3 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                      {/* Start */}
                      <div className="space-y-3 p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border-2 border-green-200">
                        <label className="text-[10px] font-black text-green-800 uppercase tracking-widest pl-1">📅 Date de début</label>
                        <input type="date" className="input-field h-12 font-black italic border-2 border-green-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40" value={startDate} onChange={e => setStartDate(e.target.value)} />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] font-black text-green-700 uppercase tracking-widest pl-1 mb-1 block">Heure</label>
                            <select className="input-field h-12 font-black italic border-2 border-green-300" value={startHour} onChange={e => setStartHour(e.target.value)}>
                              {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map(h => <option key={h} value={h}>{h}h</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-black text-green-700 uppercase tracking-widest pl-1 mb-1 block">Minute</label>
                            <input type="number" min={0} max={59} className="input-field h-12 font-black italic border-2 border-green-300" value={startMinute} onChange={e => setStartMinute(e.target.value.padStart(2, '0'))} />
                          </div>
                        </div>
                      </div>

                      {/* End */}
                      <div className="space-y-3 p-4 bg-gradient-to-br from-red-50 to-pink-50 rounded-2xl border-2 border-red-200">
                        <label className="text-[10px] font-black text-red-800 uppercase tracking-widest pl-1">📅 Date de fin</label>
                        <input type="date" className="input-field h-12 font-black italic border-2 border-red-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] font-black text-red-700 uppercase tracking-widest pl-1 mb-1 block">Heure</label>
                            <select className="input-field h-12 font-black italic border-2 border-red-300" value={endHour} onChange={e => setEndHour(e.target.value)}>
                              {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map(h => <option key={h} value={h}>{h}h</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-black text-red-700 uppercase tracking-widest pl-1 mb-1 block">Minute</label>
                            <input type="number" min={0} max={59} className="input-field h-12 font-black italic border-2 border-red-300" value={endMinute} onChange={e => setEndMinute(e.target.value.padStart(2, '0'))} />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 4 « Départ » : niveaux et index de début (read-only) */}
                  {step === 4 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <div className="p-3 bg-[#eef3fc] rounded-xl border border-[#003087]/15 text-[11px] font-bold text-[#002d87]">
                        ℹ️ Ces valeurs sont issues du système. Elles seront utilisées comme référence de début de brigade.
                      </div>

                      {/* Section A — Tanks */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black text-[#002d87] uppercase tracking-widest">Niveaux de départ des cuves</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                        {tanks.map(t => {
                          const startLit = startTankLiters(t);
                          const pct = t.capacity > 0 ? Math.min(100, (startLit / t.capacity) * 100) : 0;
                          const isGpl = t.type === 'GPL';
                          return (
                            <div key={t.id} className="p-4 rounded-2xl border-2 border-slate-200 bg-white">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-black text-slate-800">{t.name}</p>
                                <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full uppercase", isGpl ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700")}>{t.type}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-[10px] mb-2">
                                {isGpl ? (
                                  <div className="bg-orange-50 p-2 rounded"><p className="text-orange-400 font-bold uppercase">Pourcentage</p><p className="font-black text-orange-700">{pct.toFixed(1)} %</p></div>
                                ) : (
                                  <div className="bg-slate-50 p-2 rounded"><p className="text-slate-400 font-bold uppercase">Degrés</p><p className="font-black text-slate-700">{startTankDegrees(t)}°</p></div>
                                )}
                                <div className="bg-slate-50 p-2 rounded"><p className="text-slate-400 font-bold uppercase">Litres</p><p className="font-black text-blue-700">{startLit.toLocaleString('fr-FR')} L</p></div>
                              </div>
                              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full", isGpl ? "bg-gradient-to-r from-orange-500 to-amber-400" : "bg-gradient-to-r from-blue-500 to-cyan-400")} style={{ width: `${pct}%` }} />
                              </div>
                              {isGpl && <p className="text-[9px] text-orange-500 font-bold mt-1">GPL mesuré en pourcentage de la capacité ({t.capacity.toLocaleString('fr-FR')} L)</p>}
                            </div>
                          );
                        })}
                        </div>
                        {tanks.length === 0 && (
                          <p className="text-xs text-slate-400 italic">Aucune cuve configurée.</p>
                        )}
                      </div>

                      {/* Section B — Index de début, pompe par pompe (ordre de création) */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black text-[#002d87] uppercase tracking-widest">
                          Index de départ des pistolets — de la première pompe créée à la dernière
                        </h4>
                        {orderedPumps.map((pump, pumpIdx) => {
                          const nozzles = orderedNozzlesOfPump(pump.id);
                          if (nozzles.length === 0) return null;
                          const cuves = pumpTankIds(pump.id, pumpNozzles, pumps)
                            .map(id => tanks.find(t => t.id === id)?.name).filter(Boolean).join(', ');
                          return (
                            <div key={pump.id} className="rounded-2xl border-2 border-slate-100 bg-slate-50/60 overflow-hidden">
                              <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white border-b border-slate-100">
                                <span className="w-6 h-6 rounded-lg bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-[10px] font-black shrink-0">
                                  {pumpIdx + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs font-black text-slate-800 truncate">Pompe {pump.number} · {pump.name}</p>
                                  <p className="text-[9px] text-slate-400 truncate">{cuves || 'aucune cuve'}</p>
                                </div>
                              </div>
                              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                                {nozzles.map(n => (
                                  <div key={n.id} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className={cn("w-2 h-2 rounded-full shrink-0", n.status === 'Actif' ? 'bg-green-400' : 'bg-slate-300')} />
                                      <div className="min-w-0">
                                        <p className="text-xs font-black text-slate-800 truncate">{n.name}</p>
                                        <p className="text-[9px] text-slate-400 truncate">{tanks.find(t => t.id === nozzleTankId(n, pumps))?.name || '—'}</p>
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0 pl-2">
                                      <p className="text-sm font-black text-[#002d87] tabular-nums">{startNozzleIdx(n).toLocaleString('fr-FR')}</p>
                                      <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase", n.status === 'Actif' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400')}>{n.status}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {pumpNozzles.length === 0 && (
                          <p className="text-xs text-slate-400 italic">Aucun pistolet configuré — ajoutez-les depuis « Pompes ».</p>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 5: Index de fin des pistolets */}
                  {step === 5 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <div className="p-4 bg-[#eef3fc] rounded-2xl border border-[#003087]/15 text-[11px] font-bold text-[#002d87]">
                        Saisissez les index de fin de chaque pistolet. La différence avec l'index de départ (volume débité en litres) est calculée en temps réel sur la même interface.
                        Appuyez sur <span className="mx-1 px-1.5 py-0.5 bg-white border border-[#003087]/20 rounded font-black">Entrée</span> pour passer au pistolet suivant.
                      </div>

                      {/* Une brigade ANCIENNE rouverte ne déplace plus les compteurs des
                          pistolets : ils appartiennent à la dernière brigade. On le dit
                          ici, là où l'index se saisit — voir `lib/nozzleIndexes.ts`. */}
                      {editingBrigade && pumpNozzles.some(n => !ownsNozzleIndex(brigades, editingBrigade.id, n.id)) && (
                        <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-300 text-[11px] font-bold text-amber-900 flex items-start gap-2.5">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>
                            Cette brigade n'est pas la dernière. Ses index restent enregistrés sur
                            <b> sa propre fiche</b>, mais les compteurs des pistolets — ceux qui servent
                            de départ à la prochaine brigade — <b>ne bougeront pas</b> : ils appartiennent
                            à la dernière brigade relevée.
                          </span>
                        </div>
                      )}

                      <div className="space-y-4">
                        {(() => {
                          const ordered: string[] = [];
                          const groups = orderedPumps.map(pump => {
                            const list = orderedNozzlesOfPump(pump.id).filter(n => n.status === 'Actif');
                            list.forEach(n => ordered.push(n.id));
                            return { pump, list };
                          }).filter(g => g.list.length > 0);

                          const knownPumpIds = new Set(pumps.map(p => p.id));
                          const orphans = nozzlesInCreationOrder(
                            pumpNozzles.filter(n => n.status === 'Actif' && !knownPumpIds.has(n.pumpId)));
                          orphans.forEach(n => ordered.push(n.id));

                          const focusNext = (nozzleId: string) => {
                            const idx = ordered.indexOf(nozzleId);
                            const nextId = ordered[idx + 1];
                            if (!nextId) return;
                            const el = document.getElementById(`nozzle-idx-${nextId}`) as HTMLInputElement | null;
                            el?.focus();
                            el?.select();
                          };

                          const renderNozzle = (n: typeof pumpNozzles[number]) => {
                            const err = nozzleEndError(n.id);
                            const val = wizEndNozzleIndices[n.id];
                            const startIdx = startNozzleIdx(n);
                            const tank = tanks.find(t => t.id === nozzleTankId(n, pumps));
                            const tankName = tank?.name;
                            const fuelType = tank?.type;
                            const hasValue = typeof val === 'number' && !isNaN(val);
                            const diff = hasValue ? val - startIdx : 0;

                            return (
                              <div
                                key={n.id}
                                className={cn(
                                  "p-4 bg-white rounded-2xl border-2 transition-all shadow-sm",
                                  err
                                    ? "border-red-400 bg-red-50/30"
                                    : hasValue && diff >= 0
                                    ? "border-blue-200 hover:border-blue-300"
                                    : "border-slate-200 hover:border-slate-300"
                                )}
                              >
                                {/* Pistolet Name & Tank/Fuel Header */}
                                <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-100">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#001f5c] to-[#003087] text-[#FFB800] flex items-center justify-center font-black text-xs shrink-0 shadow-sm">
                                      <Droplets className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                      <h5 className="text-xs font-black text-slate-800 truncate" title={n.name}>
                                        Pistolet: {n.name}
                                      </h5>
                                      {tankName && (
                                        <p className="text-[10px] text-slate-500 font-bold truncate">
                                          Cuve: {tankName}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  {fuelType && (
                                    <span className="px-2.5 py-1 bg-blue-50 text-blue-900 border border-blue-200 rounded-lg text-[9px] font-black uppercase tracking-wider shrink-0">
                                      {fuelType}
                                    </span>
                                  )}
                                </div>

                                {/* Three Column Row: Index Départ, Index Fin, Différence */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                                  {/* Index Départ */}
                                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">
                                      Index Départ
                                    </span>
                                    <span className="text-sm font-black text-slate-700 tabular-nums">
                                      {startIdx.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>

                                  {/* Index Fin Input */}
                                  <div>
                                    <label className="text-[9px] font-black text-[#002d87] uppercase tracking-widest block mb-0.5">
                                      Index Fin
                                    </label>
                                    <input
                                      id={`nozzle-idx-${n.id}`}
                                      type="number"
                                      step="0.01"
                                      min={startIdx}
                                      placeholder="Index fin..."
                                      className={cn(
                                        "w-full input-field h-10 font-black text-right transition-all text-sm",
                                        err
                                          ? "border-red-400 text-red-600 bg-red-50 focus:ring-red-200"
                                          : "border-blue-300 focus:border-[#FFB800] focus:ring-2 focus:ring-[#FFB800]/40"
                                      )}
                                      value={val ?? ''}
                                      onChange={e => setWizEndNozzleIndices(prev => ({ ...prev, [n.id]: e.target.value === '' ? undefined as any : parseFloat(e.target.value) }))}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNext(n.id); } }}
                                    />
                                  </div>

                                  {/* Différence (Fin - Départ) */}
                                  <div className={cn(
                                    "p-2.5 rounded-xl border transition-all flex flex-col justify-center",
                                    err
                                      ? "bg-red-100 border-red-300 text-red-800"
                                      : hasValue && diff >= 0
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                      : "bg-slate-50 border-slate-200 text-slate-400"
                                  )}>
                                    <span className="text-[9px] font-black uppercase tracking-widest block mb-0.5">
                                      Différence (Litres)
                                    </span>
                                    <span className="text-sm font-black tabular-nums">
                                      {hasValue ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L` : '0.00 L'}
                                    </span>
                                  </div>
                                </div>

                                {/* Error message */}
                                <AnimatePresence>
                                  {err && (
                                    <motion.p
                                      initial={{ opacity: 0, height: 0, x: -8 }}
                                      animate={{ opacity: 1, height: 'auto', x: [-8, 4, -2, 0] }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.3 }}
                                      className="text-[10px] text-red-600 font-bold mt-2 overflow-hidden flex items-center gap-1"
                                    >
                                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                      L'index de fin ne peut pas être inférieur à l'index de départ ({startIdx.toLocaleString('fr-FR')})
                                    </motion.p>
                                  )}
                                </AnimatePresence>
                              </div>
                            );
                          };

                          if (groups.length === 0 && orphans.length === 0) {
                            return (
                              <div className="p-6 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                                <p className="text-sm text-slate-400 italic">Aucun pistolet actif — configurez-les depuis « Pompes ».</p>
                              </div>
                            );
                          }

                          return (
                            <>
                              {groups.map(({ pump, list }, pumpIdx) => {
                                const filled = list.filter(n => typeof wizEndNozzleIndices[n.id] === 'number').length;
                                const cuves = pumpTankIds(pump.id, pumpNozzles, pumps)
                                  .map(id => tanks.find(t => t.id === id)?.name).filter(Boolean).join(', ');
                                return (
                                  <div key={pump.id} className="rounded-2xl border-2 border-slate-100 bg-slate-50/60 overflow-hidden">
                                    <div className="flex items-center gap-2.5 px-4 py-3 bg-white border-b border-slate-100">
                                      <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0">
                                        {pumpIdx + 1}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-black text-slate-800 truncate">Pompe {pump.number} · {pump.name}</p>
                                        <p className="text-[10px] text-slate-400 font-bold truncate">{cuves || 'aucune cuve'}</p>
                                      </div>
                                      <span className={cn("text-[10px] font-black px-2.5 py-1 rounded-full shrink-0",
                                        filled === list.length ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                                        {filled}/{list.length} renseigné(s)
                                      </span>
                                    </div>
                                    <div className="p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-2 gap-3">{list.map(renderNozzle)}</div>
                                  </div>
                                );
                              })}
                              {orphans.length > 0 && (
                                <div className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50/50 space-y-3">
                                  <p className="text-[10px] font-black text-amber-700 uppercase">Pistolets sans pompe — à corriger dans « Pompes »</p>
                                  <div className="space-y-3">{orphans.map(renderNozzle)}</div>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 6: Comptabilité */}
                  {step === 6 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      {/* SUB-SECTION A: Résumé des ventes par piste */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-black text-[#002d87] uppercase tracking-widest">Résumé des ventes par piste</h4>
                        <div className="overflow-x-auto rounded-2xl border-2 border-slate-100">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] font-black">
                              <tr>
                                <th className="px-3 py-2">Pompiste</th><th className="px-3 py-2">Piste</th><th className="px-3 py-2">Type</th>
                                <th className="px-3 py-2 text-right">Litres</th><th className="px-3 py-2 text-right">Prix/L</th><th className="px-3 py-2 text-right">Théorique</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {pompisteSales.map(s => (
                                <tr key={s.pompisteId} className="font-bold text-slate-700">
                                  <td className="px-3 py-2">{s.name}</td>
                                  <td className="px-3 py-2">{s.trackName}</td>
                                  <td className="px-3 py-2">{s.fuelType}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{s.litersSold.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{s.mixedFuel ? <span title={Object.entries(s.byFuel).map(([f, v]: [string, any]) => `${f}: ${v.price}`).join(' · ')} className="text-purple-700">Mixte</span> : s.pricePerLiter.toLocaleString('fr-FR')}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-blue-700">{s.theoretical.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
                                </tr>
                              ))}
                              <tr className="bg-[#eef3fc] font-black text-[#002d87]">
                                <td className="px-3 py-2" colSpan={5}>TOTAL</td>
                                <td className="px-3 py-2 text-right tabular-nums">{pompisteSales.reduce((s, x) => s + x.theoretical, 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* SUB-SECTION B: Encaissements par pompiste */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black text-[#002d87] uppercase tracking-widest">Saisie des encaissements par pompiste</h4>
                        {pompisteSales.map(s => {
                          const myVersements = versements[s.pompisteId] || [];
                          const versedTotal = myVersements.reduce((sum, v) => sum + (v.amount || 0), 0);
                          const cash = (pompistePayments[s.pompisteId] ?? 0) + versedTotal;
                          const justifs = pompisteJustifications[s.pompisteId] || [];
                          // La dernière justification ajoutée s'affiche EN HAUT :
                          // en enfilant TAG, TPE puis crédit client, la ligne qui
                          // vient d'apparaître finissait sous toutes les autres, et
                          // il fallait dérouler pour saisir son montant. L'ordre
                          // enregistré, lui, ne change pas.
                          const justifsNewestFirst = [...justifs].reverse();
                          const justifTotal = justifs.reduce((sum, j) => sum + (j.amount || 0), 0);
                          const ecartRestant = s.theoretical - cash - justifTotal;
                          const addVersement = () => setVersements(prev => ({
                            ...prev,
                            [s.pompisteId]: [...(prev[s.pompisteId] || []), {
                              id: newId(), amount: 0,
                              // Horodate a la minute pres.
                              at: new Date().toISOString().slice(0, 16),
                            }],
                          }));
                          const setVersement = (vid: string, patch: Partial<{ amount: number; at: string; notes: string }>) =>
                            setVersements(prev => ({
                              ...prev,
                              [s.pompisteId]: (prev[s.pompisteId] || []).map(v => v.id === vid ? { ...v, ...patch } : v),
                            }));
                          const rmVersement = (vid: string) => setVersements(prev => ({
                            ...prev,
                            [s.pompisteId]: (prev[s.pompisteId] || []).filter(v => v.id !== vid),
                          }));
                          const searchVal = justifClientSearch[s.pompisteId] || '';
                          const addJustif = (j: any) => setPompisteJustifications(prev => ({ ...prev, [s.pompisteId]: [...(prev[s.pompisteId] || []), j] }));
                          const removeJustif = (jid: string) => setPompisteJustifications(prev => ({ ...prev, [s.pompisteId]: (prev[s.pompisteId] || []).filter(x => x.id !== jid) }));
                          // ── La dépense en cours de saisie ────────────────
                          const draft = expenseDraft[s.pompisteId] || { name: '', category: '', amount: '' };
                          const patchDraft = (changes: Partial<typeof draft>) =>
                            setExpenseDraft(prev => ({ ...prev, [s.pompisteId]: { ...draft, ...changes } }));
                          const draftAmount = parseFloat(draft.amount) || 0;
                          const canAddExpense = draft.name.trim().length > 0 && draftAmount > 0;
                          const addExpenseJustif = () => {
                            if (!canAddExpense) return;
                            addJustif({
                              id: newId(), type: 'EXPENSE',
                              expenseName: draft.name.trim(),
                              expenseCategory: draft.category || undefined,
                              description: '', liters: 0, amount: draftAmount,
                              byLiters: false, fuelType: s.primaryFuel,
                            });
                            setExpenseDraft(prev => ({ ...prev, [s.pompisteId]: { name: '', category: '', amount: '' } }));
                            setShowNewClientForm(null);
                          };
                          return (
                            <div key={s.pompisteId} className="p-3 sm:p-4 rounded-2xl border-2 border-slate-200 bg-white space-y-3">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-8 h-8 rounded-lg bg-[#001f5c] text-[#FFB800] flex items-center justify-center font-black text-xs shrink-0">{s.name[0]}</div>
                                  <p className="text-sm font-black text-slate-800 truncate">{s.name}</p>
                                </div>
                                <p className="text-[10px] font-black text-blue-700">Théorique: {s.theoretical.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</p>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                  <label className="text-[9px] font-black text-slate-500 uppercase mb-1 block">Espèces remises (optionnel)</label>
                                  <input type="number" placeholder="Vide = brigade en attente"
                                    className="input-field h-10 font-black"
                                    value={pompistePayments[s.pompisteId] ?? ''}
                                    onChange={e => setPompistePayments(prev => {
                                      const next = { ...prev };
                                      if (e.target.value === '') delete next[s.pompisteId];
                                      else next[s.pompisteId] = parseFloat(e.target.value) || 0;
                                      return next;
                                    })} />
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-slate-500 uppercase mb-1 block">Total versements</label>
                                  <div className="h-10 flex items-center px-3 rounded-xl bg-emerald-50 text-emerald-700 font-black text-sm">
                                    {versedTotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD
                                  </div>
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-slate-500 uppercase mb-1 block">Écart</label>
                                  <div className={cn("h-10 flex items-center px-3 rounded-xl font-black text-sm", ecartRestant > 0.01 ? "bg-red-50 text-red-600" : ecartRestant < -0.01 ? "bg-green-50 text-green-600" : "bg-slate-50 text-slate-500")}>{ecartRestant.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</div>
                                </div>
                              </div>

                              {/* Versements espèce — plusieurs par pompiste, horodatés à la minute.
                                  Ils s'ajoutent aux espèces remises et justifient d'autant l'écart. */}
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Versements espèce</p>
                                  <button onClick={addVersement}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700">
                                    + Versement
                                  </button>
                                </div>
                                {myVersements.length === 0 ? (
                                  <p className="text-[10px] text-emerald-700/70 italic">Aucun versement — l'écart restera à justifier.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {myVersements.map(v => (
                                      // Quatre champs sur une ligne de 12 colonnes devenaient
                                      // illisibles sur un téléphone : ils passent à la ligne
                                      // d'eux-mêmes tant que la place manque.
                                      <div key={v.id} className="flex flex-wrap items-center gap-2">
                                        <input type="number" placeholder="Montant"
                                          className="input-field h-9 font-black text-right w-28 shrink-0"
                                          value={v.amount || ''}
                                          onChange={e => setVersement(v.id, { amount: parseFloat(e.target.value) || 0 })} />
                                        <input type="datetime-local"
                                          className="input-field h-9 font-bold text-xs flex-1 min-w-[10rem]"
                                          value={v.at}
                                          onChange={e => setVersement(v.id, { at: e.target.value })} />
                                        <input placeholder="Note (optionnel)"
                                          className="input-field h-9 text-xs flex-1 min-w-[8rem]"
                                          value={v.notes || ''}
                                          onChange={e => setVersement(v.id, { notes: e.target.value })} />
                                        <button onClick={() => rmVersement(v.id)} title="Retirer ce versement"
                                          className="h-9 w-9 shrink-0 rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center">
                                          <X className="w-4 h-4" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Justification buttons */}
                              <div className="flex flex-wrap gap-2">
                                {/* TAG comme TPE : l'argent justifié ARRIVE EN BANQUE. Les deux
                                    naissent donc avec un compte (le premier de la liste), que la
                                    fiche ci-dessous laisse changer à tout moment. Un TAG n'en avait
                                    aucun : son montant comptait comme encaissé dans le rapport
                                    Carburant sans qu'un seul dinar n'entre sur un compte. */}
                                {bankAccounts.length === 0 ? (
                                  <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-[10px] font-black uppercase"
                                    title="Créez un compte bancaire dans Finance → Comptes Bancaires">
                                    TPE / TAG — aucun compte bancaire
                                  </span>
                                ) : (<>
                                  <button onClick={() => addJustif({ id: newId(), type: 'TAG', description: '', liters: 0, amount: 0, byLiters: false, fuelType: s.primaryFuel, bankAccountId: bankAccounts[0].id })}
                                    className="px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700 text-[10px] font-black uppercase hover:bg-purple-200">+ TAG</button>
                                  {bankAccounts.map(acc => (
                                    <button key={acc.id}
                                      onClick={() => addJustif({ id: newId(), type: 'TPE', description: 'TPE ' + acc.name, liters: 0, amount: 0, byLiters: false, fuelType: s.primaryFuel, bankAccountId: acc.id })}
                                      className="px-3 py-1.5 rounded-lg bg-cyan-100 text-cyan-700 text-[10px] font-black uppercase hover:bg-cyan-200">
                                      + TPE {acc.name}
                                    </button>
                                  ))}
                                </>)}
                                <button onClick={() => setShowNewClientForm(showNewClientForm === `credit-${s.pompisteId}` ? null : `credit-${s.pompisteId}`)} className="px-3 py-1.5 rounded-lg bg-orange-100 text-orange-700 text-[10px] font-black uppercase hover:bg-orange-200">+ Crédit Client</button>
                                {/* L'avance client a laissé la place à la DÉPENSE : le
                                    gérant ne justifiait plus sur l'argent déjà versé
                                    d'un client, mais sur ce que le pompiste avait payé
                                    de sa poche de brigade. La saisie reprend celle de
                                    l'écran Dépenses — nom, catégorie, montant. */}
                                <button onClick={() => setShowNewClientForm(showNewClientForm === `expense-${s.pompisteId}` ? null : `expense-${s.pompisteId}`)} className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase hover:bg-emerald-200">+ Dépense</button>
                              </div>

                              {/* ── Nouvelle dépense ─────────────────────────────────
                                  La MÊME saisie que l'écran Dépenses : un nom, une
                                  catégorie (facultative, prise dans les réglages) et
                                  un montant. Une fois ajoutée, elle justifie le reste
                                  comme les autres pièces — et devient une vraie
                                  dépense du Carburant à l'enregistrement. */}
                              {showNewClientForm === `expense-${s.pompisteId}` && (
                                <div className="p-3 rounded-xl border-2 border-emerald-100 bg-emerald-50/60 space-y-2">
                                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Nouvelle dépense</p>
                                  <div>
                                    <label className="text-[9px] font-black text-slate-500 uppercase mb-1 block">Nom de la dépense *</label>
                                    <input autoFocus placeholder="Ex: Achat d'eau, réparation, pourboire…"
                                      value={draft.name}
                                      onChange={e => patchDraft({ name: e.target.value })}
                                      onKeyDown={e => { if (e.key === 'Enter') addExpenseJustif(); }}
                                      className="w-full input-field h-9 text-xs font-bold" />
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[9px] font-black text-slate-500 uppercase mb-1 block">Catégorie (optionnel)</label>
                                      <div className="flex gap-1.5">
                                        <select value={draft.category}
                                          onChange={e => patchDraft({ category: e.target.value })}
                                          className="flex-1 input-field h-9 text-xs font-bold">
                                          <option value="">— Aucune —</option>
                                          {(settings.expenseCategories || []).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <button type="button" title="Nouvelle catégorie"
                                          onClick={() => {
                                            const cat = window.prompt('Nom de la nouvelle catégorie :');
                                            if (!cat || !cat.trim()) return;
                                            const name = cat.trim();
                                            if (!(settings.expenseCategories || []).includes(name)) {
                                              dispatch({ type: 'SET_SETTINGS', payload: { ...settings, expenseCategories: [...(settings.expenseCategories || []), name] } });
                                            }
                                            patchDraft({ category: name });
                                          }}
                                          className="h-9 w-9 shrink-0 rounded-lg bg-white border border-emerald-200 text-emerald-700 font-black">+</button>
                                      </div>
                                    </div>
                                    <div>
                                      <label className="text-[9px] font-black text-slate-500 uppercase mb-1 block">Montant (DA) *</label>
                                      <input type="number" placeholder="0"
                                        value={draft.amount}
                                        onChange={e => patchDraft({ amount: e.target.value })}
                                        onKeyDown={e => { if (e.key === 'Enter') addExpenseJustif(); }}
                                        className="w-full input-field h-9 text-xs font-bold" />
                                    </div>
                                  </div>
                                  <div className="flex gap-2 pt-0.5">
                                    <button onClick={() => { setShowNewClientForm(null); }}
                                      className="flex-1 py-2 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500">Annuler</button>
                                    <button onClick={addExpenseJustif} disabled={!canAddExpense}
                                      className="flex-1 py-2 rounded-lg bg-emerald-600 disabled:opacity-40 text-white text-[10px] font-black uppercase">Ajouter la dépense</button>
                                  </div>
                                  <p className="text-[9px] font-bold text-emerald-700/70">
                                    Elle justifie l'écart comme un bon, et sera enregistrée dans Dépenses (Carburant) avec cette brigade.
                                  </p>
                                </div>
                              )}

                              {/* Recherche du client d'un CRÉDIT. L'avance client
                                  ne se saisit plus ici — voir le bouton Dépense. */}
                              {showNewClientForm === `credit-${s.pompisteId}` && (() => {
                                const matches = clients
                                  .filter(c => matchesSearch(searchVal, c.name, c.phone))
                                  .slice(0, 5);
                                return (
                                  <div className="p-3 rounded-xl border-2 border-slate-100 bg-slate-50 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <Search className="w-4 h-4 text-slate-400" />
                                      <input placeholder="Rechercher client (nom / téléphone)" value={searchVal} onChange={e => setJustifClientSearch(prev => ({ ...prev, [s.pompisteId]: e.target.value }))} className="flex-1 input-field h-9 text-xs font-bold" />
                                    </div>
                                    {matches.map(c => {
                                      // Les mêmes chiffres que la fiche du client, au dinar près.
                                      const st = standingOf(c);
                                      return (
                                      <button key={c.id} onClick={() => {
                                        addJustif({ id: newId(), type: 'CLIENT_CREDIT', description: '', liters: 0, amount: 0, byLiters: false, fuelType: s.primaryFuel, clientId: c.id, clientName: c.name });
                                        setShowNewClientForm(null);
                                        setJustifClientSearch(prev => ({ ...prev, [s.pompisteId]: '' }));
                                      }} className="w-full text-left p-2 bg-white rounded-lg border border-slate-100 hover:border-blue-300 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="text-xs font-black text-slate-800 truncate">{c.name}</p>
                                          <p className="text-[9px] text-slate-400">{c.phone || 'N/A'}</p>
                                        </div>
                                        <div className="text-right shrink-0 leading-tight">
                                          <p className={cn("text-[9px] font-black", st.debt > 0 ? "text-red-500" : "text-slate-400")}>Dette {money0(st.debt)}</p>
                                          {Number.isFinite(st.restCredit) && (
                                            <p className={cn("text-[8px] font-bold", st.restCredit < 0 ? "text-red-500" : "text-slate-400")}>
                                              {st.restCredit < 0 ? `Hors plafond ${money0(-st.restCredit)}` : `Reste crédit ${money0(st.restCredit)}`}
                                            </p>
                                          )}
                                          {st.advance > 0 && <p className="text-[8px] font-bold text-emerald-600">Avance {money0(st.advance)}</p>}
                                        </div>
                                      </button>
                                      );
                                    })}
                                    {matches.length === 0 && <p className="text-[10px] text-slate-400 font-bold text-center py-1">Aucun client</p>}
                                    <button onClick={() => { setNewClientDraft({ name: searchVal, phone: '', type: 'PARTICULIER', paymentMode: 'CREDIT' }); setShowNewClientForm(`new-credit-${s.pompisteId}`); }} className="w-full p-2 rounded-lg border-2 border-dashed border-blue-200 text-blue-600 text-[10px] font-black uppercase hover:bg-blue-50">+ Nouveau client</button>
                                  </div>
                                );
                              })()}

                              {/* New client mini form */}
                              {showNewClientForm === `new-credit-${s.pompisteId}` && (() => {
                                return (
                                  <div className="p-3 rounded-xl border-2 border-blue-100 bg-blue-50/50 space-y-2">
                                    <p className="text-[10px] font-black text-[#002d87] uppercase">Nouveau client</p>
                                    <input placeholder="Nom" value={newClientDraft.name} onChange={e => setNewClientDraft(d => ({ ...d, name: e.target.value }))} className="w-full input-field h-9 text-xs font-bold" />
                                    <input placeholder="Téléphone" value={newClientDraft.phone} onChange={e => setNewClientDraft(d => ({ ...d, phone: e.target.value }))} className="w-full input-field h-9 text-xs font-bold" />
                                    <div className="grid grid-cols-2 gap-2">
                                      <select value={newClientDraft.type} onChange={e => setNewClientDraft(d => ({ ...d, type: e.target.value as Client['type'] }))} className="input-field h-9 text-xs font-bold">
                                        <option value="PARTICULIER">Particulier</option><option value="ENTREPRISE">Entreprise</option><option value="GOUVERNEMENT">Gouvernement</option>
                                      </select>
                                      <select value={newClientDraft.paymentMode} onChange={e => setNewClientDraft(d => ({ ...d, paymentMode: e.target.value as Client['paymentMode'] }))} className="input-field h-9 text-xs font-bold">
                                        <option value="CASH">Cash</option><option value="CREDIT">Crédit</option><option value="ADVANCE">Avance</option>
                                      </select>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={() => setShowNewClientForm(null)} className="flex-1 py-2 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500">Annuler</button>
                                      <button onClick={() => {
                                        if (!newClientDraft.name.trim()) return;
                                        const nc: Client = { id: newId(), name: newClientDraft.name.trim(), phone: newClientDraft.phone, balance: 0, debt: 0, creditLimit: 0, paymentDelay: 0, type: newClientDraft.type, paymentMode: newClientDraft.paymentMode, advanceBalance: 0, transactionHistory: [] };
                                        dispatch({ type: 'ADD_CLIENT', payload: nc });
                                        addJustif({ id: newId(), type: 'CLIENT_CREDIT', description: '', liters: 0, amount: 0, byLiters: false, fuelType: s.primaryFuel, clientId: nc.id, clientName: nc.name });
                                        setShowNewClientForm(null);
                                      }} className="flex-1 py-2 rounded-lg bg-[#001f5c] text-white text-[10px] font-black uppercase">Créer & ajouter</button>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Justification list — de la plus récente à la plus ancienne */}
                              {justifs.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between px-0.5">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                      Justifications ({justifs.length})
                                    </p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase">La plus récente en premier</p>
                                  </div>
                                  {justifsNewestFirst.map((j, jIdx) => {
                                    const patch = (changes: Partial<typeof j>) => setPompisteJustifications(prev => ({ ...prev, [s.pompisteId]: (prev[s.pompisteId] || []).map(x => x.id === j.id ? { ...x, ...changes } : x) }));
                                    const isNewest = jIdx === 0;
                                    return (
                                    <div key={j.id} className={cn("p-3 rounded-xl border space-y-2 transition-all",
                                      isNewest ? "bg-[#fff8e6] border-[#FFB800]/60 shadow-sm"
                                        : j.type === 'EXPENSE' ? "bg-emerald-50/60 border-emerald-100"
                                        : "bg-slate-50 border-slate-100")}>
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 uppercase shrink-0">
                                            {j.type === 'CLIENT_CREDIT' ? 'CRÉDIT CLIENT' : j.type === 'CLIENT_AVANCE' ? 'AVANCE CLIENT' : j.type === 'EXPENSE' ? '🧾 DÉPENSE' : j.type}
                                          </span>
                                          {isNewest && (
                                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-[#001f5c] text-[#FFB800] uppercase shrink-0">Nouveau</span>
                                          )}
                                        </div>
                                        <button onClick={() => removeJustif(j.id)} className="text-red-400 hover:text-red-600 shrink-0"><X className="w-3.5 h-3.5" /></button>
                                      </div>

                                      {/* Le compte du client, en toutes lettres. La ligne
                                          n'affichait qu'un nombre entre parenthèses — sans
                                          dire s'il s'agissait d'une dette, d'une avance ou
                                          d'un reste de plafond — et ce nombre venait du
                                          compteur de la fiche, pas de ses pièces. */}
                                      {(j.type === 'CLIENT_CREDIT' || j.type === 'CLIENT_AVANCE') && (() => {
                                        const c = clients.find(x => x.id === j.clientId);
                                        const st = c ? standingOf(c) : null;
                                        return (
                                          <div className="min-h-8 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 bg-white rounded-lg text-xs font-black text-slate-700 border border-slate-100">
                                            <span className="truncate">👤 {j.clientName}</span>
                                            {st && (j.type === 'CLIENT_AVANCE' ? (
                                              <span className="text-[9px] font-black text-emerald-600">Avance {money0(st.advance)}</span>
                                            ) : (
                                              <span className={cn("text-[9px] font-black", st.debt > 0 ? "text-red-500" : "text-slate-400")}>Dette {money0(st.debt)}</span>
                                            ))}
                                          </div>
                                        );
                                      })()}

                                      {/* La dépense : son nom et sa catégorie, exactement
                                          comme sur l'écran Dépenses — c'est sous ce nom
                                          qu'elle y sera enregistrée. */}
                                      {j.type === 'EXPENSE' && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Nom de la dépense</label>
                                            <input value={j.expenseName || ''}
                                              onChange={e => patch({ expenseName: e.target.value })}
                                              placeholder="Nom de la dépense"
                                              className={cn("input-field h-9 text-xs font-bold w-full",
                                                !(j.expenseName || '').trim() && "border-red-300 text-red-600")} />
                                          </div>
                                          <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Catégorie (optionnel)</label>
                                            <select value={j.expenseCategory || ''}
                                              onChange={e => patch({ expenseCategory: e.target.value || undefined })}
                                              className="input-field h-9 text-xs font-bold w-full">
                                              <option value="">— Aucune —</option>
                                              {(settings.expenseCategories || []).map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                          </div>
                                        </div>
                                      )}

                                      {/* Compte crédité (TAG / TPE) — la ligne qui entrera au
                                          grand livre et fera monter le solde de CE compte. */}
                                      {(j.type === 'TAG' || j.type === 'TPE') && (
                                        <div>
                                          <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Compte crédité</label>
                                          {bankAccounts.length === 0 ? (
                                            <p className="text-[10px] font-bold text-orange-600">
                                              Aucun compte bancaire — créez-en un dans Finance → Comptes Bancaires.
                                            </p>
                                          ) : (
                                            <select
                                              value={j.bankAccountId || ''}
                                              onChange={e => patch({ bankAccountId: e.target.value || undefined })}
                                              className={cn("input-field h-9 text-xs font-bold w-full",
                                                !j.bankAccountId && "border-red-300 text-red-600")}>
                                              <option value="">— Choisir le compte —</option>
                                              {bankAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                                            </select>
                                          )}
                                          {bankAccounts.length > 0 && !j.bankAccountId && (
                                            <p className="text-[9px] font-bold text-red-500 mt-1">
                                              Sans compte, ce montant n'entrera sur aucun solde bancaire.
                                            </p>
                                          )}
                                        </div>
                                      )}

                                      {/* Description (always) */}
                                      <input placeholder="Description" value={j.description} onChange={e => patch({ description: e.target.value })} className="input-field h-9 text-xs font-bold w-full" />

                                      {/* Une justification se saisit en MONTANT, point.
                                          Le calcul par litres a été retiré : le montant
                                          justifié est celui du bon, du TPE ou du crédit
                                          client — le déduire d'un volume et d'un prix
                                          affiché ne faisait que le rendre approximatif. */}
                                      <div>
                                        <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Montant (DA)</label>
                                        <input type="number" placeholder="Montant total" value={j.amount || ''} onChange={e => patch({ amount: parseFloat(e.target.value) || 0, liters: 0, byLiters: false })} className="input-field h-9 text-xs font-bold" />
                                      </div>

                                      <p className="text-[10px] font-black text-right text-blue-700">
                                        Montant: {(j.amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD
                                      </p>
                                    </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Per-pompiste recap */}
                              <div className="grid grid-cols-2 gap-2 text-[10px] pt-2 border-t border-slate-100">
                                <p className="text-slate-500 font-bold">Espèces: <span className="text-slate-800 font-black">{cash.toLocaleString('fr-FR')}</span></p>
                                <p className="text-slate-500 font-bold">Justifié: <span className="text-slate-800 font-black">{justifTotal.toLocaleString('fr-FR')}</span></p>
                              </div>
                              {Math.abs(ecartRestant) > 0.01 && (
                                <p className="text-[10px] font-bold text-orange-600">Ce décalage ({ecartRestant.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD) sera enregistré dans l'historique de paiement du pompiste</p>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* SUB-SECTION C: Récapitulatif final */}
                      {(() => {
                        const totalTheo = pompisteSales.reduce((s, x) => s + x.theoretical, 0);
                        const totalCash = pompisteSales.reduce((s, x) => s + (pompistePayments[x.pompisteId] || 0), 0);
                        const totalJust = pompisteSales.reduce((s, x) => s + (pompisteJustifications[x.pompisteId] || []).reduce((a, j) => a + (j.amount || 0), 0), 0);
                        const solde = totalTheo - totalCash - totalJust;
                        return (
                          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#001f5c] to-[#003087] text-white space-y-2">
                            <h4 className="text-[10px] font-black text-[#FFB800] uppercase tracking-widest">Récapitulatif final</h4>
                            <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                              <p>Total théorique:</p><p className="text-right text-[#FFB800] font-black">{totalTheo.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</p>
                              <p>Total espèces:</p><p className="text-right font-black">{totalCash.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</p>
                              <p>Total justifications:</p><p className="text-right font-black">{totalJust.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</p>
                              <p>Solde restant:</p><p className={cn("text-right font-black", Math.abs(solde) < 0.01 ? "text-green-300" : "text-red-300")}>{solde.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</p>
                            </div>

                            {/* ── Ce qui SORT en dépenses ─────────────────────────────
                                Justifiées ici, elles seront écrites dans l'écran
                                Dépenses (Carburant) au nom de cette brigade. */}
                            {(() => {
                              const lists = Object.values(pompisteJustifications) as WizardJustification[][];
                              const rows = lists.flat().filter(j => j.type === 'EXPENSE' && (j.amount || 0) > 0);
                              if (rows.length === 0) return null;
                              const total = rows.reduce((a, j) => a + (j.amount || 0), 0);
                              return (
                                <div className="pt-2 mt-2 border-t border-white/15 space-y-1">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-200">
                                    Dépenses justifiées ({rows.length}) — enregistrées dans Dépenses
                                  </p>
                                  {rows.map(j => (
                                    <div key={j.id} className="flex items-center justify-between gap-2 text-[11px] font-bold">
                                      <span className="truncate">
                                        🧾 {j.expenseName || 'Dépense'}
                                        {j.expenseCategory ? <span className="text-blue-200"> · {j.expenseCategory}</span> : null}
                                      </span>
                                      <span className="text-right font-black text-emerald-300 shrink-0">
                                        −{(j.amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD
                                      </span>
                                    </div>
                                  ))}
                                  <div className="flex items-center justify-between gap-2 text-[11px] font-black pt-1">
                                    <span>Total dépenses</span>
                                    <span className="text-[#FFB800]">{total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD</span>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* ── Ce qui va ENTRER EN BANQUE ──────────────────────────
                                L'utilisateur doit lire, avant d'enregistrer, le montant
                                exact qu'il retrouvera dans l'historique de chaque compte. */}
                            {(() => {
                              const byAccount = new Map<string, number>();
                              const lists = Object.values(pompisteJustifications) as WizardJustification[][];
                              lists.forEach(list =>
                                (list || []).forEach(j => {
                                  if (j.type !== 'TAG' && j.type !== 'TPE') return;
                                  if (!j.bankAccountId || !(j.amount > 0)) return;
                                  byAccount.set(j.bankAccountId, (byAccount.get(j.bankAccountId) || 0) + j.amount);
                                }));
                              if (byAccount.size === 0) return null;
                              return (
                                <div className="pt-2 mt-2 border-t border-white/15 space-y-1">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">Encaissé en banque (TPE / TAG)</p>
                                  {[...byAccount.entries()].map(([id, amount]) => (
                                    <div key={id} className="flex items-center justify-between gap-2 text-[11px] font-bold">
                                      <span className="truncate">{bankAccounts.find(a => a.id === id)?.name || 'Compte'}</span>
                                      <span className="text-right font-black text-emerald-300 shrink-0">
                                        +{amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DZD
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </div>

                {/* Footer — the app's own primary/outline buttons. Les boutons
                    passent pleine largeur sur mobile plutôt que de se tasser. */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-b from-slate-50/85 to-slate-50 border-t border-slate-200 flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-auto hidden lg:block">
                    Étape {step} / {STEPS.length} — {STEPS[step - 1]?.label}
                  </span>
                  {step > 1 && (
                    <button onClick={() => setStep(s => s - 1)} disabled={isSubmitting} className="btn-outline flex-1 sm:flex-none justify-center">
                      Retour
                    </button>
                  )}
                  {step < 6 ? (
                    <button
                      onClick={() => {
                        if (step === 2) {
                          // initialize presence for chef's pompistes if not set
                          const chef2 = brigadeChefs.find(c => c.id === chefId);
                          const ids = chef2?.pompisteIds || [];
                          setPompistePresence(prev => {
                            const next = { ...prev };
                            ids.forEach(pid => { if (!next[pid]) next[pid] = 'present'; });
                            return next;
                          });
                        }
                        setStep(s => s + 1);
                      }}
                      disabled={isSubmitting || !canGoNext}
                      className="btn-primary flex-1 sm:flex-none sm:min-w-[13rem] justify-center text-[11px]"
                    >
                      {isSubmitting ? (<><LoaderCircle className="w-4 h-4 animate-spin" />Traitement...</>) : (<>Suivant <ArrowRight className="w-4 h-4" /></>)}
                    </button>
                  ) : (
                    <>
                      {/* Button: Save as Pending */}
                      <button
                        onClick={() => handleStartBrigade('En attente')}
                        disabled={isSubmitting || !canGoNext}
                        className="px-4 py-2.5 rounded-xl border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 font-black text-[11px] uppercase tracking-wider flex flex-1 sm:flex-none items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-50"
                      >
                        {isSubmitting ? (
                          <LoaderCircle className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Clock className="w-4 h-4 text-amber-600" />
                            {editingBrigade ? 'Enregistrer (En attente)' : 'Créer (En attente)'}
                          </>
                        )}
                      </button>

                      {/* Button: Clôturer Brigade */}
                      <button
                        onClick={() => handleStartBrigade('Clôturée')}
                        disabled={isSubmitting || !canGoNext}
                        className="btn-primary flex-1 sm:flex-none sm:min-w-[13rem] text-[11px] flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? (
                          <><LoaderCircle className="w-4 h-4 animate-spin" />Traitement...</>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#FFB800]" />
                            {editingBrigade?.status === 'En attente'
                              ? '✓ Clôturer la Brigade'
                              : editingBrigade
                              ? 'Mettre à jour & Clôturer'
                              : 'Créer & Clôturer'}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>

              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* Brigade Detail Modal — 5 Tabs */}
      <AnimatePresence>
        {showDetail && selectedBrigade && (
          <BrigadeDetailModal
            brigade={selectedBrigade}
            pumps={pumps}
            tanks={tanks}
            pompistes={pompistes}
            brigadeChefs={brigadeChefs}
            pumpNozzles={pumpNozzles}
            tracks={tracks}
            shopSales={shopSales}
            settings={settings}
            accounting={brigadeAccountings.find(a => a.brigadeId === selectedBrigade.id)}
            clients={clients}
            onClose={() => { setShowDetail(false); setSelectedBrigade(null); setDetailTab('info'); }}
          />
        )}
      </AnimatePresence>

      {/* Fiche Modal */}
      <AnimatePresence>
        {showFicheModal && selectedBrigade && (
          <BrigadeFicheModal
            brigade={selectedBrigade}
            pumps={pumps}
            tanks={tanks}
            pompistes={pompistes}
            brigadeChefs={brigadeChefs}
            pumpNozzles={pumpNozzles}
            tracks={tracks}
            shopSales={shopSales}
            settings={settings}
            accounting={brigadeAccountings.find(a => a.brigadeId === selectedBrigade.id)}
            onClose={() => { setShowFicheModal(false); setSelectedBrigade(null); }}
          />
        )}
      </AnimatePresence>

      {/* Accounting Modal — `brigades` n'y sert qu'à savoir si cette brigade est
          encore la dernière sur ses pistolets : sinon, un index corrigé dans la
          comptabilité ne déplace plus leur compteur (`lib/nozzleIndexes.ts`). */}
      <AnimatePresence>
        {showAccountingModal && selectedBrigade && (
          <BrigadeAccountingModal
            brigade={selectedBrigade}
            pumps={pumps}
            tanks={tanks}
            pompistes={pompistes}
            brigadeChefs={brigadeChefs}
            pumpNozzles={pumpNozzles}
            settings={settings}
            clients={clients}
            tracks={tracks}
            currentUserRole={currentUserRole || 'admin'}
            currentUserName={currentUserName}
            existingAccounting={brigadeAccountings.find(a => a.brigadeId === selectedBrigade.id)}
            treasuryTransactions={treasuryTransactions}
            bankAccounts={bankAccounts}
            expenses={expenses}
            clientAccounts={clientAccounts}
            brigades={brigades}
            dispatch={dispatch}
            onClose={() => { setShowAccountingModal(false); setSelectedBrigade(null); }}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={showConfirmDelete}
        title="Supprimer la Brigade"
        message={`Êtes-vous sûr de vouloir supprimer la brigade ${selectedBrigade?.id} ? Cette action est irréversible.`
          + (selectedBrigade && brigadeLiters(selectedBrigade, pumpNozzles, pumps) > 0
            ? `\n\nLes ${brigadeLiters(selectedBrigade, pumpNozzles, pumps).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L qu'elle avait retirés seront REMIS dans les cuves.`
            : '')}
        confirmLabel="Supprimer"
        danger={true}
        onConfirm={() => {
          if (selectedBrigade) {
            // Une brigade supprimée n'a jamais eu lieu : ses litres reviennent
            // dans les cuves, exactement comme la suppression d'un achat leur
            // reprend les siens.
            const backDeltas = brigadeTankDeltas(selectedBrigade, null, pumpNozzles, pumps);
            if (backDeltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: backDeltas });
            dispatch({ type: 'DELETE_BRIGADE', payload: selectedBrigade.id });
            const back = brigadeLiters(selectedBrigade, pumpNozzles, pumps);
            dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: back > 0
              ? `Brigade supprimée — ${back.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L remis dans les cuves`
              : 'Brigade supprimée' } });
          }
          setShowConfirmDelete(false);
          setSelectedBrigade(null);
        }}
        onCancel={() => setShowConfirmDelete(false)}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
        @media print {
           .fixed { display: none !important; }
           .card-glass { box-shadow: none !important; border: 1px solid #eee !important; }
        }
      `}</style>
    </div>
  );
};

export default Brigades;
