/**
 * ─── WorkerPaymentModal ─────────────────────────────────────────────────────────
 * The single salary-payment dialog shared by every worker screen of the app
 * (Pompistes, Gérants, Employés Magasin, Lavage & Cafétéria). Each screen maps
 * its own worker model to the normalised props below; the modal owns the whole
 * interaction — selecting the unpaid days / months / interventions, ticking the
 * acomptes, absences and décalages to apply, an optional prime, and a freely
 * editable net — then hands the result back through `onConfirm` so the caller
 * persists it in its own store.
 *
 * Sizing & chrome match the "Nouvelle brigade" assistant and the achats forms:
 * a wide dialog, a fixed gradient header/footer and a single scrolling body.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Banknote, X, CalendarDays, CalendarRange, Briefcase, Wallet, UserX, Scale,
  Gift, Check, Eye, CreditCard, ListChecks, ClipboardList, Save, Trash2,
} from 'lucide-react';
import { cn, formatCurrency } from '@/src/lib/utils';
import {
  SalaryType, PrimeType, PayAcompte, PayAbsence, PayDecalage, PayWork, PayInventaire,
  computeUnpaidWorkingDays, computeUnpaidMonths, computeNet, primeAmount,
  dayLabel, monthLabel, isoDay,
} from '@/src/lib/workerPay';
import { inventoryDeduction } from '@/src/lib/inventaire';

const money = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);

export interface WorkerPaymentResult {
  net: number;
  date: string;
  mode: string;
  chequeNumber?: string;
  notes?: string;
  prime: { type: PrimeType; value: number; amount: number } | null;
  selectedDays: string[];
  selectedMonths: string[];
  selectedAcompteIds: string[];
  selectedAbsenceIds: string[];
  selectedDecalageIds: string[];
  selectedWorkIds: string[];
  worksTotal: number;
  /** Inventaires retenus : leurs manquants sont constatés sur ce paiement. */
  selectedInventaireIds: string[];
  /** Somme des manquants des inventaires retenus. */
  inventaireTotal: number;
  /** Retenue réellement appliquée au titre des inventaires (0 si désactivée). */
  inventaireDeduction: number;
  inventaireDeductionActive: boolean;
  inventaireDeductionType: PrimeType;
  inventaireDeductionValue: number;
  breakdown: {
    base: number; acomptes: number; absences: number;
    decalageBonus: number; decalageRetenue: number; prime: number; inventaire: number;
  };
}

export interface WorkerPaymentModalProps {
  open: boolean;
  onClose: () => void;
  worker: {
    name: string;
    role?: string;
    salaryType: SalaryType;
    /** Daily rate (jour) or monthly salary (mois). */
    salaryAmount: number;
    percentage?: number;
    workDays?: number[];
    startDate?: string;
  };
  acomptes?: PayAcompte[];
  absences?: PayAbsence[];
  /** Pompiste-only décalage lines (with their brigade label). */
  decalages?: PayDecalage[];
  /** Percentage-paid: the unpaid interventions. */
  works?: PayWork[];
  /**
   * Inventaires non réglés dont les manquants concernent cet employé. Ne sont
   * passés que pour un employé marqué « concerné par les inventaires ».
   */
  inventaires?: PayInventaire[];
  /** Sélection d'inventaires enregistrée précédemment pour cet employé. */
  savedInventaireIds?: string[];
  /** Retire définitivement un inventaire de l'écran de paie de cet employé. */
  onDismissInventaire?: (id: string) => void;
  /** Enregistre la sélection d'inventaires sans passer par un paiement. */
  onSaveInventaireSelection?: (ids: string[]) => void;
  /** Dette d'inventaire déjà constatée sur les paiements précédents. */
  inventaireDebt?: number;
  /** Days / months already settled by earlier payments — excluded from the list. */
  paidDays?: string[];
  paidMonths?: string[];
  /** Recent payments shown at the bottom. */
  history?: { label: string; date: string; amount: number }[];
  /** Payment modes offered in the dropdown. */
  modes?: string[];
  onConfirm: (result: WorkerPaymentResult) => void;
  /** Percentage-paid: opens the "detail of all works" screen. */
  onShowWorkDetails?: () => void;
}

const setToggle = (s: Set<string>, id: string) => {
  const n = new Set(s);
  n.has(id) ? n.delete(id) : n.add(id);
  return n;
};

export default function WorkerPaymentModal(props: WorkerPaymentModalProps) {
  const { open, onClose, worker } = props;
  const acomptes = props.acomptes || [];
  const absences = props.absences || [];
  const decalages = props.decalages || [];
  const works = props.works || [];
  const modes = props.modes && props.modes.length ? props.modes : ['Espèces', 'Chèque', 'Virement'];

  const isDay = worker.salaryType === 'jour';
  const isMonth = worker.salaryType === 'mois';
  const isPercent = worker.salaryType === 'pourcentage';
  const rate = worker.percentage || 0;

  // ── Unpaid periods (computed from the system date) ────────────────────────────
  const absenceDays = useMemo(() => absences.filter(a => !a.paid).map(a => a.date), [absences]);
  const unpaidDays = useMemo(
    () => (isDay ? computeUnpaidWorkingDays({
      workDays: worker.workDays, startDate: worker.startDate,
      paidDays: props.paidDays, absenceDays,
    }) : []),
    [isDay, worker.workDays, worker.startDate, props.paidDays, absenceDays]);
  const unpaidMonths = useMemo(
    () => (isMonth ? computeUnpaidMonths({ startDate: worker.startDate, paidMonths: props.paidMonths }) : []),
    [isMonth, worker.startDate, props.paidMonths]);

  // ── Selection state (everything ticked by default) ────────────────────────────
  // The dialog is remounted on every open, so lazy initialisers seed the ticks
  // once with no first-frame flash.
  const [selDays, setSelDays] = useState<Set<string>>(() => new Set(unpaidDays));
  const [selMonths, setSelMonths] = useState<Set<string>>(() => new Set(unpaidMonths));
  const [selWorks, setSelWorks] = useState<Set<string>>(() => new Set(works.map(w => w.id)));
  const [selAcomptes, setSelAcomptes] = useState<Set<string>>(() => new Set(acomptes.filter(a => !a.paid).map(a => a.id)));
  const [selAbsences, setSelAbsences] = useState<Set<string>>(() => new Set(absences.filter(a => !a.paid).map(a => a.id)));
  const [selDecalages, setSelDecalages] = useState<Set<string>>(() => new Set(decalages.filter(d => !d.paid).map(d => d.id)));

  const [primeOn, setPrimeOn] = useState(false);
  const [primeType, setPrimeType] = useState<PrimeType>('percent');
  const [primeValue, setPrimeValue] = useState(0);

  // ── Inventaires ───────────────────────────────────────────────────────────
  // Sélectionner un inventaire CONSTATE son manquant sur ce paiement ; activer
  // la retenue est une décision séparée, et le pourcentage (ou le montant fixe)
  // décide de la part réellement retenue au salarié.
  const inventaires = props.inventaires || [];
  const [selInventaires, setSelInventaires] = useState<Set<string>>(() => {
    const saved = props.savedInventaireIds?.filter(id => inventaires.some(i => i.id === id));
    return new Set(saved && saved.length ? saved : inventaires.map(i => i.id));
  });
  const [invDeductOn, setInvDeductOn] = useState(false);
  const [invDeductType, setInvDeductType] = useState<PrimeType>('percent');
  const [invDeductValue, setInvDeductValue] = useState(0);

  const [date, setDate] = useState(isoDay(new Date()));
  const [mode, setMode] = useState(modes[0]);
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [net, setNet] = useState(0);
  const [netTouched, setNetTouched] = useState(false);

  // ── Live breakdown ────────────────────────────────────────────────────────────
  const base = useMemo(() => {
    if (isDay) return worker.salaryAmount * selDays.size;
    if (isMonth) return worker.salaryAmount * selMonths.size;
    if (isPercent) return works.filter(w => selWorks.has(w.id)).reduce((s, w) => s + w.share, 0);
    return worker.salaryAmount;
  }, [isDay, isMonth, isPercent, worker.salaryAmount, selDays, selMonths, selWorks, works]);

  const acomptesDue = acomptes.filter(a => selAcomptes.has(a.id)).reduce((s, a) => s + a.amount, 0);
  const absencesDue = absences.filter(a => selAbsences.has(a.id)).reduce((s, a) => s + a.cost, 0);
  const decBonus = decalages.filter(d => d.type === 'BONUS' && selDecalages.has(d.id)).reduce((s, d) => s + d.amount, 0);
  const decRetenue = decalages.filter(d => d.type === 'RETENUE' && selDecalages.has(d.id)).reduce((s, d) => s + d.amount, 0);
  const prime = primeOn ? primeAmount(base, primeType, primeValue) : 0;

  const inventaireTotal = inventaires
    .filter(i => selInventaires.has(i.id))
    .reduce((s, i) => s + i.lossValue, 0);
  const invDeduction = inventoryDeduction(inventaireTotal, invDeductOn, invDeductType, invDeductValue);

  const computed = computeNet({ base, acomptes: acomptesDue, absences: absencesDue, decalageBonus: decBonus, decalageRetenue: decRetenue, prime, inventaire: invDeduction });
  const worksTotal = works.filter(w => selWorks.has(w.id)).reduce((s, w) => s + w.base, 0);

  React.useEffect(() => { if (!netTouched) setNet(computed); }, [computed, netTouched]);

  const confirm = () => {
    props.onConfirm({
      net, date, mode,
      chequeNumber: chequeNumber || undefined,
      notes: notes || undefined,
      prime: primeOn && prime > 0 ? { type: primeType, value: Number(primeValue) || 0, amount: prime } : null,
      selectedDays: [...selDays],
      selectedMonths: [...selMonths],
      selectedAcompteIds: [...selAcomptes],
      selectedAbsenceIds: [...selAbsences],
      selectedDecalageIds: [...selDecalages],
      selectedWorkIds: [...selWorks],
      worksTotal,
      selectedInventaireIds: [...selInventaires],
      inventaireTotal,
      inventaireDeduction: invDeduction,
      inventaireDeductionActive: invDeductOn,
      inventaireDeductionType: invDeductType,
      inventaireDeductionValue: Number(invDeductValue) || 0,
      breakdown: { base, acomptes: acomptesDue, absences: absencesDue, decalageBonus: decBonus, decalageRetenue: decRetenue, prime, inventaire: invDeduction },
    });
  };

  if (!open || typeof document === 'undefined') return null;

  const periodTitle = isDay ? 'Jours non payés' : isMonth ? 'Mois non payés' : 'Interventions non payées';
  const periodCount = isDay ? selDays.size : isMonth ? selMonths.size : selWorks.size;
  const periodTotal = isDay ? unpaidDays.length : isMonth ? unpaidMonths.length : works.length;

  return createPortal(
    <AnimatePresence>
      <div className="modal-shell z-[70] text-left">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="modal-box modal-box-full max-w-5xl relative z-10 flex flex-col"
        >
          {/* Header */}
          <div className="p-5 sm:p-6 bg-gradient-to-r from-[#001f5c] via-blue-800 to-[#002d87] text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 bg-[#FFB800] rounded-2xl flex items-center justify-center text-blue-900 shadow-lg shrink-0">
                <Banknote className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h3 className="font-black uppercase tracking-wider text-base sm:text-lg truncate">Paiement du salaire</h3>
                <p className="text-[11px] sm:text-xs text-blue-100 font-semibold truncate">
                  {worker.name}{worker.role ? ` · ${worker.role}` : ''} ·{' '}
                  {isDay ? `Journalier — ${money(worker.salaryAmount)}/jour`
                    : isMonth ? `Mensuel — ${money(worker.salaryAmount)}/mois`
                      : `Pourcentage — ${rate}% des travaux`}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-5 bg-slate-50">
            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label="Mode de paie" tone="blue"
                value={isDay ? 'Journalier' : isMonth ? 'Mensuel' : `${rate}%`} />
              <Tile label={isDay ? 'Jours retenus' : isMonth ? 'Mois retenus' : 'Travaux retenus'} tone="slate"
                value={`${periodCount} / ${periodTotal}`} />
              <Tile label="Base" tone="slate" value={money(base)} />
              <Tile label="Net à payer" tone="gold" value={money(net)} />
            </div>

            {/* Période à payer */}
            <Section icon={isDay ? CalendarDays : isMonth ? CalendarRange : Briefcase} title={periodTitle}
              hint={isDay ? 'Tous les jours travaillés non encore payés sont cochés. Décochez ceux à ne pas régler.'
                : isMonth ? 'Chaque mois dû est coché par défaut.'
                  : 'Les interventions déjà payées ne réapparaissent pas.'}
              action={isPercent && props.onShowWorkDetails ? (
                <button onClick={props.onShowWorkDetails} className="text-[11px] font-black uppercase tracking-wide text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-xl flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> Détail des travaux
                </button>
              ) : (periodTotal > 0 ? (
                <SelectAll all={selectAllState(periodCount, periodTotal)} onToggle={() => {
                  if (isDay) setSelDays(prev => prev.size === unpaidDays.length ? new Set() : new Set(unpaidDays));
                  else if (isMonth) setSelMonths(prev => prev.size === unpaidMonths.length ? new Set() : new Set(unpaidMonths));
                }} />
              ) : undefined)}
            >
              {isDay && (unpaidDays.length === 0
                ? <Empty label="Aucun jour non payé." />
                : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {unpaidDays.map(d => (
                      <ChkPill key={d} checked={selDays.has(d)} onToggle={() => setSelDays(s => setToggle(s, d))}
                        left={dayLabel(d)} right={money(worker.salaryAmount)} />
                    ))}
                  </div>)}

              {isMonth && (unpaidMonths.length === 0
                ? <Empty label="Aucun mois non payé." />
                : <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {unpaidMonths.map(m => (
                      <ChkRow key={m} checked={selMonths.has(m)} onToggle={() => setSelMonths(s => setToggle(s, m))}
                        title={monthLabel(m)} amount={money(worker.salaryAmount)} />
                    ))}
                  </div>)}

              {isPercent && (works.length === 0
                ? <Empty label="Aucun travail non payé pour cet employé." />
                : <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                    {works.map(w => (
                      <ChkRow key={w.id} checked={selWorks.has(w.id)} onToggle={() => setSelWorks(s => setToggle(s, w.id))}
                        title={w.label} subtitle={w.sublabel} amount={`+${money(w.share)}`} sub2={`base ${money(w.base)}`} tone="green" />
                    ))}
                  </div>)}
            </Section>

            {/* Acomptes */}
            <Section icon={Wallet} title="Acomptes à décompter" tone="amber"
              hint="Cochez les avances à soustraire du net. Les acomptes cochés seront marqués comme réglés."
              action={acomptes.length > 0 ? <SelectAll all={selectAllState(selAcomptes.size, acomptes.length)}
                onToggle={() => setSelAcomptes(s => s.size === acomptes.length ? new Set() : new Set(acomptes.map(a => a.id)))} /> : undefined}>
              {acomptes.length === 0 ? <Empty label="Aucun acompte." /> : (
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {acomptes.map(a => (
                    <ChkRow key={a.id} checked={selAcomptes.has(a.id)} onToggle={() => setSelAcomptes(s => setToggle(s, a.id))}
                      title={a.description || 'Acompte'} subtitle={dayLabel(a.date) + (a.paid ? ' · déjà décompté' : '')}
                      amount={`−${money(a.amount)}`} tone="amber" />
                  ))}
                </div>)}
            </Section>

            {/* Absences */}
            <Section icon={UserX} title="Absences / retenues" tone="red"
              hint="Cochées par défaut. Les jours d'absence sont déjà exclus du décompte des jours travaillés."
              action={absences.length > 0 ? <SelectAll all={selectAllState(selAbsences.size, absences.length)}
                onToggle={() => setSelAbsences(s => s.size === absences.length ? new Set() : new Set(absences.map(a => a.id)))} /> : undefined}>
              {absences.length === 0 ? <Empty label="Aucune absence." /> : (
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {absences.map(a => (
                    <ChkRow key={a.id} checked={selAbsences.has(a.id)} onToggle={() => setSelAbsences(s => setToggle(s, a.id))}
                      title={a.description || 'Absence'} subtitle={dayLabel(a.date)}
                      amount={a.cost > 0 ? `−${money(a.cost)}` : '—'} tone="red" />
                  ))}
                </div>)}
            </Section>

            {/* Décalages (pompiste) */}
            {decalages.length > 0 && (
              <Section icon={Scale} title="Décalages (par brigade)" tone="blue"
                hint="Primes (surplus) ajoutées, retenues (manque) soustraites. Cochez celles à encaisser sur CE paiement ; décochez celles qui attendront le suivant."
                action={<SelectAll all={selectAllState(selDecalages.size, decalages.length)}
                  onToggle={() => setSelDecalages(s => s.size === decalages.length ? new Set() : new Set(decalages.map(d => d.id)))} />}>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {decalages.map(d => (
                    <ChkRow key={d.id} checked={selDecalages.has(d.id)} onToggle={() => setSelDecalages(s => setToggle(s, d.id))}
                      title={d.label || (d.type === 'BONUS' ? 'Prime (surplus)' : 'Retenue (manque)')}
                      subtitle={dayLabel(d.date)}
                      amount={`${d.type === 'BONUS' ? '+' : '−'}${money(d.amount)}`}
                      tone={d.type === 'BONUS' ? 'green' : 'red'} />
                  ))}
                </div>
              </Section>
            )}

            {/* ── Inventaires ────────────────────────────────────────────────
                Un employé « concerné par les inventaires » répond des manquants
                constatés au comptage. Deux décisions distinctes se prennent ici :
                  1. QUELS inventaires on lui oppose (cocher / écarter) ;
                  2. COMBIEN on lui retient là-dessus — rien du tout, un
                     pourcentage des manquants, ou une somme fixe.
                Sans la seconde, le décalage est simplement constaté et gardé
                dans son dossier, sans toucher à son salaire. */}
            {inventaires.length > 0 && (
              <Section icon={ClipboardList} title="Décalages d'inventaire" tone="amber"
                hint="Manquants constatés au comptage, valorisés au prix d'achat. Décochez ce qui ne le concerne pas ; « Écarter » le retire définitivement de son écran de paie."
                action={
                  <div className="flex items-center gap-2">
                    <SelectAll all={selectAllState(selInventaires.size, inventaires.length)}
                      onToggle={() => setSelInventaires(s => s.size === inventaires.length ? new Set() : new Set(inventaires.map(i => i.id)))} />
                    {props.onSaveInventaireSelection && (
                      <button onClick={() => props.onSaveInventaireSelection!([...selInventaires])}
                        className="text-[11px] font-black uppercase tracking-wide text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-xl flex items-center gap-1.5">
                        <Save className="w-3.5 h-3.5" /> Enregistrer la sélection
                      </button>
                    )}
                  </div>
                }>
                <div className="space-y-2">
                  <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {inventaires.map(inv => {
                      const checked = selInventaires.has(inv.id);
                      return (
                        <div key={inv.id}
                          className={cn('w-full flex items-center gap-3 rounded-xl border p-2.5 transition-colors',
                            checked ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-200')}>
                          <button onClick={() => setSelInventaires(s => setToggle(s, inv.id))}
                            className="flex items-center gap-3 min-w-0 flex-1 text-left">
                            <Box checked={checked} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-bold text-slate-700 text-sm truncate">{inv.label}</span>
                              <span className="block text-[11px] text-slate-400 truncate">
                                {dayLabel(inv.date)}
                                {inv.sublabel ? ` · ${inv.sublabel}` : ''}
                                {` · ${inv.productCount} produit(s) manquant(s)`}
                              </span>
                            </span>
                            <span className="font-black tabular-nums text-sm text-amber-700 shrink-0">
                              {money(inv.lossValue)}
                            </span>
                          </button>
                          {props.onDismissInventaire && (
                            <button onClick={() => {
                              setSelInventaires(s => { const n = new Set(s); n.delete(inv.id); return n; });
                              props.onDismissInventaire!(inv.id);
                            }}
                              title="Écarter cet inventaire — il ne réapparaîtra plus pour cet employé"
                              className="w-8 h-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center shrink-0">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-black uppercase tracking-wide text-amber-700">
                      Total des manquants retenus ({selInventaires.size} inventaire(s))
                    </span>
                    <span className="font-black tabular-nums text-amber-800">{money(inventaireTotal)}</span>
                  </div>

                  {/* Combien on lui retient réellement */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-700">Retenir sur le salaire</p>
                        <p className="text-[11px] text-slate-400">
                          Désactivé, le décalage est constaté dans son dossier mais rien n'est déduit de sa paie.
                        </p>
                      </div>
                      <SwitchMini checked={invDeductOn} onChange={setInvDeductOn} />
                    </div>
                    {invDeductOn && (
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex rounded-xl overflow-hidden border border-slate-200">
                          {(['percent', 'amount'] as PrimeType[]).map(t => (
                            <button key={t} onClick={() => setInvDeductType(t)}
                              className={cn('px-4 py-2.5 text-xs font-black uppercase tracking-wide transition-colors',
                                invDeductType === t ? 'bg-[#003087] text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                              {t === 'percent' ? '% des manquants' : 'Montant fixe'}
                            </button>
                          ))}
                        </div>
                        <div className="flex-1 min-w-[140px]">
                          <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">
                            {invDeductType === 'percent' ? 'Pourcentage (%)' : 'Montant (DA)'}
                          </label>
                          <input type="number" className="input-field font-black" value={invDeductValue}
                            onChange={e => setInvDeductValue(Number(e.target.value))} />
                        </div>
                        <div className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-black tabular-nums">
                          −{money(invDeduction)}
                        </div>
                      </div>
                    )}
                    {invDeductOn && invDeduction < inventaireTotal && (
                      <p className="text-[11px] text-slate-500">
                        Reste à sa charge sans être retenu cette fois : {money(inventaireTotal - invDeduction)}.
                      </p>
                    )}
                  </div>

                  {(props.inventaireDebt || 0) > 0 && (
                    <p className="text-[11px] text-slate-500">
                      Dette d'inventaire déjà constatée sur ses paiements précédents :{' '}
                      <b className="text-red-600">{money(props.inventaireDebt || 0)}</b>.
                    </p>
                  )}
                </div>
              </Section>
            )}

            {/* Prime */}
            <Section icon={Gift} title="Prime" tone="green"
              hint="Ajoute un bonus au net à payer."
              action={<SwitchMini checked={primeOn} onChange={setPrimeOn} />}>
              {!primeOn ? <Empty label="Aucune prime." /> : (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex rounded-xl overflow-hidden border border-slate-200">
                    {(['percent', 'amount'] as PrimeType[]).map(t => (
                      <button key={t} onClick={() => setPrimeType(t)}
                        className={cn('px-4 py-2.5 text-xs font-black uppercase tracking-wide transition-colors',
                          primeType === t ? 'bg-[#003087] text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                        {t === 'percent' ? '% pourcentage' : 'Montant fixe'}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">{primeType === 'percent' ? 'Pourcentage (%)' : 'Montant (DA)'}</label>
                    <input type="number" className="input-field font-black" value={primeValue}
                      onChange={e => setPrimeValue(Number(e.target.value))} />
                  </div>
                  <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-black tabular-nums">
                    +{money(prime)}
                  </div>
                </div>
              )}
            </Section>

            {/* Récapitulatif + net */}
            <div className="rounded-3xl bg-gradient-to-br from-[#001f5c] to-blue-800 text-white p-5 sm:p-6 shadow-xl space-y-4">
              <p className="text-[11px] font-black text-[#FFB800] uppercase tracking-widest flex items-center gap-2">
                <ListChecks className="w-4 h-4" /> Récapitulatif
              </p>
              <div className="bg-white/5 rounded-2xl p-4 space-y-2.5 text-sm border border-white/10">
                <Line label={isDay ? `Salaire (${selDays.size} j × ${money(worker.salaryAmount)})` : isMonth ? `Salaire (${selMonths.size} mois)` : `Part ${rate}% des travaux`} value={money(base)} strong />
                {acomptesDue > 0 && <Line label="− Acomptes" value={`−${money(acomptesDue)}`} tone="red" />}
                {absencesDue > 0 && <Line label="− Absences / retenues" value={`−${money(absencesDue)}`} tone="orange" />}
                {decBonus > 0 && <Line label="+ Primes décalage" value={`+${money(decBonus)}`} tone="green" />}
                {decRetenue > 0 && <Line label="− Retenues décalage" value={`−${money(decRetenue)}`} tone="red" />}
                {prime > 0 && <Line label="+ Prime" value={`+${money(prime)}`} tone="green" />}
                {invDeduction > 0 && (
                  <Line label={`− Décalage inventaire (${invDeductType === 'percent' ? `${invDeductValue}% de ${money(inventaireTotal)}` : 'montant fixe'})`}
                    value={`−${money(invDeduction)}`} tone="red" />
                )}
                {inventaireTotal > 0 && invDeduction === 0 && (
                  <Line label={`Décalage inventaire constaté (non retenu)`} value={money(inventaireTotal)} tone="orange" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="text-[10px] font-black text-blue-200 uppercase tracking-widest">Net à payer (modifiable)</label>
                  <div className="flex items-center gap-2 mt-1.5">
                    <input type="number" value={net}
                      onChange={e => { setNet(Number(e.target.value)); setNetTouched(true); }}
                      className="w-full px-4 py-3 rounded-xl bg-white text-[#001f5c] font-black text-2xl tabular-nums outline-none focus:ring-4 focus:ring-[#FFB800]/40" />
                    {netTouched && (
                      <button onClick={() => { setNetTouched(false); setNet(computed); }}
                        title="Recalculer automatiquement"
                        className="px-3 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-[10px] font-black uppercase">Auto</button>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest">Montant final</p>
                  <p className="text-4xl sm:text-5xl font-black text-[#FFB800] tabular-nums leading-none mt-1">{money(net)}</p>
                </div>
              </div>
            </div>

            {/* Paiement */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Date</label>
                <input type="date" className="input-field font-black text-xs" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Mode</label>
                <select className="input-field font-black text-xs" value={mode} onChange={e => setMode(e.target.value)}>
                  {modes.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {(mode === 'Chèque' || mode === 'Virement') && (
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">N° {mode}</label>
                  <input className="input-field font-black text-xs" value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} placeholder="Ex: 123456" />
                </div>
              )}
              <div className={cn(mode === 'Chèque' || mode === 'Virement' ? '' : 'sm:col-span-2 lg:col-span-2')}>
                <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Notes</label>
                <input className="input-field font-black text-xs" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optionnel" />
              </div>
            </div>

            {/* Historique */}
            {props.history && props.history.length > 0 && (
              <Section icon={CreditCard} title="Derniers paiements" tone="slate">
                <div className="space-y-1.5">
                  {props.history.slice(0, 4).map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <span className="font-semibold text-slate-600">{h.label} · {dayLabel(h.date)}</span>
                      <span className="font-black tabular-nums text-slate-700">{money(h.amount)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 sm:p-5 bg-white border-t border-slate-200 flex gap-3 shrink-0">
            <button onClick={onClose}
              className="flex-1 text-[11px] font-black uppercase tracking-widest text-slate-600 border-2 border-slate-200 rounded-xl py-3 hover:bg-slate-50 transition-colors">
              Annuler
            </button>
            <button onClick={confirm}
              className="flex-[2] bg-gradient-to-r from-emerald-600 to-emerald-500 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-xl py-3 transition-all hover:-translate-y-0.5 text-[11px] flex items-center justify-center gap-2 shadow-md shadow-emerald-200/60">
              <Check className="w-4 h-4" /> Enregistrer le paiement · {money(net)}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────────
function selectAllState(sel: number, total: number): 'all' | 'none' | 'some' {
  if (total === 0 || sel === 0) return 'none';
  return sel >= total ? 'all' : 'some';
}

function SelectAll({ all, onToggle }: { all: 'all' | 'none' | 'some'; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="text-[11px] font-black uppercase tracking-wide text-slate-500 hover:text-blue-700 flex items-center gap-1.5">
      <span className={cn('w-4 h-4 rounded border-2 flex items-center justify-center',
        all === 'all' ? 'bg-[#003087] border-[#003087]' : all === 'some' ? 'bg-blue-200 border-blue-400' : 'border-slate-300')}>
        {all !== 'none' && <Check className="w-3 h-3 text-white" />}
      </span>
      {all === 'all' ? 'Tout décocher' : 'Tout cocher'}
    </button>
  );
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone: 'blue' | 'slate' | 'gold' }) {
  const tones = {
    blue: 'bg-blue-50 border-blue-100 text-blue-900',
    slate: 'bg-white border-slate-200 text-slate-800',
    gold: 'bg-[#001f5c] border-[#001f5c] text-[#FFB800]',
  } as const;
  return (
    <div className={cn('rounded-2xl border p-3', tones[tone])}>
      <p className={cn('text-[9px] font-black uppercase tracking-widest mb-1', tone === 'gold' ? 'text-blue-200' : 'text-slate-400')}>{label}</p>
      <p className="text-lg font-black tabular-nums leading-tight">{value}</p>
    </div>
  );
}

function Section({ icon: Icon, title, hint, action, tone = 'slate', children }: {
  icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode;
  tone?: 'slate' | 'amber' | 'red' | 'blue' | 'green'; children: React.ReactNode;
}) {
  const iconTones = {
    slate: 'bg-slate-100 text-slate-600', amber: 'bg-amber-100 text-amber-600',
    red: 'bg-red-100 text-red-600', blue: 'bg-blue-100 text-blue-700', green: 'bg-emerald-100 text-emerald-600',
  } as const;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', iconTones[tone])}><Icon className="w-4 h-4" /></div>
        <div className="min-w-0 flex-1">
          <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#002d87] truncate">{title}</h4>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-slate-400 text-center py-3">{label}</p>;
}

const rowTones = {
  slate: 'text-slate-700', amber: 'text-amber-700', red: 'text-red-600', green: 'text-emerald-600',
} as const;

function ChkRow({ checked, onToggle, title, subtitle, amount, sub2, tone = 'slate' }: {
  checked: boolean; onToggle: () => void; title: string; subtitle?: string;
  amount: React.ReactNode; sub2?: string; tone?: keyof typeof rowTones; key?: React.Key;
}) {
  return (
    <button onClick={onToggle}
      className={cn('w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors',
        checked ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-slate-200 hover:bg-slate-50')}>
      <Box checked={checked} />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-700 text-sm truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className={cn('font-black tabular-nums text-sm', rowTones[tone])}>{amount}</p>
        {sub2 && <p className="text-[10px] text-slate-400 tabular-nums">{sub2}</p>}
      </div>
    </button>
  );
}

function ChkPill({ checked, onToggle, left, right }: { checked: boolean; onToggle: () => void; left: string; right: string; key?: React.Key }) {
  return (
    <button onClick={onToggle}
      className={cn('flex items-center gap-2 rounded-xl border p-2 text-left transition-colors',
        checked ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-slate-200 hover:bg-slate-50')}>
      <Box checked={checked} />
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-slate-700 capitalize truncate">{left}</p>
        <p className="text-[10px] text-slate-400 tabular-nums truncate">{right}</p>
      </div>
    </button>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
      checked ? 'bg-[#003087] border-[#003087]' : 'border-slate-300 bg-white')}>
      {checked && <Check className="w-3.5 h-3.5 text-white" />}
    </span>
  );
}

function SwitchMini({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={cn('w-11 h-6 rounded-full relative transition-colors shrink-0', checked ? 'bg-emerald-500' : 'bg-slate-300')}>
      <span className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: 'red' | 'orange' | 'green'; strong?: boolean }) {
  const tones = { red: 'text-red-300', orange: 'text-orange-300', green: 'text-emerald-300' };
  return (
    <div className="flex items-center justify-between">
      <span className={cn(tone ? tones[tone] : 'text-blue-200', strong && 'text-white font-semibold')}>{label}</span>
      <span className={cn('font-black tabular-nums', strong ? 'text-white text-lg' : tone ? tones[tone] : 'text-blue-100')}>{value}</span>
    </div>
  );
}
