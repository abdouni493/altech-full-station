/**
 * ─── Caisse & Banques (rapport général) ────────────────────────────────────────
 * Reprend dans le rapport général tout ce que montrent les écrans *Caisse
 * Générale* et *Comptes Bancaires* : le solde de la caisse, le solde de chaque
 * compte bancaire avec son historique, la caisse de chaque partie, et le journal
 * consolidé de TOUTES les opérations de la station sur la période.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, Landmark, Layers, TrendingUp, TrendingDown, ArrowLeftRight, Search,
  ArrowDownCircle, ArrowUpCircle, ShoppingCart, Receipt, CreditCard, Target, Wallet,
  Building2, ChevronDown, ChevronRight, Coins,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, matchesSearch } from '@/src/lib/utils';
import { money, formatDate, Table } from '@/src/components/biz/Kit';
import { TreasuryReport, TreasuryAccount, TreasuryPartKey } from '@/src/lib/treasuryReporting';
import CaisseDetailModal from '@/src/components/biz/CaisseDetailModal';

const fmtDate = (s?: string) => (s ? formatDate(s) : '—');

const NATURE_ICON: Record<string, React.ElementType> = {
  'Dépôt': ArrowDownCircle, 'Retrait': ArrowUpCircle, 'Virement': ArrowLeftRight,
  'Achat': ShoppingCart, 'Vente': Receipt, 'Dépense': CreditCard,
  'Brigade': Target, 'TPE': CreditCard, 'Salaire': Wallet, 'Ajustement': Layers,
};

function Kpi({ icon: Icon, label, value, sub, tone = 'blue' }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', amber: 'from-amber-500 to-yellow-500',
    red: 'from-red-500 to-red-600', purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600',
  };
  return (
    <div className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm">
      <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}>
        <Icon style={{ width: 18, height: 18 }} />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── One bank account, with its history ──────────────────────────────────────
function AccountCard({ a }: { a: TreasuryAccount; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('rounded-2xl border overflow-hidden bg-white transition-all',
      open ? 'border-[#003087]/30 shadow-lg' : 'border-slate-100 shadow-sm')}>
      <div className="p-4 text-white" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-[#FFB800] shrink-0" />
              <h4 className="font-black truncate">{a.name}</h4>
            </div>
            {a.accountNumber && <p className="text-[11px] text-blue-200 font-mono mt-0.5">{a.accountNumber}</p>}
          </div>
          <span className={cn('badge', a.balance >= 0 ? 'badge-success' : 'badge-danger')}>
            {a.balance >= 0 ? 'Actif' : 'Découvert'}
          </span>
        </div>
        <p className="text-[10px] uppercase font-bold text-blue-200 mt-3">Solde actuel</p>
        <p className="text-2xl font-black tabular-nums text-[#FFB800] leading-tight">{money(a.balance)}</p>
        <p className="text-[11px] text-blue-200 mt-0.5">Début de période {money(a.openingBalance)} • {a.movesCount} mouvement(s)</p>
      </div>
      <div className="p-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-50 p-2 text-center">
            <p className="text-[9px] uppercase font-black text-slate-400">Entrées</p>
            <p className="font-black text-emerald-600 tabular-nums text-xs">+{money(a.credit)}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-2 text-center">
            <p className="text-[9px] uppercase font-black text-slate-400">Sorties</p>
            <p className="font-black text-red-600 tabular-nums text-xs">−{money(a.debit)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 text-center">
            <p className="text-[9px] uppercase font-black text-slate-400">Net période</p>
            <p className="font-black text-slate-700 tabular-nums text-xs">{money(a.credit - a.debit)}</p>
          </div>
        </div>
        <button onClick={() => setOpen(o => !o)} disabled={a.moves.length === 0}
          className={cn('w-full flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 rounded-lg transition-colors',
            a.moves.length ? 'text-[#003087] hover:bg-slate-50' : 'text-slate-300 cursor-default')}>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {a.moves.length ? `Historique (${a.moves.length})` : 'Aucun mouvement sur la période'}
        </button>
        <AnimatePresence initial={false}>
          {open && a.moves.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }} className="overflow-hidden">
              <div className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                {a.moves.map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-700 truncate">{m.label}</p>
                      <p className="text-slate-400">
                        {fmtDate(m.date)} • {m.nature} • {m.counterpart}
                        {m.reference ? ` • ${m.reference}` : ''}
                      </p>
                    </div>
                    <span className={cn('font-black tabular-nums shrink-0', m.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────
export default function TreasuryView({ report: r }: { report: TreasuryReport }) {
  const [part, setPart] = useState<'all' | TreasuryPartKey>('all');
  const [nature, setNature] = useState('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(150);
  /** Le détail complet du solde de la caisse — ouvert en cliquant la carte. */
  const [caisseOpen, setCaisseOpen] = useState(false);

  const natures = useMemo(() => r.byNature.map(n => n.nature), [r.byNature]);

  const rows = useMemo(() => r.movements.filter(m => {
    return (part === 'all' || m.part === part)
      && (nature === 'all' || m.nature === nature)
      && matchesSearch(search, m.label, m.accounts);
  }), [r.movements, part, nature, search]);

  const flow = useMemo(() => {
    const inTotal = rows.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const outTotal = rows.filter(m => m.amount < 0).reduce((s, m) => s - m.amount, 0);
    return { inTotal, outTotal, net: inTotal - outTotal };
  }, [rows]);

  return (
    <div className="space-y-8">
      {/* Hero balances */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Un solde négatif ne doit pas s'afficher comme un solde normal : la
            carte passe au rouge, l'annonce et s'ouvre sur le calcul complet. */}
        <button type="button" onClick={() => setCaisseOpen(true)}
          className="rounded-2xl p-6 text-white text-left transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#003087]/40"
          style={{ background: r.caisseBalance < 0 ? 'linear-gradient(135deg, #7f1d1d, #b91c1c)' : 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className={cn('flex items-center gap-2', r.caisseBalance < 0 ? 'text-red-100' : 'text-blue-200')}>
              <PiggyBank className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Caisse générale</span>
            </div>
            {r.caisseBalance < 0 && <span className="badge badge-danger shrink-0">Découvert</span>}
          </div>
          <p className={cn('text-4xl font-black tabular-nums mt-2', r.caisseBalance < 0 ? 'text-white' : 'text-[#FFB800]')}>
            {money(r.caisseBalance)}
          </p>
          <p className={cn('text-[11px] mt-1', r.caisseBalance < 0 ? 'text-red-100' : 'text-blue-200')}>
            Espèces — dépôts, retraits et virements
          </p>
          {/* Le solde est celui d'aujourd'hui ; la ligne ci-dessous rattache ce
              chiffre à la période choisie, sinon rien ne bougeait à l'écran
              quand on changeait les dates. */}
          <p className={cn('text-[11px] mt-1 tabular-nums', r.caisseBalance < 0 ? 'text-red-100' : 'text-blue-200')}>
            Début de période {money(r.caisseOpening)} · +{money(r.caisseIn)} · −{money(r.caisseOut)}
          </p>
          <p className={cn('text-[11px] font-black mt-2 flex items-center gap-1', r.caisseBalance < 0 ? 'text-white' : 'text-[#FFB800]')}>
            Voir le détail du calcul <ChevronRight className="w-3 h-3" />
          </p>
        </button>
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <Landmark className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Total en banque</span>
          </div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(r.bankTotal)}</p>
          <p className="text-[11px] text-emerald-100 mt-1">{r.counts.accounts} compte(s) bancaire(s)</p>
          <p className="text-[11px] text-emerald-100 mt-1 tabular-nums">
            Début de période {money(r.bankOpening)} · +{money(r.bankIn)} · −{money(r.bankOut)}
          </p>
        </div>
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #4c1d95, #6d28d9)' }}>
          <div className="flex items-center gap-2 text-violet-200">
            <Coins className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Trésorerie totale</span>
          </div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(r.grandTotal)}</p>
          <p className="text-[11px] text-violet-200 mt-1">Caisse générale + comptes bancaires</p>
        </div>
      </div>

      {/* Period flows */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} tone="green" label="Encaissements" value={`+${money(r.inflow)}`} sub="sur la période" />
        <Kpi icon={TrendingDown} tone="red" label="Décaissements" value={`−${money(r.outflow)}`} sub="sur la période" />
        <Kpi icon={Layers} tone={r.net >= 0 ? 'blue' : 'red'} label="Flux net" value={money(r.net)} />
        <Kpi icon={Building2} tone="purple" label="Opérations" value={String(r.counts.movements)} sub={`${r.counts.ledgerLines} au grand livre`} />
      </div>

      {/* Cash position per part */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Wallet className="w-5 h-5 text-[#FFB800]" /> Caisse de chaque partie</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {r.partBalances.map(p => (
            <button key={p.key} onClick={() => setPart(part === p.key ? 'all' : p.key)}
              className={cn('card-glass p-4 text-left transition-all', part === p.key && 'ring-2 ring-[#003087]')}>
              <p className="text-[11px] font-bold uppercase text-slate-400">{p.label}</p>
              <p className={cn('text-2xl font-black tabular-nums mt-1', p.balance >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.balance)}</p>
              <div className="flex items-center gap-3 mt-2 text-[11px] font-bold">
                <span className="text-emerald-600">+{money(p.inflow)}</span>
                <span className="text-red-600">−{money(p.outflow)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Bank accounts */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Landmark className="w-5 h-5 text-[#FFB800]" /> Comptes bancaires</h3>
        {r.accounts.length === 0 ? (
          <div className="card-glass p-8 text-center text-slate-400 text-sm">Aucun compte bancaire enregistré.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {r.accounts.map(a => <AccountCard key={a.id} a={a} />)}
          </div>
        )}
      </div>

      {/* Break-down by nature */}
      {r.byNature.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5 text-[#FFB800]" /> Répartition par nature d'opération</h3>
          <Table head={<>
            <th className="table-head">Nature</th><th className="table-head text-right">Opérations</th>
            <th className="table-head text-right">Encaissements</th><th className="table-head text-right">Décaissements</th>
            <th className="table-head text-right">Net</th>
          </>}>
            {r.byNature.map(n => {
              const Icon = NATURE_ICON[n.nature] || Layers;
              return (
                <tr key={n.nature} className="cursor-pointer hover:bg-slate-50" onClick={() => setNature(nature === n.nature ? 'all' : n.nature)}>
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-1.5 font-bold text-slate-700"><Icon className="w-3.5 h-3.5" /> {n.nature}</span>
                  </td>
                  <td className="table-cell tabular-nums text-right">{n.count}</td>
                  <td className="table-cell tabular-nums text-right text-emerald-600">{n.inflow ? `+${money(n.inflow)}` : '—'}</td>
                  <td className="table-cell tabular-nums text-right text-red-600">{n.outflow ? `−${money(n.outflow)}` : '—'}</td>
                  <td className={cn('table-cell tabular-nums text-right font-black', n.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(n.net)}</td>
                </tr>
              );
            })}
            <tr className="bg-blue-50/60">
              <td className="table-cell font-black text-[#002d87]">TOTAL</td>
              <td className="table-cell tabular-nums text-right font-black">{r.counts.movements}</td>
              <td className="table-cell tabular-nums text-right font-black text-emerald-600">+{money(r.inflow)}</td>
              <td className="table-cell tabular-nums text-right font-black text-red-600">−{money(r.outflow)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', r.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(r.net)}</td>
            </tr>
          </Table>
        </div>
      )}

      {/* Consolidated journal */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Receipt className="w-5 h-5 text-[#FFB800]" /> Journal consolidé des opérations</h3>

        <div className="card-glass p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Description ou compte…" className="input-field pl-9" />
          </div>
          <select value={part} onChange={e => setPart(e.target.value as any)} className="input-field !w-auto min-w-[180px]">
            <option value="all">Toutes les parties</option>
            {r.partBalances.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select value={nature} onChange={e => setNature(e.target.value)} className="input-field !w-auto min-w-[160px]">
            <option value="all">Toutes les natures</option>
            {natures.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-xs text-slate-400 ml-auto">{rows.length} opération(s)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-center">
            <p className="text-[10px] uppercase font-black text-slate-400">Encaissements (filtre)</p>
            <p className="font-black text-emerald-600 tabular-nums">+{money(flow.inTotal)}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-3 text-center">
            <p className="text-[10px] uppercase font-black text-slate-400">Décaissements (filtre)</p>
            <p className="font-black text-red-600 tabular-nums">−{money(flow.outTotal)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-[10px] uppercase font-black text-slate-400">Flux net (filtre)</p>
            <p className={cn('font-black tabular-nums', flow.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(flow.net)}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card-glass p-8 text-center text-slate-400 text-sm">Aucune opération sur la période avec ces filtres.</div>
        ) : (
          <>
            <Table head={<>
              <th className="table-head">Date</th><th className="table-head">Nature</th><th className="table-head">Partie</th>
              <th className="table-head">Description</th><th className="table-head">Comptes</th>
              <th className="table-head">Référence</th><th className="table-head text-right">Montant</th>
            </>}>
              {rows.slice(0, limit).map(m => {
                const Icon = NATURE_ICON[m.nature] || Layers;
                return (
                  <tr key={m.id}>
                    <td className="table-cell whitespace-nowrap">{fmtDate(m.date)}</td>
                    <td className="table-cell">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600"><Icon className="w-3.5 h-3.5" /> {m.nature}</span>
                    </td>
                    <td className="table-cell"><span className="badge badge-neutral">{m.partLabel}</span></td>
                    <td className="table-cell max-w-[300px]">{m.label || '—'}</td>
                    <td className="table-cell text-[11px] text-slate-400">{m.accounts || '—'}</td>
                    <td className="table-cell text-[11px] text-slate-400">{m.reference || (m.isLedger ? 'Grand livre' : 'Document')}</td>
                    <td className={cn('table-cell text-right tabular-nums font-bold', m.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                    </td>
                  </tr>
                );
              })}
            </Table>
            {rows.length > limit && (
              <button className="btn-outline w-full" onClick={() => setLimit(l => l + 250)}>
                Afficher plus ({rows.length - limit} restantes)
              </button>
            )}
          </>
        )}
      </div>

      {/* Le solde de la caisse, expliqué jusqu'à la ligne */}
      <CaisseDetailModal open={caisseOpen} onClose={() => setCaisseOpen(false)}
        detail={r.caisseDetail} from={r.from} to={r.to} />
    </div>
  );
}
