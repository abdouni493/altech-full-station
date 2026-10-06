/**
 * ─── Paramètres → Magasins : créer le SECOND magasin ───────────────────────────
 *
 * La station a un magasin. Elle peut en ouvrir un second : on demande alors le
 * nom du magasin EXISTANT et celui du NOUVEAU. Dès sa création, le second
 * magasin apparaît dans la barre latérale avec exactement les mêmes interfaces
 * que le premier (point de vente, ventes, stock, inventaire, achats, clients,
 * fournisseurs, employés, dépenses, caisse, rapports, retours clients).
 *
 * Les deux magasins sont INDÉPENDANTS : chacun son catalogue, son stock, ses
 * ventes, sa caisse et ses calculs. Les deux entrent dans la Caisse Générale et
 * dans les Rapports Généraux, chacun dans sa propre section.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Plus, Save, ArrowRight, EyeOff, CheckCircle2, Boxes, Wallet, BarChart2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppState, useAppDispatch, StationSettings } from '../store/AppContext';
import { Modal, Field, Input, Confirm } from './biz/Kit';
import { MODULES } from '../lib/bizConfig';

type MagasinFields = Pick<StationSettings, 'magasin1Name' | 'magasin2Name' | 'magasin2Enabled'>;

export default function MagasinsSettings({ onSaved }: { onSaved?: (patch: MagasinFields) => void }) {
  const { settings } = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const enabled = !!settings.magasin2Enabled;
  const [name1, setName1] = useState(settings.magasin1Name || MODULES.lavage.label || 'Magasin');
  const [name2, setName2] = useState(settings.magasin2Name || '');
  const [creating, setCreating] = useState(false);
  const [draft1, setDraft1] = useState('');
  const [draft2, setDraft2] = useState('');
  const [confirmHide, setConfirmHide] = useState(false);

  const persist = (patch: MagasinFields, message: string) => {
    dispatch({ type: 'SET_SETTINGS', payload: { ...settings, ...patch } });
    onSaved?.(patch);
    toast.success(message);
  };

  const openCreate = () => {
    setDraft1(settings.magasin1Name || MODULES.lavage.label || 'Magasin');
    setDraft2(settings.magasin2Name || '');
    setCreating(true);
  };

  const create = () => {
    const n1 = draft1.trim();
    const n2 = draft2.trim();
    if (!n1) { toast.error('Donnez un nom au magasin existant.'); return; }
    if (!n2) { toast.error('Donnez un nom au nouveau magasin.'); return; }
    if (n1.toLowerCase() === n2.toLowerCase()) { toast.error('Les deux magasins doivent porter des noms différents.'); return; }
    persist({ magasin1Name: n1, magasin2Name: n2, magasin2Enabled: true }, `Magasin « ${n2} » créé — il apparaît dans la barre latérale.`);
    setName1(n1); setName2(n2);
    setCreating(false);
  };

  const rename = () => {
    const n1 = name1.trim();
    const n2 = name2.trim();
    if (!n1 || (enabled && !n2)) { toast.error('Chaque magasin doit avoir un nom.'); return; }
    if (enabled && n1.toLowerCase() === n2.toLowerCase()) { toast.error('Les deux magasins doivent porter des noms différents.'); return; }
    persist({ magasin1Name: n1, magasin2Name: enabled ? n2 : settings.magasin2Name, magasin2Enabled: enabled }, 'Noms des magasins enregistrés ✓');
  };

  const features = [
    { icon: Boxes, text: 'Mêmes interfaces que le premier magasin : point de vente, ventes, stock, inventaire, achats, clients, fournisseurs, employés, dépenses, caisse, rapports.' },
    { icon: Wallet, text: 'Stock, caisse et calculs totalement indépendants du premier magasin.' },
    { icon: BarChart2, text: 'Inclus dans la Caisse Générale et les Rapports Généraux, avec sa propre section.' },
  ];

  return (
    <div className="space-y-8">
      <div className="p-5 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 text-sm text-blue-900 font-medium leading-relaxed">
        La station peut tenir <b>deux magasins indépendants</b>. Les produits des deux magasins peuvent être
        transférés vers les <b>armoires</b> de la piste.
      </div>

      {/* Magasins existants */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="p-5 rounded-2xl border-2 border-slate-100 bg-white space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
              <Store className="w-5 h-5 text-[#FFB800]" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Premier magasin</p>
              <p className="font-black text-[#002d87]">{MODULES.lavage.label}</p>
            </div>
          </div>
          <Field label="Nom du premier magasin">
            <Input value={name1} onChange={e => setName1(e.target.value)} placeholder="Ex : Magasin Central" />
          </Field>
        </div>

        {enabled ? (
          <div className="p-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-600">
                  <Store className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Second magasin actif</p>
                  <p className="font-black text-[#002d87]">{MODULES.magasin2.label}</p>
                </div>
              </div>
              <button onClick={() => navigate('/magasin2/pos')} className="btn-ghost text-[11px]">Ouvrir <ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
            <Field label="Nom du second magasin">
              <Input value={name2} onChange={e => setName2(e.target.value)} placeholder="Ex : Magasin Pièces auto" />
            </Field>
          </div>
        ) : (
          <button onClick={openCreate}
            className="p-5 rounded-2xl border-2 border-dashed border-[#003087]/30 hover:border-[#003087] hover:bg-[#eef3fc] transition-all flex flex-col items-center justify-center text-center gap-2 min-h-[11rem]">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFB800, #e6a000)' }}>
              <Plus className="w-6 h-6 text-[#001f5c]" />
            </div>
            <p className="font-black text-[#002d87] uppercase tracking-wider text-sm">Créer un nouveau magasin</p>
            <p className="text-xs text-slate-500 max-w-xs">Un second magasin, avec les mêmes interfaces et des calculs indépendants.</p>
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={rename} className="btn-primary"><Save className="w-4 h-4" /> Enregistrer les noms</button>
        {enabled && (
          <button onClick={() => setConfirmHide(true)} className="btn-ghost text-red-600"><EyeOff className="w-4 h-4" /> Masquer le second magasin</button>
        )}
      </div>

      {/* Création du second magasin : on nomme l'existant ET le nouveau. */}
      <Modal open={creating} onClose={() => setCreating(false)} size="lg" icon={Store}
        title="Créer un nouveau magasin" subtitle="Nommez le magasin existant et le nouveau magasin"
        footer={<>
          <button onClick={() => setCreating(false)} className="btn-ghost">Annuler</button>
          <button onClick={create} className="btn-primary"><Plus className="w-4 h-4" /> Créer le magasin</button>
        </>}>
        <div className="space-y-5">
          <Field label="1. Nom du magasin EXISTANT" required hint="Le magasin que vous utilisez déjà — ses données ne changent pas.">
            <Input value={draft1} onChange={e => setDraft1(e.target.value)} placeholder="Ex : Magasin Central" autoFocus />
          </Field>
          <Field label="2. Nom du NOUVEAU magasin" required hint="Il apparaîtra comme une nouvelle partie dans la barre latérale.">
            <Input value={draft2} onChange={e => setDraft2(e.target.value)} placeholder="Ex : Magasin Pièces auto"
              onKeyDown={e => { if (e.key === 'Enter') create(); }} />
          </Field>
          <div className="space-y-2">
            {features.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs text-slate-600">
                <f.icon className="w-4 h-4 text-[#003087] shrink-0 mt-0.5" /> <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Confirm
        open={confirmHide}
        danger={false}
        confirmLabel="Masquer"
        title="Masquer le second magasin"
        message={`« ${MODULES.magasin2.label} » disparaîtra de la barre latérale, de la Caisse Générale et des Rapports Généraux.\nSes données sont CONSERVÉES : recréez-le pour les retrouver.`}
        onCancel={() => setConfirmHide(false)}
        onConfirm={() => {
          setConfirmHide(false);
          persist({ magasin1Name: settings.magasin1Name, magasin2Name: settings.magasin2Name, magasin2Enabled: false }, 'Second magasin masqué');
        }}
      />
    </div>
  );
}
