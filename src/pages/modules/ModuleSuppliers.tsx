import React, { useMemo, useState } from 'react';
import { Truck, Plus, Phone, MapPin, ShoppingCart, CircleDollarSign, Wallet, TrendingUp } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizContact } from '@/src/lib/bizConfig';
import { matchesSearch } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, EmptyState, Table,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, money, formatDate,
} from '@/src/components/biz/Kit';
import { ContactModal } from './_shared';

export default function ModuleSuppliers({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'suppliers');
  const { suppliers, purchases } = biz.state;

  const [search, setSearch] = useState('');
  // Tableau par défaut : on vient ici pour lire une dette fournisseur, pas pour
  // regarder des vignettes. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizContact | null>(null);
  const [history, setHistory] = useState<BizContact | null>(null);
  const [toDelete, setToDelete] = useState<BizContact | null>(null);

  const filtered = suppliers.filter((s: BizContact) => matchesSearch(search, s.name, s.phone));

  const supStats = (id: string) => {
    const ps = purchases.filter(p => p.supplierId === id);
    const total = ps.reduce((s, x) => s + x.total, 0);
    const paid = ps.reduce((s, x) => s + x.paid, 0);
    return { count: ps.length, total, paid, rest: total - paid, purchases: ps };
  };
  const del = () => { if (toDelete) { biz.remove('suppliers', toDelete.id); toast.success('Fournisseur supprimé'); setToDelete(null); } };
  const totalDebt = suppliers.reduce((s, sup) => s + supStats(sup.id).rest, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Truck} title="Fournisseurs" subtitle={`${cfg.label} — gestion des fournisseurs`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouveau fournisseur</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Truck} label="Fournisseurs" value={suppliers.length} tone="blue" />
        <StatCard icon={ShoppingCart} label="Total achats" value={money(purchases.reduce((s, p) => s + p.total, 0))} tone="green" />
        <StatCard icon={CircleDollarSign} label="Dettes fournisseurs" value={money(totalDebt)} tone="red" />
      </div>

      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom ou téléphone…" />
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Truck} title="Aucun fournisseur" action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouveau fournisseur</button> : undefined} /> : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Fournisseur</th><th className="table-head">Téléphone</th><th className="table-head">Adresse</th>
          <th className="table-head text-right">Achats</th><th className="table-head text-right">Total</th>
          <th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(s => {
            const st = supStats(s.id);
            return (
              <tr key={s.id}>
                <td className="table-cell font-bold text-slate-700">{s.name}</td>
                <td className="table-cell whitespace-nowrap">{s.phone || '—'}</td>
                <td className="table-cell text-slate-500 max-w-[220px] truncate" title={s.address || undefined}>{s.address || '—'}</td>
                <td className="table-cell tabular-nums text-right">{st.count}</td>
                <td className="table-cell tabular-nums text-right font-bold">{money(st.total)}</td>
                <td className="table-cell tabular-nums text-right text-emerald-600">{money(st.paid)}</td>
                <td className="table-cell tabular-nums text-right">
                  {st.rest > 0
                    ? <span className="font-black text-red-600">{money(st.rest)}</span>
                    : <Badge tone="success">À jour</Badge>}
                </td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={ShoppingCart} tone="blue" title="Historique des achats" onClick={() => setHistory(s)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(s); setShowForm(true); }} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(s => {
            const st = supStats(s.id);
            return (
              <GlassCard key={s.id}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-500 text-white flex items-center justify-center"><Truck className="w-5 h-5" /></div>
                  <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{s.name}</h3>{s.phone && <p className="text-xs text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone}</p>}</div>
                </div>
                {s.address && <p className="text-xs text-slate-400 flex items-center gap-1 mt-2"><MapPin className="w-3 h-3" />{s.address}</p>}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Achats</p><p className="font-black text-slate-700 tabular-nums text-sm">{st.count}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-xs">{money(st.paid)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-xs">{money(st.rest)}</p></div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setHistory(s)}><ShoppingCart className="w-4 h-4" /> Achats</button>
                  <RowActions>
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(s); setShowForm(true); }} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      <ContactModal biz={biz} coll="suppliers" open={showForm} onClose={() => setShowForm(false)} initial={editing} />

      <Modal open={!!history} onClose={() => setHistory(null)} icon={ShoppingCart} size="lg" title={`Achats — ${history?.name || ''}`} subtitle="Historique d'approvisionnement">
        {history && (() => {
          const st = supStats(history.id);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total achats</p><p className="font-black text-slate-700 tabular-nums">{money(st.total)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total payé</p><p className="font-black text-emerald-600 tabular-nums">{money(st.paid)}</p></div>
                <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total reste</p><p className="font-black text-red-600 tabular-nums">{money(st.rest)}</p></div>
              </div>
              {st.count === 0 ? <p className="text-center text-slate-400 text-sm py-6">Aucun achat</p> : (
                <Table head={<><th className="table-head">Réf</th><th className="table-head">Date</th><th className="table-head">Articles</th><th className="table-head">Total</th><th className="table-head">Payé</th><th className="table-head">Reste</th></>}>
                  {st.purchases.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(p => (
                    <tr key={p.id}><td className="table-cell font-bold">{p.ref}</td><td className="table-cell">{formatDate(p.date)}</td><td className="table-cell tabular-nums">{p.items.length}</td>
                      <td className="table-cell tabular-nums">{money(p.total)}</td><td className="table-cell tabular-nums text-emerald-600">{money(p.paid)}</td><td className="table-cell tabular-nums text-red-600">{money(p.rest)}</td></tr>
                  ))}
                </Table>
              )}
            </div>
          );
        })()}
      </Modal>

      <Confirm open={!!toDelete} title="Supprimer le fournisseur" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}
