/**
 * ─── Historique d'un produit ───────────────────────────────────────────────────
 * L'écran « Historique » de la Gestion de stock : tout ce qui est entré et sorti
 * pour un produit, avec ses cartes de totaux (achats, ventes, gains), sa
 * recherche, ses filtres par nature et par période — et, sur chaque ligne, le
 * BON D'ACHAT ou le BON DE VENTE d'origine qui s'ouvre en entier.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  History, ShoppingCart, TrendingUp, CircleDollarSign, Boxes, Search, Receipt,
  ArrowDownRight, ArrowUpRight, Printer, Flame, Beaker, Wrench, FileText, Info,
} from 'lucide-react';
import { cn, matchesSearch } from '@/src/lib/utils';
import {
  Modal, Table, Badge, Select, money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { BizProduct, ModuleState, formatQty } from '@/src/lib/bizConfig';
import {
  computeProductHistory, ProductMovement, ProductDocument, MovementKind, MOVEMENT_LABEL,
} from '@/src/lib/productHistory';
import { printInvoice, stationFromSettings } from '@/src/pages/modules/_shared';

const KIND_ICON: Record<MovementKind, React.ElementType> = {
  purchase: ShoppingCart, sale: Receipt, reparation: Wrench, production: Beaker, destruction: Flame,
};
const KIND_TONE: Record<MovementKind, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  purchase: 'success', sale: 'info', reparation: 'warning', production: 'neutral', destruction: 'danger',
};

function Stat({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'purple';
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-yellow-500', red: 'from-red-500 to-red-600',
    purple: 'from-purple-500 to-purple-600',
  };
  return (
    <div className="rounded-2xl border border-slate-100 p-3.5 bg-white shadow-sm">
      <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}>
        <Icon style={{ width: 16, height: 16 }} />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
    </div>
  );
}

/** Le bon d'achat / bon de vente complet, ouvert depuis une ligne. */
function DocumentModal({ doc, settings, onClose }: {
  doc: ProductDocument | null; settings: any; onClose: () => void;
}) {
  if (!doc) return null;
  const print = () => printInvoice({
    title: doc.title,
    ref: doc.ref,
    date: doc.date,
    station: stationFromSettings(settings),
    party: { label: doc.partyLabel, name: doc.partyName },
    items: doc.lines.map(l => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, total: l.total })),
    subtotal: doc.subtotal || undefined,
    reduction: doc.discount || undefined,
    total: doc.total,
    paid: doc.paid,
    rest: doc.rest,
    notes: doc.note,
    info: [
      doc.car ? { label: 'Véhicule', value: doc.car } : null,
      doc.status ? { label: 'Statut', value: String(doc.status) } : null,
      doc.createdBy ? { label: 'Enregistré par', value: doc.createdBy } : null,
    ].filter(Boolean) as { label: string; value: string }[],
  });

  return (
    <Modal open onClose={onClose} icon={FileText} size="xl"
      title={`${doc.title} ${doc.ref}`} subtitle={`${doc.partyLabel} : ${doc.partyName} · ${formatDate(doc.date)}`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">Total {money(doc.total)}</span>
          <span className="text-emerald-600">Payé {money(doc.paid)}</span>
          {doc.rest > 0 && <span className="text-red-600">Reste {money(doc.rest)}</span>}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={print}><Printer className="w-4 h-4" /> Imprimer</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {([
            [doc.partyLabel, doc.partyName],
            ['Date', formatDate(doc.date)],
            ['Statut', doc.status ? String(doc.status) : '—'],
            ['Enregistré par', doc.createdBy || '—'],
            ...(doc.car ? ([['Véhicule', doc.car]] as [string, string][]) : []),
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
              <p className="font-bold text-slate-700 text-sm break-words">{v}</p>
            </div>
          ))}
        </div>

        <Table head={<>
          <th className="table-head">Ligne</th>
          <th className="table-head text-right">Quantité</th>
          <th className="table-head text-right">Prix unitaire</th>
          <th className="table-head text-right">Total</th>
        </>}>
          {doc.lines.map((l, i) => (
            <tr key={i} className={cn(l.target && 'bg-amber-50/70')}>
              <td className="table-cell">
                <span className={cn('font-bold', l.target ? 'text-amber-800' : 'text-slate-700')}>{l.name}</span>
                {l.target && <Badge tone="warning">Produit consulté</Badge>}
              </td>
              <td className="table-cell tabular-nums text-right">{l.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
              <td className="table-cell tabular-nums text-right text-slate-500">{money(l.unitPrice)}</td>
              <td className="table-cell tabular-nums text-right font-bold">{money(l.total)}</td>
            </tr>
          ))}
        </Table>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {([
            ['Sous-total', money(doc.subtotal)],
            ['Remise', doc.discount > 0 ? `− ${money(doc.discount)}` : '—'],
            ['Total', money(doc.total)],
            ['Payé', money(doc.paid)],
            ['Reste', money(doc.rest)],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
              <p className="text-[10px] uppercase font-black text-slate-400">{k}</p>
              <p className="font-black text-slate-700 tabular-nums text-sm">{v}</p>
            </div>
          ))}
        </div>

        {doc.note && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Observation</p>
            <p className="text-sm text-slate-600">{doc.note}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function ProductHistoryModal({ product, state, settings, onClose }: {
  product: BizProduct;
  state: ModuleState;
  settings: any;
  onClose: () => void;
}) {
  const history = useMemo(() => computeProductHistory(state, product), [state, product]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | MovementKind>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [doc, setDoc] = useState<ProductDocument | null>(null);

  const rows = useMemo(() => {
    return history.movements.filter(m =>
      (kind === 'all' || m.kind === kind)
      && inPeriod(m.date, period, from, to)
      && matchesSearch(q, m.ref, m.party, m.note, m.status, formatDate(m.date)));
  }, [history.movements, q, kind, period, from, to]);

  /** Les totaux de ce que l'utilisateur voit — pas ceux de tout l'historique. */
  const shown = useMemo(() => {
    const buys = rows.filter(m => m.kind === 'purchase');
    const sells = rows.filter(m => (m.kind === 'sale' || m.kind === 'reparation') && !m.canceled);
    return {
      buyQty: buys.reduce((s, m) => s + m.qty, 0),
      buyValue: buys.reduce((s, m) => s + m.total, 0),
      sellQty: sells.reduce((s, m) => s + m.qty, 0),
      sellValue: sells.reduce((s, m) => s + m.total, 0),
      gain: sells.reduce((s, m) => s + m.gain, 0),
    };
  }, [rows]);

  const t = history.totals;
  const filtering = kind !== 'all' || period !== 'all' || !!q.trim();

  return (
    <>
      <Modal open onClose={onClose} icon={History} size="2xl" fullHeight
        title={`Historique — ${product.name}`}
        subtitle={[product.barcode, product.categoryName, `Reste ${formatQty(product.currentQty)} ${product.unit || ''}`]
          .filter(Boolean).join(' · ')}
        footer={<>
          <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
            <span className="text-slate-400 uppercase tracking-widest">{rows.length} mouvement(s)</span>
            <span className="text-emerald-600">Achats {money(shown.buyValue)}</span>
            <span className="text-blue-700">Ventes {money(shown.sellValue)}</span>
            <span className={shown.gain >= 0 ? 'text-emerald-600' : 'text-red-600'}>Gain {money(shown.gain)}</span>
          </div>
          <button className="btn-ghost" onClick={onClose}>Fermer</button>
        </>}>
        <div className="space-y-5">
          {/* ── Les totaux du produit ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={ShoppingCart} tone="purple" label="Total des achats" value={money(t.purchasedValue)}
              sub={`${formatQty(t.purchasedQty)} ${product.unit || ''} · ${t.purchaseCount} facture(s) · PU moyen ${money(t.avgBuyPrice)}`} />
            <Stat icon={TrendingUp} tone="blue" label="Total des ventes" value={money(t.soldValue)}
              sub={`${formatQty(t.soldQty)} ${product.unit || ''} · ${t.saleCount} opération(s) · PU moyen ${money(t.avgSellPrice)}`} />
            <Stat icon={CircleDollarSign} tone={t.gain >= 0 ? 'green' : 'red'} label="Total des gains" value={money(t.gain)}
              sub={`Ventes ${money(t.soldValue)} − coût ${money(t.soldCost)} · marge ${t.marginPct.toFixed(1)} %`} />
            <Stat icon={Boxes} tone="amber" label="Reste en stock"
              value={`${formatQty(t.stockQty)} ${product.unit || ''}`}
              sub={`Valeur ${money(t.stockValue)}`} />
          </div>

          {(t.destroyedQty > 0 || t.consumedQty > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {t.destroyedQty > 0 && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                    <Flame className="w-4 h-4" /> Détruit : {formatQty(t.destroyedQty)} {product.unit || ''}
                  </span>
                  <span className="font-black tabular-nums text-red-600">{money(t.destroyedValue)}</span>
                </div>
              )}
              {t.consumedQty > 0 && (
                <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-purple-700 flex items-center gap-1.5">
                    <Beaker className="w-4 h-4" /> Consommé en production : {formatQty(t.consumedQty)} {product.unit || ''}
                  </span>
                  <span className="font-black tabular-nums text-purple-600">{money(t.consumedValue)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Recherche & filtres ── */}
          <div className="card-glass p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input value={q} onChange={e => setQ(e.target.value)} className="input-field pl-9"
                  placeholder="N° de bon, fournisseur, client, motif, date…" />
              </div>
              <Select value={kind} onChange={e => setKind(e.target.value as any)} className="!w-auto min-w-[180px]">
                <option value="all">Tous les mouvements</option>
                <option value="purchase">Achats</option>
                <option value="sale">Ventes</option>
                <option value="reparation">Interventions</option>
                <option value="production">Productions</option>
                <option value="destruction">Destructions</option>
              </Select>
            </div>
            <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
            {filtering && (
              <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Sur ce que vous voyez : {formatQty(shown.buyQty)} acheté(s) pour {money(shown.buyValue)} ·
                {' '}{formatQty(shown.sellQty)} vendu(s) pour {money(shown.sellValue)} ·
                {' '}gain {money(shown.gain)}.
              </p>
            )}
          </div>

          {/* ── Les mouvements ── */}
          {rows.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
              <History className="w-10 h-10 mx-auto mb-3 text-slate-200" />
              <p className="text-sm font-bold text-slate-400">
                {history.movements.length === 0
                  ? 'Aucun mouvement pour ce produit.'
                  : 'Aucun mouvement ne correspond à cette recherche.'}
              </p>
            </div>
          ) : (
            <Table head={<>
              <th className="table-head">Date</th>
              <th className="table-head">Nature</th>
              <th className="table-head">Référence</th>
              <th className="table-head">Tiers</th>
              <th className="table-head text-right">Quantité</th>
              <th className="table-head text-right">Prix unitaire</th>
              <th className="table-head text-right">Montant</th>
              <th className="table-head text-right">Gain</th>
              <th className="table-head text-right">Document</th>
            </>}>
              {rows.map(m => {
                const Icon = KIND_ICON[m.kind];
                return (
                  <tr key={m.id} className={cn('hover:bg-slate-50', m.canceled && 'opacity-60')}>
                    <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(m.date)}</td>
                    <td className="table-cell">
                      <Badge tone={KIND_TONE[m.kind]}><Icon className="w-3 h-3" /> {MOVEMENT_LABEL[m.kind]}</Badge>
                      {m.status && <div className="text-[10px] text-slate-400 mt-0.5">{m.status}</div>}
                    </td>
                    <td className="table-cell font-bold text-slate-700">{m.ref}</td>
                    <td className="table-cell text-slate-500">{m.party}</td>
                    <td className={cn('table-cell tabular-nums text-right font-bold',
                      m.direction === 'in' ? 'text-emerald-600' : 'text-red-600')}>
                      <span className="inline-flex items-center gap-1">
                        {m.direction === 'in' ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                        {m.direction === 'in' ? '+' : '−'}{formatQty(m.qty)}
                        {product.unit ? <span className="text-[10px] text-slate-400 font-medium"> {product.unit}</span> : null}
                      </span>
                    </td>
                    <td className="table-cell tabular-nums text-right text-slate-500">{money(m.unitPrice)}</td>
                    <td className={cn('table-cell tabular-nums text-right font-black', m.canceled && 'line-through text-slate-400')}>
                      {money(m.total)}
                    </td>
                    <td className={cn('table-cell tabular-nums text-right font-bold',
                      m.gain > 0 ? 'text-emerald-600' : m.gain < 0 ? 'text-red-600' : 'text-slate-300')}>
                      {m.kind === 'sale' || m.kind === 'reparation' ? money(m.gain) : '—'}
                    </td>
                    <td className="table-cell text-right">
                      {m.doc ? (
                        <button onClick={() => setDoc(m.doc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black text-[#003087] hover:bg-blue-50 transition-colors">
                          <FileText className="w-3.5 h-3.5" />
                          {m.kind === 'purchase' ? 'Bon d\'achat' : m.kind === 'sale' ? 'Bon de vente' : 'Bon'}
                        </button>
                      ) : <span className="text-[10px] text-slate-300 italic pr-2">—</span>}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}

          {rows.some(m => m.note) && (
            <div className="space-y-1.5">
              {rows.filter(m => m.note).slice(0, 8).map(m => (
                <p key={`n-${m.id}`} className="text-[11px] text-slate-400 italic">
                  <b className="text-slate-500">{formatDate(m.date)} · {m.ref}</b> — {m.note}
                </p>
              ))}
            </div>
          )}

          <p className="text-[11px] text-slate-400 italic">
            Les ventes annulées (retour, échange) restent visibles mais barrées : leur marchandise est revenue en
            stock, elles ne comptent ni dans les ventes ni dans les gains. Le gain d'une ligne est son montant
            facturé MOINS le coût de revient de la quantité sortie.
          </p>
        </div>
      </Modal>

      <DocumentModal doc={doc} settings={settings} onClose={() => setDoc(null)} />
    </>
  );
}
