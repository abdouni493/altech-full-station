/**
 * ─── Analyses consolidées ──────────────────────────────────────────────────────
 * La station vue de haut : la courbe de toutes les activités réunies, puis la
 * comparaison entre elles — et, sur chaque activité, une carte avec sa propre
 * courbe qui s'ouvre en grand pour dérouler SON analyse complète (produits,
 * catégories, productions, ce qui se vend et ce qui dort).
 *
 * Le classement des meilleures et des pires ventes est fait toutes activités
 * confondues : chaque produit garde l'emoji de la partie d'où il vient.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  BarChart3, TrendingUp, TrendingDown, Trophy, Snowflake, ChevronRight, Layers,
  CircleDollarSign, ShoppingCart, Activity, Flame, LineChart as LineIcon,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { money, Modal, Table, Badge } from '@/src/components/biz/Kit';
import ChartBox from '@/src/components/ChartBox';
import AnalyticsView, { ProductAnalyticsModal } from '@/src/components/biz/AnalyticsView';
import { PartAnalytics, ProductAnalytics, Granularity, GRANULARITY_LABEL } from '@/src/lib/bizAnalytics';

const PART_COLOR: Record<string, string> = {
  carburant: '#003087', restaurant: '#be123c', cafeteria: '#d97706', lavage: '#0e9f6e', global: '#7c3aed',
};
const AXIS = { fontSize: 11, fill: '#94a3b8' } as const;
const shortMoney = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
};
const TIP = {
  contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 },
  formatter: (v: any, name: any) => [money(Number(v) || 0), name],
} as const;

/** Carte d'une activité : ses chiffres et sa courbe, cliquable. */
function PartCard({ part, onOpen }: { part: PartAnalytics; onOpen: () => void; key?: React.Key }) {
  const color = PART_COLOR[part.key] || '#003087';
  const up = part.trendPct >= 0;
  return (
    <button onClick={onOpen}
      className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 text-left w-full transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-[#003087]/30">
      <div className="flex items-center gap-2">
        <span className="text-xl">{part.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#002d87] text-sm leading-none">{part.label}</p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide mt-0.5">
            {part.totals.operations} opération(s) · {part.totals.products} produit(s)
          </p>
        </div>
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black',
          up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {up ? '+' : ''}{part.trendPct.toFixed(0)} %
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[9px] uppercase font-bold text-slate-400">Ventes</p>
          <p className="font-black tabular-nums text-[#002d87] text-sm leading-tight">{money(part.totals.sales)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2">
          <p className="text-[9px] uppercase font-bold text-slate-400">Coût</p>
          <p className="font-black tabular-nums text-amber-700 text-sm leading-tight">{money(part.totals.cost)}</p>
        </div>
        <div className={cn('rounded-xl p-2', part.totals.net >= 0 ? 'bg-emerald-50' : 'bg-red-50')}>
          <p className="text-[9px] uppercase font-bold text-slate-400">Résultat</p>
          <p className={cn('font-black tabular-nums text-sm leading-tight', part.totals.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {money(part.totals.net)}
          </p>
        </div>
      </div>

      <div className="mt-3 -mx-1">
        <ChartBox height={90}>
          <AreaChart data={part.points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`spark-${part.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Tooltip {...TIP} labelFormatter={(l: any) => String(l)} />
            <Area type="monotone" dataKey="revenue" name="Ventes" stroke={color} strokeWidth={2} fill={`url(#spark-${part.key})`} />
          </AreaChart>
        </ChartBox>
      </div>

      <p className="text-[11px] font-black text-[#003087] mt-2 flex items-center gap-1">
        Analyse détaillée de cette partie <ChevronRight className="w-3 h-3" />
      </p>
    </button>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-yellow-500', red: 'from-red-500 to-red-600',
    purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600',
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

function RankList({ rows, tone, onPick, emptyText }: {
  rows: ProductAnalytics[]; tone: 'good' | 'bad'; onPick: (p: ProductAnalytics) => void; emptyText: string;
}) {
  if (!rows.length) return <div className="card-glass p-6 text-center text-sm text-slate-400">{emptyText}</div>;
  const max = Math.max(...rows.map(r => Math.abs(r.revenue)), 1);
  return (
    <div className="card-glass p-3 space-y-1.5">
      {rows.map((r, i) => (
        <button key={r.id} onClick={() => onPick(r)} className="w-full text-left rounded-xl px-3 py-2 hover:bg-slate-50 group">
          <div className="flex items-center gap-2">
            <span className={cn('w-6 h-6 rounded-lg text-[11px] font-black flex items-center justify-center shrink-0',
              tone === 'good' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>{i + 1}</span>
            <span className="font-bold text-slate-700 text-sm truncate flex-1">{r.name}</span>
            <span className="font-black tabular-nums text-sm text-[#002d87] shrink-0">{money(r.revenue)}</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#003087] shrink-0" />
          </div>
          <div className="flex items-center gap-2 mt-1 pl-8">
            <div className="h-1.5 rounded-full bg-slate-100 flex-1 overflow-hidden">
              <div className={cn('h-full rounded-full', tone === 'good' ? 'bg-emerald-500' : 'bg-slate-400')}
                style={{ width: `${Math.max(2, (Math.abs(r.revenue) / max) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400 tabular-nums shrink-0">gain {money(r.gain)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function GlobalAnalyticsView({ parts, global, onGranularity }: {
  parts: PartAnalytics[];
  global: PartAnalytics;
  onGranularity?: (g: Granularity) => void;
}) {
  const [open, setOpen] = useState<PartAnalytics | null>(null);
  const [picked, setPicked] = useState<ProductAnalytics | null>(null);

  /** Une série par activité, alignée sur les mêmes intervalles. */
  const comparison = useMemo(() => global.points.map((p, i) => {
    const row: Record<string, any> = { label: p.label };
    parts.forEach(part => { row[part.label] = part.points[i]?.revenue || 0; });
    return row;
  }), [global.points, parts]);

  const shareData = parts.map(p => ({
    name: `${p.emoji} ${p.label}`,
    value: Math.max(0, p.totals.sales),
    fill: PART_COLOR[p.key] || '#003087',
  }));

  return (
    <div className="space-y-8">
      {/* ── Toute la station ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} tone="green" label="Ventes — toutes activités" value={money(global.totals.sales)}
          sub={`${global.totals.operations} opération(s)`} />
        <Kpi icon={Layers} tone="amber" label="Coût des marchandises" value={money(global.totals.cost)}
          sub={`Marge ${money(global.totals.margin)}`} />
        <Kpi icon={CircleDollarSign} tone={global.totals.net >= 0 ? 'blue' : 'red'} label="Résultat de la période"
          value={money(global.totals.net)} sub="marge − dépenses & salaires" />
        <Kpi icon={ShoppingCart} tone="purple" label="Achats" value={money(global.totals.purchases)}
          sub={`Dépenses ${money(global.totals.expenses)}`} />
      </div>

      {/* ── La courbe consolidée ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-black text-[#002d87] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#FFB800]" /> Évolution de toute la station
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {GRANULARITY_LABEL[global.granularity]} · moyenne {money(global.avgPerPoint)} par intervalle
            </p>
          </div>
          {onGranularity && (
            <select value={global.granularity} onChange={e => onGranularity(e.target.value as Granularity)}
              className="input-field !w-auto !py-1.5 text-xs">
              <option value="day">Par jour</option>
              <option value="week">Par semaine</option>
              <option value="month">Par mois</option>
            </select>
          )}
        </div>
        <div className="card-glass p-4">
          <ChartBox height={300}>
            <AreaChart data={global.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="glbRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#003087" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#003087" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="glbGain" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0e9f6e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#0e9f6e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
              <Tooltip {...TIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="revenue" name="Ventes" stroke="#003087" strokeWidth={2} fill="url(#glbRev)" />
              <Area type="monotone" dataKey="gain" name="Marge" stroke="#0e9f6e" strokeWidth={2} fill="url(#glbGain)" />
              <Line type="monotone" dataKey="expenses" name="Dépenses" stroke="#dc2626" strokeWidth={2} dot={false} />
            </AreaChart>
          </ChartBox>
        </div>
      </div>

      {/* ── Une carte par activité ── */}
      <div className="space-y-3">
        <div>
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <LineIcon className="w-5 h-5 text-[#FFB800]" /> Chaque activité en un coup d'œil
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Cliquez une activité pour ouvrir son analyse complète : ses produits, ses catégories, ses graphiques.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {parts.map(p => <PartCard key={p.key} part={p} onOpen={() => setOpen(p)} />)}
        </div>
      </div>

      {/* ── Comparatif ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#FFB800]" /> Comparatif des activités
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card-glass p-4 lg:col-span-2">
            <ChartBox height={280}>
              <BarChart data={comparison} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
                <Tooltip {...TIP} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {parts.map(p => (
                  <Bar key={p.key} dataKey={p.label} stackId="a" fill={PART_COLOR[p.key] || '#64748b'} maxBarSize={30} />
                ))}
              </BarChart>
            </ChartBox>
          </div>
          <div className="card-glass p-4">
            <ChartBox height={280}>
              <PieChart>
                <Pie data={shareData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {shareData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip {...TIP} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ChartBox>
          </div>
        </div>

        <Table head={<>
          <th className="table-head">Activité</th>
          <th className="table-head text-right">Ventes</th>
          <th className="table-head text-right">Coût marchandises</th>
          <th className="table-head text-right">Marge</th>
          <th className="table-head text-right">Achats</th>
          <th className="table-head text-right">Dépenses</th>
          <th className="table-head text-right">Résultat</th>
          <th className="table-head text-right">Tendance</th>
          <th className="table-head" />
        </>}>
          {parts.map(p => (
            <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(p)}>
              <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
              <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.totals.sales)}</td>
              <td className="table-cell tabular-nums text-right text-amber-700">{money(p.totals.cost)}</td>
              <td className="table-cell tabular-nums text-right text-blue-700">{money(p.totals.margin)}</td>
              <td className="table-cell tabular-nums text-right">{money(p.totals.purchases)}</td>
              <td className="table-cell tabular-nums text-right text-red-600">{money(p.totals.expenses)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.totals.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {money(p.totals.net)}
              </td>
              <td className="table-cell text-right">
                <Badge tone={p.trendPct >= 0 ? 'success' : 'danger'}>
                  {p.trendPct >= 0 ? '+' : ''}{p.trendPct.toFixed(1)} %
                </Badge>
              </td>
              <td className="table-cell text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL STATION</td>
            <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(global.totals.sales)}</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(global.totals.cost)}</td>
            <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(global.totals.margin)}</td>
            <td className="table-cell tabular-nums text-right font-black">{money(global.totals.purchases)}</td>
            <td className="table-cell tabular-nums text-right font-black text-red-600">{money(global.totals.expenses)}</td>
            <td className={cn('table-cell tabular-nums text-right font-black', global.totals.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {money(global.totals.net)}
            </td>
            <td className="table-cell" colSpan={2} />
          </tr>
        </Table>
      </div>

      {/* ── Ce qui se vend / ce qui ne se vend pas, toutes activités ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <h3 className="font-black text-[#002d87] flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#FFB800]" /> Ce qui se vend le mieux
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Toutes activités confondues — cliquez pour la courbe du produit</p>
          </div>
          <RankList rows={global.best} tone="good" onPick={setPicked} emptyText="Aucune vente sur la période." />
        </div>
        <div className="space-y-3">
          <div>
            <h3 className="font-black text-[#002d87] flex items-center gap-2">
              <Snowflake className="w-5 h-5 text-[#FFB800]" /> Ce qui se vend le moins
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Vendus au moins une fois, mais tout en bas du classement</p>
          </div>
          <RankList rows={global.worst} tone="bad" onPick={setPicked} emptyText="Aucune vente sur la période." />
        </div>
      </div>

      {/* ── Stock dormant, toutes activités ── */}
      <div className="space-y-3">
        <div>
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#FFB800]" /> Produits qui ne se vendent pas
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">En stock aujourd'hui, aucune vente sur la période</p>
        </div>
        {global.dead.length === 0 ? (
          <div className="card-glass p-6 text-center text-sm text-slate-400">Tout ce qui est en stock a été vendu au moins une fois ✅</div>
        ) : (
          <>
            <Table head={<>
              <th className="table-head">Produit</th><th className="table-head">Catégorie</th>
              <th className="table-head text-right">En stock</th>
              <th className="table-head text-right">Immobilisé (achat)</th>
              <th className="table-head text-right">Valeur de vente</th>
            </>}>
              {global.dead.slice(0, 30).map(d => (
                <tr key={d.id}>
                  <td className="table-cell">
                    <div className="font-bold text-slate-700">{d.name}</div>
                    {d.code && <div className="text-[11px] text-slate-400 font-mono">{d.code}</div>}
                  </td>
                  <td className="table-cell text-slate-400">{d.category || '—'}</td>
                  <td className="table-cell tabular-nums text-right font-bold">
                    {d.stockQty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{d.unit ? ` ${d.unit}` : ''}
                  </td>
                  <td className="table-cell tabular-nums text-right text-amber-700">{money(d.stockValue)}</td>
                  <td className="table-cell tabular-nums text-right text-slate-500">{money(d.potentialValue)}</td>
                </tr>
              ))}
            </Table>
            <div className="card-glass px-5 py-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                {global.dead.length} produit(s) sans une seule vente{global.dead.length > 30 ? ' — 30 premiers affichés' : ''}.
              </span>
              <span className="font-black tabular-nums text-amber-700">
                {money(global.dead.reduce((s, d) => s + d.stockValue, 0))} immobilisés
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── L'analyse complète d'une activité ── */}
      <Modal open={!!open} onClose={() => setOpen(null)} icon={BarChart3} size="2xl" fullHeight
        title={open ? `${open.emoji} ${open.label} — analyse détaillée` : ''}
        subtitle={open ? `${GRANULARITY_LABEL[open.granularity]} · ${open.points.length} intervalle(s)` : ''}
        footer={<button className="btn-ghost ml-auto" onClick={() => setOpen(null)}>Fermer</button>}>
        {open && <AnalyticsView analytics={open} />}
      </Modal>

      <ProductAnalyticsModal product={picked} granularity={global.granularity} onClose={() => setPicked(null)} />
    </div>
  );
}
