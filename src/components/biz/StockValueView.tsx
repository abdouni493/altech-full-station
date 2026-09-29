/**
 * ─── Valeur du stock ───────────────────────────────────────────────────────────
 * Deux colonnes qui ne se confondent jamais :
 *   • VALEUR D'ACHAT — ce que la marchandise a coûté. C'est celle du bilan.
 *   • VALEUR DE VENTE — ce qu'elle rapportera au prix affiché.
 * Leur écart est la marge latente : le gain qui dort en stock.
 *
 * Trois activités, chacune avec ses réserves (cuves, catalogue, comptoir,
 * boutique), détaillées jusqu'au produit — avec recherche par nom ou code.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Boxes, Wallet, TrendingUp, Layers, Search, AlertTriangle, ChevronRight,
  CalendarClock, Beaker, PieChart as PieIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, matchesSearch } from '@/src/lib/utils';
import { money, formatDate, Table, Badge, Select } from '@/src/components/biz/Kit';
import ChartBox from '@/src/components/ChartBox';
import { StockValuation, StockPart, StockLine } from '@/src/lib/stockValuation';

const AXIS = { fontSize: 11, fill: '#94a3b8' } as const;
const shortMoney = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
};

function Stat({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'purple';
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-yellow-500', red: 'from-red-500 to-red-600',
    purple: 'from-purple-500 to-purple-600',
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

/** Le tableau détaillé d'une section (cuves, catalogue, comptoir…). */
function LinesTable({ lines }: { lines: StockLine[] }) {
  if (!lines.length) return <div className="card-glass p-6 text-center text-sm text-slate-400">Aucune ligne.</div>;
  const t = lines.reduce((a, l) => ({
    buy: a.buy + l.buyValue, sell: a.sell + l.sellValue, margin: a.margin + l.margin,
  }), { buy: 0, sell: 0, margin: 0 });
  return (
    <Table head={<>
      <th className="table-head">Produit</th>
      <th className="table-head text-right">Quantité</th>
      <th className="table-head text-right">Prix d'achat</th>
      <th className="table-head text-right">Prix de vente</th>
      <th className="table-head text-right">Valeur d'achat</th>
      <th className="table-head text-right">Valeur de vente</th>
      <th className="table-head text-right">Marge latente</th>
      <th className="table-head">État</th>
    </>}>
      {lines.map(l => (
        <tr key={l.id} className="hover:bg-slate-50">
          <td className="table-cell">
            <div className="font-bold text-slate-700 flex items-center gap-1.5">
              {l.name}
              {l.raw && <span title="Matière première"><Beaker className="w-3.5 h-3.5 text-amber-500" /></span>}
            </div>
            <div className="text-[11px] text-slate-400">
              {l.code ? <span className="font-mono">{l.code}</span> : null}
              {l.code && l.category ? ' · ' : ''}{l.category || ''}
            </div>
          </td>
          <td className={cn('table-cell tabular-nums text-right font-bold', l.negative && 'text-red-600')}>
            {l.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{l.unit ? ` ${l.unit}` : ''}
          </td>
          <td className="table-cell tabular-nums text-right text-slate-500">{money(l.buyPrice)}</td>
          <td className="table-cell tabular-nums text-right text-slate-500">{l.raw ? '—' : money(l.sellPrice)}</td>
          <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(l.buyValue)}</td>
          <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(l.sellValue)}</td>
          <td className={cn('table-cell tabular-nums text-right font-bold', l.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {money(l.margin)}
            {l.buyValue > 0 && <span className="text-[10px] text-slate-400 font-medium"> ({l.marginPct.toFixed(0)} %)</span>}
          </td>
          <td className="table-cell">
            {l.negative ? <Badge tone="danger">Négatif</Badge>
              : l.low ? <Badge tone="warning">Bas</Badge>
              : <Badge tone="success">OK</Badge>}
            {l.expirationDate && (
              <div className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />{formatDate(l.expirationDate)}
              </div>
            )}
          </td>
        </tr>
      ))}
      <tr className="bg-blue-50/60">
        <td className="table-cell font-black text-[#002d87]" colSpan={4}>TOTAL</td>
        <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(t.buy)}</td>
        <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(t.sell)}</td>
        <td className={cn('table-cell tabular-nums text-right font-black', t.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(t.margin)}</td>
        <td className="table-cell" />
      </tr>
    </Table>
  );
}

/** Une activité : ses totaux, puis chacune de ses sections déroulée. */
function PartBlock({ part, query }: { part: StockPart; query: string; key?: React.Key }) {
  const [open, setOpen] = useState<string | null>(part.sections[0]?.key || null);
  const needle = query.trim();
  const match = (l: StockLine) => matchesSearch(query, l.name, l.code, l.category);

  const sections = part.sections
    .map(s => ({ ...s, lines: s.lines.filter(match) }))
    .filter(s => !needle || s.lines.length > 0);

  if (needle && sections.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">{part.emoji}</span>
          <div className="min-w-0">
            <p className="font-black text-[#002d87] text-sm leading-none">{part.label}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide mt-0.5">
              {part.count} référence(s)
              {part.lowCount > 0 ? ` · ${part.lowCount} sous seuil` : ''}
              {part.negativeCount > 0 ? ` · ${part.negativeCount} en négatif` : ''}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs sm:text-sm font-bold">
          <span className="text-amber-700">Achat {money(part.buyValue)}</span>
          <span className="text-blue-700">Vente {money(part.sellValue)}</span>
          <span className={part.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            Marge {money(part.margin)} ({part.marginPct.toFixed(0)} %)
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {sections.map(s => {
          const isOpen = open === s.key || !!needle;
          return (
            <div key={s.key}>
              <button onClick={() => setOpen(isOpen && !needle ? null : s.key)}
                className="w-full flex flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                <ChevronRight className={cn('w-4 h-4 text-slate-300 transition-transform shrink-0', isOpen && 'rotate-90')} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-700 text-sm">{s.label}</p>
                  <p className="text-[11px] text-slate-400">{s.hint} · {s.count} ligne(s)
                    {s.unit ? ` · ${s.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${s.unit}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-bold shrink-0">
                  <span className="text-amber-700">{money(s.buyValue)}</span>
                  <span className="text-blue-700">{money(s.sellValue)}</span>
                  <span className={s.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(s.margin)}</span>
                </div>
              </button>
              {isOpen && <div className="px-3 pb-4"><LinesTable lines={s.lines} /></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function StockValueView({ valuation: v }: { valuation: StockValuation }) {
  const [query, setQuery] = useState('');
  const [partFilter, setPartFilter] = useState('all');

  const parts = useMemo(
    () => v.parts.filter(p => partFilter === 'all' || p.key === partFilter),
    [v.parts, partFilter]);

  const chartData = v.parts.flatMap(p => p.sections.map(s => ({
    name: `${p.emoji} ${s.label}`,
    achat: s.buyValue,
    vente: s.sellValue,
  })));

  return (
    <div className="space-y-8">
      {/* ── Les deux valorisations ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
          <div className="flex items-center gap-2 text-amber-100">
            <Wallet className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Valeur au prix d'achat</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(v.buyValue)}</p>
          <p className="text-[11px] text-amber-100 mt-0.5">Ce que la marchandise a coûté — la valeur du bilan</p>
        </div>
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg,#001f5c,#003087)' }}>
          <div className="flex items-center gap-2 text-blue-200">
            <TrendingUp className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Valeur au prix de vente</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5" style={{ color: '#FFB800' }}>{money(v.sellValue)}</p>
          <p className="text-[11px] text-blue-200 mt-0.5">Ce que tout le stock rapporterait au prix affiché</p>
        </div>
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <Layers className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Marge latente</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(v.margin)}</p>
          <p className="text-[11px] text-emerald-100 mt-0.5">
            {v.marginPct.toFixed(1)} % du prix d'achat — le gain qui dort en stock
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Boxes} tone="blue" label="Références en stock" value={String(v.count)} />
        <Stat icon={AlertTriangle} tone="red" label="Sous seuil d'alerte" value={String(v.lowCount)}
          sub={v.negativeCount ? `dont ${v.negativeCount} en négatif` : undefined} />
        <Stat icon={Wallet} tone="amber" label="Immobilisé (achat)" value={money(v.buyValue)} />
        <Stat icon={TrendingUp} tone="green" label="Potentiel (vente)" value={money(v.sellValue)} />
      </div>

      {/* ── Comparatif visuel des réserves ── */}
      {chartData.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <PieIcon className="w-5 h-5 text-[#FFB800]" /> Achat vs vente, réserve par réserve
          </h3>
          <div className="card-glass p-4">
            <ChartBox height={300}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} height={62} angle={-16} textAnchor="end" />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(val: any, name: any) => [money(Number(val) || 0), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="achat" name="Valeur d'achat" fill="#d97706" radius={[4, 4, 0, 0]} maxBarSize={34} />
                <Bar dataKey="vente" name="Valeur de vente" fill="#003087" radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ChartBox>
          </div>
        </div>
      )}

      {/* ── Comparatif chiffré par activité ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Layers className="w-5 h-5 text-[#FFB800]" /> Comparatif par activité
        </h3>
        <Table head={<>
          <th className="table-head">Activité</th><th className="table-head text-right">Références</th>
          <th className="table-head text-right">Valeur d'achat</th><th className="table-head text-right">Valeur de vente</th>
          <th className="table-head text-right">Marge latente</th><th className="table-head text-right">Marge %</th>
          <th className="table-head text-right">Alertes</th>
        </>}>
          {v.parts.map(p => (
            <tr key={p.key}>
              <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
              <td className="table-cell tabular-nums text-right text-slate-500">{p.count}</td>
              <td className="table-cell tabular-nums text-right font-bold text-amber-700">{money(p.buyValue)}</td>
              <td className="table-cell tabular-nums text-right font-bold text-blue-700">{money(p.sellValue)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.margin)}</td>
              <td className="table-cell tabular-nums text-right text-slate-500">{p.marginPct.toFixed(1)} %</td>
              <td className="table-cell tabular-nums text-right">
                {p.lowCount > 0 ? <Badge tone="danger">{p.lowCount}</Badge> : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL STATION</td>
            <td className="table-cell tabular-nums text-right font-black">{v.count}</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(v.buyValue)}</td>
            <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(v.sellValue)}</td>
            <td className={cn('table-cell tabular-nums text-right font-black', v.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(v.margin)}</td>
            <td className="table-cell tabular-nums text-right font-black">{v.marginPct.toFixed(1)} %</td>
            <td className="table-cell tabular-nums text-right font-black">{v.lowCount}</td>
          </tr>
        </Table>
      </div>

      {/* ── Détail complet ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Boxes className="w-5 h-5 text-[#FFB800]" /> Détail du stock, référence par référence
        </h3>
        <div className="card-glass p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)} className="input-field pl-9"
              placeholder="Nom, code-barres ou catégorie…" />
          </div>
          <Select value={partFilter} onChange={e => setPartFilter(e.target.value)} className="!w-auto min-w-[190px]">
            <option value="all">Toutes les activités</option>
            {v.parts.map(p => <option key={p.key} value={p.key}>{p.emoji} {p.label}</option>)}
          </Select>
        </div>

        <div className="space-y-4">
          {parts.map(p => <PartBlock key={p.key} part={p} query={query} />)}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 italic">
        Le carburant en cuve est valorisé au prix d'achat et au prix à la pompe enregistrés dans les Réglages.
        Les matières premières n'ont pas de prix de vente : leur valeur de vente est égale à leur coût, pour ne pas
        inventer une marge qui n'existe pas.
      </p>
    </div>
  );
}
