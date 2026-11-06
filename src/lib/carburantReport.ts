/**
 * ─── RAPPORT CARBURANT (période + pompiste) ──────────────────────────────────
 * Rassemble, pour une période et éventuellement UN pompiste, tout ce que la
 * partie Carburant a produit : ventes des pistolets, produits vendus depuis les
 * armoires et les magasins pendant les brigades, espèces remises, chaque mode
 * de justification (TPE, TAG, crédit client, dépenses, achats produits), les
 * décalages, les achats carburant et les factures de l'écran Ventes Carburant.
 *
 * Chaque total est accompagné de ses LIGNES : l'écran les déplie au clic sur une
 * carte, pour montrer comment le chiffre a été obtenu.
 */
import { within } from './period';
import {
  brigadeNozzleRows, brigadePompisteGroups, justifiedByPompiste, BrigadeCalcContext,
} from './brigadeCalc';

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface ReportLine {
  id: string;
  date: string;
  label: string;
  sub?: string;
  pompiste?: string;
  qty?: number;
  unit?: string;
  amount: number;
}

export interface PompisteRow {
  pompisteId: string;
  name: string;
  brigades: number;
  liters: number;
  fuelAmount: number;
  products: number;
  theoretical: number;
  cash: number;
  tpe: number;
  tag: number;
  credit: number;
  expense: number;
  achat: number;
  justified: number;
  ecart: number;
}

export interface BrigadeRow extends PompisteRow {
  brigadeId: string;
  date: string;
  shift: string;
  status: string;
}

export interface FuelRow { fuelType: string; liters: number; amount: number; buyPrice: number; cost: number; margin: number }

export interface CarburantPeriodReport {
  from: string; to: string; pompisteId?: string;
  brigadeCount: number;
  liters: number;
  fuelSales: number;
  fuelCost: number;
  fuelMargin: number;
  armoireSales: number;
  magasinSales: number;
  theoretical: number;
  cash: number;
  tpe: number;
  tag: number;
  credit: number;
  expense: number;
  achat: number;
  justified: number;
  /** théorique − espèces − justifié : > 0 manquant, < 0 excédent. */
  ecart: number;
  shortages: number;
  surpluses: number;
  purchases: number;
  purchaseLiters: number;
  invoices: number;
  invoicesPaid: number;
  invoicesRest: number;
  details: Record<string, ReportLine[]>;
  byPompiste: PompisteRow[];
  byBrigade: BrigadeRow[];
  byFuel: FuelRow[];
  byDay: { day: string; liters: number; amount: number }[];
}

const emptyRow = (pompisteId: string, name: string): PompisteRow => ({
  pompisteId, name, brigades: 0, liters: 0, fuelAmount: 0, products: 0, theoretical: 0,
  cash: 0, tpe: 0, tag: 0, credit: 0, expense: 0, achat: 0, justified: 0, ecart: 0,
});

export function computeCarburantPeriodReport(app: any, from: string, to: string, pompisteId?: string): CarburantPeriodReport {
  const ctx: BrigadeCalcContext = {
    pumps: app.pumps || [], tanks: app.tanks || [], pumpNozzles: app.pumpNozzles || [],
    pompistes: app.pompistes || [], settings: app.settings,
  };
  const buyPrices = app.settings?.fuelBuyPrices || {};
  const pName = (id?: string) => (app.pompistes || []).find((p: any) => p.id === id)?.name
    || (app.brigadeChefs || []).find((c: any) => c.id === id)?.name || '—';
  const details: Record<string, ReportLine[]> = {
    sales: [], armoire: [], magasin: [], cash: [], tpe: [], tag: [], credit: [], expense: [], achat: [],
    ecart: [], purchases: [], invoices: [], theoretical: [],
  };
  const byPompiste = new Map<string, PompisteRow>();
  const byBrigade: BrigadeRow[] = [];
  const byFuel = new Map<string, FuelRow>();
  const byDay = new Map<string, { day: string; liters: number; amount: number }>();
  const clientName = (id?: string) => (app.clients || []).find((c: any) => c.id === id)?.name;

  const brigades = (app.brigades || []).filter((b: any) => within(b.date, from, to));
  let brigadeCount = 0;

  for (const b of brigades) {
    const acc = (app.brigadeAccountings || []).find((a: any) => a.brigadeId === b.id);
    const justifs: any[] = acc?.justifications || [];
    const rows = brigadeNozzleRows(b, ctx);
    const groups = brigadePompisteGroups(b, ctx, rows, justifiedByPompiste(justifs));
    const day = String(b.date).slice(0, 10);
    let counted = false;

    for (const g of groups) {
      if (pompisteId && g.pompisteId !== pompisteId) continue;
      if (g.unassigned && !g.totalLiters && !g.theoretical) continue;
      counted = true;
      const mine = justifs.filter(j => (j.pompisteId || '_unassigned') === g.pompisteId);
      const sumT = (t: string) => mine.filter(j => (j.justificationType || 'CLIENT') === t).reduce((s, j) => s + num(j.amount), 0);
      const arm = (b.armoireSales || []).filter((s: any) => s.pompisteId === g.pompisteId);
      const mag = (b.magasinProductMoves || []).filter((m: any) => m.kind === 'VENTE' && m.pompisteId === g.pompisteId);
      const armTotal = arm.reduce((s: number, x: any) => s + num(x.total), 0);
      const magTotal = mag.reduce((s: number, x: any) => s + num(x.total), 0);
      const row: BrigadeRow = {
        ...emptyRow(g.pompisteId, g.name), brigadeId: b.id, date: b.date, shift: b.shift, status: b.status,
        brigades: 1, liters: g.totalLiters, fuelAmount: g.totalAmount, products: armTotal + magTotal,
        theoretical: g.theoretical, cash: g.collected,
        tpe: sumT('TPE'), tag: sumT('TAG'), credit: sumT('CLIENT'), expense: sumT('EXPENSE'), achat: sumT('ACHAT_PRODUIT'),
        justified: g.justified, ecart: g.ecart,
      };
      byBrigade.push(row);
      const agg = byPompiste.get(g.pompisteId) || emptyRow(g.pompisteId, g.name);
      (Object.keys(agg) as (keyof PompisteRow)[]).forEach(k => {
        if (typeof agg[k] === 'number') (agg as any)[k] += (row as any)[k];
      });
      byPompiste.set(g.pompisteId, agg);

      const ref = `Brigade ${day} · ${b.shift}`;
      g.byFuel.forEach(f => {
        details.sales.push({ id: `${b.id}-${g.pompisteId}-${f.fuelType}`, date: b.date, label: `${f.fuelType}`, sub: ref, pompiste: g.name, qty: f.liters, unit: 'L', amount: f.amount });
        const fr = byFuel.get(f.fuelType) || { fuelType: f.fuelType, liters: 0, amount: 0, buyPrice: num(buyPrices[f.fuelType]), cost: 0, margin: 0 };
        fr.liters += f.liters; fr.amount += f.amount;
        byFuel.set(f.fuelType, fr);
      });
      const d = byDay.get(day) || { day, liters: 0, amount: 0 };
      d.liters += g.totalLiters; d.amount += g.totalAmount; byDay.set(day, d);
      details.theoretical.push({ id: `th-${b.id}-${g.pompisteId}`, date: b.date, label: ref, sub: `Carburant ${g.totalAmount.toFixed(2)} + produits ${(armTotal + magTotal).toFixed(2)}`, pompiste: g.name, amount: g.theoretical });
      if (g.collected) details.cash.push({ id: `c-${b.id}-${g.pompisteId}`, date: b.date, label: 'Espèces remises', sub: ref, pompiste: g.name, amount: g.collected });
      arm.forEach((x: any, i: number) => details.armoire.push({ id: `a-${b.id}-${i}-${g.pompisteId}`, date: b.date, label: x.productName, sub: ref, pompiste: g.name, qty: num(x.quantity), amount: num(x.total) }));
      mag.forEach((x: any, i: number) => details.magasin.push({ id: `m-${b.id}-${i}-${g.pompisteId}`, date: b.date, label: x.productName, sub: ref, pompiste: g.name, qty: num(x.quantity), amount: num(x.total) }));
      mine.forEach(j => {
        const t = j.justificationType || 'CLIENT';
        const key = t === 'TPE' ? 'tpe' : t === 'TAG' ? 'tag' : t === 'EXPENSE' ? 'expense' : t === 'ACHAT_PRODUIT' ? 'achat' : 'credit';
        const opsNote = j.entryMode === 'DETAIL' && j.operations?.length ? `${j.operations.length} opération(s)` : '';
        details[key].push({
          id: j.id, date: b.date,
          label: key === 'credit' ? (clientName(j.clientId) || j.clientName || 'Client')
            : key === 'achat' ? `${j.productName || 'Produit'} × ${num(j.quantity)}`
            : (j.tagType || j.notes || j.clientName || (key === 'tpe' ? 'TPE' : key === 'tag' ? 'TAG' : 'Dépense')),
          sub: [ref, opsNote, j.expenseCategory].filter(Boolean).join(' · '), pompiste: g.name, amount: num(j.amount),
        });
      });
      if (Math.abs(g.ecart) > 0.01) details.ecart.push({ id: `e-${b.id}-${g.pompisteId}`, date: b.date, label: g.ecart > 0 ? 'Manquant' : 'Excédent', sub: ref, pompiste: g.name, amount: g.ecart });
    }
    if (counted) brigadeCount++;
  }

  // Achats carburant (station) — affichés même filtrés par pompiste, à titre d'info.
  let purchases = 0, purchaseLiters = 0;
  for (const p of (app.purchases || [])) {
    if (!(p.items?.some((i: any) => !!i.tankId) || p.tankId) || !within(p.date, from, to)) continue;
    const liters = (p.items || []).reduce((s: number, i: any) => s + num(i.quantity), 0);
    purchases += num(p.total); purchaseLiters += liters;
    const sup = (app.suppliers || []).find((s: any) => s.id === p.supplierId)?.name;
    details.purchases.push({ id: p.id, date: p.date, label: sup || 'Fournisseur', sub: [p.invoiceNumber && `Facture ${p.invoiceNumber}`, p.status].filter(Boolean).join(' · '), qty: liters, unit: 'L', amount: num(p.total) });
  }

  // Factures Ventes Carburant.
  let invoices = 0, invoicesPaid = 0, invoicesRest = 0;
  if (!pompisteId) for (const s of (app.shopSales || [])) {
    if (s.invoice?.kind !== 'CARBURANT' || !within(s.date, from, to)) continue;
    invoices += num(s.total); invoicesPaid += num(s.amountPaid); invoicesRest += num(s.rest);
    details.invoices.push({ id: s.id, date: s.date, label: s.invoice.number, sub: `${clientName(s.clientId) || s.invoice.clientName || ''} · payé ${num(s.amountPaid).toFixed(2)} · reste ${num(s.rest).toFixed(2)}`, amount: num(s.total) });
  }

  const fuelRows = [...byFuel.values()].map(f => ({ ...f, cost: f.liters * f.buyPrice, margin: f.amount - f.liters * f.buyPrice }))
    .sort((a, b) => b.amount - a.amount);
  const sum = (k: keyof PompisteRow) => byBrigade.reduce((s, r) => s + num(r[k]), 0);
  const ecart = sum('ecart');
  const sortByDate = (l: ReportLine[]) => l.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  Object.values(details).forEach(sortByDate);

  return {
    from, to, pompisteId, brigadeCount,
    liters: sum('liters'), fuelSales: sum('fuelAmount'),
    fuelCost: fuelRows.reduce((s, f) => s + f.cost, 0), fuelMargin: fuelRows.reduce((s, f) => s + f.margin, 0),
    armoireSales: details.armoire.reduce((s, l) => s + l.amount, 0),
    magasinSales: details.magasin.reduce((s, l) => s + l.amount, 0),
    theoretical: sum('theoretical'), cash: sum('cash'), tpe: sum('tpe'), tag: sum('tag'), credit: sum('credit'),
    expense: sum('expense'), achat: sum('achat'), justified: sum('justified'), ecart,
    shortages: byBrigade.filter(r => r.ecart > 0.01).reduce((s, r) => s + r.ecart, 0),
    surpluses: -byBrigade.filter(r => r.ecart < -0.01).reduce((s, r) => s + r.ecart, 0),
    purchases, purchaseLiters, invoices, invoicesPaid, invoicesRest,
    details,
    byPompiste: [...byPompiste.values()].sort((a, b) => b.theoretical - a.theoretical),
    byBrigade: byBrigade.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    byFuel: fuelRows,
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
