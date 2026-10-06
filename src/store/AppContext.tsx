import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ToastMessage, ToastType } from '../components/Toast';
import {
  db, supabase, subscribeTable, uploadFile, uploadBase64, BUCKETS,
  onRealtimeHealthChange, readPersistedSession, dbSelectAll,
} from '../lib/supabase';
import type { RealtimeHealth } from '../lib/supabase';
import { newId, degreesFromLiters } from '../lib/utils';
import { MODULES, applyMagasinSettings, isMagasin2Enabled } from '../lib/bizConfig';
import type { ConsigneMode, ConsigneState } from '../lib/bizConfig';

// ─── Null-or-zero sanitizer ────────────────────────────────────────────────────
// Converts empty-string or undefined to null so optional UUID / date FK columns
// never receive '' (which Postgres rejects with "invalid input syntax for uuid").
const nz = (v: any) => (v === '' || v === undefined ? null : v);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FuelType = 'ESSENCE' | 'GASOIL' | 'GPL' | 'DIESEL' | 'SUPER';

export interface Tank {
  id: string;
  name: string;
  type: FuelType;
  capacity: number;
  current: number;
  degrees: number;
  alertThreshold: number;
  notes?: string;
  /**
   * Cuve épinglée par l'utilisateur : elle remonte en TÊTE de l'écran Cuves et
   * de la liste du tableau de bord. Sur une station qui compte dix cuves, les
   * deux ou trois qui tournent vraiment doivent être sous les yeux sans faire
   * défiler — c'est tout ce que ce drapeau sert.
   */
  isFavorite?: boolean;
}

export interface Pump {
  id: string;
  number: string;
  name: string;
  /**
   * Primary cuve of the pump. It is no longer chosen by hand: the cuve now lives
   * on each pistolet, and this field mirrors the first pistolet's cuve so the
   * historical per-cuve accounting (brigades, fiche journalière, rapports)
   * keeps working unchanged.
   */
  tankId?: string;
  /** @deprecated Pistes were removed from the application. */
  trackId?: string;
  /** Derived from `tankId` — pumps no longer carry a hand-picked fuel type. */
  type?: FuelType;
  lastIndex: number;
  status: 'Actif' | 'Maintenance' | 'Hors service';
  currentBrigadeStartIndex?: number;
  /** Row creation date — screens list the pompes from the oldest to the newest. */
  createdAt?: string;
}

export interface PumpNozzle {
  id: string;
  pumpId: string;
  name: string;
  /** Cuve this pistolet draws from — chosen when the pistolet is created. */
  tankId?: string;
  lastIndex: number;
  startIndex: number;
  status: 'Actif' | 'Inactif';
  /** Row creation date — pistolets are listed in creation order inside a pompe. */
  createdAt?: string;
}

/** Cuve of a pistolet, falling back to its pump's cuve for legacy rows. */
export function nozzleTankId(nozzle: PumpNozzle, pumps: Pump[]): string | undefined {
  return nozzle.tankId || pumps.find(p => p.id === nozzle.pumpId)?.tankId;
}

/**
 * Pompes from the FIRST created to the LAST. Rows come back from Supabase
 * newest-first, so every screen that walks the pompes (brigade wizard, fiche…)
 * sorts through here to keep one stable, human-readable order. Pompes without a
 * creation date (legacy rows) fall back to their number.
 */
export function pumpsInCreationOrder<T extends Pump>(pumps: T[]): T[] {
  return [...pumps].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const bt = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(at) ? -1 : 1;
    return String(a.number || '').localeCompare(String(b.number || ''), 'fr', { numeric: true });
  });
}

/** Pistolets of one pompe, in creation order (name as the legacy fallback). */
export function nozzlesInCreationOrder(nozzles: PumpNozzle[]): PumpNozzle[] {
  return [...nozzles].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const bt = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(at) ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { numeric: true });
  });
}

/** Distinct cuves a pump serves, derived from its pistolets. */
export function pumpTankIds(pumpId: string, nozzles: PumpNozzle[], pumps: Pump[]): string[] {
  const ids = nozzles
    .filter(n => n.pumpId === pumpId)
    .map(n => nozzleTankId(n, pumps))
    .filter((v): v is string => !!v);
  const fallback = pumps.find(p => p.id === pumpId)?.tankId;
  if (ids.length === 0 && fallback) return [fallback];
  return Array.from(new Set(ids));
}

export interface Track {
  id: string;
  name: string;
}

// ─── Armoires (rangements de produits sur la piste) ───────────────────────────
/**
 * Une armoire est un rangement de produits posé sur la piste, d'où les
 * pompistes vendent pendant leur brigade. Elle est rattachée aux POMPES qu'elle
 * dessert (une brigade est organisée par pompiste → pompes tenues) et,
 * facultativement, à une piste. Le pompiste qui tient l'une de ces pompes vend
 * par défaut depuis cette armoire — toutes les autres restent proposées.
 *
 * Ses produits viennent d'un MAGASIN (le premier ou le second) par transfert.
 */
export interface Armoire {
  id: string;
  name: string;
  /** Piste (track) facultative à laquelle l'armoire est rattachée. */
  trackId?: string;
  /** Pompes desservies par cette armoire. */
  pumpIds?: string[];
  notes?: string;
  createdAt?: string;
}

/** Magasin d'origine d'un produit d'armoire (premier ou second magasin). */
export type MagasinKey = 'lavage' | 'magasin2';

/** Nature d'un achat / état d'un contenant d'un produit consigné (voir bizConfig). */
export type { ConsigneMode, ConsigneState };

/** Nombre d'unités PLEINES : total − vides. */
export const fullOf = (total: number, empty?: number) => (total || 0) - (empty || 0);

/** Stock courant d'un produit dans une armoire (une ligne par produit). */
export interface ArmoireStockItem {
  id: string;
  armoireId: string;
  productId: string;
  /** Magasin dont vient le produit. */
  moduleKey?: MagasinKey;
  /** Nombre TOTAL d'unités (pleines + vides pour un produit consigné). Peut être négatif. */
  quantity: number;
  /** Produit consigné : combien de ces unités sont VIDES. */
  emptyQuantity?: number;
}

/** Ligne produit d'un transfert Magasin → Armoire. */
export interface StockTransferItem {
  id: string;
  transferId?: string;
  productId: string;
  productName: string;
  barcode?: string;
  quantity: number;
  /** Produit consigné : transfère-t-on des contenants VIDES ou PLEINS ? */
  consigneState?: ConsigneState;
}

/** Transfert de produits d'un MAGASIN vers une armoire. */
export interface StockTransfer {
  id: string;
  armoireId: string;
  /** Magasin d'où partent les produits (premier ou second). */
  moduleKey: MagasinKey;
  date: string;
  /** 'produits' (bouton de la Gestion de stock) ou 'transferts' (page Transferts). */
  source: 'produits' | 'transferts';
  notes?: string;
  createdBy?: string;
  totalQty: number;
  items: StockTransferItem[];
  createdAt?: string;
}

/** Vente d'un produit depuis une armoire, enregistrée lors d'une brigade. */
export interface ArmoireSale {
  id: string;
  armoireId: string;
  brigadeId?: string;
  pompisteId?: string;
  productId: string;
  productName: string;
  moduleKey?: MagasinKey;
  quantity: number;
  price: number;
  total: number;
  date: string;
  createdAt?: string;
  /** Produit consigné : la bouteille vendue reste dans l'armoire, elle passe
   *  simplement de PLEINE à VIDE (le client repart avec le contenu). */
  consigne?: boolean;
}

/** Achat de produits fait DIRECTEMENT par un pompiste auprès d'un fournisseur
 *  passé à la station : réglé avec l'argent de la brigade et rangé dans une
 *  armoire. Il justifie le décalage de caisse ET incrémente le stock d'armoire. */
export interface ArmoirePurchase {
  id: string;
  armoireId: string;
  brigadeId?: string;
  pompisteId?: string;
  productId: string;
  productName: string;
  moduleKey?: MagasinKey;
  quantity: number;
  /** Prix d'achat unitaire — pré-rempli depuis la fiche produit, éditable. */
  unitPrice: number;
  total: number;
  supplierName?: string;
  date: string;
  createdAt?: string;
  consigneMode?: ConsigneMode;
}

/** Photo du stock d'un produit dans une armoire au moment de la création d'une
 *  brigade : ce que la brigade précédente a laissé, plus les transferts magasin
 *  → armoire intervenus depuis, et les mouvements de la brigade. */
export interface BrigadeArmoireStockLine {
  armoireId: string;
  armoireName?: string;
  productId: string;
  productName: string;
  previousQuantity: number;
  transferredQuantity: number;
  /** Quantité initiale = previousQuantity + transferredQuantity. */
  quantity: number;
  soldQuantity: number;
  purchasedQuantity: number;
  /** Quantité finale = quantity − sorties réelles + entrées réelles. */
  endQuantity: number;
  consigne?: boolean;
  previousEmptyQuantity?: number;
  transferredEmptyQuantity?: number;
  emptyQuantity?: number;
  soldEmptyQuantity?: number;
  filledQuantity?: number;
  purchasedEmptyQuantity?: number;
  endEmptyQuantity?: number;
}

// ─── Helpers de stock (transferts Magasin ↔ Armoire, brigades) ───────────────
// `quantity` est le delta du nombre TOTAL d'unités ; `emptyQuantity` celui du
// nombre d'unités VIDES (produits consignés). Les deux suivent le même signe,
// si bien qu'annuler un mouvement annule aussi son effet vide/plein.
export type StockLine = { productId: string; quantity: number; emptyQuantity?: number; moduleKey?: MagasinKey };

/** Delta d'un transfert Magasin → Armoire : un contenant VIDE transféré
 *  déplace une unité ET une unité vide. */
export const transferStockLine = (i: Pick<StockTransferItem, 'productId' | 'quantity' | 'consigneState'>): StockLine => ({
  productId: i.productId,
  quantity: i.quantity,
  emptyQuantity: i.consigneState === 'VIDE' ? i.quantity : 0,
});

/** Delta d'armoire d'une VENTE en brigade. Produit consigné : la bouteille ne
 *  quitte pas l'armoire, elle devient VIDE (total inchangé, +vides). */
export const armoireSaleStockLine = (
  s: { productId: string; quantity: number; consigne?: boolean },
): StockLine => (s.consigne
  ? { productId: s.productId, quantity: 0, emptyQuantity: s.quantity }
  : { productId: s.productId, quantity: -s.quantity });

/** Delta d'armoire d'un ACHAT en brigade. `REMPLISSAGE` : des vides repartent
 *  pleines ; `VIDE` : des contenants vides entrent en plus ; sinon achat classique. */
export const armoirePurchaseStockLine = (
  p: { productId: string; quantity: number; consigneMode?: ConsigneMode },
): StockLine => {
  if (p.consigneMode === 'REMPLISSAGE') return { productId: p.productId, quantity: 0, emptyQuantity: -p.quantity };
  if (p.consigneMode === 'VIDE') return { productId: p.productId, quantity: p.quantity, emptyQuantity: p.quantity };
  return { productId: p.productId, quantity: p.quantity };
};

export interface Driver {
  id: string;
  name: string;
  status?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface Acompte {
  id: string;
  date: string;
  amount: number;
  description?: string;
  isPaid: boolean;
  monthPaid?: string;
}

export interface Absence {
  id: string;
  date: string;
  cost: number;
  description?: string;
  isPaid: boolean;
  monthPaid?: string;
}

export interface WorkerPaymentRecord {
  id: string;
  month: string;
  baseSalary: number;
  totalAcomptes: number;
  totalAbsences: number;
  bonusDecalage?: number;
  retenueDecalage?: number;
  netSalary: number;
  /** Alias of netSalary kept for the history views that read `amount`. */
  amount?: number;
  paymentDate: string;
  paymentMode: string;
  chequeNumber?: string;
  notes?: string;
  isPaid: boolean;
  /** `jour` payroll: the worked days settled by this payment (never re-listed). */
  paidDays?: string[];
  /** `mois` payroll: the months settled by this payment. */
  paidMonths?: string[];
  /** Pompiste: the décalage lines applied by this payment. */
  decalageIds?: string[];
  /** Optional bonus added on top of the net. */
  primeType?: 'percent' | 'amount';
  primeValue?: number;
  primeAmount?: number;
}

export interface Pompiste {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  cin?: string;
  address?: string;
  photo?: string;      // URL (from bucket) or base64 (legacy)
  photoUrl?: string;   // Supabase bucket URL
  status: 'Actif' | 'Inactif';
  trackId?: string;
  chefId?: string;
  baseSalary: number;
  /** `mois` (default) pays a monthly salary; `jour` pays a daily rate. */
  salaryType?: 'jour' | 'mois';
  /** Weekdays worked (0 = Sunday … 6 = Saturday) — only used when salaryType = 'jour'. */
  workDays?: number[];
  /** Date the employee was declared to the CNAS (social security). */
  cnasDate?: string;
  hasAccess: boolean;
  username?: string;
  password?: string;
  authUserId?: string; // Supabase auth.users id (null = no account yet)
  permissions?: UserPermissions;
  paymentRecord?: WorkerPaymentRecord[];
  acomptes?: Acompte[];
  absences?: Absence[];
  hireDate?: string;
  decalageHistory?: {
    brigadeId: string;
    date: string;
    amount: number;
    type: 'BONUS' | 'RETENUE';
  }[];
}

export interface BrigadeChef {
  id: string;
  name: string;
  phone?: string;
  cin?: string;
  email?: string;
  address?: string;
  photo?: string;
  photoUrl?: string;
  status: 'Actif' | 'Inactif' | 'En service' | 'En congé' | 'Congé';
  baseSalary: number;
  hireDate?: string;
  hasAccess: boolean;
  username?: string;
  password?: string;
  authUserId?: string;
  permissions?: UserPermissions;
  pompisteIds: string[];
  acomptes?: Acompte[];
  absences?: Absence[];
  paymentRecord?: WorkerPaymentRecord[];
  decalageHistory?: {
    brigadeId: string;
    date: string;
    amount: number;
    type: 'BONUS' | 'RETENUE';
  }[];
}

export interface GerantWorker {
  id: string;
  name: string;
  phone?: string;
  cin?: string;
  email?: string;
  address?: string;
  photo?: string;
  photoUrl?: string;
  status: 'Actif' | 'Inactif';
  baseSalary: number;
  salaryType?: 'jour' | 'mois';
  workDays?: number[];
  cnasDate?: string;
  hireDate?: string;
  hasAccess: boolean;
  username?: string;
  password?: string;
  authUserId?: string;
  permissions?: UserPermissions;
  paymentRecord?: WorkerPaymentRecord[];
  acomptes?: Acompte[];
  absences?: Absence[];
}

export interface MagasinWorker {
  id: string;
  name: string;
  phone?: string;
  cin?: string;
  email?: string;
  address?: string;
  photo?: string;
  photoUrl?: string;
  status: 'Actif' | 'Inactif';
  baseSalary: number;
  salaryType?: 'jour' | 'mois';
  workDays?: number[];
  cnasDate?: string;
  hireDate?: string;
  hasAccess: boolean;
  username?: string;
  password?: string;
  authUserId?: string;
  permissions?: UserPermissions;
  paymentRecord?: WorkerPaymentRecord[];
  acomptes?: Acompte[];
  absences?: Absence[];
}

export interface Brigade {
  id: string;
  /**
   * Instant de CRÉATION de la fiche, tel que la base l'a posé (`created_at`).
   * `date` ne dit que le jour couvert par la brigade : deux brigades saisies le
   * même jour, ou une brigade d'hier enregistrée ce matin, ne se départagent
   * que par celui-ci. C'est lui qui met la liste dans l'ordre « la dernière
   * créée en tête ».
   */
  createdAt?: string;
  date: string;
  shift: 'Matin' | 'Soir' | 'Nuit';
  chefId: string;
  status: 'Planifiée' | 'Ouverte' | 'Clôturée' | 'Fermée' | 'En attente';
  startTimestamp?: string;
  endTimestamp?: string;
  startTime?: string;
  endTime?: string;
  startDatetime?: string;   // ISO timestamp replacing separate date+startTime
  endDatetime?: string;     // ISO timestamp replacing separate date+endTime
  isActive: boolean;
  notes?: string;
  printedAt?: string;
  pompisteIds?: string[];
  startIndices?: Record<string, number>;
  endIndices?: Record<string, number>;
  startTankLevels?: Record<string, { degrees: number; liters: number }>;
  /**
   * Niveau des cuves en fin de brigade. `measured` distingue la JAUGE relevée à
   * la main — celle qui sert au calcul du décalage — du niveau simplement déduit
   * du volume débité par les pistolets. Absent sur les brigades enregistrées
   * avant l'ajout du drapeau : elles sont alors traitées comme un relevé.
   */
  endTankLevels?: Record<string, { degrees: number; liters: number; measured?: boolean }>;
  pompisteData?: Record<string, {
    litersSold: number;
    theoretical: number;
    collected: { cash: number; bons: number; cheques: number };
    totalCollected: number;
    decalage: number;
    pricePerLiter: number;
  }>;
  pompisteAssignments?: Array<{
    pompisteId: string;
    trackId: string;
    present: boolean;
    chefActingAsPompiste?: boolean;
  }>;
  startNozzleIndices?: Record<string, number>;
  endNozzleIndices?: Record<string, number>;
  activeNozzleIds?: string[];
  canReactivate?: boolean;
  /** Pompes held by each pompiste on this brigade (several per pompiste). */
  pompistePumpAssignments?: Array<{ pompisteId: string; pumpIds: string[] }>;
  /**
   * Cash instalments handed over during the brigade, timed to the minute. They
   * add up to what the pompiste actually gave and justify the décalage against
   * the theoretical takings.
   */
  versements?: Array<{ id: string; pompisteId: string; amount: number; at: string; notes?: string }>;
  /** Ventes de produits depuis les armoires saisies à la création de la brigade
   *  (récap conservé ; le stock d'armoire est décrémenté). */
  armoireSales?: Array<{
    armoireId: string;
    pompisteId: string;
    productId: string;
    productName: string;
    moduleKey?: MagasinKey;
    quantity: number;
    price: number;
    total: number;
    /** Coût de revient d'une unité, figé à la vente (prix d'achat / de remplissage). */
    unitCost?: number;
    /** Produit consigné : la bouteille vendue reste dans l'armoire, elle se vide. */
    consigne?: boolean;
  }>;
  /** Achats de produits réglés par un pompiste sur la caisse de la brigade et
   *  rangés dans une armoire (justificatif ACHAT_PRODUIT). */
  armoireProductPurchases?: Array<{
    armoireId: string;
    pompisteId: string;
    productId: string;
    productName: string;
    moduleKey?: MagasinKey;
    quantity: number;
    unitPrice: number;
    total: number;
    supplierName?: string;
    consigneMode?: ConsigneMode;
  }>;
  /** Photo du stock de TOUTES les armoires prise à la création de la brigade. */
  armoireStockSnapshot?: BrigadeArmoireStockLine[];
}

export interface BrigadeAccountingJustification {
  id: string;
  accountingId: string;
  /** For a TPE justification: the bank account of that terminal, credited on save. */
  bankAccountId?: string;
  clientId: string;
  amount: number;
  clientType?: string;
  paymentMode?: string;
  notes?: string;
  // 'EXPENSE' : une dépense payée sur les espèces de la brigade (nom + montant,
  // description facultative). Elle justifie le reste au même titre qu'un bon,
  // sans client ni compte bancaire.
  // 'ACHAT_PRODUIT' : marchandise achetée par le pompiste sur la caisse de la
  // brigade et rangée dans une armoire (bouteilles de gaz comprises).
  justificationType?: 'CLIENT' | 'TAG' | 'TPE' | 'EXPENSE' | 'ACHAT_PRODUIT'; // default 'CLIENT'
  clientName?: string;    // optional free-text name for TAG/TPE (or the expense label)
  /**
   * La catégorie d'une justification EXPENSE — celle de l'écran Dépenses
   * (`settings.expenseCategories`). Facultative : sans elle, la dépense écrite
   * dans l'écran Dépenses est classée « Dépense brigade ».
   */
  expenseCategory?: string;
  fuelType?: string;      // e.g. 'SUPER', 'DIESEL'
  liters?: number;        // how many liters
  pricePerLiter?: number; // auto-filled from settings
  trackId?: string;       // which piste (track)
  pompisteId?: string;    // which pompiste
  // ── Justificatif ACHAT_PRODUIT (marchandise achetée et rentrée en armoire) ──
  productId?: string;
  productName?: string;
  /** Magasin dont vient la fiche du produit. */
  moduleKey?: MagasinKey;
  armoireId?: string;
  /** Quantité achetée, en unités de stock du produit. */
  quantity?: number;
  /** Prix d'achat unitaire retenu (pré-rempli, éditable). */
  unitPrice?: number;
  supplierName?: string;
  /** Produit consigné : `REMPLISSAGE` (bouteilles vides remplies) ou `VIDE`. */
  consigneMode?: ConsigneMode;
}

export interface TpeTransaction {
  id: string;
  brigadeId: string;
  accountingId?: string;
  date: string;
  mode: 'TAG' | 'TPE';
  clientName?: string;
  clientId?: string;
  fuelType: string;
  liters: number;
  pricePerLiter: number;
  amount: number;
  trackId?: string;
  trackName?: string;
  pompisteId?: string;
  pompisteName?: string;
  notes?: string;
  createdAt: string;
}

export interface BrigadeAccounting {
  id: string;
  brigadeId: string;
  totalDue: number;
  cashReceived: number;
  rest: number;
  tankSummary: any[];
  nozzleSummary: any[];
  decalageSummary: Record<string, any>;
  pompisteSummary?: Record<string, any>;
  cuveVerifications: Record<string, { verified: boolean; corrected: boolean; correctedValue?: number }>;
  nozzleVerifications: Record<string, { verified: boolean; corrected: boolean; correctedValue?: number }>;
  restAssignedWorkerType?: string;
  restAssignedWorkerId?: string;
  restAssignedAmount: number;
  status: 'draft' | 'completed';
  createdBy?: string;
  justifications?: BrigadeAccountingJustification[];
}

export interface Client {
  id: string;
  name: string;
  phone?: string;
  cin?: string;
  email?: string;
  address?: string;
  contactPerson?: string;
  balance: number;
  debt: number;
  creditLimit: number;
  paymentDelay: number;
  type: 'PARTICULIER' | 'ENTREPRISE' | 'GOUVERNEMENT';
  paymentMode: 'CASH' | 'CREDIT' | 'ADVANCE';
  nif?: string;
  nis?: string;
  article?: string;
  rc?: string;
  advanceBalance?: number;
  /**
   * ─── L'OUVERTURE DU COMPTE ─────────────────────────────────────────────────
   * Ce que le client devait DÉJÀ (ou avait déjà versé) le jour où sa fiche a été
   * créée. Le montant était jusqu'ici écrit dans les seules colonnes `debt` /
   * `balance` : le journal du client — la source que TOUS les écrans lisent
   * désormais — n'en savait rien, l'historique s'ouvrait donc vide et le rapport
   * général ne comptait pas la créance. C'est maintenant une ligne du compte.
   */
  openingDebt?: number;
  openingAdvance?: number;
  /** Date de la reprise — la création de la fiche à défaut. */
  openingDate?: string;
  openingNotes?: string;
  createdAt?: string;
  appointments?: ClientAppointment[];
  transactionHistory: {
    id: string;
    date: string;
    type: 'RECHARGE' | 'PAYMENT' | 'SALE';
    amount: number;
    mode?: string;
    receiptNumber?: string;
    receiptPhoto?: string;
    notes?: string;
  }[];
}

export interface SupplierDebtPayment {
  id: string;
  purchaseId?: string;
  deliveryNoteId?: string;
  date: string;
  amount: number;
  totalDue: number;
  rest: number;
  paymentMode: 'ESPECES' | 'CHEQUE' | 'VIREMENT';
  chequeNumber?: string;
  notes?: string;
}

export interface SupplierAppointment {
  id: string;
  purchaseId?: string;
  date: string;
  amount: number;
  notes?: string;
  isPaid: boolean;
}

export interface ClientAppointment {
  id: string;
  saleId?: string;
  date: string;
  amount: number;
  notes?: string;
  isPaid: boolean;
}

export interface Supplier {
  id: string;
  ref?: string;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  balance: number;
  totalPurchases: number;
  nif?: string;
  nis?: string;
  article?: string;
  rc?: string;
  type?: 'Carburant' | 'Magasin';
  debtPayments?: SupplierDebtPayment[];
  appointments?: SupplierAppointment[];
}

export interface ProductBrand {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  ref?: string;
  name: string;
  category: string;
  buyPrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  barcode?: string;
  image?: string;    // URL (bucket) or base64 (legacy)
  imageUrl?: string; // Supabase bucket URL
  unit: string;
  brand?: string;
  brandId?: string;
  lastSellingPrice?: number;
  tvaRate?: number;
  sellByDetails?: boolean;
  detailCapacity?: number;
  detailUnit?: string;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  description: string;
  paymentMode?: string;
  chequeNumber?: string;
  /** Bordereau of a virement / versement, when the money left a bank account. */
  bordereauNumber?: string;
  /**
   * Account the money actually left. En espèces, c'est la caisse de l'activité
   * qui paie (`CAISSE_CARBURANT`, `CAISSE_CAFETERIA`…) — la caisse générale
   * uniquement pour une dépense de la Finance ; sinon un `BankAccount.id`.
   * La dépense apparaît alors dans l'historique de ce compte.
   */
  accountId?: string;
  /**
   * L'activité qui SUPPORTE la dépense — c'est elle qui la paie et c'est dans
   * son rapport qu'elle pèse. Absent sur les dépenses saisies avant ce choix :
   * elles étaient toutes portées par le Carburant (voir `expensePartOf`).
   */
  part?: TreasuryPart;
  paidBy?: string;
  recipient?: string;
  status?: string;
  receipt?: string;   // URL or base64
  receiptUrl?: string;
  createdBy?: string;
  /**
   * ─── UNE DÉPENSE NÉE D'UNE BRIGADE ──────────────────────────────────────
   *
   * La comptabilité d'une brigade peut justifier son reste « par dépense » :
   * le pompiste a payé quelque chose avec les espèces de la brigade et remet
   * d'autant moins. Cette dépense-là est alors écrite ICI, dans l'écran
   * Dépenses, pour qu'elle pèse dans le résultat du Carburant comme n'importe
   * quelle autre charge — et pour qu'on puisse la retrouver.
   *
   * Elle ne SORT en revanche d'AUCUNE caisse : l'argent n'y est jamais entré,
   * puisque la brigade a remis son montant en moins. Toute lecture de
   * trésorerie doit donc l'écarter — voir `isBrigadeExpense`.
   */
  brigadeId?: string;
  /** La justification de brigade dont elle est née (son propre `id`). */
  brigadeJustificationId?: string;
  /** Le pompiste sur le lot duquel la dépense a été justifiée. */
  pompisteId?: string;
}

// ─── Treasury: general cash box + bank accounts ────────────────────────────────

/** A bank account of the station. `balance` is the live solde. */
export interface BankAccount {
  id: string;
  name: string;             // bank name, e.g. "BNA — Mostaganem"
  accountNumber?: string;
  initialBalance: number;   // solde at creation
  balance: number;          // current solde (maintained by the ledger)
  notes?: string;
  createdAt: string;
}

/** Pseudo-account id of the general cash box in the treasury ledger. */
export const CAISSE_ID = 'CAISSE' as const;

/**
 * Pseudo-account id of the cash box of ONE activity of the station. Money can
 * be moved from the caisse of a part (Carburant, Cafétéria, Magasin) to a bank
 * account or to another caisse exactly like from the caisse générale: the
 * movement is a single `TRANSFER` line whose `accountFrom` / `accountTo` hold
 * these ids, so both sides can never disagree.
 */
export const CAISSE_PART_ID = {
  carburant: 'CAISSE_CARBURANT',
  restaurant: 'CAISSE_RESTAURANT',
  cafeteria: 'CAISSE_CAFETERIA',
  lavage: 'CAISSE_LAVAGE',
  magasin2: 'CAISSE_MAGASIN2',
} as const;

/** Every cash box of the station, general one included. */
export const CASH_ACCOUNT_IDS: string[] = [CAISSE_ID, ...Object.values(CAISSE_PART_ID)];

/** Display name of any account id used in the ledger. */
export const CASH_ACCOUNT_LABEL: Record<string, string> = {
  [CAISSE_ID]: 'Caisse générale',
  [CAISSE_PART_ID.carburant]: 'Caisse Carburant',
  [CAISSE_PART_ID.restaurant]: 'Caisse Restaurant',
  [CAISSE_PART_ID.cafeteria]: 'Caisse Cafétéria',
  // Les deux magasins portent le nom choisi dans Paramètres → Magasins.
  get [CAISSE_PART_ID.lavage]() { return `Caisse ${MODULES.lavage.label}`; },
  get [CAISSE_PART_ID.magasin2]() { return `Caisse ${MODULES.magasin2.label}`; },
};

/**
 * Applique les noms choisis pour les magasins (Paramètres → Magasins) à TOUS
 * les libellés de l'application : sections de la barre latérale, caisses,
 * rapports. Appelé à chaque changement des réglages, avant le rendu des écrans.
 */
export function syncMagasinLabels(settings: Pick<StationSettings, 'magasin1Name' | 'magasin2Name' | 'magasin2Enabled'> | null | undefined): void {
  // Les libellés des caisses et des rapports lisent MODULES à la volée.
  applyMagasinSettings(settings);
}

/** `true` when the id designates a cash box rather than a bank account. */
export const isCashAccount = (id?: string): boolean => !!id && CASH_ACCOUNT_IDS.includes(id);

/**
 * Readable name of an `accountFrom` / `accountTo`: a cash box, a bank account,
 * or the outside world when the id is empty.
 */
export function accountLabelOf(
  id: string | undefined,
  accounts: Pick<BankAccount, 'id' | 'name'>[],
  fallback = 'Externe',
): string {
  if (!id) return fallback;
  return CASH_ACCOUNT_LABEL[id] || accounts.find(a => a.id === id)?.name || fallback;
}

/**
 * The nature of a treasury movement. `DEPOSIT` / `WITHDRAW` are manual cash
 * operations on the general caisse; `TRANSFER` moves money between the caisse
 * and a bank account (or between two bank accounts); the remaining kinds are
 * written automatically by the business screens so the ledger tells the whole
 * story of the station's money.
 */
export type TreasuryKind =
  | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER'
  | 'PURCHASE' | 'SALE' | 'EXPENSE' | 'BRIGADE' | 'TPE' | 'SALARY' | 'ADJUST';

/** Which activity of the station the movement belongs to. */
export type TreasuryPart = 'carburant' | 'restaurant' | 'cafeteria' | 'lavage' | 'magasin2' | 'systeme';

/** Les activités qui tiennent leur PROPRE caisse — la Finance tient la générale. */
export const TREASURY_PARTS: TreasuryPart[] = ['carburant', 'restaurant', 'cafeteria', 'lavage', 'magasin2', 'systeme'];

/** Les activités réellement utilisées : le second magasin n'y figure qu'une fois créé. */
export const activeTreasuryPartList = (): TreasuryPart[] =>
  TREASURY_PARTS.filter(p => p !== 'magasin2' || isMagasin2Enabled());

/**
 * La caisse d'où sortent les ESPÈCES d'une activité : son propre coffre, et la
 * caisse générale seulement pour la Finance.
 *
 * C'est la règle qui manquait aux dépenses : payée en espèces, une dépense de
 * la Cafétéria vidait la caisse GÉNÉRALE — l'activité qui la supportait, elle,
 * gardait un tiroir plein d'un argent déjà dépensé.
 */
export const cashAccountOfPart = (part?: TreasuryPart): string =>
  (part && (CAISSE_PART_ID as Record<string, string>)[part]) || CAISSE_ID;

/** L'activité dont un coffre est le tiroir (`undefined` pour la caisse générale). */
export const partOfCashAccount = (id?: string): TreasuryPart | undefined =>
  (Object.keys(CAISSE_PART_ID) as (keyof typeof CAISSE_PART_ID)[])
    .find(k => CAISSE_PART_ID[k] === id);

/**
 * L'activité qui supporte une dépense. Les dépenses saisies avant que ce choix
 * existe n'en portent aucune : elles étaient toutes comptées au Carburant (par
 * la caisse comme par le rapport), c'est donc là qu'elles restent.
 */
export const expensePartOf = (e: { part?: string | null } | null | undefined): TreasuryPart =>
  ((e?.part as TreasuryPart) || 'carburant');

/**
 * Une dépense née d'une justification de brigade.
 *
 * Son montant est DÉJÀ retranché des espèces remises par la brigade : le
 * pompiste l'a réglée sur le tiroir avant de rendre le reste. La retirer une
 * seconde fois d'une caisse compterait le même argent deux fois — toutes les
 * lectures de trésorerie (caisse Carburant, Caisse Générale, journal) doivent
 * donc l'ignorer. Elle reste en revanche une CHARGE à part entière dans les
 * rapports de résultat.
 */
export const isBrigadeExpense = (
  e: { brigadeId?: string | null } | null | undefined,
): boolean => !!(e && e.brigadeId);

/**
 * One line of the station's money ledger. `accountFrom` / `accountTo` hold
 * either `CAISSE_ID` (the general cash box), a `BankAccount.id`, or `undefined`
 * when the money comes from / goes to the outside world (a client, a supplier…).
 */
export interface TreasuryTransaction {
  id: string;
  date: string;
  kind: TreasuryKind;
  amount: number;
  description?: string;
  accountFrom?: string;
  accountTo?: string;
  part: TreasuryPart;
  /** Origin document, e.g. `{ refType: 'purchase', refId: 'pur-12' }`. */
  refType?: string;
  refId?: string;
  chequeNumber?: string;
  bordereauNumber?: string;
  createdBy?: string;
  createdAt: string;
}

/**
 * Écarte les DOUBLONS d'encaissement de brigade au grand livre.
 *
 * Une brigade n'écrit qu'UNE ligne d'espèces (`kind === 'BRIGADE'`) vers un
 * tiroir. Mais ré-enregistrer la comptabilité d'une brigade pouvait laisser
 * l'ancienne ligne en place : deux encaissements pour la même brigade, et la
 * caisse — donc toute la trésorerie — gonflée d'autant. Vu en production sur la
 * brigade du 29/08, comptée à la fois 1 220 425 ET 1 221 725 (créées à 11 min
 * d'écart) : +1 220 425 de trop dans la caisse générale.
 *
 * On ne garde, par brigade, que la ligne d'espèces la PLUS RÉCENTE — celle que
 * la dernière sauvegarde a écrite. Rien d'autre n'est touché : les lignes
 * TAG/TPE d'une brigade portent une nature distincte (`kind` ≠ `BRIGADE`) même
 * quand elles partagent son `refId`, et les règlements MULTIPLES d'un même achat
 * (`kind === 'PURCHASE'`) sont autant de vrais versements — les fondre
 * effacerait de l'argent réellement payé.
 */
export function dedupeLedger(txs: TreasuryTransaction[]): TreasuryTransaction[] {
  const keep = new Map<string, TreasuryTransaction>();
  for (const t of txs) {
    if (t.kind !== 'BRIGADE' || !t.refId) continue;
    const cur = keep.get(t.refId);
    if (!cur || new Date(t.createdAt).getTime() >= new Date(cur.createdAt).getTime()) {
      keep.set(t.refId, t);
    }
  }
  if (keep.size === 0) return txs;
  return txs.filter(t =>
    t.kind !== 'BRIGADE' || !t.refId || keep.get(t.refId)!.id === t.id);
}

/** Net effect of the ledger on one account id (`CAISSE_ID` or a bank id). */
export function ledgerNetFor(accountId: string, txs: TreasuryTransaction[]): number {
  let net = 0;
  for (const t of dedupeLedger(txs)) {
    if (t.accountTo === accountId) net += t.amount;
    if (t.accountFrom === accountId) net -= t.amount;
  }
  return net;
}

/**
 * Le sens NATUREL d'une écriture, quand elle ne dit pas de quel compte elle part
 * ou dans lequel elle arrive (lignes anciennes, saisies sans compte).
 */
const OUTGOING_TX_KINDS = ['WITHDRAW', 'PURCHASE', 'EXPENSE', 'SALARY'];
const INCOMING_TX_KINDS = ['DEPOSIT', 'SALE', 'BRIGADE', 'ADJUST'];

/**
 * Effet d'une ligne du grand livre sur les ESPÈCES de la station — tous tiroirs
 * confondus (caisse générale ET coffres des activités).
 *
 * C'est le seul signe qui vaille pour un journal de caisse : seuls les deux
 * comptes de la ligne disent où l'argent a bougé. Le signer sur sa NATURE —
 * « un achat, une dépense, un salaire, donc de l'argent qui sort de la caisse »
 * — comptait comme un décaissement d'espèces tout ce qui était réglé par
 * VIREMENT BANCAIRE : le compte bancaire était bien débité, et la Caisse
 * Générale retirait le même montant une seconde fois d'un tiroir qui ne l'avait
 * jamais contenu. Un encaissement TPE, lui, arrive en banque et gonflait les
 * entrées de la caisse pour la même raison.
 *
 * Un mouvement qui se joue entièrement en banque vaut donc zéro : l'argent a
 * bougé, les espèces non. D'un tiroir vers un autre, il est lu depuis le tiroir
 * SOURCE — c'est celui-là que la ligne porte (`tx.part`), et c'est bien de
 * là que l'argent est parti.
 */
export function cashEffectOf(
  t: Pick<TreasuryTransaction, 'kind' | 'amount' | 'accountFrom' | 'accountTo'>,
): number {
  const amount = Number(t.amount) || 0;
  if (!amount) return 0;
  const cashIn = t.accountTo ? isCashAccount(t.accountTo) : INCOMING_TX_KINDS.includes(t.kind);
  const cashOut = t.accountFrom ? isCashAccount(t.accountFrom) : OUTGOING_TX_KINDS.includes(t.kind);
  if (cashIn && cashOut) return -amount;
  return (cashIn ? amount : 0) - (cashOut ? amount : 0);
}

/**
 * Montant de l'opération signé du point de vue de la TRÉSORERIE (espèces ET
 * banque) : ce qu'elle a réellement fait bouger, même quand aucun tiroir n'a été
 * ouvert. Un virement interne vaut zéro — l'argent n'a fait que changer de place.
 */
export function treasuryEffectOf(
  t: Pick<TreasuryTransaction, 'kind' | 'amount' | 'accountFrom' | 'accountTo'>,
): number {
  const amount = Number(t.amount) || 0;
  if (!amount || t.kind === 'TRANSFER') return 0;
  return OUTGOING_TX_KINDS.includes(t.kind) ? -amount : amount;
}

/**
 * Effet d'UNE ligne du grand livre sur la caisse d'UNE activité.
 *
 * La caisse d'une activité, c'est l'argent liquide qu'elle détient — QUEL QUE
 * SOIT le tiroir où il se trouve : son propre coffre (`CAISSE_CARBURANT`…) ou la
 * caisse générale, quand le mouvement lui est imputé. Un dépôt saisi dans la
 * Caisse Générale avec « Carburant » en partie concernée entre bien dans la
 * caisse Carburant : il n'était compté nulle part, la partie qui le portait
 * n'étant lue que sur son coffre.
 *
 * Les deux bouts sont examinés séparément, ce qui donne la bonne réponse même
 * quand les deux appartiennent à l'activité : un virement de son coffre vers la
 * caisse générale ne fait que déplacer son argent, et vaut donc zéro pour elle.
 */
export function partCashEffect(part: TreasuryPart, t: TreasuryTransaction): number {
  const coffer = (CAISSE_PART_ID as Record<string, string>)[part];
  /** Ce bout du mouvement est-il un tiroir de CETTE activité ? */
  const mine = (id?: string) => !!id && (id === coffer || (id === CAISSE_ID && t.part === part));
  return (mine(t.accountTo) ? t.amount : 0) - (mine(t.accountFrom) ? t.amount : 0);
}

/**
 * Les opérations MANUELLES du grand livre qui touchent la caisse d'une activité
 * — dépôts, retraits, virements, ajustements.
 *
 * Les lignes nées d'un document (`refType`) sont écartées : achats, dépenses,
 * brigades et règlements clients sont déjà comptés depuis leur document. Sans
 * ce filtre, chaque encaissement de brigade compterait deux fois.
 */
export function partCashLedgerLines(
  part: TreasuryPart, txs: TreasuryTransaction[],
): { tx: TreasuryTransaction; amount: number }[] {
  const out: { tx: TreasuryTransaction; amount: number }[] = [];
  for (const t of txs) {
    if (t.refType) continue;
    const amount = partCashEffect(part, t);
    if (amount) out.push({ tx: t, amount });
  }
  return out;
}

/** Live solde of a bank account: its opening balance plus every movement. */
export function bankBalanceOf(
  account: Pick<BankAccount, 'id' | 'initialBalance'>,
  txs: TreasuryTransaction[],
): number {
  return account.initialBalance + ledgerNetFor(account.id, txs);
}

/** Live solde of the general cash box (pure ledger, no opening balance). */
export function caisseBalanceOf(txs: TreasuryTransaction[]): number {
  return ledgerNetFor(CAISSE_ID, txs);
}

export interface DeliveryNote {
  id: string;
  date: string;
  supplierId: string;
  tankId: string;
  liters: number;
  pricePerLiter: number;
  status: 'Reçu' | 'En attente';
  total: number;
  expiryDate?: string;
  photos?: string[];   // URLs
  blNumber?: string;
  blDate?: string;
  creationDate?: string;
  immatriculation?: string; // car plate, optional
  driverId?: string;         // chauffeur (FK to drivers)
  items?: DeliveryNoteItem[]; // multi-tank items
  payments: {
    id: string;
    date: string;
    amount: number;
    mode: string;
    receiptNumber?: string;
    receiptPhoto?: string;
  }[];
}

// Multi-tank items on a single Bon de Livraison
export interface DeliveryNoteItem {
  id: string;
  deliveryNoteId: string;
  tankId: string;
  liters: number;
  pricePerLiter: number;
  total: number;
}

// Fuel Invoice (Facturation)
export interface FuelInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  creationDate: string;
  receptionDate?: string;
  deliveryNoteIds: string[]; // linked BL ids
  tvaActive: boolean;
  tvaRate: number;
  subtotal: number;
  tvaAmount: number;
  total: number;
  amountPaid: number;
  rest: number;
  status: 'Payé' | 'Non Payé' | 'Partiel';
  appointmentDate?: string;
  appointmentAmount?: number;
  appointmentNotes?: string;
  invoiceImageUrl?: string;
  notes?: string;
}

// Fuel Receipt (Paiements)
export interface FuelReceipt {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  creationDate: string;
  invoiceIds: string[];        // linked invoice ids (empty = debt payment)
  totalInvoiced: number;
  amountPaid: number;
  rest: number;
  isDebtPayment: boolean;      // true when no invoices linked
  receiptImageUrl?: string;
  notes?: string;
}

export interface PurchaseItem {
  productId?: string;
  productName: string;
  quantity: number;
  buyPrice: number;
  sellingPrice: number;
  minStock?: number;
  unit?: string;
  total: number;
  tankId?: string;
  tvaActive?: boolean;
  tvaRate?: number;
}

export interface PurchasePayment {
  id: string;
  date: string;
  amount: number;
  mode: 'ESPECES' | 'CHEQUE' | 'VIREMENT';
  chequeNumber?: string;
  /** Numéro de bordereau (optional, printed on the invoice). */
  bordereauNumber?: string;
  /**
   * Where the money came from: `CAISSE_ID` for cash, or a `BankAccount.id`.
   * Bank payments are subtracted from that account through the treasury ledger.
   */
  accountId?: string;
  notes?: string;
}

export interface Purchase {
  id: string;
  date: string;
  supplierId: string;
  invoiceNumber?: string;
  dueDate?: string;
  driverId?: string;
  items: PurchaseItem[];
  total: number;
  amountPaid: number;
  rest: number;
  /**
   * `Dette` / `Dette partielle` : la facture n'est pas soldée, le reste est dû
   * au fournisseur et remonte dans les dettes fournisseurs (`lib/supplierDebt`).
   * `Partiel` et `À payer` sont les libellés historiques des mêmes situations —
   * conservés pour que les achats déjà enregistrés restent lisibles.
   */
  status: 'Payé' | 'Dette' | 'Dette partielle' | 'Partiel' | 'À payer' | 'En attente livraison';
  paymentMode?: 'ESPECES' | 'CHEQUE' | 'CREDIT' | 'VIREMENT';
  chequeNumber?: string;
  linkedDeliveryNoteId?: string;
  payments: PurchasePayment[];
  notes?: string;
  type: 'COMMANDE' | 'RECEPTION';
  receivedQuantities?: { [productId: string]: number };
  tvaRate?: number;
  tvaActive?: boolean;
  tankId?: string;
  receiptPhoto?: string;
  /** Numéro du bon de livraison saisi sur l'achat carburant. */
  blNumber?: string;
  /** Remise: en pourcentage du sous-total ou en montant fixe. */
  discountType?: 'percent' | 'amount';
  discountValue?: number;
  /** Montant de la remise réellement déduit du sous-total. */
  discountAmount?: number;
  /** Sous-total hors remise et hors TVA. */
  subtotal?: number;
  tvaAmount?: number;

  // ── Rendez-vous de paiement ────────────────────────────────────────────────
  /**
   * Quand il est activé à la création de l'achat, un rappel est affiché en haut
   * du tableau de bord jusqu'à ce que la dette soit réglée : le fournisseur doit
   * être payé à `appointmentDate`.
   */
  appointmentActive?: boolean;
  /** Date à laquelle le paiement est attendu (YYYY-MM-DD). */
  appointmentDate?: string;
  /** Montant attendu ce jour-là ; vide ⇒ le reste dû. */
  appointmentAmount?: number;
  appointmentNotes?: string;
  /** Passe à `true` dès que la dette est soldée (ou manuellement). */
  appointmentPaid?: boolean;
  appointmentPaidAt?: string;
}

export interface FuelSale {
  id: string;
  date: string;
  pumpId: string;
  liters: number;
  pricePerLiter: number;
  total: number;
  paymentMode: 'ESPECES' | 'BON' | 'CHEQUE' | 'CREDIT' | 'AVANCE';
  clientId?: string;
  bonNumber?: string;
  bonPhoto?: string;
  bonPhotoUrl?: string;
  pompisteId: string;
  brigadeId: string;
}

export interface ShopSale {
  id: string;
  date: string;
  clientId?: string;
  sellerId?: string;
  items: { productId: string; productName: string; quantity: number; price: number; tva?: number }[];
  subtotal: number;
  tvaAmount?: number;
  total: number;
  paymentMode: 'ESPECES' | 'CHEQUE' | 'CREDIT' | 'AVANCE' | 'BON';
  chequeNumber?: string;
  bonNumber?: string;
  bonPhoto?: string;
  bonPhotoUrl?: string;
  amountPaid?: number;
  rest?: number;
  status: 'Payé' | 'Dette';
  notes?: string;
  printedAt?: string;
  invoiceImageUrl?: string;
}

export interface InventoryPumpIndex {
  pumpId: string;
  systemIndex: number;
  actualIndex: number;
  gap: number;
}

export interface Inventory {
  id: string;
  name?: string;
  description?: string;
  date: string;
  user: string;
  type?: 'Carburant' | 'Magasin';
  status: 'En cours' | 'Validé' | 'Comparé';
  fuelGaps: {
    tankId: string; systemQty: number; actualQty: number; degrees?: number; gap: number; value: number;
  }[];
  pumpIndexGaps?: InventoryPumpIndex[];
  productGaps: {
    productId: string; systemQty: number; actualQty: number; gap: number; value: number;
  }[];
  adjustmentReason?: string;
  adjustedAt?: string;
}

export interface UserPermission {
  voir: boolean; creer: boolean; modifier: boolean; supprimer: boolean;
  imprimer: boolean; exporter: boolean; scanner: boolean; generer: boolean;
}

export interface UserPermissions {
  [moduleId: string]: UserPermission;
}

/** Every role the app can be signed in as. `module_worker` is an employee of one
 *  of the business parts (Restaurant / Cafétéria / Magasin). */
export type AppUserRole =
  | 'admin' | 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin' | 'module_worker';

/** Connected employee of a business part, resolved at login from Supabase. */
export interface ModuleWorkerSession {
  id: string;
  moduleKey: 'restaurant' | 'cafeteria' | 'lavage' | 'magasin2';
  name: string;
  roleName?: string;
  /** Flat map keyed `"<interface>.<action>"`, e.g. `"stock.voir"`. */
  permissions: Record<string, boolean>;
}

/** A reusable, named set of permissions the admin can save per role and apply
 *  to any worker with one click (see the Template Manager page). */
export interface PermissionTemplate {
  id: string;
  name: string;
  role: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin';
  permissions: UserPermissions;
}

export interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  role: string;
  permissions: UserPermissions;
  status: 'Actif' | 'Inactif';
  avatarUrl?: string;
}

export interface StationSettings {
  name: string;
  logo?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  fiscalId?: string;
  rc?: string;
  fuelPrices: Record<FuelType, number>;
  fuelBuyPrices: Record<FuelType, number>;
  conversionTables: Record<string, { degree: number; liters: number }[]>;
  productCategories: string[];
  expenseCategories: string[];
  productUnits?: string[];
  decalagePositifActif?: boolean;
  decalageNegatifActif?: boolean;
  decalagePositifSeuil?: number;  // threshold below which positive décalage alert is suppressed
  decalageNegatifSeuil?: number;  // threshold below which negative décalage alert is suppressed
  // ── Magasins (Paramètres → Magasins) ──────────────────────────────────────
  /** Nom du PREMIER magasin (partie `lavage`). Vide ⇒ « Magasin ». */
  magasin1Name?: string;
  /** Nom du SECOND magasin (partie `magasin2`). */
  magasin2Name?: string;
  /** Le second magasin a-t-il été créé ? Il apparaît alors dans la barre latérale. */
  magasin2Enabled?: boolean;
}

export interface BrigadeDecalageAlert {
  id: string;
  brigadeId: string;
  brigadeDate: string;
  startDatetime?: string;
  endDatetime?: string;
  chefId?: string;
  chefName?: string;
  alertType: 'CORRECT' | 'RETOUR_CUVE' | 'VENTE_DIRECTE';
  tankId?: string;
  tankName?: string;
  pompisteId?: string;
  pompisteName?: string;
  decalageLiters: number;
  decalageAmount: number;
  workersInfo: Array<{ id: string; name: string; role: string }>;
  isDismissed: boolean;
  createdAt: string;
}

export interface DailyReport {
  id: string;
  date: string;
  fuelRevenue: number;
  shopRevenue: number;
  totalExpenses: number;
  cashToDeposit: number;
  tankVariations: { tankId: string; startLiters: number; endLiters: number }[];
  brigadeIds: string[];
}

export interface AppState {
  tanks: Tank[];
  pumps: Pump[];
  pumpNozzles: PumpNozzle[];
  tracks: Track[];
  pompistes: Pompiste[];
  brigadeChefs: BrigadeChef[];
  brigades: Brigade[];
  brigadeAccountings: BrigadeAccounting[];
  brigadeDecalageAlerts: BrigadeDecalageAlert[];
  tpeTransactions: TpeTransaction[];
  clients: Client[];
  suppliers: Supplier[];
  products: Product[];
  expenses: Expense[];
  bankAccounts: BankAccount[];
  treasuryTransactions: TreasuryTransaction[];
  deliveryNotes: DeliveryNote[];
  fuelInvoices: FuelInvoice[];
  fuelReceipts: FuelReceipt[];
  purchases: Purchase[];
  fuelSales: FuelSale[];
  shopSales: ShopSale[];
  inventories: Inventory[];
  dailyReports: DailyReport[];
  settings: StationSettings;
  users: User[];
  permissionTemplates: PermissionTemplate[];
  toasts: ToastMessage[];
  activityLog: { id: string; timestamp: string; userId: string; action: string; details: string }[];
  isRtl: boolean;
  gerants: GerantWorker[];
  magasinWorkers: MagasinWorker[];
  productBrands: ProductBrand[];
  drivers: Driver[];
  /** Armoires de la piste, leur stock, les transferts magasin → armoire et les
   *  ventes / achats de produits saisis dans les brigades. */
  armoires: Armoire[];
  armoireStock: ArmoireStockItem[];
  stockTransfers: StockTransfer[];
  armoireSales: ArmoireSale[];
  armoirePurchases: ArmoirePurchase[];
  currentUserRole: AppUserRole;
  currentUserId?: string;
  currentUserName?: string;
  currentUserAvatarUrl?: string;
  currentUserPermissions?: UserPermissions;
  /** Set only for `module_worker` sessions — the employee of a business part
   *  (Restaurant / Cafétéria / Magasin) and their `iface.action` grants. */
  currentModuleWorker?: ModuleWorkerSession;
  isLoading: boolean;
}

// ─── Empty initial state (data comes from Supabase) ───────────────────────────
export const DEFAULT_PRODUCT_UNITS = ['Pièce', 'Litre', 'Kg', 'Carton', 'Pack', 'Bidon'];

/**
 * Paramètres avant que la base ait répondu.
 *
 * Aucun PRIX n'y figure : ils valaient autrefois 14,80 / 12,50 DA, et une station
 * dont la ligne `station_settings` ne portait pas encore ses tarifs voyait donc
 * ses ventes valorisées à des prix qui n'étaient pas les siens. Un zéro est faux
 * de façon visible ; un prix inventé, lui, se glisse dans les totaux sans que
 * personne le remarque. Les listes de catégories et d'unités restent, elles :
 * ce ne sont pas des données de la station mais les choix proposés dans les
 * formulaires tant que la station n'a pas défini les siens.
 */
const emptySettings: StationSettings = {
  name: '',
  fuelPrices:    { SUPER: 0, DIESEL: 0, ESSENCE: 0, GASOIL: 0, GPL: 0 },
  fuelBuyPrices: { SUPER: 0, DIESEL: 0, ESSENCE: 0, GASOIL: 0, GPL: 0 },
  conversionTables: {},
  productCategories: ['Lubrifiants', 'Accessoires', 'Lavage', 'Magasin'],
  expenseCategories: ['Salaires', 'Entretien', 'Électricité', 'Eau', 'Loyer', 'Impôts', 'Divers'],
  productUnits: DEFAULT_PRODUCT_UNITS,
};

const initialState: AppState = {
  tanks: [], pumps: [], pumpNozzles: [], tracks: [], pompistes: [], brigadeChefs: [], brigades: [], brigadeAccountings: [],
  brigadeDecalageAlerts: [],
  tpeTransactions: [],
  clients: [], suppliers: [], products: [], expenses: [],
  bankAccounts: [], treasuryTransactions: [],
  deliveryNotes: [],
  fuelInvoices: [], fuelReceipts: [],
  purchases: [], fuelSales: [], shopSales: [], inventories: [], dailyReports: [],
  settings: emptySettings,
  users: [], permissionTemplates: [], toasts: [], activityLog: [],
  isRtl: false,
  gerants: [], magasinWorkers: [], productBrands: [], drivers: [],
  armoires: [], armoireStock: [], stockTransfers: [], armoireSales: [], armoirePurchases: [],
  currentUserRole: 'admin',
  currentUserName: undefined,
  currentUserAvatarUrl: undefined,
  currentUserPermissions: undefined,
  isLoading: true,
};

// ─── Action Types ─────────────────────────────────────────────────────────────

type AppAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'HYDRATE'; payload: Partial<AppState> }
  | { type: 'ADD_TANK'; payload: Tank }
  | { type: 'UPDATE_TANK'; payload: Tank }
  | { type: 'ADJUST_TANK_LEVELS'; payload: { tankId: string; deltaLiters: number }[] }
  | { type: 'DELETE_TANK'; payload: string }
  | { type: 'ADD_PUMP'; payload: Pump }
  | { type: 'UPDATE_PUMP'; payload: Pump }
  | { type: 'DELETE_PUMP'; payload: string }
  | { type: 'ADD_NOZZLE'; payload: PumpNozzle }
  | { type: 'UPDATE_NOZZLE'; payload: PumpNozzle }
  | { type: 'DELETE_NOZZLE'; payload: string }
  | { type: 'ADD_TRACK'; payload: Track }
  | { type: 'UPDATE_TRACK'; payload: Track }
  | { type: 'DELETE_TRACK'; payload: string }
  | { type: 'ADD_POMPISTE'; payload: Pompiste }
  | { type: 'UPDATE_POMPISTE'; payload: Pompiste }
  | { type: 'DELETE_POMPISTE'; payload: string }
  | { type: 'ADD_BRIGADE_CHEF'; payload: BrigadeChef }
  | { type: 'UPDATE_BRIGADE_CHEF'; payload: BrigadeChef }
  | { type: 'DELETE_BRIGADE_CHEF'; payload: string }
  | { type: 'ADD_CLIENT'; payload: Client }
  | { type: 'UPDATE_CLIENT'; payload: Client }
  | { type: 'DELETE_CLIENT'; payload: string }
  | { type: 'ADD_SUPPLIER'; payload: Supplier }
  | { type: 'UPDATE_SUPPLIER'; payload: Supplier }
  | { type: 'DELETE_SUPPLIER'; payload: string }
  | { type: 'ADD_PRODUCT'; payload: Product }
  | { type: 'UPDATE_PRODUCT'; payload: Product }
  | { type: 'DELETE_PRODUCT'; payload: string }
  | { type: 'ADD_DELIVERY_NOTE'; payload: DeliveryNote }
  | { type: 'UPDATE_DELIVERY_NOTE'; payload: DeliveryNote }
  | { type: 'DELETE_DELIVERY_NOTE'; payload: string }
  | { type: 'ADD_FUEL_INVOICE'; payload: FuelInvoice }
  | { type: 'UPDATE_FUEL_INVOICE'; payload: FuelInvoice }
  | { type: 'DELETE_FUEL_INVOICE'; payload: string }
  | { type: 'ADD_FUEL_RECEIPT'; payload: FuelReceipt }
  | { type: 'UPDATE_FUEL_RECEIPT'; payload: FuelReceipt }
  | { type: 'DELETE_FUEL_RECEIPT'; payload: string }
  | { type: 'ADD_PURCHASE'; payload: Purchase }
  | { type: 'UPDATE_PURCHASE'; payload: Purchase }
  | { type: 'DELETE_PURCHASE'; payload: string }
  | { type: 'ADD_INVENTORY'; payload: Inventory }
  | { type: 'UPDATE_INVENTORY'; payload: Inventory }
  | { type: 'DELETE_INVENTORY'; payload: string }
  | { type: 'ADD_EXPENSE'; payload: Expense }
  | { type: 'UPDATE_EXPENSE'; payload: Expense }
  | { type: 'DELETE_EXPENSE'; payload: string }
  | { type: 'ADD_BANK_ACCOUNT'; payload: BankAccount }
  | { type: 'UPDATE_BANK_ACCOUNT'; payload: BankAccount }
  | { type: 'DELETE_BANK_ACCOUNT'; payload: string }
  | { type: 'ADD_TREASURY_TX'; payload: TreasuryTransaction }
  | { type: 'UPDATE_TREASURY_TX'; payload: TreasuryTransaction }
  | { type: 'DELETE_TREASURY_TX'; payload: string }
  | { type: 'UPDATE_USER_PERMISSIONS'; payload: { userId: string; permissions: UserPermissions } }
  | { type: 'ADD_USER'; payload: User }
  | { type: 'UPDATE_USER'; payload: User }
  | { type: 'LOG_ACTIVITY'; payload: { userId: string; action: string; details: string } }
  | { type: 'SET_SETTINGS'; payload: StationSettings }
  | { type: 'ADD_BRIGADE'; payload: Brigade }
  | { type: 'ADD_DRIVER'; payload: Driver }
  | { type: 'DELETE_DRIVER'; payload: string }
  | { type: 'UPDATE_BRIGADE'; payload: Brigade }
  | { type: 'DELETE_BRIGADE'; payload: string }
  | { type: 'ADD_FUEL_SALE'; payload: FuelSale }
  | { type: 'UPDATE_FUEL_SALE'; payload: FuelSale }
  | { type: 'DELETE_FUEL_SALE'; payload: string }
  | { type: 'ADD_SHOP_SALE'; payload: ShopSale }
  | { type: 'UPDATE_SHOP_SALE'; payload: ShopSale }
  | { type: 'DELETE_SHOP_SALE'; payload: string }
  | { type: 'ADD_DAILY_REPORT'; payload: DailyReport }
  | { type: 'ADD_TOAST'; payload: { type: ToastType; message: string } }
  | { type: 'REMOVE_TOAST'; payload: string }
  | { type: 'TOGGLE_RTL' }
  | { type: 'ADD_GERANT'; payload: GerantWorker }
  | { type: 'UPDATE_GERANT'; payload: GerantWorker }
  | { type: 'DELETE_GERANT'; payload: string }
  | { type: 'ADD_MAGASIN_WORKER'; payload: MagasinWorker }
  | { type: 'UPDATE_MAGASIN_WORKER'; payload: MagasinWorker }
  | { type: 'DELETE_MAGASIN_WORKER'; payload: string }
  | { type: 'ADD_BRAND'; payload: ProductBrand }
  | { type: 'UPDATE_BRAND'; payload: ProductBrand }
  | { type: 'DELETE_BRAND'; payload: string }
  | { type: 'UPDATE_WORKER_ACOMPTE'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; acompte: Acompte } }
  | { type: 'DELETE_WORKER_ACOMPTE'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; acompteId: string } }
  | { type: 'UPDATE_WORKER_ABSENCE'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; absence: Absence } }
  | { type: 'DELETE_WORKER_ABSENCE'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; absenceId: string } }
  | { type: 'ADD_WORKER_PAYMENT'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; payment: WorkerPaymentRecord } }
  | { type: 'DELETE_WORKER_PAYMENT'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; paymentId: string } }
  | { type: 'ADD_SUPPLIER_APPOINTMENT'; payload: { supplierId: string; appointment: SupplierAppointment } }
  | { type: 'ADD_CLIENT_APPOINTMENT'; payload: { clientId: string; appointment: ClientAppointment } }
  | { type: 'ADD_SUPPLIER_PAYMENT'; payload: { supplierId: string; payment: SupplierDebtPayment } }
  | { type: 'ADD_CLIENT_PAYMENT'; payload: { clientId: string; payment: { id: string; date: string; type: 'PAYMENT' | 'RECHARGE' | 'SALE'; amount: number; mode?: string; receiptNumber?: string; receiptPhoto?: string; notes?: string } } }
  | { type: 'UPDATE_CLIENT_PAYMENT'; payload: { clientId: string; payment: { id: string; date: string; type: 'PAYMENT' | 'RECHARGE' | 'SALE'; amount: number; mode?: string; receiptNumber?: string; receiptPhoto?: string; notes?: string }; previousAmount: number } }
  | { type: 'DELETE_CLIENT_PAYMENT'; payload: { clientId: string; paymentId: string } }
  | { type: 'UPDATE_PRODUCT_STOCK'; payload: { productId: string; quantity: number; buyPrice?: number; sellPrice?: number } }
  | { type: 'SAVE_INVENTORY'; payload: Inventory }
  | { type: 'UPDATE_BRIGADE_STATUS'; payload: { brigadeId: string; isActive: boolean; status: string } }
  | { type: 'MARK_PAYMENT_PAID'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; paymentId: string } }
  | { type: 'UPDATE_WORKER_PERMISSIONS'; payload: { workerType: 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'; workerId: string; permissions: UserPermissions } }
  | { type: 'SET_PERMISSION_TEMPLATES'; payload: PermissionTemplate[] }
  | { type: 'ADD_PERMISSION_TEMPLATE'; payload: PermissionTemplate }
  | { type: 'UPDATE_PERMISSION_TEMPLATE'; payload: PermissionTemplate }
  | { type: 'DELETE_PERMISSION_TEMPLATE'; payload: string }
  | { type: 'SET_CURRENT_USER'; payload: { role: AppUserRole; id?: string; name?: string; avatarUrl?: string; permissions?: UserPermissions; moduleWorker?: ModuleWorkerSession } }
  | { type: 'ADD_BRIGADE_ACCOUNTING'; payload: BrigadeAccounting }
  | { type: 'UPDATE_BRIGADE_ACCOUNTING'; payload: BrigadeAccounting }
  | { type: 'ADD_TPE_TRANSACTION'; payload: TpeTransaction }
  | { type: 'DELETE_TPE_TRANSACTION'; payload: string }
  | { type: 'SET_TPE_TRANSACTIONS'; payload: TpeTransaction[] }
  | { type: 'ADD_BRIGADE_DECALAGE_ALERT'; payload: BrigadeDecalageAlert }
  | { type: 'DISMISS_BRIGADE_DECALAGE_ALERT'; payload: string }
  | { type: 'DELETE_BRIGADE_DECALAGE_ALERTS_BY_BRIGADE'; payload: string }
  | { type: 'SET_BRIGADE_DECALAGE_ALERTS'; payload: BrigadeDecalageAlert[] }
  | { type: 'HYDRATE_TABLES' }
  | { type: 'RESTORE_STATE'; payload: AppState }
  // ── Armoires & transferts Magasin → Armoire ──────────────────────────────
  | { type: 'ADD_ARMOIRE'; payload: Armoire }
  | { type: 'UPDATE_ARMOIRE'; payload: Armoire }
  | { type: 'DELETE_ARMOIRE'; payload: string }
  | { type: 'ADD_STOCK_TRANSFER'; payload: StockTransfer }
  | { type: 'UPDATE_STOCK_TRANSFER'; payload: { transfer: StockTransfer; previous: StockTransfer } }
  | { type: 'DELETE_STOCK_TRANSFER'; payload: StockTransfer };

// ─── Stock d'armoire : deltas purs (mises à jour optimistes) ──────────────────
// `sign` vaut +1 pour appliquer un mouvement, −1 pour l'annuler.

function applyArmoireDelta(
  stock: ArmoireStockItem[], armoireId: string, items: StockLine[], sign: number,
): ArmoireStockItem[] {
  if (!items?.length || !armoireId) return stock;
  const next = stock.map(s => ({ ...s }));
  items.forEach(i => {
    if (!i.productId) return;
    const empty = (i.emptyQuantity || 0) * sign;
    const idx = next.findIndex(s => s.armoireId === armoireId && s.productId === i.productId);
    if (idx >= 0) {
      next[idx].quantity += i.quantity * sign;
      next[idx].emptyQuantity = (next[idx].emptyQuantity || 0) + empty;
      if (i.moduleKey && !next[idx].moduleKey) next[idx].moduleKey = i.moduleKey;
    } else {
      next.push({ id: newId(), armoireId, productId: i.productId, moduleKey: i.moduleKey, quantity: i.quantity * sign, emptyQuantity: empty });
    }
  });
  return next;
}

/** Les lignes de stock d'un transfert, avec le magasin d'origine. */
const transferLines = (tr: StockTransfer): StockLine[] =>
  (tr.items || []).map(i => ({ ...transferStockLine(i), moduleKey: tr.moduleKey }));

/**
 * Applique (+1) ou ANNULE (−1) tous les mouvements de stock d'armoire d'une
 * brigade : ses ventes de produits ET ses achats rentrés en armoire. Seule
 * source des deltas liés à une brigade — création, édition, suppression.
 */
function applyBrigadeArmoireDeltas(
  stock: ArmoireStockItem[],
  brigade: Pick<Brigade, 'armoireSales' | 'armoireProductPurchases'>,
  sign: number,
): ArmoireStockItem[] {
  let next = stock;
  for (const sl of brigade.armoireSales ?? []) {
    if (!sl.armoireId || !sl.productId || !sl.quantity) continue;
    next = applyArmoireDelta(next, sl.armoireId, [{ ...armoireSaleStockLine(sl), moduleKey: sl.moduleKey }], sign);
  }
  for (const p of brigade.armoireProductPurchases ?? []) {
    if (!p.armoireId || !p.productId || !p.quantity) continue;
    next = applyArmoireDelta(next, p.armoireId, [{ ...armoirePurchaseStockLine(p), moduleKey: p.moduleKey }], sign);
  }
  return next;
}

/** Lignes `ArmoireSale` (état global) reconstruites depuis le récap d'une brigade. */
function brigadeArmoireSaleRows(b: Brigade): ArmoireSale[] {
  const date = b.endDatetime || b.startDatetime || b.date || new Date().toISOString();
  return (b.armoireSales ?? [])
    .filter(x => x.armoireId && x.productId)
    .map(x => ({
      id: newId(), armoireId: x.armoireId, brigadeId: b.id, pompisteId: x.pompisteId,
      productId: x.productId, productName: x.productName, moduleKey: x.moduleKey,
      quantity: x.quantity, price: x.price, total: x.total, date, consigne: x.consigne ?? false,
    }));
}

/** Lignes `ArmoirePurchase` (état global) reconstruites depuis le récap d'une brigade. */
function brigadeArmoirePurchaseRows(b: Brigade): ArmoirePurchase[] {
  const date = b.endDatetime || b.startDatetime || b.date || new Date().toISOString();
  return (b.armoireProductPurchases ?? [])
    .filter(p => p.armoireId && p.productId)
    .map(p => ({
      id: newId(), armoireId: p.armoireId, brigadeId: b.id, pompisteId: p.pompisteId,
      productId: p.productId, productName: p.productName, moduleKey: p.moduleKey,
      quantity: p.quantity, unitPrice: p.unitPrice, total: p.total,
      supplierName: p.supplierName, date, consigneMode: p.consigneMode,
    }));
}

/** La brigade porte-t-elle un récap d'armoire ? (sinon : rien n'a changé). */
const carriesArmoireMoves = (b: Partial<Brigade>): boolean =>
  b.armoireSales !== undefined || b.armoireProductPurchases !== undefined;

// ─── Reducer ──────────────────────────────────────────────────────────────────

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'HYDRATE':
      return { ...state, ...action.payload, isLoading: false };

    case 'HYDRATE_TABLES':
      return { ...state, isLoading: true };

    case 'SET_CURRENT_USER':
      return {
        ...state,
        currentUserRole: action.payload.role,
        currentUserId: action.payload.id,
        currentUserName: action.payload.name,
        currentUserAvatarUrl: action.payload.avatarUrl,
        currentUserPermissions:
          action.payload.permissions !== undefined
            ? action.payload.permissions
            : state.currentUserPermissions,
        currentModuleWorker:
          action.payload.moduleWorker !== undefined
            ? action.payload.moduleWorker
            : state.currentModuleWorker,
      };

    case 'ADD_TANK':    return { ...state, tanks: [...state.tanks, action.payload] };
    case 'UPDATE_TANK': return { ...state, tanks: state.tanks.map(t => t.id === action.payload.id ? action.payload : t) };
    // Delta-based tank adjustment (livraisons). Applied against the LIVE state
    // (never a component snapshot) so successive rollback/apply pairs compose
    // correctly. `degrees` is re-derived so gauge-based displays follow.
    case 'ADJUST_TANK_LEVELS': {
      const deltas: Record<string, number> = {};
      action.payload.forEach(d => { if (d.tankId) deltas[d.tankId] = (deltas[d.tankId] || 0) + (d.deltaLiters || 0); });
      return {
        ...state,
        tanks: state.tanks.map(t => {
          const delta = deltas[t.id];
          if (!delta) return t;
          const newLiters = Math.max(0, (t.current || 0) + delta);
          if (t.type === 'GPL') {
            const percent = t.capacity > 0 ? (newLiters / t.capacity) * 100 : t.degrees;
            return { ...t, current: newLiters, degrees: Math.max(0, Math.min(100, percent)) };
          }
          const curve = state.settings.conversionTables?.[t.id] || [];
          if (curve.length > 0) return { ...t, current: newLiters, degrees: degreesFromLiters(curve, newLiters) };
          return { ...t, current: newLiters };
        }),
      };
    }
    case 'DELETE_TANK': return { ...state, tanks: state.tanks.filter(t => t.id !== action.payload) };

    case 'ADD_PUMP':    return { ...state, pumps: [...state.pumps, action.payload] };
    case 'UPDATE_PUMP': return { ...state, pumps: state.pumps.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'DELETE_PUMP': return { ...state, pumps: state.pumps.filter(p => p.id !== action.payload) };

    case 'ADD_NOZZLE':    return { ...state, pumpNozzles: [...(state.pumpNozzles || []), action.payload] };
    case 'UPDATE_NOZZLE': return { ...state, pumpNozzles: (state.pumpNozzles || []).map(n => n.id === action.payload.id ? action.payload : n) };
    case 'DELETE_NOZZLE': return { ...state, pumpNozzles: (state.pumpNozzles || []).filter(n => n.id !== action.payload) };

    case 'SET_PERMISSION_TEMPLATES': return { ...state, permissionTemplates: action.payload };
    case 'ADD_PERMISSION_TEMPLATE':  return { ...state, permissionTemplates: [...state.permissionTemplates, action.payload] };
    case 'UPDATE_PERMISSION_TEMPLATE': return { ...state, permissionTemplates: state.permissionTemplates.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'DELETE_PERMISSION_TEMPLATE': return { ...state, permissionTemplates: state.permissionTemplates.filter(t => t.id !== action.payload) };

    case 'ADD_TRACK':    return { ...state, tracks: [...state.tracks, action.payload] };
    case 'UPDATE_TRACK': return { ...state, tracks: state.tracks.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'DELETE_TRACK': return { ...state, tracks: state.tracks.filter(t => t.id !== action.payload) };

    case 'ADD_POMPISTE':    return { ...state, pompistes: [...state.pompistes, action.payload] };
    case 'UPDATE_POMPISTE': return { ...state, pompistes: state.pompistes.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'DELETE_POMPISTE': return { ...state, pompistes: state.pompistes.filter(p => p.id !== action.payload) };

    case 'ADD_BRIGADE_CHEF':    return { ...state, brigadeChefs: [...state.brigadeChefs, action.payload] };
    case 'UPDATE_BRIGADE_CHEF': return { ...state, brigadeChefs: state.brigadeChefs.map(b => b.id === action.payload.id ? action.payload : b) };
    case 'DELETE_BRIGADE_CHEF': return { ...state, brigadeChefs: state.brigadeChefs.filter(b => b.id !== action.payload) };

    case 'ADD_CLIENT':    return { ...state, clients: [...state.clients, action.payload] };
    case 'UPDATE_CLIENT': return { ...state, clients: state.clients.map(c => c.id === action.payload.id ? action.payload : c) };
    case 'DELETE_CLIENT': return { ...state, clients: state.clients.filter(c => c.id !== action.payload) };

    case 'ADD_SUPPLIER':    return { ...state, suppliers: [...state.suppliers, action.payload] };
    case 'UPDATE_SUPPLIER': return { ...state, suppliers: state.suppliers.map(s => s.id === action.payload.id ? action.payload : s) };
    case 'DELETE_SUPPLIER': return { ...state, suppliers: state.suppliers.filter(s => s.id !== action.payload) };

    case 'ADD_PRODUCT':    return { ...state, products: [...state.products, action.payload] };
    case 'UPDATE_PRODUCT': return { ...state, products: state.products.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'DELETE_PRODUCT': return { ...state, products: state.products.filter(p => p.id !== action.payload) };

    case 'ADD_DELIVERY_NOTE':    return { ...state, deliveryNotes: [...state.deliveryNotes, action.payload] };
    case 'UPDATE_DELIVERY_NOTE': return { ...state, deliveryNotes: state.deliveryNotes.map(d => d.id === action.payload.id ? action.payload : d) };
    case 'DELETE_DELIVERY_NOTE': return { ...state, deliveryNotes: state.deliveryNotes.filter(d => d.id !== action.payload) };

    case 'ADD_FUEL_INVOICE':    return { ...state, fuelInvoices: [...state.fuelInvoices, action.payload] };
    case 'UPDATE_FUEL_INVOICE': return { ...state, fuelInvoices: state.fuelInvoices.map(f => f.id === action.payload.id ? action.payload : f) };
    case 'DELETE_FUEL_INVOICE': return { ...state, fuelInvoices: state.fuelInvoices.filter(f => f.id !== action.payload) };
    case 'ADD_FUEL_RECEIPT':    return { ...state, fuelReceipts: [...state.fuelReceipts, action.payload] };
    case 'UPDATE_FUEL_RECEIPT': return { ...state, fuelReceipts: state.fuelReceipts.map(r => r.id === action.payload.id ? action.payload : r) };
    case 'DELETE_FUEL_RECEIPT': return { ...state, fuelReceipts: state.fuelReceipts.filter(r => r.id !== action.payload) };

    case 'ADD_PURCHASE':    return { ...state, purchases: [...state.purchases, action.payload] };
    case 'UPDATE_PURCHASE': return { ...state, purchases: state.purchases.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'DELETE_PURCHASE': return { ...state, purchases: state.purchases.filter(p => p.id !== action.payload) };

    case 'ADD_INVENTORY':    return { ...state, inventories: [...state.inventories, action.payload] };
    case 'UPDATE_INVENTORY': return { ...state, inventories: state.inventories.map(i => i.id === action.payload.id ? action.payload : i) };
    case 'DELETE_INVENTORY': return { ...state, inventories: state.inventories.filter(i => i.id !== action.payload) };

    case 'ADD_EXPENSE':    return { ...state, expenses: [...state.expenses, action.payload] };
    case 'UPDATE_EXPENSE': return { ...state, expenses: state.expenses.map(e => e.id === action.payload.id ? action.payload : e) };
    case 'DELETE_EXPENSE': return { ...state, expenses: state.expenses.filter(e => e.id !== action.payload) };

    // ── Treasury: bank accounts & money ledger ────────────────────────────
    // A bank account's `balance` is never edited directly by a movement: it is
    // recomputed from `initialBalance` + every ledger line touching it, so the
    // cards, the history and the accounting can never disagree.
    case 'ADD_BANK_ACCOUNT':
      return { ...state, bankAccounts: [...state.bankAccounts, action.payload] };
    case 'UPDATE_BANK_ACCOUNT':
      return { ...state, bankAccounts: state.bankAccounts.map(b => b.id === action.payload.id ? action.payload : b) };
    case 'DELETE_BANK_ACCOUNT':
      return {
        ...state,
        bankAccounts: state.bankAccounts.filter(b => b.id !== action.payload),
        treasuryTransactions: state.treasuryTransactions.filter(
          t => t.accountFrom !== action.payload && t.accountTo !== action.payload),
      };
    case 'ADD_TREASURY_TX':
      return { ...state, treasuryTransactions: [action.payload, ...state.treasuryTransactions] };
    case 'UPDATE_TREASURY_TX':
      return { ...state, treasuryTransactions: state.treasuryTransactions.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'DELETE_TREASURY_TX':
      return { ...state, treasuryTransactions: state.treasuryTransactions.filter(t => t.id !== action.payload) };

    case 'ADD_USER':    return { ...state, users: [...state.users, action.payload] };
    case 'UPDATE_USER': return { ...state, users: state.users.map(u => u.id === action.payload.id ? action.payload : u) };
    case 'UPDATE_USER_PERMISSIONS':
      return { ...state, users: state.users.map(u => u.id === action.payload.userId ? { ...u, permissions: action.payload.permissions } : u) };

    case 'LOG_ACTIVITY': {
      const newLog = { id: `LOG-${Date.now()}`, timestamp: new Date().toISOString(), ...action.payload };
      return { ...state, activityLog: [newLog, ...state.activityLog].slice(0, 500) };
    }

    case 'SET_SETTINGS': return { ...state, settings: action.payload };

    case 'RESTORE_STATE': return action.payload;

    // Le stock des armoires suit la brigade : ses ventes le décrémentent (ou
    // vident les bouteilles), ses achats l'incrémentent (ou les remplissent).
    case 'ADD_BRIGADE': {
      const b = action.payload;
      return {
        ...state,
        brigades: [...state.brigades, b],
        armoireStock: applyBrigadeArmoireDeltas(state.armoireStock || [], b, +1),
        armoireSales: [...(state.armoireSales || []), ...brigadeArmoireSaleRows(b)],
        armoirePurchases: [...(state.armoirePurchases || []), ...brigadeArmoirePurchaseRows(b)],
      };
    }
    case 'UPDATE_BRIGADE': {
      const b = action.payload;
      const prev = state.brigades.find(x => x.id === b.id);
      const brigades = state.brigades.map(x => x.id === b.id ? b : x);
      if (!carriesArmoireMoves(b)) return { ...state, brigades };
      // Éditer une brigade REJOUE ses mouvements d'armoire : on annule ceux de
      // l'ancienne version, puis on applique ceux de la nouvelle.
      let armoireStock = state.armoireStock || [];
      if (prev) armoireStock = applyBrigadeArmoireDeltas(armoireStock, prev, -1);
      armoireStock = applyBrigadeArmoireDeltas(armoireStock, b, +1);
      return {
        ...state,
        brigades,
        armoireStock,
        armoireSales: [...(state.armoireSales || []).filter(x => x.brigadeId !== b.id), ...brigadeArmoireSaleRows(b)],
        armoirePurchases: [...(state.armoirePurchases || []).filter(x => x.brigadeId !== b.id), ...brigadeArmoirePurchaseRows(b)],
      };
    }
    case 'DELETE_BRIGADE': {
      // Supprimer une brigade rend aux armoires ce qu'elle avait vendu / acheté.
      const gone = state.brigades.find(b => b.id === action.payload);
      return {
        ...state,
        armoireStock: gone ? applyBrigadeArmoireDeltas(state.armoireStock || [], gone, -1) : state.armoireStock,
        armoireSales: (state.armoireSales || []).filter(x => x.brigadeId !== action.payload),
        armoirePurchases: (state.armoirePurchases || []).filter(x => x.brigadeId !== action.payload),
        brigades: state.brigades.filter(b => b.id !== action.payload),
        brigadeDecalageAlerts: (state.brigadeDecalageAlerts || []).filter(a => a.brigadeId !== action.payload),
        brigadeAccountings: (state.brigadeAccountings || []).filter(a => a.brigadeId !== action.payload),
        fuelSales: (state.fuelSales || []).filter(s => s.brigadeId !== action.payload),
        // L'argent d'une brigade supprimée s'en va avec elle : ses espèces et ses
        // encaissements TPE / TAG. Ils restaient au grand livre, et la caisse
        // comme les comptes bancaires gardaient indéfiniment la recette d'une
        // brigade dont plus aucune pièce n'existait.
        treasuryTransactions: (state.treasuryTransactions || []).filter(
          t => !(t.refType === 'brigade' && t.refId === action.payload)),
        // Les dépenses justifiées sur cette brigade n'ont plus de pièce : elles
        // s'en vont avec elle, sans quoi l'écran Dépenses garderait une charge
        // rattachée à une brigade qui n'existe plus.
        expenses: (state.expenses || []).filter(e => e.brigadeId !== action.payload),
      };
    }

    // ── Armoires ───────────────────────────────────────────────────────────────
    case 'ADD_ARMOIRE':    return { ...state, armoires: [action.payload, ...(state.armoires || [])] };
    case 'UPDATE_ARMOIRE': return { ...state, armoires: (state.armoires || []).map(a => a.id === action.payload.id ? action.payload : a) };
    case 'DELETE_ARMOIRE': return {
      ...state,
      armoires: (state.armoires || []).filter(a => a.id !== action.payload),
      armoireStock: (state.armoireStock || []).filter(st => st.armoireId !== action.payload),
      stockTransfers: (state.stockTransfers || []).filter(t => t.armoireId !== action.payload),
    };

    // ── Transferts Magasin → Armoire (le stock magasin est déplacé par l'écran,
    //    dans la partie Magasin concernée ; ici : l'armoire et l'historique) ──
    case 'ADD_STOCK_TRANSFER': {
      const tr = action.payload;
      return {
        ...state,
        stockTransfers: [tr, ...(state.stockTransfers || [])],
        armoireStock: applyArmoireDelta(state.armoireStock || [], tr.armoireId, transferLines(tr), +1),
      };
    }
    case 'UPDATE_STOCK_TRANSFER': {
      const { transfer, previous } = action.payload;
      // Annuler l'ancien transfert puis appliquer le nouveau.
      let armoireStock = applyArmoireDelta(state.armoireStock || [], previous.armoireId, transferLines(previous), -1);
      armoireStock = applyArmoireDelta(armoireStock, transfer.armoireId, transferLines(transfer), +1);
      return {
        ...state,
        stockTransfers: (state.stockTransfers || []).map(t => t.id === transfer.id ? transfer : t),
        armoireStock,
      };
    }
    case 'DELETE_STOCK_TRANSFER': {
      const tr = action.payload;
      return {
        ...state,
        stockTransfers: (state.stockTransfers || []).filter(t => t.id !== tr.id),
        armoireStock: applyArmoireDelta(state.armoireStock || [], tr.armoireId, transferLines(tr), -1),
      };
    }

    case 'ADD_FUEL_SALE':    return { ...state, fuelSales: [...state.fuelSales, action.payload] };
    case 'UPDATE_FUEL_SALE': return { ...state, fuelSales: state.fuelSales.map(s => s.id === action.payload.id ? action.payload : s) };
    case 'DELETE_FUEL_SALE': return { ...state, fuelSales: state.fuelSales.filter(s => s.id !== action.payload) };

    case 'ADD_SHOP_SALE':    return { ...state, shopSales: [...state.shopSales, action.payload] };
    case 'UPDATE_SHOP_SALE': return { ...state, shopSales: state.shopSales.map(s => s.id === action.payload.id ? action.payload : s) };
    case 'DELETE_SHOP_SALE': return { ...state, shopSales: state.shopSales.filter(s => s.id !== action.payload) };

    case 'ADD_DAILY_REPORT': return { ...state, dailyReports: [...state.dailyReports, action.payload] };

    case 'ADD_TOAST': {
      const id = `toast-${Date.now()}`;
      return { ...state, toasts: [...state.toasts, { id, type: action.payload.type, message: action.payload.message }] };
    }
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };

    case 'TOGGLE_RTL': return { ...state, isRtl: !state.isRtl };

    case 'ADD_GERANT':    return { ...state, gerants: [...state.gerants, action.payload] };
    case 'UPDATE_GERANT': return { ...state, gerants: state.gerants.map(g => g.id === action.payload.id ? action.payload : g) };
    case 'DELETE_GERANT': return { ...state, gerants: state.gerants.filter(g => g.id !== action.payload) };

    case 'ADD_MAGASIN_WORKER':    return { ...state, magasinWorkers: [...state.magasinWorkers, action.payload] };
    case 'UPDATE_MAGASIN_WORKER': return { ...state, magasinWorkers: state.magasinWorkers.map(m => m.id === action.payload.id ? action.payload : m) };
    case 'DELETE_MAGASIN_WORKER': return { ...state, magasinWorkers: state.magasinWorkers.filter(m => m.id !== action.payload) };

    case 'ADD_BRAND':    return { ...state, productBrands: [...state.productBrands, action.payload] };
    case 'UPDATE_BRAND': return { ...state, productBrands: state.productBrands.map(b => b.id === action.payload.id ? action.payload : b) };
    case 'DELETE_BRAND': return { ...state, productBrands: state.productBrands.filter(b => b.id !== action.payload) };

    case 'ADD_DRIVER': return { ...state, drivers: [...(state.drivers || []), action.payload] };
    case 'DELETE_DRIVER': return { ...state, drivers: (state.drivers || []).filter(d => d.id !== action.payload) };

    case 'UPDATE_WORKER_ACOMPTE': {
      const { workerType, workerId, acompte } = action.payload;
      const updateList = (list: any[]) => list.map(item => {
        if (item.id !== workerId) return item;
        const exists = (item.acomptes || []).some((a: any) => a.id === acompte.id);
        const acomptes = exists
          ? (item.acomptes || []).map((a: any) => a.id === acompte.id ? acompte : a)
          : [...(item.acomptes || []), acompte];
        return { ...item, acomptes };
      });
      if (workerType === 'pompiste') return { ...state, pompistes: updateList(state.pompistes) };
      if (workerType === 'chef_brigade') return { ...state, brigadeChefs: updateList(state.brigadeChefs) };
      if (workerType === 'gerant') return { ...state, gerants: updateList(state.gerants) };
      return { ...state, magasinWorkers: updateList(state.magasinWorkers) };
    }

    case 'UPDATE_WORKER_ABSENCE': {
      const { workerType, workerId, absence } = action.payload;
      const updateList = (list: any[]) => list.map(item => {
        if (item.id !== workerId) return item;
        const exists = (item.absences || []).some((a: any) => a.id === absence.id);
        const absences = exists
          ? (item.absences || []).map((a: any) => a.id === absence.id ? absence : a)
          : [...(item.absences || []), absence];
        return { ...item, absences };
      });
      if (workerType === 'pompiste') return { ...state, pompistes: updateList(state.pompistes) };
      if (workerType === 'chef_brigade') return { ...state, brigadeChefs: updateList(state.brigadeChefs) };
      if (workerType === 'gerant') return { ...state, gerants: updateList(state.gerants) };
      return { ...state, magasinWorkers: updateList(state.magasinWorkers) };
    }

    case 'ADD_WORKER_PAYMENT': {
      const { workerType, workerId, payment } = action.payload;
      const updateList = (list: any[]) => list.map(item => {
        if (item.id !== workerId) return item;
        const exists = (item.paymentRecord || []).some((p: any) => p.id === payment.id);
        const paymentRecord = exists
          ? (item.paymentRecord || []).map((p: any) => p.id === payment.id ? payment : p)
          : [...(item.paymentRecord || []), payment];
        return { ...item, paymentRecord };
      });
      if (workerType === 'pompiste') return { ...state, pompistes: updateList(state.pompistes) };
      if (workerType === 'chef_brigade') return { ...state, brigadeChefs: updateList(state.brigadeChefs) };
      if (workerType === 'gerant') return { ...state, gerants: updateList(state.gerants) };
      return { ...state, magasinWorkers: updateList(state.magasinWorkers) };
    }

    case 'DELETE_WORKER_ACOMPTE': {
      const { workerType, workerId, acompteId } = action.payload;
      const updateList = (list: any[]) => list.map(item => item.id !== workerId ? item
        : { ...item, acomptes: (item.acomptes || []).filter((a: any) => a.id !== acompteId) });
      if (workerType === 'pompiste') return { ...state, pompistes: updateList(state.pompistes) };
      if (workerType === 'chef_brigade') return { ...state, brigadeChefs: updateList(state.brigadeChefs) };
      if (workerType === 'gerant') return { ...state, gerants: updateList(state.gerants) };
      return { ...state, magasinWorkers: updateList(state.magasinWorkers) };
    }

    case 'DELETE_WORKER_ABSENCE': {
      const { workerType, workerId, absenceId } = action.payload;
      const updateList = (list: any[]) => list.map(item => item.id !== workerId ? item
        : { ...item, absences: (item.absences || []).filter((a: any) => a.id !== absenceId) });
      if (workerType === 'pompiste') return { ...state, pompistes: updateList(state.pompistes) };
      if (workerType === 'chef_brigade') return { ...state, brigadeChefs: updateList(state.brigadeChefs) };
      if (workerType === 'gerant') return { ...state, gerants: updateList(state.gerants) };
      return { ...state, magasinWorkers: updateList(state.magasinWorkers) };
    }

    case 'DELETE_WORKER_PAYMENT': {
      const { workerType, workerId, paymentId } = action.payload;
      const updateList = (list: any[]) => list.map(item => item.id !== workerId ? item
        : { ...item, paymentRecord: (item.paymentRecord || []).filter((p: any) => p.id !== paymentId) });
      if (workerType === 'pompiste') return { ...state, pompistes: updateList(state.pompistes) };
      if (workerType === 'chef_brigade') return { ...state, brigadeChefs: updateList(state.brigadeChefs) };
      if (workerType === 'gerant') return { ...state, gerants: updateList(state.gerants) };
      return { ...state, magasinWorkers: updateList(state.magasinWorkers) };
    }

    case 'ADD_SUPPLIER_APPOINTMENT':
      return { ...state, suppliers: state.suppliers.map(s => s.id === action.payload.supplierId ? { ...s, appointments: [...(s.appointments || []), action.payload.appointment] } : s) };

    case 'ADD_CLIENT_APPOINTMENT':
      return { ...state, clients: state.clients.map(c => c.id === action.payload.clientId ? { ...c, appointments: [...(c.appointments || []), action.payload.appointment] } : c) };

    case 'ADD_SUPPLIER_PAYMENT':
      return { ...state, suppliers: state.suppliers.map(s => s.id === action.payload.supplierId ? { ...s, balance: Math.max(0, s.balance - action.payload.payment.amount), debtPayments: [...(s.debtPayments || []), action.payload.payment] } : s) };

    case 'ADD_CLIENT_PAYMENT':
      return { ...state, clients: state.clients.map(c => {
        if (c.id !== action.payload.clientId) return c;
        let updatedBalance = c.balance;
        let updatedAdvance = c.advanceBalance ?? c.balance;
        let updatedDebt = c.debt;
        if (action.payload.payment.type === 'PAYMENT') updatedDebt = Math.max(0, c.debt - action.payload.payment.amount);
        else if (action.payload.payment.type === 'RECHARGE') {
          // L'avance vivait dans DEUX colonnes qui ne se parlaient pas : la
          // recharge créditait `balance`, la consommation d'un bon débitait
          // `advanceBalance`. Un client pouvait donc afficher une avance pleine
          // et un solde consommé en même temps. Les deux bougent ensemble.
          updatedBalance = c.balance + action.payload.payment.amount;
          updatedAdvance = updatedAdvance + action.payload.payment.amount;
        }
        return {
          ...c,
          balance: updatedBalance,
          advanceBalance: updatedAdvance,
          debt: updatedDebt,
          transactionHistory: [...(c.transactionHistory || []), action.payload.payment as any],
        };
      }) };

    /**
     * ─── Corriger un mouvement du compte client ────────────────────────────
     *
     * Un règlement se saisit vite et mal : mauvais montant, mauvaise date,
     * mauvais mode. Il n'existait aucun moyen de le reprendre — il fallait
     * créer un second mouvement en sens inverse, que l'historique montrait
     * ensuite comme deux opérations là où il n'y en avait qu'une.
     *
     * Le compteur de la fiche suit la CORRECTION, pas le nouveau montant : une
     * dette de 5 000 réglée par erreur de 3 000 au lieu de 2 000 remonte de
     * 1 000 quand on rectifie, elle ne repart pas de zéro.
     */
    case 'UPDATE_CLIENT_PAYMENT': {
      const { clientId, payment, previousAmount } = action.payload;
      const delta = (payment.amount || 0) - (previousAmount || 0);
      return { ...state, clients: state.clients.map(c => {
        if (c.id !== clientId) return c;
        const advance = c.advanceBalance ?? c.balance;
        const patch = payment.type === 'PAYMENT'
          ? { debt: Math.max(0, c.debt - delta) }
          : payment.type === 'RECHARGE'
            ? { balance: c.balance + delta, advanceBalance: advance + delta }
            : {};
        return {
          ...c, ...patch,
          transactionHistory: (c.transactionHistory || []).map(t => t.id === payment.id ? { ...t, ...payment } as any : t),
        };
      }) };
    }

    case 'DELETE_CLIENT_PAYMENT': {
      const { clientId, paymentId } = action.payload;
      return { ...state, clients: state.clients.map(c => {
        if (c.id !== clientId) return c;
        const tx = (c.transactionHistory || []).find(t => t.id === paymentId);
        const amount = Number(tx?.amount) || 0;
        const advance = c.advanceBalance ?? c.balance;
        // Supprimer un règlement REND la dette qu'il avait effacée ; supprimer
        // une recharge reprend l'avance qu'elle avait créditée.
        const patch = tx?.type === 'PAYMENT'
          ? { debt: c.debt + amount }
          : tx?.type === 'RECHARGE'
            ? { balance: Math.max(0, c.balance - amount), advanceBalance: Math.max(0, advance - amount) }
            : {};
        return {
          ...c, ...patch,
          transactionHistory: (c.transactionHistory || []).filter(t => t.id !== paymentId),
        };
      }) };
    }

    case 'UPDATE_PRODUCT_STOCK':
      return { ...state, products: state.products.map(p => p.id === action.payload.productId ? { ...p, stock: p.stock + action.payload.quantity, buyPrice: action.payload.buyPrice ?? p.buyPrice, sellingPrice: action.payload.sellPrice ?? p.sellingPrice } : p) };

    case 'SAVE_INVENTORY':
      return { ...state, inventories: [...state.inventories, action.payload] };

    case 'UPDATE_BRIGADE_STATUS':
      return { ...state, brigades: state.brigades.map(b => b.id === action.payload.brigadeId ? { ...b, isActive: action.payload.isActive, status: action.payload.status as any } : b) };

    case 'ADD_BRIGADE_ACCOUNTING':    return { ...state, brigadeAccountings: [...state.brigadeAccountings, action.payload] };
    case 'UPDATE_BRIGADE_ACCOUNTING': return { ...state, brigadeAccountings: state.brigadeAccountings.map(a => a.id === action.payload.id ? action.payload : a) };

    case 'ADD_TPE_TRANSACTION':
      return { ...state, tpeTransactions: [...(state.tpeTransactions || []), action.payload] };
    case 'DELETE_TPE_TRANSACTION':
      return { ...state, tpeTransactions: (state.tpeTransactions || []).filter(t => t.id !== action.payload) };
    case 'SET_TPE_TRANSACTIONS':
      return { ...state, tpeTransactions: action.payload };

    case 'ADD_BRIGADE_DECALAGE_ALERT':
      return { ...state, brigadeDecalageAlerts: [action.payload, ...(state.brigadeDecalageAlerts || [])] };
    case 'DISMISS_BRIGADE_DECALAGE_ALERT':
      return { ...state, brigadeDecalageAlerts: (state.brigadeDecalageAlerts || []).map(a => a.id === action.payload ? { ...a, isDismissed: true } : a) };
    case 'DELETE_BRIGADE_DECALAGE_ALERTS_BY_BRIGADE':
      return { ...state, brigadeDecalageAlerts: (state.brigadeDecalageAlerts || []).filter(a => a.brigadeId !== action.payload) };
    case 'SET_BRIGADE_DECALAGE_ALERTS':
      return { ...state, brigadeDecalageAlerts: action.payload };

    case 'MARK_PAYMENT_PAID': {
      const { workerType, workerId, paymentId } = action.payload;
      const upd = (rec: any[]) => rec.map(p => p.id === paymentId ? { ...p, isPaid: true } : p);
      if (workerType === 'pompiste')       return { ...state, pompistes:      state.pompistes.map(p => p.id === workerId ? { ...p, paymentRecord: upd(p.paymentRecord || []) } : p) };
      if (workerType === 'chef_brigade')   return { ...state, brigadeChefs:   state.brigadeChefs.map(c => c.id === workerId ? { ...c, paymentRecord: upd(c.paymentRecord || []) } : c) };
      if (workerType === 'gerant')         return { ...state, gerants:        state.gerants.map(g => g.id === workerId ? { ...g, paymentRecord: upd(g.paymentRecord || []) } : g) };
      return { ...state, magasinWorkers: state.magasinWorkers.map(m => m.id === workerId ? { ...m, paymentRecord: upd(m.paymentRecord || []) } : m) };
    }

    case 'UPDATE_WORKER_PERMISSIONS': {
      const { workerType, workerId, permissions } = action.payload;
      if (workerType === 'pompiste')       return { ...state, pompistes:      state.pompistes.map(p => p.id === workerId ? { ...p, permissions } : p) };
      if (workerType === 'chef_brigade')   return { ...state, brigadeChefs:   state.brigadeChefs.map(c => c.id === workerId ? { ...c, permissions } : c) };
      if (workerType === 'gerant')         return { ...state, gerants:        state.gerants.map(g => g.id === workerId ? { ...g, permissions } : g) };
      return { ...state, magasinWorkers: state.magasinWorkers.map(m => m.id === workerId ? { ...m, permissions } : m) };
    }

    default: return state;
  }
}

// ─── Supabase row → AppContext model mappers ──────────────────────────────────

function mapTank(r: any): Tank {
  return { id: r.id, name: r.name, type: r.type, capacity: +r.capacity, current: +r.current, degrees: +r.degrees, alertThreshold: +r.alert_threshold, notes: r.notes, isFavorite: !!r.is_favorite };
}
function mapPump(r: any): Pump {
  return { id: r.id, number: r.number, name: r.name, tankId: r.tank_id, trackId: r.track_id, type: r.type, lastIndex: +r.last_index, status: r.status, currentBrigadeStartIndex: r.current_brigade_start_index ? +r.current_brigade_start_index : undefined, createdAt: r.created_at ?? undefined };
}
function mapTrack(r: any): Track { return { id: r.id, name: r.name }; }
function mapPermissionTemplate(r: any): PermissionTemplate {
  return { id: r.id, name: r.name, role: r.role, permissions: (r.permissions ?? {}) as UserPermissions };
}
function mapDriver(r: any): Driver {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    phone: r.phone,
    email: r.email,
    address: r.address,
  };
}
function mapSupplier(r: any): Supplier {
  return { id: r.id, ref: r.ref, name: r.name, contact: r.contact, phone: r.phone, email: r.email, address: r.address, balance: +r.balance, totalPurchases: +r.total_purchases, nif: r.nif, nis: r.nis, article: r.article, rc: r.rc, type: r.type, appointments: [], debtPayments: [] };
}
function mapClient(r: any): Client {
  return { id: r.id, name: r.name, phone: r.phone, cin: r.cin, email: r.email, address: r.address, contactPerson: r.contact_person, balance: +r.balance, debt: +r.debt, creditLimit: +r.credit_limit, paymentDelay: +r.payment_delay, type: r.type, paymentMode: r.payment_mode, nif: r.nif, nis: r.nis, article: r.article, rc: r.rc, advanceBalance: +(r.advance_balance ?? 0), openingDebt: +(r.opening_debt ?? 0), openingAdvance: +(r.opening_advance ?? 0), openingDate: r.opening_date ?? undefined, openingNotes: r.opening_notes ?? undefined, createdAt: r.created_at ?? undefined, appointments: [], transactionHistory: [] };
}
function mapProduct(r: any): Product {
  return { id: r.id, ref: r.ref, name: r.name, category: r.category, buyPrice: +r.buy_price, sellingPrice: +r.selling_price, stock: +r.stock, minStock: +r.min_stock, barcode: r.barcode, image: r.image_url, imageUrl: r.image_url, unit: r.unit, brand: r.brand, brandId: r.brand_id, lastSellingPrice: r.last_selling_price ? +r.last_selling_price : undefined, tvaRate: +(r.tva_rate ?? 0), sellByDetails: r.sell_by_details ?? false, detailCapacity: r.detail_capacity ? +r.detail_capacity : undefined, detailUnit: r.detail_unit };
}
function mapBrand(r: any): ProductBrand { return { id: r.id, name: r.name }; }
function mapPompiste(r: any): Pompiste {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, cin: r.cin, address: r.address, photo: r.photo_url, photoUrl: r.photo_url, status: r.status, trackId: r.track_id, chefId: r.chef_id, baseSalary: +r.base_salary, salaryType: r.salary_type ?? undefined, workDays: r.work_days ?? undefined, cnasDate: r.cnas_date ?? undefined, hasAccess: r.has_access, username: r.username, authUserId: r.auth_user_id ?? undefined, permissions: r.permissions || {}, hireDate: r.hire_date, paymentRecord: [], acomptes: [], absences: [], decalageHistory: [] };
}
function mapBrigadeChef(r: any): BrigadeChef {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, cin: r.cin, address: r.address, photo: r.photo_url, photoUrl: r.photo_url, status: r.status, baseSalary: +r.base_salary, hasAccess: r.has_access, username: r.username, authUserId: r.auth_user_id ?? undefined, permissions: r.permissions || {}, hireDate: r.hire_date, pompisteIds: [], paymentRecord: [], acomptes: [], absences: [], decalageHistory: [] };
}
function mapGerant(r: any): GerantWorker {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, cin: r.cin, address: r.address, photo: r.photo_url, photoUrl: r.photo_url, status: r.status, baseSalary: +r.base_salary, salaryType: r.salary_type ?? undefined, workDays: r.work_days ?? undefined, cnasDate: r.cnas_date ?? undefined, hasAccess: r.has_access, username: r.username, authUserId: r.auth_user_id ?? undefined, permissions: r.permissions || {}, hireDate: r.hire_date, paymentRecord: [], acomptes: [], absences: [] };
}
function mapMagasinWorker(r: any): MagasinWorker {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, cin: r.cin, address: r.address, photo: r.photo_url, photoUrl: r.photo_url, status: r.status, baseSalary: +r.base_salary, salaryType: r.salary_type ?? undefined, workDays: r.work_days ?? undefined, cnasDate: r.cnas_date ?? undefined, hasAccess: r.has_access, username: r.username, authUserId: r.auth_user_id ?? undefined, permissions: r.permissions || {}, hireDate: r.hire_date, paymentRecord: [], acomptes: [], absences: [] };
}
function mapBrigade(r: any): Brigade {
  return { id: r.id, createdAt: r.created_at ?? undefined, date: r.date, shift: r.shift, chefId: r.chef_id, status: r.status, startTimestamp: r.start_timestamp, endTimestamp: r.end_timestamp, startTime: r.start_time, endTime: r.end_time, startDatetime: r.start_datetime, endDatetime: r.end_datetime, isActive: r.is_active, notes: r.notes, printedAt: r.printed_at, pompisteIds: [], startIndices: r.start_indices || {}, endIndices: r.end_indices || {}, startTankLevels: r.start_tank_levels || {}, endTankLevels: r.end_tank_levels || {}, pompisteData: r.pompiste_data || {}, pompisteAssignments: r.pompiste_assignments || [], startNozzleIndices: r.start_nozzle_indices || {}, endNozzleIndices: r.end_nozzle_indices || {}, activeNozzleIds: r.active_nozzle_ids || [], canReactivate: r.can_reactivate ?? false, pompistePumpAssignments: r.pompiste_pump_assignments || [], versements: r.versements || [], armoireSales: r.armoire_sales || [], armoireProductPurchases: r.armoire_product_purchases || [], armoireStockSnapshot: r.armoire_stock_snapshot || [] };
}

// ─── Armoires : mappers ────────────────────────────────────────────────────────
function mapArmoire(r: any): Armoire {
  return { id: r.id, name: r.name, trackId: r.track_id ?? undefined, pumpIds: Array.isArray(r.pump_ids) ? r.pump_ids : [], notes: r.notes ?? undefined, createdAt: r.created_at };
}
function mapArmoireStockItem(r: any): ArmoireStockItem {
  return { id: r.id, armoireId: r.armoire_id, productId: r.product_id, moduleKey: r.module_key ?? undefined, quantity: +r.quantity || 0, emptyQuantity: +(r.empty_quantity ?? 0) };
}
function mapStockTransferItem(r: any): StockTransferItem {
  return { id: r.id, transferId: r.transfer_id, productId: r.product_id, productName: r.product_name || '', barcode: r.barcode ?? undefined, quantity: +r.quantity || 0, consigneState: r.consigne_state ?? undefined };
}
function mapStockTransfer(r: any): StockTransfer {
  return { id: r.id, armoireId: r.armoire_id, moduleKey: (r.module_key || 'lavage') as MagasinKey, date: r.date, source: (r.source ?? 'transferts'), notes: r.notes ?? undefined, createdBy: r.created_by ?? undefined, totalQty: +r.total_qty || 0, items: [], createdAt: r.created_at };
}
function mapArmoireSale(r: any): ArmoireSale {
  return { id: r.id, armoireId: r.armoire_id, brigadeId: r.brigade_id ?? undefined, pompisteId: r.pompiste_id ?? undefined, productId: r.product_id, productName: r.product_name || '', moduleKey: r.module_key ?? undefined, quantity: +r.quantity || 0, price: +r.price || 0, total: +r.total || 0, date: r.date, createdAt: r.created_at, consigne: r.consigne ?? false };
}
function mapArmoirePurchase(r: any): ArmoirePurchase {
  return { id: r.id, armoireId: r.armoire_id, brigadeId: r.brigade_id ?? undefined, pompisteId: r.pompiste_id ?? undefined, productId: r.product_id, productName: r.product_name || '', moduleKey: r.module_key ?? undefined, quantity: +r.quantity || 0, unitPrice: +r.unit_price || 0, total: +r.total || 0, supplierName: r.supplier_name ?? undefined, date: r.date, createdAt: r.created_at, consigneMode: r.consigne_mode ?? undefined };
}

/**
 * Tout ce qui touche aux armoires, en une lecture. Une table absente (migration
 * pas encore passée) rend une liste vide : l'application continue de tourner.
 */
async function loadArmoireData(): Promise<Pick<AppState, 'armoires' | 'armoireStock' | 'stockTransfers' | 'armoireSales' | 'armoirePurchases'>> {
  const safe = <T,>(p: Promise<T[]>) => p.catch(err => { console.warn('[armoires] lecture impossible (migration SQL à exécuter ?) :', err?.message || err); return [] as T[]; });
  const [rawA, rawS, rawT, rawI, rawSales, rawP] = await Promise.all([
    safe(db.getArmoires()), safe(db.getArmoireStock()), safe(db.getStockTransfers()),
    safe(db.getStockTransferItems()), safe(db.getArmoireSales()), safe(db.getArmoirePurchases()),
  ]);
  const items = (rawI as any[]).map(mapStockTransferItem);
  const stockTransfers = (rawT as any[]).map(t => {
    const m = mapStockTransfer(t);
    m.items = items.filter(i => i.transferId === m.id);
    return m;
  });
  return {
    armoires: (rawA as any[]).map(mapArmoire),
    armoireStock: (rawS as any[]).map(mapArmoireStockItem),
    stockTransfers,
    armoireSales: (rawSales as any[]).map(mapArmoireSale),
    armoirePurchases: (rawP as any[]).map(mapArmoirePurchase),
  };
}
function mapBrigadeAccounting(r: any): BrigadeAccounting {
  return {
    id: r.id, brigadeId: r.brigade_id, totalDue: +r.total_due || 0, cashReceived: +r.cash_received || 0,
    rest: +r.rest || 0, tankSummary: r.tank_summary || [], nozzleSummary: r.nozzle_summary || [],
    decalageSummary: r.decalage_summary || {}, cuveVerifications: r.cuve_verifications || {},
    nozzleVerifications: r.nozzle_verifications || {}, restAssignedWorkerType: r.rest_assigned_worker_type,
    restAssignedWorkerId: r.rest_assigned_worker_id, restAssignedAmount: +r.rest_assigned_amount || 0,
    status: r.status || 'draft', createdBy: r.created_by, justifications: [],
    pompisteSummary: r.pompiste_summary || {},
  };
}
/** Load every brigade accounting with its justifications attached. Shared by the
 *  initial hydration (Phase 2) and the realtime `brigades` refetch so both paths
 *  always produce identical, complete accounting data (espèces reçues, TPE/Tags,
 *  décalages par pompiste). Previously accountings were only loaded on realtime
 *  events, so a freshly-loaded Fiche Journalière could miss this data. */
async function loadBrigadeAccountingsWithJustifications(): Promise<BrigadeAccounting[]> {
  const accountingsRaw = await db.getBrigadeAccountings().catch(() => []);
  const accountings = ((accountingsRaw as any[]) || []).map(mapBrigadeAccounting);
  if (accountings.length > 0) {
    // Lecture PAGINÉE : au-delà du plafond du serveur, les justifications les
    // plus anciennes ne remontaient plus — et l'historique d'un client se
    // réduisait alors aux dernières brigades chargées.
    const justifRaw = await dbSelectAll<any>('brigade_accounting_justifications');
    ((justifRaw ?? []) as any[]).forEach((jr: any) => {
      const acct = accountings.find(a => a.id === jr.accounting_id);
      if (!acct) return;
      if (!acct.justifications) acct.justifications = [];
      acct.justifications.push({
        id: jr.id, accountingId: jr.accounting_id, clientId: jr.client_id || '',
        amount: +jr.amount || 0, clientType: jr.client_type, paymentMode: jr.payment_mode,
        notes: jr.notes, justificationType: jr.justification_type || 'CLIENT', bankAccountId: jr.bank_account_id ?? undefined,
        clientName: jr.client_name, fuelType: jr.fuel_type, liters: +jr.liters || 0,
        pricePerLiter: +jr.price_per_liter || 0, trackId: jr.track_id, pompisteId: jr.pompiste_id,
        expenseCategory: jr.expense_category ?? undefined,
        // Justificatif ACHAT_PRODUIT : produit, armoire, quantité, prix, consigne.
        productId: jr.product_id ?? undefined, productName: jr.product_name ?? undefined,
        moduleKey: jr.module_key ?? undefined, armoireId: jr.armoire_id ?? undefined,
        quantity: +jr.quantity || 0, unitPrice: +jr.unit_price || 0,
        supplierName: jr.supplier_name ?? undefined, consigneMode: jr.consigne_mode ?? undefined,
      });
    });
  }
  return accountings;
}

/**
 * ─── Recharger un client SANS perdre son compte ─────────────────────────
 *
 * `mapClient` ne sait rendre que la LIGNE du client : ses rendez-vous et son
 * historique de mouvements repartent vides, parce qu'ils vivent dans deux autres
 * tables. Les relire ainsi — ce que faisaient l'abonnement temps réel ET le
 * rafraîchissement d'une minute — remplaçait chaque client par une fiche sans
 * mémoire :
 *
 *   • le règlement qu'on venait d'encaisser disparaissait de l'historique ;
 *   • la caisse Carburant, qui compte les espèces remises par les clients sur
 *     ce même historique (`lib/carburantSales`), reperdait le montant aussitôt ;
 *   • le journal de la Caisse Générale n'en gardait aucune trace non plus.
 *
 * Et comme l'enregistrement d'un règlement met à jour `clients.debt`, il déclenchait
 * lui-même l'événement qui l'effaçait de l'écran. Un client se recharge donc
 * TOUJOURS avec ses pièces — exactement comme les bons de livraison et les achats,
 * qui avaient déjà reçu ce traitement.
 */
async function loadClientsEnriched(): Promise<Client[]> {
  const [rows, appts, txs] = await Promise.all([
    db.getClients(),
    dbSelectAll<any>('client_appointments').catch(() => []),
    dbSelectAll<any>('client_transactions').catch(() => []),
  ]);
  return (rows as any[]).map(c => {
    const m = mapClient(c);
    m.appointments = (appts as any[]).filter(a => a.client_id === c.id)
      .map(a => ({ id: a.id, saleId: a.sale_id, date: a.date, amount: +a.amount, notes: a.notes, isPaid: a.is_paid }));
    m.transactionHistory = (txs as any[]).filter(t => t.client_id === c.id)
      .map(t => ({ id: t.id, date: t.date, type: t.type, amount: +t.amount, mode: t.mode, receiptNumber: t.receipt_number, receiptPhoto: t.receipt_photo_url, notes: t.notes }));
    return m;
  });
}

/** Même règle pour un fournisseur : ses échéances et ses règlements le suivent. */
async function loadSuppliersEnriched(): Promise<Supplier[]> {
  const [rows, appts, payments] = await Promise.all([
    db.getSuppliers(),
    supabase.from('supplier_appointments').select('*').then(r => r.data ?? []),
    supabase.from('supplier_debt_payments').select('*').then(r => r.data ?? []),
  ]);
  return (rows as any[]).map(s => {
    const m = mapSupplier(s);
    m.appointments = (appts as any[]).filter(a => a.supplier_id === s.id)
      .map(a => ({ id: a.id, purchaseId: a.purchase_id, date: a.date, amount: +a.amount, notes: a.notes, isPaid: a.is_paid }));
    m.debtPayments = (payments as any[]).filter(p => p.supplier_id === s.id)
      .map(p => ({ id: p.id, purchaseId: p.purchase_id, deliveryNoteId: p.delivery_note_id, date: p.date, amount: +p.amount, totalDue: +p.total_due, rest: +p.rest, paymentMode: p.payment_mode, chequeNumber: p.cheque_number, notes: p.notes }));
    return m;
  });
}

/**
 * Une vente magasin avec SES articles. Sans eux, le dossier d'un client affichait
 * bien la facture mais plus rien à l'intérieur — et le récapitulatif
 * « détail par article » du compte se vidait à chaque rafraîchissement.
 */
async function loadShopSalesEnriched(): Promise<ShopSale[]> {
  const [rows, items] = await Promise.all([
    dbSelectAll<any>('shop_sales'),
    dbSelectAll<any>('shop_sale_items', { orderBy: 'sale_id', ascending: true }).catch(() => []),
  ]);
  return (rows as any[]).map(s => {
    const m = mapShopSale(s);
    m.items = (items as any[]).filter(i => i.sale_id === s.id)
      .map(i => ({ productId: i.product_id, productName: i.product_name, quantity: +i.quantity, price: +i.price, tva: +(i.tva ?? 0) }));
    return m;
  });
}

/* ── Worker loaders that re-merge payroll sub-records ─────────────────────────
 * The realtime refetch slices below must rebuild workers WITH their acomptes,
 * absences, salaires and décalages — otherwise a live event replaces the
 * Phase-2-enriched workers with bare rows, silently dropping those sub-records
 * (e.g. the Fiche Journalière "Dépenses" would lose acomptes & salaires). */
async function loadPompistesEnriched(): Promise<Pompiste[]> {
  const [rows, acomptes, absences, payments, decalage] = await Promise.all([
    db.getPompistes(),
    supabase.from('worker_acomptes').select('*').eq('worker_type', 'pompiste').then(r => r.data ?? []),
    supabase.from('worker_absences').select('*').eq('worker_type', 'pompiste').then(r => r.data ?? []),
    supabase.from('worker_payment_records').select('*').eq('worker_type', 'pompiste').then(r => r.data ?? []),
    supabase.from('pompiste_decalage_history').select('*').then(r => r.data ?? []),
  ]);
  return (rows as any[]).map(p => {
    const m = mapPompiste(p);
    m.acomptes      = (acomptes as any[]).filter(a => a.worker_id === p.id).map(mapAcompte);
    m.absences      = (absences as any[]).filter(a => a.worker_id === p.id).map(mapAbsence);
    m.paymentRecord = (payments as any[]).filter(r => r.worker_id === p.id).map(mapPaymentRecord);
    m.decalageHistory = (decalage as any[])
      .filter(d => d.pompiste_id === p.id)
      .map(d => ({ brigadeId: d.brigade_id, date: d.date, amount: +d.amount, type: d.type as 'BONUS' | 'RETENUE' }));
    return m;
  });
}
async function loadBrigadeChefsEnriched(): Promise<BrigadeChef[]> {
  const [rows, assignments, acomptes, absences, payments] = await Promise.all([
    db.getBrigadeChefs(),
    supabase.from('chef_pompiste_assignments').select('chef_id, pompiste_id').then(r => r.data ?? []),
    supabase.from('worker_acomptes').select('*').eq('worker_type', 'chef_brigade').then(r => r.data ?? []),
    supabase.from('worker_absences').select('*').eq('worker_type', 'chef_brigade').then(r => r.data ?? []),
    supabase.from('worker_payment_records').select('*').eq('worker_type', 'chef_brigade').then(r => r.data ?? []),
  ]);
  return (rows as any[]).map(c => {
    const m = mapBrigadeChef(c);
    m.pompisteIds   = (assignments as any[]).filter(a => a.chef_id === c.id).map(a => a.pompiste_id);
    m.acomptes      = (acomptes as any[]).filter(a => a.worker_id === c.id).map(mapAcompte);
    m.absences      = (absences as any[]).filter(a => a.worker_id === c.id).map(mapAbsence);
    m.paymentRecord = (payments as any[]).filter(r => r.worker_id === c.id).map(mapPaymentRecord);
    return m;
  });
}
async function loadGerantsEnriched(): Promise<GerantWorker[]> {
  const [rows, acomptes, absences, payments] = await Promise.all([
    db.getGerants(),
    supabase.from('worker_acomptes').select('*').eq('worker_type', 'gerant').then(r => r.data ?? []),
    supabase.from('worker_absences').select('*').eq('worker_type', 'gerant').then(r => r.data ?? []),
    supabase.from('worker_payment_records').select('*').eq('worker_type', 'gerant').then(r => r.data ?? []),
  ]);
  return (rows as any[]).map(g => {
    const m = mapGerant(g);
    m.acomptes      = (acomptes as any[]).filter(a => a.worker_id === g.id).map(mapAcompte);
    m.absences      = (absences as any[]).filter(a => a.worker_id === g.id).map(mapAbsence);
    m.paymentRecord = (payments as any[]).filter(r => r.worker_id === g.id).map(mapPaymentRecord);
    return m;
  });
}
async function loadMagasinWorkersEnriched(): Promise<MagasinWorker[]> {
  const [rows, acomptes, absences, payments] = await Promise.all([
    db.getMagasinWorkers(),
    supabase.from('worker_acomptes').select('*').eq('worker_type', 'magasin').then(r => r.data ?? []),
    supabase.from('worker_absences').select('*').eq('worker_type', 'magasin').then(r => r.data ?? []),
    supabase.from('worker_payment_records').select('*').eq('worker_type', 'magasin').then(r => r.data ?? []),
  ]);
  return (rows as any[]).map(w => {
    const m = mapMagasinWorker(w);
    m.acomptes      = (acomptes as any[]).filter(a => a.worker_id === w.id).map(mapAcompte);
    m.absences      = (absences as any[]).filter(a => a.worker_id === w.id).map(mapAbsence);
    m.paymentRecord = (payments as any[]).filter(r => r.worker_id === w.id).map(mapPaymentRecord);
    return m;
  });
}
function mapBrigadeDecalageAlert(r: any): BrigadeDecalageAlert {
  return {
    id: r.id, brigadeId: r.brigade_id, brigadeDate: r.brigade_date,
    startDatetime: r.start_datetime, endDatetime: r.end_datetime,
    chefId: r.chef_id, chefName: r.chef_name,
    alertType: r.alert_type, tankId: r.tank_id, tankName: r.tank_name,
    pompisteId: r.pompiste_id, pompisteName: r.pompiste_name,
    decalageLiters: +r.decalage_liters, decalageAmount: +r.decalage_amount,
    workersInfo: r.workers_info || [], isDismissed: r.is_dismissed,
    createdAt: r.created_at
  };
}
function mapTpeTransaction(r: any): TpeTransaction {
  return {
    id: r.id, brigadeId: r.brigade_id, accountingId: r.accounting_id, date: r.date,
    mode: r.mode, clientName: r.client_name, clientId: r.client_id,
    fuelType: r.fuel_type, liters: +r.liters || 0, pricePerLiter: +r.price_per_liter || 0,
    amount: +r.amount || 0, trackId: r.track_id, trackName: r.track_name,
    pompisteId: r.pompiste_id, pompisteName: r.pompiste_name, notes: r.notes,
    createdAt: r.created_at,
  };
}
function mapFuelSale(r: any): FuelSale {
  return { id: r.id, date: r.date, pumpId: r.pump_id, liters: +r.liters, pricePerLiter: +r.price_per_liter, total: +r.total, paymentMode: r.payment_mode, clientId: r.client_id, bonNumber: r.bon_number, bonPhoto: r.bon_photo_url, bonPhotoUrl: r.bon_photo_url, pompisteId: r.pompiste_id, brigadeId: r.brigade_id };
}
function mapShopSale(r: any): ShopSale {
  return { id: r.id, date: r.date, clientId: r.client_id, sellerId: r.seller_id, items: [], subtotal: +r.subtotal, tvaAmount: +r.tva_amount, total: +r.total, paymentMode: r.payment_mode, chequeNumber: r.cheque_number, bonNumber: r.bon_number, bonPhoto: r.bon_photo_url, bonPhotoUrl: r.bon_photo_url, amountPaid: +r.amount_paid, rest: +r.rest, status: r.status, notes: r.notes, printedAt: r.printed_at, invoiceImageUrl: r.invoice_image_url };
}
function mapDeliveryNote(r: any): DeliveryNote {
  return { id: r.id, date: r.date, supplierId: r.supplier_id, tankId: r.tank_id, liters: +r.liters, pricePerLiter: +r.price_per_liter, status: r.status, total: +r.total, expiryDate: r.expiry_date, blNumber: r.bl_number, blDate: r.bl_date, creationDate: r.creation_date, immatriculation: r.immatriculation, driverId: r.driver_id, items: [], photos: [], payments: [] };
}
function mapFuelInvoice(r: any): FuelInvoice {
  return {
    id: r.id, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date,
    creationDate: r.creation_date, receptionDate: r.reception_date,
    deliveryNoteIds: [], // loaded separately from fuel_invoice_bls
    tvaActive: r.tva_active, tvaRate: +r.tva_rate, subtotal: +r.subtotal,
    tvaAmount: +r.tva_amount, total: +r.total, amountPaid: +r.amount_paid,
    rest: +r.rest, status: r.status, appointmentDate: r.appointment_date,
    appointmentAmount: r.appointment_amount ? +r.appointment_amount : undefined,
    appointmentNotes: r.appointment_notes, invoiceImageUrl: r.invoice_image_url, notes: r.notes
  };
}
function mapFuelReceipt(r: any): FuelReceipt {
  return {
    id: r.id, receiptNumber: r.receipt_number, receiptDate: r.receipt_date,
    creationDate: r.creation_date, invoiceIds: [],
    totalInvoiced: +r.total_invoiced, amountPaid: +r.amount_paid,
    rest: +r.rest, isDebtPayment: r.is_debt_payment,
    receiptImageUrl: r.receipt_image_url, notes: r.notes
  };
}
function mapDeliveryNoteItem(r: any): DeliveryNoteItem {
  return { id: r.id, deliveryNoteId: r.delivery_note_id, tankId: r.tank_id, liters: +r.liters, pricePerLiter: +r.price_per_liter, total: +r.total };
}
function mapPurchase(r: any): Purchase {
  return { id: r.id, date: r.date, supplierId: r.supplier_id, invoiceNumber: r.invoice_number, dueDate: r.due_date, driverId: r.driver_id, items: [], total: +r.total, amountPaid: +r.amount_paid, rest: +r.rest, status: r.status, paymentMode: r.payment_mode, chequeNumber: r.cheque_number, linkedDeliveryNoteId: r.linked_delivery_note_id, payments: [], notes: r.notes, type: r.type, tvaRate: +(r.tva_rate ?? 0), tvaActive: r.tva_active, tankId: r.tank_id, receiptPhoto: r.receipt_photo_url,
    blNumber: r.bl_number ?? undefined, discountType: r.discount_type ?? undefined, discountValue: r.discount_value != null ? +r.discount_value : undefined,
    discountAmount: r.discount_amount != null ? +r.discount_amount : undefined, subtotal: r.subtotal != null ? +r.subtotal : undefined,
    tvaAmount: r.tva_amount != null ? +r.tva_amount : undefined,
    appointmentActive: r.appointment_active ?? undefined, appointmentDate: r.appointment_date ?? undefined,
    appointmentAmount: r.appointment_amount != null ? +r.appointment_amount : undefined,
    appointmentNotes: r.appointment_notes ?? undefined, appointmentPaid: r.appointment_paid ?? undefined,
    appointmentPaidAt: r.appointment_paid_at ?? undefined };
}
/**
 * Sub-records of an achat. `mapPurchase` leaves `items` / `payments` empty, so
 * EVERY path that rebuilds the purchases slice must re-attach them through this
 * helper. A lossy refetch used to drop `items`, and a later edit or delete then
 * rolled back nothing at all on the cuves (the rollback reads `items`).
 */
function mapPurchaseItemRow(i: any): PurchaseItem {
  return {
    productId: i.product_id, productName: i.product_name, quantity: +i.quantity,
    buyPrice: +i.buy_price, sellingPrice: +i.selling_price,
    minStock: i.min_stock ? +i.min_stock : undefined, unit: i.unit, total: +i.total,
    tankId: i.tank_id, tvaActive: i.tva_active, tvaRate: +(i.tva_rate ?? 0),
  };
}
function mapPurchasePaymentRow(pay: any): PurchasePayment {
  return {
    id: pay.id, date: pay.date, amount: +pay.amount, mode: pay.mode,
    chequeNumber: pay.cheque_number ?? undefined,
    bordereauNumber: pay.bordereau_number ?? undefined,
    accountId: pay.account_id ?? undefined,
    notes: pay.notes ?? undefined,
  };
}
/** Rebuilds the full purchases slice (header + cuve lines + règlements). */
function buildPurchases(rows: any[], itemRows: any[], paymentRows: any[]): Purchase[] {
  return (rows ?? []).map(p => {
    const m = mapPurchase(p);
    m.items    = (itemRows    ?? []).filter((i: any)   => i.purchase_id === p.id).map(mapPurchaseItemRow);
    m.payments = (paymentRows ?? []).filter((pay: any) => pay.purchase_id === p.id).map(mapPurchasePaymentRow);
    return m;
  });
}
function mapExpense(r: any): Expense {
  return { id: r.id, date: r.date, category: r.category, amount: +r.amount, description: r.description, paymentMode: r.payment_mode, chequeNumber: r.cheque_number, bordereauNumber: r.bordereau_number ?? undefined, accountId: r.account_id ?? undefined, part: (r.part || 'carburant') as TreasuryPart, paidBy: r.paid_by, recipient: r.recipient, status: r.status, receipt: r.receipt_url, receiptUrl: r.receipt_url, createdBy: r.created_by, brigadeId: r.brigade_id ?? undefined, brigadeJustificationId: r.brigade_justification_id ?? undefined, pompisteId: r.pompiste_id ?? undefined };
}
function mapBankAccount(r: any): BankAccount {
  return {
    id: r.id, name: r.name, accountNumber: r.account_number,
    initialBalance: +(r.initial_balance ?? 0), balance: +(r.balance ?? 0),
    notes: r.notes, createdAt: r.created_at,
  };
}
function mapTreasuryTx(r: any): TreasuryTransaction {
  return {
    id: r.id, date: r.date, kind: r.kind, amount: +(r.amount ?? 0),
    description: r.description, accountFrom: r.account_from ?? undefined,
    accountTo: r.account_to ?? undefined, part: r.part || 'systeme',
    refType: r.ref_type ?? undefined, refId: r.ref_id ?? undefined,
    chequeNumber: r.cheque_number ?? undefined, bordereauNumber: r.bordereau_number ?? undefined,
    createdBy: r.created_by ?? undefined, createdAt: r.created_at,
  };
}
function treasuryTxToRow(t: TreasuryTransaction) {
  return {
    id: t.id, date: t.date, kind: t.kind, amount: t.amount, description: t.description ?? null,
    account_from: t.accountFrom ?? null, account_to: t.accountTo ?? null, part: t.part,
    ref_type: t.refType ?? null, ref_id: t.refId ?? null,
    cheque_number: t.chequeNumber ?? null, bordereau_number: t.bordereauNumber ?? null,
    created_by: t.createdBy ?? null,
  };
}
function mapInventory(r: any): Inventory {
  return { id: r.id, name: r.name, description: r.description, date: r.date, user: r.user_name, type: r.type, status: r.status, fuelGaps: r.fuel_gaps || [], pumpIndexGaps: r.pump_index_gaps || [], productGaps: r.product_gaps || [], adjustmentReason: r.adjustment_reason, adjustedAt: r.adjusted_at };
}
function mapDailyReport(r: any): DailyReport {
  return { id: r.id, date: r.date, fuelRevenue: +r.fuel_revenue, shopRevenue: +r.shop_revenue, totalExpenses: +r.total_expenses, cashToDeposit: +r.cash_to_deposit, tankVariations: r.tank_variations || [], brigadeIds: r.brigade_ids || [] };
}
function mapNozzle(r: any): PumpNozzle {
  return { id: r.id, pumpId: r.pump_id, name: r.name, tankId: r.tank_id ?? undefined, lastIndex: +r.last_index, startIndex: +r.start_index, status: r.status || 'Actif', createdAt: r.created_at ?? undefined };
}
function mapSettings(r: any): StationSettings {
  return { name: r.name, logo: r.logo_url, logoUrl: r.logo_url, address: r.address, phone: r.phone, email: r.email, fiscalId: r.fiscal_id, rc: r.rc, fuelPrices: r.fuel_prices || emptySettings.fuelPrices, fuelBuyPrices: r.fuel_buy_prices || emptySettings.fuelBuyPrices, conversionTables: r.conversion_tables || {}, productCategories: r.product_categories || emptySettings.productCategories, expenseCategories: r.expense_categories || emptySettings.expenseCategories, productUnits: r.product_units || DEFAULT_PRODUCT_UNITS, decalagePositifActif: r.decalage_positif_actif, decalageNegatifActif: r.decalage_negatif_actif, decalagePositifSeuil: +(r.decalage_positif_seuil ?? 0), decalageNegatifSeuil: +(r.decalage_negatif_seuil ?? 0), magasin1Name: r.magasin1_name ?? undefined, magasin2Name: r.magasin2_name ?? undefined, magasin2Enabled: !!r.magasin2_enabled };
}
function mapAcompte(r: any): Acompte {
  return { id: r.id, date: r.date, amount: +r.amount, description: r.description, isPaid: r.is_paid, monthPaid: r.month_paid };
}
function mapAbsence(r: any): Absence {
  return { id: r.id, date: r.date, cost: +r.cost, description: r.description, isPaid: r.is_paid, monthPaid: r.month_paid };
}
function mapPaymentRecord(r: any): WorkerPaymentRecord {
  return { id: r.id, month: r.month, baseSalary: +r.base_salary, totalAcomptes: +r.total_acomptes, totalAbsences: +r.total_absences, bonusDecalage: +(r.bonus_decalage ?? 0), retenueDecalage: +(r.retenue_decalage ?? 0), netSalary: +r.net_salary, amount: +r.net_salary, paymentDate: r.payment_date, paymentMode: r.payment_mode, chequeNumber: r.cheque_number, notes: r.notes, isPaid: r.is_paid, paidDays: r.paid_days ?? undefined, paidMonths: r.paid_months ?? undefined, decalageIds: r.decalage_ids ?? undefined, primeType: r.prime_type ?? undefined, primeValue: r.prime_value != null ? +r.prime_value : undefined, primeAmount: r.prime_amount != null ? +r.prime_amount : undefined };
}

/**
 * Reports a client movement onto the `clients` row itself.
 *
 * `ADD_CLIENT_PAYMENT` only inserts the line in `client_transactions`; without
 * this the reducer's optimistic debt/balance would be wiped by the refresh that
 * re-reads the client from the database right after. Only PAYMENT (lowers the
 * debt) and RECHARGE (raises the advance) touch the account — a SALE line is
 * pure history, its accounting is carried by the caller's own UPDATE_CLIENT.
 */
async function applyClientPaymentToAccount(
  clientId: string,
  payment: { type: 'PAYMENT' | 'RECHARGE' | 'SALE'; amount: number },
): Promise<void> {
  if (payment.type === 'SALE') return;
  // maybeSingle() avoids a 406 if the client was concurrently deleted.
  const { data } = await supabase.from('clients').select('balance, debt, advance_balance').eq('id', clientId).maybeSingle();
  if (!data) return;
  // Une recharge crédite les DEUX colonnes de l'avance : `balance`, que cet
  // écran a toujours alimentée, et `advance_balance`, la seule que la
  // consommation d'un bon de brigade décrémente. Tant qu'une seule bougeait,
  // les deux racontaient une histoire différente du même compte.
  const patch = payment.type === 'PAYMENT'
    ? { debt: Math.max(0, (+data.debt || 0) - payment.amount) }
    : {
      balance: (+data.balance || 0) + payment.amount,
      advance_balance: (+(data.advance_balance ?? data.balance) || 0) + payment.amount,
    };
  await supabase.from('clients').update(patch).eq('id', clientId);
}

/**
 * Report d'une CORRECTION ou d'une SUPPRESSION de mouvement client sur la fiche.
 *
 * Même raison d'être que `applyClientPaymentToAccount` : la table
 * `client_transactions` porte l'historique, mais les colonnes `debt` /
 * `balance` / `advance_balance` sont des compteurs qu'il faut bouger à la main,
 * sinon le rafraîchissement qui suit l'écriture rendrait l'ancien solde.
 *
 * `delta` est la variation du montant encaissé : positif quand le règlement
 * grossit, négatif quand il rétrécit ou disparaît.
 */
async function applyClientPaymentDelta(
  clientId: string, type: 'PAYMENT' | 'RECHARGE' | 'SALE', delta: number,
): Promise<void> {
  if (type === 'SALE' || !delta) return;
  const { data } = await supabase.from('clients').select('balance, debt, advance_balance').eq('id', clientId).maybeSingle();
  if (!data) return;
  const patch = type === 'PAYMENT'
    ? { debt: Math.max(0, (+data.debt || 0) - delta) }
    : {
      balance: Math.max(0, (+data.balance || 0) + delta),
      advance_balance: Math.max(0, (+(data.advance_balance ?? data.balance) || 0) + delta),
    };
  await supabase.from('clients').update(patch).eq('id', clientId);
}

async function cleanBrigadeDependencies(brigadeId: string): Promise<void> {
  // 1. Delete brigade_decalage_alerts for this brigade
  await supabase.from('brigade_decalage_alerts').delete().eq('brigade_id', brigadeId);
  // 2. Delete brigade_pompiste_assignments for this brigade
  await supabase.from('brigade_pompiste_assignments').delete().eq('brigade_id', brigadeId);
  // 3. Delete pompiste_decalage_history for this brigade
  await supabase.from('pompiste_decalage_history').delete().eq('brigade_id', brigadeId);
  // 4. Delete fuel_sales for this brigade
  await supabase.from('fuel_sales').delete().eq('brigade_id', brigadeId);
  // 5. Delete brigade_accounting_justifications associated with this brigade's accounting
  const { data: accountings } = await supabase.from('brigade_accounting').select('id').eq('brigade_id', brigadeId);
  if (accountings && accountings.length > 0) {
    const accIds = accountings.map(a => a.id);
    await supabase.from('brigade_accounting_justifications').delete().in('accounting_id', accIds);
  }
  // 6. Delete brigade_accounting rows
  await supabase.from('brigade_accounting').delete().eq('brigade_id', brigadeId);
  // 7. Les lignes du grand livre écrites par cette brigade — les espèces remises
  //    ET les encaissements TPE / TAG. Sans ce ménage, la brigade disparaissait
  //    de l'écran mais son argent restait sur la caisse et sur les comptes
  //    bancaires, sans plus aucune pièce pour l'expliquer.
  await supabase.from('treasury_transactions').delete()
    .eq('ref_type', 'brigade').eq('ref_id', brigadeId);
  // 8. Les dépenses justifiées sur cette brigade (`lib/brigadeExpenses.ts`).
  //    La colonne peut ne pas exister encore : l'erreur ne doit pas empêcher la
  //    suppression de la brigade elle-même.
  const { error: expErr } = await supabase.from('expenses').delete().eq('brigade_id', brigadeId);
  if (expErr) console.warn('[brigade] dépenses de brigade non supprimées :', expErr.message);
}

// ─── Armoires : écriture en base ──────────────────────────────────────────────

/** Colonnes jsonb d'une brigade qui portent son récap d'armoire. */
function brigadeArmoireColumns(b: Brigade) {
  return {
    armoire_sales: b.armoireSales || [],
    armoire_product_purchases: b.armoireProductPurchases || [],
    armoire_stock_snapshot: b.armoireStockSnapshot || [],
  };
}

/** Colonnes du justificatif ACHAT_PRODUIT (vides pour les autres types). */
function justifProductColumns(j: BrigadeAccountingJustification) {
  if (j.justificationType !== 'ACHAT_PRODUIT') return {};
  return {
    product_id: nz(j.productId), product_name: nz(j.productName), module_key: nz(j.moduleKey),
    armoire_id: nz(j.armoireId), quantity: j.quantity || 0, unit_price: j.unitPrice || 0,
    supplier_name: nz(j.supplierName), consigne_mode: nz(j.consigneMode),
  };
}

const stockTransferRow = (tr: StockTransfer) => ({
  id: tr.id, armoire_id: tr.armoireId, module_key: tr.moduleKey, date: tr.date, source: tr.source,
  notes: nz(tr.notes), created_by: nz(tr.createdBy), total_qty: tr.totalQty,
});
const stockTransferItemRow = (transferId: string, i: StockTransferItem) => ({
  id: i.id, transfer_id: transferId, product_id: i.productId, product_name: i.productName,
  barcode: nz(i.barcode), quantity: i.quantity, consigne_state: nz(i.consigneState),
});

/**
 * Annule en base les mouvements d'armoire ENREGISTRÉS d'une brigade : on relit
 * ce qui a réellement été appliqué (armoire_sales / armoire_purchases) avant de
 * le rendre, puis on efface ces lignes. Table absente => rien à rendre.
 */
async function reverseBrigadeArmoireStock(brigadeId: string): Promise<void> {
  const [salesRes, purchRes] = await Promise.all([
    supabase.from('armoire_sales').select('armoire_id, product_id, quantity, consigne, module_key').eq('brigade_id', brigadeId),
    supabase.from('armoire_purchases').select('armoire_id, product_id, quantity, consigne_mode, module_key').eq('brigade_id', brigadeId),
  ]);
  if (salesRes.error && purchRes.error) return;
  for (const r of (salesRes.data || []) as any[]) {
    if (!r.armoire_id || !r.product_id) continue;
    const l = armoireSaleStockLine({ productId: r.product_id, quantity: +r.quantity || 0, consigne: !!r.consigne });
    await db.adjustArmoireStock(r.armoire_id, r.product_id, -l.quantity, -(l.emptyQuantity || 0), r.module_key ?? undefined);
  }
  for (const r of (purchRes.data || []) as any[]) {
    if (!r.armoire_id || !r.product_id) continue;
    const l = armoirePurchaseStockLine({ productId: r.product_id, quantity: +r.quantity || 0, consigneMode: r.consigne_mode ?? undefined });
    await db.adjustArmoireStock(r.armoire_id, r.product_id, -l.quantity, -(l.emptyQuantity || 0), r.module_key ?? undefined);
  }
  await Promise.all([
    supabase.from('armoire_sales').delete().eq('brigade_id', brigadeId),
    supabase.from('armoire_purchases').delete().eq('brigade_id', brigadeId),
  ]);
}

/**
 * Écrit les ventes / achats de produits d'une brigade (armoire_sales /
 * armoire_purchases) et applique le delta correspondant au stock d'armoire.
 */
async function writeBrigadeArmoireStock(b: Brigade): Promise<void> {
  const date = b.endDatetime || b.startDatetime || b.date || new Date().toISOString();
  const sales = (b.armoireSales || []).filter(x => x.armoireId && x.productId && x.quantity);
  const purchases = (b.armoireProductPurchases || []).filter(x => x.armoireId && x.productId && x.quantity);
  if (sales.length) {
    await db.addArmoireSales(sales.map(x => ({
      id: newId(), armoire_id: x.armoireId, brigade_id: b.id, pompiste_id: nz(x.pompisteId),
      product_id: x.productId, product_name: x.productName, module_key: nz(x.moduleKey),
      quantity: x.quantity, price: x.price, total: x.total, consigne: !!x.consigne, date,
    })));
    for (const x of sales) {
      const l = armoireSaleStockLine(x);
      await db.adjustArmoireStock(x.armoireId, x.productId, l.quantity, l.emptyQuantity || 0, x.moduleKey);
    }
  }
  if (purchases.length) {
    await db.addArmoirePurchases(purchases.map(x => ({
      id: newId(), armoire_id: x.armoireId, brigade_id: b.id, pompiste_id: nz(x.pompisteId),
      product_id: x.productId, product_name: x.productName, module_key: nz(x.moduleKey),
      quantity: x.quantity, unit_price: x.unitPrice, total: x.total,
      supplier_name: nz(x.supplierName), consigne_mode: nz(x.consigneMode), date,
    })));
    for (const x of purchases) {
      const l = armoirePurchaseStockLine(x);
      await db.adjustArmoireStock(x.armoireId, x.productId, l.quantity, l.emptyQuantity || 0, x.moduleKey);
    }
  }
}

// ─── Supabase sync function (standalone, not a hook) ─────────────────────────
// This is extracted here so AppProvider can wrap dispatch with it.
// NOTE: errors are intentionally NOT caught here — they propagate to
// syncedDispatch which shows a toast and reverts the optimistic change.
async function syncToSupabase(action: AppAction): Promise<void> {
  switch (action.type) {
      case 'ADD_TANK':
        await db.addTank({ id: action.payload.id, name: action.payload.name, type: action.payload.type, capacity: action.payload.capacity, current: action.payload.current, degrees: action.payload.degrees, alert_threshold: action.payload.alertThreshold, notes: action.payload.notes, is_favorite: !!action.payload.isFavorite });
        break;
      case 'UPDATE_TANK':
        await db.updateTank(action.payload.id, { name: action.payload.name, type: action.payload.type, capacity: action.payload.capacity, current: action.payload.current, degrees: action.payload.degrees, alert_threshold: action.payload.alertThreshold, notes: action.payload.notes, is_favorite: !!action.payload.isFavorite });
        break;
      case 'ADJUST_TANK_LEVELS':
        // Atomic server-side delta (SET current = current + delta) so concurrent
        // sessions can't clobber each other. Requires the adjust_tank_level RPC
        // (supabase/migrations/tank_level_delta_rpc.sql).
        for (const d of action.payload) {
          if (!d.tankId || !d.deltaLiters) continue;
          const { error } = await supabase.rpc('adjust_tank_level', { p_tank_id: d.tankId, p_delta: d.deltaLiters });
          if (error) throw new Error(`RPC adjust_tank_level: ${error.message}`);
        }
        break;
      case 'DELETE_TANK': await db.deleteTank(action.payload); break;
      case 'ADD_PERMISSION_TEMPLATE':
        await db.addPermissionTemplate({ id: action.payload.id, name: action.payload.name, role: action.payload.role, permissions: action.payload.permissions });
        break;
      case 'UPDATE_PERMISSION_TEMPLATE':
        await db.updatePermissionTemplate(action.payload.id, { name: action.payload.name, role: action.payload.role, permissions: action.payload.permissions, updated_at: new Date().toISOString() });
        break;
      case 'DELETE_PERMISSION_TEMPLATE': await db.deletePermissionTemplate(action.payload); break;
      case 'ADD_TRACK':    await db.addTrack({ id: action.payload.id, name: action.payload.name }); break;
      case 'UPDATE_TRACK': await db.updateTrack(action.payload.id, { name: action.payload.name, updated_at: new Date().toISOString() }); break;
      case 'DELETE_TRACK': await db.deleteTrack(action.payload); break;
      case 'ADD_PUMP':
        await db.addPump({ id: action.payload.id, number: action.payload.number, name: action.payload.name, tank_id: nz(action.payload.tankId), track_id: nz(action.payload.trackId), type: action.payload.type, last_index: action.payload.lastIndex, status: action.payload.status });
        break;
      case 'UPDATE_PUMP':
        await db.updatePump(action.payload.id, { number: action.payload.number, name: action.payload.name, tank_id: nz(action.payload.tankId), track_id: nz(action.payload.trackId), type: action.payload.type, last_index: action.payload.lastIndex, status: action.payload.status, current_brigade_start_index: action.payload.currentBrigadeStartIndex });
        break;
      case 'DELETE_PUMP': await db.deletePump(action.payload); break;
      case 'ADD_NOZZLE':
        await db.addNozzle({ id: action.payload.id, pump_id: action.payload.pumpId, name: action.payload.name, tank_id: nz(action.payload.tankId), last_index: action.payload.lastIndex, start_index: action.payload.startIndex, status: action.payload.status });
        break;
      case 'UPDATE_NOZZLE':
        await db.updateNozzle(action.payload.id, { name: action.payload.name, tank_id: nz(action.payload.tankId), last_index: action.payload.lastIndex, status: action.payload.status });
        break;
      case 'DELETE_NOZZLE': await db.deleteNozzle(action.payload); break;
      case 'ADD_SUPPLIER':
        await db.addSupplier({ id: action.payload.id, ref: action.payload.ref, name: action.payload.name, contact: action.payload.contact, phone: action.payload.phone, email: action.payload.email, address: action.payload.address, balance: action.payload.balance, total_purchases: action.payload.totalPurchases, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, type: action.payload.type });
        break;
      case 'UPDATE_SUPPLIER':
        await db.updateSupplier(action.payload.id, { ref: action.payload.ref, name: action.payload.name, contact: action.payload.contact, phone: action.payload.phone, email: action.payload.email, address: action.payload.address, balance: action.payload.balance, total_purchases: action.payload.totalPurchases, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, type: action.payload.type });
        break;
      case 'DELETE_SUPPLIER': await db.deleteSupplier(action.payload); break;
      case 'ADD_CLIENT':
        await db.addClient({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, cin: action.payload.cin, email: action.payload.email, address: action.payload.address, contact_person: action.payload.contactPerson, balance: action.payload.balance, debt: action.payload.debt, credit_limit: action.payload.creditLimit, payment_delay: action.payload.paymentDelay, type: action.payload.type, payment_mode: action.payload.paymentMode, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, advance_balance: action.payload.advanceBalance ?? 0, opening_debt: action.payload.openingDebt ?? 0, opening_advance: action.payload.openingAdvance ?? 0, opening_date: nz(action.payload.openingDate), opening_notes: nz(action.payload.openingNotes) });
        break;
      case 'UPDATE_CLIENT':
        await db.updateClient(action.payload.id, { name: action.payload.name, phone: action.payload.phone, cin: action.payload.cin, email: action.payload.email, address: action.payload.address, contact_person: action.payload.contactPerson, balance: action.payload.balance, debt: action.payload.debt, credit_limit: action.payload.creditLimit, payment_delay: action.payload.paymentDelay, type: action.payload.type, payment_mode: action.payload.paymentMode, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, advance_balance: action.payload.advanceBalance ?? 0, opening_debt: action.payload.openingDebt ?? 0, opening_advance: action.payload.openingAdvance ?? 0, opening_date: nz(action.payload.openingDate), opening_notes: nz(action.payload.openingNotes) });
        break;
      case 'DELETE_CLIENT': await db.deleteClient(action.payload); break;
      case 'ADD_PRODUCT':
        await db.addProduct({ id: action.payload.id, ref: action.payload.ref, name: action.payload.name, category: action.payload.category, buy_price: action.payload.buyPrice, selling_price: action.payload.sellingPrice, stock: action.payload.stock, min_stock: action.payload.minStock, barcode: action.payload.barcode, image_url: (action.payload as any).imageUrl || action.payload.image, unit: action.payload.unit, brand: action.payload.brand, brand_id: nz(action.payload.brandId), tva_rate: action.payload.tvaRate ?? 0, sell_by_details: action.payload.sellByDetails ?? false, detail_capacity: action.payload.detailCapacity ?? null, detail_unit: action.payload.detailUnit ?? null });
        break;
      case 'UPDATE_PRODUCT':
        await db.updateProduct(action.payload.id, { ref: action.payload.ref, name: action.payload.name, category: action.payload.category, buy_price: action.payload.buyPrice, selling_price: action.payload.sellingPrice, stock: action.payload.stock, min_stock: action.payload.minStock, barcode: action.payload.barcode, image_url: (action.payload as any).imageUrl || action.payload.image, unit: action.payload.unit, brand: action.payload.brand, brand_id: nz(action.payload.brandId), tva_rate: action.payload.tvaRate ?? 0, sell_by_details: action.payload.sellByDetails ?? false, detail_capacity: action.payload.detailCapacity ?? null, detail_unit: action.payload.detailUnit ?? null });
        break;
      case 'DELETE_PRODUCT': await db.deleteProduct(action.payload); break;
      case 'ADD_BRAND':    await db.addBrand({ id: action.payload.id, name: action.payload.name }); break;
      case 'UPDATE_BRAND': await db.updateBrand(action.payload.id, { name: action.payload.name }); break;
      case 'DELETE_BRAND': await db.deleteBrand(action.payload); break;
      case 'ADD_POMPISTE':
        await db.addPompiste({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, track_id: nz(action.payload.trackId), chef_id: nz(action.payload.chefId), base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        break;
      case 'UPDATE_POMPISTE':
        await db.updatePompiste(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, track_id: nz(action.payload.trackId), chef_id: nz(action.payload.chefId), base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        break;
      case 'DELETE_POMPISTE': await db.deletePompiste(action.payload); break;
      case 'ADD_BRIGADE_CHEF':
        await db.addBrigadeChef({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        if (action.payload.pompisteIds?.length) await supabase.from('chef_pompiste_assignments').insert(action.payload.pompisteIds.map(pid => ({ chef_id: action.payload.id, pompiste_id: pid })));
        break;
      case 'UPDATE_BRIGADE_CHEF':
        await db.updateBrigadeChef(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        if (action.payload.pompisteIds !== undefined) { await supabase.from('chef_pompiste_assignments').delete().eq('chef_id', action.payload.id); if (action.payload.pompisteIds.length) await supabase.from('chef_pompiste_assignments').insert(action.payload.pompisteIds.map(pid => ({ chef_id: action.payload.id, pompiste_id: pid }))); }
        break;
      case 'DELETE_BRIGADE_CHEF': await db.deleteBrigadeChef(action.payload); break;
      case 'ADD_GERANT':
        await db.addGerant({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        break;
      case 'UPDATE_GERANT':
        await db.updateGerant(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        break;
      case 'DELETE_GERANT': await db.deleteGerant(action.payload); break;
      case 'ADD_MAGASIN_WORKER':
        await db.addMagasinWorker({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        break;
      case 'UPDATE_MAGASIN_WORKER':
        await db.updateMagasinWorker(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: (action.payload as any).photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, auth_user_id: action.payload.authUserId, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
        break;
      case 'DELETE_MAGASIN_WORKER': await db.deleteMagasinWorker(action.payload); break;
      case 'ADD_BRIGADE': {
        const b = action.payload;
        await db.addBrigade({ id: b.id, date: b.date, shift: b.shift, chef_id: nz(b.chefId), status: b.status, start_timestamp: b.startTimestamp, end_timestamp: b.endTimestamp, start_time: b.startTime, end_time: b.endTime, start_datetime: nz(b.startDatetime), end_datetime: nz(b.endDatetime), is_active: b.isActive, notes: b.notes, start_indices: b.startIndices || {}, end_indices: b.endIndices || {}, start_tank_levels: b.startTankLevels || {}, end_tank_levels: b.endTankLevels || {}, pompiste_data: b.pompisteData || {}, pompiste_assignments: b.pompisteAssignments || [], start_nozzle_indices: b.startNozzleIndices || {}, end_nozzle_indices: b.endNozzleIndices || {}, active_nozzle_ids: b.activeNozzleIds || [], can_reactivate: b.canReactivate ?? false, pompiste_pump_assignments: b.pompistePumpAssignments || [], versements: b.versements || [], ...brigadeArmoireColumns(b) });
        if (b.pompisteIds?.length) await supabase.from('brigade_pompiste_assignments').insert(b.pompisteIds.map(pid => ({ brigade_id: b.id, pompiste_id: pid })));
        // Ventes / achats de produits en armoire : lignes d'historique + stock.
        await writeBrigadeArmoireStock(b);
        break;
      }
      case 'UPDATE_BRIGADE': {
        const b = action.payload;
        await db.updateBrigade(b.id, { date: b.date, shift: b.shift, chef_id: nz(b.chefId), status: b.status, start_timestamp: b.startTimestamp, end_timestamp: b.endTimestamp, start_time: b.startTime, end_time: b.endTime, start_datetime: nz(b.startDatetime), end_datetime: nz(b.endDatetime), is_active: b.isActive, notes: b.notes, printed_at: b.printedAt, start_indices: b.startIndices || {}, end_indices: b.endIndices || {}, start_tank_levels: b.startTankLevels || {}, end_tank_levels: b.endTankLevels || {}, pompiste_data: b.pompisteData || {}, pompiste_assignments: b.pompisteAssignments || [], start_nozzle_indices: b.startNozzleIndices || {}, end_nozzle_indices: b.endNozzleIndices || {}, active_nozzle_ids: b.activeNozzleIds || [], can_reactivate: b.canReactivate ?? false, pompiste_pump_assignments: b.pompistePumpAssignments || [], versements: b.versements || [], ...(carriesArmoireMoves(b) ? brigadeArmoireColumns(b) : {}) });
        if (b.pompisteIds) { await supabase.from('brigade_pompiste_assignments').delete().eq('brigade_id', b.id); if (b.pompisteIds.length) await supabase.from('brigade_pompiste_assignments').insert(b.pompisteIds.map(pid => ({ brigade_id: b.id, pompiste_id: pid }))); }
        // Éditer une brigade rejoue ses mouvements d'armoire : on rend ce qui
        // avait été appliqué (lu en base), puis on écrit la nouvelle version.
        if (carriesArmoireMoves(b)) {
          await reverseBrigadeArmoireStock(b.id);
          await writeBrigadeArmoireStock(b);
        }
        break;
      }
      case 'DELETE_BRIGADE':
        // Les armoires récupèrent d'abord ce que la brigade avait vendu / acheté.
        await reverseBrigadeArmoireStock(action.payload);
        await cleanBrigadeDependencies(action.payload);
        await db.deleteBrigade(action.payload);
        break;

      // ── Armoires ───────────────────────────────────────────────────────────
      case 'ADD_ARMOIRE':
        await db.addArmoire({ id: action.payload.id, name: action.payload.name, track_id: nz(action.payload.trackId), pump_ids: action.payload.pumpIds || [], notes: nz(action.payload.notes) });
        break;
      case 'UPDATE_ARMOIRE':
        await db.updateArmoire(action.payload.id, { name: action.payload.name, track_id: nz(action.payload.trackId), pump_ids: action.payload.pumpIds || [], notes: nz(action.payload.notes), updated_at: new Date().toISOString() });
        break;
      case 'DELETE_ARMOIRE':
        await db.deleteArmoire(action.payload);
        break;

      // ── Transferts Magasin → Armoire ───────────────────────────────────────
      // Le stock du MAGASIN (biz_products) est déplacé par l'écran lui-même ;
      // ici : l'en-tête, ses lignes et le stock de l'armoire (RPC atomique).
      case 'ADD_STOCK_TRANSFER': {
        const tr = action.payload;
        await db.addStockTransfer(stockTransferRow(tr));
        await db.addStockTransferItems(tr.items.map(i => stockTransferItemRow(tr.id, i)));
        for (const l of transferLines(tr)) {
          await db.adjustArmoireStock(tr.armoireId, l.productId, l.quantity, l.emptyQuantity || 0, tr.moduleKey);
        }
        break;
      }
      case 'UPDATE_STOCK_TRANSFER': {
        const { transfer, previous } = action.payload;
        for (const l of transferLines(previous)) {
          await db.adjustArmoireStock(previous.armoireId, l.productId, -l.quantity, -(l.emptyQuantity || 0), previous.moduleKey);
        }
        await db.deleteStockTransferItems(transfer.id);
        const { id: _id, ...row } = stockTransferRow(transfer);
        await db.updateStockTransfer(transfer.id, { ...row, updated_at: new Date().toISOString() });
        await db.addStockTransferItems(transfer.items.map(i => stockTransferItemRow(transfer.id, i)));
        for (const l of transferLines(transfer)) {
          await db.adjustArmoireStock(transfer.armoireId, l.productId, l.quantity, l.emptyQuantity || 0, transfer.moduleKey);
        }
        break;
      }
      case 'DELETE_STOCK_TRANSFER': {
        const tr = action.payload;
        for (const l of transferLines(tr)) {
          await db.adjustArmoireStock(tr.armoireId, l.productId, -l.quantity, -(l.emptyQuantity || 0), tr.moduleKey);
        }
        await db.deleteStockTransfer(tr.id);
        break;
      }
      case 'UPDATE_BRIGADE_STATUS': await db.updateBrigade(action.payload.brigadeId, { is_active: action.payload.isActive, status: action.payload.status }); break;
      case 'ADD_BRIGADE_DECALAGE_ALERT': {
        const al = action.payload;
        // Use upsert with ignoreDuplicates to avoid 409 conflicts when the same alert is re-dispatched
        await supabase.from('brigade_decalage_alerts').upsert({
          id: al.id, brigade_id: nz(al.brigadeId), brigade_date: al.brigadeDate,
          start_datetime: nz(al.startDatetime), end_datetime: nz(al.endDatetime),
          chef_id: nz(al.chefId), chef_name: al.chefName,
          alert_type: al.alertType, tank_id: nz(al.tankId), tank_name: al.tankName,
          pompiste_id: nz(al.pompisteId), pompiste_name: al.pompisteName,
          decalage_liters: al.decalageLiters, decalage_amount: al.decalageAmount,
          workers_info: al.workersInfo || [], is_dismissed: al.isDismissed,
          created_at: al.createdAt,
        }, { onConflict: 'id', ignoreDuplicates: true });
        break;
      }
      case 'DISMISS_BRIGADE_DECALAGE_ALERT':
        await supabase.from('brigade_decalage_alerts').update({ is_dismissed: true }).eq('id', action.payload);
        break;
      case 'DELETE_BRIGADE_DECALAGE_ALERTS_BY_BRIGADE':
        await supabase.from('brigade_decalage_alerts').delete().eq('brigade_id', action.payload);
        break;
      case 'ADD_BRIGADE_ACCOUNTING': {
        const a = action.payload;
        // Use upsert to handle FK race condition: brigade INSERT may not be committed
        // yet when accounting INSERT fires. Upsert retries gracefully and also prevents
        // duplicate-key errors on double-submission.
        const accountingRow = { id: a.id, brigade_id: a.brigadeId, total_due: a.totalDue, cash_received: a.cashReceived, rest: a.rest, tank_summary: a.tankSummary || [], nozzle_summary: a.nozzleSummary || [], decalage_summary: a.decalageSummary || {}, cuve_verifications: a.cuveVerifications || {}, nozzle_verifications: a.nozzleVerifications || {}, rest_assigned_worker_type: nz(a.restAssignedWorkerType), rest_assigned_worker_id: nz(a.restAssignedWorkerId), rest_assigned_amount: a.restAssignedAmount || 0, status: a.status, created_by: a.createdBy, pompiste_summary: a.pompisteSummary || {} };
        // Retry up to 3 times with exponential back-off to handle the brigade FK race
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 300 * attempt));
          const { error: accErr } = await supabase.from('brigade_accounting').upsert(accountingRow, { onConflict: 'id' });
          if (!accErr) { lastErr = null; break; }
          lastErr = new Error(`INSERT brigade_accounting: ${accErr.message}`);
        }
        if (lastErr) throw lastErr;
        if (a.justifications?.length) await Promise.all(a.justifications.map(j => {
          const isTPE = j.justificationType === 'TAG' || j.justificationType === 'TPE';
          return db.addBrigadeAccountingJustification({
            id: j.id,
            accounting_id: a.id,
            // For TAG/TPE there is no client — skip client_id so the (nullable) column stays null
            ...(isTPE ? {} : { client_id: nz(j.clientId) }),
            amount: j.amount,
            client_type: j.clientType,
            payment_mode: j.paymentMode,
            notes: j.notes,
            justification_type: j.justificationType || 'CLIENT', bank_account_id: nz(j.bankAccountId),
            client_name: nz(j.clientName),
            expense_category: nz(j.expenseCategory),
            fuel_type: nz(j.fuelType),
            liters: j.liters || 0,
            price_per_liter: j.pricePerLiter || 0,
            track_id: nz(j.trackId),
            pompiste_id: nz(j.pompisteId),
            ...justifProductColumns(j),
          });
        }));
        // Save any TAG/TPE justifications as tpe_transactions rows (Caisse TPE)
        {
          const tpeJustifs = a.justifications?.filter(j => j.justificationType === 'TAG' || j.justificationType === 'TPE') || [];
          if (tpeJustifs.length) {
            await Promise.all(tpeJustifs.map(j =>
              supabase.from('tpe_transactions').insert({
                id: j.id,
                brigade_id: a.brigadeId,
                accounting_id: a.id,
                date: new Date().toISOString().split('T')[0],
                mode: j.justificationType,
                client_name: nz(j.clientName),
                client_id: nz(j.clientId),
                fuel_type: j.fuelType,
                liters: j.liters || 0,
                price_per_liter: j.pricePerLiter || 0,
                amount: j.amount,
                track_id: nz(j.trackId),
                pompiste_id: nz(j.pompisteId),
              })
            ));
          }
        }
        // Save décalage history entries for each pompiste that has a décalage
        if (a.decalageSummary && Object.keys(a.decalageSummary).length > 0) {
          const decalagePromises = Object.entries(a.decalageSummary).map(([pompisteId, d]: [string, any]) => {
            if (Math.abs(d.money) < 0.01) return Promise.resolve();
            return db.addDecalageHistory({
              id: newId(),
              pompiste_id: pompisteId,
              brigade_id: a.brigadeId,
              date: new Date().toISOString().split('T')[0],
              amount: Math.abs(d.money),
              type: d.money < 0 ? 'BONUS' : 'RETENUE',
            });
          });
          // Also save rest-assigned worker décalage if present (skip chefs — no FK in pompiste_decalage_history)
          if (a.restAssignedWorkerId && Math.abs(a.restAssignedAmount || 0) > 0.01 && a.restAssignedWorkerType !== 'chef_brigade') {
            decalagePromises.push(
              db.addDecalageHistory({
                id: newId(),
                pompiste_id: a.restAssignedWorkerId,
                brigade_id: a.brigadeId,
                date: new Date().toISOString().split('T')[0],
                amount: Math.abs(a.restAssignedAmount || 0),
                type: (a.rest || 0) < 0 ? 'BONUS' : 'RETENUE',
              })
            );
          }
          await Promise.allSettled(decalagePromises);
        }
        break;
      }
      case 'UPDATE_BRIGADE_ACCOUNTING': {
        const a = action.payload;
        await db.updateBrigadeAccounting(a.id, { brigade_id: a.brigadeId, total_due: a.totalDue, cash_received: a.cashReceived, rest: a.rest, tank_summary: a.tankSummary || [], nozzle_summary: a.nozzleSummary || [], decalage_summary: a.decalageSummary || {}, cuve_verifications: a.cuveVerifications || {}, nozzle_verifications: a.nozzleVerifications || {}, rest_assigned_worker_type: nz(a.restAssignedWorkerType), rest_assigned_worker_id: nz(a.restAssignedWorkerId), rest_assigned_amount: a.restAssignedAmount || 0, status: a.status, created_by: a.createdBy, pompiste_summary: a.pompisteSummary || {} });
        // Re-sync justifications for this accounting (delete old, then re-insert)
        await supabase.from('brigade_accounting_justifications').delete().eq('accounting_id', a.id);
        if (a.justifications?.length) await Promise.all(a.justifications.map(j => {
          const isTPE = j.justificationType === 'TAG' || j.justificationType === 'TPE';
          return db.addBrigadeAccountingJustification({
            id: j.id,
            accounting_id: a.id,
            // For TAG/TPE there is no client — skip client_id so the (nullable) column stays null
            ...(isTPE ? {} : { client_id: nz(j.clientId) }),
            amount: j.amount,
            client_type: j.clientType,
            payment_mode: j.paymentMode,
            notes: j.notes,
            justification_type: j.justificationType || 'CLIENT', bank_account_id: nz(j.bankAccountId),
            client_name: nz(j.clientName),
            expense_category: nz(j.expenseCategory),
            fuel_type: nz(j.fuelType),
            liters: j.liters || 0,
            price_per_liter: j.pricePerLiter || 0,
            track_id: nz(j.trackId),
            pompiste_id: nz(j.pompisteId),
            ...justifProductColumns(j),
          });
        }));
        // Re-sync TAG/TPE transactions for this accounting (delete old, then re-insert)
        await supabase.from('tpe_transactions').delete().eq('accounting_id', a.id);
        {
          const tpeJustifs = a.justifications?.filter(j => j.justificationType === 'TAG' || j.justificationType === 'TPE') || [];
          if (tpeJustifs.length) {
            await Promise.all(tpeJustifs.map(j =>
              supabase.from('tpe_transactions').insert({
                id: j.id,
                brigade_id: a.brigadeId,
                accounting_id: a.id,
                date: new Date().toISOString().split('T')[0],
                mode: j.justificationType,
                client_name: nz(j.clientName),
                client_id: nz(j.clientId),
                fuel_type: j.fuelType,
                liters: j.liters || 0,
                price_per_liter: j.pricePerLiter || 0,
                amount: j.amount,
                track_id: nz(j.trackId),
                pompiste_id: nz(j.pompisteId),
              })
            ));
          }
        }
        // Re-sync décalage history for this brigade (delete old, then re-insert)
        await supabase.from('pompiste_decalage_history').delete().eq('brigade_id', a.brigadeId);
        if (a.decalageSummary && Object.keys(a.decalageSummary).length > 0) {
          const decalagePromises = Object.entries(a.decalageSummary).map(([pompisteId, d]: [string, any]) => {
            if (Math.abs(d.money) < 0.01) return Promise.resolve();
            return db.addDecalageHistory({
              id: newId(),
              pompiste_id: pompisteId,
              brigade_id: a.brigadeId,
              date: new Date().toISOString().split('T')[0],
              amount: Math.abs(d.money),
              type: d.money < 0 ? 'BONUS' : 'RETENUE',
            });
          });
          if (a.restAssignedWorkerId && Math.abs(a.restAssignedAmount || 0) > 0.01 && a.restAssignedWorkerType !== 'chef_brigade') {
            decalagePromises.push(
              db.addDecalageHistory({
                id: newId(),
                pompiste_id: a.restAssignedWorkerId,
                brigade_id: a.brigadeId,
                date: new Date().toISOString().split('T')[0],
                amount: Math.abs(a.restAssignedAmount || 0),
                type: (a.rest || 0) < 0 ? 'BONUS' : 'RETENUE',
              })
            );
          }
          await Promise.allSettled(decalagePromises);
        }
        break;
      }
      case 'ADD_FUEL_SALE':
        await db.addFuelSale({ id: action.payload.id, date: action.payload.date, pump_id: action.payload.pumpId, liters: action.payload.liters, price_per_liter: action.payload.pricePerLiter, total: action.payload.total, payment_mode: action.payload.paymentMode, client_id: nz(action.payload.clientId), bon_number: action.payload.bonNumber, bon_photo_url: (action.payload as any).bonPhotoUrl || action.payload.bonPhoto, pompiste_id: nz(action.payload.pompisteId), brigade_id: nz(action.payload.brigadeId) });
        break;
      case 'UPDATE_FUEL_SALE':
        await db.updateFuelSale(action.payload.id, { pump_id: action.payload.pumpId, liters: action.payload.liters, price_per_liter: action.payload.pricePerLiter, total: action.payload.total, payment_mode: action.payload.paymentMode, client_id: nz(action.payload.clientId), bon_number: action.payload.bonNumber, bon_photo_url: (action.payload as any).bonPhotoUrl });
        break;
      case 'DELETE_FUEL_SALE': await db.deleteFuelSale(action.payload); break;
      case 'ADD_SHOP_SALE': {
        const s = action.payload;
        await db.addShopSale({ id: s.id, date: s.date, client_id: nz(s.clientId), seller_id: nz(s.sellerId), subtotal: s.subtotal, tva_amount: s.tvaAmount ?? 0, total: s.total, payment_mode: s.paymentMode, cheque_number: s.chequeNumber, bon_number: s.bonNumber, bon_photo_url: (s as any).bonPhotoUrl, amount_paid: s.amountPaid ?? 0, rest: s.rest ?? 0, status: s.status, notes: s.notes, invoice_image_url: s.invoiceImageUrl ?? null });
        if (s.items?.length) await db.addShopSaleItems(s.items.map(i => ({ sale_id: s.id, product_id: i.productId, product_name: i.productName, quantity: i.quantity, price: i.price, tva: i.tva ?? 0 })));
        break;
      }
      case 'UPDATE_SHOP_SALE':
        await db.updateShopSale(action.payload.id, { subtotal: action.payload.subtotal, tva_amount: action.payload.tvaAmount, total: action.payload.total, payment_mode: action.payload.paymentMode, amount_paid: action.payload.amountPaid, rest: action.payload.rest, status: action.payload.status, notes: action.payload.notes, printed_at: action.payload.printedAt });
        break;
      case 'DELETE_SHOP_SALE': await db.deleteShopSale(action.payload); break;
      case 'ADD_DELIVERY_NOTE': {
        const d = action.payload;
        await db.addDeliveryNote({ id: d.id, date: d.date, supplier_id: nz(d.supplierId), tank_id: nz(d.tankId), liters: d.liters, price_per_liter: d.pricePerLiter, status: d.status, total: d.total, expiry_date: nz(d.expiryDate), bl_number: d.blNumber ?? null, bl_date: nz(d.blDate), creation_date: nz(d.creationDate), immatriculation: d.immatriculation ?? null, driver_id: nz(d.driverId) });
        if (d.items?.length) {
          const { error: itemsErr } = await supabase.from('delivery_note_items').insert(d.items.map(it => ({ id: it.id, delivery_note_id: d.id, tank_id: nz(it.tankId), liters: it.liters, price_per_liter: it.pricePerLiter, total: it.total })));
          if (itemsErr) throw new Error(`INSERT delivery_note_items: ${itemsErr.message}`);
        }
        if (d.photos?.length) for (const url of d.photos) await db.addDeliveryNotePhoto({ delivery_note_id: d.id, photo_url: url });
        if (d.payments?.length) for (const p of d.payments) await db.addDeliveryNotePayment({ id: p.id, delivery_note_id: d.id, date: p.date, amount: p.amount, mode: p.mode, receipt_number: p.receiptNumber, receipt_photo_url: p.receiptPhoto });
        break;
      }
      case 'UPDATE_DELIVERY_NOTE': {
        const d = action.payload;
        await db.updateDeliveryNote(d.id, { date: d.date, supplier_id: nz(d.supplierId), tank_id: nz(d.tankId), liters: d.liters, price_per_liter: d.pricePerLiter, status: d.status, total: d.total, expiry_date: nz(d.expiryDate), bl_number: d.blNumber ?? null, bl_date: nz(d.blDate), creation_date: nz(d.creationDate), immatriculation: d.immatriculation ?? null, driver_id: nz(d.driverId) });
        {
          const { error: delErr } = await supabase.from('delivery_note_items').delete().eq('delivery_note_id', d.id);
          if (delErr) throw new Error(`DELETE delivery_note_items: ${delErr.message}`);
        }
        if (d.items?.length) {
          const { error: insErr } = await supabase.from('delivery_note_items').insert(d.items.map(it => ({ id: it.id, delivery_note_id: d.id, tank_id: nz(it.tankId), liters: it.liters, price_per_liter: it.pricePerLiter, total: it.total })));
          if (insErr) throw new Error(`INSERT delivery_note_items: ${insErr.message}`);
        }
        // Re-sync photos so newly-attached scans persist on edit
        await supabase.from('delivery_note_photos').delete().eq('delivery_note_id', d.id);
        if (d.photos?.length) for (const url of d.photos) await db.addDeliveryNotePhoto({ delivery_note_id: d.id, photo_url: url });
        break;
      }
      case 'DELETE_DELIVERY_NOTE': await db.deleteDeliveryNote(action.payload); break;
      case 'ADD_FUEL_INVOICE': {
        const fi = action.payload;
        await supabase.from('fuel_invoices').insert({
          id: fi.id, invoice_number: fi.invoiceNumber, invoice_date: fi.invoiceDate,
          creation_date: fi.creationDate, reception_date: nz(fi.receptionDate),
          tva_active: fi.tvaActive, tva_rate: fi.tvaRate, subtotal: fi.subtotal,
          tva_amount: fi.tvaAmount, total: fi.total, amount_paid: fi.amountPaid,
          rest: fi.rest, status: fi.status, appointment_date: nz(fi.appointmentDate),
          appointment_amount: fi.appointmentAmount ?? null, appointment_notes: fi.appointmentNotes ?? null,
          invoice_image_url: fi.invoiceImageUrl ?? null, notes: fi.notes ?? null
        });
        if (fi.deliveryNoteIds.length > 0) {
          await supabase.from('fuel_invoice_bls').insert(
            fi.deliveryNoteIds.map(dnId => ({ invoice_id: fi.id, delivery_note_id: dnId }))
          );
        }
        break;
      }
      case 'UPDATE_FUEL_INVOICE': {
        const ufi = action.payload;
        await supabase.from('fuel_invoices').update({
          invoice_number: ufi.invoiceNumber, invoice_date: ufi.invoiceDate,
          reception_date: nz(ufi.receptionDate), tva_active: ufi.tvaActive, tva_rate: ufi.tvaRate,
          subtotal: ufi.subtotal, tva_amount: ufi.tvaAmount, total: ufi.total,
          amount_paid: ufi.amountPaid, rest: ufi.rest, status: ufi.status,
          appointment_date: nz(ufi.appointmentDate), appointment_amount: ufi.appointmentAmount ?? null,
          appointment_notes: ufi.appointmentNotes ?? null,
          invoice_image_url: ufi.invoiceImageUrl ?? null, notes: ufi.notes ?? null, updated_at: new Date().toISOString()
        }).eq('id', ufi.id);
        await supabase.from('fuel_invoice_bls').delete().eq('invoice_id', ufi.id);
        if (ufi.deliveryNoteIds.length > 0) {
          await supabase.from('fuel_invoice_bls').insert(
            ufi.deliveryNoteIds.map(dnId => ({ invoice_id: ufi.id, delivery_note_id: dnId }))
          );
        }
        break;
      }
      case 'DELETE_FUEL_INVOICE':
        await supabase.from('fuel_invoices').delete().eq('id', action.payload);
        break;
      case 'ADD_FUEL_RECEIPT': {
        const fr = action.payload;
        await supabase.from('fuel_receipts').insert({
          id: fr.id, receipt_number: fr.receiptNumber, receipt_date: fr.receiptDate,
          creation_date: fr.creationDate, total_invoiced: fr.totalInvoiced,
          amount_paid: fr.amountPaid, rest: fr.rest, is_debt_payment: fr.isDebtPayment,
          receipt_image_url: fr.receiptImageUrl ?? null, notes: fr.notes ?? null
        });
        if (fr.invoiceIds.length > 0) {
          await supabase.from('fuel_receipt_invoices').insert(
            fr.invoiceIds.map(invId => ({ receipt_id: fr.id, invoice_id: invId, amount: fr.amountPaid / fr.invoiceIds.length }))
          );
        }
        break;
      }
      case 'UPDATE_FUEL_RECEIPT': {
        const ufr = action.payload;
        await supabase.from('fuel_receipts').update({
          receipt_number: ufr.receiptNumber, receipt_date: ufr.receiptDate,
          total_invoiced: ufr.totalInvoiced, amount_paid: ufr.amountPaid, rest: ufr.rest,
          is_debt_payment: ufr.isDebtPayment, receipt_image_url: ufr.receiptImageUrl ?? null,
          notes: ufr.notes ?? null, updated_at: new Date().toISOString()
        }).eq('id', ufr.id);
        await supabase.from('fuel_receipt_invoices').delete().eq('receipt_id', ufr.id);
        if (ufr.invoiceIds.length > 0) {
          await supabase.from('fuel_receipt_invoices').insert(
            ufr.invoiceIds.map(invId => ({ receipt_id: ufr.id, invoice_id: invId, amount: ufr.amountPaid }))
          );
        }
        break;
      }
      case 'DELETE_FUEL_RECEIPT':
        await supabase.from('fuel_receipts').delete().eq('id', action.payload);
        break;
      case 'ADD_PURCHASE': {
        const p = action.payload;
        await db.addPurchase({ id: p.id, date: p.date, supplier_id: nz(p.supplierId), invoice_number: p.invoiceNumber, due_date: nz(p.dueDate), driver_id: nz(p.driverId), total: p.total, amount_paid: p.amountPaid, rest: p.rest, status: p.status, payment_mode: p.paymentMode, cheque_number: p.chequeNumber, linked_delivery_note_id: nz(p.linkedDeliveryNoteId), notes: p.notes, type: p.type, tva_rate: p.tvaRate ?? 0, tva_active: p.tvaActive ?? false, tank_id: nz(p.tankId), receipt_photo_url: p.receiptPhoto, bl_number: nz(p.blNumber), discount_type: nz(p.discountType), discount_value: p.discountValue ?? 0, discount_amount: p.discountAmount ?? 0, subtotal: p.subtotal ?? 0, tva_amount: p.tvaAmount ?? 0, appointment_active: p.appointmentActive ?? false, appointment_date: nz(p.appointmentDate), appointment_amount: p.appointmentAmount ?? null, appointment_notes: nz(p.appointmentNotes), appointment_paid: p.appointmentPaid ?? false, appointment_paid_at: nz(p.appointmentPaidAt) });
        if (p.items?.length) await db.addPurchaseItems(p.items.map(i => ({ purchase_id: p.id, product_id: nz(i.productId), product_name: i.productName, quantity: i.quantity, buy_price: i.buyPrice, selling_price: i.sellingPrice, min_stock: i.minStock, unit: i.unit, total: i.total, tank_id: nz(i.tankId), tva_active: i.tvaActive ?? false, tva_rate: i.tvaRate ?? 0 })));
        if (p.payments?.length) for (const pay of p.payments) await db.addPurchasePayment({ id: pay.id, purchase_id: p.id, date: pay.date, amount: pay.amount, mode: pay.mode, cheque_number: pay.chequeNumber, bordereau_number: nz(pay.bordereauNumber), account_id: nz(pay.accountId), notes: pay.notes });
        break;
      }
      case 'UPDATE_PURCHASE':
        {
          const p = action.payload;
          await db.updatePurchase(p.id, { date: p.date, supplier_id: nz(p.supplierId), invoice_number: p.invoiceNumber, total: p.total, amount_paid: p.amountPaid, rest: p.rest, status: p.status, payment_mode: p.paymentMode, cheque_number: p.chequeNumber, notes: p.notes, receipt_photo_url: p.receiptPhoto, bl_number: nz(p.blNumber), discount_type: nz(p.discountType), discount_value: p.discountValue ?? 0, discount_amount: p.discountAmount ?? 0, subtotal: p.subtotal ?? 0, tva_amount: p.tvaAmount ?? 0, tva_active: p.tvaActive ?? false, tva_rate: p.tvaRate ?? 0, appointment_active: p.appointmentActive ?? false, appointment_date: nz(p.appointmentDate), appointment_amount: p.appointmentAmount ?? null, appointment_notes: nz(p.appointmentNotes), appointment_paid: p.appointmentPaid ?? false, appointment_paid_at: nz(p.appointmentPaidAt) });
          // Lines and payment methods are rewritten wholesale: without this an
          // edit kept the ORIGINAL rows in Supabase, so any payment method or
          // cuve line added while editing disappeared on the next reload.
          await db.deletePurchaseItems(p.id);
          if (p.items?.length) await db.addPurchaseItems(p.items.map(i => ({ purchase_id: p.id, product_id: nz(i.productId), product_name: i.productName, quantity: i.quantity, buy_price: i.buyPrice, selling_price: i.sellingPrice, min_stock: i.minStock, unit: i.unit, total: i.total, tank_id: nz(i.tankId), tva_active: i.tvaActive ?? false, tva_rate: i.tvaRate ?? 0 })));
          await db.deletePurchasePayments(p.id);
          if (p.payments?.length) await db.addPurchasePayments(p.payments.map(pay => ({ id: pay.id, purchase_id: p.id, date: pay.date, amount: pay.amount, mode: pay.mode, cheque_number: pay.chequeNumber, bordereau_number: nz(pay.bordereauNumber), account_id: nz(pay.accountId), notes: pay.notes })));
        }
        break;
      case 'DELETE_PURCHASE': await db.deletePurchase(action.payload); break;
      case 'ADD_EXPENSE':
        await db.addExpense({ id: action.payload.id, date: action.payload.date, category: action.payload.category, amount: action.payload.amount, description: action.payload.description, payment_mode: action.payload.paymentMode, cheque_number: action.payload.chequeNumber, bordereau_number: nz(action.payload.bordereauNumber), account_id: nz(action.payload.accountId), part: expensePartOf(action.payload), paid_by: action.payload.paidBy, recipient: action.payload.recipient, status: action.payload.status, receipt_url: (action.payload as any).receiptUrl || action.payload.receipt, created_by: nz(action.payload.createdBy), brigade_id: nz(action.payload.brigadeId), brigade_justification_id: nz(action.payload.brigadeJustificationId), pompiste_id: nz(action.payload.pompisteId) });
        break;
      case 'UPDATE_EXPENSE':
        await db.updateExpense(action.payload.id, { date: action.payload.date, category: action.payload.category, amount: action.payload.amount, description: action.payload.description, payment_mode: action.payload.paymentMode, cheque_number: action.payload.chequeNumber, bordereau_number: nz(action.payload.bordereauNumber), account_id: nz(action.payload.accountId), part: expensePartOf(action.payload), paid_by: action.payload.paidBy, recipient: action.payload.recipient, status: action.payload.status, receipt_url: (action.payload as any).receiptUrl, brigade_id: nz(action.payload.brigadeId), brigade_justification_id: nz(action.payload.brigadeJustificationId), pompiste_id: nz(action.payload.pompisteId) });
        break;
      case 'DELETE_EXPENSE': await db.deleteExpense(action.payload); break;

      // ── Treasury ──────────────────────────────────────────────────────
      case 'ADD_BANK_ACCOUNT': {
        const b = action.payload;
        await db.addBankAccount({ id: b.id, name: b.name, account_number: nz(b.accountNumber), initial_balance: b.initialBalance, balance: b.balance, notes: nz(b.notes) });
        break;
      }
      case 'UPDATE_BANK_ACCOUNT': {
        const b = action.payload;
        await db.updateBankAccount(b.id, { name: b.name, account_number: nz(b.accountNumber), initial_balance: b.initialBalance, balance: b.balance, notes: nz(b.notes) });
        break;
      }
      case 'DELETE_BANK_ACCOUNT':
        // Ledger lines referencing the account go with it (see ON DELETE CASCADE
        // in the migration); the reducer already dropped them locally.
        await db.deleteBankAccount(action.payload);
        break;
      case 'ADD_TREASURY_TX':
        await db.addTreasuryTransaction(treasuryTxToRow(action.payload));
        break;
      case 'UPDATE_TREASURY_TX': {
        const { id, ...rest } = treasuryTxToRow(action.payload);
        await db.updateTreasuryTransaction(id, rest);
        break;
      }
      case 'DELETE_TREASURY_TX':
        await db.deleteTreasuryTransaction(action.payload);
        break;

      case 'ADD_INVENTORY':
      case 'SAVE_INVENTORY':
        await db.addInventory({ id: action.payload.id, name: action.payload.name, description: action.payload.description, date: action.payload.date, user_name: action.payload.user, type: action.payload.type, status: action.payload.status, fuel_gaps: action.payload.fuelGaps, pump_index_gaps: action.payload.pumpIndexGaps || [], product_gaps: action.payload.productGaps, adjustment_reason: action.payload.adjustmentReason, adjusted_at: nz(action.payload.adjustedAt) });
        break;
      case 'UPDATE_INVENTORY':
        await db.updateInventory(action.payload.id, { name: action.payload.name, status: action.payload.status, fuel_gaps: action.payload.fuelGaps, pump_index_gaps: action.payload.pumpIndexGaps || [], product_gaps: action.payload.productGaps, adjustment_reason: action.payload.adjustmentReason, adjusted_at: nz(action.payload.adjustedAt) });
        break;
      case 'DELETE_INVENTORY': await db.deleteInventory(action.payload); break;
      case 'ADD_DAILY_REPORT':
        await db.addDailyReport({ id: action.payload.id, date: action.payload.date, fuel_revenue: action.payload.fuelRevenue, shop_revenue: action.payload.shopRevenue, total_expenses: action.payload.totalExpenses, cash_to_deposit: action.payload.cashToDeposit, tank_variations: action.payload.tankVariations, brigade_ids: action.payload.brigadeIds });
        break;
      case 'SET_SETTINGS':
        await db.saveSettings({ name: action.payload.name, logo_url: (action.payload as any).logoUrl || action.payload.logo, address: action.payload.address, phone: action.payload.phone, email: action.payload.email, fiscal_id: action.payload.fiscalId, rc: action.payload.rc, fuel_prices: action.payload.fuelPrices, fuel_buy_prices: action.payload.fuelBuyPrices || emptySettings.fuelBuyPrices, conversion_tables: action.payload.conversionTables, product_categories: action.payload.productCategories, expense_categories: action.payload.expenseCategories, product_units: action.payload.productUnits || DEFAULT_PRODUCT_UNITS, decalage_positif_actif: action.payload.decalagePositifActif, decalage_negatif_actif: action.payload.decalageNegatifActif, decalage_positif_seuil: action.payload.decalagePositifSeuil ?? 0, decalage_negatif_seuil: action.payload.decalageNegatifSeuil ?? 0, magasin1_name: nz(action.payload.magasin1Name), magasin2_name: nz(action.payload.magasin2Name), magasin2_enabled: !!action.payload.magasin2Enabled });
        break;
      case 'UPDATE_WORKER_ACOMPTE':
        await db.addWorkerAcompte({ id: action.payload.acompte.id, worker_type: action.payload.workerType, worker_id: action.payload.workerId, date: action.payload.acompte.date, amount: action.payload.acompte.amount, description: action.payload.acompte.description, is_paid: action.payload.acompte.isPaid, month_paid: action.payload.acompte.monthPaid });
        break;
      case 'UPDATE_WORKER_ABSENCE':
        await db.addWorkerAbsence({ id: action.payload.absence.id, worker_type: action.payload.workerType, worker_id: action.payload.workerId, date: action.payload.absence.date, cost: action.payload.absence.cost, description: action.payload.absence.description, is_paid: action.payload.absence.isPaid, month_paid: action.payload.absence.monthPaid });
        break;
      case 'ADD_WORKER_PAYMENT':
        await db.addWorkerPaymentRecord({ id: action.payload.payment.id, worker_type: action.payload.workerType, worker_id: action.payload.workerId, month: action.payload.payment.month, base_salary: action.payload.payment.baseSalary, total_acomptes: action.payload.payment.totalAcomptes, total_absences: action.payload.payment.totalAbsences, bonus_decalage: action.payload.payment.bonusDecalage ?? 0, retenue_decalage: action.payload.payment.retenueDecalage ?? 0, net_salary: action.payload.payment.netSalary, payment_date: action.payload.payment.paymentDate, payment_mode: action.payload.payment.paymentMode, cheque_number: action.payload.payment.chequeNumber, notes: action.payload.payment.notes, is_paid: action.payload.payment.isPaid, paid_days: action.payload.payment.paidDays ?? null, paid_months: action.payload.payment.paidMonths ?? null, decalage_ids: action.payload.payment.decalageIds ?? null, prime_type: nz(action.payload.payment.primeType), prime_value: action.payload.payment.primeValue ?? null, prime_amount: action.payload.payment.primeAmount ?? null });
        break;
      case 'DELETE_WORKER_ACOMPTE': await db.deleteWorkerAcompte(action.payload.acompteId); break;
      case 'DELETE_WORKER_ABSENCE': await db.deleteWorkerAbsence(action.payload.absenceId); break;
      case 'DELETE_WORKER_PAYMENT': await db.deleteWorkerPaymentRecord(action.payload.paymentId); break;
      case 'MARK_PAYMENT_PAID': await db.markPaymentPaid(action.payload.paymentId); break;
      case 'ADD_SUPPLIER_APPOINTMENT':
        await db.addSupplierAppointment({ id: action.payload.appointment.id, supplier_id: action.payload.supplierId, purchase_id: nz(action.payload.appointment.purchaseId), date: action.payload.appointment.date, amount: action.payload.appointment.amount, notes: action.payload.appointment.notes, is_paid: action.payload.appointment.isPaid });
        break;
      case 'ADD_SUPPLIER_PAYMENT':
        await db.addSupplierDebtPayment({ id: action.payload.payment.id, supplier_id: action.payload.supplierId, purchase_id: nz(action.payload.payment.purchaseId), delivery_note_id: nz(action.payload.payment.deliveryNoteId), date: action.payload.payment.date, amount: action.payload.payment.amount, total_due: action.payload.payment.totalDue, rest: action.payload.payment.rest, payment_mode: action.payload.payment.paymentMode, cheque_number: action.payload.payment.chequeNumber, notes: action.payload.payment.notes });
        break;
      case 'ADD_CLIENT_APPOINTMENT':
        await db.addClientAppointment({ id: action.payload.appointment.id, client_id: action.payload.clientId, sale_id: nz(action.payload.appointment.saleId), date: action.payload.appointment.date, amount: action.payload.appointment.amount, notes: action.payload.appointment.notes, is_paid: action.payload.appointment.isPaid });
        break;
      case 'ADD_CLIENT_PAYMENT':
        await db.addClientTransaction({ id: action.payload.payment.id, client_id: action.payload.clientId, date: action.payload.payment.date, type: action.payload.payment.type, amount: action.payload.payment.amount, mode: action.payload.payment.mode, receipt_number: action.payload.payment.receiptNumber, receipt_photo_url: action.payload.payment.receiptPhoto, notes: action.payload.payment.notes });
        await applyClientPaymentToAccount(action.payload.clientId, action.payload.payment);
        break;
      case 'UPDATE_CLIENT_PAYMENT':
        await db.updateClientTransaction(action.payload.payment.id, { date: action.payload.payment.date, type: action.payload.payment.type, amount: action.payload.payment.amount, mode: action.payload.payment.mode, receipt_number: action.payload.payment.receiptNumber, receipt_photo_url: action.payload.payment.receiptPhoto, notes: action.payload.payment.notes });
        await applyClientPaymentDelta(action.payload.clientId, action.payload.payment.type, (action.payload.payment.amount || 0) - (action.payload.previousAmount || 0));
        break;
      case 'DELETE_CLIENT_PAYMENT': {
        // Le montant se lit sur le SERVEUR avant la suppression : l'état local
        // a déjà retiré la ligne quand cette fonction s'exécute.
        const { data: gone } = await supabase.from('client_transactions').select('type, amount').eq('id', action.payload.paymentId).maybeSingle();
        await db.deleteClientTransaction(action.payload.paymentId);
        if (gone) await applyClientPaymentDelta(action.payload.clientId, gone.type, -(+gone.amount || 0));
        break;
      }
      case 'UPDATE_PRODUCT_STOCK': {
        // maybeSingle() avoids 406 if product was concurrently deleted
        const { data } = await supabase.from('products').select('stock, buy_price, selling_price').eq('id', action.payload.productId).maybeSingle();
        if (data) await supabase.from('products').update({ stock: (+data.stock) + action.payload.quantity, buy_price: action.payload.buyPrice ?? data.buy_price, selling_price: action.payload.sellPrice ?? data.selling_price }).eq('id', action.payload.productId);
        break;
      }
      case 'ADD_DRIVER': await db.addDriver({ id: action.payload.id, name: action.payload.name, status: action.payload.status ?? 'Actif', phone: action.payload.phone ?? null, email: action.payload.email ?? null, address: action.payload.address ?? null }); break;
      case 'DELETE_DRIVER': await db.deleteDriver(action.payload); break;
      case 'LOG_ACTIVITY': await db.addActivityLog({ user_id: action.payload.userId, action: action.payload.action, details: action.payload.details }); break;
      default: break;
    }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const StateContext    = createContext<AppState | undefined>(undefined);
const DispatchContext = createContext<React.Dispatch<AppAction> | undefined>(undefined);

// ─── refetchEntityAfterAction ─────────────────────────────────────────────────
// After a failed write we call this to re-fetch the affected slice from
// Supabase and dispatch HYDRATE so the optimistic change is reverted.
// Also called after successful writes on tables with sub-records (brigades,
// shop sales, etc.) to keep related data consistent.

async function refetchEntityAfterAction(
  action: AppAction,
  dispatch: React.Dispatch<AppAction>
): Promise<void> {
  try {
    switch (action.type) {
      // ── Tanks ───────────────────────────────────────────────────────────
      case 'ADD_TANK': case 'UPDATE_TANK': case 'DELETE_TANK': case 'ADJUST_TANK_LEVELS': {
        const raw = await db.getTanks();
        dispatch({ type: 'HYDRATE', payload: { tanks: (raw as any[]).map(mapTank) } });
        break;
      }
      // ── Pumps ───────────────────────────────────────────────────────────
      case 'ADD_PUMP': case 'UPDATE_PUMP': case 'DELETE_PUMP': {
        const raw = await db.getPumps();
        dispatch({ type: 'HYDRATE', payload: { pumps: (raw as any[]).map(mapPump) } });
        break;
      }
      // ── Tracks ──────────────────────────────────────────────────────────
      case 'ADD_TRACK': case 'UPDATE_TRACK': case 'DELETE_TRACK': {
        const raw = await db.getTracks();
        dispatch({ type: 'HYDRATE', payload: { tracks: (raw as any[]).map(mapTrack) } });
        break;
      }
      // ── Pompistes ───────────────────────────────────────────────────────
      case 'ADD_POMPISTE': case 'UPDATE_POMPISTE': case 'DELETE_POMPISTE':
      case 'UPDATE_WORKER_PERMISSIONS': {
        const pompistes = await loadPompistesEnriched();
        dispatch({ type: 'HYDRATE', payload: { pompistes } });
        break;
      }
      case 'UPDATE_WORKER_ACOMPTE':
      case 'UPDATE_WORKER_ABSENCE':
      case 'ADD_WORKER_PAYMENT':
      case 'DELETE_WORKER_ACOMPTE':
      case 'DELETE_WORKER_ABSENCE':
      case 'DELETE_WORKER_PAYMENT':
      case 'MARK_PAYMENT_PAID': {
        const workerType = (action as any).payload?.workerType;
        if (workerType === 'pompiste') {
          const pompistes = await loadPompistesEnriched();
          dispatch({ type: 'HYDRATE', payload: { pompistes } });
        } else if (workerType === 'chef_brigade') {
          const brigadeChefs = await loadBrigadeChefsEnriched();
          dispatch({ type: 'HYDRATE', payload: { brigadeChefs } });
        } else if (workerType === 'gerant') {
          const gerants = await loadGerantsEnriched();
          dispatch({ type: 'HYDRATE', payload: { gerants } });
        } else if (workerType === 'magasin') {
          const magasinWorkers = await loadMagasinWorkersEnriched();
          dispatch({ type: 'HYDRATE', payload: { magasinWorkers } });
        }
        break;
      }
      // ── Brigade Chefs ────────────────────────────────────────────────────
      case 'ADD_BRIGADE_CHEF': case 'UPDATE_BRIGADE_CHEF': case 'DELETE_BRIGADE_CHEF': {
        const brigadeChefs = await loadBrigadeChefsEnriched();
        dispatch({ type: 'HYDRATE', payload: { brigadeChefs } });
        break;
      }
      // ── Gérants ──────────────────────────────────────────────────────────
      case 'ADD_GERANT': case 'UPDATE_GERANT': case 'DELETE_GERANT': {
        const gerants = await loadGerantsEnriched();
        dispatch({ type: 'HYDRATE', payload: { gerants } });
        break;
      }
      // ── Magasin workers ───────────────────────────────────────────────────
      case 'ADD_MAGASIN_WORKER': case 'UPDATE_MAGASIN_WORKER': case 'DELETE_MAGASIN_WORKER': {
        const magasinWorkers = await loadMagasinWorkersEnriched();
        dispatch({ type: 'HYDRATE', payload: { magasinWorkers } });
        break;
      }
      // ── Suppliers ─────────────────────────────────────────────────────────
      case 'ADD_SUPPLIER': case 'UPDATE_SUPPLIER': case 'DELETE_SUPPLIER':
      case 'ADD_SUPPLIER_PAYMENT': case 'ADD_SUPPLIER_APPOINTMENT': {
        dispatch({ type: 'HYDRATE', payload: { suppliers: await loadSuppliersEnriched() } });
        break;
      }
      // ── Clients ───────────────────────────────────────────────────────────
      case 'ADD_CLIENT': case 'UPDATE_CLIENT': case 'DELETE_CLIENT':
      case 'ADD_CLIENT_PAYMENT': case 'UPDATE_CLIENT_PAYMENT': case 'DELETE_CLIENT_PAYMENT':
      case 'ADD_CLIENT_APPOINTMENT': {
        // Tout l'historique, sans plafond : un règlement d'il y a deux ans reste
        // une ligne du compte du client (`loadClientsEnriched`).
        dispatch({ type: 'HYDRATE', payload: { clients: await loadClientsEnriched() } });
        break;
      }
      // ── Products / Brands ─────────────────────────────────────────────────
      case 'ADD_PRODUCT': case 'UPDATE_PRODUCT': case 'DELETE_PRODUCT': case 'UPDATE_PRODUCT_STOCK': {
        const raw = await db.getProducts();
        dispatch({ type: 'HYDRATE', payload: { products: (raw as any[]).map(mapProduct) } });
        break;
      }
      case 'ADD_BRAND': case 'UPDATE_BRAND': case 'DELETE_BRAND': {
        const raw = await db.getBrands();
        dispatch({ type: 'HYDRATE', payload: { productBrands: (raw as any[]).map(mapBrand) } });
        break;
      }
      // ── Brigades ──────────────────────────────────────────────────────────
      case 'ADD_BRIGADE': case 'UPDATE_BRIGADE': case 'DELETE_BRIGADE': case 'UPDATE_BRIGADE_STATUS': {
        const raw       = await db.getBrigades();
        const assignRaw = await supabase.from('brigade_pompiste_assignments').select('brigade_id, pompiste_id').then(r => r.data ?? []);
        const brigades  = (raw as any[]).map(b => {
          const m = mapBrigade(b);
          m.pompisteIds = (assignRaw as any[]).filter(a => a.brigade_id === b.id).map(a => a.pompiste_id);
          return m;
        });
        // Supprimer une brigade emporte ses lignes de trésorerie côté base
        // (`cleanBrigadeDependencies`) : les soldes doivent se relire dans le
        // même mouvement, sinon les comptes gardent à l'écran l'argent d'une
        // brigade qui n'existe plus.
        if (action.type === 'DELETE_BRIGADE') {
          const treasuryTransactions = ((await db.getTreasuryTransactions()) as any[]).map(mapTreasuryTx);
          const accounts = ((await db.getBankAccounts()) as any[]).map(mapBankAccount);
          dispatch({ type: 'HYDRATE', payload: {
            ...(await loadArmoireData()),
            brigades, treasuryTransactions,
            bankAccounts: accounts.map(b => ({ ...b, balance: bankBalanceOf(b, treasuryTransactions) })),
          } });
          break;
        }
        // Le stock des armoires a pu bouger avec la brigade : on le relit aussi.
        dispatch({ type: 'HYDRATE', payload: { brigades, ...(await loadArmoireData()) } });
        break;
      }
      // ── Fuel Sales ────────────────────────────────────────────────────────
      case 'ADD_FUEL_SALE': case 'UPDATE_FUEL_SALE': case 'DELETE_FUEL_SALE': {
        const data = await dbSelectAll<any>('fuel_sales');
        dispatch({ type: 'HYDRATE', payload: { fuelSales: (data as any[]).map(mapFuelSale) } });
        break;
      }
      // ── Shop Sales ────────────────────────────────────────────────────────
      case 'ADD_SHOP_SALE': case 'UPDATE_SHOP_SALE': case 'DELETE_SHOP_SALE': {
        dispatch({ type: 'HYDRATE', payload: { shopSales: await loadShopSalesEnriched() } });
        break;
      }
      // ── Delivery Notes ────────────────────────────────────────────────────
      case 'ADD_DELIVERY_NOTE': case 'UPDATE_DELIVERY_NOTE': case 'DELETE_DELIVERY_NOTE': {
        const raw          = await db.getDeliveryNotes();
        const photosData   = await supabase.from('delivery_note_photos').select('*').then(r => r.data ?? []);
        const paymentsData = await supabase.from('delivery_note_payments').select('*').then(r => r.data ?? []);
        const itemsData    = await supabase.from('delivery_note_items').select('*').then(r => r.data ?? []);
        const deliveryNotes = (raw as any[]).map(d => {
          const m = mapDeliveryNote(d);
          m.photos   = (photosData as any[]).filter(p => p.delivery_note_id === d.id).map(p => p.photo_url);
          m.items    = (itemsData as any[]).filter(i => i.delivery_note_id === d.id).map(mapDeliveryNoteItem);
          m.payments = (paymentsData as any[]).filter(p => p.delivery_note_id === d.id).map(p => ({ id: p.id, date: p.date, amount: +p.amount, mode: p.mode, receiptNumber: p.receipt_number, receiptPhoto: p.receipt_photo_url }));
          return m;
        });
        dispatch({ type: 'HYDRATE', payload: { deliveryNotes } });
        break;
      }
      // ── Fuel Invoices ─────────────────────────────────────────────────────
      case 'ADD_FUEL_INVOICE': case 'UPDATE_FUEL_INVOICE': case 'DELETE_FUEL_INVOICE': {
        const raw    = await supabase.from('fuel_invoices').select('*').order('created_at', { ascending: false }).limit(500).then(r => r.data ?? []);
        const blsRaw = await supabase.from('fuel_invoice_bls').select('*').then(r => r.data ?? []);
        const fuelInvoices = (raw as any[]).map(r => {
          const m = mapFuelInvoice(r);
          m.deliveryNoteIds = (blsRaw as any[]).filter(b => b.invoice_id === r.id).map(b => b.delivery_note_id);
          return m;
        });
        dispatch({ type: 'HYDRATE', payload: { fuelInvoices } });
        break;
      }
      // ── Fuel Receipts ─────────────────────────────────────────────────────
      case 'ADD_FUEL_RECEIPT': case 'UPDATE_FUEL_RECEIPT': case 'DELETE_FUEL_RECEIPT': {
        const raw     = await supabase.from('fuel_receipts').select('*').order('created_at', { ascending: false }).limit(500).then(r => r.data ?? []);
        const invsRaw = await supabase.from('fuel_receipt_invoices').select('*').then(r => r.data ?? []);
        const fuelReceipts = (raw as any[]).map(r => {
          const m = mapFuelReceipt(r);
          m.invoiceIds = (invsRaw as any[]).filter(b => b.receipt_id === r.id).map(b => b.invoice_id);
          return m;
        });
        dispatch({ type: 'HYDRATE', payload: { fuelReceipts } });
        break;
      }
      // ── Purchases ─────────────────────────────────────────────────────────
      case 'ADD_PURCHASE': case 'UPDATE_PURCHASE': case 'DELETE_PURCHASE': {
        const { data: purchasesData } = await supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(500);
        const { data: itemsData }    = await supabase.from('purchase_items').select('*');
        const { data: paymentsData } = await supabase.from('purchase_payments').select('*');
        if (purchasesData) {
          const purchases = buildPurchases(
            purchasesData as any[], (itemsData ?? []) as any[], (paymentsData ?? []) as any[]);
          dispatch({ type: 'HYDRATE', payload: { purchases } });
        }
        break;
      }
      // ── Expenses ──────────────────────────────────────────────────────────
      // ── Treasury ──────────────────────────────────────────────────────────
      case 'ADD_BANK_ACCOUNT': case 'UPDATE_BANK_ACCOUNT': case 'DELETE_BANK_ACCOUNT':
      case 'ADD_TREASURY_TX': case 'UPDATE_TREASURY_TX': case 'DELETE_TREASURY_TX': {
        const treasuryTransactions = ((await db.getTreasuryTransactions()) as any[]).map(mapTreasuryTx);
        const accounts = ((await db.getBankAccounts()) as any[]).map(mapBankAccount);
        dispatch({
          type: 'HYDRATE',
          payload: {
            treasuryTransactions,
            bankAccounts: accounts.map(b => ({ ...b, balance: bankBalanceOf(b, treasuryTransactions) })),
          },
        });
        break;
      }
      case 'ADD_EXPENSE': case 'UPDATE_EXPENSE': case 'DELETE_EXPENSE': {
        const raw = await db.getExpenses();
        dispatch({ type: 'HYDRATE', payload: { expenses: (raw as any[]).map(mapExpense) } });
        break;
      }
      // ── Inventories ───────────────────────────────────────────────────────
      case 'ADD_INVENTORY': case 'UPDATE_INVENTORY': case 'DELETE_INVENTORY': case 'SAVE_INVENTORY': {
        const raw = await db.getInventories();
        dispatch({ type: 'HYDRATE', payload: { inventories: (raw as any[]).map(mapInventory) } });
        break;
      }
      // ── Daily Reports ─────────────────────────────────────────────────────
      case 'ADD_DAILY_REPORT': {
        const raw = await db.getDailyReports();
        dispatch({ type: 'HYDRATE', payload: { dailyReports: (raw as any[]).map(mapDailyReport) } });
        break;
      }
      // ── Settings ──────────────────────────────────────────────────────────
      case 'SET_SETTINGS': {
        const raw = await db.getSettings();
        if (raw) dispatch({ type: 'HYDRATE', payload: { settings: mapSettings(raw) } });
        break;
      }
      // ── Armoires & transferts ─────────────────────────────────────────────
      case 'ADD_ARMOIRE': case 'UPDATE_ARMOIRE': case 'DELETE_ARMOIRE':
      case 'ADD_STOCK_TRANSFER': case 'UPDATE_STOCK_TRANSFER': case 'DELETE_STOCK_TRANSFER': {
        dispatch({ type: 'HYDRATE', payload: await loadArmoireData() });
        break;
      }
      default: break;
    }
  } catch (refetchErr) {
    console.error('[refetchEntityAfterAction] Refetch failed after error:', refetchErr);
  }
}

// ─── AppProvider ──────────────────────────────────────────────────────────────

interface AppProviderProps {
  children: ReactNode;
  /**
   * Remounts the store when the signed-in user changes (see App.tsx). React
   * strips `key` before props reach the component, so it is declared only
   * because this project has no @types/react to supply JSX.IntrinsicAttributes.
   */
  key?: string;
}

export const AppProvider = ({ children }: AppProviderProps) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Id of the user the store has been hydrated for. Doubles as the
  // double-invocation guard (StrictMode / Concurrent Mode) the old
  // `hydrationStarted` ref provided, while still allowing a genuine re-hydration
  // when a different user signs in.
  const hydratedForUser = useRef<string | null>(null);
  // Prevents concurrent re-hydrations (e.g. TOKEN_REFRESHED fires while initial
  // hydrate is still in progress).
  const isHydrating = useRef(false);

  // ── Auth session gate ──────────────────────────────────────────────────────
  // AppProvider also wraps the login screen (it supplies the station name and
  // logo), so hydration must not fire its ~40 table reads before anyone is
  // signed in: RLS returns nothing to an anonymous visitor anyway, and that
  // burst of requests only slowed the login down — and on a shared IP it helped
  // trip Supabase's rate limiter, which is what produced the 429 on
  // `/auth/v1/token`.
  //
  // It also means a login always hydrates, even when React keeps this provider
  // mounted across the login → app transition (both branches of App render an
  // <AppProvider> at the same position, so the instance is reused and a one-shot
  // guard would have left the store frozen on its logged-out contents).
  //
  // Seeded synchronously from localStorage so hydration starts on the first
  // frame instead of waiting on getSession(); every query still goes through
  // supabase-js, which renews the token and applies RLS before answering.
  // `null` = signed out.
  const [sessionUserId, setSessionUserId] = useState<string | null>(
    () => readPersistedSession()?.user?.id ?? null,
  );

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setSessionUserId(data.session?.user?.id ?? null); })
      .catch(() => { /* keep whatever the stored session said */ });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Same id → React bails out, so token refreshes never re-trigger a hydrate.
      if (alive) setSessionUserId(session?.user?.id ?? null);
    });

    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  // ── Initial hydration from Supabase (two-phase progressive loading) ────────
  useEffect(() => {
    let cancelled = false;
    let phase1Timeout: ReturnType<typeof setTimeout>;

    // Signed out: the login screen only needs the station branding.
    if (sessionUserId === null) {
      hydratedForUser.current = null;
      (async () => {
        try {
          const raw = await db.getSettings();
          if (!cancelled && raw) {
            dispatch({ type: 'HYDRATE', payload: { settings: mapSettings(raw) } });
          }
        } catch {
          /* branding is cosmetic — the login form works without it */
        } finally {
          if (!cancelled) dispatch({ type: 'SET_LOADING', payload: false });
        }
      })();
      return () => { cancelled = true; };
    }

    if (hydratedForUser.current === sessionUserId) return;
    hydratedForUser.current = sessionUserId;

    async function hydrate() {
      dispatch({ type: 'SET_LOADING', payload: true });

      // ── DB Connectivity diagnostic ───────────────────────────────────────
      // Try a tiny read on startup. If it fails (RLS, wrong credentials, network)
      // we surface a visible error instead of loading silently for 30 s.
      {
        const { error: connectErr } = await supabase
          .from('station_settings')
          .select('id')
          .limit(1);
        if (connectErr) {
          console.error('[DB] Connectivity check failed:', connectErr.message, connectErr);
          dispatch({
            type: 'ADD_TOAST',
            payload: {
              type: 'error',
              message:
                `⚠️ Connexion à la base de données échouée: ${connectErr.message}. ` +
                `Vérifiez vos politiques RLS Supabase et rechargez la page.`,
            },
          });
        } else {
          console.log('[DB] Connectivity check OK');
        }
      }

      // 15-second timeout guards Phase 1 only (Phase 2 uses safeQ per table)
      phase1Timeout = setTimeout(() => {
        if (!cancelled) {
          console.error('[hydrate] Phase 1 timeout: releasing loading spinner');
          dispatch({ type: 'SET_LOADING', payload: false });
          dispatch({
            type: 'ADD_TOAST',
            payload: { type: 'error', message: 'Délai de chargement dépassé. Certaines données peuvent être manquantes.' },
          });
        }
      }, 15000);

      try {
        // ── PHASE 1: Small/critical tables → unblock the UI ─────────────
        // We load only what is needed for the app shell and navigation to render.
        // Transactional tables (fuel_sales, shop_sales, purchases, …) are deferred
        // to Phase 2 so the first paint is not blocked by large-table scans.
        console.log('[hydrate] Phase 1 – critical tables…');

        const [
          tanksRaw, pumpsRaw, nozzlesRaw, tracksRaw, driversRaw,
          productsRaw, brandsRaw,
          pompistesRaw, chefsRaw, gerantsRaw, magasinRaw,
          clientsRaw, suppliersRaw,
          brigadesRaw, settingsRaw,
          brigadeAssignmentsRaw, chefAssignmentsRaw,
          permissionTemplatesRaw,
          bankAccountsRaw, treasuryRaw,
        ] = await Promise.all([
          db.getTanks(),
          db.getPumps(),
          db.getNozzles(),
          db.getTracks(),
          db.getDrivers(),
          db.getProducts(),
          db.getBrands(),
          db.getPompistes(),
          db.getBrigadeChefs(),
          db.getGerants(),
          db.getMagasinWorkers(),
          db.getClients(),
          db.getSuppliers(),
          db.getBrigades(),
          db.getSettings(),
          supabase.from('brigade_pompiste_assignments').select('brigade_id, pompiste_id').then(r => r.data ?? []),
          supabase.from('chef_pompiste_assignments').select('chef_id, pompiste_id').then(r => r.data ?? []),
          db.getPermissionTemplates().catch(() => []),
          db.getBankAccounts().catch(() => []),
          db.getTreasuryTransactions().catch(() => []),
        ]);

        if (cancelled) return;

        // Map Phase 1 data
        const tanks   = (tanksRaw  as any[]).map(mapTank);
        const pumps   = (pumpsRaw  as any[]).map(mapPump);
        const pumpNozzles = (nozzlesRaw as any[]).map(mapNozzle);
        const tracks  = (tracksRaw as any[]).map(mapTrack);
        const drivers = (driversRaw as any[]).map(mapDriver);

        const products = (productsRaw as any[]).map(mapProduct);
        const brands   = (brandsRaw   as any[]).map(mapBrand);

        // Workers without payroll sub-records (added in Phase 2)
        const pompistes = (pompistesRaw as any[]).map(mapPompiste);
        const brigadeChefs = (chefsRaw as any[]).map(c => {
          const m = mapBrigadeChef(c);
          m.pompisteIds = (chefAssignmentsRaw as any[]).filter(a => a.chef_id === c.id).map(a => a.pompiste_id);
          return m;
        });
        const gerants        = (gerantsRaw  as any[]).map(mapGerant);
        const magasinWorkers = (magasinRaw  as any[]).map(mapMagasinWorker);

        // Clients & suppliers without sub-records (added in Phase 2)
        const clients   = (clientsRaw   as any[]).map(mapClient);
        const suppliers = (suppliersRaw as any[]).map(mapSupplier);

        const brigades = (brigadesRaw as any[]).map(b => {
          const m = mapBrigade(b);
          m.pompisteIds = (brigadeAssignmentsRaw as any[]).filter(a => a.brigade_id === b.id).map(a => a.pompiste_id);
          return m;
        });

        const settings = settingsRaw ? mapSettings(settingsRaw) : emptySettings;
        const permissionTemplates = (permissionTemplatesRaw as any[]).map(mapPermissionTemplate);
        const treasuryTransactions = (treasuryRaw as any[]).map(mapTreasuryTx);
        // Bank balances are derived from the ledger so a card can never drift
        // from its own history.
        const bankAccounts = (bankAccountsRaw as any[])
          .map(mapBankAccount)
          .map(b => ({ ...b, balance: bankBalanceOf(b, treasuryTransactions) }));

        // Release loading spinner; app can render now
        clearTimeout(phase1Timeout);

        if (cancelled) return;

        dispatch({
          type: 'HYDRATE',
          payload: {
            tanks, pumps, pumpNozzles, tracks, drivers, products, productBrands: brands,
            pompistes, brigadeChefs, gerants, magasinWorkers,
            clients, suppliers, brigades, settings, permissionTemplates,
            bankAccounts, treasuryTransactions,
            // Transactional tables start empty; filled by Phase 2 momentarily
            fuelSales: [], shopSales: [], deliveryNotes: [], purchases: [],
            expenses: [], inventories: [], dailyReports: [],
          },
        });

        console.log('[hydrate] Phase 1 complete — UI unblocked');

        // ── PHASE 2: Large/transactional tables (background) ─────────────
        // Each fetch is wrapped in safeQ so a single failing table does not
        // abort the rest.  We also cap row counts on the biggest tables.
        if (cancelled) return;

        console.log('[hydrate] Phase 2 – transactional tables…');

        const safeQ = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
          try { return await fn(); }
          catch (err) {
            console.error(`[hydrate] Phase 2 – ${name} failed:`, err);
            return [] as unknown as T;
          }
        };

        const [
          fuelSalesRaw, shopSalesRaw, deliveryNotesRaw, purchasesRaw,
          expensesRaw, inventoriesRaw, dailyReportsRaw,
          acomptesRaw, absencesRaw, paymentRecordsRaw,
          dnPaymentsRaw, dnPhotosRaw,
          purchaseItemsRaw, purchasePaymentsRaw,
          shopItemsRaw,
          supplierApptRaw, supplierDebtRaw,
          clientApptRaw, clientTxRaw,
          dnItemsRaw,
          fuelInvoicesRaw, fuelInvoiceBlsRaw, fuelReceiptsRaw, fuelReceiptInvoicesRaw,
        ] = await Promise.all([
          // Large tables — capped at 500 most-recent rows
          safeQ('Fuel Sales', async () => {
            return dbSelectAll<any>('fuel_sales');
          }),
          safeQ('Shop Sales', async () => {
            return dbSelectAll<any>('shop_sales');
          }),
          safeQ('Delivery Notes', () => db.getDeliveryNotes()),
          safeQ('Purchases', async () => {
            const { data, error } = await supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(500);
            if (error) throw error; return data ?? [];
          }),
          safeQ('Expenses', () => db.getExpenses()),
          safeQ('Inventories', () => db.getInventories()),
          safeQ('Daily Reports', () => db.getDailyReports()),
          // Payroll sub-records (all workers combined)
          safeQ('Worker Acomptes', async () => {
            const { data, error } = await supabase.from('worker_acomptes').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Worker Absences', async () => {
            const { data, error } = await supabase.from('worker_absences').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Payment Records', async () => {
            const { data, error } = await supabase.from('worker_payment_records').select('*');
            if (error) throw error; return data ?? [];
          }),
          // Sub-records for delivery notes / purchases / shop sales
          safeQ('DN Payments', async () => {
            const { data, error } = await supabase.from('delivery_note_payments').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('DN Photos', async () => {
            const { data, error } = await supabase.from('delivery_note_photos').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Purchase Items', async () => {
            const { data, error } = await supabase.from('purchase_items').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Purchase Payments', async () => {
            const { data, error } = await supabase.from('purchase_payments').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Shop Sale Items', () => dbSelectAll<any>('shop_sale_items', { orderBy: 'sale_id', ascending: true })),
          // Client / Supplier sub-records
          safeQ('Supplier Appointments', async () => {
            const { data, error } = await supabase.from('supplier_appointments').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Supplier Debt Payments', async () => {
            const { data, error } = await supabase.from('supplier_debt_payments').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Client Appointments', () => dbSelectAll<any>('client_appointments')),
          safeQ('Client Transactions', () => dbSelectAll<any>('client_transactions')),
          safeQ('Delivery Note Items', async () => {
            const { data, error } = await supabase.from('delivery_note_items').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Fuel Invoices', async () => {
            const { data, error } = await supabase.from('fuel_invoices').select('*').order('created_at', { ascending: false }).limit(500);
            if (error) throw error; return data ?? [];
          }),
          safeQ('Fuel Invoice BLs', async () => {
            const { data, error } = await supabase.from('fuel_invoice_bls').select('*');
            if (error) throw error; return data ?? [];
          }),
          safeQ('Fuel Receipts', async () => {
            const { data, error } = await supabase.from('fuel_receipts').select('*').order('created_at', { ascending: false }).limit(500);
            if (error) throw error; return data ?? [];
          }),
          safeQ('Fuel Receipt Invoices', async () => {
            const { data, error } = await supabase.from('fuel_receipt_invoices').select('*');
            if (error) throw error; return data ?? [];
          }),
        ]);

        if (cancelled) return;

        // ── Map Phase 2 data ──────────────────────────────────────────────

        const fuelSales = (fuelSalesRaw as any[]).map(mapFuelSale);

        const shopSales = (shopSalesRaw as any[]).map(s => {
          const m = mapShopSale(s);
          m.items = (shopItemsRaw as any[]).filter(i => i.sale_id === s.id).map(i => ({ productId: i.product_id, productName: i.product_name, quantity: +i.quantity, price: +i.price, tva: +(i.tva ?? 0) }));
          return m;
        });

        const deliveryNotes = (deliveryNotesRaw as any[]).map(d => {
          const m = mapDeliveryNote(d);
          m.photos   = (dnPhotosRaw   as any[]).filter(p => p.delivery_note_id === d.id).map(p => p.photo_url);
          m.items    = (dnItemsRaw    as any[]).filter(i => i.delivery_note_id === d.id).map(mapDeliveryNoteItem);
          m.payments = (dnPaymentsRaw as any[]).filter(p => p.delivery_note_id === d.id).map(p => ({ id: p.id, date: p.date, amount: +p.amount, mode: p.mode, receiptNumber: p.receipt_number, receiptPhoto: p.receipt_photo_url }));
          return m;
        });

        const fuelInvoices = (fuelInvoicesRaw as any[]).map(r => {
          const m = mapFuelInvoice(r);
          m.deliveryNoteIds = (fuelInvoiceBlsRaw as any[]).filter(b => b.invoice_id === r.id).map(b => b.delivery_note_id);
          return m;
        });
        const fuelReceipts = (fuelReceiptsRaw as any[]).map(r => {
          const m = mapFuelReceipt(r);
          m.invoiceIds = (fuelReceiptInvoicesRaw as any[]).filter(b => b.receipt_id === r.id).map(b => b.invoice_id);
          return m;
        });

        const purchases = buildPurchases(
          purchasesRaw as any[], purchaseItemsRaw as any[], purchasePaymentsRaw as any[]);

        const expenses     = (expensesRaw     as any[]).map(mapExpense);
        const inventories  = (inventoriesRaw  as any[]).map(mapInventory);
        const dailyReports = (dailyReportsRaw as any[]).map(mapDailyReport);

        // Merge payroll sub-records into workers (reuses Phase 1 raw arrays)
        const decalageHistoryRaw = await supabase
          .from('pompiste_decalage_history')
          .select('*')
          .then(r => r.data ?? []);

        const pompistesWithPayroll = (pompistesRaw as any[]).map(p => {
          const m = mapPompiste(p);
          m.acomptes      = (acomptesRaw      as any[]).filter(a => a.worker_id === p.id && a.worker_type === 'pompiste').map(mapAcompte);
          m.absences      = (absencesRaw      as any[]).filter(a => a.worker_id === p.id && a.worker_type === 'pompiste').map(mapAbsence);
          m.paymentRecord = (paymentRecordsRaw as any[]).filter(r => r.worker_id === p.id && r.worker_type === 'pompiste').map(mapPaymentRecord);
          m.decalageHistory = (decalageHistoryRaw as any[])
            .filter(d => d.pompiste_id === p.id)
            .map(d => ({
              brigadeId: d.brigade_id,
              date: d.date,
              amount: +d.amount,
              type: d.type as 'BONUS' | 'RETENUE',
            }));
          return m;
        });

        const brigadeChefWithPayroll = (chefsRaw as any[]).map(c => {
          const m = mapBrigadeChef(c);
          m.pompisteIds   = (chefAssignmentsRaw  as any[]).filter(a => a.chef_id === c.id).map(a => a.pompiste_id);
          m.acomptes      = (acomptesRaw         as any[]).filter(a => a.worker_id === c.id && a.worker_type === 'chef_brigade').map(mapAcompte);
          m.absences      = (absencesRaw         as any[]).filter(a => a.worker_id === c.id && a.worker_type === 'chef_brigade').map(mapAbsence);
          m.paymentRecord = (paymentRecordsRaw   as any[]).filter(r => r.worker_id === c.id && r.worker_type === 'chef_brigade').map(mapPaymentRecord);
          return m;
        });

        const gerantsWithPayroll = (gerantsRaw as any[]).map(g => {
          const m = mapGerant(g);
          m.acomptes      = (acomptesRaw      as any[]).filter(a => a.worker_id === g.id && a.worker_type === 'gerant').map(mapAcompte);
          m.absences      = (absencesRaw      as any[]).filter(a => a.worker_id === g.id && a.worker_type === 'gerant').map(mapAbsence);
          m.paymentRecord = (paymentRecordsRaw as any[]).filter(r => r.worker_id === g.id && r.worker_type === 'gerant').map(mapPaymentRecord);
          return m;
        });

        const magasinWithPayroll = (magasinRaw as any[]).map(m2 => {
          const m = mapMagasinWorker(m2);
          m.acomptes      = (acomptesRaw      as any[]).filter(a => a.worker_id === m2.id && a.worker_type === 'magasin').map(mapAcompte);
          m.absences      = (absencesRaw      as any[]).filter(a => a.worker_id === m2.id && a.worker_type === 'magasin').map(mapAbsence);
          m.paymentRecord = (paymentRecordsRaw as any[]).filter(r => r.worker_id === m2.id && r.worker_type === 'magasin').map(mapPaymentRecord);
          return m;
        });

        // Merge supplier sub-records
        const suppliersWithSub = (suppliersRaw as any[]).map(s => {
          const m = mapSupplier(s);
          m.appointments = (supplierApptRaw as any[]).filter(a => a.supplier_id === s.id).map(a => ({ id: a.id, purchaseId: a.purchase_id, date: a.date, amount: +a.amount, notes: a.notes, isPaid: a.is_paid }));
          m.debtPayments = (supplierDebtRaw as any[]).filter(p => p.supplier_id === s.id).map(p => ({ id: p.id, purchaseId: p.purchase_id, deliveryNoteId: p.delivery_note_id, date: p.date, amount: +p.amount, totalDue: +p.total_due, rest: +p.rest, paymentMode: p.payment_mode, chequeNumber: p.cheque_number, notes: p.notes }));
          return m;
        });

        // Merge client sub-records
        const clientsWithSub = (clientsRaw as any[]).map(c => {
          const m = mapClient(c);
          m.appointments      = (clientApptRaw as any[]).filter(a => a.client_id === c.id).map(a => ({ id: a.id, saleId: a.sale_id, date: a.date, amount: +a.amount, notes: a.notes, isPaid: a.is_paid }));
          m.transactionHistory = (clientTxRaw as any[]).filter(t => t.client_id === c.id).map(t => ({ id: t.id, date: t.date, type: t.type, amount: +t.amount, mode: t.mode, receiptNumber: t.receipt_number, receiptPhoto: t.receipt_photo_url, notes: t.notes }));
          return m;
        });

        // Caisse TPE — TAG/TPE transactions
        const tpeRaw = await safeQ('TPE Transactions', async () => {
          const { data, error } = await supabase.from('tpe_transactions').select('*').order('date', { ascending: false });
          if (error) throw error; return data ?? [];
        });
        const tpeTransactions = (tpeRaw as any[]).map(mapTpeTransaction);

        // Brigade décalage alerts (admin dashboard)
        const alertsRaw = await safeQ('Brigade Décalage Alerts', async () => {
          const { data, error } = await supabase.from('brigade_decalage_alerts').select('*').order('created_at', { ascending: false }).limit(200);
          if (error) throw error; return data ?? [];
        });
        const brigadeDecalageAlerts = (alertsRaw as any[]).map(mapBrigadeDecalageAlert);

        // Brigade accountings (+ justifications) — required by the Fiche Journalière
        // (espèces reçues, TPE/Tags, décalages par pompiste) and the dashboards.
        const brigadeAccountings = await safeQ('Brigade Accountings', loadBrigadeAccountingsWithJustifications);

        // Armoires, leur stock, les transferts et les mouvements de brigade.
        // `loadArmoireData` ne lève jamais (table absente => listes vides).
        const armoireData = await loadArmoireData();

        if (cancelled) return;

        dispatch({
          type: 'HYDRATE',
          payload: {
            ...armoireData,
            fuelSales, shopSales, deliveryNotes, purchases,
            fuelInvoices, fuelReceipts,
            expenses, inventories, dailyReports,
            tpeTransactions,
            brigadeDecalageAlerts,
            brigadeAccountings,
            pompistes:       pompistesWithPayroll,
            brigadeChefs:    brigadeChefWithPayroll,
            gerants:         gerantsWithPayroll,
            magasinWorkers:  magasinWithPayroll,
            suppliers:       suppliersWithSub,
            clients:         clientsWithSub,
          },
        });

        console.log('[hydrate] Phase 2 complete — all data loaded');

      } catch (err) {
        clearTimeout(phase1Timeout);
        if (cancelled) return;
        console.error('[hydrate] Critical error in Phase 1:', err);
        dispatch({ type: 'SET_LOADING', payload: false });
        dispatch({
          type: 'ADD_TOAST',
          payload: {
            type: 'error',
            message: `Erreur de chargement: ${err instanceof Error ? err.message : 'Erreur inconnue'}. Rechargez la page.`,
          },
        });
      }
    }

    isHydrating.current = true;
    hydrate().finally(() => { isHydrating.current = false; });
    return () => {
      cancelled = true;
      clearTimeout(phase1Timeout);
    };
  }, [dispatch, sessionUserId]);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  // Wire up the existing subscribeTable() helper so DB changes DZDe by other
  // sessions (or directly in the Supabase dashboard) reflect in the app live.
  useEffect(() => {
    // Nothing to watch until someone is signed in — RLS would reject the joins
    // anyway, and opening the socket from the login screen only adds noise.
    if (!sessionUserId) return;

    // Map each table to a lightweight re-fetch that returns the new state slice
    type SliceFn = () => Promise<Partial<AppState>>;
    const tableMap: Record<string, SliceFn> = {
      tanks:   async () => ({ tanks:           ((await db.getTanks())        as any[]).map(mapTank) }),
      pumps:   async () => ({ pumps:           ((await db.getPumps())        as any[]).map(mapPump) }),
      pump_nozzles: async () => ({ pumpNozzles: ((await db.getNozzles())    as any[]).map(mapNozzle) }),
      tracks:  async () => ({ tracks:          ((await db.getTracks())       as any[]).map(mapTrack) }),
      products: async () => ({ products:       ((await db.getProducts())     as any[]).map(mapProduct) }),
      product_brands: async () => ({ productBrands: ((await db.getBrands()) as any[]).map(mapBrand) }),
      pompistes: async () => ({ pompistes:     await loadPompistesEnriched() }),
      brigade_chefs: async () => ({ brigadeChefs: await loadBrigadeChefsEnriched() }),
      gerants: async () => ({ gerants:         await loadGerantsEnriched() }),
      magasin_workers: async () => ({ magasinWorkers: await loadMagasinWorkersEnriched() }),
      // Rebuild WITH sub-records — voir `loadClientsEnriched`. Mapper la seule
      // ligne du client vidait son historique de règlements à chaque événement.
      suppliers: async () => ({ suppliers:     await loadSuppliersEnriched() }),
      clients:  async () => ({ clients:        await loadClientsEnriched() }),
      expenses: async () => ({ expenses:       ((await db.getExpenses())     as any[]).map(mapExpense) }),
      treasury_transactions: async () => {
        const treasuryTransactions = ((await db.getTreasuryTransactions()) as any[]).map(mapTreasuryTx);
        const raw = ((await db.getBankAccounts()) as any[]).map(mapBankAccount);
        return {
          treasuryTransactions,
          bankAccounts: raw.map(b => ({ ...b, balance: bankBalanceOf(b, treasuryTransactions) })),
        };
      },
      bank_accounts: async () => {
        const treasuryTransactions = ((await db.getTreasuryTransactions()) as any[]).map(mapTreasuryTx);
        const raw = ((await db.getBankAccounts()) as any[]).map(mapBankAccount);
        return {
          treasuryTransactions,
          bankAccounts: raw.map(b => ({ ...b, balance: bankBalanceOf(b, treasuryTransactions) })),
        };
      },
      brigades: async () => {
        const raw       = await db.getBrigades();
        const assignRaw = await supabase.from('brigade_pompiste_assignments').select('brigade_id, pompiste_id').then(r => r.data ?? []);
        const brigadeAccountings = await loadBrigadeAccountingsWithJustifications();
        return { brigades: (raw as any[]).map(b => { const m = mapBrigade(b); m.pompisteIds = (assignRaw as any[]).filter(a => a.brigade_id === b.id).map(a => a.pompiste_id); return m; }), brigadeAccountings };
      },
      fuel_sales: async () => {
        const data = await dbSelectAll<any>('fuel_sales');
        return { fuelSales: (data as any[]).map(mapFuelSale) };
      },
      // Idem : sans ses articles, une vente magasin ne dit plus ce qui a été pris.
      shop_sales: async () => ({ shopSales: await loadShopSalesEnriched() }),
      delivery_notes: async () => {
        // Rebuild WITH sub-records — a lossy refetch here would drop `items`,
        // and later edits/deletes would then roll back only the first cuve.
        const raw          = await db.getDeliveryNotes();
        const photosData   = await supabase.from('delivery_note_photos').select('*').then(r => r.data ?? []);
        const paymentsData = await supabase.from('delivery_note_payments').select('*').then(r => r.data ?? []);
        const itemsData    = await supabase.from('delivery_note_items').select('*').then(r => r.data ?? []);
        const deliveryNotes = (raw as any[]).map(d => {
          const m = mapDeliveryNote(d);
          m.photos   = (photosData as any[]).filter(p => p.delivery_note_id === d.id).map(p => p.photo_url);
          m.items    = (itemsData as any[]).filter(i => i.delivery_note_id === d.id).map(mapDeliveryNoteItem);
          m.payments = (paymentsData as any[]).filter(p => p.delivery_note_id === d.id).map(p => ({ id: p.id, date: p.date, amount: +p.amount, mode: p.mode, receiptNumber: p.receipt_number, receiptPhoto: p.receipt_photo_url }));
          return m;
        });
        return { deliveryNotes };
      },
      // Relue aussi par le repli « sans websocket » (voir POLLED_TABLES).
      armoire_stock: async () => loadArmoireData(),
      purchases: async () => {
        // Rebuild WITH sub-records — exactly like `delivery_notes` above. Mapping
        // the header alone dropped `items` and `payments` from EVERY achat as soon
        // as any realtime event fired, and a later edit or delete then rolled back
        // nothing at all on the cuves (the rollback reads `items`).
        // Every write path touches the `purchases` row itself, so this one
        // subscription is enough to cover item/payment changes too.
        const { data }        = await supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(500);
        const { data: items } = await supabase.from('purchase_items').select('*');
        const { data: pays }  = await supabase.from('purchase_payments').select('*');
        return { purchases: buildPurchases((data ?? []) as any[], (items ?? []) as any[], (pays ?? []) as any[]) };
      },
    };

    const unsubs: (() => void)[] = [];

    // Armoires : un enregistrement de brigade ou de transfert touche plusieurs
    // lignes d'un coup (une par produit). On regroupe la rafale en UNE relecture.
    let armoireTimer: ReturnType<typeof setTimeout> | null = null;
    const refetchArmoires = () => {
      if (armoireTimer) clearTimeout(armoireTimer);
      armoireTimer = setTimeout(async () => {
        armoireTimer = null;
        try { dispatch({ type: 'HYDRATE', payload: await loadArmoireData() }); }
        catch (err) { console.error('[realtime] Refetch failed for armoires:', err); }
      }, 700);
    };
    for (const table of ['armoires', 'armoire_stock', 'stock_transfers', 'stock_transfer_items', 'armoire_sales', 'armoire_purchases']) {
      unsubs.push(subscribeTable(table, refetchArmoires));
    }
    unsubs.push(() => { if (armoireTimer) clearTimeout(armoireTimer); });

    for (const [table, sliceFn] of Object.entries(tableMap)) {
      unsubs.push(
        subscribeTable(table, async () => {
          try {
            const payload = await sliceFn();
            dispatch({ type: 'HYDRATE', payload });
          } catch (err) {
            console.error(`[realtime] Refetch failed for ${table}:`, err);
          }
        })
      );
    }

    // ── Fallback when the websocket cannot be reached ────────────────────────
    // Some machines sit behind a resolver or firewall that blocks `wss://`
    // (net::ERR_NAME_NOT_RESOLVED, repeated for every reconnect attempt). Live
    // push is then impossible, but the app must not quietly serve stale data:
    // poll the volatile tables instead, and only while the tab is on screen.
    const POLLED_TABLES = [
      'tanks', 'products', 'fuel_sales', 'shop_sales', 'purchases',
      'expenses', 'treasury_transactions', 'brigades', 'clients', 'armoire_stock',
    ];
    const POLL_INTERVAL_MS = 60_000;
    const POLL_MIN_GAP_MS  = 20_000;
    const WARN_AFTER_MS    = 30_000;

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPollAt = 0;
    let pollInFlight = false;
    let warnedOffline = false;

    const refreshPolledTables = async () => {
      if (pollInFlight || document.visibilityState !== 'visible') return;
      pollInFlight = true;
      lastPollAt = Date.now();
      try {
        for (const table of POLLED_TABLES) {
          const sliceFn = tableMap[table];
          if (!sliceFn) continue;
          try {
            dispatch({ type: 'HYDRATE', payload: await sliceFn() });
          } catch (err) {
            console.warn(`[poll] Refresh failed for ${table}:`, err);
          }
        }
      } finally {
        pollInFlight = false;
      }
    };

    // Returning to the tab is when stale data is most obvious — refresh then too.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPollAt > POLL_MIN_GAP_MS) {
        refreshPolledTables();
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(refreshPolledTables, POLL_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibilityChange);
      refreshPolledTables();
    };

    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };

    const unwatchHealth = onRealtimeHealthChange((health: RealtimeHealth) => {
      if (health === 'offline') {
        startPolling();
        // Warn only if it stays down: a brief blip reconnects on its own and
        // does not deserve a message blaming the machine's network.
        if (!warnedOffline && !warnTimer) {
          warnTimer = setTimeout(() => {
            warnedOffline = true;
            warnTimer = null;
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                type: 'warning',
                message:
                  'Mise à jour en direct indisponible sur ce poste. ' +
                  'Les données sont actualisées automatiquement chaque minute.',
              },
            });
          }, WARN_AFTER_MS);
        }
      } else if (health === 'online') {
        if (warnTimer) { clearTimeout(warnTimer); warnTimer = null; }
        stopPolling();
      }
    });

    return () => {
      unsubs.forEach(u => u());
      unwatchHealth();
      stopPolling();
      if (warnTimer) clearTimeout(warnTimer);
    };
  }, [dispatch, sessionUserId]);

  // NOTE: We deliberately do NOT re-hydrate on the Supabase 'TOKEN_REFRESHED'
  // event. That event fires whenever the JWT is silently renewed — including
  // every time the user switches back to this tab after it was in the
  // background — and re-fetching all critical tables there made the whole UI
  // appear to "auto-refresh" itself each time the app regained focus. Data
  // should only be reloaded on an explicit user action (e.g. a page reload),
  // not implicitly from a token renewal.

  // ── Synced dispatch: optimistic update + Supabase write ───────────────────
  //
  // On write failure: show an error toast AND re-fetch the affected entity
  // from the DB to revert the optimistic change, so the UI reflects reality.
  const syncedDispatch = useCallback((action: AppAction): void => {
    dispatch(action); // optimistic update first — UI stays snappy

    syncToSupabase(action).then(async () => {
      // Le niveau des cuves est le seul chiffre que le SERVEUR calcule et non le
      // client : `adjust_tank_level` fait `current = current + delta` sur la
      // ligne verrouillée. L'optimisme local part, lui, de l'état du navigateur —
      // périmé dès qu'un autre poste a livré ou clôturé une brigade entre-temps,
      // et borné différemment (la RPC plafonne à 0). On relit donc les cuves
      // juste après l'écriture : l'écran Cuves affiche alors ce que la base
      // contient VRAIMENT, sans attendre un rechargement de l'application.
      if (action.type === 'ADJUST_TANK_LEVELS') {
        await refetchEntityAfterAction(action, dispatch);
      }
    }).catch(async (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[syncedDispatch] DB write failed:', (action as any).type, errMsg);

      // Notify the user with an actionable error toast
      dispatch({
        type: 'ADD_TOAST',
        payload: {
          type: 'error',
          message: `Erreur de sauvegarde (${(action as any).type}): ${errMsg}`,
        },
      });

      // Revert the optimistic change by re-fetching from the database
      await refetchEntityAfterAction(action, dispatch);
    });
  }, [dispatch]);

  // Noms des magasins + second magasin actif : appliqués AVANT le rendu des
  // écrans, pour que chaque libellé (barre latérale, caisses, rapports) les lise.
  useMemo(
    () => syncMagasinLabels(state.settings),
    [state.settings.magasin1Name, state.settings.magasin2Name, state.settings.magasin2Enabled],
  );

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={syncedDispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
};

// ─── Context hooks ─────────────────────────────────────────────────────────────

export const useAppState = () => {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
};

export const useAppDispatch = () => {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
  return ctx;
};

export const useRtl = () => {
  const { isRtl } = useAppState();
  const dispatch  = useAppDispatch();
  return { isRtl, toggleRtl: () => dispatch({ type: 'TOGGLE_RTL' }) };
};

// ─── useModulePermission: per-module action gating ───────────────────────────
const ALL_ALLOWED: UserPermission = {
  voir: true, creer: true, modifier: true, supprimer: true,
  imprimer: true, exporter: true, scanner: true, generer: true,
};
const NONE_ALLOWED: UserPermission = {
  voir: false, creer: false, modifier: false, supprimer: false,
  imprimer: false, exporter: false, scanner: false, generer: false,
};

/**
 * Returns the current user's permission flags for a module.
 * Admins always get full access. Workers get exactly what the admin granted
 * (missing module → everything false). Use this to show/hide action buttons:
 *
 *   const perm = useModulePermission('Cuves');
 *   {perm.creer && <button>Ajouter</button>}
 */
export function useModulePermission(moduleId: string): UserPermission {
  const { currentUserRole, currentUserPermissions } = useAppState();
  return useMemo(() => {
    if (currentUserRole === 'admin') return ALL_ALLOWED;
    return currentUserPermissions?.[moduleId] ?? NONE_ALLOWED;
  }, [currentUserRole, currentUserPermissions, moduleId]);
}

// ─── useBizPermission: per-interface gating inside a business part ────────────
export interface BizPermission {
  voir: boolean; creer: boolean; modifier: boolean; supprimer: boolean;
}
const BIZ_ALL: BizPermission  = { voir: true,  creer: true,  modifier: true,  supprimer: true };
const BIZ_NONE: BizPermission = { voir: false, creer: false, modifier: false, supprimer: false };

/**
 * Permission flags of the connected user for one interface of a business part
 * (Restaurant / Cafétéria / Magasin).
 *
 *   const perm = useBizPermission('restaurant', 'stock');
 *   {perm.creer && <button>Nouveau produit</button>}
 *
 * Admins (and the fuel-station roles, which never reach these pages) get full
 * access; a part employee gets exactly what the admin ticked in the employee's
 * Permissions modal — and only inside their own part.
 */
export function useBizPermission(moduleKey: string, interfaceId: string): BizPermission {
  const { currentUserRole, currentModuleWorker } = useAppState();
  return useMemo(() => {
    if (currentUserRole !== 'module_worker') return BIZ_ALL;
    if (!currentModuleWorker || currentModuleWorker.moduleKey !== moduleKey) return BIZ_NONE;
    const p = currentModuleWorker.permissions || {};
    const can = (a: string) => !!p[`${interfaceId}.${a}`];
    // Actions are meaningless without "voir" — the page is not reachable anyway.
    if (!can('voir')) return BIZ_NONE;
    return { voir: true, creer: can('creer'), modifier: can('modifier'), supprimer: can('supprimer') };
  }, [currentUserRole, currentModuleWorker, moduleKey, interfaceId]);
}

// ─── useSupabaseDispatch: alias for useAppDispatch (already synced) ───────────
/**
 * @deprecated Use useAppDispatch() — it already syncs to Supabase.
 * Kept for backward compatibility only.
 */
export function useSupabaseDispatch() {
  const dispatch = useAppDispatch();

  return useCallback(async (action: AppAction) => {
    // Always update local state first (optimistic)
    dispatch(action);

    // Persist to Supabase in background
    try {
      switch (action.type) {
        // ── Tanks ──────────────────────────────────────────────────────────
        case 'ADD_TANK':
          await db.addTank({ id: action.payload.id, name: action.payload.name, type: action.payload.type, capacity: action.payload.capacity, current: action.payload.current, degrees: action.payload.degrees, alert_threshold: action.payload.alertThreshold, notes: action.payload.notes, is_favorite: !!action.payload.isFavorite });
          break;
        case 'UPDATE_TANK':
          await db.updateTank(action.payload.id, { name: action.payload.name, type: action.payload.type, capacity: action.payload.capacity, current: action.payload.current, degrees: action.payload.degrees, alert_threshold: action.payload.alertThreshold, notes: action.payload.notes, is_favorite: !!action.payload.isFavorite });
          break;
        case 'DELETE_TANK':
          await db.deleteTank(action.payload);
          break;

        // ── Tracks ─────────────────────────────────────────────────────────
        case 'ADD_TRACK':
          await db.addTrack({ id: action.payload.id, name: action.payload.name });
          break;
        case 'UPDATE_TRACK':
          await db.updateTrack(action.payload.id, { name: action.payload.name, updated_at: new Date().toISOString() });
          break;
        case 'DELETE_TRACK':
          await db.deleteTrack(action.payload);
          break;

        // ── Pumps ──────────────────────────────────────────────────────────
        case 'ADD_PUMP':
          await db.addPump({ id: action.payload.id, number: action.payload.number, name: action.payload.name, tank_id: nz(action.payload.tankId), track_id: nz(action.payload.trackId), type: action.payload.type, last_index: action.payload.lastIndex, status: action.payload.status });
          break;
        case 'UPDATE_PUMP':
          await db.updatePump(action.payload.id, { number: action.payload.number, name: action.payload.name, tank_id: nz(action.payload.tankId), track_id: nz(action.payload.trackId), type: action.payload.type, last_index: action.payload.lastIndex, status: action.payload.status, current_brigade_start_index: action.payload.currentBrigadeStartIndex });
          break;
        case 'DELETE_PUMP':
          await db.deletePump(action.payload);
          break;

        // ── Suppliers ──────────────────────────────────────────────────────
        case 'ADD_SUPPLIER':
          await db.addSupplier({ id: action.payload.id, ref: action.payload.ref, name: action.payload.name, contact: action.payload.contact, phone: action.payload.phone, email: action.payload.email, address: action.payload.address, balance: action.payload.balance, total_purchases: action.payload.totalPurchases, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, type: action.payload.type });
          break;
        case 'UPDATE_SUPPLIER':
          await db.updateSupplier(action.payload.id, { ref: action.payload.ref, name: action.payload.name, contact: action.payload.contact, phone: action.payload.phone, email: action.payload.email, address: action.payload.address, balance: action.payload.balance, total_purchases: action.payload.totalPurchases, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, type: action.payload.type });
          break;
        case 'DELETE_SUPPLIER':
          await db.deleteSupplier(action.payload);
          break;

        // ── Clients ────────────────────────────────────────────────────────
        case 'ADD_CLIENT':
          await db.addClient({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, cin: action.payload.cin, email: action.payload.email, address: action.payload.address, contact_person: action.payload.contactPerson, balance: action.payload.balance, debt: action.payload.debt, credit_limit: action.payload.creditLimit, payment_delay: action.payload.paymentDelay, type: action.payload.type, payment_mode: action.payload.paymentMode, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, advance_balance: action.payload.advanceBalance ?? 0, opening_debt: action.payload.openingDebt ?? 0, opening_advance: action.payload.openingAdvance ?? 0, opening_date: nz(action.payload.openingDate), opening_notes: nz(action.payload.openingNotes) });
          break;
        case 'UPDATE_CLIENT':
          await db.updateClient(action.payload.id, { name: action.payload.name, phone: action.payload.phone, cin: action.payload.cin, email: action.payload.email, address: action.payload.address, contact_person: action.payload.contactPerson, balance: action.payload.balance, debt: action.payload.debt, credit_limit: action.payload.creditLimit, payment_delay: action.payload.paymentDelay, type: action.payload.type, payment_mode: action.payload.paymentMode, nif: action.payload.nif, nis: action.payload.nis, article: action.payload.article, rc: action.payload.rc, advance_balance: action.payload.advanceBalance ?? 0, opening_debt: action.payload.openingDebt ?? 0, opening_advance: action.payload.openingAdvance ?? 0, opening_date: nz(action.payload.openingDate), opening_notes: nz(action.payload.openingNotes) });
          break;
        case 'DELETE_CLIENT':
          await db.deleteClient(action.payload);
          break;

        // ── Products ───────────────────────────────────────────────────────
        case 'ADD_PRODUCT':
          await db.addProduct({ id: action.payload.id, ref: action.payload.ref, name: action.payload.name, category: action.payload.category, buy_price: action.payload.buyPrice, selling_price: action.payload.sellingPrice, stock: action.payload.stock, min_stock: action.payload.minStock, barcode: action.payload.barcode, image_url: action.payload.imageUrl || action.payload.image, unit: action.payload.unit, brand: action.payload.brand, brand_id: nz(action.payload.brandId), tva_rate: action.payload.tvaRate ?? 0 });
          break;
        case 'UPDATE_PRODUCT':
          await db.updateProduct(action.payload.id, { ref: action.payload.ref, name: action.payload.name, category: action.payload.category, buy_price: action.payload.buyPrice, selling_price: action.payload.sellingPrice, stock: action.payload.stock, min_stock: action.payload.minStock, barcode: action.payload.barcode, image_url: action.payload.imageUrl || action.payload.image, unit: action.payload.unit, brand: action.payload.brand, brand_id: nz(action.payload.brandId), tva_rate: action.payload.tvaRate ?? 0 });
          break;
        case 'DELETE_PRODUCT':
          await db.deleteProduct(action.payload);
          break;

        // ── Product Brands ─────────────────────────────────────────────────
        case 'ADD_BRAND':
          await db.addBrand({ id: action.payload.id, name: action.payload.name });
          break;
        case 'UPDATE_BRAND':
          await db.updateBrand(action.payload.id, { name: action.payload.name });
          break;
        case 'DELETE_BRAND':
          await db.deleteBrand(action.payload);
          break;

        // ── Pompistes ──────────────────────────────────────────────────────
        case 'ADD_POMPISTE':
          await db.addPompiste({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, track_id: nz(action.payload.trackId), chef_id: nz(action.payload.chefId), base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          break;
        case 'UPDATE_POMPISTE':
          await db.updatePompiste(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, track_id: nz(action.payload.trackId), chef_id: nz(action.payload.chefId), base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          break;
        case 'DELETE_POMPISTE':
          await db.deletePompiste(action.payload);
          break;

        // ── Brigade Chefs ──────────────────────────────────────────────────
        case 'ADD_BRIGADE_CHEF':
          await db.addBrigadeChef({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          if (action.payload.pompisteIds?.length) await supabase.from('chef_pompiste_assignments').insert(action.payload.pompisteIds.map(pid => ({ chef_id: action.payload.id, pompiste_id: pid })));
          break;
        case 'UPDATE_BRIGADE_CHEF':
          await db.updateBrigadeChef(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          if (action.payload.pompisteIds !== undefined) { await supabase.from('chef_pompiste_assignments').delete().eq('chef_id', action.payload.id); if (action.payload.pompisteIds.length) await supabase.from('chef_pompiste_assignments').insert(action.payload.pompisteIds.map(pid => ({ chef_id: action.payload.id, pompiste_id: pid }))); }
          break;
        case 'DELETE_BRIGADE_CHEF':
          await db.deleteBrigadeChef(action.payload);
          break;

        // ── Gérants ────────────────────────────────────────────────────────
        case 'ADD_GERANT':
          await db.addGerant({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          break;
        case 'UPDATE_GERANT':
          await db.updateGerant(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          break;
        case 'DELETE_GERANT':
          await db.deleteGerant(action.payload);
          break;

        // ── Magasin Workers ────────────────────────────────────────────────
        case 'ADD_MAGASIN_WORKER':
          await db.addMagasinWorker({ id: action.payload.id, name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          break;
        case 'UPDATE_MAGASIN_WORKER':
          await db.updateMagasinWorker(action.payload.id, { name: action.payload.name, phone: action.payload.phone, email: action.payload.email, cin: action.payload.cin, address: action.payload.address, photo_url: action.payload.photoUrl, status: action.payload.status, base_salary: action.payload.baseSalary, salary_type: nz((action.payload as any).salaryType), work_days: (action.payload as any).workDays ?? null, cnas_date: nz((action.payload as any).cnasDate), has_access: action.payload.hasAccess, username: action.payload.username, permissions: action.payload.permissions || {}, hire_date: nz(action.payload.hireDate) });
          break;
        case 'DELETE_MAGASIN_WORKER':
          await db.deleteMagasinWorker(action.payload);
          break;

        // ── Brigades ───────────────────────────────────────────────────────
        case 'ADD_BRIGADE': {
          const b = action.payload;
          await db.addBrigade({ id: b.id, date: b.date, shift: b.shift, chef_id: nz(b.chefId), status: b.status, start_timestamp: b.startTimestamp, end_timestamp: b.endTimestamp, start_time: b.startTime, end_time: b.endTime, start_datetime: nz(b.startDatetime), end_datetime: nz(b.endDatetime), is_active: b.isActive, notes: b.notes, start_indices: b.startIndices || {}, end_indices: b.endIndices || {}, start_tank_levels: b.startTankLevels || {}, end_tank_levels: b.endTankLevels || {}, pompiste_data: b.pompisteData || {} });
          // Insert pompiste assignments
          if (b.pompisteIds?.length) {
            await supabase.from('brigade_pompiste_assignments').insert(b.pompisteIds.map(pid => ({ brigade_id: b.id, pompiste_id: pid })));
          }
          break;
        }
        case 'UPDATE_BRIGADE': {
          const b = action.payload;
          await db.updateBrigade(b.id, { date: b.date, shift: b.shift, chef_id: nz(b.chefId), status: b.status, start_timestamp: b.startTimestamp, end_timestamp: b.endTimestamp, start_time: b.startTime, end_time: b.endTime, start_datetime: nz(b.startDatetime), end_datetime: nz(b.endDatetime), is_active: b.isActive, notes: b.notes, printed_at: b.printedAt, start_indices: b.startIndices || {}, end_indices: b.endIndices || {}, start_tank_levels: b.startTankLevels || {}, end_tank_levels: b.endTankLevels || {}, pompiste_data: b.pompisteData || {} });
          // Sync pompiste assignments
          if (b.pompisteIds) {
            await supabase.from('brigade_pompiste_assignments').delete().eq('brigade_id', b.id);
            if (b.pompisteIds.length) {
              await supabase.from('brigade_pompiste_assignments').insert(b.pompisteIds.map(pid => ({ brigade_id: b.id, pompiste_id: pid })));
            }
          }
          break;
        }
        case 'DELETE_BRIGADE':
          await cleanBrigadeDependencies(action.payload);
          await db.deleteBrigade(action.payload);
          break;
        case 'UPDATE_BRIGADE_STATUS':
          await db.updateBrigade(action.payload.brigadeId, { is_active: action.payload.isActive, status: action.payload.status });
          break;

        // ── Fuel Sales ─────────────────────────────────────────────────────
        case 'ADD_FUEL_SALE':
          await db.addFuelSale({ id: action.payload.id, date: action.payload.date, pump_id: action.payload.pumpId, liters: action.payload.liters, price_per_liter: action.payload.pricePerLiter, total: action.payload.total, payment_mode: action.payload.paymentMode, client_id: nz(action.payload.clientId), bon_number: action.payload.bonNumber, bon_photo_url: action.payload.bonPhotoUrl || action.payload.bonPhoto, pompiste_id: nz(action.payload.pompisteId), brigade_id: nz(action.payload.brigadeId) });
          break;
        case 'UPDATE_FUEL_SALE':
          await db.updateFuelSale(action.payload.id, { pump_id: action.payload.pumpId, liters: action.payload.liters, price_per_liter: action.payload.pricePerLiter, total: action.payload.total, payment_mode: action.payload.paymentMode, client_id: nz(action.payload.clientId), bon_number: action.payload.bonNumber, bon_photo_url: action.payload.bonPhotoUrl });
          break;
        case 'DELETE_FUEL_SALE':
          await db.deleteFuelSale(action.payload);
          break;

        // ── Shop Sales ─────────────────────────────────────────────────────
        case 'ADD_SHOP_SALE': {
          const s = action.payload;
          await db.addShopSale({ id: s.id, date: s.date, client_id: nz(s.clientId), seller_id: nz(s.sellerId), subtotal: s.subtotal, tva_amount: s.tvaAmount ?? 0, total: s.total, payment_mode: s.paymentMode, cheque_number: s.chequeNumber, bon_number: s.bonNumber, bon_photo_url: s.bonPhotoUrl, amount_paid: s.amountPaid ?? 0, rest: s.rest ?? 0, status: s.status, notes: s.notes });
          if (s.items?.length) {
            await db.addShopSaleItems(s.items.map(i => ({ sale_id: s.id, product_id: i.productId, product_name: i.productName, quantity: i.quantity, price: i.price, tva: i.tva ?? 0 })));
          }
          break;
        }
        case 'UPDATE_SHOP_SALE':
          await db.updateShopSale(action.payload.id, { subtotal: action.payload.subtotal, tva_amount: action.payload.tvaAmount, total: action.payload.total, payment_mode: action.payload.paymentMode, amount_paid: action.payload.amountPaid, rest: action.payload.rest, status: action.payload.status, notes: action.payload.notes, printed_at: action.payload.printedAt });
          break;
        case 'DELETE_SHOP_SALE':
          await db.deleteShopSale(action.payload);
          break;

        // ── Delivery Notes ─────────────────────────────────────────────────
        case 'ADD_DELIVERY_NOTE': {
          const d = action.payload;
          await db.addDeliveryNote({ id: d.id, date: d.date, supplier_id: nz(d.supplierId), tank_id: nz(d.tankId), liters: d.liters, price_per_liter: d.pricePerLiter, status: d.status, total: d.total, expiry_date: nz(d.expiryDate) });
          if (d.photos?.length) {
            for (const url of d.photos) {
              await db.addDeliveryNotePhoto({ delivery_note_id: d.id, photo_url: url });
            }
          }
          if (d.payments?.length) {
            for (const p of d.payments) {
              await db.addDeliveryNotePayment({ id: p.id, delivery_note_id: d.id, date: p.date, amount: p.amount, mode: p.mode, receipt_number: p.receiptNumber, receipt_photo_url: p.receiptPhoto });
            }
          }
          break;
        }
        case 'UPDATE_DELIVERY_NOTE':
          await db.updateDeliveryNote(action.payload.id, { date: action.payload.date, supplier_id: nz(action.payload.supplierId), tank_id: nz(action.payload.tankId), liters: action.payload.liters, price_per_liter: action.payload.pricePerLiter, status: action.payload.status, total: action.payload.total, expiry_date: nz(action.payload.expiryDate) });
          break;
        case 'DELETE_DELIVERY_NOTE':
          await db.deleteDeliveryNote(action.payload);
          break;

        // ── Purchases ──────────────────────────────────────────────────────
        case 'ADD_PURCHASE': {
          const p = action.payload;
          await db.addPurchase({ id: p.id, date: p.date, supplier_id: nz(p.supplierId), invoice_number: p.invoiceNumber, due_date: nz(p.dueDate), driver_id: nz(p.driverId), total: p.total, amount_paid: p.amountPaid, rest: p.rest, status: p.status, payment_mode: p.paymentMode, cheque_number: p.chequeNumber, linked_delivery_note_id: nz(p.linkedDeliveryNoteId), notes: p.notes, type: p.type, tva_rate: p.tvaRate ?? 0, tva_active: p.tvaActive ?? false, tank_id: nz(p.tankId), receipt_photo_url: p.receiptPhoto, bl_number: nz(p.blNumber), discount_type: nz(p.discountType), discount_value: p.discountValue ?? 0, discount_amount: p.discountAmount ?? 0, subtotal: p.subtotal ?? 0, tva_amount: p.tvaAmount ?? 0, appointment_active: p.appointmentActive ?? false, appointment_date: nz(p.appointmentDate), appointment_amount: p.appointmentAmount ?? null, appointment_notes: nz(p.appointmentNotes), appointment_paid: p.appointmentPaid ?? false, appointment_paid_at: nz(p.appointmentPaidAt) });
          if (p.items?.length) {
            await db.addPurchaseItems(p.items.map(i => ({ purchase_id: p.id, product_id: nz(i.productId), product_name: i.productName, quantity: i.quantity, buy_price: i.buyPrice, selling_price: i.sellingPrice, min_stock: i.minStock, unit: i.unit, total: i.total, tank_id: nz(i.tankId), tva_active: i.tvaActive ?? false, tva_rate: i.tvaRate ?? 0 })));
          }
          if (p.payments?.length) {
            for (const pay of p.payments) {
              await db.addPurchasePayment({ id: pay.id, purchase_id: p.id, date: pay.date, amount: pay.amount, mode: pay.mode, cheque_number: pay.chequeNumber, bordereau_number: nz(pay.bordereauNumber), account_id: nz(pay.accountId), notes: pay.notes });
            }
          }
          break;
        }
        case 'UPDATE_PURCHASE':
          {
            const p = action.payload;
            await db.updatePurchase(p.id, { date: p.date, supplier_id: nz(p.supplierId), invoice_number: p.invoiceNumber, total: p.total, amount_paid: p.amountPaid, rest: p.rest, status: p.status, payment_mode: p.paymentMode, cheque_number: p.chequeNumber, notes: p.notes, receipt_photo_url: p.receiptPhoto, bl_number: nz(p.blNumber), discount_type: nz(p.discountType), discount_value: p.discountValue ?? 0, discount_amount: p.discountAmount ?? 0, subtotal: p.subtotal ?? 0, tva_amount: p.tvaAmount ?? 0, tva_active: p.tvaActive ?? false, tva_rate: p.tvaRate ?? 0, appointment_active: p.appointmentActive ?? false, appointment_date: nz(p.appointmentDate), appointment_amount: p.appointmentAmount ?? null, appointment_notes: nz(p.appointmentNotes), appointment_paid: p.appointmentPaid ?? false, appointment_paid_at: nz(p.appointmentPaidAt) });
            // Lines and payment methods are rewritten wholesale: without this an
            // edit kept the ORIGINAL rows in Supabase, so any payment method or
            // cuve line added while editing disappeared on the next reload.
            await db.deletePurchaseItems(p.id);
            if (p.items?.length) await db.addPurchaseItems(p.items.map(i => ({ purchase_id: p.id, product_id: nz(i.productId), product_name: i.productName, quantity: i.quantity, buy_price: i.buyPrice, selling_price: i.sellingPrice, min_stock: i.minStock, unit: i.unit, total: i.total, tank_id: nz(i.tankId), tva_active: i.tvaActive ?? false, tva_rate: i.tvaRate ?? 0 })));
            await db.deletePurchasePayments(p.id);
            if (p.payments?.length) await db.addPurchasePayments(p.payments.map(pay => ({ id: pay.id, purchase_id: p.id, date: pay.date, amount: pay.amount, mode: pay.mode, cheque_number: pay.chequeNumber, bordereau_number: nz(pay.bordereauNumber), account_id: nz(pay.accountId), notes: pay.notes })));
          }
          break;
        case 'DELETE_PURCHASE':
          await db.deletePurchase(action.payload);
          break;

        // ── Expenses ───────────────────────────────────────────────────────
        case 'ADD_EXPENSE':
          await db.addExpense({ id: action.payload.id, date: action.payload.date, category: action.payload.category, amount: action.payload.amount, description: action.payload.description, payment_mode: action.payload.paymentMode, cheque_number: action.payload.chequeNumber, bordereau_number: nz(action.payload.bordereauNumber), account_id: nz(action.payload.accountId), part: expensePartOf(action.payload), paid_by: action.payload.paidBy, recipient: action.payload.recipient, status: action.payload.status, receipt_url: action.payload.receiptUrl || action.payload.receipt, created_by: nz(action.payload.createdBy), brigade_id: nz(action.payload.brigadeId), brigade_justification_id: nz(action.payload.brigadeJustificationId), pompiste_id: nz(action.payload.pompisteId) });
          break;
        case 'UPDATE_EXPENSE':
          await db.updateExpense(action.payload.id, { date: action.payload.date, category: action.payload.category, amount: action.payload.amount, description: action.payload.description, payment_mode: action.payload.paymentMode, cheque_number: action.payload.chequeNumber, bordereau_number: nz(action.payload.bordereauNumber), account_id: nz(action.payload.accountId), part: expensePartOf(action.payload), paid_by: action.payload.paidBy, recipient: action.payload.recipient, status: action.payload.status, receipt_url: action.payload.receiptUrl, brigade_id: nz(action.payload.brigadeId), brigade_justification_id: nz(action.payload.brigadeJustificationId), pompiste_id: nz(action.payload.pompisteId) });
          break;
        case 'DELETE_EXPENSE':
          await db.deleteExpense(action.payload);
          break;

        // ── Inventories ────────────────────────────────────────────────────
        case 'ADD_INVENTORY':
        case 'SAVE_INVENTORY':
          await db.addInventory({ id: action.payload.id, name: action.payload.name, description: action.payload.description, date: action.payload.date, user_name: action.payload.user, type: action.payload.type, status: action.payload.status, fuel_gaps: action.payload.fuelGaps, pump_index_gaps: action.payload.pumpIndexGaps || [], product_gaps: action.payload.productGaps, adjustment_reason: action.payload.adjustmentReason, adjusted_at: nz(action.payload.adjustedAt) });
          break;
        case 'UPDATE_INVENTORY':
          await db.updateInventory(action.payload.id, { name: action.payload.name, status: action.payload.status, fuel_gaps: action.payload.fuelGaps, pump_index_gaps: action.payload.pumpIndexGaps || [], product_gaps: action.payload.productGaps, adjustment_reason: action.payload.adjustmentReason, adjusted_at: nz(action.payload.adjustedAt) });
          break;
        case 'DELETE_INVENTORY':
          await db.deleteInventory(action.payload);
          break;

        // ── Daily Report ───────────────────────────────────────────────────
        case 'ADD_DAILY_REPORT':
          await db.addDailyReport({ id: action.payload.id, date: action.payload.date, fuel_revenue: action.payload.fuelRevenue, shop_revenue: action.payload.shopRevenue, total_expenses: action.payload.totalExpenses, cash_to_deposit: action.payload.cashToDeposit, tank_variations: action.payload.tankVariations, brigade_ids: action.payload.brigadeIds });
          break;

        // ── Settings ───────────────────────────────────────────────────────
        case 'SET_SETTINGS':
          await db.saveSettings({ name: action.payload.name, logo_url: action.payload.logoUrl || action.payload.logo, address: action.payload.address, phone: action.payload.phone, email: action.payload.email, fiscal_id: action.payload.fiscalId, rc: action.payload.rc, fuel_prices: action.payload.fuelPrices, conversion_tables: action.payload.conversionTables, product_categories: action.payload.productCategories, expense_categories: action.payload.expenseCategories, product_units: action.payload.productUnits || DEFAULT_PRODUCT_UNITS, decalage_positif_actif: action.payload.decalagePositifActif, decalage_negatif_actif: action.payload.decalageNegatifActif, decalage_positif_seuil: action.payload.decalagePositifSeuil ?? 0, decalage_negatif_seuil: action.payload.decalageNegatifSeuil ?? 0, magasin1_name: nz(action.payload.magasin1Name), magasin2_name: nz(action.payload.magasin2Name), magasin2_enabled: !!action.payload.magasin2Enabled });
          break;

        // ── Payroll sub-records ────────────────────────────────────────────
        case 'UPDATE_WORKER_ACOMPTE':
          await db.addWorkerAcompte({ id: action.payload.acompte.id, worker_type: action.payload.workerType, worker_id: action.payload.workerId, date: action.payload.acompte.date, amount: action.payload.acompte.amount, description: action.payload.acompte.description, is_paid: action.payload.acompte.isPaid, month_paid: action.payload.acompte.monthPaid });
          break;
        case 'UPDATE_WORKER_ABSENCE':
          await db.addWorkerAbsence({ id: action.payload.absence.id, worker_type: action.payload.workerType, worker_id: action.payload.workerId, date: action.payload.absence.date, cost: action.payload.absence.cost, description: action.payload.absence.description, is_paid: action.payload.absence.isPaid, month_paid: action.payload.absence.monthPaid });
          break;
        case 'ADD_WORKER_PAYMENT':
          await db.addWorkerPaymentRecord({ id: action.payload.payment.id, worker_type: action.payload.workerType, worker_id: action.payload.workerId, month: action.payload.payment.month, base_salary: action.payload.payment.baseSalary, total_acomptes: action.payload.payment.totalAcomptes, total_absences: action.payload.payment.totalAbsences, bonus_decalage: action.payload.payment.bonusDecalage ?? 0, retenue_decalage: action.payload.payment.retenueDecalage ?? 0, net_salary: action.payload.payment.netSalary, payment_date: action.payload.payment.paymentDate, payment_mode: action.payload.payment.paymentMode, cheque_number: action.payload.payment.chequeNumber, notes: action.payload.payment.notes, is_paid: action.payload.payment.isPaid, paid_days: action.payload.payment.paidDays ?? null, paid_months: action.payload.payment.paidMonths ?? null, decalage_ids: action.payload.payment.decalageIds ?? null, prime_type: nz(action.payload.payment.primeType), prime_value: action.payload.payment.primeValue ?? null, prime_amount: action.payload.payment.primeAmount ?? null });
          break;
        case 'DELETE_WORKER_ACOMPTE':
          await db.deleteWorkerAcompte(action.payload.acompteId);
          break;
        case 'DELETE_WORKER_ABSENCE':
          await db.deleteWorkerAbsence(action.payload.absenceId);
          break;
        case 'DELETE_WORKER_PAYMENT':
          await db.deleteWorkerPaymentRecord(action.payload.paymentId);
          break;
        case 'MARK_PAYMENT_PAID':
          await db.markPaymentPaid(action.payload.paymentId);
          break;

        // ── Supplier sub-records ───────────────────────────────────────────
        case 'ADD_SUPPLIER_APPOINTMENT':
          await db.addSupplierAppointment({ id: action.payload.appointment.id, supplier_id: action.payload.supplierId, purchase_id: nz(action.payload.appointment.purchaseId), date: action.payload.appointment.date, amount: action.payload.appointment.amount, notes: action.payload.appointment.notes, is_paid: action.payload.appointment.isPaid });
          break;
        case 'ADD_SUPPLIER_PAYMENT':
          await db.addSupplierDebtPayment({ id: action.payload.payment.id, supplier_id: action.payload.supplierId, purchase_id: nz(action.payload.payment.purchaseId), delivery_note_id: nz(action.payload.payment.deliveryNoteId), date: action.payload.payment.date, amount: action.payload.payment.amount, total_due: action.payload.payment.totalDue, rest: action.payload.payment.rest, payment_mode: action.payload.payment.paymentMode, cheque_number: action.payload.payment.chequeNumber, notes: action.payload.payment.notes });
          break;

        // ── Client sub-records ─────────────────────────────────────────────
        case 'ADD_CLIENT_APPOINTMENT':
          await db.addClientAppointment({ id: action.payload.appointment.id, client_id: action.payload.clientId, sale_id: nz(action.payload.appointment.saleId), date: action.payload.appointment.date, amount: action.payload.appointment.amount, notes: action.payload.appointment.notes, is_paid: action.payload.appointment.isPaid });
          break;
        case 'ADD_CLIENT_PAYMENT':
          await db.addClientTransaction({ id: action.payload.payment.id, client_id: action.payload.clientId, date: action.payload.payment.date, type: action.payload.payment.type, amount: action.payload.payment.amount, mode: action.payload.payment.mode, receipt_number: action.payload.payment.receiptNumber, receipt_photo_url: action.payload.payment.receiptPhoto, notes: action.payload.payment.notes });
          await applyClientPaymentToAccount(action.payload.clientId, action.payload.payment);
          break;
        case 'UPDATE_CLIENT_PAYMENT':
          await db.updateClientTransaction(action.payload.payment.id, { date: action.payload.payment.date, type: action.payload.payment.type, amount: action.payload.payment.amount, mode: action.payload.payment.mode, receipt_number: action.payload.payment.receiptNumber, receipt_photo_url: action.payload.payment.receiptPhoto, notes: action.payload.payment.notes });
          await applyClientPaymentDelta(action.payload.clientId, action.payload.payment.type, (action.payload.payment.amount || 0) - (action.payload.previousAmount || 0));
          break;
        case 'DELETE_CLIENT_PAYMENT': {
          const { data: goneTx } = await supabase.from('client_transactions').select('type, amount').eq('id', action.payload.paymentId).maybeSingle();
          await db.deleteClientTransaction(action.payload.paymentId);
          if (goneTx) await applyClientPaymentDelta(action.payload.clientId, goneTx.type, -(+goneTx.amount || 0));
          break;
        }

        // ── Product stock ──────────────────────────────────────────────────
        case 'UPDATE_PRODUCT_STOCK':
          // Stock is embedded in the products table; fetch current then update
          // maybeSingle() avoids 406 if product was concurrently deleted
          {
            const { data } = await supabase.from('products').select('stock, buy_price, selling_price').eq('id', action.payload.productId).maybeSingle();
            if (data) {
              await supabase.from('products').update({
                stock: (+data.stock) + action.payload.quantity,
                buy_price: action.payload.buyPrice ?? data.buy_price,
                selling_price: action.payload.sellPrice ?? data.selling_price,
              }).eq('id', action.payload.productId);
            }
          }
          break;

        // ── Drivers ────────────────────────────────────────────────────────
        case 'ADD_DRIVER':
          await db.addDriver({ id: action.payload.id, name: action.payload.name });
          break;
        case 'DELETE_DRIVER':
          await db.deleteDriver(action.payload);
          break;

        // ── Log Activity ───────────────────────────────────────────────────
        case 'LOG_ACTIVITY':
          await db.addActivityLog({ user_id: action.payload.userId, action: action.payload.action, details: action.payload.details });
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('Supabase sync error for action', action.type, err);
    }
  }, [dispatch]);
}
