/**
 * ─── Shared modals & helpers for module pages ──────────────────────────────────
 * ProductModal / ContactModal are reused across Stock, Purchases, Production and
 * POS so the "create new product / client / supplier" experience is identical
 * everywhere the prompt requires it.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Package, Printer, RefreshCw, User, Truck, Wallet, Upload, Image as ImageIcon, X, Beaker, EyeOff,
  AlertTriangle, Search, Pencil, Car, Plus, Trash2, Clock, ScanLine, Hash,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, formatCurrency, matchesSearch } from '@/src/lib/utils';
const fc = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);
import { BizApi } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import {
  BizProduct, BizContact, BizDocPayment, BizCar, BizRappelConfig, DEFAULT_RAPPEL_CONFIG,
  MODULES, carLabel, BizProductRef, BizProductCar, BizGearbox, GEARBOX_LABEL,
  productRefLabel, productCarLabel, productSearchFields,
} from '@/src/lib/bizConfig';
import { saveDraft, resolveDraft, failDraft, ProductDraft } from '@/src/lib/productDrafts';
import { Modal, ModalPortal, Field, Input, Textarea, Select, Switch, InlineCreate } from '@/src/components/biz/Kit';
import BarcodeScannerModal from '@/src/components/BarcodeScannerModal';
import { uploadFile } from '@/src/lib/supabase';
import {
  barcodeLabelHTML, barcodeLabelsHTML, LABEL_40_20, LabelSize, LabelOptions,
} from '@/src/lib/barcodeLabel';

// ─── Barcode helpers ──────────────────────────────────────────────────────────
export function genBarcode(): string {
  let code = '61';
  for (let i = 0; i < 11; i++) code += Math.floor(Math.random() * 10);
  return code;
}

/**
 * ─── Étiquette code-barres ────────────────────────────────────────────────────
 * Le tracé Code 128 et la mise en page de la vignette vivent dans
 * `lib/barcodeLabel.ts` : ils s'y testent, et l'écran n'a plus qu'à ouvrir la
 * fenêtre d'impression. `barcodeSVG` reste exporté d'ici pour les appelants
 * historiques.
 */
export { barcodeSVG } from '@/src/lib/barcodeLabel';

/**
 * Ouvre l'aperçu d'étiquette d'un produit : nom en gras, code-barres à la
 * largeur de la vignette, code lisible et prix.
 *
 * TOUS les écrans qui impriment une étiquette passent par ici — la fiche
 * produit du stock comme le formulaire de saisie — pour que le format du
 * rouleau, le sens d'impression et le nombre de copies soient les mêmes
 * partout. Ces trois réglages se font dans la fenêtre d'aperçu et se retiennent
 * sur le poste ; ce que l'appelant passe n'est que le point de départ de la
 * toute première étiquette, avant qu'un réglage n'ait été enregistré.
 *
 * Le bouton ne lance plus l'impression à l'aveugle : l'aperçu s'ouvre, montre
 * la vignette telle qu'elle sortira, et c'est le bouton « Imprimer » de cette
 * fenêtre — qui a déjà le focus — qui appelle le dialogue.
 */
export function printBarcode(
  product: { name?: string; barcode?: string; salePrice?: number },
  sizeOrOptions: LabelSize | LabelOptions = LABEL_40_20,
) {
  const code = (product.barcode || '').trim();
  if (!code) {
    toast.error("Ce produit n'a pas de code-barres : générez-en un d'abord.");
    return;
  }
  // La fenêtre s'ouvre à la taille de l'aperçu agrandi et de ses réglages, pas
  // à celle de la vignette : 40 × 20 mm à l'écran ne se relit pas.
  const win = window.open('', '_blank', 'width=640,height=880');
  if (!win) {
    toast.error(
      "L'aperçu de l'étiquette a été bloqué par le navigateur. "
      + 'Autorisez les fenêtres pop-up pour ce site, puis réessayez.',
      { duration: 6000 },
    );
    return;
  }
  win.document.open();
  win.document.write(barcodeLabelHTML({ ...product, barcode: code }, sizeOrOptions));
  win.document.close();
}

/**
 * Le même aperçu, mais pour TOUT UN LOT de produits — la réception d'un achat.
 *
 * Une facture apporte douze références : les étiqueter une par une, c'est douze
 * fenêtres, douze dialogues d'impression, et le rouleau qu'on finit par régler
 * de travers en chemin. Ici la fenêtre s'ouvre une fois, montre la planche
 * entière, et le rouleau se règle pour tout le lot d'un coup.
 *
 * Chaque entrée porte son propre nombre d'exemplaires (`copies`) — la quantité
 * reçue. Les produits SANS code-barres sont écartés ici, et pas en silence :
 * l'appelant sait combien manquent, il les montre avant d'arriver jusque-là.
 */
export function printBarcodes(
  items: { name?: string; barcode?: string; salePrice?: number; copies?: number }[],
  sizeOrOptions: LabelSize | LabelOptions = LABEL_40_20,
) {
  const printable = (items || [])
    .map(i => ({ ...i, barcode: (i.barcode || '').trim() }))
    .filter(i => i.barcode);
  if (!printable.length) {
    toast.error("Aucun de ces produits n'a de code-barres : générez-en d'abord.");
    return;
  }
  const win = window.open('', '_blank', 'width=980,height=900');
  if (!win) {
    toast.error(
      "L'aperçu des étiquettes a été bloqué par le navigateur. "
      + 'Autorisez les fenêtres pop-up pour ce site, puis réessayez.',
      { duration: 6000 },
    );
    return;
  }
  win.document.open();
  win.document.write(barcodeLabelsHTML(printable, sizeOrOptions));
  win.document.close();
}

// ─── Empty product template ────────────────────────────────────────────────────
export function emptyProduct(): Partial<BizProduct> {
  return {
    name: '', description: '', barcode: '', marqueId: '', categoryId: '',
    principalQty: 0, currentQty: 0, minQty: 5, purchasePrice: 0, salePrice: 0,
    unit: 'unité', hasExpiration: false, expirationDate: '',
    sellByDetail: false, detailCapacity: 0, detailUnit: 'L', detailSalePrice: 0,
    imageUrl: '', isRawMaterial: false,
    refs: [], cars: [],
  };
}

// ─── Références & véhicules compatibles ────────────────────────────────────────
/**
 * Nettoie les références avant enregistrement : une ligne ajoutée puis
 * abandonnée (numéro vide) ne doit pas se retrouver sur la fiche, et chaque
 * référence conservée porte un identifiant — c'est lui qui la distingue de sa
 * voisine quand on en corrige une seule.
 */
export function cleanProductRefs(refs: BizProductRef[] | undefined): BizProductRef[] | undefined {
  const kept = (refs || [])
    .map(r => ({
      ...r,
      id: r.id || newId(),
      ref: (r.ref || '').trim(),
      brand: (r.brand || '').trim() || undefined,
      note: (r.note || '').trim() || undefined,
    }))
    // Le NUMÉRO fait la référence : une marque seule ne se cherche pas.
    .filter(r => r.ref);
  return kept.length ? kept : undefined;
}

/**
 * Même règle pour les véhicules : la marque OU le modèle suffit à garder la
 * ligne (« toutes les Clio » est une compatibilité valable), le reste est
 * facultatif.
 */
export function cleanProductCars(cars: BizProductCar[] | undefined): BizProductCar[] | undefined {
  const kept = (cars || [])
    .map(c => ({
      ...c,
      id: c.id || newId(),
      name: (c.name || '').trim(),
      marque: (c.marque || '').trim(),
      year: (c.year || '').trim() || undefined,
      gearbox: c.gearbox || undefined,
      description: (c.description || '').trim() || undefined,
    }))
    .filter(c => c.name || c.marque);
  return kept.length ? kept : undefined;
}

/**
 * ─── LES NUMÉROS SOUS LESQUELS LA PIÈCE EST CONNUE ─────────────────────────────
 *
 * Une pièce détachée n'a pas UN numéro, elle en a plusieurs : celui du
 * constructeur, celui de l'équipementier, celui du catalogue du fournisseur. Le
 * client qui appelle en cite un au hasard — et sans cette liste, le magasinier
 * n'a aucun moyen de savoir que le filtre posé sur son étagère est justement
 * celui-là. Chaque numéro entre donc dans la recherche du stock, des achats et
 * du point de vente.
 */
export function ProductRefsEditor({ refs, onChange }: {
  refs: BizProductRef[];
  onChange: (next: BizProductRef[]) => void;
}) {
  const patch = (id: string, key: keyof BizProductRef, value: any) =>
    onChange(refs.map(r => (r.id === id ? { ...r, [key]: value } : r)));

  const add = () => onChange([...refs, { id: newId(), ref: '', brand: '', note: '' }]);

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-violet-600" />
          <p className="text-[11px] font-black uppercase tracking-wider text-violet-800">
            Références de la pièce {refs.length > 0 && <span className="text-violet-500">({refs.length})</span>}
          </p>
        </div>
        <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={add}>
          <Plus className="w-3.5 h-3.5" /> Ajouter une référence
        </button>
      </div>
      <p className="text-[11px] font-semibold text-violet-900/60 leading-relaxed">
        Autant de numéros que la pièce en porte — <strong>origine constructeur</strong>,
        équipementier, catalogue fournisseur. Chacun retrouve le produit dans la Gestion de
        stock, dans un achat et au point de vente, avec ou sans ses espaces.
      </p>

      {refs.length === 0 ? (
        <p className="text-xs text-violet-900/50 italic py-1">Aucune référence enregistrée.</p>
      ) : (
        <div className="space-y-2">
          {refs.map((r, i) => (
            <div key={r.id || i} className="rounded-xl bg-white border border-violet-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">
                  Référence {i + 1}{productRefLabel(r) ? ` — ${productRefLabel(r)}` : ''}
                </span>
                <button type="button" title="Retirer cette référence"
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 shrink-0"
                  onClick={() => onChange(refs.filter(x => x !== r))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder="Référence (ex: 7701 478 261)" value={r.ref || ''}
                  onChange={e => patch(r.id, 'ref', e.target.value)} />
                <Input placeholder="Marque / origine (ex: Bosch)" value={r.brand || ''}
                  onChange={e => patch(r.id, 'brand', e.target.value)} />
                <Input placeholder="Note (facultatif)" value={r.note || ''}
                  onChange={e => patch(r.id, 'note', e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ─── LES VÉHICULES QUE LA PIÈCE ÉQUIPE ─────────────────────────────────────────
 *
 * Au comptoir, personne n'arrive avec une référence : on arrive avec une
 * voiture. Ce que le magasinier entend, c'est « Clio 4 de 2015, boîte
 * automatique » — et c'est exactement ce qu'il doit pouvoir taper pour voir
 * sortir les plaquettes, les filtres et la courroie qui lui vont.
 *
 * La boîte laissée vide veut dire « les deux » : c'est le cas de la grande
 * majorité des pièces, et l'imposer obligerait à saisir deux lignes pour rien.
 */
export function ProductCarsEditor({ cars, onChange }: {
  cars: BizProductCar[];
  onChange: (next: BizProductCar[]) => void;
}) {
  const patch = (id: string, key: keyof BizProductCar, value: any) =>
    onChange(cars.map(c => (c.id === id ? { ...c, [key]: value } : c)));

  const add = () => onChange([
    ...cars,
    { id: newId(), name: '', marque: '', year: '', gearbox: undefined, description: '' },
  ]);

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-blue-600" />
          <p className="text-[11px] font-black uppercase tracking-wider text-blue-800">
            Véhicules compatibles {cars.length > 0 && <span className="text-blue-500">({cars.length})</span>}
          </p>
        </div>
        <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={add}>
          <Plus className="w-3.5 h-3.5" /> Ajouter un véhicule
        </button>
      </div>
      <p className="text-[11px] font-semibold text-blue-900/60 leading-relaxed">
        Les voitures que cette pièce équipe — autant que nécessaire. La
        <strong> marque ou le modèle</strong> suffit ; l'année, la boîte et la description
        affinent. <strong>Boîte laissée vide = les deux conviennent.</strong> Le client
        annonce sa voiture, la recherche sort la pièce.
      </p>

      {cars.length === 0 ? (
        <p className="text-xs text-blue-900/50 italic py-1">Aucun véhicule enregistré.</p>
      ) : (
        <div className="space-y-2">
          {cars.map((c, i) => (
            <div key={c.id || i} className="rounded-xl bg-white border border-blue-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">
                  Véhicule {i + 1}{productCarLabel(c) ? ` — ${productCarLabel(c)}` : ''}
                </span>
                <button type="button" title="Retirer ce véhicule"
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 shrink-0"
                  onClick={() => onChange(cars.filter(x => x !== c))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Input placeholder="Marque (ex: Renault)" value={c.marque || ''}
                  onChange={e => patch(c.id, 'marque', e.target.value)} />
                <Input placeholder="Modèle (ex: Clio 4)" value={c.name || ''}
                  onChange={e => patch(c.id, 'name', e.target.value)} />
                <Input placeholder="Année (ex: 2012-2019)" value={c.year || ''}
                  onChange={e => patch(c.id, 'year', e.target.value)} />
                <Select value={c.gearbox || ''}
                  onChange={e => patch(c.id, 'gearbox', (e.target.value || undefined) as BizGearbox | undefined)}>
                  <option value="">Boîte — les deux</option>
                  <option value="auto">{GEARBOX_LABEL.auto}</option>
                  <option value="manuelle">{GEARBOX_LABEL.manuelle}</option>
                </Select>
              </div>
              <Textarea rows={2} placeholder="Description (motorisation, finition, précision…)"
                value={c.description || ''}
                onChange={e => patch(c.id, 'description', e.target.value)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Units a packaged product can be split into when sold au détail. */
export const DETAIL_UNITS = ['L', 'ml', 'kg', 'g', 'm', 'cm', 'unité'];

/**
 * Construit la fiche produit définitive à partir du formulaire — la même règle
 * s'applique à une création, à une modification et au renvoi d'un brouillon.
 */
export function buildProduct(
  form: Partial<BizProduct>,
  lookup: { marques: { id: string; name: string }[]; categories: { id: string; name: string }[] },
): BizProduct {
  const marqueName = lookup.marques.find(x => x.id === form.marqueId)?.name;
  const categoryName = lookup.categories.find(x => x.id === form.categoryId)?.name;
  // Une matière première ne se vend pas : la vente au détail, qui n'existe que
  // pour le point de vente, est retirée avec elle.
  const isRawMaterial = !!form.isRawMaterial;
  const sellByDetail = !isRawMaterial && !!form.sellByDetail;
  return {
    id: form.id || newId(),
    name: (form.name || '').trim(),
    description: form.description || '',
    barcode: form.barcode || '',
    marqueId: form.marqueId, marqueName,
    categoryId: form.categoryId, categoryName,
    principalQty: Number(form.principalQty) || 0,
    currentQty: form.id ? Number(form.currentQty) || 0 : Number(form.principalQty) || 0,
    minQty: Number(form.minQty) || 0,
    purchasePrice: Number(form.purchasePrice) || 0,
    salePrice: Number(form.salePrice) || 0,
    unit: form.unit || 'unité',
    hasExpiration: !!form.hasExpiration,
    expirationDate: form.hasExpiration ? form.expirationDate : undefined,
    sellByDetail,
    detailCapacity: sellByDetail ? Number(form.detailCapacity) || 0 : undefined,
    detailUnit: sellByDetail ? (form.detailUnit || 'L') : undefined,
    // Left empty ⇒ the POS falls back to salePrice / detailCapacity.
    detailSalePrice: sellByDetail && Number(form.detailSalePrice) > 0
      ? Number(form.detailSalePrice) : undefined,
    imageUrl: form.imageUrl || undefined,
    isRawMaterial,
    // Références et véhicules compatibles : les lignes vides laissées derrière
    // une hésitation ne partent pas en base, mais rien de ce qui est saisi
    // n'est perdu — c'est sur ces champs que la pièce se retrouvera.
    refs: cleanProductRefs(form.refs),
    cars: cleanProductCars(form.cars),
    createdAt: form.createdAt || new Date().toISOString(),
  };
}

/**
 * Enregistre un produit et NE REND LA MAIN QU'UNE FOIS LA BASE D'ACCORD.
 *
 * La fiche part dans sa propre table (`biz_products`) : une ligne de quelques
 * centaines d'octets, confirmée en une fraction de seconde. Elle n'attend plus
 * l'envoi de l'état partagé complet — 665 Ko qui expiraient au bout de huit
 * secondes sur le lien de la station, et faisaient échouer la création d'un
 * produit alors que la base allait parfaitement bien.
 *
 * Le brouillon est écrit AVANT la première tentative : à partir de cet instant,
 * même un rafraîchissement immédiat, une coupure réseau ou un refus du serveur
 * ne peuvent plus faire disparaître la saisie — elle attendra dans l'onglet
 * « Brouillons » de la Gestion de stock, avec son bouton de renvoi.
 */
export async function persistNewProduct(
  biz: BizApi,
  product: BizProduct,
  opts: { createdBy?: string; origin?: ProductDraft['origin'] } = {},
): Promise<{ ok: boolean; error?: string }> {
  const draft = saveDraft({
    moduleKey: biz.module, product, createdBy: opts.createdBy, origin: opts.origin,
  });
  const result = await biz.addAndConfirm('products', product);
  if (result.ok) resolveDraft(draft.id);
  else failDraft(draft.id, result.error);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ─── Recherche de doublons à la saisie du nom ─────────────────────────────────
/**
 * Normalise un nom pour la comparaison : minuscules, accents retirés, espaces
 * et ponctuation réduits. « Café au Lait » et « cafe-au-lait » se rapprochent
 * ainsi l'un de l'autre, ce qui est justement le but.
 */
export function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Produits du catalogue dont le nom ressemble à ce qui est en train d'être
 * tapé — c'est ce qui évite de créer une deuxième fiche « Eau minérale » alors
 * qu'elle existe déjà avec son stock et son historique.
 *
 * Les correspondances sont classées : d'abord le nom IDENTIQUE, puis ce qui
 * commence par la saisie, puis ce qui la contient. `excludeId` retire le produit
 * en cours de modification, qui n'est évidemment pas son propre doublon.
 */
export function findSimilarProducts(
  products: BizProduct[], name: string, excludeId?: string, limit = 6,
): BizProduct[] {
  const q = normalizeName(name);
  if (q.length < 2) return [];
  const scored: { p: BizProduct; score: number }[] = [];
  for (const p of products) {
    if (excludeId && p.id === excludeId) continue;
    const n = normalizeName(p.name);
    if (!n) continue;
    const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : q.includes(n) ? 3 : -1;
    if (score < 0) continue;
    scored.push({ p, score });
  }
  return scored
    .sort((a, b) => (a.score - b.score) || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(x => x.p);
}

/** « 12 kg » — quantité restante d'un produit, avec son unité. */
function formatQtyLabel(p: BizProduct): string {
  const q = Number(p.currentQty) || 0;
  const rounded = Number.isInteger(q) ? String(q) : q.toFixed(2);
  return `${rounded} ${p.unit || ''}`.trim();
}

/** Un produit porte-t-il EXACTEMENT ce nom ? (comparaison normalisée) */
export function findExactProduct(
  products: BizProduct[], name: string, excludeId?: string,
): BizProduct | undefined {
  const q = normalizeName(name);
  if (!q) return undefined;
  return products.find(p => p.id !== excludeId && normalizeName(p.name) === q);
}

// ─── ProductModal ───────────────────────────────────────────────────────────────
export function ProductModal({
  biz, open, onClose, initial, onSaved, origin = 'stock',
}: {
  biz: BizApi; open: boolean; onClose: () => void; initial?: Partial<BizProduct> | null;
  onSaved?: (p: BizProduct) => void;
  /** D'où vient la saisie — noté sur le brouillon en cas d'échec. */
  origin?: ProductDraft['origin'];
}) {
  const { currentUserName, currentModuleWorker } = useAppState();
  const [form, setForm] = useState<Partial<BizProduct>>(initial || emptyProduct());
  // La fiche ouverte peut BASCULER en modification : quand la saisie révèle un
  // produit déjà au catalogue et que l'utilisateur choisit de le reprendre, le
  // formulaire porte alors son `id` et doit l'enregistrer comme une mise à jour.
  const isEdit = !!form.id;
  const [showMarque, setShowMarque] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Liste des produits ressemblants, masquée dès que l'utilisateur l'écarte. */
  const [hideSuggestions, setHideSuggestions] = useState(false);
  /** Lecture du code-barres à la caméra plutôt qu'à la main. */
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  /**
   * Les références et la compatibilité véhicule ne concernent que la partie qui
   * vend des PIÈCES : le Lavage & Vidange. Un sandwich de cafétéria n'a ni
   * numéro d'origine ni voiture compatible.
   */
  const showAutoParts = biz.module === 'lavage';

  React.useEffect(() => { setForm(initial || emptyProduct()); setHideSuggestions(false); }, [initial, open]);

  // ── Produits déjà au catalogue qui portent (à peu près) le même nom ──────
  const similar = useMemo(
    () => findSimilarProducts(biz.state.products, form.name || '', form.id),
    [biz.state.products, form.name, form.id]);
  const duplicate = useMemo(
    () => findExactProduct(biz.state.products, form.name || '', form.id),
    [biz.state.products, form.name, form.id]);
  const showSimilar = !hideSuggestions && similar.length > 0;

  /**
   * « Reprendre ce produit » : la fiche existante est chargée dans le
   * formulaire, qui passe en MODIFICATION. C'est ce qu'il faut faire neuf fois
   * sur dix — on voulait réapprovisionner ou corriger un produit, pas en créer
   * un second qui coupe l'historique en deux.
   */
  const adoptExisting = (p: BizProduct) => {
    setForm({ ...p });
    setHideSuggestions(true);
    toast('Fiche existante chargée — vous la modifiez au lieu d\'en créer une seconde', { icon: '✏️' });
  };

  const set = (k: keyof BizProduct, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const url = await uploadFile('products', fileName, file);
      if (url) {
        set('imageUrl', url);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => set('imageUrl', reader.result as string);
        reader.readAsDataURL(file);
      }
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => set('imageUrl', reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
    }
  };

  /**
   * Enregistre — et VÉRIFIE. L'écran ne dit « Produit créé » que lorsque le
   * serveur l'a confirmé ; sinon il le dit franchement et renvoie l'utilisateur
   * vers le brouillon conservé dans la Gestion de stock.
   */
  const save = async () => {
    if (!form.name?.trim() || saving) return;
    const product = buildProduct(form, { marques: biz.state.marques, categories: biz.state.categories });
    setSaving(true);
    try {
      if (isEdit) {
        onSaved?.(product);
        onClose();
        // La fiche modifiée part dans sa ligne, et on attend le verdict : une
        // modification annoncée « enregistrée » sans l'être, c'est un prix de
        // vente faux au point de vente jusqu'au prochain rechargement.
        const res = await biz.updateAndConfirm('products', product);
        if (res.ok) toast.success('Produit modifié');
        else toast.error(`Modification non enregistrée en base — ${res.error}`, { duration: 7000 });
        return;
      }

      // Création : le brouillon est posé d'abord, la fenêtre se ferme tout de
      // suite (l'utilisateur enchaîne), la confirmation arrive derrière.
      onSaved?.(product);
      onClose();
      const res = await persistNewProduct(biz, product, {
        createdBy: currentModuleWorker?.name || currentUserName || undefined,
        origin,
      });
      if (res.ok) {
        toast.success('Produit créé et enregistré');
      } else {
        toast.error(
          `« ${product.name} » n'a pas pu être enregistré — ${res.error}. Il est gardé dans les brouillons de la Gestion de stock.`,
          { duration: 9000 },
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} icon={Package} size="xl" formScale
      title={isEdit ? 'Modifier le produit' : 'Nouveau produit'}
      subtitle="Informations du produit"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim() || uploadingImage || saving}>
          {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}
        </button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ── Nom + produits déjà existants ────────────────────────────────
            Dès les premières lettres, le catalogue est interrogé et les fiches
            qui portent (à peu près) ce nom s'affichent avec leur stock et leurs
            prix. Sans cela, un « Eau minérale » finissait par exister en trois
            exemplaires, chacun avec un bout de l'historique et du stock. */}
        <div className="sm:col-span-2">
          <Field label="Nom du produit" required
            hint="Tapez les premières lettres : les produits déjà au catalogue qui portent ce nom s'affichent en dessous.">
            <Input value={form.name || ''}
              onChange={e => { set('name', e.target.value); setHideSuggestions(false); }}
              placeholder="Ex: Huile de table" autoComplete="off" />
          </Field>

          {duplicate && (
            <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 flex flex-wrap items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-bold text-amber-800 min-w-0 flex-1">
                « {duplicate.name} » existe déjà au catalogue — stock {formatQtyLabel(duplicate)}
                {' '}· achat {fc(duplicate.purchasePrice)}
              </span>
              {!isEdit && (
                <button type="button" className="btn-secondary !py-1.5 !px-3 text-[11px] shrink-0"
                  onClick={() => adoptExisting(duplicate)}>
                  <Pencil className="w-3.5 h-3.5" /> Modifier cette fiche
                </button>
              )}
            </div>
          )}

          {showSimilar && (
            <div className="mt-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 border-b border-slate-200">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 min-w-0 flex-1">
                  {similar.length} produit(s) déjà au catalogue avec ce nom
                </p>
                <button type="button" onClick={() => setHideSuggestions(true)}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-600 shrink-0">Masquer</button>
              </div>
              <div className="max-h-52 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                {similar.map(p => (
                  <div key={p.id} className="px-3.5 py-2.5 flex flex-wrap items-center gap-2 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-700 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {p.categoryName || 'Sans catégorie'}
                        {p.barcode ? ` · ${p.barcode}` : ''}
                        {p.isRawMaterial ? ' · matière première' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] font-black text-slate-600 tabular-nums">
                        Stock {formatQtyLabel(p)}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        Achat {fc(p.purchasePrice)} · Vente {fc(p.salePrice)}
                      </p>
                    </div>
                    {!isEdit && (
                      <button type="button" className="btn-outline !py-1.5 !px-3 text-[11px] shrink-0"
                        onClick={() => adoptExisting(p)}>
                        Reprendre
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="px-3.5 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                « Reprendre » charge la fiche existante ici : vous la modifiez au lieu d'en créer une seconde,
                et son stock comme son historique restent d'un seul tenant.
              </p>
            </div>
          )}
        </div>

        {/* ── Matière première ──────────────────────────────────────────────
            Un ingrédient (farine, café en grains, huile moteur…) se suit en
            stock et s'achète, mais ne se vend jamais tel quel : il disparaît
            alors du point de vente. */}
        <div className={`sm:col-span-2 rounded-xl border px-4 py-3 transition-colors ${
          form.isRawMaterial ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Beaker className={`w-4 h-4 mt-0.5 shrink-0 ${form.isRawMaterial ? 'text-amber-600' : 'text-slate-400'}`} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700">Matière première</p>
                <p className="text-xs text-slate-400">
                  Ingrédient de production — suivi en stock et en achats, jamais vendu tel quel
                </p>
              </div>
            </div>
            <Switch checked={!!form.isRawMaterial} onChange={v => set('isRawMaterial', v)} />
          </div>
          {form.isRawMaterial && (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <EyeOff className="w-3.5 h-3.5 shrink-0" />
              Ce produit n'apparaîtra pas au point de vente.
            </p>
          )}
        </div>

        {/* Image Upload Field */}
        <div className="sm:col-span-2">
          <Field label="Photo du produit" hint="Affichée sur les cartes du point de vente (POS).">
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
              {form.imageUrl ? (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shrink-0 bg-white shadow-sm">
                  <img src={form.imageUrl} alt="Aperçu" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => set('imageUrl', '')}
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
                  {uploadingImage ? 'Téléchargement…' : form.imageUrl ? "Changer la photo" : 'Choisir une photo'}
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
        </div>

        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder="Description du produit" />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Code-barres"
            hint="Scannez le code du produit avec la caméra, ou générez-en un s'il n'en possède pas.">
            <div className="flex gap-2">
              <Input value={form.barcode || ''} onChange={e => set('barcode', e.target.value)} placeholder="Code-barres" />
              <button type="button" title="Scanner avec la caméra" className="btn-primary !px-3 shrink-0" onClick={() => { setScanNote(''); setScanning(true); }}>
                <ScanLine className="w-4 h-4" />
              </button>
              <button type="button" title="Générer" className="btn-secondary !px-3 shrink-0" onClick={() => set('barcode', genBarcode())}>
                <RefreshCw className="w-4 h-4" />
              </button>
              <button type="button" title={form.barcode ? "Aperçu et impression de l'étiquette" : "Générez ou scannez un code-barres d'abord"}
                className="btn-outline !px-3 shrink-0" onClick={() => printBarcode(form as any)} disabled={!form.barcode}>
                <Printer className="w-4 h-4" />
              </button>
            </div>
          </Field>
          {scanNote && <p className="mt-1.5 text-[11px] font-bold text-amber-700">{scanNote}</p>}
        </div>

        {/* ── Références & compatibilité véhicule ────────────────────────────
            Propres à la partie Lavage & Vidange, qui vend des pièces
            détachées : une pièce se cherche par son numéro ou par la voiture
            qu'elle équipe, jamais par son nom de rayon. Ces deux blocs
            n'apparaissent pas en Cafétéria, où ils n'auraient aucun sens. */}
        {showAutoParts && (
          <>
            <div className="sm:col-span-2">
              <ProductRefsEditor refs={form.refs || []} onChange={v => set('refs', v)} />
            </div>
            <div className="sm:col-span-2">
              <ProductCarsEditor cars={form.cars || []} onChange={v => set('cars', v)} />
            </div>
          </>
        )}

        <Field label="Marque">
          <div className="flex gap-2">
            <Select value={form.marqueId || ''} onChange={e => set('marqueId', e.target.value)}>
              <option value="">— Sélectionner —</option>
              {biz.state.marques.map(mq => <option key={mq.id} value={mq.id}>{mq.name}</option>)}
            </Select>
            <button type="button" className="btn-secondary !px-3 shrink-0" onClick={() => setShowMarque(s => !s)}>+</button>
          </div>
          {showMarque && (
            <div className="mt-2">
              <InlineCreate placeholder="Nouvelle marque" onCreate={name => {
                const it = { id: newId(), name }; biz.add('marques', it); set('marqueId', it.id); setShowMarque(false);
              }} />
            </div>
          )}
        </Field>

        <Field label="Catégorie">
          <div className="flex gap-2">
            <Select value={form.categoryId || ''} onChange={e => set('categoryId', e.target.value)}>
              <option value="">— Sélectionner —</option>
              {biz.state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <button type="button" className="btn-secondary !px-3 shrink-0" onClick={() => setShowCat(s => !s)}>+</button>
          </div>
          {showCat && (
            <div className="mt-2">
              <InlineCreate placeholder="Nouvelle catégorie" onCreate={name => {
                const it = { id: newId(), name }; biz.add('categories', it); set('categoryId', it.id); setShowCat(false);
              }} />
            </div>
          )}
        </Field>

        <Field label="Quantité principale">
          <Input type="number" value={form.principalQty ?? 0} onChange={e => set('principalQty', e.target.value)} />
        </Field>
        {isEdit && (
          <Field label="Quantité restante">
            <Input type="number" value={form.currentQty ?? 0} onChange={e => set('currentQty', e.target.value)} />
          </Field>
        )}
        <Field label="Quantité minimale (alerte)">
          <Input type="number" value={form.minQty ?? 0} onChange={e => set('minQty', e.target.value)} />
        </Field>
        <Field label="Unité">
          <Select value={form.unit || 'unité'} onChange={e => set('unit', e.target.value)}>
            {['unité', 'kg', 'g', 'L', 'ml', 'part', 'jeu', 'boîte', 'pack'].map(u => <option key={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Prix d'achat (DA)">
          <Input type="number" value={form.purchasePrice ?? 0} onChange={e => set('purchasePrice', e.target.value)} />
        </Field>
        <Field label="Prix de vente (DA)">
          <Input type="number" value={form.salePrice ?? 0} onChange={e => set('salePrice', e.target.value)} />
        </Field>

        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">Date d'expiration</p>
            <p className="text-xs text-slate-400">Activez pour suivre la péremption</p>
          </div>
          <Switch checked={!!form.hasExpiration} onChange={v => set('hasExpiration', v)} />
        </div>
        {form.hasExpiration && (
          <div className="sm:col-span-2">
            <Field label="Date d'expiration">
              <Input type="date" value={form.expirationDate || ''} onChange={e => set('expirationDate', e.target.value)} />
            </Field>
          </div>
        )}

        {/* ── Vente au détail ───────────────────────────────────────────────
            One packaged unit (a 50 L drum, a 25 kg sack…) can be sold litre by
            litre. The POS then deducts the fraction actually sold from stock.
            Sans objet pour une matière première, qui ne se vend pas. */}
        {!form.isRawMaterial && (
        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">Vente au détail</p>
            <p className="text-xs text-slate-400">Vendre une fraction d'une unité (ex: 1 L sur un bidon de 50 L)</p>
          </div>
          <Switch checked={!!form.sellByDetail} onChange={v => set('sellByDetail', v)} />
        </div>
        )}
        {!form.isRawMaterial && form.sellByDetail && (
          <>
            <Field label="Contenance d'une unité" required hint="Ex: 50 pour un bidon de 50 litres">
              <Input type="number" value={form.detailCapacity ?? 0} onChange={e => set('detailCapacity', e.target.value)} />
            </Field>
            <Field label="Unité de détail">
              <Select value={form.detailUnit || 'L'} onChange={e => set('detailUnit', e.target.value)}>
                {DETAIL_UNITS.map(u => <option key={u}>{u}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={`Prix de vente d'un ${form.detailUnit || 'L'} (DA)`}
                hint={`Laissez à 0 pour utiliser ${Number(form.salePrice) || 0} ÷ ${Number(form.detailCapacity) || 0} automatiquement.`}>
                <Input type="number" value={form.detailSalePrice ?? 0} onChange={e => set('detailSalePrice', e.target.value)} />
              </Field>
            </div>
          </>
        )}
      </div>

      {/* ── Lecture du code-barres à la caméra ───────────────────────────────
          Le code lu remplit le champ. S'il appartient DÉJÀ à un autre produit,
          on le dit au lieu de laisser deux fiches partager le même code : le
          point de vente ne saurait plus laquelle vendre. */}
      {scanning && (
        <BarcodeScannerModal
          open
          title="Scanner le code du produit"
          subtitle="Présentez l'étiquette devant la caméra"
          onClose={() => setScanning(false)}
          onDetect={code => {
            const owner = biz.state.products.find(
              (p: BizProduct) => p.id !== form.id && (p.barcode || '').trim() === code);
            set('barcode', code);
            setScanNote(owner
              ? `Ce code appartient déjà à « ${owner.name} » — changez-le, ou reprenez cette fiche.`
              : '');
            if (owner) toast.error(`Code déjà utilisé par « ${owner.name} »`);
            else toast.success(`Code-barres ${code}`);
          }}
        />
      )}
    </Modal>
  );
}

// ─── Le parc d'un client (Lavage & Vidange) ─────────────────────────────────
/**
 * ─── POURQUOI LES VOITURES VIVENT SUR LA FICHE DU CLIENT ───────────────────────
 *
 * Un lavage saisissait le véhicule DANS l'intervention : marque, modèle, plaque,
 * couleur, retapés à chaque passage. Trois conséquences, toutes vécues :
 *
 *   • la même voiture s'écrivait de trois façons (« Clio », « clio », « CLIO »)
 *     et son historique se retrouvait éparpillé sur trois orthographes ;
 *   • un client qui gare deux voitures chez vous n'avait aucun moyen de dire
 *     LAQUELLE passait aujourd'hui ;
 *   • le kilométrage, qui n'a de sens que suivi dans le temps, n'était nulle
 *     part.
 *
 * Le parc est donc porté par le CLIENT. L'intervention continue d'accepter un
 * véhicule saisi à la main — un client de passage n'a pas de fiche — mais dès
 * qu'un client est choisi, ses voitures se proposent d'elles-mêmes.
 *
 * Ce composant est volontairement autonome (il ne reçoit qu'une liste et un
 * `onChange`) pour être posé à l'identique dans TOUTES les créations de client
 * de la partie Lavage : l'écran Clients, le point de vente, la fiche
 * d'intervention.
 */
export function CarsEditor({ cars, onChange, defaults }: {
  cars: BizCar[];
  onChange: (next: BizCar[]) => void;
  /** Délais de rappel de la partie — affichés en repère (« Défaut : 30 j »). */
  defaults?: BizRappelConfig;
}) {
  const cfg = defaults || DEFAULT_RAPPEL_CONFIG;
  const patch = (id: string, key: keyof BizCar, value: any) =>
    onChange(cars.map(c => (c.id === id ? { ...c, [key]: value } : c)));

  /** Un champ « jours » vide efface l'override (retour au délai de la partie). */
  const patchDays = (id: string, key: 'rappelLavageDays' | 'rappelReparationDays', raw: string) =>
    patch(id, key, raw === '' ? undefined : Math.max(0, Number(raw) || 0));

  const add = () => onChange([
    ...cars,
    { id: newId(), name: '', marque: '', color: '', year: '', immatriculation: '', createdAt: new Date().toISOString() },
  ]);

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-blue-600" />
          <p className="text-[11px] font-black uppercase tracking-wider text-blue-800">
            Véhicules du client {cars.length > 0 && <span className="text-blue-500">({cars.length})</span>}
          </p>
        </div>
        <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={add}>
          <Plus className="w-3.5 h-3.5" /> Ajouter un véhicule
        </button>
      </div>
      <p className="text-[11px] font-semibold text-blue-900/60 leading-relaxed">
        Un client peut en avoir plusieurs. Seule la <strong>marque ou le modèle</strong> est
        nécessaire — l'immatriculation reste facultative. Le kilométrage se corrige à chaque
        passage, depuis la fiche d'intervention.
      </p>

      {cars.length === 0 ? (
        <p className="text-xs text-blue-900/50 italic py-1">Aucun véhicule enregistré.</p>
      ) : (
        <div className="space-y-2">
          {cars.map((c, i) => (
            <div key={c.id || i} className="rounded-xl bg-white border border-blue-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Véhicule {i + 1}{carLabel(c) ? ` — ${carLabel(c)}` : ''}
                </span>
                <button type="button" title="Retirer ce véhicule"
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                  onClick={() => onChange(cars.filter(x => x !== c))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Input placeholder="Nom / modèle" value={c.name || ''}
                  onChange={e => patch(c.id!, 'name', e.target.value)} />
                <Input placeholder="Marque" value={c.marque || ''}
                  onChange={e => patch(c.id!, 'marque', e.target.value)} />
                <Input placeholder="Immatriculation (facultatif)" value={c.immatriculation || ''}
                  onChange={e => patch(c.id!, 'immatriculation', e.target.value)} />
                <Input placeholder="Couleur" value={c.color || ''}
                  onChange={e => patch(c.id!, 'color', e.target.value)} />
                <Input placeholder="Année" inputMode="numeric" value={c.year || ''}
                  onChange={e => patch(c.id!, 'year', e.target.value)} />
                <Input placeholder="Kilométrage" type="number" inputMode="numeric" min={0}
                  value={c.kilometrage ?? ''}
                  onChange={e => patch(c.id!, 'kilometrage', e.target.value === '' ? undefined : Number(e.target.value) || 0)} />
              </div>

              {/* ── Le rappel PROPRE À CE VÉHICULE ─────────────────────────────
                  Chaque voiture se rappelle à SA cadence : laissez vide pour
                  suivre le délai de la partie, mettez 0 pour ne jamais rappeler
                  ce véhicule, ou un nombre de jours qui l'emporte pour lui seul. */}
              <div className="rounded-lg bg-amber-50/70 border border-amber-200 p-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                    Rappel propre à ce véhicule
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Lavage (jours)</label>
                    <Input type="number" inputMode="numeric" min={0} className="text-right"
                      placeholder={`Défaut : ${cfg.lavageDays} j`}
                      value={c.rappelLavageDays ?? ''}
                      onChange={e => patchDays(c.id!, 'rappelLavageDays', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Vidange (jours)</label>
                    <Input type="number" inputMode="numeric" min={0} className="text-right"
                      placeholder={`Défaut : ${cfg.reparationDays} j`}
                      value={c.rappelReparationDays ?? ''}
                      onChange={e => patchDays(c.id!, 'rappelReparationDays', e.target.value)} />
                  </div>
                </div>
                <p className="text-[10px] font-semibold text-amber-900/60 leading-relaxed">
                  Vide = délai de la partie. <strong>0</strong> = ce véhicule ne reçoit aucun rappel de cette nature.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Nettoie le parc avant enregistrement : une ligne entièrement vide (ajoutée
 * puis abandonnée) ne doit pas se retrouver dans la fiche, et chaque voiture
 * conservée doit avoir un identifiant — c'est lui qui la relie à ses passages.
 */
export function cleanCars(cars: BizCar[] | undefined): BizCar[] | undefined {
  /** Un délai propre au véhicule : un entier ≥ 0, ou rien (retour au défaut). */
  const cleanDays = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined;
  const kept = (cars || [])
    .map(c => ({
      ...c,
      id: c.id || newId(),
      name: (c.name || '').trim(),
      marque: (c.marque || '').trim(),
      color: (c.color || '').trim(),
      year: (c.year || '').trim(),
      immatriculation: (c.immatriculation || '').trim(),
      rappelLavageDays: cleanDays(c.rappelLavageDays),
      rappelReparationDays: cleanDays(c.rappelReparationDays),
    }))
    .filter(c => c.name || c.marque || c.immatriculation);
  return kept.length ? kept : undefined;
}

// ─── ContactModal (client / supplier) ──────────────────────────────────────────
export function ContactModal({
  biz, coll, open, onClose, initial, onSaved,
}: {
  biz: BizApi; coll: 'clients' | 'suppliers'; open: boolean; onClose: () => void;
  initial?: Partial<BizContact> | null; onSaved?: (c: BizContact) => void;
}) {
  const isSupplier = coll === 'suppliers';
  const isEdit = !!initial?.id;
  /**
   * Le parc n'a de sens que pour un CLIENT d'une partie de service (Lavage &
   * Vidange) : une cafétéria n'a que faire des voitures de ses clients, et un
   * fournisseur encore moins. Ce même composant sert partout, donc c'est ici —
   * et une seule fois — que la question se tranche.
   */
  const showCars = !isSupplier && !!MODULES[biz.module]?.isService;
  const blank = (): Partial<BizContact> => ({
    name: '', phone: '', address: '',
    openingDebt: 0, openingAdvance: 0, openingDate: todayISO(), openingNotes: '',
    cars: [],
  });
  const [form, setForm] = useState<Partial<BizContact>>(initial || blank());
  React.useEffect(() => { setForm(initial || blank()); }, [initial, open]);

  const openDebt = Math.max(0, Number(form.openingDebt) || 0);
  const openAdvance = Math.max(0, Number(form.openingAdvance) || 0);

  const save = () => {
    if (!form.name?.trim()) return;
    const contact: BizContact = {
      id: form.id || newId(),
      name: form.name!.trim(),
      phone: form.phone || '',
      address: form.address || '',
      createdAt: form.createdAt || new Date().toISOString(),
      // ── La reprise du compte ────────────────────────────────────────────
      // Un client de cafétéria ou de lavage arrive rarement à zéro : il
      // traîne l'ardoise d'un carnet plus vieux que le logiciel. Faute d'un
      // endroit où l'écrire, il fallait inventer une fausse vente — qui
      // gonflait le chiffre d'affaires d'une marchandise jamais sortie.
      openingDebt: openDebt,
      openingAdvance: openAdvance,
      openingDate: (openDebt > 0 || openAdvance > 0) ? (form.openingDate || todayISO()) : undefined,
      openingNotes: form.openingNotes || undefined,
      // Les règlements déjà encaissés sur cette reprise ne se perdent pas
      // parce qu'on rouvre la fiche pour corriger un numéro de téléphone.
      openingPayments: form.openingPayments,
      // Idem pour les dépôts d'avance (trop-perçus portés au crédit) : rouvrir
      // la fiche pour une correction ne doit pas effacer l'argent que le client
      // a laissé d'avance.
      advancePayments: form.advancePayments,
      // Le parc, nettoyé de ses lignes vides. Sur une partie sans véhicules, on
      // reconduit ce que la fiche portait déjà plutôt que de l'effacer : le même
      // client peut être modifié depuis un écran qui n'affiche pas le parc.
      cars: showCars ? cleanCars(form.cars) : initial?.cars,
    };
    if (isEdit) biz.update(coll, contact); else biz.add(coll, contact);
    onSaved?.(contact);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} icon={isSupplier ? Truck : User} size="lg" formScale
      title={isEdit ? (isSupplier ? 'Modifier le fournisseur' : 'Modifier le client') : (isSupplier ? 'Nouveau fournisseur' : 'Nouveau client')}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim()}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="Nom" required><Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom complet" /></Field>
        <Field label="Téléphone"><Input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0550 00 00 00" /></Field>
        <Field label="Adresse"><Textarea value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Adresse" /></Field>

        {showCars && (
          <CarsEditor cars={form.cars || []} onChange={cars => setForm(f => ({ ...f, cars }))}
            defaults={biz.state.rappelConfig || DEFAULT_RAPPEL_CONFIG} />
        )}

        {!isSupplier && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-800">Reprise à l'ouverture du compte</p>
            </div>
            <p className="text-[11px] font-semibold text-amber-900/70 leading-relaxed">
              Ce que le client doit déjà — ou a déjà versé — avant sa première vente ici.
              Le montant devient la première ligne de son historique et compte sur sa carte,
              dans la Caisse Générale et dans les rapports. La <b>dette</b> est une créance de
              plus ; l'<b>avance</b> est son argent : elle vient en déduction de ce qu'il doit,
              et lui reste acquise tant qu'il n'a rien pris.
            </p>
            <p className="text-[11px] font-semibold text-amber-900/70 leading-relaxed">
              Ni l'une ni l'autre ne fait bouger le tiroir aujourd'hui : ce sont des soldes
              REPRIS, contractés ou encaissés avant que la station ne tienne ce compte. Seuls
              les règlements saisis ensuite entrent en caisse.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Dette initiale (DA)">
                <Input type="number" inputMode="decimal" className="text-right" value={form.openingDebt ?? 0}
                  onChange={e => setForm(f => ({ ...f, openingDebt: Number(e.target.value) || 0 }))} />
              </Field>
              <Field label="Avance initiale (DA)">
                <Input type="number" inputMode="decimal" className="text-right" value={form.openingAdvance ?? 0}
                  onChange={e => setForm(f => ({ ...f, openingAdvance: Number(e.target.value) || 0 }))} />
              </Field>
            </div>
            {(openDebt > 0 || openAdvance > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date de la reprise">
                  <Input type="date" value={(form.openingDate || todayISO()).slice(0, 10)}
                    onChange={e => setForm(f => ({ ...f, openingDate: e.target.value }))} />
                </Field>
                <Field label="Note (facultatif)">
                  <Input value={form.openingNotes || ''} placeholder="Ancien carnet, solde repris au…"
                    onChange={e => setForm(f => ({ ...f, openingNotes: e.target.value }))} />
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Product picker (search products in stock) ─────────────────────────────────
/**
 * Un produit répond-il à ce qui est tapé ? Nom, code-barres, description,
 * MAIS AUSSI chacune de ses références et chacun des véhicules qu'il équipe —
 * les trois écrans (stock, achats, point de vente) partagent cette règle, pour
 * qu'une pièce trouvée sur l'un le soit aussi sur les deux autres.
 */
export function productMatches(p: BizProduct, query: string): boolean {
  return matchesSearch(query, ...productSearchFields(p), p.description || '');
}

export function useProductSearch(products: BizProduct[], query: string) {
  if (!query.trim()) return products;
  return products.filter(p => productMatches(p, query));
}

// ─── PayDebtModal ───────────────────────────────────────────────────────────────
/** Ce qu'un encaissement porte en plus de son montant. */
export interface PayDebtMeta {
  /** Espèces, Chèque, TPE, Virement. */
  mode: string;
  /** Numéro de chèque, de bordereau ou de transaction. */
  reference?: string;
  /** Date de l'encaissement, `YYYY-MM-DD` — aujourd'hui par défaut. */
  date: string;
}

/** Modes proposés à la caisse d'une partie. */
export const PAY_MODES = ['Espèces', 'Chèque', 'TPE', 'Virement'] as const;

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function PayDebtModal({
  open, onClose, total, alreadyPaid, advanceHeld = 0, allowAdvance = false, onPay, title = 'Payer la dette',
}: {
  open: boolean; onClose: () => void; total: number; alreadyPaid: number;
  /**
   * L'avance que la station détient DÉJÀ pour ce client. Elle ne figurait pas
   * ici : la fenêtre réclamait la dette entière à un client qui avait payé
   * d'avance, et le caissier encaissait une seconde fois le même argent.
   */
  advanceHeld?: number;
  /**
   * Autorise un ENCAISSEMENT SUPÉRIEUR à la dette : le trop-perçu devient une
   * avance au crédit du client. Réservé au règlement d'un COMPTE entier (écran
   * Clients) — un règlement sur une facture unique reste plafonné à son reste,
   * car un trop-perçu n'aurait aucune pièce où s'imputer.
   */
  allowAdvance?: boolean;
  /**
   * `meta` porte le mode, la référence et la DATE de l'encaissement : sans elle
   * un relevé de compte ne peut pas dire quand l'argent est entré.
   */
  onPay: (amount: number, meta: PayDebtMeta) => void;
  title?: string;
}) {
  const advance = Math.max(0, Number(advanceHeld) || 0);
  const gross = Math.max(0, total - alreadyPaid);
  /** Ce qu'il reste à ENCAISSER : la dette, son avance déduite. */
  const rest = Math.max(0, gross - advance);
  const [amount, setAmount] = useState<number>(rest);
  const [mode, setMode] = useState<string>('Espèces');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState<string>(todayISO());
  React.useEffect(() => {
    setAmount(rest); setMode('Espèces'); setReference(''); setDate(todayISO());
  }, [rest, open]);
  const newRest = Math.max(0, rest - (Number(amount) || 0));
  /** Le trop-perçu qui deviendra une avance — seulement là où c'est permis. */
  const surplus = allowAdvance ? Math.max(0, (Number(amount) || 0) - rest) : 0;

  return (
    <Modal open={open} onClose={onClose} icon={Wallet} size="lg" formScale title={title} subtitle="Encaissement d'un règlement partiel ou total"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" disabled={!amount || amount <= 0}
          onClick={() => { if (amount > 0) onPay(Number(amount), { mode, reference: reference.trim() || undefined, date }); }}>
          Enregistrer le paiement
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{fc(total)}</p></div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Déjà payé</p><p className="font-black text-emerald-600 tabular-nums text-sm sm:text-base">{fc(alreadyPaid)}</p></div>
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm sm:text-base">{fc(rest)}</p></div>
        </div>
        {advance > 0 && (
          <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-[11px] font-semibold text-teal-900 leading-relaxed">
            La station détient déjà <b>{fc(advance)}</b> d'avance pour ce client :
            {' '}{fc(Math.min(advance, gross))} en sont imputés sur les {fc(gross)} de ses documents ouverts.
            Ne lui réclamez que le reste.
          </div>
        )}
        <Field label="Montant à payer cette fois (DA)">
          <Input type="number" inputMode="decimal" value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            max={allowAdvance ? undefined : rest} className="text-right" />
        </Field>
        {surplus > 0 && (
          <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-[11px] font-semibold text-teal-900 leading-relaxed">
            Le client verse <b>{fc(surplus)}</b> de plus que sa dette :
            {' '}ce trop-perçu est enregistré comme une <b>avance</b> à son crédit,
            {' '}qu'il pourra utiliser sur ses prochains achats.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Mode de règlement">
            <Select value={mode} onChange={e => setMode(e.target.value)}>
              {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Référence (chèque, bordereau…)">
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optionnel" />
          </Field>
          <Field label="Date de l'encaissement">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="rounded-2xl bg-[#001f5c] text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-blue-200">Nouveau reste</span>
          <span className="text-2xl font-black tabular-nums text-[#FFB800]">{fc(newRest)}</span>
        </div>
        {surplus > 0 && (
          <div className="rounded-2xl bg-teal-600 text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-teal-100">Avance créée</span>
            <span className="text-2xl font-black tabular-nums text-white">{fc(surplus)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Les versements d'un document au moment où il est ENREGISTRÉ (création, ou
 * édition qui change le montant déjà payé).
 *
 * Tant que la somme des versements connus colle au cumul `paid`, on les garde
 * intacts — une édition de libellé ne doit pas réécrire l'histoire des
 * encaissements. Dès qu'elle ne colle plus, l'ancien détail ne décrit plus ce
 * document : il est remplacé par UN versement à la date du document, ce qui est
 * exactement ce que l'on sait de lui.
 */
export function seedPayments(
  previous: BizDocPayment[] | undefined, paid: number, date: string, by?: string,
): BizDocPayment[] | undefined {
  const known = Array.isArray(previous) ? previous : [];
  const sum = known.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  if (known.length && Math.abs(sum - paid) < 0.005) return known;
  if (paid <= 0) return undefined;
  return [{ id: newId(), date, amount: paid, mode: 'Espèces', by }];
}

/**
 * Ajoute un versement DATÉ à un document (vente ou intervention) et remet à jour
 * son cumul `paid`.
 *
 * Les documents antérieurs n'avaient qu'un cumul : le premier appel le reprend
 * comme versement d'origine, à la date du document, pour que la somme des
 * versements soit toujours égale à `paid` — sinon le relevé encaisserait deux
 * fois le même argent.
 */
export function withPayment<T extends { id: string; date: string; total: number; paid: number; payments?: BizDocPayment[] }>(
  doc: T, amount: number, meta: PayDebtMeta, by?: string,
): T & { paid: number; rest: number; payments: BizDocPayment[] } {
  const existing: BizDocPayment[] = Array.isArray(doc.payments) ? [...doc.payments] : [];
  if (!existing.length && doc.paid > 0) {
    existing.push({ id: `${doc.id}-p0`, date: doc.date, amount: doc.paid, mode: 'Espèces' });
  }
  const paid = Math.min(doc.total, doc.paid + amount);
  // Le versement réellement ajouté ne peut pas dépasser ce qui restait dû.
  const applied = paid - doc.paid;
  if (applied > 0) {
    existing.push({
      id: newId(),
      date: `${meta.date}T${new Date().toTimeString().slice(0, 8)}`,
      amount: applied,
      mode: meta.mode,
      reference: meta.reference,
      by,
    });
  }
  return { ...doc, paid, rest: Math.max(0, doc.total - paid), payments: existing };
}

// ─── Invoice print helper ───────────────────────────────────────────────────────

/** Identity of the station, printed in the header of every document. */
export interface PrintStation {
  name?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  fiscalId?: string;
  rc?: string;
}

export interface PrintPaymentLine {
  label: string;      // "Espèces", "BNA — chèque 445221"…
  amount: number;
  reference?: string;
}

export interface PrintInvoiceOptions {
  title: string;
  ref: string;
  date: string;
  station?: PrintStation;
  /** @deprecated pass `station` instead — kept so old call sites keep compiling. */
  store?: string;
  party?: { label: string; name: string; phone?: string; address?: string };
  /** Free-form blocks printed under the party (vehicle, session, worker…). */
  info?: { label: string; value: string }[];
  items: { name: string; qty: number | string; unitPrice: number; total: number }[];
  subtotal?: number;
  reduction?: number;
  tva?: number;
  total: number;
  paid: number;
  rest: number;
  payments?: PrintPaymentLine[];
  notes?: string;
  footerNote?: string;
}

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dz = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

export function printInvoice(opts: PrintInvoiceOptions) {
  const st = opts.station || {};
  const stationName = st.name || opts.store || 'altech station';

  const rows = opts.items.map(it => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(it.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${esc(it.qty)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${dz(it.unitPrice)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${dz(it.total)}</td>
    </tr>`).join('');

  const totalLine = (label: string, value: string, color = '#1e293b', border = '') =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;color:${color};${border}">
       <span>${esc(label)}</span><strong>${value} DA</strong></div>`;

  const infoBlocks = (opts.info || []).filter(i => i.value).map(i => `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 14px">
      <p style="margin:0;font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(i.label)}</p>
      <p style="margin:3px 0 0;font-weight:700;font-size:13px">${esc(i.value)}</p>
    </div>`).join('');

  const paymentRows = (opts.payments || []).filter(p => p.amount > 0).map(p => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(p.label)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#64748b">${esc(p.reference || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right"><strong>${dz(p.amount)} DA</strong></td>
    </tr>`).join('');

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)} ${esc(opts.ref)}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;max-width:760px;margin:auto">

      <!-- Header: station identity + document -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:18px;gap:16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="" style="width:58px;height:58px;object-fit:cover;border-radius:12px">` : ''}
          <div>
            <h1 style="margin:0;color:#003087;font-size:21px">${esc(stationName)}</h1>
            ${st.address ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${esc(st.address)}</p>` : ''}
            ${st.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">Tél: ${esc(st.phone)}</p>` : ''}
            ${st.email ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">${esc(st.email)}</p>` : ''}
            ${(st.fiscalId || st.rc) ? `<p style="margin:2px 0 0;color:#94a3b8;font-size:11px">
              ${st.fiscalId ? `NIF: ${esc(st.fiscalId)}` : ''}${st.fiscalId && st.rc ? ' • ' : ''}${st.rc ? `RC: ${esc(st.rc)}` : ''}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <h2 style="margin:0;color:#FFB800;font-size:19px">${esc(opts.title)}</h2>
          <p style="margin:4px 0 0;font-weight:700">${esc(opts.ref)}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:12px">${new Date(opts.date).toLocaleString('fr-DZ')}</p>
        </div>
      </div>

      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(opts.party.label)}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${esc(opts.party.name)}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${esc(opts.party.phone)}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${esc(opts.party.address)}</p>` : ''}
      </div>` : ''}

      ${infoBlocks ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">${infoBlocks}</div>` : ''}

      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#003087;color:#fff">
          <th style="padding:10px;text-align:left">Désignation</th><th style="padding:10px">Qté</th>
          <th style="padding:10px;text-align:right">P.U (DA)</th><th style="padding:10px;text-align:right">Total (DA)</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:12px;color:#94a3b8">Aucune ligne</td></tr>'}</tbody></table>

      <div style="margin-top:16px;margin-left:auto;width:280px;font-size:13px">
        ${opts.subtotal !== undefined ? totalLine('Sous-total', dz(opts.subtotal)) : ''}
        ${opts.reduction ? totalLine('Remise', `- ${dz(opts.reduction)}`, '#b45309') : ''}
        ${opts.tva ? totalLine('TVA', dz(opts.tva)) : ''}
        ${totalLine('Total', dz(opts.total), '#003087', 'border-top:2px solid #003087;font-size:15px')}
        ${totalLine('Payé', dz(opts.paid), '#059669')}
        ${totalLine('Reste', dz(opts.rest), '#dc2626')}
      </div>

      ${paymentRows ? `<div style="margin-top:22px">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">Détail du paiement</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f1f5f9;color:#475569">
            <th style="padding:6px 8px;text-align:left">Mode</th>
            <th style="padding:6px 8px;text-align:left">Référence</th>
            <th style="padding:6px 8px;text-align:right">Montant</th>
          </tr></thead><tbody>${paymentRows}</tbody></table>
      </div>` : ''}

      ${opts.notes ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#b45309;font-weight:700">Observations</p>
        <p style="margin:4px 0 0;font-size:13px">${esc(opts.notes)}</p></div>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet &amp; Signature</div></div>
      </div>
      <p style="margin-top:26px;text-align:center;color:#94a3b8;font-size:11px">
        ${esc(opts.footerNote || `${stationName} — Merci de votre confiance.`)}</p>

      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}

// ─── Purchase invoice print (facture d'achat) ───────────────────────────────────
/**
 * La facture d'achat s'imprime avec la MÊME identité visuelle que la Fiche
 * Journalière (`pages/DailyReport.tsx`) : bandeau bleu nuit dégradé, filet or,
 * bandeau d'indicateurs, parties numérotées, tableaux à en-tête bleu et pied de
 * page à signatures. Les documents qui sortent de la station se ressemblent
 * enfin, au lieu d'avoir chacun leur mise en page.
 *
 * Le document porte DEUX horodatages, parce qu'ils ne disent pas la même chose :
 * la date et l'heure de CRÉATION de la facture (quand l'achat a été enregistré)
 * et celles de l'IMPRESSION (l'instant présent), qui datent la copie papier.
 * La ligne « Créée le » n'apparaît que si l'achat porte vraiment cet horodatage :
 * la répéter depuis la date de facture n'apprendrait rien de plus.
 */
export interface PrintPurchaseInvoiceOptions {
  /** En-tête du document — « Facture d'achat » par défaut. */
  title?: string;
  ref: string;
  /** Date de la facture (jour de l'achat). */
  date: string;
  /** Horodatage d'enregistrement dans l'application, quand il est connu. */
  createdAt?: string;
  createdBy?: string;
  station?: PrintStation;
  supplier?: { label?: string; name: string; phone?: string; address?: string };
  /** Blocs libres imprimés avec le fournisseur (n° facture, BL, statut…). */
  info?: { label: string; value: string }[];
  items: { name: string; qty: number | string; unitPrice: number; total: number }[];
  subtotal?: number;
  reduction?: number;
  tva?: number;
  total: number;
  paid: number;
  rest: number;
  payments?: PrintPaymentLine[];
  notes?: string;
  footerNote?: string;
}

/* Palette de la Fiche Journalière — même bleu, même or. */
const PRINT_C = {
  blue900: '#001233',
  blue800: '#001f5c',
  blue700: '#002d87',
  blue600: '#003087',
  gold: '#FFB800',
};

/** Montant à la française : « 12 345,60 » — comme la fiche journalière. */
const frMoney = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Quantité : entière quand elle l'est, deux décimales au plus sinon. */
const frQty = (v: number | string) =>
  typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(v ?? '');

const asDate = (v?: string) => {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? null : d;
};
/** « 12/05/2026 » */
const frDay = (v?: string) => {
  const d = asDate(v);
  return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : String(v ?? '—');
};
/** « 12/05/2026 à 14:32 » — l'heure n'est ajoutée que si la valeur en porte une. */
const frMoment = (v?: string) => {
  const d = asDate(v);
  if (!d) return String(v ?? '—');
  const day = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (v !== undefined && !/\d{1,2}:\d{2}/.test(v)) return day;
  return `${day} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function printPurchaseInvoice(opts: PrintPurchaseInvoiceOptions) {
  const st = opts.station || {};
  const stationName = st.name || 'Station';
  const title = opts.title || "Facture d'achat";
  const printedAt = new Date();
  const printedLabel = `${printedAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${printedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  const items = opts.items || [];
  // Certaines factures portent une quantite deja formatee (« 1 000 L ») : on ne
  // totalise que ce qui est reellement un nombre, sinon la ligne TOTAL afficherait 0.
  const qtyCountable = items.length > 0 && items.every(it => typeof it.qty === 'number');
  const qtyTotal = items.reduce((s, it) => s + (typeof it.qty === 'number' ? it.qty : 0), 0);
  const qtyTotalLabel = qtyCountable ? frQty(qtyTotal) : '—';

  const rows = items.map((it, i) => `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="b">${esc(it.name)}</td>
      <td class="r">${esc(frQty(it.qty))}</td>
      <td class="r" style="color:#b45309">${frMoney(it.unitPrice)} DA</td>
      <td class="r b" style="color:#1d4ed8">${frMoney(it.total)} DA</td>
    </tr>`).join('');

  const infoBoxes = [
    ...(opts.supplier?.phone ? [{ label: 'Téléphone', value: opts.supplier.phone }] : []),
    ...(opts.supplier?.address ? [{ label: 'Adresse', value: opts.supplier.address }] : []),
    ...(opts.info || []).filter(i => i.value),
    ...(opts.createdBy ? [{ label: 'Enregistré par', value: opts.createdBy }] : []),
  ].map(i => `<div class="box">
      <p class="l">${esc(i.label)}</p><p class="v">${esc(i.value)}</p>
    </div>`).join('');

  const totalLine = (label: string, value: string, color: string, strong = false) =>
    `<div class="tl"${strong ? ` style="border-top:2px solid ${PRINT_C.blue700};margin-top:4px;padding-top:8px"` : ''}>
       <span>${esc(label)}</span><strong style="color:${color}">${value} DA</strong></div>`;

  const paymentRows = (opts.payments || []).filter(p => p.amount > 0).map((p, i) => `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="b">${esc(p.label)}</td>
      <td style="color:#64748b">${esc(p.reference || '—')}</td>
      <td class="r b" style="color:#047857">${frMoney(p.amount)} DA</td>
    </tr>`).join('');

  const kpis = [
    { label: 'Total facture', value: `${frMoney(opts.total)} DA`, col: PRINT_C.blue700 },
    { label: 'Payé', value: `${frMoney(opts.paid)} DA`, col: '#047857' },
    { label: 'Reste dû', value: `${frMoney(opts.rest)} DA`, col: opts.rest > 0 ? '#dc2626' : '#15803d' },
    { label: 'Articles', value: `${items.length}${qtyCountable && qtyTotal ? ` · ${frQty(qtyTotal)} u.` : ''}`, col: '#0e7490' },
  ].map(k => `<div class="kpi" style="border-left-color:${k.col}">
      <p class="l">${esc(k.label)}</p><p class="v" style="color:${k.col}">${esc(k.value)}</p>
    </div>`).join('');

  const part = (num: string, label: string, accent: string, body: string) => `
    <section class="part" style="border-top-color:${accent}">
      <div class="part-head"><span class="part-num">${num}</span><h3>${esc(label)}</h3></div>
      <div class="part-body">${body}</div>
    </section>`;

  const win = window.open('', '_blank', 'width=880,height=1000');
  if (!win) return;
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>${esc(title)} ${esc(opts.ref)}</title>
    <style>
      @page { size: A4 portrait; margin: 5mm; }
      * { box-sizing: border-box; }
      html, body { margin:0; padding:0; }
      body { font-family: Arial, Helvetica, sans-serif; color:#1e293b; background:#eef2f7;
             -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { width:794px; margin:16px auto; background:#fff; padding:0 0 10px; }
      @media print { body { background:#fff; } .sheet { width:100%; margin:0; } }

      /* ── Bandeau station (identique à la fiche journalière) ── */
      .banner { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px;
                background:linear-gradient(135deg, ${PRINT_C.blue900} 0%, ${PRINT_C.blue800} 55%, ${PRINT_C.blue600} 100%); }
      .ident { display:flex; align-items:center; gap:14px; }
      .logo { width:58px; height:58px; object-fit:contain; border-radius:8px; background:#fff; padding:3px; }
      .logo-ph { width:58px; height:58px; border-radius:8px; background:rgba(255,184,0,0.15);
                 border:1px solid rgba(255,184,0,0.4); display:flex; align-items:center; justify-content:center;
                 color:${PRINT_C.gold}; font-size:28px; font-weight:900; }
      .st-name { margin:0; font-weight:900; font-size:22px; color:#fff; letter-spacing:.3px; }
      .st-addr { margin:2px 0 0; font-size:11px; color:rgba(255,255,255,.7); }
      .st-legal { margin:2px 0 0; font-size:10px; color:rgba(255,255,255,.55); }
      .doc { text-align:right; white-space:nowrap; }
      .badge { display:inline-block; background:${PRINT_C.gold}; color:${PRINT_C.blue900}; font-weight:900;
               font-size:11px; text-transform:uppercase; letter-spacing:1px; padding:6px 14px; border-radius:6px; }
      .doc .ref { margin:7px 0 0; font-size:13px; font-weight:900; color:#fff; }
      .doc .sub { margin:2px 0 0; font-size:11px; font-weight:700; color:rgba(255,255,255,.9); }
      .doc .sub2 { margin:2px 0 0; font-size:10px; color:rgba(255,255,255,.6); }
      .goldbar { height:4px; width:100%; background:linear-gradient(90deg, ${PRINT_C.gold}, transparent); margin-bottom:14px; }

      /* ── Bandeau d'indicateurs ── */
      .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:0 14px 16px; }
      .kpi { border-left:3px solid; background:#f8fafc; border-radius:0 7px 7px 0; padding:8px 12px; }
      .kpi .l { margin:0; font-size:8.5px; font-weight:900; text-transform:uppercase; letter-spacing:.5px; color:#94a3b8; }
      .kpi .v { margin:3px 0 0; font-size:16px; font-weight:900; }

      /* ── Parties numérotées ── */
      /* Une partie longue (un tableau de 40 lignes) doit pouvoir se couper : on
         protege seulement l'en-tete et chaque ligne, et on repete le thead. */
      .part { border-top:2px solid ${PRINT_C.blue700}; margin:0 14px 14px; }
      .part-head, tr { page-break-inside:avoid; }
      thead { display:table-header-group; }
      .part-head { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid #e2e8f0; }
      .part-num { width:20px; height:20px; background:${PRINT_C.blue900}; color:${PRINT_C.gold}; border-radius:5px;
                  display:flex; align-items:center; justify-content:center; font-weight:900; font-size:11px; }
      .part-head h3 { margin:0; color:${PRINT_C.blue900}; font-weight:900; font-size:13px;
                      text-transform:uppercase; letter-spacing:.8px; }
      .part-body { padding-top:10px; }

      /* ── Tableaux ── */
      table { width:100%; border-collapse:collapse; }
      thead tr { background:${PRINT_C.blue800}; }
      th { padding:6px 9px; text-align:left; font-size:10px; font-weight:900; text-transform:uppercase;
           letter-spacing:.4px; color:#fff; }
      th.r { text-align:right; }
      td { padding:5px 9px; font-size:11px; font-weight:600; color:#1e293b; border-bottom:1px solid #eef2f7; }
      td.r { text-align:right; }
      td.b { font-weight:900; }
      tr.alt td { background:#f8fafc; }
      tr.total td { background:#eff6ff; font-weight:900; color:${PRINT_C.blue900}; }

      /* ── Blocs d'information ── */
      .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
      .box { padding:10px 13px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
      .box .l { margin:0; font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:.5px; color:#64748b; }
      .box .v { margin:3px 0 0; font-size:13px; font-weight:900; color:#0f172a; }
      .box.hero { background:#eff6ff; border-color:#bfdbfe; }
      .box.hero .v { font-size:16.5px; color:${PRINT_C.blue700}; }

      /* ── Totaux ── */
      .totals { width:300px; margin:12px 0 0 auto; }
      .tl { display:flex; justify-content:space-between; padding:5px 0; font-size:12px; font-weight:700; color:#475569; }
      .tl strong { font-size:13px; }

      .note { margin-top:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 13px; }
      .note .l { margin:0; font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:.5px; color:#b45309; }
      .note .v { margin:4px 0 0; font-size:11.5px; font-weight:600; color:#78350f; }

      /* ── Pied de page ── */
      .footer { margin:0 14px; padding-top:10px; border-top:1px solid #e2e8f0; page-break-inside:avoid; }
      .meta { display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; margin-bottom:22px; }
      .sign { display:grid; grid-template-columns:1fr 1fr; gap:60px; }
      .sign p { font-size:10.5px; font-weight:900; color:#334155; margin:0 0 34px; }
      .sign .line { border-bottom:1px solid #94a3b8; }
      .thanks { margin:16px 14px 0; text-align:center; color:#94a3b8; font-size:10px; }
    </style></head>
    <body><div class="sheet">

      <div class="banner">
        <div class="ident">
          ${st.logoUrl ? `<img class="logo" src="${esc(st.logoUrl)}" alt="logo">` : '<div class="logo-ph">&#9981;</div>'}
          <div>
            <p class="st-name">${esc(stationName)}</p>
            ${st.address ? `<p class="st-addr">${esc(st.address)}</p>` : ''}
            <p class="st-legal">${[
              st.phone && `Tél: ${esc(st.phone)}`,
              st.email && esc(st.email),
              st.fiscalId && `NIF: ${esc(st.fiscalId)}`,
              st.rc && `RC: ${esc(st.rc)}`,
            ].filter(Boolean).join('  ·  ')}</p>
          </div>
        </div>
        <div class="doc">
          <span class="badge">${esc(title)}</span>
          <p class="ref">N° ${esc(opts.ref)}</p>
          <p class="sub">Date facture : ${esc(frDay(opts.date))}</p>
          ${opts.createdAt ? `<p class="sub2">Créée le ${esc(frMoment(opts.createdAt))}</p>` : ''}
          <p class="sub2">Imprimée le ${esc(printedLabel)}</p>
        </div>
      </div>
      <div class="goldbar"></div>

      <div class="kpis">${kpis}</div>

      ${part('1', opts.supplier?.label || 'Fournisseur', PRINT_C.blue700, `
        <div class="grid">
          <div class="box hero"><p class="l">Fournisseur</p><p class="v">${esc(opts.supplier?.name || '—')}</p></div>
          ${infoBoxes}
        </div>`)}

      ${part('2', 'Détail de la facture', '#c2410c', `
        <table>
          <thead><tr>
            <th>Désignation</th><th class="r">Quantité</th><th class="r">Prix unitaire</th><th class="r">Total</th>
          </tr></thead>
          <tbody>
            ${rows || '<tr><td class="b">Aucune ligne</td><td class="r">0</td><td class="r">0,00 DA</td><td class="r">0,00 DA</td></tr>'}
            <tr class="total">
              <td>TOTAL</td>
              <td class="r">${esc(qtyTotalLabel)}</td>
              <td class="r">—</td>
              <td class="r">${frMoney(opts.total)} DA</td>
            </tr>
          </tbody>
        </table>
        <div class="totals">
          ${opts.subtotal !== undefined ? totalLine('Sous-total', frMoney(opts.subtotal), '#334155') : ''}
          ${opts.reduction ? totalLine('Remise', `- ${frMoney(opts.reduction)}`, '#b45309') : ''}
          ${opts.tva ? totalLine('TVA', frMoney(opts.tva), '#334155') : ''}
          ${totalLine('Total facture', frMoney(opts.total), PRINT_C.blue700, true)}
          ${totalLine('Payé', frMoney(opts.paid), '#047857')}
          ${totalLine('Reste dû', frMoney(opts.rest), opts.rest > 0 ? '#dc2626' : '#15803d')}
        </div>`)}

      ${part('3', 'Règlements', '#047857', `
        ${paymentRows ? `<table>
          <thead><tr><th>Mode / Compte</th><th>Référence</th><th class="r">Montant</th></tr></thead>
          <tbody>${paymentRows}
            <tr class="total"><td>TOTAL RÉGLÉ</td><td></td><td class="r">${frMoney(opts.paid)} DA</td></tr>
          </tbody></table>`
        : `<div class="grid">
             <div class="box"><p class="l">Total facture</p><p class="v">${frMoney(opts.total)} DA</p></div>
             <div class="box"><p class="l">Payé</p><p class="v" style="color:#047857">${frMoney(opts.paid)} DA</p></div>
             <div class="box"><p class="l">Reste dû</p><p class="v" style="color:${opts.rest > 0 ? '#dc2626' : '#15803d'}">${frMoney(opts.rest)} DA</p></div>
           </div>`}
        ${opts.notes ? `<div class="note"><p class="l">Observations</p><p class="v">${esc(opts.notes)}</p></div>` : ''}`)}

      <div class="footer">
        <div class="meta">
          <span>${opts.createdAt ? `Créée le ${esc(frMoment(opts.createdAt))} &nbsp;·&nbsp; ` : ''}Imprimée le ${esc(printedLabel)}</span>
          <span>${esc(stationName)} — ${esc(title)} ${esc(opts.ref)}</span>
        </div>
        <div class="sign">
          <div><p>Signature Fournisseur :</p><div class="line"></div></div>
          <div><p>Cachet &amp; Signature Station :</p><div class="line"></div></div>
        </div>
      </div>
      <p class="thanks">${esc(opts.footerNote || `${stationName} — Document généré automatiquement.`)}</p>

    </div><script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

// ─── Payment receipt (reçu de règlement) ────────────────────────────────────────
/**
 * Receipt handed to a client (or kept by the station) when a debt instalment is
 * collected. Same visual language as `printInvoice`, but the body is the
 * movement itself — dette avant → montant réglé → dette après — instead of a
 * list of articles.
 */
export interface PrintReceiptOptions {
  /** Document title, e.g. "Reçu de règlement". */
  title?: string;
  /** Receipt number printed top-right. */
  ref: string;
  date: string;
  station?: PrintStation;
  party?: { label: string; name: string; phone?: string; address?: string };
  /** Extra blocks under the party (N° facture, encaissé par…). */
  info?: { label: string; value: string }[];
  amount: number;
  /** Payment mode: Espèces / Chèque / Virement. */
  mode?: string;
  /** Cheque or transfer number. */
  reference?: string;
  /** Debt before and after the payment, printed as the receipt's summary. */
  debtBefore?: number;
  debtAfter?: number;
  notes?: string;
  footerNote?: string;
}

export function printPaymentReceipt(opts: PrintReceiptOptions) {
  const st = opts.station || {};
  const stationName = st.name || 'altech station';
  const title = opts.title || 'Reçu de règlement';

  const infoBlocks = (opts.info || []).filter(i => i.value).map(i => `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 14px">
      <p style="margin:0;font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(i.label)}</p>
      <p style="margin:3px 0 0;font-weight:700;font-size:13px">${esc(i.value)}</p>
    </div>`).join('');

  const row = (label: string, value: string, color = '#1e293b', extra = '') =>
    `<div style="display:flex;justify-content:space-between;padding:8px 0;color:${color};${extra}">
       <span>${esc(label)}</span><strong>${value} DA</strong></div>`;

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(opts.ref)}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;max-width:760px;margin:auto">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:18px;gap:16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="" style="width:58px;height:58px;object-fit:cover;border-radius:12px">` : ''}
          <div>
            <h1 style="margin:0;color:#003087;font-size:21px">${esc(stationName)}</h1>
            ${st.address ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${esc(st.address)}</p>` : ''}
            ${st.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">Tél: ${esc(st.phone)}</p>` : ''}
            ${(st.fiscalId || st.rc) ? `<p style="margin:2px 0 0;color:#94a3b8;font-size:11px">
              ${st.fiscalId ? `NIF: ${esc(st.fiscalId)}` : ''}${st.fiscalId && st.rc ? ' • ' : ''}${st.rc ? `RC: ${esc(st.rc)}` : ''}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <h2 style="margin:0;color:#FFB800;font-size:19px">${esc(title)}</h2>
          <p style="margin:4px 0 0;font-weight:700">${esc(opts.ref)}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:12px">${new Date(opts.date).toLocaleString('fr-DZ')}</p>
        </div>
      </div>

      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(opts.party.label)}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${esc(opts.party.name)}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${esc(opts.party.phone)}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${esc(opts.party.address)}</p>` : ''}
      </div>` : ''}

      ${infoBlocks ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">${infoBlocks}</div>` : ''}

      <!-- Le montant encaissé : l'information principale du reçu -->
      <div style="background:#003087;color:#fff;border-radius:12px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div>
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bfdbfe;font-weight:700">Montant encaissé</p>
          <p style="margin:6px 0 0;font-size:12px;color:#bfdbfe">
            ${esc(opts.mode || 'Espèces')}${opts.reference ? ` — ${esc(opts.reference)}` : ''}
          </p>
        </div>
        <span style="font-size:30px;font-weight:800;color:#FFB800">${dz(opts.amount)} DA</span>
      </div>

      ${(opts.debtBefore !== undefined || opts.debtAfter !== undefined) ? `
        <div style="margin-left:auto;width:300px;font-size:13px">
          ${opts.debtBefore !== undefined ? row('Dette avant règlement', dz(opts.debtBefore), '#64748b') : ''}
          ${row('Montant réglé', `- ${dz(opts.amount)}`, '#059669')}
          ${opts.debtAfter !== undefined ? row('Reste dû', dz(opts.debtAfter), '#dc2626', 'border-top:2px solid #003087;font-size:15px') : ''}
        </div>` : ''}

      ${opts.notes ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#b45309;font-weight:700">Observations</p>
        <p style="margin:4px 0 0;font-size:13px">${esc(opts.notes)}</p></div>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet &amp; Signature</div></div>
      </div>
      <p style="margin-top:26px;text-align:center;color:#94a3b8;font-size:11px">
        ${esc(opts.footerNote || `${stationName} — Reçu faisant foi de règlement.`)}</p>

      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}

// ─── "Imprimer la facture ?" prompt ─────────────────────────────────────────────
/**
 * Small confirmation shown right after a sale / lavage / vidange is saved, so
 * the user decides whether the document is printed.
 */
export function AskPrintModal({
  open, title = 'Imprimer la facture ?', message, onPrint, onSkip,
}: {
  open: boolean; title?: string; message?: string;
  onPrint: () => void; onSkip: () => void;
}) {
  if (!open) return null;
  return (
    <ModalPortal>
    <div className="modal-shell" style={{ zIndex: 80 }} onClick={onSkip}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div className="modal-box modal-box-anim max-w-sm relative z-10" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
            <Printer className="w-6 h-6 text-[#003087]" />
          </div>
          <h3 className="text-base font-black text-[#002d87] mb-2">{title}</h3>
          <p className="text-sm text-slate-500">
            {message || 'Le document reprend les informations de la station, du client et du paiement.'}
          </p>
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button onClick={onSkip} className="btn-ghost flex-1">Non, merci</button>
          <button onClick={onPrint} className="btn-primary flex-1">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

/** Maps the app's station settings onto the print header shape. */
export function stationFromSettings(settings: any): PrintStation {
  return {
    name: settings?.stationName || settings?.name,
    logoUrl: settings?.logoUrl || settings?.logo,
    address: settings?.address,
    phone: settings?.phone,
    email: settings?.email,
    fiscalId: settings?.fiscalId,
    rc: settings?.rc,
  };
}
