/**
 * ─── Rappel « Rendez-vous de paiement » (haut du tableau de bord) ──────────────
 * Bandeau affiché en haut du tableau de bord dès qu'un achat carburant porte un
 * rendez-vous de paiement non réglé : retards en premier, puis aujourd'hui, puis
 * les échéances des prochains jours. Il disparaît de lui-même dès que la dette
 * est soldée (voir `appointmentOf`).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  BellRing, CalendarClock, ChevronDown, ChevronUp, ArrowRight, AlertTriangle, Wallet,
} from 'lucide-react';
import { cn, formatCurrency } from '@/src/lib/utils';
import { Purchase, Supplier } from '../store/AppContext';
import { pendingAppointments, PaymentAppointment } from '../lib/paymentAppointments';

const fmtDay = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString('fr-DZ', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

/** Colours of one row, by urgency. */
const ROW_TONE: Record<string, { bg: string; text: string; badge: string }> = {
  overdue: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', badge: 'bg-red-600 text-white' },
  today: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', badge: 'bg-amber-500 text-white' },
  soon: { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800', badge: 'bg-yellow-400 text-yellow-900' },
  later: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', badge: 'bg-blue-500 text-white' },
};

export default function PaymentAppointmentsBanner({
  purchases, suppliers,
}: { purchases: Purchase[]; suppliers: Supplier[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  const appts = useMemo(() => pendingAppointments(purchases), [purchases]);

  if (appts.length === 0) return null;

  const overdue = appts.filter(a => a.urgency === 'overdue');
  const today = appts.filter(a => a.urgency === 'today');
  const totalDue = appts.reduce((s, a) => s + a.amount, 0);
  // The banner takes the colour of its most urgent line.
  const worst = overdue.length ? 'overdue' : today.length ? 'today' : appts[0].urgency;

  const headline = overdue.length
    ? `${overdue.length} paiement${overdue.length > 1 ? 's' : ''} fournisseur en retard`
    : today.length
      ? `${today.length} paiement${today.length > 1 ? 's' : ''} fournisseur à régler aujourd'hui`
      : `${appts.length} rendez-vous de paiement à venir`;

  const supplierName = (id?: string) => suppliers.find(s => s.id === id)?.name || 'Fournisseur';

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-3xl overflow-hidden shadow-xl border"
      style={{
        borderColor: worst === 'overdue' ? 'rgba(220,38,38,0.35)' : 'rgba(255,184,0,0.35)',
        background: worst === 'overdue'
          ? 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 45%,#b91c1c 100%)'
          : 'linear-gradient(135deg,#001233 0%,#001f5c 45%,#003087 100%)',
      }}
    >
      {/* Header */}
      <div className="px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
          style={{ background: worst === 'overdue' ? 'rgba(255,255,255,0.15)' : 'linear-gradient(135deg,#FFB800,#e6a000)' }}>
          {worst === 'overdue'
            ? <AlertTriangle className="w-6 h-6 text-white" />
            : <BellRing className="w-6 h-6 text-[#001f5c]" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">
            Rendez-vous de paiement — Achats carburant
          </p>
          <p className="text-lg font-black text-white leading-tight italic">{headline}</p>
          <p className="text-[11px] text-white/60 font-semibold mt-0.5">
            {appts.length} échéance{appts.length > 1 ? 's' : ''} · total attendu{' '}
            <span className="text-[#FFB800] font-black">{formatCurrency(totalDue)}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate('/fuel-purchases')}
            className="h-11 px-5 rounded-2xl flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] bg-white/10 hover:bg-white/20 text-white transition-all border border-white/20"
          >
            <Wallet className="w-4 h-4" style={{ color: '#FFB800' }} /> Régler
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Réduire' : 'Afficher le détail'}
            className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-all border border-white/20"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Detail list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {appts.map((a: PaymentAppointment) => {
                const tone = ROW_TONE[a.urgency];
                return (
                  <button
                    key={a.purchaseId}
                    onClick={() => navigate('/fuel-purchases')}
                    className={cn('w-full text-left rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-3 transition-all hover:shadow-md', tone.bg)}
                  >
                    <span className={cn('text-[10px] font-black uppercase px-2.5 py-1 rounded-full shrink-0', tone.badge)}>
                      {a.daysLeft < 0
                        ? `Retard ${Math.abs(a.daysLeft)} j`
                        : a.daysLeft === 0 ? "Aujourd'hui"
                          : a.daysLeft === 1 ? 'Demain' : `Dans ${a.daysLeft} j`}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-800 text-sm truncate">
                        {supplierName(a.supplierId)}
                        {a.invoiceNumber ? <span className="text-slate-400 font-bold"> · Facture {a.invoiceNumber}</span> : null}
                        {!a.invoiceNumber && a.blNumber ? <span className="text-slate-400 font-bold"> · BL {a.blNumber}</span> : null}
                      </p>
                      <p className={cn('text-[11px] font-semibold flex items-center gap-1.5 flex-wrap', tone.text)}>
                        <CalendarClock className="w-3 h-3 shrink-0" /> {fmtDay(a.date)}
                        {a.rest !== a.amount && (
                          <span className="text-slate-400">· reste dû {formatCurrency(a.rest)}</span>
                        )}
                        {a.notes && <span className="text-slate-500 truncate">· {a.notes}</span>}
                      </p>
                    </div>

                    <p className="font-black tabular-nums text-[#002d87] text-lg shrink-0">{formatCurrency(a.amount)}</p>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                );
              })}
              <p className="text-[10px] text-white/45 font-semibold px-1 pt-1">
                Le rappel disparaît automatiquement dès que la dette de l'achat est soldée.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
