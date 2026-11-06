/**
 * Saisie d'une justification TPE / TAG d'une brigade :
 *   • « Montant global » : montant + description (+ type de tag pour un TAG) ;
 *   • « Opérations détaillées » : une ligne par opération.
 *       TPE : n° de carte (avec propositions des cartes déjà saisies), nature
 *             (carburant), n° d'opération, quantité (facultative) et montant —
 *             la quantité calcule le montant et inversement.
 *       TAG : produit ou carburant, type de tag (avec création), description,
 *             montant.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, CreditCard, Tag, Layers, Hash, Fuel, ListChecks } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  JustifOperation, JustifEntryMode, emptyOperation, opsTotal, suggestCards, formatCard,
  loadTagTypes, addTagType,
} from '../../lib/justifOps';

const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

export function useTagTypes() {
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => { loadTagTypes().then(setTypes); }, []);
  const add = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    await addTagType(n);
    setTypes(prev => prev.includes(n) ? prev : [...prev, n]);
  };
  return { types, add };
}

/** Champ n° de carte avec propositions cliquables pour compléter. */
export function CardNumberInput({ value, onChange, known }: { value: string; onChange: (v: string) => void; known: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const props = useMemo(() => suggestCards(known, value), [known, value]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <input data-testid="op-card" value={formatCard(value)} inputMode="numeric" placeholder="N° de carte"
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value.replace(/[^\dA-Za-z*]/g, '')); setOpen(true); }}
        className="input-field !h-10 !py-1.5 text-xs font-bold w-full tracking-wider" />
      {open && props.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-cyan-200 rounded-xl shadow-lg overflow-hidden">
          <p className="px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-600 bg-cyan-50">Cartes déjà saisies</p>
          {props.map(c => (
            <button key={c} type="button" onMouseDown={e => { e.preventDefault(); onChange(c); setOpen(false); }}
              className="w-full text-left px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-cyan-50 tracking-wider">
              <span className="text-cyan-700">{formatCard(c.slice(0, value.replace(/\s+/g, '').length))}</span>
              {formatCard(c).slice(formatCard(c.slice(0, value.replace(/\s+/g, '').length)).length)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function JustifOperationsEditor({
  type, entryMode, operations, onChange, fuelTypes, priceOf, knownCards, tagTypes, onAddTagType, products,
  amount, description, tagType, onTotalChange,
}: {
  type: 'TPE' | 'TAG';
  entryMode: JustifEntryMode;
  operations: JustifOperation[];
  /** Appelé avec le nouveau mode / les nouvelles opérations ; le montant = somme. */
  onChange: (mode: JustifEntryMode, ops: JustifOperation[]) => void;
  fuelTypes: string[];
  priceOf: (fuel?: string) => number;
  knownCards: string[];
  tagTypes: string[];
  onAddTagType: (name: string) => void;
  products: { id: string; name: string; price: number }[];
  amount: number;
  description: string;
  tagType?: string;
  onTotalChange: (patch: { amount?: number; description?: string; tagType?: string }) => void;
}) {
  const [newTag, setNewTag] = useState<string | null>(null);
  const isTpe = type === 'TPE';

  const patchOp = (id: string, p: Partial<JustifOperation>) =>
    onChange('DETAIL', operations.map(o => o.id === id ? { ...o, ...p } : o));
  const addOp = () => onChange('DETAIL', [...operations, { ...emptyOperation(fuelTypes[0]), tagType: isTpe ? undefined : (tagType || tagTypes[0]) }]);
  const removeOp = (id: string) => onChange('DETAIL', operations.filter(o => o.id !== id));

  const setQty = (o: JustifOperation, q: string) => {
    const quantity = parseFloat(q);
    const price = o.unitPrice || (o.productKind === 'PRODUIT' ? 0 : priceOf(o.fuelType));
    if (!q || !Number.isFinite(quantity)) { patchOp(o.id, { quantity: undefined }); return; }
    patchOp(o.id, { quantity, unitPrice: price, amount: price ? Math.round(quantity * price * 100) / 100 : o.amount });
  };
  const setAmount = (o: JustifOperation, a: string) => {
    const amount = parseFloat(a) || 0;
    const price = o.unitPrice || (o.productKind === 'PRODUIT' ? 0 : priceOf(o.fuelType));
    patchOp(o.id, { amount, unitPrice: price || undefined, quantity: price ? Math.round(amount / price * 100) / 100 : o.quantity });
  };
  const setFuel = (o: JustifOperation, fuelType: string) => {
    const price = priceOf(fuelType);
    patchOp(o.id, { fuelType, unitPrice: price, amount: o.quantity && price ? Math.round(o.quantity * price * 100) / 100 : o.amount });
  };

  const TagTypeSelect = ({ value, onPick }: { value?: string; onPick: (v: string) => void }) => (
    newTag !== null ? (
      <div className="flex gap-1">
        <input autoFocus value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Nouveau type"
          onKeyDown={e => { if (e.key === 'Enter' && newTag.trim()) { onAddTagType(newTag); onPick(newTag.trim()); setNewTag(null); } }}
          className="input-field !h-10 !py-1.5 text-xs font-bold w-full" />
        <button type="button" onClick={() => { if (newTag.trim()) { onAddTagType(newTag); onPick(newTag.trim()); } setNewTag(null); }}
          className="px-2 rounded-lg bg-purple-600 text-white text-[10px] font-black">OK</button>
      </div>
    ) : (
      <select value={value || ''} onChange={e => e.target.value === '__new' ? setNewTag('') : onPick(e.target.value)}
        className="input-field !h-10 !py-1.5 text-xs font-bold w-full">
        <option value="">— Type de tag —</option>
        {tagTypes.map(t => <option key={t} value={t}>{t}</option>)}
        <option value="__new">+ Créer un nouveau type…</option>
      </select>
    )
  );

  return (
    <div className="space-y-2">
      {/* Mode de saisie */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white border border-slate-200">
        {([['TOTAL', 'Montant global', Layers], ['DETAIL', 'Opérations détaillées', ListChecks]] as const).map(([m, label, Icon]) => (
          <button key={m} type="button"
            onClick={() => onChange(m, m === 'DETAIL' && operations.length === 0 ? [{ ...emptyOperation(fuelTypes[0]), tagType: isTpe ? undefined : tagType }] : operations)}
            className={cn('flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all',
              entryMode === m ? (isTpe ? 'bg-cyan-600 text-white shadow' : 'bg-purple-600 text-white shadow') : 'text-slate-500 hover:bg-slate-50')}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {entryMode !== 'DETAIL' ? (
        <div className="space-y-2">
          {!isTpe && (
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Type de tag</label>
              <TagTypeSelect value={tagType} onPick={v => onTotalChange({ tagType: v })} />
            </div>
          )}
          <input placeholder="Description" value={description} onChange={e => onTotalChange({ description: e.target.value })}
            className="input-field !h-10 !py-1.5 text-xs font-bold w-full" />
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Montant total (DA)</label>
            <input type="number" placeholder="Montant total" value={amount || ''}
              onChange={e => onTotalChange({ amount: parseFloat(e.target.value) || 0 })}
              className="input-field !h-10 !py-1.5 text-xs font-bold w-full" />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {operations.map((o, idx) => (
            <div key={o.id} className={cn('rounded-xl border p-2.5 space-y-2 bg-white', isTpe ? 'border-cyan-200' : 'border-purple-200')}>
              <div className="flex items-center justify-between">
                <span className={cn('text-[9px] font-black uppercase tracking-widest flex items-center gap-1', isTpe ? 'text-cyan-700' : 'text-purple-700')}>
                  {isTpe ? <CreditCard className="w-3 h-3" /> : <Tag className="w-3 h-3" />} Opération {idx + 1}
                </span>
                <button type="button" onClick={() => removeOp(o.id)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
              </div>
              {isTpe ? (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                  <div className="col-span-2 lg:col-span-1">
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">N° de carte</label>
                    <CardNumberInput value={o.cardNumber || ''} onChange={v => patchOp(o.id, { cardNumber: v })} known={knownCards} />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block flex items-center gap-1"><Fuel className="w-2.5 h-2.5" /> Nature</label>
                    <select value={o.fuelType || ''} onChange={e => setFuel(o, e.target.value)} className="input-field !h-10 !py-1.5 text-xs font-bold w-full">
                      {fuelTypes.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block flex items-center gap-1"><Hash className="w-2.5 h-2.5" /> N° opération</label>
                    <input data-testid="op-number" value={o.operationNumber || ''} onChange={e => patchOp(o.id, { operationNumber: e.target.value })}
                      placeholder="N° opération" className="input-field !h-10 !py-1.5 text-xs font-bold w-full" />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">Quantité (L) — option.</label>
                    <input data-testid="op-qty" type="number" step="0.01" value={o.quantity ?? ''} onChange={e => setQty(o, e.target.value)}
                      placeholder="Litres" className="input-field !h-10 !py-1.5 text-xs font-bold w-full" />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">Montant (DA)</label>
                    <input data-testid="op-amount" type="number" step="0.01" value={o.amount || ''} onChange={e => setAmount(o, e.target.value)}
                      placeholder="Montant" className={cn('input-field !h-10 !py-1.5 text-xs font-black w-full', !(o.amount > 0) && 'border-red-300')} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">Produit / Carburant</label>
                    <select value={o.productKind === 'PRODUIT' ? `P:${o.productId || ''}` : `F:${o.fuelType || ''}`}
                      onChange={e => {
                        const v = e.target.value;
                        if (v.startsWith('F:')) { const f = v.slice(2); patchOp(o.id, { productKind: 'CARBURANT', fuelType: f, productId: undefined, productName: undefined, unitPrice: priceOf(f) }); }
                        else { const p = products.find(x => x.id === v.slice(2)); patchOp(o.id, { productKind: 'PRODUIT', productId: p?.id, productName: p?.name, fuelType: undefined, unitPrice: p?.price }); }
                      }}
                      className="input-field !h-10 !py-1.5 text-xs font-bold w-full">
                      <optgroup label="Carburant">
                        {fuelTypes.map(f => <option key={f} value={`F:${f}`}>{f}</option>)}
                      </optgroup>
                      {products.length > 0 && (
                        <optgroup label="Produits">
                          {products.map(p => <option key={p.id} value={`P:${p.id}`}>{p.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">Type de tag</label>
                    <TagTypeSelect value={o.tagType} onPick={v => patchOp(o.id, { tagType: v })} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">Description</label>
                    <input value={o.description || ''} onChange={e => patchOp(o.id, { description: e.target.value })}
                      placeholder="Description" className="input-field !h-10 !py-1.5 text-xs font-bold w-full" />
                  </div>
                  <div className="col-span-2 lg:col-span-1">
                    <label className="text-[8px] font-black text-slate-400 uppercase mb-0.5 block">Montant (DA)</label>
                    <input data-testid="op-amount" type="number" step="0.01" value={o.amount || ''} onChange={e => patchOp(o.id, { amount: parseFloat(e.target.value) || 0 })}
                      placeholder="Montant" className={cn('input-field !h-10 !py-1.5 text-xs font-black w-full', !(o.amount > 0) && 'border-red-300')} />
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={addOp}
              className={cn('inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase',
                isTpe ? 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200' : 'bg-purple-100 text-purple-700 hover:bg-purple-200')}>
              <Plus className="w-3.5 h-3.5" /> Ajouter une opération
            </button>
            <span className={cn('text-[10px] font-black', isTpe ? 'text-cyan-700' : 'text-purple-700')}>
              {operations.length} opération(s) · {fmt(opsTotal(operations))} DA
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


/** Liste en lecture seule des opérations d'une justification TPE / TAG. */
export function JustifOpsList({ type, operations, compact }: { type: 'TPE' | 'TAG' | string; operations?: JustifOperation[]; compact?: boolean }) {
  if (!operations || operations.length === 0) return null;
  const isTpe = type === 'TPE';
  return (
    <div className={cn('rounded-lg border overflow-hidden', isTpe ? 'border-cyan-100' : 'border-purple-100')}>
      <table className="w-full text-[10px]">
        <thead className={isTpe ? 'bg-cyan-50 text-cyan-700' : 'bg-purple-50 text-purple-700'}>
          <tr className="font-black uppercase">
            <th className="px-2 py-1 text-left">#</th>
            {isTpe ? <><th className="px-2 py-1 text-left">Carte</th><th className="px-2 py-1 text-left">Nature</th><th className="px-2 py-1 text-left">N° op.</th><th className="px-2 py-1 text-right">Qté</th></>
              : <><th className="px-2 py-1 text-left">Produit</th><th className="px-2 py-1 text-left">Type</th>{!compact && <th className="px-2 py-1 text-left">Description</th>}</>}
            <th className="px-2 py-1 text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((o, i) => (
            <tr key={o.id} className="border-t border-slate-100 font-bold text-slate-700">
              <td className="px-2 py-1 text-slate-400">{i + 1}</td>
              {isTpe ? <>
                <td className="px-2 py-1 tracking-wider">{formatCard(o.cardNumber) || '—'}</td>
                <td className="px-2 py-1">{o.fuelType || '—'}</td>
                <td className="px-2 py-1">{o.operationNumber || '—'}</td>
                <td className="px-2 py-1 text-right">{o.quantity ? `${fmt(o.quantity)} L` : '—'}</td>
              </> : <>
                <td className="px-2 py-1">{o.productKind === 'PRODUIT' ? (o.productName || 'Produit') : (o.fuelType || '—')}</td>
                <td className="px-2 py-1">{o.tagType || '—'}</td>
                {!compact && <td className="px-2 py-1">{o.description || '—'}</td>}
              </>}
              <td className="px-2 py-1 text-right font-black">{fmt(o.amount)} DA</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
