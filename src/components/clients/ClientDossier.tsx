/**
 * ─── Le dossier d'un client ────────────────────────────────────────────────────
 *
 * UN seul écran pour les trois activités — Carburant, Cafétéria, Lavage &
 * Réparation. « Voir détails » et « Historique » n'ouvrent plus deux boîtes
 * différentes : ils ouvrent le MÊME dossier, à une rubrique différente.
 *
 * Ce qu'il montre, rubrique par rubrique :
 *
 *   Vue d'ensemble  — les soldes, ce qui les explique, et ce qui cloche ;
 *   Journal         — TOUTES les opérations du compte, avec le solde après
 *                     chacune, le détail article par article et les filtres ;
 *   Achats          — les documents seuls, dépliés sur leurs lignes ;
 *   Règlements      — l'argent encaissé, daté, par mode, avec ses reçus ;
 *   Avance          — les dépôts ET ce qui les a consommés ;
 *   Fiche           — l'identité complète et la fiscalité.
 *
 * La mise en page est celle des Paramètres : un panneau de navigation bleu nuit
 * à gauche, la rubrique à droite sous son bandeau. C'est la seule disposition de
 * l'application qui tient un contenu long sans le transformer en interminable
 * défilement — un compte client, justement, est long.
 *
 * Le composant ne sait RIEN de l'activité d'où vient le client : il lit un
 * `ClientStatement` (voir `lib/clientStatement.ts`), la forme commune aux trois.
 * Tout ce qui est propre à une activité — recharger une avance, régler une
 * dette, programmer un rendez-vous — lui est passé en paramètre.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, ChevronRight, ChevronDown, Receipt, Wallet, CreditCard,
  FileBarChart, Printer, IdCard, LayoutDashboard, History, ShoppingBag,
  AlertTriangle, TrendingUp, CircleDollarSign, CalendarRange,
  Package, ArrowUpRight, ArrowDownRight, Info, Pencil, Trash2, Flag,
} from 'lucide-react';
import { cn, matchesSearch } from '@/src/lib/utils';
import { money } from '@/src/components/biz/Kit';
import {
  ClientStatement, StatementLine, StatementPayment, StatementKind, KIND_COLOR, KIND_LABEL,
} from '@/src/lib/clientStatement';

// ─── Types de l'API du dossier ────────────────────────────────────────────────

export interface DossierRow {
  label: string;
  value?: React.ReactNode;
  /** Une ligne vide reste affichée : « non renseigné » est une information. */
  hint?: string;
}

export interface DossierGroup {
  title: string;
  icon?: React.ElementType;
  rows: DossierRow[];
}

export interface DossierSection {
  id: string;
  label: string;
  icon: React.ElementType;
  /** Compteur affiché à droite de l'entrée de navigation. */
  count?: number;
  /** Sous-titre du bandeau de la rubrique. */
  hint?: string;
  render: () => React.ReactNode;
}

/**
 * L'OUVERTURE du compte, telle que le dossier doit la montrer et la laisser
 * corriger. Elle n'est pas une vente : c'est ce que le client devait déjà (ou
 * avait déjà versé) le jour où sa fiche a été créée.
 */
export interface DossierOpening {
  /** Dette de reprise saisie à la création. */
  debt: number;
  /** Premier versement d'avance. */
  advance: number;
  date: string;
  notes?: string;
  /** Ce qui a déjà été réglé sur cette dette de reprise. */
  paid?: number;
  /** Reprendre l'écart fiche / pièces en dette initiale, d'un clic. */
  onAdopt?: () => void;
  onEdit?: () => void;
}

export interface DossierAdvance {
  /** Ce qu'il reste sur le compte d'avance. */
  available: number;
  recharged: number;
  used: number;
  /** Écart entre deux compteurs d'avance qui ne s'accordent pas encore. */
  gap?: number;
  onRecharge?: () => void;
}

export interface ClientDossierProps {
  open: boolean;
  onClose: () => void;
  /** Le compte ENTIER du client — sans bornes de période. */
  statement: ClientStatement;
  /** Chips affichées sous le nom (type, mode de règlement…). */
  badges?: React.ReactNode;
  /** Les blocs d'identité de la rubrique « Fiche ». */
  identity?: DossierGroup[];
  /** L'encours que porte la fiche client, quand l'activité en tient un. */
  recordedDebt?: number;
  /** Plafond de crédit accordé, pour le signaler quand il est dépassé. */
  creditLimit?: number;
  advance?: DossierAdvance;
  /** Ce que le compte portait à son ouverture, et de quoi le corriger. */
  opening?: DossierOpening;
  /** Corriger un règlement de l'historique. */
  onEditPayment?: (payment: StatementPayment) => void;
  /** Supprimer un règlement de l'historique. */
  onDeletePayment?: (payment: StatementPayment) => void;
  /** Réimprimer le reçu d'un règlement. */
  onPrintPayment?: (payment: StatementPayment) => void;
  /** Rubriques propres à l'activité (rendez-vous de paiement…). */
  extraSections?: DossierSection[];
  initialSection?: string;
  onPayDebt?: () => void;
  /** Régler une opération précise du journal. */
  onSettleLine?: (line: StatementLine) => void;
  /** Imprimer le reçu d'un règlement du journal. */
  onPrintReceipt?: (line: StatementLine) => void;
  onReport?: () => void;
  onPrintStatement?: () => void;
  /** Plan de superposition — au-dessus des écrans qui montent déjà haut. */
  zClass?: string;
  /** La feuille A4 hors écran, quand l'appelant en fournit une. */
  children?: React.ReactNode;
  /** `@types/react` absent : le `key` doit être déclaré pour être accepté. */
  key?: React.Key;
}

// ─── Petites briques ──────────────────────────────────────────────────────────

/**
 * Une date de tableau. Une date vide ou illisible se dit « — » : `formatDate`
 * rendait « Invalid Date » en toutes lettres au milieu du journal, ce qui donne
 * l'air d'un bug là où il n'y a qu'une pièce sans date.
 */
const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

const monthKey = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (key: string) => {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Une tuile de chiffre — le vocabulaire visuel des Paramètres. */
function Tile({
  icon: Icon, label, value, sub, tone = 'blue', accent,
}: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: 'blue' | 'green' | 'red' | 'amber' | 'slate'; accent?: boolean;
}) {
  const tones: Record<string, { chip: string; text: string; ring: string }> = {
    blue: { chip: 'from-[#001f5c] to-[#003087]', text: 'text-[#002d87]', ring: 'border-blue-100' },
    green: { chip: 'from-emerald-500 to-emerald-600', text: 'text-emerald-600', ring: 'border-emerald-100' },
    red: { chip: 'from-red-500 to-red-600', text: 'text-red-600', ring: 'border-red-100' },
    amber: { chip: 'from-amber-500 to-yellow-500', text: 'text-amber-600', ring: 'border-amber-100' },
    slate: { chip: 'from-slate-400 to-slate-500', text: 'text-slate-600', ring: 'border-slate-100' },
  };
  const t = tones[tone];
  return (
    <div className={cn('rounded-2xl border bg-white p-4 shadow-sm', t.ring, accent && 'ring-2 ring-offset-1 ring-amber-200')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 leading-tight">{label}</p>
        <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br text-white flex items-center justify-center shrink-0', t.chip)}>
          <Icon style={{ width: 15, height: 15 }} />
        </div>
      </div>
      <p className={cn('text-xl font-black tabular-nums leading-tight mt-1.5', t.text)}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-semibold mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

/** L'en-tête encadré d'un tableau ou d'un bloc de la rubrique. */
function Block({
  icon: Icon, title, hint, action, children, tone = 'blue',
}: {
  icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode;
  children: React.ReactNode; tone?: 'blue' | 'green' | 'amber';
  // `@types/react` n'est pas installé : sans cette ligne, TypeScript refuse le
  // `key` que réclame pourtant toute liste JSX (même remarque dans `Kit.tsx`).
  key?: React.Key;
}) {
  const tones: Record<string, string> = {
    blue: 'text-[#002d87]', green: 'text-emerald-600', amber: 'text-amber-600',
  };
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
        <Icon className={cn('w-4 h-4 shrink-0', tones[tone])} />
        <div className="min-w-0 flex-1">
          <h4 className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-[#002d87] truncate">{title}</h4>
          {hint && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function Empty({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="p-10 flex flex-col items-center justify-center text-center gap-2">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-300" />
      </div>
      <p className="text-xs font-bold text-slate-400">{message}</p>
    </div>
  );
}

/** Le détail article par article d'un document, replié sous sa ligne. */
function ItemTable({ items }: { items: NonNullable<StatementLine['items']> }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-[9px] font-black uppercase tracking-wider text-slate-400">
          <th className="py-1.5 text-left">Désignation</th>
          <th className="py-1.5 text-right">Quantité</th>
          <th className="py-1.5 text-right">P.U.</th>
          <th className="py-1.5 text-right">Montant</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i} className="border-t border-slate-200/70">
            <td className="py-1.5 pr-2 font-semibold text-slate-600">{it.name}</td>
            <td className="py-1.5 text-right tabular-nums text-slate-500 whitespace-nowrap">
              {it.qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}{it.unit ? ` ${it.unit}` : ''}
            </td>
            <td className="py-1.5 text-right tabular-nums text-slate-500 whitespace-nowrap">{money(it.unitPrice)}</td>
            <td className="py-1.5 text-right tabular-nums font-bold text-slate-700 whitespace-nowrap">{money(it.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Le dossier ───────────────────────────────────────────────────────────────

export default function ClientDossier(props: ClientDossierProps) {
  const {
    open, onClose, statement: st, badges, identity = [], recordedDebt, creditLimit,
    advance, opening, extraSections = [], initialSection = 'resume',
    onPayDebt, onSettleLine, onPrintReceipt, onReport, onPrintStatement,
    onEditPayment, onDeletePayment, onPrintPayment,
    zClass = 'z-[90]', children,
  } = props;

  const [section, setSection] = useState(initialSection);
  const [kindFilter, setKindFilter] = useState<'all' | StatementKind>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // La rubrique demandée change quand on rouvre le dossier depuis un autre
  // bouton : « Historique » doit tomber sur le journal même si la dernière
  // visite s'était terminée sur la fiche.
  React.useEffect(() => { if (open) setSection(initialSection); }, [open, initialSection]);

  const lines = st.allLines;

  /**
   * Le solde de la dette APRÈS chaque opération.
   *
   * Un journal qui n'aligne que des montants ne se vérifie pas : il faut voir la
   * dette monter puis redescendre pour savoir d'où vient le reste dû. On remonte
   * donc le compte de la plus ancienne à la plus récente, puis on rend la table
   * dans l'ordre d'affichage.
   */
  const runningDebt = useMemo(() => {
    const out: Record<string, number> = {};
    let acc = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      acc += lines[i].debtEffect;
      out[lines[i].id] = acc;
    }
    return out;
  }, [lines]);

  /** Les natures réellement présentes au compte — pas un menu de cases vides. */
  const kinds = useMemo(() => {
    const seen = new Map<StatementKind, number>();
    for (const l of lines) seen.set(l.kind, (seen.get(l.kind) || 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [lines]);

  const visible = useMemo(() => lines.filter(l => {
    if (kindFilter !== 'all' && l.kind !== kindFilter) return false;
    return matchesSearch(query, l.label, l.ref, l.kindLabel, l.status, l.notes, l.mode, l.reference, l.qtyLabel);
  }), [lines, kindFilter, query]);

  /**
   * Les documents seuls — ce que le client a effectivement pris. Ni un
   * règlement, ni une recharge, ni une AVANCE de reprise : aucun des trois ne
   * sort de marchandise, et la rubrique « Achats » les comptait pourtant.
   */
  const documents = useMemo(
    () => lines.filter(l => l.kind !== 'reglement' && l.kind !== 'recharge' && l.kind !== 'avance'),
    [lines]);

  const payments = st.payments;

  /** Mois par mois : consommé, encaissé, et le mouvement net de la dette. */
  const byMonth = useMemo(() => {
    const map = new Map<string, { charged: number; paid: number; debt: number; count: number }>();
    for (const l of lines) {
      const k = monthKey(l.date);
      if (!k) continue;
      const cur = map.get(k) || { charged: 0, paid: 0, debt: 0, count: 0 };
      cur.charged += l.charged; cur.paid += l.paid; cur.debt += l.debtEffect; cur.count += 1;
      map.set(k, cur);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [lines]);

  const advanceMoves = useMemo(() => lines.filter(l => l.advanceEffect !== 0), [lines]);

  /**
   * Ce que le client a pris, article par article, tous documents confondus.
   *
   * Le journal dit combien il a dépensé ; celui-ci dit EN QUOI. C'est la seule
   * lecture qui répond à « combien de gasoil ce transporteur nous prend-il par
   * mois » sans rouvrir chaque bon un par un.
   */
  const byItem = useMemo(() => {
    const map = new Map<string, { name: string; unit?: string; qty: number; total: number; count: number }>();
    for (const l of documents) {
      for (const it of (l.items || [])) {
        const key = `${it.name}|${it.unit || ''}`;
        const cur = map.get(key) || { name: it.name, unit: it.unit, qty: 0, total: 0, count: 0 };
        cur.qty += it.qty; cur.total += it.total; cur.count += 1;
        map.set(key, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [documents]);

  const debtFromDocs = st.closingDebt;
  /**
   * ─── Ce que le client doit VRAIMENT ─────────────────────────────────────
   *
   * Le dossier affichait la dette brute et l'avance dans deux tuiles voisines
   * qui ne se parlaient pas : un client repris avec 20 000 DA d'avance et
   * 5 000 DA de factures ouvertes s'annonçait « débiteur de 5 000 » alors que
   * la station tenait déjà son argent. On lui réclamait ce qu'il avait payé.
   */
  const advanceHeld = Math.max(0, st.advanceHeld || 0);
  const netDebt = Math.max(0, st.netDebt ?? Math.max(0, debtFromDocs - advanceHeld));
  const advanceLeft = Math.max(0, st.advanceLeft ?? (advanceHeld - Math.min(advanceHeld, Math.max(0, debtFromDocs))));
  /** L'avance a-t-elle absorbé une partie de la dette ? */
  const advanceApplied = Math.max(0, advanceHeld - advanceLeft);
  const gap = recordedDebt === undefined ? 0 : recordedDebt - debtFromDocs;
  const overLimit = creditLimit !== undefined && creditLimit > 0 && netDebt > creditLimit;

  const toggle = (id: string) => setExpanded(o => ({ ...o, [id]: !o[id] }));

  /** Y a-t-il quoi que ce soit à faire sur une ligne de règlement ? */
  const hasPaymentActions = !!(onEditPayment || onDeletePayment || onPrintPayment);

  // ── Rubriques ───────────────────────────────────────────────────────────────

  /**
   * ─── L'ouverture du compte ──────────────────────────────────────────────────
   *
   * Le bloc qui manquait. Un client repris « avec 40 000 DA de dette » voyait
   * son dossier s'ouvrir sur un compte VIDE : le montant vivait dans une colonne
   * de sa fiche, et le journal — la seule source que les écrans lisent — ne le
   * connaissait pas. Il est maintenant une ligne du compte, et ce bloc la
   * montre pour ce qu'elle est : une reprise, pas une vente.
   */
  const openingBlock = () => {
    if (!opening) return null;
    const paid = Math.max(0, opening.paid || 0);
    const rest = Math.max(0, opening.debt - paid);
    const nothing = opening.debt <= 0 && opening.advance <= 0;
    return (
      <Block icon={Flag} title="Ouverture du compte" tone="amber"
        hint="Ce que le client devait — ou avait déjà versé — le jour de la reprise"
        action={opening.onEdit && (
          <button onClick={opening.onEdit}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> {nothing ? 'Saisir une reprise' : 'Modifier'}
          </button>
        )}>
        {nothing ? (
          <div className="px-5 py-5 flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-semibold text-slate-400 flex-1 min-w-[220px]">
              Aucune reprise enregistrée : ce compte est né à zéro. Si le client devait déjà
              quelque chose — ou avait déjà versé une avance — avant sa fiche, saisissez-le ici :
              le montant entrera dans son historique, sur sa carte et dans les rapports.
            </p>
            {opening.onAdopt && (
              <button onClick={opening.onAdopt}
                className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-black uppercase tracking-wider transition-all">
                Reprendre l'écart en dette initiale
              </button>
            )}
          </div>
        ) : (
          /* Les deux plateaux de la reprise, côte à côte. L'avance initiale
             n'avait qu'une demi-case, et seulement quand aucune date n'avait à
             s'afficher : un compte ouvert sur un versement se lisait donc comme
             un compte ouvert sur une ardoise, trois cellules à zéro en tête. */
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100">
            {opening.debt > 0 ? (<>
              <div className="bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Dette initiale</p>
                <p className="text-base font-black tabular-nums text-amber-600">{money(opening.debt)}</p>
              </div>
              <div className="bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Déjà réglé dessus</p>
                <p className="text-base font-black tabular-nums text-emerald-600">{money(paid)}</p>
              </div>
              <div className="bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Reste de la reprise</p>
                <p className={cn('text-base font-black tabular-nums', rest > 0 ? 'text-red-600' : 'text-slate-300')}>{money(rest)}</p>
              </div>
            </>) : null}
            {opening.advance > 0 && (
              <div className="bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Avance initiale</p>
                <p className="text-base font-black tabular-nums text-teal-600">{money(opening.advance)}</p>
                <p className="text-[10px] text-slate-400 font-semibold">portée au crédit du compte</p>
              </div>
            )}
            <div className="bg-white px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Date de reprise</p>
              <p className="text-base font-black tabular-nums text-[#002d87]">{shortDate(opening.date)}</p>
            </div>
            {opening.advance > 0 && (
              <div className="bg-white px-4 py-3 col-span-2 sm:col-span-4">
                <p className="text-[11px] font-semibold text-slate-500 leading-relaxed">
                  Cette avance a été versée AVANT l'ouverture de la fiche : elle n'entre dans aucune
                  caisse aujourd'hui — l'argent était déjà là. Elle est portée au crédit du compte,
                  {advanceApplied > 0
                    ? ` et ${money(advanceApplied)} en ont déjà été imputés sur ce que le client doit.`
                    : " et viendra en déduction de ce que le client prendra."}
                </p>
              </div>
            )}
            {opening.notes && (
              <div className="bg-white px-4 py-3 col-span-2 sm:col-span-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Note de reprise</p>
                <p className="text-[11px] font-semibold text-slate-600">{opening.notes}</p>
              </div>
            )}
          </div>
        )}
      </Block>
    );
  };

  /**
   * L'historique des règlements sur une feuille. Le dossier imprimait le relevé
   * ENTIER ou rien : personne ne pouvait sortir la seule liste des encaissements
   * d'un client — c'est pourtant le papier qu'on lui tend quand il conteste.
   */
  const printPayments = () => {
    const rows = payments.map(p => `
      <tr>
        <td>${shortDate(p.date)}</td>
        <td>${(p.label || 'Règlement').replace(/[<>]/g, '')}</td>
        <td>${(p.mode || '').replace(/[<>]/g, '')}</td>
        <td>${(p.reference || '—').replace(/[<>]/g, '')}</td>
        <td class="num">${money(p.amount)}</td>
      </tr>`).join('');
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Règlements — ${st.client.name}</title><style>
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;padding:28px;color:#0f172a}
      h1{font-size:18px;margin:0;color:#002d87;text-transform:uppercase;letter-spacing:.06em}
      h2{font-size:12px;margin:4px 0 18px;color:#64748b;font-weight:600}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#f1f5f9;text-align:left;padding:8px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#475569}
      td{padding:8px;border-bottom:1px solid #e2e8f0}
      .num{text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:#047857}
      tfoot td{border-top:2px solid #002d87;font-weight:900;padding-top:10px}
    </style></head><body>
      <h1>Historique des règlements — ${st.client.name}</h1>
      <h2>${st.partLabel} · ${payments.length} règlement(s) · édité le ${new Date().toLocaleDateString('fr-FR')}</h2>
      <table>
        <thead><tr><th>Date</th><th>Libellé</th><th>Mode</th><th>Référence</th><th style="text-align:right">Montant</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">Aucun règlement</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4">Total encaissé</td><td class="num">${money(st.totals.paid)}</td></tr></tfoot>
      </table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };


  const resume = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile icon={Receipt} label="Total consommé" value={money(st.totals.charged)}
          sub={`${st.totals.documents} document(s) — ${documents.length ? `du ${shortDate(documents[documents.length - 1].date)} à aujourd'hui` : 'aucun'}`} />
        <Tile icon={Wallet} label="Total encaissé" value={money(st.totals.paid)} tone="green"
          sub={`${payments.length} règlement(s)`} />
        <Tile icon={CircleDollarSign} label="Reste dû" value={money(netDebt)}
          tone={netDebt > 0 ? 'red' : 'green'}
          sub={advanceApplied > 0
            ? `${money(debtFromDocs)} dus − ${money(advanceApplied)} pris sur son avance`
            : debtFromDocs > 0 ? "d'après les pièces du compte" : 'compte soldé'} />
        {advance ? (
          <Tile icon={Wallet} label="Avance disponible" value={money(advance.available)} tone="amber"
            sub={`${money(advance.recharged)} déposés — ${money(advance.used)} consommés`} />
        ) : (
          <Tile icon={CalendarRange} label="Activité" value={`${lines.length} opération(s)`} tone="slate"
            sub={st.allLines.length
              ? `du ${shortDate(lines[lines.length - 1].date)} au ${shortDate(lines[0].date)}`
              : 'aucune opération'} />
        )}
      </div>

      {openingBlock()}

      {/* Ce qui mérite d'être signalé plutôt que laissé à deviner. */}
      {(Math.abs(gap) >= 1 || overLimit || (advance && Math.abs(advance.gap || 0) >= 1)) && (
        <div className="space-y-2.5">
          {Math.abs(gap) >= 1 && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] font-semibold text-amber-900 leading-relaxed">
                <span className="font-black uppercase tracking-wider block text-[10px] mb-0.5">
                  Encours enregistré différent des pièces
                </span>
                La fiche du client annonce <b>{money(recordedDebt || 0)}</b>, ses documents
                {' '}<b>{money(debtFromDocs)}</b> — soit {money(Math.abs(gap))} de {gap > 0 ? 'plus' : 'moins'}.
                Un solde de reprise saisi à l'ouverture du compte, ou une brigade corrigée après coup,
                explique généralement l'écart. Le reste dû affiché partout ailleurs est celui des pièces.
              </div>
            </div>
          )}
          {overLimit && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 border border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="text-[11px] font-semibold text-red-900 leading-relaxed">
                <span className="font-black uppercase tracking-wider block text-[10px] mb-0.5">Plafond de crédit dépassé</span>
                Le client doit {money(netDebt)} pour un plafond de {money(creditLimit || 0)} —
                {' '}{money(netDebt - (creditLimit || 0))} au-delà.
              </div>
            </div>
          )}
          {advance && Math.abs(advance.gap || 0) >= 1 && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] font-semibold text-amber-900 leading-relaxed">
                <span className="font-black uppercase tracking-wider block text-[10px] mb-0.5">Avance à recaler</span>
                Ce client a été enregistré du temps où l'avance vivait dans deux compteurs séparés :
                ils diffèrent encore de {money(Math.abs(advance.gap || 0))}. Une recharge ou une correction
                de la fiche les remet d'accord.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ce que la dette doit à chaque nature d'opération. */}
        <Block icon={Package} title="Répartition par nature"
          hint="Ce que chaque type d'opération a pesé sur le compte">
          {st.byKind.length === 0 ? <Empty icon={Package} message="Aucune opération" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 text-left">Nature</th>
                    <th className="px-4 py-2.5 text-right">Nb</th>
                    <th className="px-4 py-2.5 text-right">Consommé</th>
                    <th className="px-4 py-2.5 text-right">Payé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {st.byKind.map(k => (
                    <tr key={k.kind} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-black whitespace-nowrap" style={{ color: KIND_COLOR[k.kind] }}>{k.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 font-bold">{k.count}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold">{money(k.charged)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-600">{money(k.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>

        {/* Par quel moyen l'argent est réellement entré. */}
        <Block icon={CreditCard} title="Règlements par mode" tone="green"
          hint="Par quel moyen le client a payé">
          {st.byMode.length === 0 ? <Empty icon={CreditCard} message="Aucun règlement encaissé" /> : (
            <div className="p-4 space-y-2.5">
              {st.byMode.map(m => {
                const share = st.totals.paid > 0 ? (m.amount / st.totals.paid) * 100 : 0;
                return (
                  <div key={m.mode}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 truncate">{m.mode}</span>
                      <span className="text-[11px] font-black tabular-nums text-emerald-600 whitespace-nowrap">
                        {money(m.amount)} <span className="text-slate-300">· {m.count}×</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600"
                        style={{ width: `${Math.max(2, share)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Block>
      </div>

      {/* L'activité du compte, mois par mois. */}
      <Block icon={TrendingUp} title="Activité mois par mois"
        hint="Consommation, encaissements et mouvement de la dette">
        {byMonth.length === 0 ? <Empty icon={TrendingUp} message="Aucune activité enregistrée" /> : (
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 text-left">Mois</th>
                  <th className="px-4 py-2.5 text-right">Opérations</th>
                  <th className="px-4 py-2.5 text-right">Consommé</th>
                  <th className="px-4 py-2.5 text-right">Encaissé</th>
                  <th className="px-4 py-2.5 text-right">Dette</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byMonth.map(([k, v]) => (
                  <tr key={k} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-bold text-slate-600 capitalize whitespace-nowrap">{monthLabel(k)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 font-bold">{v.count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold">{money(v.charged)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-600">{money(v.paid)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums font-black whitespace-nowrap',
                      v.debt > 0 ? 'text-red-600' : v.debt < 0 ? 'text-emerald-600' : 'text-slate-300')}>
                      {v.debt === 0 ? '—' : `${v.debt > 0 ? '+' : '−'}${money(Math.abs(v.debt))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    </div>
  );

  const journal = () => (
    <div className="space-y-4">
      {/* La portée du journal est DITE : tout le compte, depuis son ouverture. */}
      <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-blue-50/60 border border-blue-100">
        <Info className="w-4 h-4 text-[#003087] shrink-0 mt-0.5" />
        <p className="text-[11px] font-semibold text-[#002d87] leading-relaxed">
          Le compte ENTIER, depuis sa première opération —
          {lines.length
            ? ` du ${shortDate(lines[lines.length - 1].date)} au ${shortDate(lines[0].date)}, ${lines.length} opération(s).`
            : ' aucune opération enregistrée pour l\'instant.'}
          {' '}La colonne <b>Solde</b> donne la dette juste après chaque ligne ; une ligne
          qui porte un détail se déplie d'un clic. Pour un document borné à une période, passez par le rapport.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-xs">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer le journal…"
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none text-[#002d87] focus:border-blue-200" />
        </div>
        <div className="flex bg-slate-100 rounded-xl p-1 flex-wrap gap-0.5">
          <button onClick={() => setKindFilter('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
              kindFilter === 'all' ? 'bg-white text-[#002d87] shadow-sm' : 'text-slate-400 hover:text-slate-600')}>
            Tout ({lines.length})
          </button>
          {kinds.map(([k, n]) => (
            <button key={k} onClick={() => setKindFilter(k)}
              className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap',
                kindFilter === k ? 'bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600')}
              style={kindFilter === k ? { color: KIND_COLOR[k] } : undefined}>
              {KIND_LABEL[k]} ({n})
            </button>
          ))}
        </div>
      </div>

      <Block icon={Receipt} title={`Journal des opérations (${visible.length})`}
        hint={visible.length !== lines.length ? `${lines.length - visible.length} opération(s) masquée(s) par le filtre` : undefined}>
        {visible.length === 0 ? (
          <Empty icon={Receipt} message={lines.length === 0
            ? 'Aucune opération enregistrée pour ce client'
            : 'Aucune opération ne correspond à ce filtre'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50">
                <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Nature</th>
                  <th className="px-3 py-2.5">Réf</th>
                  <th className="px-3 py-2.5">Désignation</th>
                  <th className="px-3 py-2.5 text-right">Débit</th>
                  <th className="px-3 py-2.5 text-right">Crédit</th>
                  <th className="px-3 py-2.5 text-right">Reste</th>
                  <th className="px-3 py-2.5 text-right">Solde</th>
                  {(onSettleLine || onPrintReceipt) && <th className="px-3 py-2.5 text-center">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(l => {
                  const detail = (l.items || []).length > 0;
                  const isOpen = !!expanded[l.id];
                  return (
                    <React.Fragment key={l.id}>
                      <tr className={cn('hover:bg-slate-50 transition-colors', detail && 'cursor-pointer')}
                        onClick={() => detail && toggle(l.id)}>
                        <td className="px-3 py-2.5 text-slate-300">
                          {detail && (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap font-medium">{shortDate(l.date)}</td>
                        <td className="px-3 py-2.5 font-black whitespace-nowrap" style={{ color: KIND_COLOR[l.kind] }}>{l.kindLabel}</td>
                        <td className="px-3 py-2.5 text-slate-400 font-bold whitespace-nowrap">{l.ref || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-[300px]">
                          <span className="block truncate font-semibold" title={l.label}>{l.label}</span>
                          {(l.qtyLabel || l.mode || l.status || l.reference || l.notes) && (
                            <span className="block text-[10px] text-slate-400 font-bold truncate">
                              {[l.qtyLabel, l.mode, l.status, l.reference, l.notes].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap">
                          {l.charged ? money(l.charged) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-600 whitespace-nowrap">
                          {l.paid ? money(l.paid) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-black text-red-600 whitespace-nowrap">
                          {l.rest ? money(l.rest) : '—'}
                        </td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums font-black whitespace-nowrap',
                          (runningDebt[l.id] || 0) > 0 ? 'text-red-500' : 'text-slate-300')}>
                          {money(runningDebt[l.id] || 0)}
                        </td>
                        {(onSettleLine || onPrintReceipt) && (
                          <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                            {l.kind === 'reglement' && onPrintReceipt ? (
                              <button onClick={() => onPrintReceipt(l)} title="Imprimer le reçu"
                                className="p-1.5 hover:bg-blue-50 rounded-lg text-slate-400 hover:text-blue-700 border border-transparent hover:border-blue-100 transition-all">
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                            ) : l.debtEffect > 0 && onSettleLine ? (
                              <button onClick={() => onSettleLine(l)}
                                className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 rounded-lg text-[9px] font-black uppercase transition-all whitespace-nowrap">
                                Régler
                              </button>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        )}
                      </tr>
                      {detail && isOpen && (
                        <tr className="bg-slate-50/70">
                          <td />
                          <td colSpan={(onSettleLine || onPrintReceipt) ? 9 : 8} className="px-3 pb-3">
                            <ItemTable items={l.items!} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="text-[#002d87] font-black">
                  <td colSpan={5} className="px-3 py-3 uppercase text-[10px] tracking-widest">
                    {visible.length === lines.length ? 'Total du compte' : 'Total des lignes affichées'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(visible.reduce((s, l) => s + l.charged, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{money(visible.reduce((s, l) => s + l.paid, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-red-600">{money(visible.reduce((s, l) => s + l.rest, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-red-600">{money(debtFromDocs)}</td>
                  {(onSettleLine || onPrintReceipt) && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Block>
    </div>
  );

  const achats = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile icon={ShoppingBag} label="Documents" value={documents.length}
          sub="bons, factures et interventions" />
        <Tile icon={Receipt} label="Total consommé" value={money(st.totals.charged)}
          sub="hors retours et échanges" />
        <Tile icon={CircleDollarSign} label="Reste sur documents" value={money(st.totals.rest)}
          tone={st.totals.rest > 0 ? 'red' : 'green'} sub="ce qui n'a pas été réglé sur place" />
      </div>

      {byItem.length > 0 && (
        <Block icon={Package} title={`Détail par article et prestation (${byItem.length})`}
          hint="Tout ce que le client a pris, cumulé sur l'ensemble de son compte">
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Désignation</th>
                  <th className="px-4 py-2.5 text-right">Fois</th>
                  <th className="px-4 py-2.5 text-right">Quantité</th>
                  <th className="px-4 py-2.5 text-right">Prix moyen</th>
                  <th className="px-4 py-2.5 text-right">Montant</th>
                  <th className="px-4 py-2.5 text-right">Part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byItem.map(it => {
                  const share = st.totals.charged > 0 ? (it.total / st.totals.charged) * 100 : 0;
                  return (
                    <tr key={`${it.name}|${it.unit || ''}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-bold text-slate-700">{it.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 font-bold">{it.count}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 font-bold whitespace-nowrap">
                        {it.qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}{it.unit ? ` ${it.unit}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 whitespace-nowrap">
                        {it.qty > 0 ? money(it.total / it.qty) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-black text-[#002d87] whitespace-nowrap">{money(it.total)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 font-bold whitespace-nowrap">
                        {share.toFixed(1)} %
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      <Block icon={ShoppingBag} title={`Achats et consommations (${documents.length})`}
        hint="Chaque document se déplie sur ses lignes — articles, litres, prestations">
        {documents.length === 0 ? (
          <Empty icon={ShoppingBag} message="Ce client n'a encore rien pris" />
        ) : (
          <div className="divide-y divide-slate-100">
            {documents.map(d => {
              const detail = (d.items || []).length > 0;
              const isOpen = !!expanded[`doc-${d.id}`];
              return (
                <div key={d.id}>
                  <button type="button" onClick={() => detail && toggle(`doc-${d.id}`)}
                    className={cn('w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-slate-50 transition-colors',
                      !detail && 'cursor-default')}>
                    <div className="w-8 shrink-0 text-slate-300">
                      {detail && (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                    </div>
                    <div className="min-w-[140px] flex-1">
                      <p className="text-xs font-black truncate" style={{ color: KIND_COLOR[d.kind] }}>
                        {d.kindLabel}{d.ref ? ` · ${d.ref}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 font-semibold truncate">{d.label}</p>
                      <p className="text-[10px] text-slate-400 font-bold">
                        {[shortDate(d.date), d.qtyLabel, d.status, d.mode].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-5 shrink-0 ml-auto">
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total</p>
                        <p className="text-xs font-black tabular-nums text-[#002d87]">{money(d.charged)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Réglé</p>
                        <p className="text-xs font-black tabular-nums text-emerald-600">{money(d.paid)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Reste</p>
                        <p className={cn('text-xs font-black tabular-nums', d.rest > 0 ? 'text-red-600' : 'text-slate-300')}>
                          {money(d.rest)}
                        </p>
                      </div>
                    </div>
                  </button>
                  {detail && isOpen && (
                    <div className="px-4 pb-4 pl-12 bg-slate-50/60">
                      <ItemTable items={d.items!} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Block>
    </div>
  );

  const reglements = () => (
    <div className="space-y-4">
      <div className={cn('rounded-2xl p-6 text-white shadow-lg relative overflow-hidden flex flex-wrap items-center justify-between gap-5',
        debtFromDocs > 0
          ? 'bg-gradient-to-r from-red-600 via-red-700 to-rose-800'
          : 'bg-gradient-to-r from-emerald-600 via-emerald-700 to-emerald-800')}>
        <div className="absolute -top-10 -right-6 w-40 h-40 bg-white/5 rounded-full blur-2xl" />
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] opacity-80">
            {debtFromDocs > 0 ? 'Reste dû par le client' : 'Compte soldé'}
          </p>
          <p className="text-4xl font-black tabular-nums leading-none mt-1.5">{money(debtFromDocs)}</p>
          <p className="text-[11px] font-bold opacity-80 mt-2">
            {money(st.totals.charged)} consommés — {money(st.totals.paid)} encaissés
            {' '}sur {payments.length} règlement(s)
          </p>
        </div>
        {onPayDebt && debtFromDocs > 0 && (
          <button onClick={onPayDebt}
            className="relative z-10 px-6 py-3 bg-white text-red-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-md flex items-center gap-2">
            <CircleDollarSign className="w-4 h-4" /> Encaisser un règlement
          </button>
        )}
      </div>

      {openingBlock()}

      {/* ── L'historique des règlements ─────────────────────────────────────
          Il ne se lisait qu'en lecture seule : un montant saisi de travers ne
          pouvait plus être repris, et le reçu d'un règlement d'il y a trois mois
          était introuvable. Chaque ligne porte maintenant ses trois gestes —
          corriger, supprimer, réimprimer — et la liste entière s'imprime. */}
      <Block icon={Wallet} title={`Règlements encaissés (${payments.length})`} tone="green"
        hint="Chaque versement, à sa date et par son moyen de paiement"
        action={payments.length > 0 ? (
          <button onClick={printPayments}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#002d87] text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Imprimer la liste
          </button>
        ) : undefined}>
        {payments.length === 0 ? (
          <Empty icon={Wallet} message="Aucun règlement encaissé sur ce compte" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50">
                <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Libellé</th>
                  <th className="px-4 py-2.5">Mode</th>
                  <th className="px-4 py-2.5">Référence</th>
                  <th className="px-4 py-2.5 text-right">Montant</th>
                  {hasPaymentActions ? <th className="px-4 py-2.5 text-center">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-emerald-50/40">
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-medium">{shortDate(p.date)}</td>
                    <td className="px-4 py-2.5 text-slate-600 font-semibold">{p.label || 'Règlement'}</td>
                    <td className="px-4 py-2.5 font-black text-emerald-700 whitespace-nowrap">{p.mode}</td>
                    <td className="px-4 py-2.5 text-slate-400 font-bold">
                      {p.reference || '—'}
                      {p.inferred && (
                        <span className="text-amber-600" title="Ce versement n'était pas daté : la date du document a été reprise">
                          {' '}(date du document)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-black text-emerald-600 whitespace-nowrap">
                      {money(p.amount)}
                    </td>
                    {hasPaymentActions ? (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          {onPrintPayment ? (
                            <button onClick={() => onPrintPayment(p)} title="Imprimer le reçu"
                              className="p-1.5 rounded-lg text-slate-300 hover:text-[#002d87] hover:bg-slate-100 transition-all">
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                          {onEditPayment ? (
                            <button onClick={() => onEditPayment(p)} title="Corriger ce règlement"
                              className="p-1.5 rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-all">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                          {onDeletePayment ? (
                            <button onClick={() => onDeletePayment(p)} title="Supprimer ce règlement"
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="text-[#002d87] font-black">
                  <td colSpan={4} className="px-4 py-3 uppercase text-[10px] tracking-widest">Total encaissé</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{money(st.totals.paid)}</td>
                  {hasPaymentActions ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Block>
    </div>
  );

  const avances = () => (
    <div className="space-y-4">
      <div className="rounded-2xl p-6 text-white shadow-lg relative overflow-hidden flex flex-wrap items-center justify-between gap-5 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800">
        <div className="absolute -top-10 -right-6 w-40 h-40 bg-white/5 rounded-full blur-2xl" />
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] opacity-80">Avance encore disponible</p>
          <p className="text-4xl font-black tabular-nums leading-none mt-1.5">{money(advance?.available || 0)}</p>
          <p className="text-[11px] font-bold opacity-80 mt-2">
            {money(advance?.recharged || 0)} déposés — {money(advance?.used || 0)} consommés en bons
          </p>
          {/* Ce que l'avance a déjà éteint : sans cette ligne, un client dont
              l'avance couvre ses factures voit un solde d'avance intact et une
              dette qui, elle, a bel et bien disparu. */}
          {advanceApplied > 0 && (
            <p className="text-[11px] font-bold opacity-80 mt-1">
              dont {money(advanceApplied)} imputés sur ce qu'il doit — reste {money(advanceLeft)} à lui
            </p>
          )}
        </div>
        {advance?.onRecharge && (
          <button onClick={advance.onRecharge}
            className="relative z-10 px-6 py-3 bg-white text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-md flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Recharger l'avance
          </button>
        )}
      </div>

      <Block icon={Wallet} title={`Mouvements du compte d'avance (${advanceMoves.length})`} tone="green"
        hint="Les dépôts ET ce qui les a consommés — un solde ne se lit pas sur les seuls dépôts">
        {advanceMoves.length === 0 ? (
          <Empty icon={Wallet} message="Aucun mouvement sur le compte d'avance" />
        ) : (
          <div className="divide-y divide-slate-100">
            {advanceMoves.map(m => {
              const isIn = m.advanceEffect > 0;
              return (
                <div key={m.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center border shrink-0',
                      isIn ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100')}>
                      {isIn ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-[#002d87] truncate">
                        {/* La reprise garde son nom : ce n'est pas un dépôt du
                            jour, c'est un solde apporté à l'ouverture. */}
                        {m.kind === 'avance' ? m.label : isIn ? "Dépôt sur le compte d'avance" : m.label}
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold truncate">
                        {[shortDate(m.date), m.mode, m.reference, m.notes].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <span className={cn('text-sm font-black tabular-nums whitespace-nowrap', isIn ? 'text-emerald-600' : 'text-amber-600')}>
                    {isIn ? '+' : '−'}{money(Math.abs(m.advanceEffect))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Block>
    </div>
  );

  const fiche = () => (
    <div className="space-y-4">
      {identity.length === 0 ? (
        <Block icon={IdCard} title="Fiche client">
          <Empty icon={IdCard} message="Aucune information complémentaire enregistrée" />
        </Block>
      ) : identity.map(g => (
        <Block key={g.title} icon={g.icon || IdCard} title={g.title}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-slate-100">
            {g.rows.map((r, i) => (
              <div key={i} className="bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{r.label}</p>
                <p className="text-xs font-black text-[#002d87] break-words mt-0.5">
                  {r.value === undefined || r.value === null || r.value === '' ? (
                    <span className="text-slate-300 font-bold">Non renseigné</span>
                  ) : r.value}
                </p>
                {r.hint && <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{r.hint}</p>}
              </div>
            ))}
          </div>
        </Block>
      ))}
    </div>
  );

  const sections: DossierSection[] = [
    { id: 'resume', label: "Vue d'ensemble", icon: LayoutDashboard, hint: 'Les soldes du compte et ce qui les explique', render: resume },
    { id: 'journal', label: 'Journal complet', icon: History, count: lines.length, hint: "Toutes les opérations, depuis l'ouverture du compte", render: journal },
    { id: 'achats', label: 'Achats & consos', icon: ShoppingBag, count: documents.length, hint: 'Les documents, dépliés sur leur détail', render: achats },
    { id: 'reglements', label: 'Règlements', icon: Wallet, count: payments.length, hint: "L'argent encaissé, daté et par mode", render: reglements },
    ...(advance ? [{ id: 'avance', label: 'Compte d\'avance', icon: CreditCard, count: advanceMoves.length, hint: 'Dépôts et consommation du prépayé', render: avances }] : []),
    ...extraSections,
    { id: 'fiche', label: 'Fiche client', icon: IdCard, hint: 'Identité, coordonnées et fiscalité', render: fiche },
  ];

  const active = sections.find(s => s.id === section) || sections[0];
  const ActiveIcon = active.icon;

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <div className={cn('modal-shell not-italic text-left', zClass)}>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }} onClick={onClose}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="relative z-10 w-full max-w-[1400px] h-[var(--modal-max-h)] flex flex-col rounded-3xl overflow-hidden bg-white shadow-2xl border border-blue-200">

          {/* ── Bandeau d'identité ────────────────────────────────────────── */}
          <div className="shrink-0 px-5 sm:px-7 py-4 flex items-center gap-4 text-white"
            style={{ background: 'linear-gradient(120deg, #001233 0%, #001f5c 45%, #003087 100%)' }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-black uppercase shrink-0 border-2 border-white/20 shadow-lg"
              style={{ background: 'linear-gradient(135deg, #FFB800 0%, #e6a000 100%)', color: '#001f5c' }}>
              {(st.client.name || '?').charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-black text-[#FFB800] truncate leading-tight">{st.client.name || 'Client'}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-blue-200">{st.partLabel}</span>
                {st.client.phone && <span className="text-[10px] font-bold text-blue-200">{st.client.phone}</span>}
                {badges}
              </div>
            </div>

            {/* Les trois chiffres qui comptent, toujours visibles. */}
            <div className="hidden lg:flex items-center gap-6 shrink-0 pr-2">
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">Consommé</p>
                <p className="text-base font-black tabular-nums">{money(st.totals.charged)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">Encaissé</p>
                <p className="text-base font-black tabular-nums text-emerald-300">{money(st.totals.paid)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">Reste dû</p>
                <p className={cn('text-base font-black tabular-nums', debtFromDocs > 0 ? 'text-red-300' : 'text-emerald-300')}>
                  {money(debtFromDocs)}
                </p>
              </div>
            </div>

            <button onClick={onClose} aria-label="Fermer"
              className="p-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl transition-all shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Navigation + rubrique ─────────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row">

            {/* Panneau de navigation — le gabarit des Paramètres. */}
            <nav className="shrink-0 lg:w-64 lg:h-full overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto custom-scrollbar border-b lg:border-b-0 lg:border-r border-white/5"
              style={{ background: 'linear-gradient(170deg, #001233 0%, #001f5c 35%, #003087 70%, #002470 100%)' }}>
              <div className="flex lg:flex-col gap-1 p-2.5 lg:p-3">
                {sections.map(s => {
                  const Icon = s.icon;
                  const isActive = s.id === active.id;
                  return (
                    <button key={s.id} onClick={() => setSection(s.id)}
                      className={cn('sidebar-link !w-auto lg:!w-full whitespace-nowrap',
                        isActive ? 'sidebar-link-active' : 'sidebar-link-inactive')}>
                      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all',
                        isActive ? 'bg-[#001f5c]/20' : 'bg-white/10')}>
                        <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-[#001f5c]' : 'text-blue-200')} />
                      </div>
                      <span className="text-[13px] leading-none flex-1 text-left">{s.label}</span>
                      {s.count !== undefined && (
                        <span className={cn('text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md shrink-0',
                          isActive ? 'bg-[#001f5c]/15 text-[#001f5c]' : 'bg-white/10 text-blue-200')}>
                          {s.count}
                        </span>
                      )}
                      {isActive && s.count === undefined && <ChevronRight className="w-3 h-3 text-[#001f5c]/50 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Rubrique */}
            <div className="flex-1 min-w-0 flex flex-col bg-slate-50/40">
              <div className="shrink-0 px-5 sm:px-7 py-3.5 flex items-center gap-3 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}>
                  <ActiveIcon className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-xs uppercase tracking-widest leading-none truncate">{active.label}</h3>
                  {active.hint && <p className="text-[10px] text-blue-200 mt-1 font-semibold truncate">{active.hint}</p>}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
                <motion.div key={active.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}>
                  {active.render()}
                </motion.div>
              </div>
            </div>
          </div>

          {/* ── Pied : les totaux et les sorties papier ───────────────────── */}
          <div className="shrink-0 px-5 sm:px-7 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs font-bold mr-auto">
              <span className="text-[#002d87]">Consommé {money(st.totals.charged)}</span>
              <span className="text-emerald-600">Encaissé {money(st.totals.paid)}</span>
              <span className={debtFromDocs > 0 ? 'text-red-600' : 'text-slate-400'}>Reste dû {money(debtFromDocs)}</span>
              {advance && <span className="text-amber-600">Avance {money(advance.available)}</span>}
            </div>
            <button onClick={onClose} className="btn-ghost !py-2 !px-4 text-xs">Fermer</button>
            {onPrintStatement && (
              <button onClick={onPrintStatement} className="btn-ghost !py-2 !px-4 text-xs flex items-center gap-2">
                <Printer className="w-4 h-4" /> Imprimer le relevé
              </button>
            )}
            {onReport && (
              <button onClick={onReport} className="btn-primary !py-2 !px-4 text-xs flex items-center gap-2">
                <FileBarChart className="w-4 h-4" /> Rapport sur une période
              </button>
            )}
          </div>
        </motion.div>

        {/* La feuille A4 hors écran de l'appelant, s'il en fournit une. */}
        {children}
      </div>
    </AnimatePresence>,
    document.body,
  );
}
