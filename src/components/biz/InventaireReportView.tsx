/**
 * ─── Rapports d'inventaire (toutes activités) ──────────────────────────────────
 * Ce que les inventaires ont révélé, cafétéria et lavage réunis :
 *
 *   • combien de comptages ont été faits, combien attendent leur comparaison ;
 *   • ce qui MANQUE (pertes) et ce qui a été trouvé en PLUS (surplus), en dinars
 *     au prix d'achat ;
 *   • le détail produit par produit de chaque décalage, ouvrable d'un clic.
 *
 * Rien n'est recalculé ici : chaque inventaire porte son propre rapport d'écarts,
 * figé au moment où il a été comparé. Cet écran ne fait que les rassembler, pour
 * que deux écrans ne puissent jamais annoncer deux chiffres différents.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  ClipboardList, TrendingDown, TrendingUp, Scale, AlertTriangle, ChevronRight,
  Boxes, PackageX, CheckCircle2, Filter,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { money, formatDate, Modal, Table, Badge } from '@/src/components/biz/Kit';
import { BizInventaire, INVENTAIRE_STATUS_META, formatQty } from '@/src/lib/bizConfig';
import { InventaireSummary } from '@/src/lib/inventaire';

/** Une perte, rattachée à son inventaire et à son activité. */
export interface LossRow {
  id: string;
  partKey: string;
  partLabel: string;
  emoji: string;
  inventaire: BizInventaire;
  productName: string;
  categoryName?: string;
  unit?: string;
  countedQty: number;
  systemQty: number;
  ecart: number;
  purchasePrice: number;
  value: number;
}

/** Toutes les pertes constatées, par activité — la source de la carte « Pertes ». */
export function collectLosses(parts: InventaireSummary[]): LossRow[] {
  return parts.flatMap(p => p.inventaires.flatMap(inv =>
    (inv.comparison?.lines || [])
      .filter(l => l.kind === 'perte')
      .map(l => ({
        id: `${p.key}-${inv.id}-${l.productId}`,
        partKey: p.key, partLabel: p.label, emoji: p.emoji,
        inventaire: inv,
        productName: l.productName,
        categoryName: l.categoryName,
        unit: l.unit,
        countedQty: l.countedQty,
        systemQty: l.systemQty,
        ecart: l.ecart,
        purchasePrice: l.purchasePrice,
        value: Math.abs(l.value),
      })),
  )).sort((a, b) => b.value - a.value);
}

export default function InventaireReportView({ parts }: { parts: InventaireSummary[] }) {
  const [partKey, setPartKey] = useState<string>('all');
  const [detail, setDetail] = useState<BizInventaire | null>(null);
  const [detailPart, setDetailPart] = useState<InventaireSummary | null>(null);
  const [showLosses, setShowLosses] = useState(false);

  const shown = useMemo(
    () => (partKey === 'all' ? parts : parts.filter(p => p.key === partKey)),
    [parts, partKey]);

  const totals = useMemo(() => ({
    inventaires: shown.reduce((s, p) => s + p.inventaires.length, 0),
    drafts: shown.reduce((s, p) => s + p.drafts, 0),
    pending: shown.reduce((s, p) => s + p.pendingComparison, 0),
    corrected: shown.reduce((s, p) => s + p.corrected, 0),
    loss: shown.reduce((s, p) => s + p.lossValue, 0),
    gain: shown.reduce((s, p) => s + p.gainValue, 0),
    net: shown.reduce((s, p) => s + p.netValue, 0),
    chargeable: shown.reduce((s, p) => s + p.chargeableLossValue, 0),
  }), [shown]);

  const losses = useMemo(() => collectLosses(shown), [shown]);

  const rows = useMemo(() => shown.flatMap(p => p.inventaires.map(inv => ({ part: p, inv })))
    .sort((a, b) => new Date(b.inv.date).getTime() - new Date(a.inv.date).getTime()),
    [shown]);

  return (
    <div className="space-y-8">
      {/* Filtre par activité */}
      <div className="card-glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#FFB800]" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filtrer par activité</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setPartKey('all')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              partKey === 'all' ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
            🏢 Toutes les activités
          </button>
          {parts.map(p => (
            <button key={p.key} onClick={() => setPartKey(p.key)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                partKey === p.key ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Le résultat */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={() => setShowLosses(true)}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
          <div className="flex items-center gap-2 text-red-100">
            <TrendingDown className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Pertes d'inventaire</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(totals.loss)}</p>
          <p className="text-[11px] text-red-100 mt-0.5">
            {losses.length} produit(s) manquant(s) — voir le détail →
          </p>
        </button>

        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <TrendingUp className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Surplus constatés</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(totals.gain)}</p>
          <p className="text-[11px] text-emerald-100 mt-0.5">Marchandise trouvée en plus du stock annoncé</p>
        </div>

        <div className="rounded-2xl p-5 text-white"
          style={{ background: totals.net >= 0 ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
          <div className="flex items-center gap-2 opacity-85">
            <Scale className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Impact net</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5" style={{ color: totals.net >= 0 ? '#FFB800' : '#fff' }}>
            {money(totals.net)}
          </p>
          <p className="text-[11px] opacity-80 mt-0.5">Surplus − pertes, au prix d'achat</p>
        </div>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: ClipboardList, label: 'Inventaires', value: String(totals.inventaires), tone: 'text-[#002d87]' },
          { icon: AlertTriangle, label: 'Brouillons', value: String(totals.drafts), tone: 'text-amber-600' },
          { icon: Scale, label: 'À comparer', value: String(totals.pending), tone: 'text-violet-700' },
          { icon: CheckCircle2, label: 'Stock corrigé', value: String(totals.corrected), tone: 'text-emerald-600' },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm">
              <Icon className="w-4 h-4 text-slate-400 mb-1.5" />
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
              <p className={cn('text-xl font-black tabular-nums leading-tight', k.tone)}>{k.value}</p>
            </div>
          );
        })}
      </div>

      {/* Par activité */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Boxes className="w-5 h-5 text-[#FFB800]" /> Détail par activité
        </h3>
        <Table head={<>
          <th className="table-head">Activité</th>
          <th className="table-head text-right">Inventaires</th>
          <th className="table-head text-right">Brouillons</th>
          <th className="table-head text-right">Pertes</th>
          <th className="table-head text-right">Surplus</th>
          <th className="table-head text-right">Imputable aux employés</th>
          <th className="table-head text-right">Impact net</th>
        </>}>
          {shown.map(p => (
            <tr key={p.key} className="hover:bg-slate-50">
              <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
              <td className="table-cell tabular-nums text-right">{p.inventaires.length}</td>
              <td className="table-cell tabular-nums text-right text-amber-700">{p.drafts}</td>
              <td className="table-cell tabular-nums text-right text-red-600">{money(p.lossValue)}</td>
              <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.gainValue)}</td>
              <td className="table-cell tabular-nums text-right text-violet-700">{money(p.chargeableLossValue)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.netValue >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {money(p.netValue)}
              </td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL</td>
            <td className="table-cell tabular-nums text-right font-black">{totals.inventaires}</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{totals.drafts}</td>
            <td className="table-cell tabular-nums text-right font-black text-red-600">{money(totals.loss)}</td>
            <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(totals.gain)}</td>
            <td className="table-cell tabular-nums text-right font-black text-violet-700">{money(totals.chargeable)}</td>
            <td className={cn('table-cell tabular-nums text-right font-black', totals.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {money(totals.net)}
            </td>
          </tr>
        </Table>
      </div>

      {/* Tous les inventaires */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-[#FFB800]" /> Tous les inventaires
        </h3>
        {rows.length === 0 ? (
          <div className="card-glass p-8 text-center text-sm text-slate-400">Aucun inventaire enregistré.</div>
        ) : (
          <Table head={<>
            <th className="table-head">Inventaire</th>
            <th className="table-head">Activité</th>
            <th className="table-head">Date</th>
            <th className="table-head text-right">Produits</th>
            <th className="table-head text-right">Décalages</th>
            <th className="table-head text-right">Pertes</th>
            <th className="table-head text-right">Surplus</th>
            <th className="table-head">État</th>
            <th className="table-head text-right">Détail</th>
          </>}>
            {rows.map(({ part, inv }) => {
              const meta = INVENTAIRE_STATUS_META[inv.status];
              return (
                <tr key={`${part.key}-${inv.id}`} className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => { setDetail(inv); setDetailPart(part); }}>
                  <td className="table-cell">
                    <div className="font-black text-slate-700">{inv.ref}</div>
                    <div className="text-[11px] text-slate-400">
                      {inv.createdBy ? `par ${inv.createdBy}` : '—'}
                      {inv.chargeWorkers === false && ' · non imputé'}
                    </div>
                  </td>
                  <td className="table-cell whitespace-nowrap">{part.emoji} {part.label}</td>
                  <td className="table-cell whitespace-nowrap">{formatDate(inv.date)}</td>
                  <td className="table-cell tabular-nums text-right">{inv.lines.length}</td>
                  <td className="table-cell tabular-nums text-right">{inv.comparison?.productsWithEcart ?? '—'}</td>
                  <td className="table-cell tabular-nums text-right text-red-600">
                    {inv.comparison ? money(inv.comparison.lossValue) : '—'}
                  </td>
                  <td className="table-cell tabular-nums text-right text-emerald-600">
                    {inv.comparison ? money(inv.comparison.gainValue) : '—'}
                  </td>
                  <td className="table-cell"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  <td className="table-cell text-right">
                    <span className="text-[11px] font-black text-[#003087] inline-flex items-center gap-1">
                      Voir <ChevronRight className="w-3 h-3" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {/* Détail d'un inventaire */}
      <Modal open={!!detail} onClose={() => setDetail(null)} icon={ClipboardList} size="2xl" fullHeight
        title={detail?.ref || ''} subtitle={detailPart ? `${detailPart.label} — ${formatDate(detail?.date || '')}` : undefined}
        footer={<button className="btn-ghost ml-auto" onClick={() => setDetail(null)}>Fermer</button>}>
        {detail && (
          <div className="space-y-4">
            {!detail.comparison ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                Ce comptage n'a pas encore été comparé au stock : aucun décalage n'a donc été calculé.
                Lancez la comparaison depuis l'écran Inventaire de la partie.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Produits comptés</p>
                    <p className="font-black text-slate-700 tabular-nums">{detail.comparison.productsCounted}</p>
                  </div>
                  <div className="rounded-xl bg-red-50 p-3">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Pertes</p>
                    <p className="font-black text-red-600 tabular-nums text-sm">{money(detail.comparison.lossValue)}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Surplus</p>
                    <p className="font-black text-emerald-600 tabular-nums text-sm">{money(detail.comparison.gainValue)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Stock corrigé</p>
                    <p className="font-black text-slate-700 text-sm">
                      {detail.correctedAt ? formatDate(detail.correctedAt) : 'Non'}
                    </p>
                  </div>
                </div>

                <Table head={<>
                  <th className="table-head">Produit</th>
                  <th className="table-head text-right">Compté</th>
                  <th className="table-head text-right">Application</th>
                  <th className="table-head text-right">Décalage</th>
                  <th className="table-head text-right">Valeur</th>
                  <th className="table-head">État</th>
                </>}>
                  {detail.comparison.lines
                    .slice()
                    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                    .map(l => (
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
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Toutes les pertes, produit par produit */}
      <LossesModal open={showLosses} onClose={() => setShowLosses(false)} losses={losses} total={totals.loss} />
    </div>
  );
}

/** Détail de toutes les pertes constatées par les inventaires. */
export function LossesModal({ open, onClose, losses, total }: {
  open: boolean; onClose: () => void; losses: LossRow[]; total: number;
}) {
  return (
    <Modal open={open} onClose={onClose} icon={PackageX} size="2xl" fullHeight
      title="Pertes d'inventaire" subtitle="Marchandise manquante constatée au comptage, au prix d'achat"
      footer={<>
        <div className="mr-auto flex items-center gap-2 text-sm font-black text-red-600">
          <span className="text-slate-400 font-bold text-xs uppercase tracking-wide">Total des pertes</span>
          {money(total)}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
      </>}>
      {losses.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center text-sm font-bold text-slate-400">
          Aucune perte constatée — les comptages correspondent au stock annoncé.
        </div>
      ) : (
        <Table head={<>
          <th className="table-head">Produit</th>
          <th className="table-head">Activité</th>
          <th className="table-head">Inventaire</th>
          <th className="table-head text-right">Manquant</th>
          <th className="table-head text-right">Prix d'achat</th>
          <th className="table-head text-right">Perte</th>
        </>}>
          {losses.map(l => (
            <tr key={l.id} className="hover:bg-slate-50">
              <td className="table-cell">
                <div className="font-bold text-slate-700">{l.productName}</div>
                <div className="text-[11px] text-slate-400">
                  {l.categoryName || '—'} · compté {formatQty(l.countedQty)} contre {formatQty(l.systemQty)} annoncé(s)
                </div>
              </td>
              <td className="table-cell whitespace-nowrap">{l.emoji} {l.partLabel}</td>
              <td className="table-cell">
                <div className="font-bold text-slate-600">{l.inventaire.ref}</div>
                <div className="text-[11px] text-slate-400">{formatDate(l.inventaire.date)}</div>
              </td>
              <td className="table-cell tabular-nums text-right font-black text-red-600">
                {formatQty(l.ecart)} {l.unit || ''}
              </td>
              <td className="table-cell tabular-nums text-right text-slate-500">{money(l.purchasePrice)}</td>
              <td className="table-cell tabular-nums text-right font-black text-red-600">{money(l.value)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Modal>
  );
}
