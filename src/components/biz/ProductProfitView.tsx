/**
 * ─── Bénéfices par produit ─────────────────────────────────────────────────────
 * La question la plus simple et la plus utile : « qu'est-ce que CE produit m'a
 * rapporté sur la période ? » — recherche par nom ou par code-barres, filtres
 * par nature, par catégorie et par rentabilité, tri sur n'importe quelle colonne.
 *
 * Le bénéfice affiché est le VRAI gain : montant facturé moins coût de revient de
 * la quantité sortie. Un produit vendu 30 DA qui a coûté 12 DA rapporte 18 DA —
 * jamais 30.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Search, TrendingUp, TrendingDown, CircleDollarSign, Layers, Percent, ArrowUpDown,
  Boxes, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { cn, matchesSearch } from '@/src/lib/utils';
import { money, Table, Badge, Select } from '@/src/components/biz/Kit';
import { PartAnalytics, ProductAnalytics, PRODUCT_KIND_LABEL, ProductKind } from '@/src/lib/bizAnalytics';
import { ProductAnalyticsModal } from '@/src/components/biz/AnalyticsView';

type SortKey = 'revenue' | 'gain' | 'qty' | 'marginPct' | 'cost' | 'name';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'name', label: 'Produit', align: 'left' },
  { key: 'qty', label: 'Quantité vendue', align: 'right' },
  { key: 'cost', label: 'Coût de revient', align: 'right' },
  { key: 'revenue', label: 'Chiffre d\'affaires', align: 'right' },
  { key: 'gain', label: 'Bénéfice', align: 'right' },
  { key: 'marginPct', label: 'Marge', align: 'right' },
];

function Kpi({ icon: Icon, label, value, sub, tone }: {
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

export default function ProductProfitView({ analytics: a }: { analytics: PartAnalytics }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | ProductKind>('all');
  const [cat, setCat] = useState('all');
  const [profit, setProfit] = useState<'all' | 'positive' | 'negative'>('all');
  const [sort, setSort] = useState<SortKey>('gain');
  const [desc, setDesc] = useState(true);
  const [picked, setPicked] = useState<ProductAnalytics | null>(null);

  const kinds = useMemo(() => Array.from(new Set(a.products.map(p => p.kind))) as ProductKind[], [a.products]);

  const rows = useMemo(() => {
    const filtered = a.products.filter(p =>
      matchesSearch(q, p.name, p.code)
      && (kind === 'all' || p.kind === kind)
      && (cat === 'all' || (p.category || 'Sans catégorie') === cat)
      && (profit === 'all' || (profit === 'positive' ? p.gain > 0 : p.gain <= 0)));
    return [...filtered].sort((x, y) => {
      const va = sort === 'name' ? x.name : (x as any)[sort];
      const vb = sort === 'name' ? y.name : (y as any)[sort];
      const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return desc ? -cmp : cmp;
    });
  }, [a.products, q, kind, cat, profit, sort, desc]);

  const totals = useMemo(() => rows.reduce((s, p) => ({
    qty: s.qty + p.qty, revenue: s.revenue + p.revenue, cost: s.cost + p.cost, gain: s.gain + p.gain,
  }), { qty: 0, revenue: 0, cost: 0, gain: 0 }), [rows]);

  const best = a.products.length ? a.products.reduce((m, p) => (p.gain > m.gain ? p : m), a.products[0]) : null;
  const losing = a.products.filter(p => p.gain < 0);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDesc(!desc);
    else { setSort(key); setDesc(key !== 'name'); }
  };

  return (
    <div className="space-y-6">
      {/* ── Les totaux de la période ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} tone="blue" label="Chiffre d'affaires" value={money(a.totals.sales)}
          sub={`${a.totals.products} produit(s) vendu(s)`} />
        <Kpi icon={Layers} tone="amber" label="Coût de revient" value={money(a.totals.cost)}
          sub="ce que la marchandise vendue a coûté" />
        <Kpi icon={CircleDollarSign} tone={a.totals.margin >= 0 ? 'green' : 'red'} label="Bénéfice sur les ventes"
          value={money(a.totals.margin)}
          sub={a.totals.sales > 0 ? `Marge ${(a.totals.margin / a.totals.sales * 100).toFixed(1)} %` : undefined} />
        <Kpi icon={Boxes} tone="purple" label="Produit le plus rentable"
          value={best ? money(best.gain) : '—'} sub={best?.name} />
      </div>

      {losing.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-black text-red-700">
              {losing.length} produit(s) vendus à perte ou sans marge
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {losing.slice(0, 6).map(p => p.name).join(', ')}{losing.length > 6 ? '…' : ''} — leur prix de vente ne
              couvre pas leur coût de revient.
            </p>
          </div>
          <button className="btn-secondary !py-2 !px-3 text-xs shrink-0" onClick={() => { setProfit('negative'); setSort('gain'); setDesc(false); }}>
            Les afficher
          </button>
        </div>
      )}

      {/* ── Recherche & filtres ── */}
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
        <Select value={profit} onChange={e => setProfit(e.target.value as any)} className="!w-auto min-w-[160px]">
          <option value="all">Tous les produits</option>
          <option value="positive">Bénéficiaires</option>
          <option value="negative">Sans marge ou à perte</option>
        </Select>
        <span className="text-xs text-slate-400 ml-auto">{rows.length} produit(s)</span>
      </div>

      {/* ── Le tableau ── */}
      {rows.length === 0 ? (
        <div className="card-glass p-10 text-center text-sm text-slate-400">
          Aucun produit ne correspond à cette recherche sur la période.
        </div>
      ) : (
        <Table head={<>
          {COLUMNS.map(c => (
            <th key={c.key} className={cn('table-head cursor-pointer select-none', c.align === 'right' && 'text-right')}
              onClick={() => toggleSort(c.key)}>
              <span className="inline-flex items-center gap-1">
                {c.label}
                <ArrowUpDown className={cn('w-3 h-3', sort === c.key ? 'text-[#003087]' : 'text-slate-300')} />
              </span>
            </th>
          ))}
          <th className="table-head text-right">Part du CA</th>
          <th className="table-head" />
        </>}>
          {rows.map(p => (
            <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setPicked(p)}>
              <td className="table-cell">
                <div className="font-bold text-slate-700 flex items-center gap-2">
                  {p.name}
                  <Badge tone={p.kind === 'production' ? 'warning' : p.kind === 'prestation' ? 'info' : 'neutral'}>
                    {PRODUCT_KIND_LABEL[p.kind]}
                  </Badge>
                </div>
                <div className="text-[11px] text-slate-400">
                  {p.code ? <span className="font-mono">{p.code}</span> : null}
                  {p.code && p.category ? ' · ' : ''}{p.category || ''}
                  {p.stockQty !== undefined ? ` · reste ${p.stockQty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${p.unit ? ` ${p.unit}` : ''}` : ''}
                </div>
              </td>
              <td className="table-cell tabular-nums text-right">
                {p.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{p.unit ? ` ${p.unit}` : ''}
                <div className="text-[10px] text-slate-400">{p.operations} opération(s)</div>
              </td>
              <td className="table-cell tabular-nums text-right text-amber-700">{money(p.cost)}</td>
              <td className="table-cell tabular-nums text-right font-bold text-blue-700">{money(p.revenue)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {money(p.gain)}
              </td>
              <td className="table-cell tabular-nums text-right">
                <span className={cn('inline-flex items-center gap-1 font-bold',
                  p.marginPct >= 20 ? 'text-emerald-600' : p.marginPct > 0 ? 'text-amber-600' : 'text-red-600')}>
                  {p.marginPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {p.marginPct.toFixed(1)} %
                </span>
              </td>
              <td className="table-cell tabular-nums text-right text-slate-400">{p.share.toFixed(1)} %</td>
              <td className="table-cell text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL AFFICHÉ</td>
            <td className="table-cell tabular-nums text-right font-black">
              {totals.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            </td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(totals.cost)}</td>
            <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(totals.revenue)}</td>
            <td className={cn('table-cell tabular-nums text-right font-black', totals.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {money(totals.gain)}
            </td>
            <td className="table-cell tabular-nums text-right font-black text-slate-500">
              {totals.revenue !== 0 ? `${(totals.gain / totals.revenue * 100).toFixed(1)} %` : '—'}
            </td>
            <td className="table-cell" colSpan={2} />
          </tr>
        </Table>
      )}

      <p className="text-[11px] text-slate-400 italic flex items-start gap-1.5">
        <Percent className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Cliquez une ligne pour ouvrir la courbe du produit sur la période. Les prestations (main-d'œuvre) sont
        de la marge pure : elles n'ont pas de coût de revient. Les ventes annulées par un retour ou un échange
        sont exclues de ces chiffres.
      </p>

      <ProductAnalyticsModal product={picked} granularity={a.granularity} onClose={() => setPicked(null)} />
    </div>
  );
}
