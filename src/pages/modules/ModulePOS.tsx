/**
 * ─── Point de vente ─────────────────────────────────────────────────────────────
 * Caisse of the Cafétéria and of the Lavage & Vidange part (which absorbed the
 * former Magasin point-de-vente).
 *
 *  • Session de travail obligatoire — rien ne peut être vendu avant qu'un employé
 *    n'ouvre sa session avec le fond de caisse qu'il a déjà en main. Ce fond
 *    n'entre JAMAIS dans le théorique ni dans le décalage.
 *  • Chaque session appartient à UN employé : celui qui se connecte ouvre et
 *    clôture la sienne, jamais celle d'un collègue. Deux caissiers peuvent donc
 *    tenir une session ouverte en même temps sans se gêner (voir
 *    `src/hooks/useBizSessions.ts`).
 *  • Filtrage par catégorie en plus de la recherche.
 *  • Accès rapide : l'utilisateur épingle les produits qui se vendent le plus et
 *    choisit leur ordre ; ils ouvrent la grille du comptoir.
 *  • Remise : en pourcentage ou en montant fixe, activée à la demande.
 *  • AFFICHEUR CLIENT — option du poste : le second petit écran d'un tout-en-un
 *    montre au client, en très gros chiffres, le total du panier au fur et à
 *    mesure qu'on y ajoute des produits, puis la monnaie à rendre une fois la
 *    vente encaissée (voir `components/biz/CustomerDisplay`).
 *  • Vente au détail : un produit « au détail » demande la quantité dans son
 *    unité (10 L sur un bidon de 50 L) et le stock est décrémenté d'autant.
 *  • ENCAISSEMENT DIRECT — cette même demande de quantité offre, à côté de
 *    « Ajouter au panier », un bouton « Encaisser » qui vend l'article SEUL,
 *    tout de suite : la vente est écrite dans l'historique sans que rien
 *    n'entre au panier, et le panier en cours n'est pas touché. C'est la vente
 *    la plus fréquente du comptoir — un article, réglé en espèces — et elle ne
 *    coûte plus deux gestes (voir `sellNow`).
 *  • Vente rapide de fiches techniques : une fiche marquée « vente directe »
 *    (ex: café au lait) s'affiche sur le comptoir et déduit ses ingrédients du
 *    stock à la vente, sans passer par la production.
 *  • Les productions envoyées au comptoir apparaissent directement ici.
 *  • VENTE À DÉCOUVERT — la caisse ne refuse JAMAIS une vente pour un manque de
 *    stock : un produit à zéro, une fiche technique dont il manque un
 *    ingrédient, une production déjà écoulée partent quand même. La quantité
 *    manquante descend en NÉGATIF (Gestion de stock / Comptoir) et se rattrape
 *    au prochain achat ou à la prochaine production. Le caissier est prévenu du
 *    découvert, il n'est jamais bloqué : c'est le client qu'on perdrait, pas la
 *    marchandise, qui est bien sortie.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag, Search, Plus, Minus, X, User, UserPlus, Percent, Check, Package,
  PlayCircle, StopCircle, Lock, Beaker, Layers, Wallet, AlertTriangle, Printer,
  Star, ArrowUp, ArrowDown, ListOrdered, Zap, Users, Monitor, MonitorOff, ScanLine,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizSale, BizLineItem, BizSession, BizFiche, BizProduct, BizDiscountType,
  detailPrice, discountOf, posPinKey, isSellableProduct, roundQty, formatQty,
  isReversedSale, netCashOfSale, BizProductRef, BizProductCar,
  productRefLabel, productCarLabel, productSearchFields,
} from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import { useBizSessions } from '@/src/hooks/useBizSessions';
import { PageHeader, Badge, Select, Field, Input, Textarea, Modal, money, formatDate, ViewToggle, Table } from '@/src/components/biz/Kit';
import { useCustomerDisplay, CustomerDisplayState } from '@/src/components/biz/CustomerDisplay';
import { ContactModal, printInvoice, AskPrintModal, stationFromSettings } from './_shared';
import BarcodeScannerModal from '@/src/components/BarcodeScannerModal';

type LineKind = 'comptoir' | 'product' | 'fiche';

interface CartLine {
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
  /** Stock ceiling in the line's own unit (detail unit for detail lines). */
  max: number;
  unit?: string;
  kind: LineKind;
  /**
   * Coût de revient d'UNE unité conditionnée (prix d'achat du produit, coût
   * unitaire d'une production au comptoir, coût de revient d'une fiche). Figé
   * sur la vente pour que le rapport calcule le vrai gain de la ligne.
   */
  unitCost: number;
  /** Set for products sold au détail: how much of one unit a detail unit is. */
  detailCapacity?: number;
  detailUnit?: string;
}

/** Sellable entry of the POS grid. */
interface Source {
  id: string;
  name: string;
  price: number;
  avail: number;
  unit?: string;
  kind: LineKind;
  /** Coût de revient d'une unité conditionnée — reporté tel quel sur la vente. */
  unitCost: number;
  categoryName?: string;
  detail?: boolean;
  detailCapacity?: number;
  detailUnit?: string;
  fiche?: BizFiche;
  imageUrl?: string;
  /**
   * Le code-barres du produit, pour que la douchette et la caméra retrouvent la
   * vignette. Une production du comptoir ou une fiche technique n'en portent
   * pas : elles ne sont pas étiquetées en rayon.
   */
  barcode?: string;
  /**
   * ─── CE SUR QUOI LA VIGNETTE SE RETROUVE ──────────────────────────────────
   * Tous les mots qui doivent faire sortir cet article : son nom, son code, et
   * — pour une pièce détachée — chacune de ses références et chacun des
   * véhicules qu'elle équipe. Au comptoir, le client n'annonce pas un nom de
   * rayon : il annonce « Clio 4 de 2015 » ou lit un numéro sur son ancienne
   * pièce, et c'est cela que le caissier tape.
   *
   * Une production du comptoir ou une fiche technique n'en portent pas.
   */
  searchFields?: string[];
  /** Les références de la pièce, montrées sous son nom sur la vignette. */
  refs?: BizProductRef[];
  /** Les véhicules compatibles, montrés sous les références. */
  cars?: BizProductCar[];
  /** Stable key used by the "accès rapide" pinning. */
  pinKey: string;
  /**
   * Fiches techniques : les ingrédients qui ne sont plus en stock. La vente
   * reste possible (le stock passera en négatif) — c'est une information, pas
   * un blocage.
   */
  missing?: string[];
}

export default function ModulePOS({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'pos');
  const { settings, currentUserName, currentModuleWorker, currentUserRole } = useAppState();
  const { comptoir, products, clients, fiches, workers } = biz.state;
  const pinned = biz.state.posPinned || [];

  // Seul l'administrateur voit le théorique de la session (total vendu, espèces
  // dues, décalage) ; l'employé qui tient la caisse vend sans jamais les voir.
  const isAdmin = currentUserRole === 'admin';

  // La session de l'employé CONNECTÉ — jamais celle d'un collègue. `otherOpen`
  // sert seulement à informer (l'admin voit qui tient une caisse en ce moment).
  const { mySession, otherOpen } = useBizSessions(moduleKey);

  /**
   * Pièces détachées : seule la partie Lavage & Vidange en vend, et donc
   * seule elle cherche par référence ou par véhicule.
   */
  const isLavage = moduleKey === 'lavage';

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  /**
   * Mise en page du rayon. SEUL écran de l'application où les vignettes restent
   * la vue de départ : ici, elles ne présentent pas des données, ce sont les
   * TOUCHES de la caisse — un caissier les vise du doigt. Le tableau est
   * offert à côté, pour un rayon de pièces où c'est la référence qui distingue
   * deux articles au nom identique.
   */
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState('');
  const [passage, setPassage] = useState(true);
  const [showClient, setShowClient] = useState(false);
  const [discountMode, setDiscountMode] = useState<'none' | BizDiscountType>('none');
  const [discountStr, setDiscountStr] = useState('');
  const [paidStr, setPaidStr] = useState('');
  const [detailPrompt, setDetailPrompt] = useState<Source | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showOrganize, setShowOrganize] = useState(false);
  // Lecture d'un code-barres à la caméra, pour ajouter l'article au panier.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [askPrint, setAskPrint] = useState<BizSale | null>(null);
  // Afficheur client — la fenêtre posée sur le second écran du poste.
  const [showDisplay, setShowDisplay] = useState(false);
  // Le ticket qui vient d'être encaissé : l'afficheur montre le remerciement et
  // la monnaie à rendre jusqu'au premier article du panier suivant.
  const [lastReceipt, setLastReceipt] = useState<CustomerDisplayState['receipt']>(null);

  // ── Sellable catalogue ────────────────────────────────────────────────────
  const source = useMemo<Source[]>(() => {
    const out: Source[] = [];

    // Productions already sent to the comptoir. A line stays on the grid while
    // it holds something AND while it is in the red: une production vendue à
    // découvert doit rester vendable (et visible en négatif) jusqu'à ce que la
    // fabrication suivante la remette à flot. Seule une ligne pile à zéro s'en
    // va — elle a été écoulée proprement.
    if (cfg.hasComptoir) {
      comptoir.filter(c => c.qty !== 0).forEach(c => {
        const matchingProd = products.find(p => p.name === c.productName);
        const matchingFiche = fiches.find(f => f.name === c.productName);
        out.push({
          id: c.id, name: c.productName, price: c.unitPrice, avail: c.qty,
          unit: c.unit, kind: 'comptoir', categoryName: c.categoryName,
          // Coût de revient sorti de la production qui a alimenté le comptoir.
          unitCost: c.purchasePrice || matchingFiche?.costPerUnit || 0,
          imageUrl: matchingProd?.imageUrl || matchingFiche?.imageUrl,
          pinKey: posPinKey('comptoir', c.productName),
        });
      });
    }

    // Stock products — including the ones sold au détail. Products are listed
    // even at 0 or negative stock: the POS may oversell them (stock goes minus)
    // and a later purchase settles the shortfall (e.g. −5 stock + 15 reçus = 10).
    // Les matières premières, elles, ne se vendent pas : elles restent en stock
    // et en production, mais ne descendent jamais sur le comptoir.
    products.filter(isSellableProduct).forEach(p => {
      if (p.sellByDetail && (p.detailCapacity || 0) > 0) {
        out.push({
          id: p.id, name: p.name, price: detailPrice(p),
          avail: p.currentQty * (p.detailCapacity || 0),
          unit: p.detailUnit, kind: 'product', categoryName: p.categoryName,
          // Toujours le coût d'UNE unité conditionnée : la ligne de vente
          // convertit la quantité au détail en unités conditionnées.
          unitCost: p.purchasePrice || 0,
          detail: true, detailCapacity: p.detailCapacity, detailUnit: p.detailUnit,
          imageUrl: p.imageUrl,
          barcode: p.barcode,
          searchFields: productSearchFields(p),
          refs: p.refs, cars: p.cars,
          pinKey: posPinKey('product', p.id),
        });
      } else {
        out.push({
          id: p.id, name: p.name, price: p.salePrice, avail: p.currentQty,
          unit: p.unit, kind: 'product', categoryName: p.categoryName,
          unitCost: p.purchasePrice || 0,
          imageUrl: p.imageUrl,
          barcode: p.barcode,
          searchFields: productSearchFields(p),
          refs: p.refs, cars: p.cars,
          pinKey: posPinKey('product', p.id),
        });
      }
    });

    // Quick-sale fiches (no production run needed). Une fiche reste au comptoir
    // même quand ses ingrédients sont épuisés : elle se vend à découvert et ce
    // sont les ingrédients qui passent en négatif dans la Gestion de stock.
    fiches.filter(f => f.directSale).forEach(f => out.push({
      id: f.id, name: f.name, price: f.unitPrice,
      avail: maxFicheServings(f, products), unit: f.sellUnit || 'unité',
      kind: 'fiche', categoryName: f.categoryName, fiche: f,
      // Coût des ingrédients d'UNE part, déduits du stock à la vente.
      unitCost: f.costPerUnit || 0,
      imageUrl: f.imageUrl,
      pinKey: posPinKey('fiche', f.id),
      missing: missingIngredients(f, products),
    }));

    return out;
  }, [cfg.hasComptoir, comptoir, products, fiches]);

  // ── Accès rapide ──────────────────────────────────────────────────────────
  // Pinned tiles come first, in the order the user arranged them; everything
  // else keeps the catalogue order behind them.
  const rank = (s: Source) => {
    const i = pinned.indexOf(s.pinKey);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const isPinned = (s: Source) => pinned.includes(s.pinKey);

  const savePinned = (keys: string[]) => biz.patch({ posPinned: keys });
  const togglePin = (s: Source) => {
    const next = isPinned(s) ? pinned.filter(k => k !== s.pinKey) : [...pinned, s.pinKey];
    savePinned(next);
    toast.success(isPinned(s) ? `${s.name} retiré de l'accès rapide` : `${s.name} épinglé en accès rapide`);
  };

  const categories = useMemo(
    () => Array.from(new Set(source.map(s => s.categoryName).filter(Boolean))).sort() as string[],
    [source]);

  const filtered = useMemo(() => source
    .filter(s =>
      // Le code-barres entre dans la recherche : la douchette USB écrit dans ce
      // même champ, et le produit doit se trouver sur son code comme sur son nom.
      // Un produit du catalogue apporte en plus SES références et LES VÉHICULES
      // qu'il équipe : « clio 4 2015 » ou « 7701478261 » sortent la pièce sans
      // que le caissier ait à connaître son nom de rayon.
      matchesSearch(search, s.name, s.barcode, ...(s.searchFields || [])) &&
      (category === 'all' || s.categoryName === category))
    .sort((a, b) => rank(a) - rank(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, search, category, pinned]);

  const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const discountAmount = discountMode === 'none'
    ? 0
    : discountOf(subtotal, discountMode, Number(discountStr) || 0);
  const total = Math.max(0, subtotal - discountAmount);
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);

  // ── Afficheur client ──────────────────────────────────────────────────────
  // Ce que le client lit sur le second écran. Il suit le panier ligne à ligne :
  // dès qu'un produit y entre, le total change sous ses yeux.
  const displayData = useMemo<CustomerDisplayState>(() => ({
    title: stationFromSettings(settings).name || 'Station',
    subtitle: cfg.label,
    lines: cart.map(l => ({
      id: l.id, name: l.name, qty: l.qty, unitPrice: l.unitPrice,
      // L'unité n'est montrée que sur une vente au détail : « 2,5 L × 250,00 DA »
      // se lit, « 3 unité × 120,00 DA » n'apprend rien.
      unit: l.detailUnit,
      total: l.qty * l.unitPrice,
    })),
    subtotal, discount: discountAmount, total,
    receipt: lastReceipt,
  }), [settings, cfg.label, cart, subtotal, discountAmount, total, lastReceipt]);

  useCustomerDisplay(showDisplay, displayData, reason => {
    setShowDisplay(false);
    if (reason === 'blocked') {
      toast.error("Afficheur bloqué — autorisez les fenêtres pop-up pour ce site, puis réessayez");
    }
  });

  // ── Cart ──────────────────────────────────────────────────────────────────
  // Aucune ligne n'est plafonnée par le stock : produit du catalogue, production
  // du comptoir ou fiche technique, tout se vend à découvert. `max` ne sert plus
  // qu'à CHIFFRER ce découvert pour le signaler au caissier.
  const pushLine = (s: Source, qty: number) => {
    // Le client suivant est arrivé : l'afficheur quitte le remerciement de la
    // vente précédente et repart sur le panier en cours.
    setLastReceipt(null);
    setCart(prev => {
      const found = prev.find(l => l.id === s.id);
      if (found) return prev.map(l => l.id === s.id ? { ...l, qty: l.qty + qty } : l);
      return [...prev, {
        id: s.id, name: s.name, unitPrice: s.price, qty,
        max: s.avail, unit: s.unit, kind: s.kind, unitCost: s.unitCost,
        detailCapacity: s.detailCapacity, detailUnit: s.detailUnit,
      }];
    });
  };

  const addToCart = (s: Source) => {
    if (!mySession) { toast.error('Ouvrez votre session de travail pour vendre'); return; }
    // Detail products ask for the quantity to sell, in the detail unit.
    if (s.detail) { setDetailPrompt(s); return; }
    pushLine(s, 1);
  };

  /**
   * Un code-barres lu à la caméra (ou tapé sur une douchette) : l'article part
   * DIRECTEMENT au panier — c'est tout l'intérêt du scan à la caisse.
   *
   * Un code inconnu n'est jamais silencieux : il est déposé dans la recherche
   * pour que le caissier voie ce qu'il vient de lire, et le dise en un mot au
   * responsable du stock. Un produit vendu au détail ouvre sa demande de
   * quantité comme lorsqu'on touche sa vignette.
   */
  const scanToCart = (code: string): boolean => {
    if (!mySession) {
      toast.error('Ouvrez votre session de travail pour vendre');
      return false;
    }
    const clean = code.trim();
    const found = source.find(s => (s.barcode || '').trim() === clean);
    if (!found) {
      setSearch(clean);
      setScanNote(`Code ${clean} inconnu — aucun produit ne le porte.`);
      toast.error(`Code ${clean} inconnu au catalogue`);
      return false;
    }
    setScanNote(`${found.name} ajouté au panier`);
    if (found.detail) {
      // La quantité au détail se saisit : la fenêtre du scanner s'efface.
      setScanning(false);
      setDetailPrompt(found);
      return true;
    }
    pushLine(found, 1);
    toast.success(`${found.name} ajouté`);
    return true;
  };

  const inc = (id: string) => setCart(prev => prev.map(l => l.id === id ? { ...l, qty: l.qty + 1 } : l));
  const dec = (id: string) => setCart(prev => prev.flatMap(l => l.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l]));
  const setLineQty = (id: string, v: number) =>
    setCart(prev => prev.map(l => l.id === id ? { ...l, qty: Math.max(0, v) } : l));
  const rm = (id: string) => setCart(prev => prev.filter(l => l.id !== id));

  /** Ce qui sera vendu au-delà du stock sur une ligne — 0 quand tout est couvert. */
  const shortOf = (l: CartLine) => Math.max(0, roundQty(l.qty - l.max));
  const shortLines = cart.filter(l => shortOf(l) > 0);

  // ── Checkout ──────────────────────────────────────────────────────────────
  /**
   * ─── L'ÉCRITURE D'UNE VENTE ────────────────────────────────────────────────
   * Le SEUL endroit qui pose une ligne dans l'historique des ventes et qui sort
   * la marchandise du stock. Deux chemins y mènent :
   *
   *  • le panier, encaissé par « Valider la vente » ;
   *  • l'encaissement DIRECT d'un article vendu au détail, qui ne passe jamais
   *    par le panier (voir `sellNow`).
   *
   * La différence tient dans les arguments — les lignes, la remise, le client —
   * jamais dans le traitement : même numérotation, même déduction de stock,
   * même rattachement à la session du caissier.
   */
  const registerSale = (opts: {
    lines: CartLine[];
    /** Remise déjà chiffrée en dinars — 0 quand la vente part au prix plein. */
    reduction: number;
    discountType?: BizDiscountType;
    discountValue?: number;
    /** Encaissé en espèces ; ce qui manque part en crédit sur le client. */
    paid: number;
    clientId?: string;
    clientName: string;
  }): BizSale => {
    const lines = opts.lines;
    const saleSubtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const saleReduction = Math.min(saleSubtotal, Math.max(0, opts.reduction));
    const saleTotal = Math.max(0, saleSubtotal - saleReduction);
    const salePaid = Math.max(0, opts.paid);
    const saleRest = Math.max(0, saleTotal - salePaid);

    // `unitCost` accompagne chaque ligne : il est toujours exprimé pour UNE unité
    // de `qty`, donc pour une unité conditionnée sur une vente au détail.
    const items: BizLineItem[] = lines.map(l => l.detailCapacity
      ? {
        productId: l.id, productName: l.name,
        qty: l.qty / l.detailCapacity, unitPrice: l.unitPrice, unitCost: l.unitCost,
        detailQty: l.qty, detailUnit: l.detailUnit,
        total: l.qty * l.unitPrice,
      }
      : { productId: l.id, productName: l.name, qty: l.qty, unitPrice: l.unitPrice, unitCost: l.unitCost, total: l.qty * l.unitPrice });

    const soldAt = new Date().toISOString();
    const sale: BizSale = {
      id: newId(), ref: `V-${String(biz.state.sales.length + 1).padStart(4, '0')}`,
      clientId: opts.clientId,
      clientName: opts.clientName,
      items, subtotal: saleSubtotal,
      reduction: saleReduction,
      discountType: opts.discountType,
      discountValue: opts.discountValue,
      total: saleTotal, paid: salePaid, rest: saleRest,
      date: soldAt, status: saleRest > 0 ? 'crédit' : 'payée',
      // L'encaissement du comptoir est daté dès la vente : le relevé du client
      // n'a alors rien à reconstruire.
      payments: salePaid > 0
        ? [{ id: newId(), date: soldAt, amount: salePaid, mode: 'Espèces', by: currentUserName || 'Admin' }]
        : undefined,
      createdBy: currentUserName || 'Admin',
      sessionId: mySession!.id,
      workerId: mySession!.workerId,
      workerName: mySession!.workerName,
    };
    biz.add('sales', sale);

    // Deduct stock. Rien n'est plafonné à zéro : ce qui a été vendu sans être en
    // stock part en NÉGATIF et se rattrape au prochain achat / à la prochaine
    // production. Une même matière première peut être consommée par plusieurs
    // lignes du panier (deux fiches qui partagent un ingrédient) : on cumule
    // d'abord tous les prélèvements, puis on écrit UNE fois chaque produit —
    // sinon la deuxième écriture repartirait du stock d'avant la première.
    const draw = new Map<string, number>();
    const take = (productId: string, qty: number) =>
      draw.set(productId, (draw.get(productId) || 0) + qty);

    lines.forEach(l => {
      if (l.kind === 'comptoir') {
        const c = comptoir.find(x => x.id === l.id);
        if (c) biz.update('comptoir', { ...c, qty: roundQty(c.qty - l.qty) });
      } else if (l.kind === 'fiche') {
        // A direct-sale fiche behaves like an instant production: its ingredients
        // leave the stock right away — and may drive it negative, settled later
        // by a purchase. Il manque de la matière ? La vente passe quand même.
        const f = fiches.find(x => x.id === l.id);
        f?.ingredients.forEach(ing => {
          // Un ingrédient « semi-fini » n'est pas une ligne de stock : il n'y a
          // rien à décrémenter pour lui.
          if (ing.sourceType === 'fiche') return;
          take(ing.productId, ing.quantityUsed * l.qty / Math.max(1, f.outputQuantity));
        });
      } else {
        take(l.id, l.detailCapacity ? l.qty / l.detailCapacity : l.qty);
      }
    });

    draw.forEach((consumed, productId) => {
      const p = products.find(x => x.id === productId);
      if (p) biz.update('products', { ...p, currentQty: roundQty(p.currentQty - consumed) });
    });

    return sale;
  };

  const checkout = () => {
    if (!mySession) { toast.error('Ouvrez votre session de travail pour vendre'); return; }
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (!passage && !clientId) { toast.error('Sélectionnez un client'); return; }
    if (passage && rest > 0) { toast.error('Un client est requis pour une vente à crédit'); return; }

    const client = clients.find(c => c.id === clientId);
    const sale = registerSale({
      lines: cart,
      reduction: discountAmount,
      discountType: discountMode === 'none' ? undefined : discountMode,
      discountValue: discountMode === 'none' ? undefined : Number(discountStr) || 0,
      paid,
      clientId: passage ? undefined : clientId,
      clientName: passage ? 'Client de passage' : (client?.name || '—'),
    });

    const shortNote = shortLines.length
      ? ` — ${shortLines.length} article(s) vendu(s) à découvert, stock en négatif`
      : '';
    toast.success((discountAmount > 0
      ? `Vente enregistrée — remise de ${money(discountAmount)} accordée`
      : 'Vente enregistrée') + shortNote);
    // L'afficheur passe au remerciement : le client y lit ce qu'il a payé et la
    // monnaie qu'on lui doit, au lieu d'un panier redevenu vide.
    setLastReceipt({ total, paid, change: Math.max(0, paid - total) });
    setCart([]); setDiscountMode('none'); setDiscountStr(''); setPaidStr(''); setClientId(''); setPassage(true);
    setAskPrint(sale);
  };

  /**
   * ─── ENCAISSEMENT DIRECT ───────────────────────────────────────────────────
   * Un article vendu au détail — 5 L pris sur un bidon, 2 kg pris sur un sac —
   * part TOUT DE SUITE sans jamais entrer dans le panier : le caissier saisit la
   * quantité, touche « Encaisser », et la vente est déjà dans l'historique.
   *
   * C'est la vente la plus fréquente du comptoir : un seul article, réglé en
   * espèces, sans remise et sans client nommé. La faire passer par le panier
   * obligeait à ajouter, puis valider, pour un ticket d'une seule ligne.
   *
   * Ce raccourci ne touche JAMAIS au panier en cours : un caissier qui compose
   * la note d'un client peut encaisser un passant entre deux articles, il
   * retrouve sa note intacte. Le ticket direct est donc toujours au prix plein
   * et au client de passage : la remise et le crédit restent l'affaire du
   * panier, qui seul porte un client et un montant payé.
   */
  const sellNow = (s: Source, qty: number) => {
    if (!mySession) { toast.error('Ouvrez votre session de travail pour vendre'); return; }
    if (!perm.creer) { toast.error("Vous n'avez pas le droit d'enregistrer une vente"); return; }
    if (qty <= 0) return;

    const amount = qty * s.price;
    const sale = registerSale({
      lines: [{
        id: s.id, name: s.name, unitPrice: s.price, qty,
        max: s.avail, unit: s.unit, kind: s.kind, unitCost: s.unitCost,
        detailCapacity: s.detailCapacity, detailUnit: s.detailUnit,
      }],
      reduction: 0,
      paid: amount,
      clientName: 'Client de passage',
    });

    const short = Math.max(0, roundQty(qty - s.avail));
    toast.success(`${s.name} encaissé — ${money(amount)}`
      + (short > 0 ? ` (${formatQty(short)} ${s.detailUnit || ''} à découvert)` : ''));
    // L'afficheur ne bascule sur le ticket que si aucun panier n'est en cours :
    // le client qui suit sa note à l'écran ne doit pas la voir remplacée par
    // l'encaissement de quelqu'un d'autre.
    if (cart.length === 0) setLastReceipt({ total: amount, paid: amount, change: 0 });
    setAskPrint(sale);
  };

  const doPrint = (sale: BizSale) => {
    const client = clients.find(c => c.id === sale.clientId);
    printInvoice({
      title: 'Facture de vente', ref: sale.ref, date: sale.date,
      station: stationFromSettings(settings),
      party: { label: 'Client', name: sale.clientName, phone: client?.phone, address: client?.address },
      info: [
        { label: 'Caissier', value: sale.workerName || '' },
        { label: 'Session', value: mySession?.ref || '' },
      ],
      items: sale.items.map(i => ({
        name: i.productName,
        qty: i.detailQty ? `${i.detailQty} ${i.detailUnit || ''}`.trim() : i.qty,
        unitPrice: i.unitPrice, total: i.total ?? i.qty * i.unitPrice,
      })),
      subtotal: sale.subtotal, reduction: sale.reduction,
      total: sale.total, paid: sale.paid, rest: sale.rest,
      payments: [{ label: 'Espèces', amount: sale.paid }],
      footerNote: sale.reduction
        ? `Remise accordée : ${sale.discountType === 'percent' ? `${sale.discountValue}%` : money(sale.reduction)}`
        : undefined,
    });
    biz.update('sales', { ...sale, printedAt: new Date().toISOString() });
  };

  // ── Session totals (for the closing screen) ───────────────────────────────
  const sessionFigures = useMemo(() => figuresForSession(mySession, biz.state.sales), [mySession, biz.state.sales]);

  /**
   * ─── LE CURSEUR DANS LA RECHERCHE, ET NULLE PART AILLEURS ──────────────────
   *
   * Le caissier arrive au point de vente pour TAPER un nom de produit ou passer
   * une douchette code-barres : le champ de recherche prend donc le curseur dès
   * l'ouverture de l'écran, sans qu'il ait à le viser.
   *
   * Mais dès qu'il touche autre chose — une vignette produit, le panier, un
   * bouton — le curseur doit LÂCHER le champ. Sinon la douchette continue d'y
   * écrire pendant qu'il compose le panier à la souris, et les caractères
   * tombent dans une recherche qu'il ne regarde plus. Un clic sur un bouton ou
   * une autre saisie enlève le focus tout seul ; un clic sur une vignette ou une
   * zone décorative, non — c'est ce cas que ce garde traite.
   *
   * Il revient uniquement quand l'utilisateur reclique DANS le champ.
   */
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const posRootRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Un `requestAnimationFrame` : le champ n'existe qu'une fois la grille peinte.
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const root = posRootRef.current;
    if (!root) return;
    const release = (e: MouseEvent | TouchEvent) => {
      const input = searchRef.current;
      if (!input) return;
      const target = e.target as Node | null;
      // Clic DANS le champ (ou sur sa loupe) : on le laisse tranquille.
      if (target && input.contains(target)) return;
      if (document.activeElement === input) input.blur();
    };
    root.addEventListener('mousedown', release);
    root.addEventListener('touchstart', release, { passive: true });
    return () => {
      root.removeEventListener('mousedown', release);
      root.removeEventListener('touchstart', release);
    };
  }, []);

  return (
    <div ref={posRootRef} className="space-y-4 animate-fade-in">
      <PageHeader icon={ShoppingBag} title="Point de vente" subtitle={`${cfg.label} — caisse & encaissement`}
        actions={<div className="flex items-center gap-2 flex-wrap">
          {/* Afficheur client — la fenêtre à poser sur le petit second écran du
              poste tout-en-un. Elle ne peut s'ouvrir que sur un clic : le
              navigateur refuse une fenêtre que la page ouvrirait toute seule. */}
          <button
            onClick={() => setShowDisplay(v => !v)}
            className={showDisplay ? 'btn-primary' : 'btn-secondary'}
            title={showDisplay
              ? "Éteindre l'afficheur client"
              : "Ouvrir l'afficheur client — à glisser sur le second écran du poste"}>
            {showDisplay ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            <span className="hidden sm:inline">Afficheur client</span>
          </button>
          {mySession ? (
            <>
              <div className="hidden sm:block text-right">
                <p className="text-[10px] uppercase font-bold text-slate-400">Ma session</p>
                <p className="text-sm font-black text-[#002d87]">{mySession.workerName}</p>
              </div>
              <button className="btn-secondary" onClick={() => setShowClose(true)}>
                <StopCircle className="w-4 h-4" /> Clôturer ma session
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setShowOpen(true)}>
              <PlayCircle className="w-4 h-4" /> Ouvrir ma session
            </button>
          )}
        </div>} />

      {/* Session gate — l'employé ouvre SA session ; celle d'un collègue restée
          ouverte ne le concerne pas et ne l'empêche pas de travailler. */}
      {!mySession && (
        <div className="card-glass p-6 flex flex-col sm:flex-row items-center gap-4 border-l-4 border-amber-400">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <Lock className="w-6 h-6 text-amber-600" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-black text-slate-800">Vous n'avez aucune session de travail ouverte</h3>
            <p className="text-sm text-slate-500">
              Ouvrez votre propre session — à votre nom, avec le fond de caisse que vous avez déjà en main —
              avant de vendre. Ce fond n'est pas compté dans le théorique de votre session.
            </p>
          </div>
          <button className="btn-primary shrink-0" onClick={() => setShowOpen(true)}>
            <PlayCircle className="w-4 h-4" /> Ouvrir ma session
          </button>
        </div>
      )}

      {mySession && (
        <div className={`card-glass p-4 grid grid-cols-2 gap-3 ${isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Employé</p><p className="font-black text-slate-700 text-sm">{mySession.workerName}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Ouverte le</p><p className="font-black text-slate-700 text-sm">{new Date(mySession.openedAt).toLocaleString('fr-DZ')}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Fond de caisse</p><p className="font-black text-slate-700 text-sm tabular-nums">{money(mySession.openingCash)}</p></div>
          {isAdmin && (
            <div><p className="text-[10px] uppercase font-bold text-slate-400">Ventes de la session</p><p className="font-black text-emerald-600 text-sm tabular-nums">{money(sessionFigures.total)}</p></div>
          )}
        </div>
      )}

      {/* Les autres caisses ouvertes — information de supervision réservée à
          l'administrateur : un employé n'a rien à savoir de la caisse d'un autre
          et ne peut de toute façon pas y toucher. */}
      {isAdmin && otherOpen.length > 0 && (
        <div className="card-glass p-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black uppercase text-slate-400 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Autres caisses ouvertes
          </span>
          {otherOpen.map(s => (
            <Badge key={s.id} tone="warning">
              {s.workerName} — {s.ref} — depuis {new Date(s.openedAt).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          ))}
          <span className="text-[11px] text-slate-400">
            Chacune se clôture depuis le poste de son employé (ou dans Caisse → Sessions de travail).
          </span>
        </div>
      )}

      {/* Comptoir & encaissement.
          Sur grand écran, ce bloc occupe une hauteur d'écran fixe et CHAQUE
          colonne défile pour son compte : le caissier fait défiler les produits
          sans jamais perdre de vue le panier ni le bouton « Valider la vente »,
          qui restent épinglés à droite. Sous `lg`, tout revient au fil normal de
          la page (le panier passe sous la grille), comme avant. */}
      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[calc(100vh-14rem)] lg:min-h-[480px] ${mySession ? '' : 'opacity-50 pointer-events-none'}`}>
        {/* Catalogue — la seule colonne qui défile avec les produits */}
        <div className="lg:col-span-2 lg:min-h-0 lg:overflow-y-auto custom-scrollbar lg:pr-2 space-y-4">
          <div className="card-glass p-3 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder={isLavage
                  ? 'Nom, code-barres, référence ou véhicule (« clio 4 2015 »)…'
                  : 'Rechercher un produit ou scanner son code…'}
                className="input-field pl-9"
                // Une douchette USB écrit ici puis envoie « Entrée ». Le panier ne
                // se remplit QUE sur un code-barres exact : valider une recherche
                // par nom ajouterait au hasard le premier produit de la liste.
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  const code = search.trim();
                  if (!code || !source.some(s => (s.barcode || '').trim() === code)) return;
                  e.preventDefault();
                  if (scanToCart(code)) setSearch('');
                }} />
            </div>
            {/* Scanner : le code lu tombe DIRECTEMENT dans le panier. La fenêtre
                reste ouverte pour enchaîner les articles d'un même client. */}
            <button className="btn-primary shrink-0" onClick={() => { setScanNote(''); setScanning(true); }}
              title="Scanner un code-barres avec la caméra et l'ajouter au panier">
              <ScanLine className="w-4 h-4" /> Scanner
            </button>
            <Select value={category} onChange={e => setCategory(e.target.value)} className="!w-auto min-w-[170px]">
              <option value="all">Toutes catégories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <button className="btn-secondary shrink-0" onClick={() => setShowOrganize(true)}
              title="Choisir et ordonner les produits affichés en tête de la grille">
              <ListOrdered className="w-4 h-4" /> Organiser l'affichage
            </button>
            <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCategory('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${category === 'all' ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                <Layers className="w-3.5 h-3.5 inline mr-1" />Tout
              </button>
              {categories.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${category === c ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {pinned.length > 0 && (
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[#FFB800]" />
              {pinned.length} produit(s) en accès rapide — ils s'affichent en tête de la grille.
            </p>
          )}

          {filtered.length === 0 ? (
            <div className="card-glass p-12 text-center text-slate-400">
              <Package className="w-10 h-10 mx-auto mb-2 text-slate-300" />Aucun produit disponible
            </div>
          ) : view === 'table' ? (
            /* ── Le rayon en tableau ─────────────────────────────────────
               La ligne entière est cliquable : on ajoute au panier comme on
               tapait la vignette. Ce que la vignette ne peut pas montrer sans
               se serrer — référence, véhicules, catégorie — tient ici en clair. */
            <Table head={<>
              <th className="table-head">Produit</th><th className="table-head">Catégorie</th>
              <th className="table-head">Référence / véhicule</th>
              <th className="table-head text-right">Prix</th><th className="table-head text-right">Disponible</th>
              <th className="table-head text-right">Accès rapide</th>
            </>}>
              {filtered.map(s => (
                <tr key={`${s.kind}-${s.id}`} role="button" tabIndex={0}
                  onClick={() => addToCart(s)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addToCart(s); } }}
                  className={`cursor-pointer ${isPinned(s) ? 'bg-amber-50/60' : ''}`}
                  title="Ajouter au panier">
                  <td className="table-cell">
                    <div className="font-bold text-slate-700 flex items-center gap-1.5">
                      {s.name}
                      {s.kind === 'fiche' && <Badge tone="primary">Vente rapide</Badge>}
                      {s.detail && <Badge tone="info">Au détail</Badge>}
                    </div>
                    {(s.kind === 'fiche' ? (s.missing?.length || 0) > 0 : s.avail <= 0) && (
                      <div className="text-[11px] font-bold text-amber-600">
                        Vente à découvert — stock en négatif
                        {s.missing && s.missing.length > 0 && ` · manque ${s.missing.slice(0, 3).join(', ')}${s.missing.length > 3 ? '…' : ''}`}
                      </div>
                    )}
                  </td>
                  <td className="table-cell text-slate-500">{s.categoryName || '—'}</td>
                  <td className="table-cell">
                    {!!s.refs?.length && (
                      <div className="text-[11px] font-mono text-violet-600 truncate max-w-[220px]" title={s.refs.map(productRefLabel).join(' · ')}>
                        {s.refs.map(productRefLabel).join(' · ')}
                      </div>
                    )}
                    {!!s.cars?.length && (
                      <div className="text-[11px] font-bold text-blue-600 truncate max-w-[220px]" title={s.cars.map(productCarLabel).join(' · ')}>
                        {s.cars.map(productCarLabel).join(' · ')}
                      </div>
                    )}
                    {!s.refs?.length && !s.cars?.length && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="table-cell tabular-nums text-right font-black text-[#002d87]">
                    {money(s.price)}{s.detail ? <span className="text-[10px] font-bold">/{s.detailUnit}</span> : null}
                  </td>
                  <td className="table-cell text-right">
                    <Badge tone={s.avail <= 0 ? 'danger' : s.avail <= 5 ? 'warning' : 'neutral'}>
                      {formatQty(s.avail)} {s.unit}
                    </Badge>
                  </td>
                  <td className="table-cell text-right">
                    <button type="button" onClick={e => { e.stopPropagation(); togglePin(s); }}
                      title={isPinned(s) ? "Retirer de l'accès rapide" : "Épingler en accès rapide"}
                      className={`w-8 h-8 rounded-lg inline-flex items-center justify-center border transition-colors
                        ${isPinned(s) ? 'bg-[#FFB800] border-[#FFB800] text-white' : 'bg-white border-slate-200 text-slate-300 hover:text-[#FFB800]'}`}>
                      <Star className={`w-3.5 h-3.5 ${isPinned(s) ? 'fill-white' : ''}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
              {filtered.map(s => (
                <div key={`${s.kind}-${s.id}`} role="button" tabIndex={0}
                  onClick={() => addToCart(s)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addToCart(s); } }}
                  className={`card-glass p-2 text-left card-hover group flex flex-col justify-between relative cursor-pointer ${isPinned(s) ? 'ring-2 ring-[#FFB800]' : ''}`}>
                  {/* Pin / unpin — quick access for the best sellers. */}
                  <button type="button" onClick={e => { e.stopPropagation(); togglePin(s); }}
                    title={isPinned(s) ? "Retirer de l'accès rapide" : "Épingler en accès rapide"}
                    className={`absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-lg flex items-center justify-center border transition-colors
                      ${isPinned(s)
                        ? 'bg-[#FFB800] border-[#FFB800] text-white'
                        : 'bg-white/90 border-slate-200 text-slate-300 hover:text-[#FFB800] opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
                    <Star className={`w-3 h-3 ${isPinned(s) ? 'fill-white' : ''}`} />
                  </button>
                  <div>
                    {s.imageUrl ? (
                      <div className="w-full h-20 rounded-lg overflow-hidden mb-1.5 relative bg-slate-100 border border-slate-200/60 shadow-inner">
                        <img src={s.imageUrl} alt={s.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </div>
                    ) : (
                      <div className="w-full h-12 rounded-lg bg-gradient-to-br from-[#003087]/10 to-[#FFB800]/10 flex items-center justify-center mb-1.5">
                        {s.kind === 'fiche' ? <Beaker className="w-5 h-5 text-[#003087]" /> : <Package className="w-5 h-5 text-[#003087]" />}
                      </div>
                    )}
                    <p className="font-bold text-slate-700 text-xs leading-tight line-clamp-2">{s.name}</p>
                    {/* Ce qui a fait sortir la vignette. Un rayon de pièces
                        détachées compte dix filtres qui portent presque le même
                        nom : c'est la référence — ou la voiture — qui dit
                        laquelle est la bonne, pas le nom. */}
                    {!!s.refs?.length && (
                      <p className="text-[9px] font-mono text-violet-600 leading-tight line-clamp-1"
                        title={s.refs.map(productRefLabel).join(' · ')}>
                        {s.refs.map(productRefLabel).join(' · ')}
                      </p>
                    )}
                    {!!s.cars?.length && (
                      <p className="text-[9px] font-bold text-blue-600 leading-tight line-clamp-1"
                        title={s.cars.map(productCarLabel).join(' · ')}>
                        {s.cars.map(productCarLabel).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-1">
                    <span className="font-black text-[#002d87] text-xs tabular-nums">
                      {money(s.price)}{s.detail ? <span className="text-[9px] font-bold">/{s.detailUnit}</span> : null}
                    </span>
                    <Badge tone={s.avail <= 0 ? 'danger' : s.avail <= 5 ? 'warning' : 'neutral'}>
                      {formatQty(s.avail)} {s.unit}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {isPinned(s) && <Badge tone="warning">Accès rapide</Badge>}
                    {s.kind === 'fiche' && <Badge tone="primary">Vente rapide</Badge>}
                    {s.detail && <Badge tone="info">Au détail</Badge>}
                  </div>
                  {/* Plus rien en stock : on le dit, mais la vente reste ouverte
                      et fera descendre les quantités en négatif. Sur une fiche,
                      ce sont les ingrédients manquants qui font foi. */}
                  {(s.kind === 'fiche' ? (s.missing?.length || 0) > 0 : s.avail <= 0) && (
                    <p className="mt-1.5 text-[10px] font-bold text-amber-600 flex items-start gap-1 leading-tight">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                      <span>
                        Vente à découvert — stock en négatif
                        {s.missing && s.missing.length > 0 && (
                          <span className="block font-semibold text-amber-500">
                            Manque : {s.missing.slice(0, 3).join(', ')}
                            {s.missing.length > 3 ? '…' : ''}
                          </span>
                        )}
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panier & encaissement — épinglé : il ne défile jamais avec les produits */}
        <div className="lg:min-h-0 lg:overflow-y-auto custom-scrollbar space-y-4 lg:pb-1">
          <div className="card-glass p-4">
            <div className="mb-3">
              <div className="flex gap-2 mb-2">
                <button onClick={() => setPassage(true)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${passage ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>Client de passage</button>
                <button onClick={() => setPassage(false)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${!passage ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>Client</button>
              </div>
              {!passage && (
                <div className="flex gap-2">
                  <Select value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="">— Sélectionner —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
                  </Select>
                  <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowClient(true)}><UserPlus className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar">
              {cart.length === 0 ? <p className="text-center text-slate-400 text-sm py-6">Panier vide</p> : cart.map(l => (
                <div key={l.id} className={`flex items-center gap-2 rounded-xl p-2 ${shortOf(l) > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{l.name}</p>
                    <p className="text-xs text-slate-400 tabular-nums">
                      {money(l.unitPrice)}{l.detailUnit ? `/${l.detailUnit}` : ''} × {formatQty(l.qty)}
                    </p>
                    {/* Découvert de la ligne — la vente reste autorisée. */}
                    {shortOf(l) > 0 && (
                      <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {formatQty(shortOf(l))} {l.detailUnit || l.unit || ''} au-delà du stock
                      </p>
                    )}
                  </div>
                  {l.detailCapacity ? (
                    <input type="number" step="0.01" min={0} value={l.qty}
                      onChange={e => setLineQty(l.id, Number(e.target.value))}
                      className="input-field !py-1 !px-2 w-20 text-center" />
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => dec(l.id)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                      <span className="w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                      <button onClick={() => inc(l.id)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    </div>
                  )}
                  <button onClick={() => rm(l.id)} className="w-6 h-6 rounded-md text-red-500 flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="card-glass p-4 space-y-3">
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Sous-total</span><span className="font-bold tabular-nums">{money(subtotal)}</span></div>

            {/* Remise — en pourcentage ou en montant fixe */}
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <Percent className="w-4 h-4" /> Remise
                </span>
                {discountAmount > 0 && (
                  <span className="font-black tabular-nums text-amber-700 text-sm">−{money(discountAmount)}</span>
                )}
              </div>
              <div className="flex gap-1.5">
                {([['none', 'Aucune'], ['percent', '%'], ['amount', 'Montant']] as const).map(([m, lbl]) => (
                  <button key={m} onClick={() => { setDiscountMode(m); if (m === 'none') setDiscountStr(''); }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${discountMode === m ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              {discountMode !== 'none' && (
                <div className="relative">
                  <input type="number" min={0} value={discountStr} autoFocus
                    onChange={e => setDiscountStr(e.target.value)}
                    placeholder={discountMode === 'percent' ? 'Pourcentage (0-100)' : 'Montant remisé (DA)'}
                    className="input-field !py-1.5 pr-8 text-right" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-300 pointer-events-none">
                    {discountMode === 'percent' ? '%' : 'DA'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#001f5c] text-white p-3">
              <span className="text-sm font-semibold text-blue-200">Total à payer</span><span className="text-xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[11px] font-bold uppercase text-slate-400">Payé</label><input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} placeholder={String(total)} className="input-field mt-1" /></div>
              <div><label className="text-[11px] font-bold uppercase text-slate-400">Reste</label><div className="mt-1 h-[46px] rounded-xl bg-red-50 flex items-center px-3 font-black tabular-nums text-red-600">{money(rest)}</div></div>
            </div>
            {/* Récapitulatif du découvert : le caissier valide en connaissance
                de cause, il n'est jamais empêché de servir le client. */}
            {shortLines.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>{shortLines.length} article(s) vendu(s) à découvert.</strong> La vente
                  passe normalement : les quantités manquantes s'afficheront en négatif dans la
                  Gestion de stock (et au Comptoir) jusqu'au prochain achat ou à la prochaine
                  production.
                </span>
              </div>
            )}
            <button className="btn-primary w-full" onClick={checkout} disabled={!perm.creer || !mySession}
              title={mySession ? (perm.creer ? undefined : "Vous n'avez pas le droit d'enregistrer une vente") : 'Ouvrez votre session de travail'}>
              <Check className="w-4 h-4" /> Valider la vente
            </button>
          </div>
        </div>
      </div>

      {/* Scanner : les articles entrent au panier les uns après les autres,
          la fenêtre reste ouverte tant que le client dépose sa marchandise. */}
      <BarcodeScannerModal
        open={scanning}
        continuous
        title="Scanner un article"
        subtitle="Chaque code lu entre directement dans le panier"
        lastResult={scanNote}
        onClose={() => setScanning(false)}
        onDetect={scanToCart}
      />

      {/* Detail quantity prompt */}
      {detailPrompt && (
        <DetailQtyModal source={detailPrompt} canSell={perm.creer && !!mySession}
          onClose={() => setDetailPrompt(null)}
          onConfirm={qty => { pushLine(detailPrompt, qty); setDetailPrompt(null); }}
          onSell={qty => { sellNow(detailPrompt, qty); setDetailPrompt(null); }} />
      )}

      {showOrganize && (
        <OrganizeModal sources={source} pinned={pinned} sales={biz.state.sales}
          onSave={keys => { savePinned(keys); setShowOrganize(false); toast.success('Ordre d\'affichage enregistré'); }}
          onClose={() => setShowOrganize(false)} />
      )}

      {showOpen && (
        <OpenSessionModal
          moduleKey={moduleKey}
          defaultName={currentModuleWorker?.name || currentUserName || ''}
          workers={workers}
          onClose={() => setShowOpen(false)} />
      )}

      {showClose && mySession && (
        <CloseSessionModal moduleKey={moduleKey} session={mySession} onClose={() => setShowClose(false)} />
      )}

      <AskPrintModal open={!!askPrint}
        onPrint={() => { if (askPrint) doPrint(askPrint); setAskPrint(null); }}
        onSkip={() => setAskPrint(null)} />

      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)}
        onSaved={(c) => { setPassage(false); setClientId(c.id); }} />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * How many servings of a direct-sale fiche the current stock allows.
 *
 * Zéro ne veut pas dire « invendable » : c'est le seuil à partir duquel la
 * vente se fait à découvert et pousse les ingrédients en négatif.
 */
function maxFicheServings(f: BizFiche, products: { id: string; currentQty: number }[]): number {
  if (!f.ingredients.length) return 0;
  const per = Math.max(1, f.outputQuantity);
  let min = Infinity;
  for (const ing of f.ingredients) {
    // Un semi-fini (autre fiche) n'a pas de ligne de stock : il ne limite rien.
    if (ing.sourceType === 'fiche') continue;
    const p = products.find(x => x.id === ing.productId);
    const need = ing.quantityUsed / per;
    if (!p) return 0;
    if (need <= 0) continue;
    min = Math.min(min, Math.floor(p.currentQty / need));
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}

/**
 * Ingrédients d'une fiche dont le stock ne couvre plus une seule part — ceux
 * qui passeront en négatif si le caissier vend quand même. Purement informatif :
 * la fiche reste vendable.
 */
function missingIngredients(f: BizFiche, products: BizProduct[]): string[] {
  const per = Math.max(1, f.outputQuantity);
  return f.ingredients
    .filter(ing => {
      if (ing.sourceType === 'fiche') return false;
      const need = ing.quantityUsed / per;
      if (need <= 0) return false;
      const p = products.find(x => x.id === ing.productId);
      return !p || p.currentQty < need;
    })
    .map(ing => ing.productName);
}

/**
 * Theoretical takings of a session. The opening float is deliberately absent:
 * the worker owes only what they sold in cash during the session.
 */
export function figuresForSession(session: BizSession | null, sales: BizSale[]) {
  if (!session) return { total: 0, cash: 0, credit: 0, count: 0 };
  // Une vente ANNULÉE ne compte pas dans le théorique : rendue, le caissier a
  // sorti l'argent du tiroir ; échangée, c'est la vente de remplacement (même
  // session) qui porte le panier — les compter toutes deux doublait la recette.
  const own = sales.filter(s => s.sessionId === session.id);
  const effective = own.filter(s => !isReversedSale(s));
  return {
    total: effective.reduce((s, x) => s + x.total, 0),
    // Théorique = ce qui doit RÉELLEMENT être dans le tiroir : les
    // remboursements en sont déjà sortis.
    cash: own.reduce((s, x) => s + netCashOfSale(x), 0),
    credit: effective.reduce((s, x) => s + x.rest, 0),  // granted as debt, not cash
    count: effective.length,
  };
}

// ─── Organise the POS grid (accès rapide) ──────────────────────────────────────
/**
 * Lets the caissier pick the products that sell the most and arrange the order
 * in which they open the grid. Everything that is not pinned keeps following
 * behind, in the catalogue order.
 */
function OrganizeModal({ sources, pinned, sales, onSave, onClose }: {
  sources: Source[];
  pinned: string[];
  sales: BizSale[];
  onSave: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [keys, setKeys] = useState<string[]>(pinned);
  const [search, setSearch] = useState('');

  // Units already sold, by product name — what "se vend le plus" actually means.
  const soldByName = useMemo(() => {
    const m: Record<string, number> = {};
    sales.filter(s => !isReversedSale(s)).forEach(s =>
      s.items.forEach(i => { m[i.productName] = (m[i.productName] || 0) + (i.detailQty || i.qty || 0); }));
    return m;
  }, [sales]);

  // One entry per pin key — a product and its comptoir line share the same tile.
  // The best sellers come first so they are the easiest to pin.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: Source[] = [];
    sources.forEach(s => { if (!seen.has(s.pinKey)) { seen.add(s.pinKey); out.push(s); } });
    return out.sort((a, b) => (soldByName[b.name] || 0) - (soldByName[a.name] || 0));
  }, [sources, soldByName]);

  const labelOf = (key: string) =>
    unique.find(s => s.pinKey === key)?.name || key.split(':').slice(1).join(':');
  const move = (i: number, dir: -1 | 1) => setKeys(prev => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (key: string) =>
    setKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const available = unique
    .filter(s => matchesSearch(search, s.name));

  return (
    <Modal open onClose={onClose} icon={ListOrdered} size="lg"
      title="Organiser l'affichage du comptoir"
      subtitle="Épinglez les produits qui se vendent le plus : ils s'affichent en premier"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={() => onSave(keys)}>Enregistrer l'ordre</button>
      </>}>
      <div className="space-y-4">
        {/* Ordered quick-access list */}
        <div>
          <p className="text-[11px] font-black uppercase text-slate-400 mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#FFB800]" /> Accès rapide — {keys.length} produit(s)
          </p>
          {keys.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">
              Aucun produit épinglé — cochez ci-dessous ceux à mettre en tête.
            </p>
          ) : (
            <div className="space-y-1.5">
              {keys.map((key, i) => (
                <div key={key} className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 p-2">
                  <span className="w-6 h-6 rounded-lg bg-[#FFB800] text-white text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-700">{labelOf(key)}</span>
                  <button className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center disabled:opacity-30"
                    onClick={() => move(i, -1)} disabled={i === 0} title="Monter">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center disabled:opacity-30"
                    onClick={() => move(i, 1)} disabled={i === keys.length - 1} title="Descendre">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button className="w-7 h-7 rounded-lg text-red-500 flex items-center justify-center" onClick={() => toggle(key)} title="Retirer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Catalogue picker */}
        <div>
          <p className="text-[11px] font-black uppercase text-slate-400 mb-2">
            Catalogue — trié par quantités déjà vendues
          </p>
          <div className="relative mb-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un produit…" className="input-field pl-9" />
          </div>
          <div className="max-h-[260px] overflow-y-auto custom-scrollbar space-y-1">
            {available.length === 0 && <p className="text-center text-sm text-slate-400 py-4">Aucun produit</p>}
            {available.map(s => {
              const on = keys.includes(s.pinKey);
              return (
                <button key={s.pinKey} onClick={() => toggle(s.pinKey)}
                  className={`w-full flex items-center gap-2 rounded-xl p-2 text-left border transition-colors ${on ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100 hover:bg-slate-50'}`}>
                  <Star className={`w-4 h-4 shrink-0 ${on ? 'text-[#FFB800] fill-[#FFB800]' : 'text-slate-300'}`} />
                  <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-700">{s.name}</span>
                  {(soldByName[s.name] || 0) > 0 && (
                    <Badge tone="success">{Math.round(soldByName[s.name])} vendu(s)</Badge>
                  )}
                  {s.categoryName && <Badge tone="neutral">{s.categoryName}</Badge>}
                  <span className="text-xs font-black tabular-nums text-[#002d87] shrink-0">{money(s.price)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Detail quantity prompt ────────────────────────────────────────────────────
/**
 * La quantité d'un article vendu au détail, et les DEUX sorties qu'on lui donne :
 *
 *  • « Ajouter » — la quantité entre au panier, la note se compose article par
 *    article et se règle à la fin. C'est le chemin d'un client qui prend
 *    plusieurs choses.
 *  • « Encaisser » — la vente part immédiatement, seule, en espèces et au prix
 *    plein. C'est le chemin du client qui ne prend QUE ça : un aller simple,
 *    sans panier à valider derrière.
 *
 * Le second est de loin le plus courant au comptoir, mais il écrit une vente
 * définitive d'un seul geste : il garde donc sa propre couleur, pour qu'on ne
 * le touche jamais en croyant remplir le panier.
 */
function DetailQtyModal({ source, canSell, onClose, onConfirm, onSell }: {
  source: Source; canSell: boolean; onClose: () => void;
  onConfirm: (qty: number) => void; onSell: (qty: number) => void;
}) {
  // La quantité au détail démarre à zéro : le caissier saisit lui-même ce qu'il
  // vend au lieu de partir d'une unité déjà comptée.
  const [qty, setQty] = useState('');
  const value = Number(qty) || 0;
  // Selling more than the stock is allowed — the stock simply goes negative and
  // is recovered on the next purchase; we only inform the cashier.
  const tooMuch = value > source.avail;
  const amount = value * source.price;
  return (
    <Modal open onClose={onClose} icon={Package} size="md"
      title={source.name} subtitle={`Vente au détail — ${source.detailUnit} sur ${source.detailCapacity} ${source.detailUnit} par unité`}
      footer={
        /* Trois actions dans une boîte étroite : elles passent à la ligne au
           lieu de se comprimer sur l'écran d'un poste de caisse. */
        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-outline" onClick={() => onConfirm(value)} disabled={value <= 0}>
            <Plus className="w-4 h-4" /> Ajouter au panier
          </button>
          <button className="btn-secondary" onClick={() => onSell(value)} disabled={value <= 0 || !canSell}
            title={canSell ? 'Enregistre la vente tout de suite, sans passer par le panier'
              : "Vous n'avez pas le droit d'enregistrer une vente"}>
            {/* Le montant n'est PAS répété ici : il changerait de largeur à
                chaque chiffre tapé et ferait sauter la rangée de boutons. Il se
                lit en gros dans la case « Montant », juste au-dessus. */}
            <Wallet className="w-4 h-4" /> Encaisser
          </button>
        </div>
      }>
      <div className="space-y-4">
        <Field label={`Quantité à vendre (${source.detailUnit})`} required>
          <Input type="number" step="0.01" min={0} value={qty} onChange={e => setQty(e.target.value)} placeholder="0" autoFocus />
        </Field>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Disponible</p>
            <p className={`font-black tabular-nums ${source.avail <= 0 ? 'text-red-600' : 'text-slate-700'}`}>
              {formatQty(source.avail)} {source.detailUnit}
            </p>
          </div>
          {/* Le prix au détail, sous les yeux du caissier : c'est lui qu'on
              annonce au client, et il n'apparaissait nulle part dans la boîte. */}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Prix</p>
            <p className="font-black tabular-nums text-slate-700">
              {money(source.price)}<span className="text-[11px] font-bold text-slate-400"> / {source.detailUnit}</span>
            </p>
          </div>
          <div className="rounded-xl bg-[#002d87] p-3 col-span-2 sm:col-span-1">
            <p className="text-[10px] uppercase font-bold text-white/60">Montant</p>
            <p className="font-black text-[#FFB800] tabular-nums">{money(amount)}</p>
          </div>
        </div>
        {tooMuch && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Quantité supérieure au stock — le stock passera en négatif (rattrapé au prochain achat).
          </p>
        )}
        {/* Ce que font les deux boutons — dit une fois, en clair, pour qu'un
            encaissement direct ne soit jamais une surprise. */}
        <p className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-[11px] leading-relaxed text-slate-500">
          <strong className="text-slate-600">Ajouter au panier</strong> pour continuer la note du client.{' '}
          <strong className="text-slate-600">Encaisser</strong> enregistre la vente immédiatement — seule,
          en espèces, au prix plein et au client de passage — et elle part directement dans l'historique
          des ventes.
        </p>
      </div>
    </Modal>
  );
}

// ─── Open a work session ───────────────────────────────────────────────────────
/**
 * L'employé connecté ouvre SA session : son nom est imposé et il ne peut pas
 * ouvrir une caisse au nom d'un collègue. Seul l'administrateur garde le choix
 * de l'employé — c'est lui qui remet physiquement le fond de caisse au poste.
 */
function OpenSessionModal({ moduleKey, defaultName, workers, onClose }: {
  moduleKey: ModuleKey; defaultName: string;
  workers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { open, me, isAdmin } = useBizSessions(moduleKey);
  const [workerId, setWorkerId] = useState('');
  const [name, setName] = useState(defaultName);
  const [openingCash, setOpeningCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const myName = me.name || defaultName;

  const save = async () => {
    const picked = workers.find(w => w.id === workerId);
    // Employé : toujours lui-même. Admin : l'employé choisi, sinon son propre nom.
    const workerName = (isAdmin ? (picked?.name || name) : myName).trim();
    const ownerId = isAdmin ? picked?.id : me.id;
    if (!workerName) { toast.error("Indiquez le nom de l'employé"); return; }

    setBusy(true);
    const res = await open({
      workerId: ownerId,
      workerName,
      openingCash: Number(openingCash) || 0,
      notes,
    });
    setBusy(false);
    if (!res.ok) { toast.error(res.error || "Session non ouverte"); return; }
    toast.success('Session ouverte');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={PlayCircle} size="md"
      title="Ouvrir ma session de travail"
      subtitle="Votre nom et le fond de caisse que vous avez déjà en main"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Ouverture…' : 'Ouvrir la session'}
        </button>
      </>}>
      <div className="space-y-4">
        {isAdmin ? (
          <>
            <Field label="Employé" hint="La session appartiendra à cet employé : lui seul pourra vendre dedans et la clôturer.">
              <Select value={workerId} onChange={e => { setWorkerId(e.target.value); const w = workers.find(x => x.id === e.target.value); if (w) setName(w.name); }}>
                <option value="">— Saisir un nom libre —</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            {!workerId && (
              <Field label="Nom de l'employé" required>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nom d'utilisateur de l'employé" />
              </Field>
            )}
          </>
        ) : (
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 flex items-start gap-2">
            <User className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Session ouverte au nom de</p>
              <p className="font-black text-[#002d87]">{myName}</p>
              <p className="text-[11px] text-blue-800 mt-1">
                Cette session n'appartient qu'à vous : vous êtes le seul à y vendre et le seul à la clôturer.
              </p>
            </div>
          </div>
        )}
        <Field label="Fond de caisse à l'ouverture (DA)"
          hint="Argent que vous avez déjà en main. Il n'est jamais compté dans le théorique ni dans le décalage.">
          <Input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ─── Close a work session ──────────────────────────────────────────────────────
/**
 * Seul le propriétaire de la session la clôture. L'administrateur peut clôturer
 * celle qu'un employé a oubliée (supervision) — c'est écrit noir sur blanc dans
 * la fenêtre, et la base refuse tout autre cas.
 */
export function CloseSessionModal({ moduleKey, session, onClose }: {
  moduleKey: ModuleKey; session: BizSession; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const { currentUserRole } = useAppState();
  const { close, owns } = useBizSessions(moduleKey);
  // L'employé clôture en comptant simplement ses espèces ; le théorique et le
  // décalage restent réservés à l'administrateur.
  const isAdmin = currentUserRole === 'admin';
  const fig = figuresForSession(session, biz.state.sales);
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState(session.notes || '');
  const [busy, setBusy] = useState(false);

  const declared = Number(closingCash) || 0;
  // Théorique = encaissements en espèces de la session (le fond d'ouverture est exclu).
  const decalage = declared - fig.cash;
  const forSomeoneElse = !owns(session);

  const save = async () => {
    setBusy(true);
    const res = await close(session, {
      closingCash: declared,
      theoretical: fig.cash,
      credit: fig.credit,
      decalage,
      notes,
    });
    setBusy(false);
    if (!res.ok) { toast.error(res.error || 'Session non clôturée'); return; }
    toast.success('Session clôturée');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={StopCircle} size="lg"
      title={`Clôturer la session ${session.ref}`} subtitle={session.workerName}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Clôture…' : 'Clôturer la session'}
        </button>
      </>}>
      <div className="space-y-4">
        {forSomeoneElse && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Cette session appartient à <strong>{session.workerName}</strong>. Vous la clôturez en tant
              qu'administrateur : la clôture sera enregistrée à votre nom.
            </span>
          </div>
        )}
        {isAdmin ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Ventes</p><p className="font-black text-slate-700 tabular-nums">{fig.count}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Chiffre d'affaires</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(fig.total)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Théorique espèces</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(fig.cash)}</p></div>
              <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Crédits accordés</p><p className="font-black text-amber-600 tabular-nums text-sm">{money(fig.credit)}</p></div>
            </div>

            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 flex items-start gap-2">
              <Wallet className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Le fond de caisse d'ouverture ({money(session.openingCash)}) est exclu du théorique :
                l'employé ne doit que les {money(fig.cash)} encaissés pendant sa session.
                Les {money(fig.credit)} laissés en dette justifient l'écart correspondant.
              </span>
            </div>
          </>
        ) : (
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 flex items-start gap-2">
            <Wallet className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Comptez les espèces présentes dans la caisse et saisissez le montant ci-dessous.
              Le contrôle de la caisse (théorique et décalage) est réservé à l'administrateur.
            </span>
          </div>
        )}

        <Field label="Espèces comptées à la fermeture (DA)" required>
          <Input type="number" value={closingCash} onChange={e => setClosingCash(e.target.value)} placeholder="0" autoFocus />
        </Field>

        {isAdmin && (
          <div className={`rounded-2xl p-4 text-white ${Math.abs(decalage) < 0.01 ? 'bg-emerald-600' : decalage > 0 ? 'bg-[#003087]' : 'bg-red-600'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold opacity-90">Décalage (compté − théorique)</span>
              <span className="text-2xl font-black tabular-nums">{money(decalage)}</span>
            </div>
            <p className="text-[11px] opacity-80 mt-1">
              {Math.abs(decalage) < 0.01
                ? 'Caisse juste.'
                : decalage > 0 ? 'Excédent en caisse.' : "Manque en caisse à justifier."}
            </p>
          </div>
        )}

        <Field label="Notes / justification"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
