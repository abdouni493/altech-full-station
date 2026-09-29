import React, { useMemo, useState } from 'react';
import { Beaker, Flame, RotateCcw, Trash2 as Trash, Search, Layers, Wallet, Boxes } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizComptoirItem, BizDestruction, formatQty } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, Select, CardGrid, GlassCard, EmptyState, Tabs, Table,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, money, formatDate,
} from '@/src/components/biz/Kit';

export default function ModuleComptoir({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'comptoir');
  // Le stock a désormais ses propres destructions : chaque écran n'affiche que
  // les siennes (une ligne sans `source` vient du comptoir, avant la séparation).
  const { comptoir } = biz.state;
  const destructions = useMemo(
    () => biz.state.destructions.filter(d => d.source !== 'stock'),
    [biz.state.destructions]);
  const [tab, setTab] = useState<'avail' | 'destroy'>('avail');
  // Le comptoir s'ouvre en tableau : on y cherche une quantité disponible et
  // une valeur, colonne par colonne. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [destroying, setDestroying] = useState<BizComptoirItem | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState<'recover' | 'delete' | null>(null);

  const cats = useMemo(() => Array.from(new Set(comptoir.map(c => c.categoryName).filter(Boolean))) as string[], [comptoir]);
  // Une ligne pile à zéro a été écoulée proprement et disparaît. Une ligne
  // NÉGATIVE, elle, reste affichée : le point de vente a servi plus que ce qui
  // avait été fabriqué, et il faut voir ce qu'il reste à produire pour combler.
  const availFiltered = useMemo(() => comptoir.filter(c =>
    c.qty !== 0 && matchesSearch(search, c.productName) && (cat === 'all' || c.categoryName === cat)), [comptoir, search, cat]);

  const stockValue = comptoir.reduce((s, c) => s + c.qty * c.unitPrice, 0);
  const destroyedValue = destructions.reduce((s, d) => s + (d.recovered ? 0 : d.value), 0);

  const doDestroy = (qty: number, reason: string) => {
    if (!destroying || qty <= 0) return;
    const amount = Math.min(destroying.qty, qty);
    biz.update('comptoir', { ...destroying, qty: destroying.qty - amount });
    biz.add('destructions', {
      id: newId(), source: 'comptoir', productName: destroying.productName,
      categoryName: destroying.categoryName, qty: amount, unit: destroying.unit,
      unitPrice: destroying.unitPrice,
      // Coût de production conservé à part : c'est lui qui repartira au comptoir
      // si le produit est récupéré, jamais le prix de vente.
      unitCost: destroying.purchasePrice || 0,
      value: amount * destroying.unitPrice, reason, date: new Date().toISOString(), createdBy: 'Admin', recovered: false,
    } as BizDestruction);
    toast.success('Destruction enregistrée');
    setDestroying(null);
  };

  const recover = (d: BizDestruction) => {
    biz.update('destructions', { ...d, recovered: true, recoveredAt: new Date().toISOString() });
    // Return qty to comptoir (find matching item or create)
    const existing = comptoir.find(c => c.productName === d.productName);
    if (existing) biz.update('comptoir', { ...existing, qty: existing.qty + d.qty });
    // Le produit revient avec son coût de revient — le prix de vente n'est un
    // coût pour personne, et le retenir mettrait son gain à zéro.
    else biz.add('comptoir', { id: newId(), productName: d.productName, categoryName: d.categoryName, qty: d.qty, unit: d.unit, unitPrice: d.unitPrice, purchasePrice: d.unitCost ?? 0, date: new Date().toISOString() });
    toast.success('Produit récupéré au comptoir');
  };

  const bulkRecover = () => { selected.forEach(id => { const d = destructions.find(x => x.id === id); if (d && !d.recovered) recover(d); }); setSelected([]); setConfirmBulk(null); };
  const bulkDelete = () => { selected.forEach(id => biz.remove('destructions', id)); setSelected([]); setConfirmBulk(null); toast.success('Supprimé'); };
  const toggleSel = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Beaker} title="Comptoir" subtitle={`${cfg.label} — produits prêts à la vente`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Boxes} label="Produits comptoir" value={availFiltered.length} tone="blue" />
        <StatCard icon={Wallet} label="Valeur comptoir" value={money(stockValue)} tone="green" />
        <StatCard icon={Flame} label="Destructions" value={destructions.filter(d => !d.recovered).length} tone="red" />
        <StatCard icon={Flame} label="Valeur détruite" value={money(destroyedValue)} tone="amber" />
      </div>

      <Tabs tabs={[{ id: 'avail', label: 'Disponible', icon: Beaker }, { id: 'destroy', label: 'Historique destructions', icon: Flame }]} active={tab} onChange={id => setTab(id as any)} />

      {tab === 'avail' ? (
        <>
          <div className="card-glass p-4 flex flex-wrap items-center gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Nom du produit…" />
            <Select value={cat} onChange={e => setCat(e.target.value)} className="!w-auto min-w-[160px]">
              <option value="all">Toutes catégories</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
          </div>
          {availFiltered.length === 0 ? <EmptyState icon={Beaker} title="Comptoir vide" message="Transférez des productions vers le comptoir." /> : view === 'table' ? (
            <Table head={<>
              <th className="table-head">Produit</th><th className="table-head">Catégorie</th><th className="table-head">Depuis</th>
              <th className="table-head text-right">Disponible</th><th className="table-head text-right">Prix unit.</th>
              <th className="table-head text-right">Valeur stock</th><th className="table-head text-right">Actions</th>
            </>}>
              {availFiltered.map(c => (
                <tr key={c.id}>
                  <td className="table-cell">
                    <div className="font-bold text-slate-700">{c.productName}</div>
                    {c.qty < 0 && (
                      <div className="text-[11px] font-semibold text-red-600">
                        Vendu à découvert — {formatQty(-c.qty)} {c.unit || ''} à produire
                      </div>
                    )}
                  </td>
                  <td className="table-cell">{c.categoryName ? <Badge tone="primary"><Layers className="w-3 h-3" />{c.categoryName}</Badge> : <span className="text-slate-400">—</span>}</td>
                  <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(c.date)}</td>
                  <td className={`table-cell tabular-nums text-right font-black ${c.qty < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {formatQty(c.qty)} <span className="text-xs font-normal text-slate-400">{c.unit}</span>
                  </td>
                  <td className="table-cell tabular-nums text-right">{money(c.unitPrice)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(c.qty * c.unitPrice)}</td>
                  <td className="table-cell text-right">
                    <RowActions>
                      {perm.supprimer && c.qty > 0 && <ActionBtn icon={Flame} tone="red" title="Destruction" onClick={() => setDestroying(c)} />}
                    </RowActions>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <CardGrid>
              {availFiltered.map(c => (
                <GlassCard key={c.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div><h3 className="font-black text-slate-800">{c.productName}</h3>{c.categoryName && <Badge tone="primary"><Layers className="w-3 h-3" />{c.categoryName}</Badge>}</div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">Depuis {formatDate(c.date)}</p>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className={`rounded-xl p-2.5 ${c.qty < 0 ? 'bg-red-50' : 'bg-emerald-50'}`}><p className="text-[10px] uppercase font-bold text-slate-400">Disponible</p><p className={`font-black tabular-nums ${c.qty < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatQty(c.qty)} <span className="text-xs text-slate-400">{c.unit}</span></p></div>
                    <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10px] uppercase font-bold text-slate-400">Prix unit.</p><p className="font-black text-slate-700 tabular-nums">{money(c.unitPrice)}</p></div>
                  </div>
                  {c.qty < 0 && (
                    <p className="mt-2 text-[11px] font-semibold text-red-600 leading-tight">
                      Vendu à découvert au point de vente — {formatQty(-c.qty)} {c.unit || ''} à
                      produire pour revenir à zéro.
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-slate-400">Valeur stock</span><span className="font-black text-[#002d87] tabular-nums">{money(c.qty * c.unitPrice)}</span>
                  </div>
                  {perm.supprimer && c.qty > 0 && (
                  <button className="w-full mt-3 !py-2 rounded-xl bg-red-50 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-red-100 transition-colors" onClick={() => setDestroying(c)}>
                    <Flame className="w-4 h-4" /> Destruction
                  </button>)}
                </GlassCard>
              ))}
            </CardGrid>
          )}
        </>
      ) : (
        <>
          {selected.length > 0 && (
            <div className="card-glass p-3 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-500">{selected.length} sélectionné(s)</span>
              <div className="ml-auto flex gap-2">
                {perm.modifier && <button className="btn-outline !py-1.5" onClick={() => setConfirmBulk('recover')}><RotateCcw className="w-4 h-4" /> Récupérer</button>}
                {perm.supprimer && <button className="!py-1.5 px-4 rounded-xl bg-red-600 text-white font-bold text-xs flex items-center gap-1.5" onClick={() => setConfirmBulk('delete')}><Trash className="w-4 h-4" /> Supprimer</button>}
              </div>
            </div>
          )}
          {destructions.length === 0 ? <EmptyState icon={Flame} title="Aucune destruction" /> : (
            <Table head={<>
              <th className="table-head"><input type="checkbox" checked={selected.length === destructions.length && destructions.length > 0} onChange={e => setSelected(e.target.checked ? destructions.map(d => d.id) : [])} /></th>
              <th className="table-head">Date</th><th className="table-head">Produit</th><th className="table-head">Qté</th><th className="table-head">Valeur</th>
              <th className="table-head">Motif</th><th className="table-head">Agent</th><th className="table-head">État</th><th className="table-head text-right">Actions</th>
            </>}>
              {destructions.map(d => (
                <tr key={d.id}>
                  <td className="table-cell"><input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleSel(d.id)} /></td>
                  <td className="table-cell">{formatDate(d.date)}</td>
                  <td className="table-cell font-bold">{d.productName}</td>
                  <td className="table-cell tabular-nums">{d.qty}</td>
                  <td className="table-cell tabular-nums text-red-600">{money(d.value)}</td>
                  <td className="table-cell text-slate-500">{d.reason || '—'}</td>
                  <td className="table-cell">{d.createdBy}</td>
                  <td className="table-cell">{d.recovered ? <Badge tone="success">Récupéré</Badge> : <Badge tone="danger">Détruit</Badge>}</td>
                  <td className="table-cell">
                    <div className="flex items-center gap-1.5 justify-end">
                      {!d.recovered && <ActionBtn icon={RotateCcw} tone="green" title="Récupérer" onClick={() => recover(d)} />}
                      {perm.supprimer && <ActionBtn icon={Trash} tone="red" title="Supprimer" onClick={() => biz.remove('destructions', d.id)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {destroying && <DestroyModal item={destroying} onClose={() => setDestroying(null)} onConfirm={doDestroy} />}
      <Confirm open={confirmBulk === 'recover'} danger={false} confirmLabel="Récupérer" title="Récupérer les produits" message={`Récupérer ${selected.length} produit(s) au comptoir ?`} onConfirm={bulkRecover} onCancel={() => setConfirmBulk(null)} />
      <Confirm open={confirmBulk === 'delete'} title="Supprimer" message={`Supprimer ${selected.length} ligne(s) ?`} onConfirm={bulkDelete} onCancel={() => setConfirmBulk(null)} />
    </div>
  );
}

function DestroyModal({ item, onClose, onConfirm }: { item: BizComptoirItem; onClose: () => void; onConfirm: (qty: number, reason: string) => void }) {
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} icon={Flame} size="md" title="Destruction de produit" subtitle={item.productName}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="!px-6 !py-2.5 rounded-xl bg-red-600 text-white font-bold text-xs uppercase" onClick={() => onConfirm(qty, reason)}>Confirmer</button></>}>
      <div className="space-y-4">
        <Field label={`Quantité à détruire (max ${item.qty})`}><Input type="number" value={qty} max={item.qty} onChange={e => setQty(Number(e.target.value))} /></Field>
        <Field label="Motif de destruction"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Péremption, casse, échantillon…" /></Field>
        <div className="rounded-xl bg-red-50 p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-red-500">Valeur détruite</span>
          <span className="text-xl font-black tabular-nums text-red-600">{money(Math.min(item.qty, qty) * item.unitPrice)}</span>
        </div>
      </div>
    </Modal>
  );
}
