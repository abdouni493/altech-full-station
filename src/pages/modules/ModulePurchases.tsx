import React, { useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Search, Trash2 as TrashIcon, X, Truck, Receipt, Wallet, CircleDollarSign, Package,
  Tag, Banknote, Droplet, Scale, Info, Printer, Barcode,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizPurchase, BizLineItem, BizProduct, detailPrice, formatQty,
  productRefLabel, productCarLabel,
} from '@/src/lib/bizConfig';
import { deleteBizPurchase, describePurchaseRollback, purchaseStockDeltas, totalRolledBack } from '@/src/lib/bizPurchase';
import {
  snapshotFor, stampLine, lineSnapshot, effectiveAvgCost, usesAverageCost, roundCost,
} from '@/src/lib/bizAverageCost';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import { useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal, Field, Input, Select, Switch, FormSection,
  StaticField, money, formatDate,
} from '@/src/components/biz/Kit';
import { ProductModal, ContactModal, PayDebtModal, printPurchaseInvoice, productMatches, stationFromSettings } from './_shared';
import PurchaseLabelsModal from '@/src/components/biz/PurchaseLabelsModal';

export default function ModulePurchases({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'purchases');
  const { settings } = useAppState();
  const { purchases, products, suppliers } = biz.state;

  const [search, setSearch] = useState('');
  // Les achats s'ouvrent en tableau : c'est la lecture la plus dense d'une
  // liste de factures (réf, fournisseur, total, reste) ; les cartes restent
  // à un clic, et restent la seule vue possible sur un téléphone.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizPurchase | null>(null);
  const [viewing, setViewing] = useState<BizPurchase | null>(null);
  const [paying, setPaying] = useState<BizPurchase | null>(null);
  const [toDelete, setToDelete] = useState<BizPurchase | null>(null);
  /**
   * Facture dont on étiquette la marchandise. La réception est le moment où les
   * étiquettes se posent : la facture porte déjà la liste de ce qui est arrivé
   * et en quelle quantité, inutile de la retrouver produit par produit dans la
   * Gestion de stock.
   */
  const [labeling, setLabeling] = useState<BizPurchase | null>(null);

  const filtered = useMemo(() => {
    return [...purchases]
      .filter(p => matchesSearch(search, p.ref, p.supplierName))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases, search]);

  const stats = useMemo(() => ({
    count: purchases.length,
    total: purchases.reduce((s, p) => s + p.total, 0),
    paid: purchases.reduce((s, p) => s + p.paid, 0),
    rest: purchases.reduce((s, p) => s + p.rest, 0),
  }), [purchases]);

  /**
   * Supprimer une facture d'achat ANNULE la réception : les quantités reçues
   * quittent le stock des produits concernés, puis la facture disparaît des
   * rapports, de la dette fournisseur et de la caisse de la partie. Retirer la
   * seule ligne laissait le stock gonflé de marchandise jamais reçue.
   */
  const del = () => {
    if (!toDelete) return;
    const deltas = deleteBizPurchase(toDelete, products, biz);
    const qty = totalRolledBack(deltas);
    toast.success(qty > 0
      ? `Achat supprimé — ${formatQty(qty)} unité(s) retirée(s) du stock`
      : 'Achat supprimé');
    setToDelete(null);
  };

  /** Ce que la suppression retirera du stock, montré dans la confirmation. */
  const deleteImpact = useMemo(
    () => (toDelete ? describePurchaseRollback(purchaseStockDeltas(toDelete, products)) : ''),
    [toDelete, products]);

  /**
   * Imprime la facture d'achat. Le rendu est écrit une seule fois : les cartes,
   * le tableau et la fiche de l'achat appellent tous cette fonction, sinon la
   * mise en page finirait par diverger d'un bouton a l'autre.
   */
  const printPurchase = (p: BizPurchase) => {
    const sup = suppliers.find(s => s.id === p.supplierId);
    printPurchaseInvoice({
      title: "Facture d'achat",
      ref: p.ref,
      date: p.date,
      // L'horodatage de saisie de l'achat : le gabarit y ajoute l'heure
      // d'impression, les deux ne disent pas la même chose.
      createdAt: p.createdAt,
      createdBy: p.createdBy,
      station: stationFromSettings(settings),
      supplier: { name: p.supplierName, phone: sup?.phone, address: sup?.address },
      info: [{ label: 'Activité', value: cfg.label }],
      items: p.items.map(i => ({
        name: i.productName, qty: i.qty, unitPrice: i.unitPrice, total: i.qty * i.unitPrice,
      })),
      total: p.total, paid: p.paid, rest: p.rest,
    });
  };

  const onPay = (amount: number) => {
    if (!paying) return;
    const paid = Math.min(paying.total, paying.paid + amount);
    biz.update('purchases', { ...paying, paid, rest: Math.max(0, paying.total - paid) });
    toast.success('Paiement enregistré');
    setPaying(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={ShoppingCart} title="Achats" subtitle={`${cfg.label} — factures fournisseurs`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouvel achat</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={Receipt} label="Achats" value={stats.count} tone="blue" />
        <StatCard icon={CircleDollarSign} label="Total achats" value={money(stats.total)} tone="purple" />
        <StatCard icon={Wallet} label="Payé" value={money(stats.paid)} tone="green" />
        <StatCard icon={Wallet} label="Dettes fournisseurs" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-3 sm:p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Réf ou fournisseur…" />
        {/* The table needs room: on a phone the cards are the only sensible view. */}
        <div className="ml-auto hidden md:block"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Aucun achat" message="Créez votre première facture d'achat."
          action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouvel achat</button> : undefined} />
      ) : (
        <>
        {/* Cards — the only layout on a phone, and one click away on desktop. */}
        <div className={view === 'table' ? 'md:hidden' : ''}>
        <CardGrid>
          {filtered.map(p => (
            <GlassCard key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-800">{p.ref}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Truck className="w-3 h-3" />{p.supplierName}</p>
                </div>
                {p.rest > 0 ? <Badge tone="danger">Crédit</Badge> : <Badge tone="success">Payé</Badge>}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
                <span>{formatDate(p.date)} • {p.items.length} article(s)</span>
                {usesAverageCost(p) && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 font-bold">
                    <Scale className="w-3 h-3" /> Coût moyen
                  </span>
                )}
              </p>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(p.total)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(p.paid)}</p></div>
                <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(p.rest)}</p></div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(p); setShowForm(true); }} />}
                  {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(p)} />}
                  <ActionBtn icon={Printer} tone="slate" title="Imprimer la facture d’achat" onClick={() => printPurchase(p)} />
                  <ActionBtn icon={Barcode} tone="blue" title="Imprimer les étiquettes code-barres des produits" onClick={() => setLabeling(p)} />
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
        </div>

        {/* Table — desktop only, the default: every column at a glance. */}
        {view === 'table' && (
        <div className="hidden md:block">
        <Table head={<>
          <th className="table-head">Réf</th><th className="table-head">Fournisseur</th><th className="table-head">Date</th>
          <th className="table-head text-right">Articles</th><th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th>
          <th className="table-head text-right">Reste</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(p => (
            <tr key={p.id}>
              <td className="table-cell font-bold">{p.ref}</td>
              <td className="table-cell">{p.supplierName}</td>
              <td className="table-cell whitespace-nowrap">{formatDate(p.date)}</td>
              <td className="table-cell tabular-nums text-right">{p.items.length}</td>
              <td className="table-cell tabular-nums text-right font-bold">{money(p.total)}</td>
              <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.paid)}</td>
              <td className="table-cell tabular-nums text-right text-red-600">{money(p.rest)}</td>
              <td className="table-cell">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(p); setShowForm(true); }} />}
                  {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(p)} />}
                  <ActionBtn icon={Printer} tone="slate" title="Imprimer la facture d’achat" onClick={() => printPurchase(p)} />
                  <ActionBtn icon={Barcode} tone="blue" title="Imprimer les étiquettes code-barres des produits" onClick={() => setLabeling(p)} />
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
        </div>
        )}
        </>
      )}

      {showForm && <PurchaseForm moduleKey={moduleKey} initial={editing} onClose={() => setShowForm(false)} />}

      {/* View */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Receipt} size="2xl" title={`Achat ${viewing?.ref || ''}`} subtitle={viewing?.supplierName}
        footer={<>
          <button className="btn-ghost" onClick={() => setViewing(null)}>Fermer</button>
          {/* La marchandise qu'on vient de relire est celle qu'il faut
              étiqueter : le rayon se remplit dans la foulée. */}
          <button className="btn-outline" onClick={() => viewing && setLabeling(viewing)}>
            <Barcode className="w-4 h-4" /> Étiquettes code-barres
          </button>
          {/* On imprime la facture qu'on est en train de lire : c'est ici qu'on
              décide qu'elle est juste, pas dans la liste. */}
          <button className="btn-primary" onClick={() => viewing && printPurchase(viewing)}>
            <Printer className="w-4 h-4" /> Imprimer la facture
          </button>
        </>}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">Fournisseur</p><p className="font-bold text-slate-700 break-words">{viewing.supplierName}</p></div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">Date</p><p className="font-bold text-slate-700">{formatDate(viewing.date)}</p></div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">Articles</p><p className="font-bold text-slate-700">{viewing.items.length}</p></div>
            </div>
            <Table head={<>
              <th className="table-head">Produit</th><th className="table-head text-right">Qté</th>
              <th className="table-head text-right">Prix achat</th><th className="table-head text-right">Prix vente</th>
              <th className="table-head text-right">Prix détail</th><th className="table-head text-right">Total</th>
            </>}>
              {viewing.items.map((it, i) => (
                <tr key={i}>
                  <td className="table-cell">{it.productName}</td>
                  <td className="table-cell tabular-nums text-right">{it.qty}</td>
                  <td className="table-cell tabular-nums text-right">{money(it.unitPrice)}</td>
                  <td className="table-cell tabular-nums text-right">{it.salePrice !== undefined ? money(it.salePrice) : '—'}</td>
                  <td className="table-cell tabular-nums text-right text-xs text-slate-500 whitespace-nowrap">
                    {it.detailSalePrice ? `${money(it.detailSalePrice)} / ${it.detailUnit || 'L'}` : '—'}
                  </td>
                  <td className="table-cell tabular-nums text-right font-bold">{money(it.qty * it.unitPrice)}</td>
                </tr>
              ))}
            </Table>
            {/* Coût moyen pondéré — les chiffres du JOUR de la réception.
                Rouvrir cette facture dans six mois affichera exactement les
                mêmes : rien n'est recalculé avec le coût moyen d'aujourd'hui. */}
            {usesAverageCost(viewing) && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Scale className="w-4 h-4 text-violet-700" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-violet-800">
                    Coût moyen pondéré — calcul de cette réception
                  </p>
                </div>
                <div className="space-y-2.5">
                  {viewing.items.map((it, i) => {
                    const snap = lineSnapshot(it);
                    if (!snap) return null;
                    const prevValue = roundCost(Math.max(0, snap.prevStockQty) * snap.prevAvgCost);
                    const totalQty = roundCost(Math.max(0, snap.prevStockQty) + snap.purchaseQty);
                    return (
                      <div key={i} className="rounded-xl bg-white border border-violet-100 p-3">
                        <p className="text-sm font-black text-slate-800 mb-2">{it.productName}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                          <div><p className="text-[10px] uppercase font-black text-slate-400">Qté achetée</p><p className="font-bold tabular-nums text-slate-700 text-sm">{formatQty(snap.purchaseQty)}</p></div>
                          <div><p className="text-[10px] uppercase font-black text-slate-400">Stock précédent</p><p className="font-bold tabular-nums text-slate-700 text-sm">{formatQty(snap.prevStockQty)}</p></div>
                          <div><p className="text-[10px] uppercase font-black text-slate-400">Coût moyen préc.</p><p className="font-bold tabular-nums text-slate-700 text-sm">{money(snap.prevAvgCost)}</p></div>
                          <div><p className="text-[10px] uppercase font-black text-slate-400">Prix d'achat payé</p><p className="font-bold tabular-nums text-[#002d87] text-sm">{money(snap.purchaseUnitCost)}</p></div>
                          <div><p className="text-[10px] uppercase font-black text-slate-400">Stock après</p><p className="font-bold tabular-nums text-slate-700 text-sm">{formatQty(snap.resultStockQty)}</p></div>
                          <div><p className="text-[10px] uppercase font-black text-violet-500">Nouveau coût moyen</p><p className="font-black tabular-nums text-violet-700 text-sm">{money(snap.resultAvgCost)}</p></div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-violet-100 text-[11px] text-slate-500 tabular-nums leading-relaxed">
                          Valeur du stock précédent : {formatQty(Math.max(0, snap.prevStockQty))} × {money(snap.prevAvgCost)} = {money(prevValue)}
                          <span className="mx-1.5 text-slate-300">•</span>
                          Valeur reçue : {formatQty(snap.purchaseQty)} × {money(snap.purchaseUnitCost)} = {money(snap.purchaseTotalCost)}
                          <span className="block text-violet-800 font-semibold">
                            {money(roundCost(prevValue + snap.purchaseTotalCost))} ÷ {formatQty(totalQty)} = {money(snap.resultAvgCost)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{money(viewing.total)}</p></div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm sm:text-base">{money(viewing.paid)}</p></div>
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm sm:text-base">{money(viewing.rest)}</p></div>
            </div>
          </div>
        )}
      </Modal>

      {/* Les étiquettes de la marchandise reçue sur cette facture. */}
      <PurchaseLabelsModal open={!!labeling} onClose={() => setLabeling(null)}
        purchase={labeling} biz={biz} canEdit={perm.modifier} />

      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer l'achat"
        message={`Facture ${toDelete?.ref || ''} — ${money(toDelete?.total || 0)}.\n\n`
          + `Les quantités reçues seront RETIRÉES du stock et l'achat ne comptera plus dans les rapports, la dette fournisseur ni la caisse.\n\n`
          + (deleteImpact || 'Aucune quantité à reprendre sur cette facture.')
          + '\n\nCette action est définitive.'}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Create / Edit purchase ─────────────────────────────────────────────────────
function PurchaseForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizPurchase | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { products, suppliers } = biz.state;
  const isEdit = !!initial;
  /** Pièces détachées : la partie Lavage & Vidange est la seule concernée. */
  const isLavage = moduleKey === 'lavage';

  const [items, setItems] = useState<BizLineItem[]>(initial?.items || []);
  /**
   * Option « coût moyen pondéré ». Une facture déjà enregistrée garde ce qu'elle
   * a RÉELLEMENT fait ; un nouvel achat part du réglage de la partie, pour que
   * l'utilisateur n'ait pas à recocher la case à chaque livraison (une
   * réception oubliée fausserait la moyenne de tout le stock).
   */
  const [useAvg, setUseAvg] = useState(
    initial ? usesAverageCost(initial) : !!biz.state.avgCostEnabled);
  const [pQuery, setPQuery] = useState('');
  /** Produit tout juste ajouté, signalé en tête de liste. */
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(initial?.supplierId || '');
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [paidStr, setPaidStr] = useState<string>(initial ? String(initial.paid) : '');
  const [showProductModal, setShowProductModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);

  const total = useMemo(() => items.reduce((s, it) => s + it.qty * it.unitPrice, 0), [items]);
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);
  /** Expected margin of the whole basket, at the sale prices typed on the lines. */
  const expectedMargin = useMemo(
    () => items.reduce((s, it) => s + it.qty * ((it.salePrice ?? 0) - it.unitPrice), 0), [items]);

  /**
   * Les produits proposés pendant la saisie. La recherche est la MÊME que dans
   * la Gestion de stock et au point de vente : nom, code-barres, mais aussi
   * chaque référence de la pièce et chaque véhicule qu'elle équipe. Le bon du
   * fournisseur ne porte souvent QUE la référence — c'est avec elle qu'il faut
   * pouvoir retrouver la fiche, sinon on en crée une seconde et le stock se
   * coupe en deux.
   */
  const matches = useMemo(() => {
    if (!pQuery.trim()) return [];
    return products.filter(p => productMatches(p, pQuery)).slice(0, 20);
  }, [products, pQuery]);

  /**
   * Adds a product to the achat. The line is preloaded with the product's
   * current commercial settings (prix d'achat, prix de vente, seuil, prix au
   * détail) so the user only edits what this delivery changes.
   */
  const addProduct = (p: BizProduct) => {
    if (items.some(it => it.productId === p.id)) { toast.error('Produit déjà ajouté'); return; }
    // Le nouveau produit se pose EN TÊTE de liste : c'est celui qu'on vient de
    // choisir et dont on doit saisir quantité et prix. Ajouté en queue, il
    // partait sous la ligne de flottaison et il fallait redescendre le
    // formulaire à chaque article d'un bon de livraison un peu long.
    setItems(prev => [{
      productId: p.id, productName: p.name,
      qty: 1,
      unitPrice: p.purchasePrice,
      salePrice: p.salePrice,
      minQty: p.minQty,
      hasExpiration: p.hasExpiration, expirationDate: p.expirationDate,
      sellByDetail: !!p.sellByDetail,
      detailCapacity: p.detailCapacity,
      detailUnit: p.detailUnit || 'L',
      detailSalePrice: p.sellByDetail ? detailPrice(p) : undefined,
    }, ...prev]);
    // La recherche n'est PAS vidée : un même bon de livraison porte plusieurs
    // articles, et la liste des résultats doit rester ouverte pour enchaîner
    // les ajouts. Le champ se vide au bouton « Effacer » ou à la touche Échap.
    setLastAdded(p.id);
    toast.success(`${p.name} ajouté`);
  };
  const updItem = (id: string, patch: Partial<BizLineItem>) => setItems(prev => prev.map(it => it.productId === id ? { ...it, ...patch } : it));
  const rmItem = (id: string) => setItems(prev => prev.filter(it => it.productId !== id));

  /**
   * Writes a line's commercial settings back onto the product it points to.
   *
   * `snap` n'est fourni qu'à la CRÉATION d'un achat au coût moyen : le produit
   * prend alors le CUMP calculé comme coût de revient (c'est lui qui vaut le
   * stock et qui donne la marge au point de vente), et le prix réellement payé
   * au fournisseur est conservé à part dans `lastPurchasePrice`.
   *
   * Sans `snap`, la fonction se comporte exactement comme avant : le prix
   * d'achat du produit devient le dernier prix payé.
   */
  const applyToProduct = (
    it: BizLineItem,
    addStock: boolean,
    snap?: { resultAvgCost: number },
  ) => {
    const prod = products.find(p => p.id === it.productId);
    if (!prod) return;
    biz.update('products', {
      ...prod,
      principalQty: addStock ? prod.principalQty + it.qty : prod.principalQty,
      currentQty: addStock ? prod.currentQty + it.qty : prod.currentQty,
      minQty: it.minQty ?? prod.minQty,
      purchasePrice: snap ? snap.resultAvgCost : it.unitPrice,
      ...(snap ? { averageCost: snap.resultAvgCost, lastPurchasePrice: it.unitPrice } : {}),
      salePrice: it.salePrice ?? prod.salePrice,
      hasExpiration: it.hasExpiration ?? prod.hasExpiration,
      expirationDate: it.hasExpiration ? it.expirationDate : prod.expirationDate,
      // Le prix au détail n'est écrit que si le produit est vendu au détail ;
      // 0 ⇒ le POS retombe sur prix de vente ÷ contenance.
      detailSalePrice: prod.sellByDetail
        ? (Number(it.detailSalePrice) > 0 ? Number(it.detailSalePrice) : undefined)
        : prod.detailSalePrice,
    });
  };

  const save = () => {
    if (items.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (!supplierId) { toast.error('Sélectionnez un fournisseur'); return; }
    const supplier = suppliers.find(s => s.id === supplierId);

    // Coût moyen : chaque produit est calculé POUR LUI-MÊME (jamais une moyenne
    // de la facture entière) et la photo du calcul est figée sur la ligne, pour
    // que la facture reste lisible telle quelle dans dix achats.
    const applyAvg = useAvg && !isEdit;
    const savedItems = applyAvg
      ? items.map(it => {
        const prod = products.find(p => p.id === it.productId);
        if (!prod) return it;
        return stampLine(it, snapshotFor(prod, it.qty, it.unitPrice));
      })
      : items;

    const purchase: BizPurchase = {
      id: initial?.id || newId(),
      ref: initial?.ref || `A-${String(biz.state.purchases.length + 1).padStart(4, '0')}`,
      supplierId, supplierName: supplier?.name || '—',
      items: savedItems, total, paid, rest, date: new Date(date).toISOString(),
      createdAt: initial?.createdAt || new Date().toISOString(), createdBy: 'Admin',
      // Une facture existante garde son mode d'origine : rebasculer l'option
      // après coup ne doit pas réécrire une histoire qui a déjà servi.
      ...(isEdit ? (initial?.useAverageCost ? { useAverageCost: true } : {}) : (useAvg ? { useAverageCost: true } : {})),
    };

    if (isEdit) {
      biz.update('purchases', purchase);
      // Le stock n'est ajouté qu'à la création — une modification ne réapplique
      // que les prix et le seuil, sinon la quantité serait comptée deux fois.
      // Le coût moyen n'est pas recalculé non plus, pour la même raison : la
      // photo figée sur la facture reste la vérité de cette réception.
      items.forEach(it => applyToProduct(it, false, undefined));
    } else {
      biz.add('purchases', purchase);
      savedItems.forEach(it => {
        const snap = applyAvg ? lineSnapshot(it) : null;
        applyToProduct(it, true, snap ? { resultAvgCost: snap.resultAvgCost } : undefined);
      });
    }

    // Le choix devient le réglage par défaut de la partie pour les prochains achats.
    if (!isEdit && useAvg !== !!biz.state.avgCostEnabled) biz.patch({ avgCostEnabled: useAvg });

    toast.success(isEdit
      ? 'Achat modifié — prix mis à jour'
      : applyAvg
        ? 'Achat créé — stock, prix et coût moyen pondéré mis à jour'
        : 'Achat créé, stock et prix mis à jour');
    onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} icon={ShoppingCart} size="3xl" formScale fullHeight
        title={isEdit ? 'Modifier l\'achat' : 'Nouvel achat'}
        subtitle="Produits reçus, prix de vente, fournisseur et paiement"
        footer={<>
          <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
            <span className="text-slate-400 uppercase tracking-widest">{items.length} produit(s)</span>
            <span className="text-[#002d87]">Total {money(total)}</span>
            {rest > 0 && <span className="text-red-600">Dette {money(rest)}</span>}
          </div>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer l\'achat'}</button>
        </>}>
        <div className="space-y-4 sm:space-y-5">
          {/* Récapitulatif de l'achat — repris en permanence dans le pied de page. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] uppercase font-black text-slate-400">Produits</p>
              <p className="font-black tabular-nums text-slate-700 text-sm sm:text-lg">{items.length}</p>
            </div>
            <div className="rounded-xl bg-[#eef3fc] border border-[#003087]/15 px-3 py-2.5">
              <p className="text-[10px] uppercase font-black text-slate-400">Total</p>
              <p className="font-black tabular-nums text-[#002d87] text-sm sm:text-lg">{money(total)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
              <p className="text-[10px] uppercase font-black text-slate-400">Payé</p>
              <p className="font-black tabular-nums text-emerald-600 text-sm sm:text-lg">{money(paid)}</p>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 ${rest > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
              <p className="text-[10px] uppercase font-black text-slate-400">Reste</p>
              <p className={`font-black tabular-nums text-sm sm:text-lg ${rest > 0 ? 'text-red-600' : 'text-slate-500'}`}>{money(rest)}</p>
            </div>
          </div>

          {/* Option « coût moyen pondéré » — désactivée par défaut, elle ne
              change rien tant que l'utilisateur ne l'allume pas. */}
          <div className={`rounded-2xl border p-3 sm:p-4 ${useAvg ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${useAvg ? 'bg-violet-600 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}>
                  <Scale className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800">Coût moyen pondéré (CUMP)</p>
                  <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                    {useAvg
                      ? "Chaque produit reçu recalcule son coût de revient au prorata des quantités : (stock × coût moyen + reçu × prix payé) ÷ total. Le prix payé au fournisseur reste inscrit tel quel sur la facture."
                      : "Désactivé : le prix d'achat du produit devient simplement le dernier prix payé, comme aujourd'hui. Activez l'option pour valoriser le stock au coût moyen."}
                  </p>
                </div>
              </div>
              {isEdit ? (
                <Badge tone={usesAverageCost(initial!) ? 'primary' : 'neutral'}>
                  {usesAverageCost(initial!) ? 'Achat enregistré au coût moyen' : 'Achat au dernier prix'}
                </Badge>
              ) : (
                <Switch checked={useAvg} onChange={setUseAvg} label={useAvg ? 'Activé' : 'Désactivé'} />
              )}
            </div>
            {isEdit && (
              <p className="mt-2 text-[11px] text-slate-500 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                Le coût moyen n'est pas recalculé sur une modification : les chiffres figés à la
                réception restent la mémoire de cette facture. Pour repartir d'un calcul juste,
                supprimez l'achat et ressaisissez-le.
              </p>
            )}
          </div>

          {/* 1. Produits — recherche puis saisie ligne par ligne */}
          <FormSection step={1} icon={Package} title="Produits achetés"
            hint={isLavage
              ? 'Cherchez par nom, code-barres, référence ou véhicule et ajoutez autant de pièces que le bon en porte — la dernière ajoutée passe en tête'
              : 'Cherchez et ajoutez autant de produits que la livraison en porte — le dernier ajouté passe en tête de liste'}
            action={
              <button className="btn-secondary !py-2 !px-3.5 text-xs w-full sm:w-auto" onClick={() => setShowProductModal(true)}>
                <Plus className="w-4 h-4" /> Nouveau produit
              </button>
            }>
            <div className="relative mb-4">
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={pQuery} onChange={e => setPQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setPQuery(''); } }}
                placeholder={isLavage
                  ? 'Rechercher par nom, code-barres, référence ou véhicule…'
                  : 'Rechercher un produit par nom ou code-barres…'}
                className={`input-field !pl-11 ${pQuery ? '!pr-11' : ''}`} />
              {pQuery && (
                <button type="button" onClick={() => setPQuery('')} title="Effacer la recherche (Échap)"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              )}
              {matches.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-96">
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                      {matches.length} résultat(s) — cliquez pour ajouter, la liste reste ouverte
                    </span>
                    <span className="text-[11px] font-black text-[#002d87] tabular-nums shrink-0">{items.length} au panier</span>
                  </div>
                  <div className="overflow-y-auto custom-scrollbar">
                  {matches.map(p => {
                    const already = items.some(it => it.productId === p.id);
                    return (
                      <button key={p.id} onClick={() => addProduct(p)} disabled={already}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed border-b border-slate-50 last:border-0">
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-slate-700 truncate">{p.name}</span>
                          <span className="block text-[11px] text-slate-400 truncate">
                            {p.categoryName || 'Sans catégorie'}{p.barcode ? ` • ${p.barcode}` : ''}
                            {p.sellByDetail ? ' • vendu au détail' : ''}
                          </span>
                          {/* Ce qui a fait sortir cette ligne : sans la
                              référence ni le véhicule sous les yeux, on ne sait
                              pas si c'est LA bonne pièce qu'on ajoute. */}
                          {!!p.refs?.length && (
                            <span className="block text-[11px] font-mono text-violet-600 truncate">
                              {p.refs.map(productRefLabel).join(' · ')}
                            </span>
                          )}
                          {!!p.cars?.length && (
                            <span className="block text-[11px] font-semibold text-blue-600 truncate">
                              {p.cars.map(productCarLabel).join(' · ')}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0 text-right">
                          {already
                            ? <span className="block font-black text-emerald-600">Déjà ajouté</span>
                            : <span className="block">Achat {money(p.purchasePrice)}</span>}
                          <span className="block">Stock {p.currentQty}</span>
                        </span>
                      </button>
                    );
                  })}
                  </div>
                  <button type="button" onClick={() => setPQuery('')}
                    className="shrink-0 px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100">
                    Terminer la sélection
                  </button>
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <Package className="w-9 h-9 mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-500">Aucun produit ajouté</p>
                <p className="text-xs text-slate-400 mt-1">Cherchez-en un ci-dessus pour commencer.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((it, idx) => {
                  const prod = products.find(p => p.id === it.productId);
                  const lineTotal = it.qty * it.unitPrice;
                  const unitMargin = (it.salePrice ?? 0) - it.unitPrice;
                  const marginPct = it.unitPrice > 0 ? (unitMargin / it.unitPrice) * 100 : 0;
                  const detailUnit = it.detailUnit || prod?.detailUnit || 'L';
                  const capacity = Number(it.detailCapacity ?? prod?.detailCapacity) || 0;
                  const autoDetail = capacity > 0 ? (it.salePrice ?? 0) / capacity : 0;
                  // Aperçu du coût moyen : recalculé en direct pendant la saisie,
                  // relu tel quel (photo figée) sur une facture déjà enregistrée.
                  const avgSnap = isEdit
                    ? lineSnapshot(it)
                    : (useAvg && prod ? snapshotFor(prod, it.qty, it.unitPrice) : null);
                  return (
                    <div key={it.productId} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                      {/* Line header */}
                      <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                        <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-800 truncate flex items-center gap-2">
                            <span className="truncate">{it.productName}</span>
                            {it.productId === lastAdded && items.length > 1 && (
                              <span className="shrink-0 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 text-[10px] uppercase tracking-widest">
                                Dernier ajouté
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            Stock actuel {prod?.currentQty ?? 0} {prod?.unit || 'unité'}
                            {prod ? ` → ${(prod.currentQty + (Number(it.qty) || 0)).toLocaleString('fr-FR')} après réception` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0 hidden sm:block">
                          <p className="text-[10px] uppercase font-black text-slate-400">Total ligne</p>
                          <p className="font-black tabular-nums text-[#002d87]">{money(lineTotal)}</p>
                        </div>
                        <button onClick={() => rmItem(it.productId)} title="Retirer le produit"
                          className="w-9 h-9 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
                      </div>

                      {/* Quantité + prix d'achat + prix de vente + seuil */}
                      <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
                        <Field label="Quantité reçue">
                          <Input type="number" step="0.01" min={0} inputMode="decimal" value={it.qty}
                            onChange={e => updItem(it.productId, { qty: Number(e.target.value) })}
                            className="text-right" />
                        </Field>
                        <Field label="Prix d'achat (DA)">
                          <Input type="number" step="0.01" min={0} inputMode="decimal" value={it.unitPrice}
                            onChange={e => updItem(it.productId, { unitPrice: Number(e.target.value) })}
                            className="text-right" />
                        </Field>
                        <Field label="Prix de vente (DA)">
                          <Input type="number" step="0.01" min={0} inputMode="decimal" value={it.salePrice ?? 0}
                            onChange={e => updItem(it.productId, { salePrice: Number(e.target.value) })}
                            className="text-right" />
                        </Field>
                        <Field label="Quantité minimale">
                          <Input type="number" step="1" min={0} inputMode="decimal" value={it.minQty ?? 0}
                            onChange={e => updItem(it.productId, { minQty: Number(e.target.value) })}
                            className="text-right" />
                        </Field>
                        <Field label="Total de la ligne">
                          <StaticField tone="primary">{money(lineTotal)}</StaticField>
                        </Field>
                      </div>

                      {/* Vente au détail — uniquement si le produit a l'option activée */}
                      {prod?.sellByDetail && (
                        <div className="mx-3 sm:mx-4 mb-4 rounded-2xl border border-[#003087]/15 bg-[#eef3fc] p-3 sm:p-4">
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            <Droplet className="w-4 h-4 text-[#002d87]" />
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#002d87]">
                              Vente au détail
                            </p>
                            <span className="text-[11px] text-slate-500">
                              1 {prod.unit || 'unité'} = {capacity.toLocaleString('fr-FR')} {detailUnit}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <Field label={`Prix de vente d'un ${detailUnit} (DA)`}
                              hint={capacity > 0 ? `Prix automatique : ${money(autoDetail)} (prix de vente ÷ ${capacity.toLocaleString('fr-FR')})` : undefined}>
                              <Input type="number" step="0.01" min={0} inputMode="decimal" value={it.detailSalePrice ?? 0}
                                onChange={e => updItem(it.productId, { detailSalePrice: Number(e.target.value) })}
                                className="text-right" />
                            </Field>
                            <div className="flex items-start sm:items-center">
                              <button type="button" className="btn-outline !py-3 !px-4 text-xs w-full"
                                onClick={() => updItem(it.productId, { detailSalePrice: Number(autoDetail.toFixed(2)) })}
                                disabled={capacity <= 0}>
                                Utiliser le prix automatique
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Impact sur le coût moyen pondéré de CE produit */}
                      {avgSnap && (
                        <div className="mx-3 sm:mx-4 mb-4 rounded-2xl border border-violet-200 bg-violet-50 p-3 sm:p-4">
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            <Scale className="w-4 h-4 text-violet-700" />
                            <p className="text-[11px] font-black uppercase tracking-widest text-violet-800">
                              Impact sur le coût moyen
                            </p>
                            {isEdit && <Badge tone="neutral">Chiffres figés à la réception</Badge>}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3">
                            <div className="rounded-xl bg-white border border-violet-100 px-3 py-2">
                              <p className="text-[10px] uppercase font-black text-slate-400">Stock précédent</p>
                              <p className="font-black tabular-nums text-slate-700 text-sm">{formatQty(avgSnap.prevStockQty)}</p>
                            </div>
                            <div className="rounded-xl bg-white border border-violet-100 px-3 py-2">
                              <p className="text-[10px] uppercase font-black text-slate-400">Coût moyen précédent</p>
                              <p className="font-black tabular-nums text-slate-700 text-sm">{money(avgSnap.prevAvgCost)}</p>
                            </div>
                            <div className="rounded-xl bg-white border border-violet-100 px-3 py-2">
                              <p className="text-[10px] uppercase font-black text-slate-400">Prix payé (cette facture)</p>
                              <p className="font-black tabular-nums text-[#002d87] text-sm">{money(avgSnap.purchaseUnitCost)}</p>
                            </div>
                            <div className="rounded-xl bg-white border border-violet-100 px-3 py-2">
                              <p className="text-[10px] uppercase font-black text-slate-400">Stock après</p>
                              <p className="font-black tabular-nums text-slate-700 text-sm">{formatQty(avgSnap.resultStockQty)}</p>
                            </div>
                            <div className="rounded-xl bg-violet-600 px-3 py-2 col-span-2 sm:col-span-1">
                              <p className="text-[10px] uppercase font-black text-violet-200">Nouveau coût moyen</p>
                              <p className="font-black tabular-nums text-white text-sm">{money(avgSnap.resultAvgCost)}</p>
                            </div>
                          </div>
                          {/* Le calcul en toutes lettres — l'utilisateur doit pouvoir
                              refaire l'opération de tête et retrouver le même chiffre. */}
                          <p className="mt-2.5 text-[11px] text-violet-900/80 tabular-nums leading-relaxed">
                            ({formatQty(Math.max(0, avgSnap.prevStockQty))} × {money(avgSnap.prevAvgCost)}
                            {' '}+ {formatQty(avgSnap.purchaseQty)} × {money(avgSnap.purchaseUnitCost)})
                            {' '}÷ {formatQty(Math.max(0, avgSnap.prevStockQty) + avgSnap.purchaseQty)}
                            {' '}= <strong>{money(avgSnap.resultAvgCost)}</strong>
                            {avgSnap.prevStockQty <= 0 && (
                              <span className="block text-violet-700">
                                Stock précédent nul ou négatif : le coût moyen repart du prix payé sur cette réception.
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Expiration + marge */}
                      <div className="px-3 sm:px-4 pb-3 sm:pb-4 flex flex-wrap items-center gap-3 sm:gap-4 justify-between">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Switch checked={!!it.hasExpiration} onChange={v => updItem(it.productId, { hasExpiration: v })} label="Date d'expiration" />
                          {it.hasExpiration && (
                            <input type="date" value={it.expirationDate || ''}
                              onChange={e => updItem(it.productId, { expirationDate: e.target.value })}
                              className="input-field !py-2 !px-3 !w-auto !min-h-0 text-sm" />
                          )}
                        </div>
                        <p className={`text-[11px] sm:text-xs font-bold ${unitMargin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          Marge unitaire {money(unitMargin)}
                          {it.unitPrice > 0 ? ` (${marginPct.toFixed(1)} %)` : ''}
                          {' • '}sur la ligne {money(unitMargin * it.qty)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </FormSection>

          {/* 2. Fournisseur & date */}
          <FormSection step={2} icon={Truck} title="Fournisseur & date">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <Field label="Fournisseur" required>
                <div className="flex gap-2">
                  <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">— Sélectionner —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  <button className="btn-secondary !px-3.5 shrink-0" title="Nouveau fournisseur" onClick={() => setShowSupplierModal(true)}><Plus className="w-4 h-4" /></button>
                </div>
              </Field>
              <Field label="Date de l'achat"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
            </div>
          </FormSection>

          {/* 3. Paiement */}
          <FormSection step={3} icon={Banknote} title="Paiement"
            hint="Laissez le montant payé vide pour régler la totalité">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <Field label="Montant payé (DA)">
                    <Input type="number" step="0.01" inputMode="decimal" value={paidStr} onChange={e => setPaidStr(e.target.value)}
                      placeholder={String(total)} className="text-right" />
                  </Field>
                  <Field label="Reste à payer">
                    <StaticField tone={rest > 0 ? 'danger' : 'success'}>{money(rest)}</StaticField>
                  </Field>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <Tag className="w-4 h-4" /> Marge attendue
                  </span>
                  <span className={`font-black tabular-nums text-lg ${expectedMargin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {money(expectedMargin)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl bg-[#001f5c] text-white p-5 sm:p-6 space-y-3 text-sm self-start w-full">
                <div className="flex justify-between"><span className="text-blue-200">Produits</span><span className="font-bold tabular-nums">{items.length}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">Payé</span><span className="font-bold tabular-nums">{money(paid)}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">Reste</span><span className="font-bold tabular-nums text-red-300">{money(rest)}</span></div>
                <div className="flex flex-wrap gap-2 justify-between items-baseline pt-3 border-t border-white/20">
                  <span className="font-semibold">Total de l'achat</span>
                  <span className="text-2xl sm:text-3xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
                </div>
              </div>
            </div>
          </FormSection>
        </div>
      </Modal>

      {/* Un produit créé depuis l'achat suit exactement le même chemin sûr que
          depuis la Gestion de stock : brouillon d'abord, confirmation ensuite. */}
      <ProductModal biz={biz} origin="purchase" open={showProductModal}
        onClose={() => setShowProductModal(false)} onSaved={(p) => addProduct(p)} />
      <ContactModal biz={biz} coll="suppliers" open={showSupplierModal} onClose={() => setShowSupplierModal(false)} onSaved={(s) => setSupplierId(s.id)} />
    </>
  );
}
