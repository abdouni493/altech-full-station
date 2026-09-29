import React, { useMemo, useState } from 'react';
import {
  FlaskConical, FileText, Plus, AlertTriangle, Clock, User, Eye, Trash2 as Trash, Beaker, Search, X,
  TrendingUp, PackageCheck, Layers, Calculator, Upload, Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizProduction, BizFiche, BizIngredient, BizProduct } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import { uploadFile } from '@/src/lib/supabase';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, Select, CardGrid, GlassCard, Table, EmptyState, Tabs,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, Switch, InlineCreate, money, formatDate, inPeriod, Period,
} from '@/src/components/biz/Kit';

export default function ModuleProduction({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'production');
  const { productions, fiches } = biz.state;
  const [tab, setTab] = useState<'prod' | 'fiche'>('prod');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={FlaskConical} title="Production" subtitle={`${cfg.label} — fabrication & fiches techniques`}
        actions={<TabAction tab={tab} moduleKey={moduleKey} />} />
      <Tabs tabs={[{ id: 'prod', label: 'Productions', icon: FlaskConical }, { id: 'fiche', label: 'Fiches techniques', icon: FileText }]}
        active={tab} onChange={(id) => setTab(id as any)} />
      {tab === 'prod' ? <ProductionsTab moduleKey={moduleKey} /> : <FichesTab moduleKey={moduleKey} />}
    </div>
  );
}

function TabAction({ tab, moduleKey }: { tab: 'prod' | 'fiche'; moduleKey: ModuleKey }) {
  const [open, setOpen] = useState(false);
  const perm = useBizPermission(moduleKey, 'production');
  if (!perm.creer) return null;
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4" /> {tab === 'prod' ? 'Nouvelle production' : 'Nouvelle fiche'}
      </button>
      {open && tab === 'prod' && <ProductionForm moduleKey={moduleKey} onClose={() => setOpen(false)} />}
      {open && tab === 'fiche' && <FicheForm moduleKey={moduleKey} initial={null} onClose={() => setOpen(false)} />}
    </>
  );
}

// ─── Productions tab ────────────────────────────────────────────────────────────
function ProductionsTab({ moduleKey }: { moduleKey: ModuleKey }) {
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'production');
  const { productions } = biz.state;
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  // Tableau par défaut : une liste de fabrications se compare en colonnes
  // (coût, valeur, gains). Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [viewing, setViewing] = useState<BizProduction | null>(null);
  const [transfer, setTransfer] = useState<BizProduction | null>(null);
  const [toDelete, setToDelete] = useState<BizProduction | null>(null);

  const filtered = useMemo(() => {
    return [...productions].filter(p => matchesSearch(search, p.name) && inPeriod(p.date, period))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [productions, search, period]);

  const stats = useMemo(() => ({
    count: productions.length,
    value: productions.reduce((s, p) => s + p.totalValue, 0),
    cost: productions.reduce((s, p) => s + p.totalCost, 0),
    loss: productions.reduce((s, p) => s + p.lossValue, 0),
  }), [productions]);

  const del = () => { if (toDelete) { biz.remove('productions', toDelete.id); toast.success('Production supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FlaskConical} label="Productions" value={stats.count} tone="blue" />
        <StatCard icon={TrendingUp} label="Valeur vente" value={money(stats.value)} tone="green" />
        <StatCard icon={Calculator} label="Coût production" value={money(stats.cost)} tone="purple" />
        <StatCard icon={AlertTriangle} label="Valeur pertes" value={money(stats.loss)} tone="red" />
      </div>
      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom de production…" />
        <Select value={period} onChange={e => setPeriod(e.target.value as Period)} className="!w-auto">
          <option value="all">Toutes dates</option><option value="today">Aujourd'hui</option><option value="week">Cette semaine</option><option value="month">Ce mois</option>
        </Select>
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? <EmptyState icon={FlaskConical} title="Aucune production" message="Lancez votre première fabrication." /> : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Production</th><th className="table-head">Date</th><th className="table-head">Par</th>
          <th className="table-head text-right">Produit</th><th className="table-head text-right">Reste au comptoir</th>
          <th className="table-head text-right">Coût</th><th className="table-head text-right">Valeur vente</th>
          <th className="table-head text-right">Gains nets</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(p => {
            const rest = p.outputQuantity - p.sentToComptoir;
            const gain = p.totalValue - p.totalCost;
            return (
              <tr key={p.id}>
                <td className="table-cell">
                  <div className="font-bold text-slate-700 flex items-center gap-1.5">
                    {p.name}
                    {p.hasLoss && <Badge tone="danger"><AlertTriangle className="w-3 h-3" /> Perte</Badge>}
                  </div>
                  <div className="text-[11px] text-slate-400">{p.categoryName || 'Sans catégorie'} • {p.ingredients.length} ingrédient(s)</div>
                </td>
                <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(p.date)}</td>
                <td className="table-cell text-slate-500">{p.createdBy}</td>
                <td className="table-cell tabular-nums text-right">{p.outputQuantity} {p.unit || ''}</td>
                <td className="table-cell tabular-nums text-right">
                  {rest > 0
                    ? <button className="font-black text-[#002d87] hover:underline" title="Mettre au comptoir" onClick={() => setTransfer(p)}>{rest} {p.unit || ''}</button>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="table-cell tabular-nums text-right">{money(p.totalCost)}</td>
                <td className="table-cell tabular-nums text-right">{money(p.totalValue)}</td>
                <td className={`table-cell tabular-nums text-right font-black ${gain >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(gain)}</td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Détails" onClick={() => setViewing(p)} />
                    {rest > 0 && <ActionBtn icon={PackageCheck} tone="green" title={`Mettre au comptoir (${rest})`} onClick={() => setTransfer(p)} />}
                    {perm.supprimer && <ActionBtn icon={Trash} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(p => {
            const rest = p.outputQuantity - p.sentToComptoir;
            const gain = p.totalValue - p.totalCost;
            return (
              <GlassCard key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{p.name}</h3>
                    {p.categoryName && <Badge tone="primary">{p.categoryName}</Badge>}</div>
                  {p.hasLoss && <Badge tone="danger"><AlertTriangle className="w-3 h-3" /> Perte</Badge>}
                </div>
                <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-2">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(p.date)}</span>
                  <span className="flex items-center gap-1"><User className="w-3 h-3" />{p.createdBy}</span>
                </p>
                <div className="mt-3 space-y-1.5 text-sm">
                  <Row k="Ingrédients" v={`${p.ingredients.length} article(s)`} />
                  <Row k="Quantité produite" v={`${p.outputQuantity} ${p.unit || ''}`} />
                  {p.hasLoss && <><Row k="Prévu" v={`${p.expectedQuantity} ${p.unit || ''}`} /><Row k="Perdu" v={`${p.lossQuantity} ${p.unit || ''} • ${money(p.lossValue)}`} danger /></>}
                  <Row k="Reste au stock prod." v={`${rest} ${p.unit || ''}`} />
                  <Row k="Coût total" v={money(p.totalCost)} />
                  <Row k="Valeur vente" v={money(p.totalValue)} />
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                    <span className="text-slate-500 font-semibold">Gains nets</span>
                    <span className={`font-black tabular-nums ${gain >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(gain)}</span>
                  </div>
                </div>
                {rest > 0 && (
                  <button className="btn-secondary w-full mt-3 !py-2" onClick={() => setTransfer(p)}>
                    <PackageCheck className="w-4 h-4" /> Mettre au comptoir ({rest})
                  </button>
                )}
                <div className="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Détails" onClick={() => setViewing(p)} />
                    {perm.supprimer && <ActionBtn icon={Trash} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={FlaskConical} size="lg" title={viewing?.name || ''} subtitle="Détails de la production">
        {viewing && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50"><th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-slate-400">Ingrédient</th><th className="px-2 text-[11px] font-bold uppercase text-slate-400">Qté</th><th className="px-2 text-[11px] font-bold uppercase text-slate-400">P.U</th><th className="px-3 text-right text-[11px] font-bold uppercase text-slate-400">Coût</th></tr></thead>
                <tbody>{viewing.ingredients.map((ig, i) => (
                  <tr key={i} className="border-t border-slate-100"><td className="px-3 py-2">{ig.productName}</td><td className="px-2 text-center tabular-nums">{ig.quantityUsed} {ig.unit}</td><td className="px-2 text-center tabular-nums">{money(ig.unitCost)}</td><td className="px-3 text-right font-bold tabular-nums">{money(ig.lineCost)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat k="Coût total" v={money(viewing.totalCost)} /><MiniStat k="Valeur vente" v={money(viewing.totalValue)} /><MiniStat k="Gains" v={money(viewing.totalValue - viewing.totalCost)} tone="green" />
            </div>
            {viewing.hasLoss && <div className="rounded-xl bg-red-50 border border-red-200 p-3"><p className="text-sm font-bold text-red-700">Perte: {viewing.lossQuantity} {viewing.unit} ({money(viewing.lossValue)})</p><p className="text-xs text-red-500">{viewing.lossReason}</p></div>}
          </div>
        )}
      </Modal>

      {transfer && <TransferModal moduleKey={moduleKey} production={transfer} onClose={() => setTransfer(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la production" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function Row({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return <div className="flex items-center justify-between"><span className="text-slate-400">{k}</span><span className={`font-bold tabular-nums ${danger ? 'text-red-600' : 'text-slate-700'}`}>{v}</span></div>;
}
function MiniStat({ k, v, tone }: { k: string; v: string; tone?: 'green' }) {
  return <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">{k}</p><p className={`font-black tabular-nums ${tone === 'green' ? 'text-emerald-600' : 'text-slate-700'}`}>{v}</p></div>;
}

// ─── Transfer to comptoir ──────────────────────────────────────────────────────
function TransferModal({ moduleKey, production, onClose }: { moduleKey: ModuleKey; production: BizProduction; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const rest = production.outputQuantity - production.sentToComptoir;
  const [qty, setQty] = useState(rest);

  const doTransfer = () => {
    const amount = Math.min(rest, Math.max(0, qty));
    if (amount <= 0) return;
    biz.update('productions', { ...production, sentToComptoir: production.sentToComptoir + amount });
    biz.add('comptoir', {
      id: newId(), productName: production.name, categoryName: production.categoryName, qty: amount,
      unit: production.unit, unitPrice: production.unitPrice, purchasePrice: production.costPerUnit,
      date: new Date().toISOString(), sourceProductionId: production.id,
    });
    toast.success(`${amount} ${production.unit || ''} envoyé(s) au comptoir`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={PackageCheck} size="md" title="Mettre au comptoir" subtitle={production.name}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={doTransfer}>Transférer</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <MiniStat k="Produit" v={`${production.outputQuantity}`} /><MiniStat k="Déjà envoyé" v={`${production.sentToComptoir}`} /><MiniStat k="Reste" v={`${rest}`} tone="green" />
        </div>
        <Field label="Quantité à transférer">
          <div className="flex gap-2">
            <Input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} max={rest} />
            <button className="btn-outline shrink-0" onClick={() => setQty(rest)}>Max</button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ─── Production form ────────────────────────────────────────────────────────────
function ProductionForm({ moduleKey, onClose }: { moduleKey: ModuleKey; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { fiches, products } = biz.state;
  const [ficheQuery, setFicheQuery] = useState('');
  const [selectedFiche, setSelectedFiche] = useState<BizFiche | null>(null);
  const [qty, setQty] = useState(0);
  const [hasLoss, setHasLoss] = useState(false);
  const [realQty, setRealQty] = useState(0);
  const [lossReason, setLossReason] = useState('');

  const ratio = selectedFiche && selectedFiche.outputQuantity > 0 ? qty / selectedFiche.outputQuantity : 0;
  const scaledIngredients: BizIngredient[] = useMemo(() => {
    if (!selectedFiche) return [];
    return selectedFiche.ingredients.map(ig => ({ ...ig, quantityUsed: +(ig.quantityUsed * ratio).toFixed(3), lineCost: +(ig.quantityUsed * ratio * ig.unitCost).toFixed(2) }));
  }, [selectedFiche, ratio]);

  const stockIssues = useMemo(() => scaledIngredients.filter(ig => {
    if (ig.sourceType === 'fiche') return false;
    const prod = products.find(p => p.id === ig.productId);
    return prod ? prod.currentQty < ig.quantityUsed : false;
  }), [scaledIngredients, products]);

  const totalCost = scaledIngredients.reduce((s, ig) => s + ig.lineCost, 0);
  const expectedQty = qty;
  const outputQty = hasLoss ? realQty : expectedQty;
  const costPerUnit = outputQty > 0 ? totalCost / outputQty : 0;
  const lossQty = hasLoss ? Math.max(0, expectedQty - realQty) : 0;
  const totalValue = selectedFiche ? outputQty * selectedFiche.unitPrice : 0;

  const matches = useMemo(() => {
    if (!ficheQuery.trim()) return [];
    return fiches.filter(f => matchesSearch(ficheQuery, f.name)).slice(0, 6);
  }, [fiches, ficheQuery]);

  const pick = (f: BizFiche) => { setSelectedFiche(f); setQty(f.outputQuantity); setRealQty(f.outputQuantity); setFicheQuery(''); };

  const save = () => {
    if (!selectedFiche) { toast.error('Sélectionnez une fiche technique'); return; }
    if (qty <= 0) { toast.error('Saisissez une quantité'); return; }
    if (stockIssues.length > 0) { toast.error('Stock insuffisant'); return; }
    const production: BizProduction = {
      id: newId(), name: `${selectedFiche.name}`, categoryName: selectedFiche.categoryName, ficheId: selectedFiche.id,
      date: new Date().toISOString(), createdBy: 'Admin', ingredients: scaledIngredients,
      // The whole output goes straight to the comptoir: there is no separate
      // "combien mettre au comptoir" step anymore — a production is immediately
      // sellable from the point de vente.
      outputQuantity: outputQty, expectedQuantity: expectedQty, sentToComptoir: outputQty,
      unit: selectedFiche.sellUnit || 'unité',
      unitPrice: selectedFiche.unitPrice, totalCost: +totalCost.toFixed(2), totalValue: +totalValue.toFixed(2), costPerUnit: +costPerUnit.toFixed(2),
      hasLoss, lossQuantity: lossQty, lossValue: +(lossQty * costPerUnit).toFixed(2), lossReason: hasLoss ? lossReason : undefined,
    };
    biz.add('productions', production);
    if (outputQty > 0) {
      biz.add('comptoir', {
        id: newId(), productName: production.name, categoryName: production.categoryName,
        qty: outputQty, unit: production.unit, unitPrice: production.unitPrice,
        purchasePrice: production.costPerUnit, date: production.date, sourceProductionId: production.id,
      });
    }
    // Deduct raw stock
    scaledIngredients.forEach(ig => {
      if (ig.sourceType === 'fiche') return;
      const prod = products.find(p => p.id === ig.productId);
      if (prod) biz.update('products', { ...prod, currentQty: Math.max(0, prod.currentQty - ig.quantityUsed) });
    });
    toast.success('Production enregistrée — envoyée au comptoir et stock déduit');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={FlaskConical} size="xl" title="Lancer une production" subtitle="Basée sur une fiche technique"
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save} disabled={!selectedFiche || stockIssues.length > 0}>Valider la production</button></>}>
      <div className="space-y-5">
        {/* Step 1: fiche */}
        <div>
          <label className="label-field">1. Fiche technique</label>
          {selectedFiche ? (
            <div className="flex items-center justify-between rounded-xl bg-[#001f5c]/5 border border-[#003087]/15 p-3">
              <div><p className="font-black text-[#002d87]">{selectedFiche.name}</p><p className="text-xs text-slate-500">Rendement de base: {selectedFiche.outputQuantity} • Prix: {money(selectedFiche.unitPrice)}</p></div>
              <button onClick={() => setSelectedFiche(null)} className="text-slate-400 hover:text-red-500"><X className="w-5 h-5" /></button>
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={ficheQuery} onChange={e => setFicheQuery(e.target.value)} placeholder="Rechercher une fiche…" className="input-field pl-9" />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                  {matches.map(f => <button key={f.id} onClick={() => pick(f)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm font-semibold text-slate-700">{f.name}</button>)}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedFiche && (
          <>
            {/* Step 2: scale */}
            <Field label="2. Quantité à produire"><Input type="number" value={qty} onChange={e => { setQty(Number(e.target.value)); if (!hasLoss) setRealQty(Number(e.target.value)); }} /></Field>

            {/* Step 3: stock check */}
            <div>
              <label className="label-field">3. Ingrédients & vérification stock</label>
              {stockIssues.length > 0 && (
                <div className="mb-2 rounded-xl bg-red-50 border border-red-200 p-3 flex items-center gap-2 text-red-700 animate-fade-in">
                  <AlertTriangle className="w-5 h-5" /> <span className="font-bold text-sm">Stock insuffisant ! Ajustez la quantité ou réapprovisionnez.</span>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50"><th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-slate-400">Ingrédient</th><th className="px-2 text-[11px] font-bold uppercase text-slate-400">Requis</th><th className="px-2 text-[11px] font-bold uppercase text-slate-400">Stock</th><th className="px-3 text-right text-[11px] font-bold uppercase text-slate-400">Coût</th></tr></thead>
                  <tbody>{scaledIngredients.map((ig, i) => {
                    const prod = products.find(p => p.id === ig.productId);
                    const insufficient = ig.sourceType !== 'fiche' && prod && prod.currentQty < ig.quantityUsed;
                    return <tr key={i} className={`border-t border-slate-100 ${insufficient ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-2 font-semibold">{ig.productName} {ig.sourceType === 'fiche' && <Badge tone="info">Production</Badge>}</td>
                      <td className="px-2 text-center tabular-nums">{ig.quantityUsed} {ig.unit}</td>
                      <td className={`px-2 text-center tabular-nums ${insufficient ? 'text-red-600 font-bold' : ''}`}>{prod ? `${prod.currentQty}` : '—'}</td>
                      <td className="px-3 text-right font-bold tabular-nums">{money(ig.lineCost)}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </div>

            {/* Step 4: loss */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-bold text-slate-700">4. Déclarer une perte de production</p><p className="text-xs text-slate-400">Évaporation, casse, non-conformité…</p></div>
                <Switch checked={hasLoss} onChange={setHasLoss} />
              </div>
              {hasLoss && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Quantité réellement produite"><Input type="number" value={realQty} onChange={e => setRealQty(Number(e.target.value))} /></Field>
                  <div className="rounded-xl bg-red-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Perte calculée</p><p className="font-black text-red-600 tabular-nums">{lossQty} {selectedFiche.sellUnit} • {money(lossQty * costPerUnit)}</p></div>
                  <div className="sm:col-span-2"><Field label="Description de la perte"><Textarea value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder="Ex: évaporation lors de la cuisson" /></Field></div>
                </div>
              )}
            </div>

            {/* Recap */}
            <div className="rounded-2xl bg-[#001f5c] text-white p-4 grid grid-cols-3 gap-3">
              <div><p className="text-[10px] uppercase font-bold text-blue-200">Coût total</p><p className="font-black tabular-nums">{money(totalCost)}</p></div>
              <div><p className="text-[10px] uppercase font-bold text-blue-200">Valeur vente</p><p className="font-black tabular-nums text-[#FFB800]">{money(totalValue)}</p></div>
              <div><p className="text-[10px] uppercase font-bold text-blue-200">Gains nets</p><p className="font-black tabular-nums text-emerald-300">{money(totalValue - totalCost)}</p></div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Fiches tab ─────────────────────────────────────────────────────────────────
function FichesTab({ moduleKey }: { moduleKey: ModuleKey }) {
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'production');
  const { fiches } = biz.state;
  const [search, setSearch] = useState('');
  // Tableau par défaut : les recettes se lisent côte à côte (coût, prix, gain).
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [editing, setEditing] = useState<BizFiche | null>(null);
  const [toDelete, setToDelete] = useState<BizFiche | null>(null);

  const filtered = fiches.filter(f => matchesSearch(search, f.name));
  const del = () => { if (toDelete) { biz.remove('fiches', toDelete.id); toast.success('Fiche supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-5">
      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom de fiche…" />
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>
      {filtered.length === 0 ? <EmptyState icon={FileText} title="Aucune fiche technique" message="Créez une recette de fabrication." /> : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Fiche</th><th className="table-head">Catégorie</th>
          <th className="table-head text-right">Ingrédients</th><th className="table-head text-right">Rendement</th>
          <th className="table-head text-right">Coût unitaire</th><th className="table-head text-right">Prix vente</th>
          <th className="table-head text-right">Gain / unité</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(f => (
            <tr key={f.id}>
              <td className="table-cell">
                <div className="font-bold text-slate-700 flex items-center gap-1.5">
                  {f.name}
                  {f.usableInProduction && <Badge tone="info">Semi-fini</Badge>}
                </div>
              </td>
              <td className="table-cell">{f.categoryName ? <Badge tone="primary">{f.categoryName}</Badge> : <span className="text-slate-400">—</span>}</td>
              <td className="table-cell tabular-nums text-right">{f.ingredients.length}</td>
              <td className="table-cell tabular-nums text-right">{f.outputQuantity} {f.sellUnit || ''}</td>
              <td className="table-cell tabular-nums text-right">{money(f.costPerUnit)}</td>
              <td className="table-cell tabular-nums text-right">{money(f.unitPrice)}</td>
              <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(f.gainsPerUnit)}</td>
              <td className="table-cell text-right">
                <RowActions>
                  <ActionBtn icon={Eye} tone="amber" title="Modifier" onClick={() => setEditing(f)} />
                  {perm.supprimer && <ActionBtn icon={Trash} tone="red" title="Supprimer" onClick={() => setToDelete(f)} />}
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(f => (
            <GlassCard key={f.id}>
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="font-black text-slate-800">{f.name}</h3>{f.categoryName && <Badge tone="primary">{f.categoryName}</Badge>}</div>
                {f.usableInProduction && <Badge tone="info">Semi-fini</Badge>}
              </div>
              <div className="mt-3 space-y-1.5 text-sm">
                <Row k="Ingrédients" v={`${f.ingredients.length}`} />
                <Row k="Rendement" v={`${f.outputQuantity} ${f.sellUnit || ''}`} />
                <Row k="Coût unitaire" v={money(f.costPerUnit)} />
                <Row k="Prix vente" v={money(f.unitPrice)} />
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-100"><span className="text-slate-500 font-semibold">Gain / unité</span><span className="font-black tabular-nums text-emerald-600">{money(f.gainsPerUnit)}</span></div>
              </div>
              <div className="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
                <RowActions>
                  <ActionBtn icon={Eye} tone="amber" title="Modifier" onClick={() => setEditing(f)} />
                  {perm.supprimer && <ActionBtn icon={Trash} tone="red" title="Supprimer" onClick={() => setToDelete(f)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}
      {editing && <FicheForm moduleKey={moduleKey} initial={editing} onClose={() => setEditing(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la fiche" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Fiche form ─────────────────────────────────────────────────────────────────
function FicheForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizFiche | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { products, fiches, categories } = biz.state;
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name || '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [sellUnit, setSellUnit] = useState(initial?.sellUnit || 'part');
  const [usableInProduction, setUsable] = useState(!!initial?.usableInProduction);
  const [directSale, setDirectSale] = useState(!!initial?.directSale);
  const [outputQuantity, setOutput] = useState(initial?.outputQuantity || 1);
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice || 0);
  const [ingredients, setIngredients] = useState<BizIngredient[]>(initial?.ingredients || []);
  const [query, setQuery] = useState('');
  const [showCat, setShowCat] = useState(false);
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl || '');
  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `fiche_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const url = await uploadFile('products', fileName, file);
      if (url) {
        setImageUrl(url);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => setImageUrl(reader.result as string);
        reader.readAsDataURL(file);
      }
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => setImageUrl(reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
    }
  };

  const reusable = fiches.filter(f => f.usableInProduction && f.id !== initial?.id);
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const fromStock = products.filter(p => matchesSearch(query, p.name, p.barcode)).map(p => ({ type: 'stock' as const, id: p.id, name: p.name, cost: p.purchasePrice, unit: p.unit }));
    const fromFiche = reusable.filter(f => matchesSearch(query, f.name)).map(f => ({ type: 'fiche' as const, id: f.id, name: f.name, cost: f.costPerUnit, unit: f.productUnit || f.sellUnit }));
    return [...fromStock, ...fromFiche].slice(0, 6);
  }, [products, reusable, query]);

  const addIng = (m: { type: 'stock' | 'fiche'; id: string; name: string; cost: number; unit?: string }) => {
    if (ingredients.some(i => i.productId === m.id)) return;
    setIngredients(prev => [...prev, { productId: m.id, productName: m.name, quantityUsed: 1, unitCost: m.cost, lineCost: m.cost, unit: m.unit, sourceType: m.type }]);
    setQuery('');
  };
  const updIng = (id: string, qty: number) => setIngredients(prev => prev.map(i => i.productId === id ? { ...i, quantityUsed: qty, lineCost: +(qty * i.unitCost).toFixed(2) } : i));
  const rmIng = (id: string) => setIngredients(prev => prev.filter(i => i.productId !== id));

  const totalCost = ingredients.reduce((s, i) => s + i.lineCost, 0);
  const costPerUnit = outputQuantity > 0 ? totalCost / outputQuantity : 0;
  const totalValue = outputQuantity * unitPrice;

  const save = () => {
    if (!name.trim()) { toast.error('Nom requis'); return; }
    const fiche: BizFiche = {
      id: initial?.id || newId(), name: name.trim(), categoryId, categoryName: categories.find(c => c.id === categoryId)?.name,
      description, ingredients, sellByUnit: true, sellUnit, usableInProduction, productUnit: sellUnit, directSale,
      outputQuantity, unitPrice, totalCost: +totalCost.toFixed(2), costPerUnit: +costPerUnit.toFixed(2),
      totalValue: +totalValue.toFixed(2), gainsPerUnit: +(unitPrice - costPerUnit).toFixed(2), totalGains: +(totalValue - totalCost).toFixed(2),
      imageUrl: imageUrl || undefined,
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    if (isEdit) biz.update('fiches', fiche); else biz.add('fiches', fiche);
    toast.success(isEdit ? 'Fiche modifiée' : 'Fiche créée');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={FileText} size="xl" title={isEdit ? 'Modifier la fiche' : 'Nouvelle fiche technique'} subtitle="Recette de fabrication"
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save} disabled={uploadingImage}>{isEdit ? 'Enregistrer' : 'Créer'}</button></>}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <Field label="Nom du produit" required><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Couscous royal" /></Field>
          
          {/* Photo field */}
          <Field label="Photo du produit" hint="Affichée sur les cartes du point de vente (POS).">
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
              {imageUrl ? (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shrink-0 bg-white shadow-sm">
                  <img src={imageUrl} alt="Aperçu" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 shadow-md hover:bg-red-700 transition-colors"
                    title="Supprimer l'image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center bg-white text-slate-400 shrink-0">
                  <ImageIcon className="w-6 h-6 mb-1" />
                  <span className="text-[10px] font-bold">Sans image</span>
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                <label className="btn-secondary !py-2 !px-3.5 inline-flex items-center gap-2 cursor-pointer text-xs font-bold">
                  <Upload className="w-4 h-4 text-[#003087]" />
                  {uploadingImage ? 'Téléchargement…' : imageUrl ? "Changer la photo" : 'Choisir une photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={handleImageChange}
                  />
                </label>
                <p className="text-[11px] text-slate-400">Stockée dans le bucket Supabase « products ».</p>
              </div>
            </div>
          </Field>

          <Field label="Catégorie">
            <div className="flex gap-2">
              <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">— Sélectionner —</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowCat(s => !s)}>+</button>
            </div>
            {showCat && <div className="mt-2"><InlineCreate placeholder="Nouvelle catégorie" onCreate={n => { const it = { id: newId(), name: n }; biz.add('categories', it); setCategoryId(it.id); setShowCat(false); }} /></div>}
          </Field>
          <Field label="Description / procédé"><Textarea value={description} onChange={e => setDescription(e.target.value)} /></Field>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <div><p className="text-sm font-bold text-slate-700">Réutilisable en production</p><p className="text-xs text-slate-400">Comme ingrédient semi-fini</p></div>
            <Switch checked={usableInProduction} onChange={setUsable} />
          </div>
          {/* Vente rapide : la fiche s'affiche directement au point de vente et
              ses ingrédients sont déduits du stock à la vente — sans production. */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-700">Vente directe au comptoir</p>
              <p className="text-xs text-slate-400">Affichée au point de vente (ex: café au lait) — stock déduit à la vente</p>
            </div>
            <Switch checked={directSale} onChange={setDirectSale} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unité de vente"><Select value={sellUnit} onChange={e => setSellUnit(e.target.value)}>{['part', 'unité', 'kg', 'L', 'tasse', 'flacon', 'bidon'].map(u => <option key={u}>{u}</option>)}</Select></Field>
            <Field label="Rendement"><Input type="number" value={outputQuantity} onChange={e => setOutput(Number(e.target.value))} /></Field>
          </div>
          <Field label="Prix de vente unitaire (DA)"><Input type="number" value={unitPrice} onChange={e => setUnitPrice(Number(e.target.value))} /></Field>
          <div className="rounded-2xl bg-[#001f5c] text-white p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-blue-200">Coût ingrédients</span><span className="font-bold tabular-nums">{money(totalCost)}</span></div>
            <div className="flex justify-between"><span className="text-blue-200">Coût de revient / unité</span><span className="font-bold tabular-nums">{money(costPerUnit)}</span></div>
            <div className="flex justify-between"><span className="text-blue-200">Valeur vente totale</span><span className="font-bold tabular-nums text-[#FFB800]">{money(totalValue)}</span></div>
            <div className="flex justify-between pt-1.5 border-t border-white/10"><span className="text-blue-200">Gain net total</span><span className="font-black tabular-nums text-emerald-300">{money(totalValue - totalCost)}</span></div>
          </div>
        </div>

        {/* Ingredients */}
        <div className="lg:col-span-2">
          <label className="label-field">Ingrédients & dosages</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher produit ou fiche réutilisable…" className="input-field pl-9" />
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                {matches.map(m => (
                  <button key={m.id} onClick={() => addIng(m)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">{m.name} {m.type === 'fiche' && <Badge tone="info">Production</Badge>}</span>
                    <span className="text-xs text-slate-400">{money(m.cost)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {ingredients.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50"><th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-slate-400">Ingrédient</th><th className="px-2 text-[11px] font-bold uppercase text-slate-400">Qté</th><th className="px-2 text-[11px] font-bold uppercase text-slate-400">Coût unit.</th><th className="px-3 text-right text-[11px] font-bold uppercase text-slate-400">Total</th><th></th></tr></thead>
                <tbody>{ingredients.map(ig => (
                  <tr key={ig.productId} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{ig.productName} {ig.sourceType === 'fiche' && <Badge tone="info">Production</Badge>}</td>
                    <td className="px-2"><input type="number" step="0.001" value={ig.quantityUsed} onChange={e => updIng(ig.productId, Number(e.target.value))} className="input-field !py-1.5 !px-2 w-20 text-center" /> <span className="text-xs text-slate-400">{ig.unit}</span></td>
                    <td className="px-2 text-center tabular-nums">{money(ig.unitCost)}</td>
                    <td className="px-3 text-right font-bold tabular-nums">{money(ig.lineCost)}</td>
                    <td className="px-2"><button onClick={() => rmIng(ig.productId)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><X className="w-4 h-4" /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
