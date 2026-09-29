/**
 * ─── « Générer un rapport » — le relevé de compte d'un client sur une période ───
 *
 * Ouvert depuis le bouton Historique de n'importe quelle activité (Carburant,
 * Cafétéria, Lavage & Vidange). L'utilisateur choisit une date de début et
 * une date de fin — ou un raccourci — voit le relevé se recalculer en direct,
 * puis l'imprime sur le gabarit de la Fiche Journalière.
 *
 * Le composant ne sait RIEN de l'activité : elle lui passe une fonction qui
 * construit le `ClientStatement` pour un couple (début, fin). C'est ce qui
 * permet aux trois écrans de partager exactement le même document.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useRef, useState } from 'react';
import { FileBarChart, Printer, CalendarRange, Wallet, CircleDollarSign, Receipt } from 'lucide-react';
import { Modal, money } from './Kit';
import { printFiche } from './ReportFiche';
import { ClientStatementFiche } from './ClientStatementFiche';
import { ClientStatement, KIND_COLOR, periodLabel } from '@/src/lib/clientStatement';
import { cn } from '@/src/lib/utils';

/** Raccourcis de période — `null` sur une borne veut dire « pas de limite ». */
type Preset = { id: string; label: string; range: () => { from: string; to: string } };

const iso = (d: Date) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
};
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const startOfYear = () => { const d = new Date(); return new Date(d.getFullYear(), 0, 1); };

const PRESETS: Preset[] = [
  { id: 'all', label: 'Tout', range: () => ({ from: '', to: '' }) },
  { id: 'month', label: 'Ce mois', range: () => ({ from: iso(startOfMonth()), to: iso(new Date()) }) },
  {
    id: 'last30', label: '30 derniers jours',
    range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return { from: iso(d), to: iso(new Date()) }; },
  },
  { id: 'year', label: 'Cette année', range: () => ({ from: iso(startOfYear()), to: iso(new Date()) }) },
];

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR');
};

function Tile({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone: 'blue' | 'green' | 'red' | 'amber';
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600',
    red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-yellow-500',
  };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
      <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}>
        <Icon style={{ width: 16, height: 16 }} />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ClientReportModal({
  open, onClose, build, settings, clientName, partLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Construit le relevé pour la période demandée (bornes vides = tout). */
  build: (from: string, to: string) => ClientStatement;
  settings: any;
  clientName: string;
  partLabel: string;
}) {
  // Par défaut : TOUT l'historique. Le compte d'un client se lit d'abord en
  // entier ; c'est la restriction qui doit être demandée, pas l'inverse.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const ficheRef = useRef<HTMLDivElement>(null);

  const statement = useMemo(
    () => build(from, to),
    [build, from, to]);

  const activePreset = PRESETS.find(p => {
    const r = p.range();
    return r.from === from && r.to === to;
  })?.id;

  return (
    <Modal
      open={open} onClose={onClose} icon={FileBarChart} size="3xl" fullHeight zClass="z-[95]"
      title={`Rapport client — ${clientName}`}
      subtitle={`${partLabel} · ${periodLabel(from, to)}`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">Consommé {money(statement.totals.charged)}</span>
          <span className="text-emerald-600">Payé {money(statement.totals.paid)}</span>
          <span className="text-red-600">Reste dû {money(statement.closingDebt)}</span>
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={() => printFiche(ficheRef.current)}>
          <Printer className="w-4 h-4" /> Imprimer le relevé
        </button>
      </>}>

      <div className="space-y-5 not-italic text-left">
        {/* ── Période ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <header className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
            <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0 shadow-sm">1</span>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#002d87] flex items-center gap-2">
                <CalendarRange className="w-4 h-4 shrink-0" /> Période du rapport
              </h4>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                Laissez les dates vides pour éditer l'historique complet du compte.
              </p>
            </div>
          </header>
          <div className="p-3 sm:p-5 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p.id} type="button"
                  onClick={() => { const r = p.range(); setFrom(r.from); setTo(r.to); }}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                    activePreset === p.id ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Date de début</span>
                <input type="date" value={from} max={to || undefined}
                  onChange={e => setFrom(e.target.value)}
                  className="input-field mt-1 w-full" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Date de fin</span>
                <input type="date" value={to} min={from || undefined}
                  onChange={e => setTo(e.target.value)}
                  className="input-field mt-1 w-full" />
              </label>
            </div>
          </div>
        </section>

        {/* ── Totaux ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile icon={Receipt} label="Total consommé" value={money(statement.totals.charged)}
            sub={`${statement.totals.documents} document(s)`} tone="blue" />
          <Tile icon={Wallet} label="Total payé" value={money(statement.totals.paid)}
            sub={`${statement.payments.length} règlement(s)`} tone="green" />
          <Tile icon={CircleDollarSign} label="Reste période" value={money(statement.totals.rest)}
            sub={`Crédit ${money(statement.totals.credit)}`} tone="amber" />
          {/* La tuile de clôture dit ce que le client doit RÉELLEMENT : son
              avance déduite. Elle annonçait la dette brute, et le relevé
              réclamait donc un argent que la station détenait déjà. */}
          <Tile icon={CircleDollarSign} label="Dette de clôture" value={money(statement.netDebt)}
            sub={statement.advanceHeld > 0
              ? `Ouverture ${money(statement.openingDebt)} · avance ${money(statement.advanceHeld)} déduite`
              : `Ouverture ${money(statement.openingDebt)}`} tone="red" />
        </div>

        {/* ── Journal ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <header className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
            <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0 shadow-sm">2</span>
            <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#002d87]">
              Journal des opérations ({statement.lines.length})
            </h4>
          </header>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            {statement.lines.length === 0 ? (
              <p className="p-8 text-center text-slate-400 text-sm font-semibold">Aucune opération sur cette période</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Nature</th>
                    <th className="px-4 py-2.5">Réf</th>
                    <th className="px-4 py-2.5">Désignation</th>
                    <th className="px-4 py-2.5 text-right">Débit</th>
                    <th className="px-4 py-2.5 text-right">Crédit</th>
                    <th className="px-4 py-2.5 text-right">Reste</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statement.lines.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{shortDate(l.date)}</td>
                      <td className="px-4 py-2.5 font-black whitespace-nowrap" style={{ color: KIND_COLOR[l.kind] }}>{l.kindLabel}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-bold">{l.ref || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[280px]">
                        <span className="block truncate font-semibold" title={l.label}>{l.label}</span>
                        {(l.qtyLabel || l.mode || l.reference) && (
                          <span className="block text-[10px] text-slate-400 font-bold truncate">
                            {[l.qtyLabel, l.mode, l.reference].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold">{l.charged ? money(l.charged) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-600">{l.paid ? money(l.paid) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-black text-red-600">{l.rest ? money(l.rest) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr className="text-[#002d87] font-black">
                    <td className="px-4 py-3 uppercase text-[10px] tracking-widest" colSpan={4}>Total période</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(statement.totals.charged)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{money(statement.totals.paid)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-600">{money(statement.totals.rest)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </section>

        {/* ── Règlements ──────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <header className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
            <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0 shadow-sm">3</span>
            <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#002d87]">
              Règlements encaissés ({statement.payments.length})
            </h4>
          </header>
          <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
            {statement.payments.length === 0 ? (
              <p className="p-8 text-center text-slate-400 text-sm font-semibold">Aucun règlement sur cette période</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Libellé</th>
                    <th className="px-4 py-2.5">Mode</th>
                    <th className="px-4 py-2.5">Référence</th>
                    <th className="px-4 py-2.5 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statement.payments.map(p => (
                    <tr key={p.id} className="hover:bg-emerald-50/40">
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{shortDate(p.date)}</td>
                      <td className="px-4 py-2.5 text-slate-600 font-semibold">{p.label || 'Règlement'}</td>
                      <td className="px-4 py-2.5 font-black text-emerald-700">{p.mode}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-bold">
                        {p.reference || '—'}
                        {p.inferred && <span className="text-amber-600"> (date du document)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-black text-emerald-600">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr className="text-[#002d87] font-black">
                    <td className="px-4 py-3 uppercase text-[10px] tracking-widest" colSpan={4}>Total encaissé</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{money(statement.totals.paid)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* La feuille A4, hors écran : c'est elle que `printFiche` clone. */}
      <ClientStatementFiche ref={ficheRef} statement={statement} settings={settings} />
    </Modal>
  );
}
