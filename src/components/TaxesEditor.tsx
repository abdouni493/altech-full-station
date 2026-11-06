/**
 * Éditeur TVA + autres taxes, réutilisable (achats carburant, ventes carburant).
 *
 *  • TVA : interrupteur + taux.
 *  • Autres taxes : les modèles déjà créés s'affichent en pastilles ; un clic
 *    active la taxe (valeur pré-remplie, modifiable pour ce document). « Nouvelle
 *    taxe » crée un modèle (nom + pourcentage ou montant fixe) enregistré pour
 *    les prochaines opérations, et l'active aussitôt.
 */
import React, { useEffect, useState } from 'react';
import { Plus, Receipt, Trash2, X, Check, Percent, Coins } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Switch, Field, Input, Select, StaticField, money } from './biz/Kit';
import {
  AppliedTax, TaxPreset, TaxKind, loadTaxPresets, saveTaxPreset, deleteTaxPreset, taxAmount,
} from '../lib/taxes';
import { newId } from '../lib/utils';

export function useTaxPresets() {
  const [presets, setPresets] = useState<TaxPreset[]>([]);
  useEffect(() => { loadTaxPresets().then(setPresets); }, []);
  return { presets, setPresets };
}

export default function TaxesEditor({
  base, tvaActive, onTvaActive, tvaRate, onTvaRate, taxes, onTaxes,
}: {
  /** Base HT sur laquelle s'appliquent les pourcentages. */
  base: number;
  tvaActive: boolean; onTvaActive: (v: boolean) => void;
  tvaRate: string; onTvaRate: (v: string) => void;
  taxes: AppliedTax[]; onTaxes: (t: AppliedTax[]) => void;
}) {
  const { presets, setPresets } = useTaxPresets();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaxKind>('percent');
  const [value, setValue] = useState('');

  const tvaAmount = tvaActive ? base * (Number(tvaRate) || 0) / 100 : 0;
  const activeOf = (presetId: string) => taxes.find(t => t.presetId === presetId);

  const toggle = (p: TaxPreset) => {
    const cur = activeOf(p.id);
    if (cur) onTaxes(taxes.filter(t => t !== cur));
    else onTaxes([...taxes, { id: newId(), presetId: p.id, name: p.name, kind: p.kind, value: p.value, amount: taxAmount(base, p.kind, p.value) }]);
  };

  const create = async () => {
    if (!name.trim()) { toast.error('Saisissez le nom de la taxe'); return; }
    const v = Number(value) || 0;
    if (v <= 0) { toast.error('Saisissez la valeur de la taxe'); return; }
    const p = await saveTaxPreset({ name, kind, value: v });
    setPresets(prev => [...prev, p]);
    onTaxes([...taxes, { id: newId(), presetId: p.id, name: p.name, kind: p.kind, value: p.value, amount: taxAmount(base, p.kind, p.value) }]);
    toast.success(`Taxe « ${p.name} » enregistrée et activée`);
    setName(''); setValue(''); setKind('percent'); setCreating(false);
  };

  const removePreset = async (p: TaxPreset) => {
    if (!window.confirm(`Supprimer définitivement le modèle de taxe « ${p.name} » ?`)) return;
    await deleteTaxPreset(p.id);
    setPresets(prev => prev.filter(x => x.id !== p.id));
    onTaxes(taxes.filter(t => t.presetId !== p.id));
  };

  const updateValue = (id: string, v: string) =>
    onTaxes(taxes.map(t => t.id === id ? { ...t, value: Number(v) || 0, amount: taxAmount(base, t.kind, Number(v) || 0) } : t));

  return (
    <div className="space-y-3">
      {/* TVA */}
      <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${tvaActive ? 'bg-[#eef3fc] border-[#003087]/20' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-700 flex items-center gap-1.5"><Percent className="w-4 h-4" /> TVA</p>
            <p className="text-xs text-slate-400">Appliquée sur le montant HT (après remise)</p>
          </div>
          <Switch checked={tvaActive} onChange={onTvaActive} />
        </div>
        {tvaActive && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <Field label="Taux de TVA (%)">
              <Input type="number" step="0.01" inputMode="decimal" value={tvaRate}
                onChange={e => onTvaRate(e.target.value)} className="text-right" />
            </Field>
            <Field label="Montant de la TVA">
              <StaticField tone="primary">{money(tvaAmount)}</StaticField>
            </Field>
          </div>
        )}
      </div>

      {/* Autres taxes */}
      <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${taxes.length ? 'bg-violet-50/70 border-violet-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-700 flex items-center gap-1.5"><Receipt className="w-4 h-4" /> Autres taxes</p>
            <p className="text-xs text-slate-400">Activez une taxe enregistrée ou créez-en une nouvelle</p>
          </div>
          <button type="button" onClick={() => setCreating(c => !c)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-black bg-violet-600 text-white hover:bg-violet-700">
            {creating ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {creating ? 'Annuler' : 'Nouvelle taxe'}
          </button>
        </div>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {presets.map(p => {
              const on = !!activeOf(p.id);
              return (
                <span key={p.id} className={`group inline-flex items-center gap-1 rounded-full border text-xs font-bold transition-all ${on ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'}`}>
                  <button type="button" onClick={() => toggle(p)} className="inline-flex items-center gap-1 pl-3 py-1.5">
                    {on ? <Check className="w-3.5 h-3.5" /> : (p.kind === 'percent' ? <Percent className="w-3 h-3" /> : <Coins className="w-3 h-3" />)}
                    {p.name} · {p.kind === 'percent' ? `${p.value}%` : money(p.value)}
                  </button>
                  <button type="button" title="Supprimer le modèle" onClick={() => removePreset(p)}
                    className={`pr-2 py-1.5 opacity-50 hover:opacity-100 ${on ? 'text-white' : 'text-red-500'}`}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {creating && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 rounded-xl bg-white border border-violet-200 p-3">
            <Field label="Nom de la taxe">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Taxe carburant" />
            </Field>
            <Field label="Type">
              <Select value={kind} onChange={e => setKind(e.target.value as TaxKind)}>
                <option value="percent">Pourcentage (%)</option>
                <option value="amount">Montant fixe (DA)</option>
              </Select>
            </Field>
            <Field label={kind === 'percent' ? 'Valeur (%)' : 'Montant (DA)'}>
              <Input type="number" step="0.01" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} className="text-right" placeholder="0" />
            </Field>
            <div className="flex items-end">
              <button type="button" onClick={create}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-black bg-[#003087] text-white hover:bg-[#002d87]">
                <Check className="w-4 h-4" /> Enregistrer & activer
              </button>
            </div>
          </div>
        )}

        {taxes.length > 0 && (
          <div className="space-y-2">
            {taxes.map(t => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white border border-violet-100 px-3 py-2">
                <span className="font-bold text-sm text-slate-700 flex-1 min-w-[120px]">{t.name}</span>
                <span className="text-[10px] uppercase font-black text-violet-500">{t.kind === 'percent' ? 'Pourcentage' : 'Montant fixe'}</span>
                <Input type="number" step="0.01" value={String(t.value)} onChange={e => updateValue(t.id, e.target.value)}
                  className="!w-28 text-right" />
                <span className="text-xs text-slate-400">{t.kind === 'percent' ? '%' : 'DA'}</span>
                <span className="font-black tabular-nums text-violet-700 text-sm min-w-[100px] text-right">+ {money(t.amount)}</span>
                <button type="button" onClick={() => onTaxes(taxes.filter(x => x.id !== t.id))} className="p-1 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
        {presets.length === 0 && !creating && (
          <p className="text-xs text-slate-400 italic">Aucune taxe enregistrée pour l'instant.</p>
        )}
      </div>
    </div>
  );
}
