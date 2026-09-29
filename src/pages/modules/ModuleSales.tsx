import React, { useMemo, useState } from 'react';
import {
  Receipt, Wallet, TrendingUp, CircleDollarSign, User, ShoppingBag,
  Undo2, Repeat, Search, X, Printer, ArrowRightLeft, Clock,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizSale, BizLineItem, BizProduct,
  detailPrice, isSellableProduct, isReversedSale, netCashOfSale, formatQty,
} from '@/src/lib/bizConfig';
import {
  applyRestock, bumpQty, describeRestock, restockLines, restockPlan, restockTargetOf, totalRestocked,
} from '@/src/lib/bizRestock';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import { useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal, Field, Input, Select, Textarea, money,
  formatDate, formatDateTime, formatTime,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { PayDebtModal, PayDebtMeta, withPayment, seedPayments, printInvoice, stationFromSettings } from './_shared';

export default function ModuleSales({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'sales');
  const { settings } = useAppState();
  const { sales, clients } = biz.state;

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  // Les ventes s'ouvrent en tableau : sur une journée de caisse on cherche une
  // référence et un reste à payer, pas une vignette. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [viewing, setViewing] = useState<BizSale | null>(null);
  const [editing, setEditing] = useState<BizSale | null>(null);
  const [paying, setPaying] = useState<BizSale | null>(null);
  const [toDelete, setToDelete] = useState<BizSale | null>(null);
  const [returning, setReturning] = useState<BizSale | null>(null);
  const [exchanging, setExchanging] = useState<BizSale | null>(null);

  const filtered = useMemo(() => {
    return [...sales].filter(s => {
      const client = clients.find(c => c.id === s.clientId);
      const matchQ = matchesSearch(search, s.clientName, client?.phone, s.ref);
      return matchQ && inPeriod(s.date, period, from, to);
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, clients, search, period, from, to]);

  // Une vente retournée ou échangée n'est plus un chiffre d'affaires : la
  // marchandise est revenue. Elle reste dans la liste (avec son état) mais elle
  // sort des compteurs — c'est ce que les rapports comptent aussi.
  const stats = useMemo(() => {
    const effective = sales.filter(s => !isReversedSale(s));
    return {
      count: effective.length,
      reversed: sales.length - effective.length,
      total: effective.reduce((s, x) => s + x.total, 0),
      paid: sales.reduce((s, x) => s + netCashOfSale(x), 0),
      refunded: sales.reduce((s, x) => s + (x.status === 'retournée' ? (x.refundedAmount || 0) : 0), 0),
      rest: effective.reduce((s, x) => s + x.rest, 0),
    };
  }, [sales]);

  /**
   * Supprimer une vente ANNULE la sortie de marchandise : chaque article
   * retrouve sa place — un produit du catalogue en Gestion de stock, une
   * production au Comptoir, une fiche technique sous forme de ses ingrédients —
   * puis la facture disparaît des rapports et de la dette client.
   *
   * Sans cette reprise, une vente supprimée laissait la marchandise dehors pour
   * toujours : le catalogue annonçait moins de stock que ce que la partie avait
   * réellement en rayon, et le manque ne se rattrapait jamais.
   */
  const del = () => {
    if (!toDelete) return;
    // Une vente déjà retournée ou échangée a DÉJÀ rendu sa marchandise : la
    // rendre une seconde fois gonflerait le stock d'articles jamais revenus.
    const alreadyBack = isReversedSale(toDelete);
    if (!alreadyBack) {
      const plan = restockPlan(biz.state, toDelete.items);
      applyRestock(biz, plan);
      const qty = totalRestocked(plan);
      toast.success(qty > 0
        ? `Vente supprimée — ${formatQty(qty)} unité(s) remise(s) en stock`
        : 'Vente supprimée');
    } else {
      toast.success('Vente supprimée — sa marchandise était déjà revenue en stock');
    }
    biz.remove('sales', toDelete.id);
    setToDelete(null);
  };

  /** Ce que la suppression va remettre en stock, montré dans la confirmation. */
  const deleteImpact = useMemo(
    () => (toDelete && !isReversedSale(toDelete) ? describeRestock(biz.state, toDelete.items) : ''),
    [toDelete, biz.state]);
  const onPay = (amount: number, meta: PayDebtMeta) => {
    if (!paying) return;
    // `withPayment` ajoute le versement daté ET recalcule paid/rest : le relevé
    // de compte peut alors dire quand l'argent est entré, et par quel moyen.
    const next = withPayment(paying, amount, meta);
    biz.update('sales', { ...next, status: next.rest > 0 ? 'crédit' : 'payée' });
    toast.success('Paiement enregistré'); setPaying(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Receipt} title="Ventes" subtitle={`${cfg.label} — factures de vente`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShoppingBag} label="Ventes" value={stats.count} tone="blue"
          sub={stats.reversed ? `${stats.reversed} retour(s) / échange(s) exclus` : undefined} />
        <StatCard icon={TrendingUp} label="Chiffre d'affaires" value={money(stats.total)} tone="green"
          sub="hors ventes annulées" />
        <StatCard icon={Wallet} label="Encaissé" value={money(stats.paid)} tone="purple"
          sub={stats.refunded ? `${money(stats.refunded)} remboursé(s)` : undefined} />
        <StatCard icon={CircleDollarSign} label="Dettes clients" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, téléphone ou réf…" />
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? <EmptyState icon={Receipt} title="Aucune vente" message="Les ventes du point de vente apparaîtront ici." /> : view === 'grid' ? (
        <CardGrid>
          {filtered.map(s => (
            <GlassCard key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-black text-slate-800">{s.ref}</h3><p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{s.clientName}</p></div>
                <StatusBadge sale={s} />
              </div>
              <p className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span>{formatDate(s.date)}</span>
                <span className="inline-flex items-center gap-1 font-bold text-slate-500 tabular-nums">
                  <Clock className="w-3 h-3" />{formatTime(s.date)}
                </span>
                <span>• {s.items.length} article(s)</span>
              </p>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(s.total)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(s.paid)}</p></div>
                <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(s.rest)}</p></div>
              </div>
              <div className="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(s)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(s)} />}
                  {s.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(s)} />}
                  {canReverse(s) && perm.modifier && <ActionBtn icon={Undo2} tone="slate" title="Retour produit" onClick={() => setReturning(s)} />}
                  {canReverse(s) && perm.modifier && <ActionBtn icon={Repeat} tone="green" title="Échanger" onClick={() => setExchanging(s)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      ) : (
        <Table head={<>
          <th className="table-head">Réf</th><th className="table-head">Client</th>
          <th className="table-head">Date</th><th className="table-head">Heure</th>
          <th className="table-head">Total</th><th className="table-head">Payé</th><th className="table-head">Reste</th>
          <th className="table-head">État</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(s => (
            <tr key={s.id}>
              <td className="table-cell font-bold">{s.ref}</td><td className="table-cell">{s.clientName}</td>
              <td className="table-cell whitespace-nowrap">{formatDate(s.date)}</td>
              <td className="table-cell whitespace-nowrap">
                <span className="inline-flex items-center gap-1 font-bold text-slate-600 tabular-nums">
                  <Clock className="w-3 h-3 text-slate-400" />{formatTime(s.date)}
                </span>
              </td>
              <td className="table-cell tabular-nums">{money(s.total)}</td><td className="table-cell tabular-nums text-emerald-600">{money(s.paid)}</td>
              <td className="table-cell tabular-nums text-red-600">{money(s.rest)}</td>
              <td className="table-cell">{s.rest > 0 ? <Badge tone="danger">Crédit</Badge> : <Badge tone="success">Payée</Badge>}</td>
              <td className="table-cell"><RowActions>
                <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(s)} />
                {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(s)} />}
                {s.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(s)} />}
                {canReverse(s) && perm.modifier && <ActionBtn icon={Undo2} tone="slate" title="Retour produit" onClick={() => setReturning(s)} />}
                {canReverse(s) && perm.modifier && <ActionBtn icon={Repeat} tone="green" title="Échanger" onClick={() => setExchanging(s)} />}
                {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
              </RowActions></td>
            </tr>
          ))}
        </Table>
      )}

      {/* View */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Receipt} size="lg" title={`Vente ${viewing?.ref || ''}`} subtitle={viewing?.clientName}>
        {viewing && (
          <div className="space-y-4">
            {/* Quand la vente a été faite — l'heure autant que le jour. */}
            <div className="rounded-xl bg-slate-50 p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                <Clock className="w-3.5 h-3.5 text-slate-400" />{formatDateTime(viewing.date)}
              </span>
              {viewing.workerName && (
                <span className="inline-flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />{viewing.workerName}
                </span>
              )}
            </div>
            {/* Vente annulée : elle ne compte plus nulle part, on le dit ici. */}
            {isReversedSale(viewing) && (
              <div className="rounded-xl bg-slate-100 border border-slate-200 p-3 text-xs text-slate-600 flex items-start gap-2">
                <Undo2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Vente {viewing.status}</strong>
                  {viewing.refundedAt ? ` le ${formatDateTime(viewing.refundedAt)}` : ''}
                  {viewing.status === 'retournée' ? ` — ${money(viewing.refundedAmount || 0)} rendu(s) au client` : ''}
                  {viewing.returnReason ? ` (${viewing.returnReason})` : ''}.
                  {' '}La marchandise est revenue en stock : cette facture est exclue du chiffre
                  d'affaires et des gains des rapports.
                </span>
              </div>
            )}
            <Table head={<><th className="table-head">Produit</th><th className="table-head">Qté</th><th className="table-head">P.U</th><th className="table-head">Total</th></>}>
              {viewing.items.map((it, i) => <tr key={i}><td className="table-cell">{it.productName}</td><td className="table-cell tabular-nums">{it.qty}</td><td className="table-cell tabular-nums">{money(it.unitPrice)}</td><td className="table-cell tabular-nums font-bold">{money((it.total ?? it.qty * it.unitPrice))}</td></tr>)}
            </Table>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Sous-total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(viewing.subtotal)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Réduction</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(viewing.reduction)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(viewing.paid)}</p></div>
              <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(viewing.rest)}</p></div>
            </div>
            <div className="flex justify-end"><button className="btn-outline" onClick={() => printInvoice({
              title: 'Facture de vente', ref: viewing.ref, date: viewing.date,
              station: stationFromSettings(settings),
              party: { label: 'Client', name: viewing.clientName, phone: clients.find(c => c.id === viewing.clientId)?.phone },
              info: [
                { label: 'Caissier', value: viewing.workerName || viewing.createdBy || '' },
                { label: 'État', value: viewing.status },
              ],
              items: viewing.items.map(i => ({
                name: i.productName,
                qty: i.detailQty ? `${i.detailQty} ${i.detailUnit || ''}`.trim() : i.qty,
                unitPrice: i.unitPrice, total: i.total ?? i.qty * i.unitPrice,
              })),
              subtotal: viewing.subtotal, reduction: viewing.reduction,
              total: viewing.total, paid: viewing.paid, rest: viewing.rest,
              payments: [{ label: 'Espèces', amount: viewing.paid }],
            })}><Receipt className="w-4 h-4" /> Imprimer</button></div>
          </div>
        )}
      </Modal>

      {editing && <EditSale moduleKey={moduleKey} sale={editing} onClose={() => setEditing(null)} />}
      {returning && <ReturnModal moduleKey={moduleKey} sale={returning} onClose={() => setReturning(null)} />}
      {exchanging && <ExchangeModal moduleKey={moduleKey} sale={exchanging} onClose={() => setExchanging(null)} />}
      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer la vente"
        message={`Facture ${toDelete?.ref || ''} — ${money(toDelete?.total || 0)}.\n\n`
          + (toDelete && isReversedSale(toDelete)
            ? 'Cette vente a déjà été retournée ou échangée : sa marchandise est revenue en stock, rien de plus ne sera rendu.'
            : 'Les quantités vendues seront REMISES en stock et la vente ne comptera plus dans les rapports ni dans la dette client.\n\n'
              + (deleteImpact || 'Aucune quantité à remettre en stock sur cette facture.'))
          + '\n\nCette action est définitive.'}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Retours & échanges ────────────────────────────────────────────────────────

/** A sale can be reversed once — a refunded or exchanged invoice is final. */
function canReverse(s: BizSale): boolean {
  return s.status !== 'retournée' && s.status !== 'échangée';
}

function StatusBadge({ sale }: { sale: BizSale }) {
  if (sale.status === 'retournée') return <Badge tone="neutral">Retournée</Badge>;
  if (sale.status === 'échangée') return <Badge tone="info">Échangée</Badge>;
  if (sale.rest > 0) return <Badge tone="danger">Crédit</Badge>;
  return <Badge tone="success">Payée</Badge>;
}

/**
 * Return: the goods go back to stock and the client is refunded what they paid.
 */
function ReturnModal({ moduleKey, sale, onClose }: { moduleKey: ModuleKey; sale: BizSale; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const [refund, setRefund] = useState(String(sale.paid));
  const [reason, setReason] = useState('');
  const amount = Number(refund) || 0;

  const confirm = () => {
    restockLines(biz, sale.items);
    biz.update('sales', {
      ...sale,
      status: 'retournée',
      refundedAmount: amount,
      refundedAt: new Date().toISOString(),
      rest: 0,
      returnReason: reason.trim() || undefined,
    });
    toast.success('Retour enregistré — marchandise remise en stock, vente sortie du chiffre d\'affaires');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Undo2} size="lg"
      title={`Retour de la vente ${sale.ref}`} subtitle={sale.clientName}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={confirm}>Valider le retour</button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
          Chaque article revient là d'où il était sorti — un produit du catalogue en Gestion de stock,
          une production au Comptoir, une fiche technique sous forme de ses ingrédients. La vente
          quitte alors le chiffre d'affaires et les gains des rapports.
        </div>
        <Table head={<>
          <th className="table-head">Produit</th><th className="table-head">Qté remise</th>
          <th className="table-head">Retour vers</th><th className="table-head text-right">Montant</th>
        </>}>
          {sale.items.map((it, i) => {
            const target = restockTargetOf(biz.state, it);
            return (
              <tr key={i}>
                <td className="table-cell">{it.productName}</td>
                <td className="table-cell tabular-nums">{it.detailQty ? `${formatQty(it.detailQty)} ${it.detailUnit || ''}` : formatQty(it.qty)}</td>
                <td className="table-cell">
                  <Badge tone="info">{target.label}</Badge>
                  <div className="text-[11px] text-slate-400 mt-0.5">{target.detail}</div>
                </td>
                <td className="table-cell text-right tabular-nums">{money(it.total ?? it.qty * it.unitPrice)}</td>
              </tr>
            );
          })}
        </Table>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Déjà encaissé</p>
            <p className="font-black text-slate-700 tabular-nums">{money(sale.paid)}</p>
          </div>
          <Field label="Montant remboursé au client (DA)">
            <Input type="number" value={refund} onChange={e => setRefund(e.target.value)} />
          </Field>
        </div>
        <Field label="Motif du retour"><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/**
 * Exchange: the sold goods go back to stock and are replaced by other products
 * picked by search. The difference is shown explicitly — positive means the
 * client still has to pay, negative means the station gives money back.
 */
function ExchangeModal({ moduleKey, sale, onClose }: { moduleKey: ModuleKey; sale: BizSale; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { products, clients, settings: _s } = biz.state as any;
  const { settings } = useAppState();
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<BizLineItem[]>([]);

  const matches = useMemo(() => {
    if (!query.trim()) return [] as BizProduct[];
    return (products as BizProduct[])
      // Une matière première ne part jamais chez le client, même en échange.
      .filter(p => isSellableProduct(p) && p.currentQty > 0
        && matchesSearch(query, p.name, p.barcode))
      .slice(0, 8);
  }, [products, query]);

  const add = (p: BizProduct) => {
    if (lines.some(l => l.productId === p.id)) { setQuery(''); return; }
    if (p.sellByDetail && (p.detailCapacity || 0) > 0) {
      const unitPrice = detailPrice(p);
      setLines(prev => [...prev, {
        productId: p.id, productName: p.name, detailQty: 1, detailUnit: p.detailUnit || 'L',
        qty: 1 / (p.detailCapacity || 1), unitPrice, unitCost: p.purchasePrice || 0, total: unitPrice,
      }]);
    } else {
      setLines(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.salePrice, unitCost: p.purchasePrice || 0, total: p.salePrice }]);
    }
    setQuery('');
  };
  const setQty = (productId: string, v: number) => {
    const p = (products as BizProduct[]).find(x => x.id === productId);
    setLines(prev => prev.map(l => {
      if (l.productId !== productId) return l;
      if (l.detailQty !== undefined && p?.detailCapacity) {
        const detailQty = Math.max(0, v);
        return { ...l, detailQty, qty: detailQty / p.detailCapacity, total: detailQty * l.unitPrice };
      }
      const qty = Math.max(0, v);
      return { ...l, qty, total: qty * l.unitPrice };
    }));
  };
  const rm = (id: string) => setLines(prev => prev.filter(l => l.productId !== id));

  const newTotal = lines.reduce((s, l) => s + (l.total ?? l.qty * l.unitPrice), 0);
  // > 0 : le client complète ; < 0 : la station rembourse.
  const delta = newTotal - sale.total;

  const confirm = () => {
    if (lines.length === 0) { toast.error('Sélectionnez au moins un produit de remplacement'); return; }

    // Retour ET remplacement dans le MÊME plan : un produit repris puis
    // redonné en remplacement était sinon écrit deux fois depuis le même stock
    // lu au début, et la reprise disparaissait purement et simplement.
    // Pas de plancher à zéro non plus : comme au point de vente, un manque
    // descend en négatif et se rattrape au prochain achat.
    const plan = restockPlan(biz.state, sale.items);
    lines.forEach(l => bumpQty(plan.stock, l.productId, -l.qty));
    applyRestock(biz, plan);

    // 3. A replacement invoice carries the new basket; the original is closed.
    const replacement: BizSale = {
      id: newId(),
      ref: `V-${String(biz.state.sales.length + 1).padStart(4, '0')}`,
      clientId: sale.clientId, clientName: sale.clientName,
      items: lines,
      subtotal: newTotal, reduction: 0, total: newTotal,
      // Money already in the till stays in; the delta is settled now.
      paid: Math.min(newTotal, sale.paid + Math.max(0, delta)),
      rest: Math.max(0, newTotal - (sale.paid + Math.max(0, delta))),
      date: new Date().toISOString(),
      status: newTotal - (sale.paid + Math.max(0, delta)) > 0 ? 'crédit' : 'payée',
      createdBy: sale.createdBy,
      sessionId: sale.sessionId, workerId: sale.workerId, workerName: sale.workerName,
      exchangeOfSaleId: sale.id,
      exchangeDelta: delta,
    };
    biz.add('sales', replacement);
    biz.update('sales', { ...sale, status: 'échangée', exchangedIntoSaleId: replacement.id, rest: 0 });

    toast.success(delta === 0
      ? 'Échange enregistré'
      : delta > 0
        ? `Échange enregistré — le client complète ${money(delta)}`
        : `Échange enregistré — ${money(-delta)} à rendre au client`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Repeat} size="xl"
      title={`Échange de la vente ${sale.ref}`} subtitle={sale.clientName}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={confirm} disabled={lines.length === 0}>Valider l'échange</button>
      </>}>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Articles repris (remis en stock)</p>
          <Table head={<><th className="table-head">Produit</th><th className="table-head">Qté</th><th className="table-head text-right">Montant</th></>}>
            {sale.items.map((it, i) => (
              <tr key={i}>
                <td className="table-cell">{it.productName}</td>
                <td className="table-cell tabular-nums">{it.detailQty ? `${it.detailQty} ${it.detailUnit || ''}` : it.qty}</td>
                <td className="table-cell text-right tabular-nums">{money(it.total ?? it.qty * it.unitPrice)}</td>
              </tr>
            ))}
          </Table>
        </div>

        <div>
          <label className="label-field">Produits de remplacement</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher par nom ou code-barres…" className="input-field pl-9" />
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                {matches.map(p => (
                  <button key={p.id} onClick={() => add(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-xs text-slate-400">
                      {p.sellByDetail && p.detailCapacity
                        ? `${money(detailPrice(p))}/${p.detailUnit} • stock ${p.currentQty}`
                        : `${money(p.salePrice)} • stock ${p.currentQty}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {lines.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {lines.map(l => (
                <div key={l.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                  <span className="flex-1 text-sm font-semibold text-slate-700 truncate">{l.productName}</span>
                  <input type="number" step="0.01" min={0}
                    value={l.detailQty !== undefined ? l.detailQty : l.qty}
                    onChange={e => setQty(l.productId, Number(e.target.value))}
                    className="input-field !py-1 !px-2 w-20 text-center" />
                  <span className="text-[11px] text-slate-400 w-8">{l.detailUnit || 'u'}</span>
                  <span className="text-sm font-bold tabular-nums w-24 text-right">{money(l.total ?? l.qty * l.unitPrice)}</span>
                  <button onClick={() => rm(l.productId)} className="text-red-500 p-1"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Money difference */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Ancienne vente</p>
            <p className="font-black text-slate-700 tabular-nums">{money(sale.total)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Nouveau panier</p>
            <p className="font-black text-slate-700 tabular-nums">{money(newTotal)}</p>
          </div>
          <div className={`rounded-xl p-3 text-center text-white ${delta === 0 ? 'bg-emerald-600' : delta > 0 ? 'bg-[#003087]' : 'bg-red-600'}`}>
            <p className="text-[10px] uppercase font-bold opacity-90">Décalage</p>
            <p className="font-black tabular-nums">{money(Math.abs(delta))}</p>
            <p className="text-[10px] opacity-90">
              {delta === 0 ? 'Aucun complément' : delta > 0 ? 'le client complète' : 'à rendre au client'}
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn-outline" onClick={() => printInvoice({
            title: 'Bon d\'échange', ref: sale.ref, date: new Date().toISOString(),
            station: stationFromSettings(settings),
            party: { label: 'Client', name: sale.clientName },
            items: lines.map(l => ({
              name: l.productName,
              qty: l.detailQty ? `${l.detailQty} ${l.detailUnit || ''}`.trim() : l.qty,
              unitPrice: l.unitPrice, total: l.total ?? l.qty * l.unitPrice,
            })),
            subtotal: newTotal, total: newTotal,
            paid: sale.paid, rest: Math.max(0, delta),
            notes: delta === 0 ? 'Échange sans complément'
              : delta > 0 ? `Complément à payer par le client : ${money(delta)}`
                : `Montant rendu au client : ${money(-delta)}`,
          })} disabled={lines.length === 0}>
            <Printer className="w-4 h-4" /> Aperçu du bon
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditSale({ moduleKey, sale, onClose }: { moduleKey: ModuleKey; sale: BizSale; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { clients } = biz.state;
  const [clientId, setClientId] = useState(sale.clientId || '');
  const [reduction, setReduction] = useState(sale.reduction);
  const [paid, setPaid] = useState(sale.paid);
  const total = Math.max(0, sale.subtotal - reduction);
  const save = () => {
    const client = clients.find(c => c.id === clientId);
    biz.update('sales', {
      ...sale, clientId: clientId || undefined, clientName: client?.name || 'Client de passage',
      reduction, total, paid, rest: Math.max(0, total - paid),
      status: total - paid > 0 ? 'crédit' : 'payée',
      // Le détail des encaissements ne survit que s'il colle encore au montant
      // payé : sinon il décrirait une facture qui n'existe plus.
      payments: seedPayments(sale.payments, paid, sale.date, sale.createdBy),
    });
    toast.success('Vente modifiée'); onClose();
  };
  return (
    <Modal open onClose={onClose} icon={Edit2} size="md" title={`Modifier ${sale.ref}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="space-y-4">
        <Field label="Client"><Select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Client de passage</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Réduction (DA)"><Input type="number" value={reduction} onChange={e => setReduction(Number(e.target.value))} /></Field>
          <Field label="Payé (DA)"><Input type="number" value={paid} onChange={e => setPaid(Number(e.target.value))} /></Field>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 flex items-center justify-between"><span className="text-sm text-slate-400">Total</span><span className="font-black tabular-nums">{money(total)}</span></div>
      </div>
    </Modal>
  );
}
