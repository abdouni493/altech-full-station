import React, { useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { motion } from "motion/react";
import { X, Printer, Download } from "lucide-react";
import { exportElementToPdf, printDocumentMode } from "../lib/pdf";
import {
  Brigade, Pump, Tank, Pompiste, BrigadeChef, PumpNozzle, Track, ShopSale, StationSettings, BrigadeAccounting
} from "../store/AppContext";
import {
  brigadeNozzleRows, brigadePompisteGroups, brigadeTankRows, brigadeTotals, justifiedByPompiste,
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
  onClose: () => void;
}

const fmt = (n: number) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDT = (iso?: string, fallback?: string) => {
  if (iso) { const d = new Date(iso); if (!isNaN(d.getTime())) return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  return fallback || '—';
};

const BrigadeFicheModal: React.FC<Props> = ({
  brigade, pumps, tanks, pompistes, brigadeChefs, pumpNozzles, tracks, settings, accounting, onClose
}) => {
  const ficheRef = useRef<HTMLDivElement>(null);
  const chef = brigadeChefs.find(c => c.id === brigade.chefId);

  // Tout le calcul de la fiche vient de `lib/brigadeCalc` : chaque pistolet est
  // valorisé au carburant de SA cuve, et le regroupement se fait par pompiste —
  // les pistes n'existent plus, s'y fier rendait la fiche entièrement vide.
  const ctx = useMemo(
    () => ({ pumps, tanks, pumpNozzles, pompistes, settings }),
    [pumps, tanks, pumpNozzles, pompistes, settings]);

  const nozzleRows = useMemo(() => brigadeNozzleRows(brigade, ctx), [brigade, ctx]);

  // Justifications regroupées par pompiste (montants + lignes à détailler)
  const justifByPompiste = useMemo(() => {
    const m: Record<string, NonNullable<BrigadeAccounting['justifications']>> = {};
    (accounting?.justifications || []).forEach(j => {
      // Les dépenses ont leur propre section : on ne les répète pas ici.
      if (j.justificationType === 'EXPENSE') return;
      const pid = j.pompisteId || '_unassigned';
      (m[pid] = m[pid] || []).push(j);
    });
    return m;
  }, [accounting]);
  const justifTotals = useMemo(
    () => justifiedByPompiste(accounting?.justifications), [accounting]);

  // Les dépenses de brigade justifient le reste sans être rattachées à un
  // pompiste : on les liste à part et on les ajoute au total justifié.
  const expenseJustifs = useMemo(
    () => (accounting?.justifications || []).filter(j => j.justificationType === 'EXPENSE'),
    [accounting]);
  const expensesTotal = useMemo(
    () => expenseJustifs.reduce((s, j) => s + (j.amount || 0), 0), [expenseJustifs]);

  // Détail Pompiste → Pompe → Pistolet, avec la ventilation par carburant.
  const pumpBreakdown = useMemo(
    () => brigadePompisteGroups(brigade, ctx, nozzleRows, justifTotals),
    [brigade, ctx, nozzleRows, justifTotals]);

  const tankRows = useMemo(
    () => brigadeTankRows(brigade, ctx, nozzleRows), [brigade, ctx, nozzleRows]);

  const totals = useMemo(
    () => brigadeTotals(nozzleRows, pumpBreakdown), [nozzleRows, pumpBreakdown]);

  const [pdfBusy, setPdfBusy] = React.useState(false);

  const exportPDF = async () => {
    if (!ficheRef.current || pdfBusy) return;
    setPdfBusy(true);
    const ok = await exportElementToPdf(
      ficheRef.current,
      `Fiche_Brigade_${(chef?.name || brigade.id).replace(/\s+/g, '_')}_${brigade.date}.pdf`,
      { header: `${settings.name || 'Station'} — Fiche de Brigade — ${brigade.date}` }
    );
    setPdfBusy(false);
    if (!ok) alert("Échec de la génération du PDF. Réessayez ou utilisez Imprimer → Enregistrer en PDF.");
  };

  // ── Printable / displayable fiche body ──────────────────────────────────────
  const ficheBody = (
    <div className="p-8 space-y-6 text-left bg-white not-italic" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* HEADER */}
      <div className="flex items-start justify-between pb-5 border-b-2 border-blue-900">
        <div className="flex items-start gap-4">
          {(settings.logoUrl || settings.logo) ? (
            <img src={settings.logoUrl || settings.logo} alt="logo" className="w-16 h-16 object-contain rounded-xl border border-slate-200" />
          ) : (
            <div className="w-16 h-16 bg-blue-900 rounded-xl flex items-center justify-center"><span className="text-yellow-400 font-black text-xl">⛽</span></div>
          )}
          <div>
            <p className="font-black text-xl text-blue-900">{settings.name || 'Station'}</p>
            <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest">FICHE DE BRIGADE — CARBURANT</p>
          </div>
        </div>
        <div className="text-right text-sm text-slate-600 space-y-0.5">
          {settings.address && <p>{settings.address}</p>}
          {settings.phone && <p>Tél: {settings.phone}</p>}
          {settings.email && <p>{settings.email}</p>}
          {settings.fiscalId && <p>NIF: {settings.fiscalId}</p>}
          {settings.rc && <p>RC: {settings.rc}</p>}
        </div>
      </div>
      <div className="w-full h-0.5 bg-gradient-to-r from-blue-900 via-yellow-400 to-blue-900" />

      {/* Brigade Info Banner */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'N° Brigade', value: brigade.id.slice(0, 8) },
          { label: 'Chef', value: chef?.name || 'N/A' },
          { label: 'Début', value: fmtDT(brigade.startDatetime, `${brigade.date} ${brigade.startTime || ''}`) },
          { label: 'Fin', value: fmtDT(brigade.endDatetime, `${brigade.date} ${brigade.endTime || ''}`) },
        ].map(item => (
          <div key={item.label} className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-center">
            <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">{item.label}</p>
            <p className="font-black text-blue-900 text-xs">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Pompistes présents */}
      {pumpBreakdown.length > 0 && (
        <section>
          <FicheHeader num="1" label="Pompistes Présents" />
          <div className="flex flex-wrap gap-2">
            {pumpBreakdown.map(b => (
              <span key={b.pompisteId} className={`px-3 py-1.5 rounded-lg text-xs font-black ${b.unassigned ? 'bg-amber-50 border border-amber-300 text-amber-800' : b.present ? 'bg-blue-50 border border-blue-200 text-blue-900' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                {b.name}
                <span className={`font-bold ${b.unassigned ? 'text-amber-500' : 'text-blue-400'}`}>
                  {' · '}{b.pumps.map(p => p.pump?.name || p.pump?.number || '—').join(', ') || 'aucune pompe'}
                </span>
                {!b.present && <span className="ml-1 text-red-500">(absent)</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 2: Cuves */}
      {tankRows.length > 0 && (
        <section>
          <FicheHeader num="2" label="Cuves" />
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-blue-900 text-white">
              {['Cuve', 'Type', 'Début (°/L)', 'Fin (°/L)', 'Consommé (L)'].map(h => <Th key={h} dark>{h}</Th>)}
            </tr></thead>
            <tbody>
              {tankRows.map(({ tank, startDeg, startL, endDeg, endL, cuveDiff, measured }) => (
                <tr key={tank.id} className="border-b border-slate-200">
                  <Td><strong>{tank.name}</strong></Td>
                  <Td><span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-black">{tank.type}</span></Td>
                  <Td className="tabular-nums">{startDeg}° · {fmt(startL)}</Td>
                  <Td className="tabular-nums">
                    {measured
                      ? <>{endDeg}° · {fmt(endL)}</>
                      : <span className="text-slate-400 italic">jauge non relevée</span>}
                  </Td>
                  {/* Sans jauge de fin, le « consommé » ne serait qu'un reflet des
                      pistolets : on ne l'affiche pas comme une mesure de cuve. */}
                  <Td><strong className="text-blue-700">{measured ? fmt(cuveDiff) : '—'}</strong></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* SECTION 3: Pompiste → Pompe → Pistolet + comptabilité pompiste */}
      {pumpBreakdown.length > 0 && (
        <section>
          <FicheHeader num="3" label="Détail par Pompiste / Pompe / Pistolet" />
          {pumpBreakdown.map(({ pompisteId, name, present, unassigned, pumps: pumpList, byFuel, totalLiters: tL, totalAmount, theoretical: theo, collected: cash, ecart }) => {
            const justifs = justifByPompiste[pompisteId] || [];
            return (
              <div key={pompisteId} className={`mb-4 rounded-xl overflow-hidden border-2 ${unassigned ? 'border-amber-300' : 'border-blue-200'}`}>
                <div className={`px-4 py-3 flex items-center justify-between ${unassigned ? 'bg-gradient-to-r from-amber-700 to-amber-600' : 'bg-gradient-to-r from-blue-900 to-blue-800'}`}>
                  <div>
                    <p className="font-black text-white text-sm">
                      Pompiste: {name}{!present && <span className="ml-2 text-red-200">(absent)</span>}
                    </p>
                    <p className="text-[10px] text-blue-300">
                      Pompes: {pumpList.map(p => p.pump?.name || p.pump?.number || '—').join(', ') || '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-yellow-400">{fmt(totalAmount)} DA</p>
                    <p className="text-[10px] text-blue-300">{tL.toFixed(2)} L</p>
                  </div>
                </div>

                {/* Ventilation par carburant : un pompiste tient souvent des
                    pistolets de plusieurs carburants, chacun à son prix. */}
                {byFuel.length > 0 && (
                  <div className="px-4 py-2 bg-blue-50/60 border-t border-blue-100 flex flex-wrap gap-2">
                    {byFuel.map(f => (
                      <span key={f.fuelType} className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${f.fuelType === 'INCONNU' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-blue-200 text-blue-900'}`}>
                        {f.fuelType === 'INCONNU' ? 'CARBURANT INCONNU' : f.fuelType}
                        <span className="font-bold text-slate-500">
                          {' '}· {f.liters.toFixed(2)} L × {f.price.toFixed(2)} ={' '}
                        </span>
                        <span className="text-green-700">{fmt(f.amount)} DA</span>
                      </span>
                    ))}
                  </div>
                )}

                {pumpList.map(({ pump, nozzles, totalLiters: pumpL, totalAmount: pumpA, byFuel: pumpFuels }) => (
                  nozzles.length > 0 && (
                    <div key={pump?.id || 'sans-pompe'} className="border-t border-blue-100">
                      <div className="px-4 py-2 bg-slate-50 flex items-center justify-between border-b border-slate-200">
                        <span className="text-[10px] font-black text-slate-600 uppercase">
                          🔧 {pump?.name || 'Pompe supprimée'}
                          {/* Le type de la pompe n'est qu'un miroir de son premier
                              pistolet : on liste les carburants réellement servis. */}
                          {' '}({pumpFuels.map(f => f.fuelType).join(' + ') || '—'})
                        </span>
                        <span className="text-[10px] font-black text-slate-600">{pumpL.toFixed(2)} L — {fmt(pumpA)} DA</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead><tr className="bg-slate-100">
                          {['Pistolet', 'Carburant', 'Idx Début', 'Idx Fin', 'Différence (L)', 'Prix/L', 'Montant'].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border border-slate-200">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {nozzles.map(d => (
                            <tr key={d.nozzle.id} className="border-b border-slate-100">
                              <td className="px-3 py-2 font-bold border border-slate-200">⚡ {d.nozzle.name}</td>
                              <td className="px-3 py-2 border border-slate-200">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${d.missingFuelType ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-800'}`}>
                                  {d.fuelType || 'CUVE NON DÉFINIE'}
                                </span>
                                <span className="block text-[9px] text-slate-400 mt-0.5">{d.tank?.name || '—'}</span>
                              </td>
                              <td className="px-3 py-2 tabular-nums text-slate-500 border border-slate-200">{fmt(d.startIdx)}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-500 border border-slate-200">{fmt(d.endIdx)}</td>
                              {/* Fin − début, la différence affichée telle qu'elle
                                  est calculée ; une saisie inversée est signalée
                                  au lieu d'être ramenée à 0 en silence. */}
                              <td className={`px-3 py-2 font-black border border-slate-200 ${d.inverted ? 'text-red-600' : 'text-blue-700'}`}>
                                {fmt(d.endIdx)} − {fmt(d.startIdx)} = {d.liters.toFixed(2)} L
                                {d.inverted && <span className="block text-[9px] font-bold">index de fin inférieur au début</span>}
                              </td>
                              <td className="px-3 py-2 text-slate-500 border border-slate-200">{d.price.toFixed(2)}</td>
                              <td className="px-3 py-2 font-black text-green-700 border border-slate-200">{fmt(d.amount)} DA</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 border-t-2 border-slate-200">
                            <td colSpan={4} className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-500 border border-slate-200">Total {pump?.name || ''}</td>
                            <td className="px-3 py-1.5 font-black text-blue-800 border border-slate-200">{pumpL.toFixed(2)} L</td>
                            <td className="border border-slate-200" />
                            <td className="px-3 py-1.5 font-black text-green-800 border border-slate-200">{fmt(pumpA)} DA</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )
                ))}

                {/* Comptabilité pompiste */}
                <div className="px-4 py-3 bg-white border-t border-blue-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                  <div><p className="text-[9px] text-slate-400 font-black uppercase">Théorique</p><p className="font-black text-blue-900">{fmt(theo)} DA</p></div>
                  <div><p className="text-[9px] text-slate-400 font-black uppercase">Espèces reçues</p><p className="font-black text-green-700">{fmt(cash)} DA</p></div>
                  <div><p className="text-[9px] text-slate-400 font-black uppercase">Justifié</p><p className="font-black text-slate-700">{fmt(justifs.reduce((s, j) => s + (j.amount || 0), 0))} DA</p></div>
                  <div><p className="text-[9px] text-slate-400 font-black uppercase">Écart</p><p className={`font-black ${Math.abs(ecart) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>{fmt(ecart)} DA</p></div>
                </div>

                {/* Justifications */}
                {justifs.length > 0 && (
                  <div className="px-4 pb-3 bg-white">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Justifications</p>
                    <table className="w-full text-[11px]">
                      <thead><tr className="bg-slate-50">
                        {['Type', 'Détail', 'Litres', 'Montant'].map(h => <th key={h} className="px-2 py-1 text-left text-[9px] font-black text-slate-400 uppercase border border-slate-200">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {justifs.map(j => (
                          <tr key={j.id} className="border-b border-slate-100">
                            <td className="px-2 py-1 font-black border border-slate-200">{j.justificationType || 'CLIENT'}{j.paymentMode ? ` (${j.paymentMode})` : ''}</td>
                            <td className="px-2 py-1 border border-slate-200">{j.clientName || '—'}</td>
                            <td className="px-2 py-1 tabular-nums border border-slate-200">{(j.liters || 0).toFixed(2)}</td>
                            <td className="px-2 py-1 font-black text-slate-700 border border-slate-200">{fmt(j.amount)} DA</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* SECTION — Dépenses justifiées (sorties d'espèces de la brigade) */}
      {expenseJustifs.length > 0 && (
        <section>
          <FicheHeader num="3b" label="Dépenses justifiées" />
          <p className="text-[10px] text-slate-500 mb-1">
            Payées sur les espèces de la brigade — reprises dans l'écran Dépenses (Carburant).
          </p>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-blue-900 text-white">
              {['Dépense', 'Catégorie', 'Pompiste', 'Description', 'Montant'].map(h => <Th key={h} dark>{h}</Th>)}
            </tr></thead>
            <tbody>
              {expenseJustifs.map(j => (
                <tr key={j.id} className="border-b border-slate-200">
                  <Td><strong>🧾 {j.clientName || 'Dépense'}</strong></Td>
                  <Td className="text-slate-600">{j.expenseCategory || '—'}</Td>
                  <Td className="text-slate-600">{pompistes.find(p => p.id === j.pompisteId)?.name || '—'}</Td>
                  <Td className="text-slate-600">{j.notes || '—'}</Td>
                  <Td className="tabular-nums"><strong className="text-slate-800">{fmt(j.amount || 0)} DA</strong></Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <Td colSpan={4}><strong className="text-[10px] uppercase text-slate-500">Total dépenses</strong></Td>
                <Td className="tabular-nums"><strong className="text-red-700">{fmt(expensesTotal)} DA</strong></Td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {/* SECTION 4: Alertes Décalage — écart = Δ pistolets − Δ cuve */}
      {tankRows.length > 0 && (
        <section>
          <FicheHeader num="4" label="Alertes Décalage" />
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-blue-900 text-white">
              {['Cuve', 'Δ Cuve (L)', 'Δ Pistolets (L)', 'Écart (L)', 'Montant', 'Statut'].map(h => <Th key={h} dark>{h}</Th>)}
            </tr></thead>
            <tbody>
              {tankRows.map(a => (
                <tr key={a.tank.id} className="border-b border-slate-200">
                  <Td><strong>{a.tank.name}</strong></Td>
                  <Td className="tabular-nums">{a.measured ? a.cuveDiff.toFixed(2) : '—'}</Td>
                  <Td className="tabular-nums">{a.nozzleDiff.toFixed(2)}</Td>
                  <Td className="tabular-nums">{a.measured ? <strong>{a.difference.toFixed(2)}</strong> : '—'}</Td>
                  <Td className="tabular-nums">{a.measured ? `${fmt(a.amount)} DA` : '—'}</Td>
                  <Td>
                    {a.measured ? (
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${a.type === 'CORRECT' ? 'bg-green-100 text-green-700' : a.type === 'RETOUR_CUVE' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>{a.type}</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-slate-100 text-slate-500">NON RELEVÉE</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* SECTION 5: Récapitulatif Financier */}
      <section>
        <FicheHeader num="5" label="Récapitulatif Financier" />

        {/* Litres et montant par carburant, tous pistolets confondus */}
        {totals.byFuel.length > 0 && (
          <table className="w-full text-sm border-collapse mb-4">
            <thead><tr className="bg-blue-900 text-white">
              {['Carburant', 'Pistolets', 'Litres', 'Prix/L', 'Montant'].map(h => <Th key={h} dark>{h}</Th>)}
            </tr></thead>
            <tbody>
              {totals.byFuel.map(f => (
                <tr key={f.fuelType} className="border-b border-slate-200">
                  <Td><strong className={f.fuelType === 'INCONNU' ? 'text-red-600' : ''}>{f.fuelType === 'INCONNU' ? 'Cuve non définie' : f.fuelType}</strong></Td>
                  <Td className="tabular-nums">{f.nozzleCount}</Td>
                  <Td className="tabular-nums"><strong className="text-blue-700">{f.liters.toFixed(2)} L</strong></Td>
                  <Td className="tabular-nums">{f.price.toFixed(2)}</Td>
                  <Td className="tabular-nums"><strong className="text-green-700">{fmt(f.amount)} DA</strong></Td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-100 border-t-2 border-slate-300">
              <Td><strong className="uppercase text-[10px] tracking-widest text-slate-500">Total</strong></Td>
              <Td />
              <Td className="tabular-nums"><strong className="text-blue-800">{totals.liters.toFixed(2)} L</strong></Td>
              <Td />
              <Td className="tabular-nums"><strong className="text-green-800">{fmt(totals.computedAmount)} DA</strong></Td>
            </tr></tfoot>
          </table>
        )}

        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Total Litres Vendus', value: `${totals.liters.toFixed(2)} L` },
            { label: 'Montant Index (calculé)', value: `${fmt(totals.computedAmount)} DA` },
            { label: 'Total Théorique', value: `${fmt(totals.theoretical)} DA` },
            { label: 'Total Espèces Collectées', value: `${fmt(totals.collected)} DA` },
            { label: 'Total Justifications', value: `${fmt(totals.justified + expensesTotal)} DA` },
            ...(expensesTotal > 0 ? [{ label: 'dont Dépenses brigade', value: `${fmt(expensesTotal)} DA` }] : []),
            { label: 'SOLDE NET', value: `${fmt(totals.netBalance - expensesTotal)} DA`, bold: true },
          ].map((row: any, i) => (
            <div key={i} className={`flex justify-between px-4 py-3 rounded-xl border ${row.bold ? 'bg-blue-900 text-white font-black border-blue-900' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-sm">{row.label}</span>
              <span className={`font-black text-sm ${row.bold ? 'text-yellow-400' : 'text-slate-800'}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <div className="pt-6 mt-6 border-t-2 border-slate-300">
        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-6">
          <p>Généré le {new Date().toLocaleString('fr-FR')}</p>
          <p>Créé par: {accounting?.createdBy || (brigade.notes?.startsWith('Créé par:') ? brigade.notes.replace('Créé par:', '').trim() : '—')}</p>
        </div>
        <div className="grid grid-cols-2 gap-16">
          <div>
            <p className="text-sm font-black text-slate-700 mb-8">Signature du Chef de Brigade:</p>
            <div className="border-b-2 border-slate-400 w-full" />
            <p className="text-xs text-slate-500 mt-1">{chef?.name || '_______________'}</p>
          </div>
          <div>
            <p className="text-sm font-black text-slate-700 mb-8">Signature du Gérant:</p>
            <div className="border-b-2 border-slate-400 w-full" />
            <p className="text-xs text-slate-500 mt-1">_______________</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div id="fiche-root" className="modal-shell z-[80]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm print-hidden" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-5xl rounded-[2rem] shadow-2xl relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden border border-slate-100">

        {/* Screen Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 bg-gradient-to-r from-blue-900 to-blue-800 print-hidden">
          <p className="font-black text-yellow-400 uppercase tracking-widest text-sm">📋 Fiche de Brigade</p>
          <div className="flex gap-2">
            <button onClick={exportPDF} disabled={pdfBusy}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-400 text-blue-900 rounded-xl text-[10px] font-black uppercase hover:bg-yellow-300 transition-colors disabled:opacity-60">
              <Download className="w-4 h-4" /> {pdfBusy ? 'Génération…' : 'PDF'}
            </button>
            <button onClick={printDocumentMode}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 text-white rounded-xl text-[10px] font-black uppercase hover:bg-white/30 transition-colors">
              <Printer className="w-4 h-4" /> Imprimer
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg text-white"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* On-screen scrollable content (also captured for PDF) */}
        <div ref={ficheRef} className="flex-1 overflow-y-auto">
          {ficheBody}
        </div>
      </motion.div>

      {/* Print-only portal at document root */}
      {ReactDOM.createPortal(
        <div id="fiche-brigade-print-root" className="print-only-root">{ficheBody}</div>,
        document.body
      )}

      <style>{`
        /* Hidden on screen; revealed only in document-print mode (see index.css). */
        .print-only-root { display: none; }
      `}</style>
    </div>
  );
};

const FicheHeader: React.FC<{ num?: string; label: string }> = ({ num, label }) => (
  <h3 className="font-black text-blue-900 text-sm uppercase tracking-wider mb-3 pb-1 border-b border-blue-200 flex items-center gap-2">
    {num && <span className="w-6 h-6 bg-blue-900 text-yellow-400 rounded-lg flex items-center justify-center text-[11px] shrink-0">{num}</span>}
    {label}
  </h3>
);
const Th: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark }) => (
  <th className={`px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest border ${dark ? 'border-blue-800 text-white' : 'border-slate-200'}`}>{children}</th>
);
const Td: React.FC<{ children: React.ReactNode; className?: string; colSpan?: number }> = ({ children, className, colSpan }) => (
  <td colSpan={colSpan} className={`px-3 py-2 text-sm border border-slate-200 ${className || ''}`}>{children}</td>
);

export default BrigadeFicheModal;
