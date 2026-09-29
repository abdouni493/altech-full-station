/**
 * ─── Vidanges & Lavage ───────────────────────────────────────────────────────
 * Interventions of the Lavage & Vidange part.
 *
 *  • Le client est optionnel — sans client, l'intervention est au nom d'un
 *    « Client de passage ».
 *  • Une intervention porte AUTANT DE PRESTATIONS que nécessaire : un lavage et
 *    une vidange peuvent être créés en une seule fois. Chaque prestation a sa
 *    désignation, son montant et ses employés (base de la paie au pourcentage).
 *  • Une remise peut être appliquée en pourcentage ou en montant fixe ; elle est
 *    déduite du sous-total (prestations + produits).
 *  • Les produits utilisés sont cherchés par nom OU code-barres ; un produit
 *    vendu au détail se saisit dans son unité de détail (ex: 10 L sur 50 L).
 *  • Une intervention s'ouvre TOUJOURS « en attente » : le véhicule arrive
 *    avant que le travail soit fait, et les produits ne sortent du stock qu'à
 *    la finalisation. Le sélecteur de statut de la fiche bascule en
 *    « finalisé » d'un clic, sans la refermer — et le même formulaire sert
 *    plus tard à finaliser un véhicule laissé le matin.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Car, Wrench, Droplets, Plus, Minus, Search, X, User, Users, Wallet, Printer,
  Eye, Edit2, Trash2, Package, PackageSearch, CheckCircle2, Hourglass, Layers,
  Percent, Tag, ScanLine, AlertTriangle, Banknote,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizReparation, BizRepKind, BizPrestation, BizDiscountType,
  BizCar, BizLineItem, BizProduct, BizWorker, detailPrice, discountOf, prestationsOf, formatQty,
  compactRef, productRefLabel, productCarLabel,
} from '@/src/lib/bizConfig';
import { applyRestock, describeRestock, restockPlan, totalRestocked } from '@/src/lib/bizRestock';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, money, formatDate, formatTime, formatDateTime,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import {
  ContactModal, PayDebtModal, PayDebtMeta, withPayment, seedPayments, printInvoice, AskPrintModal,
  stationFromSettings, productMatches as matchesProduct,
} from './_shared';
import { ClientCarPicker } from './ClientCarPicker';
import BarcodeScannerModal from '@/src/components/BarcodeScannerModal';

/**
 * Chaque nature d'intervention porte SA couleur, et c'est la même partout :
 * le bouton qui la crée, la ligne de prestation, le bandeau du formulaire et
 * la pastille de la liste. Un lavage se lit en cyan, une vidange en violet,
 * les deux réunis aux couleurs de la station.
 */
const KIND_META: Record<BizRepKind, {
  label: string; icon: React.ElementType;
  /** Dégradé plein — fonds de bouton et d'en-tête. */
  grad: string;
  /** Ombre portée assortie au dégradé. */
  shadow: string;
  /** Fond tendre et bordure, pour une carte de prestation. */
  soft: string; border: string; text: string;
}> = {
  reparation: {
    label: 'Vidange', icon: Wrench,
    grad: 'linear-gradient(135deg,#6d28d9,#a78bfa)', shadow: '0 8px 20px rgba(109,40,217,0.30)',
    soft: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700',
  },
  lavage: {
    label: 'Lavage', icon: Droplets,
    grad: 'linear-gradient(135deg,#0e7490,#22d3ee)', shadow: '0 8px 20px rgba(14,116,144,0.30)',
    soft: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700',
  },
  mixte: {
    label: 'Lavage + Vidange', icon: Layers,
    grad: 'linear-gradient(135deg,#003087,#0044bb)', shadow: '0 8px 20px rgba(0,48,135,0.32)',
    soft: 'bg-blue-50', border: 'border-blue-200', text: 'text-[#002d87]',
  },
};

/** Kind of the whole intervention, derived from what it actually contains. */
function kindOfPrestations(lines: BizPrestation[], fallback: BizRepKind): BizRepKind {
  if (!lines.length) return fallback === 'mixte' ? 'lavage' : fallback;
  const hasLav = lines.some(l => l.kind === 'lavage');
  const hasRep = lines.some(l => l.kind === 'reparation');
  return hasLav && hasRep ? 'mixte' : (hasLav ? 'lavage' : 'reparation');
}

/** Employees proposed on a prestation of that kind (polyvalents always show). */
function workersForKind(workers: BizWorker[], kind: 'lavage' | 'reparation'): BizWorker[] {
  return workers.filter(w => !w.workerKind || w.workerKind === 'both' || w.workerKind === kind);
}
const STATUS_META: Record<string, { label: string; tone: any }> = {
  pending: { label: 'En attente', tone: 'warning' },
  finalized: { label: 'Finalisé', tone: 'success' },
  canceled: { label: 'Annulé', tone: 'danger' },
};

const PASSAGE = 'Client de passage';

export default function ModuleReparations({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'reparations');
  const { settings } = useAppState();
  const { reparations, clients, workers } = biz.state;

  const [search, setSearch] = useState('');
  // Tableau par défaut : une journée d'atelier se lit en lignes — réf, client,
  // véhicule, reste à encaisser. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  /**
   * ─── LA LISTE S'OUVRE SUR CE QUI ATTEND ───────────────────────────────────
   * Ce qu'on vient faire ici, c'est finaliser un véhicule pris en charge : la
   * liste s'ouvre donc sur les interventions EN ATTENTE, pas sur un historique
   * où elles se noient. Quand l'atelier est à jour — plus rien en attente —
   * elle s'ouvre sur tout : un filtre qui n'affiche rien n'apprend rien.
   */
  const [status, setStatus] = useState<'all' | 'pending' | 'finalized' | 'canceled'>('pending');
  /** L'utilisateur a choisi son filtre : plus rien ne le lui change sous les yeux. */
  const statusPicked = useRef(false);
  const chooseStatus = (s: typeof status) => { statusPicked.current = true; setStatus(s); };
  useEffect(() => {
    if (statusPicked.current || reparations.length === 0) return;
    statusPicked.current = true;
    if (!reparations.some(r => r.status === 'pending')) setStatus('all');
  }, [reparations]);
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState<null | { kind: BizRepKind; pending: boolean }>(null);
  const [viewing, setViewing] = useState<BizReparation | null>(null);
  /**
   * Le formulaire d'édition, et POURQUOI il s'ouvre : « Modifier » revient sur
   * une intervention telle qu'elle est, « Finaliser » ouvre la MÊME fiche déjà
   * basculée en finalisé — sans quoi le bouton vert de la liste rouvrait une
   * intervention en attente qui se réenregistrait… en attente.
   */
  const [editing, setEditing] = useState<{ rep: BizReparation; finalize?: boolean } | null>(null);
  const [paying, setPaying] = useState<BizReparation | null>(null);
  const [toDelete, setToDelete] = useState<BizReparation | null>(null);
  const [askPrint, setAskPrint] = useState<BizReparation | null>(null);

  const filtered = useMemo(() => [...reparations].filter(r => {
    const client = clients.find(c => c.id === r.clientId);
    const matchQ = matchesSearch(search, r.clientName, client?.phone, r.ref, r.car?.immatriculation);
    return matchQ && (status === 'all' || r.status === status) && inPeriod(r.date, period, from, to);
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [reparations, clients, search, status, period, from, to]);

  /**
   * ─── TROIS CHIFFRES, PAS UN DE PLUS ───────────────────────────────────────
   * L'en-tête ne dit que ce sur quoi on agit aujourd'hui : ce qui est PASSÉ
   * dans la journée, ce qui ATTEND d'être finalisé, ce qui RESTE à encaisser.
   *
   * « Interventions » compte la JOURNÉE — pas l'historique : sur un atelier
   * ouvert depuis des mois, le total de toujours ne se lit plus, il décore.
   * La journée se découpe avec le même `inPeriod` que le filtre « Aujourd'hui »
   * de la liste, pour que la carte et la liste ne se contredisent jamais.
   */
  const stats = useMemo(() => ({
    today: reparations.filter(r => inPeriod(r.date, 'today')).length,
    total: reparations.length,
    pending: reparations.filter(r => r.status === 'pending').length,
    rest: reparations.reduce((s, r) => s + r.rest, 0),
    unpaid: reparations.filter(r => r.rest > 0).length,
  }), [reparations]);

  /**
   * ─── QUI A FAIT LE TRAVAIL ────────────────────────────────────────────────
   * Une intervention nomme ses employés dans `workers`, mais c'est CHAQUE
   * prestation qui dit lequel l'a réalisée. La liste affiche donc l'équipe de
   * la ligne, chacun avec les prestations qui lui reviennent : sur une fiche
   * qui porte un lavage ET une vidange, « Karim » seul ne dit pas lequel des
   * deux il a fait — et c'est pourtant là-dessus qu'il est payé.
   *
   * Un employé nommé sur l'intervention sans être rattaché à une prestation
   * (ancienne fiche, ou intervention de produits seuls) reste listé : le
   * travail lui compte quand même, sur le total.
   */
  const crewOf = (r: BizReparation) => {
    const crew = new Map<string, { id: string; name: string; jobs: string[] }>();
    const add = (id: string, job?: string) => {
      const name = workers.find(w => w.id === id)?.name;
      if (!name) return;
      const entry = crew.get(id) || { id, name, jobs: [] };
      if (job) entry.jobs.push(job);
      crew.set(id, entry);
    };
    prestationsOf(r).forEach(l =>
      (l.workerIds || []).forEach(id => add(id, l.label || KIND_META[l.kind].label)));
    (r.workers || []).forEach(id => add(id));
    return [...crew.values()];
  };

  /**
   * Supprimer une intervention ANNULE la sortie des pièces et consommables
   * qu'elle avait utilisés : l'huile, les filtres et le shampoing reviennent en
   * Gestion de stock avant que la ligne ne disparaisse. Sans cela, la
   * marchandise restait comptée comme sortie d'un travail qui n'existe plus.
   */
  const del = () => {
    if (!toDelete) return;
    const plan = restockPlan(biz.state, toDelete.usedProducts || []);
    applyRestock(biz, plan);
    const qty = totalRestocked(plan);
    biz.remove('reparations', toDelete.id);
    toast.success(qty > 0
      ? `Intervention supprimée — ${formatQty(qty)} unité(s) remise(s) en stock`
      : 'Intervention supprimée');
    setToDelete(null);
  };

  /** Ce que la suppression va remettre en stock, montré dans la confirmation. */
  const deleteImpact = useMemo(
    () => (toDelete ? describeRestock(biz.state, toDelete.usedProducts || []) : ''),
    [toDelete, biz.state]);

  const onPay = (amount: number, meta: PayDebtMeta) => {
    if (!paying) return;
    biz.update('reparations', { ...withPayment(paying, amount, meta), updatedAt: new Date().toISOString() });
    toast.success('Paiement enregistré'); setPaying(null);
  };

  const doPrint = (r: BizReparation) => {
    const client = clients.find(c => c.id === r.clientId);
    const nameOf = (id: string) => workers.find(w => w.id === id)?.name;
    const workerNames = r.workers.map(nameOf).filter(Boolean).join(', ');
    const lines = prestationsOf(r);
    const productsTotal = r.usedProducts.reduce((s, p) => s + (p.total ?? p.qty * p.unitPrice), 0);
    const subtotal = r.subtotal ?? (r.serviceTotal + productsTotal);
    printInvoice({
      title: KIND_META[r.kind].label, ref: r.ref, date: r.date,
      station: stationFromSettings(settings),
      party: { label: 'Client', name: r.clientName, phone: client?.phone, address: client?.address },
      info: [
        { label: 'Véhicule', value: [r.car?.marque, r.car?.name, r.car?.color, r.car?.year].filter(Boolean).join(' • ') },
        { label: 'Immatriculation', value: r.car?.immatriculation || '' },
        { label: 'Employé(s)', value: workerNames },
        { label: 'Statut', value: STATUS_META[r.status].label },
        { label: 'Prestations', value: lines.length > 1 ? `${lines.length} prestations` : '' },
      ],
      items: [
        // One printed line per prestation, so the client sees exactly what was done.
        ...lines.map(l => ({
          name: `${KIND_META[l.kind].label} — ${l.label || 'Main d’œuvre'}`
            + (l.workerIds.length ? ` (${l.workerIds.map(nameOf).filter(Boolean).join(', ')})` : ''),
          qty: 1, unitPrice: l.amount, total: l.amount,
        })),
        ...r.usedProducts.map(p => ({
          name: p.productName,
          qty: p.detailQty ? `${p.detailQty} ${p.detailUnit || ''}`.trim() : p.qty,
          unitPrice: p.unitPrice,
          total: p.total ?? p.qty * p.unitPrice,
        })),
      ],
      subtotal: r.discountAmount ? subtotal : undefined,
      reduction: r.discountAmount || undefined,
      total: r.total, paid: r.paid, rest: r.rest,
      payments: [{ label: 'Espèces', amount: r.paid }],
      notes: r.problem,
      footerNote: r.discountAmount
        ? `Remise accordée : ${r.discountType === 'percent' ? `${r.discountValue}%` : money(r.discountAmount)}`
        : undefined,
    });
    biz.update('reparations', { ...r, printedAt: new Date().toISOString() });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Car} title="Vidanges & Lavage" subtitle={`${cfg.label} — atelier & interventions`}
        actions={perm.creer ? <NewInterventionActions onPick={setCreating} /> : undefined} />

      {/*
        ─── TROIS CARTES QUI FILTRENT ──────────────────────────────────────
        Chaque carte OUVRE la liste sur ce qu'elle compte : la journée, ce qui
        attend, ce qui n'est pas payé. Le chiffre et la liste racontent donc
        toujours la même chose, et le grand bandeau d'alerte qui répétait « en
        attente » juste au-dessus n'a plus lieu d'être — la carte ambre le dit,
        et elle emmène au même endroit.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Car} label="Interventions du jour" value={stats.today} tone="blue"
          sub={`${stats.total} au total`}
          onClick={() => { chooseStatus('all'); setPeriod('today'); }} />
        <StatCard icon={stats.pending > 0 ? Hourglass : CheckCircle2} label="En attente" value={stats.pending} tone="amber"
          sub={stats.pending > 0
            ? (status === 'pending' ? "C'est ce que la liste affiche" : 'À finaliser — cliquez pour les voir')
            : 'À jour — tout est finalisé'}
          onClick={() => { chooseStatus('pending'); setPeriod('all'); }} />
        <StatCard icon={Wallet} label="Reste à encaisser" value={money(stats.rest)} tone="red"
          sub={stats.unpaid > 0
            ? `${stats.unpaid} intervention${stats.unpaid > 1 ? 's' : ''} impayée${stats.unpaid > 1 ? 's' : ''}`
            : 'Tout est encaissé'} />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, téléphone, réf ou immatriculation…" />
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'pending', 'finalized', 'canceled'] as const).map(s => {
              const n = s === 'all' ? reparations.length : reparations.filter(r => r.status === s).length;
              return (
                <button key={s} onClick={() => chooseStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {s === 'all' ? 'Tous' : STATUS_META[s].label}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
                    status === s ? 'bg-white/20' : (s === 'pending' && n > 0 ? 'bg-amber-500 text-white' : 'bg-white text-slate-400')}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={status === 'pending' ? Hourglass : Car}
          title={status === 'pending' ? 'Aucune intervention en attente' : 'Aucune intervention'}
          message={status === 'pending'
            ? "L'atelier est à jour — tout est finalisé. L'historique complet reste à un clic."
            : "Créez un lavage ou une vidange : la fiche s'ouvre en attente et se finalise d'un clic."}
          action={status === 'pending'
            ? <button className="btn-secondary" onClick={() => chooseStatus('all')}>Voir toutes les interventions</button>
            : undefined} />
      ) : view === 'table' ? (
        /* Les ACTIONS ouvrent la ligne. Ce qu'on vient faire ici, c'est
           finaliser, encaisser ou imprimer une intervention : le bouton doit
           être sous le pouce dès que la ligne est trouvée, pas au bout d'un
           défilement horizontal de neuf colonnes. La référence, elle, ne sert
           qu'à recopier un numéro — elle ferme la marche. */
        <Table head={<>
          <th className="table-head">Actions</th><th className="table-head">Client</th>
          <th className="table-head">Véhicule</th>
          <th className="table-head">Prestations</th><th className="table-head">Employés</th>
          <th className="table-head">Date</th>
          <th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th>
          <th className="table-head text-right">Reste</th><th className="table-head">État</th>
          <th className="table-head">Réf</th>
        </>}>
          {filtered.map(r => {
            const KM = KIND_META[r.kind]; const KIcon = KM.icon;
            const carLabel = [r.car?.marque, r.car?.name, r.car?.immatriculation].filter(Boolean).join(' • ');
            const crew = crewOf(r);
            return (
              <tr key={r.id} className={r.status === 'pending' ? 'bg-amber-50/60' : undefined}>
                <td className="table-cell">
                  <RowActions>
                    {r.status === 'pending' && perm.modifier && (
                      <ActionBtn icon={CheckCircle2} tone="green" title="Finaliser l'intervention"
                        onClick={() => setEditing({ rep: r, finalize: true })} />
                    )}
                    <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(r)} />
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(r)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing({ rep: r })} />}
                    {r.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(r)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </td>
                <td className="table-cell">{r.clientName}</td>
                <td className="table-cell text-slate-500 max-w-[200px] truncate" title={carLabel || undefined}>{carLabel || '—'}</td>
                <td className="table-cell">
                  <div className="flex flex-wrap gap-1 max-w-[260px]">
                    {prestationsOf(r).map(l => (
                      <Badge key={l.id} tone={l.kind === 'lavage' ? 'info' : 'primary'}>
                        {l.label || KIND_META[l.kind].label}
                      </Badge>
                    ))}
                    {r.usedProducts.length > 0 && <Badge tone="neutral">{r.usedProducts.length} produit(s)</Badge>}
                  </div>
                </td>
                <td className="table-cell">
                  {crew.length === 0 ? <span className="text-slate-300">—</span> : (
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {crew.map(c => (
                        <span key={c.id}
                          title={c.jobs.length ? `${c.name} — ${c.jobs.join(' · ')}` : `${c.name} — intervention entière`}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5
                                     text-[11px] font-bold text-slate-600 max-w-full">
                          <User className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{c.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                {/* Le jour SEUL ne reconnaît pas une fiche : l'atelier en ouvre
                    des dizaines dans la même journée, et c'est l'heure de prise
                    en charge qui dit laquelle est laquelle. */}
                <td className="table-cell whitespace-nowrap text-slate-500">
                  <span className="block">{formatDate(r.date)}</span>
                  {formatTime(r.date) && (
                    <span className="block text-[11px] font-bold text-slate-400 tabular-nums">
                      à {formatTime(r.date)}
                    </span>
                  )}
                </td>
                <td className="table-cell tabular-nums text-right font-bold">{money(r.total)}</td>
                <td className="table-cell tabular-nums text-right text-emerald-600">{money(r.paid)}</td>
                <td className="table-cell tabular-nums text-right text-red-600">{money(r.rest)}</td>
                <td className="table-cell"><Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge></td>
                <td className="table-cell font-bold whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5"><KIcon className="w-4 h-4 text-[#003087]" />{r.ref}</span>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(r => {
            const KM = KIND_META[r.kind]; const KIcon = KM.icon;
            const crew = crewOf(r);
            return (
              <GlassCard key={r.id}
                className={r.status === 'pending' ? '!border-amber-300 ring-1 ring-amber-200' : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5"><KIcon className="w-4 h-4 text-[#003087]" /><h3 className="font-black text-slate-800">{r.ref}</h3></div>
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{r.clientName}</p>
                    {/* Même repère que la colonne « Date » du tableau : le jour
                        et l'heure de prise en charge. */}
                    <p className="text-[11px] text-slate-400 font-bold tabular-nums mt-0.5">
                      {formatDateTime(r.date) || formatDate(r.date)}
                    </p>
                  </div>
                  <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
                </div>
                {(r.car?.marque || r.car?.name || r.car?.immatriculation) && (
                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                    <Car className="w-3 h-3" />{[r.car.marque, r.car.name, r.car.immatriculation].filter(Boolean).join(' • ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {prestationsOf(r).map(l => (
                    <Badge key={l.id} tone={l.kind === 'lavage' ? 'info' : 'primary'}>
                      {l.kind === 'lavage' ? '🧽' : '🔧'} {l.label || KIND_META[l.kind].label} {money(l.amount)}
                    </Badge>
                  ))}
                  {r.usedProducts.length > 0 && <Badge tone="neutral">{r.usedProducts.length} produit(s)</Badge>}
                  {!!r.discountAmount && (
                    <Badge tone="warning">
                      Remise {r.discountType === 'percent' ? `${r.discountValue}%` : ''} −{money(r.discountAmount)}
                    </Badge>
                  )}
                </div>
                {/* L'équipe de l'intervention — chaque nom porte ses prestations. */}
                {crew.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <User className="w-3 h-3 text-slate-400 shrink-0" />
                    {crew.map(c => (
                      <span key={c.id}
                        title={c.jobs.length ? `${c.name} — ${c.jobs.join(' · ')}` : `${c.name} — intervention entière`}
                        className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(r.total)}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(r.paid)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(r.rest)}</p></div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100">
                  {r.status === 'pending' && perm.modifier
                    ? (
                      <button onClick={() => setEditing({ rep: r, finalize: true })}
                        className="h-9 px-3 rounded-xl font-black text-xs text-white flex items-center gap-1.5 transition-transform active:scale-[0.98]"
                        style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
                        <CheckCircle2 className="w-4 h-4" /> Finaliser
                      </button>
                    )
                    : <span />}
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(r)} />
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(r)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing({ rep: r })} />}
                    {r.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(r)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      {creating && (
        <ReparationForm
          moduleKey={moduleKey}
          kind={creating.kind}
          asPending={creating.pending}
          onClose={() => setCreating(null)}
          onSaved={r => { setCreating(null); if (r.status === 'finalized') setAskPrint(r); }}
        />
      )}
      {editing && (
        <ReparationForm
          moduleKey={moduleKey}
          kind={editing.rep.kind}
          initial={editing.rep}
          finalizing={editing.finalize}
          onClose={() => setEditing(null)}
          onSaved={r => { setEditing(null); if (r.status === 'finalized') setAskPrint(r); }}
        />
      )}
      {viewing && <ViewRep rep={viewing} workers={workers} onClose={() => setViewing(null)} onPrint={() => doPrint(viewing)} />}

      <AskPrintModal open={!!askPrint}
        onPrint={() => { if (askPrint) doPrint(askPrint); setAskPrint(null); }}
        onSkip={() => setAskPrint(null)} />

      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer l'intervention"
        message={`${toDelete?.ref || ''} — ${money(toDelete?.total || 0)}.\n\n`
          + 'Les produits utilisés seront REMIS en stock et l\'intervention ne comptera plus dans les rapports, '
          + 'la dette client ni la paie des employés.\n\n'
          + (deleteImpact || 'Aucun produit à remettre en stock sur cette intervention.')
          + '\n\nCette action est définitive.'}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Header actions ────────────────────────────────────────────────────────────
/**
 * ─── UN SEUL GESTE POUR OUVRIR L'ATELIER ────────────────────────────────────
 *
 * Trois boutons, un par nature de travail — Lavage / Vidange / les deux. Ils
 * ouvrent TOUS la fiche « en attente » : c'est l'ordre réel des choses, le
 * véhicule arrive avant d'être fini, et rien ne sort du stock tant que le
 * travail n'est pas fait.
 *
 * Le quatrième bouton « En attente » qui doublait ces trois-là a disparu : il
 * ne servait qu'à choisir un statut que la fiche pose maintenant d'elle-même,
 * et il imposait de démarrer en Lavage même pour une vidange. Finaliser tout
 * de suite reste à UN clic — le sélecteur « Finalisé » en tête de fiche, ou le
 * bouton vert du pied de page.
 */
function NewInterventionActions({
  onPick,
}: { onPick: (v: { kind: BizRepKind; pending: boolean }) => void }) {
  const TYPES: { kind: BizRepKind; short: string }[] = [
    { kind: 'lavage', short: 'Lavage' },
    { kind: 'reparation', short: 'Vidange' },
    { kind: 'mixte', short: 'Les deux' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-2xl bg-white border border-slate-200 p-1.5 shadow-sm">
        <span className="hidden md:block pl-2 pr-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
          Nouvelle
        </span>
        {TYPES.map(t => {
          const m = KIND_META[t.kind];
          const Icon = m.icon;
          return (
            <button key={t.kind} onClick={() => onPick({ kind: t.kind, pending: true })}
              title={`Nouvelle intervention — ${m.label} (ouverte en attente, finalisable aussitôt)`}
              style={{ background: m.grad, boxShadow: m.shadow }}
              className="px-3.5 h-10 rounded-xl text-xs font-black text-white flex items-center gap-1.5
                         transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:scale-95">
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{m.label}</span>
              <span className="sm:hidden">{t.short}</span>
            </button>
          );
        })}
      </div>
      {/* Ce que font ces trois boutons, dit une fois — plutôt qu'un quatrième
          bouton qui refaisait la moitié du travail. */}
      <span className="hidden lg:flex items-center gap-1.5 text-[11px] font-bold text-amber-700">
        <Hourglass className="w-3.5 h-3.5" />
        Ouvre en attente — finalisez quand le travail est fait
      </span>
    </div>
  );
}

/**
 * ─── LE DÉROULÉ D'UNE INTERVENTION, À LA MINUTE ───────────────────────────────
 * Une fiche d'atelier n'est pas un instant : elle s'ouvre quand le véhicule
 * arrive, se retouche pendant le travail, et se referme quand la voiture
 * repart. Cette frise dit CHACUN de ces moments avec son heure — c'est ce
 * qu'on vient relire quand un client conteste un délai, ou quand on veut
 * savoir combien de temps un lavage a réellement pris.
 *
 * Une étape qui n'a pas eu lieu ne s'affiche pas : une fiche encore en attente
 * n'a ni finalisation ni sortie, et l'inventer donnerait une fausse heure.
 * Les fiches enregistrées AVANT cette mise à jour n'ont que leur prise en
 * charge — le reste apparaîtra dès leur prochaine écriture.
 */
function RepTimeline({ rep }: { rep: BizReparation }) {
  /**
   * Finaliser une fiche, c'est la clôturer : le travail est déclaré fait et le
   * véhicule repart dans le même geste. Les deux moments ne se séparent donc
   * qu'en reprenant une vieille fiche dont la sortie avait été notée à part.
   */
  const closedTogether = !!rep.finalizedAt && rep.outDate === rep.finalizedAt;
  const steps: { label: string; at?: string; tone: string; icon: React.ElementType }[] = [
    { label: 'Créée (prise en charge)', at: rep.date, tone: 'text-blue-600', icon: Hourglass },
    { label: 'Dernière modification', at: rep.updatedAt, tone: 'text-amber-600', icon: Edit2 },
    {
      label: closedTogether ? 'Finalisée et clôturée (sortie du véhicule)' : 'Finalisée',
      at: rep.finalizedAt, tone: 'text-emerald-600', icon: CheckCircle2,
    },
    ...(closedTogether ? [] : [{ label: 'Clôturée — sortie du véhicule', at: rep.outDate, tone: 'text-emerald-600', icon: Car }]),
    { label: 'Annulée', at: rep.canceledAt, tone: 'text-red-600', icon: X },
    { label: 'Imprimée', at: rep.printedAt, tone: 'text-slate-500', icon: Printer },
  ];
  const shown = steps.filter(st => !!st.at && !isNaN(new Date(st.at!).getTime()));

  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Suivi horaire</p>
      <div className="space-y-1.5">
        {shown.map(st => {
          const Icon = st.icon;
          return (
            <div key={st.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                <Icon className={`w-3.5 h-3.5 ${st.tone}`} /> {st.label}
              </span>
              <span className="font-bold text-slate-700 tabular-nums shrink-0">{formatDateTime(st.at!)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Detail view ───────────────────────────────────────────────────────────────
function ViewRep({ rep, workers, onClose, onPrint }: {
  rep: BizReparation; workers: { id: string; name: string }[]; onClose: () => void; onPrint: () => void;
}) {
  const nameOf = (id: string) => workers.find(w => w.id === id)?.name;
  const workerNames = rep.workers.map(nameOf).filter(Boolean).join(', ');
  const lines = prestationsOf(rep);
  return (
    <Modal open onClose={onClose} icon={KIND_META[rep.kind].icon} size="lg"
      title={`${KIND_META[rep.kind].label} ${rep.ref}`} subtitle={rep.clientName}
      footer={<button className="btn-outline" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer la facture</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Client</p><p className="font-bold text-slate-700">{rep.clientName}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700">{STATUS_META[rep.status].label}</p></div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Prise en charge</p>
            <p className="font-bold text-slate-700">{formatDate(rep.date)}</p>
            {formatTime(rep.date) && (
              <p className="text-[11px] font-bold text-slate-400 tabular-nums">à {formatTime(rep.date)}</p>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Employé(s)</p><p className="font-bold text-slate-700">{workerNames || '—'}</p></div>
        </div>
        <RepTimeline rep={rep} />

        {(rep.car?.marque || rep.car?.name || rep.car?.immatriculation) && (
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Véhicule</p>
            <p className="text-sm font-semibold text-slate-700">{[rep.car.marque, rep.car.name, rep.car.color, rep.car.year, rep.car.immatriculation].filter(Boolean).join(' • ')}</p></div>
        )}
        {rep.problem && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] uppercase font-bold text-amber-500">Problème</p><p className="text-sm text-amber-700">{rep.problem}</p></div>}

        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Prestations réalisées</p>
          <div className="space-y-1">
            {lines.length === 0
              ? <p className="text-sm text-slate-400 italic">Aucune prestation — produits uniquement.</p>
              : lines.map(l => {
                const Icon = KIND_META[l.kind].icon;
                return (
                  <div key={l.id} className="flex items-start justify-between gap-3 text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-[#003087]" /> {l.label || KIND_META[l.kind].label}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {KIND_META[l.kind].label}
                        {l.workerIds.length ? ` • ${l.workerIds.map(nameOf).filter(Boolean).join(', ')}` : ' • aucun employé'}
                      </p>
                    </div>
                    <span className="font-bold tabular-nums shrink-0">{money(l.amount)}</span>
                  </div>
                );
              })}
          </div>
        </div>

        {rep.usedProducts.length > 0 && (
          <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Produits utilisés</p>
            <div className="space-y-1">{rep.usedProducts.map((p, i) => (
              <div key={i} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span>{p.productName} × {p.detailQty ? `${p.detailQty} ${p.detailUnit || ''}` : p.qty}</span>
                <span className="font-bold tabular-nums">{money(p.total ?? p.qty * p.unitPrice)}</span>
              </div>))}
            </div></div>
        )}

        {!!rep.discountAmount && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
              <span>Sous-total</span><span className="font-bold tabular-nums">{money(rep.subtotal ?? rep.total + rep.discountAmount)}</span>
            </div>
            <div className="flex justify-between text-sm bg-amber-50 rounded-lg px-3 py-2 text-amber-700">
              <span>Remise {rep.discountType === 'percent' ? `(${rep.discountValue}%)` : '(montant fixe)'}</span>
              <span className="font-bold tabular-nums">−{money(rep.discountAmount)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums">{money(rep.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums">{money(rep.paid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums">{money(rep.rest)}</p></div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Create / edit / finalize ──────────────────────────────────────────────────
/** A prestation being edited: the amount is kept as text so the field can be
 *  emptied while typing without collapsing to 0. */
type LineDraft = BizPrestation & { amountStr: string };

/** A prestation worth saving: it has a price, a designation or an employee. */
const keptLine = (l: LineDraft) =>
  (Number(l.amountStr) || 0) > 0 || !!l.label.trim() || l.workerIds.length > 0;

/**
 * The same form serves creation, edition and finalisation of a pending job, so
 * the three flows can never drift apart.
 *
 * An intervention holds a LIST of prestations: un lavage et une vidange
 * peuvent être facturés en une seule création, chacun avec sa désignation, son
 * montant et ses employés. Une remise (pourcentage ou montant fixe) est ensuite
 * déduite du sous-total.
 */
function ReparationForm({
  moduleKey, kind, initial, asPending, finalizing, onClose, onSaved,
}: {
  moduleKey: ModuleKey;
  kind: BizRepKind;
  initial?: BizReparation;
  /** Statut d'ouverture d'une intervention NEUVE. Par défaut « en attente ». */
  asPending?: boolean;
  /**
   * On vient FINALISER une intervention en attente : le statut est déjà basculé
   * en « finalisé » à l'ouverture, et le bouton d'enregistrement le dit. Sans
   * cela, finaliser demandait un aller-retour par le bouton « Passer en
   * finalisé » — et une fiche réenregistrée sans y penser restait en attente.
   */
  finalizing?: boolean;
  onClose: () => void;
  onSaved: (r: BizReparation) => void;
}) {
  const biz = useBiz(moduleKey);
  const { clients, products, workers } = biz.state;
  const isEdit = !!initial;
  const wasPending = initial?.status === 'pending';

  const emptyLine = (k: 'lavage' | 'reparation'): LineDraft =>
    ({ id: newId(), kind: k, label: '', amount: 0, workerIds: [], amountStr: '' });

  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (initial) {
      const existing = prestationsOf(initial).map(l => ({
        ...l, workerIds: [...(l.workerIds || [])], amountStr: l.amount ? String(l.amount) : '',
      }));
      // A products-only job saved before prestations existed still carries its
      // employees — keep them on an empty line rather than dropping them.
      if (!existing.length && (initial.workers || []).length) {
        return [{
          id: newId(), kind: initial.kind === 'lavage' ? 'lavage' : 'reparation',
          label: '', amount: 0, workerIds: [...initial.workers], amountStr: '',
        }];
      }
      return existing;
    }
    return kind === 'mixte'
      ? [emptyLine('lavage'), emptyLine('reparation')]
      : [emptyLine(kind === 'reparation' ? 'reparation' : 'lavage')];
  });

  const [clientId, setClientId] = useState(initial?.clientId || '');
  const [showClient, setShowClient] = useState(false);
  const [car, setCar] = useState<BizCar>(initial?.car || {});
  const [problem, setProblem] = useState(initial?.problem || '');
  const [used, setUsed] = useState<BizLineItem[]>(initial?.usedProducts || []);
  /**
   * ─── CE QUE LE CLIENT DOIT EST DÉJÀ ÉCRIT ─────────────────────────
   *
   * Le montant encaissé n'est pas une question à reposer : une intervention
   * qu'on finalise est réglée en entier neuf fois sur dix. Le champ « Payé »
   * SUIT donc le total — il se remet à jour quand on ajoute une prestation, un
   * produit ou une remise — et la première frappe le fige sur ce que
   * l'utilisateur a décidé : un client qui ne paie qu'une partie se saisit
   * exactement comme avant.
   *
   * Sans cela, finaliser un véhicule pris en charge le matin rouvrait la fiche
   * sur « Payé : 0 ». Il fallait relire le total, le retaper à l'identique, et
   * la moindre faute de frappe ouvrait une dette à un client qui avait payé.
   */
  const [paidStr, setPaidStr] = useState<string>(initial ? String(initial.paid) : '');
  /** `true` dès que le montant encaissé a été saisi à la main. Une intervention
   *  DÉJÀ finalisée garde le sien ; une intervention en attente n'a rien
   *  encaissé — on lui propose ce qu'il y a à payer. */
  const [paidEdited, setPaidEdited] = useState<boolean>(!!initial && initial.status !== 'pending');
  const typePaid = (v: string) => { setPaidEdited(true); setPaidStr(v); };
  const [pQuery, setPQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  /** Le texte tapé dans un champ de quantité, tant qu'il n'est pas validé. */
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  /** Le produit que l'on vient de toucher — sa fiche s'allume une seconde. */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  /**
   * Une intervention NEUVE naît « en attente » : le véhicule est là, le travail
   * ne l'est pas encore, et le stock ne doit pas bouger avant. Le sélecteur de
   * statut — en tête de fiche, et le bouton vert du pied de page — bascule en
   * « finalisé » sans quitter l'écran, pour le lavage réglé au comptoir.
   * `asPending={false}` reste possible pour ouvrir directement en finalisé.
   */
  const [pending, setPending] = useState<boolean>(
    initial ? (finalizing ? false : initial.status === 'pending') : (asPending ?? true));
  const [discountMode, setDiscountMode] = useState<'none' | BizDiscountType>(
    initial?.discountAmount ? (initial.discountType || 'amount') : 'none');
  const [discountStr, setDiscountStr] = useState<string>(
    initial?.discountValue ? String(initial.discountValue) : '');

  // ── Money ──────────────────────────────────────────────────────────────────
  const serviceTotal = lines.reduce((s, l) => s + (Number(l.amountStr) || 0), 0);
  const productsTotal = used.reduce((s, x) => s + (x.total ?? x.qty * x.unitPrice), 0);
  const subtotal = serviceTotal + productsTotal;
  const discountAmount = discountMode === 'none' ? 0 : discountOf(subtotal, discountMode, Number(discountStr) || 0);
  const total = Math.max(0, subtotal - discountAmount);
  /**
   * Le montant proposé tant que personne ne l'a corrigé : tout ce qu'il y a à
   * payer sur une intervention finalisée, et ce qui a déjà été versé (souvent
   * rien) sur une intervention laissée en attente.
   */
  const autoPaid = pending ? Number(initial?.paid) || 0 : total;
  const paid = paidEdited ? Number(paidStr) || 0 : autoPaid;
  const rest = Math.max(0, total - paid);

  const repKind = kindOfPrestations(lines.filter(keptLine), kind);

  // Every employee taking part in the intervention, across all its prestations.
  const allWorkerIds = useMemo(
    () => Array.from(new Set(lines.flatMap(l => l.workerIds))),
    [lines]);

  // ── Prestation helpers ─────────────────────────────────────────────────────
  const addLine = (k: 'lavage' | 'reparation') => setLines(prev => [...prev, emptyLine(k)]);
  const rmLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));
  const patchLine = (id: string, patch: Partial<LineDraft>) =>
    setLines(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const setLineKind = (id: string, k: 'lavage' | 'reparation') =>
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      // Drop employees who do not work on the new kind, so an assignment is never wrong.
      const allowed = new Set(workersForKind(workers, k).map(w => w.id));
      return { ...l, kind: k, workerIds: l.workerIds.filter(w => allowed.has(w)) };
    }));
  const toggleLineWorker = (id: string, workerId: string) =>
    setLines(prev => prev.map(l => l.id === id
      ? { ...l, workerIds: l.workerIds.includes(workerId) ? l.workerIds.filter(w => w !== workerId) : [...l.workerIds, workerId] }
      : l));

  // ── Produits utilisés — nom, code-barres, RÉFÉRENCES et véhicules ─────────
  /**
   * ─── POURQUOI LE PRODUIT CHOISI RESTE SOUS LES YEUX ────────────────────────
   *
   * La recherche s'effaçait dès qu'on cliquait un produit : la liste des
   * résultats disparaissait, et rien ne disait ce qui venait d'être ajouté.
   * Sur une vidange — huile, filtre à huile, filtre à air, joint — on perdait
   * le fil à chaque article.
   *
   * La recherche est donc CONSERVÉE. Le produit déjà pris se reconnaît dans les
   * résultats (pastille verte, quantité en cours), sa fiche s'allume un instant
   * en bas, et un second clic ajoute simplement une unité de plus au lieu de ne
   * rien faire.
   *
   * Les produits en rupture restent proposés : une intervention peut les
   * consommer et faire passer le stock en négatif (rattrapé au prochain achat),
   * exactement comme au point de vente. Le formulaire le DIT — « stock après »
   * vire au rouge — au lieu de l'interdire.
   *
   * ─── CE QUI EST CHERCHÉ ────────────────────────────────────────────────────
   * Cet écran ne regardait que le NOM et le code-barres. Une pièce porte
   * pourtant plusieurs numéros — celui du constructeur, celui de
   * l'équipementier, celui du catalogue du fournisseur — et c'est avec l'un
   * d'eux que le client arrive. Une pièce bien rangée, avec toutes ses
   * références sur sa fiche, restait donc introuvable ici alors que la Gestion
   * de stock, les Achats et le point de vente la sortaient sans hésiter.
   *
   * La règle est désormais LA MÊME que sur ces trois écrans (`productMatches`
   * de `_shared`) : nom, description, code-barres, marque, catégorie, CHACUNE
   * des références — telle qu'elle s'écrit ET compactée, pour que « 7701478261 »
   * retrouve « 7701 478 261 » — et chacun des véhicules que la pièce équipe.
   */
  const productMatches = useMemo(() => {
    if (!pQuery.trim()) return [];
    return products
      .filter((p: BizProduct) => matchesProduct(p, pQuery))
      // Une recherche par référence ramène plus large qu'une recherche par nom
      // (le même numéro équipe plusieurs pièces) : la liste défile, on ne la
      // tronque donc plus à dix.
      .slice(0, 30);
  }, [products, pQuery]);

  /**
   * Le produit désigné par un code EXACT — son code-barres, ou l'une de ses
   * références. Les références sont comparées SANS leurs séparateurs : le même
   * numéro se note « 7701 478 261 » sur la fiche et se tape « 7701478261 », et
   * une douchette ne met jamais les espaces.
   *
   * C'est ce que lisent la touche « Entrée » et la caméra : elles ne doivent
   * ajouter un produit que lorsqu'il n'y a aucun doute sur lequel.
   */
  const byExactCode = (code: string): BizProduct | undefined => {
    const clean = code.trim();
    if (!clean) return undefined;
    const compact = compactRef(clean);
    return products.find((p: BizProduct) => (p.barcode || '').trim() === clean)
      || products.find((p: BizProduct) => (p.refs || []).some(r => !!r.ref && compactRef(r.ref) === compact));
  };

  /** Le stock restant d'un produit, dit avec la couleur qui va avec. */
  const stockTone = (q: number, min: number) => (
    q <= 0 ? 'bg-red-100 text-red-600 border-red-200'
      : q <= (min || 0) ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-emerald-100 text-emerald-700 border-emerald-200');

  /** Met une fiche produit en évidence le temps de la retrouver des yeux. */
  const flash = (id: string) => {
    setFlashId(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 1500);
  };
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  /** Quantité d'une ligne, dans l'unité que l'utilisateur voit. */
  const shownQty = (u: BizLineItem) => (u.detailQty !== undefined ? (u.detailQty || 0) : u.qty);

  /** Quantité edit — in detail units when the product is sold au détail. */
  const setQty = (productId: string, value: number) => {
    const p = products.find((x: BizProduct) => x.id === productId);
    setUsed(prev => prev.map(u => {
      if (u.productId !== productId) return u;
      if (u.detailQty !== undefined && p?.detailCapacity) {
        const detailQty = Math.max(0, value);
        return { ...u, detailQty, qty: detailQty / p.detailCapacity, total: detailQty * u.unitPrice };
      }
      const qty = Math.max(0, value);
      return { ...u, qty, total: qty * u.unitPrice };
    }));
  };

  /**
   * Le champ garde SON texte le temps de la frappe : sans cela, l'effacer
   * écrivait 0 et il fallait tout resélectionner pour taper « 10 ».
   */
  const typeQty = (id: string, text: string) => {
    setQtyText(prev => ({ ...prev, [id]: text }));
    setQty(id, text.trim() === '' ? 0 : Number(text) || 0);
  };
  /** À la sortie du champ, l'affichage revient sur la quantité retenue. */
  const commitQty = (id: string) => setQtyText(prev => {
    const next = { ...prev }; delete next[id]; return next;
  });
  /** Les boutons − / + : une unité de détail, ou une unité entière. */
  const stepQty = (id: string, delta: number) => {
    const u = used.find(x => x.productId === id);
    if (!u) return;
    setQty(id, Math.max(0, Math.round((shownQty(u) + delta) * 100) / 100));
    commitQty(id);
  };

  const addUsed = (p: BizProduct) => {
    if (used.some(u => u.productId === p.id)) {
      // Déjà sur l'intervention : on en ajoute une de plus, on ne l'ignore pas.
      stepQty(p.id, 1);
      flash(p.id);
      toast.success(`${p.name} — quantité +1`);
      return;
    }
    if (p.sellByDetail && (p.detailCapacity || 0) > 0) {
      const unitPrice = detailPrice(p);
      setUsed(prev => [...prev, {
        productId: p.id, productName: p.name,
        detailQty: 1, detailUnit: p.detailUnit || 'L',
        qty: 1 / (p.detailCapacity || 1),
        unitPrice, unitCost: p.purchasePrice || 0, total: unitPrice,
      }]);
    } else {
      setUsed(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.salePrice, unitCost: p.purchasePrice || 0, total: p.salePrice }]);
    }
    flash(p.id);
  };

  /**
   * Un code lu à la caméra (ou par une douchette) tombe directement dans la
   * liste des produits utilisés. Un code inconnu le dit, et la caméra continue.
   *
   * Le code-barres n'est pas le seul numéro imprimé sur un carton de pièces :
   * la référence de l'équipementier y figure souvent seule. Elle est donc
   * acceptée elle aussi.
   */
  const scanToUsed = (code: string): boolean => {
    const clean = code.trim();
    const found = byExactCode(clean);
    if (!found) { setScanNote(`Code ${clean} inconnu — aucun produit ne le porte.`); return false; }
    addUsed(found);
    setScanNote(`${found.name} ajouté aux produits utilisés`);
    return true;
  };

  const rmUsed = (id: string) => { commitQty(id); setUsed(prev => prev.filter(u => u.productId !== id)); };

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = () => {
    const cleanLines: BizPrestation[] = lines
      .filter(keptLine)
      .map(l => ({
        id: l.id, kind: l.kind,
        label: l.label.trim() || KIND_META[l.kind].label,
        amount: Number(l.amountStr) || 0,
        workerIds: l.workerIds,
      }));

    if (cleanLines.length === 0 && used.length === 0) {
      toast.error('Ajoutez au moins une prestation ou un produit');
      return;
    }

    const client = clients.find(c => c.id === clientId);
    const status: BizReparation['status'] = pending ? 'pending' : 'finalized';
    const finalKind = kindOfPrestations(cleanLines, kind);
    const prefix = finalKind === 'lavage' ? 'LAV' : finalKind === 'reparation' ? 'REP' : 'INT';
    // Une intervention éditée garde SA date : c'est elle qui date aussi son
    // encaissement d'origine dans le relevé du client.
    const repDate = initial?.date || new Date().toISOString();
    /**
     * ─── ON HORODATE CE QUI VIENT DE SE PASSER ──────────────────────────────
     * La prise en charge est déjà datée par `repDate`. Ce qu'on ajoute ici,
     * c'est le reste de la vie de la fiche : l'instant de CETTE écriture, et,
     * quand elle bascule, l'instant exact de la finalisation ou de
     * l'annulation — pris une seule fois, jamais réécrit par une correction
     * de montant passée après coup.
     *
     * La sortie du véhicule (`outDate`) est la finalisation elle-même : c'est
     * au moment où le travail est déclaré fait que la voiture repart.
     *
     * Ce formulaire n'annule pas une intervention — un `canceledAt` déjà posé
     * est simplement reconduit, jamais effacé par une reprise de la fiche.
     */
    const stamp = new Date().toISOString();
    const finalizedAt = status === 'finalized' ? (initial?.finalizedAt || stamp) : initial?.finalizedAt;
    const rep: BizReparation = {
      id: initial?.id || newId(),
      ref: initial?.ref || `${prefix}-${String(biz.state.reparations.length + 1).padStart(4, '0')}`,
      kind: finalKind,
      clientId: clientId || undefined,
      clientName: client?.name || PASSAGE,
      car,
      serviceTotal: cleanLines.reduce((s, l) => s + l.amount, 0),
      prestations: cleanLines,
      usedProducts: used,
      problem,
      subtotal,
      discountType: discountMode === 'none' ? undefined : discountMode,
      discountValue: discountMode === 'none' ? undefined : Number(discountStr) || 0,
      discountAmount,
      total, paid, rest, status,
      date: repDate,
      updatedAt: isEdit ? stamp : undefined,
      finalizedAt,
      canceledAt: initial?.canceledAt,
      payments: seedPayments(initial?.payments, paid, repDate, initial?.createdBy),
      outDate: initial?.outDate || finalizedAt,
      workers: Array.from(new Set(cleanLines.flatMap(l => l.workerIds))),
      createdBy: initial?.createdBy || 'Admin',
      printedAt: initial?.printedAt,
      payrollSettled: initial?.payrollSettled,
    };

    if (isEdit) biz.update('reparations', rep); else biz.add('reparations', rep);

    /**
     * ─── LE KILOMÉTRAGE REMONTE SUR LA FICHE DU CLIENT ──────────────────────
     * Le relevé n'a de valeur que suivi dans le temps : il est saisi ici, au
     * moment où l'on a le compteur sous les yeux, et c'est la fiche du client
     * qui le conserve. On n'écrit que si le chiffre a réellement changé — une
     * intervention rouverte pour corriger un montant ne doit pas réécrire le
     * parc du client pour rien.
     *
     * Un relevé PLUS PETIT que celui déjà enregistré est tout de même accepté :
     * une faute de frappe se corrige, et un compteur remplacé repart de zéro.
     */
    if (client && car.id && typeof car.kilometrage === 'number') {
      const parc = client.cars || [];
      const known = parc.find(c => c.id === car.id);
      if (known && known.kilometrage !== car.kilometrage) {
        biz.update('clients', {
          ...client,
          cars: parc.map(c => (c.id === car.id
            ? { ...c, kilometrage: car.kilometrage, kilometrageAt: repDate.slice(0, 10) }
            : c)),
        });
      }
    }

    // Stock is deducted only when the job is actually done, and only once:
    // a pending job that gets finalized deducts at that moment.
    const shouldDeduct = status === 'finalized' && (!isEdit || wasPending);
    if (shouldDeduct) {
      used.forEach(u => {
        const p = products.find(x => x.id === u.productId);
        // Oversell allowed: the stock may go negative and is recovered on the
        // next purchase (e.g. −5 en stock + 15 reçus = 10), as in the POS.
        if (p) biz.update('products', { ...p, currentQty: p.currentQty - u.qty });
      });
    }

    toast.success(status === 'pending'
      ? 'Intervention enregistrée en attente'
      : (isEdit && wasPending ? 'Intervention finalisée' : (isEdit ? 'Intervention modifiée' : 'Intervention enregistrée')));
    onSaved(rep);
  };

  const title = isEdit
    ? (wasPending ? `Finaliser ${initial!.ref}` : `Modifier ${initial!.ref}`)
    : `Nouvelle intervention — ${KIND_META[repKind].label}`;
  /** Ce que l'enregistrement va faire, dit avant qu'on le fasse. */
  const subtitle = wasPending
    ? 'Vérifiez le travail réalisé, puis finalisez — le stock sort à cet instant'
    : (!isEdit && pending
      ? 'Prise en charge — passez en « Finalisé » dès que le travail est terminé'
      : 'Plusieurs prestations par intervention • remise • produits du stock');

  return (
    <>
      <Modal open onClose={onClose} icon={KIND_META[repKind].icon} size="xl" title={title}
        subtitle={subtitle}
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          {/* ── LA CONVERSION, SANS SORTIR DE LA FICHE ────────────────────
              La fiche s'ouvre en attente ; un lavage réglé au comptoir se
              finalise ICI, d'un clic. Le montant encaissé se remplit alors tout
              seul avec le total — visible avant d'enregistrer, corrigeable pour
              un client qui ne paie qu'une partie. */}
          {pending && (
            <button onClick={() => setPending(false)}
              title="Le travail est terminé : bascule la fiche en finalisé"
              className="px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-emerald-700
                         bg-emerald-50 border-2 border-emerald-200 flex items-center gap-2
                         transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-100 active:scale-[0.97]">
              <CheckCircle2 className="w-4 h-4" /> Passer en finalisé
            </button>
          )}
          <button onClick={save}
            className="px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white
                       flex items-center gap-2 transition-all duration-200 hover:-translate-y-0.5
                       hover:brightness-110 active:scale-[0.97]"
            style={{
              background: pending ? 'linear-gradient(135deg,#b45309,#f59e0b)' : 'linear-gradient(135deg,#047857,#10b981)',
              boxShadow: pending ? '0 8px 20px rgba(245,158,11,0.35)' : '0 8px 20px rgba(16,185,129,0.35)',
            }}>
            {pending ? <Hourglass className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {pending ? 'Enregistrer en attente' : (isEdit && wasPending ? "Finaliser l'intervention" : 'Enregistrer')}
          </button>
        </>}>
        <div className="space-y-4">

          {/* ── Finalisation d'une intervention prise en charge ───────────────
              Un véhicule laissé le matin revient ici l'après-midi. On rappelle
              en tête ce que l'enregistrement va déclencher — la sortie du stock,
              qui n'a PAS eu lieu à la prise en charge. */}
          {wasPending && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl p-4 flex flex-wrap items-center gap-3 text-white"
              style={{ background: 'linear-gradient(135deg,#047857,#10b981)', boxShadow: '0 10px 28px rgba(16,185,129,0.32)' }}>
              <span className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-black text-[15px]">Finalisation de {initial!.ref}</p>
                <p className="text-[12px] text-emerald-50 leading-relaxed">
                  Véhicule pris en charge le {formatDateTime(initial!.date)}
                  {initial!.clientName ? ` — ${initial!.clientName}` : ''}. Complétez les prestations et les
                  produits, puis enregistrez : les produits utilisés sortent du stock à ce moment-là.
                </p>
              </div>
            </motion.div>
          )}

          {/* ── Statut + nature déduite ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Statut de l'intervention"
              hint="Une intervention neuve démarre en attente — passez-la en finalisé dès que le travail est fait.">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setPending(true)}
                  className={`h-[52px] rounded-2xl text-sm font-black flex items-center justify-center gap-2
                              transition-all duration-200 active:scale-[0.97]
                              ${pending ? 'text-white -translate-y-0.5' : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600'}`}
                  style={pending ? { background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 8px 20px rgba(245,158,11,0.35)' } : undefined}>
                  <Hourglass className={`w-4 h-4 ${pending ? 'animate-pulse' : ''}`} /> En attente
                </button>
                <button onClick={() => setPending(false)}
                  className={`h-[52px] rounded-2xl text-sm font-black flex items-center justify-center gap-2
                              transition-all duration-200 active:scale-[0.97]
                              ${!pending ? 'text-white -translate-y-0.5' : 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600'}`}
                  style={!pending ? { background: 'linear-gradient(135deg,#047857,#10b981)', boxShadow: '0 8px 20px rgba(16,185,129,0.35)' } : undefined}>
                  <CheckCircle2 className="w-4 h-4" /> Finalisé
                </button>
              </div>
            </Field>
            <Field label="Type d'intervention" hint="Déduit automatiquement des prestations ajoutées.">
              <motion.div key={repKind}
                initial={{ opacity: 0.5, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="h-[52px] rounded-2xl flex items-center gap-2.5 px-4 font-black text-sm text-white"
                style={{ background: KIND_META[repKind].grad, boxShadow: KIND_META[repKind].shadow }}>
                {React.createElement(KIND_META[repKind].icon, { className: 'w-5 h-5' })}
                {KIND_META[repKind].label}
                <span className="ml-auto text-[11px] font-black bg-white/20 rounded-lg px-2 py-1 tabular-nums">
                  {lines.length} prestation{lines.length > 1 ? 's' : ''}
                </span>
              </motion.div>
            </Field>
          </div>

          {/* ── 1 · Prestations ─────────────────────────────────────────────── */}
          <Block step={1} icon={Layers} title="Prestations réalisées"
            hint="Un lavage, une vidange, ou les deux — chacun avec son montant et ses employés."
            grad="linear-gradient(135deg,#003087,#0044bb)" border="border-blue-200" tint="bg-slate-50/60"
            action={
              <div className="flex gap-2">
                {(['lavage', 'reparation'] as const).map(k => {
                  const m = KIND_META[k]; const Icon = m.icon;
                  return (
                    <button key={k} onClick={() => addLine(k)}
                      className="h-9 px-3 rounded-xl text-[11px] font-black text-white flex items-center gap-1.5
                                 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
                      style={{ background: m.grad, boxShadow: m.shadow }}>
                      <Plus className="w-3.5 h-3.5" /><Icon className="w-3.5 h-3.5" /> {m.label}
                    </button>
                  );
                })}
              </div>}>
            <div className="space-y-2.5">
              {lines.length === 0 && (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white px-4 py-6 text-center">
                  <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-bold text-slate-500">Aucune prestation</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    L'intervention ne facturera que les produits utilisés.
                  </p>
                </div>
              )}
              <AnimatePresence initial={false}>
                {lines.map((l, i) => {
                  const m = KIND_META[l.kind];
                  const pool = workersForKind(workers, l.kind);
                  return (
                    <motion.div key={l.id} layout
                      initial={{ opacity: 0, y: -10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -20, scale: 0.96 }}
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className={`rounded-2xl border-2 ${m.border} bg-white overflow-hidden shadow-sm`}>
                      {/* En-tête de la prestation — sa couleur dit sa nature. */}
                      <div className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${m.soft} border-b ${m.border}`}>
                        <span className="w-7 h-7 rounded-xl text-white flex items-center justify-center text-[11px] font-black shrink-0"
                          style={{ background: m.grad }}>
                          {i + 1}
                        </span>
                        <div className="flex gap-1.5">
                          {(['lavage', 'reparation'] as const).map(k => {
                            const km = KIND_META[k]; const Icon = km.icon; const on = l.kind === k;
                            return (
                              <button key={k} onClick={() => setLineKind(l.id, k)}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-black flex items-center gap-1.5
                                            transition-all duration-200 active:scale-95
                                            ${on ? 'text-white' : 'bg-white text-slate-400 border border-slate-200 hover:text-slate-600'}`}
                                style={on ? { background: km.grad, boxShadow: km.shadow } : undefined}>
                                <Icon className="w-3.5 h-3.5" /> {km.label}
                              </button>
                            );
                          })}
                        </div>
                        <span className={`ml-auto text-sm font-black tabular-nums ${m.text}`}>
                          {money(Number(l.amountStr) || 0)}
                        </span>
                        <button onClick={() => rmLine(l.id)} title="Retirer la prestation"
                          className="text-slate-300 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="p-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-2">
                            <Input placeholder={l.kind === 'lavage' ? 'Ex: Lavage complet intérieur/extérieur' : 'Ex: Vidange moteur + filtre à huile'}
                              value={l.label} onChange={e => patchLine(l.id, { label: e.target.value })} />
                          </div>
                          <Input type="number" placeholder="Montant (DA)" value={l.amountStr}
                            onChange={e => patchLine(l.id, { amountStr: e.target.value, amount: Number(e.target.value) || 0 })} />
                        </div>

                        <div>
                          <p className="text-[10px] uppercase font-black tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5" /> Employé(s) de cette prestation
                          </p>
                          {pool.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">
                              Aucun employé « {l.kind === 'lavage' ? 'lavage' : 'vidange'} » enregistré.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {pool.map((w: BizWorker) => {
                                const on = l.workerIds.includes(w.id);
                                return (
                                  <button key={w.id} onClick={() => toggleLineWorker(l.id, w.id)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1
                                                transition-all duration-200 active:scale-95
                                                ${on ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                    style={on ? { background: 'linear-gradient(135deg,#047857,#10b981)', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' } : undefined}>
                                    {on && <CheckCircle2 className="w-3 h-3" />} {w.name}
                                    {w.salaryType === 'pourcentage' && <span className="opacity-70">· {w.percentage || 0}%</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {allWorkerIds.length > 0 && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5 px-1">
                  <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <b>{allWorkerIds.length}</b> employé(s) sur cette intervention :{' '}
                  {allWorkerIds.map(id => workers.find((w: BizWorker) => w.id === id)?.name).filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </Block>

          {/* ── 2 · Produits utilisés ───────────────────────────────────────── */}
          <Block step={2} icon={PackageSearch} title="Produits utilisés"
            hint="Nom, code-barres, référence ou véhicule — le produit choisi reste affiché, sa quantité se règle ici."
            grad="linear-gradient(135deg,#047857,#10b981)" border="border-emerald-200" tint="bg-emerald-50/40"
            action={
              <div className="flex items-center gap-1.5">
                <span className="h-8 px-2.5 rounded-xl bg-white/20 flex items-center text-[11px] font-black tabular-nums">
                  {used.length} produit{used.length > 1 ? 's' : ''}
                </span>
                <span className="h-8 px-2.5 rounded-xl bg-white/20 flex items-center text-[11px] font-black tabular-nums">
                  {money(productsTotal)}
                </span>
              </div>}>
            <div className="space-y-3">
              {/* Recherche + douchette + caméra */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input value={pQuery} onChange={e => setPQuery(e.target.value)}
                    placeholder="Nom, code-barres, référence (7701 478 261) ou véhicule (Clio 4 2015)…"
                    className="w-full rounded-xl border-2 border-emerald-200 bg-white py-3 pl-9 pr-9 text-sm font-semibold
                               text-slate-800 outline-none transition-all placeholder:text-slate-400
                               focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    onKeyDown={e => {
                      // Une douchette USB écrit ici puis envoie « Entrée ». Un code
                      // EXACT — code-barres ou référence — ajoute son produit sans
                      // discussion ; sinon, « Entrée » ne valide que lorsqu'il ne
                      // reste QU'UN seul résultat à l'écran. Devant une liste, elle
                      // ne choisit jamais à la place de l'utilisateur : prendre le
                      // premier au hasard sortait la mauvaise pièce.
                      if (e.key !== 'Enter') return;
                      const code = pQuery.trim();
                      if (!code) return;
                      const hit = byExactCode(code)
                        || (productMatches.length === 1 ? productMatches[0] : undefined);
                      if (!hit) return;
                      e.preventDefault();
                      addUsed(hit);
                      setPQuery('');
                    }} />
                  {pQuery && (
                    <button onClick={() => setPQuery('')} title="Effacer la recherche"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button onClick={() => { setScanNote(''); setScanning(true); }}
                  title="Scanner un code-barres avec la caméra"
                  className="h-[50px] px-4 rounded-xl text-xs font-black text-white flex items-center gap-2
                             transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
                  style={{ background: 'linear-gradient(135deg,#047857,#10b981)', boxShadow: '0 8px 20px rgba(16,185,129,0.32)' }}>
                  <ScanLine className="w-4 h-4" /> Scanner
                </button>
              </div>

              {/* Résultats — dans le fil de la page, jamais par-dessus la liste */}
              <AnimatePresence initial={false}>
                {!!pQuery.trim() && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden">
                    <div className="rounded-2xl border-2 border-emerald-200 bg-white overflow-hidden shadow-sm">
                      {productMatches.length === 0 ? (
                        <div className="px-4 py-5 text-center">
                          <p className="text-sm font-semibold text-slate-400">
                            Aucun produit ne correspond à « {pQuery} ».
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Le nom, le code-barres, toutes les références de la pièce et les véhicules
                            qu'elle équipe ont été cherchés. Une pièce absente d'ici l'est aussi de la
                            Gestion de stock — ou sa référence n'est pas encore sur sa fiche.
                          </p>
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                          {productMatches.map((p: BizProduct) => {
                            const line = used.find(u => u.productId === p.id);
                            const detail = !!(p.sellByDetail && p.detailCapacity);
                            return (
                              <button key={p.id} onClick={() => addUsed(p)}
                                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors
                                            ${line ? 'bg-emerald-50' : 'hover:bg-emerald-50/60'}`}>
                                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white"
                                  style={{ background: line ? 'linear-gradient(135deg,#047857,#10b981)' : 'linear-gradient(135deg,#64748b,#94a3b8)' }}>
                                  {line ? <CheckCircle2 className="w-5 h-5" /> : <Package className="w-4 h-4" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-black text-slate-800 truncate">{p.name}</span>
                                  <span className="block text-[11px] text-slate-400 truncate">
                                    {p.barcode ? `${p.barcode} • ` : ''}{p.categoryName || 'Sans catégorie'}
                                    {detail ? ` • au détail (${p.detailCapacity} ${p.detailUnit || 'L'})` : ''}
                                  </span>
                                  {/* Les numéros de la pièce et les voitures qu'elle équipe : c'est
                                      souvent par eux qu'on vient de la trouver, il faut donc les VOIR
                                      pour reconnaître la bonne parmi plusieurs homonymes. */}
                                  {!!p.refs?.length && (
                                    <span className="block text-[11px] font-mono font-bold text-violet-600 truncate"
                                      title={p.refs.map(productRefLabel).join(' · ')}>
                                      {p.refs.map(productRefLabel).join(' · ')}
                                    </span>
                                  )}
                                  {!!p.cars?.length && (
                                    <span className="block text-[11px] text-slate-400 truncate"
                                      title={p.cars.map(productCarLabel).join(' · ')}>
                                      🚗 {p.cars.map(productCarLabel).join(' · ')}
                                    </span>
                                  )}
                                </span>
                                <span className={`hidden sm:inline-flex text-[10px] font-black px-2 py-1 rounded-lg border tabular-nums shrink-0 ${stockTone(p.currentQty, p.minQty)}`}>
                                  Stock {formatQty(p.currentQty)}
                                </span>
                                <span className="hidden md:block text-xs font-black tabular-nums text-slate-600 shrink-0">
                                  {detail ? `${money(detailPrice(p))}/${p.detailUnit || 'L'}` : money(p.salePrice)}
                                </span>
                                <span className={`shrink-0 text-[10px] font-black px-2.5 py-1.5 rounded-lg tabular-nums
                                                  ${line ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                  {line
                                    ? `✓ ${formatQty(shownQty(line))} ${line.detailUnit || p.unit || 'u'}`
                                    : '+ Ajouter'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Les produits RETENUS — nom en clair et quantité réglable */}
              {used.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-white px-4 py-6 text-center">
                  <Package className="w-8 h-8 mx-auto mb-2 text-emerald-300" />
                  <p className="text-sm font-bold text-slate-500">Aucun produit sur cette intervention</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    L'huile, les filtres et le shampoing ajoutés ici sortent du stock à la finalisation.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {used.map((u, i) => {
                      const p = products.find((x: BizProduct) => x.id === u.productId);
                      const isDetail = u.detailQty !== undefined;
                      const unitLabel = isDetail ? (u.detailUnit || 'L') : (p?.unit || 'u');
                      const stockAfter = p ? p.currentQty - u.qty : null;
                      const short = stockAfter !== null && stockAfter < 0;
                      const lit = flashId === u.productId;
                      return (
                        <motion.div key={u.productId} layout
                          initial={{ opacity: 0, y: -10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, x: -20, scale: 0.96 }}
                          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                          className={`rounded-2xl border-2 p-3 bg-gradient-to-r from-emerald-50/80 to-white transition-shadow duration-300
                                      ${lit ? 'border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]' : 'border-emerald-200 shadow-sm'}`}>
                          <div className="flex items-start gap-3">
                            <span className="w-8 h-8 rounded-xl text-white flex items-center justify-center text-[11px] font-black shrink-0"
                              style={{ background: 'linear-gradient(135deg,#047857,#10b981)' }}>
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              {/* Le NOM reste entier : c'est lui qu'on relit avant de valider. */}
                              <p className="text-sm font-black text-slate-800 leading-snug break-words">{u.productName}</p>
                              <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                                {money(u.unitPrice)} / {unitLabel}
                                {isDetail && p?.detailCapacity ? ` • bidon de ${p.detailCapacity} ${u.detailUnit || 'L'}` : ''}
                              </p>
                            </div>
                            <button onClick={() => rmUsed(u.productId)} title="Retirer ce produit"
                              className="text-slate-300 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors shrink-0">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-2.5">
                            {/* − quantité + : réglable au doigt comme au clavier */}
                            <div className="flex items-center rounded-xl border-2 border-emerald-200 bg-white overflow-hidden">
                              <button onClick={() => stepQty(u.productId, -1)} title="Une unité de moins"
                                className="w-9 h-10 flex items-center justify-center text-emerald-700 hover:bg-emerald-50 active:scale-90 transition-all">
                                <Minus className="w-4 h-4" />
                              </button>
                              <input type="number" step="0.01" min={0} inputMode="decimal"
                                value={qtyText[u.productId] ?? String(shownQty(u))}
                                onChange={e => typeQty(u.productId, e.target.value)}
                                onBlur={() => commitQty(u.productId)}
                                onFocus={e => e.currentTarget.select()}
                                className="w-16 h-10 text-center text-sm font-black tabular-nums text-slate-800
                                           border-x-2 border-emerald-100 outline-none focus:bg-emerald-50/60" />
                              <span className="h-10 px-2 flex items-center text-[11px] font-black text-emerald-700 bg-emerald-50">
                                {unitLabel}
                              </span>
                              <button onClick={() => stepQty(u.productId, 1)} title="Une unité de plus"
                                className="w-9 h-10 flex items-center justify-center text-emerald-700 hover:bg-emerald-50 active:scale-90 transition-all">
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            {stockAfter !== null && (
                              <span className={`text-[10px] font-black px-2 py-1.5 rounded-lg border flex items-center gap-1 tabular-nums
                                                ${short ? 'bg-red-100 text-red-600 border-red-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {short && <AlertTriangle className="w-3 h-3" />}
                                Stock après : {formatQty(stockAfter)}
                              </span>
                            )}

                            <span className="ml-auto text-sm font-black tabular-nums text-emerald-700">
                              {money(u.total ?? u.qty * u.unitPrice)}
                            </span>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  <div className="flex items-center justify-between rounded-xl px-4 py-2.5 text-white"
                    style={{ background: 'linear-gradient(135deg,#047857,#10b981)' }}>
                    <span className="text-[11px] font-black uppercase tracking-widest">Total produits</span>
                    <span className="font-black tabular-nums">{money(productsTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          </Block>

          {/* ── 3 · Le client, puis SA voiture ───────────────────────────────
              Recherche par nom ou téléphone, parc du client proposé, et le
              kilométrage relevé sur place. La saisie libre reste disponible :
              un client de passage n'a pas de fiche.

              Il vient APRÈS le travail : on saisit d'abord ce qui a été fait
              et ce qui a été consommé — c'est l'ordre du garage, et c'est
              seulement une fois le total connu qu'on cherche à qui le
              facturer. Le demander en premier obligeait à interrompre la
              saisie pour aller chercher une fiche client. */}
          <Block step={3} icon={Users} title="Client & véhicule"
            hint="Sans client, l'intervention part au nom d'un « Client de passage »."
            grad="linear-gradient(135deg,#3730a3,#6366f1)" border="border-indigo-200" tint="bg-white">
            <div className="space-y-3">
              <ClientCarPicker
                clients={clients}
                clientId={clientId}
                onClientId={setClientId}
                car={car}
                onCar={setCar}
                onCreateClient={() => setShowClient(true)}
                passageLabel={PASSAGE} />

              <Field label="Description du problème / observations">
                <Textarea value={problem} onChange={e => setProblem(e.target.value)}
                  placeholder="Décrivez le travail à réaliser…" />
              </Field>
            </div>
          </Block>

          {/* ── 4 · Remise ──────────────────────────────────────────────────── */}
          <Block step={4} icon={Tag} title="Remise client"
            hint="Déduite du sous-total — prestations et produits confondus."
            grad="linear-gradient(135deg,#b45309,#f59e0b)" border="border-amber-200" tint="bg-amber-50/40"
            action={
              <span className="h-8 px-3 rounded-xl bg-white/20 flex items-center text-[11px] font-black tabular-nums">
                −{money(discountAmount)}
              </span>}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Type de remise">
                <div className="flex gap-1.5">
                  {([['none', 'Aucune'], ['percent', '%'], ['amount', 'DA']] as const).map(([m, lbl]) => (
                    <button key={m} onClick={() => setDiscountMode(m)}
                      className={`flex-1 h-[46px] rounded-xl text-xs font-black transition-all duration-200 active:scale-95
                                  ${discountMode === m ? 'text-white' : 'bg-white text-slate-500 border-2 border-slate-200 hover:border-amber-300'}`}
                      style={discountMode === m ? { background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 6px 16px rgba(245,158,11,0.32)' } : undefined}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={discountMode === 'percent' ? 'Pourcentage (%)' : 'Montant remisé (DA)'}
                hint={discountMode === 'percent' ? 'Appliqué sur le sous-total.' : undefined}>
                <div className="relative">
                  <Input type="number" min={0} value={discountStr} disabled={discountMode === 'none'}
                    onChange={e => setDiscountStr(e.target.value)} placeholder="0"
                    className={discountMode === 'none' ? 'opacity-50' : ''} />
                  {discountMode === 'percent' && <Percent className="w-4 h-4 text-slate-300 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />}
                </div>
              </Field>
              <Field label="Remise déduite">
                <div className="h-[46px] rounded-xl bg-white border-2 border-amber-200 flex items-center px-4 font-black tabular-nums text-amber-700">
                  −{money(discountAmount)}
                </div>
              </Field>
            </div>
          </Block>

          {/* ── 5 · Règlement ───────────────────────────────────────────────── */}
          <div className="rounded-2xl overflow-hidden text-white shadow-lg"
            style={{ background: 'linear-gradient(135deg,#001435,#003087 55%,#0044bb)' }}>
            <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-white/10">
              <span className="w-7 h-7 rounded-xl bg-white/15 flex items-center justify-center text-xs font-black shrink-0">5</span>
              <h4 className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
                <Banknote className="w-4 h-4 text-[#FFB800]" /> Règlement
              </h4>
              <span className="ml-auto text-[11px] font-bold text-blue-200">
                {pending ? 'Encaissement possible plus tard' : "Encaissé à l'enregistrement"}
              </span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-[10px] uppercase font-black text-blue-200">Prestations</p>
                  <p className="font-black tabular-nums">{money(serviceTotal)}</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-[10px] uppercase font-black text-blue-200">Produits</p>
                  <p className="font-black tabular-nums text-emerald-300">{money(productsTotal)}</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-[10px] uppercase font-black text-blue-200">Sous-total</p>
                  <p className="font-black tabular-nums">{money(subtotal)}</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-[10px] uppercase font-black text-blue-200">Remise</p>
                  <p className="font-black tabular-nums text-amber-300">−{money(discountAmount)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 rounded-xl bg-white/10 px-4 py-2.5">
                <span className="text-sm font-black text-blue-100 uppercase tracking-wider">Total à payer</span>
                <motion.span key={total}
                  initial={{ scale: 0.92, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="text-2xl font-black tabular-nums text-[#FFB800]">
                  {money(total)}
                </motion.span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-black uppercase tracking-wider text-blue-200">Payé</label>
                    {paidEdited ? (
                      <button onClick={() => { setPaidEdited(false); setPaidStr(''); }}
                        title="Reprendre le montant calculé"
                        className="text-[10px] font-black uppercase tracking-wider text-blue-100 bg-white/10
                                   hover:bg-white/20 rounded-lg px-2 py-0.5 transition-colors active:scale-95">
                        Montant saisi — remettre le total
                      </button>
                    ) : (
                      <span className={`text-[10px] font-black uppercase tracking-wider rounded-lg px-2 py-0.5
                                        ${pending ? 'text-amber-200 bg-amber-400/20' : 'text-emerald-200 bg-emerald-400/20'}`}>
                        {pending ? 'Acompte — facultatif' : 'Proposé — modifiable'}
                      </span>
                    )}
                  </div>
                  <input type="number"
                    value={paidEdited ? paidStr : (autoPaid ? String(Math.round(autoPaid * 100) / 100) : '')}
                    onChange={e => typePaid(e.target.value)}
                    placeholder={String(pending ? 0 : total)} className="input-field mt-1" />
                  <div className="flex gap-1.5 mt-1.5">
                    <button onClick={() => typePaid(String(total))}
                      className="flex-1 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-black transition-colors active:scale-95">
                      Payé en entier
                    </button>
                    <button onClick={() => typePaid('0')}
                      className="flex-1 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-black transition-colors active:scale-95">
                      Rien payé
                    </button>
                  </div>
                  <p className="text-[11px] text-blue-200 mt-1.5 px-1">
                    {paidEdited
                      ? 'Montant saisi à la main — il ne suit plus le total.'
                      : (pending
                        /* Une prise en charge n'a rien encaissé : proposer le
                           total ici ouvrirait un paiement qui n'a pas eu lieu.
                           Le champ se remplira tout seul à la finalisation. */
                        ? "Rien d'encaissé sur une intervention en attente — saisissez un acompte si le client en a versé un."
                        : "Le total à payer est repris automatiquement : corrigez-le si le client n'a pas tout réglé.")}
                  </p>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-blue-200">Reste</label>
                  <div className={`mt-1 h-[46px] rounded-xl bg-white/10 flex items-center px-4 font-black tabular-nums
                                   ${rest > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {money(rest)}
                  </div>
                  <p className="text-[11px] text-blue-200 mt-1.5 px-1">
                    {rest > 0 ? 'Le reste entrera dans la dette du client.' : 'Intervention entièrement réglée.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Un client créé depuis la fiche arrive parfois avec son parc : s'il n'a
          qu'une voiture, elle est reprise d'office — sinon le choix reste à
          faire dans la liste ci-dessus. */}
      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)}
        onSaved={c => { setClientId(c.id); if ((c.cars || []).length === 1) setCar({ ...c.cars![0] }); }} />

      {/* Scanner : les produits entrent les uns après les autres, la fenêtre
          reste ouverte le temps de passer l'huile, le filtre et le joint. */}
      <BarcodeScannerModal
        open={scanning}
        continuous
        title="Scanner un produit utilisé"
        subtitle="Chaque code lu entre dans les produits de l'intervention"
        lastResult={scanNote}
        onClose={() => setScanning(false)}
        onDetect={scanToUsed} />
    </>
  );
}

// ─── Bloc coloré du formulaire ────────────────────────────────────────────────
/**
 * Une étape du formulaire d'intervention, avec SA couleur : les prestations en
 * bleu station, les produits en vert, le client en indigo, la remise en ambre,
 * le règlement en marine. Un formulaire long se relit alors par blocs — on
 * retrouve « les produits » à la couleur avant même d'avoir lu le titre.
 */
function Block({ step, icon: Icon, title, hint, grad, border, tint, action, children }: {
  step: number; icon: React.ElementType; title: string; hint?: string;
  /** Dégradé de l'en-tête. */
  grad: string;
  /** Bordure de la carte, assortie. */
  border: string;
  /** Teinte très douce du corps. */
  tint: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border-2 ${border} bg-white shadow-sm overflow-hidden`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-white" style={{ background: grad }}>
        <span className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center text-xs font-black shrink-0">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider flex items-center gap-2">
            <Icon className="w-4 h-4 shrink-0" /> <span className="truncate">{title}</span>
          </h4>
          {hint && <p className="text-[11px] text-white/75 mt-0.5">{hint}</p>}
        </div>
        {action && <div className="shrink-0 w-full sm:w-auto">{action}</div>}
      </header>
      <div className={`p-3 sm:p-4 ${tint}`}>{children}</div>
    </section>
  );
}
