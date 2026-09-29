import React, { useMemo, useState } from 'react';
import {
  Wallet, PiggyBank, ArrowDownCircle, ArrowUpCircle, Plus, TrendingUp, TrendingDown, Layers,
  Edit2, Trash2, Boxes, ShoppingCart, CreditCard, Banknote, Beaker,
  Clock, UserCheck, PlayCircle, StopCircle, Scale, Eye, Flame, Car, Percent,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizCaisseTx, BizSession, BizSale } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import { computeModuleReport, caisseFlowOf } from '@/src/lib/bizReporting';
import { computeBizWorkforce, WorkforceWorker } from '@/src/lib/workforceReporting';
import { ServiceWorksPanel } from '@/src/components/biz/WorkforceView';
import { useBizSessions } from '@/src/hooks/useBizSessions';
import { CloseSessionModal } from './ModulePOS';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Switch, Confirm,
  Table, Tabs, EmptyState, ViewToggle, CardGrid, GlassCard, RowActions, ActionBtn,
  money, formatDate, PeriodFilter, Period, inPeriod, periodRange,
} from '@/src/components/biz/Kit';

export default function ModuleCaisse({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'caisse');
  const app = useAppState();
  const { caisse, comptoir, destructions } = biz.state;

  const [tab, setTab] = useState<'tresorerie' | 'travaux' | 'sessions'>('tresorerie');
  // Tableau par défaut sur les deux listes de l'écran — transactions de caisse
  // et historique des sessions. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<BizCaisseTx | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizCaisseTx | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);

  /**
   * ─── CET ÉCRAN COMPTE COMME LE RAPPORT, SUR LA MÊME FENÊTRE ────────────────
   *
   * Les chiffres de cet écran étaient calculés ici, à la main, et ils ne
   * disaient pas la même chose que le Rapport de la partie ni que les Rapports
   * Généraux :
   *
   *   • « Ventes encaissées » ne lisait que les factures du point de vente et
   *     IGNORAIT LES INTERVENTIONS — dans un atelier de lavage, c'est-à-dire
   *     l'essentiel de la recette ;
   *   • achats, dépenses et salaires étaient sommés sur TOUTES LES DATES, sous
   *     un filtre de période qui laissait croire le contraire ;
   *   • « Résultat après pertes » retranchait les destructions d'un flux
   *     d'ESPÈCES : ni un solde de caisse, ni un gain — aucun autre écran
   *     n'affichait ce nombre.
   *
   * Tout passe désormais par `computeModuleReport` — le moteur du rapport — sur
   * la fenêtre rendue par `periodRange`, celle-là même qui filtre les listes de
   * l'écran. Les deux écrans ne peuvent plus se contredire.
   */
  const range = useMemo(() => periodRange(period, from, to), [period, from, to]);
  const report = useMemo(
    () => computeModuleReport(biz.state, moduleKey, range.from, range.to, app.treasuryTransactions, app.expenses),
    [biz.state, moduleKey, range, app.treasuryTransactions, app.expenses]);

  /** La fenêtre lue, dite en toutes lettres sous les cartes de la période. */
  const rangeLabel = period === 'all'
    ? 'toutes les dates'
    : `${range.from ? formatDate(range.from) : 'origine'} → ${range.to ? formatDate(range.to) : "aujourd'hui"}`;

  /**
   * Les mouvements du tiroir, TOUTES DATES — la seule définition, celle que
   * lisent aussi le rapport de la partie et l'écran Caisse Générale.
   *
   * Les DESTRUCTIONS (produits périmés, cassés, volés) n'y figurent pas : elles
   * ne sortent pas d'argent du tiroir, elles détruisent de la MARCHANDISE. Leur
   * coût pèse sur le gain de la période, pas sur le solde d'espèces — la valeur
   * du stock a déjà baissé d'autant.
   */
  const movements = report.caisseMovements;

  const totals = useMemo(() => {
    const balance = report.caisseBalance;
    const comptoirValue = comptoir.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    const destroyed = (destructions || []).filter(d => !d.recovered).reduce((s, d) => s + d.value, 0);
    return {
      balance, cashIn: report.caisseFlow.in, cashOut: report.caisseFlow.out,
      stockValue: report.stockValue, comptoirValue, destroyed,
      tresorerie: balance + report.stockValue + comptoirValue,
    };
  }, [report, comptoir, destructions]);

  // ── Period flows — lus sur les MÊMES mouvements que le solde ──
  const flow = useMemo(() => {
    const rows = movements.filter(m => inPeriod(m.date, period, from, to));
    const f = caisseFlowOf(rows);
    return { inTotal: f.in, outTotal: f.out, net: f.in - f.out };
  }, [movements, period, from, to]);

  /** La part des dépenses de la période qui est bien sortie du tiroir. */
  const expensesCash = useMemo(
    () => report.expenses
      .filter(e => e.kind === 'Dépense' && e.paidInCash)
      .reduce((s, e) => s + e.amount, 0),
    [report]);

  /**
   * Les employés de l'activité et TOUT ce qu'ils ont fait sur la période — le
   * même calcul que le rapport général. Réservé aux activités de service
   * (Lavage & Vidange) : une cafétéria n'a pas de travaux nominatifs.
   */
  const crew: WorkforceWorker[] = useMemo(
    () => (cfg.isService ? computeBizWorkforce(biz.state, moduleKey, range.from, range.to) : []),
    [cfg.isService, biz.state, moduleKey, range]);

  /**
   * Les chiffres de l'équipe, repris à l'identique du rapport général : une
   * intervention faite à deux n'est comptée qu'UNE fois dans le total de
   * l'atelier, alors qu'elle compte bien pour chacun des deux.
   */
  const crewTotals = useMemo(() => {
    const jobs = new Set<string>();
    let earned = 0, base = 0, due = 0;
    crew.forEach(w => {
      w.works.forEach(x => jobs.add(x.id));
      earned += w.earned; base += w.worksBase; due += w.dueNow;
    });
    return { jobs: jobs.size, earned, base, due, active: crew.filter(w => w.works.length > 0).length };
  }, [crew]);

  // ── Destructions de la période (pertes de marchandise) ─────────────────────
  const destructionsInPeriod = useMemo(
    () => (destructions || [])
      .filter(d => !d.recovered && inPeriod(d.date, period, from, to))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [destructions, period, from, to]);
  const destroyedInPeriod = destructionsInPeriod.reduce((s, d) => s + d.value, 0);

  // ── Category breakdown ──
  const byCat = (type: 'deposit' | 'withdraw') => {
    const m: Record<string, number> = {};
    caisse.filter(c => c.type === type && inPeriod(c.date, period, from, to)).forEach(c => { const k = c.category || 'Autre'; m[k] = (m[k] || 0) + c.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const deposCats = byCat('deposit'); const withCats = byCat('withdraw');
  const maxDepo = Math.max(1, ...deposCats.map(x => x[1])); const maxWith = Math.max(1, ...withCats.map(x => x[1]));

  const txList = useMemo(() => [...caisse]
    .filter(c => inPeriod(c.date, period, from, to) && (!catFilter || (c.category || 'Autre') === catFilter))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [caisse, period, from, to, catFilter]);

  const del = () => { if (toDelete) { biz.remove('caisse', toDelete.id); toast.success('Transaction supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Wallet} title="Caisse"
        subtitle={`${cfg.label} — trésorerie, mouvements${cfg.isService ? ', travaux des employés' : ''} & sessions de travail`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Dépôt / Retrait</button> : undefined} />

      <Tabs
        tabs={[
          { id: 'tresorerie', label: 'Trésorerie', icon: Wallet },
          // Le travail des employés n'a d'onglet que là où il existe : une
          // activité de service (Lavage & Vidange) paie ses employés SUR leurs
          // interventions, et c'est ici qu'on les paie.
          ...(cfg.isService ? [{ id: 'travaux', label: 'Travaux des employés', icon: Car }] : []),
          { id: 'sessions', label: 'Sessions de travail', icon: Clock },
        ]}
        active={tab}
        onChange={id => setTab(id as 'tresorerie' | 'travaux' | 'sessions')}
      />

      {tab === 'sessions' && <SessionsPanel moduleKey={moduleKey} />}

      {/* ── Le travail des employés, employé par employé ────────────────────
          La caisse d'un atelier ne sert pas qu'à compter les billets : c'est
          d'ici que l'on règle les employés payés au pourcentage. Ce qu'ils ont
          fait sur la période est donc lisible sur place — chaque intervention,
          chaque prestation, la base retenue, leur part et ce qui leur reste dû
          — au lieu d'obliger à ouvrir les Rapports Généraux pour le savoir. */}
      {tab === 'travaux' && (
        <div className="space-y-4">
          <div className="card-glass p-4 space-y-2">
            <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
            <p className="text-[11px] text-slate-400">
              Même période que l'onglet Trésorerie — {rangeLabel}. Le <b>reste à payer</b> d'un employé couvre en
              revanche TOUTES les dates : un travail d'un mois passé jamais réglé reste dû.
            </p>
          </div>
          <div className="card-glass p-4 sm:p-5">
            <ServiceWorksPanel workers={crew} from={range.from} to={range.to} />
          </div>
        </div>
      )}

      {tab === 'tresorerie' && <>
      {/* Hero banners */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <div className="flex items-center gap-2 text-blue-200"><Wallet className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Solde de caisse</span></div>
          <p className="text-4xl font-black tabular-nums mt-2 text-[#FFB800]">{money(totals.balance)}</p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {/* Entrées et sorties lues sur les mouvements du tiroir : une dépense
                réglée par la banque n'y figure pas — elle n'en est jamais sortie. */}
            <div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase text-blue-200 font-bold">Encaissements</p><p className="font-black tabular-nums text-emerald-300">{money(totals.cashIn)}</p></div>
            <div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase text-blue-200 font-bold">Décaissements</p><p className="font-black tabular-nums text-red-300">{money(totals.cashOut)}</p></div>
          </div>
          <p className="text-[11px] text-blue-200 mt-3">
            Les dépenses réglées <strong>en espèces</strong> sortent de cette caisse — la caisse générale n'est
            jamais débitée à sa place.
          </p>
        </div>
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100"><PiggyBank className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Trésorerie globale</span></div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(totals.tresorerie)}</p>
          <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Caisse</p><p className="font-black tabular-nums">{money(totals.balance)}</p></div>
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Comptoir</p><p className="font-black tabular-nums">{money(totals.comptoirValue)}</p></div>
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Stock</p><p className="font-black tabular-nums">{money(totals.stockValue)}</p></div>
          </div>
          {totals.destroyed > 0 && (
            <p className="text-[11px] text-emerald-100 mt-3">
              Dont <span className="font-black text-red-200">{money(totals.destroyed)}</span> de marchandise détruite,
              déjà retirée du stock.
            </p>
          )}
        </div>
      </div>

      {/* Period */}
      <div className="card-glass p-4"><PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} /></div>

      {/* ── Les espèces de la période ─────────────────────────────────────
          Ce que le tiroir a reçu et rendu entre les deux bornes, lu sur les
          mêmes mouvements que le solde affiché en tête. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Wallet className="w-5 h-5" /> Espèces de la période</h3>
        <span className="text-[11px] font-bold text-slate-400">{rangeLabel}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-emerald-600"><ArrowDownCircle className="w-5 h-5" /><span className="text-xs font-bold uppercase">Entrées</span></div><p className="text-2xl font-black tabular-nums text-emerald-600 mt-2">+{money(flow.inTotal)}</p></div>
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-red-600"><ArrowUpCircle className="w-5 h-5" /><span className="text-xs font-bold uppercase">Sorties</span></div><p className="text-2xl font-black tabular-nums text-red-600 mt-2">−{money(flow.outTotal)}</p></div>
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-[#003087]"><TrendingUp className="w-5 h-5" /><span className="text-xs font-bold uppercase">Flux net</span></div><p className={`text-2xl font-black tabular-nums mt-2 ${flow.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(flow.net)}</p></div>
      </div>

      {/* ── L'activité de la période — LES MÊMES CHIFFRES QUE LE RAPPORT ───
          Tout ce bloc sort de `computeModuleReport` : carte par carte, c'est
          ligne pour ligne ce qu'affichent le Rapport de la partie et les
          Rapports Généraux sur la même période. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5" /> Activité de la période</h3>
        <span className="text-[11px] font-bold text-slate-400">
          {rangeLabel} — identique au rapport de l'activité
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Chiffre d'affaires" value={money(report.salesTotal)} tone="blue"
          sub={`${report.counts.sales} opération(s)${cfg.isService ? ' — ventes & interventions' : ''}`} />
        <StatCard icon={Banknote} label="Ventes encaissées" value={money(report.salesPaid)} tone="green"
          sub={cfg.isService ? 'factures ET interventions réglées' : 'ce que les ventes ont fait rentrer'} />
        <StatCard icon={ShoppingCart} label="Achats payés" value={money(report.purchasesPaid)} tone="purple"
          sub={`sur ${money(report.purchasesTotal)} facturés`} />
        <StatCard icon={CreditCard} label="Dépenses" value={money(report.expensesTotal)} tone="red"
          sub={`dont ${money(expensesCash)} en espèces`} />
        <StatCard icon={Percent} label="Marge brute" value={money(report.grossMargin)} tone="blue"
          sub={`CA − ${money(report.cogs)} de marchandises`} />
        <StatCard icon={Banknote} label="Salaires versés" value={money(report.salariesPaid)} tone="amber"
          sub={`+ ${money(report.acomptesPeriod)} d'acomptes`} />
        <StatCard icon={Flame} label="Destructions" value={money(report.destroyedValue)} tone="red"
          sub="marchandise perdue" />
        <StatCard icon={Scale} label="Gain net" value={money(report.netGain)}
          tone={report.netGain >= 0 ? 'green' : 'red'}
          sub="marge − dépenses − salaires − pertes" />
      </div>
      <p className="text-[11px] text-slate-400 px-1 leading-relaxed">
        Le <b>flux net</b> ({money(flow.net)}) est de l'ARGENT : ce que le tiroir a reçu moins ce qu'il a rendu sur la
        période. Le <b>gain net</b> ({money(report.netGain)}) est un RÉSULTAT : il retranche du chiffre d'affaires le
        coût des marchandises vendues, les dépenses, les salaires et les pertes, qu'ils aient été réglés en espèces ou
        non. Les deux ne peuvent pas être égaux — un achat payé d'avance vide le tiroir sans rien coûter tant que la
        marchandise n'est pas vendue. Le <b>solde de caisse</b> affiché en tête, lui, couvre toutes les dates.
      </p>

      {/* ── Le travail des employés, à un clic ──────────────────────────────
          Une caisse d'atelier sert aussi à payer des employés au pourcentage :
          ce qu'ils ont fait sur la période s'annonce ici, et le détail complet
          — chaque intervention, chaque prestation, sa base et sa part —
          s'ouvre dans son onglet. */}
      {cfg.isService && crew.length > 0 && (
        <button onClick={() => setTab('travaux')}
          className="w-full text-left rounded-2xl p-4 sm:p-5 text-white transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#0e7490,#22d3ee)', boxShadow: '0 10px 28px rgba(14,116,144,0.30)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <Car className="w-6 h-6" />
            </span>
            <div className="min-w-0">
              <p className="font-black text-[15px]">Travaux des employés — {rangeLabel}</p>
              <p className="text-[12px] text-cyan-50">
                Qui a travaillé, sur quoi, et ce qu'il faut lui payer. Cliquez pour tout déplier.
              </p>
            </div>
            <span className="ml-auto text-xs font-black bg-white/20 rounded-lg px-3 py-1.5 shrink-0">
              Voir le détail
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
            <div className="rounded-xl bg-white/15 p-3">
              <p className="text-[10px] uppercase font-black text-cyan-50">Interventions</p>
              <p className="font-black tabular-nums text-lg">{crewTotals.jobs}</p>
            </div>
            <div className="rounded-xl bg-white/15 p-3">
              <p className="text-[10px] uppercase font-black text-cyan-50">Employés au travail</p>
              <p className="font-black tabular-nums text-lg">{crewTotals.active} <span className="text-xs font-bold">/ {crew.length}</span></p>
            </div>
            <div className="rounded-xl bg-white/15 p-3">
              <p className="text-[10px] uppercase font-black text-cyan-50">Part des employés</p>
              <p className="font-black tabular-nums text-lg">{money(crewTotals.earned)}</p>
              <p className="text-[10px] text-cyan-50">sur {money(crewTotals.base)} de base retenue</p>
            </div>
            <div className="rounded-xl bg-white/15 p-3">
              <p className="text-[10px] uppercase font-black text-cyan-50">Reste à leur payer</p>
              <p className="font-black tabular-nums text-lg">{money(crewTotals.due)}</p>
              <p className="text-[10px] text-cyan-50">travaux non encore réglés, toutes dates</p>
            </div>
          </div>
        </button>
      )}

      {/* Destructions de la période — le détail de la marchandise perdue */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Flame className="w-5 h-5" /> Destructions de la période
          </h3>
          <span className="font-black tabular-nums text-red-600">−{money(destroyedInPeriod)}</span>
        </div>
        {destructionsInPeriod.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Aucune destruction sur la période</p>
        ) : (
          <>
            <Table head={<>
              <th className="table-head">Date</th><th className="table-head">Produit</th>
              <th className="table-head">Provenance</th><th className="table-head">Quantité</th>
              <th className="table-head">Motif</th><th className="table-head">Agent</th>
              <th className="table-head text-right">Coût</th>
            </>}>
              {destructionsInPeriod.slice(0, 100).map(d => (
                <tr key={d.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(d.date)}</td>
                  <td className="table-cell font-bold text-slate-700">{d.productName}</td>
                  <td className="table-cell">
                    <Badge tone={d.source === 'stock' ? 'primary' : 'neutral'}>
                      {d.source === 'stock' ? 'Gestion de stock' : 'Comptoir'}
                    </Badge>
                  </td>
                  <td className="table-cell tabular-nums">{d.qty} <span className="text-xs text-slate-400">{d.unit}</span></td>
                  <td className="table-cell text-slate-500">{d.reason || '—'}</td>
                  <td className="table-cell text-slate-500">{d.createdBy || '—'}</td>
                  <td className="table-cell text-right tabular-nums font-bold text-red-600">{money(d.value)}</td>
                </tr>
              ))}
            </Table>
            <p className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400">
              La marchandise détruite ne sort pas d'espèces de la caisse : elle diminue la valeur du stock et le
              résultat de la partie. Le détail complet est dans « Gestion de stock → Historique destructions ».
            </p>
          </>
        )}
      </div>

      {/* Category breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryCard title="Dépôts par catégorie" icon={ArrowDownCircle} rows={deposCats} max={maxDepo} tone="emerald" onClick={setCatFilter} active={catFilter} />
        <CategoryCard title="Retraits par catégorie" icon={ArrowUpCircle} rows={withCats} max={maxWith} tone="red" onClick={setCatFilter} active={catFilter} />
      </div>

      {/* Transactions history */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5" /> Transactions de caisse</h3>
          <div className="flex items-center gap-3">
            {catFilter && <button onClick={() => setCatFilter(null)} className="text-xs text-slate-400 hover:text-red-500">Retirer filtre: {catFilter}</button>}
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
        {txList.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">Aucune transaction sur la période</p> : view === 'table' ? (
          <Table head={<>
            <th className="table-head">Date</th><th className="table-head">Sens</th>
            <th className="table-head">Description</th><th className="table-head">Catégorie</th>
            <th className="table-head text-right">Montant</th><th className="table-head text-right">Actions</th>
          </>}>
            {txList.map(tx => (
              <tr key={tx.id}>
                <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(tx.date)}</td>
                <td className="table-cell">
                  <Badge tone={tx.type === 'deposit' ? 'success' : 'danger'}>{tx.type === 'deposit' ? 'Dépôt' : 'Retrait'}</Badge>
                </td>
                <td className="table-cell text-slate-600">{tx.description || (tx.type === 'deposit' ? 'Dépôt' : 'Retrait')}</td>
                <td className="table-cell">{tx.category ? <Badge tone="neutral">{tx.category}</Badge> : <span className="text-slate-400">—</span>}</td>
                <td className={`table-cell text-right tabular-nums font-black ${tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {tx.type === 'deposit' ? '+' : '−'}{money(tx.amount)}
                </td>
                <td className="table-cell text-right">
                  <RowActions>
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(tx)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(tx)} />}
                  </RowActions>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="divide-y divide-slate-100">
            {txList.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.type === 'deposit' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                  {tx.type === 'deposit' ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}</div>
                <div className="flex-1 min-w-0"><p className="font-bold text-slate-700 truncate">{tx.description || (tx.type === 'deposit' ? 'Dépôt' : 'Retrait')}</p>
                  <p className="text-xs text-slate-400">{formatDate(tx.date)} {tx.category && <>• <Badge tone="neutral">{tx.category}</Badge></>}</p></div>
                <span className={`font-black tabular-nums ${tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>{tx.type === 'deposit' ? '+' : '−'}{money(tx.amount)}</span>
                <div className="flex items-center gap-1">
                  {perm.modifier && <button onClick={() => setForm(tx)} className="w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 flex items-center justify-center"><Edit2 className="w-4 h-4" /></button>}
                  {perm.supprimer && <button onClick={() => setToDelete(tx)} className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Le solde, mouvement par mouvement — ventes encaissées, achats réglés,
          dépenses en espèces, salaires et virements. C'est la lecture complète
          du chiffre affiché en tête : un solde qu'on ne peut pas relire n'est
          pas un solde, c'est une affirmation. */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Wallet className="w-5 h-5" /> Détail du solde de caisse
          </h3>
          <span className={`font-black tabular-nums ${flow.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {money(flow.net)} sur la période
          </span>
        </div>
        {(() => {
          const rows = movements.filter(m => inPeriod(m.date, period, from, to));
          if (rows.length === 0) return <p className="text-center text-slate-400 text-sm py-8">Aucun mouvement sur la période</p>;
          return (
            <Table head={<>
              <th className="table-head">Date</th><th className="table-head">Nature</th>
              <th className="table-head">Description</th><th className="table-head text-right">Montant</th>
            </>}>
              {rows.slice(0, 200).map(m => (
                <tr key={m.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="table-cell"><Badge tone="neutral">{m.nature}</Badge></td>
                  <td className="table-cell text-slate-600">{m.label}</td>
                  <td className={`table-cell text-right tabular-nums font-bold ${m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                  </td>
                </tr>
              ))}
            </Table>
          );
        })()}
      </div>

      </>}

      {form && <TxForm moduleKey={moduleKey} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la transaction" message="Confirmer la suppression ?" onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Sessions de travail ───────────────────────────────────────────────────────
/**
 * History of every POS work session with, for each one: the cashier, the opening
 * float, the theoretical takings, what was actually declared at closing and the
 * resulting décalage. The opening float is deliberately excluded from the
 * theoretical figure — the worker owes only what they cashed in during the shift.
 *
 * Chaque session appartient à un employé : l'employé connecté ne voit ici que
 * les siennes, l'administrateur les voit toutes et peut clôturer celle qu'un
 * employé aurait oubliée.
 */
function SessionsPanel({ moduleKey }: { moduleKey: ModuleKey }) {
  const biz = useBiz(moduleKey);
  const { sales } = biz.state;
  const { visibleSessions: sessions, isAdmin, canClose } = useBizSessions(moduleKey);

  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [worker, setWorker] = useState('all');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [viewing, setViewing] = useState<BizSession | null>(null);
  // Tableau par défaut : une session se juge sur son décalage, aligné en
  // colonne à côté du théorique et du déclaré. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [closing, setClosing] = useState<BizSession | null>(null);

  /** Live figures — a still-open session has no frozen numbers yet. */
  const figuresOf = (s: BizSession) => {
    const own = sales.filter(x => x.sessionId === s.id && x.status !== 'retournée');
    const total = own.reduce((a, x) => a + x.total, 0);
    const theoretical = s.theoretical ?? own.reduce((a, x) => a + x.paid, 0);
    const credit = s.credit ?? own.reduce((a, x) => a + x.rest, 0);
    const declared = s.closingCash;
    const decalage = s.decalage ?? (declared === undefined ? undefined : declared - theoretical);
    return { count: own.length, total, theoretical, credit, declared, decalage, sales: own };
  };

  const workerNames = useMemo(
    () => Array.from(new Set(sessions.map(s => s.workerName))).sort(),
    [sessions]);

  const filtered = useMemo(() => [...sessions]
    .filter(s =>
      inPeriod(s.openedAt, period, from, to) &&
      (worker === 'all' || s.workerName === worker) &&
      (status === 'all' || s.status === status) &&
      (sessionFilter === 'all' || s.id === sessionFilter))
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()),
    [sessions, period, from, to, worker, status, sessionFilter]);

  const totals = useMemo(() => filtered.reduce((acc, s) => {
    const f = figuresOf(s);
    acc.theoretical += f.theoretical;
    acc.declared += f.declared || 0;
    acc.credit += f.credit;
    acc.decalage += f.decalage || 0;
    acc.openingCash += s.openingCash;
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, { theoretical: 0, declared: 0, credit: 0, decalage: 0, openingCash: 0 }), [filtered, sales]);

  /** Per-worker recap over the filtered period. */
  const perWorker = useMemo(() => {
    const m: Record<string, { sessions: number; theoretical: number; declared: number; credit: number; decalage: number }> = {};
    filtered.forEach(s => {
      const f = figuresOf(s);
      (m[s.workerName] ||= { sessions: 0, theoretical: 0, declared: 0, credit: 0, decalage: 0 });
      m[s.workerName].sessions += 1;
      m[s.workerName].theoretical += f.theoretical;
      m[s.workerName].declared += f.declared || 0;
      m[s.workerName].credit += f.credit;
      m[s.workerName].decalage += f.decalage || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].theoretical - a[1].theoretical);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sales]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Sessions" value={filtered.length} tone="blue" />
        <StatCard icon={TrendingUp} label="Théorique espèces" value={money(totals.theoretical)} tone="green" />
        <StatCard icon={Banknote} label="Déclaré à la fermeture" value={money(totals.declared)} tone="purple" />
        <StatCard icon={Scale} label="Décalage cumulé" value={money(totals.decalage)} tone={totals.decalage < 0 ? 'red' : 'amber'} />
      </div>

      <div className="card-glass p-4 space-y-3">
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <div className="flex flex-wrap items-center gap-3">
          <Select value={worker} onChange={e => setWorker(e.target.value)} className="!w-auto min-w-[170px]">
            <option value="all">Tous les employés</option>
            {workerNames.map(w => <option key={w} value={w}>{w}</option>)}
          </Select>
          <Select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} className="!w-auto min-w-[190px]">
            <option value="all">Toutes les sessions</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.ref} — {s.workerName} — {formatDate(s.openedAt)}</option>
            ))}
          </Select>
          <div className="flex gap-1.5">
            {(['all', 'open', 'closed'] as const).map(st => (
              <button key={st} onClick={() => setStatus(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === st ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                {st === 'all' ? 'Toutes' : st === 'open' ? 'Ouvertes' : 'Clôturées'}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400 ml-auto">
            Fonds d'ouverture cumulés : {money(totals.openingCash)} (hors théorique)
          </span>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {/* Per-worker recap */}
      {perWorker.length > 0 && (
        <div className="card-glass overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-black text-[#002d87] flex items-center gap-2"><UserCheck className="w-5 h-5" /> Récapitulatif par employé</h3>
          </div>
          <Table head={<>
            <th className="table-head">Employé</th><th className="table-head">Sessions</th>
            <th className="table-head">Théorique</th><th className="table-head">Déclaré</th>
            <th className="table-head">Crédits</th><th className="table-head text-right">Décalage</th>
          </>}>
            {perWorker.map(([name, v]) => (
              <tr key={name}>
                <td className="table-cell font-bold">{name}</td>
                <td className="table-cell tabular-nums">{v.sessions}</td>
                <td className="table-cell tabular-nums">{money(v.theoretical)}</td>
                <td className="table-cell tabular-nums">{money(v.declared)}</td>
                <td className="table-cell tabular-nums text-amber-600">{money(v.credit)}</td>
                <td className={`table-cell text-right tabular-nums font-bold ${v.decalage < 0 ? 'text-red-600' : v.decalage > 0 ? 'text-[#003087]' : 'text-emerald-600'}`}>
                  {money(v.decalage)}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* Session history */}
      {filtered.length === 0 ? (
        <EmptyState icon={Clock} title="Aucune session"
          message="Les sessions ouvertes depuis le point de vente apparaîtront ici avec tout leur détail." />
      ) : (
        view === 'grid' ? (
        /* ── Les sessions en cartes ───────────────────────────────────────
           Le même verdict que la ligne du tableau : ce que la caisse aurait
           dû contenir, ce que l'employé a déclaré, et l'écart entre les deux. */
        <CardGrid>
          {filtered.map(s => {
            const f = figuresOf(s);
            return (
              <GlassCard key={s.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-800 truncate">{s.ref}</h3>
                    <p className="text-xs text-slate-400 truncate">{s.workerName}</p>
                  </div>
                  {s.status === 'open' ? <Badge tone="warning">Ouverte</Badge> : <Badge tone="success">Clôturée</Badge>}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {new Date(s.openedAt).toLocaleString('fr-DZ')}
                  {s.closedAt ? ` → ${new Date(s.closedAt).toLocaleString('fr-DZ')}` : ''}
                </p>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Théorique</p>
                    <p className="font-black text-slate-700 tabular-nums text-xs">{money(f.theoretical)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Déclaré</p>
                    <p className="font-black text-slate-700 tabular-nums text-xs">{f.declared === undefined ? '—' : money(f.declared)}</p>
                  </div>
                  <div className={`rounded-xl p-2 text-center ${f.decalage === undefined ? 'bg-slate-50' : f.decalage < 0 ? 'bg-red-50' : f.decalage > 0 ? 'bg-blue-50' : 'bg-emerald-50'}`}>
                    <p className="text-[9px] uppercase font-bold text-slate-400">Décalage</p>
                    <p className={`font-black tabular-nums text-xs ${f.decalage === undefined ? 'text-slate-300' : f.decalage < 0 ? 'text-red-600' : f.decalage > 0 ? 'text-[#003087]' : 'text-emerald-600'}`}>
                      {f.decalage === undefined ? '—' : money(f.decalage)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <span className="text-[11px] text-slate-400">Fond {money(s.openingCash)} • {f.count} vente(s)</span>
                  <RowActions>
                    {s.status === 'open' && canClose(s) && (
                      <ActionBtn icon={StopCircle} tone="red" title="Clôturer cette session" onClick={() => setClosing(s)} />
                    )}
                    <ActionBtn icon={Eye} tone="blue" title="Détails" onClick={() => setViewing(s)} />
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
        ) : (
        <div className="card-glass overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5" /> Historique des sessions</h3>
          </div>
          <Table head={<>
            <th className="table-head">Session</th><th className="table-head">Employé</th>
            <th className="table-head">Ouverture</th><th className="table-head">Fermeture</th>
            <th className="table-head">Fond</th><th className="table-head">Ventes</th>
            <th className="table-head">Théorique</th><th className="table-head">Déclaré</th>
            <th className="table-head">Crédits</th><th className="table-head text-right">Décalage</th>
            <th className="table-head text-right">—</th>
          </>}>
            {filtered.map(s => {
              const f = figuresOf(s);
              return (
                <tr key={s.id}>
                  <td className="table-cell font-bold">{s.ref}</td>
                  <td className="table-cell">{s.workerName}</td>
                  <td className="table-cell whitespace-nowrap text-xs">{new Date(s.openedAt).toLocaleString('fr-DZ')}</td>
                  <td className="table-cell whitespace-nowrap text-xs">
                    {s.closedAt ? new Date(s.closedAt).toLocaleString('fr-DZ') : <Badge tone="warning">Ouverte</Badge>}
                  </td>
                  <td className="table-cell tabular-nums text-slate-400">{money(s.openingCash)}</td>
                  <td className="table-cell tabular-nums">{f.count}</td>
                  <td className="table-cell tabular-nums">{money(f.theoretical)}</td>
                  <td className="table-cell tabular-nums">{f.declared === undefined ? '—' : money(f.declared)}</td>
                  <td className="table-cell tabular-nums text-amber-600">{money(f.credit)}</td>
                  <td className={`table-cell text-right tabular-nums font-bold ${f.decalage === undefined ? 'text-slate-300' : f.decalage < 0 ? 'text-red-600' : f.decalage > 0 ? 'text-[#003087]' : 'text-emerald-600'}`}>
                    {f.decalage === undefined ? '—' : money(f.decalage)}
                  </td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Clôture : le propriétaire de la session, ou l'admin
                          quand l'employé est parti sans clôturer. */}
                      {s.status === 'open' && canClose(s) && (
                        <button onClick={() => setClosing(s)} title="Clôturer cette session"
                          className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center">
                          <StopCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => setViewing(s)} title="Détails"
                        className="w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-50 flex items-center justify-center">
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
        )
      )}

      {viewing && <SessionDetail session={viewing} figures={figuresOf(viewing)} onClose={() => setViewing(null)} />}
      {closing && <CloseSessionModal moduleKey={moduleKey} session={closing} onClose={() => setClosing(null)} />}

      {!isAdmin && (
        <p className="text-[11px] text-slate-400">
          Vous ne voyez que vos propres sessions de travail : celles de vos collègues ne vous
          appartiennent pas et ne peuvent pas être modifiées depuis votre poste.
        </p>
      )}
    </div>
  );
}

function SessionDetail({ session, figures, onClose }: {
  session: BizSession;
  figures: { count: number; total: number; theoretical: number; credit: number; declared?: number; decalage?: number; sales: BizSale[] };
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} icon={Clock} size="2xl"
      title={`Session ${session.ref}`} subtitle={`${session.workerName} — ${formatDate(session.openedAt)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Ouverte le</p><p className="font-bold text-slate-700 text-sm">{new Date(session.openedAt).toLocaleString('fr-DZ')}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Clôturée le</p><p className="font-bold text-slate-700 text-sm">{session.closedAt ? new Date(session.closedAt).toLocaleString('fr-DZ') : '—'}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Fond d'ouverture</p><p className="font-bold text-slate-700 text-sm tabular-nums">{money(session.openingCash)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700 text-sm">{session.status === 'open' ? 'Ouverte' : 'Clôturée'}</p></div>
        </div>

        {/* Traçabilité : qui a ouvert la caisse, qui l'a effectivement clôturée. */}
        {(session.openedByName || session.closedByName) && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">Ouverte par</p>
              <p className="font-bold text-slate-700 text-sm">{session.openedByName || session.workerName}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">Clôturée par</p>
              <p className="font-bold text-slate-700 text-sm">{session.closedByName || '—'}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Chiffre d'affaires</p><p className="font-black text-slate-700 tabular-nums">{money(figures.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Théorique espèces</p><p className="font-black text-emerald-600 tabular-nums">{money(figures.theoretical)}</p></div>
          <div className="rounded-xl bg-purple-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Déclaré</p><p className="font-black text-purple-600 tabular-nums">{figures.declared === undefined ? '—' : money(figures.declared)}</p></div>
          <div className={`rounded-xl p-3 text-center ${(figures.decalage || 0) < 0 ? 'bg-red-50' : 'bg-blue-50'}`}>
            <p className="text-[10px] uppercase font-bold text-slate-400">Décalage</p>
            <p className={`font-black tabular-nums ${(figures.decalage || 0) < 0 ? 'text-red-600' : 'text-[#003087]'}`}>
              {figures.decalage === undefined ? '—' : money(figures.decalage)}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
          Crédits accordés pendant la session : <strong>{money(figures.credit)}</strong> — ils justifient d'autant
          l'écart entre le théorique et les espèces comptées. Le fond d'ouverture de {money(session.openingCash)} n'est
          pas compté dans le théorique.
        </div>

        {session.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Notes</p>
            <p className="text-sm text-slate-600">{session.notes}</p>
          </div>
        )}

        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Ventes de la session ({figures.count})</p>
          {figures.sales.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune vente</p>
          ) : (
            <Table head={<>
              <th className="table-head">Réf</th><th className="table-head">Heure</th><th className="table-head">Client</th>
              <th className="table-head">Articles</th><th className="table-head">Total</th>
              <th className="table-head">Payé</th><th className="table-head">Reste</th>
            </>}>
              {figures.sales.map(s => (
                <tr key={s.id}>
                  <td className="table-cell font-bold">{s.ref}</td>
                  <td className="table-cell text-xs">{new Date(s.date).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="table-cell">{s.clientName}</td>
                  <td className="table-cell text-xs text-slate-500">
                    {s.items.map(i => `${i.productName} ×${i.detailQty ? `${i.detailQty}${i.detailUnit || ''}` : i.qty}`).join(', ')}
                  </td>
                  <td className="table-cell tabular-nums">{money(s.total)}</td>
                  <td className="table-cell tabular-nums text-emerald-600">{money(s.paid)}</td>
                  <td className="table-cell tabular-nums text-red-600">{money(s.rest)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CategoryCard({ title, icon: Icon, rows, max, tone, onClick, active }: {
  title: string; icon: React.ElementType; rows: [string, number][]; max: number; tone: 'emerald' | 'red'; onClick: (c: string | null) => void; active: string | null;
}) {
  return (
    <div className="card-glass p-5">
      <h3 className="font-black text-[#002d87] flex items-center gap-2 mb-3"><Icon className="w-5 h-5" /> {title}</h3>
      {rows.length === 0 ? <p className="text-slate-400 text-sm">Aucune donnée</p> : (
        <div className="space-y-2.5">
          {rows.map(([cat, val]) => (
            <button key={cat} onClick={() => onClick(active === cat ? null : cat)} className={`w-full text-left ${active === cat ? 'opacity-100' : ''}`}>
              <div className="flex items-center justify-between text-sm mb-1"><span className="font-semibold text-slate-600">{cat}</span><span className="font-bold tabular-nums text-slate-700">{money(val)}</span></div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${(val / max) * 100}%` }} /></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TxForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizCaisseTx | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const isEdit = !!initial;
  const [type, setType] = useState<'deposit' | 'withdraw'>(initial?.type || 'deposit');
  const [amount, setAmount] = useState(initial?.amount || 0);
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState(initial?.category || '');
  const [description, setDescription] = useState(initial?.description || '');
  const save = () => {
    if (amount <= 0) { toast.error('Montant requis'); return; }
    const tx: BizCaisseTx = { id: initial?.id || newId(), type, amount: Number(amount), date: new Date(date).toISOString(), category, description };
    if (isEdit) biz.update('caisse', tx); else biz.add('caisse', tx);
    toast.success(isEdit ? 'Transaction modifiée' : 'Transaction enregistrée'); onClose();
  };
  return (
    <Modal open onClose={onClose} icon={Wallet} size="md" title={isEdit ? 'Modifier la transaction' : 'Dépôt / Retrait'}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Valider'}</button></>}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setType('deposit')} className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${type === 'deposit' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}><ArrowDownCircle className="w-4 h-4" /> Dépôt (Entrée)</button>
          <button onClick={() => setType('withdraw')} className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${type === 'withdraw' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}><ArrowUpCircle className="w-4 h-4" /> Retrait (Sortie)</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)"><Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Catégorie"><Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Apport, Retrait, Frais…" /></Field>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
