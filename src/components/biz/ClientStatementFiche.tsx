/**
 * ─── Relevé de compte client, imprimable ───────────────────────────────────────
 *
 * Le même document A4 que la *Fiche Journalière* — bandeau bleu nuit, filet or,
 * parties numérotées, tableaux zébrés, pied de page à signatures — mais son
 * sujet est UN client sur UNE période :
 *
 *      1. Identité & soldes        (dette d'ouverture → dette de clôture)
 *      2. Journal des opérations   (chaque pièce, sa date, son reste)
 *      3. Détail des documents     (article par article, ligne par ligne)
 *      4. Règlements encaissés     (date, mode, référence, montant)
 *      5. Récapitulation           (par nature, par mode de paiement)
 *
 * Il sert les trois activités sans être écrit trois fois : Carburant, Cafétéria
 * et Lavage & Vidange lui passent le même `ClientStatement`.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import {
  C, da, Banner, KpiStrip, Part, Footer, TH, TD, EmptyLine,
  tableStyle, theadRow, totalRow, sheetStyle, hiddenWrap,
} from './ReportFiche';
import { ClientStatement, KIND_COLOR, periodLabel } from '@/src/lib/clientStatement';

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR');
};
const dateTime = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const qty = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Une case du bloc « identité & soldes ». */
function InfoBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 7, padding: '8px 12px', border: '1px solid #e2e8f0' }}>
      <p style={{ margin: 0, fontSize: 8.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8' }}>{label}</p>
      <p style={{ margin: '3px 0 0 0', fontSize: 12.5, fontWeight: 900, color: color || '#0f172a' }}>{value}</p>
    </div>
  );
}

export const ClientStatementFiche = React.forwardRef<
  HTMLDivElement, { statement: ClientStatement; settings: any }
>(({ statement: s, settings }, ref) => {
  const period = periodLabel(s.from, s.to);
  const title = `Relevé de compte — ${s.client.name}`;
  // Seuls les documents ont un détail à déplier ; un règlement n'en a pas.
  const detailed = s.lines.filter(l => (l.items || []).length > 0);

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge={`Relevé client · ${s.partLabel}`} period={period} />

        <KpiStrip kpis={[
          { label: 'Total consommé', value: `${da(s.totals.charged)} DA`, col: '#1d4ed8' },
          { label: 'Total encaissé', value: `${da(s.totals.paid)} DA`, col: '#047857' },
          { label: 'Reste période', value: `${da(s.totals.rest)} DA`, col: '#dc2626' },
          { label: 'Dette de clôture', value: `${da(s.closingDebt)} DA`, col: s.closingDebt > 0 ? '#b91c1c' : '#15803d' },
        ]} />

        {/* PART 1 — IDENTITÉ & SOLDES */}
        <Part num="1" label="Identité du client & soldes de la période" accent={C.blue700}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
            <InfoBox label="Client" value={s.client.name || '—'} />
            <InfoBox label="Téléphone" value={s.client.phone || '—'} />
            <InfoBox label="Activité" value={s.partLabel} />
            <InfoBox label="Adresse" value={s.client.address || '—'} />
          </div>
          {(s.client.type || s.client.paymentMode) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
              <InfoBox label="Type de compte" value={s.client.type || '—'} />
              <InfoBox label="Mode de règlement" value={s.client.paymentMode || '—'} />
              <InfoBox label="Opérations" value={`${s.lines.length} sur la période`} />
              <InfoBox label="Documents" value={`${s.totals.documents}`} />
            </div>
          )}

          {/* Le mouvement de la dette, dans l'ordre où il se lit. */}
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Mouvement de la dette</TH><TH align="right">Montant</TH></tr></thead>
            <tbody>
              <tr style={{ background: '#fff' }}>
                <TD>Dette à l'ouverture de la période</TD>
                <TD align="right" bold color={s.openingDebt > 0 ? '#b45309' : '#64748b'}>{da(s.openingDebt)} DA</TD>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <TD>+ Consommation portée à crédit</TD>
                <TD align="right" bold color="#dc2626">{da(s.totals.credit)} DA</TD>
              </tr>
              <tr style={{ background: '#fff' }}>
                <TD>− Règlements encaissés</TD>
                <TD align="right" bold color="#15803d">{da(s.totals.paid)} DA</TD>
              </tr>
              <tr style={totalRow}>
                <TD bold color={C.blue900}>DETTE À LA CLÔTURE</TD>
                <TD align="right" bold color={s.closingDebt > 0 ? '#b91c1c' : '#15803d'}>{da(s.closingDebt)} DA</TD>
              </tr>
              {/* L'imputation de l'avance : sans elle, le relevé réclamait au
                  client une somme dont la station tenait déjà l'argent. */}
              {s.advanceHeld > 0 && s.closingDebt > 0 ? (
                <>
                  <tr style={{ background: '#f8fafc' }}>
                    <TD>− Avance détenue, imputée</TD>
                    <TD align="right" bold color="#0d9488">{da(Math.min(s.advanceHeld, s.closingDebt))} DA</TD>
                  </tr>
                  <tr style={totalRow}>
                    <TD bold color={C.blue900}>RESTE À RÉGLER</TD>
                    <TD align="right" bold color={s.netDebt > 0 ? '#b91c1c' : '#15803d'}>{da(s.netDebt)} DA</TD>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>

          {/* L'avance n'existe que là où le client en tient une. */}
          {(s.openingAdvance || s.closingAdvance || s.totals.advanceRecharged || s.totals.advanceUsed) ? (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#047857', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Compte d'avance
              </p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Avance</TH><TH align="right">Montant</TH></tr></thead>
                <tbody>
                  <tr style={{ background: '#fff' }}><TD>Solde à l'ouverture</TD><TD align="right" bold>{da(s.openingAdvance)} DA</TD></tr>
                  <tr style={{ background: '#f8fafc' }}><TD>+ Recharges de la période</TD><TD align="right" bold color="#047857">{da(s.totals.advanceRecharged)} DA</TD></tr>
                  <tr style={{ background: '#fff' }}><TD>− Consommé sur l'avance</TD><TD align="right" bold color="#b45309">{da(s.totals.advanceUsed)} DA</TD></tr>
                  <tr style={totalRow}><TD bold color={C.blue900}>SOLDE À LA CLÔTURE</TD><TD align="right" bold color="#047857">{da(s.closingAdvance)} DA</TD></tr>
                  {s.advanceHeld > s.advanceLeft ? (
                    <tr style={{ background: '#fff' }}>
                      <TD>dont imputé sur ce que le client doit</TD>
                      <TD align="right" bold color="#0d9488">{da(s.advanceHeld - s.advanceLeft)} DA</TD>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </Part>

        {/* PART 2 — JOURNAL */}
        <Part num="2" label="Journal des opérations" accent="#0e7490">
          {s.lines.length === 0 ? <EmptyLine text="Aucune opération sur la période" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}>
                <TH>Date</TH><TH>Nature</TH><TH>Réf</TH><TH>Désignation</TH>
                <TH align="right">Débit</TH><TH align="right">Crédit</TH><TH align="right">Reste</TH>
              </tr></thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={l.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <TD>{shortDate(l.date)}</TD>
                    <TD bold color={KIND_COLOR[l.kind]}>{l.kindLabel}</TD>
                    <TD color="#64748b">{l.ref || '—'}</TD>
                    <TD>
                      {l.label}
                      {(l.qtyLabel || l.mode || l.reference || l.notes) && (
                        <span style={{ color: '#94a3b8' }}>
                          {' '}— {[l.qtyLabel, l.mode, l.reference, l.notes].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </TD>
                    <TD align="right" color={l.charged ? '#0f172a' : '#cbd5e1'}>{l.charged ? `${da(l.charged)} DA` : '—'}</TD>
                    <TD align="right" color={l.paid ? '#15803d' : '#cbd5e1'}>{l.paid ? `${da(l.paid)} DA` : '—'}</TD>
                    <TD align="right" bold color={l.rest > 0 ? '#dc2626' : '#94a3b8'}>{da(l.rest)} DA</TD>
                  </tr>
                ))}
                <tr style={totalRow}>
                  <TD bold color={C.blue900}>TOTAL</TD><TD /><TD /><TD />
                  <TD align="right" bold color={C.blue900}>{da(s.totals.charged)} DA</TD>
                  <TD align="right" bold color="#15803d">{da(s.totals.paid)} DA</TD>
                  <TD align="right" bold color="#dc2626">{da(s.totals.rest)} DA</TD>
                </tr>
              </tbody>
            </table>
          )}
        </Part>

        {/* PART 3 — DÉTAIL DES DOCUMENTS */}
        <Part num="3" label="Détail des documents (article par article)" accent="#7c3aed">
          {detailed.length === 0 ? <EmptyLine text="Aucun document détaillé sur la période" /> : detailed.map(l => (
            <div key={`d-${l.id}`} style={{ marginBottom: 12, breakInside: 'avoid' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
                <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, color: C.blue900 }}>
                  {l.kindLabel} {l.ref ? `· ${l.ref}` : ''} <span style={{ color: '#94a3b8', fontWeight: 700 }}>— {dateTime(l.date)}</span>
                </p>
                <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, color: '#0f172a' }}>
                  {da(l.charged)} DA
                  {l.rest > 0 && <span style={{ color: '#dc2626' }}> · reste {da(l.rest)} DA</span>}
                </p>
              </div>
              <table style={tableStyle}>
                <thead><tr style={theadRow}>
                  <TH>Désignation</TH><TH align="right">Quantité</TH><TH align="right">P.U.</TH><TH align="right">Montant</TH>
                </tr></thead>
                <tbody>
                  {(l.items || []).map((it, i) => (
                    <tr key={`${l.id}-it-${i}`} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                      <TD>{it.name}</TD>
                      <TD align="right">{qty(it.qty)}{it.unit ? ` ${it.unit}` : ''}</TD>
                      <TD align="right" color="#64748b">{da(it.unitPrice)} DA</TD>
                      <TD align="right" bold>{da(it.total)} DA</TD>
                    </tr>
                  ))}
                  <tr style={totalRow}>
                    <TD bold color={C.blue900}>TOTAL DOCUMENT</TD><TD /><TD />
                    <TD align="right" bold color={C.blue900}>{da(l.charged)} DA</TD>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </Part>

        {/* PART 4 — RÈGLEMENTS */}
        <Part num="4" label="Règlements encaissés" accent="#047857">
          {s.payments.length === 0 ? <EmptyLine text="Aucun règlement sur la période" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}>
                <TH>Date</TH><TH>Libellé</TH><TH>Mode</TH><TH>Référence</TH><TH align="right">Montant</TH>
              </tr></thead>
              <tbody>
                {s.payments.map((p, i) => (
                  <tr key={p.id} style={{ background: i % 2 ? '#f0fdf4' : '#fff' }}>
                    <TD>{shortDate(p.date)}</TD>
                    <TD>{p.label || 'Règlement'}</TD>
                    <TD bold color="#047857">{p.mode}</TD>
                    <TD color="#64748b">
                      {p.reference || '—'}
                      {p.inferred && <span style={{ color: '#b45309' }}> (date du document)</span>}
                    </TD>
                    <TD align="right" bold color="#15803d">{da(p.amount)} DA</TD>
                  </tr>
                ))}
                <tr style={totalRow}>
                  <TD bold color={C.blue900}>TOTAL ENCAISSÉ</TD><TD /><TD /><TD />
                  <TD align="right" bold color="#15803d">{da(s.totals.paid)} DA</TD>
                </tr>
              </tbody>
            </table>
          )}
        </Part>

        {/* PART 5 — RÉCAPITULATION */}
        <Part num="5" label="Récapitulation" accent="#047857">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: C.blue700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Par nature d'opération</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Nature</TH><TH align="right">Nb</TH><TH align="right">Montant</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {s.byKind.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD></tr>) :
                    s.byKind.map((k, i) => (
                      <tr key={k.kind} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                        <TD bold color={KIND_COLOR[k.kind]}>{k.label}</TD>
                        <TD align="right">{k.count}</TD>
                        <TD align="right">{da(k.charged)} DA</TD>
                        <TD align="right" color={k.rest > 0 ? '#dc2626' : '#94a3b8'}>{da(k.rest)} DA</TD>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#047857', textTransform: 'uppercase', letterSpacing: 0.5 }}>Par mode de règlement</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Mode</TH><TH align="right">Nb</TH><TH align="right">Montant</TH></tr></thead>
                <tbody>
                  {s.byMode.length === 0 ? (<tr><TD color="#94a3b8">Aucun</TD><TD align="right">0</TD><TD align="right">0</TD></tr>) :
                    s.byMode.map((m, i) => (
                      <tr key={m.mode} style={{ background: i % 2 ? '#f0fdf4' : '#fff' }}>
                        <TD bold>{m.mode}</TD>
                        <TD align="right">{m.count}</TD>
                        <TD align="right" bold color="#15803d">{da(m.amount)} DA</TD>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '13px 16px', borderRadius: 8, color: '#fff',
            background: s.netDebt > 0
              ? 'linear-gradient(135deg,#991b1b,#dc2626)'
              : s.advanceLeft > 0
                ? 'linear-gradient(135deg,#115e59,#0d9488)'
                : 'linear-gradient(135deg,#065f46,#047857)',
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>
                {s.netDebt > 0
                  ? 'Solde restant dû par le client'
                  : s.advanceLeft > 0 ? 'Avance restant au client' : 'Compte soldé'}
              </p>
              <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>
                Dette d'ouverture {da(s.openingDebt)} DA + crédit {da(s.totals.credit)} DA
                {' '}− règlements {da(s.totals.paid)} DA
                {s.advanceHeld > 0 ? ` − avance détenue ${da(s.advanceHeld)} DA` : ''}
              </p>
            </div>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>
              {da(s.netDebt > 0 ? s.netDebt : s.advanceLeft)} DA
            </p>
          </div>
        </Part>

        <Footer settings={settings} title={title} />
      </div>
    </div>
  );
});
ClientStatementFiche.displayName = 'ClientStatementFiche';
