/**
 * ─── Employés & Personnel (rapport général) ────────────────────────────────────
 * Liste TOUS les employés de la station — pompistes, chefs de brigade, gérants,
 * employés magasin, cafétéria, magasin — et déplie pour chacun le
 * détail complet de son activité sur la période :
 *
 *  • Pompiste / chef  → chaque brigade assignée : piste, pompes, index de chaque
 *    pistolet, litres, théorique, versements horodatés, encaissement, décalage,
 *    comptabilité et justifications.
 *  • Cafétéria        → chaque session de travail et toutes ses ventes.
 *  • Lavage           → son pourcentage, chaque travail assigné prestation par
 *    prestation, la base retenue, sa part et son état de règlement.
 *  • Tout le monde    → salaires, acomptes, absences, compte de connexion.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Users, UsersRound, Wallet, Banknote, CalendarMinus, ChevronDown, ChevronRight,
  Fuel, Coffee, Droplets, Target, Gauge, Clock, Car, ShoppingCart, Lock, Percent,
  Search, Briefcase, TrendingUp, TrendingDown, Layers, Receipt, ClipboardList,
  UtensilsCrossed,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, matchesSearch } from '@/src/lib/utils';
import { money, formatDate, Table } from '@/src/components/biz/Kit';
import {
  WorkforceReport, WorkforceWorker, WorkforcePart, WFBrigade, PART_META,
} from '@/src/lib/workforceReporting';

const fmtDate = (s?: string) => (s ? formatDate(s) : '—');
const fmtDateTime = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('fr-DZ', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const liters = (n: number) => `${(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`;
/**
 * La fenêtre lue, même quand elle est ouverte d'un côté : le panneau est aussi
 * appelé depuis la Caisse d'une partie, où « ce mois » n'a pas de borne haute.
 */
const rangeLabel = (from?: string, to?: string) => (!from && !to
  ? 'toutes les dates'
  : `${from ? fmtDate(from) : 'origine'} → ${to ? fmtDate(to) : "aujourd'hui"}`);

const PART_ICON: Record<WorkforcePart, React.ElementType> = {
  carburant: Fuel, restaurant: UtensilsCrossed, cafeteria: Coffee, lavage: Droplets,
};

// ─── Small building blocks ───────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, sub, tone = 'blue' }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan' | 'slate';
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', amber: 'from-amber-500 to-yellow-500',
    red: 'from-red-500 to-red-600', purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600',
    slate: 'from-slate-500 to-slate-600',
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

function Section({ title, icon: Icon, count, children }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-black uppercase tracking-widest text-[#002d87] flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-[#FFB800]" /> {title}
        {typeof count === 'number' && <span className="text-slate-400 font-bold">({count})</span>}
      </h4>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 italic py-2">{text}</p>;
}

function Chip({ label, value, tone = 'slate' }: { label: string; value: React.ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-700', green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700',
  };
  return (
    <div className={cn('rounded-xl px-3 py-2', tones[tone])}>
      <p className="text-[9px] uppercase font-black tracking-wide opacity-60">{label}</p>
      <p className="font-black tabular-nums text-sm leading-tight">{value}</p>
    </div>
  );
}

// ─── Brigade detail (pompiste / chef) ────────────────────────────────────────
function BrigadeRow({ b }: { b: WFBrigade; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  const hasDetail = b.indices.length > 0 || b.versements.length > 0 || b.justifications.length > 0 || !!b.accounting;
  return (
    <>
      <tr className={cn(hasDetail && 'cursor-pointer hover:bg-slate-50')} onClick={() => hasDetail && setOpen(o => !o)}>
        <td className="table-cell text-slate-400 w-6">
          {hasDetail ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}
        </td>
        <td className="table-cell whitespace-nowrap font-bold">{fmtDateTime(b.date)}</td>
        <td className="table-cell"><span className="badge badge-info">{b.shift}</span></td>
        <td className="table-cell text-slate-500">{b.chefName}</td>
        <td className="table-cell text-slate-500">{b.track}</td>
        <td className="table-cell text-slate-500 max-w-[160px] truncate">{b.pumps.length ? b.pumps.join(', ') : '—'}</td>
        <td className="table-cell tabular-nums text-right">{liters(b.liters)}</td>
        <td className="table-cell tabular-nums text-right text-blue-700">{money(b.theoretical)}</td>
        <td className="table-cell tabular-nums text-right text-emerald-600">{money(b.collected)}</td>
        <td className={cn('table-cell tabular-nums text-right font-bold', b.decalage < 0 ? 'text-red-600' : b.decalage > 0 ? 'text-emerald-600' : 'text-slate-400')}>
          {money(b.decalage)}
        </td>
        <td className="table-cell">
          <span className={cn('badge', b.status === 'Clôturée' || b.status === 'Fermée' ? 'badge-success' : b.status === 'Ouverte' ? 'badge-warning' : 'badge-neutral')}>{b.status}</span>
        </td>
      </tr>
      {open && hasDetail && (
        <tr><td colSpan={11} className="bg-slate-50/70 px-4 py-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              <Chip label="Début" value={fmtDateTime(b.start)} />
              <Chip label="Fin" value={fmtDateTime(b.end)} />
              <Chip label="Durée" value={b.durationH !== undefined ? `${b.durationH} h` : '—'} />
              <Chip label="Prix / litre" value={b.pricePerLiter ? money(b.pricePerLiter) : '—'} />
              <Chip label="Présent" value={b.present ? 'Oui' : 'Non'} tone={b.present ? 'green' : 'red'} />
              <Chip label="Rôle" value={b.actingAsPompiste ? 'Chef pompiste' : b.role} />
              <Chip label="Espèces" value={money(b.cash)} tone="green" />
              <Chip label="Bons" value={money(b.bons)} tone="amber" />
              <Chip label="Chèques" value={money(b.cheques)} tone="blue" />
              <Chip label="Total encaissé" value={money(b.collected)} tone="green" />
              <Chip label="Versements" value={money(b.versementsTotal)} tone="blue" />
              <Chip label="Décalage" value={money(b.decalage)} tone={b.decalage < 0 ? 'red' : 'green'} />
            </div>

            {b.accounting && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Chip label="Comptabilité" value={b.accounting.status} tone="blue" />
                <Chip label="Total dû" value={money(b.accounting.totalDue)} />
                <Chip label="Espèces reçues" value={money(b.accounting.cashReceived)} tone="green" />
                <Chip label="Reste" value={money(b.accounting.rest)} tone={b.accounting.rest > 0 ? 'red' : 'green'} />
                <Chip label="Reste à sa charge" value={money(b.accounting.assignedRest)} tone={b.accounting.assignedRest > 0 ? 'red' : 'slate'} />
              </div>
            )}

            {b.indices.length > 0 && (
              <Section title="Index des pistolets" icon={Gauge} count={b.indices.length}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {b.indices.map((ix, i) => (
                    <div key={i} className="rounded-xl bg-white border border-slate-100 px-3 py-2">
                      <p className="text-[11px] font-bold text-slate-600 truncate">{ix.label}</p>
                      <div className="flex items-center justify-between text-[11px] mt-1">
                        <span className="text-slate-400 tabular-nums">{ix.start.toLocaleString('fr-FR')} → {ix.end.toLocaleString('fr-FR')}</span>
                        <span className="font-black tabular-nums text-[#002d87]">{liters(ix.delta)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {b.versements.length > 0 && (
              <Section title="Versements (horodatés)" icon={Clock} count={b.versements.length}>
                <div className="space-y-1">
                  {b.versements.map(v => (
                    <div key={v.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <span className="text-slate-500">{fmtDateTime(v.at)}</span>
                      <span className="text-slate-600 truncate flex-1 mx-3">{v.notes || '—'}</span>
                      <span className="font-black tabular-nums text-emerald-600">{money(v.amount)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {b.justifications.length > 0 && (
              <Section title="Justifications (bons, TAG, TPE)" icon={ClipboardList} count={b.justifications.length}>
                <div className="space-y-1">
                  {b.justifications.map((j, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100 gap-2">
                      <span className="badge badge-neutral shrink-0">{j.type}</span>
                      <span className="text-slate-700 font-semibold truncate flex-1">{j.client}</span>
                      <span className="text-slate-400 shrink-0">
                        {[j.fuel, j.liters ? `${j.liters} L` : '', j.mode].filter(Boolean).join(' • ') || '—'}
                      </span>
                      <span className="font-black tabular-nums text-[#002d87] shrink-0">{money(j.amount)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs bg-blue-50 rounded-lg px-3 py-2">
                    <span className="font-black text-[#002d87]">TOTAL JUSTIFIÉ</span>
                    <span className="font-black tabular-nums text-[#002d87]">{money(b.justificationsTotal)}</span>
                  </div>
                </div>
              </Section>
            )}

            {b.notes && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
                <p className="text-[10px] uppercase font-black text-amber-600">Notes de brigade</p>
                <p className="text-xs text-amber-800 mt-0.5">{b.notes}</p>
              </div>
            )}
          </div>
        </td></tr>
      )}
    </>
  );
}

// ─── Session detail (cafétéria / lavage POS) ─────────────────────────────────
function SessionRow({ s }: { s: WorkforceWorker['sessions'][number]; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={cn(s.sales.length > 0 && 'cursor-pointer hover:bg-slate-50')} onClick={() => s.sales.length && setOpen(o => !o)}>
        <td className="table-cell text-slate-400 w-6">
          {s.sales.length ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}
        </td>
        <td className="table-cell font-bold">{s.ref}</td>
        <td className="table-cell whitespace-nowrap">{fmtDateTime(s.openedAt)}</td>
        <td className="table-cell whitespace-nowrap text-slate-500">{fmtDateTime(s.closedAt)}</td>
        <td className="table-cell text-slate-500">{s.durationH !== undefined ? `${s.durationH} h` : '—'}</td>
        <td className="table-cell tabular-nums text-right text-slate-500">{money(s.openingCash)}</td>
        <td className="table-cell tabular-nums text-right">{s.salesCount}</td>
        <td className="table-cell tabular-nums text-right text-emerald-600 font-bold">{money(s.salesTotal)}</td>
        <td className="table-cell tabular-nums text-right text-blue-700">{money(s.theoretical)}</td>
        <td className="table-cell tabular-nums text-right text-amber-700">{money(s.credit)}</td>
        <td className={cn('table-cell tabular-nums text-right font-bold', s.decalage < 0 ? 'text-red-600' : s.decalage > 0 ? 'text-emerald-600' : 'text-slate-400')}>
          {money(s.decalage)}
        </td>
        <td className="table-cell"><span className={cn('badge', s.status === 'Ouverte' ? 'badge-warning' : 'badge-success')}>{s.status}</span></td>
      </tr>
      {open && s.sales.length > 0 && (
        <tr><td colSpan={12} className="bg-slate-50/70 px-4 py-3">
          <Section title="Ventes de la session" icon={Receipt} count={s.sales.length}>
            <div className="space-y-1">
              {s.sales.map(x => (
                <div key={x.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100 gap-3">
                  <span className="font-bold text-slate-700 shrink-0">{x.ref}</span>
                  <span className="text-slate-400 shrink-0">{fmtDateTime(x.date)}</span>
                  <span className="text-slate-600 truncate flex-1">{x.client}</span>
                  <span className="text-slate-400 shrink-0">{x.items} article(s)</span>
                  <span className="badge badge-neutral shrink-0">{x.status}</span>
                  <span className="font-black tabular-nums text-[#002d87] shrink-0">{money(x.total)}</span>
                  {x.rest > 0 && <span className="font-bold tabular-nums text-red-600 shrink-0">reste {money(x.rest)}</span>}
                </div>
              ))}
            </div>
          </Section>
          {s.notes && <p className="text-[11px] text-slate-400 italic mt-2">Note : {s.notes}</p>}
        </td></tr>
      )}
    </>
  );
}

// ─── Work detail (lavage / vidange) ───────────────────────────────────────
function WorkRow({ w, rate }: { w: WorkforceWorker['works'][number]; rate: number; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(o => !o)}>
        <td className="table-cell text-slate-400 w-6">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
        <td className="table-cell font-bold">{w.ref}</td>
        <td className="table-cell whitespace-nowrap">{fmtDate(w.date)}</td>
        <td className="table-cell">{w.client}</td>
        <td className="table-cell text-slate-500 max-w-[150px] truncate">{w.car || '—'}</td>
        <td className="table-cell max-w-[220px]">
          <div className="flex flex-wrap gap-1">
            {w.prestations.filter(p => p.mine).map(p => (
              <span key={p.id} className={cn('badge', p.kindLabel === 'Lavage' ? 'badge-info' : 'badge-primary')}>
                {p.kindLabel === 'Lavage' ? '🧽' : '🔧'} {p.label}
              </span>
            ))}
            {w.prestations.every(p => !p.mine) && <span className="text-xs text-slate-400 italic">Intervention entière</span>}
            {/* Le stock sorti se voit AVANT d'ouvrir : c'est ce qui distingue une
                vidange d'un simple lavage, et ce qu'on vient vérifier. */}
            {w.products.length > 0 && <span className="badge badge-neutral">{w.products.length} produit(s)</span>}
          </div>
        </td>
        <td className="table-cell tabular-nums text-right">{money(w.total)}</td>
        <td className="table-cell tabular-nums text-right text-slate-500">{money(w.base)}</td>
        <td className="table-cell tabular-nums text-right font-bold text-emerald-600">{rate > 0 ? money(w.share) : '—'}</td>
        <td className="table-cell">
          <span className={cn('badge', w.settled ? 'badge-success' : w.status === 'Finalisé' ? 'badge-warning' : 'badge-neutral')}>
            {w.settled ? `Réglé ${fmtDate(w.settledOn)}` : w.status === 'Finalisé' ? 'À payer' : w.status}
          </span>
        </td>
      </tr>
      {open && (
        <tr><td colSpan={10} className="bg-slate-50/70 px-4 py-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Prestations de l'intervention" icon={Layers} count={w.prestations.length}>
              {w.prestations.length === 0 ? <Empty text="Aucune prestation (produits uniquement)" /> : (
                <div className="space-y-1">
                  {w.prestations.map(p => (
                    <div key={p.id} className={cn('flex items-center justify-between text-xs rounded-lg px-3 py-2 border',
                      p.mine ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100')}>
                      <span className="truncate flex-1">
                        <b>{p.kindLabel}</b> — {p.label}
                        {p.mine && <span className="ml-1.5 text-[10px] font-black text-emerald-600 uppercase">réalisée</span>}
                      </span>
                      <span className="font-black tabular-nums text-[#002d87] shrink-0">{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            <div className="space-y-3">
              <Section title="Produits utilisés" icon={ShoppingCart} count={w.products.length}>
                {w.products.length === 0 ? <Empty text="Aucun produit" /> : (
                  <div className="space-y-1">
                    {w.products.map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100">
                        <span className="truncate flex-1">{p.name} × {p.qty}</span>
                        <span className="font-black tabular-nums shrink-0">{money(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Chip label="Remise" value={money(w.discount)} tone={w.discount > 0 ? 'amber' : 'slate'} />
                <Chip label="Total" value={money(w.total)} />
                <Chip label="Payé" value={money(w.paid)} tone="green" />
                <Chip label="Reste" value={money(w.rest)} tone={w.rest > 0 ? 'red' : 'slate'} />
              </div>
            </div>
          </div>
        </td></tr>
      )}
    </>
  );
}

// ─── Salaires, acomptes, absences ────────────────────────────────────────────
/**
 * Les trois mouvements d'argent d'un employé sur la période. Partagés par la
 * fiche complète (« Employés & Personnel ») et par le panneau des travaux du
 * rapport Magasin : une même ligne de paie ne peut donc pas s'écrire
 * de deux façons selon l'écran d'où on la regarde.
 */
function MoneyMovements({ w }: { w: WorkforceWorker }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Section title="Paiements de salaire" icon={Banknote} count={w.payments.length}>
        {w.payments.length === 0 ? <Empty text="Aucun paiement sur la période" /> : (
          <div className="space-y-1">
            {w.payments.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100 gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-700 truncate">{p.label}</p>
                  <p className="text-slate-400">
                    {fmtDate(p.date)}{p.mode ? ` • ${p.mode}` : ''}{p.worksCount ? ` • ${p.worksCount} travaux` : ''}
                    {p.description ? ` • ${p.description}` : ''}
                  </p>
                </div>
                <span className="font-black tabular-nums text-emerald-600 shrink-0">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Acomptes" icon={Wallet} count={w.acomptes.length}>
        {w.acomptes.length === 0 ? <Empty text="Aucun acompte sur la période" /> : (
          <div className="space-y-1">
            {w.acomptes.map(a => (
              <div key={a.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100 gap-2">
                <div className="min-w-0">
                  <p className="text-slate-600 truncate">{a.description || 'Acompte'}</p>
                  <p className="text-slate-400">{fmtDate(a.date)}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-black tabular-nums text-amber-700">{money(a.amount)}</span>
                  <p className={cn('text-[10px] font-bold', a.paid ? 'text-emerald-600' : 'text-red-500')}>{a.paid ? 'Décompté' : 'Dû'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Absences & retenues" icon={CalendarMinus} count={w.absences.length}>
        {w.absences.length === 0 ? <Empty text="Aucune absence sur la période" /> : (
          <div className="space-y-1">
            {w.absences.map(a => (
              <div key={a.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100 gap-2">
                <div className="min-w-0">
                  <p className="text-slate-600 truncate">{a.description || 'Absence'}</p>
                  <p className="text-slate-400">{fmtDate(a.date)}</p>
                </div>
                <span className="font-black tabular-nums text-red-600 shrink-0">−{money(a.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── One employee, fully expanded ────────────────────────────────────────────
function WorkerCard({ w }: { w: WorkforceWorker; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  const PartIcon = PART_ICON[w.part];
  const netToPay = Math.max(0, (w.salaryType === 'pourcentage' ? w.dueNow : w.salaryAmount) - w.acomptesUnpaid - w.absencesTotal);

  return (
    <div className={cn('rounded-2xl border bg-white overflow-hidden transition-all',
      open ? 'border-[#003087]/30 shadow-lg' : 'border-slate-100 shadow-sm hover:border-slate-200')}>
      {/* Header row */}
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white shrink-0"
          style={{ background: `linear-gradient(135deg, ${PART_META[w.part].color}, #0044bb)` }}>
          {w.name[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-[#002d87] truncate">{w.name}</p>
            <span className="badge badge-neutral">{w.role}</span>
            {w.speciality && <span className="badge badge-info">{w.speciality}</span>}
            {w.salaryType === 'pourcentage' && <span className="badge badge-success">{w.percentage || 0} %</span>}
            {w.hasAccount && w.accountActive && (
              <span className="badge badge-success flex items-center gap-1"><Lock className="w-3 h-3" /> Compte</span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <PartIcon className="w-3 h-3" /> {w.partLabel}
            <span>•</span> {w.payMode}
            {w.phone && <><span>•</span> {w.phone}</>}
            {w.hireDate && <><span>•</span> depuis {fmtDate(w.hireDate)}</>}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {w.highlights.map((h, i) => (
            <div key={i} className="text-right px-3 py-1 rounded-xl bg-slate-50 min-w-[92px]">
              <p className="text-[9px] uppercase font-black text-slate-400 tracking-wide">{h.label}</p>
              <p className={cn('text-xs font-black tabular-nums',
                h.tone === 'good' ? 'text-emerald-600' : h.tone === 'bad' ? 'text-red-600' : 'text-[#002d87]')}>
                {h.format === 'money' ? money(h.value)
                  : h.format === 'liters' ? liters(h.value)
                    : h.value.toLocaleString('fr-FR')}
              </p>
            </div>
          ))}
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" /> : <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-5 pt-1 space-y-6 border-t border-slate-100">

              {/* Identity + payroll */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 pt-4">
                <Chip label="Partie" value={`${w.partEmoji} ${w.partLabel}`} />
                <Chip label="Fonction" value={w.role} />
                <Chip label="Statut" value={w.status} />
                <Chip label="Téléphone" value={w.phone || '—'} />
                <Chip label="CIN" value={w.cin || '—'} />
                <Chip label="Embauche" value={fmtDate(w.hireDate)} />
                <Chip label="Mode de paie" value={w.payMode} tone="blue" />
                <Chip label="Salaire de base" value={w.salaryType === 'pourcentage' ? `${w.percentage || 0} %` : money(w.salaryAmount)} />
                <Chip label="Salaires versés" value={money(w.paymentsTotal)} tone="green" />
                <Chip label="Acomptes" value={money(w.acomptesTotal)} tone="amber" />
                <Chip label="Absences" value={money(w.absencesTotal)} tone={w.absencesTotal > 0 ? 'red' : 'slate'} />
                <Chip label="Net estimé à payer" value={money(netToPay)} tone={netToPay > 0 ? 'blue' : 'slate'} />
                {w.salaryType === 'pourcentage' && <Chip label="Part générée (période)" value={money(w.earned)} tone="green" />}
                {w.salaryType === 'pourcentage' && <Chip label="Reste dû (tout)" value={money(w.dueNow)} tone={w.dueNow > 0 ? 'red' : 'slate'} />}
                <Chip label="Compte" value={w.hasAccount ? (w.accountActive ? `Actif — ${w.username || '—'}` : 'À activer') : 'Aucun'}
                  tone={w.hasAccount && w.accountActive ? 'green' : 'slate'} />
              </div>

              {/* Brigades */}
              {w.brigades.length > 0 && (
                <Section title="Brigades assignées — détail complet" icon={Target} count={w.brigades.length}>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
                    <Chip label="Brigades" value={String(w.brigadesCount)} tone="blue" />
                    <Chip label="Litres vendus" value={liters(w.liters)} />
                    <Chip label="Théorique" value={money(w.theoretical)} tone="blue" />
                    <Chip label="Encaissé" value={money(w.collected)} tone="green" />
                    <Chip label="Décalage cumulé" value={money(w.decalage)} tone={w.decalage < 0 ? 'red' : 'green'} />
                  </div>
                  <Table head={<>
                    <th className="table-head w-6" /><th className="table-head">Date</th><th className="table-head">Poste</th>
                    <th className="table-head">Chef</th><th className="table-head">Piste</th><th className="table-head">Pompes</th>
                    <th className="table-head text-right">Litres</th><th className="table-head text-right">Théorique</th>
                    <th className="table-head text-right">Encaissé</th><th className="table-head text-right">Décalage</th>
                    <th className="table-head">Statut</th>
                  </>}>
                    {w.brigades.map(b => <BrigadeRow key={b.id} b={b} />)}
                  </Table>
                  <p className="text-[11px] text-slate-400 italic">Cliquez une brigade pour ses index de pistolets, versements, justifications et comptabilité.</p>
                </Section>
              )}

              {/* Sessions */}
              {w.sessions.length > 0 && (
                <Section title="Sessions de travail" icon={Clock} count={w.sessions.length}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                    <Chip label="Sessions" value={String(w.sessionsCount)} tone="blue" />
                    <Chip label="Ventes encaissées" value={money(w.sessionsSales)} tone="green" />
                    <Chip label="Décalage cumulé" value={money(w.sessionsDecalage)} tone={w.sessionsDecalage < 0 ? 'red' : 'green'} />
                    <Chip label="Ventes (nb)" value={String(w.sessions.reduce((s, x) => s + x.salesCount, 0))} />
                  </div>
                  <Table head={<>
                    <th className="table-head w-6" /><th className="table-head">Réf</th><th className="table-head">Ouverture</th>
                    <th className="table-head">Clôture</th><th className="table-head">Durée</th><th className="table-head text-right">Fond</th>
                    <th className="table-head text-right">Ventes</th><th className="table-head text-right">Montant</th>
                    <th className="table-head text-right">Théorique</th><th className="table-head text-right">Crédit</th>
                    <th className="table-head text-right">Décalage</th><th className="table-head">Statut</th>
                  </>}>
                    {w.sessions.map(s => <SessionRow key={s.id} s={s} />)}
                  </Table>
                  <p className="text-[11px] text-slate-400 italic">Cliquez une session pour la liste de ses ventes.</p>
                </Section>
              )}

              {/* Works (lavage / vidange) */}
              {w.works.length > 0 && (
                <Section title="Travaux assignés — lavages & vidanges" icon={Car} count={w.works.length}>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
                    <Chip label="Travaux" value={String(w.worksCount)} tone="blue" />
                    <Chip label="Montant facturé" value={money(w.worksAmount)} />
                    <Chip label="Base retenue" value={money(w.worksBase)} />
                    <Chip label={`Part ${w.percentage || 0} %`} value={money(w.earned)} tone="green" />
                    <Chip label="Reste dû" value={money(w.dueNow)} tone={w.dueNow > 0 ? 'red' : 'slate'} />
                  </div>
                  <Table head={<>
                    <th className="table-head w-6" /><th className="table-head">Réf</th><th className="table-head">Date</th>
                    <th className="table-head">Client</th><th className="table-head">Véhicule</th>
                    <th className="table-head">Prestations réalisées</th><th className="table-head text-right">Total</th>
                    <th className="table-head text-right">Base</th><th className="table-head text-right">Part</th>
                    <th className="table-head">Règlement</th>
                  </>}>
                    {w.works.map(x => <WorkRow key={x.id} w={x} rate={w.percentage || 0} />)}
                  </Table>
                  <p className="text-[11px] text-slate-400 italic">Cliquez un travail pour ses prestations, ses produits et sa remise.</p>
                </Section>
              )}

              {/* Sales */}
              {w.sales.length > 0 && (
                <Section title="Ventes réalisées" icon={ShoppingCart} count={w.sales.length}>
                  <Table head={<>
                    <th className="table-head">Réf</th><th className="table-head">Date</th><th className="table-head">Client</th>
                    <th className="table-head">Type</th><th className="table-head text-right">Articles</th>
                    <th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th>
                    <th className="table-head text-right">Reste</th><th className="table-head">Statut</th>
                  </>}>
                    {w.sales.map(s => (
                      <tr key={s.id}>
                        <td className="table-cell font-bold">{s.ref}</td>
                        <td className="table-cell whitespace-nowrap">{fmtDate(s.date)}</td>
                        <td className="table-cell">{s.client}</td>
                        <td className="table-cell"><span className="badge badge-info">{s.kind}</span></td>
                        <td className="table-cell tabular-nums text-right">{s.items}</td>
                        <td className="table-cell tabular-nums text-right font-bold">{money(s.total)}</td>
                        <td className="table-cell tabular-nums text-right text-emerald-600">{money(s.paid)}</td>
                        <td className={cn('table-cell tabular-nums text-right', s.rest > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{money(s.rest)}</td>
                        <td className="table-cell"><span className="badge badge-neutral">{s.status}</span></td>
                      </tr>
                    ))}
                  </Table>
                </Section>
              )}

              <MoneyMovements w={w} />

              {w.brigades.length === 0 && w.sessions.length === 0 && w.works.length === 0 && w.sales.length === 0 && (
                <p className="text-xs text-slate-400 italic text-center py-2">
                  Aucune activité enregistrée pour cet employé sur la période sélectionnée.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────
export default function WorkforceView({ report }: { report: WorkforceReport }) {
  const [part, setPart] = useState<'all' | WorkforcePart>('all');
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  const roles = useMemo(
    () => Array.from(new Set(report.workers.map(w => w.role))).sort(),
    [report.workers]);

  const shown = useMemo(() => report.workers.filter(w => {
    const matchQ = matchesSearch(search, w.name, w.role, w.phone);
    const hasActivity = w.brigadesCount + w.sessionsCount + w.worksCount + w.salesCount > 0;
    return matchQ
      && (part === 'all' || w.part === part)
      && (role === 'all' || w.role === role)
      && (!onlyActive || hasActivity);
  }), [report.workers, part, role, search, onlyActive]);

  const t = report.totals;

  return (
    <div className="space-y-8">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={UsersRound} tone="blue" label="Employés" value={String(t.workers)} sub={`${t.withAccount} compte(s) actif(s)`} />
        <Kpi icon={Banknote} tone="green" label="Salaires versés" value={money(t.salariesPaid)} sub="sur la période" />
        <Kpi icon={Wallet} tone="amber" label="Acomptes" value={money(t.acomptes)} sub="versés sur la période" />
        <Kpi icon={CalendarMinus} tone="red" label="Absences / retenues" value={money(t.absences)} />
        <Kpi icon={Target} tone="purple" label="Brigades couvertes" value={String(t.brigades)} sub={`${liters(t.liters)} vendus`} />
        <Kpi icon={Clock} tone="cyan" label="Sessions de travail" value={String(t.sessions)} />
        <Kpi icon={Car} tone="blue" label="Travaux lavage / vidange" value={String(t.works)} sub={money(t.worksAmount)} />
        <Kpi icon={Percent} tone={t.dueNow > 0 ? 'red' : 'green'} label="Parts employés à régler" value={money(t.dueNow)} sub={`${money(t.earned)} générés`} />
      </div>

      {/* Decalage / collection banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#001f5c,#003087)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-200">Théorique carburant</p>
          <p className="text-2xl font-black tabular-nums text-[#FFB800]">{money(t.theoretical)}</p>
        </div>
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-100 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> Encaissé par les pompistes
          </p>
          <p className="text-2xl font-black tabular-nums">{money(t.collected)}</p>
        </div>
        <div className="rounded-2xl p-4 text-white"
          style={{ background: t.decalage < 0 ? 'linear-gradient(135deg,#991b1b,#dc2626)' : 'linear-gradient(135deg,#0e7490,#0891b2)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide opacity-90 flex items-center gap-1">
            {t.decalage < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />} Décalage cumulé
          </p>
          <p className="text-2xl font-black tabular-nums">{money(t.decalage)}</p>
        </div>
      </div>

      {/* Per-part summary */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Briefcase className="w-5 h-5 text-[#FFB800]" /> Personnel par activité</h3>
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="table-head">Activité</th><th className="table-head text-right">Employés</th>
                <th className="table-head text-right">Comptes actifs</th><th className="table-head text-right">Salaires versés</th>
                <th className="table-head text-right">Acomptes</th><th className="table-head text-right">Absences</th>
                <th className="table-head text-right">Activité</th><th className="table-head text-right">À régler</th>
              </tr></thead>
              <tbody>
                {report.parts.map(p => (
                  <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => setPart(part === p.key ? 'all' : p.key)}>
                    <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
                    <td className="table-cell tabular-nums text-right font-bold">{p.count}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{p.withAccount}</td>
                    <td className="table-cell tabular-nums text-right">{money(p.salariesPaid)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(p.acomptes)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{money(p.absences)}</td>
                    <td className="table-cell tabular-nums text-right text-blue-700">{p.activityValue} {p.activityLabel.toLowerCase()}</td>
                    <td className={cn('table-cell tabular-nums text-right font-black', p.dueNow > 0 ? 'text-red-600' : 'text-slate-400')}>{money(p.dueNow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom, fonction ou téléphone…" className="input-field pl-9" />
          </div>
          <select value={role} onChange={e => setRole(e.target.value)} className="input-field !w-auto min-w-[170px]">
            <option value="all">Toutes les fonctions</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => setOnlyActive(a => !a)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              onlyActive ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
            Avec activité seulement
          </button>
          <span className="text-xs text-slate-400 ml-auto">{shown.length} employé(s)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'carburant', 'restaurant', 'cafeteria', 'lavage'] as const).map(k => (
            <button key={k} onClick={() => setPart(k)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                part === k ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
              {k === 'all' ? 'Toutes les parties' : `${PART_META[k].emoji} ${PART_META[k].label}`}
            </button>
          ))}
        </div>
      </div>

      {/* Worker list */}
      <div className="space-y-2">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Users className="w-5 h-5 text-[#FFB800]" /> Dossier détaillé de chaque employé
        </h3>
        {shown.length === 0 ? (
          <div className="card-glass p-8 text-center text-slate-400 text-sm">Aucun employé ne correspond aux filtres.</div>
        ) : (
          <div className="space-y-2">
            {shown.map(w => <WorkerCard key={`${w.part}-${w.id}`} w={w} />)}
          </div>
        )}
        <p className="text-[11px] text-slate-400 italic">
          Cliquez un employé pour dérouler ses brigades, sessions, travaux, ventes, salaires, acomptes et absences.
        </p>
      </div>
    </div>
  );
}

// ─── Le travail des employés d'une activité de service (rapport général) ──────
/**
 * ─── QUI A TRAVAILLÉ, SUR QUOI, ET CE QUE ÇA LUI FAIT ─────────────────────────
 *
 * Le rapport de la partie Magasin annonçait le chiffre d'affaires des
 * prestations sans jamais dire QUI les avait faites. Or la paie de ces employés
 * EST un pourcentage de leurs propres travaux : pour vérifier un montant que le
 * rapport affichait déjà, le gérant devait sortir de l'écran et rouvrir la fiche
 * de chaque employé, une par une.
 *
 * Ce panneau répond à la question sur la période choisie, employé par employé :
 *   • chacune de ses interventions — référence, date, client, véhicule,
 *     prestations qu'il a réalisées, produits sortis, remise, total, payé et
 *     reste dû par le client ;
 *   • la base retenue pour son pourcentage et sa part, travail par travail ;
 *   • ce qui lui a déjà été réglé, ce qui reste à lui payer, et ce qui n'est pas
 *     encore payable parce que l'intervention n'est pas finalisée ;
 *   • la répartition de son travail par nature (lavage / vidange) et par
 *     prestation ;
 *   • ses salaires, acomptes et absences de la même période.
 *
 * Il lit EXACTEMENT le même calcul que « Employés & Personnel »
 * (`computeWorkforce`) : les deux écrans ne peuvent donc pas annoncer deux
 * chiffres différents pour le même employé.
 */

/** Ce qu'un employé de service a produit sur la période, prestation comprise. */
function serviceStats(w: WorkforceWorker) {
  const byKind: Record<string, { count: number; amount: number }> = {
    Lavage: { count: 0, amount: 0 }, Vidange: { count: 0, amount: 0 },
  };
  const byLabel = new Map<string, { key: string; label: string; kindLabel: string; count: number; amount: number }>();
  let products = 0, discounts = 0, clientRest = 0;
  /** Part déjà réglée par un paiement, part à payer, part pas encore payable. */
  let settledShare = 0, dueShare = 0, openShare = 0;
  let done = 0, waiting = 0, canceled = 0;

  w.works.forEach(x => {
    x.prestations.filter(p => p.mine).forEach(p => {
      const slot = byKind[p.kindLabel] || (byKind[p.kindLabel] = { count: 0, amount: 0 });
      slot.count++; slot.amount += p.amount;
      const key = `${p.kindLabel}|${p.label || p.kindLabel}`;
      const e = byLabel.get(key)
        || { key, label: p.label || p.kindLabel, kindLabel: p.kindLabel, count: 0, amount: 0 };
      e.count++; e.amount += p.amount;
      byLabel.set(key, e);
    });
    products += x.products.reduce((t, p) => t + p.total, 0);
    discounts += x.discount;
    clientRest += x.rest;
    // Une intervention non finalisée ne se paie pas : sa part est ANNONCÉE,
    // pas encore due. C'est ce qui explique l'écart entre « part générée » et
    // « à payer » quand des véhicules sont encore à l'atelier.
    if (x.settled) settledShare += x.share;
    else if (x.status === 'Finalisé') dueShare += x.share;
    else openShare += x.share;
    if (x.status === 'Finalisé') done++;
    else if (x.status === 'En attente') waiting++;
    else canceled++;
  });

  return {
    byKind,
    prestations: [...byLabel.values()].sort((a, b) => b.amount - a.amount),
    products, discounts, clientRest,
    settledShare, dueShare, openShare,
    done, waiting, canceled,
  };
}

/** Un employé du panneau : l'entête se lit fermé, tout le détail s'ouvre. */
function ServiceWorkerRow({ w, open, onToggle }: {
  w: WorkforceWorker; open: boolean; onToggle: () => void; key?: React.Key;
}) {
  const s = useMemo(() => serviceStats(w), [w]);
  const rate = w.percentage || 0;
  const isPercent = w.salaryType === 'pourcentage';

  return (
    <div className={cn('rounded-2xl border bg-white overflow-hidden transition-all',
      open ? 'border-cyan-300 shadow-lg' : 'border-slate-100 shadow-sm hover:border-slate-200')}>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white shrink-0"
          style={{ background: `linear-gradient(135deg, ${PART_META[w.part].color}, #0044bb)` }}>
          {w.name[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-[#002d87] truncate">{w.name}</p>
            <span className="badge badge-neutral">{w.role}</span>
            {w.speciality && <span className="badge badge-info">{w.speciality}</span>}
            {isPercent && <span className="badge badge-success">{rate} %</span>}
            {w.works.length === 0 && <span className="badge badge-warning">Aucun travail</span>}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Briefcase className="w-3 h-3" /> {w.worksCount} travail(aux)
            <span>•</span> 🧽 {s.byKind.Lavage.count} lavage(s)
            <span>•</span> 🔧 {s.byKind.Vidange.count} vidange(s)
            <span>•</span> {w.payMode}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <div className="text-right px-3 py-1 rounded-xl bg-slate-50 min-w-[96px]">
            <p className="text-[9px] uppercase font-black text-slate-400 tracking-wide">Facturé</p>
            <p className="text-xs font-black tabular-nums text-[#002d87]">{money(w.worksAmount)}</p>
          </div>
          <div className="text-right px-3 py-1 rounded-xl bg-emerald-50 min-w-[96px]">
            <p className="text-[9px] uppercase font-black text-emerald-600/60 tracking-wide">Sa part</p>
            <p className="text-xs font-black tabular-nums text-emerald-600">{isPercent ? money(w.earned) : '—'}</p>
          </div>
          <div className={cn('text-right px-3 py-1 rounded-xl min-w-[96px]', w.dueNow > 0 ? 'bg-red-50' : 'bg-slate-50')}>
            <p className="text-[9px] uppercase font-black text-slate-400 tracking-wide">Reste dû</p>
            <p className={cn('text-xs font-black tabular-nums', w.dueNow > 0 ? 'text-red-600' : 'text-slate-400')}>
              {isPercent ? money(w.dueNow) : '—'}
            </p>
          </div>
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" /> : <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-5 pt-4 space-y-6 border-t border-slate-100">

              {/* Qui il est, et comment il est payé */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                <Chip label="Fonction" value={w.role} />
                <Chip label="Spécialité" value={w.speciality || 'Polyvalent'} tone="blue" />
                <Chip label="Statut" value={w.status} />
                <Chip label="Téléphone" value={w.phone || '—'} />
                <Chip label="CIN" value={w.cin || '—'} />
                <Chip label="Embauche" value={fmtDate(w.hireDate)} />
                <Chip label="Mode de paie" value={w.payMode} tone="blue" />
                <Chip label="Taux / salaire" value={isPercent ? `${rate} %` : money(w.salaryAmount)} tone="blue" />
                <Chip label="Salaires versés" value={money(w.paymentsTotal)} tone="green" />
                <Chip label="Acomptes" value={money(w.acomptesTotal)} tone={w.acomptesTotal > 0 ? 'amber' : 'slate'} />
                <Chip label="Absences" value={money(w.absencesTotal)} tone={w.absencesTotal > 0 ? 'red' : 'slate'} />
                <Chip label="Compte" value={w.hasAccount ? (w.accountActive ? `Actif — ${w.username || '—'}` : 'À activer') : 'Aucun'}
                  tone={w.hasAccount && w.accountActive ? 'green' : 'slate'} />
              </div>

              {/* Ce que la période lui a fait gagner, poste par poste */}
              <Section title="Son travail sur la période" icon={Percent}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <Chip label="Interventions" value={String(w.worksCount)} tone="blue" />
                  <Chip label="Montant facturé" value={money(w.worksAmount)} />
                  <Chip label="Base retenue" value={money(w.worksBase)} />
                  <Chip label={`Part générée (${rate} %)`} value={isPercent ? money(w.earned) : '—'} tone="green" />
                  <Chip label="Déjà réglée" value={isPercent ? money(s.settledShare) : '—'} tone="green" />
                  <Chip label="À lui payer" value={isPercent ? money(s.dueShare) : '—'} tone={s.dueShare > 0 ? 'red' : 'slate'} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <Chip label="Finalisées" value={String(s.done)} tone="green" />
                  <Chip label="En attente" value={String(s.waiting)} tone={s.waiting > 0 ? 'amber' : 'slate'} />
                  <Chip label="Annulées" value={String(s.canceled)} tone={s.canceled > 0 ? 'red' : 'slate'} />
                  <Chip label="Pas encore payable" value={isPercent ? money(s.openShare) : '—'}
                    tone={s.openShare > 0 ? 'amber' : 'slate'} />
                  <Chip label="Produits sortis" value={money(s.products)} tone="amber" />
                  <Chip label="Remises accordées" value={money(s.discounts)} tone={s.discounts > 0 ? 'amber' : 'slate'} />
                  {/* Ce que ses clients n'ont pas encore payé. Ce n'est PAS sa
                      dette — sa part lui est due quoi qu'il arrive — mais c'est
                      la créance que son travail a laissée derrière lui. */}
                  <Chip label="Reste dû par les clients" value={money(s.clientRest)}
                    tone={s.clientRest > 0 ? 'red' : 'slate'} />
                </div>
                <p className="text-[11px] text-slate-400 italic">
                  La base, c'est le montant des prestations QU'IL A réalisées — pas le total de la facture :
                  les produits et les prestations d'un collègue n'entrent pas dans sa part. Une intervention
                  sans affectation par prestation (ancienne fiche) compte, elle, sur son total entier.
                  {' '}Le reste dû ({money(w.dueNow)}) couvre TOUTES les dates, pas seulement la période
                  affichée : c'est ce qu'il faut lui régler.
                </p>
              </Section>

              {/* Par nature et par prestation */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Section title="Par nature de travail" icon={Layers}>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-cyan-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase font-black text-cyan-700/70">🧽 Lavages</p>
                      <p className="font-black tabular-nums text-cyan-700">{s.byKind.Lavage.count}</p>
                      <p className="text-[11px] font-bold text-cyan-600 tabular-nums">{money(s.byKind.Lavage.amount)}</p>
                    </div>
                    <div className="rounded-xl bg-violet-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase font-black text-violet-700/70">🔧 Vidanges</p>
                      <p className="font-black tabular-nums text-violet-700">{s.byKind.Vidange.count}</p>
                      <p className="text-[11px] font-bold text-violet-600 tabular-nums">{money(s.byKind.Vidange.amount)}</p>
                    </div>
                  </div>
                </Section>
                <Section title="Par prestation" icon={ClipboardList} count={s.prestations.length}>
                  {s.prestations.length === 0 ? <Empty text="Aucune prestation nominative sur la période" /> : (
                    <div className="space-y-1 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                      {s.prestations.map(p => (
                        <div key={p.key} className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-slate-100">
                          <span className="truncate flex-1">
                            <b>{p.kindLabel === 'Lavage' ? '🧽' : '🔧'} {p.label}</b>
                            <span className="text-slate-400"> × {p.count}</span>
                          </span>
                          <span className="font-black tabular-nums text-[#002d87] shrink-0">{money(p.amount)}</span>
                          {rate > 0 && (
                            <span className="font-black tabular-nums text-emerald-600 shrink-0 w-24 text-right">
                              part {money((p.amount * rate) / 100)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              {/* Chaque intervention, dépliable jusqu'au dernier détail */}
              <Section title="Ses interventions, une par une" icon={Car} count={w.works.length}>
                {w.works.length === 0 ? (
                  <Empty text="Aucune intervention ne lui est assignée sur cette période." />
                ) : (
                  <>
                    <Table head={<>
                      <th className="table-head w-6" /><th className="table-head">Réf</th><th className="table-head">Date</th>
                      <th className="table-head">Client</th><th className="table-head">Véhicule</th>
                      <th className="table-head">Prestations réalisées</th><th className="table-head text-right">Total</th>
                      <th className="table-head text-right">Base</th><th className="table-head text-right">Part</th>
                      <th className="table-head">Règlement</th>
                    </>}>
                      {w.works.map(x => <WorkRow key={x.id} w={x} rate={rate} />)}
                    </Table>
                    <p className="text-[11px] text-slate-400 italic">
                      Cliquez une intervention pour voir toutes ses prestations (celles de l'employé sont
                      surlignées), les produits sortis du stock, la remise accordée et ce que le client a payé.
                    </p>
                  </>
                )}
              </Section>

              {/* Salaires, acomptes, absences */}
              <MoneyMovements w={w} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ServiceWorksPanel({ workers, from, to }: {
  workers: WorkforceWorker[]; from: string; to: string;
}) {
  const [search, setSearch] = useState('');
  /**
   * Un petit atelier s'ouvre DÉJÀ déplié : à deux ou trois employés, le clic de
   * plus n'apprend rien à personne et cache l'essentiel derrière un entête.
   * Au-delà, la liste reste fermée pour qu'elle tienne encore à l'écran.
   */
  const [openIds, setOpenIds] = useState<string[]>(() => {
    const busy = workers.filter(w => w.works.length > 0);
    return busy.length > 0 && busy.length <= 3 ? busy.map(w => w.id) : [];
  });
  const [onlyActive, setOnlyActive] = useState(false);

  /**
   * Le total de l'activité. Les interventions sont comptées UNE fois même
   * lorsque deux employés se les partagent — sinon un lavage fait à deux aurait
   * doublé le chiffre d'affaires de l'atelier.
   */
  const totals = useMemo(() => {
    const seen = new Map<string, number>();
    let base = 0, earned = 0, due = 0, settled = 0, lavages = 0, vidanges = 0;
    workers.forEach(w => {
      w.works.forEach(x => seen.set(x.id, x.total));
      base += w.worksBase; earned += w.earned; due += w.dueNow;
      const s = serviceStats(w);
      settled += s.settledShare; lavages += s.byKind.Lavage.count; vidanges += s.byKind.Vidange.count;
    });
    return {
      works: seen.size,
      amount: [...seen.values()].reduce((t, v) => t + v, 0),
      base, earned, due, settled, lavages, vidanges,
      active: workers.filter(w => w.works.length > 0).length,
    };
  }, [workers]);

  /** Les prestations de l'activité, toutes équipes confondues. */
  const prestations = useMemo(() => {
    const map = new Map<string, { key: string; label: string; kindLabel: string; count: number; amount: number }>();
    workers.forEach(w => serviceStats(w).prestations.forEach(p => {
      const e = map.get(p.key) || { ...p, count: 0, amount: 0 };
      e.count += p.count; e.amount += p.amount;
      map.set(p.key, e);
    }));
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [workers]);

  const shown: WorkforceWorker[] = useMemo(() => workers
    .filter(w => (!onlyActive || w.works.length > 0))
    .filter(w => matchesSearch(search, w.name, w.role, w.speciality, w.phone))
    .sort((a, b) => b.earned - a.earned || b.worksCount - a.worksCount || a.name.localeCompare(b.name)),
    [workers, search, onlyActive]);

  const allOpen = shown.length > 0 && shown.every(w => openIds.includes(w.id));
  const toggleAll = () => setOpenIds(allOpen ? [] : shown.map(w => w.id));
  const toggle = (id: string) =>
    setOpenIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  if (workers.length === 0) {
    return <Empty text="Aucun employé n'est rattaché à cette activité." />;
  }

  return (
    <div className="space-y-5">
      {/* Les totaux de l'équipe */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={UsersRound} tone="cyan" label="Employés au travail" value={String(totals.active)}
          sub={`sur ${workers.length} rattaché(s) à l'activité`} />
        <Kpi icon={Car} tone="blue" label="Interventions" value={String(totals.works)}
          sub={`${money(totals.amount)} — 🧽 ${totals.lavages} · 🔧 ${totals.vidanges}`} />
        <Kpi icon={Percent} tone="green" label="Part des employés" value={money(totals.earned)}
          sub={`sur ${money(totals.base)} de base retenue`} />
        <Kpi icon={Wallet} tone={totals.due > 0 ? 'red' : 'slate'} label="Reste à leur payer" value={money(totals.due)}
          sub={`${money(totals.settled)} déjà réglés sur la période`} />
      </div>

      {/* Ce que l'équipe a vendu, prestation par prestation */}
      {prestations.length > 0 && (
        <Section title="Les prestations de la période — toute l'équipe" icon={ClipboardList} count={prestations.length}>
          <Table head={<>
            <th className="table-head">Prestation</th><th className="table-head">Nature</th>
            <th className="table-head text-right">Réalisées</th><th className="table-head text-right">Montant</th>
          </>}>
            {prestations.map(p => (
              <tr key={p.key}>
                <td className="table-cell font-bold">{p.label}</td>
                <td className="table-cell">
                  <span className={cn('badge', p.kindLabel === 'Lavage' ? 'badge-info' : 'badge-primary')}>
                    {p.kindLabel === 'Lavage' ? '🧽' : '🔧'} {p.kindLabel}
                  </span>
                </td>
                <td className="table-cell tabular-nums text-right">{p.count}</td>
                <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(p.amount)}</td>
              </tr>
            ))}
          </Table>
          <p className="text-[11px] text-slate-400 italic">
            Une prestation n'est comptée ici que si elle porte le nom d'un employé : c'est la même règle
            que celle qui sert à le payer.
          </p>
        </Section>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Chercher un employé — nom, fonction, spécialité…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm font-semibold
                       text-slate-700 outline-none focus:border-[#003087] focus:ring-4 focus:ring-[#003087]/10" />
        </div>
        <button onClick={() => setOnlyActive(v => !v)}
          className={cn('h-10 px-3 rounded-xl text-xs font-black transition-colors',
            onlyActive ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
          Seulement ceux qui ont travaillé
        </button>
        <button onClick={toggleAll}
          className="h-10 px-3 rounded-xl text-xs font-black bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
          {allOpen ? 'Tout replier' : 'Tout déplier'}
        </button>
        <span className="text-[11px] text-slate-400 font-bold tabular-nums ml-auto">
          {shown.length} / {workers.length} employé(s) · {rangeLabel(from, to)}
        </span>
      </div>

      {/* Un employé, tout son travail */}
      {shown.length === 0 ? (
        <Empty text="Aucun employé ne correspond à ce filtre." />
      ) : (
        <div className="space-y-2">
          {shown.map(w => (
            <ServiceWorkerRow key={w.id} w={w} open={openIds.includes(w.id)} onToggle={() => toggle(w.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
