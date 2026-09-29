/**
 * ─── Gestion de stock ───────────────────────────────────────────────────────────
 * Catalogue et inventaire d'une partie, plus la DESTRUCTION des produits perdus
 * (périmés, cassés, volés…), sur le même principe que le comptoir :
 *
 *  • « Détruire » sur un produit retire la quantité du stock et enregistre une
 *    ligne dans l'historique des destructions, valorisée au PRIX D'ACHAT.
 *  • L'onglet « Historique destructions » liste ces pertes avec leur motif, leur
 *    coût et leur détail complet ; une destruction peut être récupérée (le
 *    produit revient en stock) ou supprimée.
 *  • Le coût des destructions descend dans la Caisse de la partie et dans les
 *    Rapports (bénéfice net = marge − dépenses − salaires − destructions).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Package, Plus, Boxes, AlertTriangle, CalendarClock, Wallet, Barcode, Printer, Tag, Layers,
  Flame, RotateCcw, Trash, User, Beaker, ShoppingBag, FileWarning, Upload, CloudOff, Loader2,
  RefreshCw, CheckCircle2, History, Scale, ScanLine, Hash, Car, Search,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizProduct, BizDestruction, formatQty, productRefLabel, productCarLabel,
} from '@/src/lib/bizConfig';
import { useBiz, useBizSync, useBizProductsSync } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  ProductDraft, DRAFT_STATUS_META, subscribeDrafts, getDraftsSnapshot,
  discardDraft, retryDraft, resolveDraft, failDraft, reconcileDrafts,
} from '@/src/lib/productDrafts';
import {
  PageHeader, StatCard, Badge, SearchInput, Select, ViewToggle, CardGrid, GlassCard,
  Table, Tabs, EmptyState, RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal,
  Field, Input, Textarea, money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { ProductModal, printBarcode, productMatches } from './_shared';
import BarcodeScannerModal from '@/src/components/BarcodeScannerModal';
import ProductHistoryModal from '@/src/components/biz/ProductHistoryModal';

/** Destructions belonging to the stock screen (legacy rows are comptoir ones). */
const isStockDestruction = (d: BizDestruction) => d.source === 'stock';

export default function ModuleStock({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'stock');
  const sync = useBizSync();
  /** Ce que la BASE a accepté du catalogue — la seule chose qui compte ici. */
  const catalogue = useBizProductsSync();
  const { currentUserName, currentModuleWorker, settings } = useAppState();
  const { products, categories, marques, destructions } = biz.state;

  /**
   * Les pièces détachées — références et véhicules compatibles — n'existent que
   * dans la partie Lavage & Vidange. La Cafétéria garde son écran inchangé.
   */
  const isLavage = moduleKey === 'lavage';

  const [tab, setTab] = useState<'catalogue' | 'destructions' | 'drafts'>('catalogue');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [mrq, setMrq] = useState('all');
  /** Nature du produit : tout, ce qui se vend, ou ce qui sert à fabriquer. */
  const [nature, setNature] = useState<'all' | 'sale' | 'raw'>('all');
  // Le catalogue s'ouvre en tableau : c'est la lecture la plus dense du stock,
  // celle qu'on veut par défaut quand on cherche un article et son reste.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizProduct | null>(null);
  const [viewing, setViewing] = useState<BizProduct | null>(null);
  /** Produit dont on consulte l'historique complet (achats, ventes, gains). */
  const [historyOf, setHistoryOf] = useState<BizProduct | null>(null);
  const [toDelete, setToDelete] = useState<BizProduct | null>(null);
  const [destroying, setDestroying] = useState<BizProduct | null>(null);
  const [viewingDestruction, setViewingDestruction] = useState<BizDestruction | null>(null);
  const [destructionToDelete, setDestructionToDelete] = useState<BizDestruction | null>(null);
  const [dPeriod, setDPeriod] = useState<Period>('all');
  const [dFrom, setDFrom] = useState(''); const [dTo, setDTo] = useState('');
  /** Recherche d'un produit en scannant son étiquette. */
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');

  const filtered = useMemo(() => {
    return products.filter(p =>
      // La recherche ne porte plus seulement sur le nom et le code-barres :
      // chaque RÉFÉRENCE de la pièce et chaque VÉHICULE qu'elle équipe y
      // entrent. C'est ainsi qu'on cherche une pièce détachée — « 7701478261 »
      // ou « clio 4 2015 », jamais « filtre à huile n°3 ».
      productMatches(p, search) &&
      (cat === 'all' || p.categoryId === cat) &&
      (mrq === 'all' || p.marqueId === mrq) &&
      (nature === 'all' || (nature === 'raw' ? !!p.isRawMaterial : !p.isRawMaterial)));
  }, [products, search, cat, mrq, nature]);

  // ── Destructions du stock ──────────────────────────────────────────────────
  const stockDestructions = useMemo(
    () => destructions.filter(isStockDestruction)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [destructions]);

  const destructionsInPeriod = useMemo(
    () => stockDestructions.filter(d => inPeriod(d.date, dPeriod, dFrom, dTo)),
    [stockDestructions, dPeriod, dFrom, dTo]);

  /** Coût réellement perdu : une destruction récupérée ne coûte plus rien. */
  const destroyedValue = useMemo(
    () => stockDestructions.reduce((s, d) => s + (d.recovered ? 0 : d.value), 0),
    [stockDestructions]);
  const destroyedValueInPeriod = destructionsInPeriod.reduce((s, d) => s + (d.recovered ? 0 : d.value), 0);

  const stats = useMemo(() => {
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    return {
      total: products.length,
      raw: products.filter(p => p.isRawMaterial).length,
      low: products.filter(p => p.currentQty <= p.minQty).length,
      // Vendus à découvert au point de vente : la quantité est passée sous zéro
      // et se rattrapera au prochain achat (−5 en stock + 15 reçus = 10).
      negative: products.filter(p => p.currentQty < 0).length,
      value: products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0),
      expiring: products.filter(p => p.hasExpiration && p.expirationDate && new Date(p.expirationDate) <= soon).length,
    };
  }, [products]);

  // ── Brouillons : les créations que le serveur n'a pas confirmées ───────────
  /**
   * Les brouillons vivent hors de React (dans `localStorage`), justement parce
   * que c'est le store qui peut échouer : on s'y abonne au lieu de les lire.
   */
  const allDrafts = useSyncExternalStore(subscribeDrafts, getDraftsSnapshot, getDraftsSnapshot);
  const drafts = useMemo(
    () => allDrafts
      .filter(d => d.moduleKey === moduleKey && d.status !== 'synced')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [allDrafts, moduleKey]);
  const [sendingDraft, setSendingDraft] = useState<string | null>(null);
  const [viewingDraft, setViewingDraft] = useState<ProductDraft | null>(null);
  const [draftToDiscard, setDraftToDiscard] = useState<ProductDraft | null>(null);

  const productIds = useMemo(() => new Set(products.map(p => p.id)), [products]);
  const storeSynced = !sync.pending && !sync.saving && !sync.error;

  /**
   * Une fiche est CONFIRMÉE quand sa ligne est en base. Depuis que les produits
   * ont leur propre table, cela se juge produit par produit : un brouillon n'est
   * plus retenu parce qu'une vente ou une dépense, ailleurs, attend son tour.
   * Tant que la table n'existe pas (migration non passée), c'est l'ancien
   * critère — « tout le blob est enregistré » — qui s'applique.
   */
  const isConfirmed = useCallback(
    (id: string) => (catalogue.relational ? !catalogue.pending.has(id) : storeSynced),
    [catalogue, storeSynced]);

  /** Fiches de CETTE partie en attente d'écriture (la file couvre les deux). */
  const pendingHere = useMemo(
    () => [...catalogue.pending].filter(id => productIds.has(id)).length,
    [catalogue.pending, productIds]);

  // Confronte les brouillons au catalogue à chaque fois que l'un des deux bouge :
  // ce qui est bien arrivé disparaît, ce qui manque est signalé.
  useEffect(() => {
    reconcileDrafts(moduleKey, productIds, isConfirmed);
  }, [moduleKey, productIds, isConfirmed]);

  /**
   * « Envoyer au stock » — remet le produit du brouillon dans le catalogue (s'il
   * n'y est plus) et n'efface le brouillon QUE si la base confirme.
   */
  const pushDraft = async (d: ProductDraft): Promise<boolean> => {
    setSendingDraft(d.id);
    retryDraft(d.id);
    try {
      // Déjà au catalogue : on RÉÉCRIT sa ligne (un second `add` en ferait un
      // doublon). Absent : on l'ajoute.
      const alreadyInCatalogue = products.some(p => p.id === d.product.id);
      const res = alreadyInCatalogue
        ? await biz.updateAndConfirm('products', d.product)
        : await biz.addAndConfirm('products', d.product);
      if (res.ok) { resolveDraft(d.id); return true; }
      failDraft(d.id, res.error);
      return false;
    } finally {
      setSendingDraft(null);
    }
  };

  const sendDraft = async (d: ProductDraft) => {
    const ok = await pushDraft(d);
    if (ok) toast.success(`« ${d.product.name} » est dans le catalogue`);
    else toast.error(`Toujours impossible d'enregistrer « ${d.product.name} »`, { duration: 7000 });
  };

  const sendAllDrafts = async () => {
    let sent = 0;
    for (const d of drafts) if (await pushDraft(d)) sent++;
    if (sent) toast.success(`${sent} produit(s) renvoyé(s) au catalogue`);
    if (sent < drafts.length) toast.error(`${drafts.length - sent} brouillon(s) toujours en échec`, { duration: 7000 });
  };

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p: BizProduct) => { setEditing(p); setShowForm(true); };
  const del = () => { if (toDelete) { biz.remove('products', toDelete.id); toast.success('Produit supprimé'); setToDelete(null); } };

  /**
   * Détruire une quantité d'un produit : elle quitte le stock et devient une
   * perte valorisée au prix d'achat, tracée avec son motif et son auteur.
   */
  const doDestroy = (qty: number, reason: string, notes: string) => {
    if (!destroying) return;
    const amount = Math.min(destroying.currentQty, Math.max(0, qty));
    if (amount <= 0) { toast.error('Quantité à détruire requise'); return; }
    const unitPrice = destroying.purchasePrice || 0;
    biz.update('products', { ...destroying, currentQty: destroying.currentQty - amount });
    biz.add('destructions', {
      id: newId(),
      source: 'stock',
      productId: destroying.id,
      productName: destroying.name,
      categoryName: destroying.categoryName,
      qty: amount,
      unit: destroying.unit,
      unitPrice,
      value: amount * unitPrice,
      reason: reason.trim() || undefined,
      notes: notes.trim() || undefined,
      date: new Date().toISOString(),
      createdBy: currentModuleWorker?.name || currentUserName || 'Admin',
      recovered: false,
    } as BizDestruction);
    toast.success(`Destruction enregistrée — ${money(amount * unitPrice)} de perte`);
    setDestroying(null);
  };

  /** Erreur de saisie : le produit détruit revient dans le stock. */
  const recoverDestruction = (d: BizDestruction) => {
    const product = products.find(p => p.id === d.productId) || products.find(p => p.name === d.productName);
    if (product) biz.update('products', { ...product, currentQty: product.currentQty + d.qty });
    biz.update('destructions', { ...d, recovered: true, recoveredAt: new Date().toISOString() });
    toast.success(product ? `${d.qty} ${d.unit || ''} remis en stock` : 'Destruction annulée (produit introuvable)');
  };

  const deleteDestruction = () => {
    if (!destructionToDelete) return;
    biz.remove('destructions', destructionToDelete.id);
    toast.success('Ligne de destruction supprimée');
    setDestructionToDelete(null);
  };

  const lowBadge = (p: BizProduct) => p.currentQty <= p.minQty;
  /**
   * Stock à découvert : le point de vente a vendu plus que ce qui restait (un
   * produit à zéro, une fiche technique servie sans tous ses ingrédients). La
   * quantité s'affiche telle quelle, avec son « − » : c'est ce que la partie
   * doit racheter pour revenir à l'équilibre.
   */
  const negative = (p: BizProduct) => p.currentQty < 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Package} title="Gestion de stock" subtitle={`${cfg.label} — catalogue & inventaire`}
        actions={perm.creer ? <button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nouveau produit</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Boxes} label="Produits" value={stats.total} tone="blue"
          sub={stats.raw ? `dont ${stats.raw} matière(s) première(s)` : undefined} />
        <StatCard icon={AlertTriangle} label="Stock bas" value={stats.low} tone="red"
          sub={stats.negative ? `dont ${stats.negative} en négatif` : "≤ seuil d'alerte"} />
        <StatCard icon={Wallet} label="Valeur du stock" value={money(stats.value)} tone="green" />
        <StatCard icon={CalendarClock} label="Expirent bientôt" value={stats.expiring} tone="amber" sub="≤ 7 jours" />
        <StatCard icon={Flame} label="Valeur détruite" value={money(destroyedValue)} tone="red"
          sub={`${stockDestructions.filter(d => !d.recovered).length} destruction(s)`} />
      </div>

      {/* Une création qui n'est pas arrivée jusqu'à la base se voit ici, tout
          de suite — plus jamais un « Produit créé » qui ne l'était pas. */}
      {(drafts.length > 0 || catalogue.error || sync.error) && tab !== 'drafts' && (
        <button onClick={() => setTab('drafts')}
          className="w-full text-left rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-3 hover:bg-amber-100 transition-colors">
          <CloudOff className="w-5 h-5 text-amber-600 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-amber-800">
              {drafts.length > 0
                ? `${drafts.length} produit(s) non enregistré(s) en base`
                : catalogue.error ? 'Le catalogue n\'a pas pu être écrit'
                  : 'Enregistrement en échec'}
            </span>
            <span className="block text-xs text-amber-700">
              {catalogue.error || sync.error || 'Ouvrez les brouillons pour les renvoyer au catalogue.'}
            </span>
          </span>
          <span className="btn-secondary !py-2 !px-3 text-xs shrink-0">Voir les brouillons</span>
        </button>
      )}

      <Tabs
        tabs={[
          { id: 'catalogue', label: 'Catalogue', icon: Package },
          { id: 'destructions', label: `Historique destructions${stockDestructions.length ? ` (${stockDestructions.length})` : ''}`, icon: Flame },
          { id: 'drafts', label: `Brouillons${drafts.length ? ` (${drafts.length})` : ''}`, icon: FileWarning },
        ]}
        active={tab}
        onChange={id => setTab(id as 'catalogue' | 'destructions' | 'drafts')}
      />

      {tab === 'catalogue' && <>
      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch}
          placeholder={isLavage ? 'Nom, code-barres, référence ou véhicule…' : 'Nom ou code-barres…'} />
        {/* Scanner l'article en rayon plutôt que de chercher son nom : le code lu
            ouvre directement sa fiche, et dit franchement quand aucun produit ne
            le porte — c'est ainsi qu'on repère une étiquette jamais enregistrée. */}
        <button className="btn-secondary shrink-0" onClick={() => setScanning(true)}
          title="Scanner un code-barres avec la caméra">
          <ScanLine className="w-4 h-4" /> Scanner
        </button>
        <Select value={cat} onChange={e => setCat(e.target.value)} className="!w-auto min-w-[160px]">
          <option value="all">Toutes catégories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={mrq} onChange={e => setMrq(e.target.value)} className="!w-auto min-w-[150px]">
          <option value="all">Toutes marques</option>
          {marques.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Select value={nature} onChange={e => setNature(e.target.value as 'all' | 'sale' | 'raw')} className="!w-auto min-w-[180px]">
          <option value="all">Toute nature</option>
          <option value="sale">Produits de vente</option>
          <option value="raw">Matières premières</option>
        </Select>
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {/* Ce que la barre accepte réellement — sans cette ligne, personne ne
          devine qu'on peut y taper une plaque de référence ou « clio 4 2015 ». */}
      {isLavage && (
        <p className="-mt-1 text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1 font-semibold text-slate-500">
            <Search className="w-3.5 h-3.5" /> La recherche accepte aussi :
          </span>
          <span className="inline-flex items-center gap-1"><Hash className="w-3 h-3 text-violet-500" /> une référence — « 7701478261 », avec ou sans ses espaces</span>
          <span className="inline-flex items-center gap-1"><Car className="w-3 h-3 text-blue-500" /> un véhicule — « renault clio 4 », « clio 2015 auto »</span>
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={nature === 'raw' ? Beaker : Package}
          title={nature === 'raw' ? 'Aucune matière première' : 'Aucun produit'}
          message={nature === 'raw'
            ? 'Activez « Matière première » sur un produit pour le réserver à la production et le retirer du point de vente.'
            : 'Ajoutez votre premier produit au catalogue.'}
          action={perm.creer ? <button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nouveau produit</button> : undefined} />
      ) : view === 'grid' ? (
        <CardGrid>
          {filtered.map(p => (
            <GlassCard key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-800 truncate">{p.name}</h3>
                  <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5"><Barcode className="w-3 h-3" />{p.barcode || '—'}</p>
                </div>
                {negative(p)
                  ? <Badge tone="danger"><AlertTriangle className="w-3 h-3" />Stock négatif</Badge>
                  : lowBadge(p) ? <Badge tone="danger">Stock bas</Badge> : <Badge tone="success">En stock</Badge>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {p.isRawMaterial && <Badge tone="warning"><Beaker className="w-3 h-3" />Matière première</Badge>}
                {p.categoryName && <Badge tone="primary"><Layers className="w-3 h-3" />{p.categoryName}</Badge>}
                {p.marqueName && <Badge tone="neutral"><Tag className="w-3 h-3" />{p.marqueName}</Badge>}
                {!!p.refs?.length && <Badge tone="info"><Hash className="w-3 h-3" />{p.refs.length} réf.</Badge>}
                {!!p.cars?.length && <Badge tone="info"><Car className="w-3 h-3" />{p.cars.length} véhicule(s)</Badge>}
              </div>

              {/* Les deux premières références et les deux premiers véhicules,
                  lisibles sans ouvrir la fiche : c'est ce qu'on vérifie du
                  regard quand un client annonce sa voiture au téléphone. */}
              {!!p.refs?.length && (
                <p className="mt-2 text-[11px] text-violet-700 font-mono leading-tight break-words">
                  {p.refs.slice(0, 3).map(productRefLabel).join(' · ')}
                  {p.refs.length > 3 ? ` +${p.refs.length - 3}` : ''}
                </p>
              )}
              {!!p.cars?.length && (
                <p className="mt-1 text-[11px] text-blue-700 font-semibold leading-tight break-words">
                  {p.cars.slice(0, 2).map(productCarLabel).join(' · ')}
                  {p.cars.length > 2 ? ` +${p.cars.length - 2}` : ''}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-xl bg-slate-50 p-2.5">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Principal</p>
                  <p className="font-black text-slate-700 tabular-nums">{formatQty(p.principalQty)} <span className="text-xs font-medium text-slate-400">{p.unit}</span></p>
                </div>
                <div className={`rounded-xl p-2.5 ${lowBadge(p) ? 'bg-red-50' : 'bg-emerald-50'}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Reste</p>
                  <p className={`font-black tabular-nums ${lowBadge(p) ? 'text-red-600' : 'text-emerald-600'}`}>{formatQty(p.currentQty)} <span className="text-xs font-medium text-slate-400">{p.unit}</span></p>
                </div>
              </div>
              {negative(p) && (
                <p className="mt-2 text-[11px] font-semibold text-red-600 flex items-start gap-1 leading-tight">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  Vendu à découvert au point de vente — {formatQty(-p.currentQty)} {p.unit || ''} à
                  racheter pour revenir à zéro.
                </p>
              )}
              {/* Une matière première n'a pas de prix de vente : ce qui compte,
                  c'est ce qu'elle a coûté. */}
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-slate-400">{p.isRawMaterial ? "Prix d'achat" : 'Prix vente'}</span>
                <span className="font-black text-[#002d87] tabular-nums">
                  {money(p.isRawMaterial ? p.purchasePrice : p.salePrice)}
                </span>
              </div>
              {p.isRawMaterial && (
                <p className="mt-1.5 text-[11px] font-semibold text-amber-600 flex items-center gap-1">
                  <ShoppingBag className="w-3 h-3 shrink-0" /> Masquée au point de vente
                </p>
              )}
              {p.hasExpiration && p.expirationDate && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 font-semibold">
                  <CalendarClock className="w-3.5 h-3.5" /> Expire le {formatDate(p.expirationDate)}
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">Créé le {formatDate(p.createdAt)}</span>
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  <ActionBtn icon={Printer} tone="slate" title="Imprimer l'étiquette code-barres" onClick={() => printBarcode(p)} />
                  <ActionBtn icon={History} tone="slate" title="Historique — achats, ventes & gains" onClick={() => setHistoryOf(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => openEdit(p)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </div>
              {perm.modifier && (
                <button onClick={() => setDestroying(p)} disabled={p.currentQty <= 0}
                  title={p.currentQty <= 0 ? 'Aucune quantité en stock à détruire' : 'Retirer du stock une quantité perdue'}
                  className="w-full mt-3 py-2 rounded-xl bg-red-50 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <Flame className="w-4 h-4" /> Destruction
                </button>
              )}
            </GlassCard>
          ))}
        </CardGrid>
      ) : (
        <Table head={<>
          {/* Ordre voulu pour le stock : le produit, puis les actions à portée de
              main, puis les deux chiffres qu'on lit en premier — le reste et le
              prix de vente — et enfin le reste des colonnes. */}
          <th className="table-head">Produit</th><th className="table-head">Actions</th>
          <th className="table-head">Reste</th><th className="table-head">Prix vente</th>
          <th className="table-head">Catégorie</th><th className="table-head">Marque</th>
          <th className="table-head">Principal</th><th className="table-head">État</th>
        </>}>
          {filtered.map(p => (
            <tr key={p.id}>
              <td className="table-cell">
                <div className="font-bold text-slate-700 flex items-center gap-1.5">
                  {p.name}
                  {p.isRawMaterial && (
                    <span title="Matière première — masquée au point de vente" className="shrink-0">
                      <Beaker className="w-3.5 h-3.5 text-amber-500" />
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">{p.barcode || '—'}</div>
                {!!p.refs?.length && (
                  <div className="text-[11px] text-violet-600 font-mono truncate max-w-[220px]"
                    title={p.refs.map(productRefLabel).join(' · ')}>
                    {p.refs.map(productRefLabel).join(' · ')}
                  </div>
                )}
                {!!p.cars?.length && (
                  <div className="text-[11px] text-blue-600 font-semibold truncate max-w-[220px]"
                    title={p.cars.map(productCarLabel).join(' · ')}>
                    {p.cars.map(productCarLabel).join(' · ')}
                  </div>
                )}
              </td>
              <td className="table-cell">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  <ActionBtn icon={Printer} tone="slate" title="Imprimer l'étiquette code-barres" onClick={() => printBarcode(p)} />
                  <ActionBtn icon={History} tone="slate" title="Historique — achats, ventes & gains" onClick={() => setHistoryOf(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => openEdit(p)} />}
                  {perm.modifier && p.currentQty > 0 && <ActionBtn icon={Flame} tone="red" title="Destruction" onClick={() => setDestroying(p)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </td>
              <td className={`table-cell tabular-nums font-bold ${negative(p) ? 'text-red-600' : ''}`}
                title={negative(p) ? `Vendu à découvert — ${formatQty(-p.currentQty)} ${p.unit || ''} à racheter` : undefined}>
                {formatQty(p.currentQty)} {p.unit}
              </td>
              <td className="table-cell tabular-nums">
                {p.isRawMaterial
                  ? <span className="text-slate-400">— <span className="text-[11px]">matière première</span></span>
                  : money(p.salePrice)}
              </td>
              <td className="table-cell">{p.categoryName || '—'}</td>
              <td className="table-cell">{p.marqueName || '—'}</td>
              <td className="table-cell tabular-nums">{formatQty(p.principalQty)} {p.unit}</td>
              <td className="table-cell">
                {negative(p)
                  ? <Badge tone="danger">Négatif</Badge>
                  : lowBadge(p) ? <Badge tone="danger">Bas</Badge> : <Badge tone="success">OK</Badge>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      </>}

      {/* ── Historique des destructions ─────────────────────────────────────── */}
      {tab === 'destructions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Flame} label="Destructions (période)" value={destructionsInPeriod.length} tone="red" />
            <StatCard icon={Wallet} label="Coût de la période" value={money(destroyedValueInPeriod)} tone="amber" />
            <StatCard icon={Flame} label="Total détruit" value={money(destroyedValue)} tone="red" sub="hors lignes récupérées" />
            <StatCard icon={RotateCcw} label="Récupérées" value={stockDestructions.filter(d => d.recovered).length} tone="green" />
          </div>

          <div className="card-glass p-4">
            <PeriodFilter period={dPeriod} onChange={setDPeriod} from={dFrom} to={dTo} onFrom={setDFrom} onTo={setDTo} />
          </div>

          {destructionsInPeriod.length === 0 ? (
            <EmptyState icon={Flame} title="Aucune destruction"
              message="Utilisez le bouton « Destruction » sur un produit du catalogue pour retirer du stock une quantité perdue (périmée, cassée, volée…)." />
          ) : (
            <div className="card-glass overflow-hidden">
              <Table head={<>
                <th className="table-head">Date</th><th className="table-head">Produit</th>
                <th className="table-head">Quantité</th><th className="table-head">Coût unitaire</th>
                <th className="table-head">Motif</th><th className="table-head">Agent</th>
                <th className="table-head">État</th>
                <th className="table-head text-right">Coût</th>
                <th className="table-head text-right">Actions</th>
              </>}>
                {destructionsInPeriod.map(d => (
                  <tr key={d.id} className={d.recovered ? 'opacity-60' : undefined}>
                    <td className="table-cell whitespace-nowrap">{formatDate(d.date)}</td>
                    <td className="table-cell">
                      <div className="font-bold text-slate-700">{d.productName}</div>
                      {d.categoryName && <div className="text-[11px] text-slate-400">{d.categoryName}</div>}
                    </td>
                    <td className="table-cell tabular-nums">{d.qty} <span className="text-xs text-slate-400">{d.unit}</span></td>
                    <td className="table-cell tabular-nums text-slate-500">{money(d.unitPrice)}</td>
                    <td className="table-cell text-slate-500 max-w-[200px]">{d.reason || '—'}</td>
                    <td className="table-cell text-slate-500">{d.createdBy || '—'}</td>
                    <td className="table-cell">{d.recovered ? <Badge tone="success">Récupéré</Badge> : <Badge tone="danger">Détruit</Badge>}</td>
                    <td className={`table-cell text-right tabular-nums font-bold ${d.recovered ? 'text-slate-400 line-through' : 'text-red-600'}`}>
                      {money(d.value)}
                    </td>
                    <td className="table-cell text-right">
                      <RowActions>
                        <ActionBtn icon={Eye} tone="blue" title="Détails" onClick={() => setViewingDestruction(d)} />
                        {perm.modifier && !d.recovered && (
                          <ActionBtn icon={RotateCcw} tone="green" title="Récupérer (remettre en stock)" onClick={() => recoverDestruction(d)} />
                        )}
                        {perm.supprimer && (
                          <ActionBtn icon={Trash} tone="red" title="Supprimer la ligne" onClick={() => setDestructionToDelete(d)} />
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </Table>
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {destructionsInPeriod.length} ligne(s) — le coût des destructions est déduit du résultat de la partie.
                </span>
                <span className="font-black tabular-nums text-red-600">{money(destroyedValueInPeriod)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Brouillons : les créations que le serveur n'a pas confirmées ────── */}
      {tab === 'drafts' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 flex flex-wrap items-start gap-3">
            <FileWarning className="w-5 h-5 text-[#003087] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-700">À quoi sert cet onglet</p>
              <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                Chaque produit créé est d'abord écrit dans ce poste, puis envoyé à la base —
                sa propre ligne, quelques centaines d'octets, confirmée en une fraction de
                seconde. Tant que la base n'a pas confirmé, la saisie reste ici : réseau
                coupé, serveur injoignable, session expirée. Rien n'est perdu :
                « Envoyer au stock » la remet dans le catalogue et la renvoie.
              </p>
            </div>
            {drafts.length > 0 && perm.creer && (
              <button className="btn-primary !py-2 !px-4 text-xs shrink-0"
                onClick={sendAllDrafts} disabled={!!sendingDraft}>
                <Upload className="w-4 h-4" /> Tout envoyer au stock
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={FileWarning} label="Brouillons" value={drafts.length} tone="amber"
              sub="créations non confirmées" />
            <StatCard icon={CloudOff} label="En échec" value={drafts.filter(d => d.status === 'failed').length} tone="red" />
            <StatCard icon={AlertTriangle} label="Perdus" value={drafts.filter(d => d.status === 'lost').length} tone="red"
              sub="absents du catalogue" />
            <StatCard icon={catalogue.error ? CloudOff : CheckCircle2}
              label="Catalogue en base"
              value={catalogue.saving ? 'Envoi…'
                : catalogue.error ? 'En échec'
                  : pendingHere ? `${pendingHere} en attente` : 'À jour'}
              tone={catalogue.error ? 'red' : catalogue.saving || pendingHere ? 'amber' : 'green'}
              sub={catalogue.relational
                ? 'écriture directe — une ligne par produit'
                : 'via l\'état partagé (migration non passée)'} />
          </div>

          {catalogue.error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
              <CloudOff className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-red-700">La base refuse l'écriture des produits</p>
                <p className="text-xs text-red-600 mt-0.5 break-words">{catalogue.error}</p>
                <p className="text-[11px] text-red-500 mt-1">
                  Les fiches en attente repartent d'elles-mêmes ; « Envoyer au stock » force un essai.
                </p>
              </div>
            </div>
          )}

          {/* Le reste de la partie (ventes, achats, destructions, caisse…) voyage
              encore dans l'état partagé. Son échec ne retient PLUS les produits,
              mais il doit rester visible : ces données-là, elles, attendent. */}
          {sync.error && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <CloudOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-amber-800">
                  Le reste des données de la partie n'est pas enregistré
                </p>
                <p className="text-xs text-amber-700 mt-0.5 break-words">{sync.error}</p>
                <p className="text-[11px] text-amber-600 mt-1">
                  Ventes, achats, destructions et caisse — le catalogue, lui, est écrit à part.
                </p>
              </div>
              <button className="btn-secondary !py-2 !px-3 text-xs shrink-0" onClick={() => sync.flush()}>
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            </div>
          )}

          {drafts.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Aucun brouillon en attente"
              message="Tous les produits créés depuis ce poste ont été confirmés par le serveur." />
          ) : (
            <CardGrid>
              {drafts.map(d => {
                const meta = DRAFT_STATUS_META[d.status as keyof typeof DRAFT_STATUS_META];
                const inCatalogue = productIds.has(d.product.id);
                const busy = sendingDraft === d.id;
                return (
                  <GlassCard key={d.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-black text-slate-800 truncate">{d.product.name}</h3>
                        <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                          <Barcode className="w-3 h-3" />{d.product.barcode || '—'}
                        </p>
                      </div>
                      <Badge tone={d.status === 'pending' ? 'warning' : 'danger'}>{meta?.label || d.status}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {d.product.isRawMaterial && <Badge tone="warning"><Beaker className="w-3 h-3" />Matière première</Badge>}
                      {d.product.categoryName && <Badge tone="primary"><Layers className="w-3 h-3" />{d.product.categoryName}</Badge>}
                      <Badge tone={inCatalogue ? 'info' : 'danger'}>
                        {inCatalogue ? 'Dans le catalogue' : 'Absent du catalogue'}
                      </Badge>
                      {d.origin === 'purchase' && <Badge tone="neutral">Saisi depuis un achat</Badge>}
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <p className="text-[10px] uppercase font-bold text-slate-400">Quantité</p>
                        <p className="font-black text-slate-700 tabular-nums">
                          {formatQty(d.product.principalQty)} <span className="text-xs font-medium text-slate-400">{d.product.unit}</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <p className="text-[10px] uppercase font-bold text-slate-400">
                          {d.product.isRawMaterial ? "Prix d'achat" : 'Prix vente'}
                        </p>
                        <p className="font-black text-[#002d87] tabular-nums">
                          {money(d.product.isRawMaterial ? d.product.purchasePrice : d.product.salePrice)}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-[11px] text-slate-500 leading-snug">{meta?.hint}</p>
                    {d.error && (
                      <p className="mt-1.5 text-[11px] font-semibold text-red-600 break-words leading-snug">{d.error}</p>
                    )}
                    <p className="mt-2 text-[11px] text-slate-400">
                      Saisi le {formatDate(d.createdAt)}{d.createdBy ? ` par ${d.createdBy}` : ''} • {d.attempts} tentative(s)
                    </p>

                    {perm.creer && (
                      <button onClick={() => sendDraft(d)} disabled={busy || !!sendingDraft}
                        title="Remettre ce produit dans le catalogue et l'enregistrer sur le serveur"
                        className="w-full mt-3 py-2 rounded-xl bg-[#003087] text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-[#002d87] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {busy
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Envoi…</>
                          : <><Upload className="w-4 h-4" /> Envoyer au stock</>}
                      </button>
                    )}
                    <div className="flex items-center justify-end mt-2">
                      <RowActions>
                        <ActionBtn icon={Eye} tone="blue" title="Détails de la saisie" onClick={() => setViewingDraft(d)} />
                        <ActionBtn icon={Trash} tone="red" title="Abandonner ce brouillon" onClick={() => setDraftToDiscard(d)} />
                      </RowActions>
                    </div>
                  </GlassCard>
                );
              })}
            </CardGrid>
          )}
        </div>
      )}

      <ProductModal biz={biz} open={showForm} onClose={() => setShowForm(false)} initial={editing} />

      {/* Scanner du catalogue : le code lu ouvre la fiche du produit. S'il
          n'existe pas, il reste dans la recherche — l'écran vide dit alors
          exactement quelle étiquette n'a jamais été enregistrée. */}
      <BarcodeScannerModal
        open={scanning}
        title="Scanner un produit"
        subtitle="Le code lu ouvre la fiche du produit"
        lastResult={scanNote}
        onClose={() => setScanning(false)}
        onDetect={code => {
          const clean = code.trim();
          const found = products.find(p => (p.barcode || '').trim() === clean);
          setSearch(clean);
          if (!found) {
            setScanNote(`Code ${clean} inconnu — aucun produit du catalogue ne le porte.`);
            toast.error(`Code ${clean} inconnu`);
            return false;
          }
          setScanNote('');
          setScanning(false);
          setViewing(found);
          return true;
        }}
      />

      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Package} size="lg"
        title={viewing?.name || ''} subtitle="Détails du produit">
        {viewing && (
          <div className="space-y-4">
            {negative(viewing) && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold text-sm">
                  Stock négatif — {formatQty(-viewing.currentQty)} {viewing.unit || ''} vendu(s) à
                  découvert au point de vente. Le prochain achat remettra le compte à l'équilibre.
                </span>
              </div>
            )}
            {viewing.isRawMaterial && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-amber-700">
                <Beaker className="w-4 h-4 shrink-0" />
                <span className="font-semibold text-sm">
                  Matière première — sert à la production et n'apparaît pas au point de vente.
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Nature', viewing.isRawMaterial ? 'Matière première' : 'Produit de vente'],
                ['Code-barres', viewing.barcode || '—'], ['Catégorie', viewing.categoryName || '—'],
                ['Marque', viewing.marqueName || '—'], ['Unité', viewing.unit || '—'],
                ['Quantité principale', `${formatQty(viewing.principalQty)} ${viewing.unit}`], ['Reste en stock', `${formatQty(viewing.currentQty)} ${viewing.unit}`],
                ['Seuil d\'alerte', `${formatQty(viewing.minQty)} ${viewing.unit}`], ['Prix d\'achat', money(viewing.purchasePrice)],
                ['Prix de vente', money(viewing.salePrice)], ['Créé le', formatDate(viewing.createdAt)],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
                  <p className="font-bold text-slate-700 text-sm">{v}</p>
                </div>
              ))}
            </div>
            {/* Coût moyen pondéré — n'apparaît que sur les produits déjà reçus
                par un achat au coût moyen. Le dernier prix payé est montré à
                côté : ce ne sont pas la même information, et les confondre fait
                valoriser le stock à un prix qui n'a jamais été payé en moyenne. */}
            {viewing.averageCost !== undefined && (
              <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
                <p className="text-[10px] uppercase font-black text-violet-800 flex items-center gap-1.5 mb-2">
                  <Scale className="w-3.5 h-3.5" /> Valorisation au coût moyen pondéré
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white border border-violet-100 p-2.5">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Coût moyen d'achat</p>
                    <p className="font-black text-violet-700 tabular-nums text-sm">{money(viewing.averageCost)}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 p-2.5">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Dernier prix payé</p>
                    <p className="font-black text-slate-700 tabular-nums text-sm">
                      {viewing.lastPurchasePrice !== undefined ? money(viewing.lastPurchasePrice) : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 p-2.5">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Valeur du stock</p>
                    <p className="font-black text-slate-700 tabular-nums text-sm">
                      {money(viewing.currentQty * viewing.averageCost)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {/* ── Les références de la pièce ─────────────────────────────────
                Chacune retrouve le produit dans la recherche du stock, d'un
                achat et du point de vente. */}
            {!!viewing.refs?.length && (
              <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
                <p className="text-[10px] uppercase font-black text-violet-800 flex items-center gap-1.5 mb-2">
                  <Hash className="w-3.5 h-3.5" /> Références ({viewing.refs.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {viewing.refs.map(r => (
                    <span key={r.id}
                      className="px-2.5 py-1 rounded-lg bg-white border border-violet-200 text-[11px] font-mono font-bold text-violet-700"
                      title={r.note || undefined}>
                      {productRefLabel(r)}{r.note ? ` · ${r.note}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Les véhicules que la pièce équipe ──────────────────────────
                Ce que le client annonce au comptoir, et donc ce qu'il faut
                pouvoir confirmer d'un coup d'œil. */}
            {!!viewing.cars?.length && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                <p className="text-[10px] uppercase font-black text-blue-800 flex items-center gap-1.5 mb-2">
                  <Car className="w-3.5 h-3.5" /> Véhicules compatibles ({viewing.cars.length})
                </p>
                <div className="space-y-1.5">
                  {viewing.cars.map(c => (
                    <div key={c.id} className="rounded-lg bg-white border border-blue-100 px-2.5 py-1.5">
                      <p className="text-[12px] font-bold text-blue-800">{productCarLabel(c) || '—'}</p>
                      {c.description && <p className="text-[11px] text-slate-500">{c.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewing.description && <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Description</p><p className="text-sm text-slate-600">{viewing.description}</p></div>}
            {viewing.hasExpiration && viewing.expirationDate && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-amber-700">
                <CalendarClock className="w-4 h-4" /> <span className="font-semibold text-sm">Expire le {formatDate(viewing.expirationDate)}</span>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-outline" onClick={() => printBarcode(viewing)} disabled={!viewing.barcode}
                title={viewing.barcode ? "Aperçu et impression de l'étiquette 40 × 20 mm" : 'Ce produit n’a pas de code-barres'}>
                <Printer className="w-4 h-4" /> Étiquette code-barres
              </button>
              <button className="btn-outline" onClick={() => { const p = viewing; setViewing(null); setHistoryOf(p); }}>
                <History className="w-4 h-4" /> Historique
              </button>
              {perm.modifier && <button className="btn-secondary" onClick={() => { setViewing(null); openEdit(viewing); }}><Edit2 className="w-4 h-4" /> Modifier</button>}
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!toDelete} title="Supprimer le produit" message={`Voulez-vous supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />

      {/* Détail complet d'un brouillon — la saisie telle qu'elle a été faite. */}
      <Modal open={!!viewingDraft} onClose={() => setViewingDraft(null)} icon={FileWarning} size="lg"
        title={viewingDraft?.product.name || ''} subtitle="Brouillon — saisie non confirmée par le serveur">
        {viewingDraft && (
          <div className="space-y-4">
            <div className={`rounded-xl border p-3 flex items-start gap-2 ${
              viewingDraft.status === 'pending' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              <CloudOff className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-semibold text-sm">
                {DRAFT_STATUS_META[viewingDraft.status as keyof typeof DRAFT_STATUS_META]?.hint}
                {viewingDraft.error ? ` — ${viewingDraft.error}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Nature', viewingDraft.product.isRawMaterial ? 'Matière première' : 'Produit de vente'],
                ['Code-barres', viewingDraft.product.barcode || '—'],
                ['Catégorie', viewingDraft.product.categoryName || '—'],
                ['Marque', viewingDraft.product.marqueName || '—'],
                ['Unité', viewingDraft.product.unit || '—'],
                ['Quantité principale', `${formatQty(viewingDraft.product.principalQty)} ${viewingDraft.product.unit || ''}`],
                ['Seuil d\'alerte', `${formatQty(viewingDraft.product.minQty)} ${viewingDraft.product.unit || ''}`],
                ['Prix d\'achat', money(viewingDraft.product.purchasePrice)],
                ['Prix de vente', money(viewingDraft.product.salePrice)],
                ['Vente au détail', viewingDraft.product.sellByDetail
                  ? `${formatQty(viewingDraft.product.detailCapacity || 0)} ${viewingDraft.product.detailUnit || ''}` : 'Non'],
                ['Saisi le', formatDate(viewingDraft.createdAt)],
                ['Saisi par', viewingDraft.createdBy || '—'],
                ['Provenance', viewingDraft.origin === 'purchase' ? 'Formulaire d\'achat' : 'Gestion de stock'],
                ['Tentatives', String(viewingDraft.attempts)],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
                  <p className="font-bold text-slate-700 text-sm break-words">{v}</p>
                </div>
              ))}
            </div>
            {viewingDraft.product.description && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] uppercase font-bold text-slate-400">Description</p>
                <p className="text-sm text-slate-600">{viewingDraft.product.description}</p>
              </div>
            )}
            {perm.creer && (
              <div className="flex justify-end">
                <button className="btn-primary" disabled={!!sendingDraft}
                  onClick={() => { const d = viewingDraft; setViewingDraft(null); sendDraft(d); }}>
                  <Upload className="w-4 h-4" /> Envoyer au stock
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Confirm open={!!draftToDiscard} title="Abandonner ce brouillon"
        message={`Le produit « ${draftToDiscard?.product.name} » ne sera plus proposé au renvoi. ${
          draftToDiscard && productIds.has(draftToDiscard.product.id)
            ? 'Il reste dans le catalogue de ce poste.'
            : 'Sa saisie sera définitivement perdue.'}`}
        onConfirm={() => { if (draftToDiscard) discardDraft(draftToDiscard.id); setDraftToDiscard(null); toast.success('Brouillon abandonné'); }}
        onCancel={() => setDraftToDiscard(null)} />

      {/* Tout ce qui est arrivé à un produit : chaque achat, chaque vente, chaque
          perte — avec le bon d'origine consultable ligne par ligne. */}
      {historyOf && (
        <ProductHistoryModal product={historyOf} state={biz.state} settings={settings}
          onClose={() => setHistoryOf(null)} />
      )}

      {destroying && <DestroyStockModal product={destroying} onClose={() => setDestroying(null)} onConfirm={doDestroy} />}
      {viewingDestruction && <DestructionDetail destruction={viewingDestruction} onClose={() => setViewingDestruction(null)} />}
      <Confirm open={!!destructionToDelete} title="Supprimer la ligne de destruction"
        message={`Retirer définitivement la destruction de « ${destructionToDelete?.productName} » (${money(destructionToDelete?.value || 0)}) de l'historique ? Le stock n'est pas modifié — utilisez « Récupérer » pour rendre la quantité.`}
        onConfirm={deleteDestruction} onCancel={() => setDestructionToDelete(null)} />
    </div>
  );
}

// ─── Destruction d'une quantité du stock ───────────────────────────────────────
/**
 * La perte est valorisée au PRIX D'ACHAT du produit : c'est ce que la
 * marchandise a réellement coûté, et donc ce que la partie perd — le montant
 * qui sera déduit de son résultat dans la Caisse et les Rapports.
 */
function DestroyStockModal({
  product, onClose, onConfirm,
}: {
  product: BizProduct;
  onClose: () => void;
  onConfirm: (qty: number, reason: string, notes: string) => void;
}) {
  const [qtyStr, setQtyStr] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const qty = Math.max(0, Number(qtyStr) || 0);
  const capped = Math.min(product.currentQty, qty);
  const unitPrice = product.purchasePrice || 0;
  const tooMuch = qty > product.currentQty;

  const REASONS = ['Périmé', 'Cassé / abîmé', 'Volé / perdu', 'Non conforme', 'Échantillon'];

  return (
    <Modal open onClose={onClose} icon={Flame} size="md"
      title="Destruction de produit" subtitle={product.name}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button onClick={() => onConfirm(capped, reason, notes)} disabled={capped <= 0}
          className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Confirmer la destruction
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">En stock</p>
            <p className="font-black text-slate-700 tabular-nums">{formatQty(product.currentQty)} <span className="text-xs text-slate-400">{product.unit}</span></p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Prix d'achat</p>
            <p className="font-black text-slate-700 tabular-nums">{money(unitPrice)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Reste après</p>
            <p className="font-black text-slate-700 tabular-nums">{formatQty(product.currentQty - capped)} <span className="text-xs text-slate-400">{product.unit}</span></p>
          </div>
        </div>

        <Field label={`Quantité à détruire (max ${formatQty(product.currentQty)} ${product.unit || ''})`} required>
          <Input type="number" min={0} step="0.01" value={qtyStr} onChange={e => setQtyStr(e.target.value)} />
        </Field>
        {tooMuch && (
          <p className="text-xs font-semibold text-amber-600">
            Le stock ne contient que {formatQty(product.currentQty)} {product.unit} — seule cette quantité sera détruite.
          </p>
        )}

        <Field label="Motif de destruction" hint="Choisissez un motif courant ou saisissez le vôtre.">
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Péremption, casse, vol…" />
        </Field>
        <div className="flex flex-wrap gap-1.5 -mt-2">
          {REASONS.map(r => (
            <button key={r} onClick={() => setReason(r)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${reason === r ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {r}
            </button>
          ))}
        </div>

        <Field label="Observations (optionnel)">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Précisions sur la perte…" />
        </Field>

        <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-500">Coût de la destruction</p>
            <p className="text-[11px] text-red-400">{capped} {product.unit} × {money(unitPrice)} — déduit du résultat de la partie</p>
          </div>
          <span className="text-xl font-black tabular-nums text-red-600">{money(capped * unitPrice)}</span>
        </div>
      </div>
    </Modal>
  );
}

// ─── Détail d'une destruction ──────────────────────────────────────────────────
function DestructionDetail({ destruction: d, onClose }: { destruction: BizDestruction; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} icon={Flame} size="md"
      title={`Destruction — ${d.productName}`} subtitle={formatDate(d.date)}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Produit', d.productName],
            ['Catégorie', d.categoryName || '—'],
            ['Quantité détruite', `${d.qty} ${d.unit || ''}`.trim()],
            ['Coût unitaire (prix d\'achat)', money(d.unitPrice)],
            ['Motif', d.reason || '—'],
            ['Enregistrée par', d.createdBy || '—'],
            ['Date', formatDate(d.date)],
            ['Provenance', d.source === 'stock' ? 'Gestion de stock' : 'Comptoir'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
              <p className="font-bold text-slate-700 text-sm">{v}</p>
            </div>
          ))}
        </div>

        {d.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Observations</p>
            <p className="text-sm text-slate-600">{d.notes}</p>
          </div>
        )}

        {d.recovered ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-2 text-emerald-700">
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm font-semibold">
              Récupérée{d.recoveredAt ? ` le ${formatDate(d.recoveredAt)}` : ''} — la quantité est revenue en stock et
              ne coûte plus rien à la partie.
            </span>
          </div>
        ) : (
          <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-500">
              <User className="w-4 h-4" />
              <span className="text-sm font-semibold">Perte définitive imputée à la partie</span>
            </div>
            <span className="text-xl font-black tabular-nums text-red-600">{money(d.value)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
