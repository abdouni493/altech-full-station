import React, { useState, useMemo } from "react";
import {
  X, Clock, Calendar, Users, Printer, TrendingUp, Droplets, Zap,
  User, DollarSign, ShoppingBag, Activity, ChevronRight, CheckCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import {
  useAppState, Brigade, Pump, Tank, Pompiste, BrigadeChef, PumpNozzle, Track, ShopSale, StationSettings, BrigadeAccounting, Client, nozzleTankId
} from "../store/AppContext";
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
  const { brigadeAccountings, bankAccounts = [] } = useAppState();
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

  const ActiveIcon = SECTIONS.find(s => s.id === activeSection)?.icon || Calendar;

  const statusColor = brigade.status === 'Ouverte' ? 'bg-green-500' : brigade.status === 'Planifiée' ? 'bg-blue-500' : 'bg-slate-400';

  return (
    <div className="modal-shell z-[60]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-5xl rounded-[2rem] shadow-2xl relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden border border-slate-100">

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}>
              <Calendar className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="font-black text-sm uppercase tracking-widest italic">Détails Brigade</h2>
              <p className="text-[11px] text-blue-200 font-bold mt-0.5">{brigade.date} · {brigade.shift} · {chef?.name || 'N/A'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="p-2 hover:bg-white/20 rounded-lg transition text-white"><Printer className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition text-white"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          <div className="w-44 shrink-0 flex flex-col border-r border-slate-100 bg-white">
            <div className="px-3 py-3 space-y-0.5 flex-1">
              {SECTIONS.map(s => {
                const Icon = s.icon;
                const isActive = activeSection === s.id;
                return (
                  <button key={s.id} onClick={() => setActiveSection(s.id)}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all text-[11px] font-bold",
                      isActive ? "bg-blue-900 text-yellow-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700")}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{s.label}</span>
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
                  </button>
                );
              })}
            </div>
            {/* Status chip */}
            <div className="p-3 border-t border-slate-100">
              <div className={cn("flex items-center gap-2 px-3 py-2 rounded-xl", brigade.status === 'Ouverte' ? 'bg-green-50' : brigade.status === 'Planifiée' ? 'bg-blue-50' : 'bg-slate-50')}>
                <div className={cn("w-2 h-2 rounded-full", statusColor)} />
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-600">{brigade.status}</span>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto bg-slate-50 custom-scrollbar">
            <AnimatePresence mode="wait">

              {/* ── Informations ── */}
              {activeSection === 'info' && (
                <motion.div key="info" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-5">
                  <SectionHeader icon={Calendar} label="Informations Brigade" />
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Date', value: brigade.date },
                      { label: 'Quart', value: brigade.shift },
                      { label: 'Chef', value: chef?.name || 'N/A' },
                      { label: 'Statut', value: brigade.status },
                      { label: 'Heure Début', value: brigade.startTime || '—' },
                      { label: 'Heure Fin', value: brigade.endTime || '—' },
                      { label: 'Démarrage', value: brigade.startTimestamp ? new Date(brigade.startTimestamp).toLocaleString('fr-FR') : '—' },
                      { label: 'Clôture', value: brigade.endTimestamp ? new Date(brigade.endTimestamp).toLocaleString('fr-FR') : '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-white rounded-2xl p-4 border border-slate-100">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                        <p className="font-black text-slate-800 text-sm">{value}</p>
                      </div>
                    ))}
                  </div>
                  {brigade.canReactivate && (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] font-bold text-amber-700">🔄 Réactivation possible après clôture</div>
                  )}
                </motion.div>
              )}

              {/* ── Cuves ── */}
              {activeSection === 'cuves' && (
                <motion.div key="cuves" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                  <SectionHeader icon={Droplets} label="Niveaux des Cuves" />
                  {tankData.length === 0 && <Empty label="Aucune donnée de cuve" />}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-blue-900 text-white">
                        <tr>{['Cuve', 'Type', 'Début °/%', 'Début L', 'Fin °/%', 'Fin L', 'Δ Cuve L', 'Δ Pistolets L', 'Écart L'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {tankData.map(({ tank, startL, startDeg, endL, endDeg, cuveDiff, nozzleDiff, difference, measured, type }) => (
                          <tr key={tank.id} className="hover:bg-blue-50/20">
                            <td className="px-3 py-3 font-black text-slate-800">{tank.name}</td>
                            <td className="px-3 py-3"><span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-100 text-blue-700">{tank.type}</span></td>
                            <td className="px-3 py-3 font-mono text-[11px] text-slate-500">{startDeg.toFixed(1)}{tank.type === 'GPL' ? '%' : '°'}</td>
                            <td className="px-3 py-3 font-black text-blue-700">{startL.toLocaleString('fr-FR')} L</td>
                            {/* Sans jauge de fin relevée, il n'y a pas de mesure de
                                cuve à afficher — et donc aucun écart à en tirer. */}
                            <td className="px-3 py-3 font-mono text-[11px] text-slate-500">{measured ? `${endDeg.toFixed(1)}${tank.type === 'GPL' ? '%' : '°'}` : '—'}</td>
                            <td className="px-3 py-3 font-black text-slate-700">{measured ? `${endL.toLocaleString('fr-FR')} L` : '—'}</td>
                            <td className="px-3 py-3 font-black text-slate-700">{measured ? `${cuveDiff.toFixed(1)} L` : '—'}</td>
                            <td className="px-3 py-3 font-black text-blue-700">{nozzleDiff.toFixed(1)} L</td>
                            <td className={cn("px-3 py-3 font-black", !measured ? "text-slate-400" : type === 'CORRECT' ? "text-green-700" : type === 'RETOUR_CUVE' ? "text-amber-700" : "text-red-700")}>
                              {measured ? `${difference.toFixed(1)} L` : 'non relevée'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {/* ── Pistolets ── */}
              {activeSection === 'pistolets' && (
                <motion.div key="pistolets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                  <SectionHeader icon={Zap} label="Index Pistolets" />
                  {nozzleData.length === 0 && <Empty label="Aucun pistolet actif" />}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-purple-900 text-white">
                        <tr>{['Pistolet', 'Pompe', 'Carburant', 'Index Début', 'Index Fin', 'Différence (L)', 'Prix/L', 'Montant'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {nozzleData.map(d => (
                          <tr key={d.nozzle.id} className="hover:bg-purple-50/20">
                            <td className="px-3 py-3 font-black text-slate-800">{d.nozzle.name}</td>
                            <td className="px-3 py-3 text-slate-600">{d.pump?.name || '—'}</td>
                            {/* Le carburant vient de la CUVE du pistolet : deux
                                pistolets d'une même pompe peuvent différer. */}
                            <td className="px-3 py-3">
                              <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black", d.missingFuelType ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
                                {d.fuelType || 'CUVE NON DÉFINIE'}
                              </span>
                              <span className="block text-[9px] text-slate-400 mt-0.5">{d.tank?.name || '—'}</span>
                            </td>
                            <td className="px-3 py-3 font-mono text-[11px] text-slate-500 tabular-nums">{d.startIdx.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                            <td className="px-3 py-3 font-mono text-[11px] text-slate-500 tabular-nums">{d.endIdx.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                            <td className={cn("px-3 py-3 font-black", d.inverted ? "text-red-600" : "text-blue-700")}>
                              {d.liters.toFixed(2)} L
                              {d.inverted && <span className="block text-[9px] font-bold">index de fin &lt; début</span>}
                            </td>
                            <td className="px-3 py-3 text-slate-500 tabular-nums text-[11px]">{d.price.toFixed(2)}</td>
                            <td className="px-3 py-3 font-black text-green-700">{d.revenue.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DA</td>
                          </tr>
                        ))}
                      </tbody>
                      {nozzleData.length > 0 && (
                        <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                          <tr>
                            <td colSpan={5} className="px-3 py-2 font-black text-[10px] uppercase tracking-widest text-slate-500">TOTAL</td>
                            <td className="px-3 py-2 font-black text-blue-800">{totals.liters.toFixed(2)} L</td>
                            <td />
                            <td className="px-3 py-2 font-black text-green-800">{totals.computedAmount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DA</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  {/* Récapitulatif par carburant, tous pistolets confondus */}
                  {totals.byFuel.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total par carburant</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {totals.byFuel.map(f => (
                          <div key={f.fuelType} className={cn("p-4 rounded-2xl border", f.fuelType === 'INCONNU' ? "bg-red-50 border-red-200" : "bg-white border-slate-200")}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                              {f.fuelType === 'INCONNU' ? 'Cuve non définie' : f.fuelType} · {f.nozzleCount} pistolet(s)
                            </p>
                            <p className="font-black text-blue-700">{f.liters.toFixed(2)} L</p>
                            <p className="text-[11px] text-slate-500 font-bold">× {f.price.toFixed(2)} DA/L</p>
                            <p className="font-black text-green-700 mt-1">{f.amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DA</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Pompistes ── */}
              {activeSection === 'pompistes' && (
                <motion.div key="pompistes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                  <SectionHeader icon={Users} label="Pompistes de Brigade" />
                  {pompisteGroups.length === 0 ? <Empty label="Aucun pompiste dans cette brigade" /> : (
                    <div className="space-y-3">
                      {pompisteGroups.map(group => (
                        <div key={group.pompisteId} className={cn("p-4 rounded-2xl border-2",
                          group.unassigned ? "border-amber-300 bg-amber-50/40"
                            : group.present ? "border-green-200 bg-white"
                            : "border-red-200 bg-red-50/30 opacity-70")}>
                          <div className="flex items-center gap-3 mb-3">
                            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-black text-white", group.present ? "bg-blue-700" : "bg-red-400")}>
                              {group.name[0] || '?'}
                            </div>
                            <div className="flex-1">
                              <p className="font-black text-slate-800">{group.name}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-[10px] text-slate-500">
                                  {group.pumps.map(p => p.pump?.name || p.pump?.number || '—').join(', ') || 'aucune pompe'}
                                </span>
                                <span className={cn("px-1.5 py-0.5 text-[9px] font-black rounded-full", group.present ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>{group.present ? 'Présent' : 'Absent'}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-blue-700">{group.totalLiters.toFixed(2)} L</p>
                              <p className="font-black text-green-700 text-sm">{group.totalAmount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DA</p>
                            </div>
                          </div>

                          {/* Ce que chaque pompiste a vendu, carburant par carburant */}
                          {group.byFuel.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {group.byFuel.map(f => (
                                <span key={f.fuelType} className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black border",
                                  f.fuelType === 'INCONNU' ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-50 border-slate-200 text-slate-700")}>
                                  {f.fuelType === 'INCONNU' ? 'CUVE NON DÉFINIE' : f.fuelType}
                                  <span className="font-bold text-slate-500"> · {f.liters.toFixed(2)} L × {f.price.toFixed(2)} = </span>
                                  <span className="text-green-700">{f.amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DA</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Comptabilité ── */}
              {activeSection === 'comptabilite' && (
                <motion.div key="comptabilite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-5">
                  <SectionHeader icon={DollarSign} label="Comptabilité" />
                  {!accountingRecord ? (
                    <div className="text-center py-12">
                      <DollarSign className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                      <p className="text-slate-400 font-medium">Aucune comptabilité enregistrée</p>
                      <p className="text-slate-300 text-sm mt-1">Utilisez le bouton "Comptabilité" depuis la carte brigade</p>
                    </div>
                  ) : (
                    <div className="space-y-5">

                      {/* ① Synthèse financière */}
                      <div className="grid grid-cols-3 gap-4">
                        {[
                          { label: 'Total Dû', value: `${accountingRecord.totalDue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA`, color: 'text-blue-700' },
                          { label: 'Espèces Reçues', value: `${accountingRecord.cashReceived.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA`, color: 'text-green-700' },
                          { label: 'Reste', value: `${accountingRecord.rest.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA`, color: Math.abs(accountingRecord.rest) < 1 ? 'text-green-700' : 'text-red-700' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white rounded-2xl p-4 border border-slate-100 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
                            <p className={cn("font-black text-lg", color)}>{value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <span className={cn("px-2 py-1 rounded-full text-[10px] font-black", accountingRecord.status === 'completed' ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700")}>
                          {accountingRecord.status === 'completed' ? '✓ Comptabilisée' : 'En cours'}
                        </span>
                        {accountingRecord.createdBy && <span className="text-[10px] text-slate-500 font-bold">par {accountingRecord.createdBy}</span>}
                      </div>

                      {/* ② Vérification des cuves */}
                      {Object.keys(accountingRecord.cuveVerifications || {}).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vérification Cuves</p>
                          {(Object.entries(accountingRecord.cuveVerifications) as [string, { verified: boolean; corrected: boolean; correctedValue?: number }][]).map(([tankId, ver]) => {
                            const tank = tanks.find(t => t.id === tankId);
                            return (
                              <div key={tankId} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100">
                                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", ver.verified ? "bg-green-500" : "bg-slate-300")} />
                                <span className="font-black text-slate-700 text-sm flex-1">{tank?.name || tankId}</span>
                                {ver.corrected && ver.correctedValue !== undefined && (
                                  <span className="text-[10px] font-black px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Corrigé → {ver.correctedValue.toLocaleString('fr-FR')} L</span>
                                )}
                                <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-full", ver.verified ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                                  {ver.verified ? (ver.corrected ? 'Non conforme' : 'Conforme') : 'Non vérifié'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ③ Vérification des pistolets */}
                      {Object.keys(accountingRecord.nozzleVerifications || {}).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vérification Pistolets</p>
                          {(Object.entries(accountingRecord.nozzleVerifications) as [string, { verified: boolean; corrected: boolean; correctedValue?: number }][]).map(([nozzleId, ver]) => {
                            const nozzle = pumpNozzles.find(n => n.id === nozzleId);
                            const pump = pumps.find(p => p.id === nozzle?.pumpId);
                            return (
                              <div key={nozzleId} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100">
                                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", ver.verified ? "bg-green-500" : "bg-slate-300")} />
                                <div className="flex-1">
                                  <span className="font-black text-slate-700 text-sm">{nozzle?.name || nozzleId}</span>
                                  <span className="text-[10px] text-slate-400 ml-2">{pump?.name}</span>
                                </div>
                                {ver.corrected && ver.correctedValue !== undefined && (
                                  <span className="text-[10px] font-black px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Corrigé → {ver.correctedValue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</span>
                                )}
                                <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-full", ver.verified ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                                  {ver.verified ? (ver.corrected ? 'Non conforme' : 'Conforme') : 'Non vérifié'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ④ Comparaison Cuves vs Pistolets */}
                      {(accountingRecord.tankSummary || []).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Comparaison Cuves / Pistolets</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-blue-900 text-white">
                                <tr>{['Cuve', 'Sortie Cuve', 'Pistolets', 'Écart', 'Valeur'].map(h => (
                                  <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>
                                ))}</tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {(accountingRecord.tankSummary as any[]).map((ts: any) => {
                                  const tank = tanks.find(t => t.id === ts.tankId);
                                  return (
                                    <tr key={ts.tankId} className={cn("hover:bg-slate-50", Math.abs(ts.ecart) < 2 ? "" : "bg-red-50/30")}>
                                      <td className="px-3 py-2 font-black text-slate-800">{tank?.name || ts.tankId}</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{(ts.diff || 0).toFixed(1)} L</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{((ts.diff || 0) - (ts.ecart || 0)).toFixed(1)} L</td>
                                      <td className={cn("px-3 py-2 font-black", Math.abs(ts.ecart) < 2 ? "text-green-700" : "text-red-700")}>{(ts.ecart || 0) > 0 ? '+' : ''}{(ts.ecart || 0).toFixed(1)} L</td>
                                      <td className={cn("px-3 py-2 font-black text-sm", (ts.ecartMoney || 0) > 0 ? "text-amber-700" : "text-green-700")}>{(ts.ecartMoney || 0).toFixed(0)} DA</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {(accountingRecord.nozzleSummary || []).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Détails Pistolets</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-900 text-white">
                                <tr>{['Pistolet', 'Pompe', 'Début', 'Fin', 'Litres', 'Montant'].map(h => (
                                  <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>
                                ))}</tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {(accountingRecord.nozzleSummary as any[]).map((ns: any) => {
                                  const nozzle = pumpNozzles.find(n => n.id === ns.nozzleId);
                                  const pump = pumps.find(p => p.id === nozzle?.pumpId);
                                  return (
                                    <tr key={ns.nozzleId} className="hover:bg-slate-50">
                                      <td className="px-3 py-2 font-black text-slate-800">{nozzle?.name || ns.nozzleId}</td>
                                      <td className="px-3 py-2 text-slate-600">{pump?.name || '—'}</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{(ns.startIdx || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{(ns.endIdx || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                                      <td className="px-3 py-2 font-black text-blue-700">{(ns.liters || 0).toFixed(2)} L</td>
                                      <td className="px-3 py-2 font-black text-green-700">{(ns.revenue || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* ⑧ Résumé des Agents (Pompistes) */}
                      {accountingRecord.pompisteSummary && Object.keys(accountingRecord.pompisteSummary).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Détails Comptabilité Pompistes</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-blue-900 text-white">
                                <tr>{['Pompiste', 'Piste', 'Théorique', 'Espèces', 'Justif.', 'Écart'].map(h => (
                                  <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>
                                ))}</tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {Object.entries(accountingRecord.pompisteSummary).map(([pompisteId, data]: [string, any]) => {
                                  const pompiste = pompistes.find(p => p.id === pompisteId);
                                  const track = tracks.find(t => t.id === data.trackId);
                                  return (
                                    <tr key={pompisteId} className="hover:bg-slate-50">
                                      <td className="px-3 py-2 font-black text-slate-800">{pompiste?.name || pompisteId}</td>
                                      <td className="px-3 py-2 text-slate-600">{track?.name || data.trackName || '—'}</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{(data.theoretical || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{(data.cashReceived || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</td>
                                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{(data.justifTotal || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</td>
                                      <td className={cn("px-3 py-2 font-black text-[11px]", (data.ecart || 0) < 0 ? "text-green-700" : (data.ecart || 0) > 0 ? "text-red-700" : "text-slate-600")}>
                                        {(data.ecart || 0) > 0 ? '+' : ''}{(data.ecart || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MAD
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* ⑤ Décalage par agent */}
                      {Object.keys(accountingRecord.decalageSummary || {}).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Décalage par Agent</p>
                          {Object.entries(accountingRecord.decalageSummary).map(([workerId, d]: [string, any]) => {
                            const pompiste = pompistes.find(p => p.id === workerId);
                            return (
                              <div key={workerId} className={cn("flex items-center gap-3 p-3 rounded-xl border", d.money < 0 ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100")}>
                                <div className="w-8 h-8 bg-blue-700 text-white rounded-lg flex items-center justify-center font-black text-xs">{pompiste?.name[0] || '?'}</div>
                                <div className="flex-1">
                                  <p className="font-black text-slate-800 text-sm">{pompiste?.name || workerId}</p>
                                  <p className="text-[10px] text-slate-500">{d.liters?.toFixed(2)} L</p>
                                </div>
                                <div className="text-right">
                                  <p className={cn("font-black text-sm", d.money < 0 ? "text-red-700" : "text-amber-700")}>{d.money > 0 ? '+' : ''}{d.money?.toFixed(0)} DA</p>
                                  <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full", d.money < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                                    {d.money < 0 ? 'BONUS' : 'RETENUE'}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ⑥ Reste affecté */}
                      {accountingRecord.restAssignedWorkerId && Math.abs(accountingRecord.restAssignedAmount || 0) > 0.01 && (
                        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                          <p className="text-[10px] font-black text-amber-900 uppercase tracking-widest mb-2">Reste Affecté</p>
                          {(() => {
                            const isChef = accountingRecord.restAssignedWorkerType === 'chef_brigade';
                            const worker = isChef
                              ? brigadeChefs.find(c => c.id === accountingRecord.restAssignedWorkerId)
                              : pompistes.find(p => p.id === accountingRecord.restAssignedWorkerId);
                            return (
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-black text-slate-800">{worker?.name || accountingRecord.restAssignedWorkerId}</p>
                                  <span className="text-[9px] font-black px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">{isChef ? 'Chef de Brigade' : 'Pompiste'}</span>
                                </div>
                                <div className="text-right">
                                  <p className="font-black text-amber-800">{(accountingRecord.restAssignedAmount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</p>
                                  <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full", (accountingRecord.rest || 0) < 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                                    {(accountingRecord.rest || 0) < 0 ? 'BONUS' : 'RETENUE'}
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* ⑦ Justifications Clients / TAG / TPE / Dépenses */}
                      {(accountingRecord.justifications || []).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Justifications Clients / TAG / TPE / Dépenses</p>
                          {(accountingRecord.justifications || []).map(j => {
                            const client = clients.find(c => c.id === j.clientId);
                            const track = tracks.find(t => t.id === j.trackId);
                            const pompiste = pompistes.find(p => p.id === j.pompisteId);
                            const isExpense = j.justificationType === 'EXPENSE';
                            const label = j.clientName || client?.name || j.notes || j.justificationType || 'Justification';
                            const typeLabel = isExpense ? 'DÉPENSE' : (j.justificationType || 'CLIENT');
                            return (
                              <div key={j.id} className={cn('flex items-center justify-between p-3 rounded-xl border', isExpense ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100')}>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-bold text-slate-700">{isExpense ? '🧾 ' : ''}{label}</span>
                                    <span className={cn('text-[9px] font-black px-2 py-0.5 rounded-full', isExpense ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{typeLabel}</span>
                                  </div>
                                  <div className="text-[9px] text-slate-500 mt-1 space-x-2">
                                    {isExpense && j.expenseCategory ? (
                                      <span className="font-black text-emerald-700">{j.expenseCategory}</span>
                                    ) : null}
                                    {isExpense && j.notes ? <span>{j.notes}</span> : null}
                                    {j.fuelType && <span>{j.fuelType}</span>}
                                    {track && <span>{track.name}</span>}
                                    {pompiste && <span>{pompiste.name}</span>}
                                    {j.liters ? <span>{j.liters.toLocaleString('fr-FR')} L</span> : null}
                                  </div>
                                  {/* Où l'argent est ALLÉ : un TAG / TPE crédite un compte
                                      bancaire, et la fiche doit le nommer — c'est là qu'on
                                      vérifie que la ligne existe bien dans son historique. */}
                                  {/* Une dépense a sa contrepartie dans l'écran Dépenses :
                                      on le dit ici, c'est là qu'on la retrouve. */}
                                  {isExpense && (
                                    <p className="text-[9px] font-black mt-1 text-emerald-600">
                                      → Dépenses (Carburant) · payée sur les espèces de la brigade
                                    </p>
                                  )}
                                  {(j.justificationType === 'TAG' || j.justificationType === 'TPE') && (
                                    <p className={cn('text-[9px] font-black mt-1',
                                      j.bankAccountId ? 'text-emerald-600' : 'text-red-500')}>
                                      {j.bankAccountId
                                        ? `→ ${bankAccounts.find(a => a.id === j.bankAccountId)?.name || 'Compte bancaire'}`
                                        : 'Aucun compte crédité — argent absent des soldes bancaires'}
                                    </p>
                                  )}
                                </div>
                                <span className="font-black text-blue-700">{j.amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Ventes Magasin ── */}
              {activeSection === 'ventes' && (
                <motion.div key="ventes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                  <SectionHeader icon={ShoppingBag} label={`Ventes Magasin (${brigadeSales.length})`} />
                  {brigadeSales.length === 0 ? (
                    <Empty label="Aucune vente magasin pendant cette brigade" />
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-700 text-white">
                            <tr>{['Date', 'Total', 'Mode Paiement', 'Statut'].map(h => (
                              <th key={h} className="px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {brigadeSales.map(s => (
                              <tr key={s.id} className="hover:bg-slate-50">
                                <td className="px-3 py-3 text-[11px] font-bold text-slate-700">{new Date(s.date).toLocaleDateString('fr-FR')}</td>
                                <td className="px-3 py-3 font-black text-green-700">{s.total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</td>
                                <td className="px-3 py-3 text-slate-600 text-[11px]">{s.paymentMode}</td>
                                <td className="px-3 py-3"><span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-green-100 text-green-700">{s.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                            <tr>
                              <td className="px-3 py-2 font-black text-[10px] uppercase text-slate-500">TOTAL</td>
                              <td className="px-3 py-2 font-black text-green-800">{brigadeSales.reduce((s, x) => s + x.total, 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA</td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </motion.div>
              )}

              {/* ── Historique ── */}
              {activeSection === 'historique' && (
                <motion.div key="historique" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-4">
                  <SectionHeader icon={Activity} label="Historique des Actions" />
                  <div className="space-y-3">
                    {[
                      brigade.startTimestamp && { time: brigade.startTimestamp, label: 'Brigade créée', color: 'bg-blue-500' },
                      brigade.status === 'Ouverte' && brigade.startTimestamp && { time: brigade.startTimestamp, label: 'Brigade activée', color: 'bg-green-500' },
                      brigade.endTimestamp && { time: brigade.endTimestamp, label: 'Brigade clôturée', color: 'bg-slate-500' },
                      accountingRecord && { time: brigade.endTimestamp || brigade.date, label: `Comptabilité enregistrée (${accountingRecord.status})`, color: 'bg-emerald-500' },
                    ].filter(Boolean).map((ev: any, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100">
                        <div className={cn("w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0", ev.color)} />
                        <div>
                          <p className="font-black text-slate-800 text-sm">{ev.label}</p>
                          <p className="text-[10px] text-slate-400">{new Date(ev.time).toLocaleString('fr-FR')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-3 shrink-0">
          <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black uppercase text-blue-900 border-2 border-blue-900 rounded-xl hover:bg-blue-50 transition-colors bg-white">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
          <button onClick={onClose} className="flex-1 bg-gradient-to-r from-blue-900 to-blue-800 text-white font-black uppercase tracking-widest rounded-xl py-2.5 text-[10px] hover:shadow-lg transition-all hover:-translate-y-0.5">
            FERMER
          </button>
        </div>
      </motion.div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const SectionHeader: React.FC<{ icon: React.FC<any>; label: string }> = ({ icon: Icon, label }) => (
  <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
    <div className="w-8 h-8 rounded-xl bg-blue-900 flex items-center justify-center"><Icon className="w-4 h-4 text-yellow-400" /></div>
    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">{label}</h3>
  </div>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-center py-12 text-slate-400 text-sm">{label}</div>
);

export default BrigadeDetailModal;
