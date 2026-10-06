/**
 * ─── Transfert de produits : MAGASIN → ARMOIRE ─────────────────────────────────
 *
 * Le transfert part du PREMIER ou du SECOND magasin (au choix) et arrive dans
 * une armoire de la piste. Le stock quitte le magasin (sa Gestion de stock
 * baisse) et entre dans l'armoire. Modifier ou supprimer un transfert rend
 * exactement ce qu'il avait déplacé.
 *
 * Bouteilles de gaz (produits consignés) : chaque ligne précise si l'on
 * transfère des bouteilles PLEINES ou VIDES — les deux stocks sont distincts,
 * au magasin comme dans l'armoire.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeftRight, Search, Package, Plus, Minus, Trash2, Check, Store } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn, newId } from '@/src/lib/utils';
import { Modal, Field, Select, Textarea } from '@/src/components/biz/Kit';
import {
  useAppState, useAppDispatch, StockTransfer, StockTransferItem, MagasinKey, ConsigneState,
} from '@/src/store/AppContext';
import { useBiz, useBizAll } from '@/src/store/BizContext';
import { activeMagasinKeys, productStockSplit, roundQty, BizProduct } from '@/src/lib/bizConfig';
import { magasinLabel, magasinProducts, searchMagasinProducts } from '@/src/lib/armoires';
import { db } from '@/src/lib/supabase';

const fmt = (n: number) => roundQty(n).toLocaleString('fr-FR');

/** Une variation du stock d'un produit de magasin : `qty` unités SORTENT. */
interface MagasinMove { moduleKey: MagasinKey; productId: string; qty: number; empty: number }

/**
 * Déplace le stock des magasins. Toutes les variations d'un même produit sont
 * additionnées AVANT d'écrire : une modification de transfert (rendre l'ancien,
 * prendre le nouveau) doit produire UNE écriture, sans quoi la seconde
 * repartirait de la fiche d'avant la première et l'effacerait.
 */
export function useMagasinStockMover() {
  const m1 = useBiz('lavage');
  const m2 = useBiz('magasin2');
  return useCallback((moves: MagasinMove[]) => {
    const agg = new Map<string, MagasinMove>();
    for (const mv of moves) {
      if (!mv.productId || (!mv.qty && !mv.empty)) continue;
      const k = `${mv.moduleKey}|${mv.productId}`;
      const cur = agg.get(k) || { ...mv, qty: 0, empty: 0 };
      cur.qty += mv.qty; cur.empty += mv.empty;
      agg.set(k, cur);
    }
    agg.forEach(mv => {
      const api = mv.moduleKey === 'magasin2' ? m2 : m1;
      const p = (api.state.products || []).find(x => x.id === mv.productId);
      if (!p) return;
      const next: BizProduct = { ...p, currentQty: roundQty((p.currentQty || 0) - mv.qty) };
      if (mv.empty || p.consigneActive) {
        next.emptyQty = roundQty(Math.max(0, (p.emptyQty || 0) - mv.empty));
      }
      api.update('products', next);
    });
  }, [m1, m2]);
}

const movesOf = (tr: Pick<StockTransfer, 'moduleKey' | 'items'>, sign: number): MagasinMove[] =>
  (tr.items || []).map(i => ({
    moduleKey: tr.moduleKey, productId: i.productId,
    qty: i.quantity * sign,
    empty: (i.consigneState === 'VIDE' ? i.quantity : 0) * sign,
  }));

/** Créer / modifier / supprimer un transfert — magasin ET armoire ensemble. */
export function useStockTransferActions() {
  const dispatch = useAppDispatch();
  const move = useMagasinStockMover();

  const guard = async (): Promise<boolean> => {
    if (await db.armoireTablesReady()) return true;
    toast.error("Les tables des armoires n'existent pas encore : exécutez la migration SQL dans Supabase.");
    return false;
  };

  return {
    create: async (tr: StockTransfer) => {
      if (!(await guard())) return false;
      move(movesOf(tr, +1));
      dispatch({ type: 'ADD_STOCK_TRANSFER', payload: tr });
      return true;
    },
    update: async (next: StockTransfer, previous: StockTransfer) => {
      if (!(await guard())) return false;
      move([...movesOf(previous, -1), ...movesOf(next, +1)]);
      dispatch({ type: 'UPDATE_STOCK_TRANSFER', payload: { transfer: next, previous } });
      return true;
    },
    remove: async (tr: StockTransfer) => {
      if (!(await guard())) return false;
      move(movesOf(tr, -1));
      dispatch({ type: 'DELETE_STOCK_TRANSFER', payload: tr });
      return true;
    },
  };
}

interface DraftItem {
  productId: string;
  productName: string;
  barcode?: string;
  unit?: string;
  quantity: number;
  consigneState?: ConsigneState;
}

export default function StockTransferBuilder({
  open, transfer, presetModuleKey, presetProductId, presetArmoireId, source = 'transferts', onClose,
}: {
  open: boolean;
  /** Transfert à modifier ; absent pour un nouveau transfert. */
  transfer?: StockTransfer | null;
  /** Magasin de départ imposé (bouton « Transférer » d'une Gestion de stock). */
  presetModuleKey?: MagasinKey;
  /** Produit ajouté d'office (bouton « Transférer » d'une fiche produit). */
  presetProductId?: string;
  /** Armoire de destination déjà choisie (bouton « Transférer » d'une armoire). */
  presetArmoireId?: string;
  source?: 'produits' | 'transferts';
  onClose: () => void;
}) {
  const { armoires = [], currentUserName } = useAppState();
  const biz = useBizAll();
  const actions = useStockTransferActions();
  const magasins = activeMagasinKeys() as MagasinKey[];

  const [moduleKey, setModuleKey] = useState<MagasinKey>(transfer?.moduleKey || presetModuleKey || 'lavage');
  const [armoireId, setArmoireId] = useState(transfer?.armoireId || presetArmoireId || (armoires.length === 1 ? armoires[0].id : ''));
  const [notes, setNotes] = useState(transfer?.notes || '');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const catalogue = useMemo(() => magasinProducts(biz, [moduleKey]), [biz, moduleKey]);
  const productOf = (id: string) => catalogue.find(x => x.product.id === id)?.product;

  const [items, setItems] = useState<DraftItem[]>(() => {
    if (transfer) {
      return transfer.items.map(i => ({
        productId: i.productId, productName: i.productName, barcode: i.barcode,
        unit: undefined, quantity: i.quantity, consigneState: i.consigneState,
      }));
    }
    const p = presetProductId
      ? ((biz?.[presetModuleKey || 'lavage']?.products || []) as BizProduct[]).find(x => x.id === presetProductId)
      : undefined;
    return p ? [{
      productId: p.id, productName: p.name, barcode: p.barcode, unit: p.unit, quantity: 1,
      consigneState: p.consigneActive ? 'PLEIN' : undefined,
    }] : [];
  });

  /**
   * Stock du magasin disponible pour CE transfert. Produit consigné : on ne
   * transfère que dans la catégorie choisie (pleines ou vides). En édition, ce
   * que le transfert avait déjà pris est rendu — s'il porte le même état.
   */
  const availableFor = (i: DraftItem): number => {
    const p = productOf(i.productId);
    if (!p) return 0;
    const previous = transfer && transfer.moduleKey === moduleKey
      ? transfer.items.find(x => x.productId === i.productId) : undefined;
    if (!p.consigneActive) return (p.currentQty || 0) + (previous?.quantity || 0);
    const split = productStockSplit(p);
    const base = i.consigneState === 'VIDE' ? split.empty : split.full;
    const restore = previous && (previous.consigneState || 'PLEIN') === (i.consigneState || 'PLEIN') ? previous.quantity : 0;
    return base + restore;
  };

  const matches = useMemo(() => searchMagasinProducts(catalogue, search), [catalogue, search]);

  const addProduct = (p: BizProduct) => {
    if (items.some(i => i.productId === p.id)) { toast.error('Produit déjà ajouté'); return; }
    // Produit consigné : on part sur les bouteilles PLEINES, l'état reste
    // basculable ligne par ligne juste après.
    setItems(prev => [...prev, {
      productId: p.id, productName: p.name, barcode: p.barcode, unit: p.unit, quantity: 1,
      consigneState: p.consigneActive ? 'PLEIN' : undefined,
    }]);
    setSearch('');
  };
  const patchItem = (pid: string, patch: Partial<DraftItem>) =>
    setItems(prev => prev.map(i => (i.productId === pid ? { ...i, ...patch } : i)));
  const removeItem = (pid: string) => setItems(prev => prev.filter(i => i.productId !== pid));

  const total = items.reduce((s, i) => s + (i.quantity || 0), 0);

  const changeMagasin = (k: MagasinKey) => {
    if (k === moduleKey) return;
    // Les fiches d'un magasin n'existent pas dans l'autre : la liste repart à vide.
    setModuleKey(k);
    setItems([]);
  };

  const submit = async () => {
    if (!armoireId) { toast.error("Sélectionnez l'armoire de destination."); return; }
    const clean = items.filter(i => (i.quantity || 0) > 0);
    if (!clean.length) { toast.error('Ajoutez au moins un produit avec une quantité.'); return; }
    for (const i of clean) {
      const avail = availableFor(i);
      if (i.quantity > avail + 1e-6) {
        const p = productOf(i.productId);
        const etat = p?.consigneActive ? (i.consigneState === 'VIDE' ? ' vides' : ' pleines') : '';
        toast.error(`Stock insuffisant pour ${i.productName}${etat} (dispo : ${fmt(avail)}).`);
        return;
      }
    }
    const lines: StockTransferItem[] = clean.map(i => ({
      id: newId(), productId: i.productId, productName: i.productName, barcode: i.barcode,
      quantity: i.quantity, consigneState: i.consigneState,
    }));
    const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
    setSaving(true);
    const ok = transfer
      ? await actions.update({ ...transfer, armoireId, notes: notes.trim() || undefined, items: lines, totalQty }, transfer)
      : await actions.create({
        id: newId(), armoireId, moduleKey, date: new Date().toISOString(), source,
        notes: notes.trim() || undefined, createdBy: currentUserName, totalQty, items: lines,
      });
    setSaving(false);
    if (!ok) return;
    toast.success(transfer ? 'Transfert mis à jour' : 'Transfert enregistré');
    onClose();
  };

  return (
    <Modal
      open={open} onClose={onClose} size="xl" fullHeight zClass="z-[75]"
      icon={ArrowLeftRight}
      title={transfer ? 'Modifier le transfert' : 'Nouveau transfert'}
      subtitle={`${magasinLabel(moduleKey)} → Armoire • date automatique`}
      footer={<>
        <button onClick={onClose} className="btn-ghost">Annuler</button>
        <button onClick={submit} disabled={saving} className="btn-primary">
          <Check className="w-4 h-4" /> {transfer ? 'Enregistrer' : 'Valider le transfert'}
        </button>
      </>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Magasin d'origine — le premier ou le second. Figé en modification. */}
          <Field label="Magasin d'origine" required>
            {magasins.length > 1 && !transfer ? (
              <div className="grid grid-cols-2 gap-2">
                {magasins.map(k => (
                  <button key={k} type="button" onClick={() => changeMagasin(k)}
                    className={cn('px-3 py-2.5 rounded-xl border-2 text-xs font-black uppercase tracking-wide flex items-center gap-2 transition-all',
                      moduleKey === k ? 'border-[#003087] bg-[#eef3fc] text-[#002d87]' : 'border-slate-200 text-slate-500 hover:border-[#003087]/40')}>
                    <Store className="w-4 h-4 shrink-0" /> <span className="truncate">{magasinLabel(k)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="field-static flex items-center gap-2"><Store className="w-4 h-4" /> {magasinLabel(moduleKey)}</div>
            )}
          </Field>
          <Field label="Armoire de destination" required>
            <Select value={armoireId} onChange={e => setArmoireId(e.target.value)}>
              <option value="">— Sélectionner une armoire —</option>
              {armoires.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            {armoires.length === 0 && (
              <p className="text-[11px] font-bold text-orange-600 mt-1">Aucune armoire — créez-en une depuis « Armoires ».</p>
            )}
          </Field>
        </div>

        {/* Recherche produit */}
        <Field label={`Rechercher un produit de ${magasinLabel(moduleKey)} (nom, code-barres, référence)`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input className="input-field pl-9" placeholder="Nom, référence ou code-barres…"
              value={search} onChange={e => setSearch(e.target.value)} autoFocus={!presetProductId} />
          </div>
          {search && (
            <div className="mt-2 border border-slate-100 rounded-2xl overflow-hidden shadow-lg bg-white">
              {matches.length === 0 ? (
                <p className="p-4 text-xs font-bold text-slate-400 text-center">Aucun produit trouvé</p>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-50 custom-scrollbar">
                  {matches.map(({ product: p }) => {
                    const added = items.some(i => i.productId === p.id);
                    const split = productStockSplit(p);
                    return (
                      <div key={p.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="font-black text-[#002d87] text-sm truncate">
                            {p.name}
                            {p.consigneActive && <span className="ml-2 badge badge-yellow">Vide / Plein</span>}
                          </p>
                          <p className="text-[11px] text-slate-400 font-bold">
                            {p.barcode ? `Code : ${p.barcode} · ` : ''}
                            <span className="text-emerald-600">Stock : {fmt(split.total)} {p.unit || ''}</span>
                            {p.consigneActive && <span className="text-amber-600"> ({fmt(split.full)} pleines · {fmt(split.empty)} vides)</span>}
                          </p>
                        </div>
                        <button type="button" onClick={() => addProduct(p)} disabled={added}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-white bg-[#003087] disabled:opacity-30 hover:scale-105 transition-all shrink-0">
                          {added ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Field>

        {/* Lignes du transfert */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label-field mb-0">Produits à transférer ({items.length})</label>
            <span className="text-[11px] font-black text-slate-400 uppercase">Total : {fmt(total)}</span>
          </div>
          {items.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center">
              <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-400">Recherchez et ajoutez des produits</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(i => {
                const p = productOf(i.productId);
                const avail = availableFor(i);
                const over = i.quantity > avail + 1e-6;
                const consigned = !!p?.consigneActive;
                const split = p ? productStockSplit(p) : { full: 0, empty: 0, total: 0 };
                return (
                  <div key={i.productId} className="bg-slate-50 rounded-2xl p-3 space-y-2 border border-slate-100">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[10rem]">
                        <p className="text-sm font-black text-slate-800 truncate">
                          {i.productName}
                          {consigned && <span className="ml-2 badge badge-yellow">Vide / Plein</span>}
                        </p>
                        <p className={cn('text-[11px] font-bold', over ? 'text-red-500' : 'text-slate-400')}>
                          Dispo{consigned ? (i.consigneState === 'VIDE' ? ' (vides)' : ' (pleines)') : ''} : {fmt(avail)} {i.unit || p?.unit || ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => patchItem(i.productId, { quantity: Math.max(0, (i.quantity || 0) - 1) })}
                          className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"><Minus className="w-3.5 h-3.5" /></button>
                        <input type="number" min={0} step="any" value={i.quantity}
                          onChange={e => patchItem(i.productId, { quantity: Number(e.target.value) || 0 })}
                          className={cn('w-20 h-9 text-center rounded-lg border font-black text-[#002d87] outline-none', over ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white')} />
                        <button type="button" onClick={() => patchItem(i.productId, { quantity: (i.quantity || 0) + 1 })}
                          className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"><Plus className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => removeItem(i.productId)}
                          className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {/* Bouteilles : on transfère soit des PLEINES, soit des VIDES. */}
                    {consigned && (
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { state: 'PLEIN' as ConsigneState, label: '🟢 Pleines', count: split.full },
                          { state: 'VIDE' as ConsigneState, label: '⚪ Vides', count: split.empty },
                        ]).map(o => (
                          <button key={o.state} type="button" onClick={() => patchItem(i.productId, { consigneState: o.state })}
                            className={cn('p-2 rounded-xl border-2 text-left transition-all',
                              (i.consigneState || 'PLEIN') === o.state ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white hover:border-amber-200')}>
                            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-800">{o.label}</span>
                            <span className="block text-[10px] font-bold text-slate-400">{fmt(o.count)} en stock magasin</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Field label="Notes (optionnel)">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
