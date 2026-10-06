/**
 * ─── Armoires : les rangements de produits de la piste ─────────────────────────
 *
 * Une armoire dessert une ou plusieurs POMPES (et, au besoin, une piste). Les
 * produits y arrivent par TRANSFERT depuis le premier ou le second magasin, et
 * en sortent par les VENTES saisies dans les brigades — ou y entrent par les
 * ACHATS réglés par un pompiste sur la caisse de sa brigade.
 *
 * Bouteilles de gaz (produits consignés) : le stock se lit « pleines / vides ».
 * Une vente vide la bouteille (elle reste dans l'armoire), un remplissage la
 * remplit, un achat de bouteilles vides agrandit le parc.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Archive, Plus, Edit2, Trash2, Package, ArrowDownToLine, ShoppingBag, Map as MapIcon,
  Boxes, History, ArrowLeftRight, Wrench, Eye, Store, ArrowRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn, newId } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission, Armoire, pumpsInCreationOrder,
} from '../store/AppContext';
import { useBizAll } from '../store/BizContext';
import {
  PageHeader, StatCard, Modal, Field, Input, Select, Textarea, Confirm, EmptyState, Tabs,
  formatDateTime, money,
} from '@/src/components/biz/Kit';
import StockTransferBuilder from '@/src/components/armoires/StockTransferBuilder';
import { findMagasinProduct, magasinLabel, armoireProductMovements, armoireSplit } from '@/src/lib/armoires';
import { roundQty } from '@/src/lib/bizConfig';

const fmt = (n: number) => roundQty(n).toLocaleString('fr-FR');

// ── Création / modification ──────────────────────────────────────────────────
function ArmoireForm({ armoire, onClose, onSave }: {
  armoire: Armoire | null;
  onClose: () => void;
  onSave: (form: Omit<Armoire, 'id' | 'createdAt'>) => void;
}) {
  const { tracks = [], pumps = [] } = useAppState();
  const dispatch = useAppDispatch();
  const [name, setName] = useState(armoire?.name || '');
  const [trackId, setTrackId] = useState(armoire?.trackId || '');
  const [pumpIds, setPumpIds] = useState<string[]>(armoire?.pumpIds || []);
  const [notes, setNotes] = useState(armoire?.notes || '');
  const orderedPumps = pumpsInCreationOrder(pumps);

  const addTrack = () => {
    const label = window.prompt('Nom de la nouvelle piste :');
    if (!label || !label.trim()) return;
    const id = newId();
    dispatch({ type: 'ADD_TRACK', payload: { id, name: label.trim() } });
    setTrackId(id);
  };

  const submit = () => {
    if (!name.trim()) { toast.error("Le nom de l'armoire est requis."); return; }
    if (!trackId && pumpIds.length === 0) {
      toast.error("Rattachez l'armoire à au moins une pompe ou à une piste.");
      return;
    }
    onSave({ name: name.trim(), trackId: trackId || undefined, pumpIds, notes: notes.trim() || undefined });
  };

  return (
    <Modal open onClose={onClose} size="lg" icon={Archive}
      title={armoire ? "Modifier l'armoire" : 'Nouvelle armoire'}
      subtitle="Rangement de produits rattaché aux pompes de la piste"
      footer={<>
        <button onClick={onClose} className="btn-ghost">Annuler</button>
        <button onClick={submit} className="btn-primary">{armoire ? 'Enregistrer' : "Créer l'armoire"}</button>
      </>}>
      <div className="space-y-5">
        <Field label="Nom de l'armoire" required>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Armoire Piste Nord" autoFocus />
        </Field>

        <Field label="Pompes desservies" hint="Le pompiste qui tient l'une de ces pompes vend depuis cette armoire pendant sa brigade.">
          {orderedPumps.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Aucune pompe configurée — ajoutez-les depuis « Pompes ».</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {orderedPumps.map(p => {
                const on = pumpIds.includes(p.id);
                return (
                  <button key={p.id} type="button"
                    onClick={() => setPumpIds(prev => on ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                    className={cn('px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                      on ? 'bg-[#001f5c] text-white border-[#001f5c]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#003087]')}>
                    {p.number} · {p.name}
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <Field label="Piste (optionnel)">
          <div className="flex gap-2">
            <Select value={trackId} onChange={e => setTrackId(e.target.value)}>
              <option value="">— Aucune piste —</option>
              {tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <button type="button" onClick={addTrack} title="Nouvelle piste"
              className="h-11 px-3 shrink-0 rounded-xl border-2 border-slate-200 text-[#003087] font-black hover:border-[#003087]">+ Piste</button>
          </div>
        </Field>

        <Field label="Notes (optionnel)">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Détail d'une armoire ─────────────────────────────────────────────────────
function ArmoireDetail({ armoire, onClose, onTransfer }: { armoire: Armoire; onClose: () => void; onTransfer: () => void }) {
  const { armoireStock = [], stockTransfers = [], armoireSales = [], armoirePurchases = [], pompistes = [], pumps = [], tracks = [] } = useAppState();
  const biz = useBizAll();
  const [tab, setTab] = useState<'stock' | 'transfers' | 'purchases' | 'sales'>('stock');
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  const stock = armoireStock.filter(s => s.armoireId === armoire.id && (s.quantity !== 0 || (s.emptyQuantity || 0) !== 0));
  const transfers = stockTransfers.filter(t => t.armoireId === armoire.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const purchases = armoirePurchases.filter(p => p.armoireId === armoire.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const sales = armoireSales.filter(s => s.armoireId === armoire.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const pompisteName = (id?: string) => pompistes.find(p => p.id === id)?.name || '—';
  const productName = (id: string, fallback?: string) => findMagasinProduct(biz, id)?.product.name || fallback || 'Produit supprimé';

  const totalQty = stock.reduce((s, r) => s + r.quantity, 0);
  const totalSales = sales.reduce((s, r) => s + r.total, 0);
  const pumpNames = (armoire.pumpIds || []).map(id => pumps.find(p => p.id === id)).filter(Boolean).map(p => `${p!.number} · ${p!.name}`);
  const trackName = tracks.find(t => t.id === armoire.trackId)?.name;

  const historyProduct = historyOf ? findMagasinProduct(biz, historyOf)?.product : undefined;
  const history = historyOf ? armoireProductMovements(armoire.id, historyOf, stockTransfers, armoirePurchases, armoireSales, pompisteName) : [];

  return (
    <Modal open onClose={onClose} size="xl" fullHeight icon={Archive} title={armoire.name}
      subtitle={[trackName ? `Piste ${trackName}` : '', pumpNames.length ? `Pompes : ${pumpNames.join(', ')}` : ''].filter(Boolean).join(' — ') || 'Aucune pompe rattachée'}
      footer={<button onClick={onTransfer} className="btn-primary"><ArrowLeftRight className="w-4 h-4" /> Transférer vers cette armoire</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={Boxes} label="Références" value={stock.filter(s => s.quantity > 0).length} />
          <StatCard icon={Package} label="Qté totale" value={fmt(totalQty)} tone="green" />
          <StatCard icon={ShoppingBag} label="Ventes" value={money(totalSales)} tone="amber" />
        </div>

        <Tabs active={tab} onChange={id => setTab(id as any)} tabs={[
          { id: 'stock', label: 'Produits actuels', icon: Package },
          { id: 'transfers', label: `Transferts (${transfers.length})`, icon: ArrowDownToLine },
          { id: 'purchases', label: `Achats / remplissages (${purchases.length})`, icon: ArrowLeftRight },
          { id: 'sales', label: `Ventes (${sales.length})`, icon: ShoppingBag },
        ]} />

        {tab === 'stock' && (stock.length === 0 ? (
          <EmptyState icon={Package} title="Aucun produit" message="Transférez des produits depuis un magasin vers cette armoire." />
        ) : (
          <div className="space-y-2">
            {stock.map(s => {
              const found = findMagasinProduct(biz, s.productId);
              const p = found?.product;
              const consigned = !!p?.consigneActive || (s.emptyQuantity || 0) !== 0;
              const split = armoireSplit(s);
              return (
                <div key={s.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-xl bg-[#eef3fc] text-[#003087] flex items-center justify-center"><Package className="w-5 h-5" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">
                          {p?.name || 'Produit supprimé'}
                          {consigned && <span className="ml-2 badge badge-yellow">Vide / Plein</span>}
                        </p>
                        <p className="text-[11px] text-slate-400 font-bold flex items-center gap-1">
                          <Store className="w-3 h-3" /> {magasinLabel(found?.moduleKey || s.moduleKey)}
                          {p?.barcode ? ` · Code : ${p.barcode}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className={cn('text-lg font-black', s.quantity < 0 ? 'text-red-600' : 'text-[#002d87]')}>{fmt(s.quantity)}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">{p?.unit || 'unités'}</p>
                      </div>
                      <button onClick={() => setHistoryOf(s.productId)} title="Historique de ce produit"
                        className="p-2 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600"><History className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {consigned && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-center">
                        <p className="text-lg font-black text-emerald-700 leading-none">{fmt(split.full)}</p>
                        <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mt-1">Pleines</p>
                      </div>
                      <div className="bg-orange-50 border border-orange-100 rounded-xl p-2.5 text-center">
                        <p className="text-lg font-black text-orange-700 leading-none">{fmt(split.empty)}</p>
                        <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mt-1">Vides</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {tab === 'transfers' && (transfers.length === 0 ? (
          <EmptyState icon={ArrowDownToLine} title="Aucun transfert" message="Les transferts vers cette armoire s'afficheront ici." />
        ) : (
          <div className="space-y-3">
            {transfers.map(t => (
              <div key={t.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-[11px] font-black text-slate-500">{formatDateTime(t.date)}</span>
                  <span className="badge badge-info">Depuis {magasinLabel(t.moduleKey)}</span>
                </div>
                <div className="space-y-1">
                  {t.items.map(it => (
                    <div key={it.id} className="flex items-center justify-between text-xs gap-2">
                      <span className="font-bold text-slate-700 truncate">
                        {it.productName}
                        {it.consigneState && (
                          <span className={`ml-2 badge ${it.consigneState === 'VIDE' ? 'badge-warning' : 'badge-success'}`}>{it.consigneState === 'VIDE' ? 'Vides' : 'Pleines'}</span>
                        )}
                      </span>
                      <span className="font-black text-emerald-600 shrink-0">+{fmt(it.quantity)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        {tab === 'purchases' && (purchases.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="Aucun achat" message="Les achats de produits rangés dans cette armoire pendant les brigades s'afficheront ici." />
        ) : (
          <div className="space-y-2">
            {purchases.map(p => (
              <div key={p.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">
                    {productName(p.productId, p.productName)}
                    {p.consigneMode && (
                      <span className={`ml-2 badge ${p.consigneMode === 'REMPLISSAGE' ? 'badge-info' : 'badge-warning'}`}>
                        {p.consigneMode === 'REMPLISSAGE' ? 'Vide → Plein' : 'Bouteilles vides'}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-400 font-bold">{formatDateTime(p.date)} · {pompisteName(p.pompisteId)}{p.supplierName ? ` · ${p.supplierName}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn('text-sm font-black', p.consigneMode === 'REMPLISSAGE' ? 'text-blue-700' : 'text-emerald-600')}>
                    {p.consigneMode === 'REMPLISSAGE' ? `${fmt(p.quantity)} remplie(s)` : `+${fmt(p.quantity)}`} × {fmt(p.unitPrice)}
                  </p>
                  <p className="text-[11px] font-black text-[#002d87]">{money(p.total)}</p>
                </div>
              </div>
            ))}
          </div>
        ))}

        {tab === 'sales' && (sales.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Aucune vente" message="Les ventes de produits depuis cette armoire (brigades) s'afficheront ici." />
        ) : (
          <div className="space-y-2">
            {sales.map(s => (
              <div key={s.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">
                    {productName(s.productId, s.productName)}
                    {s.consigne && <span className="ml-2 badge badge-yellow">Plein → Vide</span>}
                  </p>
                  <p className="text-[11px] text-slate-400 font-bold">{formatDateTime(s.date)} · {pompisteName(s.pompisteId)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-orange-600">{s.consigne ? `${fmt(s.quantity)} vidée(s)` : `−${fmt(s.quantity)}`} × {fmt(s.price)}</p>
                  <p className="text-[11px] font-black text-[#002d87]">{money(s.total)}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {historyOf && (
        <Modal open onClose={() => setHistoryOf(null)} size="lg" zClass="z-[80]" icon={History}
          title="Historique du produit" subtitle={`${historyProduct?.name || 'Produit'} · ${armoire.name}`}>
          {history.length === 0 ? (
            <EmptyState icon={History} title="Aucun mouvement" message="Ce produit n'a encore ni transfert, ni achat, ni vente dans cette armoire." />
          ) : (
            <div className="space-y-2">
              {history.map(r => (
                <div key={r.id} className="bg-white p-3.5 rounded-2xl border border-slate-100 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800 flex items-center gap-2 flex-wrap">
                      {r.kind}
                      {r.consigne && <span className="badge badge-yellow">{r.consigne}</span>}
                    </p>
                    <p className="text-[11px] text-slate-400 font-bold">{formatDateTime(r.date)} · {r.detail}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('text-sm font-black', r.kind === 'Vente' ? 'text-orange-600' : r.kind === 'Remplissage' ? 'text-blue-700' : 'text-emerald-600')}>{r.qtyLabel}</p>
                    {r.amount !== undefined && <p className="text-[11px] font-black text-[#002d87]">{money(r.amount)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Armoires() {
  const { armoires = [], armoireStock = [], armoireSales = [], tracks = [], pumps = [] } = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Armoires');
  const transferPerm = useModulePermission('Transferts');
  const biz = useBizAll();

  const [form, setForm] = useState<{ armoire: Armoire | null } | null>(null);
  const [detail, setDetail] = useState<Armoire | null>(null);
  const [toDelete, setToDelete] = useState<Armoire | null>(null);
  const [transferTo, setTransferTo] = useState<string | null>(null);

  const stockOf = (id: string) => armoireStock.filter(s => s.armoireId === id);
  const trackName = (id?: string) => tracks.find(t => t.id === id)?.name;

  const totals = useMemo(() => {
    const consigned = armoireStock.filter(s => findMagasinProduct(biz, s.productId)?.product.consigneActive);
    return {
      qty: armoireStock.reduce((s, r) => s + r.quantity, 0),
      full: consigned.reduce((s, r) => s + (r.quantity - (r.emptyQuantity || 0)), 0),
      empty: consigned.reduce((s, r) => s + (r.emptyQuantity || 0), 0),
      hasConsigne: consigned.length > 0,
      sales: armoireSales.reduce((s, r) => s + r.total, 0),
    };
  }, [armoireStock, armoireSales, biz]);

  const save = (data: Omit<Armoire, 'id' | 'createdAt'>) => {
    if (form?.armoire) {
      dispatch({ type: 'UPDATE_ARMOIRE', payload: { ...form.armoire, ...data } });
      toast.success('Armoire mise à jour');
    } else {
      dispatch({ type: 'ADD_ARMOIRE', payload: { id: newId(), ...data, createdAt: new Date().toISOString() } });
      toast.success('Armoire créée');
    }
    setForm(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Archive} title="Armoires"
        subtitle="Rangements de produits de la piste — stock, transferts depuis les magasins, ventes et achats des brigades."
        actions={<>
          {transferPerm.creer && armoires.length > 0 && (
            <button onClick={() => setTransferTo('')} className="btn-outline"><ArrowLeftRight className="w-4 h-4" /> Transférer</button>
          )}
          {perm.creer && (
            <button onClick={() => setForm({ armoire: null })} className="btn-primary"><Plus className="w-4 h-4" /> Nouvelle armoire</button>
          )}
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Archive} label="Armoires" value={armoires.length} />
        <StatCard icon={Package} label="Qté en armoires" value={fmt(totals.qty)} tone="green" />
        <StatCard icon={ShoppingBag} label="Ventes armoires" value={money(totals.sales)} tone="amber" />
        {totals.hasConsigne
          ? <StatCard icon={Boxes} label="Bouteilles pleines / vides" value={`${fmt(totals.full)} / ${fmt(totals.empty)}`} tone="purple" />
          : <StatCard icon={Wrench} label="Pompes desservies" value={new Set(armoires.flatMap(a => a.pumpIds || [])).size} tone="purple" />}
      </div>

      {armoires.length === 0 ? (
        <EmptyState icon={Archive} title="Aucune armoire"
          message="Créez une armoire et rattachez-la aux pompes qu'elle dessert. Ses produits viendront des magasins par transfert."
          action={perm.creer && <button onClick={() => setForm({ armoire: null })} className="btn-primary"><Plus className="w-4 h-4" /> Nouvelle armoire</button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {armoires.map(a => {
            const st = stockOf(a.id);
            const refs = st.filter(s => s.quantity > 0).length;
            const qty = st.reduce((s, r) => s + r.quantity, 0);
            const consigneRows = st.filter(s => findMagasinProduct(biz, s.productId)?.product.consigneActive);
            const cTotal = consigneRows.reduce((s, r) => s + r.quantity, 0);
            const cEmpty = consigneRows.reduce((s, r) => s + (r.emptyQuantity || 0), 0);
            const pumpLabels = (a.pumpIds || []).map(id => pumps.find(p => p.id === id)).filter(Boolean).map(p => p!.number || p!.name);
            return (
              <div key={a.id} className="card-glass p-5 flex flex-col">
                <div className="flex justify-between items-start gap-3 mb-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
                      <Archive className="w-6 h-6 text-[#FFB800]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-black text-[#002d87] uppercase truncate">{a.name}</h3>
                      <p className="text-[11px] text-slate-500 font-bold flex items-center gap-1.5 truncate">
                        <MapIcon className="w-3 h-3 shrink-0" />
                        {[trackName(a.trackId), pumpLabels.length ? `Pompes ${pumpLabels.join(', ')}` : ''].filter(Boolean).join(' · ') || 'Non rattachée'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {perm.modifier && <button onClick={() => setForm({ armoire: a })} title="Modifier" className="p-2 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Edit2 className="w-4 h-4" /></button>}
                    {perm.supprimer && <button onClick={() => setToDelete(a)} title="Supprimer" className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-slate-50 rounded-2xl p-3 text-center">
                    <p className="text-xl font-black text-[#002d87]">{refs}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Références</p>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-3 text-center">
                    <p className="text-xl font-black text-[#002d87]">{fmt(qty)}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Qté en stock</p>
                  </div>
                </div>
                {consigneRows.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
                      <p className="text-xl font-black text-emerald-700">{fmt(cTotal - cEmpty)}</p>
                      <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Bouteilles pleines</p>
                    </div>
                    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3 text-center">
                      <p className="text-xl font-black text-orange-700">{fmt(cEmpty)}</p>
                      <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">Bouteilles vides</p>
                    </div>
                  </div>
                )}

                <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                  {transferPerm.creer && (
                    <button onClick={() => setTransferTo(a.id)} className="py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider border-2 border-[#003087]/20 text-[#003087] hover:bg-[#eef3fc] flex items-center justify-center gap-1.5">
                      <ArrowLeftRight className="w-4 h-4" /> Transférer
                    </button>
                  )}
                  <button onClick={() => setDetail(a)} className={cn('py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider text-[#FFB800] flex items-center justify-center gap-1.5', !transferPerm.creer && 'col-span-2')}
                    style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
                    <Eye className="w-4 h-4" /> Détails <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && <ArmoireForm armoire={form.armoire} onClose={() => setForm(null)} onSave={save} />}
      {detail && <ArmoireDetail armoire={detail} onClose={() => setDetail(null)} onTransfer={() => { setTransferTo(detail.id); }} />}
      {transferTo !== null && <TransferForArmoire armoireId={transferTo} onClose={() => setTransferTo(null)} />}
      <Confirm
        open={!!toDelete}
        title="Supprimer l'armoire"
        message={`Supprimer « ${toDelete?.name} » ?\nSon stock et l'historique de ses transferts seront perdus. Cette action est irréversible.`}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) { dispatch({ type: 'DELETE_ARMOIRE', payload: toDelete.id }); toast.success('Armoire supprimée'); }
          setToDelete(null);
        }}
      />
    </div>
  );
}

/** Ouvre le constructeur de transfert, l'armoire déjà choisie quand on vient d'une carte. */
function TransferForArmoire({ armoireId, onClose }: { armoireId: string; onClose: () => void }) {
  return <StockTransferBuilder open presetArmoireId={armoireId || undefined} onClose={onClose} />;
}
