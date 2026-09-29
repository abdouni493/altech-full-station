import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, DollarSign, Droplets, Printer, CheckCircle, AlertTriangle,
  Search, Plus, Trash2, ChevronRight, ArrowRight, Users, Zap
} from "lucide-react";
import { cn, newId, degreesFromLiters, matchesSearch } from "@/src/lib/utils";
import {
  Brigade, Pump, Tank, Pompiste, BrigadeChef, PumpNozzle, StationSettings,
  Client, Track, BrigadeAccounting, BrigadeAccountingJustification, FuelType,
  TreasuryTransaction, BankAccount, Expense, CAISSE_ID,
} from "../store/AppContext";
import {
  brigadeActiveNozzles, brigadeNozzleRows, brigadeTankRows, brigadePompisteGroups, justifiedByPompiste,
} from "../lib/brigadeCalc";
import { brigadeTankDeltas } from "../lib/brigadeTanks";
import { clientChargeDelta, clientStanding, ClientLedger } from "../lib/clientLedger";
import {
  brigadeBankLines, brigadeBankLineIds, unbankedJustifications, accountOfJustification,
} from "../lib/brigadeBankLines";
import { ownsNozzleIndex } from "../lib/nozzleIndexes";
import { planBrigadeExpenses, BRIGADE_EXPENSE_CATEGORY } from "../lib/brigadeExpenses";

interface Justification {
  id: string;
  clientId: string;
  amount: number;
  justificationType: 'CLIENT' | 'TAG' | 'TPE' | 'EXPENSE';
  /** Description libre d'une dépense (justifie le reste sans client). */
  notes?: string;
  /** La catégorie d'une dépense — celle de l'écran Dépenses, facultative. */
  expenseCategory?: string;
  /**
   * Le compte bancaire crédité par un TAG / TPE.
   *
   * Il manquait ici : cette fenêtre relisait les justifications d'une brigade,
   * les réenregistrait SANS leur compte, et l'argent encaissé au terminal
   * disparaissait des soldes bancaires à la première ouverture de la
   * comptabilité — sans que rien ne le signale.
   */
  bankAccountId?: string;
  clientName?: string;
  fuelType?: string;
  liters?: number;
  pricePerLiter?: number;
  trackId?: string;
  pompisteId?: string;
}

interface Props {
  brigade: Brigade;
  pumps: Pump[];
  tanks: Tank[];
  pompistes: Pompiste[];
  brigadeChefs: BrigadeChef[];
  pumpNozzles: PumpNozzle[];
  settings: StationSettings;
  clients: Client[];
  tracks: Track[];
  currentUserRole: string;
  currentUserName?: string;
  existingAccounting?: BrigadeAccounting;
  /**
   * Le grand livre — les lignes de trésorerie que CETTE brigade a écrites sont
   * réécrites à l'enregistrement, pour que la caisse suive le montant corrigé
   * ici au lieu de rester sur celui saisi à la clôture.
   */
  treasuryTransactions?: TreasuryTransaction[];
  /** Les comptes bancaires : un TAG / TPE justifié crédite celui du terminal. */
  bankAccounts?: BankAccount[];
  /**
   * Les dépenses déjà enregistrées. Une justification « dépense » en écrit une
   * vraie dans l'écran Dépenses : il faut donc savoir laquelle existe déjà pour
   * la corriger — et non en créer une seconde (`lib/brigadeExpenses.ts`).
   */
  expenses?: Expense[];
  /**
   * Le compte de chaque client, relu sur ses pièces — celui-là même que l'écran
   * Clients affiche. Cette fenêtre ne montrait AUCUN solde : on justifiait « au
   * client » sans savoir ce qu'il devait déjà, et le seul chiffre visible
   * ailleurs (la colonne `clients.debt`) n'était pas celui de sa fiche.
   */
  clientAccounts?: Record<string, ClientLedger>;
  /**
   * Toutes les brigades — uniquement pour savoir QUI détient le compteur de
   * chaque pistolet. Corriger un index ici recopiait la valeur dans
   * `pump_nozzles.last_index`, le compteur qui sert d'index de DÉPART à la
   * prochaine brigade : rouvrir la comptabilité d'une brigade ancienne — même
   * sans rien changer, les corrections d'origine étant relues telles quelles —
   * faisait RECULER toute la piste sur les index de ce jour-là. Voir
   * `lib/nozzleIndexes.ts`.
   */
  brigades?: Brigade[];
  dispatch: React.Dispatch<any>;
  onClose: () => void;
}

/** Un montant en dinars, au dinar près. */
const money0 = (v: number): string =>
  `${(Number.isFinite(v) ? v : 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA`;

type VerEntry = { verified: boolean; corrected: boolean; correctedValue?: number };

const BrigadeAccountingModal: React.FC<Props> = ({
  brigade, pumps, tanks, pompistes, brigadeChefs, pumpNozzles, settings,
  clients, tracks, currentUserRole, currentUserName, existingAccounting,
  treasuryTransactions = [], bankAccounts = [], expenses = [], clientAccounts = {}, brigades = [],
  dispatch, onClose
}) => {
  const chef = brigadeChefs.find(c => c.id === brigade.chefId);

  // ── wizard step ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Step 1: Cuve verifications ───────────────────────────────────────────────
  const [cuveVer, setCuveVer] = useState<Record<string, VerEntry>>(existingAccounting?.cuveVerifications || {});

  // ── Step 2: Nozzle verifications ─────────────────────────────────────────────
  const [nozzleVer, setNozzleVer] = useState<Record<string, VerEntry>>(existingAccounting?.nozzleVerifications || {});

  // ── Step 4: financial ────────────────────────────────────────────────────────
  const [cashReceived, setCashReceived] = useState(existingAccounting?.cashReceived || 0);
  const [justifications, setJustifications] = useState<Justification[]>(
    (existingAccounting?.justifications || []).map(j => ({
      id: j.id, clientId: j.clientId, amount: j.amount,
      justificationType: j.justificationType || 'CLIENT',
      // Le libellé rattrape le compte des brigades dont la colonne a été perdue
      // (« TPE Naftal card » est resté écrit sur la pièce).
      bankAccountId: accountOfJustification(j, bankAccounts),
      clientName: j.clientName, notes: j.notes, expenseCategory: j.expenseCategory,
      fuelType: j.fuelType, liters: j.liters,
      pricePerLiter: j.pricePerLiter, trackId: j.trackId, pompisteId: j.pompisteId,
    }))
  );
  // Mode de justification du reste : dépense de brigade, bon/tag ou TPE.
  const [justifMode, setJustifMode] = useState<'EXPENSE' | 'TAG' | 'TPE'>('EXPENSE');
  // Saisie d'une dépense justifiée (nom obligatoire, description facultative).
  const [expName, setExpName] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expCategory, setExpCategory] = useState('');
  const [expAmount, setExpAmount] = useState<number | ''>('');
  const [tpeClientName, setTpeClientName] = useState('');
  const [tpeBankAccountId, setTpeBankAccountId] = useState(bankAccounts[0]?.id || '');
  const [tpeFuelType, setTpeFuelType] = useState(Object.keys(settings.fuelPrices)[0] || 'SUPER');
  const [tpeLiters, setTpeLiters] = useState<number | ''>('');
  const [tpeTrackId, setTpeTrackId] = useState('');
  const [tpePompisteId, setTpePompisteId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [currentClientAmount, setCurrentClientAmount] = useState<number | ''>('');
  const [restAssignedWorkerType, setRestAssignedWorkerType] = useState(existingAccounting?.restAssignedWorkerType || '');
  const [restAssignedWorkerId, setRestAssignedWorkerId] = useState(existingAccounting?.restAssignedWorkerId || '');

  // ── Create-new-client (inline) ───────────────────────────────────────────────
  const [showCreateClientModal, setShowCreateClientModal] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    name: '', phone: '', type: 'PARTICULIER' as 'PARTICULIER' | 'ENTREPRISE',
    paymentMode: 'CASH' as 'CASH' | 'CREDIT' | 'ADVANCE',
    cin: '', email: '', address: '',
  });

  const handleCreateClient = () => {
    if (!newClientForm.name.trim()) return;
    const clientId = newId();
    const newClient = {
      id: clientId,
      name: newClientForm.name,
      phone: newClientForm.phone || undefined,
      cin: newClientForm.cin || undefined,
      email: newClientForm.email || undefined,
      address: newClientForm.address || undefined,
      type: newClientForm.type,
      paymentMode: newClientForm.paymentMode,
      balance: 0,
      debt: 0,
      creditLimit: 0,
      paymentDelay: 30,
      advanceBalance: 0,
      transactionHistory: [],
    };
    dispatch({ type: 'ADD_CLIENT', payload: newClient });
    // Auto-select the new client
    setSelectedClientId(clientId);
    setClientSearch(newClientForm.name);
    // Reset form and close modal
    setNewClientForm({ name: '', phone: '', type: 'PARTICULIER', paymentMode: 'CASH', cin: '', email: '', address: '' });
    setShowCreateClientModal(false);
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Client "${newClientForm.name}" créé et sélectionné` } });
  };

  // ── Calcul partagé (`lib/brigadeCalc`) ───────────────────────────────────────
  // Chaque pistolet est valorisé au carburant de SA cuve, et le regroupement se
  // fait par pompiste : les pistes n'existent plus, et s'y fier vidait à la fois
  // le détail par pistolet et la répartition des décalages.
  const calcCtx = useMemo(
    () => ({ pumps, tanks, pumpNozzles, pompistes, settings }),
    [pumps, tanks, pumpNozzles, pompistes, settings]);

  const activeNozzles = useMemo(
    () => brigadeActiveNozzles(brigade, calcCtx), [brigade, calcCtx]);

  /**
   * ─── QUI DÉPLACE LE COMPTEUR D'UN PISTOLET ─────────────────────────────────
   *
   * Corriger un index de fin ici le recopiait dans `pump_nozzles.last_index` —
   * le compteur qui sert d'index de DÉPART à la prochaine brigade. Comme les
   * corrections d'origine sont relues à l'ouverture, il suffisait de rouvrir la
   * comptabilité d'une brigade ancienne et de l'enregistrer, SANS RIEN CHANGER,
   * pour que les pistolets reculent sur les index de ce jour-là.
   *
   * Seule la DERNIÈRE brigade à avoir relevé un pistolet déplace son compteur.
   * Une correction portée sur une brigade antérieure reste enregistrée sur SA
   * fiche — ses litres, son théorique et sa cuve suivent — mais le compteur ne
   * bouge plus. Voir `lib/nozzleIndexes.ts`.
   */
  const ownsLiveIndex = (nozzleId: string) =>
    brigades.length === 0 || ownsNozzleIndex(brigades, brigade.id, nozzleId);
  /** Vrai quand cette brigade n'est plus la dernière sur au moins un pistolet. */
  const indexesLockedByLater = useMemo<boolean>(
    () => activeNozzles.some((n: PumpNozzle) => !ownsLiveIndex(n.id)),
    [activeNozzles, brigades, brigade.id]);

  // Les corrections d'index saisies ici rejouent le MÊME calcul, sans en écrire
  // une seconde version qui finirait par diverger.
  const endOverrides = useMemo(() => {
    const o: Record<string, number | undefined> = {};
    (Object.entries(nozzleVer) as [string, VerEntry][]).forEach(([nozzleId, ver]) => {
      if (ver?.corrected && ver.correctedValue !== undefined) o[nozzleId] = ver.correctedValue;
    });
    return o;
  }, [nozzleVer]);

  const nozzleData = useMemo(
    () => brigadeNozzleRows(brigade, calcCtx, endOverrides).map(r => ({ ...r, revenue: r.amount })),
    [brigade, calcCtx, endOverrides]);

  // ── Comparaison cuves (les corrections de jauge sont prises en compte) ───────
  const tankComparison = useMemo(() => {
    const base = brigadeTankRows(brigade, calcCtx, nozzleData);
    return base.map(row => {
      const ver = cuveVer[row.tank.id];
      if (!ver?.corrected || ver.correctedValue === undefined) {
        return { ...row, nozzleTotal: row.nozzleDiff, ecart: row.difference, ecartMoney: row.amount };
      }
      // Jauge corrigée : le niveau de fin est celui saisi ici, et il vaut relevé.
      const endL = ver.correctedValue;
      const cuveDiff = row.startL - endL;
      const difference = row.nozzleDiff - cuveDiff;
      const price = settings.fuelPrices[row.tank.type] || 0;
      return {
        ...row, endL, measured: true, cuveDiff, difference,
        nozzleTotal: row.nozzleDiff,
        ecart: difference,
        amount: Math.abs(difference) * price,
        ecartMoney: Math.abs(difference) * price,
      };
    });
  }, [brigade, calcCtx, nozzleData, cuveVer, settings]);

  // ── Regroupement par pompiste ────────────────────────────────────────────────
  const justifTotals = useMemo(() => justifiedByPompiste(
    justifications.map(j => ({ pompisteId: (j as any).pompisteId, amount: j.amount }))), [justifications]);
  const pompisteGroups = useMemo(
    () => brigadePompisteGroups(brigade, calcCtx, nozzleData, justifTotals),
    [brigade, calcCtx, nozzleData, justifTotals]);

  // ── Décalage par pompiste ────────────────────────────────────────────────────
  // L'écart d'une cuve se répartit entre les pompistes AU PRORATA des litres que
  // chacun a débités sur cette cuve : sans cela, un pompiste absorbait la
  // totalité d'un écart produit par plusieurs.
  type DecalageEntry = { pompiste: Pompiste | undefined; track: Track | undefined; liters: number; money: number };
  const decalageByPompiste = useMemo((): Record<string, DecalageEntry> => {
    const result: Record<string, DecalageEntry> = {};
    tankComparison.forEach(({ tank, ecart, measured }) => {
      if (!measured || Math.abs(ecart) < 0.01) return;
      const price = settings.fuelPrices[tank.type] || 0;
      const shares = pompisteGroups
        .map(g => ({ g, liters: g.nozzles.filter(r => r.tank?.id === tank.id).reduce((s, r) => s + r.liters, 0) }))
        .filter(x => x.liters > 0);
      const totalOnTank = shares.reduce((s, x) => s + x.liters, 0);
      if (totalOnTank <= 0) return;
      shares.forEach(({ g, liters }) => {
        const part = ecart * (liters / totalOnTank);
        if (!result[g.pompisteId]) result[g.pompisteId] = { pompiste: g.pompiste, track: undefined, liters: 0, money: 0 };
        result[g.pompisteId].liters += part;
        result[g.pompisteId].money += part * price;
      });
    });
    return result;
  }, [tankComparison, pompisteGroups, settings]);

  const totalRevenue = nozzleData.reduce((s, d) => s + d.revenue, 0);
  const justifiedTotal = justifications.reduce((s, j) => s + j.amount, 0);
  const reste = totalRevenue - cashReceived - justifiedTotal;

  // ── Step 1 helpers ───────────────────────────────────────────────────────────
  const allCuvesVerified = tankComparison.length === 0 || tankComparison.every(t => cuveVer[t.tank.id]?.verified);
  const allNozzlesVerified = activeNozzles.length === 0 || activeNozzles.every(n => nozzleVer[n.id]?.verified);

  // ── Client search ────────────────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 8);
    return clients.filter(c => matchesSearch(clientSearch, c.name, c.phone, c.cin)).slice(0, 8);
  }, [clients, clientSearch]);

  /** Ce qu'un client doit et détient — le même chiffre que l'écran Clients. */
  const standingOf = (c: Client) => clientStanding(c, clientAccounts[c.id]);

  const addJustification = () => {
    if (!selectedClientId || !currentClientAmount || +currentClientAmount <= 0) return;
    setJustifications(prev => [...prev, { id: newId(), clientId: selectedClientId, amount: +currentClientAmount, justificationType: 'CLIENT' }]);
    setSelectedClientId('');
    setCurrentClientAmount('');
    setClientSearch('');
  };

  // ── Justification par dépense ────────────────────────────────────────────────
  const addExpenseJustification = () => {
    if (!expName.trim() || !expAmount || +expAmount <= 0) return;
    setJustifications(prev => [...prev, {
      id: newId(),
      clientId: '',
      amount: +expAmount,
      justificationType: 'EXPENSE',
      clientName: expName.trim(),
      notes: expDesc.trim() || undefined,
      expenseCategory: expCategory || undefined,
    }]);
    setExpName('');
    setExpDesc('');
    setExpCategory('');
    setExpAmount('');
  };

  // ── TPE / Tag justification helpers ──────────────────────────────────────────
  const tpePricePerLiter = useMemo(() => settings.fuelPrices[tpeFuelType as FuelType] || 0, [settings, tpeFuelType]);
  const tpeAutoAmount = useMemo(() => (typeof tpeLiters === 'number' ? tpeLiters * tpePricePerLiter : 0), [tpeLiters, tpePricePerLiter]);

  const addTpeJustification = () => {
    if (!tpeLiters || +tpeLiters <= 0) return;
    const amount = +tpeLiters * tpePricePerLiter;
    setJustifications(prev => [...prev, {
      id: newId(),
      clientId: '',
      clientName: tpeClientName || undefined,
      amount,
      justificationType: justifMode,
      // TAG comme TPE : l'argent est encaissé sur un compte bancaire.
      bankAccountId: tpeBankAccountId || undefined,
      fuelType: tpeFuelType,
      liters: +tpeLiters,
      pricePerLiter: tpePricePerLiter,
      trackId: tpeTrackId || undefined,
      pompisteId: tpePompisteId || undefined,
    }]);
    setTpeClientName('');
    setTpeLiters('');
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const justObjs: BrigadeAccountingJustification[] = justifications.map(j => {
      const client = clients.find(c => c.id === j.clientId);
      return {
        id: j.id, accountingId: '', clientId: j.clientId || '', amount: j.amount,
        clientType: client?.type, paymentMode: client?.paymentMode,
        justificationType: j.justificationType || 'CLIENT',
        bankAccountId: j.bankAccountId, notes: j.notes,
        clientName: j.clientName, expenseCategory: j.expenseCategory,
        fuelType: j.fuelType, liters: j.liters,
        pricePerLiter: j.pricePerLiter, trackId: j.trackId, pompisteId: j.pompisteId,
      };
    });

    // Un TAG / TPE sans compte désigné compterait comme encaissé dans le rapport
    // Carburant sans qu'un dinar n'entre en banque : on refuse plutôt que de le
    // perdre en silence. Sans aucun compte enregistré, il n'y a rien à choisir.
    const unbanked = bankAccounts.length > 0 ? unbankedJustifications(justObjs, bankAccounts) : [];
    if (unbanked.length > 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message:
        `Choisissez le compte bancaire de ${unbanked.length} justification(s) TPE / TAG` } });
      return;
    }

    const accounting: BrigadeAccounting = {
      id: existingAccounting?.id || newId(),
      brigadeId: brigade.id,
      totalDue: totalRevenue,
      cashReceived,
      rest: reste,
      tankSummary: tankComparison.map(t => ({ tankId: t.tank.id, startL: t.startL, endL: t.endL, diff: t.diff, ecart: t.ecart, ecartMoney: t.ecartMoney })),
      nozzleSummary: nozzleData.map(d => ({ nozzleId: d.nozzle.id, startIdx: d.startIdx, endIdx: d.endIdx, liters: d.liters, revenue: d.revenue })),
      decalageSummary: Object.fromEntries((Object.entries(decalageByPompiste) as [string, DecalageEntry][]).map(([pid, d]) => [pid, { liters: d.liters, money: d.money }])),
      cuveVerifications: cuveVer,
      nozzleVerifications: nozzleVer,
      restAssignedWorkerType: restAssignedWorkerType || undefined,
      restAssignedWorkerId: restAssignedWorkerId || undefined,
      restAssignedAmount: Math.abs(reste),
      status: 'completed',
      createdBy: currentUserName,
      justifications: justObjs.map(j => ({ ...j, accountingId: existingAccounting?.id || '' })),
    };

    const action = existingAccounting ? 'UPDATE_BRIGADE_ACCOUNTING' : 'ADD_BRIGADE_ACCOUNTING';
    dispatch({ type: action, payload: accounting });

    // ── Les dépenses justifiées deviennent de VRAIES dépenses ───────────────
    // Même règle que l'assistant de création : la charge pèse dans le résultat
    // du Carburant et se retrouve dans l'écran Dépenses, sans sortir d'aucune
    // caisse (la brigade a déjà remis son montant en moins).
    {
      const plan = planBrigadeExpenses(accounting.justifications, expenses, {
        brigadeId: brigade.id,
        date: brigade.date,
        shift: brigade.shift,
        createdBy: currentUserName,
        pompisteName: pid => pompistes.find(p => p.id === pid)?.name,
      });
      plan.remove.forEach(id => dispatch({ type: 'DELETE_EXPENSE', payload: id }));
      plan.add.forEach(e => dispatch({ type: 'ADD_EXPENSE', payload: e }));
      plan.update.forEach(e => dispatch({ type: 'UPDATE_EXPENSE', payload: e }));
    }

    // Reflect TAG/TPE justifications in the Caisse TPE store immediately
    if (existingAccounting) {
      // Drop any previous TPE rows for this accounting before re-adding
      (existingAccounting.justifications || [])
        .filter(j => j.justificationType === 'TAG' || j.justificationType === 'TPE')
        .forEach(j => dispatch({ type: 'DELETE_TPE_TRANSACTION', payload: j.id }));
    }
    justifications
      .filter(j => j.justificationType === 'TAG' || j.justificationType === 'TPE')
      .forEach(j => {
        const track = tracks.find(t => t.id === j.trackId);
        const pompiste = pompistes.find(p => p.id === j.pompisteId);
        dispatch({ type: 'ADD_TPE_TRANSACTION', payload: {
          id: j.id,
          brigadeId: brigade.id,
          accountingId: accounting.id,
          date: brigade.date,
          mode: j.justificationType as 'TAG' | 'TPE',
          clientName: j.clientName,
          clientId: j.clientId || undefined,
          fuelType: j.fuelType || '',
          liters: j.liters || 0,
          pricePerLiter: j.pricePerLiter || 0,
          amount: j.amount,
          trackId: j.trackId,
          trackName: track?.name,
          pompisteId: j.pompisteId,
          pompisteName: pompiste?.name,
          createdAt: new Date().toISOString(),
        }});
      });

    // ── Report sur les comptes clients ──────────────────────────────────────
    // Seule la DIFFÉRENCE avec ce qui était déjà enregistré est appliquée :
    // rouvrir cette comptabilité pour corriger un montant rajoutait auparavant
    // une seconde fois TOUTE la consommation de la brigade, et la dette du
    // client enflait sans qu'aucune pièce ne l'explique. Les TAG et les TPE
    // n'entrent dans le compte de personne (voir `clientChargeDelta`).
    //
    // Aucune ligne d'historique n'est plus écrite ici : la justification EST la
    // pièce du bon. La copie qu'on en faisait dans `client_transactions` faisait
    // compter chaque bon deux fois dans le compte du client.
    clientChargeDelta(existingAccounting?.justifications, justObjs).forEach((delta, clientId) => {
      const client = clients.find(c => c.id === clientId);
      if (!client) return;
      // Les deux colonnes de l'avance descendent ensemble — `balance` est celle
      // que la recharge crédite côté Clients.
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

    // ── Corrections de pistolets ────────────────────────────────────────────
    // Corriger l'index de fin d'un pistolet change le volume que la brigade a
    // débité : la cuve doit suivre DANS LE MÊME MOUVEMENT. Elle ne le faisait
    // pas — l'index corrigé était enregistré, le stock restait sur l'ancien
    // volume, et la cuve s'éloignait un peu plus de ses pièces à chaque
    // correction. Seule la DIFFÉRENCE est appliquée, comme partout ailleurs.
    let hadNozzleCorrection = false;
    const newEndNozzleIndices = { ...(brigade.endNozzleIndices || {}) };
    activeNozzles.forEach((nozzle: PumpNozzle) => {
      const ver = nozzleVer[nozzle.id];
      if (ver?.corrected && ver.correctedValue !== undefined) {
        newEndNozzleIndices[nozzle.id] = ver.correctedValue;
        // Le compteur vivant du pistolet n'appartient qu'à sa DERNIÈRE brigade
        // (voir `ownsLiveIndex` plus haut) : une correction portée sur une
        // brigade antérieure reste sur sa fiche sans faire reculer la piste.
        if (ownsLiveIndex(nozzle.id)) {
          dispatch({ type: 'UPDATE_NOZZLE', payload: { ...nozzle, lastIndex: ver.correctedValue } });
        }
        hadNozzleCorrection = true;
      }
    });
    const nozzleDeltas = hadNozzleCorrection
      ? brigadeTankDeltas(
        brigade,
        { startNozzleIndices: brigade.startNozzleIndices, endNozzleIndices: newEndNozzleIndices },
        pumpNozzles, pumps)
      : [];
    if (nozzleDeltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: nozzleDeltas });

    // ── Corrections de cuve (jauge relevée) ─────────────────────────────────
    // Le comptage physique fait foi : la cuve est ramenée sur la valeur relevée.
    // On y va par DELTA (`adjust_tank_level`), jamais par une écriture absolue —
    // c'est la seule route qui reste juste si un achat ou une brigade est
    // enregistré au même instant depuis un autre poste, et c'est le serveur qui
    // recalcule les degrés à partir de la table de conversion.
    //
    // Le delta est calculé APRÈS les corrections de pistolets ci-dessus, pour
    // que la jauge relevée soit bien le niveau final et non un niveau corrigé
    // deux fois.
    const nozzleDeltaByTank: Record<string, number> = {};
    nozzleDeltas.forEach(d => { nozzleDeltaByTank[d.tankId] = d.deltaLiters; });
    const cuveDeltas: { tankId: string; deltaLiters: number }[] = [];
    // Les relevés corrigés sont rassemblés puis écrits EN UNE FOIS : une
    // écriture par cuve repartait à chaque tour de la brigade d'origine, et
    // seule la dernière cuve corrigée survivait.
    const correctedLevels: Record<string, { degrees: number; liters: number; measured: boolean }> = {};
    tankComparison.forEach(({ tank }: any) => {
      const ver = cuveVer[tank.id];
      if (!ver?.corrected || ver.correctedValue === undefined) return;
      const after = Math.max(0, (Number(tank.current) || 0) + (nozzleDeltaByTank[tank.id] || 0));
      const delta = ver.correctedValue - after;
      if (Math.abs(delta) > 0.0001) cuveDeltas.push({ tankId: tank.id, deltaLiters: delta });
      const curve = settings.conversionTables?.[tank.id] || [];
      correctedLevels[tank.id] = {
        degrees: tank.type === 'GPL'
          ? (tank.capacity > 0 ? (ver.correctedValue / tank.capacity) * 100 : 0)
          : (curve.length > 0
            ? degreesFromLiters(curve, ver.correctedValue)
            : (brigade.endTankLevels?.[tank.id]?.degrees || 0)),
        liters: ver.correctedValue,
        measured: true,
      };
    });
    if (Object.keys(correctedLevels).length > 0) {
      dispatch({
        type: 'UPDATE_BRIGADE',
        payload: {
          ...brigade,
          ...(hadNozzleCorrection ? { endNozzleIndices: newEndNozzleIndices } : {}),
          endTankLevels: { ...(brigade.endTankLevels || {}), ...correctedLevels },
        },
      });
    } else if (hadNozzleCorrection) {
      dispatch({ type: 'UPDATE_BRIGADE', payload: { ...brigade, endNozzleIndices: newEndNozzleIndices } });
    }
    if (cuveDeltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: cuveDeltas });

    // ── La caisse suit le montant enregistré ici ────────────────────────────
    // La clôture avait écrit une ligne au grand livre pour les espèces remises.
    // Corriger ce montant ici la laissait telle quelle : la caisse gardait
    // l'ancien chiffre pendant que le rapport Carburant montrait le nouveau.
    // La ligne est donc réécrite, exactement comme le fait l'assistant.
    (treasuryTransactions || [])
      .filter(t => t.refType === 'brigade' && t.refId === brigade.id && t.kind === 'BRIGADE')
      .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));

    // ── Les TPE / TAG entrent en BANQUE ─────────────────────────────────────
    // Cette fenêtre n'écrivait aucune ligne bancaire : une justification saisie
    // ici gonflait « encaissé » du rapport Carburant, et l'historique du compte
    // ne montrait rien. Les lignes de la brigade sont réécrites entièrement,
    // exactement comme le fait l'assistant, pour qu'un montant corrigé ici soit
    // le montant que le compte affiche.
    brigadeBankLineIds(treasuryTransactions, brigade.id)
      .forEach(id => dispatch({ type: 'DELETE_TREASURY_TX', payload: id }));
    brigadeBankLines({
      brigadeId: brigade.id,
      date: brigade.endDatetime || brigade.date,
      label: brigade.date,
      justifications: justObjs,
      pompisteName: pid => pompistes.find(p => p.id === pid)?.name,
      createdBy: currentUserName,
      accounts: bankAccounts,
    }).forEach(tx => dispatch({ type: 'ADD_TREASURY_TX', payload: tx }));

    if (cashReceived > 0) {
      dispatch({
        type: 'ADD_TREASURY_TX',
        payload: {
          id: newId(),
          date: brigade.endDatetime || brigade.date,
          kind: 'BRIGADE',
          amount: cashReceived,
          description: `Encaissement brigade du ${brigade.date}`,
          accountTo: CAISSE_ID,
          part: 'carburant',
          refType: 'brigade', refId: brigade.id,
          createdBy: currentUserName,
          createdAt: new Date().toISOString(),
        } as TreasuryTransaction,
      });
    }

    // Assign rest décalage to the selected agent (pompiste or chef)
    if (restAssignedWorkerId && Math.abs(reste) > 0.01) {
      const entry = { brigadeId: brigade.id, date: brigade.date, amount: Math.abs(reste), type: (reste < 0 ? 'BONUS' : 'RETENUE') as 'BONUS' | 'RETENUE' };
      if (restAssignedWorkerType === 'chef_brigade') {
        const targetChef = brigadeChefs.find(c => c.id === restAssignedWorkerId);
        if (targetChef) {
          dispatch({ type: 'UPDATE_BRIGADE_CHEF', payload: { ...targetChef, decalageHistory: [...(targetChef.decalageHistory || []), entry] } });
        }
      } else {
        const pompiste = pompistes.find(p => p.id === restAssignedWorkerId);
        if (pompiste) {
          dispatch({ type: 'UPDATE_POMPISTE', payload: { ...pompiste, decalageHistory: [...(pompiste.decalageHistory || []), entry] } });
        }
      }
    }

    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: 'Comptabilité enregistrée ✓' } });
    onClose();
  };

  const STEPS = [
    { n: 1, label: 'Cuves' },
    { n: 2, label: 'Pistolets' },
    { n: 3, label: 'Comparaison' },
    { n: 4, label: 'Réconciliation' },
  ];

  return (
    <div className="modal-shell z-[70] italic text-left">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-5xl rounded-[2rem] shadow-2xl relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden border border-slate-100">

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}>
              <DollarSign className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <h2 className="font-black text-sm uppercase tracking-widest">
                {existingAccounting ? 'MODIFIER COMPTABILITÉ' : 'COMPTABILITÉ BRIGADE'}
              </h2>
              <p className="text-[11px] text-blue-200 font-bold mt-0.5">{brigade.date} · {brigade.shift} · Chef: {chef?.name || 'N/A'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="p-2 hover:bg-white/20 rounded-lg transition text-white"><Printer className="w-5 h-5" /></button>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition text-white"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-4 pb-0 shrink-0">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.n}>
                <button onClick={() => setStep(s.n)}
                  className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-all",
                    step === s.n ? "bg-blue-900 text-yellow-400" : step > s.n ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400")}>
                  {step > s.n ? <CheckCircle className="w-3.5 h-3.5" /> : <span>{s.n}</span>}
                  {s.label}
                </button>
                {i < 3 && <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" />}
              </React.Fragment>
            ))}
          </div>
          <div className="h-px bg-slate-100 mt-3" />
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">

            {/* ─── STEP 1: Verify Cuves ─── */}
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vérification des Cuves — confirmez ou corrigez les niveaux de fin</p>
                {tankComparison.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Aucune donnée de cuve pour cette brigade</div>}
                {tankComparison.map(({ tank, startL, endL, diff }) => {
                  const ver = cuveVer[tank.id] || {};
                  return (
                    <div key={tank.id} className={cn("rounded-2xl border-2 overflow-hidden", ver.verified ? "border-green-300" : "border-slate-200")}>
                      <div className="px-5 py-3 bg-gradient-to-r from-blue-900 to-blue-800 flex items-center gap-3">
                        <Droplets className="w-4 h-4 text-yellow-400" />
                        <p className="font-black text-white text-sm flex-1">{tank.name} <span className="text-blue-300 text-[10px] font-bold ml-2">{tank.type}</span></p>
                        {ver.verified && <span className="px-2 py-0.5 rounded-full bg-green-400 text-green-900 text-[9px] font-black uppercase">✓ Vérifié</span>}
                      </div>
                      <div className="p-4 bg-white">
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <div className="text-center p-3 bg-blue-50 rounded-xl">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Début</p>
                            <p className="font-black text-blue-900">{startL.toLocaleString('fr-FR')} L</p>
                          </div>
                          <div className="text-center p-3 bg-slate-50 rounded-xl">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Fin enregistrée</p>
                            <p className="font-black text-slate-700">{endL.toLocaleString('fr-FR')} L</p>
                          </div>
                          <div className="text-center p-3 bg-green-50 rounded-xl">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Différence</p>
                            <p className="font-black text-green-700">{diff.toFixed(1)} L</p>
                          </div>
                        </div>

                        {ver.corrected && (
                          <div className="mb-3">
                            <label className="text-[9px] font-black text-orange-700 uppercase tracking-widest block mb-1">Valeur corrigée (L)</label>
                            <input type="number" step="0.1" placeholder="Entrer la valeur correcte..."
                              className="w-full px-3 py-2 border-2 border-orange-300 rounded-xl font-bold outline-none focus:ring-2 focus:ring-orange-400"
                              value={ver.correctedValue ?? ''}
                              onChange={e => setCuveVer(prev => ({ ...prev, [tank.id]: { ...ver, correctedValue: parseFloat(e.target.value) || undefined } }))} />
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button onClick={() => setCuveVer(prev => ({ ...prev, [tank.id]: { verified: true, corrected: false } }))}
                            className={cn("flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all", ver.verified && !ver.corrected ? "bg-green-500 text-white" : "border-2 border-green-400 text-green-700 hover:bg-green-50")}>
                            ✓ Conforme
                          </button>
                          <button onClick={() => setCuveVer(prev => ({ ...prev, [tank.id]: { verified: true, corrected: true, correctedValue: ver.correctedValue } }))}
                            className={cn("flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all", ver.corrected ? "bg-red-500 text-white" : "border-2 border-red-400 text-red-700 hover:bg-red-50")}>
                            ✗ Non conforme
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}

            {/* ─── STEP 2: Verify Nozzles ─── */}
            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vérification des Pistolets — confirmez ou corrigez les index de fin</p>
                {/* Une brigade qui n'est plus la dernière garde ses index pour
                    elle — voir `lib/nozzleIndexes.ts`. */}
                {indexesLockedByLater && (
                  <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-300 text-[11px] font-bold text-amber-900 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Cette brigade n'est pas la dernière. Un index corrigé ici reste enregistré sur
                      <b> sa propre fiche</b> — litres, théorique et cuve suivent — mais les compteurs
                      des pistolets, ceux qui servent de départ à la prochaine brigade,
                      <b> ne bougeront pas</b> : ils appartiennent à la dernière brigade relevée.
                    </span>
                  </div>
                )}
                {activeNozzles.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Aucun pistolet actif pour cette brigade</div>}
                {activeNozzles.map(nozzle => {
                  const d = nozzleData.find(x => x.nozzle.id === nozzle.id)!;
                  if (!d) return null;
                  const ver = nozzleVer[nozzle.id] || {};
                  return (
                    <div key={nozzle.id} className={cn("rounded-2xl border-2 overflow-hidden", ver.verified ? "border-green-300" : "border-slate-200")}>
                      <div className="px-5 py-3 bg-gradient-to-r from-purple-900 to-purple-800 flex items-center gap-3">
                        <Zap className="w-4 h-4 text-yellow-400" />
                        <p className="font-black text-white text-sm flex-1">{nozzle.name} <span className="text-purple-300 text-[10px] font-bold ml-2">{d.pump?.name}</span></p>
                        {ver.verified && <span className="px-2 py-0.5 rounded-full bg-green-400 text-green-900 text-[9px] font-black uppercase">✓ Vérifié</span>}
                      </div>
                      <div className="p-4 bg-white">
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <div className="text-center p-3 bg-blue-50 rounded-xl">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Index Début</p>
                            <p className="font-black text-blue-900 tabular-nums">{d.startIdx.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</p>
                          </div>
                          <div className="text-center p-3 bg-slate-50 rounded-xl">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Index Fin</p>
                            <p className="font-black text-slate-700 tabular-nums">{(brigade.endNozzleIndices?.[nozzle.id] ?? d.startIdx).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</p>
                          </div>
                          <div className="text-center p-3 bg-green-50 rounded-xl">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Litres</p>
                            <p className="font-black text-green-700">{d.liters.toFixed(2)} L</p>
                          </div>
                        </div>

                        {ver.corrected && (
                          <div className="mb-3">
                            <label className="text-[9px] font-black text-orange-700 uppercase tracking-widest block mb-1">Index fin corrigé</label>
                            <input type="number" step="0.01"
                              className="w-full px-3 py-2 border-2 border-orange-300 rounded-xl font-bold outline-none focus:ring-2 focus:ring-orange-400"
                              value={ver.correctedValue ?? ''}
                              onChange={e => setNozzleVer(prev => ({ ...prev, [nozzle.id]: { ...ver, correctedValue: parseFloat(e.target.value) || undefined } }))} />
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button onClick={() => setNozzleVer(prev => ({ ...prev, [nozzle.id]: { verified: true, corrected: false } }))}
                            className={cn("flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all", ver.verified && !ver.corrected ? "bg-green-500 text-white" : "border-2 border-green-400 text-green-700 hover:bg-green-50")}>
                            ✓ Conforme
                          </button>
                          <button onClick={() => setNozzleVer(prev => ({ ...prev, [nozzle.id]: { verified: true, corrected: true, correctedValue: ver.correctedValue } }))}
                            className={cn("flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all", ver.corrected ? "bg-red-500 text-white" : "border-2 border-red-400 text-red-700 hover:bg-red-50")}>
                            ✗ Non conforme
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}

            {/* ─── STEP 3: Comparison & Décalage ─── */}
            {step === 3 && (
              <motion.div key="s3" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-6 space-y-5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Comparaison Cuves vs Pistolets & Décalages</p>

                {/* Per-cuve comparison */}
                {tankComparison.map(({ tank, diff, nozzleTotal, ecart, ecartMoney }) => (
                  <div key={tank.id} className={cn("p-5 rounded-2xl border-2", Math.abs(ecart) < 2 ? "border-green-200 bg-green-50" : Math.abs(ecart) < 20 ? "border-yellow-200 bg-yellow-50" : "border-red-200 bg-red-50")}>
                    <div className="flex items-center gap-3 mb-4">
                      <Droplets className="w-5 h-5 text-blue-600" />
                      <p className="font-black text-blue-900 flex-1">{tank.name} · {tank.type}</p>
                      <span className={cn("px-3 py-1 rounded-full text-[10px] font-black", Math.abs(ecart) < 2 ? "bg-green-200 text-green-800" : Math.abs(ecart) < 20 ? "bg-yellow-200 text-yellow-800" : "bg-red-200 text-red-800")}>
                        {Math.abs(ecart) < 2 ? '✓ OK' : ecart > 0 ? '↑ Surplus' : '↓ Manque'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 bg-white rounded-xl"><p className="text-[9px] text-slate-400 uppercase mb-1">Sortie Cuve</p><p className="font-black text-slate-700">{diff.toFixed(1)} L</p></div>
                      <div className="p-3 bg-white rounded-xl"><p className="text-[9px] text-slate-400 uppercase mb-1">Pistolets</p><p className="font-black text-slate-700">{nozzleTotal.toFixed(1)} L</p></div>
                      <div className="p-3 bg-white rounded-xl">
                        <p className="text-[9px] text-slate-400 uppercase mb-1">Écart</p>
                        <p className={cn("font-black", Math.abs(ecart) < 2 ? "text-green-600" : "text-red-600")}>{ecart > 0 ? '+' : ''}{ecart.toFixed(1)} L</p>
                        <p className={cn("text-[10px] font-black", ecartMoney < 0 ? "text-red-500" : "text-green-500")}>{(ecartMoney > 0 ? '+' : '')}{ecartMoney.toFixed(0)} DA</p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Décalage per pompiste */}
                {Object.keys(decalageByPompiste).length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Décalage par Pompiste</p>
                    {(Object.entries(decalageByPompiste) as [string, DecalageEntry][]).map(([pid, d]) => (
                      <div key={pid} className={cn("p-4 rounded-2xl border-2 flex items-center gap-4", d.money < 0 ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50")}>
                        <div className="w-10 h-10 bg-blue-700 text-white rounded-xl flex items-center justify-center font-black">{d.pompiste?.name[0] || '?'}</div>
                        <div className="flex-1">
                          <p className="font-black text-slate-800">{d.pompiste?.name || pid}</p>
                          <p className="text-[10px] text-slate-500">Piste: {d.track?.name || '—'}</p>
                        </div>
                        <div className="text-right">
                          <p className={cn("font-black text-sm", d.liters < 0 ? "text-red-700" : "text-yellow-700")}>{d.liters > 0 ? '+' : ''}{d.liters.toFixed(2)} L</p>
                          <p className={cn("font-black text-xs", d.money < 0 ? "text-red-600" : "text-yellow-600")}>{d.money > 0 ? '+' : ''}{d.money.toFixed(0)} DA</p>
                          <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full", d.money < 0 ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>{d.money < 0 ? 'BONUS' : 'RETENUE'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {Object.keys(decalageByPompiste).length === 0 && tankComparison.every(t => Math.abs(t.ecart) < 2) && (
                  <div className="flex items-center gap-3 p-4 bg-green-50 rounded-2xl border border-green-200">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                    <p className="font-black text-green-700">Aucun décalage détecté — cuves et pistolets en accord</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── STEP 4: Financial Reconciliation ─── */}
            {step === 4 && (
              <motion.div key="s4" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-6 space-y-6">

                {/* Quick synthesis from previous steps */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 text-center">
                    <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1">Cuves vérifiées</p>
                    <p className="text-xl font-black text-blue-900">{(Object.values(cuveVer) as VerEntry[]).filter(v => v.verified).length}/{tankComparison.length}</p>
                    <p className="text-[10px] text-blue-400">{(Object.values(cuveVer) as VerEntry[]).filter(v => v.corrected).length} correction(s)</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100 text-center">
                    <p className="text-[9px] font-black text-purple-600 uppercase tracking-widest mb-1">Pistolets vérifiés</p>
                    <p className="text-xl font-black text-purple-900">{(Object.values(nozzleVer) as VerEntry[]).filter(v => v.verified).length}/{activeNozzles.length}</p>
                    <p className="text-[10px] text-purple-400">{nozzleData.reduce((s, d) => s + d.liters, 0).toFixed(1)} L vendus</p>
                  </div>
                  <div className={cn("p-4 rounded-2xl border text-center", Object.keys(decalageByPompiste).length > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-100")}>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: Object.keys(decalageByPompiste).length > 0 ? '#92400e' : '#166534' }}>Décalages</p>
                    <p className="text-xl font-black" style={{ color: Object.keys(decalageByPompiste).length > 0 ? '#b45309' : '#15803d' }}>
                      {Object.keys(decalageByPompiste).length} agent(s)
                    </p>
                    <p className="text-[10px]" style={{ color: Object.keys(decalageByPompiste).length > 0 ? '#d97706' : '#16a34a' }}>
                      {(Object.values(decalageByPompiste) as DecalageEntry[]).reduce((s, d) => s + d.money, 0).toFixed(0)} DA
                    </p>
                  </div>
                </div>

                {/* Total due banner */}
                <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 rounded-2xl text-center">
                  <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest mb-2">Montant Total Dû</p>
                  <p className="text-4xl font-black text-yellow-400">{totalRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} <span className="text-xl">DA</span></p>
                  <p className="text-[11px] text-blue-300 mt-2">{nozzleData.reduce((s, d) => s + d.liters, 0).toFixed(2)} L vendus</p>
                </div>

                {/* ─── Detailed breakdown: Pompiste → Pompes → Pistolets ─── */}
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Détail par Pompiste / Pompe / Pistolet</p>

                  {pompisteGroups.filter(g => g.present || g.totalLiters > 0).map(group => {
                    const pompiste = group.pompiste;
                    const pompisteTotalLiters = group.totalLiters;
                    const pompisteRevenue = group.totalAmount;
                    const decalage = decalageByPompiste[group.pompisteId];

                    return (
                      <div key={group.pompisteId} className={cn("rounded-2xl border-2 overflow-hidden", group.unassigned ? "border-amber-300" : "border-blue-200")}>
                        {/* Pompiste summary */}
                        <div className={cn("px-5 py-3 flex items-center gap-3", group.unassigned ? "bg-gradient-to-r from-amber-700 to-amber-600" : "bg-gradient-to-r from-blue-900 to-blue-800")}>
                          <div className="w-9 h-9 bg-yellow-400 text-blue-900 rounded-xl flex items-center justify-center font-black text-sm shrink-0">
                            {group.name[0] || '?'}
                          </div>
                          <div className="flex-1">
                            <p className="font-black text-white text-sm">{group.name}</p>
                            <p className="text-[10px] text-blue-300">
                              {group.pumps.map(p => p.pump?.name || p.pump?.number || '—').join(', ') || 'aucune pompe'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-black text-yellow-400 text-lg">{pompisteRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</p>
                            <p className="text-[10px] text-blue-300">{pompisteTotalLiters.toFixed(2)} L</p>
                          </div>
                        </div>

                        {/* Ventilation par carburant — un pompiste sert souvent
                            plusieurs carburants, chacun à son propre prix. */}
                        {group.byFuel.length > 0 && (
                          <div className="px-4 py-2 bg-blue-50/60 border-b border-blue-100 flex flex-wrap gap-2">
                            {group.byFuel.map(f => (
                              <span key={f.fuelType} className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black border",
                                f.fuelType === 'INCONNU' ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-blue-200 text-blue-900")}>
                                {f.fuelType === 'INCONNU' ? 'CUVE NON DÉFINIE' : f.fuelType}
                                <span className="font-bold text-slate-500"> · {f.liters.toFixed(2)} L × {f.price.toFixed(2)} = </span>
                                <span className="text-green-700">{f.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Per-Pompe breakdown */}
                        <div className="p-4 space-y-3 bg-slate-50">
                          {group.pumps.map(({ pump, nozzles: pumpNozzles, totalLiters: pumpLiters, totalAmount: pumpRevenue, byFuel: pumpFuels }) => {
                            if (pumpNozzles.length === 0) return null;
                            return (
                              <div key={pump?.id || 'sans-pompe'} className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                                {/* Pump header */}
                                <div className="px-4 py-2 bg-slate-100 flex items-center justify-between border-b border-slate-200">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black text-slate-500 uppercase">🔧 {pump?.name || 'Pompe supprimée'}</span>
                                    {/* Les carburants réellement servis, et non le
                                        type de la pompe qui ne reflète que son
                                        premier pistolet. */}
                                    {pumpFuels.map(f => (
                                      <span key={f.fuelType} className="text-[9px] px-2 py-0.5 bg-slate-200 rounded-full text-slate-600 font-bold">{f.fuelType}</span>
                                    ))}
                                  </div>
                                  <div className="text-right">
                                    <span className="font-black text-slate-700 text-sm">{pumpRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</span>
                                    <span className="text-[10px] text-slate-400 ml-2">{pumpLiters.toFixed(2)} L</span>
                                  </div>
                                </div>

                                {/* Per-Nozzle/Pistolet rows */}
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-slate-50">
                                      <th className="px-3 py-1.5 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Pistolet</th>
                                      <th className="px-3 py-1.5 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Carburant</th>
                                      <th className="px-3 py-1.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Idx Début</th>
                                      <th className="px-3 py-1.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Idx Fin</th>
                                      <th className="px-3 py-1.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Différence (L)</th>
                                      <th className="px-3 py-1.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Prix/L</th>
                                      <th className="px-3 py-1.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Montant</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {pumpNozzles.map(d => (
                                      <tr key={d.nozzle.id}>
                                        <td className="px-3 py-2 font-bold text-slate-700">⚡ {d.nozzle.name}</td>
                                        <td className="px-3 py-2">
                                          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black", d.missingFuelType ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-800")}>
                                            {d.fuelType || 'CUVE NON DÉFINIE'}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 text-xs">{d.startIdx.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 text-xs">{d.endIdx.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                                        <td className={cn("px-3 py-2 text-right font-black", d.inverted ? "text-red-600" : "text-blue-700")}>
                                          {d.liters.toFixed(2)} L
                                          {d.inverted && <span className="block text-[9px] font-bold">index de fin &lt; début</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 text-xs">{d.price.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-right font-black text-green-700">{d.revenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-slate-100 font-black">
                                      <td colSpan={4} className="px-3 py-2 text-[10px] uppercase text-slate-500">Total Pompe {pump?.name || ''}</td>
                                      <td className="px-3 py-2 text-right text-blue-800">{pumpLiters.toFixed(2)} L</td>
                                      <td />
                                      <td className="px-3 py-2 text-right text-green-800">{pumpRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            );
                          })}

                          {/* Total pompiste + décalage */}
                          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 rounded-xl border border-blue-200">
                            <span className="text-[10px] font-black text-blue-900 uppercase tracking-widest">Total {group.name}</span>
                            <div className="text-right">
                              <p className="font-black text-blue-900">{pompisteRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</p>
                              <p className="text-[10px] text-blue-500">{pompisteTotalLiters.toFixed(2)} L</p>
                            </div>
                          </div>

                          {/* Décalage indicator */}
                          {decalage && Math.abs(decalage.money) > 0.01 && (
                            <div className={cn("flex items-center justify-between px-4 py-2 rounded-xl border",
                              decalage.money < 0 ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"
                            )}>
                              <span className={cn("text-[10px] font-black uppercase", decalage.money < 0 ? "text-red-700" : "text-yellow-700")}>
                                {decalage.money < 0 ? '📉 Décalage (Retenue)' : '📈 Décalage (Bonus)'}
                              </span>
                              <div className="text-right">
                                <p className={cn("font-black", decalage.money < 0 ? "text-red-700" : "text-yellow-700")}>
                                  {decalage.money > 0 ? '+' : ''}{decalage.money.toFixed(2)} DA
                                </p>
                                <p className="text-[10px] text-slate-400">{decalage.liters > 0 ? '+' : ''}{decalage.liters.toFixed(2)} L</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Grand total row */}
                  <div className="flex items-center justify-between p-5 bg-gradient-to-r from-blue-900 to-blue-800 rounded-2xl">
                    <span className="font-black text-white uppercase tracking-widest text-sm">Total Général Brigade</span>
                    <div className="text-right">
                      <p className="font-black text-yellow-400 text-2xl">{totalRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</p>
                      <p className="text-blue-300 text-[11px]">{nozzleData.reduce((s, d) => s + d.liters, 0).toFixed(2)} L vendus</p>
                    </div>
                  </div>
                </div>

                {/* Cash received */}
                <div className="p-5 bg-green-50 rounded-2xl border-2 border-green-200">
                  <label className="text-[10px] font-black text-green-700 uppercase tracking-widest mb-2 block">Espèces Reçues du Chef (DA)</label>
                  <input type="number" step="0.01" placeholder="0.00"
                    className="w-full px-4 py-3 bg-white border-2 border-green-300 rounded-xl font-bold text-xl outline-none focus:ring-2 focus:ring-green-400"
                    value={cashReceived || ''}
                    onChange={e => setCashReceived(parseFloat(e.target.value) || 0)} />
                </div>

                {/* ─── Justification Mode Selector ─── */}
                <div className="space-y-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Justification du Reste</p>

                  {/* Mode tabs */}
                  <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl">
                    {(['EXPENSE', 'TAG', 'TPE'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setJustifMode(mode)}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all",
                          justifMode === mode
                            ? "bg-blue-900 text-yellow-400 shadow-sm"
                            : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {mode === 'EXPENSE' ? '🧾 Dépense' : mode === 'TAG' ? '🏷️ Bon/Tag' : '💳 TPE'}
                      </button>
                    ))}
                  </div>

                  {/* EXPENSE mode — une charge payée sur les espèces de la brigade */}
                  {justifMode === 'EXPENSE' && (
                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-3">
                      <p className="text-[10px] font-black text-emerald-900 uppercase tracking-widest">Dépense de la brigade</p>
                      <div>
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Nom de la dépense *</label>
                        <input
                          type="text"
                          placeholder="Ex: Achat d'eau, réparation, pourboire..."
                          value={expName}
                          onChange={e => setExpName(e.target.value)}
                          className="w-full px-3 py-2.5 border border-emerald-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400 bg-white" />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Description (optionnel)</label>
                        <input
                          type="text"
                          placeholder="Précisions sur la dépense..."
                          value={expDesc}
                          onChange={e => setExpDesc(e.target.value)}
                          className="w-full px-3 py-2.5 border border-emerald-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400 bg-white" />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Catégorie (optionnel)</label>
                        <select
                          value={expCategory}
                          onChange={e => setExpCategory(e.target.value)}
                          className="w-full px-3 py-2.5 border border-emerald-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400 bg-white">
                          <option value="">— Aucune —</option>
                          {(settings.expenseCategories || []).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Montant (DA) *</label>
                          <input type="number" step="0.01" placeholder="0.00"
                            className="w-full px-3 py-2.5 border border-emerald-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                            value={expAmount}
                            onChange={e => setExpAmount(parseFloat(e.target.value) || '')} />
                        </div>
                        <button onClick={addExpenseJustification}
                          disabled={!expName.trim() || !expAmount || +expAmount <= 0}
                          className="px-4 py-2.5 bg-emerald-600 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase hover:bg-emerald-700 transition-colors flex items-center gap-1 shrink-0">
                          <Plus className="w-3.5 h-3.5" /> Ajouter
                        </button>
                      </div>
                      <p className="text-[9px] font-bold text-slate-400">
                        La dépense justifie le reste au même titre qu'un bon : elle sort des espèces de la
                        brigade, et sera enregistrée dans l'écran Dépenses (Carburant) au nom de cette brigade.
                      </p>
                    </div>
                  )}

                  {/* TAG / TPE mode — fuel-based form */}
                  {(justifMode === 'TAG' || justifMode === 'TPE') && (
                    <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-200 space-y-3">
                      <p className="text-[10px] font-black text-amber-900 uppercase tracking-widest">
                        {justifMode === 'TAG' ? 'Bon / Tag' : 'Transaction TPE'}
                      </p>

                      {/* Compte crédité — c'est LUI qui reçoit l'argent du terminal.
                          Sans ce choix, la justification comptait comme encaissée
                          sans qu'aucun solde bancaire ne bouge. */}
                      <div>
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Compte bancaire crédité</label>
                        {bankAccounts.length === 0 ? (
                          <p className="text-[10px] font-bold text-orange-600">
                            Aucun compte bancaire — créez-en un dans Finance → Comptes Bancaires.
                          </p>
                        ) : (
                          <select
                            value={tpeBankAccountId}
                            onChange={e => setTpeBankAccountId(e.target.value)}
                            className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                          >
                            <option value="">— Choisir le compte —</option>
                            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        )}
                      </div>

                      {/* Optional client name */}
                      <div>
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Nom du Client (optionnel)</label>
                        <input
                          type="text"
                          placeholder="Nom du client..."
                          value={tpeClientName}
                          onChange={e => setTpeClientName(e.target.value)}
                          className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        />
                      </div>

                      {/* Fuel type selector */}
                      <div>
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Type Carburant</label>
                        <select
                          value={tpeFuelType}
                          onChange={e => setTpeFuelType(e.target.value)}
                          className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        >
                          {Object.entries(settings.fuelPrices).map(([type, price]) => (
                            <option key={type} value={type}>{type} — {Number(price).toFixed(2)} DA/L</option>
                          ))}
                        </select>
                      </div>

                      {/* Liters input with auto-calculated total */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Quantité (Litres)</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={tpeLiters}
                            onChange={e => setTpeLiters(parseFloat(e.target.value) || '')}
                            className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Montant Calculé</label>
                          <div className="px-3 py-2.5 bg-amber-100 border-2 border-amber-300 rounded-xl">
                            <span className="font-black text-amber-900">{tpeAutoAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</span>
                          </div>
                        </div>
                      </div>

                      {/* Optional: which track/pompiste */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Piste (optionnel)</label>
                          <select
                            value={tpeTrackId}
                            onChange={e => setTpeTrackId(e.target.value)}
                            className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                          >
                            <option value="">— Toutes les pistes —</option>
                            {tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Pompiste (optionnel)</label>
                          <select
                            value={tpePompisteId}
                            onChange={e => setTpePompisteId(e.target.value)}
                            className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                          >
                            <option value="">— Tous les pompistes —</option>
                            {pompistes.filter(p => brigade.pompisteIds?.includes(p.id)).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <button
                        onClick={addTpeJustification}
                        disabled={!tpeLiters || +tpeLiters <= 0}
                        className="w-full py-2.5 bg-amber-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase hover:bg-amber-600 transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Ajouter {justifMode === 'TAG' ? 'Bon/Tag' : 'Transaction TPE'}
                      </button>
                    </div>
                  )}

                  {/* Combined justification list (all types) */}
                  {justifications.map(j => {
                    const client = clients.find(c => c.id === j.clientId);
                    const isTPE = j.justificationType === 'TPE' || j.justificationType === 'TAG';
                    const isExpense = j.justificationType === 'EXPENSE';
                    return (
                      <div key={j.id} className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border",
                        isTPE ? "bg-amber-50 border-amber-200" : isExpense ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"
                      )}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shrink-0"
                          style={{ background: isTPE ? '#f59e0b20' : isExpense ? '#10b98120' : '#dbeafe', color: isTPE ? '#b45309' : isExpense ? '#047857' : '#1e40af' }}>
                          {j.justificationType === 'TPE' ? '💳' : j.justificationType === 'TAG' ? '🏷️' : isExpense ? '🧾' : '👤'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-slate-800 text-sm">
                            {isExpense ? (j.clientName || 'Dépense') : isTPE ? (j.clientName || `Sans nom · ${j.fuelType}`) : (client?.name || j.clientId)}
                          </p>
                          {isExpense ? (
                            <p className="text-[10px] text-slate-400">
                              {j.expenseCategory || 'Dépense de brigade'}{j.notes ? ` · ${j.notes}` : ''}
                            </p>
                          ) : isTPE ? (
                            <p className="text-[10px] text-slate-400">{j.liters?.toFixed(2)} L × {j.pricePerLiter?.toFixed(2)} DA/L</p>
                          ) : (
                            <p className="text-[10px] text-slate-400">
                              {client?.type} · {client?.paymentMode}
                              {client && (
                                <span className={cn("ml-1.5 font-black", standingOf(client).debt > 0 ? "text-red-500" : "text-slate-400")}>
                                  · Dette {money0(standingOf(client).debt)}
                                </span>
                              )}
                            </p>
                          )}
                          {/* Le compte crédité se change ici : une justification reprise
                              d'une ancienne brigade n'en porte encore aucun. */}
                          {isTPE && bankAccounts.length > 0 && (
                            <select
                              value={j.bankAccountId || ''}
                              onChange={e => setJustifications(prev => prev.map(x =>
                                x.id === j.id ? { ...x, bankAccountId: e.target.value || undefined } : x))}
                              className={cn("mt-1 w-full px-2 py-1 rounded-lg border text-[10px] font-bold outline-none bg-white",
                                j.bankAccountId ? "border-amber-200 text-slate-600" : "border-red-300 text-red-600")}
                            >
                              <option value="">— Compte à choisir —</option>
                              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          )}
                        </div>
                        <p className="font-black text-blue-700">{j.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</p>
                        <button
                          onClick={() => setJustifications(prev => prev.filter(x => x.id !== j.id))}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}

                  {justifications.length > 0 && (
                    <div className="flex justify-between px-3 pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total justifié</span>
                      <span className="font-black text-blue-700">{justifiedTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA</span>
                    </div>
                  )}
                </div>

                {/* Reste */}
                <div className={cn("p-5 rounded-2xl border-2 text-center", Math.abs(reste) < 1 ? "bg-green-50 border-green-200" : reste > 0 ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200")}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-slate-500">
                    {Math.abs(reste) < 1 ? '✓ Soldé' : reste > 0 ? 'Reste à Justifier' : 'Excédent'}
                  </p>
                  <p className={cn("text-3xl font-black", Math.abs(reste) < 1 ? "text-green-700" : reste > 0 ? "text-red-700" : "text-yellow-700")}>
                    {reste > 0 ? '+' : ''}{reste.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DA
                  </p>
                </div>

                {/* Assign rest to pompiste */}
                {Math.abs(reste) > 0.01 && (
                  <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-200 space-y-3">
                    <p className="text-[10px] font-black text-amber-900 uppercase tracking-widest">Affecter le décalage à un agent</p>
                    <select value={restAssignedWorkerId} onChange={e => {
                        const id = e.target.value;
                        setRestAssignedWorkerId(id);
                        if (!id) setRestAssignedWorkerType('');
                        else if (chef && id === chef.id) setRestAssignedWorkerType('chef_brigade');
                        else setRestAssignedWorkerType('pompiste');
                      }}
                      className="w-full px-3 py-2.5 border border-amber-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                      <option value="">— Sélectionner un agent —</option>
                      <optgroup label="Pompistes">
                        {pompistes.filter(p => brigade.pompisteIds?.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                      {chef && <optgroup label="Chef de Brigade"><option value={chef.id}>{chef.name} (Chef)</option></optgroup>}
                    </select>
                  </div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-3 shrink-0">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)}
              className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-900 border-2 border-blue-900 rounded-xl hover:bg-blue-50 transition-colors bg-white">
              ← Retour
            </button>
          )}
          {step < 4 ? (
            <button onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !allCuvesVerified) || (step === 2 && !allNozzlesVerified)}
              className="flex-1 bg-gradient-to-r from-blue-900 to-blue-800 disabled:opacity-50 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-xl py-2.5 transition-all hover:-translate-y-0.5 text-[10px] flex items-center justify-center gap-2">
              Suivant <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSave}
              className="flex-1 bg-gradient-to-r from-green-700 to-emerald-600 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-xl py-2.5 transition-all hover:-translate-y-0.5 text-[10px] flex items-center justify-center gap-2">
              <CheckCircle className="w-4 h-4" />
              {existingAccounting ? 'MODIFIER LA COMPTABILITÉ' : 'ENREGISTRER LA COMPTABILITÉ'}
            </button>
          )}
        </div>
      </motion.div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>

      {/* Create-new-client mini-modal */}
      <AnimatePresence>
        {showCreateClientModal && (
          <div className="modal-shell z-[80]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowCreateClientModal(false)}
              className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="bg-gradient-to-r from-blue-900 to-blue-800 text-white px-5 py-4 flex items-center justify-between">
                <h3 className="font-black text-sm uppercase tracking-widest">Nouveau Client</h3>
                <button onClick={() => setShowCreateClientModal(false)} className="p-1.5 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Nom *</label>
                  <input type="text" value={newClientForm.name}
                    onChange={e => setNewClientForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Nom du client" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Téléphone</label>
                    <input type="text" value={newClientForm.phone}
                      onChange={e => setNewClientForm(f => ({ ...f, phone: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="0555..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">CIN</label>
                    <input type="text" value={newClientForm.cin}
                      onChange={e => setNewClientForm(f => ({ ...f, cin: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="CIN" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Type</label>
                    <select value={newClientForm.type}
                      onChange={e => setNewClientForm(f => ({ ...f, type: e.target.value as any }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                      <option value="PARTICULIER">Particulier</option>
                      <option value="ENTREPRISE">Entreprise</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Mode Paiement</label>
                    <select value={newClientForm.paymentMode}
                      onChange={e => setNewClientForm(f => ({ ...f, paymentMode: e.target.value as any }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                      <option value="CASH">Comptant</option>
                      <option value="CREDIT">Crédit</option>
                      <option value="ADVANCE">Avances</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setShowCreateClientModal(false)}
                    className="flex-1 py-2.5 border-2 border-slate-200 rounded-xl text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50">
                    Annuler
                  </button>
                  <button onClick={handleCreateClient}
                    disabled={!newClientForm.name.trim()}
                    className="flex-1 py-2.5 bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase hover:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Créer & Sélectionner
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BrigadeAccountingModal;
