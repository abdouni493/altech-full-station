/**
 * ─── Inventaire physique d'une partie (Cafétéria / Lavage) ─────────────────────
 *
 * Compter ce qu'il y a VRAIMENT en rayon, puis confronter ce comptage à ce que
 * l'application annonce. Chaque partie a ses propres inventaires, comme elle a
 * ses propres produits et ses propres employés : rien n'est partagé entre la
 * cafétéria et le lavage.
 *
 * Le parcours complet :
 *   1. ASSISTANT — on choisit la date, le nom se déduit tout seul
 *      (`invnt-01-01-2026`), puis on sélectionne les produits et on saisit ce
 *      qu'on a trouvé. Entrée passe au produit suivant, sans lâcher le clavier.
 *   2. BROUILLON — un comptage peut être laissé en plan et repris plus tard ;
 *      « Terminer le comptage » le fige.
 *   3. COMPARAISON — le comptage est confronté au stock du moment : chaque
 *      produit reçoit son DÉCALAGE, valorisé au prix d'achat.
 *   4. CORRECTION — sur confirmation explicite, et APRÈS une sauvegarde des
 *      quantités d'avant, le stock est aligné sur le comptage. Les manquants
 *      apparaissent alors comme des pertes, les surplus comme des gains.
 *
 * Chaque étape s'imprime : la feuille de comptage et le rapport d'écarts sortent
 * en A4, aux couleurs de la station, comme la fiche journalière.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList, Plus, Search, Calendar, CheckCircle2, ArrowRight, ArrowLeft, X, Printer,
  Scale, AlertTriangle, TrendingDown, TrendingUp, Save, ShieldCheck, Layers, PackageCheck,
  FileText, Undo2, UsersRound, Ban, Boxes, ListChecks, RotateCcw,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn, newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizInventaire, BizInventaireLine, BizInventaireStatus, BizProduct,
  INVENTAIRE_STATUS_META, formatQty, inventaireRefFor, roundQty,
} from '@/src/lib/bizConfig';
import {
  applyCorrection, buildBackup, buildComparison, correctionDeltas, countedLabelOf, countedQtyOf,
  describeCorrection, restoreBackupLines,
} from '@/src/lib/inventaire';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, Table, EmptyState, RowActions, ActionBtn,
  ViewToggle, CardGrid, GlassCard,
  Eye, Edit2, Trash2, Confirm, Modal, Field, Input, Textarea, Select, Switch,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { printFiche } from '@/src/components/biz/ReportFiche';
import { InventaireFiche, ComparisonFiche } from '@/src/components/biz/InventaireFiche';

export default function ModuleInventaire({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'inventaire');
  const { settings, currentUserName, currentModuleWorker } = useAppState();
  const { inventaires, products } = biz.state;
  const author = currentModuleWorker?.name || currentUserName || 'Admin';

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BizInventaireStatus>('all');
  // Tableau par défaut : un inventaire se juge sur ses écarts, alignés en
  // colonnes. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');

  const [wizard, setWizard] = useState<null | { editing: BizInventaire | null }>(null);
  const [viewing, setViewing] = useState<BizInventaire | null>(null);
  const [comparing, setComparing] = useState<BizInventaire | null>(null);
  const [toDelete, setToDelete] = useState<BizInventaire | null>(null);

  /** Fiches imprimables, rendues hors écran pour la partie qu'on regarde. */
  const sheetRef = useRef<HTMLDivElement>(null);
  const comparisonSheetRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState<null | { inv: BizInventaire; kind: 'count' | 'comparison' }>(null);

  // L'impression attend que la fiche hors écran soit rendue avec le bon
  // inventaire — sinon on imprimerait la précédente.
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      printFiche(printing.kind === 'count' ? sheetRef.current : comparisonSheetRef.current);
      setPrinting(null);
    }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  const filtered = useMemo(() => {
    return [...inventaires]
      .filter(i =>
        (matchesSearch(search, i.ref, i.notes, i.createdBy)
          || i.lines.some(l => matchesSearch(search, l.productName)))
        && (statusFilter === 'all' || i.status === statusFilter)
        && inPeriod(i.date, period, from, to))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [inventaires, search, statusFilter, period, from, to]);

  const stats = useMemo(() => {
    const compared = inventaires.filter(i => !!i.comparison);
    return {
      total: inventaires.length,
      drafts: inventaires.filter(i => i.status === 'draft').length,
      pending: inventaires.filter(i => i.status === 'completed').length,
      loss: compared.reduce((s, i) => s + (i.comparison!.lossValue || 0), 0),
      gain: compared.reduce((s, i) => s + (i.comparison!.gainValue || 0), 0),
    };
  }, [inventaires]);

  const del = () => {
    if (!toDelete) return;
    biz.remove('inventaires', toDelete.id);
    toast.success(`Inventaire ${toDelete.ref} supprimé`);
    setToDelete(null);
  };

  /**
   * Lance (ou relance) la comparaison : le comptage est confronté au stock
   * ACTUEL, pas à celui figé à la saisie. L'inventaire passe à « comparé ».
   */
  const runComparison = (inv: BizInventaire) => {
    const comparison = buildComparison(inv, products, author);
    const next: BizInventaire = {
      ...inv,
      comparison,
      status: inv.status === 'corrected' ? 'corrected' : 'compared',
      chargeWorkers: inv.chargeWorkers !== false,
    };
    biz.update('inventaires', next);
    setComparing(next);
    toast.success(comparison.productsWithEcart > 0
      ? `${comparison.productsWithEcart} produit(s) avec décalage — ${money(comparison.lossValue)} de manquants`
      : 'Aucun décalage — le stock correspond au comptage');
  };

  const printCount = (inv: BizInventaire) => setPrinting({ inv, kind: 'count' });
  const printComparison = (inv: BizInventaire) => setPrinting({ inv, kind: 'comparison' });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={ClipboardList} title="Inventaire" subtitle={`${cfg.label} — comptage physique & écarts`}
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setWizard({ editing: null })}>
              <Plus className="w-4 h-4" /> Nouvel inventaire
            </button>
          : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={ClipboardList} label="Inventaires" value={stats.total} tone="blue" />
        <StatCard icon={FileText} label="Brouillons" value={stats.drafts} tone="amber" sub="comptage à reprendre" />
        <StatCard icon={Scale} label="À comparer" value={stats.pending} tone="purple" sub="comptage figé" />
        <StatCard icon={TrendingDown} label="Manquants" value={money(stats.loss)} tone="red" sub="au prix d'achat" />
        <StatCard icon={TrendingUp} label="Surplus" value={money(stats.gain)} tone="green" sub="au prix d'achat" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Nom d'inventaire, produit ou agent…" />
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="!w-auto min-w-[170px]">
            <option value="all">Tous les états</option>
            {(Object.keys(INVENTAIRE_STATUS_META) as BizInventaireStatus[]).map(k => (
              <option key={k} value={k}>{INVENTAIRE_STATUS_META[k].label}</option>
            ))}
          </Select>
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Aucun inventaire"
          message="Créez un inventaire pour compter ce qu'il y a réellement en rayon et le confronter au stock de l'application."
          action={perm.creer
            ? <button className="btn-primary" onClick={() => setWizard({ editing: null })}><Plus className="w-4 h-4" /> Nouvel inventaire</button>
            : undefined} />
      ) : view === 'grid' ? (
        /* ── Les inventaires en cartes ────────────────────────────────────
           Le même contenu que la ligne du tableau : ce qui a été compté, et
           ce que la comparaison au stock a fait apparaître. */
        <CardGrid>
          {filtered.map(inv => {
            const meta = INVENTAIRE_STATUS_META[inv.status];
            const value = inv.lines.reduce((s, l) => s + countedQtyOf(l) * (Number(l.purchasePrice) || 0), 0);
            return (
              <GlassCard key={inv.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-800 truncate">{inv.ref}</h3>
                    <p className="text-[11px] text-slate-400">
                      {formatDate(inv.date)}{inv.createdBy ? ` • par ${inv.createdBy}` : ''}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                {inv.chargeWorkers === false && (
                  <p className="text-[11px] text-slate-400 mt-1">Non imputé aux employés</p>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Produits</p>
                    <p className="font-black text-slate-700 tabular-nums text-sm">{inv.lines.length}</p>
                  </div>
                  <div className="rounded-xl bg-red-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Manquants</p>
                    <p className="font-black text-red-600 tabular-nums text-xs">{inv.comparison ? money(inv.comparison.lossValue) : '—'}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Surplus</p>
                    <p className="font-black text-emerald-600 tabular-nums text-xs">{inv.comparison ? money(inv.comparison.gainValue) : '—'}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-amber-700 tabular-nums">Compté {money(value)}</span>
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir tout le détail" onClick={() => setViewing(inv)} />
                    {perm.modifier && inv.status !== 'corrected' && (
                      <ActionBtn icon={Edit2} tone="amber" title="Modifier le comptage" onClick={() => setWizard({ editing: inv })} />
                    )}
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer la feuille de comptage" onClick={() => printCount(inv)} />
                    <ActionBtn icon={Scale} tone="green"
                      title={inv.comparison ? 'Voir la comparaison' : "Comparer au stock de l'application"}
                      onClick={() => (inv.comparison ? setComparing(inv) : runComparison(inv))} />
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(inv)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      ) : (
        <Table head={<>
          <th className="table-head">Inventaire</th>
          <th className="table-head">Date</th>
          <th className="table-head text-right">Produits</th>
          <th className="table-head text-right">Valeur comptée</th>
          <th className="table-head text-right">Manquants</th>
          <th className="table-head text-right">Surplus</th>
          <th className="table-head">État</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(inv => {
            const meta = INVENTAIRE_STATUS_META[inv.status];
            const value = inv.lines.reduce((s, l) => s + countedQtyOf(l) * (Number(l.purchasePrice) || 0), 0);
            return (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="table-cell">
                  <div className="font-black text-slate-700">{inv.ref}</div>
                  <div className="text-[11px] text-slate-400">
                    {inv.createdBy ? `par ${inv.createdBy}` : '—'}
                    {inv.chargeWorkers === false && ' · non imputé aux employés'}
                  </div>
                </td>
                <td className="table-cell whitespace-nowrap">{formatDate(inv.date)}</td>
                <td className="table-cell tabular-nums text-right">{inv.lines.length}</td>
                <td className="table-cell tabular-nums text-right text-amber-700">{money(value)}</td>
                <td className="table-cell tabular-nums text-right text-red-600">
                  {inv.comparison ? money(inv.comparison.lossValue) : '—'}
                </td>
                <td className="table-cell tabular-nums text-right text-emerald-600">
                  {inv.comparison ? money(inv.comparison.gainValue) : '—'}
                </td>
                <td className="table-cell"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                <td className="table-cell">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir tout le détail" onClick={() => setViewing(inv)} />
                    {perm.modifier && inv.status !== 'corrected' && (
                      <ActionBtn icon={Edit2} tone="amber" title="Modifier le comptage"
                        onClick={() => setWizard({ editing: inv })} />
                    )}
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer la feuille de comptage"
                      onClick={() => printCount(inv)} />
                    <ActionBtn icon={Scale} tone="green"
                      title={inv.comparison ? 'Voir la comparaison' : 'Comparer au stock de l\'application'}
                      onClick={() => (inv.comparison ? setComparing(inv) : runComparison(inv))} />
                    {inv.comparison && (
                      <ActionBtn icon={ListChecks} tone="blue" title="Rapport des écarts"
                        onClick={() => setComparing(inv)} />
                    )}
                    {perm.supprimer && (
                      <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(inv)} />
                    )}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {wizard && (
        <InventaireWizard moduleKey={moduleKey} initial={wizard.editing} author={author}
          onClose={() => setWizard(null)} />
      )}

      {viewing && (
        <InventaireDetail inventaire={viewing} partLabel={cfg.label}
          onClose={() => setViewing(null)}
          onPrint={() => printCount(viewing)}
          onCompare={() => { setViewing(null); runComparison(viewing); }} />
      )}

      {comparing && (
        <ComparisonModal
          moduleKey={moduleKey}
          inventaire={inventaires.find(i => i.id === comparing.id) || comparing}
          author={author}
          canCorrect={perm.modifier}
          onClose={() => setComparing(null)}
          onPrint={inv => printComparison(inv)}
          onRecompare={inv => runComparison(inv)} />
      )}

      <Confirm open={!!toDelete} title="Supprimer l'inventaire"
        message={`${toDelete?.ref || ''} — ${toDelete?.lines.length || 0} produit(s) comptés.\n\n`
          + (toDelete?.status === 'corrected'
            ? 'Le stock a déjà été corrigé à partir de cet inventaire : le supprimer ne remet PAS les quantités d\'avant. Utilisez « Annuler la correction » depuis le rapport des écarts si c\'est ce que vous voulez.\n\n'
            : 'Le comptage et son rapport d\'écarts seront perdus. Le stock n\'est pas modifié.\n\n')
          + 'Cette action est définitive.'}
        onConfirm={del} onCancel={() => setToDelete(null)} />

      {/* Fiches imprimables — rendues hors écran le temps de l'impression */}
      {printing && printing.kind === 'count' && (
        <InventaireFiche ref={sheetRef} inventaire={printing.inv} settings={settings} partLabel={cfg.label} />
      )}
      {printing && printing.kind === 'comparison' && (
        <ComparisonFiche ref={comparisonSheetRef} inventaire={printing.inv} settings={settings} partLabel={cfg.label} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ASSISTANT DE CRÉATION
// ════════════════════════════════════════════════════════════════════════════

/** Une ligne en cours de saisie dans l'assistant. */
interface DraftLine {
  product: BizProduct;
  /** Saisie brute : en unités principales, ou en unité de détail si `byDetail`. */
  value: string;
  /** Le produit se compte dans son unité de détail (10 L d'un bidon de 50 L). */
  byDetail: boolean;
}

function InventaireWizard({ moduleKey, initial, author, onClose }: {
  moduleKey: ModuleKey; initial: BizInventaire | null; author: string; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const { products, categories } = biz.state;

  const [step, setStep] = useState<1 | 2>(initial ? 2 : 1);
  const [date, setDate] = useState(
    initial ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  /** Lignes retenues, dans l'ordre de sélection — clé = id produit. */
  const [lines, setLines] = useState<Map<string, DraftLine>>(() => {
    const m = new Map<string, DraftLine>();
    (initial?.lines || []).forEach(l => {
      const p = products.find(x => x.id === l.productId);
      if (!p) return;
      const byDetail = !!l.sellByDetail && l.detailQty !== undefined;
      m.set(p.id, {
        product: p,
        byDetail,
        value: String(byDetail ? (l.detailQty ?? 0) : (l.countedQty ?? 0)),
      });
    });
    return m;
  });

  /** Le nom se déduit de la date — il n'est jamais tapé à la main. */
  const ref = useMemo(() => inventaireRefFor(date), [date]);

  const visible = useMemo(() => {
    return products.filter(p =>
      (catFilter === 'all' || p.categoryId === catFilter)
      && matchesSearch(query, p.name, p.barcode));
  }, [products, query, catFilter]);

  const selectedIds = useMemo(() => new Set(lines.keys()), [lines]);
  const orderedLines = useMemo(() => [...lines.values()], [lines]);

  const toggle = (p: BizProduct) => setLines(prev => {
    const next = new Map(prev);
    if (next.has(p.id)) next.delete(p.id);
    else next.set(p.id, { product: p, value: '', byDetail: !!p.sellByDetail && !!p.detailCapacity });
    return next;
  });

  const addMany = (list: BizProduct[]) => setLines(prev => {
    const next = new Map(prev);
    list.forEach(p => {
      if (!next.has(p.id)) next.set(p.id, { product: p, value: '', byDetail: !!p.sellByDetail && !!p.detailCapacity });
    });
    return next;
  });

  const removeMany = (list: BizProduct[]) => setLines(prev => {
    const next = new Map(prev);
    list.forEach(p => next.delete(p.id));
    return next;
  });

  const patchLine = (id: string, patch: Partial<DraftLine>) => setLines(prev => {
    const next = new Map<string, DraftLine>(prev);
    const cur = next.get(id);
    if (cur) next.set(id, { ...cur, ...patch });
    return next;
  });
  const setValue = (id: string, value: string) => patchLine(id, { value });
  const setByDetail = (id: string, byDetail: boolean) => patchLine(id, { byDetail });

  /**
   * Entrée passe au champ suivant — on compte un rayon les deux mains prises,
   * lâcher le clavier pour viser la case d'après ferait perdre plus de temps que
   * tout le reste de l'écran n'en fait gagner. Sur le dernier champ, Entrée
   * revient au premier.
   */
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusNext = (index: number) => {
    const next = orderedLines[index + 1] || orderedLines[0];
    if (!next) return;
    const el = qtyRefs.current[next.product.id];
    el?.focus();
    el?.select();
  };

  const toLines = (): BizInventaireLine[] => orderedLines.map(dl => {
    const p = dl.product;
    const raw = Number(dl.value) || 0;
    const capacity = Number(p.detailCapacity) || 0;
    const byDetail = dl.byDetail && capacity > 0;
    return {
      productId: p.id,
      productName: p.name,
      barcode: p.barcode,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      unit: p.unit,
      countedQty: byDetail ? roundQty(raw / capacity) : roundQty(raw),
      detailQty: byDetail ? raw : undefined,
      detailUnit: byDetail ? (p.detailUnit || 'L') : undefined,
      detailCapacity: byDetail ? capacity : undefined,
      sellByDetail: byDetail,
      purchasePrice: Number(p.purchasePrice) || 0,
      salePrice: Number(p.salePrice) || 0,
      systemQtyAtEntry: roundQty(Number(p.currentQty) || 0),
    };
  });

  const save = async (status: BizInventaireStatus) => {
    if (orderedLines.length === 0) { toast.error('Sélectionnez au moins un produit à compter'); return; }
    setSaving(true);
    const inv: BizInventaire = {
      id: initial?.id || newId(),
      ref,
      date: new Date(date).toISOString(),
      status,
      lines: toLines(),
      notes: notes.trim() || undefined,
      createdAt: initial?.createdAt || new Date().toISOString(),
      createdBy: initial?.createdBy || author,
      completedAt: status === 'completed' ? new Date().toISOString() : initial?.completedAt,
      // Un comptage modifié invalide son ancien rapport d'écarts : il faudra le
      // relancer, sinon l'écran montrerait des décalages calculés sur autre chose.
      comparison: undefined,
      chargeWorkers: initial?.chargeWorkers ?? true,
    };
    try {
      if (initial) {
        biz.update('inventaires', inv);
        const res = await biz.flush();
        toast[res.ok ? 'success' : 'error'](res.ok
          ? (status === 'draft' ? 'Brouillon enregistré' : 'Inventaire terminé')
          : `Non enregistré sur le serveur — ${res.error}`);
      } else {
        const res = await biz.addAndConfirm('inventaires', inv);
        toast[res.ok ? 'success' : 'error'](res.ok
          ? (status === 'draft' ? `Brouillon ${ref} créé` : `Inventaire ${ref} terminé`)
          : `Non enregistré sur le serveur — ${res.error}`);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const countedValue = orderedLines.reduce((s, dl) => {
    const capacity = Number(dl.product.detailCapacity) || 0;
    const raw = Number(dl.value) || 0;
    const qty = dl.byDetail && capacity > 0 ? raw / capacity : raw;
    return s + qty * (Number(dl.product.purchasePrice) || 0);
  }, 0);
  const filled = orderedLines.filter(dl => dl.value.trim() !== '').length;

  return (
    <Modal open onClose={onClose} icon={ClipboardList} size="3xl" formScale fullHeight
      title={initial ? `Modifier ${initial.ref}` : 'Nouvel inventaire'}
      subtitle={step === 1 ? 'Étape 1 — date et nom de l\'inventaire' : 'Étape 2 — produits comptés et quantités'}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-slate-400 uppercase tracking-widest">{orderedLines.length} produit(s)</span>
          {step === 2 && <span className="text-[#002d87]">{filled} saisi(s)</span>}
          {step === 2 && <span className="text-amber-700">Valeur {money(countedValue)}</span>}
        </div>
        {step === 2 && (
          <button className="btn-ghost" onClick={() => setStep(1)} disabled={saving}>
            <ArrowLeft className="w-4 h-4" /> Retour
          </button>
        )}
        <button className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
        {step === 1 ? (
          <button className="btn-primary" onClick={() => setStep(2)}>
            Étape suivante <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <>
            <button className="btn-secondary" onClick={() => save('draft')} disabled={saving}>
              <Save className="w-4 h-4" /> Enregistrer le brouillon
            </button>
            <button className="btn-primary" onClick={() => save('completed')} disabled={saving}>
              <CheckCircle2 className="w-4 h-4" /> Terminer le comptage
            </button>
          </>
        )}
      </>}>

      {/* ── Étape 1 : date → nom automatique ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[#003087]/15 bg-[#eef3fc] p-4 flex items-start gap-3">
            <Calendar className="w-5 h-5 text-[#002d87] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-black text-[#002d87]">La date décide du nom</p>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Le nom d'un inventaire n'est jamais tapé à la main : il se déduit de la date du comptage, toujours
                sous la même forme. Deux inventaires du même jour portent donc le même nom — c'est voulu, ils se
                distinguent par leur contenu et leur heure de création.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date de l'inventaire" required>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <Field label="Nom généré automatiquement">
              <div className="field-static bg-[#eef3fc] border-[#003087]/20 text-[#002d87] font-black tracking-wide">
                {ref}
              </div>
            </Field>
          </div>

          <Field label="Observations (optionnel)" hint="Ce qui explique le comptage : rayon concerné, incident, présence d'un contrôleur…">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Précisions sur ce comptage…" />
          </Field>
        </div>
      )}

      {/* ── Étape 2 : sélection des produits + quantités ──────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400">{ref}</span>
            <span className="text-xs text-slate-500">{formatDate(date)}</span>
            <span className="ml-auto text-xs text-slate-500">
              Astuce : appuyez sur <b className="text-slate-700">Entrée</b> pour passer au produit suivant.
            </span>
          </div>

          {/* Sélection */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
                    placeholder="Rechercher un produit par nom ou code-barres…" className="input-field pl-9" />
                </div>
                <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="!w-auto min-w-[180px]">
                  <option value="all">Toutes les catégories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>

              {/* Sélections en masse — la seule façon de compter un rayon entier
                  sans cliquer cent fois, et chaque produit reste décochable. */}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary !py-2 !px-3.5 text-xs"
                  onClick={() => addMany(products)}>
                  <Boxes className="w-4 h-4" /> Tous les produits de la base ({products.length})
                </button>
                <button type="button" className="btn-outline !py-2 !px-3.5 text-xs"
                  onClick={() => addMany(visible)} disabled={visible.length === 0}>
                  <Layers className="w-4 h-4" /> Ajouter les {visible.length} produit(s) affiché(s)
                </button>
                <button type="button" className="btn-outline !py-2 !px-3.5 text-xs"
                  onClick={() => removeMany(visible)} disabled={visible.length === 0}>
                  <X className="w-4 h-4" /> Retirer les produits affichés
                </button>
                <button type="button" className="btn-ghost !py-2 !px-3.5 text-xs"
                  onClick={() => setLines(new Map())} disabled={orderedLines.length === 0}>
                  <Ban className="w-4 h-4" /> Tout désélectionner
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
              {visible.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">Aucun produit ne correspond.</p>
              ) : visible.map(p => {
                const on = selectedIds.has(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p)}
                    className={cn('w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors',
                      on ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-slate-50')}>
                    <span className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0',
                      on ? 'bg-[#003087] border-[#003087]' : 'border-slate-300 bg-white')}>
                      {on && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-700 truncate">{p.name}</span>
                      <span className="block text-[11px] text-slate-400 truncate">
                        {p.categoryName || 'Sans catégorie'}{p.barcode ? ` · ${p.barcode}` : ''}
                        {p.sellByDetail && p.detailCapacity ? ` · 1 ${p.unit || 'unité'} = ${p.detailCapacity} ${p.detailUnit || 'L'}` : ''}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-400 shrink-0 text-right tabular-nums">
                      <span className="block">Stock {formatQty(p.currentQty)} {p.unit || ''}</span>
                      <span className="block">Achat {money(p.purchasePrice)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Saisie des quantités */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex flex-wrap items-center gap-3">
              <PackageCheck className="w-4 h-4 text-[#002d87] shrink-0" />
              <p className="text-xs font-black uppercase tracking-wider text-[#002d87] min-w-0 flex-1">
                Quantités trouvées en rayon — {filled} / {orderedLines.length} saisie(s)
              </p>
              <span className="text-xs font-black tabular-nums text-amber-700">{money(countedValue)}</span>
            </div>

            {orderedLines.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Sélectionnez des produits ci-dessus pour saisir ce que vous avez compté.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                {orderedLines.map((dl, idx) => {
                  const p = dl.product;
                  const capacity = Number(p.detailCapacity) || 0;
                  const canDetail = !!p.sellByDetail && capacity > 0;
                  const raw = Number(dl.value) || 0;
                  const mainQty = dl.byDetail && capacity > 0 ? raw / capacity : raw;
                  return (
                    <div key={p.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                      <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-800 truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                          Stock application {formatQty(p.currentQty)} {p.unit || ''}
                          {canDetail ? ` · 1 ${p.unit || 'unité'} = ${capacity} ${p.detailUnit || 'L'}` : ''}
                        </p>
                      </div>

                      {canDetail && (
                        <div className="flex rounded-xl overflow-hidden border border-slate-200 shrink-0">
                          <button type="button" onClick={() => setByDetail(p.id, false)}
                            className={cn('px-3 py-2 text-[11px] font-black uppercase transition-colors',
                              !dl.byDetail ? 'bg-[#003087] text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                            {p.unit || 'unité'}
                          </button>
                          <button type="button" onClick={() => setByDetail(p.id, true)}
                            className={cn('px-3 py-2 text-[11px] font-black uppercase transition-colors',
                              dl.byDetail ? 'bg-[#003087] text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                            {p.detailUnit || 'L'}
                          </button>
                        </div>
                      )}

                      <div className="shrink-0 w-32">
                        <input
                          ref={el => { qtyRefs.current[p.id] = el; }}
                          type="number" step="0.01" inputMode="decimal"
                          value={dl.value}
                          placeholder="0"
                          onChange={e => setValue(p.id, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); focusNext(idx); }
                          }}
                          className="input-field text-right font-black" />
                        {dl.byDetail && capacity > 0 && (
                          <p className="text-[10px] text-slate-400 text-right mt-1 tabular-nums">
                            = {formatQty(mainQty)} {p.unit || 'unité'}
                          </p>
                        )}
                      </div>

                      <span className="w-24 text-right text-xs font-black tabular-nums text-amber-700 shrink-0">
                        {money(mainQty * (Number(p.purchasePrice) || 0))}
                      </span>

                      <button type="button" onClick={() => toggle(p)} title="Retirer ce produit"
                        className="w-9 h-9 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DÉTAIL D'UN INVENTAIRE
// ════════════════════════════════════════════════════════════════════════════

function InventaireDetail({ inventaire: inv, partLabel, onClose, onPrint, onCompare }: {
  inventaire: BizInventaire; partLabel: string;
  onClose: () => void; onPrint: () => void; onCompare: () => void;
}) {
  const meta = INVENTAIRE_STATUS_META[inv.status];
  const totalValue = inv.lines.reduce((s, l) => s + countedQtyOf(l) * (Number(l.purchasePrice) || 0), 0);
  const totalSale = inv.lines.reduce((s, l) => s + countedQtyOf(l) * (Number(l.salePrice) || 0), 0);

  return (
    <Modal open onClose={onClose} icon={ClipboardList} size="2xl" fullHeight
      title={inv.ref} subtitle={`${partLabel} — inventaire du ${formatDate(inv.date)}`}
      footer={<>
        <div className="mr-auto flex items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-[11px] text-slate-400">{meta.hint}</span>
        </div>
        <button className="btn-outline" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer</button>
        <button className="btn-primary" onClick={onCompare}><Scale className="w-4 h-4" /> Comparer au stock</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Produits comptés</p>
            <p className="font-black text-slate-700 tabular-nums">{inv.lines.length}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Valeur (prix d'achat)</p>
            <p className="font-black text-amber-700 tabular-nums text-sm">{money(totalValue)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Valeur (prix de vente)</p>
            <p className="font-black text-emerald-600 tabular-nums text-sm">{money(totalSale)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Établi par</p>
            <p className="font-black text-slate-700 text-sm truncate">{inv.createdBy || '—'}</p>
          </div>
        </div>

        {inv.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Observations</p>
            <p className="text-sm text-slate-600">{inv.notes}</p>
          </div>
        )}

        <Table head={<>
          <th className="table-head">Produit</th>
          <th className="table-head">Catégorie</th>
          <th className="table-head text-right">Quantité comptée</th>
          <th className="table-head text-right">Prix d'achat</th>
          <th className="table-head text-right">Valeur</th>
        </>}>
          {inv.lines.map(l => (
            <tr key={l.productId}>
              <td className="table-cell">
                <div className="font-bold text-slate-700">{l.productName}</div>
                {l.barcode && <div className="text-[11px] text-slate-400 font-mono">{l.barcode}</div>}
              </td>
              <td className="table-cell text-slate-500">{l.categoryName || '—'}</td>
              <td className="table-cell tabular-nums text-right">{countedLabelOf(l)}</td>
              <td className="table-cell tabular-nums text-right text-slate-500">{money(l.purchasePrice)}</td>
              <td className="table-cell tabular-nums text-right font-black text-amber-700">
                {money(countedQtyOf(l) * (Number(l.purchasePrice) || 0))}
              </td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]" colSpan={4}>TOTAL COMPTÉ</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(totalValue)}</td>
          </tr>
        </Table>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COMPARAISON & CORRECTION
// ════════════════════════════════════════════════════════════════════════════

function ComparisonModal({ moduleKey, inventaire: inv, author, canCorrect, onClose, onPrint, onRecompare }: {
  moduleKey: ModuleKey; inventaire: BizInventaire; author: string; canCorrect: boolean;
  onClose: () => void; onPrint: (inv: BizInventaire) => void; onRecompare: (inv: BizInventaire) => void;
}) {
  const biz = useBiz(moduleKey);
  const { products } = biz.state;
  const cmp = inv.comparison;
  const [confirmCorrect, setConfirmCorrect] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [filter, setFilter] = useState<'all' | 'perte' | 'gain' | 'exact'>('all');

  const deltas = useMemo(
    () => (cmp ? correctionDeltas(cmp, products) : []),
    [cmp, products]);

  const rows = useMemo(
    () => (cmp?.lines || []).filter(l => filter === 'all' || l.kind === filter)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [cmp, filter]);

  if (!cmp) return null;

  /**
   * Aligne le stock sur le comptage. Trois choses, dans cet ordre exact :
   *   1. une SAUVEGARDE des quantités d'avant est prise et rangée dans
   *      l'inventaire — c'est elle qui rend l'opération réversible ;
   *   2. chaque produit ayant un décalage voit son stock passer à la quantité
   *      comptée ;
   *   3. l'inventaire passe en « stock corrigé » et garde son rapport, où les
   *      manquants se lisent comme des pertes et les surplus comme des gains.
   */
  const correct = () => {
    const backup = buildBackup(cmp, products);
    applyCorrection(deltas, (coll, item) => biz.update(coll, item));
    biz.update('inventaires', {
      ...inv,
      status: 'corrected',
      correctedAt: new Date().toISOString(),
      correctedBy: author,
      backup,
    });
    setConfirmCorrect(false);
    toast.success(deltas.length
      ? `Stock corrigé — ${deltas.length} produit(s) alignés sur le comptage`
      : 'Aucun décalage à corriger');
  };

  /** Remet les quantités d'avant la correction, depuis la sauvegarde. */
  const restore = () => {
    const restored = restoreBackupLines(inv.backup, products, (coll, item) => biz.update(coll, item));
    biz.update('inventaires', {
      ...inv, status: 'compared', correctedAt: undefined, correctedBy: undefined, backup: undefined,
    });
    setConfirmRestore(false);
    toast.success(restored
      ? `Correction annulée — ${restored} produit(s) remis à leur quantité d'avant`
      : 'Correction annulée');
  };

  const toggleCharge = () => {
    const next = inv.chargeWorkers === false;
    biz.update('inventaires', { ...inv, chargeWorkers: next });
    toast.success(next
      ? 'Décalage imputé aux employés — il apparaîtra dans leur paie'
      : 'Décalage retiré de la paie des employés');
  };

  const corrected = inv.status === 'corrected';

  return (
    <>
      <Modal open onClose={onClose} icon={Scale} size="2xl" fullHeight
        title={`Écarts — ${inv.ref}`} subtitle={`Comparé le ${formatDate(cmp.at)}${cmp.by ? ` par ${cmp.by}` : ''}`}
        footer={<>
          <div className="mr-auto flex flex-wrap items-center gap-2">
            {corrected
              ? <Badge tone="success">Stock corrigé</Badge>
              : <Badge tone="warning">Stock non corrigé</Badge>}
            <Badge tone={inv.chargeWorkers === false ? 'neutral' : 'info'}>
              {inv.chargeWorkers === false ? 'Non imputé aux employés' : 'Imputé aux employés'}
            </Badge>
          </div>
          <button className="btn-ghost" onClick={() => onRecompare(inv)}>
            <RotateCcw className="w-4 h-4" /> Recomparer
          </button>
          <button className="btn-outline" onClick={() => onPrint(inv)}>
            <Printer className="w-4 h-4" /> Imprimer le rapport
          </button>
          {canCorrect && !corrected && (
            <button className="btn-primary" onClick={() => setConfirmCorrect(true)} disabled={deltas.length === 0}>
              <ShieldCheck className="w-4 h-4" /> Corriger le stock
            </button>
          )}
          {canCorrect && corrected && inv.backup && (
            <button className="btn-secondary" onClick={() => setConfirmRestore(true)}>
              <Undo2 className="w-4 h-4" /> Annuler la correction
            </button>
          )}
        </>}>
        <div className="space-y-4">
          {/* Le résultat, en trois chiffres */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
              <div className="flex items-center gap-2 opacity-85">
                <TrendingDown className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wide">Manquants (pertes)</span>
              </div>
              <p className="text-2xl font-black tabular-nums mt-1.5">{money(cmp.lossValue)}</p>
              <p className="text-[11px] opacity-80 mt-0.5">
                {cmp.lines.filter(l => l.kind === 'perte').length} produit(s) · {formatQty(cmp.lossQty)} unité(s)
              </p>
            </div>
            <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
              <div className="flex items-center gap-2 opacity-85">
                <TrendingUp className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wide">Surplus (gains)</span>
              </div>
              <p className="text-2xl font-black tabular-nums mt-1.5">{money(cmp.gainValue)}</p>
              <p className="text-[11px] opacity-80 mt-0.5">
                {cmp.lines.filter(l => l.kind === 'gain').length} produit(s) · {formatQty(cmp.gainQty)} unité(s)
              </p>
            </div>
            <div className="rounded-2xl p-4 text-white"
              style={{ background: cmp.netValue >= 0 ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
              <div className="flex items-center gap-2 opacity-85">
                <Scale className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wide">Impact net</span>
              </div>
              <p className="text-2xl font-black tabular-nums mt-1.5" style={{ color: cmp.netValue >= 0 ? '#FFB800' : '#fff' }}>
                {money(cmp.netValue)}
              </p>
              <p className="text-[11px] opacity-80 mt-0.5">
                {cmp.productsWithEcart} décalage(s) sur {cmp.productsCounted} produit(s)
              </p>
            </div>
          </div>

          {/* Imputation aux employés */}
          <div className={cn('rounded-2xl border p-4 flex flex-wrap items-center gap-3',
            inv.chargeWorkers === false ? 'border-slate-200 bg-slate-50' : 'border-blue-200 bg-blue-50/60')}>
            <UsersRound className={cn('w-5 h-5 shrink-0', inv.chargeWorkers === false ? 'text-slate-400' : 'text-[#003087]')} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-700">Imputer ce décalage aux employés</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Activé, les {money(cmp.lossValue)} de manquants apparaissent dans l'écran de paie des employés
                « concernés par les inventaires » de {MODULES[moduleKey].label}. Désactivé, cet inventaire
                n'y sera plus proposé du tout.
              </p>
            </div>
            <Switch checked={inv.chargeWorkers !== false} onChange={toggleCharge} />
          </div>

          {corrected && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-black text-emerald-800">
                  Stock corrigé le {formatDate(inv.correctedAt || '')}{inv.correctedBy ? ` par ${inv.correctedBy}` : ''}
                </p>
                <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                  {inv.backup?.lines.length || 0} produit(s) ont été alignés sur le comptage. Les quantités d'avant
                  sont sauvegardées : « Annuler la correction » les remet en place.
                </p>
              </div>
            </div>
          )}

          {/* Filtres */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { id: 'all', label: `Tous (${cmp.lines.length})` },
              { id: 'perte', label: `Manquants (${cmp.lines.filter(l => l.kind === 'perte').length})` },
              { id: 'gain', label: `Surplus (${cmp.lines.filter(l => l.kind === 'gain').length})` },
              { id: 'exact', label: `Conformes (${cmp.lines.filter(l => l.kind === 'exact').length})` },
            ] as const).map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  filter === f.id ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                {f.label}
              </button>
            ))}
          </div>

          <Table head={<>
            <th className="table-head">Produit</th>
            <th className="table-head text-right">Compté</th>
            <th className="table-head text-right">Application</th>
            <th className="table-head text-right">Décalage</th>
            <th className="table-head text-right">Prix d'achat</th>
            <th className="table-head text-right">Valeur</th>
            <th className="table-head">État</th>
          </>}>
            {rows.length === 0 ? (
              <tr><td className="table-cell text-slate-400 text-center" colSpan={7}>Aucune ligne dans ce filtre.</td></tr>
            ) : rows.map(l => (
              <tr key={l.productId} className={cn(l.kind === 'perte' && 'bg-red-50/40', l.kind === 'gain' && 'bg-emerald-50/40')}>
                <td className="table-cell">
                  <div className="font-bold text-slate-700">{l.productName}</div>
                  <div className="text-[11px] text-slate-400">{l.categoryName || '—'}</div>
                </td>
                <td className="table-cell tabular-nums text-right">{formatQty(l.countedQty)} {l.unit || ''}</td>
                <td className="table-cell tabular-nums text-right text-slate-500">{formatQty(l.systemQty)} {l.unit || ''}</td>
                <td className={cn('table-cell tabular-nums text-right font-black',
                  l.ecart < 0 ? 'text-red-600' : l.ecart > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                  {l.ecart > 0 ? '+' : ''}{formatQty(l.ecart)}
                </td>
                <td className="table-cell tabular-nums text-right text-slate-500">{money(l.purchasePrice)}</td>
                <td className={cn('table-cell tabular-nums text-right font-black',
                  l.value < 0 ? 'text-red-600' : l.value > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                  {money(Math.abs(l.value))}
                </td>
                <td className="table-cell">
                  {l.kind === 'perte' ? <Badge tone="danger">Perte</Badge>
                    : l.kind === 'gain' ? <Badge tone="success">Surplus</Badge>
                      : <Badge tone="neutral">Conforme</Badge>}
                </td>
              </tr>
            ))}
          </Table>

          <p className="text-[11px] text-slate-400 italic flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Le décalage est la quantité comptée MOINS la quantité annoncée par l'application. Tant que le stock
            n'est pas corrigé, l'application garde ses propres quantités : ce rapport constate l'écart, il ne le
            règle pas.
          </p>
        </div>
      </Modal>

      <Confirm open={confirmCorrect} title="Corriger le stock" danger={false} confirmLabel="Corriger le stock"
        message={`${deltas.length} produit(s) vont passer à la quantité comptée.\n\n`
          + `Manquants : ${money(cmp.lossValue)} — Surplus : ${money(cmp.gainValue)}.\n\n`
          + 'Une SAUVEGARDE des quantités actuelles est prise avant l\'écriture : vous pourrez revenir en arrière '
          + 'depuis ce même écran.\n\n'
          + (describeCorrection(deltas) || 'Aucun produit à corriger.')}
        onConfirm={correct} onCancel={() => setConfirmCorrect(false)} />

      <Confirm open={confirmRestore} title="Annuler la correction" danger={false} confirmLabel="Remettre les quantités"
        message={`Les ${inv.backup?.lines.length || 0} produit(s) corrigés retrouveront la quantité qu'ils avaient `
          + `avant la correction du ${formatDate(inv.correctedAt || '')}.\n\n`
          + 'L\'inventaire repasse à « comparé » et son rapport d\'écarts est conservé.'}
        onConfirm={restore} onCancel={() => setConfirmRestore(false)} />
    </>
  );
}
