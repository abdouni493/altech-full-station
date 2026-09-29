/**
 * ─── Analyses ──────────────────────────────────────────────────────────────────
 * La lecture graphique d'une période, pour une activité ou pour toute la
 * station : l'évolution des ventes, du coût des marchandises et du gain, puis le
 * classement des produits — ce qui SE VEND et ce qui NE SE VEND PAS.
 *
 * Chaque produit se clique et ouvre SA propre courbe sur la même période, avec
 * son détail complet (quantités, coût, marge, part du chiffre d'affaires, reste
 * en stock). La recherche accepte le nom ou le code-barres.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  TrendingUp, TrendingDown, BarChart3, PackageSearch, Trophy, Snowflake, Layers,
  Beaker, ChevronRight, Search, CircleDollarSign, ShoppingCart, Boxes, Activity, Flame,
} from 'lucide-react';
import { cn, matchesSearch } from '@/src/lib/utils';
import { money, formatDate, Modal, Badge, Table, Select } from '@/src/components/biz/Kit';
import ChartBox from '@/src/components/ChartBox';
import {
  PartAnalytics, ProductAnalytics, ProductionAnalytics, Granularity,
  GRANULARITY_LABEL, PRODUCT_KIND_LABEL, ProductKind, DeadStockRow,
} from '@/src/lib/bizAnalytics';

const PALETTE = ['#003087', '#FFB800', '#0e9f6e', '#dc2626', '#7c3aed', '#0e7490', '#d97706', '#be185d', '#0f766e', '#4338ca'];

/** Axe des montants : 12 500 DA → « 12,5k ». */
const shortMoney = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
};

const AXIS = { fontSize: 11, fill: '#94a3b8' } as const;

const tooltipStyle = {
  contentStyle: {
    borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12,
    boxShadow: '0 10px 25px -5px rgba(0,0,0,.15)',
  },
  formatter: (v: any, name: any) => [money(Number(v) || 0), name],
} as const;

// ─── Petites briques ─────────────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, sub, tone = 'blue', onClick }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone?: 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'cyan' | 'slate'; onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600',
    red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-yellow-500',
    purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600',
    slate: 'from-slate-500 to-slate-600',
  };
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick}
      className={cn('rounded-2xl border border-slate-100 p-4 bg-white shadow-sm text-left w-full',
        onClick && 'transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer')}>
      <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}>
        <Icon style={{ width: 18, height: 18 }} />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
    </Tag>
  );
}

function TrendBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black',
      up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {up ? '+' : ''}{pct.toFixed(1)} %
    </span>
  );
}

function SectionTitle({ icon: Icon, title, hint, right }: {
  icon: React.ElementType; title: string; hint?: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Icon className="w-5 h-5 text-[#FFB800]" /> {title}</h3>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

// ─── Courbe principale d'une activité ────────────────────────────────────────
type MetricKey = 'revenue' | 'gain' | 'qty' | 'flow';

const METRICS: { id: MetricKey; label: string }[] = [
  { id: 'revenue', label: 'Ventes & coûts' },
  { id: 'gain', label: 'Gain' },
  { id: 'qty', label: 'Quantités' },
  { id: 'flow', label: 'Achats & dépenses' },
];

function MainChart({ a, metric }: { a: PartAnalytics; metric: MetricKey }) {
  const data = a.points;
  if (!data.length) {
    return <div className="card-glass p-10 text-center text-sm text-slate-400">Aucune donnée sur cette période.</div>;
  }
  return (
    <div className="card-glass p-4">
      <ChartBox height={300}>
        {metric === 'revenue' ? (
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="anaRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#003087" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#003087" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="revenue" name="Ventes" stroke="#003087" strokeWidth={2} fill="url(#anaRev)" />
            <Bar dataKey="cost" name="Coût marchandises" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Line type="monotone" dataKey="gain" name="Marge" stroke="#0e9f6e" strokeWidth={2} dot={false} />
          </ComposedChart>
        ) : metric === 'gain' ? (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="net" name="Résultat (marge − charges)" radius={[4, 4, 0, 0]} maxBarSize={30}>
              {data.map((p, i) => <Cell key={i} fill={p.net >= 0 ? '#0e9f6e' : '#dc2626'} />)}
            </Bar>
          </BarChart>
        ) : metric === 'qty' ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="anaQty" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={46} />
            <Tooltip contentStyle={tooltipStyle.contentStyle}
              formatter={(v: any, n: any) => [Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="qty" name="Quantités vendues" stroke="#7c3aed" strokeWidth={2} fill="url(#anaQty)" />
            <Line type="monotone" dataKey="count" name="Opérations" stroke="#0e7490" strokeWidth={2} dot={false} />
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="purchases" name="Achats" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="expenses" name="Dépenses & salaires" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Line type="monotone" dataKey="revenue" name="Ventes" stroke="#003087" strokeWidth={2} dot={false} />
          </BarChart>
        )}
      </ChartBox>
    </div>
  );
}

// ─── Courbe d'UN produit ─────────────────────────────────────────────────────
function ProductChart({ points }: { points: ProductAnalytics['points'] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <ChartBox height={230}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="prodRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#003087" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#003087" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="revenue" name="Ventes" stroke="#003087" strokeWidth={2} fill="url(#prodRev)" />
          <Bar dataKey="cost" name="Coût" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line type="monotone" dataKey="gain" name="Gain" stroke="#0e9f6e" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ChartBox>
    </div>
  );
}

/** Fiche complète d'un produit : ses chiffres, sa courbe, son intervalle fort. */
export function ProductAnalyticsModal({ product, granularity, onClose }: {
  product: ProductAnalytics | null; granularity: Granularity; onClose: () => void;
}) {
  if (!product) return null;
  const best = product.points.reduce((m, p) => (p.revenue > m.revenue ? p : m), product.points[0]);
  const rows: [string, string][] = [
    ['Quantité vendue', `${product.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${product.unit ? ` ${product.unit}` : ''}`],
    ['Chiffre d\'affaires', money(product.revenue)],
    ['Coût des marchandises', money(product.cost)],
    ['Gain', money(product.gain)],
    ['Marge', `${product.marginPct.toFixed(1)} %`],
    ['Part du CA de l\'activité', `${product.share.toFixed(1)} %`],
    ['Opérations', String(product.operations)],
    ['Nature', PRODUCT_KIND_LABEL[product.kind]],
    ['Catégorie', product.category || '—'],
    ['Code-barres', product.code || '—'],
    ['Première vente', product.firstSale ? formatDate(product.firstSale) : '—'],
    ['Dernière vente', product.lastSale ? formatDate(product.lastSale) : '—'],
    ...(product.stockQty !== undefined
      ? ([['Reste en stock', `${product.stockQty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${product.unit ? ` ${product.unit}` : ''}`],
        ['Valeur du reste', money(product.stockValue || 0)]] as [string, string][])
      : []),
    [`Meilleur intervalle (${GRANULARITY_LABEL[granularity].toLowerCase()})`, best ? `${best.label} — ${money(best.revenue)}` : '—'],
  ];

  return (
    <Modal open onClose={onClose} icon={PackageSearch} size="2xl"
      title={product.name} subtitle={`${PRODUCT_KIND_LABEL[product.kind]} · analyse de la période`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">CA {money(product.revenue)}</span>
          <span className="text-amber-700">Coût {money(product.cost)}</span>
          <span className={product.gain >= 0 ? 'text-emerald-600' : 'text-red-600'}>Gain {money(product.gain)}</span>
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
      </>}>
      <div className="space-y-4">
        <ProductChart points={product.points} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
              <p className="font-bold text-slate-700 text-sm break-words">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Classements ─────────────────────────────────────────────────────────────
function RankList({ rows, tone, onPick, emptyText }: {
  rows: ProductAnalytics[]; tone: 'good' | 'bad'; onPick: (p: ProductAnalytics) => void; emptyText: string;
}) {
  if (!rows.length) return <div className="card-glass p-6 text-center text-sm text-slate-400">{emptyText}</div>;
  const max = Math.max(...rows.map(r => Math.abs(r.revenue)), 1);
  return (
    <div className="card-glass p-3 space-y-1.5">
      {rows.map((r, i) => (
        <button key={r.id} onClick={() => onPick(r)}
          className="w-full text-left rounded-xl px-3 py-2 hover:bg-slate-50 transition-colors group">
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
            <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
              {r.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{r.unit ? ` ${r.unit}` : ''} · gain {money(r.gain)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function DeadStockList({ rows }: { rows: DeadStockRow[] }) {
  if (!rows.length) {
    return <div className="card-glass p-6 text-center text-sm text-slate-400">Tout ce qui est en stock a été vendu au moins une fois ✅</div>;
  }
  const total = rows.reduce((s, r) => s + r.stockValue, 0);
  return (
    <>
      <Table head={<>
        <th className="table-head">Produit</th><th className="table-head">Catégorie</th>
        <th className="table-head text-right">En stock</th>
        <th className="table-head text-right">Immobilisé (achat)</th>
        <th className="table-head text-right">Valeur de vente</th>
      </>}>
        {rows.slice(0, 40).map(r => (
          <tr key={r.id}>
            <td className="table-cell">
              <div className="font-bold text-slate-700 flex items-center gap-1.5">
                {r.name}
                {r.raw && <Badge tone="warning">Matière 1ʳᵉ</Badge>}
              </div>
              {r.code && <div className="text-[11px] text-slate-400 font-mono">{r.code}</div>}
            </td>
            <td className="table-cell text-slate-400">{r.category || '—'}</td>
            <td className="table-cell tabular-nums text-right font-bold">
              {r.stockQty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{r.unit ? ` ${r.unit}` : ''}
            </td>
            <td className="table-cell tabular-nums text-right text-amber-700">{money(r.stockValue)}</td>
            <td className="table-cell tabular-nums text-right text-slate-500">{money(r.potentialValue)}</td>
          </tr>
        ))}
      </Table>
      <div className="card-glass px-5 py-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {rows.length} produit(s) en stock sans une seule vente sur la période{rows.length > 40 ? ' — 40 premiers affichés' : ''}.
        </span>
        <span className="font-black tabular-nums text-amber-700">{money(total)} immobilisés</span>
      </div>
    </>
  );
}

// ─── Vue principale ──────────────────────────────────────────────────────────
export default function AnalyticsView({ analytics: a, onGranularity }: {
  analytics: PartAnalytics;
  /** Fourni quand l'écran laisse changer le découpage du temps. */
  onGranularity?: (g: Granularity) => void;
}) {
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const [picked, setPicked] = useState<ProductAnalytics | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | ProductKind>('all');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState<'revenue' | 'gain' | 'qty' | 'margin'>('revenue');

  const kinds = useMemo(
    () => Array.from(new Set(a.products.map(p => p.kind))) as ProductKind[],
    [a.products]);

  const filtered = useMemo(() => {
    const rows = a.products.filter(p =>
      matchesSearch(q, p.name, p.code)
      && (kind === 'all' || p.kind === kind)
      && (cat === 'all' || (p.category || 'Sans catégorie') === cat));
    const key = sort === 'margin' ? 'marginPct' : sort === 'gain' ? 'gain' : sort === 'qty' ? 'qty' : 'revenue';
    return [...rows].sort((x, y) => (y as any)[key] - (x as any)[key]);
  }, [a.products, q, kind, cat, sort]);

  const pieData = a.categories.slice(0, 8).map((c, i) => ({ name: c.name, value: Math.max(0, c.revenue), fill: PALETTE[i % PALETTE.length] }));

  return (
    <div className="space-y-8">
      {/* ── Chiffres de tête ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} tone="green" label="Chiffre d'affaires" value={money(a.totals.sales)}
          sub={`${a.totals.operations} opération(s)`} />
        <Kpi icon={Layers} tone="amber" label="Coût des marchandises" value={money(a.totals.cost)}
          sub={`Marge ${money(a.totals.margin)}`} />
        <Kpi icon={CircleDollarSign} tone={a.totals.net >= 0 ? 'blue' : 'red'} label="Résultat de la période"
          value={money(a.totals.net)} sub="marge − dépenses & salaires" />
        <Kpi icon={ShoppingCart} tone="purple" label="Achats" value={money(a.totals.purchases)}
          sub={`Dépenses ${money(a.totals.expenses)}`} />
      </div>

      {/* ── Courbe principale ── */}
      <div className="space-y-3">
        <SectionTitle icon={BarChart3} title="Évolution sur la période"
          hint={`${GRANULARITY_LABEL[a.granularity]} · ${a.points.length} intervalle(s) · moyenne ${money(a.avgPerPoint)} par intervalle`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <TrendBadge pct={a.trendPct} />
              {onGranularity && (
                <Select value={a.granularity} onChange={e => onGranularity(e.target.value as Granularity)}
                  className="!w-auto !py-1.5 text-xs">
                  <option value="day">Par jour</option>
                  <option value="week">Par semaine</option>
                  <option value="month">Par mois</option>
                </Select>
              )}
            </div>
          } />
        <div className="tab-bar overflow-x-auto custom-scrollbar">
          {METRICS.map(m => (
            <button key={m.id} onClick={() => setMetric(m.id)}
              className={cn('tab-item', metric === m.id && 'tab-item-active')}>{m.label}</button>
          ))}
        </div>
        <MainChart a={a} metric={metric} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={Trophy} tone="green" label="Meilleur intervalle"
            value={a.bestPoint ? money(a.bestPoint.revenue) : '—'} sub={a.bestPoint?.label} />
          <Kpi icon={TrendingDown} tone="slate" label="Intervalle le plus faible"
            value={a.worstPoint ? money(a.worstPoint.revenue) : '—'} sub={a.worstPoint?.label} />
          <Kpi icon={Activity} tone="cyan" label="Tendance"
            value={`${a.trendPct >= 0 ? '+' : ''}${a.trendPct.toFixed(1)} %`}
            sub={`${money(a.firstHalf)} → ${money(a.secondHalf)}`} />
          <Kpi icon={Boxes} tone="amber" label="Produits vendus" value={String(a.totals.products)}
            sub={`${a.dead.length} en stock sans vente`} />
        </div>
      </div>

      {/* ── Ce qui se vend / ce qui ne se vend pas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <SectionTitle icon={Trophy} title="Ce qui se vend le mieux"
            hint="Classement par chiffre d'affaires — cliquez pour la courbe du produit" />
          <RankList rows={a.best} tone="good" onPick={setPicked} emptyText="Aucune vente sur la période." />
        </div>
        <div className="space-y-3">
          <SectionTitle icon={Snowflake} title="Ce qui se vend le moins"
            hint="Vendus au moins une fois, mais tout en bas du classement" />
          <RankList rows={a.worst} tone="bad" onPick={setPicked} emptyText="Aucune vente sur la période." />
        </div>
      </div>

      {/* ── Stock dormant ── */}
      <div className="space-y-3">
        <SectionTitle icon={Flame} title="Produits qui ne se vendent pas"
          hint="En stock aujourd'hui, aucune vente sur la période — de l'argent immobilisé" />
        <DeadStockList rows={a.dead} />
      </div>

      {/* ── Répartition par catégorie ── */}
      {a.categories.length > 0 && (
        <div className="space-y-3">
          <SectionTitle icon={Layers} title="Répartition par catégorie" hint="Part de chaque catégorie dans le chiffre d'affaires" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-glass p-4">
              <ChartBox height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ChartBox>
            </div>
            <Table head={<>
              <th className="table-head">Catégorie</th><th className="table-head text-right">Produits</th>
              <th className="table-head text-right">CA</th><th className="table-head text-right">Gain</th>
              <th className="table-head text-right">Part</th>
            </>}>
              {a.categories.map((c, i) => (
                <tr key={c.name}>
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-2 font-bold text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                      {c.name}
                    </span>
                  </td>
                  <td className="table-cell tabular-nums text-right text-slate-500">{c.products}</td>
                  <td className="table-cell tabular-nums text-right font-bold">{money(c.revenue)}</td>
                  <td className={cn('table-cell tabular-nums text-right', c.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(c.gain)}</td>
                  <td className="table-cell tabular-nums text-right text-slate-400">{c.share.toFixed(1)} %</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}

      {/* ── Productions ── */}
      {a.productions.length > 0 && (
        <ProductionSection rows={a.productions} />
      )}

      {/* ── Tableau détaillé, recherche par nom ou code-barres ── */}
      <div className="space-y-3">
        <SectionTitle icon={PackageSearch} title="Analyse produit par produit"
          hint="Recherchez par nom ou code-barres, filtrez, puis cliquez une ligne pour sa courbe" />
        <div className="card-glass p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} className="input-field pl-9"
              placeholder="Nom du produit ou code-barres…" />
          </div>
          <Select value={kind} onChange={e => setKind(e.target.value as any)} className="!w-auto min-w-[170px]">
            <option value="all">Toute nature</option>
            {kinds.map(k => <option key={k} value={k}>{PRODUCT_KIND_LABEL[k]}</option>)}
          </Select>
          <Select value={cat} onChange={e => setCat(e.target.value)} className="!w-auto min-w-[170px]">
            <option value="all">Toutes catégories</option>
            {a.categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </Select>
          <Select value={sort} onChange={e => setSort(e.target.value as any)} className="!w-auto min-w-[160px]">
            <option value="revenue">Trier par CA</option>
            <option value="gain">Trier par gain</option>
            <option value="qty">Trier par quantité</option>
            <option value="margin">Trier par marge %</option>
          </Select>
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} produit(s)</span>
        </div>

        {filtered.length === 0 ? (
          <div className="card-glass p-10 text-center text-sm text-slate-400">Aucun produit ne correspond à cette recherche.</div>
        ) : (
          <Table head={<>
            <th className="table-head">Produit</th><th className="table-head">Nature</th>
            <th className="table-head text-right">Quantité</th><th className="table-head text-right">CA</th>
            <th className="table-head text-right">Coût</th><th className="table-head text-right">Gain</th>
            <th className="table-head text-right">Marge</th><th className="table-head text-right">Part</th>
            <th className="table-head" />
          </>}>
            {filtered.map(p => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setPicked(p)}>
                <td className="table-cell">
                  <div className="font-bold text-slate-700">{p.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {p.code ? <span className="font-mono">{p.code}</span> : null}
                    {p.code && p.category ? ' · ' : ''}
                    {p.category || ''}
                  </div>
                </td>
                <td className="table-cell"><Badge tone={p.kind === 'production' ? 'warning' : p.kind === 'prestation' ? 'info' : 'neutral'}>{PRODUCT_KIND_LABEL[p.kind]}</Badge></td>
                <td className="table-cell tabular-nums text-right">
                  {p.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{p.unit ? ` ${p.unit}` : ''}
                </td>
                <td className="table-cell tabular-nums text-right font-bold text-blue-700">{money(p.revenue)}</td>
                <td className="table-cell tabular-nums text-right text-amber-700">{money(p.cost)}</td>
                <td className={cn('table-cell tabular-nums text-right font-black', p.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.gain)}</td>
                <td className="table-cell tabular-nums text-right text-slate-500">{p.marginPct.toFixed(1)} %</td>
                <td className="table-cell tabular-nums text-right text-slate-400">{p.share.toFixed(1)} %</td>
                <td className="table-cell text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <ProductAnalyticsModal product={picked} granularity={a.granularity} onClose={() => setPicked(null)} />
    </div>
  );
}

// ─── Productions (cafétéria) ─────────────────────────────────────────────────
function ProductionSection({ rows }: { rows: ProductionAnalytics[] }) {
  const [picked, setPicked] = useState<ProductionAnalytics | null>(null);
  const totals = rows.reduce((a, r) => ({
    produced: a.produced + r.produced, cost: a.cost + r.cost, value: a.value + r.value,
    loss: a.loss + r.lossValue, sold: a.sold + r.soldRevenue, gain: a.gain + r.soldGain,
  }), { produced: 0, cost: 0, value: 0, loss: 0, sold: 0, gain: 0 });

  const chartData = rows.slice(0, 10).map(r => ({
    name: r.name, produced: r.produced, cost: r.cost, sold: r.soldRevenue, gain: r.soldGain,
  }));

  return (
    <div className="space-y-3">
      <SectionTitle icon={Beaker} title="Analyse des produits fabriqués"
        hint="Ce qui a été produit, ce que ça a coûté, les pertes, et ce que la vente en a tiré" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Beaker} tone="purple" label="Fabriqué" value={totals.produced.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
          sub={`${rows.length} produit(s) fabriqué(s)`} />
        <Kpi icon={Layers} tone="amber" label="Coût de fabrication" value={money(totals.cost)} />
        <Kpi icon={TrendingUp} tone="green" label="Vendu (fabriqués)" value={money(totals.sold)}
          sub={`Gain ${money(totals.gain)}`} />
        <Kpi icon={Flame} tone="red" label="Pertes de production" value={money(totals.loss)} />
      </div>

      <div className="card-glass p-4">
        <ChartBox height={280}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} height={48} angle={-18} textAnchor="end" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={52} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="cost" name="Coût de fabrication" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="sold" name="Vendu" fill="#003087" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="gain" name="Gain" fill="#0e9f6e" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ChartBox>
      </div>

      <Table head={<>
        <th className="table-head">Produit fabriqué</th><th className="table-head text-right">Fabrications</th>
        <th className="table-head text-right">Quantité</th><th className="table-head text-right">Coût unitaire</th>
        <th className="table-head text-right">Coût total</th><th className="table-head text-right">Pertes</th>
        <th className="table-head text-right">Vendu</th><th className="table-head text-right">Gain</th>
        <th className="table-head text-right">Invendu</th><th className="table-head" />
      </>}>
        {rows.map(r => (
          <tr key={r.name} className="cursor-pointer hover:bg-slate-50" onClick={() => setPicked(r)}>
            <td className="table-cell font-bold text-slate-700">{r.name}</td>
            <td className="table-cell tabular-nums text-right text-slate-500">{r.runs}</td>
            <td className="table-cell tabular-nums text-right">{r.produced.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{r.unit ? ` ${r.unit}` : ''}</td>
            <td className="table-cell tabular-nums text-right text-slate-500">{money(r.costPerUnit)}</td>
            <td className="table-cell tabular-nums text-right text-amber-700">{money(r.cost)}</td>
            <td className={cn('table-cell tabular-nums text-right', r.lossValue > 0 ? 'text-red-600 font-bold' : 'text-slate-300')}>
              {r.lossValue > 0 ? money(r.lossValue) : '—'}
            </td>
            <td className="table-cell tabular-nums text-right font-bold text-blue-700">{money(r.soldRevenue)}</td>
            <td className={cn('table-cell tabular-nums text-right font-black', r.soldGain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(r.soldGain)}</td>
            <td className={cn('table-cell tabular-nums text-right', r.unsold > 0 ? 'text-amber-600' : 'text-slate-300')}>
              {r.unsold > 0 ? r.unsold.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '—'}
            </td>
            <td className="table-cell text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
          </tr>
        ))}
      </Table>

      <Modal open={!!picked} onClose={() => setPicked(null)} icon={Beaker} size="2xl"
        title={picked?.name || ''} subtitle="Produit fabriqué — analyse de la période">
        {picked && (
          <div className="space-y-4">
            <ProductChart points={picked.points} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {([
                ['Fabrications', String(picked.runs)],
                ['Quantité produite', `${picked.produced.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${picked.unit ? ` ${picked.unit}` : ''}`],
                ['Coût unitaire', money(picked.costPerUnit)],
                ['Coût total', money(picked.cost)],
                ['Valeur produite', money(picked.value)],
                ['Envoyé au comptoir', picked.sentToComptoir.toLocaleString('fr-FR', { maximumFractionDigits: 2 })],
                ['Pertes (quantité)', picked.lossQty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })],
                ['Pertes (coût)', money(picked.lossValue)],
                ['Vendu sur la période', money(picked.soldRevenue)],
                ['Gain des ventes', money(picked.soldGain)],
                ['Quantité vendue', picked.soldQty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })],
                ['Invendu (produit − vendu)', picked.unsold.toLocaleString('fr-FR', { maximumFractionDigits: 2 })],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
                  <p className="font-bold text-slate-700 text-sm">{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
