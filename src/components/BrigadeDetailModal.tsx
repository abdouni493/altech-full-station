import React, { useState, useMemo } from "react";
import {
  X, Clock, Calendar, Users, Printer, TrendingUp, Droplets, Zap,
  User, DollarSign, ShoppingBag, Activity, ChevronRight, CheckCircle, Wrench, Database
} from "lucide-react";
import { JustifOpsList } from "./brigade/JustifOperationsEditor";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import {
  useAppState, Brigade, Pump, Tank, Pompiste, BrigadeChef, PumpNozzle, Track, ShopSale, StationSettings, BrigadeAccounting, Client, nozzleTankId
} from "../store/AppContext";
import BrigadeArmoireMovements, { hasArmoireMoves } from './armoires/BrigadeArmoireMovements';
import {
  brigadeNozzleRows, brigadeTankRows, brigadePompisteGroups, brigadeTotals, justifiedByPompiste, toNum,
} from "../lib/brigadeCalc";

interface Props {
  brigade: Brigade;
  pumps: Pump[];
  tanks: Tank[];
  pompistes: Pompiste[];
  brigadeChefs: BrigadeChef[];
  pumpNozzles: PumpNozzle[];
  tracks: Track[];
  shopSales: ShopSale[];
  settings: StationSettings;
  accounting?: BrigadeAccounting;
  clients: Client[];
  initialSection?: string;
  onClose: () => void;
}

const SECTIONS = [
  { id: 'info',         label: 'Informations',     icon: Calendar },
  { id: 'cuves',        label: 'Cuves',             icon: Droplets },
  { id: 'pistolets',    label: 'Pistolets',         icon: Zap },
  { id: 'pompistes',    label: 'Pompistes',         icon: Users },
  { id: 'comptabilite', label: 'Comptabilité',      icon: DollarSign },
  { id: 'ventes',       label: 'Ventes Magasin',    icon: ShoppingBag },
  { id: 'historique',   label: 'Historique',        icon: Activity },
];

const BrigadeDetailModal: React.FC<Props> = ({
  brigade, pumps, tanks, pompistes, brigadeChefs, pumpNozzles, tracks,
  shopSales, settings, accounting: initialAccounting, clients, initialSection, onClose
}) => {
  const { brigadeAccountings, bankAccounts = [], armoires = [] } = useAppState();
  const [activeSection, setActiveSection] = useState(initialSection || 'info');
  const chef = brigadeChefs.find(c => c.id === brigade.chefId);
  const accounting = initialAccounting || brigadeAccountings.find(a => a.brigadeId === brigade.id);
  // Tout le calcul vient de `lib/brigadeCalc` : prix au carburant de la cuve DU
  // pistolet, regroupement par pompiste (les pistes n'existent plus).
  const calcCtx = useMemo(
    () => ({ pumps, tanks, pumpNozzles, pompistes, settings }),
    [pumps, tanks, pumpNozzles, pompistes, settings]);

  const nozzleData = useMemo(
    () => brigadeNozzleRows(brigade, calcCtx).map(r => ({ ...r, revenue: r.amount })),
    [brigade, calcCtx]);

  const tankData = useMemo(
    () => brigadeTankRows(brigade, calcCtx, nozzleData), [brigade, calcCtx, nozzleData]);

  const activeNozzles = nozzleData;

  const justifTotals = useMemo(
    () => justifiedByPompiste(accounting?.justifications), [accounting]);
  const pompisteGroups = useMemo(
    () => brigadePompisteGroups(brigade, calcCtx, nozzleData, justifTotals),
    [brigade, calcCtx, nozzleData, justifTotals]);
  const totals = useMemo(
    () => brigadeTotals(nozzleData, pompisteGroups), [nozzleData, pompisteGroups]);

  const accountingRecord = useMemo<BrigadeAccounting | undefined>(() => {
    if (accounting) return accounting;
    if (brigade.status !== 'Clôturée') return undefined;

    // Comptabilité absente : on la reconstruit avec la MÊME arithmétique que
    // partout ailleurs, plutôt qu'avec une copie qui finirait par diverger.
    const decalageSummary: Record<string, { money: number; liters: number }> = {};
    const pompisteSummary: Record<string, any> = {};
    pompisteGroups.forEach(g => {
      if (Math.abs(g.ecart) > 0.01) decalageSummary[g.pompisteId] = { money: g.ecart, liters: 0 };
      pompisteSummary[g.pompisteId] = {
        theoretical: g.theoretical,
        cashReceived: g.collected,
        justifTotal: g.justified,
        ecart: g.ecart,
        litersSold: g.totalLiters,
        pompisteName: g.name,
        pumpNames: g.pumps.map(p => p.pump?.name || p.pump?.number || '—'),
        byFuel: g.byFuel,
      };
    });

    const tankSummary = tankData.map(t => ({
      tankId: t.tank.id,
      name: t.tank.name,
      fuelType: t.tank.type,
      start: brigade.startTankLevels?.[t.tank.id],
      end: brigade.endTankLevels?.[t.tank.id],
      measured: t.measured,
      diff: t.cuveDiff,
      nozzleDiff: t.nozzleDiff,
      ecart: t.difference,
      ecartMoney: t.amount,
    }));

    const nozzleSummary = nozzleData.map(d => ({
      nozzleId: d.nozzle.id,
      nozzleName: d.nozzle.name,
      pumpName: d.pump?.name,
      tankName: d.tank?.name,
      fuelType: d.fuelType,
      start: d.startIdx,
      end: d.endIdx,
      startIdx: d.startIdx,
      endIdx: d.endIdx,
      liters: d.liters,
      price: d.price,
      revenue: d.amount,
    }));

    const createdBy = brigade.notes?.startsWith('Créé par:') ? brigade.notes.replace('Créé par:', '').trim() : '';

    return {
      id: brigade.id,
      brigadeId: brigade.id,
      totalDue: totals.theoretical,
      cashReceived: totals.collected,
      rest: totals.netBalance,
      tankSummary,
      nozzleSummary,
      pompisteSummary,
      decalageSummary,
      cuveVerifications: {},
      nozzleVerifications: {},
      restAssignedAmount: 0,
      status: 'completed',
      createdBy,
      justifications: [],
    };
  }, [accounting, brigade, pompisteGroups, tankData, nozzleData, totals]);

  // Shop sales during brigade
  const brigadeSales = useMemo(() => {
    if (!brigade.startTimestamp) return [];
    const start = new Date(brigade.startTimestamp).getTime();
    const end = brigade.endTimestamp ? new Date(brigade.endTimestamp).getTime() : Date.now();
    return shopSales.filter(s => {
      const t = new Date(s.date).getTime();
      return t >= start && t <= end;
    });
  }, [shopSales, brigade]);

  // ── Données dérivées pour l'affichage étape par étape ─────────────────────
  const justifs = accountingRecord?.justifications || accounting?.justifications || [];
  const pName = (id?: string) => pompistes.find(p => p.id === id)?.name || (id === brigade.chefId ? (chef?.name || 'Chef') : '—');
  const startAt = brigade.startDatetime || brigade.startTimestamp;
  const endAt = brigade.endDatetime || brigade.endTimestamp;
  const durationH = startAt && endAt ? Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3600000) : 0;
  const armoireSaleTotalOf = (pid: string) => (brigade.armoireSales || []).filter(s => s.pompisteId === pid).reduce((a, s) => a + (s.total || 0), 0)
    + (brigade.magasinProductMoves || []).filter(m => m.kind === 'VENTE' && m.pompisteId === pid).reduce((a, m) => a + (m.total || 0), 0);
  const totalProducts = (brigade.armoireSales || []).reduce((a, s) => a + (s.total || 0), 0)
    + (brigade.magasinProductMoves || []).filter(m => m.kind === 'VENTE').reduce((a, m) => a + (m.total || 0), 0);
  const byType = (t: string) => justifs.filter(j => (j.justificationType || 'CLIENT') === t);
  const sumOf = (list: { amount?: number }[]) => list.reduce((a, j) => a + (Number(j.amount) || 0), 0);
  const tpeTotal = sumOf(byType('TPE'));
  const tagTotal = sumOf(byType('TAG'));
  const clientTotal = sumOf(byType('CLIENT'));
  const expenseTotal = sumOf(byType('EXPENSE'));
  const achatTotal = sumOf(byType('ACHAT_PRODUIT'));
  const bankByAccount = useMemo(() => {
    const m = new Map<string, number>();
    justifs.forEach(j => {
      if ((j.justificationType === 'TPE' || j.justificationType === 'TAG') && j.bankAccountId)
        m.set(j.bankAccountId, (m.get(j.bankAccountId) || 0) + (j.amount || 0));
    });
    return [...m.entries()];
  }, [justifs]);
  const theoTotal = totals.theoretical;
  const collectedTotal = totals.collected;
  const justifiedTotal = sumOf(justifs) || totals.justified;
  const balance = theoTotal - collectedTotal - justifiedTotal;

  const STEP_SECTIONS = [
    { id: 'info',         num: 0, label: 'Vue d\'ensemble', icon: Activity },
    { id: 'pompistes',    num: 1, label: 'Pompistes',       icon: Users },
    { id: 'pompes',       num: 2, label: 'Pompes',          icon: Wrench },
    { id: 'planning',     num: 3, label: 'Planning',        icon: Calendar },
    { id: 'depart',       num: 4, label: 'Départ',          icon: Database },
    { id: 'fin',          num: 5, label: 'Index fin',       icon: Droplets },
    { id: 'comptabilite', num: 6, label: 'Comptabilité',    icon: DollarSign },
    { id: 'produits',     num: 7, label: 'Produits & ventes', icon: ShoppingBag },
    { id: 'historique',   num: 8, label: 'Historique',      icon: Clock },
  ];
  const section = STEP_SECTIONS.find(s => s.id === activeSection) ? activeSection
    : activeSection === 'cuves' ? 'fin' : activeSection === 'pistolets' ? 'fin' : activeSection === 'ventes' ? 'produits' : 'info';

  const statusTone = brigade.status === 'Ouverte' ? 'bg-emerald-400 text-emerald-950' : brigade.status === 'Planifiée' ? 'bg-sky-300 text-sky-950'
    : brigade.status === 'En attente' ? 'bg-amber-300 text-amber-950' : 'bg-slate-200 text-slate-800';

  const justifLabel = (t?: string) => t === 'TPE' ? '💳 TPE' : t === 'TAG' ? '🏷️ TAG' : t === 'EXPENSE' ? '🧾 Dépense'
    : t === 'ACHAT_PRODUIT' ? '📦 Achat produit' : '👤 Crédit client';
  const justifTone = (t?: string) => t === 'TPE' ? 'border-cyan-200 bg-cyan-50/50' : t === 'TAG' ? 'border-purple-200 bg-purple-50/50'
    : t === 'EXPENSE' ? 'border-emerald-200 bg-emerald-50/50' : t === 'ACHAT_PRODUIT' ? 'border-indigo-200 bg-indigo-50/50' : 'border-orange-200 bg-orange-50/50';

  return (
    <div className="modal-shell z-[60]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="not-italic bg-slate-50 w-full max-w-6xl rounded-2xl sm:rounded-[2rem] shadow-2xl relative z-10 flex flex-col h-[var(--modal-max-h)] overflow-hidden border border-slate-100">

        {/* Header */}
        <div className="px-5 sm:px-7 py-4 sm:py-5 text-white shrink-0 border-b-2 border-[#FFB800]/60"
          style={{ background: 'linear-gradient(120deg, #001233 0%, #001f5c 45%, #003087 100%)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,184,0,0.18)', border: '1px solid rgba(255,184,0,0.35)' }}>
                <Calendar className="w-5 h-5 text-[#FFB800]" />
              </div>
              <div className="min-w-0">
                <h2 className="font-black text-sm sm:text-base uppercase tracking-widest truncate">Détails de la brigade</h2>
                <p className="text-[11px] text-blue-200 font-bold mt-0.5 truncate">
                  {fmtDate(brigade.date)} · {brigade.shift} · {(brigade.pompisteIds || []).length} pompiste(s)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase', statusTone)}>{brigade.status}</span>
              <button onClick={onClose} className="modal-close"><X className="w-5 h-5" /></button>
            </div>
          </div>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
            {[
              { l: 'Litres vendus', v: `${fmtN(totals.liters)} L`, c: 'text-sky-200' },
              { l: 'Théorique', v: money(theoTotal), c: 'text-[#FFB800]' },
              { l: 'Espèces', v: money(collectedTotal), c: 'text-emerald-300' },
              { l: 'Justifié', v: money(justifiedTotal), c: 'text-violet-200' },
              { l: 'Décalage', v: money(balance), c: Math.abs(balance) < 1 ? 'text-emerald-300' : 'text-red-300' },
            ].map(k => (
              <div key={k.l} className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">{k.l}</p>
                <p className={cn('font-black tabular-nums text-sm sm:text-base', k.c)}>{k.v}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
          {/* Step navigation */}
          <nav className="md:w-56 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-2 md:p-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto">
            {STEP_SECTIONS.map(s => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={cn('flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all shrink-0',
                    active ? 'bg-gradient-to-r from-[#001f5c] to-[#003087] text-white shadow-md' : 'text-slate-600 hover:bg-slate-100')}>
                  <span className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0',
                    active ? 'bg-[#FFB800] text-[#001233]' : 'bg-slate-100 text-slate-500')}>
                    {s.num >= 1 && s.num <= 6 ? s.num : <Icon className="w-3.5 h-3.5" />}
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-wide whitespace-nowrap">{s.label}</span>
                  {active && <ChevronRight className="w-3.5 h-3.5 ml-auto hidden md:block" />}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
            <AnimatePresence mode="wait">
              <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">

                {/* ── Vue d'ensemble ── */}
                {section === 'info' && (<>
                  <StepTitle num={0} icon={Activity} title="Vue d'ensemble" hint="Résumé de chaque étape de la création de la brigade" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <OverviewCard n={1} title="Pompistes" color="blue" onClick={() => setActiveSection('pompistes')}
                      value={`${(brigade.pompisteAssignments || []).filter(a => a.present).length || (brigade.pompisteIds || []).length} présent(s)`}
                      sub={(brigade.pompisteIds || []).map(pName).join(', ') || '—'} />
                    <OverviewCard n={2} title="Pompes" color="indigo" onClick={() => setActiveSection('pompes')}
                      value={`${new Set(nozzleData.map(n => n.pump?.id)).size} pompe(s) · ${nozzleData.length} pistolet(s)`}
                      sub={totals.byFuel.map(f => `${f.fuelType}: ${fmtN(f.liters)} L`).join(' · ') || '—'} />
                    <OverviewCard n={3} title="Planning" color="sky" onClick={() => setActiveSection('planning')}
                      value={`${fmtDT(startAt)} → ${fmtDT(endAt)}`} sub={durationH ? `Durée : ${durationH.toFixed(1)} h` : '—'} />
                    <OverviewCard n={4} title="Départ" color="amber" onClick={() => setActiveSection('depart')}
                      value={`${tankData.length} cuve(s) relevée(s)`} sub={tankData.map(t => `${t.tank.name}: ${fmtN(t.startL)} L`).join(' · ') || '—'} />
                    <OverviewCard n={5} title="Index fin" color="orange" onClick={() => setActiveSection('fin')}
                      value={`${fmtN(totals.liters)} L débités`} sub={money(totals.computedAmount)} />
                    <OverviewCard n={6} title="Comptabilité" color="emerald" onClick={() => setActiveSection('comptabilite')}
                      value={money(theoTotal)} sub={`Espèces ${money(collectedTotal)} · Justifié ${money(justifiedTotal)}`} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {[
                      { l: 'TPE', v: tpeTotal, c: 'text-cyan-700 bg-cyan-50 border-cyan-100' },
                      { l: 'TAG', v: tagTotal, c: 'text-purple-700 bg-purple-50 border-purple-100' },
                      { l: 'Crédit client', v: clientTotal, c: 'text-orange-700 bg-orange-50 border-orange-100' },
                      { l: 'Dépenses', v: expenseTotal, c: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
                      { l: 'Achats produits', v: achatTotal, c: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
                      { l: 'Produits vendus', v: totalProducts, c: 'text-rose-700 bg-rose-50 border-rose-100' },
                    ].map(k => (
                      <div key={k.l} className={cn('rounded-xl border px-3 py-2.5', k.c)}>
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{k.l}</p>
                        <p className="font-black tabular-nums text-sm">{money(k.v)}</p>
                      </div>
                    ))}
                  </div>
                </>)}

                {/* ── 1. Pompistes ── */}
                {section === 'pompistes' && (<>
                  <StepTitle num={1} icon={Users} title="Pompistes" hint="Les pompistes présents sur la brigade et le chef de brigade" />
                  {chef && (
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center font-black">{chef.name?.[0] || 'C'}</div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">Chef de brigade</p><p className="font-black text-slate-800">{chef.name}</p></div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(brigade.pompisteAssignments?.length ? brigade.pompisteAssignments : (brigade.pompisteIds || []).map(id => ({ pompisteId: id, trackId: '', present: true }))).map((a: any) => {
                      const p = pompistes.find(x => x.id === a.pompisteId);
                      const g = pompisteGroups.find(x => x.pompisteId === a.pompisteId);
                      return (
                        <div key={a.pompisteId} className="rounded-2xl bg-white border border-slate-200 p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white flex items-center justify-center font-black">{(p?.name || pName(a.pompisteId))[0]}</div>
                            <div className="min-w-0 flex-1">
                              <p className="font-black text-slate-800 truncate">{p?.name || pName(a.pompisteId)}</p>
                              <p className="text-[10px] font-bold text-slate-400">{p?.phone || ''}{a.chefActingAsPompiste ? ' · Chef en poste pompiste' : ''}</p>
                            </div>
                            <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-black uppercase', a.present ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                              {a.present ? 'Présent' : 'Absent'}
                            </span>
                          </div>
                          {g && (
                            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                              <Mini l="Litres" v={`${fmtN(g.totalLiters)} L`} />
                              <Mini l="Théorique" v={money(g.theoretical)} />
                              <Mini l="Écart" v={money(g.ecart)} tone={Math.abs(g.ecart) < 1 ? 'ok' : 'bad'} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>)}

                {/* ── 2. Pompes ── */}
                {section === 'pompes' && (<>
                  <StepTitle num={2} icon={Wrench} title="Pompes" hint="Les pompes et pistolets tenus par chaque pompiste" />
                  {pompisteGroups.length === 0 ? <Empty label="Aucune pompe attribuée" /> : pompisteGroups.map(g => (
                    <div key={g.pompisteId} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-slate-100 flex items-center justify-between">
                        <p className="font-black text-slate-800 flex items-center gap-2"><User className="w-4 h-4 text-indigo-500" /> {g.name}</p>
                        <p className="text-[11px] font-black text-indigo-700">{g.pumps.length} pompe(s) · {fmtN(g.totalLiters)} L</p>
                      </div>
                      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {g.pumps.map((pg, i) => (
                          <div key={i} className="rounded-xl border border-slate-100 p-3">
                            <p className="text-xs font-black text-slate-700 mb-2">⛽ {pg.pump?.name || `Pompe ${pg.pump?.number || i + 1}`}</p>
                            <div className="space-y-1">
                              {pg.nozzles.map(n => (
                                <div key={n.nozzle.id} className="flex items-center justify-between text-[11px] font-bold">
                                  <span className="text-slate-600">{n.nozzle.name} <span className="text-slate-400">· {n.tank?.name || '—'} ({n.fuelType || '?'})</span></span>
                                  <span className="tabular-nums text-slate-800">{fmtN(n.liters)} L</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {pg.byFuel.map(f => <span key={f.fuelType} className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[9px] font-black">{f.fuelType} {fmtN(f.liters)} L</span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>)}

                {/* ── 3. Planning ── */}
                {section === 'planning' && (<>
                  <StepTitle num={3} icon={Calendar} title="Planning" hint="Dates, horaires et statut de la brigade" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <InfoBox l="Journée" v={fmtDate(brigade.date)} />
                    <InfoBox l="Poste" v={brigade.shift} />
                    <InfoBox l="Statut" v={brigade.status} />
                    <InfoBox l="Début" v={fmtDT(startAt)} />
                    <InfoBox l="Fin" v={fmtDT(endAt)} />
                    <InfoBox l="Durée" v={durationH ? `${durationH.toFixed(1)} heures` : '—'} />
                    <InfoBox l="Créée le" v={fmtDT(brigade.createdAt)} />
                    <InfoBox l="Imprimée le" v={fmtDT(brigade.printedAt)} />
                    <InfoBox l="Comptabilité" v={accounting ? (accounting.status === 'completed' ? 'Terminée' : 'Brouillon') : 'Non saisie'} />
                  </div>
                  {brigade.notes && <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm font-bold text-amber-900">📝 {brigade.notes}</div>}
                </>)}

                {/* ── 4. Départ ── */}
                {section === 'depart' && (<>
                  <StepTitle num={4} icon={Database} title="Départ" hint="Index de départ des pistolets et niveaux des cuves à l'ouverture" />
                  <SubCard title="Niveaux des cuves au départ" icon={Droplets}>
                    <SimpleTable head={['Cuve', 'Carburant', 'Degrés', 'Litres']}
                      rows={tankData.map(t => [t.tank.name, t.tank.type, fmtN(t.startDeg), `${fmtN(t.startL)} L`])} />
                  </SubCard>
                  <SubCard title="Index de départ des pistolets" icon={Zap}>
                    <SimpleTable head={['Pompe', 'Pistolet', 'Cuve', 'Index départ']}
                      rows={nozzleData.map(n => [n.pump?.name || '—', n.nozzle.name, n.tank?.name || '—', fmtN(n.startIdx)])} />
                  </SubCard>
                </>)}

                {/* ── 5. Index fin ── */}
                {section === 'fin' && (<>
                  <StepTitle num={5} icon={Droplets} title="Index de fin" hint="Index de fin, litres débités, niveaux de fin et écarts des cuves" />
                  <SubCard title="Pistolets — index et ventes" icon={Zap}>
                    <SimpleTable head={['Pistolet', 'Carburant', 'Départ', 'Fin', 'Litres', 'Prix', 'Montant']}
                      rows={nozzleData.map(n => [`${n.pump?.name || ''} · ${n.nozzle.name}`, n.fuelType || '?', fmtN(n.startIdx), fmtN(n.endIdx), `${fmtN(n.liters)} L`, fmtN(n.price), money(n.amount)])}
                      foot={['TOTAL', '', '', '', `${fmtN(totals.liters)} L`, '', money(totals.computedAmount)]} />
                  </SubCard>
                  <SubCard title="Cuves — niveaux de fin et décalage" icon={Droplets}>
                    <SimpleTable head={['Cuve', 'Départ', 'Fin', 'Baisse cuve', 'Débit pistolets', 'Écart', 'Valeur']}
                      rows={tankData.map(t => [
                        `${t.tank.name}${t.measured ? '' : ' (déduit)'}`, `${fmtN(t.startL)} L`, `${fmtN(t.endL)} L`,
                        `${fmtN(t.cuveDiff)} L`, `${fmtN(t.nozzleDiff)} L`,
                        t.measured ? `${fmtN(t.difference)} L` : '—', t.measured ? money(t.amount) : '—'])} />
                  </SubCard>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {totals.byFuel.map(f => (
                      <div key={f.fuelType} className="rounded-xl bg-white border border-slate-200 p-3">
                        <p className="text-[9px] font-black uppercase text-slate-400">{f.fuelType}</p>
                        <p className="font-black text-slate-800 tabular-nums">{fmtN(f.liters)} L</p>
                        <p className="text-[11px] font-bold text-blue-700 tabular-nums">{money(f.amount)}</p>
                      </div>
                    ))}
                  </div>
                </>)}

                {/* ── 6. Comptabilité ── */}
                {section === 'comptabilite' && (<>
                  <StepTitle num={6} icon={DollarSign} title="Comptabilité" hint="Par pompiste : théorique, versements, justifications détaillées et décalage" />
                  {!accountingRecord && <Empty label="Aucune comptabilité enregistrée pour cette brigade" />}
                  {pompisteGroups.map(g => {
                    const list = justifs.filter(j => (j.pompisteId || '_unassigned') === g.pompisteId);
                    const vers = (brigade.versements || []).filter(v => v.pompisteId === g.pompisteId);
                    const prod = armoireSaleTotalOf(g.pompisteId);
                    return (
                      <div key={g.pompisteId} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-gradient-to-r from-emerald-50 via-white to-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <p className="font-black text-slate-800 flex items-center gap-2"><User className="w-4 h-4 text-emerald-600" /> {g.name}</p>
                          <span className={cn('px-2.5 py-1 rounded-full text-[10px] font-black', Math.abs(g.ecart) < 1 ? 'bg-emerald-100 text-emerald-700' : g.ecart > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')}>
                            {Math.abs(g.ecart) < 1 ? 'Équilibré' : g.ecart > 0 ? `Manque ${money(g.ecart)}` : `Excédent ${money(-g.ecart)}`}
                          </span>
                        </div>
                        <div className="p-4 space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <Mini l="Carburant" v={money(Math.max(0, g.theoretical - prod))} />
                            <Mini l="Produits" v={money(prod)} />
                            <Mini l="À rendre" v={money(g.theoretical)} />
                            <Mini l="Espèces" v={money(g.collected)} tone="ok" />
                            <Mini l="Justifié" v={money(g.justified)} />
                          </div>
                          {vers.length > 0 && (
                            <div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Versements ({vers.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {vers.map(v => <span key={v.id} className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-100 text-[10px] font-black text-emerald-800">{fmtDT(v.at)} · {money(v.amount)}</span>)}
                              </div>
                            </div>
                          )}
                          {list.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Justifications ({list.length})</p>
                              {list.map(j => {
                                const client = clients.find(c => c.id === j.clientId);
                                const bank = bankAccounts.find(b => b.id === j.bankAccountId);
                                return (
                                  <div key={j.id} className={cn('rounded-xl border p-3 space-y-2', justifTone(j.justificationType))}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white border border-slate-200">{justifLabel(j.justificationType)}</span>
                                        <span className="text-xs font-black text-slate-700 truncate">
                                          {j.justificationType === 'CLIENT' || !j.justificationType ? (client?.name || j.clientName || '—')
                                            : j.justificationType === 'ACHAT_PRODUIT' ? `${j.productName || 'Produit'} × ${fmtN(j.quantity || 0)}`
                                            : (j.notes || j.clientName || (j.entryMode === 'DETAIL' ? `${j.operations?.length || 0} opération(s)` : 'Montant global'))}
                                        </span>
                                      </div>
                                      <span className="font-black tabular-nums text-slate-900">{money(j.amount)}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 text-[9px] font-black uppercase">
                                      {bank && <span className="px-2 py-0.5 rounded bg-white text-blue-700 border border-blue-100">🏦 {bank.name}</span>}
                                      {j.tagType && <span className="px-2 py-0.5 rounded bg-white text-purple-700 border border-purple-100">{j.tagType}</span>}
                                      {(j.justificationType === 'TPE' || j.justificationType === 'TAG') && <span className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">{j.entryMode === 'DETAIL' ? 'Opérations détaillées' : 'Montant global'}</span>}
                                      {j.expenseCategory && <span className="px-2 py-0.5 rounded bg-white text-emerald-700 border border-emerald-100">{j.expenseCategory}</span>}
                                      {j.supplierName && <span className="px-2 py-0.5 rounded bg-white text-indigo-700 border border-indigo-100">{j.supplierName}</span>}
                                    </div>
                                    {j.entryMode === 'DETAIL' && <JustifOpsList type={j.justificationType || ''} operations={j.operations} />}
                                  </div>
                                );
                              })}
                            </div>
                          ) : <p className="text-[11px] font-bold text-slate-400">Aucune justification</p>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-2xl p-4 sm:p-5 text-white space-y-2" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#FFB800]">Récapitulatif final</p>
                    {[
                      ['Total théorique', theoTotal], ['Total espèces', collectedTotal], ['TPE', tpeTotal], ['TAG', tagTotal],
                      ['Crédit client', clientTotal], ['Dépenses', expenseTotal], ['Achats produits', achatTotal], ['Total justifié', justifiedTotal],
                    ].map(([l, v]) => (
                      <div key={l as string} className="flex justify-between text-xs font-bold"><span className="text-blue-200">{l}</span><span className="tabular-nums">{money(v as number)}</span></div>
                    ))}
                    <div className="flex justify-between pt-2 border-t border-white/20 font-black"><span>Décalage</span><span className={cn('tabular-nums', Math.abs(balance) < 1 ? 'text-emerald-300' : 'text-red-300')}>{money(balance)}</span></div>
                    {bankByAccount.length > 0 && (
                      <div className="pt-2 border-t border-white/15 space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">Encaissé en banque (TPE / TAG)</p>
                        {bankByAccount.map(([id, a]) => (
                          <div key={id} className="flex justify-between text-xs font-bold"><span>{bankAccounts.find(b => b.id === id)?.name || 'Compte'}</span><span className="text-emerald-300">+{money(a)}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                </>)}

                {/* ── Produits & ventes ── */}
                {section === 'produits' && (<>
                  <StepTitle num={7} icon={ShoppingBag} title="Produits & ventes" hint="Ventes et achats de produits (armoires et magasins) pendant la brigade" />
                  {hasArmoireMoves(brigade)
                    ? <BrigadeArmoireMovements brigade={brigade} pompistes={pompistes} armoires={armoires} />
                    : <Empty label="Aucun mouvement d'armoire" />}
                  {(brigade.magasinProductMoves || []).length > 0 && (
                    <SubCard title="Mouvements directs en magasin" icon={ShoppingBag}>
                      <SimpleTable head={['Type', 'Pompiste', 'Produit', 'Qté', 'Prix', 'Total']}
                        rows={(brigade.magasinProductMoves || []).map(m => [m.kind === 'VENTE' ? 'Vente' : 'Achat', pName(m.pompisteId), m.productName, fmtN(m.quantity), money(m.price), money(m.total)])} />
                    </SubCard>
                  )}
                  {brigadeSales.length > 0 && (
                    <SubCard title="Ventes boutique pendant la brigade" icon={ShoppingBag}>
                      <SimpleTable head={['Date', 'Articles', 'Total', 'Statut']}
                        rows={brigadeSales.map(s => [fmtDT(s.date), String(s.items?.length || 0), money(s.total), s.status])} />
                    </SubCard>
                  )}
                </>)}

                {/* ── Historique ── */}
                {section === 'historique' && (<>
                  <StepTitle num={8} icon={Clock} title="Historique" hint="Chronologie de la brigade" />
                  <div className="relative pl-5 space-y-3 before:absolute before:left-2 before:top-1 before:bottom-1 before:w-0.5 before:bg-slate-200">
                    {[
                      brigade.createdAt && { time: brigade.createdAt, label: 'Brigade créée', color: 'bg-blue-500' },
                      startAt && { time: startAt, label: 'Début de la brigade', color: 'bg-emerald-500' },
                      ...(brigade.versements || []).map(v => ({ time: v.at, label: `Versement de ${pName(v.pompisteId)} : ${money(v.amount)}`, color: 'bg-amber-500' })),
                      endAt && { time: endAt, label: 'Fin de la brigade', color: 'bg-slate-500' },
                      accountingRecord && { time: endAt || brigade.date, label: `Comptabilité enregistrée (${accountingRecord.status === 'completed' ? 'terminée' : 'brouillon'})`, color: 'bg-violet-500' },
                      brigade.printedAt && { time: brigade.printedAt, label: 'Fiche imprimée', color: 'bg-sky-500' },
                    ].filter(Boolean).sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime()).map((ev: any, i) => (
                      <div key={i} className="relative flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100">
                        <span className={cn('absolute -left-[18px] top-4 w-3 h-3 rounded-full ring-2 ring-white', ev.color)} />
                        <div>
                          <p className="font-black text-slate-800 text-sm">{ev.label}</p>
                          <p className="text-[10px] text-slate-400">{fmtDT(ev.time)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>)}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 bg-white border-t border-slate-200 flex gap-3 shrink-0">
          <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black uppercase text-[#002d87] border-2 border-[#002d87] rounded-xl hover:bg-blue-50 transition-colors bg-white">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
          <button onClick={onClose} className="flex-1 bg-gradient-to-r from-[#001f5c] to-[#003087] text-white font-black uppercase tracking-widest rounded-xl py-2.5 text-[10px] hover:shadow-lg transition-all">
            Fermer
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const money = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
const fmtN = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const fmtDate = (v?: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR'); };
const fmtDT = (v?: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

const StepTitle: React.FC<{ num: number; icon: React.FC<any>; title: string; hint?: string }> = ({ num, icon: Icon, title, hint }) => (
  <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
      {num >= 1 && num <= 6 ? <span className="font-black text-[#FFB800]">{num}</span> : <Icon className="w-5 h-5 text-[#FFB800]" />}
    </div>
    <div>
      <h3 className="text-sm font-black uppercase tracking-widest text-[#001f5c]">{num >= 1 && num <= 6 ? `Étape ${num} — ` : ''}{title}</h3>
      {hint && <p className="text-[11px] font-bold text-slate-400">{hint}</p>}
    </div>
  </div>
);

const OVERVIEW_COLORS: Record<string, string> = {
  blue: 'from-blue-500 to-blue-700', indigo: 'from-indigo-500 to-indigo-700', sky: 'from-sky-500 to-sky-700',
  amber: 'from-amber-400 to-amber-600', orange: 'from-orange-500 to-orange-700', emerald: 'from-emerald-500 to-emerald-700',
};
const OverviewCard: React.FC<{ n: number; title: string; value: string; sub: string; color: string; onClick: () => void }> = ({ n, title, value, sub, color, onClick }) => (
  <button onClick={onClick} className="text-left rounded-2xl bg-white border border-slate-200 p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all group">
    <div className="flex items-center gap-2 mb-2">
      <span className={cn('w-7 h-7 rounded-lg bg-gradient-to-br text-white flex items-center justify-center text-xs font-black', OVERVIEW_COLORS[color])}>{n}</span>
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</span>
      <ChevronRight className="w-4 h-4 ml-auto text-slate-300 group-hover:text-slate-600" />
    </div>
    <p className="font-black text-slate-800 text-sm">{value}</p>
    <p className="text-[11px] font-bold text-slate-400 truncate">{sub}</p>
  </button>
);

const Mini: React.FC<{ l: string; v: string; tone?: 'ok' | 'bad' }> = ({ l, v, tone }) => (
  <div className={cn('rounded-xl px-2.5 py-2 border', tone === 'ok' ? 'bg-emerald-50 border-emerald-100' : tone === 'bad' ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100')}>
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{l}</p>
    <p className={cn('text-xs font-black tabular-nums', tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-800')}>{v}</p>
  </div>
);

const InfoBox: React.FC<{ l: string; v: string }> = ({ l, v }) => (
  <div className="rounded-xl bg-white border border-slate-200 p-3">
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{l}</p>
    <p className="font-black text-slate-800 text-sm">{v || '—'}</p>
  </div>
);

const SubCard: React.FC<{ title: string; icon: React.FC<any>; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
    <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center gap-2">
      <Icon className="w-4 h-4 text-[#003087]" />
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-600">{title}</p>
    </div>
    <div className="p-3">{children}</div>
  </div>
);

const SimpleTable: React.FC<{ head: string[]; rows: (string | number)[][]; foot?: (string | number)[] }> = ({ head, rows, foot }) => (
  rows.length === 0 ? <Empty label="Aucune donnée" /> : (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead><tr className="bg-[#001f5c] text-white">{head.map((h, i) => <th key={i} className={cn('px-2.5 py-2 font-black uppercase text-[9px] tracking-wide', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn('border-b border-slate-100', i % 2 ? 'bg-slate-50/60' : '')}>
              {r.map((c, k) => <td key={k} className={cn('px-2.5 py-1.5 font-bold text-slate-700', k === 0 ? 'text-left' : 'text-right tabular-nums')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot><tr className="bg-blue-50 font-black text-[#001f5c]">{foot.map((c, k) => <td key={k} className={cn('px-2.5 py-2', k === 0 ? 'text-left' : 'text-right tabular-nums')}>{c}</td>)}</tr></tfoot>}
      </table>
    </div>
  )
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-center py-10 text-slate-400 text-sm font-bold">{label}</div>
);

export default BrigadeDetailModal;
