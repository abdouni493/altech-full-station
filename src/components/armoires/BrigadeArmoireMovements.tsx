/**
 * ─── Mouvements d'armoire d'une brigade ────────────────────────────────────────
 * Ce que la brigade a vendu depuis les armoires, ce que ses pompistes y ont
 * rangé après l'avoir acheté sur la caisse, et la photo du stock de chaque
 * armoire (début → fin), bouteilles de gaz pleines / vides comprises.
 *
 * Partagé par le détail de la brigade, la fiche imprimable et la fiche
 * journalière : les trois écrans disent exactement la même chose.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { Brigade, Pompiste, Armoire } from '@/src/store/AppContext';

const qty = (n?: number) => (Math.round((n || 0) * 1000) / 1000).toLocaleString('fr-FR');
const da = (n?: number) => `${(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DA`;

/** La brigade a-t-elle touché aux armoires ? */
export const hasArmoireMoves = (b?: Brigade | null): boolean =>
  !!b && ((b.armoireSales?.length || 0) + (b.armoireProductPurchases?.length || 0)) > 0;

export default function BrigadeArmoireMovements({
  brigade, pompistes, armoires, print = false, showSnapshot = true,
}: {
  brigade: Brigade;
  pompistes: Pompiste[];
  armoires: Armoire[];
  /** Mise en page sobre, pour l'impression (bordures fines, pas de couleurs de fond). */
  print?: boolean;
  showSnapshot?: boolean;
}) {
  const sales = brigade.armoireSales || [];
  const purchases = brigade.armoireProductPurchases || [];
  // La photo ne montre que les produits qui ont bougé ou qui restent en armoire.
  const snapshot = (brigade.armoireStockSnapshot || [])
    .filter(l => l.soldQuantity || l.purchasedQuantity || l.quantity || l.endQuantity);
  if (!sales.length && !purchases.length && !(showSnapshot && snapshot.length)) return null;

  const pompisteName = (id?: string) => pompistes.find(p => p.id === id)?.name || '—';
  const armoireName = (id?: string, fallback?: string) => armoires.find(a => a.id === id)?.name || fallback || '—';
  const anyConsigne = snapshot.some(l => l.consigne);

  const th = print
    ? 'px-2 py-1 text-left text-[9px] font-black uppercase border border-slate-300'
    : 'px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-500';
  const td = print ? 'px-2 py-1 text-[10px] border border-slate-200' : 'px-3 py-2 text-xs';
  const tableCls = print ? 'w-full border-collapse' : 'w-full';
  const wrap = print ? 'space-y-2' : 'space-y-4';
  const title = print
    ? 'text-[10px] font-black uppercase tracking-widest text-slate-700 mb-1'
    : 'text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2';
  const box = print ? '' : 'rounded-xl border border-slate-100 overflow-x-auto bg-white';
  const salesTotal = sales.reduce((s, x) => s + (x.total || 0), 0);
  const purchasesTotal = purchases.reduce((s, x) => s + (x.total || 0), 0);

  return (
    <div className={wrap}>
      {sales.length > 0 && (
        <div>
          <p className={title}>🛒 Ventes de produits depuis les armoires — {da(salesTotal)}</p>
          <div className={box}>
            <table className={tableCls}>
              <thead className={print ? '' : 'bg-slate-50'}>
                <tr>{['Pompiste', 'Armoire', 'Produit', 'Nature', 'Qté', 'Prix', 'Total'].map(h => <th key={h} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody className={print ? '' : 'divide-y divide-slate-50'}>
                {sales.map((x, i) => (
                  <tr key={i}>
                    <td className={td}>{pompisteName(x.pompisteId)}</td>
                    <td className={td}>{armoireName(x.armoireId)}</td>
                    <td className={`${td} font-bold`}>{x.productName}</td>
                    <td className={td}>{x.consigne ? 'Bouteille : plein → vide' : 'Vente'}</td>
                    <td className={`${td} text-right tabular-nums`}>{x.consigne ? `${qty(x.quantity)} vidée(s)` : `−${qty(x.quantity)}`}</td>
                    <td className={`${td} text-right tabular-nums`}>{qty(x.price)}</td>
                    <td className={`${td} text-right tabular-nums font-black`}>{da(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {purchases.length > 0 && (
        <div>
          <p className={title}>📦 Achats de produits → armoire (réglés sur la caisse) — {da(purchasesTotal)}</p>
          <div className={box}>
            <table className={tableCls}>
              <thead className={print ? '' : 'bg-slate-50'}>
                <tr>{['Pompiste', 'Armoire', 'Produit', 'Nature', 'Qté', 'Prix', 'Total', 'Fournisseur'].map(h => <th key={h} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody className={print ? '' : 'divide-y divide-slate-50'}>
                {purchases.map((x, i) => (
                  <tr key={i}>
                    <td className={td}>{pompisteName(x.pompisteId)}</td>
                    <td className={td}>{armoireName(x.armoireId)}</td>
                    <td className={`${td} font-bold`}>{x.productName}</td>
                    <td className={td}>{x.consigneMode === 'REMPLISSAGE' ? 'Remplissage (vide → plein)' : x.consigneMode === 'VIDE' ? 'Bouteilles vides' : 'Achat'}</td>
                    <td className={`${td} text-right tabular-nums`}>{x.consigneMode === 'REMPLISSAGE' ? `${qty(x.quantity)} remplie(s)` : `+${qty(x.quantity)}`}</td>
                    <td className={`${td} text-right tabular-nums`}>{qty(x.unitPrice)}</td>
                    <td className={`${td} text-right tabular-nums font-black`}>{da(x.total)}</td>
                    <td className={td}>{x.supplierName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showSnapshot && snapshot.length > 0 && (
        <div>
          <p className={title}>🗄️ Stock des armoires — début → fin de brigade</p>
          <div className={box}>
            <table className={tableCls}>
              <thead className={print ? '' : 'bg-slate-50'}>
                <tr>
                  {['Armoire', 'Produit', 'Brigade préc.', 'Transferts', 'Début', 'Vendu', 'Acheté', 'Fin',
                    ...(anyConsigne ? ['Vides début', 'Vides fin', 'Pleines fin'] : [])].map(h => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody className={print ? '' : 'divide-y divide-slate-50'}>
                {snapshot.map((l, i) => (
                  <tr key={i}>
                    <td className={td}>{armoireName(l.armoireId, l.armoireName)}</td>
                    <td className={`${td} font-bold`}>{l.productName}</td>
                    <td className={`${td} text-right tabular-nums`}>{qty(l.previousQuantity)}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.transferredQuantity ? `+${qty(l.transferredQuantity)}` : '—'}</td>
                    <td className={`${td} text-right tabular-nums font-bold`}>{qty(l.quantity)}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.soldQuantity ? (l.consigne ? `${qty(l.soldQuantity)} vidée(s)` : `−${qty(l.soldQuantity)}`) : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.purchasedQuantity ? `+${qty(l.purchasedQuantity)}` : '—'}</td>
                    <td className={`${td} text-right tabular-nums font-black`}>{qty(l.endQuantity)}</td>
                    {anyConsigne && <td className={`${td} text-right tabular-nums`}>{l.consigne ? qty(l.emptyQuantity) : '—'}</td>}
                    {anyConsigne && <td className={`${td} text-right tabular-nums font-bold`}>{l.consigne ? qty(l.endEmptyQuantity) : '—'}</td>}
                    {anyConsigne && <td className={`${td} text-right tabular-nums font-bold`}>{l.consigne ? qty((l.endQuantity || 0) - (l.endEmptyQuantity || 0)) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
