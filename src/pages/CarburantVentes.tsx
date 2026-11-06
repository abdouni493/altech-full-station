/**
 * ─── Ventes Carburant ───────────────────────────────────────────────────────────
 * Factures de vente de la partie Carburant :
 *   1. Client — recherche + sélection, ou création sur place (même formulaire
 *      que l'écran Clients) ;
 *   2. Produits — plusieurs lignes : carburant (cuve), produits d'une armoire,
 *      produits d'un magasin ; quantités, prix, total ;
 *   3. Remise, TVA et autres taxes (modèles réutilisables) — inclus au total ;
 *   4. Règlement — tout payé ou montant saisi ; le reste devient une dette du
 *      client, visible dans son historique.
 *
 * Chaque facture reçoit un numéro de série (FV-AAAA-0001). Son enregistrement
 * décrémente le stock de chaque ligne (cuve, armoire, magasin) ; une
 * modification ou une suppression rend d'abord ce que la version précédente
 * avait pris. La part payée en espèces entre dans la caisse Carburant ; un
 * règlement par chèque / virement / TPE crédite le compte bancaire choisi.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Receipt, Plus, Search, Fuel, Archive, Store, X, User, UserPlus, Trash2, Eye, Edit2, Printer,
  Wallet, CircleDollarSign, TrendingUp, FileText, Percent, Banknote, CheckCircle2, AlertTriangle, Package,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch, cn } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  ShopSale, CarburantInvoiceLine, CarburantInvoiceMeta, Client, MagasinKey, TreasuryTransaction,
} from '../store/AppContext';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Switch, Confirm,
  Table, EmptyState, SearchInput, RowActions, ActionBtn, FormSection, StaticField,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '../components/biz/Kit';
import TaxesEditor from '../components/TaxesEditor';
import { AppliedTax, computeTaxes, sumTaxes, taxLabel } from '../lib/taxes';
import { NewClientModal } from '../components/clients/ClientFormModal';
import { useBizAll } from '../store/BizContext';
import { magasinProducts, magasinLabel } from '../lib/armoires';
import { useMagasinStockMover } from '../components/armoires/StockTransferBuilder';
import { printPurchaseInvoice, stationFromSettings } from './modules/_shared';
import { clientLedgers } from '../lib/clientLedger';

const todayISO = () => new Date().toISOString().split('T')[0];
const fmtQ = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

const PAY_MODES = [
  { id: 'ESPECES', label: 'Espèces', bank: false },
  { id: 'CHEQUE', label: 'Chèque', bank: true },
  { id: 'VIREMENT', label: 'Virement', bank: true },
  { id: 'TPE', label: 'TPE / Carte', bank: true },
  { id: 'AVANCE', label: "Sur l'avance du client", bank: false },
] as const;

const SOURCE_META = {
  CARBURANT: { label: 'Carburant', icon: Fuel, tone: 'bg-amber-100 text-amber-700' },
  ARMOIRE: { label: 'Armoire', icon: Archive, tone: 'bg-indigo-100 text-indigo-700' },
  MAGASIN: { label: 'Magasin', icon: Store, tone: 'bg-emerald-100 text-emerald-700' },
} as const;

const isInvoice = (s: ShopSale) => s.invoice?.kind === 'CARBURANT';

/** Clé de stock d'une ligne : la même source + le même produit. */
const stockKey = (l: Pick<CarburantInvoiceLine, 'source' | 'sourceId' | 'productId'>) => `${l.source}|${l.sourceId}|${l.productId || ''}`;

export default function CarburantVentes() {
  const app = useAppState();
  const { shopSales = [], clients = [], settings, bankAccounts = [], treasuryTransactions = [] } = app;
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Ventes Carburant');
  const moveMagasin = useMagasinStockMover();

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Payé' | 'Dette'>('ALL');
  const [editing, setEditing] = useState<ShopSale | null | 'new'>(null);
  const [viewing, setViewing] = useState<ShopSale | null>(null);
  const [toDelete, setToDelete] = useState<ShopSale | null>(null);

  const invoices = useMemo(() => shopSales.filter(isInvoice)
    .sort((a, b) => (b.invoice!.seq || 0) - (a.invoice!.seq || 0)), [shopSales]);
  const filtered = useMemo(() => invoices.filter(s => {
    if (!inPeriod(s.date, period, from, to)) return false;
    if (statusFilter !== 'ALL' && (statusFilter === 'Payé' ? s.rest > 0.009 : s.rest <= 0.009)) return false;
    if (!search) return true;
    const client = clients.find(c => c.id === s.clientId);
    return matchesSearch(search, s.invoice!.number, s.invoice!.clientName, client?.name, client?.phone);
  }), [invoices, period, from, to, statusFilter, search, clients]);

  const stats = {
    count: filtered.length,
    total: filtered.reduce((a, s) => a + (s.total || 0), 0),
    paid: filtered.reduce((a, s) => a + (s.amountPaid || 0), 0),
    rest: filtered.reduce((a, s) => a + (s.rest || 0), 0),
    taxes: filtered.reduce((a, s) => a + (s.tvaAmount || 0) + (s.invoice?.taxesAmount || 0), 0),
  };

  /** Applique (sign = −1 : sortie) ou rend (+1) le stock des lignes d'une facture. */
  const applyStock = (lines: CarburantInvoiceLine[], sign: number) => {
    const tanks: { tankId: string; deltaLiters: number }[] = [];
    const arm: { armoireId: string; moduleKey?: MagasinKey; productId: string; quantity: number }[] = [];
    const mag: { moduleKey: MagasinKey; productId: string; qty: number; empty: number }[] = [];
    lines.forEach(l => {
      const q = (Number(l.quantity) || 0) * sign;
      if (!q) return;
      if (l.source === 'CARBURANT') tanks.push({ tankId: l.sourceId, deltaLiters: q });
      else if (l.source === 'ARMOIRE' && l.productId) arm.push({ armoireId: l.sourceId, productId: l.productId, quantity: q, moduleKey: (l as any).moduleKey });
      else if (l.source === 'MAGASIN' && l.productId) mag.push({ moduleKey: l.sourceId as MagasinKey, productId: l.productId, qty: -q, empty: 0 });
    });
    if (tanks.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: tanks });
    if (arm.length) dispatch({ type: 'ADJUST_ARMOIRE_STOCK', payload: arm });
    if (mag.length) moveMagasin(mag);
  };

  const removeTreasury = (saleId: string) => treasuryTransactions
    .filter(t => t.refType === 'carburant_invoice' && t.refId === saleId)
    .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));

  const doDelete = () => {
    if (!toDelete) return;
    applyStock(toDelete.invoice!.lines, +1);
    removeTreasury(toDelete.id);
    dispatch({ type: 'DELETE_SHOP_SALE', payload: toDelete.id });
    toast.success(`Facture ${toDelete.invoice!.number} supprimée — stock rendu`);
    setToDelete(null);
  };

  const doPrint = (s: ShopSale) => {
    const inv = s.invoice!;
    const client = clients.find(c => c.id === s.clientId);
    const bank = bankAccounts.find(b => b.id === inv.bankAccountId);
    printPurchaseInvoice({
      title: 'Facture de vente',
      ref: inv.number,
      date: s.date,
      createdAt: inv.createdAt,
      createdBy: inv.createdBy,
      station: stationFromSettings(settings),
      supplier: {
        label: 'Client',
        name: client?.name || inv.clientName || 'Client comptant',
        phone: client?.phone,
        address: client?.address,
      },
      info: [
        { label: 'N° facture', value: inv.number },
        { label: 'Statut', value: s.rest > 0.009 ? (s.amountPaid > 0 ? 'Dette partielle' : 'Dette') : 'Payé' },
        { label: 'Mode de paiement', value: PAY_MODES.find(m => m.id === s.paymentMode)?.label || s.paymentMode },
        ...(client?.nif ? [{ label: 'NIF', value: client.nif }] : []),
        ...(client?.rc ? [{ label: 'RC', value: client.rc }] : []),
        ...(client?.nis ? [{ label: 'NIS', value: client.nis }] : []),
        ...(client?.article ? [{ label: 'Article', value: client.article }] : []),
      ],
      items: inv.lines.map(l => ({
        name: `${l.productName}${l.sourceName ? ` — ${l.sourceName}` : ''}`,
        qty: `${fmtQ(l.quantity)} ${l.unit || ''}`.trim(),
        unitPrice: l.price,
        total: l.total,
      })),
      subtotal: s.subtotal + (inv.discountAmount || 0),
      reduction: inv.discountAmount,
      tva: s.tvaAmount,
      taxes: (inv.taxes || []).map(t => ({ label: taxLabel(t), amount: t.amount })),
      total: s.total, paid: s.amountPaid || 0, rest: s.rest || 0,
      payments: (s.amountPaid || 0) > 0 ? [{
        label: `${PAY_MODES.find(m => m.id === s.paymentMode)?.label || s.paymentMode}${bank ? ` — ${bank.name}` : ''}`,
        amount: s.amountPaid || 0,
        reference: s.chequeNumber || s.bonNumber || '',
      }] : [],
      notes: s.notes,
      partySignLabel: 'Signature Client',
      footerNote: `${settings.name || 'Station'} — Merci de votre confiance.`,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={Receipt} title="Ventes Carburant" subtitle="Factures de vente — carburant, produits d'armoires et de magasins"
        actions={perm.creer ? (
          <button className="btn-primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Nouvelle vente</button>
        ) : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={FileText} label="Factures" value={String(stats.count)} tone="blue" />
        <StatCard icon={TrendingUp} label="Chiffre d'affaires" value={money(stats.total)} tone="purple" />
        <StatCard icon={Wallet} label="Encaissé" value={money(stats.paid)} tone="green" />
        <StatCard icon={CircleDollarSign} label="Reste dû (dettes)" value={money(stats.rest)} tone="red" />
        <StatCard icon={Percent} label="TVA & taxes" value={money(stats.taxes)} tone="amber" />
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder="N° de facture ou nom du client…" /></div>
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="lg:!w-48">
            <option value="ALL">Tous les statuts</option>
            <option value="Payé">Payées</option>
            <option value="Dette">Avec reste dû</option>
          </Select>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="Aucune facture de vente"
          message="Créez une vente : choisissez le client, les produits, les taxes et le règlement."
          action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Nouvelle vente</button>} />
      ) : (
        <Table head={<>
          <th className="table-head">N° facture</th><th className="table-head">Date</th><th className="table-head">Client</th>
          <th className="table-head">Articles</th><th className="table-head text-right">Total</th>
          <th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th>
          <th className="table-head">Statut</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(s => {
            const client = clients.find(c => c.id === s.clientId);
            const inv = s.invoice!;
            return (
              <tr key={s.id}>
                <td className="table-cell font-black text-[#002d87]">{inv.number}</td>
                <td className="table-cell">{formatDate(s.date)}</td>
                <td className="table-cell font-bold text-slate-700">{client?.name || inv.clientName || '—'}</td>
                <td className="table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(['CARBURANT', 'ARMOIRE', 'MAGASIN'] as const).filter(src => inv.lines.some(l => l.source === src)).map(src => (
                      <span key={src} className={cn('px-1.5 py-0.5 rounded text-[9px] font-black uppercase', SOURCE_META[src].tone)}>
                        {SOURCE_META[src].label} · {inv.lines.filter(l => l.source === src).length}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="table-cell text-right tabular-nums font-black">{money(s.total)}</td>
                <td className="table-cell text-right tabular-nums text-emerald-600">{money(s.amountPaid || 0)}</td>
                <td className="table-cell text-right tabular-nums text-red-600">{money(s.rest || 0)}</td>
                <td className="table-cell"><Badge tone={s.rest > 0.009 ? (s.amountPaid > 0 ? 'warning' : 'danger') : 'success'}>{s.rest > 0.009 ? (s.amountPaid > 0 ? 'Partiel' : 'Dette') : 'Payé'}</Badge></td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir détails" onClick={() => setViewing(s)} />
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(s)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(s)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {editing && (
        <SaleForm
          initial={editing === 'new' ? null : editing}
          invoices={invoices}
          onClose={() => setEditing(null)}
          applyStock={applyStock}
          removeTreasury={removeTreasury}
          onSaved={(s, print) => { setEditing(null); if (print) doPrint(s); }}
        />
      )}
      {viewing && <SaleDetail sale={viewing} onClose={() => setViewing(null)} onPrint={() => doPrint(viewing)}
        onEdit={perm.modifier ? () => { setEditing(viewing); setViewing(null); } : undefined} />}
      <Confirm open={!!toDelete} title="Supprimer la facture"
        message={`Supprimer la facture ${toDelete?.invoice?.number} ?\nLe stock de chaque produit sera rendu et le règlement annulé.`}
        onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Formulaire ──────────────────────────────────────────────────────────────
interface Line extends CarburantInvoiceLine { moduleKey?: MagasinKey; available?: number }

function SaleForm({ initial, invoices, onClose, onSaved, applyStock, removeTreasury }: {
  initial: ShopSale | null;
  invoices: ShopSale[];
  onClose: () => void;
  onSaved: (s: ShopSale, print: boolean) => void;
  applyStock: (lines: CarburantInvoiceLine[], sign: number) => void;
  removeTreasury: (saleId: string) => void;
}) {
  const app = useAppState();
  const { clients = [], tanks = [], armoires = [], armoireStock = [], settings, bankAccounts = [], currentUserName } = app;
  const dispatch = useAppDispatch();
  const biz = useBizAll();
  const inv = initial?.invoice;

  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : todayISO());
  const [clientId, setClientId] = useState(initial?.clientId || '');
  const [clientQuery, setClientQuery] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => (inv?.lines || []).map(l => ({ ...l })));
  const [source, setSource] = useState<'CARBURANT' | 'ARMOIRE' | 'MAGASIN'>('CARBURANT');
  const [armoireId, setArmoireId] = useState(armoires[0]?.id || '');
  const [productQuery, setProductQuery] = useState('');
  const [discountOn, setDiscountOn] = useState(!!inv?.discountAmount);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(inv?.discountType || 'percent');
  const [discountValue, setDiscountValue] = useState(String(inv?.discountValue ?? ''));
  const [tvaActive, setTvaActive] = useState(!!inv?.tvaActive);
  const [tvaRate, setTvaRate] = useState(String(inv?.tvaRate ?? 19));
  const [taxesRaw, setTaxes] = useState<AppliedTax[]>(inv?.taxes || []);
  const [payMode, setPayMode] = useState<string>(initial?.paymentMode || 'ESPECES');
  const [bankAccountId, setBankAccountId] = useState(inv?.bankAccountId || bankAccounts[0]?.id || '');
  const [reference, setReference] = useState(initial?.chequeNumber || '');
  const [paidAll, setPaidAll] = useState(initial ? (initial.rest || 0) <= 0.009 : true);
  const [paidAmount, setPaidAmount] = useState(String(initial?.amountPaid ?? ''));
  const [notes, setNotes] = useState(initial?.notes || '');

  const client = clients.find(c => c.id === clientId);
  const ledgers = useMemo(() => clientLedgers(app), [app]);
  const clientMatches = useMemo(() => {
    const q = clientQuery.trim();
    if (!q) return clients.slice(0, 8);
    return clients.filter(c => matchesSearch(q, c.name, c.phone, c.cin, c.nif)).slice(0, 8);
  }, [clients, clientQuery]);

  // ── Catalogue de la source choisie ──
  const magProducts = useMemo(() => magasinProducts(biz), [biz, settings.magasin2Enabled]);
  const productOf = (id?: string) => magProducts.find(m => m.product.id === id);
  /** Ce que la facture d'origine avait déjà pris (rendu en édition). */
  const prevTaken = useMemo(() => {
    const m = new Map<string, number>();
    (inv?.lines || []).forEach(l => m.set(stockKey(l), (m.get(stockKey(l)) || 0) + l.quantity));
    return m;
  }, [inv]);
  const availableOf = (l: Pick<Line, 'source' | 'sourceId' | 'productId'>): number => {
    const back = prevTaken.get(stockKey(l)) || 0;
    if (l.source === 'CARBURANT') return (tanks.find(t => t.id === l.sourceId)?.current || 0) + back;
    if (l.source === 'ARMOIRE') {
      const st = armoireStock.find(s => s.armoireId === l.sourceId && s.productId === l.productId);
      return (st ? st.quantity - (st.emptyQuantity || 0) : 0) + back;
    }
    return (productOf(l.productId)?.product.currentQty || 0) + back;
  };

  const catalogue = useMemo(() => {
    const q = productQuery.trim();
    if (source === 'CARBURANT') {
      return tanks.map(t => ({
        key: `T:${t.id}`, name: `${t.type}`, sub: `${t.name} · ${fmtQ(t.current)} L en cuve`,
        price: (settings.fuelPrices as any)?.[t.type] || 0, unit: 'L',
        line: { source: 'CARBURANT' as const, sourceId: t.id, sourceName: t.name, productId: t.type, productName: t.type, unit: 'L', unitCost: (settings.fuelBuyPrices as any)?.[t.type] || 0 },
      })).filter(x => !q || matchesSearch(q, x.name, x.sub));
    }
    if (source === 'ARMOIRE') {
      const a = armoires.find(x => x.id === armoireId);
      if (!a) return [];
      return armoireStock.filter(st => st.armoireId === a.id).map(st => {
        const mp = productOf(st.productId);
        if (!mp) return null;
        const p = mp.product;
        const avail = st.quantity - (st.emptyQuantity || 0);
        return {
          key: `A:${a.id}:${p.id}`, name: p.name, sub: `${a.name} · ${fmtQ(avail)} ${p.unit || 'u.'} en armoire`,
          price: p.salePrice || 0, unit: p.unit || 'u.',
          line: { source: 'ARMOIRE' as const, sourceId: a.id, sourceName: a.name, productId: p.id, productName: p.name, unit: p.unit || 'u.', moduleKey: mp.moduleKey, unitCost: p.averageCost || p.purchasePrice || 0 },
        };
      }).filter(Boolean).filter((x: any) => !q || matchesSearch(q, x.name)) as any[];
    }
    return magProducts.map(({ product: p, moduleKey }) => ({
      key: `M:${moduleKey}:${p.id}`, name: p.name, sub: `${magasinLabel(moduleKey)} · ${fmtQ(p.currentQty || 0)} ${p.unit || 'u.'} en stock`,
      price: p.salePrice || 0, unit: p.unit || 'u.',
      line: { source: 'MAGASIN' as const, sourceId: moduleKey, sourceName: magasinLabel(moduleKey), productId: p.id, productName: p.name, unit: p.unit || 'u.', unitCost: p.averageCost || p.purchasePrice || 0 },
    })).filter(x => !q || matchesSearch(q, x.name, (x as any).sub)).slice(0, 40);
  }, [source, tanks, armoires, armoireId, armoireStock, magProducts, productQuery, settings]);

  const addLine = (c: any) => {
    const existing = lines.find(l => stockKey(l) === stockKey(c.line));
    if (existing) { patchLine(existing.id, { quantity: existing.quantity + 1 }); return; }
    setLines(prev => [...prev, { id: newId(), ...c.line, quantity: 1, price: c.price, total: c.price }]);
  };
  const patchLine = (id: string, p: Partial<Line>) => setLines(prev => prev.map(l => {
    if (l.id !== id) return l;
    const n = { ...l, ...p };
    n.total = Math.round((Number(n.quantity) || 0) * (Number(n.price) || 0) * 100) / 100;
    return n;
  }));

  // ── Totaux ──
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const discountAmount = !discountOn ? 0 : discountType === 'percent'
    ? subtotal * (Number(discountValue) || 0) / 100 : Math.min(subtotal, Number(discountValue) || 0);
  const ht = Math.max(0, subtotal - discountAmount);
  const tvaAmount = tvaActive ? Math.round(ht * (Number(tvaRate) || 0)) / 100 : 0;
  const taxes = useMemo(() => computeTaxes(ht, taxesRaw), [ht, taxesRaw]);
  const taxesAmount = sumTaxes(taxes);
  const total = Math.round((ht + tvaAmount + taxesAmount) * 100) / 100;
  const paid = Math.min(total, paidAll ? total : Math.max(0, Number(paidAmount) || 0));
  const rest = Math.max(0, Math.round((total - paid) * 100) / 100);
  const needsBank = !!PAY_MODES.find(m => m.id === payMode)?.bank;
  const stockIssues = lines.filter(l => l.quantity > availableOf(l) + 1e-9);

  const nextSeq = () => invoices.reduce((m, s) => Math.max(m, s.invoice?.seq || 0), 0) + 1;

  const save = (print: boolean) => {
    if (!clientId) { toast.error('Sélectionnez ou créez le client'); return; }
    if (lines.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (lines.some(l => !(l.quantity > 0))) { toast.error('Chaque ligne doit avoir une quantité'); return; }
    if (needsBank && paid > 0 && !bankAccountId) { toast.error('Choisissez le compte bancaire crédité'); return; }
    if (payMode === 'AVANCE' && rest > 0) { /* le reste reste une dette */ }

    const id = initial?.id || newId();
    const seq = inv?.seq || nextSeq();
    const number = inv?.number || `FV-${new Date(date).getFullYear()}-${String(seq).padStart(4, '0')}`;
    const cleanLines: CarburantInvoiceLine[] = lines.map(({ available, ...l }) => l);
    const meta: CarburantInvoiceMeta = {
      kind: 'CARBURANT', number, seq, clientName: client?.name,
      lines: cleanLines,
      discountType: discountOn ? discountType : undefined,
      discountValue: discountOn ? Number(discountValue) || 0 : undefined,
      discountAmount,
      tvaActive, tvaRate: Number(tvaRate) || 0,
      taxes, taxesAmount,
      bankAccountId: needsBank ? bankAccountId : undefined,
      createdBy: inv?.createdBy || currentUserName,
      createdAt: inv?.createdAt || new Date().toISOString(),
      updatedAt: initial ? new Date().toISOString() : undefined,
    };
    const sale: ShopSale = {
      id, date: new Date(date).toISOString(), clientId,
      items: cleanLines.map(l => ({ productId: l.productId || '', productName: `${l.productName}${l.source === 'CARBURANT' ? ' (L)' : ''}`, quantity: l.quantity, price: l.price })),
      subtotal: ht, tvaAmount, total,
      paymentMode: (payMode === 'VIREMENT' || payMode === 'TPE' ? 'CHEQUE' : payMode) as any,
      chequeNumber: reference || undefined,
      bonNumber: number,
      amountPaid: paid, rest,
      status: rest > 0.009 ? 'Dette' : 'Payé',
      notes: notes || undefined,
      invoice: meta,
    };
    // Le mode réel est gardé tel quel (le type historique ne connaît pas tous les modes).
    (sale as any).paymentMode = payMode;

    // Stock : rendre l'ancienne version, puis sortir la nouvelle.
    if (inv) applyStock(inv.lines, +1);
    applyStock(cleanLines, -1);

    // Règlement non espèces → compte bancaire.
    if (initial) removeTreasury(id);
    if (needsBank && paid > 0 && bankAccountId) {
      const tx: TreasuryTransaction = {
        id: newId(), date: sale.date, kind: 'SALE', amount: paid,
        description: `Facture ${number} — ${client?.name || ''}`.trim(),
        accountTo: bankAccountId, part: 'carburant',
        refType: 'carburant_invoice', refId: id,
        chequeNumber: payMode === 'CHEQUE' ? (reference || undefined) : undefined,
        bordereauNumber: payMode !== 'CHEQUE' ? (reference || undefined) : undefined,
        createdBy: currentUserName, createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
    }

    dispatch({ type: initial ? 'UPDATE_SHOP_SALE' : 'ADD_SHOP_SALE', payload: sale });
    toast.success(initial ? `Facture ${number} modifiée` : `Facture ${number} enregistrée`);
    onSaved(sale, print);
  };

  const ledger = client ? ledgers[client.id] : undefined;

  return (
    <>
      <Modal open onClose={onClose} icon={Receipt} size="3xl" fullHeight formScale
        title={initial ? `Modifier la facture ${inv?.number}` : 'Nouvelle vente'}
        subtitle="Client, produits, taxes et règlement"
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-outline" onClick={() => save(true)}><Printer className="w-4 h-4" /> Enregistrer & imprimer</button>
          <button className="btn-primary" onClick={() => save(false)}><CheckCircle2 className="w-4 h-4" /> Enregistrer — {money(total)}</button>
        </>}>
        <div className="space-y-6">
          {/* 1. Client */}
          <FormSection step={1} icon={User} title="Client" hint="Recherchez le client ou créez-le sur place">
            {client ? (
              <div className="rounded-2xl border-2 border-[#003087]/20 bg-[#eef3fc] p-4 flex flex-wrap items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-lg font-black">{client.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[#001f5c] truncate">{client.name}</p>
                  <p className="text-xs font-bold text-slate-500">{[client.phone, client.type, client.paymentMode === 'CREDIT' ? 'Crédit' : client.paymentMode === 'ADVANCE' ? 'Avance' : 'Comptant'].filter(Boolean).join(' · ')}</p>
                </div>
                {ledger && (
                  <div className="flex gap-2">
                    <div className="rounded-xl bg-white px-3 py-2 border border-red-100"><p className="text-[9px] font-black uppercase text-slate-400">Dette</p><p className="font-black text-red-600 text-sm tabular-nums">{money(ledger.netDebt ?? 0)}</p></div>
                    <div className="rounded-xl bg-white px-3 py-2 border border-emerald-100"><p className="text-[9px] font-black uppercase text-slate-400">Avance</p><p className="font-black text-emerald-600 text-sm tabular-nums">{money(ledger.advanceLeft ?? 0)}</p></div>
                  </div>
                )}
                <button className="btn-ghost" onClick={() => setClientId('')}><X className="w-4 h-4" /> Changer</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input autoFocus value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Nom, téléphone, CIN, NIF…" className="!pl-9" />
                  </div>
                  <button className="btn-primary shrink-0" onClick={() => setCreatingClient(true)}><UserPlus className="w-4 h-4" /> Nouveau client</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {clientMatches.map(c => (
                    <button key={c.id} onClick={() => { setClientId(c.id); setClientQuery(''); }}
                      className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-[#003087]/40 hover:bg-[#eef3fc] transition-all flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-black">{c.name[0]}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-slate-800 truncate">{c.name}</span>
                        <span className="block text-[11px] font-bold text-slate-400 truncate">{c.phone || c.type}</span>
                      </span>
                    </button>
                  ))}
                  {clientMatches.length === 0 && <p className="text-sm text-slate-400 font-bold p-3">Aucun client — créez-le avec « Nouveau client ».</p>}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <Field label="Date de la facture"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
              <Field label="N° de facture"><StaticField tone="primary">{inv?.number || `FV-${new Date(date).getFullYear()}-${String(nextSeq()).padStart(4, '0')}`}</StaticField></Field>
            </div>
          </FormSection>

          {/* 2. Produits */}
          <FormSection step={2} icon={Package} title="Produits" hint="Carburant, produits d'une armoire ou d'un magasin — plusieurs lignes possibles">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 mb-3">
              {(['CARBURANT', 'ARMOIRE', 'MAGASIN'] as const).map(src => {
                const M = SOURCE_META[src];
                return (
                  <button key={src} onClick={() => { setSource(src); setProductQuery(''); }}
                    className={cn('flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-black uppercase', source === src ? 'bg-white shadow text-[#002d87]' : 'text-slate-500')}>
                    <M.icon className="w-4 h-4" /> {M.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-2">
              {source === 'ARMOIRE' && (
                <Select value={armoireId} onChange={e => setArmoireId(e.target.value)} className="sm:!w-56">
                  {armoires.length === 0 && <option value="">Aucune armoire</option>}
                  {armoires.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              )}
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder="Rechercher un produit…" className="!pl-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
              {catalogue.map((c: any) => {
                const added = lines.some(l => stockKey(l) === stockKey(c.line));
                return (
                  <button key={c.key} onClick={() => addLine(c)}
                    className={cn('text-left rounded-xl border p-2.5 transition-all', added ? 'border-[#003087] bg-[#eef3fc]' : 'border-slate-200 bg-white hover:border-[#003087]/40')}>
                    <p className="text-xs font-black text-slate-800 truncate">{c.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 truncate">{c.sub}</p>
                    <p className="text-[11px] font-black text-[#002d87] mt-0.5">{money(c.price)} / {c.unit}</p>
                  </button>
                );
              })}
              {catalogue.length === 0 && <p className="col-span-full text-sm text-slate-400 font-bold p-3">Aucun produit disponible pour cette source.</p>}
            </div>

            {lines.length > 0 && (
              <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#001f5c] text-white text-[10px] uppercase font-black">
                      <tr><th className="px-3 py-2 text-left">Produit</th><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-right">Dispo.</th>
                        <th className="px-3 py-2 text-right">Quantité</th><th className="px-3 py-2 text-right">Prix unit.</th><th className="px-3 py-2 text-right">Total</th><th /></tr>
                    </thead>
                    <tbody>
                      {lines.map(l => {
                        const M = SOURCE_META[l.source];
                        const avail = availableOf(l);
                        const over = l.quantity > avail + 1e-9;
                        return (
                          <tr key={l.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-black text-slate-800">{l.productName}</td>
                            <td className="px-3 py-2"><span className={cn('px-2 py-0.5 rounded text-[10px] font-black', M.tone)}>{M.label} · {l.sourceName}</span></td>
                            <td className={cn('px-3 py-2 text-right tabular-nums text-xs font-bold', over ? 'text-red-600' : 'text-slate-400')}>{fmtQ(avail)} {l.unit}</td>
                            <td className="px-3 py-2 text-right"><Input type="number" step="0.01" value={String(l.quantity)} onChange={e => patchLine(l.id, { quantity: parseFloat(e.target.value) || 0 })} className={cn('!w-24 text-right !h-9', over && '!border-red-300')} /></td>
                            <td className="px-3 py-2 text-right"><Input type="number" step="0.01" value={String(l.price)} onChange={e => patchLine(l.id, { price: parseFloat(e.target.value) || 0 })} className="!w-28 text-right !h-9" /></td>
                            <td className="px-3 py-2 text-right font-black tabular-nums text-[#002d87]">{money(l.total)}</td>
                            <td className="px-2"><button onClick={() => setLines(prev => prev.filter(x => x.id !== l.id))} className="p-1.5 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot><tr className="bg-blue-50 font-black text-[#001f5c]"><td className="px-3 py-2" colSpan={5}>Sous-total ({lines.length} ligne(s))</td><td className="px-3 py-2 text-right tabular-nums">{money(subtotal)}</td><td /></tr></tfoot>
                  </table>
                </div>
              </div>
            )}
            {stockIssues.length > 0 && (
              <p className="mt-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> {stockIssues.length} ligne(s) dépassent le stock disponible — le stock deviendra négatif.
              </p>
            )}
          </FormSection>

          {/* 3. Remise, TVA, taxes */}
          <FormSection step={3} icon={Percent} title="Remise, TVA & taxes" hint="La TVA et les taxes s'appliquent après la remise et s'ajoutent au total">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className={`rounded-2xl border p-4 space-y-3 ${discountOn ? 'bg-amber-50/70 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-700 flex items-center gap-1.5"><Percent className="w-4 h-4" /> Remise</p>
                    <Switch checked={discountOn} onChange={setDiscountOn} />
                  </div>
                  {discountOn && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Field label="Type"><Select value={discountType} onChange={e => setDiscountType(e.target.value as any)}><option value="percent">Pourcentage (%)</option><option value="amount">Montant fixe (DA)</option></Select></Field>
                      <Field label="Valeur"><Input type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)} className="text-right" /></Field>
                      <Field label="Remise"><StaticField>− {money(discountAmount)}</StaticField></Field>
                    </div>
                  )}
                </div>
                <TaxesEditor base={ht} tvaActive={tvaActive} onTvaActive={setTvaActive} tvaRate={tvaRate} onTvaRate={setTvaRate} taxes={taxes} onTaxes={setTaxes} />
              </div>
              <div className="rounded-2xl bg-[#001f5c] text-white p-5 sm:p-6 space-y-3 text-sm self-start w-full">
                <div className="flex justify-between"><span className="text-blue-200">Sous-total</span><span className="font-bold tabular-nums">{money(subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">Remise</span><span className="font-bold tabular-nums text-[#FFB800]">− {money(discountAmount)}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">Total HT</span><span className="font-bold tabular-nums">{money(ht)}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">TVA {tvaActive ? `(${tvaRate}%)` : ''}</span><span className="font-bold tabular-nums">{money(tvaAmount)}</span></div>
                {taxes.map(t => <div key={t.id} className="flex justify-between"><span className="text-violet-200">{taxLabel(t)}</span><span className="font-bold tabular-nums">+ {money(t.amount)}</span></div>)}
                <div className="flex flex-wrap gap-2 justify-between items-baseline pt-3 border-t border-white/20">
                  <span className="font-semibold">Total TTC</span>
                  <span className="text-2xl sm:text-3xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
                </div>
              </div>
            </div>
          </FormSection>

          {/* 4. Règlement */}
          <FormSection step={4} icon={Banknote} title="Règlement" hint="Le reste non payé est enregistré comme dette du client">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {PAY_MODES.map(m => (
                <button key={m.id} onClick={() => setPayMode(m.id)}
                  className={cn('py-2.5 rounded-xl border-2 text-xs font-black', payMode === m.id ? 'border-[#003087] bg-[#eef3fc] text-[#002d87]' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {needsBank && (
                <Field label="Compte bancaire crédité">
                  <Select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
              )}
              {needsBank && <Field label={payMode === 'CHEQUE' ? 'N° de chèque' : 'Référence'}><Input value={reference} onChange={e => setReference(e.target.value)} /></Field>}
              <Field label="Payé en totalité ?">
                <div className="h-[42px] flex items-center"><Switch checked={paidAll} onChange={setPaidAll} label={paidAll ? 'Oui' : 'Non — saisir le montant'} /></div>
              </Field>
              {!paidAll && (
                <Field label="Montant payé (DA)">
                  <Input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className="text-right" placeholder="0" />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Total</p><p className="font-black tabular-nums text-slate-800">{money(total)}</p></div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Payé</p><p className="font-black tabular-nums text-emerald-600">{money(paid)}</p></div>
              <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Reste (dette)</p><p className="font-black tabular-nums text-red-600">{money(rest)}</p></div>
            </div>
            <div className="mt-3"><Field label="Notes"><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field></div>
          </FormSection>
        </div>
      </Modal>
      {creatingClient && (
        <NewClientModal initialName={clientQuery} onClose={() => setCreatingClient(false)}
          onCreated={(c: Client) => { setClientId(c.id); setCreatingClient(false); setClientQuery(''); }} />
      )}
    </>
  );
}

// ─── Détail ──────────────────────────────────────────────────────────────────
function SaleDetail({ sale, onClose, onPrint, onEdit }: { sale: ShopSale; onClose: () => void; onPrint: () => void; onEdit?: () => void }) {
  const { clients = [], bankAccounts = [] } = useAppState();
  const inv = sale.invoice!;
  const client = clients.find(c => c.id === sale.clientId);
  const bank = bankAccounts.find(b => b.id === inv.bankAccountId);
  return (
    <Modal open onClose={onClose} icon={Receipt} size="xl" title={`Facture ${inv.number}`} subtitle={`${formatDate(sale.date)} · ${client?.name || inv.clientName || '—'}`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        {onEdit && <button className="btn-outline" onClick={onEdit}><Edit2 className="w-4 h-4" /> Modifier</button>}
        <button className="btn-primary" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-[#eef3fc] p-3 sm:col-span-2">
            <p className="text-[10px] uppercase font-black text-slate-400">Client</p>
            <p className="font-black text-[#001f5c]">{client?.name || inv.clientName || '—'}</p>
            <p className="text-xs font-bold text-slate-500">{[client?.phone, client?.address, client?.nif && `NIF ${client.nif}`, client?.rc && `RC ${client.rc}`].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-black text-slate-400">Règlement</p>
            <p className="font-black text-slate-700">{PAY_MODES.find(m => m.id === sale.paymentMode)?.label || sale.paymentMode}</p>
            <p className="text-xs font-bold text-slate-500">{bank?.name || ''}{sale.chequeNumber ? ` · ${sale.chequeNumber}` : ''}</p>
          </div>
        </div>
        <Table head={<>
          <th className="table-head">Produit</th><th className="table-head">Source</th>
          <th className="table-head text-right">Qté</th><th className="table-head text-right">P.U</th><th className="table-head text-right">Total</th>
        </>}>
          {inv.lines.map(l => (
            <tr key={l.id}>
              <td className="table-cell font-bold">{l.productName}</td>
              <td className="table-cell"><span className={cn('px-2 py-0.5 rounded text-[10px] font-black', SOURCE_META[l.source].tone)}>{SOURCE_META[l.source].label} · {l.sourceName}</span></td>
              <td className="table-cell text-right tabular-nums">{fmtQ(l.quantity)} {l.unit}</td>
              <td className="table-cell text-right tabular-nums">{money(l.price)}</td>
              <td className="table-cell text-right tabular-nums font-black">{money(l.total)}</td>
            </tr>
          ))}
        </Table>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Box l="Sous-total" v={money(sale.subtotal + (inv.discountAmount || 0))} />
          <Box l="Remise" v={money(inv.discountAmount || 0)} tone="amber" />
          <Box l={`TVA${inv.tvaActive ? ` (${inv.tvaRate}%)` : ''}`} v={money(sale.tvaAmount || 0)} />
          {(inv.taxes || []).map(t => <Box key={t.id} l={taxLabel(t)} v={money(t.amount)} tone="violet" />)}
          <Box l="Total TTC" v={money(sale.total)} tone="blue" />
          <Box l="Payé" v={money(sale.amountPaid || 0)} tone="green" />
          <Box l="Reste dû" v={money(sale.rest || 0)} tone="red" />
        </div>
        {sale.notes && <p className="text-sm font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">📝 {sale.notes}</p>}
        <p className="text-[11px] font-bold text-slate-400">Créée le {inv.createdAt ? new Date(inv.createdAt).toLocaleString('fr-FR') : '—'}{inv.createdBy ? ` par ${inv.createdBy}` : ''}{inv.updatedAt ? ` · modifiée le ${new Date(inv.updatedAt).toLocaleString('fr-FR')}` : ''}</p>
      </div>
    </Modal>
  );
}

function Box({ l, v, tone }: { l: string; v: string; tone?: 'amber' | 'violet' | 'blue' | 'green' | 'red'; key?: React.Key }) {
  const t = tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'violet' ? 'bg-violet-50 text-violet-700' : tone === 'blue' ? 'bg-[#eef3fc] text-[#002d87]'
    : tone === 'green' ? 'bg-emerald-50 text-emerald-700' : tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-700';
  return <div className={cn('rounded-xl p-3 text-center', t)}><p className="text-[10px] uppercase font-black text-slate-400">{l}</p><p className="font-black tabular-nums text-sm">{v}</p></div>;
}
