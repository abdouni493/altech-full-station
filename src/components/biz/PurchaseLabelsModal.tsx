/**
 * ─── LES ÉTIQUETTES D'UNE FACTURE D'ACHAT ─────────────────────────────────────
 *
 * Le moment que cet écran sert : la livraison est posée par terre, la facture
 * est saisie, et il faut maintenant étiqueter tout ce qui vient d'arriver avant
 * de le mettre en rayon.
 *
 * Jusqu'ici il fallait ressortir chaque produit de la Gestion de stock, un par
 * un, pour lui imprimer sa vignette : une facture de douze références, c'était
 * douze allers-retours, douze fenêtres d'aperçu et autant de chances d'en
 * oublier une. Or la facture SAIT déjà ce qui est arrivé, et en quelle
 * quantité — c'est exactement la liste d'étiquettes à sortir.
 *
 * D'où cet écran : la facture ouvre SES produits, on décoche ce qu'on n'a pas
 * besoin d'étiqueter, la quantité reçue sert de nombre d'étiquettes par défaut,
 * et tout part sur le même rouleau (voir `lib/barcodeLabel.ts`).
 *
 * Deux détails qui comptent :
 *
 *   • le PRIX imprimé est celui décidé SUR CETTE FACTURE quand elle en porte un
 *     (`salePrice` de la ligne), sinon celui du catalogue. C'est l'achat qui
 *     (re)décide du prix de vente : étiqueter au prix d'hier remettrait en rayon
 *     l'ancien tarif le jour même où on le change ;
 *   • un produit SANS code-barres ne peut pas s'imprimer. Il reste visible, en
 *     tête de liste, avec de quoi lui en attribuer un sur-le-champ — le faire
 *     disparaître donnerait une planche incomplète sans dire pourquoi.
 */
import React, { useMemo, useState } from 'react';
import { Barcode, Printer, Package, AlertTriangle, Wand2, CheckSquare, Square } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { BizPurchase, BizProduct, formatQty } from '@/src/lib/bizConfig';
import { BizApi } from '@/src/store/BizContext';
import { Modal, Table, Badge, money } from '@/src/components/biz/Kit';
import { printBarcodes, genBarcode } from '@/src/pages/modules/_shared';

/** Une ligne de la facture, rapprochée de sa fiche produit. */
interface LabelRow {
  key: string;
  productId: string;
  product?: BizProduct;
  name: string;
  barcode: string;
  /** Quantité reçue sur la facture — le nombre d'étiquettes par défaut. */
  qty: number;
  /** Prix qui sera imprimé sur la vignette. */
  price: number;
}

/**
 * Le nombre d'étiquettes que propose une ligne : la quantité reçue, arrondie au
 * supérieur (2,5 bidons livrés, c'est 3 contenants à étiqueter) et plafonnée —
 * une saisie à 400 ne doit pas engager tout le rouleau sans qu'on l'ait voulu.
 */
export function defaultCopies(qty: number): number {
  const n = Math.ceil(Number(qty) || 0);
  return Math.max(1, Math.min(99, n));
}

/** Un code-barres qu'aucun produit du catalogue ne porte déjà. */
function freshBarcode(products: BizProduct[]): string {
  const taken = new Set(products.map(p => (p.barcode || '').trim()).filter(Boolean));
  for (let i = 0; i < 20; i++) {
    const code = genBarcode();
    if (!taken.has(code)) return code;
  }
  return genBarcode();
}

export default function PurchaseLabelsModal({
  open, onClose, purchase, biz, canEdit,
}: {
  open: boolean;
  onClose: () => void;
  purchase: BizPurchase | null;
  biz: BizApi;
  /** Attribuer un code-barres manquant modifie la FICHE PRODUIT : à autoriser. */
  canEdit: boolean;
}) {
  const products = biz.state.products as BizProduct[];

  const rows: LabelRow[] = useMemo(() => {
    if (!purchase) return [];
    return purchase.items.map((it, i) => {
      const product = products.find(p => p.id === it.productId);
      return {
        key: `${it.productId || 'x'}-${i}`,
        productId: it.productId,
        product,
        name: product?.name || it.productName,
        barcode: (product?.barcode || '').trim(),
        qty: it.qty,
        // Le prix décidé sur CETTE facture prime sur celui du catalogue.
        price: it.salePrice ?? product?.salePrice ?? 0,
      };
    });
  }, [purchase, products]);

  /** Lignes cochées, et nombre d'étiquettes de chacune. */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [generating, setGenerating] = useState<string | null>(null);

  /**
   * À l'ouverture (et à chaque changement de facture) : tout ce qui PEUT
   * s'imprimer est coché, avec la quantité reçue pour nombre d'étiquettes.
   * C'est le geste attendu neuf fois sur dix — on décoche l'exception.
   *
   * Le remplissage se fait PENDANT le rendu, pas dans un effet. Un effet ne
   * part qu'après l'affichage : la boîte s'ouvrait donc sur « 0 produit ·
   * 0 étiquette », toutes cases décochées, avant de se remplir à l'image
   * suivante. React réexécute simplement le composant, et rien de faux n'est
   * jamais montré.
   *
   * La clé retient l'OUVERTURE autant que la facture : refermer puis rouvrir la
   * même facture repart d'une liste propre, sans traîner les cases décochées la
   * fois d'avant.
   */
  const seedKey = open && purchase ? purchase.id : null;
  const [seeded, setSeeded] = useState<string | null>(null);
  if (seeded !== seedKey) {
    setSeeded(seedKey);
    if (seedKey) {
      const pick: Record<string, boolean> = {};
      const cop: Record<string, number> = {};
      for (const r of rows) {
        pick[r.key] = !!r.barcode;
        cop[r.key] = defaultCopies(r.qty);
      }
      setPicked(pick);
      setCopies(cop);
    }
  }

  const missing = rows.filter(r => !r.barcode);
  const selected = rows.filter(r => picked[r.key] && r.barcode);
  const totalLabels = selected.reduce((s, r) => s + (copies[r.key] || 1), 0);
  const allPicked = rows.every(r => !r.barcode || picked[r.key]);

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.key] = r.barcode ? !allPicked : false;
    setPicked(next);
  };

  const setCount = (key: string, raw: string) => {
    const n = Math.max(1, Math.min(99, Math.round(Number(raw) || 1)));
    setCopies(c => ({ ...c, [key]: n }));
  };

  /**
   * Attribue un code-barres au produit et ATTEND le verdict du serveur : une
   * étiquette imprimée sur un code que la base n'a pas gardé ne se scannera
   * jamais au point de vente.
   */
  const generate = async (row: LabelRow) => {
    if (!row.product || generating) return;
    setGenerating(row.key);
    try {
      const updated = { ...row.product, barcode: freshBarcode(products) };
      const res = await biz.updateAndConfirm('products', updated);
      if (res.ok) {
        setPicked(p => ({ ...p, [row.key]: true }));
        toast.success(`Code-barres attribué à « ${updated.name} »`);
      } else {
        toast.error(`Code-barres non enregistré — ${res.error}`, { duration: 7000 });
      }
    } finally {
      setGenerating(null);
    }
  };

  const print = () => {
    if (!selected.length) return;
    printBarcodes(selected.map(r => ({
      name: r.name,
      barcode: r.barcode,
      salePrice: r.price,
      copies: copies[r.key] || 1,
    })));
  };

  return (
    // La planche s'ouvre aussi DEPUIS la fiche de l'achat, qui reste derrière :
    // sans ce plan, elle s'afficherait dessous et paraîtrait ne pas répondre.
    <Modal open={open} onClose={onClose} icon={Barcode} size="2xl" zClass="z-[70]"
      title="Étiquettes code-barres"
      subtitle={purchase ? `Achat ${purchase.ref} — ${purchase.items.length} produit(s)` : undefined}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={print} disabled={!selected.length}>
          <Printer className="w-4 h-4" />
          {totalLabels > 0
            ? `Imprimer ${totalLabels} étiquette${totalLabels > 1 ? 's' : ''}`
            : 'Imprimer'}
        </button>
      </>}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Cette facture ne porte aucun produit.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={toggleAll}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-2 text-xs font-black text-slate-600 transition-colors">
              {allPicked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allPicked ? 'Tout décocher' : 'Tout cocher'}
            </button>
            <span className="text-xs font-bold text-slate-400">
              {selected.length} produit(s) · {totalLabels} étiquette(s)
            </span>
          </div>

          {/* Les produits sans code-barres : dits franchement, et réparables
              ici même. Une planche incomplète sans explication, c'est un rayon
              où la moitié des articles ne passe pas en caisse. */}
          {missing.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] leading-relaxed text-amber-800 font-semibold">
                {missing.length} produit(s) de cette facture n'ont pas de code-barres : ils ne
                peuvent pas être étiquetés.
                {canEdit
                  ? ' Attribuez-leur-en un avec le bouton « Générer » — la fiche produit est mise à jour.'
                  : " Un responsable doit leur en attribuer un depuis la Gestion de stock."}
              </p>
            </div>
          )}

          <Table head={<>
            <th className="table-head w-10"></th>
            <th className="table-head">Produit</th>
            <th className="table-head">Code-barres</th>
            <th className="table-head text-right">Reçu</th>
            <th className="table-head text-right">Prix vente</th>
            <th className="table-head text-right">Étiquettes</th>
          </>}>
            {rows.map(r => {
              const on = !!picked[r.key] && !!r.barcode;
              return (
                <tr key={r.key} className={r.barcode ? undefined : 'bg-amber-50/60'}>
                  <td className="table-cell">
                    <input type="checkbox" checked={on} disabled={!r.barcode}
                      onChange={e => setPicked(p => ({ ...p, [r.key]: e.target.checked }))}
                      className="w-4 h-4 accent-[#003087] disabled:opacity-40"
                      title={r.barcode ? 'Imprimer cette étiquette' : 'Sans code-barres : impossible à imprimer'} />
                  </td>
                  <td className="table-cell font-bold">
                    <span className="inline-flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-slate-400" />{r.name}
                    </span>
                    {!r.product && (
                      <span className="block text-[10px] font-bold text-slate-400">
                        Produit retiré du catalogue
                      </span>
                    )}
                  </td>
                  <td className="table-cell font-mono text-xs">
                    {r.barcode || (
                      <span className="inline-flex items-center gap-2">
                        <Badge tone="warning">Aucun</Badge>
                        {canEdit && r.product && (
                          <button onClick={() => generate(r)} disabled={generating === r.key}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#003087] hover:bg-[#001f5c] disabled:opacity-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white transition-colors">
                            <Wand2 className="w-3 h-3" />
                            {generating === r.key ? '…' : 'Générer'}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="table-cell tabular-nums text-right text-slate-500">{formatQty(r.qty)}</td>
                  <td className="table-cell tabular-nums text-right">{r.price > 0 ? money(r.price) : '—'}</td>
                  <td className="table-cell text-right">
                    <input type="number" min={1} max={99} step={1}
                      value={copies[r.key] ?? 1} disabled={!on}
                      onChange={e => setCount(r.key, e.target.value)}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm font-bold tabular-nums disabled:bg-slate-50 disabled:text-slate-300" />
                  </td>
                </tr>
              );
            })}
          </Table>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Le prix imprimé est celui décidé sur cette facture quand elle en porte un, sinon celui
            du catalogue. Le format du rouleau et le sens d'impression se règlent dans la fenêtre
            d'aperçu, et restent retenus sur ce poste.
          </p>
        </div>
      )}
    </Modal>
  );
}
