/**
 * ─── Shared UI kit for the business-module pages ───────────────────────────────
 * Thin wrappers over the app's existing CSS component classes (index.css) so all
 * new Restaurant / Cafétéria / Lavage / Magasin screens stay visually identical
 * to the rest of StationPro. Hardcoded French labels are auto-translated to
 * Arabic at runtime (see lib/autoTranslate.ts).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, LayoutGrid, List, Inbox, Eye, Edit2, Trash2, Plus } from 'lucide-react';
import { cn, formatCurrency, formatDate, formatDateTime, formatTime } from '@/src/lib/utils';
import { within } from '@/src/lib/period';

/**
 * Renders a dialog straight into <body>.
 *
 * Every page wrapper is a potential trap for a `position: fixed` overlay: an
 * ancestor carrying a transform, a filter or — as on the pages using
 * `animate-fade-in` — a CSS animation on `opacity` establishes a stacking
 * context, and the dialog inside it can no longer rise above the sidebar
 * (z-50) no matter how high its own z-index is. Escaping to <body> is the only
 * fix that does not depend on what the page above happens to do.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export { formatCurrency, formatDate, formatDateTime, formatTime };
export const money = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);

// ─── PageHeader ──────────────────────────────────────────────────────────────
export function PageHeader({
  icon: Icon, title, subtitle, actions,
}: { icon: React.ElementType; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <Icon className="w-5 h-5 text-[#FFB800]" />
        </div>
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────
export function StatCard({
  icon: Icon, label, value, sub, tone = 'blue', onClick,
}: { icon?: React.ElementType; label: string; value: React.ReactNode; sub?: string; tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate'; onClick?: () => void }) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-yellow-500',
    red: 'from-red-500 to-red-600',
    purple: 'from-purple-500 to-purple-600',
    slate: 'from-slate-500 to-slate-600',
  };
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br text-white', tones[tone])}>
            <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
          </div>
        )}
      </div>
      <div className="text-2xl font-black text-[#002d87] tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-xs text-slate-400 font-medium">{sub}</div>}
    </>
  );
  // Une carte qui FILTRE la liste se clique : c'est alors un vrai bouton — au
  // clavier comme à la souris — et non un bloc décoré qui réagit en silence.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="stat-card w-full text-left cursor-pointer">
        {body}
      </button>
    );
  }
  return <div className="stat-card">{body}</div>;
}

// ─── Badge ───────────────────────────────────────────────────────────────────
export function Badge({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'yellow'; children: React.ReactNode; key?: React.Key }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

// ─── Modal ───────────────────────────────────────────────────────────────────
const modalSizes: Record<string, string> = {
  sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl',
  // Large workspace for the data-entry forms (achats, ventes…): same width as
  // the « Nouvelle Brigade » assistant, which is the reference for these screens.
  '3xl': 'max-w-5xl',
};
export function Modal({
  open, onClose, title, subtitle, icon: Icon, size = 'md', formScale, fullHeight, zClass, children, footer,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; icon?: React.ElementType;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  /**
   * Plan de superposition. Une boîte ouverte PAR-DESSUS une autre doit passer
   * au-dessus d'elle : les écrans historiques montent jusqu'à `z-[80]`, donc un
   * dialogue lancé depuis l'un d'eux doit le dire ici, sinon il s'ouvre derrière
   * et paraît ne pas répondre.
   */
  zClass?: string;
  /**
   * Long data-entry workspaces (achats, ventes…) opt into the larger control
   * scale: taller inputs, bigger labels and full-width actions on a phone.
   */
  formScale?: boolean;
  /**
   * Always fill the available height, like the « Nouvelle Brigade » assistant:
   * header and footer stay put and only the body scrolls. Without it the dialog
   * hugs its content.
   */
  fullHeight?: boolean;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  // Same shell, same backdrop and same entrance as the « Nouvelle Brigade »
  // assistant: a transparent scroll layer, a blurred backdrop pinned to the
  // viewport, and the box fading in while it scales up from 0.95.
  return (
    <ModalPortal>
    <AnimatePresence>
      {open && (
        <div className={cn('modal-shell', zClass || 'z-[60]')}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn('modal-box relative z-10', modalSizes[size], formScale && 'modal-form-lg', fullHeight && 'modal-box-full')}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                {Icon && (
                  <div className="modal-title-icon">
                    <Icon className="w-4 h-4" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className={cn('modal-title font-black truncate', formScale ? 'text-base sm:text-lg' : 'text-base')}>{title}</h3>
                  {subtitle && <p className="modal-subtitle text-xs truncate">{subtitle}</p>}
                </div>
              </div>
              <button onClick={onClose} className="modal-close" aria-label="Fermer">
                <X className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
              </button>
            </div>
            <div className={cn('modal-body', formScale ? 'p-3 sm:p-5 lg:p-6' : 'p-4 sm:p-6')}>{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    </ModalPortal>
  );
}

// ─── FormSection ─────────────────────────────────────────────────────────────
/**
 * Numbered block of a long data-entry form (achats, ventes…). The step number,
 * the title and the optional right-hand action always sit on the same line so a
 * wide modal still reads top-to-bottom.
 */
export function FormSection({
  step, icon: Icon, title, hint, action, children,
}: {
  step?: number; icon?: React.ElementType; title: string; hint?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* On a phone the action drops under the title instead of squeezing it. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 sm:py-3.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
        {step !== undefined && (
          <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0 shadow-sm">
            {step}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h4 className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#002d87] flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 shrink-0" />} <span className="truncate">{title}</span>
          </h4>
          {hint && <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">{hint}</p>}
        </div>
        {action && <div className="shrink-0 w-full sm:w-auto">{action}</div>}
      </header>
      <div className="p-3 sm:p-5">{children}</div>
    </section>
  );
}

/**
 * Read-only twin of an Input: a computed value (total de ligne, reste à payer…)
 * that must line up with the fields next to it.
 */
export function StaticField({ children, tone = 'neutral', className }: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'danger' | 'primary';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: '',
    primary: 'bg-[#eef3fc] border-[#003087]/20 text-[#002d87]',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-600',
    danger: 'bg-red-50 border-red-200 text-red-600',
  };
  return <div className={cn('field-static', tones[tone], className)}>{children}</div>;
}

// ─── ConfirmDialog ───────────────────────────────────────────────────────────
export function Confirm({
  open, title, message, onConfirm, onCancel, confirmLabel = 'Supprimer', danger = true,
}: { open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean }) {
  if (!open) return null;
  return (
    <ModalPortal>
    <div className="modal-shell" style={{ zIndex: 70 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        onClick={onCancel} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="modal-box max-w-sm relative z-10" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center mb-4', danger ? 'bg-red-100' : 'bg-amber-100')}>
            <Trash2 className={cn('w-6 h-6', danger ? 'text-red-600' : 'text-amber-600')} />
          </div>
          <h3 className="text-base font-black text-[#002d87] mb-2">{title}</h3>
          {/* `whitespace-pre-line`: a message may spell out its consequences on
              several lines (e.g. the cuve levels an achat rollback will restore). */}
          <p className="text-sm text-slate-500 whitespace-pre-line">{message}</p>
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button onClick={onCancel} className="btn-ghost flex-1">Annuler</button>
          <button onClick={onConfirm}
            className={cn('flex-1 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all text-white',
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600')}>
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
    </ModalPortal>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────
export function Field({ label, required, children, hint }: { label?: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      {label && <label className="label-field">{label}{required && <span className="text-red-500"> *</span>}</label>}
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => <input ref={ref} {...props} className={cn('input-field', props.className)} />,
);
Input.displayName = 'Input';

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input-field', props.className)} rows={props.rows ?? 3} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return <select {...props} className={cn('input-field', props.className)}>{props.children}</select>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2.5 select-none">
      <span className={cn('w-10 h-6 rounded-full transition-colors relative shrink-0', checked ? 'bg-[#003087]' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label && <span className="text-sm font-semibold text-slate-600">{label}</span>}
    </button>
  );
}

// ─── SearchInput ─────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder = 'Rechercher…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 min-w-[200px]">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="input-field pl-9" />
    </div>
  );
}

// ─── View toggle (grid / table) ──────────────────────────────────────────────
export function ViewToggle({ view, onChange }: { view: 'grid' | 'table'; onChange: (v: 'grid' | 'table') => void }) {
  return (
    <div className="tab-bar">
      <button className={cn('tab-item flex items-center gap-1.5', view === 'grid' && 'tab-item-active')} onClick={() => onChange('grid')}>
        <LayoutGrid className="w-4 h-4" /> Cartes
      </button>
      <button className={cn('tab-item flex items-center gap-1.5', view === 'table' && 'tab-item-active')} onClick={() => onChange('table')}>
        <List className="w-4 h-4" /> Tableau
      </button>
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; icon?: React.ElementType }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tab-bar overflow-x-auto custom-scrollbar">
      {tabs.map(tb => {
        const Icon = tb.icon;
        return (
          <button key={tb.id} className={cn('tab-item flex items-center gap-1.5', active === tb.id && 'tab-item-active')} onClick={() => onChange(tb.id)}>
            {Icon && <Icon className="w-4 h-4" />} {tb.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon = Inbox, title, message, action }: { icon?: React.ElementType; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="card-glass p-12 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="text-base font-black text-slate-700">{title}</h3>
      {message && <p className="text-sm text-slate-400 mt-1 max-w-sm">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Row action buttons ──────────────────────────────────────────────────────
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}
export function ActionBtn({
  icon: Icon, tone = 'slate', title, onClick, disabled,
}: {
  icon: React.ElementType; tone?: 'slate' | 'blue' | 'green' | 'red' | 'amber'; title: string;
  onClick: () => void;
  /** Une action momentanément impossible reste VISIBLE : le `title` dit pourquoi. */
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    blue: 'text-blue-600 hover:bg-blue-50',
    green: 'text-emerald-600 hover:bg-emerald-50',
    red: 'text-red-600 hover:bg-red-50',
    amber: 'text-amber-600 hover:bg-amber-50',
  };
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
        disabled ? 'text-slate-300 cursor-not-allowed' : tones[tone])}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

export { Eye, Edit2, Trash2, Plus };

// ─── Card grid wrapper ───────────────────────────────────────────────────────
export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{children}</div>;
}

// ─── Animated card ───────────────────────────────────────────────────────────
export function GlassCard({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void; key?: React.Key }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('card-glass p-4', onClick && 'cursor-pointer card-hover', className)}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

// ─── Table shell ─────────────────────────────────────────────────────────────
export function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card-glass overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead><tr>{head}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Date-period filter helper ───────────────────────────────────────────────
export type Period = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';

/**
 * ─── LA FENÊTRE DE DATES D'UNE PÉRIODE, ÉCRITE UNE SEULE FOIS ───────────────
 *
 * Le filtre de période d'un écran (`inPeriod`) et les moteurs de calcul, qui
 * prennent une fenêtre `from`/`to` (`computeModuleReport`, `computeWorkforce`),
 * lisaient la même période de deux façons différentes. Un écran pouvait donc
 * lister les mouvements d'un mois en affichant au-dessus les totaux d'un autre.
 *
 * `periodRange` rend cette fenêtre sous la forme que les rapports attendent —
 * des dates `AAAA-MM-JJ`, une borne vide valant « pas de limite de ce côté ».
 * `inPeriod` s'en sert lui aussi : une seule définition, deux usages.
 *
 * Les périodes relatives (semaine, mois, année) n'ont volontairement PAS de
 * borne haute : une pièce datée de demain reste visible plutôt que de
 * disparaître sans explication.
 */
export function periodRange(period: Period, from?: string, to?: string): { from: string; to: string } {
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const now = new Date();
  const since = (apply: (d: Date) => void) => { const d = new Date(now); apply(d); return { from: iso(d), to: '' }; };
  switch (period) {
    case 'today': return { from: iso(now), to: iso(now) };
    case 'week': return since(d => d.setDate(now.getDate() - 7));
    case 'month': return since(d => d.setMonth(now.getMonth() - 1));
    case 'year': return since(d => d.setFullYear(now.getFullYear() - 1));
    case 'custom': return { from: from || '', to: to || '' };
    default: return { from: '', to: '' };
  }
}

export function inPeriod(dateStr: string, period: Period, from?: string, to?: string): boolean {
  // Une date illisible ne se laisse pas filtrer : la ligne reste visible plutôt
  // que de disparaître sans que rien ne le dise.
  if (isNaN(new Date(dateStr).getTime())) return true;
  const r = periodRange(period, from, to);
  return within(dateStr, r.from, r.to);
}

export function PeriodFilter({ period, onChange, from, to, onFrom, onTo }: {
  period: Period; onChange: (p: Period) => void; from?: string; to?: string; onFrom?: (v: string) => void; onTo?: (v: string) => void;
}) {
  const opts: { id: Period; label: string }[] = [
    { id: 'all', label: 'Tout' }, { id: 'today', label: "Aujourd'hui" }, { id: 'week', label: 'Cette semaine' },
    { id: 'month', label: 'Ce mois' }, { id: 'year', label: 'Cette année' }, { id: 'custom', label: 'Période' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {opts.map(o => (
          <button key={o.id} onClick={() => onChange(o.id)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              period === o.id ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
            {o.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={from || ''} onChange={e => onFrom?.(e.target.value)} className="input-field !py-1.5 !w-auto text-xs" />
          <span className="text-slate-400 text-xs">→</span>
          <input type="date" value={to || ''} onChange={e => onTo?.(e.target.value)} className="input-field !py-1.5 !w-auto text-xs" />
        </div>
      )}
    </div>
  );
}

// ─── Small inline mini-manager for categories / marques / roles ──────────────
export function InlineCreate({ placeholder, onCreate }: { placeholder: string; onCreate: (name: string) => void }) {
  const [val, setVal] = React.useState('');
  return (
    <div className="flex gap-2">
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder} className="input-field !py-2 text-sm" />
      <button type="button" onClick={() => { if (val.trim()) { onCreate(val.trim()); setVal(''); } }}
        className="btn-secondary !px-3 shrink-0"><Plus className="w-4 h-4" /></button>
    </div>
  );
}
