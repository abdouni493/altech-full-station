/**
 * Négociation des TPE / TAG d'un compte bancaire.
 *  • Onglet « À négocier » : les opérations non négociées (filtres type / pompiste /
 *    période / recherche), sélection multiple, total sélectionné ; la création
 *    vire ce total du compte vers la caisse Carburant.
 *  • Onglet « Historique » : les négociations passées, leur détail, annulation.
 */
import React, { useMemo, useState } from 'react';
import {
  Handshake, CheckSquare, Square, CreditCard, Tag, Wallet, History, Trash2, ChevronDown, ChevronUp, Search,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '../../lib/utils';
import {
  useAppState, useAppDispatch, BankAccount, CAISSE_PART_ID,
} from '../../store/AppContext';
import { Modal, Field, Input, Textarea, Select, money, formatDate, Badge, Confirm } from '../biz/Kit';
import { formatCard } from '../../lib/justifOps';
import {
  Negotiation, NegotiableItem, negotiableItems, negotiatedKeys, saveNegotiation, deleteNegotiation,
} from '../../lib/negotiations';
import { todayLocal } from '@/src/lib/period';

const todayISO = () => todayLocal();

export default function NegotiationModal({
  account, negotiations, onChanged, onClose, initialTab = 'pending',
}: {
  account: BankAccount & { balance: number };
  negotiations: Negotiation[];
  onChanged: (next: Negotiation[]) => void;
  onClose: () => void;
  initialTab?: 'pending' | 'history';
}) {
  const { brigadeAccountings = [], brigades = [], pompistes = [], currentUserName, treasuryTransactions = [] } = useAppState();
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<'pending' | 'history'>(initialTab);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'TPE' | 'TAG'>('ALL');
  const [pompisteFilter, setPompisteFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [toCancel, setToCancel] = useState<Negotiation | null>(null);

  const accountNegs = useMemo(() => negotiations.filter(n => n.bankAccountId === account.id), [negotiations, account.id]);
  const done = useMemo(() => negotiatedKeys(negotiations), [negotiations]);
  const all = useMemo(() => negotiableItems(brigadeAccountings, brigades, pompistes, account.id), [brigadeAccountings, brigades, pompistes, account.id]);
  const pending = useMemo(() => all.filter(i => !done.has(i.key)), [all, done]);
  const filtered = useMemo(() => pending.filter(i => {
    if (typeFilter !== 'ALL' && i.type !== typeFilter) return false;
    if (pompisteFilter && i.pompisteId !== pompisteFilter) return false;
    const d = (i.brigadeDate || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (q) {
      const s = q.toLowerCase().replace(/\s+/g, '');
      const hay = [i.cardNumber, i.operationNumber, i.description, i.tagType, i.pompisteName, i.fuelType, i.productName].join(' ').toLowerCase().replace(/\s+/g, '');
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [pending, typeFilter, pompisteFilter, from, to, q]);

  const pendingTotal = pending.reduce((s, i) => s + i.amount, 0);
  const selItems = pending.filter(i => selected.has(i.key));
  const selTotal = selItems.reduce((s, i) => s + i.amount, 0);
  const allFilteredSelected = filtered.length > 0 && filtered.every(i => selected.has(i.key));
  const toggle = (k: string) => setSelected(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev);
    if (allFilteredSelected) filtered.forEach(i => n.delete(i.key)); else filtered.forEach(i => n.add(i.key));
    return n;
  });
  const pompisteOptions = [...new Map(pending.filter(i => i.pompisteId).map(i => [i.pompisteId!, i.pompisteName || '—'])).entries()];

  const create = async () => {
    if (selItems.length === 0) { toast.error('Sélectionnez au moins une opération'); return; }
    const id = newId();
    const txId = newId();
    const when = new Date(date).toISOString();
    dispatch({
      type: 'ADD_TREASURY_TX', payload: {
        id: txId, date: when, kind: 'TRANSFER', amount: selTotal,
        description: `Négociation ${selItems.length} opération(s) TPE/TAG — ${account.name}${reference ? ` (réf. ${reference})` : ''}`,
        accountFrom: account.id, accountTo: CAISSE_PART_ID.carburant, part: 'carburant',
        refId: id, bordereauNumber: reference || undefined,
        createdBy: currentUserName, createdAt: new Date().toISOString(),
      },
    });
    const neg: Negotiation = {
      id, bankAccountId: account.id, date: when, amount: selTotal,
      itemKeys: selItems.map(i => i.key), items: selItems, notes: notes || undefined, reference: reference || undefined,
      txId, createdBy: currentUserName, createdAt: new Date().toISOString(),
    };
    await saveNegotiation(neg);
    onChanged([neg, ...negotiations]);
    toast.success(`Négociation de ${money(selTotal)} virée vers la caisse Carburant`);
    setSelected(new Set()); setReference(''); setNotes('');
    setTab('history'); setOpen(id);
  };

  const cancel = async () => {
    if (!toCancel) return;
    const tx = treasuryTransactions.find(t => t.id === toCancel.txId);
    if (tx) dispatch({ type: 'DELETE_TREASURY_TX', payload: tx.id });
    await deleteNegotiation(toCancel.id);
    onChanged(negotiations.filter(n => n.id !== toCancel.id));
    toast.success('Négociation annulée — les opérations redeviennent à négocier');
    setToCancel(null);
  };

  const renderItem = (i: NegotiableItem, selectable?: boolean) => {
    const sel = selected.has(i.key);
    return (
      <div key={i.key} onClick={selectable ? () => toggle(i.key) : undefined}
        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${selectable ? 'cursor-pointer' : ''} ${sel ? 'bg-[#eef3fc] border-[#003087]/40 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
        {selectable && (sel ? <CheckSquare className="w-5 h-5 text-[#003087] shrink-0" /> : <Square className="w-5 h-5 text-slate-300 shrink-0" />)}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${i.type === 'TPE' ? 'bg-cyan-100 text-cyan-700' : 'bg-purple-100 text-purple-700'}`}>
          {i.type === 'TPE' ? <CreditCard className="w-4 h-4" /> : <Tag className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-800 truncate">
            {i.type === 'TPE'
              ? (i.cardNumber ? `Carte ${formatCard(i.cardNumber)}` : (i.detailed ? 'Opération TPE' : 'TPE — montant global'))
              : (i.tagType || (i.detailed ? 'Opération TAG' : 'TAG — montant global'))}
            {i.operationNumber && <span className="text-slate-400 font-bold"> · Op. {i.operationNumber}</span>}
          </p>
          <p className="text-[11px] font-bold text-slate-400 truncate">
            Brigade du {formatDate(i.brigadeDate)} · {i.pompisteName || '—'}
            {i.fuelType ? ` · ${i.fuelType}` : ''}{i.productName ? ` · ${i.productName}` : ''}
            {i.quantity ? ` · ${i.quantity} L` : ''}{i.description ? ` · ${i.description}` : ''}
          </p>
        </div>
        <span className="font-black tabular-nums text-slate-900 shrink-0">{money(i.amount)}</span>
      </div>
    );
  };

  return (
    <Modal open onClose={onClose} icon={Handshake} size="2xl" fullHeight
      title={`Négociation TPE / TAG — ${account.name}`}
      subtitle={`Solde du compte : ${money(account.balance)} · ${pending.length} opération(s) à négocier (${money(pendingTotal)})`}
      footer={tab === 'pending' ? <>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" disabled={selItems.length === 0} onClick={create}>
          Négocier {selItems.length > 0 ? `${selItems.length} opération(s) · ${money(selTotal)}` : ''}
        </button>
      </> : <button className="btn-ghost" onClick={onClose}>Fermer</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
          {([['pending', `À négocier (${pending.length})`, Wallet], ['history', `Historique (${accountNegs.length})`, History]] as const).map(([id, l, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black uppercase tracking-wide ${tab === id ? 'bg-white shadow text-[#002d87]' : 'text-slate-500'}`}>
              <Icon className="w-4 h-4" /> {l}
            </button>
          ))}
        </div>

        {tab === 'pending' ? (<>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3"><p className="text-[10px] uppercase font-black text-amber-600">Non négociées</p><p className="font-black tabular-nums text-amber-800">{money(pendingTotal)}</p></div>
            <div className="rounded-xl bg-cyan-50 border border-cyan-100 p-3"><p className="text-[10px] uppercase font-black text-cyan-600">Dont TPE</p><p className="font-black tabular-nums text-cyan-800">{money(pending.filter(i => i.type === 'TPE').reduce((s, i) => s + i.amount, 0))}</p></div>
            <div className="rounded-xl bg-purple-50 border border-purple-100 p-3"><p className="text-[10px] uppercase font-black text-purple-600">Dont TAG</p><p className="font-black tabular-nums text-purple-800">{money(pending.filter(i => i.type === 'TAG').reduce((s, i) => s + i.amount, 0))}</p></div>
            <div className="rounded-xl bg-[#001f5c] p-3 text-white"><p className="text-[10px] uppercase font-black text-blue-200">Sélection</p><p className="font-black tabular-nums text-[#FFB800]">{money(selTotal)}</p></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Carte, n° opération, description…" className="!pl-9" />
            </div>
            <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}>
              <option value="ALL">TPE + TAG</option><option value="TPE">TPE</option><option value="TAG">TAG</option>
            </Select>
            <Select value={pompisteFilter} onChange={e => setPompisteFilter(e.target.value)}>
              <option value="">Tous les pompistes</option>
              {pompisteOptions.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} title="Du" />
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} title="Au" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10 font-bold">Aucune opération à négocier</p>
          ) : (
            <div className="space-y-2">
              <button onClick={toggleAll} className="inline-flex items-center gap-2 text-xs font-black text-[#002d87] uppercase">
                {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />} Tout sélectionner ({filtered.length})
              </button>
              {filtered.map(i => renderItem(i, true))}
            </div>
          )}

          {selItems.length > 0 && (
            <div className="rounded-2xl border border-[#003087]/20 bg-[#eef3fc] p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-[#002d87]">Création de la négociation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
                <Field label="Référence (optionnel)"><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="N° bordereau / remise" /></Field>
                <Field label="Destination"><div className="field-static bg-white">Caisse Carburant</div></Field>
              </div>
              <Field label="Notes"><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
              <div className="rounded-xl bg-[#001f5c] text-white p-3 flex items-center justify-between">
                <span className="text-sm font-bold text-blue-200">{selItems.length} opération(s) · {account.name} → Caisse Carburant</span>
                <span className="text-lg font-black tabular-nums text-[#FFB800]">{money(selTotal)}</span>
              </div>
            </div>
          )}
        </>) : (
          accountNegs.length === 0 ? <p className="text-center text-slate-400 text-sm py-10 font-bold">Aucune négociation sur ce compte</p> : (
            <div className="space-y-2">
              {accountNegs.map(n => (
                <div key={n.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <button onClick={() => setOpen(open === n.id ? null : n.id)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0"><Handshake className="w-5 h-5" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-800">Négociation du {formatDate(n.date)}</p>
                      <p className="text-[11px] font-bold text-slate-400">{n.items.length} opération(s) · {n.reference ? `Réf. ${n.reference} · ` : ''}{n.createdBy || ''}</p>
                    </div>
                    <Badge tone="success">→ Caisse Carburant</Badge>
                    <span className="font-black tabular-nums text-emerald-700">{money(n.amount)}</span>
                    {open === n.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {open === n.id && (
                    <div className="px-4 pb-4 space-y-2 border-t border-slate-100 pt-3">
                      {n.notes && <p className="text-xs font-bold text-slate-500 bg-amber-50 border border-amber-100 rounded-lg p-2">📝 {n.notes}</p>}
                      {n.items.map(i => renderItem(i))}
                      <div className="flex justify-end">
                        <button onClick={() => setToCancel(n)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black text-red-600 bg-red-50 hover:bg-red-100">
                          <Trash2 className="w-3.5 h-3.5" /> Annuler la négociation
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
      <Confirm open={!!toCancel} title="Annuler la négociation"
        message={`Le virement de ${money(toCancel?.amount || 0)} vers la caisse Carburant sera supprimé et les opérations redeviendront à négocier.`}
        confirmLabel="Annuler la négociation" onConfirm={cancel} onCancel={() => setToCancel(null)} />
    </Modal>
  );
}
