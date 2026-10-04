/**
 * ─── Workforce Reporting Engine ────────────────────────────────────────────────
 * Turns the whole application state (the Supabase fuel-station data + the two
 * business parts) into ONE list of employees, each carrying every detail of what
 * they did over the period:
 *
 *  • Pompistes & chefs de brigade → chaque brigade qui leur est assignée, avec la
 *    piste, les pompes tenues, les index début/fin de chaque pistolet, les litres,
 *    le théorique, les versements horodatés, l'encaissement (espèces / bons /
 *    chèques) et le décalage — plus la comptabilité de la brigade.
 *  • Employés Cafétéria → leurs sessions de travail (ouverture, fermeture, fond de
 *    caisse, théorique, crédit, décalage) et toutes les ventes de chaque session.
 *  • Employés Magasin → leur pourcentage, la liste de TOUS les travaux
 *    qui leur sont assignés (prestation par prestation), la base retenue, leur
 *    part, et si elle est déjà réglée.
 *  • Tout le monde → salaires versés, acomptes, absences, compte de connexion.
 *
 * Pure computation, no React — consumed by `WorkforceView` in the general report.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizState, ModuleKey, MODULES, BizWorker, BizReparation, BizSession, BizSale,
  WORKER_KIND_META, prestationsOf, workerShareOf, isReversedSale, netCashOfSale,
} from './bizConfig';
import { within } from './bizReporting';

export type WorkforcePart = 'carburant' | 'restaurant' | 'cafeteria' | 'lavage';

export const PART_META: Record<WorkforcePart, { label: string; emoji: string; color: string }> = {
  carburant: { label: 'Carburant', emoji: '⛽', color: '#003087' },
  restaurant: { label: 'Restaurant', emoji: '🍽️', color: '#be123c' },
  cafeteria: { label: 'Cafétéria', emoji: '☕', color: '#b45309' },
  lavage: { label: 'Magasin', emoji: '🛒', color: '#0e7490' },
};

// ─── Detail rows ─────────────────────────────────────────────────────────────
export interface WFPayment { id: string; label: string; date: string; amount: number; description?: string; mode?: string; worksCount?: number }
export interface WFAcompte { id: string; date: string; amount: number; description?: string; paid: boolean }
export interface WFAbsence { id: string; date: string; cost: number; description?: string; paid: boolean }

/** One intervention (lavage / vidange) performed by the worker. */
export interface WFWork {
  id: string; ref: string; date: string; kindLabel: string; client: string; car: string;
  /** Every prestation of the job; `mine` marks the ones this worker performed. */
  prestations: { id: string; label: string; kindLabel: string; amount: number; mine: boolean }[];
  myPrestations: string;
  products: { name: string; qty: number; total: number }[];
  discount: number;
  total: number;
  /** Amount of the job that counts for this worker's percentage. */
  base: number;
  share: number;
  paid: number; rest: number;
  status: string;
  settled: boolean;
  settledOn?: string;
}

/** One POS work session (cafétéria / lavage). */
export interface WFSession {
  id: string; ref: string; openedAt: string; closedAt?: string; status: string;
  openingCash: number; closingCash?: number;
  theoretical: number; credit: number; decalage: number;
  durationH?: number;
  salesCount: number; salesTotal: number; salesPaid: number; salesRest: number;
  sales: { id: string; ref: string; date: string; client: string; total: number; paid: number; rest: number; status: string; items: number }[];
  notes?: string;
}

/** One brigade the pompiste (or the chef) took part in. */
export interface WFBrigade {
  id: string; date: string; shift: string; status: string; chefName: string;
  role: 'Pompiste' | 'Chef de brigade';
  start?: string; end?: string; durationH?: number;
  present: boolean;
  actingAsPompiste: boolean;
  track: string;
  pumps: string[];
  /** Index début / fin de chaque pistolet tenu. */
  indices: { label: string; start: number; end: number; delta: number }[];
  liters: number; pricePerLiter: number; theoretical: number;
  cash: number; bons: number; cheques: number; collected: number; decalage: number;
  versements: { id: string; at: string; amount: number; notes?: string }[];
  versementsTotal: number;
  /** Comptabilité de la brigade (chef / vue d'ensemble). */
  accounting?: { totalDue: number; cashReceived: number; rest: number; status: string; assignedRest: number };
  justifications: { type: string; client: string; amount: number; fuel?: string; liters?: number; mode?: string }[];
  justificationsTotal: number;
  notes?: string;
}

/** A sale rung up by the worker (magasin / POS / comptoir). */
export interface WFSale {
  id: string; ref: string; date: string; client: string; kind: string;
  total: number; paid: number; rest: number; items: number; status: string;
}

export interface WorkforceWorker {
  id: string; name: string;
  part: WorkforcePart; partLabel: string; partEmoji: string;
  role: string;
  /** Lavage part: « Lavage », « Vidange » or « Polyvalent ». */
  speciality?: string;
  phone?: string; cin?: string; email?: string;
  status: string; hireDate?: string;
  hasAccount: boolean; accountActive: boolean; username?: string;
  payMode: string; salaryType: string; salaryAmount: number; percentage?: number;

  // ── Money over the period ────────────────────────────────────────────────
  paymentsTotal: number; acomptesTotal: number; acomptesUnpaid: number;
  absencesTotal: number; absencesCount: number;
  /** Percentage payroll: total share generated by the works of the period. */
  earned: number;
  /** Share not yet settled by a payment (all dates). */
  dueNow: number;
  payments: WFPayment[]; acomptes: WFAcompte[]; absences: WFAbsence[];

  // ── Activity over the period ─────────────────────────────────────────────
  works: WFWork[]; worksCount: number; worksAmount: number; worksBase: number;
  sessions: WFSession[]; sessionsCount: number; sessionsSales: number; sessionsDecalage: number;
  brigades: WFBrigade[]; brigadesCount: number;
  liters: number; theoretical: number; collected: number; decalage: number;
  sales: WFSale[]; salesCount: number; salesAmount: number;

  /** Compact numbers shown on the collapsed card. */
  highlights: WFHighlight[];
}

/** A headline figure of a worker, with the unit it must be rendered in. */
export interface WFHighlight {
  label: string;
  value: number;
  format: 'money' | 'count' | 'liters';
  tone?: 'good' | 'bad' | 'neutral';
}

export interface WorkforcePartSummary {
  key: WorkforcePart; label: string; emoji: string;
  count: number; withAccount: number;
  salariesPaid: number; acomptes: number; absences: number;
  earned: number; dueNow: number;
  activityLabel: string; activityValue: number;
}

export interface WorkforceReport {
  from: string; to: string;
  workers: WorkforceWorker[];
  parts: WorkforcePartSummary[];
  totals: {
    workers: number; withAccount: number;
    salariesPaid: number; acomptes: number; absences: number;
    earned: number; dueNow: number;
    works: number; worksAmount: number;
    sessions: number; brigades: number;
    liters: number; theoretical: number; collected: number; decalage: number;
    sales: number; salesAmount: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hoursBetween = (a?: string, b?: string): number | undefined => {
  if (!a || !b) return undefined;
  const t1 = new Date(a).getTime(); const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2) || t2 < t1) return undefined;
  return Math.round(((t2 - t1) / 3_600_000) * 10) / 10;
};
const carLabel = (c: any) => [c?.marque, c?.name, c?.color, c?.immatriculation].filter(Boolean).join(' • ');

const SALARY_LABEL: Record<string, string> = { mois: 'Mensuel', jour: 'Journalier', pourcentage: 'Pourcentage' };

// ─── Business-part employees (Cafétéria / Lavage) ────────────────────────────
function bizWorker(
  w: BizWorker, key: ModuleKey, from: string, to: string,
  reparations: BizReparation[], sessions: BizSession[], sales: BizSale[],
): WorkforceWorker {
  const cfg = MODULES[key];
  const isPercent = w.salaryType === 'pourcentage';
  const rate = w.percentage || 0;

  // ── Which works were already settled by a payment? ──
  const settledBy = new Map<string, { date: string }>();
  (w.payments || []).forEach(p => (p.workIds || []).forEach(id => settledBy.set(id, { date: p.date })));

  const myWorks = reparations.filter(r => (r.workers || []).includes(w.id));
  const works: WFWork[] = myWorks
    .filter(r => within(r.date, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(r => {
      const lines = prestationsOf(r);
      const mine = lines.filter(l => (l.workerIds || []).includes(w.id));
      const base = mine.length ? mine.reduce((s, l) => s + num(l.amount), 0) : r.total;
      const settled = settledBy.get(r.id);
      return {
        id: r.id, ref: r.ref, date: r.date,
        kindLabel: r.kind === 'lavage' ? 'Lavage' : r.kind === 'reparation' ? 'Vidange' : 'Lavage + Vidange',
        client: r.clientName, car: carLabel(r.car),
        prestations: lines.map(l => ({
          id: l.id, label: l.label, amount: num(l.amount),
          kindLabel: l.kind === 'lavage' ? 'Lavage' : 'Vidange',
          mine: (l.workerIds || []).includes(w.id),
        })),
        myPrestations: (mine.length ? mine : lines).map(l => l.label).filter(Boolean).join(' · '),
        products: (r.usedProducts || []).map(p => ({
          name: p.productName, qty: p.detailQty ?? p.qty, total: p.total ?? p.qty * p.unitPrice,
        })),
        discount: num(r.discountAmount),
        total: r.total, base,
        share: isPercent ? workerShareOf(r, w.id, rate) : 0,
        paid: r.paid, rest: r.rest,
        status: r.status === 'finalized' ? 'Finalisé' : r.status === 'pending' ? 'En attente' : 'Annulé',
        settled: !!settled, settledOn: settled?.date,
      };
    });

  // Everything still owed, whatever the period — that is what the admin must pay.
  const dueNow = isPercent
    ? myWorks
      .filter(r => r.status === 'finalized' && !settledBy.has(r.id))
      .reduce((s, r) => s + workerShareOf(r, w.id, rate), 0)
    : 0;

  // ── Sessions de travail + their sales ──
  const mySessions = sessions.filter(s => s.workerId === w.id && within(s.openedAt, from, to));
  const wfSessions: WFSession[] = mySessions
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
    .map(s => {
      const sSales = sales.filter(x => x.sessionId === s.id);
      return {
        id: s.id, ref: s.ref, openedAt: s.openedAt, closedAt: s.closedAt,
        status: s.status === 'open' ? 'Ouverte' : 'Clôturée',
        openingCash: num(s.openingCash), closingCash: s.closingCash,
        theoretical: num(s.theoretical), credit: num(s.credit), decalage: num(s.decalage),
        durationH: hoursBetween(s.openedAt, s.closedAt),
        // Une vente annulée (retour / échange) ne compte pas dans l'activité de
        // la session : la marchandise est revenue, et l'argent d'un retour est
        // ressorti du tiroir. Elle reste listée ci-dessous avec son état.
        salesCount: sSales.filter(x => !isReversedSale(x)).length,
        salesTotal: sSales.filter(x => !isReversedSale(x)).reduce((a, x) => a + x.total, 0),
        salesPaid: sSales.reduce((a, x) => a + netCashOfSale(x), 0),
        salesRest: sSales.filter(x => !isReversedSale(x)).reduce((a, x) => a + x.rest, 0),
        sales: sSales
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .map(x => ({
            id: x.id, ref: x.ref, date: x.date, client: x.clientName,
            total: x.total, paid: x.paid, rest: x.rest, status: x.status, items: (x.items || []).length,
          })),
        notes: s.notes,
      };
    });

  // ── Direct sales (rung up outside / independently of a session) ──
  const mySales = sales.filter(s => s.workerId === w.id && within(s.date, from, to));
  const wfSales: WFSale[] = mySales
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(s => ({
      id: s.id, ref: s.ref, date: s.date, client: s.clientName, kind: 'Vente',
      total: s.total, paid: s.paid, rest: s.rest, items: (s.items || []).length, status: s.status,
    }));

  const payments: WFPayment[] = (w.payments || [])
    .filter(p => within(p.date, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(p => ({
      id: p.id, label: p.period, date: p.date, amount: p.amount, description: p.description,
      worksCount: p.workIds?.length,
    }));
  const acomptes: WFAcompte[] = (w.acomptes || []).filter(a => within(a.date, from, to))
    .map(a => ({ id: a.id, date: a.date, amount: a.amount, description: a.description, paid: a.paid }));
  const absences: WFAbsence[] = (w.absences || []).filter(a => within(a.date, from, to))
    .map(a => ({ id: a.id, date: a.date, cost: a.cost, description: a.description, paid: a.paid }));

  const worksAmount = works.reduce((s, x) => s + x.total, 0);
  const worksBase = works.reduce((s, x) => s + x.base, 0);
  const earned = works.reduce((s, x) => s + x.share, 0);
  const sessionsSales = wfSessions.reduce((s, x) => s + x.salesTotal, 0);
  const sessionsDecalage = wfSessions.reduce((s, x) => s + x.decalage, 0);

  // A service-part employee who only ran the till is summarised like a cashier.
  const showWorks = cfg.isService && !(works.length === 0 && wfSessions.length > 0);
  const highlights: WFHighlight[] = showWorks
    ? [
      { label: 'Travaux', value: works.length, format: 'count' },
      { label: 'Montant travaux', value: worksAmount, format: 'money', tone: 'neutral' },
      ...(isPercent ? [
        { label: `Part ${rate}%`, value: earned, format: 'money' as const, tone: 'good' as const },
        { label: 'Reste dû', value: dueNow, format: 'money' as const, tone: (dueNow > 0 ? 'bad' : 'neutral') as 'bad' | 'neutral' },
      ] : []),
    ]
    : [
      { label: 'Sessions', value: wfSessions.length, format: 'count' },
      { label: 'Ventes session', value: sessionsSales, format: 'money', tone: 'good' },
      { label: 'Décalage', value: sessionsDecalage, format: 'money', tone: sessionsDecalage < 0 ? 'bad' : 'good' },
    ];

  return {
    id: w.id, name: w.name,
    part: key as WorkforcePart, partLabel: cfg.label, partEmoji: cfg.emoji,
    role: w.roleName,
    speciality: cfg.isService ? WORKER_KIND_META[w.workerKind || 'both'].short : undefined,
    phone: w.phone, cin: w.cin, email: w.email,
    status: w.paid ? 'Salarié' : 'Non salarié',
    hireDate: w.startDate,
    hasAccount: !!w.hasAccount, accountActive: !!w.authUserId, username: w.username,
    payMode: isPercent ? `Pourcentage ${rate} %` : (SALARY_LABEL[w.salaryType] || w.salaryType),
    salaryType: w.salaryType, salaryAmount: num(w.salaryAmount), percentage: w.percentage,

    paymentsTotal: payments.reduce((s, p) => s + p.amount, 0),
    acomptesTotal: acomptes.reduce((s, a) => s + a.amount, 0),
    acomptesUnpaid: (w.acomptes || []).filter(a => !a.paid).reduce((s, a) => s + a.amount, 0),
    absencesTotal: absences.reduce((s, a) => s + a.cost, 0),
    absencesCount: absences.length,
    earned, dueNow,
    payments, acomptes, absences,

    works, worksCount: works.length, worksAmount, worksBase,
    sessions: wfSessions, sessionsCount: wfSessions.length, sessionsSales, sessionsDecalage,
    brigades: [], brigadesCount: 0,
    liters: 0, theoretical: 0, collected: 0, decalage: sessionsDecalage,
    sales: wfSales,
    // Le CA d'un employé ne retient que ses ventes effectives — un retour ne lui
    // est ni compté ni reproché.
    salesCount: mySales.filter(s => !isReversedSale(s)).length,
    salesAmount: mySales.filter(s => !isReversedSale(s)).reduce((s, x) => s + x.total, 0),
    highlights,
  };
}

// ─── Fuel-station employees ──────────────────────────────────────────────────
/** Detailed brigade lines of one pompiste (or of the chef who led the brigade). */
function brigadeLines(
  app: any, workerId: string, role: 'Pompiste' | 'Chef de brigade', from: string, to: string,
): WFBrigade[] {
  const brigades: any[] = app.brigades || [];
  const chefs: any[] = app.brigadeChefs || [];
  const tracks: any[] = app.tracks || [];
  const pumps: any[] = app.pumps || [];
  const nozzles: any[] = app.pumpNozzles || [];
  const clients: any[] = app.clients || [];
  const pompistes: any[] = app.pompistes || [];
  const accountings: any[] = app.brigadeAccountings || [];

  const mine = brigades.filter(b => {
    if (!within(b.startDatetime || b.date, from, to)) return false;
    return role === 'Chef de brigade'
      ? b.chefId === workerId
      : (b.pompisteIds || []).includes(workerId)
      || (b.pompisteAssignments || []).some((a: any) => a.pompisteId === workerId);
  });

  return mine
    .sort((a, b) => new Date(b.startDatetime || b.date).getTime() - new Date(a.startDatetime || a.date).getTime())
    .map(b => {
      const acc = accountings.find((a: any) => a.brigadeId === b.id);
      const assignment = (b.pompisteAssignments || []).find((a: any) => a.pompisteId === workerId);
      const data = (b.pompisteData || {})[workerId] || {};
      const pumpIds: string[] = (b.pompistePumpAssignments || [])
        .find((p: any) => p.pompisteId === workerId)?.pumpIds || [];
      const myPumps = pumps.filter(p => pumpIds.includes(p.id));

      // Index of every pistolet of the pumps held by this pompiste.
      const indices = nozzles
        .filter(n => pumpIds.includes(n.pumpId))
        .map(n => {
          const start = num((b.startNozzleIndices || {})[n.id]);
          const end = num((b.endNozzleIndices || {})[n.id]);
          const pump = pumps.find(p => p.id === n.pumpId);
          return {
            label: `${pump?.name || pump?.number || 'Pompe'} — ${n.name}`,
            start, end, delta: Math.max(0, end - start),
          };
        });

      const versements = (b.versements || [])
        .filter((v: any) => v.pompisteId === workerId)
        .map((v: any) => ({ id: v.id, at: v.at, amount: num(v.amount), notes: v.notes }))
        .sort((x: any, y: any) => new Date(x.at).getTime() - new Date(y.at).getTime());

      const collected = data.collected || {};
      const justifications = (acc?.justifications || [])
        // A chef sees the whole brigade; a pompiste only their own justifications.
        .filter((j: any) => role === 'Chef de brigade' || !j.pompisteId || j.pompisteId === workerId)
        .map((j: any) => ({
          type: j.justificationType || 'CLIENT',
          client: j.clientName || clients.find(c => c.id === j.clientId)?.name || '—',
          amount: num(j.amount), fuel: j.fuelType, liters: j.liters, mode: j.paymentMode,
        }));

      // A chef's figures are the whole brigade's; a pompiste's are their own.
      const isChef = role === 'Chef de brigade';
      const allData: any[] = Object.values(b.pompisteData || {});
      const sum = (f: (d: any) => number) => allData.reduce((s, d) => s + num(f(d)), 0);

      return {
        id: b.id, date: b.startDatetime || b.date, shift: b.shift, status: b.status,
        chefName: chefs.find(c => c.id === b.chefId)?.name || '—',
        role,
        start: b.startDatetime || b.startTime, end: b.endDatetime || b.endTime,
        durationH: hoursBetween(b.startDatetime, b.endDatetime),
        present: assignment ? assignment.present !== false : true,
        actingAsPompiste: !!assignment?.chefActingAsPompiste,
        track: tracks.find(t => t.id === assignment?.trackId)?.name || '—',
        pumps: isChef
          ? pumps.filter(p => (b.pompistePumpAssignments || []).some((a: any) => a.pumpIds?.includes(p.id)))
            .map(p => p.name || p.number)
          : myPumps.map(p => p.name || p.number),
        indices: isChef ? [] : indices,
        liters: isChef ? sum(d => d.litersSold) : num(data.litersSold),
        pricePerLiter: num(data.pricePerLiter),
        theoretical: isChef ? sum(d => d.theoretical) : num(data.theoretical),
        cash: isChef ? sum(d => d.collected?.cash) : num(collected.cash),
        bons: isChef ? sum(d => d.collected?.bons) : num(collected.bons),
        cheques: isChef ? sum(d => d.collected?.cheques) : num(collected.cheques),
        collected: isChef ? sum(d => d.totalCollected) : num(data.totalCollected),
        decalage: isChef ? sum(d => d.decalage) : num(data.decalage),
        versements: isChef
          ? (b.versements || []).map((v: any) => ({
            id: v.id,
            at: v.at,
            amount: num(v.amount),
            notes: [pompistes.find(p => p.id === v.pompisteId)?.name, v.notes].filter(Boolean).join(' — '),
          }))
          : versements,
        versementsTotal: (isChef ? (b.versements || []) : versements).reduce((s: number, v: any) => s + num(v.amount), 0),
        accounting: acc ? {
          totalDue: num(acc.totalDue), cashReceived: num(acc.cashReceived), rest: num(acc.rest),
          status: acc.status === 'completed' ? 'Clôturée' : 'Brouillon',
          assignedRest: acc.restAssignedWorkerId === workerId ? num(acc.restAssignedAmount) : 0,
        } : undefined,
        justifications,
        justificationsTotal: justifications.reduce((s: number, j: any) => s + j.amount, 0),
        notes: b.notes,
      };
    });
}

/** Shape shared by pompistes, chefs, gérants and magasin workers. */
function fuelWorker(
  app: any, w: any, role: string, from: string, to: string,
  opts: { brigadeRole?: 'Pompiste' | 'Chef de brigade'; sellerSales?: boolean } = {},
): WorkforceWorker {
  const payments: WFPayment[] = (w.paymentRecord || [])
    .filter((p: any) => within(p.paymentDate, from, to))
    .sort((a: any, b: any) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())
    .map((p: any) => ({
      id: p.id, label: p.month, date: p.paymentDate, amount: num(p.netSalary),
      description: [p.notes, p.chequeNumber ? `Chèque ${p.chequeNumber}` : ''].filter(Boolean).join(' — '),
      mode: p.paymentMode,
    }));
  const acomptes: WFAcompte[] = (w.acomptes || []).filter((a: any) => within(a.date, from, to))
    .map((a: any) => ({ id: a.id, date: a.date, amount: num(a.amount), description: a.description, paid: !!a.isPaid }));
  const absences: WFAbsence[] = (w.absences || []).filter((a: any) => within(a.date, from, to))
    .map((a: any) => ({ id: a.id, date: a.date, cost: num(a.cost), description: a.description, paid: !!a.isPaid }));

  const brigades = opts.brigadeRole ? brigadeLines(app, w.id, opts.brigadeRole, from, to) : [];

  // Magasin sellers: the shop invoices they rang up.
  const sales: WFSale[] = opts.sellerSales
    ? (app.shopSales || [])
      .filter((s: any) => s.sellerId === w.id && within(s.date, from, to))
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((s: any) => ({
        id: s.id, ref: s.id?.slice(0, 8) || '—', date: s.date,
        client: (app.clients || []).find((c: any) => c.id === s.clientId)?.name || 'Comptoir',
        kind: 'Magasin', total: num(s.total), paid: num(s.amountPaid ?? s.total), rest: num(s.rest),
        items: (s.items || []).length, status: s.status || 'Payé',
      }))
    : [];

  const liters = brigades.reduce((s, b) => s + b.liters, 0);
  const theoretical = brigades.reduce((s, b) => s + b.theoretical, 0);
  const collected = brigades.reduce((s, b) => s + b.collected, 0);
  const decalage = brigades.reduce((s, b) => s + b.decalage, 0);
  const salesAmount = sales.reduce((s, x) => s + x.total, 0);

  const acomptesSum = acomptes.reduce((s, a) => s + a.amount, 0);
  const highlights: WFHighlight[] = opts.brigadeRole
    ? [
      { label: 'Brigades', value: brigades.length, format: 'count' },
      { label: 'Litres vendus', value: liters, format: 'liters' },
      { label: 'Encaissé', value: collected, format: 'money', tone: 'good' },
      { label: 'Décalage', value: decalage, format: 'money', tone: decalage < 0 ? 'bad' : 'good' },
    ]
    : opts.sellerSales
      ? [
        { label: 'Ventes', value: sales.length, format: 'count' },
        { label: 'CA', value: salesAmount, format: 'money', tone: 'good' },
        { label: 'Acomptes', value: acomptesSum, format: 'money', tone: 'neutral' },
      ]
      : [
        { label: 'Salaires versés', value: payments.reduce((s, p) => s + p.amount, 0), format: 'money', tone: 'good' },
        { label: 'Acomptes', value: acomptesSum, format: 'money', tone: 'neutral' },
        { label: 'Absences', value: absences.reduce((s, a) => s + a.cost, 0), format: 'money', tone: absences.length ? 'bad' : 'neutral' },
      ];

  return {
    id: w.id, name: w.name,
    part: 'carburant', partLabel: PART_META.carburant.label, partEmoji: PART_META.carburant.emoji,
    role,
    phone: w.phone, cin: w.cin, email: w.email,
    status: w.status || 'Actif', hireDate: w.hireDate,
    hasAccount: !!w.hasAccess, accountActive: !!w.authUserId, username: w.username,
    payMode: 'Mensuel', salaryType: 'mois', salaryAmount: num(w.baseSalary),

    paymentsTotal: payments.reduce((s, p) => s + p.amount, 0),
    acomptesTotal: acomptes.reduce((s, a) => s + a.amount, 0),
    acomptesUnpaid: (w.acomptes || []).filter((a: any) => !a.isPaid).reduce((s: number, a: any) => s + num(a.amount), 0),
    absencesTotal: absences.reduce((s, a) => s + a.cost, 0),
    absencesCount: absences.length,
    earned: 0, dueNow: 0,
    payments, acomptes, absences,

    works: [], worksCount: 0, worksAmount: 0, worksBase: 0,
    sessions: [], sessionsCount: 0, sessionsSales: 0, sessionsDecalage: 0,
    brigades, brigadesCount: brigades.length,
    liters, theoretical, collected, decalage,
    sales, salesCount: sales.length, salesAmount,
    highlights,
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────
/**
 * Les employés d'UNE partie commerciale, avec tout ce qu'ils ont fait sur la
 * période — exactement le même calcul que le rapport général, sans avoir à
 * reconstruire les pompistes et les brigades pour l'obtenir.
 *
 * C'est ce que lit la Caisse d'une partie de service : l'écran où l'on paie les
 * employés doit montrer le travail sur lequel ils sont payés, et il ne peut pas
 * le compter autrement que le rapport.
 */
export function computeBizWorkforce(
  st: { workers?: BizWorker[]; reparations?: BizReparation[]; sessions?: BizSession[]; sales?: BizSale[] },
  key: ModuleKey, from: string, to: string,
): WorkforceWorker[] {
  return (st.workers || [])
    .map(w => bizWorker(w, key, from, to, st.reparations || [], st.sessions || [], st.sales || []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function computeWorkforce(app: any, biz: BizState, from: string, to: string): WorkforceReport {
  const workers: WorkforceWorker[] = [
    ...(app.pompistes || []).map((p: any) => fuelWorker(app, p, 'Pompiste', from, to, { brigadeRole: 'Pompiste' })),
    ...(app.brigadeChefs || []).map((c: any) => fuelWorker(app, c, 'Chef de brigade', from, to, { brigadeRole: 'Chef de brigade' })),
    ...(app.gerants || []).map((g: any) => fuelWorker(app, g, 'Gérant', from, to)),
    ...(app.magasinWorkers || []).map((m: any) => fuelWorker(app, m, 'Employé magasin', from, to, { sellerSales: true })),
    ...(Object.keys(MODULES) as ModuleKey[]).flatMap(key => {
      const st = biz[key];
      return st ? computeBizWorkforce(st, key, from, to) : [];
    }),
  ].sort((a, b) => a.part.localeCompare(b.part) || a.name.localeCompare(b.name));

  const partOf = (k: WorkforcePart) => workers.filter(w => w.part === k);
  const parts: WorkforcePartSummary[] = (Object.keys(PART_META) as WorkforcePart[]).map(k => {
    const list = partOf(k);
    const activity = k === 'carburant'
      ? { label: 'Brigades', value: list.reduce((s, w) => s + w.brigadesCount, 0) }
      : k === 'lavage'
        ? { label: 'Travaux', value: list.reduce((s, w) => s + w.worksCount, 0) }
        : { label: 'Sessions', value: list.reduce((s, w) => s + w.sessionsCount, 0) };
    return {
      key: k, label: PART_META[k].label, emoji: PART_META[k].emoji,
      count: list.length,
      withAccount: list.filter(w => w.hasAccount && w.accountActive).length,
      salariesPaid: list.reduce((s, w) => s + w.paymentsTotal, 0),
      acomptes: list.reduce((s, w) => s + w.acomptesTotal, 0),
      absences: list.reduce((s, w) => s + w.absencesTotal, 0),
      earned: list.reduce((s, w) => s + w.earned, 0),
      dueNow: list.reduce((s, w) => s + w.dueNow, 0),
      activityLabel: activity.label, activityValue: activity.value,
    };
  });

  const sum = (f: (w: WorkforceWorker) => number) => workers.reduce((s, w) => s + f(w), 0);
  return {
    from, to, workers, parts,
    totals: {
      workers: workers.length,
      withAccount: workers.filter(w => w.hasAccount && w.accountActive).length,
      salariesPaid: sum(w => w.paymentsTotal),
      acomptes: sum(w => w.acomptesTotal),
      absences: sum(w => w.absencesTotal),
      earned: sum(w => w.earned),
      dueNow: sum(w => w.dueNow),
      works: sum(w => w.worksCount),
      worksAmount: sum(w => w.worksAmount),
      sessions: sum(w => w.sessionsCount),
      brigades: sum(w => w.brigadesCount),
      liters: sum(w => w.liters),
      theoretical: sum(w => w.theoretical),
      collected: sum(w => w.collected),
      decalage: sum(w => w.decalage),
      sales: sum(w => w.salesCount),
      salesAmount: sum(w => w.salesAmount),
    },
  };
}
