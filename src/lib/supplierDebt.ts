/**
 * ─── Dettes fournisseurs — une seule source de vérité ───────────────────────────
 *
 * Ce que la station doit à un fournisseur, c'est la somme des FACTURES qu'elle
 * n'a pas encore soldées. Rien d'autre.
 *
 * Jusqu'ici trois écrans répondaient trois choses différentes :
 *
 *   • les Rapports Généraux lisaient la colonne `suppliers.balance`, un total
 *     figé que l'écran Achats Carburant n'a jamais mis à jour → toujours 0 ;
 *   • l'écran Fournisseurs additionnait les anciens Bons de Livraison, écran
 *     remplacé par les Achats Carburant → toujours 0 lui aussi ;
 *   • le Fonds de roulement recopiait le premier, donc 0 une troisième fois.
 *
 * Un achat enregistré avec un reste à payer se voit désormais partout, parce que
 * tout le monde appelle ces fonctions : la dette est RECALCULÉE à partir des
 * documents (achats + anciens bons de livraison), jamais lue dans un total
 * stocké qui peut avoir dérivé.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/** Une facture non soldée — la brique de toutes les vues « dettes ». */
export interface SupplierDebtInvoice {
  id: string;
  supplierId: string;
  supplierName: string;
  /** N° de facture, à défaut n° de BL, à défaut le début de l'identifiant. */
  ref: string;
  date: string;
  total: number;
  paid: number;
  rest: number;
  /** `purchase` = achat (carburant ou marchandise), `bl` = ancien bon de livraison. */
  source: 'purchase' | 'bl';
  /** Vrai quand l'achat porte au moins une cuve : c'est un achat carburant. */
  fuel: boolean;
  /** Rendez-vous de paiement programmé sur l'achat, s'il y en a un. */
  appointmentDate?: string;
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const shortId = (id: string) => (id || '').slice(0, 8).toUpperCase();

/** Total payé d'un achat : ses règlements, ou à défaut son `amountPaid`. */
export function purchasePaid(p: any): number {
  const fromPayments = (p?.payments || []).reduce((s: number, x: any) => s + num(x?.amount), 0);
  return fromPayments > 0 ? fromPayments : num(p?.amountPaid);
}

/** Reste dû d'un achat, recalculé — jamais lu tel quel dans la colonne `rest`. */
export function purchaseRest(p: any): number {
  const rest = num(p?.total) - purchasePaid(p);
  // Les arrondis de TVA laissent des restes de l'ordre du millième de dinar :
  // ils ne sont pas des dettes.
  return Math.abs(rest) < 0.01 ? 0 : rest;
}

/** Un achat est-il un achat CARBURANT (au moins une ligne rattachée à une cuve) ? */
export function isFuelPurchase(p: any): boolean {
  return (p?.items || []).some((i: any) => !!i?.tankId) || !!p?.tankId;
}

/**
 * Toutes les factures non soldées de la station, achats et anciens bons de
 * livraison confondus, les plus lourdes d'abord.
 *
 * `opts.fuelOnly` limite aux achats carburant (l'activité « Carburant » des
 * rapports) ; `opts.supplierId` limite à un fournisseur.
 */
export function unpaidSupplierInvoices(
  app: any,
  opts: { fuelOnly?: boolean; supplierId?: string } = {},
): SupplierDebtInvoice[] {
  const suppliers: any[] = app?.suppliers || [];
  const nameOf = (id?: string) => suppliers.find(s => s.id === id)?.name || 'Fournisseur inconnu';
  const rows: SupplierDebtInvoice[] = [];

  for (const p of (app?.purchases || [])) {
    if (opts.supplierId && p.supplierId !== opts.supplierId) continue;
    const fuel = isFuelPurchase(p);
    if (opts.fuelOnly && !fuel) continue;
    const rest = purchaseRest(p);
    if (rest <= 0) continue;
    rows.push({
      id: p.id,
      supplierId: p.supplierId,
      supplierName: nameOf(p.supplierId),
      ref: p.invoiceNumber || p.blNumber || shortId(p.id),
      date: p.date,
      total: num(p.total),
      paid: purchasePaid(p),
      rest,
      source: 'purchase',
      fuel,
      appointmentDate: p.appointmentActive && !p.appointmentPaid ? p.appointmentDate : undefined,
    });
  }

  // Anciens Bons de Livraison — l'écran a été remplacé par les Achats Carburant,
  // mais les stations qui s'en servaient gardent des impayés à faire remonter.
  for (const n of (app?.deliveryNotes || [])) {
    if (opts.supplierId && n.supplierId !== opts.supplierId) continue;
    const total = num(n.total) || num(n.liters) * num(n.pricePerLiter);
    const paid = (n.payments || []).reduce((s: number, x: any) => s + num(x?.amount), 0);
    const rest = total - paid;
    if (rest < 0.01) continue;
    rows.push({
      id: n.id,
      supplierId: n.supplierId,
      supplierName: nameOf(n.supplierId),
      ref: n.blNumber || shortId(n.id),
      date: n.date,
      total, paid, rest,
      source: 'bl',
      fuel: true,
    });
  }

  return rows.sort((a, b) => b.rest - a.rest);
}

/** Ce qu'un fournisseur donné réclame encore, tous documents confondus. */
export function supplierBalance(app: any, supplierId: string): number {
  return unpaidSupplierInvoices(app, { supplierId }).reduce((s, r) => s + r.rest, 0);
}

/** Total dû à tous les fournisseurs (option `fuelOnly` pour l'activité Carburant). */
export function totalSupplierDebt(app: any, opts: { fuelOnly?: boolean } = {}): number {
  return unpaidSupplierInvoices(app, opts).reduce((s, r) => s + r.rest, 0);
}

/**
 * Bilan d'un fournisseur : ce qui lui a été acheté, ce qui lui a été payé, ce
 * qu'il reste à lui payer — sur toute la période demandée, ou depuis toujours.
 */
export function supplierStats(
  app: any,
  supplierId: string,
  range?: { from?: string; to?: string },
): { totalPurchased: number; totalPaid: number; balance: number; invoicesCount: number; unpaidCount: number } {
  const inRange = (d: string) => {
    if (!range?.from && !range?.to) return true;
    const day = String(d || '').slice(0, 10);
    if (range?.from && day < range.from) return false;
    if (range?.to && day > range.to) return false;
    return true;
  };

  let totalPurchased = 0, totalPaid = 0, invoicesCount = 0, unpaidCount = 0;

  for (const p of (app?.purchases || [])) {
    if (p.supplierId !== supplierId || !inRange(p.date)) continue;
    totalPurchased += num(p.total);
    totalPaid += purchasePaid(p);
    invoicesCount += 1;
    if (purchaseRest(p) > 0) unpaidCount += 1;
  }
  for (const n of (app?.deliveryNotes || [])) {
    if (n.supplierId !== supplierId || !inRange(n.date)) continue;
    const total = num(n.total) || num(n.liters) * num(n.pricePerLiter);
    const paid = (n.payments || []).reduce((s: number, x: any) => s + num(x?.amount), 0);
    totalPurchased += total;
    totalPaid += paid;
    invoicesCount += 1;
    if (total - paid >= 0.01) unpaidCount += 1;
  }

  return {
    totalPurchased,
    totalPaid,
    balance: Math.max(0, totalPurchased - totalPaid),
    invoicesCount,
    unpaidCount,
  };
}
