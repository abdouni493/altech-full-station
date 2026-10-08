/**
 * ─── Gestion des tables (Restaurant / Cafétéria) ───────────────────────────────
 *
 *  • Les TABLES de la salle : nom, zone, places — création (une par une ou en
 *    série), modification, suppression, désactivation, et l'HISTORIQUE complet
 *    de tout ce qui s'est passé sur chacune.
 *  • Les COMMANDES passées à table : en attente, encaissées, annulées — détail,
 *    impression du bon / du ticket, modification (une note en attente se rouvre
 *    au point de vente), annulation, suppression.
 *
 *  Les commandes se prennent et s'encaissent au point de vente (mode « Service à
 *  table ») : rien ne sort du stock tant que la note n'est pas encaissée.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Plus, Edit2, Trash2, History, Eye, Printer, Ban, Clock, Users, Utensils,
  CheckCircle, XCircle, Wallet, Receipt, ShoppingBag, Layers, Power,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizTable, BizTableOrder, BizTableOrderStatus, TABLE_ORDER_STATUS_LABEL,
} from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Table, Tabs, Confirm,
  RowActions, ActionBtn, EmptyState, SearchInput, ViewToggle, PeriodFilter, inPeriod, money, formatDateTime,
} from '@/src/components/biz/Kit';
import { printTableOrder, elapsedLabel, tableEvent } from './tableShared';
import { CancelOrderModal } from './ModulePOS';

type Period = Parameters<typeof inPeriod>[1];

const STATUS_TONE: Record<BizTableOrderStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning', completed: 'success', cancelled: 'danger',
};

export default function ModuleTables({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'tables');
  const { settings, currentUserName } = useAppState();
  const navigate = useNavigate();
  const tables: BizTable[] = biz.state.tables || [];
  const orders: BizTableOrder[] = biz.state.tableOrders || [];

  const [tab, setTab] = useState<'tables' | 'orders'>('tables');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [tableSearch, setTableSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [editTable, setEditTable] = useState<BizTable | 'new' | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [deleteTable, setDeleteTable] = useState<BizTable | null>(null);
  const [historyTable, setHistoryTable] = useState<BizTable | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | BizTableOrderStatus>('all');
  const [tableFilter, setTableFilter] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<BizTableOrder | null>(null);
  const [editOrder, setEditOrder] = useState<BizTableOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<BizTableOrder | null>(null);
  const [deleteOrder, setDeleteOrder] = useState<BizTableOrder | null>(null);

  const pendingOf = (tableId: string) => orders.find(o => o.tableId === tableId && o.status === 'pending');
  const zones = useMemo(() => Array.from(new Set(tables.map(t => t.zone).filter(Boolean))).sort() as string[], [tables]);
  const by = currentUserName || 'Admin';

  // ── Indicateurs ─────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const pending = orders.filter(o => o.status === 'pending');
  const doneToday = orders.filter(o => o.status === 'completed' && (o.completedAt || '').slice(0, 10) === today);
  const cancelledToday = orders.filter(o => o.status === 'cancelled' && (o.cancelledAt || '').slice(0, 10) === today);
  const revenueToday = doneToday.reduce((s, o) => s + o.total, 0);
  const coversToday = doneToday.reduce((s, o) => s + (o.covers || 0), 0);

  // ── Tables ──────────────────────────────────────────────────────────────────
  const filteredTables = tables
    .filter(t => matchesSearch(tableSearch, t.name, t.zone, t.notes) && (zoneFilter === 'all' || t.zone === zoneFilter))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));

  const saveTable = (t: BizTable, isNew: boolean) => {
    const dup = tables.find(x => x.id !== t.id && x.name.trim().toLowerCase() === t.name.trim().toLowerCase());
    if (dup) { toast.error(`Une table « ${dup.name} » existe déjà`); return false; }
    if (isNew) biz.add('tables', t); else {
      biz.update('tables', t);
      // Le nouveau nom suit la note en attente de la table.
      const o = pendingOf(t.id);
      if (o && o.tableName !== t.name) biz.update('tableOrders', { ...o, tableName: t.name });
    }
    toast.success(isNew ? `Table « ${t.name} » créée` : `Table « ${t.name} » modifiée`);
    return true;
  };

  const removeTable = (t: BizTable) => {
    if (pendingOf(t.id)) { toast.error(`${t.name} a une note en attente : encaissez-la ou annulez-la d'abord`); return; }
    biz.remove('tables', t.id);
    toast.success(`Table « ${t.name} » supprimée — son historique de commandes est conservé`);
  };

  const toggleActive = (t: BizTable) => {
    if (!t.inactive && pendingOf(t.id)) { toast.error(`${t.name} a une note en attente`); return; }
    biz.update('tables', { ...t, inactive: !t.inactive });
    toast.success(t.inactive ? `${t.name} réactivée` : `${t.name} désactivée — elle n'est plus proposée au point de vente`);
  };

  // ── Commandes ───────────────────────────────────────────────────────────────
  const filteredOrders = orders
    .filter(o => (statusFilter === 'all' || o.status === statusFilter)
      && (tableFilter === 'all' || o.tableId === tableFilter)
      && inPeriod(o.createdAt, period, from, to)
      && matchesSearch(orderSearch, o.ref, o.tableName, o.clientName, o.serverName, o.saleRef, ...o.lines.map(l => l.name)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const printOrder = (o: BizTableOrder) => {
    printTableOrder(o, settings);
    biz.update('tableOrders', {
      ...o, printCount: (o.printCount || 0) + 1,
      history: [...(o.history || []), tableEvent('impression', by, o.status === 'pending' ? 'Bon de table' : 'Ticket')],
    });
  };

  const openInPos = (o: BizTableOrder) => navigate(`${cfg.base}/pos?order=${o.id}`);

  const doCancel = (o: BizTableOrder, reason: string) => {
    const at = new Date().toISOString();
    biz.update('tableOrders', {
      ...o, status: 'cancelled', cancelledAt: at, updatedAt: at, cancelReason: reason || undefined,
      history: [...(o.history || []), tableEvent('annulation', by, reason || undefined)],
    });
    toast.success(`Note ${o.ref} annulée`);
  };

  /** Une note annulée peut repartir en attente (si sa table est libre). */
  const reopen = (o: BizTableOrder) => {
    const other = pendingOf(o.tableId);
    if (other) { toast.error(`${o.tableName} a déjà une note en attente (${other.ref})`); return; }
    biz.update('tableOrders', {
      ...o, status: 'pending', cancelledAt: undefined, cancelReason: undefined, updatedAt: new Date().toISOString(),
      history: [...(o.history || []), tableEvent('réouverture', by)],
    });
    toast.success(`Note ${o.ref} rouverte`);
  };

  const editAction = (o: BizTableOrder) => {
    if (o.status === 'pending') openInPos(o); else setEditOrder(o);
  };

  const orderRowActions = (o: BizTableOrder) => (
    <RowActions>
      <ActionBtn icon={Eye} tone="blue" title="Voir les détails" onClick={() => setDetail(o)} />
      {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title={o.status === 'pending' ? 'Modifier les articles (point de vente)' : 'Modifier client / note'} onClick={() => editAction(o)} />}
      <ActionBtn icon={Printer} title={o.status === 'pending' ? 'Imprimer le bon de table' : 'Imprimer le ticket'} onClick={() => printOrder(o)} />
      {o.status === 'pending' && perm.creer && <ActionBtn icon={Wallet} tone="green" title="Encaisser au point de vente" onClick={() => openInPos(o)} />}
      {o.status === 'pending' && perm.modifier && <ActionBtn icon={Ban} tone="red" title="Annuler la commande" onClick={() => setCancelOrder(o)} />}
      {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setDeleteOrder(o)} />}
    </RowActions>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader icon={LayoutGrid} title="Gestion des tables" subtitle={`${cfg.label} — salle, notes en attente et historique`}
        actions={<>
          <button className="btn-secondary" onClick={() => navigate(`${cfg.base}/pos`)}><ShoppingBag className="w-4 h-4" /> Point de vente</button>
          {perm.creer && <button className="btn-secondary" onClick={() => setShowBulk(true)}><Layers className="w-4 h-4" /> Créer en série</button>}
          {perm.creer && <button className="btn-primary" onClick={() => setEditTable('new')}><Plus className="w-4 h-4" /> Nouvelle table</button>}
        </>} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={LayoutGrid} label="Tables actives" value={tables.filter(t => !t.inactive).length} sub={`${tables.length} au total`} tone="blue" />
        <StatCard icon={Clock} label="Occupées" value={pending.length} sub={money(pending.reduce((s, o) => s + o.total, 0))} tone="amber"
          onClick={() => { setTab('orders'); setStatusFilter('pending'); }} />
        <StatCard icon={CheckCircle} label="Encaissées aujourd'hui" value={doneToday.length} sub={money(revenueToday)} tone="green"
          onClick={() => { setTab('orders'); setStatusFilter('completed'); setPeriod('today'); }} />
        <StatCard icon={Receipt} label="Ticket moyen" value={money(doneToday.length ? revenueToday / doneToday.length : 0)} sub={coversToday ? `${coversToday} couvert(s)` : undefined} tone="purple" />
        <StatCard icon={XCircle} label="Annulées aujourd'hui" value={cancelledToday.length} tone="red"
          onClick={() => { setTab('orders'); setStatusFilter('cancelled'); setPeriod('today'); }} />
      </div>

      <Tabs active={tab} onChange={id => setTab(id as any)} tabs={[
        { id: 'tables', label: `Tables (${tables.length})`, icon: LayoutGrid },
        { id: 'orders', label: `Commandes (${orders.length})`, icon: Utensils },
      ]} />

      {tab === 'tables' && (
        <div className="space-y-3">
          <div className="card-glass p-3 flex flex-wrap gap-2 items-center">
            <div className="flex-1 min-w-[200px]"><SearchInput value={tableSearch} onChange={setTableSearch} placeholder="Rechercher une table…" /></div>
            {zones.length > 0 && (
              <Select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} className="!w-auto">
                <option value="all">Toutes les zones</option>
                {zones.map(z => <option key={z} value={z}>{z}</option>)}
              </Select>
            )}
            <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
          </div>

          {filteredTables.length === 0 ? (
            <EmptyState icon={LayoutGrid} title="Aucune table" message="Créez les tables de votre salle pour prendre les commandes à table."
              action={perm.creer ? <button className="btn-primary" onClick={() => setEditTable('new')}><Plus className="w-4 h-4" /> Nouvelle table</button> : undefined} />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredTables.map(t => {
                const o = pendingOf(t.id);
                const count = orders.filter(x => x.tableId === t.id).length;
                return (
                  <div key={t.id} className={`card-glass p-4 border-l-4 ${t.inactive ? 'border-slate-300 opacity-60' : o ? 'border-amber-400' : 'border-emerald-400'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-black text-lg text-slate-800 truncate">{t.name}</p>
                        <p className="text-[11px] font-bold text-slate-400">
                          {t.zone || 'Sans zone'}{t.seats ? ` · ${t.seats} place(s)` : ''}
                        </p>
                      </div>
                      <Badge tone={t.inactive ? 'neutral' : o ? 'warning' : 'success'}>{t.inactive ? 'Désactivée' : o ? 'Occupée' : 'Libre'}</Badge>
                    </div>
                    {o ? (
                      <button onClick={() => setDetail(o)} className="mt-3 w-full text-left rounded-xl bg-amber-50 border border-amber-200 p-2.5 hover:bg-amber-100 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-amber-700">{o.ref} · {o.lines.length} article(s)</span>
                          <span className="text-sm font-black tabular-nums text-amber-800">{money(o.total)}</span>
                        </div>
                        <p className="text-[10px] font-bold text-amber-600 mt-0.5 flex items-center gap-1"><Clock className="w-3 h-3" /> {elapsedLabel(o.createdAt)}{o.covers ? ` · ${o.covers} couvert(s)` : ''}{o.serverName ? ` · ${o.serverName}` : ''}</p>
                      </button>
                    ) : (
                      <p className="mt-3 text-[11px] text-slate-400">{count} commande(s) dans l'historique</p>
                    )}
                    {t.notes && <p className="mt-2 text-[11px] text-slate-500 italic line-clamp-2">{t.notes}</p>}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      {o
                        ? <button className="btn-primary !py-1.5 !px-3 !text-[11px]" onClick={() => openInPos(o)}><Wallet className="w-3.5 h-3.5" /> Ouvrir la note</button>
                        : <span />}
                      <RowActions>
                        <ActionBtn icon={History} tone="blue" title="Historique de la table" onClick={() => setHistoryTable(t)} />
                        {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditTable(t)} />}
                        {perm.modifier && <ActionBtn icon={Power} title={t.inactive ? 'Réactiver' : 'Désactiver'} onClick={() => toggleActive(t)} />}
                        {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setDeleteTable(t)} />}
                      </RowActions>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Table head={<>
              <th className="table-head">Table</th><th className="table-head">Zone</th><th className="table-head text-right">Places</th>
              <th className="table-head">Statut</th><th className="table-head text-right">Note en cours</th>
              <th className="table-head text-right">Commandes</th><th className="table-head text-right">Actions</th>
            </>}>
              {filteredTables.map(t => {
                const o = pendingOf(t.id);
                return (
                  <tr key={t.id} className={t.inactive ? 'opacity-60' : ''}>
                    <td className="table-cell font-black text-slate-700">{t.name}</td>
                    <td className="table-cell text-slate-500">{t.zone || '—'}</td>
                    <td className="table-cell text-right tabular-nums">{t.seats || '—'}</td>
                    <td className="table-cell"><Badge tone={t.inactive ? 'neutral' : o ? 'warning' : 'success'}>{t.inactive ? 'Désactivée' : o ? 'Occupée' : 'Libre'}</Badge></td>
                    <td className="table-cell text-right tabular-nums font-bold">{o ? `${money(o.total)} · ${elapsedLabel(o.createdAt)}` : '—'}</td>
                    <td className="table-cell text-right tabular-nums">{orders.filter(x => x.tableId === t.id).length}</td>
                    <td className="table-cell">
                      <div className="flex justify-end">
                        <RowActions>
                          <ActionBtn icon={History} tone="blue" title="Historique" onClick={() => setHistoryTable(t)} />
                          {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditTable(t)} />}
                          {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setDeleteTable(t)} />}
                        </RowActions>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          <div className="card-glass p-3 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex-1 min-w-[200px]"><SearchInput value={orderSearch} onChange={setOrderSearch} placeholder="Réf., table, client, serveur, article…" /></div>
              <Select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className="!w-auto">
                <option value="all">Toutes les tables</option>
                {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'pending', 'completed', 'cancelled'] as const).map(st => {
                const n = st === 'all' ? orders.length : orders.filter(o => o.status === st).length;
                return (
                  <button key={st} onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold ${statusFilter === st ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {st === 'all' ? 'Toutes' : TABLE_ORDER_STATUS_LABEL[st]} ({n})
                  </button>
                );
              })}
            </div>
            <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </div>

          {filteredOrders.length === 0 ? (
            <EmptyState icon={Utensils} title="Aucune commande" message="Les commandes prises à table au point de vente s'affichent ici." />
          ) : (
            <Table head={<>
              <th className="table-head">Réf.</th><th className="table-head">Table</th><th className="table-head">Client</th>
              <th className="table-head text-right">Articles</th><th className="table-head text-right">Total</th>
              <th className="table-head">Statut</th><th className="table-head">Date</th><th className="table-head text-right">Actions</th>
            </>}>
              {filteredOrders.map(o => (
                <tr key={o.id}>
                  <td className="table-cell font-mono font-bold text-[#002d87]">{o.ref}</td>
                  <td className="table-cell font-bold text-slate-700">{o.tableName}{o.covers ? <span className="text-[11px] text-slate-400"> · {o.covers} couv.</span> : null}</td>
                  <td className="table-cell text-slate-600">{o.clientName}</td>
                  <td className="table-cell text-right tabular-nums">{o.lines.reduce((s, l) => s + (l.detailUnit ? 1 : l.qty), 0)}</td>
                  <td className="table-cell text-right tabular-nums font-black">{money(o.total)}</td>
                  <td className="table-cell">
                    <Badge tone={STATUS_TONE[o.status]}>{TABLE_ORDER_STATUS_LABEL[o.status]}</Badge>
                    {o.status === 'pending' && <p className="text-[10px] text-amber-600 font-bold mt-0.5">{elapsedLabel(o.createdAt)}</p>}
                  </td>
                  <td className="table-cell text-[12px] text-slate-500">{formatDateTime(o.completedAt || o.cancelledAt || o.createdAt)}</td>
                  <td className="table-cell"><div className="flex justify-end">{orderRowActions(o)}</div></td>
                </tr>
              ))}
            </Table>
          )}
          {filteredOrders.length > 0 && (
            <p className="text-right text-xs font-bold text-slate-500">
              {filteredOrders.length} commande(s) · encaissé : <span className="text-emerald-600">{money(filteredOrders.filter(o => o.status === 'completed').reduce((s, o) => s + o.total, 0))}</span>
              {' '}· en attente : <span className="text-amber-600">{money(filteredOrders.filter(o => o.status === 'pending').reduce((s, o) => s + o.total, 0))}</span>
            </p>
          )}
        </div>
      )}

      {editTable && (
        <TableFormModal table={editTable === 'new' ? null : editTable} zones={zones}
          onSave={(t, isNew) => { if (saveTable(t, isNew)) setEditTable(null); }}
          onClose={() => setEditTable(null)} />
      )}
      {showBulk && (
        <BulkTablesModal existing={tables} zones={zones}
          onCreate={list => { list.forEach(t => biz.add('tables', t)); toast.success(`${list.length} table(s) créée(s)`); setShowBulk(false); }}
          onClose={() => setShowBulk(false)} />
      )}
      {historyTable && (
        <TableHistoryModal table={historyTable} orders={orders.filter(o => o.tableId === historyTable.id)}
          onView={setDetail} onPrint={printOrder} onClose={() => setHistoryTable(null)} />
      )}
      {detail && (
        <OrderDetailModal order={orders.find(o => o.id === detail.id) || detail}
          onPrint={printOrder} onEdit={perm.modifier ? editAction : undefined}
          onCancel={perm.modifier ? (o => setCancelOrder(o)) : undefined}
          onReopen={perm.modifier ? reopen : undefined}
          onClose={() => setDetail(null)} />
      )}
      {editOrder && (
        <OrderEditModal order={editOrder}
          onSave={(patch) => {
            biz.update('tableOrders', {
              ...editOrder, ...patch, updatedAt: new Date().toISOString(),
              history: [...(editOrder.history || []), tableEvent('modification', by, 'Client / note')],
            });
            toast.success(`Commande ${editOrder.ref} modifiée`);
            setEditOrder(null);
          }}
          onClose={() => setEditOrder(null)} />
      )}
      {cancelOrder && (
        <CancelOrderModal order={cancelOrder}
          onConfirm={reason => { doCancel(cancelOrder, reason); setCancelOrder(null); setDetail(null); }}
          onClose={() => setCancelOrder(null)} />
      )}
      <Confirm open={!!deleteTable} title="Supprimer la table"
        message={`Supprimer « ${deleteTable?.name} » ? Les commandes déjà passées restent dans l'historique.`}
        onConfirm={() => { if (deleteTable) removeTable(deleteTable); setDeleteTable(null); }}
        onCancel={() => setDeleteTable(null)} />
      <Confirm open={!!deleteOrder} title="Supprimer la commande"
        message={deleteOrder?.status === 'completed'
          ? `Supprimer la commande ${deleteOrder?.ref} ? La VENTE ${deleteOrder?.saleRef || ''} déjà enregistrée n'est pas touchée (elle se gère dans l'écran Ventes).`
          : `Supprimer définitivement la commande ${deleteOrder?.ref} ?`}
        onConfirm={() => { if (deleteOrder) { biz.remove('tableOrders', deleteOrder.id); toast.success('Commande supprimée'); } setDeleteOrder(null); }}
        onCancel={() => setDeleteOrder(null)} />
    </div>
  );
}

// ─── Fenêtres ─────────────────────────────────────────────────────────────────

function TableFormModal({ table, zones, onSave, onClose }: {
  table: BizTable | null; zones: string[]; onSave: (t: BizTable, isNew: boolean) => void; onClose: () => void;
}) {
  const [name, setName] = useState(table?.name || '');
  const [zone, setZone] = useState(table?.zone || '');
  const [seats, setSeats] = useState(table?.seats ? String(table.seats) : '');
  const [notes, setNotes] = useState(table?.notes || '');
  const submit = () => {
    if (!name.trim()) { toast.error('Le nom de la table est obligatoire'); return; }
    onSave({
      ...(table || { id: newId(), createdAt: new Date().toISOString() }),
      name: name.trim(), zone: zone.trim() || undefined, seats: Number(seats) || undefined, notes: notes.trim() || undefined,
    } as BizTable, !table);
  };
  return (
    <Modal open onClose={onClose} icon={LayoutGrid} size="md" title={table ? 'Modifier la table' : 'Nouvelle table'}
      footer={<><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={submit}>Enregistrer</button></>}>
      <div className="space-y-3">
        <Field label="Nom de la table" required><Input value={name} onChange={e => setName(e.target.value)} placeholder="Table 1, T-12, Terrasse A…" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zone / salle">
            <Input value={zone} onChange={e => setZone(e.target.value)} list="table-zones" placeholder="Salle, Terrasse…" />
            <datalist id="table-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
          </Field>
          <Field label="Nombre de places"><Input type="number" min={0} value={seats} onChange={e => setSeats(e.target.value)} /></Field>
        </div>
        <Field label="Remarque"><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Près de la fenêtre, réservée VIP…" /></Field>
      </div>
    </Modal>
  );
}

function BulkTablesModal({ existing, zones, onCreate, onClose }: {
  existing: BizTable[]; zones: string[]; onCreate: (list: BizTable[]) => void; onClose: () => void;
}) {
  const [prefix, setPrefix] = useState('Table ');
  const [start, setStart] = useState('1');
  const [count, setCount] = useState('10');
  const [zone, setZone] = useState('');
  const [seats, setSeats] = useState('4');
  const names = Array.from({ length: Math.min(200, Math.max(0, Number(count) || 0)) }, (_, i) => `${prefix}${(Number(start) || 1) + i}`);
  const taken = new Set(existing.map(t => t.name.trim().toLowerCase()));
  const fresh = names.filter(n => !taken.has(n.trim().toLowerCase()));
  return (
    <Modal open onClose={onClose} icon={Layers} size="md" title="Créer des tables en série"
      footer={<><button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" disabled={!fresh.length} onClick={() => onCreate(fresh.map(n => ({
          id: newId(), name: n, zone: zone.trim() || undefined, seats: Number(seats) || undefined, createdAt: new Date().toISOString(),
        })))}>Créer {fresh.length} table(s)</button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Préfixe"><Input value={prefix} onChange={e => setPrefix(e.target.value)} /></Field>
          <Field label="Premier n°"><Input type="number" value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Nombre"><Input type="number" min={1} max={200} value={count} onChange={e => setCount(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zone / salle">
            <Input value={zone} onChange={e => setZone(e.target.value)} list="bulk-zones" />
            <datalist id="bulk-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
          </Field>
          <Field label="Places par table"><Input type="number" min={0} value={seats} onChange={e => setSeats(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">
          Aperçu : {names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}
          {names.length !== fresh.length && <span className="text-amber-600 font-bold"> — {names.length - fresh.length} nom(s) existent déjà et seront ignorés.</span>}
        </p>
      </div>
    </Modal>
  );
}

function OrderLines({ order }: { order: BizTableOrder }) {
  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-black">
          <tr><th className="px-3 py-2 text-left">Article</th><th className="px-3 py-2 text-right">Qté</th><th className="px-3 py-2 text-right">P.U.</th><th className="px-3 py-2 text-right">Total</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.lines.map(l => (
            <tr key={l.id}>
              <td className="px-3 py-2 font-bold text-slate-700">{l.name}{l.note && <span className="block text-[11px] text-slate-400 font-normal">{l.note}</span>}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.qty}{l.detailUnit ? ` ${l.detailUnit}` : ''}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(l.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-black">{money(l.qty * l.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-3 bg-slate-50 text-sm space-y-1">
        <div className="flex justify-between"><span className="text-slate-500">Sous-total</span><span className="font-bold tabular-nums">{money(order.subtotal)}</span></div>
        {!!order.reduction && <div className="flex justify-between text-amber-700"><span>Remise</span><span className="font-bold tabular-nums">−{money(order.reduction)}</span></div>}
        <div className="flex justify-between text-[#002d87]"><span className="font-black">Total</span><span className="font-black tabular-nums">{money(order.total)}</span></div>
        {order.status === 'completed' && <div className="flex justify-between text-emerald-700"><span>Payé</span><span className="font-bold tabular-nums">{money(order.paid ?? order.total)}</span></div>}
      </div>
    </div>
  );
}

function OrderDetailModal({ order, onPrint, onEdit, onCancel, onReopen, onClose }: {
  order: BizTableOrder; onPrint: (o: BizTableOrder) => void; onEdit?: (o: BizTableOrder) => void;
  onCancel?: (o: BizTableOrder) => void; onReopen?: (o: BizTableOrder) => void; onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} icon={Receipt} size="lg" title={`Commande ${order.ref} — ${order.tableName}`}
      subtitle={`${TABLE_ORDER_STATUS_LABEL[order.status]} · ${formatDateTime(order.createdAt)}`}
      footer={<>
        {order.status === 'pending' && onCancel && <button className="btn-secondary !text-red-600" onClick={() => onCancel(order)}><Ban className="w-4 h-4" /> Annuler</button>}
        {order.status === 'cancelled' && onReopen && <button className="btn-secondary" onClick={() => onReopen(order)}><Clock className="w-4 h-4" /> Rouvrir</button>}
        {onEdit && <button className="btn-secondary" onClick={() => onEdit(order)}><Edit2 className="w-4 h-4" /> Modifier</button>}
        <button className="btn-primary" onClick={() => onPrint(order)}><Printer className="w-4 h-4" /> Imprimer</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Client', order.clientName],
            ['Couverts', order.covers ? String(order.covers) : '—'],
            ['Serveur', order.serverName || '—'],
            ['Vente', order.saleRef || '—'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10px] uppercase font-bold text-slate-400">{k}</p><p className="text-sm font-black text-slate-700 truncate">{v}</p></div>
          ))}
        </div>
        {order.status === 'pending' && <p className="text-xs font-bold text-amber-600 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Table ouverte depuis {elapsedLabel(order.createdAt)}</p>}
        {order.status === 'cancelled' && order.cancelReason && <p className="text-xs font-bold text-red-600">Motif d'annulation : {order.cancelReason}</p>}
        {order.notes && <p className="text-xs text-slate-600 bg-amber-50 rounded-lg p-2">📝 {order.notes}</p>}
        <OrderLines order={order} />
        <div>
          <p className="text-[10px] font-black uppercase text-slate-400 mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Historique</p>
          <ol className="space-y-1.5 border-l-2 border-slate-100 pl-3">
            {[...(order.history || [])].reverse().map((h, i) => (
              <li key={i} className="text-xs">
                <span className="font-black text-slate-700 capitalize">{h.action}</span>
                <span className="text-slate-400"> · {formatDateTime(h.at)} · {h.by}</span>
                {h.detail && <span className="block text-slate-500">{h.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}

function OrderEditModal({ order, onSave, onClose }: {
  order: BizTableOrder; onSave: (p: Partial<BizTableOrder>) => void; onClose: () => void;
}) {
  const [clientName, setClientName] = useState(order.clientName);
  const [covers, setCovers] = useState(order.covers ? String(order.covers) : '');
  const [notes, setNotes] = useState(order.notes || '');
  return (
    <Modal open onClose={onClose} icon={Edit2} size="md" title={`Modifier ${order.ref}`}
      subtitle={order.status === 'completed' ? 'Commande encaissée : les montants restent ceux de la vente.' : undefined}
      footer={<><button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={() => onSave({ clientName: clientName.trim() || order.clientName, covers: Number(covers) || undefined, notes: notes.trim() || undefined })}>Enregistrer</button></>}>
      <div className="space-y-3">
        <Field label="Client"><Input value={clientName} onChange={e => setClientName(e.target.value)} /></Field>
        <Field label="Couverts"><Input type="number" min={0} value={covers} onChange={e => setCovers(e.target.value)} /></Field>
        <Field label="Note"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function TableHistoryModal({ table, orders, onView, onPrint, onClose }: {
  table: BizTable; orders: BizTableOrder[]; onView: (o: BizTableOrder) => void; onPrint: (o: BizTableOrder) => void; onClose: () => void;
}) {
  const [status, setStatus] = useState<'all' | BizTableOrderStatus>('all');
  const list = orders.filter(o => status === 'all' || o.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = orders.filter(o => o.status === 'completed');
  const revenue = done.reduce((s, o) => s + o.total, 0);
  // Les plats les plus servis à cette table.
  const top = useMemo(() => {
    const m = new Map<string, number>();
    done.forEach(o => o.lines.forEach(l => m.set(l.name, (m.get(l.name) || 0) + (l.detailUnit ? 1 : l.qty))));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [orders]);
  return (
    <Modal open onClose={onClose} icon={History} size="xl" title={`Historique — ${table.name}`}
      subtitle={`${table.zone || 'Sans zone'}${table.seats ? ` · ${table.seats} place(s)` : ''}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Commandes</p><p className="text-lg font-black">{orders.length}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] uppercase font-bold text-emerald-600">Chiffre encaissé</p><p className="text-lg font-black text-emerald-700">{money(revenue)}</p></div>
          <div className="rounded-xl bg-purple-50 p-3"><p className="text-[10px] uppercase font-bold text-purple-600">Ticket moyen</p><p className="text-lg font-black text-purple-700">{money(done.length ? revenue / done.length : 0)}</p></div>
          <div className="rounded-xl bg-red-50 p-3"><p className="text-[10px] uppercase font-bold text-red-600">Annulées</p><p className="text-lg font-black text-red-700">{orders.filter(o => o.status === 'cancelled').length}</p></div>
        </div>
        {top.length > 0 && (
          <p className="text-xs text-slate-500"><span className="font-black text-slate-700">Les plus servis :</span> {top.map(([n, q]) => `${n} (${q})`).join(' · ')}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'pending', 'completed', 'cancelled'] as const).map(st => (
            <button key={st} onClick={() => setStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === st ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
              {st === 'all' ? 'Toutes' : TABLE_ORDER_STATUS_LABEL[st]}
            </button>
          ))}
        </div>
        {list.length === 0 ? <p className="text-center text-sm text-slate-400 py-8">Aucune commande.</p> : (
          <div className="space-y-2">
            {list.map(o => (
              <div key={o.id} className="rounded-xl border border-slate-100 p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-black text-slate-700">{o.ref} · {o.clientName} <Badge tone={STATUS_TONE[o.status]}>{TABLE_ORDER_STATUS_LABEL[o.status]}</Badge></p>
                  <p className="text-[11px] text-slate-400">{formatDateTime(o.createdAt)} · {o.lines.length} article(s){o.serverName ? ` · ${o.serverName}` : ''}{o.saleRef ? ` · vente ${o.saleRef}` : ''}</p>
                  <p className="text-[11px] text-slate-500 truncate">{o.lines.map(l => `${l.qty}× ${l.name}`).join(', ')}</p>
                </div>
                <span className="font-black tabular-nums text-[#002d87]">{money(o.total)}</span>
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Détails" onClick={() => onView(o)} />
                  <ActionBtn icon={Printer} title="Imprimer" onClick={() => onPrint(o)} />
                </RowActions>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
