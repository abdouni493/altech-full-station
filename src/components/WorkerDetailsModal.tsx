/**
 * ─── WorkerDetailsModal ─────────────────────────────────────────────────────────
 * Shared "Voir détails" dialog for every worker screen (Pompistes, Gérants,
 * Employés Magasin, Lavage & Cafétéria). It shows the full personal file plus a
 * history area with three tabs — Paiements, Acomptes, Absences — where each entry
 * can be edited inline or deleted. Each screen maps its own model onto the
 * normalised props below and persists the edits/deletes through the callbacks.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Eye, X, User, CreditCard, Wallet, UserX, Edit2, Trash2, Check, Save, Banknote,
  ClipboardList,
} from 'lucide-react';
import { cn, formatCurrency } from '@/src/lib/utils';

const money = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);
const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d.getTime()) ? (iso || '—') : d.toLocaleDateString('fr-DZ', { day: '2-digit', month: 'long', year: 'numeric' });
};

export interface DetailInfoItem { label: string; value: React.ReactNode }
export interface DetailAcompte { id: string; date: string; amount: number; description?: string; paid?: boolean }
export interface DetailAbsence { id: string; date: string; cost: number; description?: string; paid?: boolean }
export interface DetailPayment {
  id: string; date: string; amount: number; title: string; subtitle?: string; notes?: string;
  /**
   * Decomposition du paiement, affichee sous la ligne : c'est la que se lisent
   * les retenues qui expliquent l'ecart entre le salaire de base et le net,
   * dont le decalage d'inventaire.
   */
  breakdown?: { label: string; value: string; tone?: 'red' | 'green' | 'slate' }[];
}

/** Une ligne du dossier inventaire d'un employe qui en repond. */
export interface DetailInventaireRow {
  id: string;
  /** Nom de l'inventaire (invnt-01-01-2026). */
  ref: string;
  date: string;
  /** Manquants constates, au prix d'achat. */
  loss: number;
  /** Part reellement retenue sur son salaire. */
  deducted: number;
  /** Date du paiement qui a constate ce decalage. */
  settledOn?: string;
  status: 'en attente' | 'constate' | 'retenu';
}

/** Dossier inventaire complet - absent pour un employe non concerne. */
export interface DetailInventory {
  /** L'employe est-il concerne par les inventaires ? */
  liable: boolean;
  /** Manquants constates sur ses paiements mais jamais retenus : sa dette. */
  debt: number;
  /** Total deja retenu sur ses salaires au titre des inventaires. */
  deducted: number;
  /** Inventaires non encore regles dans sa paie. */
  pendingCount: number;
  pendingLoss: number;
  rows: DetailInventaireRow[];
}

export interface WorkerDetailsModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  role?: string;
  subtitle?: string;
  statusLabel?: string;
  statusTone?: 'green' | 'red' | 'slate';
  info: DetailInfoItem[];
  payments: DetailPayment[];
  acomptes: DetailAcompte[];
  absences: DetailAbsence[];
  canEdit?: boolean;
  canDelete?: boolean;
  onSaveAcompte?: (a: DetailAcompte) => void;
  onDeleteAcompte?: (id: string) => void;
  onSaveAbsence?: (a: DetailAbsence) => void;
  onDeleteAbsence?: (id: string) => void;
  onSavePayment?: (p: { id: string; date: string; amount: number; notes?: string }) => void;
  onDeletePayment?: (id: string) => void;
  /** Dossier inventaire - passe uniquement quand l'employe en repond. */
  inventory?: DetailInventory;
}

type Tab = 'payments' | 'acomptes' | 'absences' | 'inventaire';

export default function WorkerDetailsModal(props: WorkerDetailsModalProps) {
  const { open, onClose, name, role, subtitle, statusLabel, statusTone = 'green', info,
    payments, acomptes, absences, canEdit, canDelete, inventory } = props;

  const [tab, setTab] = useState<Tab>('payments');
  // Inline edit / delete-confirm state — one row at a time.
  const [editId, setEditId] = useState<string | null>(null);
  const [dDate, setDDate] = useState('');
  const [dAmount, setDAmount] = useState(0);
  const [dDesc, setDDesc] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  if (!open || typeof document === 'undefined') return null;

  const startEdit = (id: string, date: string, amount: number, desc: string) => {
    setConfirmDel(null); setEditId(id);
    setDDate((date || '').slice(0, 10)); setDAmount(amount); setDDesc(desc || '');
  };
  const cancelEdit = () => setEditId(null);

  const saveAcompte = (a: DetailAcompte) => { props.onSaveAcompte?.({ ...a, date: dDate, amount: dAmount, description: dDesc }); setEditId(null); };
  const saveAbsence = (a: DetailAbsence) => { props.onSaveAbsence?.({ ...a, date: dDate, cost: dAmount, description: dDesc }); setEditId(null); };
  const savePayment = (p: DetailPayment) => { props.onSavePayment?.({ id: p.id, date: dDate, amount: dAmount, notes: dDesc }); setEditId(null); };

  const statusToneCls = statusTone === 'red' ? 'bg-red-100 text-red-700'
    : statusTone === 'slate' ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-700';

  const tabs: { id: Tab; label: string; icon: React.ElementType; count: number }[] = [
    { id: 'payments', label: 'Paiements', icon: CreditCard, count: payments.length },
    { id: 'acomptes', label: 'Acomptes', icon: Wallet, count: acomptes.length },
    { id: 'absences', label: 'Absences', icon: UserX, count: absences.length },
    // L'onglet n'existe que pour un employe qui repond des inventaires : le
    // montrer aux autres n'apprendrait rien et ferait douter de leur situation.
    ...(inventory?.liable
      ? [{ id: 'inventaire' as Tab, label: 'Inventaire', icon: ClipboardList, count: inventory.rows.length }]
      : []),
  ];

  // ── One editable / deletable row ──────────────────────────────────────────────
  const Row = ({ id, title, sub, amount, amountTone, breakdown, onEdit, onDelete }: {
    id: string; title: string; sub?: string; amount: string;
    amountTone: string;
    breakdown?: { label: string; value: string; tone?: 'red' | 'green' | 'slate' }[];
    onEdit?: () => void; onDelete?: () => void; key?: React.Key;
  }) => {
    if (editId === id) {
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Date</label><input type="date" value={dDate} onChange={e => setDDate(e.target.value)} className="input-field !py-1.5 text-xs" /></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Montant (DA)</label><input type="number" value={dAmount} onChange={e => setDAmount(Number(e.target.value))} className="input-field !py-1.5 text-xs" /></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Description</label><input value={dDesc} onChange={e => setDDesc(e.target.value)} className="input-field !py-1.5 text-xs" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase text-slate-500 border border-slate-200 hover:bg-slate-100">Annuler</button>
            <button onClick={onEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase text-white bg-[#003087] hover:bg-blue-800 flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> Enregistrer</button>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-700 text-sm truncate">{title}</p>
          {sub && <p className="text-[11px] text-slate-400 truncate">{sub}</p>}
        </div>
        <span className={cn('font-black tabular-nums text-sm shrink-0', amountTone)}>{amount}</span>
        {confirmDel === id ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-bold text-red-600">Supprimer ?</span>
            <button onClick={() => { onDelete?.(); setConfirmDel(null); }} className="px-2 py-1 rounded-lg bg-red-600 text-white text-[10px] font-black uppercase">Oui</button>
            <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black uppercase">Non</button>
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && onEdit !== undefined && (
              <button onClick={onEdit} title="Modifier" className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-600 hover:bg-blue-50"><Edit2 className="w-4 h-4" /></button>
            )}
            {canDelete && onDelete !== undefined && (
              <button onClick={() => { setEditId(null); setConfirmDel(id); }} title="Supprimer" className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        )}
      </div>
      {breakdown && breakdown.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1">
          {breakdown.map((b, i) => (
            <span key={i} className="text-[11px]">
              <span className="text-slate-400">{b.label} </span>
              <b className={cn('tabular-nums',
                b.tone === 'red' ? 'text-red-600' : b.tone === 'green' ? 'text-emerald-600' : 'text-slate-600')}>
                {b.value}
              </b>
            </span>
          ))}
        </div>
      )}
      </div>
    );
  };

  return createPortal(
    <AnimatePresence>
      <div className="modal-shell z-[70] text-left">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="modal-box modal-box-full max-w-4xl relative z-10 flex flex-col"
        >
          {/* Header */}
          <div className="p-5 sm:p-6 bg-gradient-to-r from-[#001f5c] via-blue-800 to-[#002d87] text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-2xl font-black text-[#FFB800] shrink-0">
                {name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-black uppercase tracking-wide text-base sm:text-lg truncate">{name}</h3>
                  {statusLabel && <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-full', statusToneCls)}>{statusLabel}</span>}
                </div>
                <p className="text-[11px] sm:text-xs text-blue-100 font-semibold truncate">{[role, subtitle].filter(Boolean).join(' · ') || 'Employé'}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-5 bg-slate-50">
            {/* Personal info */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <header className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
                <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center"><User className="w-4 h-4" /></div>
                <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#002d87]">Informations personnelles</h4>
              </header>
              <div className="p-3 sm:p-4 grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                {info.map((it, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                    <p className="text-[9px] uppercase font-black text-slate-400 tracking-widest mb-0.5">{it.label}</p>
                    <p className="font-bold text-slate-700 text-sm break-words">{it.value ?? '—'}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* History */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 sm:px-4 pt-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white overflow-x-auto custom-scrollbar">
                {tabs.map(tb => (
                  <button key={tb.id} onClick={() => { setTab(tb.id); setEditId(null); setConfirmDel(null); }}
                    className={cn('flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-black uppercase tracking-wide whitespace-nowrap border-b-2 -mb-px transition-colors',
                      tab === tb.id ? 'border-[#003087] text-[#003087]' : 'border-transparent text-slate-400 hover:text-slate-600')}>
                    <tb.icon className="w-4 h-4" /> {tb.label}
                    <span className={cn('px-1.5 py-0.5 rounded-full text-[10px]', tab === tb.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400')}>{tb.count}</span>
                  </button>
                ))}
              </div>

              <div className="p-3 sm:p-4 space-y-2 max-h-[42vh] overflow-y-auto custom-scrollbar">
                {tab === 'payments' && (payments.length === 0
                  ? <Empty icon={Banknote} label="Aucun paiement enregistré." />
                  : payments.map(p => (
                    <Row key={p.id} id={p.id} title={p.title} sub={`${fmtDate(p.date)}${p.subtitle ? ` · ${p.subtitle}` : ''}${p.notes ? ` · ${p.notes}` : ''}`}
                      amount={money(p.amount)} amountTone="text-emerald-600" breakdown={p.breakdown}
                      onEdit={props.onSavePayment ? () => (editId === p.id ? savePayment(p) : startEdit(p.id, p.date, p.amount, p.notes || '')) : undefined}
                      onDelete={props.onDeletePayment ? () => props.onDeletePayment!(p.id) : undefined} />
                  )))}

                {tab === 'acomptes' && (acomptes.length === 0
                  ? <Empty icon={Wallet} label="Aucun acompte enregistré." />
                  : acomptes.map(a => (
                    <Row key={a.id} id={a.id} title={a.description || 'Acompte'} sub={`${fmtDate(a.date)}${a.paid ? ' · décompté' : ''}`}
                      amount={`−${money(a.amount)}`} amountTone="text-amber-600"
                      onEdit={props.onSaveAcompte ? () => (editId === a.id ? saveAcompte(a) : startEdit(a.id, a.date, a.amount, a.description || '')) : undefined}
                      onDelete={props.onDeleteAcompte ? () => props.onDeleteAcompte!(a.id) : undefined} />
                  )))}

                {tab === 'inventaire' && inventory && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                      <div className="rounded-xl bg-red-50 border border-red-100 p-3">
                        <p className="text-[9px] uppercase font-black text-slate-400 tracking-widest">Dette d'inventaire</p>
                        <p className="font-black text-red-600 tabular-nums text-sm">{money(inventory.debt)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">constatee, non retenue</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                        <p className="text-[9px] uppercase font-black text-slate-400 tracking-widest">Deja retenu</p>
                        <p className="font-black text-emerald-600 tabular-nums text-sm">{money(inventory.deducted)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">sur ses salaires</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                        <p className="text-[9px] uppercase font-black text-slate-400 tracking-widest">En attente</p>
                        <p className="font-black text-amber-700 tabular-nums text-sm">{money(inventory.pendingLoss)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{inventory.pendingCount} inventaire(s)</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <p className="text-[9px] uppercase font-black text-slate-400 tracking-widest">Inventaires suivis</p>
                        <p className="font-black text-slate-700 tabular-nums text-sm">{inventory.rows.length}</p>
                      </div>
                    </div>

                    {inventory.rows.length === 0
                      ? <Empty icon={ClipboardList} label="Aucun decalage d'inventaire pour cet employe." />
                      : inventory.rows.map(r => (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-slate-700 text-sm truncate">{r.ref}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {fmtDate(r.date)}
                              {r.settledOn ? ` - constate au paiement du ${fmtDate(r.settledOn)}` : ' - pas encore porte sur un paiement'}
                            </p>
                          </div>
                          <span className={cn('text-[9px] font-black uppercase px-2 py-1 rounded-full shrink-0',
                            r.status === 'retenu' ? 'bg-emerald-100 text-emerald-700'
                              : r.status === 'constate' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-500')}>
                            {r.status}
                          </span>
                          <div className="text-right shrink-0">
                            <p className="font-black tabular-nums text-sm text-red-600">{money(r.loss)}</p>
                            <p className="text-[10px] text-slate-400 tabular-nums">
                              {r.deducted > 0 ? `${money(r.deducted)} retenu(s)` : 'rien retenu'}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {tab === 'absences' && (absences.length === 0
                  ? <Empty icon={UserX} label="Aucune absence enregistrée." />
                  : absences.map(a => (
                    <Row key={a.id} id={a.id} title={a.description || 'Absence'} sub={`${fmtDate(a.date)}${a.paid ? ' · décomptée' : ''}`}
                      amount={a.cost > 0 ? `−${money(a.cost)}` : '—'} amountTone="text-red-600"
                      onEdit={props.onSaveAbsence ? () => (editId === a.id ? saveAbsence(a) : startEdit(a.id, a.date, a.cost, a.description || '')) : undefined}
                      onDelete={props.onDeleteAbsence ? () => props.onDeleteAbsence!(a.id) : undefined} />
                  )))}
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="p-4 sm:p-5 bg-white border-t border-slate-200 flex justify-end shrink-0">
            <button onClick={onClose}
              className="px-8 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest text-white bg-[#001f5c] hover:bg-blue-900 transition-colors flex items-center gap-2">
              <Check className="w-4 h-4" /> Fermer
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

function Empty({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="text-center py-10">
      <Icon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
      <p className="text-slate-400 font-semibold text-sm">{label}</p>
    </div>
  );
}
