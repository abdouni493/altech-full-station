/**
 * ─── Achats Carburant ───────────────────────────────────────────────────────────
 * Un seul écran remplace les anciens onglets « Bons de livraison / Facturation /
 * Paiements ». Un achat se crée d'un bloc :
 *
 *   1. N° de facture et n° de bon de livraison
 *   2. Date + fournisseur
 *   3. Une ou plusieurs cuves, avec la quantité reçue ; le prix d'achat vient des
 *      paramètres de la station et le total de chaque ligne est calculé
 *   4. Total, avec TVA activable et remise (pourcentage ou montant fixe)
 *   5. Un ou plusieurs modes de paiement : espèces ou compte bancaire, avec n° de
 *      chèque / bordereau optionnels ; le reste est calculé automatiquement
 *
 * Aucun champ n'est obligatoire : un achat peut être enregistré en dette.
 * À l'enregistrement, les niveaux de cuve sont mis à jour et les paiements par
 * banque sont retirés du compte concerné (journal de trésorerie).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Trash2, Edit2, Wallet, Droplets, Percent, X,
  FileText, CircleDollarSign, TrendingUp, Landmark, Banknote, Printer, Eye,
  CalendarClock, BellRing, CheckCircle2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  Purchase, PurchaseItem, PurchasePayment, TreasuryTransaction, CAISSE_ID,
  bankBalanceOf, caisseBalanceOf, FuelType,
} from '../store/AppContext';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Switch, Confirm,
  Table, EmptyState, SearchInput, RowActions, ActionBtn, FormSection, StaticField, ViewToggle,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '../components/biz/Kit';
import { printPurchaseInvoice, stationFromSettings } from './modules/_shared';
import { appointmentOf, apptTone, apptLabel } from '../lib/paymentAppointments';
import {
  deleteFuelPurchase, tankDeltasBetween, tankDeltasOf, describeTankDeltas, litersOf,
} from '../lib/fuelPurchase';
import { supplierBalance, supplierStats, purchaseRest } from '../lib/supplierDebt';

const todayISO = () => new Date().toISOString().split('T')[0];

/** One cuve line of the purchase form. */
interface CuveLine { id: string; tankId: string; quantity: string; unitPrice: string }
/**
 * One payment line of the purchase form. An achat can be settled with as many
 * lines as needed — espèces + virement + plusieurs chèques — each with its own
 * account, its own mode, its own references and its own date.
 */
interface PayLine {
  id: string; accountId: string; amount: string;
  mode: PurchasePayment['mode'];
  chequeNumber: string; bordereauNumber: string;
  date: string; notes: string;
}

const PAY_MODES: { id: PurchasePayment['mode']; label: string }[] = [
  { id: 'ESPECES', label: 'Espèces' },
  { id: 'CHEQUE', label: 'Chèque' },
  { id: 'VIREMENT', label: 'Virement' },
];

/** Default mode for an account: the caisse is cash, a bank account is a transfer. */
const modeForAccount = (accountId: string): PurchasePayment['mode'] =>
  accountId === CAISSE_ID ? 'ESPECES' : 'VIREMENT';

const STATUS_TONE: Record<string, any> = {
  'Payé': 'success',
  'Dette partielle': 'warning', 'Dette': 'danger',
  // Libellés historiques — mêmes situations, achats enregistrés avant.
  'Partiel': 'warning', 'À payer': 'danger',
  'En attente livraison': 'neutral',
};

export default function FuelPurchases() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Achats Carburant');
  const { purchases, suppliers, tanks, bankAccounts, treasuryTransactions, settings } = state;

  const [search, setSearch] = useState('');
  // Tableau par défaut : une liste de factures se lit en colonnes. Les cartes
  // restent à un clic — et restent la seule mise en page tenable sur un écran
  // étroit, où le tableau ne rentre pas.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [toDelete, setToDelete] = useState<Purchase | null>(null);

  // Only fuel purchases live on this screen (they always carry a cuve).
  const fuelPurchases = useMemo(
    () => purchases.filter(p => p.items?.some(i => !!i.tankId) || !!p.tankId),
    [purchases]);

  const filtered = useMemo(() => {
    return [...fuelPurchases]
      .filter(p => {
        const supplier = suppliers.find(s => s.id === p.supplierId);
        const matchQ = matchesSearch(search, p.invoiceNumber, p.blNumber, supplier?.name);
        return matchQ && inPeriod(p.date, period, from, to);
      })
      // Newest first.
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [fuelPurchases, suppliers, search, period, from, to]);

  // Les compteurs suivent la PÉRIODE et la recherche affichées : ils lisaient
  // toute l'histoire pendant que la liste, elle, était filtrée — les deux ne
  // parlaient donc jamais des mêmes achats. La dette est recalculée facture par
  // facture (`purchaseRest`) plutôt que lue dans la colonne `rest`, qui peut
  // traîner un reliquat d'arrondi ou une valeur écrite par une ancienne version.
  const stats = useMemo(() => ({
    count: filtered.length,
    total: filtered.reduce((s, p) => s + (p.total || 0), 0),
    paid: filtered.reduce((s, p) => s + (p.amountPaid || 0), 0),
    debt: filtered.reduce((s, p) => s + Math.max(0, purchaseRest(p)), 0),
    liters: filtered.reduce((s, p) => s + (p.items || []).reduce((a, i) => a + (i.quantity || 0), 0), 0),
  }), [filtered]);

  /**
   * Removes a purchase: the litres it delivered are taken back OUT of the cuves
   * and its treasury lines are cancelled. The purchase is re-read from the live
   * state first, so the rollback always uses the current cuve lines even if the
   * row was edited (in another tab, say) after this list was rendered.
   */
  const del = () => {
    if (!toDelete) return;
    const fresh = purchases.find(p => p.id === toDelete.id) || toDelete;
    const deltas = deleteFuelPurchase(fresh, state, dispatch);
    const liters = litersOf(fresh);
    toast.success(deltas.length
      ? `Achat supprimé — ${liters.toLocaleString('fr-FR')} L retirés des cuves`
      : 'Achat supprimé');
    setToDelete(null);
  };

  /** Cuve impact of the pending deletion, shown in the confirmation dialog. */
  const deleteImpact = useMemo(() => {
    if (!toDelete) return '';
    const fresh = purchases.find(p => p.id === toDelete.id) || toDelete;
    return describeTankDeltas(tankDeltasOf(fresh, -1), tanks);
  }, [toDelete, purchases, tanks]);

  const doPrint = (p: Purchase) => {
    const supplier = suppliers.find(s => s.id === p.supplierId);
    printPurchaseInvoice({
      title: 'Facture d’achat carburant',
      ref: p.invoiceNumber || p.blNumber || p.id.slice(0, 8),
      date: p.date,
      station: stationFromSettings(settings),
      supplier: { name: supplier?.name || '—', phone: supplier?.phone, address: supplier?.address },
      info: [
        { label: 'N° facture', value: p.invoiceNumber || '' },
        { label: 'N° bon de livraison', value: p.blNumber || '' },
        { label: 'Statut', value: p.status },
      ],
      items: (p.items || []).map(i => ({
        name: `${tanks.find(t => t.id === i.tankId)?.name || i.productName} (${tanks.find(t => t.id === i.tankId)?.type || ''})`,
        qty: `${i.quantity} L`,
        unitPrice: i.buyPrice,
        total: i.total,
      })),
      subtotal: p.subtotal, reduction: p.discountAmount, tva: p.tvaAmount,
      total: p.total, paid: p.amountPaid, rest: p.rest,
      payments: (p.payments || []).map(pay => ({
        label: accountLabel(pay.accountId, bankAccounts),
        amount: pay.amount,
        reference: [pay.chequeNumber && `Chèque ${pay.chequeNumber}`, pay.bordereauNumber && `Bordereau ${pay.bordereauNumber}`]
          .filter(Boolean).join(' • '),
      })),
      notes: p.notes,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={ShoppingCart} title="Achats Carburant" subtitle="Facture, bon de livraison, cuves et paiements en une seule saisie"
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouvel achat</button>
          : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard icon={ShoppingCart} label="Achats" value={stats.count} tone="blue" />
        <StatCard icon={Droplets} label="Volume acheté" value={`${stats.liters.toLocaleString('fr-FR')} L`} tone="purple" />
        <StatCard icon={TrendingUp} label="Montant total" value={money(stats.total)} tone="slate" />
        <StatCard icon={Wallet} label="Payé" value={money(stats.paid)} tone="green" />
        <StatCard icon={CircleDollarSign} label="Dette fournisseurs" value={money(stats.debt)} tone="red" />
      </div>

      <div className="card-glass p-3 sm:p-4 space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="N° facture, n° BL ou fournisseur…" />
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        {filtered.length > 0 && (
          <p className="text-xs text-slate-400 font-semibold">
            {filtered.length} achat(s) affiché(s) — du plus récent au plus ancien
          </p>
        )}
        {/* Le tableau demande de la place : sur un écran étroit, les cartes
            restent la seule mise en page possible. */}
        <div className="ml-auto hidden xl:block"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Aucun achat carburant"
          message="Créez un achat : facture, bon de livraison, cuves livrées et paiements."
          action={perm.creer ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouvel achat</button> : undefined} />
      ) : (
        <>
          {/* ── Les cartes : seule mise en page sur écran étroit, et à un
                 clic sur grand écran. ─────────────────────────────────────── */}
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${view === 'table' ? 'xl:hidden' : ''}`}>
            {filtered.map(p => {
              const supplier = suppliers.find(s => s.id === p.supplierId);
              const liters = (p.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
              const cuveNames = (p.items || [])
                .map(i => tanks.find(t => t.id === i.tankId)?.name)
                .filter(Boolean).join(', ');
              const appt = appointmentOf(p);
              return (
                <div key={p.id} className="card-glass p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-black text-slate-800 truncate">
                        {p.invoiceNumber || p.blNumber || 'Sans référence'}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {formatDate(p.date)} • {supplier?.name || 'Fournisseur —'}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[p.status] || 'neutral'}>{p.status}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                    {p.blNumber && <span className="badge badge-neutral">BL {p.blNumber}</span>}
                    <span className="badge badge-info"><Droplets className="w-3 h-3" />{liters.toLocaleString('fr-FR')} L</span>
                    {cuveNames && <span className="badge badge-neutral truncate max-w-full">{cuveNames}</span>}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <p className="text-[9px] uppercase font-black text-slate-400">Total</p>
                      <p className="font-black text-slate-700 tabular-nums text-sm">{money(p.total)}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-2.5 text-center">
                      <p className="text-[9px] uppercase font-black text-slate-400">Payé</p>
                      <p className="font-black text-emerald-600 tabular-nums text-sm">{money(p.amountPaid)}</p>
                    </div>
                    <div className="rounded-xl bg-red-50 p-2.5 text-center">
                      <p className="text-[9px] uppercase font-black text-slate-400">Reste</p>
                      <p className="font-black text-red-600 tabular-nums text-sm">{money(p.rest)}</p>
                    </div>
                  </div>

                  {appt && (
                    <span className={`badge ${apptTone(appt.daysLeft)}`}>
                      <CalendarClock className="w-3 h-3" />
                      {apptLabel(appt.daysLeft)} {formatDate(appt.date)}
                    </span>
                  )}

                  <div className="flex items-center justify-end pt-2 border-t border-slate-100">
                    <RowActions>
                      <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                      <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(p)} />
                      {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(p)} />}
                      {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer la dette" onClick={() => setPaying(p)} />}
                      {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                    </RowActions>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop: the full table, every column at a glance ────────── */}
          {view === 'table' && (
          <div className="hidden xl:block">
            {/* ── L'ORDRE DES COLONNES ─────────────────────────────────────
                Les boutons d'action suivent immédiatement le fournisseur : on
                les atteint sans traverser toute la ligne des yeux. Les cuves et
                le volume — la donnée qu'on consulte, jamais celle sur laquelle
                on agit — passent en fin de tableau. */}
            <Table head={<>
              <th className="table-head">Date</th><th className="table-head">Facture</th><th className="table-head">BL</th>
              <th className="table-head">Fournisseur</th><th className="table-head">Actions</th>
              <th className="table-head text-right">Total</th>
              <th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th>
              <th className="table-head">Statut</th>
              <th className="table-head">Cuves</th><th className="table-head text-right">Volume</th>
            </>}>
              {filtered.map(p => {
                const supplier = suppliers.find(s => s.id === p.supplierId);
                const liters = (p.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
                const cuveNames = (p.items || [])
                  .map(i => tanks.find(t => t.id === i.tankId)?.name)
                  .filter(Boolean).join(', ');
                return (
                  <tr key={p.id}>
                    <td className="table-cell whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="table-cell font-bold">{p.invoiceNumber || '—'}</td>
                    <td className="table-cell">{p.blNumber || '—'}</td>
                    <td className="table-cell">{supplier?.name || '—'}</td>
                    <td className="table-cell">
                      <RowActions>
                        <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                        <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(p)} />
                        {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(p)} />}
                        {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer la dette" onClick={() => setPaying(p)} />}
                        {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                      </RowActions>
                    </td>
                    <td className="table-cell tabular-nums text-right font-bold">{money(p.total)}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.amountPaid)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{money(p.rest)}</td>
                    <td className="table-cell">
                      <div className="flex flex-col gap-1 items-start">
                        <Badge tone={STATUS_TONE[p.status] || 'neutral'}>{p.status}</Badge>
                        {appointmentOf(p) && (
                          <span className={`badge ${apptTone(appointmentOf(p)!.daysLeft)} whitespace-nowrap`}>
                            <CalendarClock className="w-3 h-3 inline mr-0.5" />
                            {apptLabel(appointmentOf(p)!.daysLeft)} {formatDate(appointmentOf(p)!.date)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-xs text-slate-500 max-w-[180px]">{cuveNames || '—'}</td>
                    <td className="table-cell tabular-nums text-right">{liters.toLocaleString('fr-FR')} L</td>
                  </tr>
                );
              })}
            </Table>
          </div>
          )}
        </>
      )}

      {(creating || editing) && (
        <PurchaseForm initial={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      {viewing && <PurchaseDetail purchase={viewing} onClose={() => setViewing(null)} onPrint={() => doPrint(viewing)} />}
      {paying && <PayPurchaseDebtModal purchase={paying} onClose={() => setPaying(null)} />}

      <Confirm open={!!toDelete} title="Supprimer l'achat"
        message={`Les quantités livrées seront RETIRÉES des cuves et les règlements annulés (l'argent revient en caisse / en banque).${
          deleteImpact ? `\n\n${deleteImpact}` : ''
        }\n\nConfirmer la suppression ?`}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function accountLabel(accountId: string | undefined, accounts: { id: string; name: string }[]): string {
  if (!accountId || accountId === CAISSE_ID) return 'Espèces (caisse générale)';
  return accounts.find(a => a.id === accountId)?.name || 'Compte bancaire';
}

/** Purchase price of a fuel type, taken from the station settings. */
function buyPriceOf(type: FuelType | undefined, settings: any): number {
  if (!type) return 0;
  return Number(settings?.fuelBuyPrices?.[type]) || 0;
}

/**
 * Statut d'un achat, décidé par le RESTE À PAYER et par lui seul.
 *
 * Tant que la facture n'est pas soldée, l'achat est une DETTE envers le
 * fournisseur — et le dit. « À payer » restait ambigu (une facture à payer plus
 * tard n'était pas lue comme un dû), et un paiement partiel n'annonçait rien du
 * tout. Les deux états portent maintenant le mot « Dette » ; l'ancien libellé
 * reste reconnu pour les achats enregistrés avant ce changement.
 */
function statusFor(total: number, paid: number): Purchase['status'] {
  const rest = (Number(total) || 0) - (Number(paid) || 0);
  if (rest < 0.01) return 'Payé';
  return paid > 0 ? 'Dette partielle' : 'Dette';
}

// ─── Create / edit ─────────────────────────────────────────────────────────────
function PurchaseForm({ initial, onClose }: { initial: Purchase | null; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { purchases, suppliers, tanks, bankAccounts, treasuryTransactions, settings, currentUserName } = state;
  const isEdit = !!initial;
  /**
   * Baseline of the edit: the achat AS IT IS STORED RIGHT NOW. The cuve rollback
   * subtracts these quantities, so reading them from the live store (and not from
   * the row snapshot captured when the modal opened) keeps the cuves exact even
   * if the achat changed meanwhile.
   */
  const stored = isEdit ? (purchases.find(p => p.id === initial!.id) || initial) : null;

  // The form is seeded from that same stored version, so what the user edits and
  // what the rollback subtracts are always the same set of cuve lines.
  const [invoiceNumber, setInvoiceNumber] = useState(stored?.invoiceNumber || '');
  const [blNumber, setBlNumber] = useState(stored?.blNumber || '');
  const [date, setDate] = useState(stored ? stored.date.split('T')[0] : todayISO());
  const [supplierId, setSupplierId] = useState(stored?.supplierId || '');
  const [notes, setNotes] = useState(stored?.notes || '');

  const [lines, setLines] = useState<CuveLine[]>(() =>
    (stored?.items || []).filter(i => i.tankId).map(i => ({
      id: newId(), tankId: i.tankId!, quantity: String(i.quantity ?? ''), unitPrice: String(i.buyPrice ?? ''),
    })));

  const [tvaActive, setTvaActive] = useState(!!stored?.tvaActive);
  const [tvaRate, setTvaRate] = useState(String(stored?.tvaRate ?? 19));
  const [discountOn, setDiscountOn] = useState(!!stored?.discountAmount);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(stored?.discountType || 'percent');
  const [discountValue, setDiscountValue] = useState(String(stored?.discountValue ?? ''));

  const [pays, setPays] = useState<PayLine[]>(() =>
    (stored?.payments || []).map(p => ({
      id: p.id, accountId: p.accountId || CAISSE_ID, amount: String(p.amount ?? ''),
      mode: p.mode || modeForAccount(p.accountId || CAISSE_ID),
      chequeNumber: p.chequeNumber || '', bordereauNumber: p.bordereauNumber || '',
      // Each payment keeps the date it was made on — an edit must not rewrite it.
      date: (p.date || '').split('T')[0] || todayISO(),
      notes: p.notes || '',
    })));

  // ── Rendez-vous de paiement ────────────────────────────────────────────────
  const [apptOn, setApptOn] = useState(!!stored?.appointmentActive);
  const [apptDate, setApptDate] = useState(stored?.appointmentDate || '');
  const [apptAmount, setApptAmount] = useState(
    stored?.appointmentAmount != null ? String(stored.appointmentAmount) : '');
  const [apptNotes, setApptNotes] = useState(stored?.appointmentNotes || '');

  // ── Money ────────────────────────────────────────────────────────────────
  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const discountAmount = !discountOn ? 0
    : discountType === 'percent'
      ? subtotal * (Number(discountValue) || 0) / 100
      : Math.min(subtotal, Number(discountValue) || 0);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const tvaAmount = tvaActive ? afterDiscount * (Number(tvaRate) || 0) / 100 : 0;
  const total = afterDiscount + tvaAmount;
  const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // Une facture réglée au dinar près est réglée : les arrondis de TVA laissaient
  // un reste de l'ordre du millième, qui suffisait à faire figurer l'achat dans
  // les dettes fournisseurs et à réclamer un rendez-vous de paiement.
  const rawRest = total - paid;
  const rest = rawRest < 0.01 ? 0 : rawRest;

  // ── Cuve lines ───────────────────────────────────────────────────────────
  /** The cuve lines as they will be SAVED — also drives the live cuve preview. */
  const items = useMemo<PurchaseItem[]>(() => lines
    .filter(l => l.tankId)
    .map(l => {
      const tank = tanks.find(t => t.id === l.tankId);
      const quantity = Number(l.quantity) || 0;
      const buyPrice = Number(l.unitPrice) || 0;
      return {
        productName: `${tank?.name || 'Cuve'} — ${tank?.type || ''}`.trim(),
        quantity, buyPrice, sellingPrice: 0,
        unit: 'L', total: quantity * buyPrice, tankId: l.tankId,
        tvaActive, tvaRate: Number(tvaRate) || 0,
      };
    }), [lines, tanks, tvaActive, tvaRate]);

  /**
   * Litres that saving will actually ADD TO (or REMOVE FROM) each cuve. On a new
   * achat this is simply the quantity received; on an edit it is the difference
   * with what the achat had already put in the cuve — which is why the preview
   * must not naively add the typed quantity to the current level.
   */
  const pendingDeltas = useMemo(
    () => tankDeltasBetween(stored, { items, tankId: undefined } as Purchase),
    [stored, items]);
  const deltaForTank = (tankId: string) =>
    pendingDeltas.find(d => d.tankId === tankId)?.deltaLiters || 0;

  const addLine = () => {
    const used = new Set(lines.map(l => l.tankId));
    const tank = tanks.find(t => !used.has(t.id)) || tanks[0];
    setLines(prev => [...prev, {
      id: newId(), tankId: tank?.id || '', quantity: '',
      unitPrice: String(buyPriceOf(tank?.type, settings)),
    }]);
  };
  const setLine = (id: string, patch: Partial<CuveLine>) =>
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      // Changing the cuve re-applies the purchase price of its fuel type.
      if (patch.tankId !== undefined) {
        const tank = tanks.find(t => t.id === patch.tankId);
        next.unitPrice = String(buyPriceOf(tank?.type, settings));
      }
      return next;
    }));
  const rmLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  // ── Payment lines ────────────────────────────────────────────────────────
  /** Adds a line pre-filled with the remaining balance, on the chosen account. */
  const addPay = (accountId: string = CAISSE_ID) => setPays(prev => [...prev, {
    id: newId(), accountId, amount: String(Math.max(0, total - paid) || ''),
    mode: modeForAccount(accountId),
    chequeNumber: '', bordereauNumber: '', date: date || todayISO(), notes: '',
  }]);
  const setPay = (id: string, patch: Partial<PayLine>) =>
    setPays(prev => prev.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      // Switching account realigns the mode (cash ⇄ bank) unless it was typed.
      if (patch.accountId !== undefined && patch.mode === undefined) {
        const wasDefault = p.mode === modeForAccount(p.accountId);
        if (wasDefault) next.mode = modeForAccount(patch.accountId);
      }
      return next;
    }));
  const rmPay = (id: string) => setPays(prev => prev.filter(p => p.id !== id));
  /** Puts the whole remaining balance on one line. */
  const fillRest = (id: string) => setPays(prev => {
    const others = prev.filter(p => p.id !== id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return prev.map(p => p.id === id ? { ...p, amount: String(Math.max(0, total - others)) } : p);
  });

  const accountBalance = (accountId: string) => accountId === CAISSE_ID
    ? caisseBalanceOf(treasuryTransactions)
    : bankBalanceOf(
      bankAccounts.find(a => a.id === accountId) || { id: accountId, initialBalance: 0 },
      treasuryTransactions);

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = () => {
    if (apptOn && rest > 0 && !apptDate) {
      toast.error('Choisissez la date du rendez-vous de paiement');
      return;
    }
    const purchaseId = initial?.id || newId();

    const payments: PurchasePayment[] = pays
      .filter(p => (Number(p.amount) || 0) > 0)
      .map(p => ({
        id: p.id,
        // Each line keeps its own date, so editing an achat never rewrites the
        // date of a payment that was made another day.
        date: new Date(p.date || date).toISOString(),
        amount: Number(p.amount) || 0,
        mode: p.mode || modeForAccount(p.accountId),
        chequeNumber: p.chequeNumber || undefined,
        bordereauNumber: p.bordereauNumber || undefined,
        accountId: p.accountId,
        notes: p.notes || undefined,
      }));

    const purchase: Purchase = {
      id: purchaseId,
      date: new Date(date).toISOString(),
      supplierId,
      invoiceNumber: invoiceNumber || undefined,
      blNumber: blNumber || undefined,
      items,
      subtotal,
      discountType: discountOn ? discountType : undefined,
      discountValue: discountOn ? Number(discountValue) || 0 : undefined,
      discountAmount,
      tvaActive, tvaRate: Number(tvaRate) || 0, tvaAmount,
      total,
      amountPaid: paid,
      rest,
      status: statusFor(total, paid),
      payments,
      notes: notes || undefined,
      type: 'RECEPTION',
      tankId: items[0]?.tankId,
      // A settled purchase never needs a reminder, so the rendez-vous is only
      // kept while something is still owed.
      appointmentActive: apptOn && rest > 0,
      appointmentDate: apptOn && rest > 0 ? (apptDate || undefined) : undefined,
      appointmentAmount: apptOn && rest > 0
        ? (apptAmount === '' ? rest : Number(apptAmount) || 0)
        : undefined,
      appointmentNotes: apptOn && rest > 0 ? (apptNotes || undefined) : undefined,
      appointmentPaid: rest <= 0 ? true : (stored?.appointmentPaid ?? false),
      appointmentPaidAt: rest <= 0 ? (stored?.appointmentPaidAt || new Date().toISOString()) : undefined,
    };

    // 1. Cuve levels — on edit only the DIFFERENCE with the stored lines is
    //    applied: quantities removed from a cuve (or moved to another cuve, or
    //    lowered) are taken back out of it, exactly like a deletion would.
    const deltas = tankDeltasBetween(stored, purchase);
    if (deltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: deltas });

    // 2. The purchase itself.
    dispatch({ type: isEdit ? 'UPDATE_PURCHASE' : 'ADD_PURCHASE', payload: purchase });

    // 3. Treasury: money actually leaving the caisse / the bank accounts.
    //    Rewriting the lines of this purchase keeps balances exact after an edit.
    treasuryTransactions
      .filter(t => t.refType === 'purchase' && t.refId === purchaseId)
      .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
    const supplierName = suppliers.find(s => s.id === supplierId)?.name || 'Fournisseur';
    payments.forEach(pay => {
      const tx: TreasuryTransaction = {
        id: newId(),
        date: pay.date,
        kind: 'PURCHASE',
        amount: pay.amount,
        description: `Achat carburant ${invoiceNumber ? `n° ${invoiceNumber}` : ''} — ${supplierName}`.trim(),
        accountFrom: pay.accountId,
        part: 'carburant',
        refType: 'purchase', refId: purchaseId,
        chequeNumber: pay.chequeNumber,
        bordereauNumber: pay.bordereauNumber,
        createdBy: currentUserName,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
    });

    // 4. Dette fournisseur — le solde du fournisseur est RECALCULÉ sur toutes ses
    //    factures, celle-ci comprise. Sans cette étape la colonne `balance`
    //    restait à zéro : un achat laissé impayé n'apparaissait ni sur la fiche
    //    du fournisseur, ni dans les dettes des Rapports Généraux, ni dans le
    //    fonds de roulement. Le total est reconstruit (jamais incrémenté) pour
    //    qu'une modification ou une suppression le corrige d'elle-même.
    const supplier = suppliers.find(s => s.id === supplierId);
    if (supplier) {
      const nextApp = {
        ...state,
        purchases: isEdit
          ? purchases.map(p => (p.id === purchaseId ? purchase : p))
          : [...purchases, purchase],
      };
      const balance = supplierBalance(nextApp, supplier.id);
      const totalPurchases = supplierStats(nextApp, supplier.id).totalPurchased;
      if (Math.abs((supplier.balance || 0) - balance) > 0.01
        || Math.abs((supplier.totalPurchases || 0) - totalPurchases) > 0.01) {
        dispatch({ type: 'UPDATE_SUPPLIER', payload: { ...supplier, balance, totalPurchases } });
      }
    }

    const apptMsg = apptOn && rest > 0 && apptDate
      ? ` — rendez-vous de paiement le ${formatDate(apptDate)}, rappel affiché sur le tableau de bord`
      : '';
    // Net movement applied to the cuves, so an edit that LOWERS a quantity says
    // so explicitly instead of the vague « cuves mises à jour ».
    const net = deltas.reduce((s, d) => s + d.deltaLiters, 0);
    const cuveMsg = deltas.length === 0
      ? 'cuves inchangées'
      : `${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString('fr-FR')} L sur ${deltas.length > 1 ? `${deltas.length} cuves` : 'la cuve'}`;
    toast.success((isEdit
      ? `Achat modifié — ${cuveMsg}, trésorerie mise à jour`
      : rest > 0
        ? `Achat enregistré avec une dette de ${money(rest)} — ${cuveMsg}`
        : `Achat enregistré — ${cuveMsg}`) + apptMsg);
    onClose();
  };

  const totalLiters = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  return (
    <Modal open onClose={onClose} icon={ShoppingCart} size="3xl" formScale fullHeight
      title={isEdit ? "Modifier l'achat carburant" : 'Nouvel achat carburant'}
      subtitle="Aucun champ n'est obligatoire — l'achat peut être enregistré en dette"
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-slate-400 uppercase tracking-widest">{totalLiters.toLocaleString('fr-FR')} L</span>
          <span className="text-[#002d87]">Total {money(total)}</span>
          {rest > 0 && <span className="text-red-600">Dette {money(rest)}</span>}
        </div>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : "Enregistrer l'achat"}</button>
      </>}>
      <div className="space-y-4 sm:space-y-5">
        {/* Récapitulatif de l'achat — le pied de page reprend les mêmes chiffres
            en permanence pendant le défilement. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
            <p className="text-[10px] uppercase font-black text-slate-400">Volume</p>
            <p className="font-black tabular-nums text-slate-700 text-sm sm:text-lg">{totalLiters.toLocaleString('fr-FR')} L</p>
          </div>
          <div className="rounded-xl bg-[#eef3fc] border border-[#003087]/15 px-3 py-2.5">
            <p className="text-[10px] uppercase font-black text-slate-400">Total</p>
            <p className="font-black tabular-nums text-[#002d87] text-sm sm:text-lg">{money(total)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
            <p className="text-[10px] uppercase font-black text-slate-400">Payé</p>
            <p className="font-black tabular-nums text-emerald-600 text-sm sm:text-lg">{money(paid)}</p>
          </div>
          <div className={`rounded-xl border px-3 py-2.5 ${rest > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
            <p className="text-[10px] uppercase font-black text-slate-400">Reste</p>
            <p className={`font-black tabular-nums text-sm sm:text-lg ${rest > 0 ? 'text-red-600' : 'text-slate-500'}`}>{money(rest)}</p>
          </div>
        </div>

        {/* 1. Références, date, fournisseur */}
        <FormSection step={1} icon={FileText} title="Références de la facture"
          hint="Facture, bon de livraison, date et fournisseur">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Field label="N° de facture"><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="FA-2026-001" /></Field>
            <Field label="N° bon de livraison"><Input value={blNumber} onChange={e => setBlNumber(e.target.value)} placeholder="BL-2026-001" /></Field>
            <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Fournisseur">
              <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </FormSection>

        {/* 2. Cuves */}
        <FormSection step={2} icon={Droplets} title="Cuves livrées"
          hint="Le prix d'achat vient des paramètres de la station"
          action={
            <button className="btn-secondary !py-2 !px-3.5 text-xs w-full sm:w-auto" onClick={addLine} disabled={tanks.length === 0}>
              <Plus className="w-4 h-4" /> Ajouter une cuve
            </button>
          }>
          {tanks.length === 0 && (
            <p className="text-xs text-amber-600 mb-2">Aucune cuve configurée — créez-en une dans « Cuves / Tanks ».</p>
          )}

          {lines.length === 0 ? (
            <button onClick={addLine} disabled={tanks.length === 0}
              className="w-full rounded-2xl bg-slate-50 border-2 border-dashed border-slate-300 p-8 text-center hover:border-[#003087]/40 hover:bg-[#eef3fc] transition-colors disabled:opacity-50">
              <Droplets className="w-9 h-9 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-500">Aucune cuve — ajoutez la première ligne de livraison.</p>
            </button>
          ) : (
            <div className="space-y-3">
              {lines.map((l, idx) => {
                const tank = tanks.find(t => t.id === l.tankId);
                const qty = Number(l.quantity) || 0;
                const price = Number(l.unitPrice) || 0;
                // The cuve already holds what this achat delivered, so the level
                // after saving moves by the PENDING DELTA, not by the raw
                // quantity — otherwise an edit would show a doubled level.
                const delta = tank ? deltaForTank(tank.id) : 0;
                const after = Math.max(0, (tank?.current || 0) + delta);
                const overflow = tank ? after > tank.capacity : false;
                const fillPct = tank && tank.capacity > 0
                  ? Math.min(100, (after / tank.capacity) * 100) : 0;
                return (
                  <div key={l.id} className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm">
                    {/* Line header — numéro, cuve, total, retrait */}
                    <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0">
                        {idx + 1}
                      </span>
                      <p className="min-w-0 flex-1 text-sm font-black text-slate-800 truncate">
                        {tank ? `${tank.name} — ${tank.type}` : 'Cuve à choisir'}
                      </p>
                      <div className="text-right shrink-0 hidden sm:block">
                        <p className="text-[10px] uppercase font-black text-slate-400">Total ligne</p>
                        <p className="font-black tabular-nums text-[#002d87]">{money(qty * price)}</p>
                      </div>
                      <button onClick={() => rmLine(l.id)} title="Retirer la ligne"
                        className="w-9 h-9 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                      <Field label="Cuve">
                        <Select value={l.tankId} onChange={e => setLine(l.id, { tankId: e.target.value })}>
                          <option value="">— Choisir —</option>
                          {tanks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
                        </Select>
                      </Field>
                      <Field label="Quantité reçue (L)">
                        <Input type="number" step="0.01" inputMode="decimal" value={l.quantity}
                          onChange={e => setLine(l.id, { quantity: e.target.value })}
                          placeholder="0" className="text-right" />
                      </Field>
                      <Field label="Prix d'achat / L (DA)">
                        <Input type="number" step="0.01" inputMode="decimal" value={l.unitPrice}
                          onChange={e => setLine(l.id, { unitPrice: e.target.value })} className="text-right" />
                      </Field>
                      <Field label="Total de la ligne">
                        <StaticField tone="primary">{money(qty * price)}</StaticField>
                      </Field>
                    </div>

                    {tank && (
                      <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${overflow ? 'bg-red-500' : 'bg-[#003087]'}`}
                            style={{ width: `${fillPct}%` }} />
                        </div>
                        <p className={`text-[11px] sm:text-xs mt-1.5 ${overflow ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                          Niveau actuel {tank.current.toLocaleString('fr-FR')} L → après enregistrement {after.toLocaleString('fr-FR')} L
                          {' '}sur {tank.capacity.toLocaleString('fr-FR')} L
                          {delta !== 0 && (
                            <span className={delta > 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                              {' '}({delta > 0 ? '+' : '−'}{Math.abs(delta).toLocaleString('fr-FR')} L
                              {isEdit ? (delta > 0 ? ' ajoutés' : ' retirés') : ''})
                            </span>
                          )}
                          {overflow ? ' — dépasse la capacité de la cuve' : ''}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end items-center gap-4 px-1 pt-1 text-sm font-black">
                <span className="text-slate-400 uppercase tracking-widest text-[11px]">Volume total</span>
                <span className="text-[#002d87] tabular-nums">{totalLiters.toLocaleString('fr-FR')} L</span>
              </div>
            </div>
          )}

          {/* Impact réel sur les cuves — indispensable en modification : une cuve
              retirée de l'achat n'a plus de ligne, mais son volume doit quand
              même en être retiré. */}
          {pendingDeltas.length > 0 && (
            <div className="mt-4 rounded-2xl border border-[#003087]/20 bg-[#eef3fc] p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-[#002d87] mb-2 flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5" /> Mouvement appliqué aux cuves à l'enregistrement
              </p>
              <div className="space-y-1.5">
                {pendingDeltas.map(d => {
                  const tank = tanks.find(t => t.id === d.tankId);
                  const before = tank?.current || 0;
                  return (
                    <div key={d.tankId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-700">
                        {tank ? `${tank.name} (${tank.type})` : 'Cuve supprimée'}
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {before.toLocaleString('fr-FR')} L → {Math.max(0, before + d.deltaLiters).toLocaleString('fr-FR')} L
                        <span className={`ml-2 font-black ${d.deltaLiters > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {d.deltaLiters > 0 ? '+' : '−'}{Math.abs(d.deltaLiters).toLocaleString('fr-FR')} L
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </FormSection>

        {/* 3. Total, TVA, remise */}
        <FormSection step={3} icon={Percent} title="Total, TVA & remise"
          hint="La TVA est appliquée après la remise">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-3">
              {/* Remise */}
              <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${discountOn ? 'bg-amber-50/70 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-700 flex items-center gap-1.5"><Percent className="w-4 h-4" /> Remise</p>
                    <p className="text-xs text-slate-400">Déduite automatiquement du sous-total</p>
                  </div>
                  <Switch checked={discountOn} onChange={setDiscountOn} />
                </div>
                {discountOn && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <Field label="Type">
                      <Select value={discountType} onChange={e => setDiscountType(e.target.value as 'percent' | 'amount')}>
                        <option value="percent">Pourcentage (%)</option>
                        <option value="amount">Montant fixe (DA)</option>
                      </Select>
                    </Field>
                    <Field label={discountType === 'percent' ? 'Valeur (%)' : 'Valeur (DA)'}>
                      <Input type="number" step="0.01" inputMode="decimal" value={discountValue}
                        onChange={e => setDiscountValue(e.target.value)} className="text-right" placeholder="0" />
                    </Field>
                    <Field label="Remise déduite">
                      <StaticField className="!text-amber-700 !bg-white !border-amber-200">− {money(discountAmount)}</StaticField>
                    </Field>
                  </div>
                )}
              </div>

              {/* TVA */}
              <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${tvaActive ? 'bg-[#eef3fc] border-[#003087]/20' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-700">TVA</p>
                    <p className="text-xs text-slate-400">Appliquée après la remise</p>
                  </div>
                  <Switch checked={tvaActive} onChange={setTvaActive} />
                </div>
                {tvaActive && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <Field label="Taux de TVA (%)">
                      <Input type="number" step="0.01" inputMode="decimal" value={tvaRate}
                        onChange={e => setTvaRate(e.target.value)} className="text-right" />
                    </Field>
                    <Field label="Montant de la TVA">
                      <StaticField tone="primary">{money(tvaAmount)}</StaticField>
                    </Field>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-[#001f5c] text-white p-5 sm:p-6 space-y-3 text-sm self-start w-full">
              <div className="flex justify-between"><span className="text-blue-200">Sous-total</span><span className="font-bold tabular-nums">{money(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-blue-200">Remise</span><span className="font-bold tabular-nums text-[#FFB800]">− {money(discountAmount)}</span></div>
              <div className="flex justify-between"><span className="text-blue-200">TVA {tvaActive ? `(${tvaRate}%)` : ''}</span><span className="font-bold tabular-nums">{money(tvaAmount)}</span></div>
              <div className="flex flex-wrap gap-2 justify-between items-baseline pt-3 border-t border-white/20">
                <span className="font-semibold">Total à payer</span>
                <span className="text-2xl sm:text-3xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
              </div>
            </div>
          </div>
        </FormSection>

        {/* 4. Paiements — autant de modes que nécessaire */}
        <FormSection step={4} icon={Banknote} title="Modes de paiement"
          hint="Ajoutez autant de règlements que nécessaire : espèces, virement, plusieurs chèques… Le reste devient une dette fournisseur."
          action={
            <div className="flex flex-wrap gap-2">
              <button className="btn-outline !py-2 !px-3.5 text-xs flex-1 sm:flex-none" onClick={() => addPay(CAISSE_ID)}>
                <Wallet className="w-4 h-4" /> Espèces
              </button>
              {bankAccounts.length > 0 && (
                <button className="btn-secondary !py-2 !px-3.5 text-xs flex-1 sm:flex-none" onClick={() => addPay(bankAccounts[0].id)}>
                  <Landmark className="w-4 h-4" /> Compte bancaire
                </button>
              )}
            </div>
          }>
          {pays.length === 0 ? (
            <button onClick={() => addPay(CAISSE_ID)}
              className="w-full rounded-2xl bg-slate-50 border-2 border-dashed border-slate-300 p-8 text-center hover:border-[#003087]/40 hover:bg-[#eef3fc] transition-colors">
              <Banknote className="w-9 h-9 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-500">
                Aucun paiement — l'achat sera enregistré entièrement en dette.
              </p>
              <p className="text-xs text-slate-400 mt-1">Touchez ici pour ajouter un règlement.</p>
            </button>
          ) : (
            <div className="space-y-3">
              {pays.map((p, i) => {
                const value = Number(p.amount) || 0;
                const before = accountBalance(p.accountId);
                const insufficient = value > before;
                return (
                  <div key={p.id} className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm">
                    {/* Line header: numéro, mode, montant, retrait */}
                    <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex gap-1.5 flex-wrap">
                        {PAY_MODES.map(m => (
                          <button key={m.id} onClick={() => setPay(p.id, { mode: m.id })}
                            className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${p.mode === m.id ? 'bg-[#003087] text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:border-[#003087]/40'}`}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <span className="ml-auto text-sm font-black tabular-nums text-[#002d87]">{money(value)}</span>
                      <button onClick={() => rmPay(p.id)} title="Retirer le paiement"
                        className="w-9 h-9 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                      <Field label="Compte débité">
                        <Select value={p.accountId} onChange={e => setPay(p.id, { accountId: e.target.value })}>
                          <option value={CAISSE_ID}>Espèces (caisse générale)</option>
                          {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Montant payé (DA)">
                        <div className="flex gap-2">
                          <Input type="number" step="0.01" inputMode="decimal" value={p.amount}
                            onChange={e => setPay(p.id, { amount: e.target.value })}
                            placeholder="0" className="text-right" />
                          <button onClick={() => fillRest(p.id)} title="Solder le reste"
                            className="btn-outline !px-3 shrink-0 text-[10px] font-black">RESTE</button>
                        </div>
                      </Field>
                      <Field label="Date du règlement">
                        <Input type="date" value={p.date} onChange={e => setPay(p.id, { date: e.target.value })} />
                      </Field>
                      <Field label={p.mode === 'CHEQUE' ? 'N° chèque' : 'N° bordereau'}>
                        {p.mode === 'CHEQUE'
                          ? <Input value={p.chequeNumber} onChange={e => setPay(p.id, { chequeNumber: e.target.value })} placeholder="Ex: 4452210" />
                          : <Input value={p.bordereauNumber} onChange={e => setPay(p.id, { bordereauNumber: e.target.value })} placeholder="Optionnel" />}
                      </Field>
                    </div>

                    <p className={`px-3 sm:px-4 pb-3 text-[11px] sm:text-xs flex items-start gap-1.5 ${insufficient ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                      {p.accountId === CAISSE_ID ? <Wallet className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <Landmark className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                      <span>
                        Solde {accountLabel(p.accountId, bankAccounts)} : {money(before)}
                        {' '}→ {money(before - value)} après paiement
                        {insufficient ? ' — solde insuffisant' : ''}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
              <p className="text-[10px] uppercase font-black text-slate-400">Total achat</p>
              <p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{money(total)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
              <p className="text-[10px] uppercase font-black text-slate-400">Règlements</p>
              <p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{pays.length}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
              <p className="text-[10px] uppercase font-black text-slate-400">Total payé</p>
              <p className="font-black text-emerald-600 tabular-nums text-sm sm:text-base">{money(paid)}</p>
            </div>
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
              <p className="text-[10px] uppercase font-black text-slate-400">Reste (dette)</p>
              <p className="font-black text-red-600 tabular-nums text-sm sm:text-base">{money(rest)}</p>
            </div>
          </div>
          {paid > total && (
            <p className="text-xs sm:text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
              Les règlements dépassent le total de l'achat de {money(paid - total)}.
            </p>
          )}
          {rest > 0 && (
            <p className="text-xs sm:text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3">
              L'achat sera enregistré avec le statut « {statusFor(total, paid)} » — le reste de {money(rest)} reste dû au fournisseur.
            </p>
          )}
        </FormSection>

        {/* 5. Rendez-vous de paiement */}
        <FormSection step={5} icon={CalendarClock} title="Rendez-vous de paiement"
          hint="Programmez la date à laquelle le reste doit être payé — un rappel s'affiche en haut du tableau de bord">
          <div className="rounded-2xl border border-slate-200 p-4 space-y-4"
            style={{ background: 'linear-gradient(135deg, rgba(0,48,135,0.04), rgba(255,184,0,0.07))' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
                  <BellRing className="w-5 h-5 text-[#FFB800]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#002d87]">Activer le rendez-vous de paiement</p>
                  <p className="text-xs text-slate-500">
                    Une alerte apparaîtra en haut du tableau de bord jusqu'au règlement de la dette.
                  </p>
                </div>
              </div>
              <Switch checked={apptOn} onChange={setApptOn} />
            </div>

            {apptOn && (
              rest <= 0 ? (
                <p className="text-xs sm:text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  Cet achat est entièrement payé — aucun rendez-vous n'est nécessaire.
                  Le rappel s'activera automatiquement s'il reste une dette.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 pt-4 border-t border-slate-200">
                    <Field label="Date du rendez-vous" required>
                      <Input type="date" value={apptDate} min={todayISO()} onChange={e => setApptDate(e.target.value)} />
                    </Field>
                    <Field label="Montant attendu (DA)" hint={`Laissez vide pour le reste dû (${money(rest)}).`}>
                      <Input type="number" step="0.01" inputMode="decimal" value={apptAmount}
                        onChange={e => setApptAmount(e.target.value)} placeholder={String(Math.round(rest))} className="text-right" />
                    </Field>
                    <Field label="Note du rendez-vous" >
                      <Input value={apptNotes} onChange={e => setApptNotes(e.target.value)}
                        placeholder="Ex: régler par chèque à l'agence…" />
                    </Field>
                  </div>
                  <div className="rounded-xl bg-[#001f5c] text-white p-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-semibold text-blue-200">
                      Rappel {apptDate ? `le ${formatDate(apptDate)}` : '— choisissez une date'}
                    </span>
                    <span className="text-xl font-black tabular-nums text-[#FFB800]">
                      {money(apptAmount === '' ? rest : Number(apptAmount) || 0)}
                    </span>
                  </div>
                </>
              )
            )}
          </div>
        </FormSection>

        {/* 6. Notes */}
        <FormSection step={6} icon={FileText} title="Observations" hint="Reprises sur la facture imprimée">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
            placeholder="Notes internes ou mentions à imprimer…" />
        </FormSection>
      </div>
    </Modal>
  );
}

// ─── Detail ────────────────────────────────────────────────────────────────────
function PurchaseDetail({ purchase, onClose, onPrint }: {
  purchase: Purchase; onClose: () => void; onPrint: () => void;
}) {
  const { suppliers, tanks, bankAccounts } = useAppState();
  const supplier = suppliers.find(s => s.id === purchase.supplierId);
  const appt = appointmentOf(purchase);
  return (
    <Modal open onClose={onClose} icon={ShoppingCart} size="2xl"
      title={`Achat ${purchase.invoiceNumber || purchase.blNumber || ''}`.trim()}
      subtitle={`${supplier?.name || 'Fournisseur'} — ${formatDate(purchase.date)}`}
      footer={<button className="btn-outline" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">N° facture</p><p className="font-bold text-slate-700 text-sm break-words">{purchase.invoiceNumber || '—'}</p></div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">N° BL</p><p className="font-bold text-slate-700 text-sm break-words">{purchase.blNumber || '—'}</p></div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">Date</p><p className="font-bold text-slate-700 text-sm">{formatDate(purchase.date)}</p></div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><p className="text-[10px] uppercase font-black text-slate-400">Statut</p><p className="font-bold text-slate-700 text-sm">{purchase.status}</p></div>
        </div>

        <Table head={<><th className="table-head">Cuve</th><th className="table-head text-right">Quantité</th><th className="table-head text-right">Prix / L</th><th className="table-head text-right">Total</th></>}>
          {(purchase.items || []).map((i, idx) => {
            const tank = tanks.find(t => t.id === i.tankId);
            return (
              <tr key={idx}>
                <td className="table-cell">{tank ? `${tank.name} (${tank.type})` : i.productName}</td>
                <td className="table-cell tabular-nums text-right">{i.quantity.toLocaleString('fr-FR')} L</td>
                <td className="table-cell tabular-nums text-right">{money(i.buyPrice)}</td>
                <td className="table-cell text-right tabular-nums font-bold">{money(i.total)}</td>
              </tr>
            );
          })}
        </Table>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Sous-total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(purchase.subtotal ?? purchase.total)}</p></div>
          <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Remise</p><p className="font-black text-amber-600 tabular-nums text-sm">{money(purchase.discountAmount || 0)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">TVA</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(purchase.tvaAmount || 0)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(purchase.amountPaid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(purchase.rest)}</p></div>
        </div>

        {appt && (
          <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
            appt.urgency === 'overdue' ? 'bg-red-50 border-red-200'
              : appt.urgency === 'today' ? 'bg-amber-50 border-amber-200'
                : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex items-center gap-3 min-w-0">
              <BellRing className={`w-5 h-5 shrink-0 ${appt.urgency === 'overdue' ? 'text-red-600' : appt.urgency === 'today' ? 'text-amber-600' : 'text-blue-600'}`} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700">
                  Rendez-vous de paiement — {formatDate(appt.date)}
                  <span className="ml-2 text-xs font-black uppercase">
                    {appt.daysLeft < 0 ? `en retard de ${Math.abs(appt.daysLeft)} jour(s)`
                      : appt.daysLeft === 0 ? "aujourd'hui" : `dans ${appt.daysLeft} jour(s)`}
                  </span>
                </p>
                {appt.notes && <p className="text-xs text-slate-500 truncate">{appt.notes}</p>}
              </div>
            </div>
            <p className="font-black tabular-nums text-[#002d87]">{money(appt.amount)}</p>
          </div>
        )}

        {(purchase.payments || []).length > 0 && (
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">
              Paiements ({purchase.payments.length} règlement{purchase.payments.length > 1 ? 's' : ''})
            </p>
            <Table head={<><th className="table-head">Date</th><th className="table-head">Mode</th><th className="table-head">Compte débité</th><th className="table-head">Références</th><th className="table-head text-right">Montant</th></>}>
              {purchase.payments.map(pay => (
                <tr key={pay.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(pay.date)}</td>
                  <td className="table-cell"><Badge tone="info">{PAY_MODES.find(m => m.id === pay.mode)?.label || pay.mode}</Badge></td>
                  <td className="table-cell">{accountLabel(pay.accountId, bankAccounts)}</td>
                  <td className="table-cell text-xs text-slate-500">
                    {[pay.chequeNumber && `Chèque ${pay.chequeNumber}`, pay.bordereauNumber && `Bordereau ${pay.bordereauNumber}`].filter(Boolean).join(' • ') || '—'}
                  </td>
                  <td className="table-cell text-right tabular-nums font-bold">{money(pay.amount)}</td>
                </tr>
              ))}
              <tr className="bg-blue-50/60">
                <td className="table-cell font-black text-[#002d87]" colSpan={4}>TOTAL RÉGLÉ</td>
                <td className="table-cell text-right tabular-nums font-black text-emerald-600">{money(purchase.amountPaid)}</td>
              </tr>
            </Table>
          </div>
        )}

        {purchase.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Notes</p>
            <p className="text-sm text-slate-600">{purchase.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Pay a debt ────────────────────────────────────────────────────────────────
/**
 * Settling a supplier debt accepts SEVERAL payment methods in one go — e.g. part
 * in cash and the balance by cheque from a bank account. Each line writes its own
 * treasury movement, so every account balance stays exact.
 */
function PayPurchaseDebtModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { bankAccounts, suppliers, treasuryTransactions, currentUserName } = state;

  const [lines, setLines] = useState<PayLine[]>([{
    id: newId(), accountId: CAISSE_ID, amount: String(purchase.rest),
    mode: 'ESPECES', chequeNumber: '', bordereauNumber: '', date: todayISO(), notes: '',
  }]);

  const addLine = (accountId: string = CAISSE_ID) => setLines(prev => {
    const already = prev.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    return [...prev, {
      id: newId(), accountId, amount: String(Math.max(0, purchase.rest - already) || ''),
      mode: modeForAccount(accountId), chequeNumber: '', bordereauNumber: '', date: todayISO(), notes: '',
    }];
  });
  const setLine = (id: string, patch: Partial<PayLine>) =>
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      if (patch.accountId !== undefined && patch.mode === undefined && l.mode === modeForAccount(l.accountId)) {
        next.mode = modeForAccount(patch.accountId);
      }
      return next;
    }));
  const rmLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  const balanceOf = (accountId: string) => accountId === CAISSE_ID
    ? caisseBalanceOf(treasuryTransactions)
    : bankBalanceOf(bankAccounts.find(a => a.id === accountId) || { id: accountId, initialBalance: 0 }, treasuryTransactions);

  const value = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const newPaid = purchase.amountPaid + value;
  const rawNewRest = purchase.total - newPaid;
  const newRest = rawNewRest < 0.01 ? 0 : rawNewRest;
  const overpay = value > purchase.rest + 0.001;

  const save = () => {
    const kept = lines.filter(l => (Number(l.amount) || 0) > 0);
    if (kept.length === 0) { toast.error('Ajoutez au moins un règlement'); return; }

    const payments: PurchasePayment[] = kept.map(l => ({
      id: l.id, date: new Date(l.date || todayISO()).toISOString(), amount: Number(l.amount) || 0,
      mode: l.mode || modeForAccount(l.accountId),
      chequeNumber: l.chequeNumber || undefined,
      bordereauNumber: l.bordereauNumber || undefined,
      accountId: l.accountId,
    }));

    dispatch({
      type: 'UPDATE_PURCHASE',
      payload: {
        ...purchase,
        payments: [...(purchase.payments || []), ...payments],
        amountPaid: newPaid,
        rest: newRest,
        status: statusFor(purchase.total, newPaid),
        // Debt cleared → the payment reminder disappears from the dashboard.
        appointmentActive: newRest > 0 ? purchase.appointmentActive : false,
        appointmentPaid: newRest <= 0 ? true : purchase.appointmentPaid,
        appointmentPaidAt: newRest <= 0 ? new Date().toISOString() : purchase.appointmentPaidAt,
      },
    });

    const supplier = suppliers.find(s => s.id === purchase.supplierId);
    const supplierName = supplier?.name || 'Fournisseur';
    payments.forEach(pay => dispatch({
      type: 'ADD_TREASURY_TX',
      payload: {
        id: newId(), date: pay.date, kind: 'PURCHASE', amount: pay.amount,
        description: `Règlement dette achat ${purchase.invoiceNumber ? `n° ${purchase.invoiceNumber}` : ''} — ${supplierName}`.trim(),
        accountFrom: pay.accountId, part: 'carburant',
        refType: 'purchase', refId: purchase.id,
        chequeNumber: pay.chequeNumber, bordereauNumber: pay.bordereauNumber,
        createdBy: currentUserName, createdAt: new Date().toISOString(),
      },
    }));

    // Régler une facture réduit la dette du fournisseur : son solde est
    // reconstruit sur ses factures restantes, jamais décrémenté à l'aveugle.
    if (supplier) {
      const settled = { ...purchase, payments: [...(purchase.payments || []), ...payments], amountPaid: newPaid, rest: newRest };
      const nextApp = { ...state, purchases: state.purchases.map(p => (p.id === purchase.id ? settled : p)) };
      const balance = supplierBalance(nextApp, supplier.id);
      if (Math.abs((supplier.balance || 0) - balance) > 0.01) {
        dispatch({ type: 'UPDATE_SUPPLIER', payload: { ...supplier, balance } });
      }
    }

    toast.success(payments.length > 1
      ? `${payments.length} règlements enregistrés — ${money(value)}`
      : 'Paiement enregistré');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Wallet} size="2xl" formScale
      title="Payer la dette fournisseur"
      subtitle={`${purchase.invoiceNumber || purchase.blNumber || 'Achat'} — reste ${money(purchase.rest)}`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-slate-400 uppercase tracking-widest">{lines.length} règlement(s)</span>
          <span className="text-emerald-600">Total {money(value)}</span>
          <span className={newRest > 0 ? 'text-red-600' : 'text-emerald-600'}>Nouveau reste {money(newRest)}</span>
        </div>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0}>
          Enregistrer {lines.length > 1 ? 'les règlements' : 'le paiement'}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{money(purchase.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Déjà payé</p><p className="font-black text-emerald-600 tabular-nums text-sm sm:text-base">{money(purchase.amountPaid)}</p></div>
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm sm:text-base">{money(purchase.rest)}</p></div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black uppercase tracking-wider text-[#002d87] flex items-center gap-1.5">
            <Banknote className="w-4 h-4 text-[#FFB800]" /> Modes de paiement
          </p>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button className="btn-outline !py-2 !px-3.5 text-xs flex-1 sm:flex-none" onClick={() => addLine(CAISSE_ID)}>
              <Wallet className="w-4 h-4" /> Espèces
            </button>
            {bankAccounts.length > 0 && (
              <button className="btn-secondary !py-2 !px-3.5 text-xs flex-1 sm:flex-none" onClick={() => addLine(bankAccounts[0].id)}>
                <Landmark className="w-4 h-4" /> Compte bancaire
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {lines.map((l, i) => {
            const v = Number(l.amount) || 0;
            const before = balanceOf(l.accountId);
            const insufficient = v > before;
            return (
              <div key={l.id} className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <span className="w-7 h-7 rounded-xl bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-xs font-black shrink-0">{i + 1}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {PAY_MODES.map(m => (
                      <button key={m.id} onClick={() => setLine(l.id, { mode: m.id })}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${l.mode === m.id ? 'bg-[#003087] text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:border-[#003087]/40'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-sm font-black tabular-nums text-[#002d87]">{money(v)}</span>
                  {lines.length > 1 && (
                    <button onClick={() => rmLine(l.id)} title="Retirer ce règlement"
                      className="w-9 h-9 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                  <Field label="Payer depuis">
                    <Select value={l.accountId} onChange={e => setLine(l.id, { accountId: e.target.value })}>
                      <option value={CAISSE_ID}>Espèces (caisse générale)</option>
                      {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Montant (DA)">
                    <Input type="number" step="0.01" inputMode="decimal" value={l.amount}
                      onChange={e => setLine(l.id, { amount: e.target.value })} className="text-right" />
                  </Field>
                  <Field label="Date"><Input type="date" value={l.date} onChange={e => setLine(l.id, { date: e.target.value })} /></Field>
                  <Field label={l.mode === 'CHEQUE' ? 'N° chèque' : 'N° bordereau'}>
                    {l.mode === 'CHEQUE'
                      ? <Input value={l.chequeNumber} onChange={e => setLine(l.id, { chequeNumber: e.target.value })} placeholder="Ex: 4452210" />
                      : <Input value={l.bordereauNumber} onChange={e => setLine(l.id, { bordereauNumber: e.target.value })} placeholder="Optionnel" />}
                  </Field>
                </div>
                <p className={`px-3 sm:px-4 pb-3 text-[11px] sm:text-xs flex items-start gap-1.5 ${insufficient ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                  {l.accountId === CAISSE_ID ? <Wallet className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <Landmark className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                  <span>
                    Solde {accountLabel(l.accountId, bankAccounts)} : {money(before)} → {money(before - v)} après paiement
                    {insufficient ? ' — solde insuffisant' : ''}
                  </span>
                </p>
              </div>
            );
          })}
        </div>

        {overpay && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            Le total des règlements dépasse le reste dû de {money(value - purchase.rest)}.
          </p>
        )}

        <div className="rounded-2xl bg-[#001f5c] text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-blue-200">Nouveau reste</span>
            {newRest <= 0 && (
              <p className="text-[11px] text-emerald-300 flex items-start gap-1 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Dette soldée — le rappel de paiement sera retiré du tableau de bord</span>
              </p>
            )}
          </div>
          <span className="text-2xl font-black tabular-nums text-[#FFB800]">{money(newRest)}</span>
        </div>
      </div>
    </Modal>
  );
}
