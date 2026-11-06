/**
 * ─── Rapports Carburant ─────────────────────────────────────────────────────────
 * L'écran s'ouvre sur le choix de la période (date de début, date de fin) et,
 * en option, d'un pompiste ; « Générer le rapport » calcule alors tout ce que
 * la partie Carburant a produit sur cette période (`lib/carburantReport`).
 *
 * Chaque carte est cliquable : elle déplie le détail ligne par ligne et la
 * formule qui a donné le chiffre.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useRef, useState } from "react";
import {
  FileBarChart, Calendar, Play, Users, User, Fuel, Droplets, ShoppingCart, Archive, Store, Banknote,
  CreditCard, Tag, UserCheck, Receipt, Package, AlertTriangle, TrendingUp, Printer, FileSpreadsheet,
  RotateCcw, X, ChevronRight, Scale, Target, Coins, Layers, Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { cn } from "@/src/lib/utils";
import { useAppState } from "../store/AppContext";
import { computeCarburantPeriodReport, CarburantPeriodReport, ReportLine, PompisteRow } from "../lib/carburantReport";
import { exportElementToPdf } from "../lib/pdf";

const iso = (d: Date) => d.toISOString().split("T")[0];
const money = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
const qty = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const fmtDate = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("fr-FR"); };

type CardKey = 'sales' | 'theoretical' | 'purchases' | 'armoire' | 'magasin' | 'cash' | 'tpe' | 'tag' | 'credit' | 'expense' | 'achat' | 'ecart' | 'invoices' | 'margin';

const TONES: Record<string, { bg: string; ic: string; ring: string }> = {
  blue:    { bg: "from-[#001f5c] to-[#003087]", ic: "text-[#FFB800]", ring: "hover:ring-[#003087]/30" },
  amber:   { bg: "from-amber-500 to-orange-500", ic: "text-white", ring: "hover:ring-amber-300" },
  emerald: { bg: "from-emerald-500 to-teal-600", ic: "text-white", ring: "hover:ring-emerald-300" },
  cyan:    { bg: "from-cyan-500 to-sky-600", ic: "text-white", ring: "hover:ring-cyan-300" },
  purple:  { bg: "from-purple-500 to-fuchsia-600", ic: "text-white", ring: "hover:ring-purple-300" },
  orange:  { bg: "from-orange-500 to-red-500", ic: "text-white", ring: "hover:ring-orange-300" },
  indigo:  { bg: "from-indigo-500 to-violet-600", ic: "text-white", ring: "hover:ring-indigo-300" },
  rose:    { bg: "from-rose-500 to-pink-600", ic: "text-white", ring: "hover:ring-rose-300" },
  slate:   { bg: "from-slate-600 to-slate-800", ic: "text-white", ring: "hover:ring-slate-300" },
  red:     { bg: "from-red-500 to-red-700", ic: "text-white", ring: "hover:ring-red-300" },
};

const Reports = () => {
  const app = useAppState();
  const { pompistes = [], brigadeChefs = [], settings } = app;
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [pompisteId, setPompisteId] = useState("");
  const [generated, setGenerated] = useState<{ from: string; to: string; pompisteId: string } | null>(null);
  const [tab, setTab] = useState<'overview' | 'pompistes' | 'brigades' | 'carburants'>('overview');
  const [open, setOpen] = useState<CardKey | null>(null);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const report: CarburantPeriodReport | null = useMemo(
    () => generated ? computeCarburantPeriodReport(app, generated.from, generated.to, generated.pompisteId || undefined) : null,
    [app, generated]);

  const workers = useMemo(() => [...pompistes.map(p => ({ id: p.id, name: p.name })), ...brigadeChefs.map(c => ({ id: c.id, name: `${c.name} (chef)` }))], [pompistes, brigadeChefs]);
  const pompisteName = (id?: string) => workers.find(w => w.id === id)?.name || "Tous les pompistes";

  const presets = [
    { l: "Aujourd'hui", f: () => [iso(today), iso(today)] },
    { l: "7 derniers jours", f: () => [iso(new Date(Date.now() - 6 * 864e5)), iso(today)] },
    { l: "Ce mois", f: () => [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)] },
    { l: "Mois dernier", f: () => [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))] },
    { l: "Cette année", f: () => [iso(new Date(today.getFullYear(), 0, 1)), iso(today)] },
  ];

  const generate = (pid = pompisteId) => { if (from > to) return; setGenerated({ from, to, pompisteId: pid }); setTab('overview'); };

  const exportExcel = async () => {
    if (!report) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const sheet = (rows: any[]) => XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet([
      ["Période", `${report.from} → ${report.to}`], ["Pompiste", pompisteName(report.pompisteId)],
      ["Litres vendus", report.liters], ["Ventes carburant", report.fuelSales], ["Produits armoires", report.armoireSales],
      ["Produits magasins", report.magasinSales], ["Total théorique", report.theoretical], ["Espèces", report.cash],
      ["TPE", report.tpe], ["TAG", report.tag], ["Crédit client", report.credit], ["Dépenses", report.expense],
      ["Achats produits", report.achat], ["Décalage", report.ecart], ["Achats carburant", report.purchases], ["Factures ventes", report.invoices],
    ].map(([k, v]) => ({ Indicateur: k, Valeur: v }))), "Synthèse");
    XLSX.utils.book_append_sheet(wb, sheet(report.byPompiste.map(r => ({ Pompiste: r.name, Brigades: r.brigades, Litres: r.liters, Carburant: r.fuelAmount, Produits: r.products, Théorique: r.theoretical, Espèces: r.cash, TPE: r.tpe, TAG: r.tag, Crédit: r.credit, Dépenses: r.expense, Achats: r.achat, Décalage: r.ecart }))), "Pompistes");
    XLSX.utils.book_append_sheet(wb, sheet(report.byBrigade.map(r => ({ Date: r.date, Poste: r.shift, Pompiste: r.name, Litres: r.liters, Carburant: r.fuelAmount, Produits: r.products, Théorique: r.theoretical, Espèces: r.cash, TPE: r.tpe, TAG: r.tag, Crédit: r.credit, Dépenses: r.expense, Achats: r.achat, Décalage: r.ecart }))), "Brigades");
    XLSX.writeFile(wb, `rapport-carburant-${report.from}_${report.to}.xlsx`);
  };
  const exportPdf = async () => {
    if (!printRef.current || !report) return;
    setExporting(true);
    try { await exportElementToPdf(printRef.current, `rapport-carburant-${report.from}_${report.to}.pdf`); } finally { setExporting(false); }
  };

  // ── Écran de lancement ─────────────────────────────────────────────────────
  if (!report) {
    return (
      <div className="space-y-6">
        <div className="rounded-[2rem] overflow-hidden shadow-xl border border-slate-100">
          <div className="p-6 sm:p-10 text-white relative" style={{ background: "linear-gradient(135deg, #001233 0%, #001f5c 50%, #003087 100%)" }}>
            <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-[#FFB800]/10 blur-2xl" />
            <div className="flex items-center gap-4 relative">
              <div className="w-14 h-14 rounded-2xl bg-[#FFB800] text-[#001233] flex items-center justify-center shadow-lg"><FileBarChart className="w-7 h-7" /></div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Rapports Carburant</h1>
                <p className="text-blue-200 font-bold text-sm">Choisissez la période et, si besoin, un pompiste — puis générez le rapport.</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 sm:p-10 space-y-6">
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button key={p.l} onClick={() => { const [f, t] = p.f(); setFrom(f); setTo(t); }}
                  className="px-4 py-2 rounded-full text-xs font-black bg-slate-100 text-slate-600 hover:bg-[#eef3fc] hover:text-[#002d87] transition-colors">{p.l}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1.5"><Calendar className="w-3.5 h-3.5" /> Date de début</span>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field h-14 text-base font-black text-[#001f5c]" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1.5"><Calendar className="w-3.5 h-3.5" /> Date de fin</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field h-14 text-base font-black text-[#001f5c]" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1.5"><Users className="w-3.5 h-3.5" /> Pompiste (optionnel)</span>
                <select value={pompisteId} onChange={e => setPompisteId(e.target.value)} className="input-field h-14 text-base font-black text-[#001f5c]">
                  <option value="">Tous les pompistes</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            </div>
            {from > to && <p className="text-sm font-bold text-red-600">La date de début doit précéder la date de fin.</p>}
            <button onClick={() => generate()} disabled={from > to}
              className="w-full h-16 rounded-2xl text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 shadow-xl transition-all hover:scale-[1.01] disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #001f5c, #003087)" }}>
              <Play className="w-5 h-5 text-[#FFB800]" /> Générer le rapport
            </button>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {[
                { i: Fuel, t: "Ventes & litres", d: "Par carburant, pompe et brigade" },
                { i: Users, t: "Par pompiste", d: "Théorique, espèces, justifications" },
                { i: CreditCard, t: "TPE, TAG, crédits", d: "Chaque mode de justification" },
                { i: Scale, t: "Décalages", d: "Manquants et excédents" },
              ].map(x => (
                <div key={x.t} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <x.i className="w-5 h-5 text-[#003087] mb-2" />
                  <p className="text-xs font-black text-slate-700">{x.t}</p>
                  <p className="text-[11px] font-bold text-slate-400">{x.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Rapport généré ─────────────────────────────────────────────────────────
  const r = report;
  const filtered = !!r.pompisteId;
  const cards: { key: CardKey; label: string; value: string; sub: string; icon: React.ElementType; tone: string; hide?: boolean }[] = [
    { key: 'sales', label: 'Ventes carburant', value: money(r.fuelSales), sub: `${qty(r.liters)} L · ${r.brigadeCount} brigade(s)`, icon: Fuel, tone: 'blue' },
    { key: 'theoretical', label: 'Total théorique', value: money(r.theoretical), sub: 'Carburant + produits à rendre', icon: Target, tone: 'indigo' },
    { key: 'purchases', label: 'Achats carburant', value: money(r.purchases), sub: `${qty(r.purchaseLiters)} L reçus${filtered ? ' · station' : ''}`, icon: ShoppingCart, tone: 'slate' },
    { key: 'armoire', label: 'Produits armoires', value: money(r.armoireSales), sub: `${r.details.armoire.length} vente(s)`, icon: Archive, tone: 'purple' },
    { key: 'magasin', label: 'Produits magasins', value: money(r.magasinSales), sub: `${r.details.magasin.length} vente(s)`, icon: Store, tone: 'emerald' },
    { key: 'cash', label: 'Espèces remises', value: money(r.cash), sub: `${r.details.cash.length} remise(s)`, icon: Banknote, tone: 'emerald' },
    { key: 'tpe', label: 'TPE', value: money(r.tpe), sub: `${r.details.tpe.length} justification(s)`, icon: CreditCard, tone: 'cyan' },
    { key: 'tag', label: 'TAG / Bons', value: money(r.tag), sub: `${r.details.tag.length} justification(s)`, icon: Tag, tone: 'purple' },
    { key: 'credit', label: 'Crédit client', value: money(r.credit), sub: `${r.details.credit.length} bon(s)`, icon: UserCheck, tone: 'orange' },
    { key: 'expense', label: 'Dépenses brigade', value: money(r.expense), sub: `${r.details.expense.length} dépense(s)`, icon: Receipt, tone: 'amber' },
    { key: 'achat', label: 'Achats produits', value: money(r.achat), sub: `${r.details.achat.length} achat(s)`, icon: Package, tone: 'indigo' },
    { key: 'ecart', label: 'Décalage net', value: money(r.ecart), sub: `Manquants ${money(r.shortages)} · Excédents ${money(r.surpluses)}`, icon: AlertTriangle, tone: Math.abs(r.ecart) < 1 ? 'emerald' : 'red' },
    { key: 'invoices', label: 'Factures de vente', value: money(r.invoices), sub: `Payé ${money(r.invoicesPaid)} · Reste ${money(r.invoicesRest)}`, icon: FileBarChart, tone: 'rose', hide: filtered },
    { key: 'margin', label: 'Marge brute carburant', value: money(r.fuelMargin), sub: `Coût ${money(r.fuelCost)}`, icon: TrendingUp, tone: 'emerald' },
  ];
  const justTotal = r.tpe + r.tag + r.credit + r.expense + r.achat;
  const mix = [
    { l: 'Espèces', v: r.cash, c: 'bg-emerald-500' }, { l: 'TPE', v: r.tpe, c: 'bg-cyan-500' }, { l: 'TAG', v: r.tag, c: 'bg-purple-500' },
    { l: 'Crédit', v: r.credit, c: 'bg-orange-500' }, { l: 'Dépenses', v: r.expense, c: 'bg-amber-400' }, { l: 'Achats', v: r.achat, c: 'bg-indigo-500' },
    { l: 'Manquant', v: Math.max(0, r.ecart), c: 'bg-red-500' },
  ];
  const mixTotal = mix.reduce((s, m) => s + m.v, 0) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[2rem] overflow-hidden shadow-xl text-white" style={{ background: "linear-gradient(135deg, #001233 0%, #001f5c 50%, #003087 100%)" }}>
        <div className="p-5 sm:p-7 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#FFB800] text-[#001233] flex items-center justify-center"><FileBarChart className="w-6 h-6" /></div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black">Rapport Carburant</h1>
              <p className="text-blue-200 text-sm font-bold">{fmtDate(r.from)} → {fmtDate(r.to)} · {pompisteName(r.pompisteId)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={generated!.pompisteId} onChange={e => { setPompisteId(e.target.value); setGenerated({ ...generated!, pompisteId: e.target.value }); }}
              className="h-10 px-3 rounded-xl bg-white/10 border border-white/20 text-sm font-black text-white [&>option]:text-slate-800">
              <option value="">Tous les pompistes</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button onClick={exportPdf} disabled={exporting} className="h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-black uppercase flex items-center gap-2"><Printer className="w-4 h-4" /> {exporting ? 'PDF…' : 'PDF'}</button>
            <button onClick={exportExcel} className="h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-black uppercase flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
            <button onClick={() => setGenerated(null)} className="h-10 px-4 rounded-xl bg-[#FFB800] text-[#001233] text-xs font-black uppercase flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Nouveau rapport</button>
          </div>
        </div>
        <div className="px-5 sm:px-7 pb-5 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['Litres vendus', `${qty(r.liters)} L`], ['Chiffre carburant', money(r.fuelSales)],
            ['Encaissé + justifié', money(r.cash + justTotal)], ['Décalage', money(r.ecart)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white/10 border border-white/10 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">{l}</p>
              <p className="font-black tabular-nums text-lg text-white">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl bg-white border border-slate-200 overflow-x-auto">
        {([['overview', 'Vue d\'ensemble', Layers], ['pompistes', 'Par pompiste', Users], ['brigades', 'Par brigade', Calendar], ['carburants', 'Carburants', Droplets]] as const).map(([id, l, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex-1 min-w-[140px] flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-wide transition-all',
              tab === id ? 'bg-gradient-to-r from-[#001f5c] to-[#003087] text-white shadow' : 'text-slate-500 hover:bg-slate-50')}>
            <Icon className="w-4 h-4" /> {l}
          </button>
        ))}
      </div>

      <div ref={printRef} className="space-y-6">
        {tab === 'overview' && (<>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cards.filter(c => !c.hide).map(c => {
              const t = TONES[c.tone];
              return (
                <button key={c.key} onClick={() => setOpen(c.key)}
                  className={cn('group text-left rounded-2xl bg-white border border-slate-200 p-5 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all ring-2 ring-transparent', t.ring)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{c.label}</p>
                      <p className="text-xl font-black text-[#001f5c] tabular-nums mt-1 truncate">{c.value}</p>
                    </div>
                    <div className={cn('w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow', t.bg)}><c.icon className={cn('w-5 h-5', t.ic)} /></div>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-[11px] font-bold text-slate-400 truncate">{c.sub}</p>
                    <span className="text-[10px] font-black text-[#003087] opacity-0 group-hover:opacity-100 flex items-center">Détails <ChevronRight className="w-3 h-3" /></span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 rounded-2xl bg-white border border-slate-200 p-5">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-1">Ventes carburant par jour</p>
              <p className="text-[11px] font-bold text-slate-400 mb-4">Montant des pistolets (DA)</p>
              {r.byDay.length === 0 ? <Empty /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={r.byDay} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#eef2f7" />
                      <XAxis dataKey="day" tickFormatter={d => fmtDate(d).slice(0, 5)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                      <Tooltip cursor={{ fill: '#eef3fc' }} formatter={(v: any) => [money(Number(v)), 'Ventes']} labelFormatter={d => fmtDate(String(d))} />
                      <Bar dataKey="amount" fill="#003087" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Comment le théorique a été rendu</p>
              <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-slate-100">
                {mix.filter(m => m.v > 0).map(m => <div key={m.l} className={m.c} style={{ width: `${(m.v / mixTotal) * 100}%` }} title={`${m.l} : ${money(m.v)}`} />)}
              </div>
              <div className="space-y-1.5">
                {mix.map(m => (
                  <div key={m.l} className="flex items-center justify-between text-xs font-bold">
                    <span className="flex items-center gap-2 text-slate-600"><span className={cn('w-2.5 h-2.5 rounded-sm', m.c)} />{m.l}</span>
                    <span className="tabular-nums text-slate-800">{money(m.v)} <span className="text-slate-400">· {((m.v / mixTotal) * 100).toFixed(1)}%</span></span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-slate-100 text-[11px] font-bold text-slate-500 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Théorique {money(r.theoretical)} = espèces + justifications + décalage.
              </div>
            </div>
          </div>

          <PompisteTable rows={r.byPompiste} onPick={id => { setPompisteId(id); setGenerated({ ...generated!, pompisteId: id }); }} />
        </>)}

        {tab === 'pompistes' && (
          <div className="space-y-4">
            {r.byPompiste.length === 0 ? <Empty /> : r.byPompiste.map(p => (
              <div key={p.pompisteId} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 bg-gradient-to-r from-[#eef3fc] to-white flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center font-black text-lg">{p.name[0]}</div>
                    <div><p className="font-black text-[#001f5c]">{p.name}</p><p className="text-[11px] font-bold text-slate-400">{p.brigades} brigade(s) · {qty(p.liters)} L</p></div>
                  </div>
                  <button onClick={() => { setPompisteId(p.pompisteId); setGenerated({ ...generated!, pompisteId: p.pompisteId }); setTab('overview'); }}
                    className="px-3 py-2 rounded-xl bg-[#003087] text-white text-[11px] font-black uppercase flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Rapport de ce pompiste</button>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                  {[
                    ['Carburant', p.fuelAmount, 'text-[#002d87]'], ['Produits', p.products, 'text-purple-700'], ['Théorique', p.theoretical, 'text-indigo-700'],
                    ['Espèces', p.cash, 'text-emerald-700'], ['TPE', p.tpe, 'text-cyan-700'], ['TAG', p.tag, 'text-purple-700'],
                    ['Crédit + autres', p.credit + p.expense + p.achat, 'text-orange-700'], ['Décalage', p.ecart, Math.abs(p.ecart) < 1 ? 'text-emerald-700' : 'text-red-600'],
                  ].map(([l, v, c]) => (
                    <div key={l as string} className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{l}</p>
                      <p className={cn('text-sm font-black tabular-nums', c as string)}>{money(v as number)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'brigades' && (
          <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#001f5c] text-white text-[10px] uppercase font-black">
                <tr>{['Date', 'Poste', 'Pompiste', 'Litres', 'Carburant', 'Produits', 'Théorique', 'Espèces', 'TPE', 'TAG', 'Crédit', 'Dép.+Achats', 'Décalage'].map((h, i) =>
                  <th key={h} className={cn('px-3 py-2.5', i < 3 ? 'text-left' : 'text-right')}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {r.byBrigade.map((b, i) => (
                  <tr key={`${b.brigadeId}-${b.pompisteId}`} className={cn('border-b border-slate-100 font-bold text-slate-700', i % 2 && 'bg-slate-50/60')}>
                    <td className="px-3 py-2">{fmtDate(b.date)}</td><td className="px-3 py-2">{b.shift}</td><td className="px-3 py-2 font-black">{b.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(b.liters)}</td>
                    {[b.fuelAmount, b.products, b.theoretical, b.cash, b.tpe, b.tag, b.credit, b.expense + b.achat].map((v, k) => <td key={k} className="px-3 py-2 text-right tabular-nums">{qty(v)}</td>)}
                    <td className={cn('px-3 py-2 text-right tabular-nums font-black', Math.abs(b.ecart) < 1 ? 'text-emerald-600' : 'text-red-600')}>{qty(b.ecart)}</td>
                  </tr>
                ))}
                {r.byBrigade.length === 0 && <tr><td colSpan={13}><Empty /></td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'carburants' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {r.byFuel.length === 0 ? <Empty /> : r.byFuel.map(f => (
              <div key={f.fuelType} className="rounded-2xl bg-white border border-slate-200 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center"><Fuel className="w-5 h-5" /></div>
                  <div><p className="font-black text-[#001f5c]">{f.fuelType}</p><p className="text-[11px] font-bold text-slate-400">{qty(f.liters)} L vendus</p></div>
                </div>
                <div className="space-y-1.5 text-xs font-bold">
                  <Row l="Chiffre d'affaires" v={money(f.amount)} />
                  <Row l="Prix moyen / L" v={money(f.liters ? f.amount / f.liters : 0)} />
                  <Row l={`Coût (${money(f.buyPrice)} / L)`} v={money(f.cost)} />
                  <Row l="Marge brute" v={money(f.margin)} strong />
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#003087]" style={{ width: `${r.fuelSales ? (f.amount / r.fuelSales) * 100 : 0}%` }} /></div>
                <p className="text-[10px] font-bold text-slate-400 mt-1">{r.fuelSales ? ((f.amount / r.fuelSales) * 100).toFixed(1) : 0}% des ventes</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {open && <DetailModal k={open} r={r} onClose={() => setOpen(null)} label={cards.find(c => c.key === open)?.label || ''} station={settings?.name} />}
      </AnimatePresence>
    </div>
  );
};

// ─── Explications des calculs ────────────────────────────────────────────────
const FORMULAS: Record<CardKey, (r: CarburantPeriodReport) => { formula: string; parts?: [string, number][] }> = {
  sales: r => ({ formula: 'Σ (index fin − index départ) × prix du carburant, pour chaque pistolet de chaque brigade de la période.', parts: r.byFuel.map(f => [`${f.fuelType} — ${qty(f.liters)} L`, f.amount]) }),
  theoretical: r => ({ formula: 'Ce que chaque pompiste doit rendre = ventes carburant + produits vendus (armoires et magasins).', parts: [['Ventes carburant', r.fuelSales], ['Produits armoires', r.armoireSales], ['Produits magasins', r.magasinSales]] }),
  purchases: () => ({ formula: 'Somme des factures d\'achat carburant (Achats Carburant) datées dans la période — TVA et taxes comprises.' }),
  armoire: () => ({ formula: 'Somme des ventes de produits depuis les armoires saisies dans les brigades (quantité × prix).' }),
  magasin: () => ({ formula: 'Somme des ventes de produits prélevés directement dans un magasin pendant les brigades.' }),
  cash: () => ({ formula: 'Espèces remises par chaque pompiste à la clôture (versements compris) — elles alimentent la caisse Carburant.' }),
  tpe: () => ({ formula: 'Somme des justifications TPE (montant global ou opérations détaillées) — encaissées sur le compte bancaire du terminal.' }),
  tag: () => ({ formula: 'Somme des justifications TAG / bons — encaissées sur le compte bancaire choisi.' }),
  credit: () => ({ formula: 'Bons clients pris à crédit ou sur avance — ils deviennent une créance du client.' }),
  expense: () => ({ formula: 'Dépenses payées sur les espèces de la brigade — reportées dans l\'écran Dépenses.' }),
  achat: () => ({ formula: 'Marchandise achetée par le pompiste sur la caisse de la brigade et rangée en armoire.' }),
  ecart: r => ({ formula: 'Décalage = théorique − espèces − (TPE + TAG + crédit + dépenses + achats). Positif = manquant, négatif = excédent.', parts: [['Théorique', r.theoretical], ['− Espèces', -r.cash], ['− TPE', -r.tpe], ['− TAG', -r.tag], ['− Crédit client', -r.credit], ['− Dépenses', -r.expense], ['− Achats produits', -r.achat], ['= Décalage', r.ecart]] }),
  invoices: r => ({ formula: 'Factures de l\'écran Ventes Carburant (TVA et taxes comprises).', parts: [['Total facturé', r.invoices], ['Encaissé', r.invoicesPaid], ['Reste dû', r.invoicesRest]] }),
  margin: r => ({ formula: 'Marge brute = ventes carburant − litres vendus × prix d\'achat (Paramètres).', parts: [...r.byFuel.map(f => [`${f.fuelType} : ${money(f.amount)} − ${qty(f.liters)} L × ${money(f.buyPrice)}`, f.margin] as [string, number]), ['Total', r.fuelMargin]] }),
};

function DetailModal({ k, r, onClose, label }: { k: CardKey; r: CarburantPeriodReport; onClose: () => void; label: string; station?: string }) {
  const lines: ReportLine[] = k === 'margin' ? [] : (r.details[k] || []);
  const f = FORMULAS[k](r);
  const [q, setQ] = useState('');
  const shown = lines.filter(l => !q || `${l.label} ${l.sub} ${l.pompiste}`.toLowerCase().includes(q.toLowerCase()));
  const total = shown.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="modal-shell z-[70]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="relative z-10 bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl flex flex-col max-h-[var(--modal-max-h)] overflow-hidden">
        <div className="px-6 py-5 text-white flex items-center justify-between border-b-2 border-[#FFB800]/60" style={{ background: "linear-gradient(120deg, #001233, #003087)" }}>
          <div>
            <h3 className="font-black uppercase tracking-widest text-sm">{label}</h3>
            <p className="text-blue-200 text-xs font-bold">{fmtDate(r.from)} → {fmtDate(r.to)} · {lines.length} ligne(s)</p>
          </div>
          <button onClick={onClose} className="modal-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="rounded-2xl bg-[#eef3fc] border border-[#003087]/15 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#003087] mb-1 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" /> Comment ce chiffre est calculé</p>
            <p className="text-sm font-bold text-slate-700">{f.formula}</p>
            {f.parts && (
              <div className="mt-3 space-y-1">
                {f.parts.map(([l, v]) => (
                  <div key={l} className={cn('flex justify-between text-xs font-bold', l.startsWith('=') || l === 'Total' ? 'pt-1 border-t border-[#003087]/20 font-black text-[#001f5c]' : 'text-slate-600')}>
                    <span>{l}</span><span className="tabular-nums">{money(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {k !== 'margin' && (<>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer les lignes…" className="input-field h-11" />
            {shown.length === 0 ? <Empty /> : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black">
                    <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Détail</th><th className="px-3 py-2 text-left">Pompiste</th><th className="px-3 py-2 text-right">Qté</th><th className="px-3 py-2 text-right">Montant</th></tr>
                  </thead>
                  <tbody>
                    {shown.map(l => (
                      <tr key={l.id} className="border-t border-slate-100 font-bold text-slate-700">
                        <td className="px-3 py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="px-3 py-2"><span className="font-black text-slate-800">{l.label}</span>{l.sub && <span className="block text-[10px] text-slate-400">{l.sub}</span>}</td>
                        <td className="px-3 py-2">{l.pompiste || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.qty !== undefined ? `${qty(l.qty)} ${l.unit || ''}` : '—'}</td>
                        <td className={cn('px-3 py-2 text-right tabular-nums font-black', l.amount < 0 ? 'text-emerald-600' : 'text-[#001f5c]')}>{money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-[#001f5c] text-white font-black"><td className="px-3 py-2.5" colSpan={4}>Total ({shown.length})</td><td className="px-3 py-2.5 text-right tabular-nums text-[#FFB800]">{money(total)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </>)}
        </div>
      </motion.div>
    </div>
  );
}

function PompisteTable({ rows, onPick }: { rows: PompisteRow[]; onPick: (id: string) => void }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Synthèse par pompiste</p>
        <p className="text-[11px] font-bold text-slate-400">Cliquez un pompiste pour filtrer le rapport</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#001f5c] text-white text-[10px] uppercase font-black">
            <tr>{['Pompiste', 'Brigades', 'Litres', 'Théorique', 'Espèces', 'TPE', 'TAG', 'Autres justif.', 'Décalage'].map((h, i) => <th key={h} className={cn('px-3 py-2.5', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.pompisteId} onClick={() => onPick(p.pompisteId)} className={cn('border-b border-slate-100 font-bold text-slate-700 cursor-pointer hover:bg-[#eef3fc]', i % 2 && 'bg-slate-50/60')}>
                <td className="px-3 py-2 font-black text-[#001f5c]">{p.name}</td>
                <td className="px-3 py-2 text-right">{p.brigades}</td>
                <td className="px-3 py-2 text-right tabular-nums">{qty(p.liters)}</td>
                {[p.theoretical, p.cash, p.tpe, p.tag, p.credit + p.expense + p.achat].map((v, k) => <td key={k} className="px-3 py-2 text-right tabular-nums">{qty(v)}</td>)}
                <td className={cn('px-3 py-2 text-right tabular-nums font-black', Math.abs(p.ecart) < 1 ? 'text-emerald-600' : 'text-red-600')}>{qty(p.ecart)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}><Empty /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Row = ({ l, v, strong }: { l: string; v: string; strong?: boolean }) => (
  <div className={cn('flex justify-between', strong ? 'pt-1.5 border-t border-slate-100 font-black text-[#001f5c]' : 'text-slate-600')}><span>{l}</span><span className="tabular-nums">{v}</span></div>
);
const Empty = () => <p className="text-center text-slate-400 font-bold text-sm py-10">Aucune donnée pour cette période</p>;

export default Reports;
