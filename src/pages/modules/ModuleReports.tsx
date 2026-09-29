/**
 * ─── Rapports d'une partie ─────────────────────────────────────────────────────
 * Trois lectures de la même période, au choix :
 *   • RAPPORT DÉTAILLÉ    — le bilan complet (ventes, achats, dettes, alertes…) ;
 *   • BÉNÉFICES PAR PRODUIT — ce que chaque produit a rapporté, avec recherche
 *     par nom ou par code-barres ;
 *   • ANALYSES            — les courbes de la période, produit par produit, plus
 *     ce qui se vend le mieux et ce qui ne se vend pas.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useRef, useState } from 'react';
import { BarChart3, FileText, Printer, Calendar, LineChart, Tags } from 'lucide-react';
import { ModuleKey, MODULES } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import { PageHeader, Tabs, formatDate } from '@/src/components/biz/Kit';
import { computeModuleReport } from '@/src/lib/bizReporting';
import { computeModuleAnalytics, Granularity } from '@/src/lib/bizAnalytics';
import ReportView from '@/src/components/biz/ReportView';
import AnalyticsView from '@/src/components/biz/AnalyticsView';
import ProductProfitView from '@/src/components/biz/ProductProfitView';
import { ModuleFiche, printFiche } from '@/src/components/biz/ReportFiche';

type Tab = 'rapport' | 'produits' | 'analyses';

export default function ModuleReports({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const { settings, treasuryTransactions, expenses } = useAppState();
  const st = biz.state;
  const ficheRef = useRef<HTMLDivElement>(null);

  const firstDay = new Date(); firstDay.setDate(1);
  const [from, setFrom] = useState(firstDay.toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [range, setRange] = useState({ from, to });
  const [tab, setTab] = useState<Tab>('rapport');
  /** Découpage du temps des graphiques — automatique tant qu'on n'y touche pas. */
  const [grain, setGrain] = useState<Granularity | undefined>(undefined);

  // Le grand livre entre dans le calcul : la caisse de la partie doit compter les
  // virements partis de son coffre, comme le fait l'écran Caisse Générale. Les
  // dépenses de la station imputées à cette partie sont ses charges — payées en
  // espèces, elles sortent de SA caisse.
  const report = useMemo(
    () => computeModuleReport(st, moduleKey, range.from, range.to, treasuryTransactions, expenses),
    [st, moduleKey, range, treasuryTransactions, expenses]);
  // Les analyses servent AUSSI l'onglet « Bénéfices par produit » : c'est la même
  // table de produits, donc le même gain — les deux écrans ne peuvent pas diverger.
  const analytics = useMemo(
    () => computeModuleAnalytics(st, moduleKey, range.from, range.to, grain, expenses),
    [st, moduleKey, range, grain, expenses]);

  const generate = () => setRange({ from, to });

  return (
    <div className="space-y-6 animate-fade-in max-w-[1600px] mx-auto pb-16">
      <PageHeader icon={BarChart3} title="Rapports" subtitle={`${cfg.label} — bilan, bénéfices par produit & analyses`}
        actions={<button className="btn-primary" onClick={() => printFiche(ficheRef.current)}><Printer className="w-4 h-4" /> Imprimer la fiche</button>} />

      {/* Date range */}
      <div className="card-glass p-4 flex flex-wrap items-end gap-3">
        <div><label className="label-field">Date début</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field !w-auto" /></div>
        <div><label className="label-field">Date fin</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field !w-auto" /></div>
        <button className="btn-secondary" onClick={generate}><FileText className="w-4 h-4" /> Générer le rapport</button>
        <span className="ml-auto text-xs text-slate-400 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Période: {formatDate(range.from)} → {formatDate(range.to)}</span>
      </div>

      <Tabs
        tabs={[
          { id: 'rapport', label: 'Rapport détaillé', icon: FileText },
          { id: 'produits', label: 'Bénéfices par produit', icon: Tags },
          { id: 'analyses', label: 'Analyses', icon: LineChart },
        ]}
        active={tab}
        onChange={id => setTab(id as Tab)}
      />

      {tab === 'rapport' && <ReportView report={report} />}
      {tab === 'produits' && <ProductProfitView analytics={analytics} />}
      {tab === 'analyses' && <AnalyticsView analytics={analytics} onGranularity={setGrain} />}

      {/* Off-screen printable fiche */}
      <ModuleFiche ref={ficheRef} report={report} settings={settings} />
    </div>
  );
}
