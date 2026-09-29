/**
 * ─── Printable "Fiche" sheets for the business reports ─────────────────────────
 * A4-width (794px) printable documents that mirror the station's *Fiche
 * Journalière* design (dark-blue banner, gold accent, numbered parts, striped
 * tables, signature footer). Used by both `ModuleReports` and `GeneralReports`.
 *
 * `printFiche(el)` clones a sheet into a body-level portal and flips the body
 * into `print-document` mode so the global thermal-receipt print CSS is bypassed
 * and the sheet prints on full A4 pages (same mechanism as the Fiche Journalière).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { printDocumentMode } from '@/src/lib/pdf';
import { PartReport, GlobalReport } from '@/src/lib/bizReporting';

export const C = { blue900: '#001233', blue800: '#001f5c', blue700: '#002d87', blue600: '#003087', gold: '#FFB800' };

export const da = (n: number) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const lit = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const shortDate = (s: string) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR'); };

/** Colour of a purchase status label on the printed sheet. */
const statusColor = (s: string) =>
  s === 'Payé' ? '#15803d'
    : s === 'Dette partielle' || s === 'Partiel' ? '#b45309'
      : s === 'En attente livraison' ? '#64748b'
        : '#dc2626';

/** Human labels for the payment modes carried by an achat carburant. */
export const PAY_MODE_LABEL: Record<string, string> = { ESPECES: 'Espèces', CHEQUE: 'Chèque', VIREMENT: 'Virement' };

/** Human labels for the fuel types a cuve can hold. */
export const FUEL_TYPE_LABEL: Record<string, string> = {
  ESSENCE: 'Essence', GASOIL: 'Gasoil', GPL: 'GPL', DIESEL: 'Diesel', SUPER: 'Super', AUTRE: 'Autre',
};
/** Print colours per fuel type (kept sober for the black-and-white fiche). */
export const FUEL_TYPE_COLOR: Record<string, string> = {
  ESSENCE: '#15803d', GASOIL: '#b45309', GPL: '#7c3aed', DIESEL: '#0e7490', SUPER: '#b91c1c', AUTRE: '#475569',
};

// ─── Print helper ────────────────────────────────────────────────────────────
export function printFiche(el: HTMLElement | null) {
  if (!el) return;
  // Ensure the revealed portal exists on <body> (same id the global print CSS targets).
  let portal = document.getElementById('daily-report-print-area-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'daily-report-print-area-portal';
    document.body.appendChild(portal);
  }
  // Inject the page/fine-tune print CSS once.
  if (!document.getElementById('fiche-print-style')) {
    const style = document.createElement('style');
    style.id = 'fiche-print-style';
    style.textContent = `
      #daily-report-print-area-portal { display: none; }
      @media print {
        @page { size: A4 portrait; margin: 6mm; }
        body.print-document #daily-report-print-area-portal { display: block !important; }
        body.print-document #daily-report-print-area-portal .no-print { display: none !important; }
        body.print-document #daily-report-print-area-portal * { box-shadow: none !important; overflow: visible !important; }
        body.print-document #daily-report-print-area-portal > div { position: static !important; left: auto !important; top: auto !important; width: 100% !important; }
        body.print-document #daily-report-print-area-portal > div > div { width: 100% !important; }
      }`;
    document.head.appendChild(style);
  }
  portal.innerHTML = '';
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.position = 'static';
  clone.style.left = 'auto';
  clone.style.top = 'auto';
  portal.appendChild(clone);
  const cleanup = () => { portal!.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  printDocumentMode();
}

// ─── Shared primitives ───────────────────────────────────────────────────────
export const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
export const theadRow: React.CSSProperties = { background: C.blue800 };
export const totalRow: React.CSSProperties = { background: '#eff6ff' };

export function TH({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th style={{ padding: '6px 9px', textAlign: align || 'left', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4, color: '#fff', whiteSpace: 'nowrap' }}>{children}</th>;
}
export function TD({ children, align, bold, color }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; bold?: boolean; color?: string }) {
  return <td style={{ padding: '5px 9px', textAlign: align || 'left', fontSize: 10.5, fontWeight: bold ? 900 : 600, color: color || '#1e293b', borderBottom: '1px solid #eef2f7' }}>{children}</td>;
}
export function Part({ num, label, accent, children }: { num: string; label: string; accent: string; children: React.ReactNode; key?: React.Key }) {
  return (
    <section style={{ borderTop: `2px solid ${accent}`, margin: '0 14px 14px 14px', breakInside: 'avoid' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ width: 20, height: 20, background: C.blue900, color: C.gold, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 11 }}>{num}</span>
        <h3 style={{ margin: 0, color: C.blue900, fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</h3>
      </div>
      <div style={{ padding: '10px 0 0 0' }}>{children}</div>
    </section>
  );
}
export function EmptyLine({ text = 'Aucune donnée sur la période' }: { text?: string }) {
  return <p style={{ margin: '2px 0 6px 0', fontSize: 10.5, color: '#94a3b8', fontStyle: 'italic' }}>{text}</p>;
}

// ─── Banner + KPI strip + footer (shared shell) ──────────────────────────────
export function Banner({ settings, badge, period }: { settings: any; badge: string; period: string }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: `linear-gradient(135deg, ${C.blue900} 0%, ${C.blue800} 55%, ${C.blue600} 100%)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {(settings?.logoUrl || settings?.logo) ? (
            <img src={settings.logoUrl || settings.logo} alt="logo" style={{ width: 58, height: 58, objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 3 }} />
          ) : (
            <div style={{ width: 58, height: 58, background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.4)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: C.gold, fontSize: 28, fontWeight: 900 }}>⛽</span>
            </div>
          )}
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 22, color: '#fff', letterSpacing: 0.3 }}>{settings?.name || 'Station Naftal'}</p>
            {settings?.address && <p style={{ margin: '2px 0 0 0', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{settings.address}</p>}
            <p style={{ margin: '2px 0 0 0', fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
              {[settings?.phone && `Tél: ${settings.phone}`, settings?.fiscalId && `NIF: ${settings.fiscalId}`, settings?.rc && `RC: ${settings.rc}`].filter(Boolean).join('  ·  ')}
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ display: 'inline-block', background: C.gold, color: C.blue900, fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, padding: '6px 14px', borderRadius: 6 }}>{badge}</span>
          <p style={{ margin: '7px 0 0 0', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{period}</p>
        </div>
      </div>
      <div style={{ height: 4, width: '100%', background: `linear-gradient(90deg, ${C.gold}, transparent)`, margin: '0 0 14px 0' }} />
    </>
  );
}

export function KpiStrip({ kpis }: { kpis: { label: string; value: string; col: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpis.length}, 1fr)`, gap: 10, margin: '0 14px 16px 14px' }}>
      {kpis.map(k => (
        <div key={k.label} style={{ borderLeft: `3px solid ${k.col}`, background: '#f8fafc', borderRadius: '0 7px 7px 0', padding: '8px 12px' }}>
          <p style={{ margin: 0, fontSize: 8.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8' }}>{k.label}</p>
          <p style={{ margin: '3px 0 0 0', fontSize: 16, fontWeight: 900, color: k.col }}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}

export function Footer({ settings, title }: { settings: any; title: string }) {
  return (
    <div style={{ margin: '4px 14px 0 14px', paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginBottom: 22 }}>
        <span>Généré le {new Date().toLocaleString('fr-FR')}</span>
        <span>{settings?.name || 'Station'} — {title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60 }}>
        <div><p style={{ fontSize: 10.5, fontWeight: 900, color: '#334155', marginBottom: 34 }}>Signature Responsable :</p><div style={{ borderBottom: '1px solid #94a3b8' }} /></div>
        <div><p style={{ fontSize: 10.5, fontWeight: 900, color: '#334155', marginBottom: 34 }}>Cachet & Signature Gérant :</p><div style={{ borderBottom: '1px solid #94a3b8' }} /></div>
      </div>
    </div>
  );
}

export const sheetStyle: React.CSSProperties = { width: 794, background: '#fff', padding: '0 0 8px 0', fontFamily: 'Arial, sans-serif', color: '#1e293b' };
export const hiddenWrap: React.CSSProperties = { position: 'fixed', left: -10000, top: 0, width: 794, pointerEvents: 'none', zIndex: -1 };

// ─── Module fiche (one part, fully detailed) ─────────────────────────────────
export const ModuleFiche = React.forwardRef<HTMLDivElement, { report: PartReport; settings: any }>(({ report: r, settings }, ref) => {
  const period = `Du ${shortDate(r.from)} au ${shortDate(r.to)}`;
  const title = `Rapport ${r.label}`;
  const salesTotals = r.salesByProduct.reduce((a, x) => ({ qty: a.qty + x.qty, revenue: a.revenue + x.revenue, cost: a.cost + x.cost, gain: a.gain + x.gain }), { qty: 0, revenue: 0, cost: 0, gain: 0 });

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge={`Rapport · ${r.label}`} period={period} />
        <KpiStrip kpis={[
          { label: 'Chiffre d\'affaires', value: `${da(r.salesTotal)} DA`, col: '#047857' },
          { label: 'Total achats', value: `${da(r.purchasesTotal)} DA`, col: '#c2410c' },
          { label: 'Dépenses', value: `${da(r.expensesTotal + r.salariesPaid)} DA`, col: '#dc2626' },
          { label: 'Bénéfice net', value: `${da(r.netGain)} DA`, col: r.netGain >= 0 ? '#15803d' : '#dc2626' },
        ]} />

        {/* PART 1 — VENTES */}
        <Part num="1" label="Ventes par produit" accent={C.blue700}>
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Produit</TH><TH align="right">Quantité</TH><TH align="right">Total achat</TH><TH align="right">Total vente</TH><TH align="right">Gains</TH></tr></thead>
            <tbody>
              {r.salesByProduct.length === 0 && (<tr><TD>—</TD><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD></tr>)}
              {r.salesByProduct.map((p, i) => (
                <tr key={p.name} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                  <TD bold>{p.name}</TD>
                  <TD align="right">{lit(p.qty)}{p.unit ? ` ${p.unit}` : ''}</TD>
                  <TD align="right" color="#b45309">{da(p.cost)} DA</TD>
                  <TD align="right" color="#1d4ed8">{da(p.revenue)} DA</TD>
                  <TD align="right" bold color={p.gain >= 0 ? '#15803d' : '#dc2626'}>{da(p.gain)} DA</TD>
                </tr>
              ))}
              <tr style={totalRow}>
                <TD bold color={C.blue900}>TOTAL</TD>
                <TD align="right" bold color={C.blue900}>{lit(salesTotals.qty)}</TD>
                <TD align="right" bold color="#b45309">{da(salesTotals.cost)} DA</TD>
                <TD align="right" bold color="#1d4ed8">{da(salesTotals.revenue)} DA</TD>
                <TD align="right" bold color={salesTotals.gain >= 0 ? '#15803d' : '#dc2626'}>{da(salesTotals.gain)} DA</TD>
              </tr>
            </tbody>
          </table>

          {/* Ventes ANNULÉES — retirées du tableau ci-dessus : la marchandise est
              revenue en stock, donc ni chiffre d'affaires ni gain. Elles sont
              listées pour justifier l'écart avec ce qui a été encaissé. */}
          {r.returns.length > 0 && (
            <>
              <p style={{ margin: '10px 0 5px 0', fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Retours &amp; échanges — {r.returns.length} vente(s) annulée(s), exclue(s) du tableau ci-dessus
              </p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Réf</TH><TH>Type</TH><TH>Client</TH><TH>Date</TH><TH align="right">CA annulé</TH><TH align="right">Remboursé</TH><TH align="right">Remis en stock</TH></tr></thead>
                <tbody>
                  {r.returns.map((rt, i) => (
                    <tr key={rt.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                      <TD bold>{rt.ref}</TD><TD>{rt.kind}</TD><TD>{rt.client}</TD><TD>{shortDate(rt.date)}</TD>
                      <TD align="right" color="#64748b">{da(rt.total)} DA</TD>
                      <TD align="right" color="#dc2626">{da(rt.refunded)} DA</TD>
                      <TD align="right" color="#15803d">{da(rt.restockedCost)} DA</TD>
                    </tr>
                  ))}
                  <tr style={totalRow}>
                    <TD bold color={C.blue900}>TOTAL</TD><TD /><TD /><TD />
                    <TD align="right" bold color="#64748b">{da(r.returnsTotal)} DA</TD>
                    <TD align="right" bold color="#dc2626">{da(r.refundedTotal)} DA</TD>
                    <TD align="right" bold color="#15803d">{da(r.restockedCost)} DA</TD>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </Part>

        {/* PART 2 — FACTURES / ACHATS */}
        <Part num="2" label="Achats fournisseurs" accent="#c2410c">
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Réf</TH><TH>Fournisseur</TH><TH>Date</TH><TH align="right">Total</TH><TH align="right">Payé</TH><TH align="right">Reste</TH></tr></thead>
            <tbody>
              {r.purchases.length === 0 && (<tr><TD>Aucun achat</TD><TD /><TD /><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD></tr>)}
              {r.purchases.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                  <TD bold>{p.ref}</TD><TD>{p.supplier}</TD><TD>{shortDate(p.date)}</TD>
                  <TD align="right">{da(p.total)} DA</TD>
                  <TD align="right" color="#15803d">{da(p.paid)} DA</TD>
                  <TD align="right" color={p.rest > 0 ? '#dc2626' : '#94a3b8'}>{da(p.rest)} DA</TD>
                </tr>
              ))}
              <tr style={{ background: '#fff7ed' }}>
                <TD bold color="#9a3412">TOTAL</TD><TD /><TD />
                <TD align="right" bold color="#9a3412">{da(r.purchasesTotal)} DA</TD>
                <TD align="right" bold color="#15803d">{da(r.purchasesPaid)} DA</TD>
                <TD align="right" bold color="#dc2626">{da(r.purchasesTotal - r.purchasesPaid)} DA</TD>
              </tr>
            </tbody>
          </table>
        </Part>

        {/* PART 3 — DEPENSES */}
        <Part num="3" label="Dépenses, salaires & acomptes" accent="#dc2626">
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Type</TH><TH>Nom / Description</TH><TH align="right">Montant</TH><TH align="right">Date</TH></tr></thead>
            <tbody>
              {r.expenses.length === 0 && (<tr><TD>Aucune dépense</TD><TD /><TD align="right">0</TD><TD align="right">—</TD></tr>)}
              {r.expenses.map(e => (
                <tr key={e.id} style={{ background: '#fff' }}>
                  <TD bold color={e.kind === 'Salaire' ? '#4338ca' : e.kind === 'Acompte' ? '#b45309' : '#0f172a'}>{e.kind}</TD>
                  <TD>{e.label}{e.description ? <span style={{ color: '#94a3b8' }}> — {e.description}</span> : null}</TD>
                  <TD align="right" bold color="#dc2626">{da(e.amount)} DA</TD>
                  <TD align="right">{shortDate(e.date)}</TD>
                </tr>
              ))}
              <tr style={{ background: '#fef2f2' }}>
                <TD bold color="#991b1b">TOTAL DÉPENSES</TD><TD />
                <TD align="right" bold color="#991b1b">{da(r.expensesTotal + r.salariesPaid + r.acomptesPeriod)} DA</TD><TD />
              </tr>
            </tbody>
          </table>
        </Part>

        {/* PART 4 — DETTES */}
        <Part num="4" label="Dettes clients & fournisseurs" accent="#b45309">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dettes clients — {da(r.clientDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Client</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {r.clientDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD align="right">0</TD></tr>) :
                    r.clientDebts.map((d, i) => (
                      <tr key={d.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                        <TD>{d.name}{d.ref === 'AVANCE' ? ' — avance détenue' : d.ref === 'REPRISE' ? ' — dette initiale' : ''}</TD>
                        <TD align="right" bold color={d.rest < 0 ? '#0d9488' : '#dc2626'}>{da(d.rest)} DA</TD>
                      </tr>))}
                </tbody>
              </table>
            </div>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dettes fournisseurs — {da(r.supplierDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Fournisseur</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {r.supplierDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD align="right">0</TD></tr>) :
                    r.supplierDebts.map((d, i) => (<tr key={d.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}><TD>{d.name}</TD><TD align="right" bold color="#b45309">{da(d.rest)} DA</TD></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </Part>

        {/* PART 5 — ALERTES */}
        <Part num="5" label="Alertes stock & expiration" accent="#ea580c">
          <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Stock bas ({r.stockAlerts.length})</p>
          {r.stockAlerts.length === 0 ? <EmptyLine text="Aucune alerte de stock" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Produit</TH><TH>Catégorie</TH><TH align="right">Stock</TH><TH align="right">Seuil</TH><TH align="right">Manque</TH></tr></thead>
              <tbody>
                {r.stockAlerts.map((a, i) => (
                  <tr key={a.id} style={{ background: i % 2 ? '#fff7ed' : '#fff' }}>
                    <TD bold>{a.name}</TD><TD color="#94a3b8">{a.category || '—'}</TD>
                    <TD align="right" color={a.currentQty <= 0 ? '#dc2626' : '#b45309'}>{lit(a.currentQty)}{a.unit ? ` ${a.unit}` : ''}</TD>
                    <TD align="right">{lit(a.minQty)}</TD>
                    <TD align="right" bold color="#dc2626">{lit(a.deficit)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ margin: '10px 0 5px 0', fontSize: 10, fontWeight: 900, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expirations proches ({r.expiryAlerts.length})</p>
          {r.expiryAlerts.length === 0 ? <EmptyLine text="Aucune expiration proche" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Produit</TH><TH>Expiration</TH><TH align="right">Jours restants</TH><TH align="right">Quantité</TH></tr></thead>
              <tbody>
                {r.expiryAlerts.map((a, i) => (
                  <tr key={a.id} style={{ background: i % 2 ? '#faf5ff' : '#fff' }}>
                    <TD bold>{a.name}</TD><TD>{shortDate(a.expirationDate)}</TD>
                    <TD align="right" bold color={a.status === 'expired' ? '#dc2626' : '#c2410c'}>{a.status === 'expired' ? `Expiré (${Math.abs(a.daysLeft)}j)` : `${a.daysLeft}j`}</TD>
                    <TD align="right">{lit(a.currentQty)}{a.unit ? ` ${a.unit}` : ''}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Part>

        {/* PART 6 — EMPLOYES */}
        {r.workers.length > 0 && (
          <Part num="6" label="Comptes des employés" accent="#4338ca">
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Employé</TH><TH>Rôle</TH><TH align="right">Salaire</TH><TH align="right">Acomptes</TH><TH align="right">Absences</TH><TH align="right">Payé</TH><TH align="right">Net à payer</TH></tr></thead>
              <tbody>
                {r.workers.map((w, i) => (
                  <tr key={w.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <TD bold>{w.name}</TD><TD color="#94a3b8">{w.role}</TD>
                    <TD align="right">{da(w.salaryAmount)} DA<span style={{ color: '#94a3b8' }}>/{w.salaryType}</span></TD>
                    <TD align="right" color="#b45309">{da(w.acomptesTotal)} DA</TD>
                    <TD align="right" color="#dc2626">{w.absencesCount ? `${da(w.absencesTotal)} DA` : '—'}</TD>
                    <TD align="right" color="#15803d">{da(w.paymentsTotal)} DA</TD>
                    <TD align="right" bold color={C.blue900}>{da(w.net)} DA</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </Part>
        )}

        {/* PART 7 — RECAPITULATION */}
        <Part num={r.workers.length > 0 ? '7' : '6'} label="Récapitulation" accent="#047857">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
            {[
              { label: 'Chiffre d\'affaires', value: r.salesTotal, bg: '#eff6ff', col: '#1d4ed8' },
              { label: 'Coût marchandises', value: r.cogs, bg: '#fff7ed', col: '#c2410c' },
              { label: 'Marge brute', value: r.grossMargin, bg: '#ecfdf5', col: '#047857' },
            ].map(c => (
              <div key={c.label} style={{ padding: '10px 13px', background: c.bg, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <p style={{ margin: 0, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>{c.label}</p>
                <p style={{ margin: '3px 0 0 0', fontSize: 16.5, fontWeight: 900, color: c.col }}>{da(c.value)} DA</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderRadius: 8, color: '#fff', background: r.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Bénéfice net de la période</p>
              <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>Marge brute − Dépenses − Salaires − Destructions − Pertes</p>
              {r.returns.length > 0 && (
                <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>
                  Hors {r.returns.length} vente(s) annulée(s) ({da(r.returnsTotal)} DA) — marchandise revenue en stock
                </p>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{da(r.netGain)} DA</p>
          </div>
        </Part>

        <Footer settings={settings} title={title} />
      </div>
    </div>
  );
});
ModuleFiche.displayName = 'ModuleFiche';

// ─── Global consolidated fiche ───────────────────────────────────────────────
export const GlobalFiche = React.forwardRef<HTMLDivElement, { global: GlobalReport; settings: any }>(({ global: g, settings }, ref) => {
  const period = `Du ${shortDate(g.from)} au ${shortDate(g.to)}`;
  const title = 'Rapport Général Consolidé';
  const allClientDebts = g.parts.flatMap(p => p.clientDebts.map(d => ({ ...d, part: p.label })));
  const allSupplierDebts = g.parts.flatMap(p => p.supplierDebts.map(d => ({ ...d, part: p.label })));
  const allStockAlerts = g.parts.flatMap(p => p.stockAlerts.map(a => ({ ...a, part: p.label })));
  const allExpiry = g.parts.flatMap(p => p.expiryAlerts.map(a => ({ ...a, part: p.label })));

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge="Rapport Général" period={period} />
        <KpiStrip kpis={[
          { label: 'Total des ventes', value: `${da(g.salesTotal)} DA`, col: '#047857' },
          { label: 'Coût marchandises', value: `${da(g.cogs)} DA`, col: '#c2410c' },
          { label: 'Total des dépenses', value: `${da(g.expensesTotal + g.salariesPaid)} DA`, col: '#dc2626' },
          { label: 'Total des gains', value: `${da(g.netGain)} DA`, col: g.netGain >= 0 ? '#15803d' : '#dc2626' },
        ]} />

        {/* PART 1 — Synthèse par activité */}
        <Part num="1" label="Synthèse par activité" accent={C.blue700}>
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Activité</TH><TH align="right">Ventes</TH><TH align="right">Achats</TH><TH align="right">Dépenses</TH><TH align="right">Dettes clients</TH><TH align="right">Bénéfice net</TH></tr></thead>
            <tbody>
              {g.parts.map((p, i) => (
                <tr key={p.key} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                  <TD bold>{p.emoji} {p.label}</TD>
                  <TD align="right" color="#047857">{da(p.salesTotal)} DA</TD>
                  <TD align="right" color="#c2410c">{da(p.purchasesTotal)} DA</TD>
                  <TD align="right" color="#dc2626">{da(p.expensesTotal + p.salariesPaid)} DA</TD>
                  <TD align="right" color="#b45309">{da(p.clientDebtTotal)} DA</TD>
                  <TD align="right" bold color={p.netGain >= 0 ? '#15803d' : '#dc2626'}>{da(p.netGain)} DA</TD>
                </tr>
              ))}
              <tr style={totalRow}>
                <TD bold color={C.blue900}>TOTAL</TD>
                <TD align="right" bold color="#047857">{da(g.salesTotal)} DA</TD>
                <TD align="right" bold color="#c2410c">{da(g.purchasesTotal)} DA</TD>
                <TD align="right" bold color="#dc2626">{da(g.expensesTotal + g.salariesPaid)} DA</TD>
                <TD align="right" bold color="#b45309">{da(g.clientDebtTotal)} DA</TD>
                <TD align="right" bold color={g.netGain >= 0 ? '#15803d' : '#dc2626'}>{da(g.netGain)} DA</TD>
              </tr>
            </tbody>
          </table>
        </Part>

        {/* PART 2 — Dettes consolidées */}
        <Part num="2" label="Dettes consolidées" accent="#b45309">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>Clients — {da(g.clientDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Client</TH><TH>Activité</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {allClientDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD /><TD align="right">0</TD></tr>) :
                    allClientDebts.map((d, i) => (
                      <tr key={d.id + i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                        <TD>{d.name}{d.ref === 'AVANCE' ? ' — avance détenue' : d.ref === 'REPRISE' ? ' — dette initiale' : ''}</TD>
                        <TD color="#94a3b8">{d.part}</TD>
                        <TD align="right" bold color={d.rest < 0 ? '#0d9488' : '#dc2626'}>{da(d.rest)} DA</TD>
                      </tr>))}
                </tbody>
              </table>
            </div>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Fournisseurs — {da(g.supplierDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Fournisseur</TH><TH>Activité</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {allSupplierDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD /><TD align="right">0</TD></tr>) :
                    allSupplierDebts.map((d, i) => (<tr key={d.id + i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}><TD>{d.name}</TD><TD color="#94a3b8">{d.part}</TD><TD align="right" bold color="#b45309">{da(d.rest)} DA</TD></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </Part>

        {/* PART 3 — Alertes consolidées */}
        <Part num="3" label="Alertes consolidées" accent="#ea580c">
          <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Stock bas ({allStockAlerts.length})</p>
          {allStockAlerts.length === 0 ? <EmptyLine text="Aucune alerte de stock" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Produit</TH><TH>Activité</TH><TH align="right">Stock</TH><TH align="right">Seuil</TH><TH align="right">Manque</TH></tr></thead>
              <tbody>
                {allStockAlerts.map((a, i) => (
                  <tr key={a.id + i} style={{ background: i % 2 ? '#fff7ed' : '#fff' }}>
                    <TD bold>{a.name}</TD><TD color="#94a3b8">{a.part}</TD>
                    <TD align="right" color={a.currentQty <= 0 ? '#dc2626' : '#b45309'}>{lit(a.currentQty)}{a.unit ? ` ${a.unit}` : ''}</TD>
                    <TD align="right">{lit(a.minQty)}</TD>
                    <TD align="right" bold color="#dc2626">{lit(a.deficit)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {allExpiry.length > 0 && (
            <>
              <p style={{ margin: '10px 0 5px 0', fontSize: 10, fontWeight: 900, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expirations proches ({allExpiry.length})</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Produit</TH><TH>Activité</TH><TH>Expiration</TH><TH align="right">Jours</TH></tr></thead>
                <tbody>
                  {allExpiry.map((a, i) => (
                    <tr key={a.id + i} style={{ background: i % 2 ? '#faf5ff' : '#fff' }}>
                      <TD bold>{a.name}</TD><TD color="#94a3b8">{a.part}</TD><TD>{shortDate(a.expirationDate)}</TD>
                      <TD align="right" bold color={a.status === 'expired' ? '#dc2626' : '#c2410c'}>{a.status === 'expired' ? `Expiré` : `${a.daysLeft}j`}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Part>

        {/* PART 4 — Bilan */}
        <Part num="4" label="Bilan global" accent="#047857">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
            {[
              { label: 'Coût marchandises', value: g.cogs, bg: '#fff7ed', col: '#c2410c' },
              { label: 'Marge brute', value: g.grossMargin, bg: '#ecfdf5', col: '#047857' },
              { label: 'Valeur du stock', value: g.stockValue, bg: '#eff6ff', col: '#1d4ed8' },
              { label: 'Dépenses + salaires', value: g.expensesTotal + g.salariesPaid, bg: '#fef2f2', col: '#dc2626' },
            ].map(c => (
              <div key={c.label} style={{ padding: '10px 13px', background: c.bg, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <p style={{ margin: 0, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>{c.label}</p>
                <p style={{ margin: '3px 0 0 0', fontSize: 16.5, fontWeight: 900, color: c.col }}>{da(c.value)} DA</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderRadius: 8, color: '#fff', background: g.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Total des gains (toutes activités)</p>
              <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>Ventes − coût des marchandises vendues − dépenses − salaires − destructions − pertes</p>
            </div>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{da(g.netGain)} DA</p>
          </div>
        </Part>

        <Footer settings={settings} title={title} />
      </div>
    </div>
  );
});
GlobalFiche.displayName = 'GlobalFiche';

// ─── Fuel-purchases fiche (Achats carburant, fully detailed) ─────────────────
/** One règlement of an achat carburant, with its mode and its references. */
export interface FuelPurchasePaymentDetail {
  mode: string;                 // ESPECES | CHEQUE | VIREMENT
  amount: number;
  chequeNumber?: string;
  bordereauNumber?: string;
  account: string;              // libellé du compte débité (caisse ou banque)
  date: string;
  notes?: string;
}
/** A single achat carburant with everything needed to print/inspect it. */
export interface FuelPurchaseDetail {
  id: string;
  /** Référence de l'achat : n° de facture, à défaut n° de BL, à défaut l'id court. */
  ref: string;
  invoiceNumber?: string;
  blNumber?: string;
  date: string;
  supplier: string;
  status: string;
  items: { name: string; qty: number; unitPrice: number; total: number; type?: string }[];
  /** Cuves livrées, en une ligne : « Cuve 1 (Essence), Cuve 2 (Gasoil) ». */
  cuves: string;
  subtotal: number;
  discountAmount: number;
  tvaAmount: number;
  total: number;
  paid: number;
  rest: number;
  liters: number;
  payments: FuelPurchasePaymentDetail[];
}

/** Anything that carries a list of règlements (un achat entier ou une tranche par carburant). */
interface HasPayments { payments: FuelPurchasePaymentDetail[] }

/** Modes de règlement d'un achat, résumés en une ligne : « Chèque, Espèces ». */
export const payModesOf = (p: HasPayments): string =>
  Array.from(new Set(p.payments.map(pay => PAY_MODE_LABEL[pay.mode] || pay.mode))).join(', ') || '—';

/**
 * Références du règlement, en une ligne : compte débité + n° de chèque /
 * bordereau. C'est l'information que le gérant recherche sur la fiche imprimée.
 */
export const payInfoOf = (p: HasPayments): string => {
  if (p.payments.length === 0) return 'Aucun règlement (dette)';
  return p.payments.map(pay => [
    pay.account,
    pay.chequeNumber ? `chèque n° ${pay.chequeNumber}` : '',
    pay.bordereauNumber ? `bordereau n° ${pay.bordereauNumber}` : '',
  ].filter(Boolean).join(' · ')).join(' | ');
};

// ─── Regroupement des achats par TYPE de carburant ────────────────────────────
/**
 * Un achat vu du côté d'UN carburant : la part de cet achat qui concerne ce
 * carburant. Un achat mono-carburant (le cas courant) donne une seule tranche
 * égale à l'achat entier ; un achat qui remplit des cuves de types différents est
 * réparti au prorata de la valeur de chaque type (montants, payé, reste et
 * règlements sont proratisés pour que la somme des tranches redonne l'achat).
 */
export interface FuelPurchaseSlice {
  id: string;          // id de l'achat parent (partagé entre les tranches d'un achat multi-types)
  ref: string;
  date: string;
  supplier: string;
  status: string;
  cuves: string;       // cuves de CE type uniquement
  liters: number;      // litres de CE type
  total: number;       // montant attribué à CE type
  paid: number;
  rest: number;
  payments: FuelPurchasePaymentDetail[]; // règlements (montant = part attribuée à ce type)
  multiType: boolean;  // vrai si l'achat parent couvre plusieurs carburants
}
/** Tous les achats d'un même carburant, avec ses totaux et son récap de règlements. */
export interface FuelTypeGroup {
  type: string;        // ESSENCE | GASOIL | GPL | DIESEL | SUPER | AUTRE
  label: string;
  color: string;
  liters: number;
  total: number;
  paid: number;
  rest: number;
  count: number;       // nombre d'achats touchant ce carburant
  slices: FuelPurchaseSlice[];
  /** Récapitulatif des règlements par mode, pour ce carburant. */
  paymentsByMode: Record<string, { amount: number; count: number }>;
}

/**
 * Regroupe une liste d'achats carburant par TYPE de carburant. Les totaux (litres,
 * montant, payé, reste) et les règlements sont calculés au niveau du carburant :
 * un achat qui remplit plusieurs types est réparti au prorata de la valeur livrée
 * de chaque type. Les groupes sont triés du plus gros total au plus petit.
 */
export function groupPurchasesByFuelType(purchases: FuelPurchaseDetail[]): FuelTypeGroup[] {
  const groups = new Map<string, FuelTypeGroup>();
  const ensure = (type: string): FuelTypeGroup => {
    let g = groups.get(type);
    if (!g) {
      g = { type, label: FUEL_TYPE_LABEL[type] || type, color: FUEL_TYPE_COLOR[type] || FUEL_TYPE_COLOR.AUTRE,
        liters: 0, total: 0, paid: 0, rest: 0, count: 0, slices: [], paymentsByMode: {} };
      groups.set(type, g);
    }
    return g;
  };

  for (const p of purchases) {
    // Valeur, litres et cuves par type, à partir des lignes de l'achat.
    const byType = new Map<string, { liters: number; value: number; cuves: Set<string> }>();
    for (const it of p.items) {
      const t = it.type || 'AUTRE';
      const e = byType.get(t) || { liters: 0, value: 0, cuves: new Set<string>() };
      e.liters += it.qty || 0;
      e.value += it.total || 0;
      if (it.name) e.cuves.add(it.name);
      byType.set(t, e);
    }
    // Achat sans ligne de cuve exploitable : tout sur « Autre » pour ne rien perdre.
    if (byType.size === 0) byType.set('AUTRE', { liters: p.liters, value: p.total, cuves: new Set<string>() });

    const totalValue = Array.from(byType.values()).reduce((s, e) => s + e.value, 0) || 1;
    const multiType = byType.size > 1;

    for (const [t, e] of byType) {
      const share = multiType ? e.value / totalValue : 1;
      const g = ensure(t);
      const sliceTotal = multiType ? p.total * share : p.total;
      const slicePaid = multiType ? p.paid * share : p.paid;
      const sliceRest = multiType ? p.rest * share : p.rest;
      const slicePayments = p.payments.map(pay => ({ ...pay, amount: multiType ? pay.amount * share : pay.amount }));

      g.liters += e.liters;
      g.total += sliceTotal;
      g.paid += slicePaid;
      g.rest += sliceRest;
      g.count += 1;
      g.slices.push({
        id: p.id, ref: p.ref, date: p.date, supplier: p.supplier, status: p.status,
        cuves: Array.from(e.cuves).join(', '), liters: e.liters,
        total: sliceTotal, paid: slicePaid, rest: sliceRest, payments: slicePayments, multiType,
      });
      slicePayments.forEach(pay => {
        const cur = g.paymentsByMode[pay.mode] || { amount: 0, count: 0 };
        g.paymentsByMode[pay.mode] = { amount: cur.amount + pay.amount, count: cur.count + 1 };
      });
    }
  }

  const arr = Array.from(groups.values());
  arr.forEach(g => g.slices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  arr.sort((a, b) => b.total - a.total);
  return arr;
}

/**
 * Compact cells for the achats table: 11 columns have to fit the A4 portrait
 * width, so this sheet uses tighter padding and a smaller type size than the
 * shared `TH` / `TD`, and lets long references wrap instead of overflowing.
 */
function THc({ children, align, width }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; width?: string }) {
  return <th style={{ padding: '5px 6px', width, textAlign: align || 'left', fontSize: 8.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.2, color: '#fff' }}>{children}</th>;
}
function TDc({ children, align, bold, color }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; bold?: boolean; color?: string }) {
  return <td style={{ padding: '4px 6px', textAlign: align || 'left', fontSize: 9.5, fontWeight: bold ? 900 : 600, color: color || '#1e293b', borderBottom: '1px solid #eef2f7', wordBreak: 'break-word' }}>{children}</td>;
}

/** Récap des règlements par mode + la dette, en pastilles sous un tableau. */
function PaymentModeChips({ byMode, rest }: { byMode: Record<string, { amount: number; count: number }>; rest: number }) {
  const entries = Object.entries(byMode);
  if (entries.length === 0 && rest <= 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
      {entries.map(([mode, agg]) => (
        <span key={mode} style={{ fontWeight: 800, fontSize: 10.5, padding: '5px 11px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155' }}>
          {PAY_MODE_LABEL[mode] || mode} : {da(agg.amount)} DA ({agg.count} règlement{agg.count > 1 ? 's' : ''})
        </span>
      ))}
      {rest > 0 && (
        <span style={{ fontWeight: 800, fontSize: 10.5, padding: '5px 11px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
          Dette fournisseurs : {da(rest)} DA
        </span>
      )}
    </div>
  );
}

/** Bandeau de totaux d'un carburant, sous le titre de sa section. */
function FuelTypeSummary({ g }: { g: FuelTypeGroup }) {
  const cells: { label: string; value: string; col: string }[] = [
    { label: 'Achats', value: `${g.count}`, col: C.blue700 },
    { label: 'Volume', value: `${lit(g.liters)} L`, col: '#7c3aed' },
    { label: 'Total achats', value: `${da(g.total)} DA`, col: g.color },
    { label: 'Payé', value: `${da(g.paid)} DA`, col: '#047857' },
    { label: 'Reste (dette)', value: `${da(g.rest)} DA`, col: g.rest > 0 ? '#dc2626' : '#94a3b8' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, margin: '0 0 10px 0' }}>
      {cells.map(c => (
        <div key={c.label} style={{ borderLeft: `3px solid ${c.col}`, background: '#f8fafc', borderRadius: '0 6px 6px 0', padding: '6px 10px' }}>
          <p style={{ margin: 0, fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4, color: '#94a3b8' }}>{c.label}</p>
          <p style={{ margin: '2px 0 0 0', fontSize: 13.5, fontWeight: 900, color: c.col }}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Printable "Achats Carburant" sheet — same Fiche-Journalière shell (banner, KPI
 * strip, signature footer) as every other fiche.
 *
 * Les achats sont regroupés PAR TYPE DE CARBURANT : une section par carburant
 * (Essence, Gasoil, …), chacune avec ses totaux, la liste de ses achats et le
 * récapitulatif de ses règlements par mode. Chaque ligne porte ce que le gérant
 * vérifie : la référence, la cuve, la quantité, le mode de règlement et SES
 * références (compte débité, n° de chèque / bordereau), et le total.
 */
export const PurchasesFiche = React.forwardRef<HTMLDivElement, {
  purchases: FuelPurchaseDetail[]; from: string; to: string; settings: any;
}>(({ purchases, from, to, settings }, ref) => {
  const period = `Du ${shortDate(from)} au ${shortDate(to)}`;
  const title = 'Achats Carburant';
  const totals = purchases.reduce(
    (a, p) => ({ total: a.total + p.total, paid: a.paid + p.paid, rest: a.rest + p.rest, liters: a.liters + p.liters }),
    { total: 0, paid: 0, rest: 0, liters: 0 },
  );
  const groups = groupPurchasesByFuelType(purchases);

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge="Achats · Carburant" period={period} />
        <KpiStrip kpis={[
          { label: 'Nombre d\'achats', value: `${purchases.length}`, col: C.blue700 },
          { label: 'Volume acheté', value: `${lit(totals.liters)} L`, col: '#7c3aed' },
          { label: 'Total achats', value: `${da(totals.total)} DA`, col: '#c2410c' },
          { label: 'Payé', value: `${da(totals.paid)} DA`, col: '#047857' },
          { label: 'Reste (dette)', value: `${da(totals.rest)} DA`, col: totals.rest > 0 ? '#dc2626' : '#94a3b8' },
        ]} />

        {groups.length === 0 && (
          <Part num="1" label="Achats carburant" accent="#c2410c">
            <EmptyLine text="Aucun achat carburant sur la période" />
          </Part>
        )}

        {groups.map((g, gi) => (
          <Part key={g.type} num={`${gi + 1}`} label={`Achats ${g.label}`} accent={g.color}>
            <FuelTypeSummary g={g} />
            <table style={tableStyle}>
              <thead><tr style={theadRow}>
                <THc>N° achat</THc>
                <THc>Date</THc>
                <THc>Fournisseur</THc>
                <THc>Cuve</THc>
                <THc align="right">Quantité</THc>
                <THc>Mode de paiement</THc>
                <THc>Références du règlement</THc>
                <THc align="right">Total</THc>
                <THc align="right">Payé</THc>
                <THc align="right">Reste</THc>
                <THc>Statut</THc>
              </tr></thead>
              <tbody>
                {g.slices.map((s, i) => (
                  <tr key={s.id + '-' + i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <TDc bold color={C.blue900}>{s.ref}{s.multiType ? ' *' : ''}</TDc>
                    <TDc>{shortDate(s.date)}</TDc>
                    <TDc>{s.supplier}</TDc>
                    <TDc>{s.cuves || '—'}</TDc>
                    <TDc align="right" bold>{lit(s.liters)} L</TDc>
                    <TDc bold color={s.payments.length === 0 ? '#dc2626' : C.blue700}>{payModesOf(s)}</TDc>
                    <TDc color="#475569">{payInfoOf(s)}</TDc>
                    <TDc align="right" bold color={C.blue900}>{da(s.total)} DA</TDc>
                    <TDc align="right" color="#15803d">{da(s.paid)} DA</TDc>
                    <TDc align="right" color={s.rest > 0 ? '#dc2626' : '#94a3b8'}>{da(s.rest)} DA</TDc>
                    <TDc bold color={statusColor(s.status)}>{s.status}</TDc>
                  </tr>
                ))}
                <tr style={{ background: '#fff7ed' }}>
                  <TDc bold color="#9a3412">TOTAL {g.label.toUpperCase()}</TDc>
                  <TDc /><TDc /><TDc />
                  <TDc align="right" bold color="#9a3412">{lit(g.liters)} L</TDc>
                  <TDc /><TDc />
                  <TDc align="right" bold color="#9a3412">{da(g.total)} DA</TDc>
                  <TDc align="right" bold color="#15803d">{da(g.paid)} DA</TDc>
                  <TDc align="right" bold color="#dc2626">{da(g.rest)} DA</TDc>
                  <TDc />
                </tr>
              </tbody>
            </table>
            <PaymentModeChips byMode={g.paymentsByMode} rest={g.rest} />
          </Part>
        ))}

        {groups.some(g => g.slices.some(s => s.multiType)) && (
          <p style={{ margin: '0 14px 10px 14px', fontSize: 9, color: '#94a3b8', fontStyle: 'italic' }}>
            * Achat couvrant plusieurs carburants — montants répartis au prorata de la valeur livrée de chaque type.
          </p>
        )}

        <Footer settings={settings} title={title} />
      </div>
    </div>
  );
});
PurchasesFiche.displayName = 'PurchasesFiche';
