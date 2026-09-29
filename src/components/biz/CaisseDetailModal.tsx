/**
 * ─── Le solde de la caisse générale, expliqué ──────────────────────────────────
 * Ouvert depuis les Rapports Généraux quand on clique la carte « Caisse
 * générale ». Le chiffre seul ne se discutait pas mais ne se vérifiait pas non
 * plus : un solde négatif restait une mauvaise nouvelle sans explication.
 *
 * Cet écran déroule le calcul en entier :
 *
 *      ouverture + entrées − sorties = solde de fin de période
 *                          ( + mouvements postérieurs ) = solde d'aujourd'hui
 *
 * puis par NATURE d'opération (dépôts, encaissements de brigade, achats réglés
 * en espèces, dépenses, virements…), et enfin ligne par ligne — chaque mouvement
 * avec sa date, sa contrepartie, son document d'origine et son montant.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight,
  ShoppingCart, Receipt, CreditCard, Target, Wallet, Layers, AlertTriangle, History,
  ChevronRight, Info,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { money, formatDate, Modal, Badge } from '@/src/components/biz/Kit';
import { CaisseBreakdown, CaisseLine } from '@/src/lib/treasuryReporting';

const NATURE_ICON: Record<string, React.ElementType> = {
  'Dépôt': ArrowDownCircle, 'Retrait': ArrowUpCircle, 'Virement': ArrowLeftRight,
  'Achat': ShoppingCart, 'Vente': Receipt, 'Dépense': CreditCard,
  'Brigade': Target, 'TPE': CreditCard, 'Salaire': Wallet, 'Ajustement': Layers,
};

/** Un maillon du calcul : « Ouverture », « + Entrées », « = Solde »… */
function Step({ label, value, sign, tone, hint }: {
  label: string; value: number; sign: '' | '+' | '−' | '='; tone: string; hint?: string;
}) {
  return (
    <>
      {sign && <span className="self-center text-slate-300 font-black text-lg px-0.5 shrink-0">{sign}</span>}
      <div className={cn('rounded-xl px-3 py-2 flex-1 min-w-[128px]', sign === '=' ? 'bg-slate-100' : 'bg-slate-50')}>
        <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">{label}</p>
        <p className={cn('font-black tabular-nums text-sm mt-0.5', tone)}>{money(value)}</p>
        {hint && <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{hint}</p>}
      </div>
    </>
  );
}

/** Le tableau des mouvements — même lecture que le journal consolidé. */
function LinesTable({ lines, empty }: { lines: CaisseLine[]; empty: string }) {
  if (lines.length === 0) {
    return <p className="text-center text-slate-400 text-sm py-8 italic">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full border-collapse">
        <thead><tr>
          <th className="table-head">Date</th>
          <th className="table-head">Nature</th>
          <th className="table-head">Description</th>
          <th className="table-head">Contrepartie</th>
          <th className="table-head">Origine</th>
          <th className="table-head text-right">Effet sur la caisse</th>
        </tr></thead>
        <tbody>
          {lines.map(l => {
            const Icon = NATURE_ICON[l.nature] || Layers;
            return (
              <tr key={l.id}>
                <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(l.date)}</td>
                <td className="table-cell">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600 whitespace-nowrap">
                    <Icon className="w-3.5 h-3.5" /> {l.nature}
                  </span>
                </td>
                <td className="table-cell max-w-[280px]">
                  <span className="block truncate" title={l.label}>{l.label}</span>
                  <span className="text-[10px] text-slate-400">{l.partLabel}{l.reference ? ` · ${l.reference}` : ''}</span>
                </td>
                <td className="table-cell text-[11px] text-slate-400 whitespace-nowrap">{l.counterpart}</td>
                <td className="table-cell text-[11px] text-slate-400 whitespace-nowrap">{l.origin || 'Saisie manuelle'}</td>
                <td className={cn('table-cell text-right tabular-nums font-bold whitespace-nowrap',
                  l.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {l.amount >= 0 ? '+' : '−'}{money(Math.abs(l.amount))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CaisseDetailModal({ open, onClose, detail, from, to }: {
  open: boolean;
  onClose: () => void;
  detail: CaisseBreakdown;
  from: string;
  to: string;
}) {
  /** Nature sélectionnée dans la répartition — filtre la liste du dessous. */
  const [group, setGroup] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [showAfter, setShowAfter] = useState(false);

  const negative = detail.balance < 0;
  const selected = group ? detail.groups.find(g => g.key === group) || null : null;
  const lines = selected ? selected.lines : detail.lines;

  /** Ce qui a le plus vidé la caisse — la première explication d'un découvert. */
  const topOut = useMemo(
    () => detail.groups.filter(g => g.direction === 'out').slice(0, 3),
    [detail.groups]);

  return (
    <Modal open={open} onClose={onClose} icon={PiggyBank} size="2xl" fullHeight
      title="Solde de la caisse générale"
      subtitle={`Du ${formatDate(from)} au ${formatDate(to)} · ${detail.counts.period} mouvement(s) sur la période`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-emerald-600">Entrées +{money(detail.in)}</span>
          <span className="text-red-600">Sorties −{money(detail.out)}</span>
          <span className={negative ? 'text-red-600' : 'text-[#002d87]'}>Solde {money(detail.balance)}</span>
        </div>
        <button className="btn-primary" onClick={onClose}>Fermer</button>
      </>}>
      <div className="space-y-5">
        {/* ── Le solde, et ce qu'il vaut ─────────────────────────────────── */}
        <div className="rounded-2xl p-5 text-white"
          style={{ background: negative ? 'linear-gradient(135deg,#7f1d1d,#b91c1c)' : 'linear-gradient(135deg,#001f5c,#003087)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2" style={{ color: negative ? '#fecaca' : 'rgba(191,219,254,1)' }}>
                <PiggyBank className="w-5 h-5" />
                <span className="text-[11px] font-bold uppercase tracking-wide">Espèces en caisse aujourd'hui</span>
              </div>
              <p className="text-4xl font-black tabular-nums mt-1.5" style={{ color: negative ? '#fff' : '#FFB800' }}>
                {money(detail.balance)}
              </p>
            </div>
            <span className={cn('badge shrink-0', negative ? 'badge-danger' : 'badge-success')}>
              {negative ? 'Caisse à découvert' : 'Caisse positive'}
            </span>
          </div>
          <p className="text-[11px] mt-2" style={{ color: negative ? '#fecaca' : 'rgba(191,219,254,1)' }}>
            Somme de tous les mouvements du grand livre qui touchent la caisse générale — le même
            chiffre que l'écran Caisse Générale, toutes dates confondues.
          </p>
        </div>

        {/* ── Le calcul, étape par étape ─────────────────────────────────── */}
        <div className="card-glass p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
            Comment le solde est calculé
          </p>
          <div className="flex flex-wrap items-stretch gap-2">
            <Step label="Ouverture de période" value={detail.opening} sign="" tone="text-slate-700"
              hint={detail.counts.before ? `${detail.counts.before} mouvement(s) avant le ${formatDate(from)}` : 'aucun mouvement avant'} />
            <Step label="Entrées de la période" value={detail.in} sign="+" tone="text-emerald-600"
              hint={`${detail.counts.in} encaissement(s)`} />
            <Step label="Sorties de la période" value={detail.out} sign="−" tone="text-red-600"
              hint={`${detail.counts.out} décaissement(s)`} />
            <Step label="Solde fin de période" value={detail.periodEnd} sign="="
              tone={detail.periodEnd >= 0 ? 'text-blue-700' : 'text-red-600'} />
            {/* Les mouvements postérieurs n'apparaissent que s'il y en a : sans
                eux, « ouverture + entrées − sorties » ne retombe pas sur le
                solde affiché, et l'écart paraît être une erreur de calcul. */}
            {detail.counts.after > 0 && (
              <>
                <Step label="Mouvements postérieurs" value={detail.after} sign="+"
                  tone={detail.after >= 0 ? 'text-emerald-600' : 'text-red-600'}
                  hint={`${detail.counts.after} après le ${formatDate(to)}`} />
                <Step label="Solde aujourd'hui" value={detail.balance} sign="="
                  tone={negative ? 'text-red-600' : 'text-emerald-600'} />
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-400 italic mt-3">
            Seuls les mouvements enregistrés au grand livre bougent cette caisse : dépôts et retraits,
            encaissements d'espèces des brigades, achats et dépenses réglés en espèces, virements vers
            ou depuis un compte bancaire. Les recettes de la cafétéria et du lavage vivent dans la caisse
            de leur activité tant qu'elles n'ont pas été versées ici.
          </p>
        </div>

        {/* ── Pourquoi le solde est négatif ──────────────────────────────── */}
        {negative && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> La caisse a décaissé plus qu'elle n'a encaissé
            </p>
            <p className="text-[12px] text-red-700/90 mt-1.5 leading-relaxed">
              Le solde tient compte de TOUT l'historique. Un montant négatif veut dire qu'il est sorti
              plus d'espèces qu'il n'en est entré depuis le début — le plus souvent parce que des achats
              ou des dépenses ont été réglés « en espèces (caisse générale) » alors que la recette
              correspondante n'y a jamais été versée : encaissement de brigade non clôturé, versement
              d'une caisse d'activité non enregistré, ou fonds de caisse de départ jamais saisi.
            </p>
            {topOut.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-wide text-red-700/70">Ce qui a le plus vidé la caisse</p>
                {topOut.map(g => (
                  <div key={g.key} className="flex items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-1.5">
                    <span className="text-xs font-bold text-slate-700">{g.label}</span>
                    <span className="text-[11px] text-slate-400 ml-auto">{g.count} opération(s)</span>
                    <span className="font-black tabular-nums text-red-600 text-xs">−{money(g.total)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-red-700/70 italic mt-3">
              Pour redresser le solde : enregistrez le versement des espèces manquantes en dépôt depuis
              l'écran Caisse Générale, ou corrigez le compte débité de l'achat / de la dépense concerné.
            </p>
          </div>
        )}

        {/* ── Répartition par nature ─────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wide text-[#002d87] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#FFB800]" /> Détail par nature d'opération
            </h4>
            {group && (
              <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => setGroup(null)}>
                Voir toutes les natures
              </button>
            )}
          </div>
          {detail.groups.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
              <Info className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              <p className="text-sm font-bold text-slate-400">Aucun mouvement de caisse sur cette période.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {detail.groups.map(g => {
                const Icon = NATURE_ICON[g.label] || Layers;
                const on = group === g.key;
                const isIn = g.direction === 'in';
                return (
                  <button key={g.key} onClick={() => setGroup(on ? null : g.key)}
                    className={cn('rounded-2xl border p-3 text-left transition-all bg-white',
                      on ? 'border-[#003087] ring-2 ring-[#003087]/20 shadow-md' : 'border-slate-100 shadow-sm hover:border-[#003087]/40')}>
                    <div className="flex items-center gap-2">
                      <div className={cn('w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0',
                        isIn ? 'bg-emerald-500' : 'bg-red-500')}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-700 truncate">{g.label}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {isIn ? 'Entrée' : 'Sortie'} · {g.count} op.
                        </p>
                      </div>
                    </div>
                    <p className={cn('text-lg font-black tabular-nums mt-1.5', isIn ? 'text-emerald-600' : 'text-red-600')}>
                      {isIn ? '+' : '−'}{money(g.total)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Chaque mouvement de la période ─────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wide text-[#002d87] flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#FFB800]" />
              {selected ? `Mouvements — ${selected.label}` : 'Chaque mouvement de la période'}
            </h4>
            <div className="flex items-center gap-2">
              <span className="badge badge-success"><TrendingUp className="w-3 h-3" /> +{money(detail.in)}</span>
              <span className="badge badge-danger"><TrendingDown className="w-3 h-3" /> −{money(detail.out)}</span>
              <Badge tone={detail.in - detail.out >= 0 ? 'info' : 'warning'}>Net {money(detail.in - detail.out)}</Badge>
            </div>
          </div>
          <div className="card-glass overflow-hidden">
            <LinesTable lines={lines} empty="Aucun mouvement de caisse sur cette période." />
          </div>
        </div>

        {/* ── D'où vient l'ouverture ─────────────────────────────────────── */}
        {detail.counts.before > 0 && (
          <div className="space-y-2">
            <button onClick={() => setShowBefore(v => !v)}
              className="w-full flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#002d87] rounded-xl px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors">
              <History className="w-4 h-4 text-[#FFB800]" />
              Ce qui compose l'ouverture ({detail.counts.before} mouvement(s) avant le {formatDate(from)})
              <span className="ml-auto font-black tabular-nums text-slate-700">{money(detail.opening)}</span>
              <ChevronRight className={cn('w-4 h-4 text-slate-400 transition-transform', showBefore && 'rotate-90')} />
            </button>
            {showBefore && (
              <div className="card-glass overflow-hidden">
                <LinesTable lines={detail.openingLines} empty="Aucun mouvement antérieur." />
              </div>
            )}
          </div>
        )}

        {/* ── Ce qui a bougé après la période ────────────────────────────── */}
        {detail.counts.after > 0 && (
          <div className="space-y-2">
            <button onClick={() => setShowAfter(v => !v)}
              className="w-full flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#002d87] rounded-xl px-3 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Mouvements postérieurs au {formatDate(to)} ({detail.counts.after}) — comptés dans le solde
              <span className={cn('ml-auto font-black tabular-nums', detail.after >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {money(detail.after)}
              </span>
              <ChevronRight className={cn('w-4 h-4 text-slate-400 transition-transform', showAfter && 'rotate-90')} />
            </button>
            {showAfter && (
              <div className="card-glass overflow-hidden">
                <LinesTable lines={detail.afterLines} empty="Aucun mouvement postérieur." />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
