/**
 * ─── Fiches imprimables de l'inventaire ────────────────────────────────────────
 * Deux documents A4, dans la MÊME langue visuelle que la Fiche Journalière et
 * les rapports (bandeau bleu nuit, accent or, parties numérotées, tableaux
 * zébrés, pied de page à signer) :
 *
 *   • `InventaireFiche`  — la feuille de comptage : chaque produit avec la
 *     quantité trouvée en rayon, sa valorisation au prix d'achat et le total.
 *   • `ComparisonFiche`  — le rapport d'écarts : compté vs application, le
 *     décalage de chaque produit, les manquants d'un côté, les surplus de
 *     l'autre, et l'impact net en dinars.
 *
 * Les deux se rendent hors écran et s'impriment via `printFiche` — exactement
 * comme les fiches de rapport, donc avec la même mise en page A4.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { BizInventaire, INVENTAIRE_STATUS_META } from '@/src/lib/bizConfig';
import { countedLabelOf, countedQtyOf } from '@/src/lib/inventaire';
import {
  C, da, lit, Banner, KpiStrip, Footer, Part, TH, TD, EmptyLine,
  tableStyle, theadRow, totalRow, sheetStyle, hiddenWrap,
} from './ReportFiche';

const shortDate = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR');
};

// ─── Feuille de comptage ──────────────────────────────────────────────────────
export const InventaireFiche = React.forwardRef<HTMLDivElement, {
  inventaire: BizInventaire; settings: any; partLabel: string;
}>(({ inventaire: inv, settings, partLabel }, ref) => {
  const lines = inv.lines || [];
  const totalValue = lines.reduce((s, l) => s + countedQtyOf(l) * (Number(l.purchasePrice) || 0), 0);
  const totalSaleValue = lines.reduce((s, l) => s + countedQtyOf(l) * (Number(l.salePrice) || 0), 0);
  const totalQty = lines.reduce((s, l) => s + countedQtyOf(l), 0);
  const status = INVENTAIRE_STATUS_META[inv.status];

  // Regroupement par catégorie : c'est dans cet ordre qu'on parcourt un rayon,
  // donc c'est dans cet ordre que la feuille doit se lire.
  const byCategory = new Map<string, typeof lines>();
  lines.forEach(l => {
    const key = l.categoryName || 'Sans catégorie';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(l);
  });

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge={`Inventaire · ${partLabel}`}
          period={`${inv.ref} — ${shortDate(inv.date)}`} />
        <KpiStrip kpis={[
          { label: 'Références comptées', value: String(lines.length), col: C.blue700 },
          { label: 'Quantité totale', value: lit(totalQty), col: '#1d4ed8' },
          { label: "Valeur au prix d'achat", value: `${da(totalValue)} DA`, col: '#b45309' },
          { label: 'Valeur au prix de vente', value: `${da(totalSaleValue)} DA`, col: '#047857' },
        ]} />

        <Part num="1" label="Identification de l'inventaire" accent={C.blue700}>
          <table style={tableStyle}>
            <tbody>
              <tr style={{ background: '#f8fafc' }}>
                <TD bold>Nom de l'inventaire</TD><TD>{inv.ref}</TD>
                <TD bold>Date du comptage</TD><TD>{shortDate(inv.date)}</TD>
              </tr>
              <tr>
                <TD bold>Activité</TD><TD>{partLabel}</TD>
                <TD bold>État</TD><TD>{status.label}</TD>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <TD bold>Établi par</TD><TD>{inv.createdBy || '—'}</TD>
                <TD bold>Créé le</TD><TD>{shortDate(inv.createdAt)}</TD>
              </tr>
            </tbody>
          </table>
          {inv.notes && (
            <p style={{ margin: '8px 0 0 0', fontSize: 10.5, color: '#475569' }}>
              <b>Observations :</b> {inv.notes}
            </p>
          )}
        </Part>

        <Part num="2" label="Produits comptés" accent={C.gold}>
          {lines.length === 0 ? <EmptyLine text="Aucun produit compté." /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}>
                <TH>Produit</TH><TH>Code-barres</TH><TH align="right">Quantité comptée</TH>
                <TH align="right">Prix d'achat</TH><TH align="right">Valeur</TH>
              </tr></thead>
              <tbody>
                {[...byCategory.entries()].map(([cat, rows]) => (
                  <React.Fragment key={cat}>
                    <tr style={{ background: '#eef2f7' }}>
                      <td colSpan={5} style={{ padding: '5px 9px', fontSize: 10, fontWeight: 900, color: C.blue800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {cat} — {rows.length} référence(s)
                      </td>
                    </tr>
                    {rows.map((l, i) => (
                      <tr key={l.productId} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                        <TD bold>{l.productName}</TD>
                        <TD color="#64748b">{l.barcode || '—'}</TD>
                        <TD align="right">{countedLabelOf(l)}</TD>
                        <TD align="right" color="#b45309">{da(l.purchasePrice)} DA</TD>
                        <TD align="right" bold>{da(countedQtyOf(l) * (Number(l.purchasePrice) || 0))} DA</TD>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr style={totalRow}>
                  <TD bold color={C.blue900}>TOTAL</TD>
                  <TD />
                  <TD align="right" bold color={C.blue900}>{lit(totalQty)}</TD>
                  <TD />
                  <TD align="right" bold color="#b45309">{da(totalValue)} DA</TD>
                </tr>
              </tbody>
            </table>
          )}
        </Part>

        <Footer settings={settings} title={`Inventaire ${inv.ref}`} />
      </div>
    </div>
  );
});
InventaireFiche.displayName = 'InventaireFiche';

// ─── Rapport de comparaison ───────────────────────────────────────────────────
export const ComparisonFiche = React.forwardRef<HTMLDivElement, {
  inventaire: BizInventaire; settings: any; partLabel: string;
}>(({ inventaire: inv, settings, partLabel }, ref) => {
  const cmp = inv.comparison;
  const losses = (cmp?.lines || []).filter(l => l.kind === 'perte');
  const gains = (cmp?.lines || []).filter(l => l.kind === 'gain');
  const exact = (cmp?.lines || []).filter(l => l.kind === 'exact');

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge={`Écarts d'inventaire · ${partLabel}`}
          period={`${inv.ref} — ${shortDate(inv.date)}`} />
        <KpiStrip kpis={[
          { label: 'Références comparées', value: String(cmp?.productsCounted || 0), col: C.blue700 },
          { label: 'Avec décalage', value: String(cmp?.productsWithEcart || 0), col: '#b45309' },
          { label: 'Manquants (pertes)', value: `${da(cmp?.lossValue || 0)} DA`, col: '#dc2626' },
          { label: 'Surplus (gains)', value: `${da(cmp?.gainValue || 0)} DA`, col: '#15803d' },
        ]} />

        <Part num="1" label="Résultat de la comparaison" accent={C.blue700}>
          <table style={tableStyle}>
            <tbody>
              <tr style={{ background: '#f8fafc' }}>
                <TD bold>Inventaire</TD><TD>{inv.ref}</TD>
                <TD bold>Comparé le</TD><TD>{shortDate(cmp?.at)}</TD>
              </tr>
              <tr>
                <TD bold>Comparé par</TD><TD>{cmp?.by || '—'}</TD>
                <TD bold>Stock corrigé</TD>
                <TD color={inv.correctedAt ? '#15803d' : '#b45309'}>
                  {inv.correctedAt ? `Oui, le ${shortDate(inv.correctedAt)}` : 'Non — stock inchangé'}
                </TD>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <TD bold>Impact net</TD>
                <TD bold color={(cmp?.netValue || 0) >= 0 ? '#15803d' : '#dc2626'}>{da(cmp?.netValue || 0)} DA</TD>
                <TD bold>Imputé aux employés</TD>
                <TD>{inv.chargeWorkers === false ? 'Non' : 'Oui'}</TD>
              </tr>
            </tbody>
          </table>
          <p style={{ margin: '8px 0 0 0', fontSize: 10, color: '#64748b' }}>
            Décalage = quantité comptée en rayon − quantité annoncée par l'application. Un décalage négatif est
            de la marchandise MANQUANTE (perte), un décalage positif de la marchandise trouvée en plus (gain).
            Tout est valorisé au prix d'achat.
          </p>
        </Part>

        <Part num="2" label={`Produits manquants — ${losses.length} référence(s)`} accent="#dc2626">
          {losses.length === 0 ? <EmptyLine text="Aucun produit manquant." /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}>
                <TH>Produit</TH><TH>Catégorie</TH><TH align="right">Compté</TH>
                <TH align="right">Application</TH><TH align="right">Décalage</TH>
                <TH align="right">Prix d'achat</TH><TH align="right">Perte</TH>
              </tr></thead>
              <tbody>
                {losses.map((l, i) => (
                  <tr key={l.productId} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <TD bold>{l.productName}</TD>
                    <TD color="#64748b">{l.categoryName || '—'}</TD>
                    <TD align="right">{lit(l.countedQty)}{l.unit ? ` ${l.unit}` : ''}</TD>
                    <TD align="right">{lit(l.systemQty)}{l.unit ? ` ${l.unit}` : ''}</TD>
                    <TD align="right" bold color="#dc2626">{lit(l.ecart)}</TD>
                    <TD align="right" color="#b45309">{da(l.purchasePrice)} DA</TD>
                    <TD align="right" bold color="#dc2626">{da(Math.abs(l.value))} DA</TD>
                  </tr>
                ))}
                <tr style={totalRow}>
                  <TD bold color={C.blue900}>TOTAL MANQUANTS</TD>
                  <TD /><TD /><TD />
                  <TD align="right" bold color="#dc2626">−{lit(cmp?.lossQty || 0)}</TD>
                  <TD />
                  <TD align="right" bold color="#dc2626">{da(cmp?.lossValue || 0)} DA</TD>
                </tr>
              </tbody>
            </table>
          )}
        </Part>

        <Part num="3" label={`Produits en surplus — ${gains.length} référence(s)`} accent="#15803d">
          {gains.length === 0 ? <EmptyLine text="Aucun surplus." /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}>
                <TH>Produit</TH><TH>Catégorie</TH><TH align="right">Compté</TH>
                <TH align="right">Application</TH><TH align="right">Décalage</TH>
                <TH align="right">Prix d'achat</TH><TH align="right">Gain</TH>
              </tr></thead>
              <tbody>
                {gains.map((l, i) => (
                  <tr key={l.productId} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <TD bold>{l.productName}</TD>
                    <TD color="#64748b">{l.categoryName || '—'}</TD>
                    <TD align="right">{lit(l.countedQty)}{l.unit ? ` ${l.unit}` : ''}</TD>
                    <TD align="right">{lit(l.systemQty)}{l.unit ? ` ${l.unit}` : ''}</TD>
                    <TD align="right" bold color="#15803d">+{lit(l.ecart)}</TD>
                    <TD align="right" color="#b45309">{da(l.purchasePrice)} DA</TD>
                    <TD align="right" bold color="#15803d">{da(l.value)} DA</TD>
                  </tr>
                ))}
                <tr style={totalRow}>
                  <TD bold color={C.blue900}>TOTAL SURPLUS</TD>
                  <TD /><TD /><TD />
                  <TD align="right" bold color="#15803d">+{lit(cmp?.gainQty || 0)}</TD>
                  <TD />
                  <TD align="right" bold color="#15803d">{da(cmp?.gainValue || 0)} DA</TD>
                </tr>
              </tbody>
            </table>
          )}
        </Part>

        <Part num="4" label={`Produits conformes — ${exact.length} référence(s)`} accent={C.blue600}>
          {exact.length === 0 ? <EmptyLine text="Aucun produit sans décalage." /> : (
            <p style={{ margin: '2px 0 6px 0', fontSize: 10.5, color: '#475569', lineHeight: 1.5 }}>
              {exact.map(l => l.productName).join(' · ')}
            </p>
          )}
        </Part>

        <Footer settings={settings} title={`Écarts d'inventaire ${inv.ref}`} />
      </div>
    </div>
  );
});
ComparisonFiche.displayName = 'ComparisonFiche';
