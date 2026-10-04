/**
 * ─── On-screen report view (shared) ────────────────────────────────────────────
 * Renders a fully-detailed, drill-down report for a single "part" (a biz module
 * or the carburant activity) from a `PartReport`. Used by both `ModuleReports`
 * and `GeneralReports` so the two pages stay perfectly consistent.
 *
 * Every KPI card is clickable and opens a focused modal with the underlying
 * rows; the same row tables are also shown inline below so nothing is hidden.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import {
  TrendingUp, ShoppingCart, CreditCard, CircleDollarSign, Wallet, Boxes, Users, Truck,
  AlertTriangle, CalendarClock, Banknote, PackageX, Beaker, ChevronDown, ChevronRight, Layers,
  Undo2, PackageCheck, Fuel, Droplets, Landmark, ArrowDownCircle, ArrowUpCircle,
  Briefcase, Percent, Car, Receipt, HandCoins,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Modal, money, formatDate, Table, Badge } from '@/src/components/biz/Kit';
import {
  PartReport, clientCashSummary, clientPaymentsByMode, isCashMode,
} from '@/src/lib/bizReporting';
import { WorkforceWorker } from '@/src/lib/workforceReporting';
import { ServiceWorksPanel } from '@/src/components/biz/WorkforceView';

/** Une seule liste vide, partagée : sans elle, `[]` changerait d'identité à
    chaque rendu et relancerait les calculs qui en dépendent pour rien. */
const NO_CREW: WorkforceWorker[] = [];

const fmtDate = (s: string) => (s ? formatDate(s) : '—');
const liters = (n: number) => `${(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`;

// ─── Clickable KPI card ──────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, sub, tone = 'blue', onClick, count }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate' | 'cyan'; onClick?: () => void; count?: number; key?: React.Key;
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', amber: 'from-amber-500 to-yellow-500',
    red: 'from-red-500 to-red-600', purple: 'from-purple-500 to-purple-600', slate: 'from-slate-500 to-slate-600', cyan: 'from-cyan-500 to-teal-600',
  };
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cn('text-left rounded-2xl border border-slate-100 p-4 bg-white shadow-sm transition-all group relative overflow-hidden',
        onClick && 'hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-200 cursor-pointer')}>
      <div className="flex items-center justify-between mb-2">
        <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center', tones[tone])}>
          <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
        </div>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{count}</span>
        )}
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
      {onClick && <span className="absolute bottom-2 right-3 text-[10px] font-bold text-slate-300 group-hover:text-[#003087] transition-colors">Détails →</span>}
    </button>
  );
}

// ─── Reusable row tables (used inline + inside modals) ───────────────────────
export function SalesTable({ rows }: { rows: PartReport['sales'] }) {
  if (!rows.length) return <Empty />;
  return (
    <Table head={<><th className="table-head">Réf</th><th className="table-head">Type</th><th className="table-head">Client</th><th className="table-head">Date</th><th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th></>}>
      {rows.map(s => (
        <tr key={s.id}>
          <td className="table-cell font-bold">{s.ref}</td>
          <td className="table-cell"><span className="badge badge-info">{s.kind}</span></td>
          <td className="table-cell">{s.client}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(s.date)}</td>
          <td className="table-cell tabular-nums text-right font-bold">{money(s.total)}</td>
          <td className="table-cell tabular-nums text-right text-emerald-600">{money(s.paid)}</td>
          <td className={cn('table-cell tabular-nums text-right', s.rest > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{money(s.rest)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function PurchasesTable({ rows }: { rows: PartReport['purchases'] }) {
  if (!rows.length) return <Empty />;
  return (
    <Table head={<><th className="table-head">Réf</th><th className="table-head">Fournisseur</th><th className="table-head">Date</th><th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th></>}>
      {rows.map(p => (
        <tr key={p.id}>
          <td className="table-cell font-bold">{p.ref}</td>
          <td className="table-cell">{p.supplier}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(p.date)}</td>
          <td className="table-cell tabular-nums text-right font-bold">{money(p.total)}</td>
          <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.paid)}</td>
          <td className={cn('table-cell tabular-nums text-right', p.rest > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{money(p.rest)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ProductGainTable({ rows }: { rows: PartReport['salesByProduct'] }) {
  if (!rows.length) return <Empty />;
  const t = rows.reduce((a, x) => ({ revenue: a.revenue + x.revenue, cost: a.cost + x.cost, gain: a.gain + x.gain }), { revenue: 0, cost: 0, gain: 0 });
  return (
    <Table head={<><th className="table-head">Produit</th><th className="table-head text-right">Quantité</th><th className="table-head text-right">Coût</th><th className="table-head text-right">Vente</th><th className="table-head text-right">Gains</th></>}>
      {rows.map(p => (
        <tr key={p.name}>
          <td className="table-cell font-bold">{p.name}</td>
          <td className="table-cell tabular-nums text-right">{p.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{p.unit ? ` ${p.unit}` : ''}</td>
          <td className="table-cell tabular-nums text-right text-amber-700">{money(p.cost)}</td>
          <td className="table-cell tabular-nums text-right text-blue-700">{money(p.revenue)}</td>
          <td className={cn('table-cell tabular-nums text-right font-bold', p.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.gain)}</td>
        </tr>
      ))}
      <tr className="bg-blue-50/60">
        <td className="table-cell font-black text-[#002d87]">TOTAL</td>
        <td className="table-cell" />
        <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(t.cost)}</td>
        <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(t.revenue)}</td>
        <td className={cn('table-cell tabular-nums text-right font-black', t.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(t.gain)}</td>
      </tr>
    </Table>
  );
}

export function DebtTable({ rows, tone }: { rows: PartReport['clientDebts']; tone: 'client' | 'supplier' }) {
  if (!rows.length) return <Empty text="Aucune dette" />;
  return (
    <Table head={<><th className="table-head">Réf</th><th className="table-head">{tone === 'client' ? 'Client' : 'Fournisseur'}</th><th className="table-head">Date</th><th className="table-head text-right">Total</th><th className="table-head text-right">Reste dû</th></>}>
      {rows.map(d => (
        <tr key={d.id}>
          <td className="table-cell font-bold">{d.ref}</td>
          <td className="table-cell">{d.name}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(d.date)}</td>
          <td className="table-cell tabular-nums text-right">{money(d.total)}</td>
          {/* Une AVANCE est une ligne au crédit : elle vient en déduction du
              total, et se lit en vert pour qu'on ne la prenne pas pour une
              créance de plus. */}
          <td className={cn('table-cell tabular-nums text-right font-bold',
            d.rest < 0 ? 'text-teal-600' : tone === 'client' ? 'text-red-600' : 'text-amber-600')}>{money(d.rest)}</td>
        </tr>
      ))}
      <tr className="bg-slate-50">
        <td className="table-cell font-black uppercase text-[10px] tracking-widest" colSpan={4}>Total</td>
        <td className={cn('table-cell tabular-nums text-right font-black',
          tone === 'client' ? 'text-red-600' : 'text-amber-600')}>
          {money(Math.max(0, rows.reduce((t, d) => t + d.rest, 0)))}
        </td>
      </tr>
    </Table>
  );
}

/**
 * Les charges de la partie. La colonne « Payé depuis » dit ce que le total ne
 * disait pas : la dépense a-t-elle vidé le TIROIR de l'activité, ou est-elle
 * partie d'un compte bancaire ? C'est la différence entre un solde de caisse
 * qui baisse et un solde de caisse qui ne bouge pas.
 */
export function ExpenseTable({ rows }: { rows: PartReport['expenses'] }) {
  if (!rows.length) return <Empty />;
  const toneOf = (k: string) => k === 'Salaire' ? 'badge-info' : k === 'Acompte' ? 'badge-warning' : k === 'Absence' ? 'badge-danger' : 'badge-neutral';
  return (
    <Table head={<><th className="table-head">Type</th><th className="table-head">Nom / Description</th><th className="table-head">Payé depuis</th><th className="table-head">Date</th><th className="table-head text-right">Montant</th></>}>
      {rows.map(e => (
        <tr key={`${e.kind}-${e.id}`}>
          <td className="table-cell"><span className={cn('badge', toneOf(e.kind))}>{e.kind}</span></td>
          <td className="table-cell"><span className="font-bold">{e.label}</span>{e.description ? <span className="text-slate-400"> — {e.description}</span> : null}</td>
          <td className="table-cell text-slate-500">
            {e.kind !== 'Dépense' ? '—' : e.paidInCash === false ? 'Banque' : 'Caisse de la partie'}
          </td>
          <td className="table-cell whitespace-nowrap">{fmtDate(e.date)}</td>
          <td className="table-cell tabular-nums text-right font-bold text-red-600">{money(e.amount)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function StockAlertTable({ rows }: { rows: PartReport['stockAlerts'] }) {
  if (!rows.length) return <Empty text="Aucune alerte de stock ✅" />;
  return (
    <Table head={<><th className="table-head">Produit</th><th className="table-head">Catégorie</th><th className="table-head text-right">Stock</th><th className="table-head text-right">Seuil</th><th className="table-head text-right">Manque</th><th className="table-head text-right">Valeur</th></>}>
      {rows.map(a => (
        <tr key={a.id}>
          <td className="table-cell font-bold">{a.name}</td>
          <td className="table-cell text-slate-400">{a.category || '—'}</td>
          <td className={cn('table-cell tabular-nums text-right font-bold', a.currentQty <= 0 ? 'text-red-600' : 'text-amber-600')}>{a.currentQty}{a.unit ? ` ${a.unit}` : ''}</td>
          <td className="table-cell tabular-nums text-right text-slate-500">{a.minQty}</td>
          <td className="table-cell tabular-nums text-right font-bold text-red-600">-{a.deficit}</td>
          <td className="table-cell tabular-nums text-right">{money(a.value)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ExpiryTable({ rows }: { rows: PartReport['expiryAlerts'] }) {
  if (!rows.length) return <Empty text="Aucune expiration proche ✅" />;
  return (
    <Table head={<><th className="table-head">Produit</th><th className="table-head">Expiration</th><th className="table-head text-right">Jours restants</th><th className="table-head text-right">Quantité</th><th className="table-head text-right">Valeur</th></>}>
      {rows.map(a => (
        <tr key={a.id}>
          <td className="table-cell font-bold">{a.name}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(a.expirationDate)}</td>
          <td className="table-cell text-right">
            <span className={cn('badge', a.status === 'expired' ? 'badge-danger' : 'badge-warning')}>
              {a.status === 'expired' ? `Expiré (${Math.abs(a.daysLeft)}j)` : `${a.daysLeft}j`}
            </span>
          </td>
          <td className="table-cell tabular-nums text-right">{a.currentQty}{a.unit ? ` ${a.unit}` : ''}</td>
          <td className="table-cell tabular-nums text-right">{money(a.value)}</td>
        </tr>
      ))}
    </Table>
  );
}

function WorkerTable({ rows }: { rows: PartReport['workers'] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty text="Aucun employé" />;
  return (
    <div className="card-glass overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="table-head w-8" /><th className="table-head">Employé</th><th className="table-head">Rôle</th>
            <th className="table-head text-right">Salaire</th><th className="table-head text-right">Acomptes</th>
            <th className="table-head text-right">Absences</th><th className="table-head text-right">Payé</th><th className="table-head text-right">Net à payer</th>
          </tr></thead>
          <tbody>
            {rows.map(w => {
              const isOpen = open === w.id;
              const hasDetail = w.acomptes.length > 0 || w.absences.length > 0 || w.payments.length > 0;
              return (
                <React.Fragment key={w.id}>
                  <tr className={cn(hasDetail && 'cursor-pointer hover:bg-slate-50')} onClick={() => hasDetail && setOpen(isOpen ? null : w.id)}>
                    <td className="table-cell text-slate-400">{hasDetail ? (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}</td>
                    <td className="table-cell font-bold">{w.name}</td>
                    <td className="table-cell text-slate-500">{w.role}</td>
                    <td className="table-cell tabular-nums text-right">{money(w.salaryAmount)}<span className="text-slate-400 text-xs">/{w.salaryType}</span></td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(w.acomptesTotal)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{w.absencesCount ? money(w.absencesTotal) : '—'}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(w.paymentsTotal)}</td>
                    <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(w.net)}</td>
                  </tr>
                  {isOpen && hasDetail && (
                    <tr><td colSpan={8} className="bg-slate-50/70 px-6 py-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <MiniList title="Acomptes" empty="Aucun acompte" tone="amber" items={w.acomptes.map(a => ({ left: fmtDate(a.date), mid: a.description || 'Acompte', right: money(a.amount), flag: a.paid ? 'Payé' : 'Dû' }))} />
                        <MiniList title="Absences" empty="Aucune absence" tone="red" items={w.absences.map(a => ({ left: fmtDate(a.date), mid: a.description || 'Absence', right: money(a.cost), flag: a.paid ? 'Retenu' : '—' }))} />
                        <MiniList title="Paiements" empty="Aucun paiement" tone="green" items={w.payments.map(p => ({ left: fmtDate(p.date), mid: p.period, right: money(p.amount), flag: '' }))} />
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniList({ title, items, empty, tone }: { title: string; empty: string; tone: 'amber' | 'red' | 'green'; items: { left: string; mid: string; right: string; flag: string }[] }) {
  const toneCls = { amber: 'text-amber-700', red: 'text-red-600', green: 'text-emerald-600' }[tone];
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-3">
      <p className={cn('text-[11px] font-black uppercase tracking-wide mb-2', toneCls)}>{title}</p>
      {items.length === 0 ? <p className="text-xs text-slate-400 italic">{empty}</p> : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-400 shrink-0">{it.left}</span>
              <span className="text-slate-600 truncate flex-1">{it.mid}</span>
              <span className={cn('font-bold tabular-nums shrink-0', toneCls)}>{it.right}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DestructionTable({ rows }: { rows: PartReport['destructions'] }) {
  if (!rows.length) return <Empty text="Aucune destruction" />;
  const total = rows.reduce((s, d) => s + d.value, 0);
  return (
    <>
      <Table head={<>
        <th className="table-head">Produit</th><th className="table-head">Provenance</th>
        <th className="table-head text-right">Quantité</th><th className="table-head text-right">Coût unitaire</th>
        <th className="table-head">Motif</th><th className="table-head">Agent</th>
        <th className="table-head">Date</th><th className="table-head text-right">Coût</th>
      </>}>
        {rows.map(d => (
          <tr key={d.id}>
            <td className="table-cell">
              <div className="font-bold">{d.name}</div>
              {d.category && <div className="text-[11px] text-slate-400">{d.category}</div>}
              {d.notes && <div className="text-[11px] text-slate-400 italic">{d.notes}</div>}
            </td>
            <td className="table-cell">
              <Badge tone={d.source === 'stock' ? 'primary' : 'neutral'}>
                {d.source === 'stock' ? 'Gestion de stock' : 'Comptoir'}
              </Badge>
            </td>
            <td className="table-cell tabular-nums text-right">{d.qty} <span className="text-xs text-slate-400">{d.unit}</span></td>
            <td className="table-cell tabular-nums text-right text-slate-500">{money(d.unitPrice)}</td>
            <td className="table-cell text-slate-500">{d.reason || '—'}</td>
            <td className="table-cell text-slate-500">{d.createdBy || '—'}</td>
            <td className="table-cell whitespace-nowrap">{fmtDate(d.date)}</td>
            <td className="table-cell tabular-nums text-right font-bold text-red-600">{money(d.value)}</td>
          </tr>
        ))}
      </Table>
      <div className="card-glass px-5 py-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {rows.length} destruction(s) — coût déduit du bénéfice net de la période.
        </span>
        <span className="font-black tabular-nums text-red-600">−{money(total)}</span>
      </div>
    </>
  );
}

/**
 * Retours & échanges — les ventes ANNULÉES de la période.
 *
 * Elles ne sont plus nulle part ailleurs dans le rapport : ni dans le chiffre
 * d'affaires, ni dans les gains, puisque la marchandise est revenue en stock.
 * Ce tableau est donc le seul endroit qui explique pourquoi la caisse a moins
 * encaissé que ce qui avait été facturé.
 */
export function ReturnTable({ rows }: { rows: PartReport['returns'] }) {
  if (!rows.length) return <Empty text="Aucun retour ni échange sur la période ✅" />;
  const t = rows.reduce((a, x) => ({
    total: a.total + x.total, refunded: a.refunded + x.refunded,
    restocked: a.restocked + x.restockedCost, gain: a.gain + x.canceledGain,
  }), { total: 0, refunded: 0, restocked: 0, gain: 0 });
  return (
    <>
      <Table head={<>
        <th className="table-head">Réf</th><th className="table-head">Type</th><th className="table-head">Client</th>
        <th className="table-head">Date</th><th className="table-head">Motif</th>
        <th className="table-head text-right">CA annulé</th><th className="table-head text-right">Remboursé</th>
        <th className="table-head text-right">Remis en stock</th><th className="table-head text-right">Gain annulé</th>
      </>}>
        {rows.map(r => (
          <tr key={r.id}>
            <td className="table-cell font-bold">{r.ref}</td>
            <td className="table-cell"><Badge tone={r.kind === 'Retour' ? 'neutral' : 'info'}>{r.kind}</Badge></td>
            <td className="table-cell">{r.client}</td>
            <td className="table-cell whitespace-nowrap">{fmtDate(r.date)}</td>
            <td className="table-cell text-slate-500 max-w-[180px]">{r.reason || '—'}</td>
            <td className="table-cell tabular-nums text-right font-bold text-slate-500 line-through">{money(r.total)}</td>
            <td className="table-cell tabular-nums text-right text-red-600">{money(r.refunded)}</td>
            <td className="table-cell tabular-nums text-right text-emerald-600">{money(r.restockedCost)}</td>
            <td className="table-cell tabular-nums text-right font-bold text-amber-700">−{money(r.canceledGain)}</td>
          </tr>
        ))}
        <tr className="bg-blue-50/60">
          <td className="table-cell font-black text-[#002d87]" colSpan={5}>TOTAL</td>
          <td className="table-cell tabular-nums text-right font-black text-slate-500">{money(t.total)}</td>
          <td className="table-cell tabular-nums text-right font-black text-red-600">{money(t.refunded)}</td>
          <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(t.restocked)}</td>
          <td className="table-cell tabular-nums text-right font-black text-amber-700">−{money(t.gain)}</td>
        </tr>
      </Table>
      <div className="card-glass px-5 py-3 text-xs text-slate-400">
        {rows.length} vente(s) annulée(s) — déjà exclues du chiffre d'affaires, des gains par produit
        et du gain net. La marchandise ({money(t.restocked)} de coût de revient) est revenue en stock
        ou au comptoir, et {money(t.refunded)} ont été rendus aux clients.
      </div>
    </>
  );
}

/**
 * ─── Le solde de caisse, expliqué ─────────────────────────────────────────────
 * La carte « Solde caisse » n'affichait qu'un montant. Quand il passait sous
 * zéro — le fameux −973 867,40 DA du rapport Carburant — rien à l'écran ne
 * permettait de savoir POURQUOI, ni quelle ligne allait de travers. Ce tableau
 * est le calcul lui-même : chaque espèce entrée, chaque espèce sortie, groupées
 * par nature puis listées une par une, dont la somme EST le solde affiché.
 */
export function CaisseTable({ rows, balance, flow }: {
  rows: PartReport['caisseMovements'];
  balance: number;
  flow: PartReport['caisseFlow'];
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty text="Aucun mouvement d'espèces enregistré" />;

  // Regroupement par nature ET par sens : « Achat » sortant et « Achat » entrant
  // (un remboursement) sont deux choses différentes et ne doivent pas se compenser.
  const groups = new Map<string, { key: string; nature: string; dir: 'in' | 'out'; total: number; rows: typeof rows }>();
  rows.forEach(r => {
    const dir: 'in' | 'out' = r.amount >= 0 ? 'in' : 'out';
    const key = `${r.nature}|${dir}`;
    const g = groups.get(key) || { key, nature: r.nature, dir, total: 0, rows: [] as typeof rows };
    g.total += Math.abs(r.amount);
    g.rows.push(r);
    groups.set(key, g);
  });
  const list = [...groups.values()].sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-3">
      {/* Le calcul en une ligne */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <ArrowDownCircle className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-wide">Espèces entrées</span>
          </div>
          <p className="text-2xl font-black tabular-nums mt-1">{money(flow.in)}</p>
        </div>
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
          <div className="flex items-center gap-2 text-red-100">
            <ArrowUpCircle className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-wide">Espèces sorties</span>
          </div>
          <p className="text-2xl font-black tabular-nums mt-1">{money(flow.out)}</p>
        </div>
        <div className="rounded-2xl p-4 text-white"
          style={{ background: balance < 0 ? 'linear-gradient(135deg,#7f1d1d,#b91c1c)' : 'linear-gradient(135deg,#001f5c,#003087)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className={cn('flex items-center gap-2', balance < 0 ? 'text-red-100' : 'text-blue-200')}>
              <Wallet className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-wide">Solde</span>
            </div>
            {balance < 0 && <span className="badge badge-danger shrink-0">Découvert</span>}
          </div>
          <p className={cn('text-2xl font-black tabular-nums mt-1', balance < 0 ? 'text-white' : 'text-[#FFB800]')}>{money(balance)}</p>
        </div>
      </div>

      {/* Par nature — cliquer déroule les lignes */}
      <div className="card-glass overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <thead><tr>
              <th className="table-head w-8" /><th className="table-head">Nature</th><th className="table-head">Sens</th>
              <th className="table-head text-right">Opérations</th><th className="table-head text-right">Montant</th>
            </tr></thead>
            <tbody>
              {list.map(g => {
                const isOpen = open === g.key;
                return (
                  <React.Fragment key={g.key}>
                    <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(isOpen ? null : g.key)}>
                      <td className="table-cell text-slate-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                      <td className="table-cell font-bold">{g.nature}</td>
                      <td className="table-cell">
                        <Badge tone={g.dir === 'in' ? 'success' : 'danger'}>{g.dir === 'in' ? 'Entrée' : 'Sortie'}</Badge>
                      </td>
                      <td className="table-cell tabular-nums text-right text-slate-500">{g.rows.length}</td>
                      <td className={cn('table-cell tabular-nums text-right font-black', g.dir === 'in' ? 'text-emerald-600' : 'text-red-600')}>
                        {g.dir === 'in' ? '+' : '−'}{money(g.total)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={5} className="bg-slate-50/70 px-4 py-3">
                        <div className="space-y-1.5">
                          {g.rows.map(r => (
                            <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-white border border-slate-100 px-3 py-2">
                              <span className="text-[11px] text-slate-400 shrink-0 w-24">{fmtDate(r.date)}</span>
                              <span className="text-xs text-slate-600 flex-1 truncate">{r.label}</span>
                              {r.mode && <ModeBadge mode={r.mode} />}
                              {r.reference && <span className="badge badge-neutral shrink-0">{r.reference}</span>}
                              <span className={cn('font-black tabular-nums text-xs shrink-0', r.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                                {r.amount >= 0 ? '+' : '−'}{money(Math.abs(r.amount))}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              <tr className="bg-blue-50/60">
                <td className="table-cell" />
                <td className="table-cell font-black text-[#002d87]" colSpan={3}>SOLDE — entrées {money(flow.in)} − sorties {money(flow.out)}</td>
                <td className={cn('table-cell tabular-nums text-right font-black', balance >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 italic px-1">
        Seules les espèces comptent ici : un achat réglé par chèque ou par virement n'est jamais passé par
        le tiroir. Le solde couvre TOUTES les dates — ce qu'il y a dans la caisse aujourd'hui ne dépend pas
        de la période choisie. C'est le même chiffre que l'écran Caisse Générale.
      </p>
    </div>
  );
}

/**
 * ─── Le mode de règlement, en une pastille ────────────────────────────────────
 * Les espèces au vert — l'argent est dans le tiroir — le reste au bleu : il est
 * en banque, ou en route pour y être.
 */
function ModeBadge({ mode }: { mode: string }) {
  const cash = isCashMode(mode);
  const label = MODE_LABEL[String(mode || '').trim().toUpperCase()] || mode || 'Espèces';
  return (
    <span className={cn('text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap',
      cash ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
        : 'bg-blue-50 text-blue-700 border border-blue-100')}>
      {label}
    </span>
  );
}

const MODE_LABEL: Record<string, string> = {
  ESPECES: 'Espèces', 'ESPÈCES': 'Espèces', CASH: 'Espèces', LIQUIDE: 'Espèces',
  CHEQUE: 'Chèque', 'CHÈQUE': 'Chèque', VIREMENT: 'Virement',
  TPE: 'Carte / TPE', CARTE: 'Carte / TPE', TAG: 'TAG',
};

/**
 * ─── Les règlements des clients, mode de paiement compris ────────────────────
 * La liste des clients qui ont payé sur la période disait QUI et COMBIEN, mais
 * jamais PAR QUEL MOYEN : un chèque de 200 000 DA et 200 000 DA de billets s'y
 * ressemblaient trait pour trait, alors que l'un dort chez le banquier et
 * l'autre est déjà dans le tiroir. Le mode figure maintenant sur chaque ligne,
 * et le récapitulatif du haut donne le poids de chacun.
 */
export function ClientPaymentsTable({ rows }: { rows: PartReport['clientPayments'] }) {
  if (!rows.length) return <Empty text="Aucun règlement client sur la période" />;
  const byMode = clientPaymentsByMode(rows);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const clients = new Set(rows.map(r => r.clientId)).size;

  return (
    <div className="space-y-3">
      {/* Récapitulatif par mode — les espèces d'abord, c'est le seul argent
          déjà présent en caisse. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {byMode.map(m => (
          <div key={m.mode} className={cn('rounded-xl border p-3',
            isCashMode(m.mode) ? 'border-emerald-100 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/60')}>
            <p className="text-[10px] uppercase font-bold text-slate-400">{m.label}</p>
            <p className={cn('font-black tabular-nums text-sm', isCashMode(m.mode) ? 'text-emerald-700' : 'text-blue-700')}>{money(m.total)}</p>
            <p className="text-[10px] text-slate-400 font-medium">{m.clients} client(s) · {m.count} règlement(s)</p>
          </div>
        ))}
      </div>

      <Table head={<>
        <th className="table-head">Date</th><th className="table-head">Client</th>
        <th className="table-head">Type</th><th className="table-head">Mode de paiement</th>
        <th className="table-head">Référence</th><th className="table-head text-right">Montant</th>
      </>}>
        {rows.map(r => (
          <tr key={r.id}>
            <td className="table-cell whitespace-nowrap text-slate-500">{fmtDate(r.date)}</td>
            <td className="table-cell font-bold">{r.clientName}</td>
            <td className="table-cell"><Badge tone={r.kind === 'Recharge' ? 'info' : 'success'}>{r.kind}</Badge></td>
            <td className="table-cell"><ModeBadge mode={r.mode} /></td>
            <td className="table-cell text-slate-400">{r.reference || '—'}</td>
            <td className={cn('table-cell tabular-nums text-right font-black',
              isCashMode(r.mode) ? 'text-emerald-600' : 'text-blue-700')}>{money(r.amount)}</td>
          </tr>
        ))}
        <tr className="bg-blue-50/60">
          <td className="table-cell font-black text-[#002d87]" colSpan={5}>
            TOTAL — {rows.length} règlement(s) de {clients} client(s)
          </td>
          <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(total)}</td>
        </tr>
      </Table>

      <p className="text-[11px] text-slate-400 italic px-1">
        Seuls les règlements en ESPÈCES sont entrés dans le tiroir : un chèque, un virement ou un paiement
        par TPE est encaissé sur un compte bancaire. Le « Solde caisse » ne compte donc que les premiers —
        les deux listes ne se contredisent pas, elles ne parlent pas du même argent.
      </p>
    </div>
  );
}

/**
 * ─── Les brigades : la vraie vente de carburant ───────────────────────────────
 * Une brigade clôturée EST une vente : ses pistolets disent les litres et le
 * chiffre d'affaires, sa comptabilité dit ce qui est rentré (espèces, TPE, bons
 * clients) et ce qui manque. Le rapport lisait auparavant une table `fuel_sales`
 * que plus aucun écran n'alimente — d'où un carburant à zéro recette.
 */
export function FuelBrigadeTable({ rows }: { rows: PartReport['fuelBrigades'] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty text="Aucune brigade sur la période" />;
  const t = rows.reduce((a, b) => ({
    liters: a.liters + b.liters, revenue: a.revenue + b.revenue, cash: a.cash + b.cash,
    tpe: a.tpe + b.tpe, credit: a.credit + b.credit, rest: a.rest + b.rest,
  }), { liters: 0, revenue: 0, cash: 0, tpe: 0, credit: 0, rest: 0 });

  return (
    <div className="card-glass overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="table-head w-8" /><th className="table-head">Brigade</th><th className="table-head">Chef</th>
            <th className="table-head">Date</th><th className="table-head text-right">Litres</th>
            <th className="table-head text-right">Chiffre d'affaires</th><th className="table-head text-right">Espèces</th>
            <th className="table-head text-right">TPE</th><th className="table-head text-right">Bons clients</th>
            <th className="table-head text-right">Manquant</th><th className="table-head">Statut</th>
          </tr></thead>
          <tbody>
            {rows.map(b => {
              const isOpen = open === b.id;
              return (
                <React.Fragment key={b.id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(isOpen ? null : b.id)}>
                    <td className="table-cell text-slate-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                    <td className="table-cell font-bold whitespace-nowrap">{b.shift}</td>
                    <td className="table-cell text-slate-500">{b.chefName}</td>
                    <td className="table-cell whitespace-nowrap text-slate-500">{fmtDate(b.date)}</td>
                    <td className="table-cell tabular-nums text-right font-bold">{liters(b.liters)}</td>
                    <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(b.revenue)}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(b.cash)}</td>
                    <td className="table-cell tabular-nums text-right text-blue-700">{money(b.tpe)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(b.credit)}</td>
                    <td className={cn('table-cell tabular-nums text-right font-bold', Math.abs(b.rest) > 0.01 ? 'text-red-600' : 'text-slate-300')}>{money(b.rest)}</td>
                    <td className="table-cell"><Badge tone={b.closed ? 'success' : 'warning'}>{b.status}</Badge></td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={11} className="bg-slate-50/70 px-4 py-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-xl bg-white border border-slate-100 p-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-[#003087] mb-2 flex items-center gap-1.5">
                            <Fuel className="w-3.5 h-3.5" /> Par carburant
                          </p>
                          {b.byFuel.length === 0 ? <p className="text-xs text-slate-400 italic">Aucun litre relevé.</p> : (
                            <div className="space-y-1.5">
                              {b.byFuel.map(f => (
                                <div key={f.type} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-bold text-slate-700 w-24 shrink-0">{f.type}</span>
                                  <span className="text-slate-400 tabular-nums">{liters(f.liters)} × {money(f.price)}</span>
                                  <span className="text-amber-700 tabular-nums text-[11px]">coût {money(f.cost)}</span>
                                  <span className="ml-auto font-black tabular-nums text-[#002d87]">{money(f.revenue)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="rounded-xl bg-white border border-slate-100 p-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-[#003087] mb-2 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5" /> Par pompiste
                          </p>
                          {b.pompistes.length === 0 ? <p className="text-xs text-slate-400 italic">Aucun pompiste enregistré.</p> : (
                            <div className="space-y-1.5">
                              {b.pompistes.map(p => (
                                <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-bold text-slate-700 truncate flex-1">{p.name}</span>
                                  <span className="text-slate-400 tabular-nums shrink-0">{liters(p.liters)}</span>
                                  <span className="text-slate-500 tabular-nums shrink-0">dû {money(p.theoretical)}</span>
                                  <span className="text-emerald-600 tabular-nums shrink-0">rendu {money(p.cash + p.justified)}</span>
                                  <span className={cn('font-black tabular-nums shrink-0', Math.abs(p.ecart) > 0.01 ? 'text-red-600' : 'text-slate-300')}>{money(p.ecart)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr className="bg-blue-50/60">
              <td className="table-cell" />
              <td className="table-cell font-black text-[#002d87]" colSpan={3}>TOTAL — {rows.length} brigade(s)</td>
              <td className="table-cell tabular-nums text-right font-black">{liters(t.liters)}</td>
              <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(t.revenue)}</td>
              <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(t.cash)}</td>
              <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(t.tpe)}</td>
              <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(t.credit)}</td>
              <td className="table-cell tabular-nums text-right font-black text-red-600">{money(t.rest)}</td>
              <td className="table-cell" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Le gain net, décomposé étape par étape — la carte « Total des gains ». */
export function GainBreakdown({ report: r }: { report: PartReport }) {
  const steps: { label: string; value: number; sign: '' | '−' | '='; hint: string }[] = [
    { label: "Chiffre d'affaires", value: r.salesTotal, sign: '', hint: `${r.counts.sales} opération(s) facturée(s)` },
    { label: 'Coût des marchandises vendues', value: r.cogs, sign: '−', hint: "ce que la marchandise vendue a coûté à l'achat" },
    { label: 'Marge brute', value: r.grossMargin, sign: '=', hint: 'ce que la vente laisse avant les charges' },
    { label: 'Dépenses', value: r.expensesTotal, sign: '−', hint: `${r.expensesByCategory.length} catégorie(s)` },
    { label: 'Salaires versés', value: r.salariesPaid, sign: '−', hint: 'paie de la période' },
    ...(r.destroyedValue > 0 ? [{ label: 'Destructions', value: r.destroyedValue, sign: '−' as const, hint: 'marchandise perdue' }] : []),
    ...(r.lossValue > 0 ? [{ label: 'Pertes de production', value: r.lossValue, sign: '−' as const, hint: 'écarts de fabrication' }] : []),
    { label: 'Gain net', value: r.netGain, sign: '=', hint: 'ce qui reste réellement' },
  ];
  return (
    <div className="space-y-3">
      <Table head={<><th className="table-head" /><th className="table-head">Étape</th><th className="table-head text-right">Montant</th></>}>
        {steps.map(s => (
          <tr key={s.label} className={s.sign === '=' ? 'bg-slate-50' : undefined}>
            <td className="table-cell text-center text-slate-300 font-black w-8">{s.sign}</td>
            <td className="table-cell">
              <div className="font-bold text-slate-700">{s.label}</div>
              <div className="text-[11px] text-slate-400">{s.hint}</div>
            </td>
            <td className={cn('table-cell tabular-nums text-right font-black',
              s.label === 'Gain net' ? (s.value >= 0 ? 'text-emerald-600' : 'text-red-600')
                : s.sign === '−' ? 'text-red-600' : 'text-[#002d87]')}>{money(s.value)}</td>
          </tr>
        ))}
      </Table>
      <p className="text-[11px] text-slate-400 italic px-1">
        Un produit vendu {money(30)} qui a coûté {money(12)} rapporte {money(18)} : c'est ce montant-là qui
        alimente le gain, jamais le prix de vente entier. Le gain se calcule sur ce qui a été VENDU — il ne
        dit pas ce qu'il y a dans la caisse (voir « Solde caisse »).
      </p>
    </div>
  );
}

/** La valeur du stock, référence par référence — cuves de carburant comprises. */
export function StockValueTable({ rows, total }: { rows: PartReport['stockLines']; total: number; }) {
  if (!rows.length) return <Empty text="Aucune référence en stock" />;
  return (
    <>
      <Table head={<>
        <th className="table-head">Référence</th><th className="table-head">Catégorie</th>
        <th className="table-head text-right">Quantité</th><th className="table-head text-right">Prix d'achat</th>
        <th className="table-head text-right">Valeur</th>
      </>}>
        {rows.map(p => (
          <tr key={p.id}>
            <td className="table-cell font-bold">{p.name}</td>
            <td className="table-cell text-slate-400">{p.category || '—'}</td>
            <td className={cn('table-cell tabular-nums text-right', p.qty < 0 && 'text-red-600 font-bold')}>
              {p.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{p.unit ? ` ${p.unit}` : ''}
            </td>
            <td className="table-cell tabular-nums text-right text-slate-500">{money(p.buyPrice)}</td>
            <td className="table-cell tabular-nums text-right font-bold text-blue-700">{money(p.value)}</td>
          </tr>
        ))}
        <tr className="bg-blue-50/60">
          <td className="table-cell font-black text-[#002d87]" colSpan={4}>TOTAL — au prix d'achat</td>
          <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(total)}</td>
        </tr>
      </Table>
      <div className="card-glass px-5 py-3 text-[11px] text-slate-400 italic">
        Valorisé au PRIX D'ACHAT, jamais au prix de vente : la marge n'existe qu'une fois la marchandise
        vendue. Un prix d'achat resté à zéro dans les réglages donne une valeur nulle — c'est là qu'il faut
        regarder si un stock bien réel s'affiche à {money(0)}.
      </div>
    </>
  );
}

function Empty({ text = 'Aucune donnée sur la période' }: { text?: string }) {
  return <div className="card-glass p-6 text-center text-slate-400 text-sm">{text}</div>;
}

// ─── Section wrapper ─────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, right }: { title: string; icon: React.ElementType; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Icon className="w-5 h-5 text-[#FFB800]" /> {title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Detail modal ────────────────────────────────────────────────────────────
// Chaque carte KPI ouvre le détail de SON calcul : plus une seule ne se contente
// d'annoncer un montant que rien à l'écran ne permet de vérifier.
type DetailKey =
  | 'sales' | 'purchases' | 'gains' | 'gain' | 'expenses' | 'clientDebts' | 'supplierDebts'
  | 'stock' | 'stockValue' | 'expiry' | 'workers' | 'destructions' | 'returns'
  | 'caisse' | 'brigades' | 'serviceWorks' | 'clientPayments' | 'clientCash' | null;

// ─── Main view ───────────────────────────────────────────────────────────────
export default function ReportView({ report: r, serviceWorkers }: {
  report: PartReport;
  /**
   * Les employés de l'activité, quand celle-ci est une activité de SERVICE
   * (Magasin) : le rapport déplie alors, employé par employé, tout ce
   * qu'ils ont fait sur la période. Absent ailleurs — un rapport de cafétéria
   * ou de carburant n'a pas de travaux nominatifs à montrer.
   */
  serviceWorkers?: WorkforceWorker[];
}) {
  const [detail, setDetail] = useState<DetailKey>(null);
  const crew: WorkforceWorker[] = serviceWorkers || NO_CREW;

  /** Les chiffres de l'équipe, repris des cartes cliquables ci-dessous. */
  const crewTotals = React.useMemo(() => {
    const jobs = new Set<string>();
    let earned = 0, base = 0, due = 0;
    crew.forEach(w => {
      w.works.forEach(x => jobs.add(x.id));
      earned += w.earned; base += w.worksBase; due += w.dueNow;
    });
    return { jobs: jobs.size, earned, base, due, active: crew.filter(w => w.works.length > 0).length };
  }, [crew]);

  const financial: [string, number, ('good' | 'bad' | 'neutral')?][] = [
    ["Chiffre d'affaires", r.salesTotal, 'good'], ['Ventes encaissées', r.salesPaid], ['Coût marchandises', r.cogs],
    ...(r.fuelBrigades.length
      ? ([['Espèces des brigades', r.fuelBrigades.reduce((s, b) => s + b.cash, 0), 'good'],
        ['TPE / TAG encaissés', r.fuelBrigades.reduce((s, b) => s + b.tpe, 0)],
        ['Bons clients (crédit)', r.fuelBrigades.reduce((s, b) => s + b.credit, 0), 'bad'],
        ['Manquants de brigade', r.fuelBrigades.reduce((s, b) => s + b.rest, 0), 'bad'],
      ] as [string, number, ('good' | 'bad' | 'neutral')?][])
      : []),
    ['Retours & échanges', r.returnsTotal, r.returnsTotal > 0 ? 'bad' : undefined],
    ['Remboursé aux clients', r.refundedTotal, r.refundedTotal > 0 ? 'bad' : undefined],
    ['Marge brute', r.grossMargin, r.grossMargin >= 0 ? 'good' : 'bad'], ['Total achats', r.purchasesTotal], ['Achats payés', r.purchasesPaid],
    ['Dépenses', r.expensesTotal, 'bad'], ['Salaires versés', r.salariesPaid], ['Acomptes période', r.acomptesPeriod],
    ['Valeur production', r.productionValue], ['Pertes production', r.lossValue, r.lossValue > 0 ? 'bad' : undefined], ['Destructions', r.destroyedValue, r.destroyedValue > 0 ? 'bad' : undefined],
    ['Dettes clients', r.clientDebtTotal, r.clientDebtTotal > 0 ? 'bad' : undefined], ['Dettes fournisseurs', r.supplierDebtTotal, r.supplierDebtTotal > 0 ? 'bad' : undefined],
    ['Solde de caisse', r.caisseBalance], ['Valeur du stock', r.stockValue],
  ];

  const modalTitle: Record<Exclude<DetailKey, null>, string> = {
    sales: 'Détail des ventes', purchases: 'Détail des achats', gains: 'Gains par produit',
    gain: 'Comment le gain net est calculé', expenses: 'Dépenses, salaires & acomptes',
    clientDebts: 'Dettes des clients', supplierDebts: 'Dettes envers les fournisseurs', stock: 'Alertes de stock',
    stockValue: 'Valeur du stock, référence par référence',
    expiry: 'Alertes d\'expiration', workers: 'Comptes des employés', destructions: 'Produits détruits',
    returns: 'Retours & échanges — ventes annulées',
    caisse: 'Solde de caisse — le calcul, mouvement par mouvement',
    brigades: 'Brigades — les ventes de carburant de la période',
    serviceWorks: 'Travaux des employés — le détail, employé par employé',
    clientPayments: 'Règlements des clients — mode de paiement par client',
    clientCash: 'Règlements encaissés en espèces — client par client',
  };

  const isFuel = r.fuelBrigades.length > 0;

  /** Les règlements des clients sur la période, et ce que les espèces y pèsent. */
  const clientCash = React.useMemo(() => clientCashSummary(r.clientPayments), [r.clientPayments]);
  const cashPayments = React.useMemo(
    () => r.clientPayments.filter(p => isCashMode(p.mode)), [r.clientPayments]);

  return (
    <div className="space-y-8">
      {/* KPI cards — chacune ouvre le détail complet de son propre calcul */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={TrendingUp} tone="green" label="Ventes (CA)" value={money(r.salesTotal)}
          sub={r.counts.returns ? `${r.counts.sales} opérations — ${r.counts.returns} annulée(s) exclue(s)` : `${r.counts.sales} opérations`}
          onClick={() => setDetail('sales')} />
        <MetricCard icon={ShoppingCart} tone="purple" label="Achats" value={money(r.purchasesTotal)} sub={`${r.counts.purchases} factures · payé ${money(r.purchasesPaid)}`} onClick={() => setDetail('purchases')} />
        <MetricCard icon={Layers} tone="cyan" label="Marge brute" value={money(r.grossMargin)} sub={`CA − coût marchandises ${money(r.cogs)}`} onClick={() => setDetail('gains')} />
        <MetricCard icon={CircleDollarSign} tone={r.netGain >= 0 ? 'green' : 'red'} label="Total des gains" value={money(r.netGain)} sub="gain réel, coûts déduits" onClick={() => setDetail('gain')} />
        <MetricCard icon={CreditCard} tone="red" label="Dépenses" value={money(r.expensesTotal)} sub={`${r.expenses.length} lignes${r.salariesPaid ? ` · salaires ${money(r.salariesPaid)}` : ''}`} onClick={() => setDetail('expenses')} />
        {/* Le solde de caisse ouvre son propre calcul : entrées, sorties, puis
            chaque mouvement. Un découvert passe au rouge et s'explique. */}
        <MetricCard icon={Wallet} tone={r.caisseBalance < 0 ? 'red' : 'blue'} label="Solde caisse" value={money(r.caisseBalance)}
          sub={`+${money(r.caisseFlow.in)} · −${money(r.caisseFlow.out)}`} onClick={() => setDetail('caisse')} />
        <MetricCard icon={Boxes} tone="amber" label="Valeur stock" value={money(r.stockValue)} sub={`${r.counts.products} produits`} onClick={() => setDetail('stockValue')} />
        <MetricCard icon={Users} tone="slate" label="Employés" value={String(r.counts.workers)} sub={r.salariesPaid ? `${money(r.salariesPaid)} versés` : 'voir comptes'} onClick={() => r.workers.length ? setDetail('workers') : undefined} />
      </div>

      {/* Carburant — les brigades sont la vente. Sans elles, cette activité
          n'aurait aucune recette : la table `fuel_sales` n'est plus alimentée. */}
      {isFuel && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Fuel} tone="blue" label="Brigades" value={String(r.fuelBrigades.length)}
            sub="ventes de carburant" count={r.fuelBrigades.length} onClick={() => setDetail('brigades')} />
          <MetricCard icon={Droplets} tone="purple" label="Litres vendus" value={liters(r.fuelLiters)}
            sub="relevés aux pistolets" onClick={() => setDetail('brigades')} />
          <MetricCard icon={Banknote} tone="green" label="Espèces encaissées" value={money(r.fuelBrigades.reduce((s, b) => s + b.cash, 0))}
            sub="remises par les pompistes" onClick={() => setDetail('brigades')} />
          <MetricCard icon={Landmark} tone="cyan" label="TPE / TAG" value={money(r.fuelBrigades.reduce((s, b) => s + b.tpe, 0))}
            sub="encaissé en banque" onClick={() => setDetail('brigades')} />
        </div>
      )}

      {/* ─── Ce que les clients ont remis sur la période ──────────────────────
          La carte de gauche ouvre TOUS les règlements, mode de paiement compris ;
          celle de droite isole les ESPÈCES — combien de clients ont payé en
          billets, et quelle somme cela représente. Les deux se lisent sur la
          période choisie, pas sur l'encours de toutes les dates. */}
      {r.clientPayments.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Receipt} tone="blue" label="Règlements clients"
            value={money(r.clientPayments.reduce((s, p) => s + p.amount, 0))}
            sub={`${r.clientPayments.length} règlement(s) · ${new Set(r.clientPayments.map(p => p.clientId)).size} client(s)`}
            count={r.clientPayments.length} onClick={() => setDetail('clientPayments')} />
          <MetricCard icon={HandCoins} tone="green" label="Clients réglés en espèces"
            value={String(clientCash.clients)}
            sub={`${money(clientCash.total)} encaissés · ${clientCash.payments} règlement(s)`}
            count={clientCash.clients} onClick={() => setDetail('clientCash')} />
        </div>
      )}

      {/* ─── Le travail des employés (activité de service) ───────────────────
          Le rapport disait ce que l'atelier avait facturé sans jamais dire qui
          l'avait fait. Ces quatre cartes ouvrent le détail complet, employé par
          employé, sur la période choisie. */}
      {crew.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Briefcase} tone="cyan" label="Travaux des employés" value={String(crewTotals.jobs)}
            sub="interventions réalisées" count={crewTotals.jobs} onClick={() => setDetail('serviceWorks')} />
          <MetricCard icon={Users} tone="blue" label="Employés au travail" value={String(crewTotals.active)}
            sub={`sur ${crew.length} de l'activité`} onClick={() => setDetail('serviceWorks')} />
          <MetricCard icon={Percent} tone="green" label="Part des employés" value={money(crewTotals.earned)}
            sub={`sur ${money(crewTotals.base)} de base retenue`} onClick={() => setDetail('serviceWorks')} />
          <MetricCard icon={Wallet} tone={crewTotals.due > 0 ? 'red' : 'slate'} label="Reste à leur payer"
            value={money(crewTotals.due)} sub="travaux non encore réglés" onClick={() => setDetail('serviceWorks')} />
        </div>
      )}

      {/* Debt + alert cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Users} tone="red" label="Dettes clients" value={money(r.clientDebtTotal)} count={r.clientDebts.length} onClick={() => setDetail('clientDebts')}
          sub={r.clientAdvanceTotal > 0 ? `${money(r.clientAdvanceTotal)} d'avances clients déduites` : undefined} />
        <MetricCard icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(r.supplierDebtTotal)} count={r.supplierDebts.length} onClick={() => setDetail('supplierDebts')} />
        <MetricCard icon={AlertTriangle} tone="red" label="Alertes stock" value={String(r.stockAlerts.length)} sub="produits sous seuil" count={r.stockAlerts.length} onClick={() => setDetail('stock')} />
        <MetricCard icon={CalendarClock} tone="purple" label="Expirations proches" value={String(r.expiryAlerts.length)} sub="≤ 15 jours" count={r.expiryAlerts.length} onClick={() => setDetail('expiry')} />
      </div>

      {/* Retours & échanges — visibles seulement quand il y en a. */}
      {r.returns.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Undo2} tone="slate" label="Ventes annulées" value={money(r.returnsTotal)}
            sub="CA retiré du rapport" count={r.counts.returns} onClick={() => setDetail('returns')} />
          <MetricCard icon={Banknote} tone="red" label="Remboursé aux clients" value={money(r.refundedTotal)}
            sub="argent sorti du tiroir" onClick={() => setDetail('returns')} />
          <MetricCard icon={PackageCheck} tone="green" label="Marchandise revenue" value={money(r.restockedCost)}
            sub="coût de revient remis en stock" onClick={() => setDetail('returns')} />
        </div>
      )}

      {/* Financial synthesis */}
      <Section title="Synthèse financière" icon={Wallet}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {financial.map(([k, v, flag]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
              <p className={cn('font-black tabular-nums text-sm', flag === 'good' ? 'text-emerald-600' : flag === 'bad' ? 'text-red-600' : 'text-slate-700')}>{money(v)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Le solde de caisse, expliqué à la ligne — plus jamais un montant sec. */}
      <Section title="Solde de caisse — le calcul" icon={Wallet}
        right={<span className="text-[11px] text-slate-400 font-medium">Cliquez une nature pour dérouler ses mouvements</span>}>
        <CaisseTable rows={r.caisseMovements} balance={r.caisseBalance} flow={r.caisseFlow} />
      </Section>

      {/* Les règlements des clients, mode de paiement compris */}
      {r.clientPayments.length > 0 && (
        <Section title="Règlements des clients — par mode de paiement" icon={Receipt}
          right={<span className="text-[11px] text-slate-400 font-medium">
            {clientCash.clients} client(s) ont réglé en espèces, pour {money(clientCash.total)}
          </span>}>
          <ClientPaymentsTable rows={r.clientPayments} />
        </Section>
      )}

      {/* Carburant — les brigades de la période */}
      {isFuel && (
        <Section title="Brigades — les ventes de carburant" icon={Fuel}
          right={<span className="text-[11px] text-slate-400 font-medium">{liters(r.fuelLiters)} sur {r.fuelBrigades.length} brigade(s)</span>}>
          <FuelBrigadeTable rows={r.fuelBrigades} />
        </Section>
      )}

      {/* Sales by product */}
      <Section title="Ventes par produit" icon={TrendingUp}><ProductGainTable rows={r.salesByProduct} /></Section>

      {/* Sales invoices */}
      <Section title="Factures & prestations de vente" icon={CreditCard}
        right={r.returns.length > 0
          ? <span className="text-[11px] text-slate-400 font-medium">{r.counts.returns} vente(s) annulée(s) listée(s) plus bas</span>
          : undefined}>
        <SalesTable rows={r.sales} />
      </Section>

      {/* Retours & échanges */}
      {r.returns.length > 0 && (
        <Section title="Retours & échanges — ventes annulées" icon={Undo2}>
          <ReturnTable rows={r.returns} />
        </Section>
      )}

      {/* Purchases */}
      <Section title="Achats fournisseurs" icon={ShoppingCart}><PurchasesTable rows={r.purchases} /></Section>

      {/* Expenses */}
      <Section title="Dépenses, salaires & acomptes" icon={Banknote}>
        <ExpenseTable rows={r.expenses} />
        {r.expensesByCategory.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            {r.expensesByCategory.map(c => (
              <div key={c.category} className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] uppercase font-bold text-slate-400">{c.category}</p>
                <p className="font-black tabular-nums text-red-600 text-sm">{money(c.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Debts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Dettes clients" icon={Users}><DebtTable rows={r.clientDebts} tone="client" /></Section>
        <Section title="Dettes fournisseurs" icon={Truck}><DebtTable rows={r.supplierDebts} tone="supplier" /></Section>
      </div>

      {/* Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Alertes de stock" icon={AlertTriangle}><StockAlertTable rows={r.stockAlerts} /></Section>
        <Section title="Alertes d'expiration" icon={CalendarClock}><ExpiryTable rows={r.expiryAlerts} /></Section>
      </div>

      {/* Le travail des employés, déplié sur place */}
      {crew.length > 0 && (
        <Section title="Travaux des employés — le détail de la période" icon={Car}
          right={<span className="text-[11px] text-slate-400 font-medium">Cliquez un employé pour ses interventions, puis une intervention pour ses prestations</span>}>
          <ServiceWorksPanel workers={crew} from={r.from} to={r.to} />
        </Section>
      )}

      {/* Workers */}
      {r.workers.length > 0 && (
        <Section title="Comptes des employés" icon={Users} right={<span className="text-[11px] text-slate-400 font-medium">Cliquez une ligne pour les acomptes, absences & paiements</span>}>
          <WorkerTable rows={r.workers} />
        </Section>
      )}

      {/* Productions / Destructions */}
      {(r.productions.length > 0 || r.destructions.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {r.productions.length > 0 && (
            <Section title="Productions" icon={Beaker}>
              <Table head={<><th className="table-head">Production</th><th className="table-head text-right">Qté</th><th className="table-head text-right">Valeur</th><th className="table-head text-right">Pertes</th></>}>
                {r.productions.map(p => (
                  <tr key={p.id}>
                    <td className="table-cell font-bold">{p.name}</td>
                    <td className="table-cell tabular-nums text-right">{p.outputQuantity}{p.unit ? ` ${p.unit}` : ''}</td>
                    <td className="table-cell tabular-nums text-right">{money(p.totalValue)}</td>
                    <td className={cn('table-cell tabular-nums text-right', p.lossValue > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{p.lossValue > 0 ? money(p.lossValue) : '—'}</td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}
          {r.destructions.length > 0 && (
            <Section title="Produits détruits" icon={PackageX}><DestructionTable rows={r.destructions} /></Section>
          )}
        </div>
      )}

      {/* Net gain banner */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: r.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide opacity-90">Total des gains de la période</p>
          <p className="text-xs opacity-75 mt-1">
            Ventes {money(r.salesTotal)} − coût des marchandises {money(r.cogs)} = marge {money(r.grossMargin)}
            {' '}− dépenses − salaires − destructions − pertes
          </p>
          {r.returns.length > 0 && (
            <p className="text-xs opacity-75 mt-1">
              {r.counts.returns} vente(s) annulée(s) ({money(r.returnsTotal)}) sont exclues de ce calcul :
              la marchandise est revenue en stock et {money(r.refundedTotal)} ont été rendus aux clients.
            </p>
          )}
        </div>
        <p className="text-4xl font-black tabular-nums">{money(r.netGain)}</p>
      </motion.div>

      {/* Drill-down modal */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} size="2xl"
        title={detail ? modalTitle[detail] : ''} subtitle={`${r.label} — ${fmtDate(r.from)} → ${fmtDate(r.to)}`}>
        <AnimatePresence mode="wait">
          <motion.div key={detail || 'x'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-h-[65vh] overflow-y-auto custom-scrollbar -mx-2 px-2">
            {detail === 'sales' && <SalesTable rows={r.sales} />}
            {detail === 'purchases' && <PurchasesTable rows={r.purchases} />}
            {detail === 'gains' && <ProductGainTable rows={r.salesByProduct} />}
            {detail === 'gain' && <GainBreakdown report={r} />}
            {detail === 'expenses' && <ExpenseTable rows={r.expenses} />}
            {detail === 'clientDebts' && <DebtTable rows={r.clientDebts} tone="client" />}
            {detail === 'supplierDebts' && <DebtTable rows={r.supplierDebts} tone="supplier" />}
            {detail === 'stock' && <StockAlertTable rows={r.stockAlerts} />}
            {detail === 'stockValue' && <StockValueTable rows={r.stockLines} total={r.stockValue} />}
            {detail === 'expiry' && <ExpiryTable rows={r.expiryAlerts} />}
            {detail === 'workers' && <WorkerTable rows={r.workers} />}
            {detail === 'destructions' && <DestructionTable rows={r.destructions} />}
            {detail === 'returns' && <ReturnTable rows={r.returns} />}
            {detail === 'caisse' && <CaisseTable rows={r.caisseMovements} balance={r.caisseBalance} flow={r.caisseFlow} />}
            {detail === 'brigades' && <FuelBrigadeTable rows={r.fuelBrigades} />}
            {detail === 'clientPayments' && <ClientPaymentsTable rows={r.clientPayments} />}
            {detail === 'clientCash' && <ClientPaymentsTable rows={cashPayments} />}
            {detail === 'serviceWorks' && <ServiceWorksPanel workers={crew} from={r.from} to={r.to} />}
          </motion.div>
        </AnimatePresence>
      </Modal>
    </div>
  );
}
