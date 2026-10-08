/**
 * ─── Business Modules Configuration & Types ────────────────────────────────────
 * Self-contained data model for the commerce/production parts of the sidebar:
 * Restaurant, Cafétéria and Magasin (the Magasin point-de-vente &
 * ventes screens were folded into the Lavage part).
 *
 * These modules live on a dedicated store (`BizContext`, persisted as one JSON
 * row in Supabase), so they never touch the relational fuel-station tables.
 * Every generic page (`src/pages/modules/*`) is parameterised by a `ModuleKey`.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/**
 * `lavage`   = le PREMIER magasin (clé historique conservée pour ne jamais
 *              réécrire les données déjà enregistrées) ;
 * `magasin2` = le SECOND magasin, créé depuis Paramètres → Magasins. Il porte
 *              exactement les mêmes interfaces que le premier, avec son propre
 *              stock, ses propres ventes, sa propre caisse — tout est séparé.
 */
export type ModuleKey = 'restaurant' | 'cafeteria' | 'lavage' | 'magasin2';

/** Every part of the biz store, in sidebar order. */
export const MODULE_KEYS: ModuleKey[] = ['restaurant', 'cafeteria', 'lavage', 'magasin2'];

/** The parts that are a « Magasin » (shop): the first one and the second one. */
export const MAGASIN_KEYS: ModuleKey[] = ['lavage', 'magasin2'];

/** `true` for a magasin part (first or second). */
export const isMagasinKey = (key: string | undefined | null): key is ModuleKey =>
  key === 'lavage' || key === 'magasin2';

/** `true` for any known module key. */
export const isModuleKey = (key: string | undefined | null): key is ModuleKey =>
  !!key && (MODULE_KEYS as string[]).includes(key);

/** Keys that existed in older saved states and are migrated away on load. */
export type LegacyModuleKey = 'magasin';

// ─── Entity collections held per module ────────────────────────────────────────
export type BizCollection =
  | 'categories'
  | 'marques'
  | 'products'
  | 'purchases'
  | 'sales'
  | 'clients'
  | 'suppliers'
  | 'workers'
  | 'expenses'
  | 'caisse'
  | 'productions'
  | 'fiches'
  | 'comptoir'
  | 'destructions'
  | 'reparations'
  | 'sessions'
  | 'payRequests'
  | 'inventaires'
  | 'roles'
  | 'messageTemplates'
  | 'rappels'
  | 'tables'
  | 'tableOrders';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BizNamed { id: string; name: string }

export interface BizProduct {
  id: string;
  name: string;
  description?: string;
  barcode?: string;
  marqueId?: string;
  marqueName?: string;
  categoryId?: string;
  categoryName?: string;
  principalQty: number;   // stock principal (total reçu)
  currentQty: number;     // reste en stock
  minQty: number;         // seuil d'alerte
  purchasePrice: number;
  /**
   * Coût moyen pondéré du stock (CUMP), tenu à jour par les achats enregistrés
   * avec l'option « coût moyen » (voir `src/lib/bizAverageCost.ts`).
   *
   * Absent tant qu'aucun achat au coût moyen n'a touché le produit : tout le
   * catalogue existant vaut alors `purchasePrice`, comme avant.
   */
  averageCost?: number;
  /**
   * Dernier prix payé au fournisseur — conservé À PART du coût moyen, parce que
   * ce ne sont pas la même information : on peut acheter à 130 DA un stock qui
   * revient en moyenne à 110 DA.
   */
  lastPurchasePrice?: number;
  salePrice: number;
  unit?: string;
  hasExpiration?: boolean;
  expirationDate?: string;
  /** Sell fractions of one packaged unit (e.g. 1 L out of a 50 L drum). */
  sellByDetail?: boolean;
  /** How much the packaged unit holds, expressed in `detailUnit`. */
  detailCapacity?: number;
  /** Unit of the detail quantity: 'L' | 'ml' | 'kg' | 'g' | 'unité'… */
  detailUnit?: string;
  /** Price of ONE detail unit. Defaults to `salePrice / detailCapacity`. */
  detailSalePrice?: number;
  /** Image URL (stored in Supabase products bucket or base64 fallback). */
  imageUrl?: string;
  /**
   * Matière première : le produit sert à FABRIQUER (production, fiches
   * techniques, vidanges) et ne se vend jamais tel quel. Il reste dans la
   * Gestion de stock et dans les Achats, mais n'apparaît PAS au point de vente.
   */
  isRawMaterial?: boolean;
  /**
   * ─── LES RÉFÉRENCES DE LA PIÈCE ───────────────────────────────────────────
   * Une même pièce porte PLUSIEURS numéros : celui du constructeur (origine),
   * celui de l'équipementier qui la fabrique, celui du catalogue du fournisseur.
   * Le client, lui, arrive avec UN de ces numéros — rarement le vôtre. Les
   * garder tous sur la fiche, c'est retrouver la pièce quel que soit le numéro
   * annoncé, au lieu de fouiller le rayon.
   */
  refs?: BizProductRef[];
  /**
   * ─── LES VÉHICULES QUE LA PIÈCE ÉQUIPE ────────────────────────────────────
   * L'autre façon de chercher une pièce, et de loin la plus fréquente au
   * comptoir : par la voiture. « Clio 4, 2015, boîte automatique » doit rendre
   * les filtres, plaquettes et courroies qui lui vont, sans que le magasinier
   * ait à connaître une seule référence.
   */
  cars?: BizProductCar[];
  /**
   * ─── CONSIGNE : GESTION « VIDE / PLEIN » (bouteilles de gaz…) ─────────────
   * Le produit est un CONTENANT qui se vend plein et revient vide. Convention
   * appliquée PARTOUT (magasin, armoires, brigades) :
   *   • `currentQty` = nombre TOTAL de contenants détenus ;
   *   • `emptyQty`   = combien parmi eux sont VIDES ;
   *   • pleins       = total − vides.
   * Le total ne bouge donc pas quand une bouteille change d'état.
   */
  consigneActive?: boolean;
  /** Parmi les `currentQty` unités du magasin, combien sont VIDES. */
  emptyQty?: number;
  /** Prix payé pour REMPLIR une bouteille vide (achat « remplissage »). */
  fillPrice?: number;
  /** Prix payé pour acheter une bouteille VIDE (achat « bouteilles vides »). */
  emptyPrice?: number;
  createdAt: string;
}

/**
 * Nature d'un achat sur un produit consigné :
 *  • `REMPLISSAGE` — des bouteilles VIDES repartent PLEINES (total inchangé, −vides) ;
 *  • `VIDE`        — achat de contenants vides (le parc grandit : +total, +vides).
 */
export type ConsigneMode = 'VIDE' | 'REMPLISSAGE';

/** État d'un contenant transféré / manipulé (produit consigné). */
export type ConsigneState = 'VIDE' | 'PLEIN';

/** Le produit est-il géré en vide / plein ? */
export const isConsigneProduct = (p?: Pick<BizProduct, 'consigneActive'> | null): boolean => !!p?.consigneActive;

/** Répartition du stock MAGASIN d'un produit : total, vides, pleins. */
export function productStockSplit(p: Pick<BizProduct, 'currentQty' | 'emptyQty' | 'consigneActive'>) {
  const total = Number(p.currentQty) || 0;
  const empty = p.consigneActive ? (Number(p.emptyQty) || 0) : 0;
  return { total, empty, full: total - empty };
}

/**
 * Effet d'un ACHAT sur le stock d'un produit : variation du total et des vides.
 * Remplissage → les vides deviennent pleines ; bouteilles vides → +total, +vides ;
 * achat ordinaire → +total.
 */
export function consignePurchaseDelta(qty: number, mode?: ConsigneMode | null): { total: number; empty: number } {
  if (mode === 'REMPLISSAGE') return { total: 0, empty: -qty };
  if (mode === 'VIDE') return { total: qty, empty: qty };
  return { total: qty, empty: 0 };
}

/** Un produit ne s'affiche au point de vente que s'il n'est pas une matière première. */
export const isSellableProduct = (p: Pick<BizProduct, 'isRawMaterial'>) => !p.isRawMaterial;

// ─── Références & compatibilité véhicule d'un produit ──────────────────────────

/** Boîte de vitesses d'un véhicule compatible. Absente ⇒ les deux conviennent. */
export type BizGearbox = 'auto' | 'manuelle';

export const GEARBOX_LABEL: Record<BizGearbox, string> = {
  auto: 'Boîte automatique',
  manuelle: 'Boîte manuelle',
};

/** Un numéro sous lequel la pièce est connue. */
export interface BizProductRef {
  id: string;
  /** Le numéro lui-même — « 7701 478 261 », « W 75/3 ». */
  ref: string;
  /** Qui le publie : « Origine », « Renault », « Bosch », « Mann »… */
  brand?: string;
  /** Précision libre : « boîte de 4 », « jusqu'à 2016 »… */
  note?: string;
}

/** Un véhicule que la pièce équipe. */
export interface BizProductCar {
  id: string;
  /** Modèle — « Clio 4 », « Symbol », « Partner ». */
  name?: string;
  /** Constructeur — « Renault », « Peugeot ». */
  marque?: string;
  /** Année ou plage d'années, en texte libre : « 2015 », « 2012-2019 ». */
  year?: string;
  /** Vide ⇒ la pièce va sur les deux boîtes. */
  gearbox?: BizGearbox;
  /** Motorisation, finition, tout ce qui restreint la compatibilité. */
  description?: string;
}

/** « Bosch — 0 451 103 316 » : une référence telle qu'elle se lit. */
export function productRefLabel(r: BizProductRef | undefined | null): string {
  if (!r) return '';
  return [r.brand, r.ref].filter(Boolean).join(' — ');
}

/** « Renault Clio 4 • 2015 • Boîte automatique » — un véhicule compatible. */
export function productCarLabel(c: BizProductCar | undefined | null): string {
  if (!c) return '';
  const head = [c.marque, c.name].filter(Boolean).join(' ');
  return [head, c.year, c.gearbox ? GEARBOX_LABEL[c.gearbox] : ''].filter(Boolean).join(' • ');
}

/**
 * Un numéro tapé sans ses séparateurs. « 7701 478 261 » se note de six façons
 * selon le catalogue (espaces, points, tirets) et se tape presque toujours d'un
 * bloc : sans cette forme compacte, la référence enregistrée avec ses espaces
 * resterait introuvable.
 */
export const compactRef = (s: string): string => (s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/**
 * Les années couvertes par un millésime écrit comme dans un catalogue.
 *
 * POURQUOI CE DÉPLIAGE EXISTE
 * Une compatibilité se note « 2012-2019 » : c'est juste, et c'est illisible pour
 * une recherche. Le client, lui, annonce l'année de SA voiture — « une Clio 4 de
 * 2015 ». Sans déplier la plage, « clio 2015 » ne rendait RIEN alors que la
 * pièce était sur l'étagère, et le magasinier concluait qu'il ne l'avait pas.
 *
 * Une année seule reste elle-même. Une plage ouverte (« 2012- ») court jusqu'à
 * l'année en cours. Le dépliage est plafonné à 40 ans : au-delà, la saisie est
 * une faute de frappe, pas un millésime.
 */
export function expandYears(raw: string | undefined | null): string[] {
  const value = (raw || '').trim();
  if (!value) return [];

  const range = value.match(/^(\d{4})\s*[-–/à]\s*(\d{4})?$/);
  if (!range) return [value];

  const from = Number(range[1]);
  const to = range[2] ? Number(range[2]) : new Date().getFullYear();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 40) return [value];

  const out: string[] = [value];
  for (let y = from; y <= to; y++) out.push(String(y));
  return out;
}

/**
 * Tout ce sur quoi un produit doit pouvoir se retrouver : son nom, son
 * code-barres, TOUTES ses références (telles quelles ET compactées) et TOUS les
 * véhicules qu'il équipe.
 *
 * Une seule liste, partagée par la Gestion de stock, les Achats et le point de
 * vente — c'est ce qui garantit qu'une pièce trouvée sur un écran l'est aussi
 * sur les deux autres.
 */
export function productSearchFields(p: Partial<BizProduct> | undefined | null): string[] {
  if (!p) return [];
  const out: string[] = [p.name || '', p.barcode || '', p.marqueName || '', p.categoryName || ''];

  for (const r of p.refs || []) {
    if (!r) continue;
    out.push(r.ref || '', r.brand || '', r.note || '');
    const compact = compactRef(r.ref || '');
    if (compact && compact !== (r.ref || '').toLowerCase()) out.push(compact);
  }

  for (const c of p.cars || []) {
    if (!c) continue;
    out.push(c.marque || '', c.name || '', c.description || '');
    // « 2012-2019 » déplié année par année : le client annonce l'année de SA
    // voiture, pas la plage du catalogue.
    out.push(...expandYears(c.year));
    // Les deux orthographes de la boîte : on cherche « auto » comme
    // « automatique », et « manuelle » comme « manuel ».
    if (c.gearbox === 'auto') out.push('auto automatique');
    if (c.gearbox === 'manuelle') out.push('manuel manuelle');
  }

  return out.filter(Boolean);
}

/**
 * Quantité de stock ramenée au millième.
 *
 * Le point de vente vend À DÉCOUVERT : un produit à zéro, une fiche technique
 * dont il manque un ingrédient, une production déjà écoulée se vendent quand
 * même et font descendre la quantité en NÉGATIF — le manque se rattrape au
 * prochain achat (−5 en stock + 15 reçus = 10). Sans cet arrondi, les divisions
 * d'une fiche laisseraient des `-0.30000000000000004` dans la Gestion de stock.
 */
export const roundQty = (q: number): number => Math.round(q * 1000) / 1000;

/** Quantité affichée — le signe « − » d'un stock à découvert est conservé. */
export function formatQty(q: number): string {
  const r = roundQty(q);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Price of one detail unit of a product sold "au détail". */
export function detailPrice(p: Pick<BizProduct, 'salePrice' | 'detailCapacity' | 'detailSalePrice'>): number {
  if (p.detailSalePrice && p.detailSalePrice > 0) return p.detailSalePrice;
  const cap = Number(p.detailCapacity) || 0;
  return cap > 0 ? p.salePrice / cap : p.salePrice;
}

export interface BizLineItem {
  productId: string;
  productName: string;
  /** Quantity in packaged units — fractional when sold au détail. */
  qty: number;
  /** Unit price of the line: purchase price on an achat, sale price on a vente. */
  unitPrice: number;
  /**
   * Coût de revient d'UNE unité de `qty`, figé au moment de la vente — c'est lui
   * qui donne le vrai gain d'une ligne (vendue 30 DA, coûtée 12 DA → gain 18 DA).
   * Selon la provenance : prix d'achat du produit, coût unitaire d'une production
   * mise au comptoir, ou coût de revient d'une fiche technique vendue en direct.
   * Absent sur les anciennes ventes : le rapport le retrouve alors dans le stock,
   * le comptoir ou la fiche (voir `bizReporting.computeModuleReport`).
   */
  unitCost?: number;
  minQty?: number;
  hasExpiration?: boolean;
  expirationDate?: string;
  total?: number;
  /** Set when the line was sold au détail: quantity in `detailUnit`. */
  detailQty?: number;
  detailUnit?: string;
  // ── Purchase lines only ──────────────────────────────────────────────────
  // An achat is where a product's commercial settings are (re)decided, so the
  // line carries them and writes them back onto the product when it is saved.
  /** New sale price of one packaged unit. */
  salePrice?: number;
  /** Whether the product is sold au détail — mirrored from the product. */
  sellByDetail?: boolean;
  /** How much one packaged unit holds, in `detailUnit`. */
  detailCapacity?: number;
  /** New sale price of ONE detail unit (only when `sellByDetail`). */
  detailSalePrice?: number;
  // ── Coût moyen pondéré — photo du calcul, figée à la validation ────────────
  // Ces quatre champs ne sont écrits que par un achat enregistré avec l'option
  // « coût moyen ». Ils rendent la facture lisible pour toujours : rouvrir un
  // vieux bon montre les chiffres du JOUR de la réception, jamais un recalcul
  // avec le coût moyen d'aujourd'hui. Absents ⇒ ligne d'avant l'option.
  /** Stock du produit juste avant cette réception. */
  prevStockQty?: number;
  /** Coût moyen du produit juste avant cette réception. */
  prevAvgCost?: number;
  /** Stock du produit juste après cette réception. */
  resultStockQty?: number;
  /** Coût moyen du produit juste après cette réception. */
  resultAvgCost?: number;
  /**
   * Achat d'un produit CONSIGNÉ (bouteilles de gaz) :
   *  • `REMPLISSAGE` — des bouteilles VIDES du magasin repartent PLEINES
   *    (prix de remplissage ; le nombre total de bouteilles ne change pas) ;
   *  • `VIDE` — achat de bouteilles vides (prix bouteille vide ; +total, +vides).
   * Absent ⇒ achat ordinaire.
   */
  consigneMode?: ConsigneMode;
}

export interface BizPurchase {
  id: string;
  ref: string;
  supplierId?: string;
  supplierName: string;
  items: BizLineItem[];
  total: number;
  paid: number;
  rest: number;
  date: string;
  createdAt: string;
  createdBy?: string;
  /**
   * Cette facture a été enregistrée en coût moyen pondéré : ses lignes portent
   * la photo du calcul et elle a fait évoluer le CUMP des produits reçus.
   * Absent ou faux ⇒ achat classique, le prix d'achat du produit est simplement
   * remplacé par celui payé — le comportement historique de l'application.
   */
  useAverageCost?: boolean;
}

/**
 * Un versement DATÉ sur un document (vente ou intervention).
 *
 * `paid` ne disait que le cumul : impossible de savoir quand l'argent était
 * entré, donc impossible de sortir un relevé « du 1er au 31 » honnête. Chaque
 * encaissement laisse maintenant sa trace. Les documents antérieurs n'en ont
 * pas : le relevé les lit alors comme un versement unique à la date du
 * document, en le signalant (voir `lib/clientStatement.ts`).
 */
export interface BizDocPayment {
  id: string;
  /** Horodatage de l'encaissement. */
  date: string;
  amount: number;
  /** Espèces, chèque, TPE, virement… tel que choisi à la caisse. */
  mode?: string;
  /** Numéro de chèque, de bordereau ou de transaction. */
  reference?: string;
  notes?: string;
  /** Qui a encaissé. */
  by?: string;
}

export interface BizSale {
  id: string;
  ref: string;
  clientId?: string;
  clientName: string;   // "Client de passage" si non renseigné
  items: BizLineItem[];
  subtotal: number;
  /** Money actually taken off the subtotal — always in DA. */
  reduction: number;
  /** How the remise was expressed at the caisse: pourcentage ou montant fixe. */
  discountType?: BizDiscountType;
  /** The percentage (0-100) or the flat amount typed by the caissier. */
  discountValue?: number;
  total: number;
  paid: number;
  rest: number;
  date: string;
  status: 'payée' | 'crédit' | 'retournée' | 'échangée';
  createdBy?: string;
  /** Work session the sale was rung up in (POS requires an open session). */
  sessionId?: string;
  workerId?: string;
  workerName?: string;
  printedAt?: string;
  /** Set on a refund: the money handed back to the client. */
  refundedAmount?: number;
  refundedAt?: string;
  /** Motif du retour, saisi au moment de le valider. */
  returnReason?: string;
  /** Set on the replacement sale created by an exchange. */
  exchangeOfSaleId?: string;
  /** Set on the original sale once it has been exchanged. */
  exchangedIntoSaleId?: string;
  /** Difference settled at exchange time (>0 client pays, <0 station refunds). */
  exchangeDelta?: number;
  /** Les encaissements de cette facture, dans l'ordre où ils sont tombés. */
  payments?: BizDocPayment[];
}

/**
 * Une vente ANNULÉE — la marchandise n'est plus chez le client.
 *
 *  • `retournée` : le client a rendu les articles, ils sont revenus en stock (ou
 *    au comptoir) et il a été remboursé.
 *  • `échangée`  : les articles sont revenus et une vente de REMPLACEMENT a été
 *    créée ; c'est elle qui porte le panier, l'encaissement et le gain.
 *
 * Dans les deux cas la vente d'origine ne doit plus compter comme un chiffre
 * d'affaires ni générer le moindre gain : sans ce filtre, les rapports
 * facturaient une marchandise revenue en stock — elle était comptée deux fois
 * (une fois en vente, une fois en valeur de stock).
 */
export const isReversedSale = (s: Pick<BizSale, 'status'>): boolean =>
  s.status === 'retournée' || s.status === 'échangée';

/**
 * Argent réellement resté en caisse pour une vente :
 *  • vente normale   → ce que le client a payé ;
 *  • vente retournée → payé − remboursé (0 quand le remboursement est total,
 *    le reliquat quand la station a gardé des frais) ;
 *  • vente échangée  → 0, la vente de remplacement porte tout l'encaissement
 *    (y compris ce qui avait déjà été payé sur l'originale).
 */
export function netCashOfSale(s: BizSale): number {
  if (s.status === 'échangée') return 0;
  if (s.status === 'retournée') return (s.paid || 0) - (s.refundedAmount || 0);
  return s.paid || 0;
}

export interface BizContact {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  createdAt: string;
  /**
   * ─── L'OUVERTURE DU COMPTE ─────────────────────────────────────────────────
   * Ce que le client devait DÉJÀ, ou avait déjà versé, le jour où sa fiche a été
   * créée. Une cafétéria ou un lavage reprend des comptes plus vieux que le
   * logiciel : sans ces champs, il fallait inventer une fausse vente pour faire
   * apparaître une créance de reprise — et le chiffre d'affaires s'en trouvait
   * gonflé d'une marchandise jamais sortie.
   */
  openingDebt?: number;
  /** Premier versement d'avance, pour un compte prépayé. */
  openingAdvance?: number;
  /** Date de la reprise — la création de la fiche à défaut. */
  openingDate?: string;
  openingNotes?: string;
  /** Les règlements encaissés SUR la dette initiale, datés et par mode. */
  openingPayments?: BizDocPayment[];
  /**
   * ─── LES DÉPÔTS D'AVANCE ────────────────────────────────────────────────────
   * L'argent que le client verse EN PLUS de ce qu'il doit — le trop-perçu d'un
   * règlement, ou une avance déposée d'elle-même. Contrairement à
   * `openingAdvance` (une avance versée AVANT le logiciel, déjà encaissée hors du
   * tiroir), un dépôt d'avance est de l'argent qui entre AUJOURD'HUI : il gonfle
   * l'avance détenue par le client ET la caisse de la partie, exactement comme
   * une recharge d'avance au Carburant. Daté, par mode, pour qu'il apparaisse au
   * relevé au jour où il est tombé.
   */
  advancePayments?: BizDocPayment[];
  /**
   * ─── LE PARC DU CLIENT (Magasin) ───────────────────────────────
   * Un client de lavage revient avec SES voitures — souvent plusieurs (la
   * sienne, celle de son épouse, l'utilitaire de la société). Les saisir à
   * chaque passage faisait perdre l'historique du véhicule et obligeait à
   * retaper la plaque à chaque fois.
   *
   * Une fiche d'intervention peut toujours porter un véhicule saisi à la main :
   * ce champ ne remplace rien, il évite de retaper.
   */
  cars?: BizCar[];
}

export interface BizAcompte { id: string; date: string; amount: number; description?: string; paid: boolean }
export interface BizAbsence { id: string; date: string; cost: number; description?: string; paid: boolean }
export interface BizWorkerPayment {
  id: string;
  period: string;
  amount: number;
  date: string;
  description?: string;
  mode?: string;
  /** Percentage payroll: the works (vidanges/lavages) settled by this payment. */
  workIds?: string[];
  /** Sum of the settled works and the rate applied, for the payslip. */
  worksTotal?: number;
  percentage?: number;
  from?: string;
  to?: string;
  /** `jour` payroll: the worked days settled here (so they never reappear). */
  paidDays?: string[];
  /** `mois` payroll: the months settled here. */
  paidMonths?: string[];
  /** Bonus added on top of the computed net. */
  primeType?: 'percent' | 'amount';
  primeValue?: number;
  primeAmount?: number;
  // ── Décalages d'inventaire ────────────────────────────────────────────────
  /** Inventaires dont les manquants ont été constatés sur ce paiement. */
  inventaireIds?: string[];
  /** Somme des manquants de ces inventaires, au prix d'achat. */
  inventaireTotal?: number;
  /** Retenue réellement appliquée au salaire (0 = simplement constaté). */
  inventaireDeduction?: number;
  inventaireDeductionActive?: boolean;
  inventaireDeductionType?: 'percent' | 'amount';
  inventaireDeductionValue?: number;
}

/**
 * Speciality of an employee of the Magasin part. It decides which
 * employees are proposed on a « lavage » prestation and which on a
 * « vidange » one — `both` shows up on either.
 */
export type BizWorkerKind = 'lavage' | 'reparation' | 'both';

export const WORKER_KIND_META: Record<BizWorkerKind, { label: string; short: string }> = {
  lavage: { label: 'Employé lavage', short: 'Lavage' },
  reparation: { label: 'Employé vidange', short: 'Vidange' },
  both: { label: 'Lavage & vidange', short: 'Polyvalent' },
};

export interface BizWorker {
  id: string;
  /** Supabase auth user id — set once the login account is provisioned. */
  authUserId?: string;
  name: string;
  birthday?: string;
  cin?: string;
  phone?: string;
  roleName: string;
  /** Lavage part only: is this a lavage worker, a vidange worker, or both? */
  workerKind?: BizWorkerKind;
  paid: boolean;                 // reçoit un salaire ?
  /** `pourcentage` pays a share of every intervention the worker performed. */
  salaryType: 'jour' | 'mois' | 'pourcentage';
  salaryAmount: number;
  /** Share of each intervention total, in % — used when salaryType = 'pourcentage'. */
  percentage?: number;
  /**
   * Weekdays worked, indexed like `Date.getDay()` (0 = Sunday … 6 = Saturday).
   * Only meaningful when `salaryType = 'jour'`; the missing days are the repos.
   */
  workDays?: number[];
  /** Date the employee was declared to the CNAS (social security). */
  cnasDate?: string;
  hasAccount: boolean;
  email?: string;
  username?: string;
  password?: string;
  startDate: string;
  permissions: Record<string, boolean>;
  acomptes: BizAcompte[];
  absences: BizAbsence[];
  payments: BizWorkerPayment[];
  // ── Inventaires ───────────────────────────────────────────────────────────
  /**
   * L'employé répond des manquants constatés aux inventaires de sa partie.
   * Activé, son écran de paie liste les inventaires non réglés et permet d'en
   * retenir tout ou partie sur son salaire. Désactivé (le défaut), l'inventaire
   * ne le concerne pas du tout.
   */
  inventoryLiable?: boolean;
  /** Inventaires écartés à la main : ils ne lui sont plus proposés en paie. */
  dismissedInventaireIds?: string[];
  /** Dernière sélection d'inventaires enregistrée pour cet employé. */
  savedInventaireIds?: string[];
  createdAt: string;
}

export interface BizExpense {
  id: string;
  name: string;
  description?: string;
  amount: number;
  date: string;
  category?: string;
  /**
   * Le compte d'où l'argent est SORTI :
   *   • vide ou le coffre de la partie (`CAISSE_CAFETERIA`, `CAISSE_LAVAGE`) →
   *     payée en espèces, elle vide la caisse de CETTE partie ;
   *   • un `BankAccount.id` → payée par la banque : la caisse de la partie n'a
   *     pas bougé, c'est le compte bancaire qui est débité (une ligne
   *     `treasury_transactions` le porte, cf. `refType: 'biz_expense'`).
   */
  accountId?: string;
  /** Instrument de paiement — indépendant du compte débité. */
  paymentMode?: string;
  /** N° de chèque / bordereau quand la dépense sort d'un compte bancaire. */
  chequeNumber?: string;
}

/** `true` quand une dépense de partie a réellement vidé le tiroir. */
export const bizExpensePaidInCash = (e: Pick<BizExpense, 'accountId'>): boolean =>
  !e.accountId || e.accountId.startsWith('CAISSE');

export interface BizCaisseTx {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  date: string;
  description?: string;
  category?: string;
}

export interface BizIngredient {
  productId: string;
  productName: string;
  quantityUsed: number;
  unitCost: number;
  lineCost: number;
  unit?: string;
  sourceType?: 'stock' | 'fiche';
}

export interface BizFiche {
  id: string;
  name: string;
  categoryId?: string;
  categoryName?: string;
  description?: string;
  ingredients: BizIngredient[];
  sellByUnit?: boolean;
  sellUnit?: string;
  usableInProduction?: boolean;
  productUnit?: string;
  /**
   * Quick-sale fiche (e.g. "café au lait"): appears directly on the POS grid.
   * Selling one deducts the ingredients from stock on the spot — no production
   * run and no comptoir step in between.
   */
  directSale?: boolean;
  outputQuantity: number;
  unitPrice: number;
  totalCost: number;
  costPerUnit: number;
  totalValue: number;
  gainsPerUnit: number;
  totalGains: number;
  /** Image URL (stored in Supabase products bucket or base64 fallback). */
  imageUrl?: string;
  createdAt: string;
}

export interface BizProduction {
  id: string;
  name: string;
  categoryName?: string;
  ficheId?: string;
  date: string;
  createdBy?: string;
  ingredients: BizIngredient[];
  outputQuantity: number;
  expectedQuantity: number;
  sentToComptoir: number;
  unit?: string;
  unitPrice: number;
  totalCost: number;
  totalValue: number;
  costPerUnit: number;
  hasLoss: boolean;
  lossQuantity: number;
  lossValue: number;
  lossReason?: string;
}

export interface BizComptoirItem {
  id: string;
  productName: string;
  categoryName?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  purchasePrice: number;
  date: string;
  sourceProductionId?: string;
}

/**
 * Un produit retiré des stocks parce qu'il est perdu : périmé, cassé, volé…
 *
 * La destruction peut venir de DEUX endroits, et `source` dit lequel — c'est ce
 * qui permet de la récupérer au bon endroit et de n'afficher, sur chaque écran,
 * que son propre historique :
 *   • 'comptoir' (défaut historique) → un produit prêt à la vente au comptoir
 *   • 'stock'                        → un produit du catalogue (Gestion de stock)
 *
 * `unitPrice` est le coût unitaire retenu pour valoriser la perte : le PRIX
 * D'ACHAT côté stock (ce que le produit a réellement coûté), le prix du comptoir
 * côté comptoir. `value` = qty × unitPrice et alimente le résultat de la partie
 * (caisse et rapports).
 */
export interface BizDestruction {
  id: string;
  /** D'où vient le produit détruit. Absent = ancienne destruction du comptoir. */
  source?: 'stock' | 'comptoir';
  /** Produit du catalogue concerné, quand la destruction vient du stock. */
  productId?: string;
  productName: string;
  categoryName?: string;
  qty: number;
  unit?: string;
  /** Coût unitaire retenu pour valoriser la perte. */
  unitPrice: number;
  /**
   * Coût de revient réel d'une unité (prix d'achat / coût de production). Côté
   * comptoir, `unitPrice` est le prix de VENTE : sans ce champ, un produit
   * récupéré revenait au comptoir avec un coût égal à son prix de vente et son
   * gain tombait à zéro dans les rapports.
   */
  unitCost?: number;
  value: number;
  reason?: string;
  date: string;
  createdBy?: string;
  recovered?: boolean;
  /** Quand le produit a été remis en stock / au comptoir. */
  recoveredAt?: string;
  notes?: string;
}

// ─── POS work sessions (session de travail) ────────────────────────────────────
/**
 * A cashier must open a session before selling and closes it at the end of the
 * shift. The opening float (`openingCash`) is money the worker already had in
 * hand — it is NEVER counted in what they owe. The décalage compares the
 * theoretical takings (cash sales of the session) with the cash actually
 * declared at closing, minus the credit granted during the session.
 *
 * A session belongs to ONE employee: `workerId` (and `openedById` for a session
 * an admin opened on their own machine) is what makes it "mine". Two employees
 * can hold an open session at the same time — each one only ever sees, sells in
 * and closes their own (see `src/lib/bizSessions.ts`).
 */
export interface BizSession {
  id: string;
  ref: string;
  workerId?: string;
  workerName: string;
  /** Opening float — excluded from every theoretical/décalage computation. */
  openingCash: number;
  openedAt: string;
  closedAt?: string;
  /** Cash counted by the worker when closing. */
  closingCash?: number;
  status: 'open' | 'closed';
  notes?: string;
  /** Frozen at closing time so the history never drifts. */
  theoretical?: number;
  credit?: number;
  decalage?: number;
  /** Supabase auth user that opened the row — the DB checks ownership on it. */
  authUserId?: string;
  /** App id (module worker id, or admin user id) of whoever opened the session. */
  openedById?: string;
  openedByName?: string;
  /** Who actually clôtured it — an admin may close a forgotten session. */
  closedById?: string;
  closedByName?: string;
}

// ─── Encaissement requests raised by a lavage worker ───────────────────────────
/** A lavage worker tells the cashier/admin how much a client has to pay. */
export interface BizPayRequest {
  id: string;
  ref: string;
  clientName: string;
  car: BizCar;
  amount: number;
  description?: string;
  workerId?: string;
  workerName: string;
  status: 'pending' | 'collected' | 'canceled';
  createdAt: string;
  collectedAt?: string;
  collectedBy?: string;
}

export interface BizCar {
  /**
   * Identifiant de la voiture SUR LA FICHE DU CLIENT. Absent sur une voiture
   * simplement saisie à la main dans une intervention (client de passage, ou
   * véhicule qu'on ne rattache à personne) : ces deux cas doivent continuer de
   * fonctionner exactement comme avant.
   */
  id?: string;
  name?: string;
  marque?: string;
  color?: string;
  year?: string;
  /** Facultative : beaucoup de véhicules passent sans plaque lisible. */
  immatriculation?: string;
  description?: string;
  /**
   * Dernier kilométrage relevé, en km. Il vit sur la fiche du client et se
   * corrige à chaque passage : c'est le relevé du jour qui fait foi, jamais
   * celui d'il y a six mois.
   */
  kilometrage?: number;
  /** Date du relevé de kilométrage ci-dessus, `YYYY-MM-DD`. */
  kilometrageAt?: string;
  /**
   * ─── LE RAPPEL PROPRE À CE VÉHICULE ────────────────────────────────────────
   * Un délai de rappel PARTICULIER à cette voiture, en jours, qui l'emporte sur
   * le délai réglé pour toute la partie. Une berline qu'on lave chaque semaine
   * et un utilitaire qu'on ne revoit qu'au trimestre n'ont pas la même cadence :
   * ces champs laissent la régler VÉHICULE PAR VÉHICULE.
   *
   * Absent (`undefined`) ⇒ le véhicule suit le délai de la partie
   * (`rappelConfig`). `0` ⇒ ce véhicule ne reçoit PAS de rappel de cette nature.
   * Le lavage et la vidange se règlent séparément, comme au niveau de la
   * partie.
   */
  rappelLavageDays?: number;
  rappelReparationDays?: number;
  createdAt?: string;
}

/** Étiquette lisible d'un véhicule — « Clio • Renault • 12345-116-31 ». */
export function carLabel(c: BizCar | undefined | null): string {
  if (!c) return '';
  return [c.marque, c.name, c.immatriculation].filter(Boolean).join(' • ');
}

/** Description complète, telle qu'elle apparaît dans un message au client. */
export function carFullLabel(c: BizCar | undefined | null): string {
  if (!c) return '';
  return [c.marque, c.name, c.color, c.year, c.immatriculation].filter(Boolean).join(' • ');
}

/** Nature of an intervention: a single kind, or several kinds at once. */
export type BizRepKind = 'reparation' | 'lavage' | 'mixte';

/**
 * One line of work inside an intervention. A single visit can hold several of
 * them — e.g. a « Lavage complet » *and* a « Changement de plaquettes » — each
 * with its own price and its own employees, so the payroll of a
 * percentage-paid worker is computed on exactly what they did.
 */
export interface BizPrestation {
  id: string;
  kind: 'reparation' | 'lavage';
  /** Free-text designation, e.g. "Lavage complet intérieur/extérieur". */
  label: string;
  amount: number;
  /** Employees who performed THIS prestation (subset of `BizReparation.workers`). */
  workerIds: string[];
}

/** A remise granted on an intervention: a percentage or a flat amount. */
export type BizDiscountType = 'percent' | 'amount';

export interface BizReparation {
  id: string;
  ref: string;
  /** `mixte` when the intervention holds both lavage and vidange prestations. */
  kind: BizRepKind;
  clientId?: string;
  /** "Client de passage" when no client record was picked. */
  clientName: string;
  car: BizCar;
  /**
   * Total of the labour lines. Kept in sync with `prestations` (it is their sum)
   * so every older screen and report keeps working unchanged.
   */
  serviceTotal: number;
  /** Detail of the labour: one line per lavage / vidange performed. */
  prestations?: BizPrestation[];
  usedProducts: BizLineItem[];
  problem?: string;
  /** Prestations + produits, BEFORE the remise. */
  subtotal?: number;
  discountType?: BizDiscountType;
  /** The percentage (0-100) or the flat amount typed by the user. */
  discountValue?: number;
  /** Money actually taken off the subtotal — always in DA. */
  discountAmount?: number;
  /** Subtotal − remise. */
  total: number;
  paid: number;
  rest: number;
  status: 'pending' | 'finalized' | 'canceled';
  /**
   * Sortie du véhicule — la CLÔTURE de l'intervention, horodatée à la minute.
   * Elle tombe au moment où la fiche passe en « finalisé » : le travail est
   * fait, la voiture repart.
   */
  outDate?: string;
  /**
   * ─── LA VIE D'UNE FICHE SE LIT À LA MINUTE ────────────────────────────────
   * `date` est la PRISE EN CHARGE : l'instant où le véhicule est arrivé. Un
   * atelier en sort des dizaines par jour, et le jour seul ne dit plus rien —
   * ces quatre horodatages ISO complets disent, à la minute près, quand la
   * fiche est née, quand on l'a retouchée, et quand elle s'est refermée.
   */
  date: string;
  /** Dernière modification de la fiche (absente tant qu'elle n'a pas été rouverte). */
  updatedAt?: string;
  /** Passage en « finalisé » — la première fois seulement. */
  finalizedAt?: string;
  /** Passage en « annulé ». */
  canceledAt?: string;
  workers: string[];
  createdBy?: string;
  printedAt?: string;
  /** Payment already settled to the percentage-paid workers of this job. */
  payrollSettled?: boolean;
  /** Les encaissements de cette intervention, dans l'ordre où ils sont tombés. */
  payments?: BizDocPayment[];
}

/** Money actually deducted by a remise, clamped to the subtotal. */
export function discountOf(subtotal: number, type: BizDiscountType | undefined, value: number | undefined): number {
  const v = Number(value) || 0;
  if (v <= 0 || subtotal <= 0) return 0;
  const raw = type === 'percent' ? (subtotal * Math.min(v, 100)) / 100 : v;
  return Math.max(0, Math.min(subtotal, raw));
}

/**
 * Prestations of an intervention, rebuilt from the legacy single `serviceTotal`
 * when the record predates the multi-prestation form.
 */
export function prestationsOf(r: BizReparation): BizPrestation[] {
  if (r.prestations && r.prestations.length) return r.prestations;
  if (!r.serviceTotal) return [];
  return [{
    id: `${r.id}-legacy`,
    kind: r.kind === 'mixte' ? 'reparation' : r.kind,
    label: r.problem || (r.kind === 'lavage' ? 'Lavage' : 'Vidange'),
    amount: r.serviceTotal,
    workerIds: r.workers || [],
  }];
}

/** Share of one intervention owed to a percentage-paid worker.
 *  Prestation-level assignments narrow it down to what they actually did. */
export function workerShareOf(r: BizReparation, workerId: string, rate: number): number {
  if (rate <= 0) return 0;
  const lines = (r.prestations || []).filter(p => (p.workerIds || []).includes(workerId));
  // No per-line assignment (legacy record or products-only job) → whole total.
  if (!lines.length) return (r.total * rate) / 100;
  return (lines.reduce((s, p) => s + (Number(p.amount) || 0), 0) * rate) / 100;
}

// ─── Messages aux clients : modèles et rappels ─────────────────────────────────
/**
 * Un MODÈLE DE MESSAGE enregistré par la station. L'utilisateur en écrit un une
 * fois (« Bonjour {client}, votre {vehicule} est prête… »), le retrouve dans une
 * liste, et peut toujours le retoucher avant l'envoi : le modèle remplit le
 * champ, il ne le verrouille pas.
 *
 * Les jetons reconnus sont ceux de `MESSAGE_TOKENS` ci-dessous. Un jeton inconnu
 * est laissé tel quel plutôt que remplacé par du vide — mieux vaut voir
 * `{truc}` à la relecture que d'envoyer une phrase amputée.
 */
export interface BizMessageTemplate {
  id: string;
  name: string;
  body: string;
  /**
   * `lavage` / `reparation` : modèle proposé en premier pour un rappel de cette
   * nature. `libre` : modèle généraliste, toujours proposé.
   */
  usage?: 'lavage' | 'reparation' | 'libre';
  createdAt: string;
  createdBy?: string;
}

/** Les jetons qu'un modèle peut porter, et ce qu'ils valent à l'envoi. */
export const MESSAGE_TOKENS: { token: string; label: string }[] = [
  { token: '{client}',       label: 'Nom du client' },
  { token: '{vehicule}',     label: 'Marque, modèle et plaque du véhicule' },
  { token: '{marque}',       label: 'Marque du véhicule' },
  { token: '{modele}',       label: 'Modèle du véhicule' },
  { token: '{immatriculation}', label: "Plaque d'immatriculation" },
  { token: '{kilometrage}',  label: 'Dernier kilométrage relevé' },
  { token: '{derniere_visite}', label: 'Date du dernier passage' },
  { token: '{prestation}',   label: 'Nature du dernier passage (lavage / vidange)' },
  { token: '{station}',      label: 'Nom de la station' },
  { token: '{telephone}',    label: 'Téléphone de la station' },
];

/**
 * ─── LE SUIVI D'UN RAPPEL ──────────────────────────────────────────────────────
 *
 * Une alerte de rappel n'est PAS stockée : elle se DÉDUIT à chaque affichage des
 * interventions terminées et des délais réglés (voir `src/lib/rappels.ts`). La
 * stocker obligerait à la recalculer dès qu'un délai change, et une intervention
 * corrigée laisserait une alerte fantôme.
 *
 * Ce qui doit survivre, en revanche, c'est ce que l'utilisateur en a FAIT :
 * marquée lue, ou message parti. Cette collection ne porte que ça — une ligne
 * par alerte traitée, avec un identifiant DÉTERMINISTE
 * (`<intervention>:<nature>:<véhicule>`) pour que deux postes qui traitent la
 * même alerte n'en fassent pas deux lignes.
 */
export interface BizRappel {
  /** `${reparationId}:${kind}:${carKey}` — déterministe, jamais tiré au hasard. */
  id: string;
  reparationId: string;
  kind: 'lavage' | 'reparation';
  /** Identifiant (ou plaque) du véhicule concerné — vide si aucun. */
  carKey: string;
  clientId?: string;
  /** `read` = classée sans envoi. `sent` = un message est parti. */
  status: 'read' | 'sent';
  at: string;
  by?: string;
  /** Ligne du journal d'envoi correspondante, quand un message est parti. */
  messageId?: string;
}

/** Délais de rappel d'une partie — le lavage et la vidange sont indépendants. */
export interface BizRappelConfig {
  /** Rappeler un LAVAGE après ce nombre de jours. 0 ⇒ pas de rappel de lavage. */
  lavageDays: number;
  /** Rappeler une VIDANGE après ce nombre de jours. 0 ⇒ aucun rappel. */
  reparationDays: number;
  /** Coupe tous les rappels sans perdre les délais réglés. */
  enabled: boolean;
}

/** Réglage de départ : un lavage tous les mois, une révision tous les six mois. */
export const DEFAULT_RAPPEL_CONFIG: BizRappelConfig = {
  lavageDays: 30,
  reparationDays: 180,
  enabled: true,
};

// ─── Inventaire physique d'une partie ──────────────────────────────────────────
/**
 * Un inventaire, c'est la station qui va COMPTER ce qu'elle a réellement en
 * rayon, puis confronter ce comptage à ce que l'application annonce.
 *
 * Le cycle complet tient en quatre états :
 *   • `draft`     — le comptage est commencé et peut être repris plus tard ;
 *   • `completed` — le comptage est terminé et figé ;
 *   • `compared`  — la confrontation au stock de l'application a été faite et a
 *                   produit ses écarts (le « décalage » de chaque produit) ;
 *   • `corrected` — le stock de l'application a été aligné sur le comptage, une
 *                   sauvegarde des quantités d'avant ayant été prise.
 *
 * On ne repart JAMAIS en arrière tout seul : la correction n'écrase le stock
 * qu'après confirmation explicite, et la sauvegarde permet de revenir en arrière
 * si le comptage s'avérait faux.
 */
export type BizInventaireStatus = 'draft' | 'completed' | 'compared' | 'corrected';

export type BizBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

export const INVENTAIRE_STATUS_META: Record<BizInventaireStatus, { label: string; hint: string; tone: BizBadgeTone }> = {
  draft: { label: 'Brouillon', hint: 'Comptage en cours — reprenez-le quand vous voulez', tone: 'warning' },
  completed: { label: 'Terminé', hint: 'Comptage figé — lancez la comparaison', tone: 'info' },
  compared: { label: 'Comparé', hint: 'Écarts calculés — le stock n\'est pas encore corrigé', tone: 'primary' },
  corrected: { label: 'Stock corrigé', hint: 'Le stock de l\'application a été aligné sur le comptage', tone: 'success' },
};

/** Une ligne comptée : un produit et la quantité trouvée en rayon. */
export interface BizInventaireLine {
  productId: string;
  productName: string;
  barcode?: string;
  categoryId?: string;
  categoryName?: string;
  unit?: string;
  /** Quantité comptée, exprimée en unités principales (celles du stock). */
  countedQty: number;
  /** Produit vendu au détail : quantité comptée dans son unité de détail. */
  detailQty?: number;
  detailUnit?: string;
  detailCapacity?: number;
  sellByDetail?: boolean;
  /** Prix d'achat FIGÉ au moment du comptage — c'est lui qui valorise l'écart. */
  purchasePrice: number;
  salePrice: number;
  /** Stock annoncé par l'application quand la ligne a été saisie (indicatif). */
  systemQtyAtEntry?: number;
}

/** L'écart d'un produit entre ce qui a été compté et ce que l'application dit. */
export interface BizInventaireEcart {
  productId: string;
  productName: string;
  categoryName?: string;
  unit?: string;
  /** Quantité comptée en rayon. */
  countedQty: number;
  /** Quantité annoncée par l'application au moment de la comparaison. */
  systemQty: number;
  /** compté − application : négatif = marchandise manquante (perte). */
  ecart: number;
  purchasePrice: number;
  /** ecart × prix d'achat — négatif pour une perte, positif pour un surplus. */
  value: number;
  kind: 'perte' | 'gain' | 'exact';
}

/** Le rapport de comparaison d'un inventaire — figé au moment où il est lancé. */
export interface BizInventaireComparison {
  at: string;
  by?: string;
  lines: BizInventaireEcart[];
  /** Quantité totale manquante et ce qu'elle a coûté (valeurs POSITIVES). */
  lossQty: number;
  lossValue: number;
  /** Quantité et valeur trouvées en plus. */
  gainQty: number;
  gainValue: number;
  /** gainValue − lossValue : l'impact net de l'inventaire sur le patrimoine. */
  netValue: number;
  productsCounted: number;
  productsWithEcart: number;
}

/** Quantités d'un produit AVANT la correction — de quoi revenir en arrière. */
export interface BizInventaireBackupLine {
  productId: string;
  productName: string;
  currentQty: number;
  principalQty: number;
}

export interface BizInventaire {
  id: string;
  /** Nom généré à partir de la date : `invnt-01-01-2026`. */
  ref: string;
  /** Date de l'inventaire (jour du comptage), choisie par l'utilisateur. */
  date: string;
  status: BizInventaireStatus;
  lines: BizInventaireLine[];
  notes?: string;
  createdAt: string;
  createdBy?: string;
  /** Comptage figé (passage de `draft` à `completed`). */
  completedAt?: string;
  /** Rapport d'écarts — présent dès que la comparaison a été lancée. */
  comparison?: BizInventaireComparison;
  /** Correction du stock appliquée à partir des écarts. */
  correctedAt?: string;
  correctedBy?: string;
  /** Sauvegarde des quantités d'avant la correction. */
  backup?: { at: string; lines: BizInventaireBackupLine[] };
  /**
   * Imputer les pertes de cet inventaire aux employés de la partie.
   * `false` ⇒ l'inventaire n'apparaît plus dans l'écran de paie : c'est le
   * bouton « ne pas faire porter ce décalage aux employés ».
   */
  chargeWorkers?: boolean;
}

/** Nom d'un inventaire, dérivé de sa date : `invnt-01-01-2026`. */
export function inventaireRefFor(date: string): string {
  const d = new Date(date);
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `invnt-${p(safe.getDate())}-${p(safe.getMonth() + 1)}-${safe.getFullYear()}`;
}

/** Un inventaire compte-t-il dans les pertes ? (comparé ET imputable) */
export const inventaireCountsForWorkers = (inv: BizInventaire): boolean =>
  !!inv.comparison && inv.chargeWorkers !== false;

/** Coût des manquants d'un inventaire — 0 tant qu'il n'a pas été comparé. */
export const inventaireLossValue = (inv: BizInventaire): number => inv.comparison?.lossValue || 0;

export interface ModuleState {
  categories: BizNamed[];
  marques: BizNamed[];
  roles: BizNamed[];
  products: BizProduct[];
  purchases: BizPurchase[];
  sales: BizSale[];
  clients: BizContact[];
  suppliers: BizContact[];
  workers: BizWorker[];
  expenses: BizExpense[];
  caisse: BizCaisseTx[];
  productions: BizProduction[];
  fiches: BizFiche[];
  comptoir: BizComptoirItem[];
  destructions: BizDestruction[];
  reparations: BizReparation[];
  sessions: BizSession[];
  payRequests: BizPayRequest[];
  /** Inventaires physiques de la partie — comptage, écarts et correction. */
  inventaires: BizInventaire[];
  /** Modèles de messages enregistrés, réutilisables à l'envoi. */
  messageTemplates: BizMessageTemplate[];
  /** Alertes de rappel DÉJÀ traitées (lues ou envoyées) — voir `BizRappel`. */
  rappels: BizRappel[];
  /** Gestion des tables (Restaurant / Cafétéria) : les tables de la salle. */
  tables?: BizTable[];
  /** Commandes passées à une table : en attente, encaissées ou annulées. */
  tableOrders?: BizTableOrder[];
  /**
   * Order of the "accès rapide" tiles of the point de vente: the products that
   * sell the most, pinned by the user so they open the grid. Each entry is a
   * `posPinKey` — the comptoir keys are name-based because a production run
   * creates a new row every time.
   */
  posPinned: string[];
  /**
   * Option « coût moyen pondéré » de la partie : quand elle est active, le
   * formulaire d'achat arrive avec la case cochée et les réceptions mettent à
   * jour le CUMP des produits (voir `src/lib/bizAverageCost.ts`).
   *
   * Absente ⇒ désactivée : rien ne change par rapport au comportement
   * historique. Le réglage n'est qu'une valeur par défaut — chaque achat garde
   * la trace de ce qu'il a RÉELLEMENT fait dans `BizPurchase.useAverageCost`.
   */
  avgCostEnabled?: boolean;
  /**
   * Délais de rappel de la partie (lavage et vidange, séparément). Absent ⇒
   * `DEFAULT_RAPPEL_CONFIG`. C'est un réglage SCALAIRE : il n'a pas d'id, donc
   * il se départage sur son propre horodatage (`rappelConfigUpd` dans
   * `bizSync.ts`), sinon la copie du serveur l'écrase au prochain démarrage.
   */
  rappelConfig?: BizRappelConfig;
}

/**
 * Stable key of a POS tile, used by the "accès rapide" ordering.
 * Products and fiches keep their id; a comptoir line is keyed by its product
 * name so the pin survives the next production run.
 */
export function posPinKey(kind: 'comptoir' | 'product' | 'fiche', idOrName: string): string {
  return `${kind}:${idOrName}`;
}

export type BizState = Record<ModuleKey, ModuleState>;

// ─── Module presentation config ────────────────────────────────────────────────

export interface ModuleConfig {
  key: ModuleKey;
  label: string;          // section label in sidebar
  short: string;          // short name used in subtitles
  emoji: string;
  base: string;           // route base, e.g. "/restaurant"
  productWord: string;    // "Plat", "Produit"…
  hasProduction: boolean; // production + comptoir + fiches
  hasComptoir: boolean;
  isService: boolean;     // magasin flow
}

export const MODULES: Record<ModuleKey, ModuleConfig> = {
  restaurant: {
    key: 'restaurant',
    label: 'Restaurant',
    short: 'Restaurant',
    emoji: '🍽️',
    base: '/restaurant',
    productWord: 'Plat',
    hasProduction: true,
    hasComptoir: true,
    isService: false,
  },
  cafeteria: {
    key: 'cafeteria',
    label: 'Cafétéria',
    short: 'Cafétéria',
    emoji: '☕',
    base: '/cafeteria',
    productWord: 'Produit',
    hasProduction: true,
    hasComptoir: true,
    isService: false,
  },
  lavage: {
    key: 'lavage',
    label: 'Magasin',
    short: 'Magasin',
    emoji: '🛒',
    base: '/magasin',
    productWord: 'Produit',
    hasProduction: false,
    hasComptoir: false,
    isService: false,
  },
  // Second magasin — mêmes interfaces que le premier, données séparées.
  magasin2: {
    key: 'magasin2',
    label: 'Magasin 2',
    short: 'Magasin 2',
    emoji: '🏬',
    base: '/magasin2',
    productWord: 'Produit',
    hasProduction: false,
    hasComptoir: false,
    isService: false,
  },
};

// ─── Magasins : noms choisis par l'utilisateur + second magasin actif ? ───────
/**
 * Réglages des magasins, posés depuis Paramètres → Magasins et lus au démarrage
 * (table `station_settings`). Les libellés de `MODULES` sont mis à jour sur
 * place : chaque écran qui lit `MODULES[key].label` affiche donc le nom choisi
 * sans rien changer d'autre.
 */
export interface MagasinSettings {
  magasin1Name?: string;
  magasin2Name?: string;
  magasin2Enabled?: boolean;
}

let magasin2Enabled = false;

/** Applique les noms des magasins et l'activation du second. Idempotent. */
export function applyMagasinSettings(s: MagasinSettings | null | undefined): void {
  const n1 = (s?.magasin1Name || '').trim() || 'Magasin';
  const n2 = (s?.magasin2Name || '').trim() || 'Magasin 2';
  MODULES.lavage.label = n1;
  MODULES.lavage.short = n1;
  MODULES.magasin2.label = n2;
  MODULES.magasin2.short = n2;
  magasin2Enabled = !!s?.magasin2Enabled;
}

/** Le second magasin a-t-il été créé ? */
export const isMagasin2Enabled = (): boolean => magasin2Enabled;

/** Les parties réellement utilisées : le second magasin n'y figure qu'une fois créé. */
export function activeModuleKeys(): ModuleKey[] {
  return MODULE_KEYS.filter(k => k !== 'magasin2' || magasin2Enabled);
}

/** Les magasins réellement utilisés (le premier, puis le second s'il existe). */
export function activeMagasinKeys(): ModuleKey[] {
  return MAGASIN_KEYS.filter(k => k !== 'magasin2' || magasin2Enabled);
}

// ─── Gestion des tables (Restaurant / Cafétéria) ──────────────────────────────

/** Les parties qui servent à table. */
export const hasTables = (key: ModuleKey): boolean => key === 'restaurant' || key === 'cafeteria';

export interface BizTable {
  id: string;
  name: string;
  /** Salle / zone : « Terrasse », « Salle 1 »… */
  zone?: string;
  /** Nombre de places. */
  seats?: number;
  notes?: string;
  /** Une table désactivée n'est plus proposée au point de vente. */
  inactive?: boolean;
  createdAt: string;
}

/** Une ligne d'une commande de table — le même contenu qu'une ligne de panier. */
export interface BizTableOrderLine {
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
  max: number;
  unit?: string;
  kind: 'comptoir' | 'product' | 'fiche';
  unitCost: number;
  detailCapacity?: number;
  detailUnit?: string;
  /** Note de cuisine (« sans oignon », « bien cuit »…). */
  note?: string;
}

export type BizTableOrderStatus = 'pending' | 'completed' | 'cancelled';

export interface BizTableOrderEvent {
  at: string;
  by: string;
  action: 'création' | 'modification' | 'impression' | 'transfert' | 'encaissement' | 'annulation' | 'réouverture';
  detail?: string;
}

export interface BizTableOrder {
  id: string;
  ref: string;
  tableId: string;
  tableName: string;
  status: BizTableOrderStatus;
  lines: BizTableOrderLine[];
  clientId?: string;
  clientName: string;
  /** Nombre de couverts. */
  covers?: number;
  notes?: string;
  /** Serveur / caissier qui a ouvert la table. */
  serverName?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Vente créée à l'encaissement. */
  saleId?: string;
  saleRef?: string;
  subtotal: number;
  reduction?: number;
  total: number;
  paid?: number;
  /** Nombre d'impressions du bon de table. */
  printCount?: number;
  history: BizTableOrderEvent[];
}

export const tableOrderSubtotal = (lines: BizTableOrderLine[]): number =>
  lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

export const TABLE_ORDER_STATUS_LABEL: Record<BizTableOrderStatus, string> = {
  pending: 'En attente', completed: 'Encaissée', cancelled: 'Annulée',
};

// Interfaces list shown in the worker "permissions" editor.
export const MODULE_INTERFACES: { id: string; label: string }[] = [
  { id: 'stock', label: 'Gestion de stock' },
  { id: 'inventaire', label: 'Inventaire' },
  { id: 'purchases', label: 'Achats' },
  { id: 'production', label: 'Production' },
  { id: 'comptoir', label: 'Comptoir' },
  { id: 'pos', label: 'Point de vente' },
  { id: 'sales', label: 'Ventes' },
  { id: 'tables', label: 'Gestion des tables' },
  { id: 'reparations', label: 'Vidanges & Lavage' },
  { id: 'encaissements', label: 'Demandes d\'encaissement' },
  { id: 'clients', label: 'Clients' },
  { id: 'suppliers', label: 'Fournisseurs' },
  { id: 'workers', label: 'Employés' },
  { id: 'expenses', label: 'Dépenses' },
  { id: 'caisse', label: 'Caisse' },
  { id: 'reports', label: 'Rapports' },
  { id: 'feedbacks', label: 'Retours clients' },
];

export const INTERFACE_ACTIONS = ['voir', 'creer', 'modifier', 'supprimer'] as const;

/**
 * Interfaces that actually exist for one part — the permissions editor and the
 * employee sidebar must never offer a screen the part does not have (Lavage has
 * no "Production", Cafétéria has no "Vidanges").
 *
 * The Lavage part also carries the point-de-vente and ventes screens that used
 * to live in the (now removed) Magasin part, and the « Messages clients » screen
 * (rappels de lavage / révision), which only makes sense there.
 *
 * Mirrors `buildModuleRoutes` in App.tsx.
 */
export function interfacesForModule(key: ModuleKey): { id: string; label: string }[] {
  const cfg = MODULES[key];
  const ids = cfg.isService
    ? [
        'pos', 'sales', 'stock', 'inventaire', 'purchases',
        'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports', 'feedbacks',
      ]
    : [
        'stock', 'inventaire', 'purchases',
        ...(cfg.hasProduction ? ['production', 'comptoir'] : []),
        'pos', 'sales', ...(hasTables(key) ? ['tables'] : []),
        'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports',
        'feedbacks',
      ];
  return ids
    .map(id => MODULE_INTERFACES.find(i => i.id === id))
    .filter((i): i is { id: string; label: string } => !!i);
}
