import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { 
  Plus, 
  Search, 
  CreditCard, 
  Wallet, 
  History, 
  AlertCircle, 
  Edit2, 
  Trash2, 
  Eye, 
  X, 
  Phone, 
  CheckCircle2, 
  TrendingUp, 
  FileText, 
  Printer, 
  ArrowUpRight, 
  ArrowDownRight,
  Download,
  Building2,
  User as UserIcon,
  IdCard as IdCardIcon,
  ChevronRight,
  Upload,
  Save,
  AlertTriangle,
  ShieldCheck,
  DollarSign,
  Calendar,
  Lock,
  Filter,
  Clock,
  Grid,
  List as ListIcon,
  ChevronDown,
  Loader2,
  MoreVertical,
  Mail,
  FileBarChart,
  Flag,
  Pencil
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId, matchesSearch } from "@/src/lib/utils";
import { useAppState, useAppDispatch, useModulePermission, Client, bankBalanceOf, TreasuryTransaction, CAISSE_PART_ID } from "../store/AppContext";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import { printPaymentReceipt, stationFromSettings } from "./modules/_shared";
import { clientLedger, clientLedgers, clientOpening, advanceAvailable, advanceColumnsDisagree, ClientEntry, ClientLedger } from "../lib/clientLedger";
import { fuelClientStatement, StatementPayment } from "../lib/clientStatement";
import ClientReportModal from "../components/biz/ClientReportModal";
import { ClientStatementFiche } from "../components/biz/ClientStatementFiche";
import { printFiche } from "../components/biz/ReportFiche";
import ClientDossier from "../components/clients/ClientDossier";

/** Receipt number of a debt payment, derived from its transaction id. */
const receiptRef = (txId: string) => `REG-${txId.slice(0, 8).toUpperCase()}`;

const PAYMENT_MODE_LABEL: Record<string, string> = {
  ESPECES: "Espèces", CHEQUE: "Chèque", VIREMENT: "Virement", TPE: "Carte / TPE",
  CREDIT: "À crédit", AVANCE: "Sur avance", CASH: "Espèces", BON: "Bon",
};

/** Le mode de règlement d'un client, dit en français. */
const MODE_LABEL: Record<string, string> = {
  CASH: 'Comptant', CREDIT: 'À crédit', ADVANCE: 'Sur avance',
};

/**
 * Ce qu'un client peut régler aujourd'hui.
 *
 * Deux chiffres racontent sa dette : la colonne `debt` de sa fiche — un compteur
 * tenu au fil de l'eau — et ce que ses PIÈCES disent. Le second fait foi
 * partout à l'écran ; mais tant qu'ils diffèrent (reprise d'ouverture, brigade
 * corrigée après coup), plafonner la saisie au plus petit des deux reviendrait
 * à refuser un règlement que le client est venu payer. On retient donc le plus
 * grand : c'est une borne de saisie, pas un montant imposé.
 */
const payableDebt = (client: Client | null, ledger: ClientLedger): number =>
  Math.max(0, Math.max(client?.debt || 0, ledger.debtFromDocuments));

const Clients = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useAppState();
  const { clients, settings, currentUserName, bankAccounts, treasuryTransactions } = state;
  const perm = useModulePermission('Clients');
  const dispatch = useAppDispatch();

  // Bank accounts with their live solde — used to route a TPE (card) règlement
  // to the account behind the terminal, exactly like the « Comptes Bancaires » screen.
  const liveBankAccounts = useMemo(
    () => bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, treasuryTransactions) })),
    [bankAccounts, treasuryTransactions],
  );

  // Layout and filter states
  // Tableau par défaut : le fichier client se balaie en lignes — nom, dette,
  // solde. Les cartes restent à un clic.
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState("Tous");
  const [selectedMode, setSelectedMode] = useState("Tous");
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Modals state
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showFiscalSection, setShowFiscalSection] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("resume");
  /** Client dont on édite le relevé de compte sur une période choisie. */
  const [reportClient, setReportClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  /** Le mouvement de compte qu'on corrige, et celui qu'on s'apprête à effacer. */
  const [editingTx, setEditingTx] = useState<any>(null);
  const [txForm, setTxForm] = useState({ amount: 0, date: "", mode: "ESPECES", receiptNumber: "", notes: "" });
  const [txToDelete, setTxToDelete] = useState<any>(null);
  /** La reprise d'ouverture du compte, éditée depuis le dossier. */
  const [showOpening, setShowOpening] = useState(false);
  const [openingForm, setOpeningForm] = useState({ debt: 0, advance: 0, date: "", notes: "" });
  const [isLoading, setIsLoading] = useState(false);
  /** La feuille A4 du relevé, imprimée depuis le dossier. */
  const dossierFicheRef = React.useRef<HTMLDivElement>(null);

  /**
   * ─── Une fiche vierge ──────────────────────────────────────────────────
   *
   * Trois boutons ouvraient « Nouveau client » et remettaient le formulaire à
   * zéro chacun à sa façon — aucun des trois ne réinitialisait la REPRISE.
   * Après avoir ouvert la fiche d'un client prépayé pour la modifier, créer un
   * client repartait donc avec l'avance initiale du précédent déjà inscrite :
   * un compte naissait avec l'argent de quelqu'un d'autre au crédit, sans que
   * rien à l'écran ne le signale. Le formulaire n'a plus qu'un seul état vide.
   */
  const blankClientForm = (): Partial<Client> => ({
    name: "",
    type: "PARTICULIER",
    paymentMode: "CASH",
    phone: "",
    email: "",
    cin: "",
    address: "",
    contactPerson: "",
    creditLimit: 0,
    paymentDelay: 0,
    balance: 0,
    debt: 0,
    openingDebt: 0,
    openingAdvance: 0,
    openingDate: new Date().toISOString().split("T")[0],
    openingNotes: "",
    nif: "",
    nis: "",
    article: "",
    rc: ""
  });

  // Form States
  const [clientForm, setClientForm] = useState<Partial<Client>>(blankClientForm);

  const [rechargeForm, setRechargeForm] = useState({
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    // Une recharge est de l'argent que le client REMET : elle doit dire par quel
    // moyen, sinon on ne sait pas dans quel compte le déposer.
    mode: "ESPECES",
    bankAccountId: "",
    chequeNumber: "",
    notes: "",
    receiptPhoto: ""
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    mode: "ESPECES",
    chequeNumber: "",
    bankAccountId: "",
    notes: ""
  });

  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [appointmentForm, setAppointmentForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: 0,
    linkedSaleId: "",
    notes: ""
  });

  // Close actions dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = () => setActionMenuOpen(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  // The opened client is a local snapshot: re-sync it whenever the store moves,
  // so a règlement saved from a modal shows the debt and the history the server
  // actually holds (the payment is re-read from `client_transactions`).
  useEffect(() => {
    setSelectedClient(prev => (prev ? clients.find(c => c.id === prev.id) ?? prev : prev));
  }, [clients]);

  const handleSaveClient = () => {
    if (!clientForm.name) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Le nom est obligatoire" } });
      return;
    }

    if (clientForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientForm.email)) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Email invalide" } });
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const openDebt = Math.max(0, clientForm.openingDebt || 0);
      const openAdv = Math.max(0, clientForm.openingAdvance || 0);

      if (selectedClient) {
        // ── Corriger une reprise ────────────────────────────────────────────
        // Les compteurs de la fiche (`debt`, `balance`, `advanceBalance`) portent
        // la reprise EN PLUS de tout ce qui a bougé depuis. On ne les réécrit
        // donc pas : on leur applique la seule DIFFÉRENCE, sinon corriger une
        // dette initiale effacerait au passage tous les bons et tous les
        // règlements enregistrés depuis l'ouverture du compte.
        const wasDebt = Math.max(0, selectedClient.openingDebt || 0);
        const wasAdv = Math.max(0, selectedClient.openingAdvance || 0);
        const updated: Client = {
          ...selectedClient, ...clientForm,
          openingDebt: openDebt,
          openingAdvance: openAdv,
          debt: Math.max(0, (selectedClient.debt || 0) + (openDebt - wasDebt)),
          balance: Math.max(0, (selectedClient.balance || 0) + (openAdv - wasAdv)),
          advanceBalance: Math.max(0, (selectedClient.advanceBalance ?? selectedClient.balance ?? 0) + (openAdv - wasAdv)),
        } as Client;
        dispatch({ type: 'UPDATE_CLIENT', payload: updated });
        setSelectedClient(updated);
        dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client mis à jour" } });
      } else {
        const newClient: Client = {
          ...clientForm as Client,
          id: newId(),
          // Les deux colonnes de l'avance partent de la MÊME valeur : sinon un
          // client naissait avec un solde d'ouverture que la consommation des
          // bons ne pouvait pas entamer.
          balance: openAdv,
          advanceBalance: openAdv,
          // La reprise vit désormais À DEUX endroits qui se relisent : le
          // compteur `debt` de la fiche, et la ligne d'ouverture du journal
          // (`openingDebt`) que l'historique, les cartes et les rapports lisent.
          // N'écrire que le premier revenait à saisir une dette que rien
          // n'affichait nulle part.
          debt: openDebt,
          openingDebt: openDebt,
          openingAdvance: openAdv,
          openingDate: clientForm.openingDate || new Date().toISOString().split("T")[0],
          transactionHistory: []
        };
        dispatch({ type: 'ADD_CLIENT', payload: newClient });
        dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client ajouté" } });
      }
      setIsLoading(false);
      setShowModal(false);
    }, 800);
  };

  const handleDeleteClient = () => {
    if (!clientToDelete) return;
    setIsLoading(true);

    setTimeout(() => {
      dispatch({ type: 'DELETE_CLIENT', payload: clientToDelete.id });
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client supprimé" } });
      setIsLoading(false);
      setClientToDelete(null);
    }, 800);
  };

  /**
   * ─── Corriger un mouvement du compte client ──────────────────────────────
   *
   * L'historique se lisait, il ne se corrigeait pas. Un règlement saisi à 3 000
   * au lieu de 2 000 ne pouvait être rattrapé qu'en en créant un second, en
   * sens inverse — et le compte du client montrait alors deux opérations là où
   * il n'y en avait jamais eu qu'une.
   *
   * La ligne de TRÉSORERIE suit le règlement : c'est le même argent. Sans quoi
   * la dette serait corrigée à l'écran mais la caisse garderait l'ancien montant.
   */
  const saveEditedTx = () => {
    if (!selectedClient || !editingTx) return;
    const amount = Math.max(0, txForm.amount || 0);
    if (amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Montant invalide" } });
      return;
    }
    const payment = {
      id: editingTx.id,
      date: txForm.date,
      type: editingTx.type,
      amount,
      mode: txForm.mode,
      receiptNumber: txForm.receiptNumber || undefined,
      receiptPhoto: editingTx.receiptPhoto,
      notes: txForm.notes || undefined,
    };
    dispatch({ type: 'UPDATE_CLIENT_PAYMENT', payload: { clientId: selectedClient.id, payment, previousAmount: Number(editingTx.amount) || 0 } });

    const tx = treasuryTransactions.find(t => t.refType === 'client_payment' && t.refId === editingTx.id);
    if (tx) {
      dispatch({ type: 'UPDATE_TREASURY_TX', payload: {
        ...tx,
        amount,
        date: new Date(txForm.date).toISOString(),
        chequeNumber: txForm.mode === 'CHEQUE' ? (txForm.receiptNumber || undefined) : tx.chequeNumber,
      } });
    }
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Mouvement corrigé" } });
    setEditingTx(null);
  };

  /** Effacer un mouvement — et l'argent qu'il avait fait entrer en caisse. */
  const deleteTx = () => {
    if (!selectedClient || !txToDelete) return;
    dispatch({ type: 'DELETE_CLIENT_PAYMENT', payload: { clientId: selectedClient.id, paymentId: txToDelete.id } });
    const tx = treasuryTransactions.find(t => t.refType === 'client_payment' && t.refId === txToDelete.id);
    if (tx) dispatch({ type: 'DELETE_TREASURY_TX', payload: tx.id });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Mouvement supprimé" } });
    setTxToDelete(null);
  };

  /**
   * Le mouvement d'origine d'une ligne de règlement du dossier. Le journal
   * préfixe l'identifiant de la pièce (`pay-`, `rec-`) : sans ce décodage, un
   * bouton « corriger » ne saurait pas quelle ligne de `client_transactions`
   * il doit reprendre.
   */
  const txOfPayment = (payment: StatementPayment) => {
    const raw = String(payment.lineId || '').replace(/^(pay|rec|tx)-/, '');
    return (selectedClient?.transactionHistory || []).find(t => t.id === raw) || null;
  };

  /** Ouvre la reprise d'ouverture du compte, préremplie de ce qu'elle vaut. */
  const openOpeningEditor = (client: Client, adopt = 0) => {
    const op = clientOpening(client as any);
    setOpeningForm({
      debt: adopt > 0 ? Math.max(0, op.debt + adopt) : op.debt,
      advance: op.advance,
      date: (client.openingDate || client.createdAt || new Date().toISOString()).split('T')[0],
      notes: client.openingNotes || '',
    });
    setShowOpening(true);
  };

  /** Enregistre la reprise — et reporte la DIFFÉRENCE sur les compteurs. */
  const saveOpening = () => {
    if (!selectedClient) return;
    const debt = Math.max(0, openingForm.debt || 0);
    const advance = Math.max(0, openingForm.advance || 0);
    const wasDebt = Math.max(0, selectedClient.openingDebt || 0);
    const wasAdv = Math.max(0, selectedClient.openingAdvance || 0);
    const updated: Client = {
      ...selectedClient,
      openingDebt: debt,
      openingAdvance: advance,
      openingDate: openingForm.date,
      openingNotes: openingForm.notes || undefined,
      debt: Math.max(0, (selectedClient.debt || 0) + (debt - wasDebt)),
      balance: Math.max(0, (selectedClient.balance || 0) + (advance - wasAdv)),
      advanceBalance: Math.max(0, (selectedClient.advanceBalance ?? selectedClient.balance ?? 0) + (advance - wasAdv)),
    };
    dispatch({ type: 'UPDATE_CLIENT', payload: updated });
    setSelectedClient(updated);
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Reprise d'ouverture enregistrée" } });
    setShowOpening(false);
  };

  /**
   * Recharge d'avance. `ADD_CLIENT_PAYMENT` is used (and not `UPDATE_CLIENT`)
   * because it is the only action that writes the movement to the
   * `client_transactions` table — `UPDATE_CLIENT` persists the client columns
   * only, so the history would be lost on the next reload.
   */
  const handleRecharge = () => {
    if (!selectedClient || rechargeForm.amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Montant invalide" } });
      return;
    }
    // Payée autrement qu'en espèces, la recharge atterrit sur un compte
    // bancaire : sans compte choisi, l'argent n'irait nulle part.
    //
    // En espèces, elle tombe dans le coffre du CARBURANT — pas dans le tiroir
    // commun. C'est l'activité qui tient ce client, c'est donc sa caisse qui
    // grossit ; la caisse générale, elle, est la somme des trois activités
    // (voir `Caisse Générale`), l'argent y est donc compté de toute façon.
    const rechargeAccount = rechargeForm.mode === 'ESPECES'
      ? CAISSE_PART_ID.carburant
      : rechargeForm.bankAccountId;
    if (!rechargeAccount) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Choisissez le compte bancaire qui reçoit la recharge" } });
      return;
    }

    const payment = {
      id: newId(),
      date: rechargeForm.date,
      type: "RECHARGE" as const,
      amount: rechargeForm.amount,
      mode: rechargeForm.mode,
      receiptNumber: rechargeForm.chequeNumber || undefined,
      receiptPhoto: rechargeForm.receiptPhoto,
      notes: rechargeForm.notes,
    };

    dispatch({ type: 'ADD_CLIENT_PAYMENT', payload: { clientId: selectedClient.id, payment } });

    // ── La recharge entre dans la trésorerie ────────────────────────────────
    // Le client vient de remettre de l'argent : il doit arriver quelque part.
    // Aucune ligne n'était écrite — la station encaissait une avance sans que
    // la moindre caisse ne bouge, et le tiroir était plus plein que le solde
    // affiché. Même route qu'un règlement de dette.
    const rechargeTx: TreasuryTransaction = {
      id: newId(),
      date: new Date(rechargeForm.date).toISOString(),
      kind: 'SALE',
      amount: rechargeForm.amount,
      description: [
        `Recharge avance client — ${selectedClient.name}`,
        PAYMENT_MODE_LABEL[rechargeForm.mode] || rechargeForm.mode,
      ].filter(Boolean).join(' · '),
      accountTo: rechargeAccount,
      part: 'carburant',
      refType: 'client_payment',
      refId: payment.id,
      chequeNumber: rechargeForm.mode === 'CHEQUE' ? (rechargeForm.chequeNumber || undefined) : undefined,
      createdBy: currentUserName,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_TREASURY_TX', payload: rechargeTx });

    const destinationLabel = rechargeForm.mode === 'ESPECES'
      ? 'la caisse Carburant'
      : (liveBankAccounts.find(a => a.id === rechargeAccount)?.name || 'le compte choisi');
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Avance rechargée sur ${destinationLabel} : +${rechargeForm.amount.toLocaleString()} DA` } });
    setShowRecharge(false);
    setSelectedClient({
      ...selectedClient,
      balance: selectedClient.balance + rechargeForm.amount,
      advanceBalance: (selectedClient.advanceBalance ?? selectedClient.balance) + rechargeForm.amount,
      transactionHistory: [...(selectedClient.transactionHistory || []), payment],
    });
    setRechargeForm({
      amount: 0, date: new Date().toISOString().split("T")[0],
      mode: "ESPECES", bankAccountId: liveBankAccounts[0]?.id || "", chequeNumber: "",
      notes: "", receiptPhoto: "",
    });
  };

  /**
   * Prints the receipt of one debt payment. `debtBefore` is only known for the
   * payment being recorded right now; on a reprint of an older règlement the
   * encours has moved since, so the before/after block is simply left out
   * rather than reconstructed from an approximation.
   */
  const printReceipt = (client: Client, tx: NonNullable<Client['transactionHistory']>[number], debtBefore?: number) => {
    printPaymentReceipt({
      title: "Reçu de règlement",
      ref: receiptRef(tx.id),
      date: tx.date,
      station: stationFromSettings(settings),
      party: {
        label: "Client",
        name: client.name,
        phone: client.phone,
        address: client.address,
      },
      info: [
        { label: "Mode de règlement", value: PAYMENT_MODE_LABEL[tx.mode || ''] || tx.mode || 'Espèces' },
        { label: "Référence", value: tx.receiptNumber || '' },
        { label: "Encaissé par", value: currentUserName || '' },
        { label: "CIN / ID", value: client.cin || '' },
      ],
      amount: tx.amount,
      mode: PAYMENT_MODE_LABEL[tx.mode || ''] || tx.mode || 'Espèces',
      reference: tx.receiptNumber,
      debtBefore,
      debtAfter: debtBefore === undefined ? undefined : Math.max(0, debtBefore - tx.amount),
      notes: tx.notes,
    });
  };

  /**
   * Règlement de la dette du client. The debt is held globally on the client
   * (there is no per-facture payment column), so a payment always lowers the
   * global encours; when it was started from an invoice row, that invoice is
   * quoted on the receipt as the reason for the payment.
   */
  const handleRecordPayment = (andPrint = false) => {
    if (!selectedClient || paymentForm.amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Montant invalide" } });
      return;
    }
    // A TPE règlement is cashed on a bank account (the terminal's account): the
    // account must be chosen so the money lands somewhere in the ledger.
    const tpeAccount = paymentForm.mode === "TPE"
      ? liveBankAccounts.find(a => a.id === paymentForm.bankAccountId)
      : undefined;
    if (paymentForm.mode === "TPE" && !tpeAccount) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Choisissez le compte bancaire du TPE" } });
      return;
    }
    // Un chèque ou un virement atterrit sur un compte : sans compte choisi,
    // AUCUNE ligne de trésorerie n'était écrite. La dette disparaissait et
    // l'argent avec — ni la caisse ni la banque ne le voyaient jamais arriver.
    if ((paymentForm.mode === "CHEQUE" || paymentForm.mode === "VIREMENT") && !paymentForm.bankAccountId) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Choisissez le compte bancaire qui reçoit le règlement" } });
      return;
    }

    // ── LE TROP-PERÇU DEVIENT UNE AVANCE ────────────────────────────────────
    // Un client qui vient régler 2 500 DA sur 1 000 DA de dette ne se voit plus
    // refuser son argent : les 1 000 DA soldent la dette (un PAYMENT), les
    // 1 500 DA restants rechargent son avance (une RECHARGE). Les deux écrivent
    // leur ligne de trésorerie sur le MÊME compte, si bien que la caisse
    // Carburant et les rapports comptent l'intégralité de ce qui est entré.
    const debtCap = Math.max(0, ledger.debtFromDocuments);
    const debtPortion = Math.min(paymentForm.amount, debtCap);
    const advancePortion = Math.max(0, paymentForm.amount - debtPortion);

    // Où va l'argent — un seul compte pour les deux volets. La caisse pour les
    // espèces, le compte bancaire choisi pour le TPE, le chèque et le virement.
    const destination = tpeAccount
      ? tpeAccount.id
      : paymentForm.mode === 'ESPECES'
        // Le coffre du CARBURANT, pas le tiroir commun : c'est l'activité qui
        // tient ce client, et c'est sa caisse que le règlement doit remplir.
        ? CAISSE_PART_ID.carburant
        : (paymentForm.bankAccountId || undefined);
    const destinationLabel = tpeAccount
      ? tpeAccount.name
      : paymentForm.mode === 'ESPECES'
        ? 'la caisse Carburant'
        : (liveBankAccounts.find(a => a.id === destination)?.name || 'aucun compte');

    // L'opération d'origine, citée sur le reçu quand le règlement a été lancé
    // depuis une ligne du journal du client.
    const invoiceRef = selectedSale
      ? (selectedSale.label || `Facture #${String(selectedSale.id || '').substring(0, 8).toUpperCase()}`)
      : '';
    const tpeRef = tpeAccount ? `TPE ${tpeAccount.name}` : '';
    const debtBefore = selectedClient.debt;

    /** Écrit une opération du compte (PAYMENT / RECHARGE) et sa ligne de caisse. */
    const writeMovement = (
      type: 'PAYMENT' | 'RECHARGE', amount: number, label: string, extraNote = '',
    ) => {
      const movement = {
        id: newId(),
        date: paymentForm.date,
        type,
        amount,
        mode: paymentForm.mode,
        receiptNumber: paymentForm.chequeNumber,
        notes: [invoiceRef, tpeRef, extraNote, paymentForm.notes].filter(Boolean).join(' — '),
      };
      dispatch({ type: 'ADD_CLIENT_PAYMENT', payload: { clientId: selectedClient.id, payment: movement } });
      if (destination) {
        const tx: TreasuryTransaction = {
          id: newId(),
          date: new Date(paymentForm.date).toISOString(),
          kind: tpeAccount ? 'TPE' : 'SALE',
          amount,
          description: [
            label,
            selectedClient.name,
            invoiceRef,
            PAYMENT_MODE_LABEL[paymentForm.mode] || paymentForm.mode,
          ].filter(Boolean).join(' · '),
          accountTo: destination,
          part: 'carburant',
          refType: 'client_payment',
          refId: movement.id,
          chequeNumber: paymentForm.mode === 'CHEQUE' ? (paymentForm.chequeNumber || undefined) : undefined,
          createdBy: currentUserName,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
      }
      return movement;
    };

    // ── Le règlement entre dans le grand livre, QUEL QUE SOIT son mode ────────
    // Seul le TPE écrivait sa ligne autrefois : un client qui réglait en espèces
    // faisait disparaître la créance sans que l'argent n'arrive nulle part.
    const history = [...(selectedClient.transactionHistory || [])];
    let receiptTx: NonNullable<Client['transactionHistory']>[number] | null = null;
    if (debtPortion > 0) {
      receiptTx = writeMovement('PAYMENT', debtPortion, 'Règlement dette client');
      history.push(receiptTx as any);
    }
    if (advancePortion > 0) {
      const rec = writeMovement('RECHARGE', advancePortion, "Avance client (trop-perçu)", "Trop-perçu porté en avance");
      history.push(rec as any);
      if (!receiptTx) receiptTx = rec as any;
    }

    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: advancePortion > 0
      ? `Encaissé sur ${destinationLabel} : ${paymentForm.amount.toLocaleString()} DA — dont ${advancePortion.toLocaleString()} DA portés en avance`
      : (destination
        ? `Règlement encaissé sur ${destinationLabel} : -${paymentForm.amount.toLocaleString()} DA`
        : `Règlement enregistré: -${paymentForm.amount.toLocaleString()} DA`) } });

    const updatedClient: Client = {
      ...selectedClient,
      debt: Math.max(0, debtBefore - debtPortion),
      balance: selectedClient.balance + advancePortion,
      advanceBalance: (selectedClient.advanceBalance ?? selectedClient.balance) + advancePortion,
      transactionHistory: history,
    };
    setSelectedClient(updatedClient);
    // Le reçu porte le montant TOTAL remis et, le cas échéant, la mention de
    // l'avance créée — le client repart avec une trace de tout ce qu'il a versé.
    if (andPrint && receiptTx) {
      printReceipt(
        updatedClient,
        {
          ...receiptTx,
          amount: paymentForm.amount,
          notes: [receiptTx.notes, advancePortion > 0 ? `Dont ${advancePortion.toLocaleString()} DA en avance` : '']
            .filter(Boolean).join(' — '),
        } as any,
        debtBefore,
      );
    }

    setShowPayment(false);
    setSelectedSale(null);
    setPaymentForm({ amount: 0, date: new Date().toISOString().split("T")[0], mode: "ESPECES", chequeNumber: "", bankAccountId: "", notes: "" });
  };

  /** Opens the debt modal for one client — global debt, no invoice attached. */
  const openDebtPayment = (client: Client) => {
    setSelectedClient(client);
    setSelectedSale(null);
    setPaymentForm({
      // Ce que ses PIÈCES réclament, pas le compteur de sa fiche — et son
      // avance déduite : proposer la dette brute à un client qui a déjà versé
      // revenait à lui faire payer deux fois le même carburant.
      amount: Math.max(0, ledgers[client.id]?.netDebt ?? client.debt),
      date: new Date().toISOString().split("T")[0],
      mode: "ESPECES", chequeNumber: "", bankAccountId: liveBankAccounts[0]?.id || "", notes: "",
    });
    setShowPayment(true);
  };

  const handleSaveAppointment = () => {
    if (!selectedClient || !appointmentForm.amount || appointmentForm.amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Veuillez remplir tous les champs" } });
      return;
    }

    const newAppointment = {
      id: newId(),
      date: appointmentForm.date,
      amount: appointmentForm.amount,
      linkedSaleId: appointmentForm.linkedSaleId || null,
      notes: appointmentForm.notes,
      isPaid: false,
      createdAt: new Date().toISOString()
    };

    const updatedClient: Client = {
      ...selectedClient,
      appointments: [
        ...(selectedClient.appointments || []),
        newAppointment
      ]
    };

    dispatch({ type: 'UPDATE_CLIENT', payload: updatedClient });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Rendez-vous créé: ${appointmentForm.amount.toLocaleString()} DA` } });
    setShowAppointmentForm(false);
    setAppointmentForm({
      date: new Date().toISOString().split("T")[0],
      amount: 0,
      linkedSaleId: "",
      notes: ""
    });
    setSelectedClient(updatedClient);
  };

  const handleMarkAppointmentPaid = (appointmentId: string) => {
    if (!selectedClient) return;

    const updatedClient: Client = {
      ...selectedClient,
      appointments: selectedClient.appointments?.map(a => 
        a.id === appointmentId ? { ...a, isPaid: true } : a
      ) || []
    };

    dispatch({ type: 'UPDATE_CLIENT', payload: updatedClient });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Rendez-vous marqué comme payé" } });
    setSelectedClient(updatedClient);
  };

  /**
   * TOUT ce qui touche le compte du client, reconstruit sur ses pièces
   * (`lib/clientLedger`) : bons carburant pris sur les brigades, factures
   * magasin, règlements et recharges d'avance.
   *
   * L'écran lisait auparavant `fuelSales` — une table que plus rien n'alimente —
   * et filtrait les ventes magasin sur `paymentMode === client.id`, une
   * comparaison qui ne pouvait jamais être vraie. D'où un historique vide pour
   * tous les clients, quelle que soit leur activité.
   */
  const ledger = useMemo(
    () => clientLedger(state, selectedClient?.id || ''),
    [state, selectedClient?.id]);

  /**
   * Ce que le règlement en cours de saisie laissera derrière lui. Un versement
   * supérieur à la dette solde d'abord ce qui est dû, puis PORTE LE RESTE EN
   * AVANCE : le champ « avance après » montre l'argent que le client conserve à
   * son crédit, exactement ce que `handleRecordPayment` va enregistrer.
   */
  const paymentPreview = useMemo(() => {
    const amount = Math.max(0, paymentForm.amount || 0);
    const debtCap = Math.max(0, ledger.debtFromDocuments);
    const debtPortion = Math.min(amount, debtCap);
    const advancePortion = Math.max(0, amount - debtPortion);
    const newDebtFromDocs = Math.max(0, debtCap - debtPortion);
    const newAdvanceHeld = ledger.advanceHeld + advancePortion;
    return {
      debtPortion,
      advancePortion,
      netDebtAfter: Math.max(0, newDebtFromDocs - newAdvanceHeld),
      advanceLeftAfter: Math.max(0, newAdvanceHeld - newDebtFromDocs),
    };
  }, [ledger, paymentForm.amount]);

  /**
   * Le compte de CHAQUE client, pour la liste.
   *
   * Les cartes annonçaient l'avance et la dette lues sur les colonnes de la
   * fiche — des compteurs tenus à la main, que rien ne rapproche des pièces.
   * Elles lisent maintenant le même journal que le dossier : ce qui est affiché
   * en couverture est exactement ce qu'on retrouve en l'ouvrant.
   *
   * Le calcul ne dépend que des tables qui l'alimentent : le recalculer à chaque
   * frappe dans le champ de recherche n'aurait aucun sens.
   */
  const ledgers = useMemo(
    () => clientLedgers(state),
    [state.clients, state.brigades, state.brigadeAccountings, state.shopSales, state.fuelSales]);

  /** Ce que le client a CONSOMMÉ — bons, factures magasin, ventes anciennes. */
  const clientPurchases = useMemo(
    () => ledger.entries.filter((e: ClientEntry) => e.kind === 'bon' || e.kind === 'magasin' || e.kind === 'vente'),
    [ledger]);

  /**
   * Le relevé complet du client ouvert — la forme que le dossier partagé sait
   * lire, et celle que la feuille A4 imprime. Sans bornes : un dossier montre la
   * vie ENTIÈRE du compte, c'est le rapport qui restreint.
   */
  const dossierStatement = useMemo(
    // Fermé, le dossier ne coûte rien : inutile de relire toutes les brigades à
    // chaque mouvement de l'application pour un écran que personne ne regarde.
    () => fuelClientStatement(state, showDetail ? selectedClient : null),
    [state, selectedClient, showDetail]);

  /**
   * Le relevé de compte du client, borné à la période demandée par le rapport.
   * Il repart des mêmes pièces que le journal : ce qui s'imprime est exactement
   * ce que l'écran montre, jamais un second calcul.
   */
  const buildReport = useCallback(
    (from: string, to: string) => fuelClientStatement(state, reportClient, from, to),
    [state, reportClient]);

  /** L'avance encore disponible — la même règle que la liste des clients. */
  const advanceLeft = advanceAvailable(selectedClient);
  /**
   * Les clients enregistrés avant que les deux colonnes de l'avance ne soient
   * synchronisées en gardent deux valeurs différentes. On le DIT au lieu de
   * choisir en silence : c'est une reprise à faire, pas un calcul à deviner.
   */
  const advanceGap = advanceColumnsDisagree(selectedClient);

  /** Les blocs d'identité de la rubrique « Fiche » du dossier. */
  const dossierIdentity = useMemo(() => {
    const c = selectedClient;
    if (!c) return [];
    return [
      {
        title: 'Identité et coordonnées',
        icon: UserIcon,
        rows: [
          { label: 'Raison sociale / Nom', value: c.name },
          { label: 'Type de client', value: c.type },
          { label: 'Personne à contacter', value: c.contactPerson },
          { label: 'Téléphone', value: c.phone },
          { label: 'E-mail', value: c.email },
          { label: 'CIN / Identifiant', value: c.cin },
          { label: 'Adresse', value: c.address },
        ],
      },
      {
        title: 'Conditions commerciales',
        icon: ShieldCheck,
        rows: [
          { label: 'Mode de règlement', value: MODE_LABEL[c.paymentMode] || c.paymentMode },
          { label: 'Plafond de crédit', value: c.creditLimit ? `${c.creditLimit.toLocaleString()} DA` : undefined },
          { label: 'Délai de paiement', value: c.paymentDelay ? `${c.paymentDelay} jour(s)` : undefined },
          {
            label: 'Encours enregistré', value: `${(c.debt || 0).toLocaleString()} DA`,
            hint: "le compteur de la fiche — les pièces font foi",
          },
          {
            label: "Reste dû d'après les pièces", value: `${ledger.debtFromDocuments.toLocaleString()} DA`,
            hint: `${ledger.chargedOnCredit.toLocaleString()} à crédit − ${ledger.paid.toLocaleString()} réglés`,
          },
          {
            label: "Avance disponible", value: `${advanceLeft.toLocaleString()} DA`,
            hint: `${ledger.recharged.toLocaleString()} déposés − ${ledger.chargedOnAdvance.toLocaleString()} consommés`,
          },
          {
            label: "Reste dû, avance déduite", value: `${ledger.netDebt.toLocaleString()} DA`,
            hint: ledger.advanceHeld > 0
              ? `${ledger.debtFromDocuments.toLocaleString()} dus − ${Math.min(ledger.advanceHeld, ledger.debtFromDocuments).toLocaleString()} pris sur son avance`
              : "aucune avance à imputer",
          },
        ],
      },
      {
        title: 'Fiscalité et registre',
        icon: FileText,
        rows: [
          { label: 'NIF', value: c.nif },
          { label: 'NIS', value: c.nis },
          { label: "Article d'imposition", value: c.article },
          { label: 'Registre du commerce', value: c.rc },
        ],
      },
    ];
  }, [selectedClient, ledger, advanceLeft]);

  /** La rubrique « Rendez-vous » du dossier — propre au Carburant. */
  const renderAppointments = () => {
    if (!selectedClient) return null;
    const appts = [...(selectedClient.appointments || [])]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const due = appts.filter(a => !a.isPaid).reduce((s, a) => s + (a.amount || 0), 0);
    return (
      <div className="space-y-4 not-italic">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Échéances non encore réglées</p>
            <p className="text-xl font-black tabular-nums text-[#002d87]">{due.toLocaleString()} DA</p>
            <p className="text-[11px] font-semibold text-slate-400">
              {appts.filter(a => !a.isPaid).length} à venir sur {appts.length} programmé(s)
            </p>
          </div>
          {perm.modifier && (
            <button
              onClick={() => setShowAppointmentForm(!showAppointmentForm)}
              className="btn-primary !py-2 !px-4 text-xs flex items-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" /> {showAppointmentForm ? "Fermer le formulaire" : "Programmer un paiement"}
            </button>
          )}
        </div>

        {showAppointmentForm && (
          <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="label-field">Date d'échéance</label>
                <input type="date" value={appointmentForm.date}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, date: e.target.value })}
                  className="input-field font-bold" />
              </div>
              <div className="space-y-1.5">
                <label className="label-field">Montant attendu (DA)</label>
                <input type="number" value={appointmentForm.amount}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, amount: parseFloat(e.target.value) || 0 })}
                  className="input-field font-bold" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <label className="label-field">Opération concernée (optionnel)</label>
                <select value={appointmentForm.linkedSaleId}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, linkedSaleId: e.target.value })}
                  className="input-field font-bold">
                  <option value="">Sélectionner une opération…</option>
                  {/* Seules les consommations qui ont laissé une dette peuvent
                      motiver un rendez-vous : un bon pris sur l'avance est déjà payé. */}
                  {clientPurchases.filter((e: ClientEntry) => e.debtEffect > 0).map((e: ClientEntry) => (
                    <option key={e.id} value={e.id}>
                      {e.label} — {e.date ? new Date(e.date).toLocaleDateString() : "—"} ({e.debtEffect.toLocaleString()} DA)
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="label-field">Notes</label>
                <input type="text" value={appointmentForm.notes}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })}
                  placeholder="Instructions, interlocuteur…" className="input-field font-bold" />
              </div>
            </div>
            <button onClick={handleSaveAppointment} className="btn-primary w-full flex items-center justify-center gap-2">
              <Calendar className="w-4 h-4" /> Programmer le rendez-vous
            </button>
          </div>
        )}

        {appts.length === 0 ? (
          <div className="p-10 text-center bg-white rounded-2xl border border-slate-200">
            <Calendar className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-bold text-slate-400">Aucun rendez-vous de paiement programmé</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {appts.map(appt => {
              const isLate = new Date(appt.date) < new Date() && !appt.isPaid;
              return (
                <div key={appt.id}
                  className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border",
                    isLate ? "bg-red-50/60 border-red-100" : appt.isPaid ? "bg-emerald-50/40 border-emerald-100" : "bg-white border-slate-200")}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border shrink-0",
                      isLate ? "bg-red-100 text-red-600 border-red-200"
                        : appt.isPaid ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : "bg-blue-100 text-blue-900 border-blue-200")}>
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {new Date(appt.date).toLocaleDateString()}
                        {appt.linkedSaleId ? ` · opération ${appt.linkedSaleId.substring(0, 8).toUpperCase()}` : ''}
                      </p>
                      <p className={cn("text-base font-black tabular-nums",
                        isLate ? "text-red-600" : appt.isPaid ? "text-emerald-700" : "text-[#002d87]")}>
                        {appt.amount.toLocaleString()} DA
                      </p>
                      {appt.notes && <p className="text-[11px] text-slate-400 font-semibold truncate">{appt.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[9px] font-black px-2.5 py-1 rounded-full border uppercase tracking-wider",
                      isLate ? "bg-red-100 text-red-700 border-red-200"
                        : appt.isPaid ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200")}>
                      {isLate ? "En retard" : appt.isPaid ? "Payé" : "À venir"}
                    </span>
                    {!appt.isPaid && perm.modifier && (
                      <button onClick={() => handleMarkAppointmentPaid(appt.id)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all">
                        Marquer payé
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Filtering Logic
  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchesQuery = matchesSearch(searchTerm, c.name, c.phone, c.email, c.cin);

      const matchesType = selectedType === "Tous" || c.type === selectedType;
      const matchesMode = selectedMode === "Tous" || c.paymentMode === selectedMode;
      
      return matchesQuery && matchesType && matchesMode;
    });
  }, [clients, searchTerm, selectedType, selectedMode]);

  const TypeBadge = ({ type }: { type: string }) => (
    <span className={cn(
      "text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block",
      type === "ENTREPRISE" ? "bg-blue-50 text-blue-700 border-blue-100" :
      type === "GOUVERNEMENT" ? "bg-slate-50 text-slate-700 border-slate-100" : "bg-purple-50 text-purple-700 border-purple-100"
    )}>
      {type}
    </span>
  );

  const ModeBadge = ({ mode }: { mode: string }) => (
    <span className={cn(
      "text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block",
      mode === "CREDIT" ? "bg-red-50 text-red-700 border-red-100" :
      mode === "ADVANCE" ? "bg-green-50 text-green-700 border-green-100" : "bg-slate-50 text-slate-500 border-slate-100"
    )}>
      {mode}
    </span>
  );

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 italic text-left">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">Gestion des Clients</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Gérez vos comptes clients, crédits et avances de fonds.</p>
        </div>
        {perm.creer && (
        <button
          onClick={() => { 
            setSelectedClient(null); 
            setClientForm(blankClientForm());
            setShowModal(true); 
          }}
          className="h-14 px-8 bg-gradient-to-r from-[#001f5c] via-[#002d85] to-[#001f5c] text-[#FFB800] border border-blue-900 hover:border-[#FFB800] rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-blue-950/20 hover:scale-105 transition-all flex items-center gap-3 italic"
        >
          <Plus className="w-5 h-5 text-[#FFB800]" /> NOUVEAU CLIENT
        </button>
        )}
      </div>

      {/* ── Rechercher un client ───────────────────────────────────
          Le champ était une barre grise, en petites capitales, qui ressemblait à
          un bandeau décoratif plus qu'à une zone de saisie : on ne voyait ni
          qu'elle attendait une frappe, ni ce qu'elle venait de retenir. Il est
          maintenant ce qu'il doit être — une vraie boîte de recherche, large,
          qui s'allume au focus, se vide d'un clic et DIT combien de clients elle
          a retenus. Les filtres sont posés dessous, en pastilles lisibles. */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden not-italic">
        <div className="px-5 sm:px-6 pt-5 pb-4">
          <label htmlFor="client-search" className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2 ml-1">
            Rechercher un client
          </label>
          <div className="group relative">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-[#003087] transition-colors pointer-events-none" />
            <input
              id="client-search"
              type="search"
              autoComplete="off"
              placeholder="Nom, raison sociale, téléphone, e-mail ou CIN…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-16 pl-14 pr-32 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold text-[#002d87] placeholder:text-slate-400 placeholder:font-medium outline-none transition-all focus:bg-white focus:border-[#003087] focus:ring-4 focus:ring-blue-100"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {searchTerm && (
                <button onClick={() => setSearchTerm("")} title="Effacer la recherche"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all">
                  <X className="w-4 h-4" />
                </button>
              )}
              <span className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500 tabular-nums whitespace-nowrap">
                {filteredClients.length} / {clients.length}
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Type</span>
            {[["Tous", "Tous"], ["PARTICULIER", "Particulier"], ["ENTREPRISE", "Entreprise"], ["GOUVERNEMENT", "Gouvernement"]].map(([v, label]) => (
              <button key={v} onClick={() => setSelectedType(v)}
                className={cn("px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border",
                  selectedType === v
                    ? "bg-[#002d87] text-white border-[#002d87] shadow-sm"
                    : "bg-slate-50 text-slate-500 border-slate-100 hover:bg-slate-100")}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Règlement</span>
            {[["Tous", "Tous"], ["CASH", "Comptant"], ["ADVANCE", "Avance"], ["CREDIT", "Crédit"]].map(([v, label]) => (
              <button key={v} onClick={() => setSelectedMode(v)}
                className={cn("px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border",
                  selectedMode === v
                    ? "bg-[#002d87] text-white border-[#002d87] shadow-sm"
                    : "bg-slate-50 text-slate-500 border-slate-100 hover:bg-slate-100")}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 ml-auto bg-slate-100 rounded-xl p-1">
            <button onClick={() => setViewMode("grid")} title="Cartes"
              className={cn("px-3 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-wider",
                viewMode === "grid" ? "bg-white text-[#002d87] shadow-sm" : "text-slate-400 hover:text-slate-600")}>
              <Grid className="w-4 h-4" /> Cartes
            </button>
            <button onClick={() => setViewMode("table")} title="Tableau"
              className={cn("px-3 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-wider",
                viewMode === "table" ? "bg-white text-[#002d87] shadow-sm" : "text-slate-400 hover:text-slate-600")}>
              <ListIcon className="w-4 h-4" /> Tableau
            </button>
          </div>
        </div>
      </div>

      {/* Grid or Table Display */}
      <AnimatePresence mode="wait">
        {viewMode === "grid" ? (
          <motion.div 
            key="grid"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredClients.length > 0 ? (
              filteredClients.map((c, index) => {
                // Le compte du client, relu sur ses pièces : c'est lui qui donne
                // les chiffres de la carte, jamais les colonnes de la fiche.
                const cl = ledgers[c.id] || clientLedger(state, c.id);
                // La dette NETTE : ce qu'on peut réellement réclamer une fois
                // l'avance du client imputée. La carte annonçait la brute et
                // affichait l'avance à côté, sans jamais les rapprocher — un
                // client prépayé y figurait comme débiteur de son propre argent.
                const cDebt = cl.netDebt;
                return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.03 }}
                  className={cn(
                    "group relative bg-white rounded-3xl border transition-all p-5 pt-6 space-y-4 not-italic flex flex-col hover:shadow-xl hover:-translate-y-0.5",
                    actionMenuOpen === c.id ? "z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl" : "z-10 border-slate-100 hover:border-blue-200 shadow-sm"
                  )}
                >
                  {/* Le liseré de tête — la seule couleur de la carte. */}
                  <div className="h-1.5 absolute top-0 left-0 right-0 rounded-t-3xl bg-gradient-to-r from-[#001f5c] via-[#003087] to-[#FFB800]" />

                  {/* ── Identité ────────────────────────────────────────────
                      La carte ne raconte plus que trois choses : QUI est le
                      client, ce qu'il a pris, ce qu'il a payé, ce qu'il doit.
                      Elle portait avant six pastilles de plus — avance, plafond,
                      nombre d'opérations, écart de fiche — qu'on ne lisait
                      jamais en survolant une liste, et qui poussaient les trois
                      chiffres qui comptent tout en bas. Ils vivent tous dans le
                      dossier, à un clic. */}
                  <div className="flex items-start gap-3.5 pt-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black uppercase shrink-0 shadow-md border-2 border-white"
                      style={{ background: 'linear-gradient(135deg, #001f5c 0%, #003087 100%)', color: '#FFB800' }}>
                      {c.name[0]}
                    </div>
                    <div className="min-w-0 flex-1 pr-8">
                      <h4 className="font-black text-[#002d87] uppercase tracking-tight text-sm leading-tight truncate not-italic">{c.name}</h4>
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        <TypeBadge type={c.type} />
                        <ModeBadge mode={c.paymentMode} />
                      </div>
                    </div>
                  </div>

                  {/* Actions Dropdown Button */}
                  <div className="absolute top-4 right-4">
                    <motion.button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionMenuOpen(actionMenuOpen === c.id ? null : c.id);
                      }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-blue-900 transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </motion.button>

                    {/* Action list */}
                    <AnimatePresence>
                      {actionMenuOpen === c.id && (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -8, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 mt-2 w-56 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[60] overflow-hidden not-italic"
                        >
                          <div className="divide-y divide-slate-100">
                            <button
                              onClick={() => { setSelectedClient(c); setActiveTab("resume"); setShowDetail(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Eye className="w-4 h-4 text-slate-500" /> Dossier Client
                            </button>
                            {perm.modifier && (
                            <button
                              onClick={() => { setSelectedClient(c); setClientForm(c); setShowModal(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                            </button>
                            )}
                            {perm.modifier && (
                            <button
                              onClick={() => { setSelectedClient(c); openOpeningEditor(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-amber-700 hover:bg-amber-50 flex items-center gap-3 transition-colors"
                            >
                              <Flag className="w-4 h-4 text-amber-500" /> Reprise (dette / avance)
                            </button>
                            )}
                            {c.paymentMode === "ADVANCE" && (
                              <button
                                onClick={() => { setSelectedClient(c); setShowRecharge(true); setActionMenuOpen(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                              >
                                <Wallet className="w-4 h-4 text-green-500" /> Recharger Avance
                              </button>
                            )}
                            {cDebt > 0 && perm.modifier && (
                              <button
                                onClick={() => { openDebtPayment(c); setActionMenuOpen(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors"
                              >
                                <DollarSign className="w-4 h-4 text-emerald-500" /> Payer la Dette
                              </button>
                            )}
                            <button
                              onClick={() => { setSelectedClient(c); setActiveTab("journal"); setShowDetail(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <History className="w-4 h-4 text-slate-500" /> Historique Complet
                            </button>
                            <button
                              onClick={() => { setReportClient(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-blue-900 hover:bg-blue-50 flex items-center gap-3 transition-colors"
                            >
                              <FileBarChart className="w-4 h-4 text-blue-600" /> Générer un Rapport
                            </button>
                            {perm.supprimer && (
                            <button
                              onClick={() => { setClientToDelete(c); setActionMenuOpen(null); }}
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

                  {/* ── Informations personnelles ──────────────────────────── */}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 divide-y divide-slate-100/80 not-italic">
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-600 truncate">{c.phone || "Téléphone non renseigné"}</span>
                    </div>
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-600 truncate lowercase">{c.email || "e-mail non renseigné"}</span>
                    </div>
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <IdCardIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-600 truncate">{c.cin || "CIN / ICE non renseigné"}</span>
                    </div>
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-600 truncate">{c.address || "Adresse non renseignée"}</span>
                    </div>
                  </div>

                  {/* ── Les trois chiffres du compte ────────────────────────
                      Ils se relisent l'un l'autre : achats − règlements = dette,
                      et tous trois sortent du MÊME journal que le dossier —
                      dette initiale de reprise comprise. */}
                  <div className="mt-auto grid grid-cols-3 gap-2 not-italic">
                    <div className="rounded-2xl border border-slate-100 bg-white p-3 text-center">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">Total achats</p>
                      <p className="text-[13px] font-black text-[#002d87] tabular-nums leading-none truncate">{cl.charged.toLocaleString()}</p>
                      <p className="text-[8px] font-bold text-slate-300 mt-0.5">DA</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3 text-center">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">Total règlements</p>
                      <p className="text-[13px] font-black text-emerald-700 tabular-nums leading-none truncate">{cl.paid.toLocaleString()}</p>
                      <p className="text-[8px] font-bold text-emerald-400 mt-0.5">DA</p>
                    </div>
                    {/* Dette nette, ou — quand le client est en avance — ce que
                        la station lui doit encore. Les deux ne peuvent pas être
                        vrais en même temps : l'un est le reliquat de l'autre. */}
                    <div className={cn("rounded-2xl border p-3 text-center",
                      cDebt > 0 ? "bg-red-50/70 border-red-100"
                        : cl.advanceLeft > 0 ? "bg-teal-50/70 border-teal-100" : "bg-slate-50 border-slate-100")}>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">
                        {cDebt > 0 || cl.advanceLeft <= 0 ? 'Total dettes' : 'Avance détenue'}
                      </p>
                      <p className={cn("text-[13px] font-black tabular-nums leading-none truncate",
                        cDebt > 0 ? "text-red-600" : cl.advanceLeft > 0 ? "text-teal-700" : "text-slate-400")}>
                        {(cDebt > 0 || cl.advanceLeft <= 0 ? cDebt : cl.advanceLeft).toLocaleString()}
                      </p>
                      <p className={cn("text-[8px] font-bold mt-0.5", cDebt > 0 ? "text-red-300" : "text-slate-300")}>DA</p>
                    </div>
                  </div>

                </motion.div>
                );
              })
            ) : (
              <div className="col-span-full">
                <EmptyState 
                  icon={Building2}
                  title="Aucun client trouvé"
                  description="Ajustez vos filtres ou créez un nouveau client."
                  action={() => { setSelectedClient(null); setClientForm(blankClientForm()); setShowModal(true); }}
                  actionLabel="AJOUTER UN CLIENT"
                />
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
            key="table"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="card-glass overflow-hidden shadow-2xl border-slate-100 italic"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-blue-900 text-[10px] uppercase font-black tracking-[0.2em] italic border-b border-slate-100">
                  <tr>
                    <th className="px-8 py-6">Client</th>
                    <th className="px-8 py-6">Type / Mode</th>
                    <th className="px-8 py-6 text-right">Consommé</th>
                    <th className="px-8 py-6 text-right">Réglé</th>
                    <th className="px-8 py-6 text-right">Solde Avance</th>
                    <th className="px-8 py-6 text-right">Reste Dû</th>
                    <th className="px-8 py-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredClients.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState 
                          icon={Building2}
                          title="Aucun client trouvé"
                          description="Ajustez vos filtres ou créez un nouveau client."
                          action={() => { setSelectedClient(null); setClientForm(blankClientForm()); setShowModal(true); }}
                          actionLabel="AJOUTER UN CLIENT"
                        />
                      </td>
                    </tr>
                  ) : filteredClients.map((c, index) => {
                    const cl = ledgers[c.id] || clientLedger(state, c.id);
                    const cDebt = cl.netDebt;
                    return (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      className="group hover:bg-slate-50/50 border-b border-slate-100 transition-colors"
                    >
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-blue-900 font-black text-lg italic uppercase border border-slate-200">
                            {c.name[0]}
                          </div>
                          <div>
                            <span className="block font-black text-blue-900 uppercase italic tracking-tighter leading-none mb-1">{c.name}</span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{c.phone || "N/A"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-1.5 items-start">
                          <TypeBadge type={c.type} />
                          <ModeBadge mode={c.paymentMode} />
                        </div>
                      </td>
                      {/* Consommé, réglé, reste : les trois se relisent, et
                          tous viennent du journal du client. */}
                      <td className="px-8 py-5 text-right font-black text-blue-900 text-base italic">
                        {cl.charged.toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                        <span className="block text-[9px] font-bold text-slate-400 not-italic normal-case tracking-normal">
                          {cl.entries.length} opération(s)
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-emerald-600 text-base italic">
                        {cl.paid.toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                        <span className="block text-[9px] font-bold text-slate-400 not-italic normal-case tracking-normal">
                          {cl.counts.reglements} règlement(s)
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-green-600 text-base italic">
                        {advanceAvailable(c).toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn("font-black text-base italic leading-none", cDebt > 0 ? "text-red-500" : "text-slate-300")}>
                            {cDebt.toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                          </span>
                          {c.creditLimit > 0 && cDebt > c.creditLimit && (
                            <span className="flex items-center gap-1 text-[8px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded italic">
                              <AlertTriangle className="w-3 h-3" /> Hors Plafond
                            </span>
                          )}
                          {Math.abs(cl.debtGap) >= 1 && (
                            <span className="text-[8px] font-black uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded not-italic"
                              title={`La fiche annonce ${(c.debt || 0).toLocaleString()} DA`}>
                              Écart fiche {Math.abs(cl.debtGap).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {cDebt > 0 && perm.modifier && (
                            <button
                              onClick={() => openDebtPayment(c)}
                              title="Payer la dette"
                              className="px-3 py-2 mr-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[8px] font-black uppercase tracking-widest italic transition-all flex items-center gap-1.5 shadow-sm"
                            >
                              <DollarSign className="w-3.5 h-3.5 text-yellow-300" /> Payer
                            </button>
                          )}
                          <button onClick={() => { setSelectedClient(c); setActiveTab("journal"); setShowDetail(true); }} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-300 hover:text-emerald-600 transition-all border border-transparent hover:border-slate-200" title="Historique complet du compte"><History className="w-4 h-4" /></button>
                          <button onClick={() => setReportClient(c)} className="p-2.5 hover:bg-blue-50 rounded-xl text-slate-300 hover:text-blue-700 transition-all border border-transparent hover:border-blue-100" title="Générer un rapport sur une période"><FileBarChart className="w-4 h-4" /></button>
                          <button onClick={() => { setSelectedClient(c); setActiveTab("resume"); setShowDetail(true); }} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-300 hover:text-blue-900 transition-all border border-transparent hover:border-slate-200" title="Dossier complet du client"><Eye className="w-4 h-4" /></button>
                          {perm.modifier && <button onClick={() => { setSelectedClient(c); setClientForm(c); setShowModal(true); }} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-300 hover:text-blue-600 transition-all border border-transparent hover:border-slate-200" title="Modifier"><Edit2 className="w-4 h-4" /></button>}
                          {perm.supprimer && <button onClick={() => setClientToDelete(c)} className="p-2.5 hover:bg-red-50 rounded-xl text-slate-200 hover:text-red-600 transition-all border border-transparent hover:border-red-100" title="Supprimer"><Trash2 className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create/Edit Modal (Matching Create New Brigade) */}
      <AnimatePresence>
        {showModal && (
          <div className="modal-shell z-[70] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl rounded-[3rem] relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden shadow-2xl border border-blue-200"
            >
              {/* Premium Gradient Header */}
              <div className="p-8 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0 border-b border-blue-900/10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/5 shadow-xl">
                    <UserIcon className="w-6 h-6 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg uppercase tracking-tighter italic text-yellow-400">
                      {selectedClient ? "Modifier Profil Client" : "Nouveau Client"}
                    </h3>
                    <p className="text-[11px] text-blue-200 font-bold mt-1">Saisie des données administratives et financières</p>
                  </div>
                </div>
                <button onClick={() => setShowModal(false)} className="p-3 hover:bg-white/10 rounded-2xl transition-all"><X className="w-6 h-6 text-white" /></button>
              </div>

              {/* Scrollable Form Body */}
              <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Client Identity Card */}
                  <div className="p-8 bg-gradient-to-br from-blue-50 to-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-6">
                    <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest border-b pb-2">Identité Administrative</h4>
                    
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NOM OU RAISON SOCIALE</label>
                      <input 
                        type="text" 
                        value={clientForm.name} 
                        onChange={e => setClientForm({...clientForm, name: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Ex: SONATRACH / CLIENT PARTICULIER" 
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">TYPE DE CLIENT</label>
                        <select 
                          value={clientForm.type} 
                          onChange={e => setClientForm({...clientForm, type: e.target.value as any})} 
                          className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14"
                        >
                          <option value="PARTICULIER">Particulier</option>
                          <option value="ENTREPRISE">Entreprise</option>
                          <option value="GOUVERNEMENT">Gouvernement</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">TÉLÉPHONE</label>
                        <input 
                          type="text" 
                          value={clientForm.phone} 
                          onChange={e => setClientForm({...clientForm, phone: e.target.value})} 
                          className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                          placeholder="Ex: 0550 12 34 56" 
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ADRESSE EMAIL</label>
                      <input 
                        type="email" 
                        value={clientForm.email} 
                        onChange={e => setClientForm({...clientForm, email: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black lowercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="client@domaine.dz" 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">CIN / IDENTIFIANT REGISTRE</label>
                      <input 
                        type="text" 
                        value={clientForm.cin} 
                        onChange={e => setClientForm({...clientForm, cin: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Numéro CIN ou ICE..." 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ADRESSE DU DOMICILE / SIÈGE</label>
                      <input 
                        type="text" 
                        value={clientForm.address} 
                        onChange={e => setClientForm({...clientForm, address: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Adresse postale..." 
                      />
                    </div>
                  </div>

                  {/* Right Column: Conditions and Financial details */}
                  <div className="p-8 bg-gradient-to-br from-blue-50 to-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-6 flex flex-col">
                    <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest border-b pb-2">Conditions Financières</h4>
                    
                    <div className="space-y-3">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">MODE DE PAIEMENT PAR DÉFAUT</label>
                      <div className="grid grid-cols-3 gap-2">
                        {["CASH", "ADVANCE", "CREDIT"].map(m => (
                          <button 
                            key={m}
                            type="button"
                            onClick={() => setClientForm({...clientForm, paymentMode: m as any})}
                            className={cn(
                              "p-4 rounded-2xl border-2 text-[9px] font-black uppercase tracking-widest transition-all italic",
                              clientForm.paymentMode === m ? "border-blue-900 bg-blue-100/50 text-blue-900" : "border-slate-100 bg-white text-slate-400 hover:bg-slate-50"
                            )}
                          >
                            {m === "CASH" ? "Comptant" : m === "ADVANCE" ? "Avance" : "Crédit"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode specific parameters */}
                    <div className="flex-1 flex flex-col justify-center">
                      <AnimatePresence mode="wait">
                        {clientForm.paymentMode === "CREDIT" ? (
                          <motion.div 
                            key="credit" 
                            initial={{ opacity: 0, scale: 0.98 }} 
                            animate={{ opacity: 1, scale: 1 }} 
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="p-6 bg-red-50/50 rounded-2xl border border-red-100 space-y-4 w-full"
                          >
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Plafond Crédit Autorisé (DA)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.creditLimit} onChange={e => setClientForm({...clientForm, creditLimit: parseFloat(e.target.value) || 0})} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Délai Contractuel de Règlement (Jours)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.paymentDelay} onChange={e => setClientForm({...clientForm, paymentDelay: parseInt(e.target.value) || 0})} />
                            </div>
                            {/* ── La dette de reprise ──────────────────────
                                Elle ne s'affichait qu'à la CRÉATION, et n'était
                                écrite que dans le compteur `debt` de la fiche :
                                l'historique du client s'ouvrait donc vide, sa
                                carte annonçait 0, et le rapport général ne
                                comptait pas la créance. Elle est maintenant une
                                LIGNE de son compte — et se corrige à tout moment. */}
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Dette initiale à l'ouverture (DA)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.openingDebt ?? 0} onChange={e => setClientForm({...clientForm, openingDebt: parseFloat(e.target.value) || 0})} />
                              <p className="text-[9px] font-bold text-red-700/60 leading-relaxed ml-1">
                                Ce que le client devait DÉJÀ avant sa fiche. Elle entre dans son historique,
                                sur sa carte, dans la Caisse Générale et dans les rapports — sans faire
                                entrer d'argent en caisse : la somme a été engagée avant ce compte.
                              </p>
                            </div>
                          </motion.div>
                        ) : clientForm.paymentMode === "ADVANCE" ? (
                          <motion.div 
                            key="advance" 
                            initial={{ opacity: 0, scale: 0.98 }} 
                            animate={{ opacity: 1, scale: 1 }} 
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="p-6 bg-green-50/50 rounded-2xl border border-green-100 space-y-4 w-full"
                          >
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-green-700 uppercase tracking-widest ml-1">Avance initiale à l'ouverture (DA)</label>
                              <input type="number" className="input-field bg-white border-green-100 text-green-950 font-black h-13 shadow-inner" value={clientForm.openingAdvance ?? 0} onChange={e => setClientForm({...clientForm, openingAdvance: parseFloat(e.target.value) || 0})} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Dette initiale à l'ouverture (DA)</label>
                              <input type="number" className="input-field bg-white border-slate-200 text-red-950 font-black h-13 shadow-inner" value={clientForm.openingDebt ?? 0} onChange={e => setClientForm({...clientForm, openingDebt: parseFloat(e.target.value) || 0})} />
                            </div>
                            <p className="text-[9px] font-bold text-green-700/70 italic leading-relaxed">
                              Les ventes et consommations boutique et carburant seront automatiquement imputées sur ce compte d'avance.
                              L'avance initiale ouvre l'historique du client, se déduit de ce qu'il doit et se retrouve
                              dans la Caisse Générale et dans les rapports.
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div 
                            key="cash"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.4 }}
                            className="p-8 bg-slate-100 rounded-2xl flex flex-col items-center justify-center text-center italic space-y-3 w-full"
                          >
                            <ShieldCheck className="w-12 h-12 text-slate-500" />
                            <p className="text-[9px] font-black uppercase tracking-widest">Paiement comptant standard sans encours ni avance.</p>
                            <p className="text-[9px] font-bold normal-case text-slate-500 leading-relaxed">
                              Une reprise reste possible : ouvrez « Dette initiale » depuis le menu
                              de sa carte si ce client traînait déjà une ardoise.
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* La date de la reprise — elle place la ligne d'ouverture en
                    TÊTE du journal ; sans elle, le solde après chaque opération
                    se calculerait à partir du mauvais point de départ. */}
                {((clientForm.openingDebt || 0) > 0 || (clientForm.openingAdvance || 0) > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-[2rem] bg-amber-50/60 border border-amber-100">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest ml-1">Date de la reprise</label>
                      <input type="date" className="input-field bg-white border-amber-200 focus:border-amber-500 text-blue-900 font-black text-xs h-13 shadow-inner"
                        value={(clientForm.openingDate || '').split('T')[0]}
                        onChange={e => setClientForm({ ...clientForm, openingDate: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest ml-1">Note de reprise (facultatif)</label>
                      <input type="text" placeholder="Ancien carnet, solde repris au 01/01…"
                        className="input-field bg-white border-amber-200 focus:border-amber-500 text-blue-900 font-black text-xs h-13 shadow-inner"
                        value={clientForm.openingNotes || ''}
                        onChange={e => setClientForm({ ...clientForm, openingNotes: e.target.value })} />
                    </div>
                  </div>
                )}

                {/* Collapsible Fiscal Panel */}
                <div className="border-t border-slate-100 pt-6">
                  <button 
                    type="button"
                    onClick={() => setShowFiscalSection(!showFiscalSection)}
                    className="flex items-center justify-between w-full p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors text-[10px] font-black text-slate-500 uppercase tracking-widest italic"
                  >
                    <span className="flex items-center gap-3"><Lock className="w-4 h-4 text-blue-950" /> Informations Fiscales & Commerciales (Optionnel)</span>
                    <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform", showFiscalSection && "rotate-180")} />
                  </button>

                  <AnimatePresence>
                    {showFiscalSection && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden mt-4"
                      >
                        <div className="p-8 bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-[2rem] border border-blue-100/50 space-y-4 grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NIF</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.nif || ""} onChange={e => setClientForm({...clientForm, nif: e.target.value})} placeholder="Numéro d'Identification Fiscale" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NIS</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.nis || ""} onChange={e => setClientForm({...clientForm, nis: e.target.value})} placeholder="Numéro d'Identification Statistique" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ARTICLE IMPOSITION</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.article || ""} onChange={e => setClientForm({...clientForm, article: e.target.value})} placeholder="Code Article d'imposition" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">REGISTRE DE COMMERCE (RC)</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.rc || ""} onChange={e => setClientForm({...clientForm, rc: e.target.value})} placeholder="Numéro Registre de Commerce" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-8 bg-slate-50 border-t flex gap-6 shrink-0">
                <button onClick={() => setShowModal(false)} className="px-10 py-5 text-[11px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic underline underline-offset-8">Annuler</button>
                <button 
                  onClick={handleSaveClient} 
                  disabled={isLoading}
                  className="flex-1 h-16 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-2xl flex items-center justify-center gap-4 italic transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-yellow-400" /> : <Save className="w-5 h-5 text-yellow-400" />}
                  {isLoading ? "ENREGISTREMENT..." : "Enregistrer Profil"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Le dossier du client ───────────────────────────────────────────
          « Voir détails » et « Historique complet » ouvrent le MÊME dossier, à
          une rubrique différente : c'est le même compte, il n'y a aucune raison
          qu'il se raconte de deux façons. La mise en page est celle des
          Paramètres (voir `components/clients/ClientDossier`). */}
      {showDetail && selectedClient && (
        <ClientDossier
          key={selectedClient.id}
          open
          onClose={() => setShowDetail(false)}
          statement={dossierStatement}
          initialSection={activeTab}
          // Le règlement et la recharge s'ouvrent PAR-DESSUS le dossier (z-80) :
          // lancés depuis lui, ils doivent le recouvrir, sinon ils s'ouvrent
          // derrière et le bouton paraît ne pas répondre.
          zClass="z-[70]"
          recordedDebt={selectedClient.debt}
          creditLimit={selectedClient.creditLimit}
          badges={<>
            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
              {selectedClient.type}
            </span>
            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
              {MODE_LABEL[selectedClient.paymentMode] || selectedClient.paymentMode}
            </span>
            {selectedClient.cin && (
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
                CIN {selectedClient.cin}
              </span>
            )}
          </>}
          identity={dossierIdentity}
          // La reprise d'ouverture, montrée et corrigeable depuis le dossier —
          // c'est là qu'on la cherche quand un solde ne tombe pas juste.
          opening={{
            debt: clientOpening(selectedClient as any).debt,
            advance: clientOpening(selectedClient as any).advance,
            date: selectedClient.openingDate || selectedClient.createdAt || '',
            notes: selectedClient.openingNotes,
            // Ce qui a été réglé DEPUIS l'ouverture rembourse d'abord la reprise :
            // c'est la plus ancienne dette du compte.
            paid: Math.min(clientOpening(selectedClient as any).debt, ledger.paid),
            onEdit: perm.modifier ? () => openOpeningEditor(selectedClient) : undefined,
            // Un écart entre la fiche et les pièces vient presque toujours d'une
            // reprise jamais saisie : un clic la transforme en ligne d'ouverture.
            onAdopt: perm.modifier && ledger.debtGap >= 1
              ? () => openOpeningEditor(selectedClient, ledger.debtGap)
              : undefined,
          }}
          onEditPayment={perm.modifier ? (payment) => {
            const tx = txOfPayment(payment);
            if (!tx) {
              // La ligne d'ouverture n'est pas un mouvement de `client_transactions` :
              // elle se corrige par la reprise, pas par ce formulaire.
              openOpeningEditor(selectedClient);
              return;
            }
            setEditingTx(tx);
            setTxForm({
              amount: Number(tx.amount) || 0,
              date: (tx.date || '').split('T')[0],
              mode: tx.mode || 'ESPECES',
              receiptNumber: tx.receiptNumber || '',
              notes: tx.notes || '',
            });
          } : undefined}
          onDeletePayment={perm.supprimer ? (payment) => {
            const tx = txOfPayment(payment);
            if (tx) setTxToDelete(tx);
            else dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Cette ligne vient de la reprise d'ouverture : modifiez-la depuis « Dette initiale »" } });
          } : undefined}
          onPrintPayment={(payment) => {
            const tx = txOfPayment(payment);
            if (tx) printReceipt(selectedClient, tx);
          }}
          advance={selectedClient.paymentMode === 'ADVANCE' || ledger.recharged > 0 ? {
            available: advanceLeft,
            recharged: ledger.recharged,
            used: ledger.chargedOnAdvance,
            gap: advanceGap,
            onRecharge: perm.modifier ? () => setShowRecharge(true) : undefined,
          } : undefined}
          extraSections={[{
            id: 'rdv',
            label: 'Rendez-vous',
            icon: Calendar,
            count: (selectedClient.appointments || []).length,
            hint: 'Les échéances de paiement convenues avec le client',
            render: () => renderAppointments(),
          }]}
          onPayDebt={perm.modifier ? () => openDebtPayment(selectedClient) : undefined}
          onSettleLine={perm.modifier ? (line) => {
            setSelectedSale({ id: line.id, label: line.label });
            setPaymentForm({
              amount: Math.min(line.debtEffect, payableDebt(selectedClient, ledger)),
              date: new Date().toISOString().split("T")[0],
              mode: "ESPECES", chequeNumber: "",
              bankAccountId: liveBankAccounts[0]?.id || "", notes: "",
            });
            setShowPayment(true);
          } : undefined}
          onPrintReceipt={(line) => {
            const tx = (selectedClient.transactionHistory || []).find(t => `pay-${t.id}` === line.id);
            if (tx) printReceipt(selectedClient, tx);
          }}
          onReport={() => { setReportClient(selectedClient); setShowDetail(false); }}
          onPrintStatement={() => printFiche(dossierFicheRef.current)}
        >
          {/* La feuille A4, hors écran : c'est elle que `printFiche` clone. */}
          <ClientStatementFiche ref={dossierFicheRef} statement={dossierStatement} settings={settings} />
        </ClientDossier>
      )}

      {/* Recharge Avance Modal */}
      <AnimatePresence>
        {showRecharge && selectedClient && (
          <div className="modal-shell z-[80] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowRecharge(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-blue-200"
            >
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <Wallet className="w-5 h-5 text-yellow-400" />
                  <h3 className="font-black uppercase italic text-yellow-400 font-black">Recharger l'Avance</h3>
                </div>
                <button onClick={() => setShowRecharge(false)} className="p-2 hover:bg-white/10 rounded-lg text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-white">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Montant de la recharge (DA)</label>
                  <input 
                    type="number" 
                    value={rechargeForm.amount} 
                    onChange={e => setRechargeForm({...rechargeForm, amount: parseFloat(e.target.value) || 0})}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-2xl h-16 text-center shadow-inner" 
                    placeholder="0.00"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Date</label>
                    <input type="date" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" value={rechargeForm.date} onChange={e => setRechargeForm({...rechargeForm, date: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Mode de règlement</label>
                    {/* Ce choix n'était relié à rien : la recharge était toujours
                        enregistrée sans mode, et sans ligne de trésorerie. */}
                    <select
                      className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner"
                      value={rechargeForm.mode}
                      onChange={e => setRechargeForm({ ...rechargeForm, mode: e.target.value })}
                    >
                      <option value="ESPECES">Espèces</option>
                      <option value="CHEQUE">Chèque</option>
                      <option value="VIREMENT">Virement</option>
                      <option value="TPE">Carte / TPE</option>
                    </select>
                  </div>
                </div>

                {rechargeForm.mode !== 'ESPECES' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Compte crédité</label>
                      <select
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner"
                        value={rechargeForm.bankAccountId}
                        onChange={e => setRechargeForm({ ...rechargeForm, bankAccountId: e.target.value })}
                      >
                        <option value="">— Sélectionner —</option>
                        {liveBankAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name} — {a.balance.toLocaleString()} DA</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase ml-1">
                        N° {rechargeForm.mode === 'CHEQUE' ? 'chèque' : 'référence'}
                      </label>
                      <input
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner"
                        value={rechargeForm.chequeNumber}
                        onChange={e => setRechargeForm({ ...rechargeForm, chequeNumber: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-[10px] font-bold text-slate-500 leading-relaxed">
                  L'argent remis par le client entre dans{" "}
                  <span className="text-blue-900 font-black">
                    {rechargeForm.mode === 'ESPECES'
                      ? 'la caisse Carburant'
                      : (liveBankAccounts.find(a => a.id === rechargeForm.bankAccountId)?.name || 'le compte bancaire à choisir')}
                  </span>{" "}
                  et son avance monte d'autant.
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Notes / Réf Banque</label>
                  <textarea className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs p-3 shadow-inner" placeholder="Notes additionnelles..." rows={2} value={rechargeForm.notes} onChange={e => setRechargeForm({...rechargeForm, notes: e.target.value})} />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t flex gap-4 shrink-0">
                <button onClick={() => setShowRecharge(false)} className="flex-1 px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic">Annuler</button>
                <button 
                  onClick={handleRecharge} 
                  disabled={rechargeForm.amount <= 0}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-yellow-400" /> Valider Recharge
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Debt Modal — règlement de la dette du client */}
      <AnimatePresence>
        {showPayment && selectedClient && (
          <div className="modal-shell z-[80] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowPayment(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-blue-200"
            >
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-yellow-400" />
                  <div>
                    <h3 className="font-black uppercase italic text-yellow-400">Payer la Dette</h3>
                    <p className="text-[10px] text-blue-200 font-bold mt-0.5 not-italic">{selectedClient.name}</p>
                  </div>
                </div>
                <button onClick={() => { setShowPayment(false); setSelectedSale(null); }} className="p-2 hover:bg-white/10 rounded-lg text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-white">

                <div className="p-5 bg-gradient-to-br from-blue-50 to-slate-50 rounded-2xl space-y-2.5 border-2 border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Situation du Compte Client</p>
                  <div className="grid grid-cols-2 gap-y-2 text-xs font-bold text-slate-600">
                    {selectedSale && (
                      <>
                        <span>Opération concernée</span>
                        <span className="text-blue-900 font-black text-right">
                          {selectedSale.label || `#${String(selectedSale.id || '').substring(0, 8).toUpperCase()}`}
                        </span>
                      </>
                    )}
                    <span>Reste dû (d'après les pièces)</span>
                    <span className="text-red-600 font-black text-right">{ledger.debtFromDocuments.toLocaleString()} DA</span>
                    <span className="text-emerald-600">Déjà réglé (cumul)</span>
                    <span className="text-emerald-700 text-right">{ledger.paid.toLocaleString()} DA</span>
                    {/* L'avance que la station DÉTIENT déjà pour ce client : la
                        lui réclamer une seconde fois, c'est encaisser deux fois
                        le même argent. Elle n'apparaissait pas ici. */}
                    {ledger.advanceHeld > 0 && (
                      <>
                        <span className="text-teal-600">Avance détenue, imputée</span>
                        <span className="text-teal-700 font-black text-right">
                          −{Math.min(ledger.advanceHeld, ledger.debtFromDocuments).toLocaleString()} DA
                        </span>
                      </>
                    )}
                    {/* Le compteur de la fiche n'est montré QUE s'il diverge :
                        le taire laisserait croire à une erreur de saisie quand
                        c'est en réalité une reprise d'ouverture. */}
                    {Math.abs(ledger.debtGap) >= 1 && (
                      <>
                        <span className="text-amber-600">Encours enregistré sur la fiche</span>
                        <span className="text-amber-700 font-black text-right">{(selectedClient.debt || 0).toLocaleString()} DA</span>
                      </>
                    )}
                    <span className="text-slate-500 border-t pt-2">Reste après ce règlement</span>
                    <span className="text-blue-900 font-black text-right border-t pt-2">
                      {paymentPreview.netDebtAfter.toLocaleString()} DA
                    </span>
                    {/* Le trop-perçu porté en avance : le client garde cet argent
                        à son crédit, il apparaît dès qu'on saisit plus que sa dette. */}
                    {paymentPreview.advanceLeftAfter > 0 && (
                      <>
                        <span className="text-teal-600">Avance après ce règlement</span>
                        <span className="text-teal-700 font-black text-right">
                          +{paymentPreview.advanceLeftAfter.toLocaleString()} DA
                        </span>
                      </>
                    )}
                  </div>
                  {selectedSale && (
                    <p className="text-[9px] font-bold text-slate-400 italic leading-relaxed pt-1">
                      La dette est tenue globalement sur le compte client : ce règlement diminue l'encours total et cite cette facture sur le reçu.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Montant payé (DA)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={paymentForm.amount}
                      onChange={e => setPaymentForm({...paymentForm, amount: parseFloat(e.target.value) || 0})}
                      className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-lg h-14 pr-24 shadow-inner text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setPaymentForm({...paymentForm, amount: payableDebt(selectedClient, ledger)})}
                      className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-blue-50 text-blue-700 text-[8px] font-black uppercase rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      Payer Total
                    </button>
                  </div>
                  {/* Le plafond de saisie est celui que le client peut RÉELLEMENT
                      régler — le plus grand des deux encours (`payableDebt`). Comparé
                      à la seule colonne `debt` de la fiche, un client dont la dette
                      venait des brigades voyait le bouton « Valider » rester grisé :
                      il était tout simplement impossible d'encaisser son règlement. */}
                  {paymentPreview.advancePortion > 0 && (
                    <p className="text-[9px] font-black text-teal-600 uppercase tracking-widest ml-1 leading-relaxed not-italic">
                      Trop-perçu de {paymentPreview.advancePortion.toLocaleString()} DA porté en avance
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Date</label>
                    <input type="date" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" value={paymentForm.date} onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Mode de règlement</label>
                    <select className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner" value={paymentForm.mode} onChange={e => setPaymentForm({...paymentForm, mode: e.target.value, bankAccountId: e.target.value === "TPE" ? (paymentForm.bankAccountId || liveBankAccounts[0]?.id || "") : paymentForm.bankAccountId })}>
                      <option value="ESPECES">Espèces</option>
                      <option value="CHEQUE">Chèque</option>
                      <option value="VIREMENT">Virement</option>
                      <option value="TPE">Carte / TPE</option>
                    </select>
                  </div>
                </div>

                {paymentForm.mode === "CHEQUE" && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Numéro de Chèque</label>
                    <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" value={paymentForm.chequeNumber} onChange={e => setPaymentForm({...paymentForm, chequeNumber: e.target.value})} placeholder="Numéro du chèque..." />
                  </div>
                )}

                {/* Où va l'argent. Un règlement en espèces tombe dans la caisse ;
                    tout le reste atterrit sur un compte bancaire à désigner.
                    Seul le TPE demandait ce compte : un chèque encaissé ne créditait
                    donc AUCUN compte, la dette disparaissait et l'argent avec elle. */}
                {paymentForm.mode === "ESPECES" ? (
                  <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                    <p className="text-[9px] font-black text-emerald-700 uppercase ml-1 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5" /> Encaissé dans la caisse Carburant
                    </p>
                    <p className="text-[9px] font-bold text-emerald-600/70 italic leading-relaxed px-1 mt-1">
                      Le montant entre dans le coffre de l'activité Carburant — celle qui tient ce
                      client — et apparaît dans le journal de la Caisse Générale.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 p-4 rounded-2xl bg-blue-50/60 border border-blue-100">
                    <label className="text-[9px] font-black text-blue-700 uppercase ml-1 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {paymentForm.mode === "TPE" ? "Compte bancaire du TPE" : "Compte bancaire crédité"}
                    </label>
                    {liveBankAccounts.length === 0 ? (
                      <p className="text-[10px] font-bold text-red-500 italic leading-relaxed px-1">
                        Aucun compte bancaire. Créez-en un dans « Comptes Bancaires » pour encaisser ce règlement.
                      </p>
                    ) : (
                      <>
                        <select
                          className="input-field border-blue-200 focus:border-blue-900 text-blue-900 font-black text-[11px] h-13 shadow-inner bg-white"
                          value={paymentForm.bankAccountId}
                          onChange={e => setPaymentForm({ ...paymentForm, bankAccountId: e.target.value })}
                        >
                          <option value="">— Choisir le compte —</option>
                          {liveBankAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name} — {a.balance.toLocaleString()} DA</option>
                          ))}
                        </select>
                        <p className="text-[9px] font-bold text-blue-600/70 italic leading-relaxed px-1">
                          Le montant sera crédité sur ce compte et apparaîtra dans son historique de transactions.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Remarques / Notes</label>
                  <textarea className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs p-3 shadow-inner" placeholder="Notes additionnelles..." rows={2} value={paymentForm.notes} onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})} />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t flex flex-wrap gap-3 shrink-0">
                <button onClick={() => { setShowPayment(false); setSelectedSale(null); }} className="px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic">Annuler</button>
                <button
                  onClick={() => handleRecordPayment(false)}
                  disabled={paymentForm.amount <= 0 || (paymentForm.mode !== "ESPECES" && !paymentForm.bankAccountId)}
                  className="flex-1 min-w-[140px] px-4 py-2.5 bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-50 transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" /> Valider
                </button>
                <button
                  onClick={() => handleRecordPayment(true)}
                  disabled={paymentForm.amount <= 0 || (paymentForm.mode !== "ESPECES" && !paymentForm.bankAccountId)}
                  className="flex-1 min-w-[180px] px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4 text-yellow-400" /> Valider & Imprimer Reçu
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Corriger un mouvement du compte ─────────────────────────────────
          Un règlement mal saisi n'était rattrapable que par un second règlement
          en sens inverse. Il se reprend maintenant sur place : montant, date,
          mode, référence — et la ligne de caisse suit. */}
      <AnimatePresence>
        {editingTx && selectedClient && (
          <div className="modal-shell z-[95] not-italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setEditingTx(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-blue-200"
            >
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <Pencil className="w-5 h-5 text-yellow-400" />
                  <div>
                    <h3 className="font-black uppercase text-yellow-400">
                      {editingTx.type === 'RECHARGE' ? "Corriger la recharge" : "Corriger le règlement"}
                    </h3>
                    <p className="text-[10px] text-blue-200 font-bold mt-0.5">{selectedClient.name}</p>
                  </div>
                </div>
                <button onClick={() => setEditingTx(null)} className="p-2 hover:bg-white/10 rounded-lg text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-white">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-[11px] font-bold text-slate-500 leading-relaxed">
                  Montant enregistré à l'origine :{" "}
                  <span className="text-blue-900 font-black">{(Number(editingTx.amount) || 0).toLocaleString()} DA</span>.
                  La correction s'applique à la dette du client ET à la caisse qui avait reçu l'argent.
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Montant (DA)</label>
                  <input type="number" value={txForm.amount}
                    onChange={e => setTxForm({ ...txForm, amount: parseFloat(e.target.value) || 0 })}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-lg h-14 shadow-inner text-center" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Date</label>
                    <input type="date" value={txForm.date}
                      onChange={e => setTxForm({ ...txForm, date: e.target.value })}
                      className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Mode</label>
                    <select value={txForm.mode} onChange={e => setTxForm({ ...txForm, mode: e.target.value })}
                      className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner">
                      <option value="ESPECES">Espèces</option>
                      <option value="CHEQUE">Chèque</option>
                      <option value="VIREMENT">Virement</option>
                      <option value="TPE">Carte / TPE</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Référence / N° de chèque</label>
                  <input type="text" value={txForm.receiptNumber}
                    onChange={e => setTxForm({ ...txForm, receiptNumber: e.target.value })}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Notes</label>
                  <textarea rows={2} value={txForm.notes}
                    onChange={e => setTxForm({ ...txForm, notes: e.target.value })}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs p-3 shadow-inner" />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t flex gap-3 shrink-0">
                <button onClick={() => setEditingTx(null)}
                  className="px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all">Annuler</button>
                <button onClick={saveEditedTx} disabled={txForm.amount <= 0}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 hover:scale-[1.02] transition-all flex items-center justify-center gap-2">
                  <Save className="w-4 h-4 text-yellow-400" /> Enregistrer la correction
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── La reprise d'ouverture du compte ───────────────────────────────── */}
      <AnimatePresence>
        {showOpening && selectedClient && (
          <div className="modal-shell z-[95] not-italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowOpening(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-amber-200"
            >
              <div className="p-6 bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <Flag className="w-5 h-5" />
                  <div>
                    <h3 className="font-black uppercase">Ouverture du compte</h3>
                    <p className="text-[10px] font-bold mt-0.5 opacity-90">{selectedClient.name}</p>
                  </div>
                </div>
                <button onClick={() => setShowOpening(false)} className="p-2 hover:bg-white/10 rounded-lg text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-white">
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] font-semibold text-amber-900 leading-relaxed">
                  Ce que le client devait — ou avait déjà versé — le jour où sa fiche a été créée.
                  Ce montant devient la <b>première ligne de son historique</b> : il compte sur sa
                  carte, dans la Caisse Générale et dans les rapports. La <b>dette</b> est une
                  créance de plus ; l'<b>avance</b> est son argent — elle vient en déduction de ce
                  qu'il doit. Ni l'une ni l'autre ne fait entrer d'argent en caisse aujourd'hui :
                  ce sont des soldes repris, pas des encaissements du jour.
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Dette initiale (DA)</label>
                  <input type="number" value={openingForm.debt}
                    onChange={e => setOpeningForm({ ...openingForm, debt: parseFloat(e.target.value) || 0 })}
                    className="input-field bg-white border-red-100 text-red-950 font-black h-14 text-lg text-center shadow-inner" />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-green-700 uppercase tracking-widest ml-1">Avance initiale (DA)</label>
                  <input type="number" value={openingForm.advance}
                    onChange={e => setOpeningForm({ ...openingForm, advance: parseFloat(e.target.value) || 0 })}
                    className="input-field bg-white border-green-100 text-green-950 font-black h-14 text-lg text-center shadow-inner" />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Date de la reprise</label>
                  <input type="date" value={openingForm.date}
                    onChange={e => setOpeningForm({ ...openingForm, date: e.target.value })}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" />
                  <p className="text-[9px] font-bold text-slate-400 leading-relaxed ml-1">
                    Elle place la ligne en tête du journal : sans elle, l'ouverture se retrouverait
                    au milieu des bons et le solde après chaque opération deviendrait faux.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Note (facultatif)</label>
                  <input type="text" value={openingForm.notes} placeholder="Ancien carnet, solde repris au 01/01…"
                    onChange={e => setOpeningForm({ ...openingForm, notes: e.target.value })}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t flex gap-3 shrink-0">
                <button onClick={() => setShowOpening(false)}
                  className="px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all">Annuler</button>
                <button onClick={saveOpening}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" /> Enregistrer la reprise
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Suppression d'un mouvement du compte client */}
      <ConfirmDialog
        isOpen={!!txToDelete}
        title="Supprimer ce mouvement"
        message={txToDelete
          ? `Supprimer ${txToDelete.type === 'RECHARGE' ? 'la recharge' : 'le règlement'} de ${(Number(txToDelete.amount) || 0).toLocaleString()} DA du ${new Date(txToDelete.date).toLocaleDateString('fr-FR')} ? La dette du client et la caisse qui avait reçu l'argent seront corrigées.`
          : ''}
        onConfirm={deleteTx}
        onCancel={() => setTxToDelete(null)}
        confirmLabel="SUPPRIMER"
        danger={true}
      />

      {/* Relevé de compte imprimable, sur la période choisie par l'utilisateur. */}
      {reportClient && (
        <ClientReportModal
          open
          onClose={() => setReportClient(null)}
          build={buildReport}
          settings={settings}
          clientName={reportClient.name}
          partLabel="Carburant"
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog 
        isOpen={!!clientToDelete}
        title="Supprimer un client"
        message={`Êtes-vous sûr de vouloir supprimer le client "${clientToDelete?.name}" ? Cette action est définitive et effacera tout son historique bancaire et de consommation.`}
        onConfirm={handleDeleteClient}
        onCancel={() => setClientToDelete(null)}
        confirmLabel="SUPPRIMER"
        danger={true}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default Clients;
