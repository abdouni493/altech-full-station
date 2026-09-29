/**
 * ─── Afficheur client ──────────────────────────────────────────────────────────
 * Le petit deuxième écran d'un poste de caisse « tout-en-un » : pendant que le
 * caissier compose le panier sur son écran, le client lit sur l'afficheur ce qui
 * vient d'être ajouté et, en très gros chiffres, le TOTAL à payer.
 *
 * L'afficheur est une FENÊTRE À PART (`window.open`), jamais un panneau de la
 * page : c'est la seule façon de la poser sur le second écran du poste. Le
 * caissier la fait glisser une fois sur le petit afficheur, appuie sur « Plein
 * écran », et elle y reste toute la journée.
 *
 * Cette fenêtre ne charge NI React NI feuille de style : tout son HTML est écrit
 * ici, dans un document `about:blank` de même origine. Elle démarre donc
 * instantanément, survit à un rechargement de la caisse et fonctionne sans
 * réseau — trois choses qu'un poste de vente ne peut pas se permettre de perdre.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useRef } from 'react';
import { formatCurrency } from '@/src/lib/utils';

/** Une ligne du panier, telle que le client la voit. */
export interface CustomerDisplayLine {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** Unité de vente au détail (L, kg…) — absente sur une vente à l'unité. */
  unit?: string;
  total: number;
}

/** Tout ce que l'afficheur montre à un instant donné. */
export interface CustomerDisplayState {
  /** Nom de la station, en tête de l'afficheur. */
  title: string;
  /** L'activité qui tient la caisse (Cafétéria, Lavage…). */
  subtitle: string;
  lines: CustomerDisplayLine[];
  subtotal: number;
  discount: number;
  total: number;
  /**
   * Le ticket qui vient d'être encaissé. Tant qu'il est là, l'afficheur montre
   * le remerciement et la monnaie à rendre au lieu d'un panier vide — c'est le
   * moment où le client a le plus besoin de lire l'écran.
   */
  receipt?: { total: number; paid: number; change: number } | null;
}

const WINDOW_NAME = 'rclmc-afficheur-client';
const WINDOW_FEATURES = 'width=1024,height=600,menubar=no,toolbar=no,location=no,status=no';

const money = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);

const esc = (v: unknown): string => String(v ?? '').replace(
  /[&<>"']/g,
  c => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]),
);

/** Une quantité lisible : 3 reste « 3 », 2.5 reste « 2,5 ». */
const qtyLabel = (q: number): string =>
  (Math.round(q * 1000) / 1000).toLocaleString('fr-DZ', { maximumFractionDigits: 3 });

/**
 * Le squelette de la fenêtre. Il n'est écrit qu'UNE fois, à l'ouverture : seuls
 * `#head` et `#root` sont repeints à chaque changement de panier. Le bouton
 * « Plein écran », lui, garde ainsi le gestionnaire de clic qu'on lui accroche
 * depuis la caisse.
 *
 * Toutes les tailles sont en `vh` bornées par `clamp()` : le même document reste
 * lisible sur un afficheur 800×480 comme sur un écran 24 pouces.
 */
const SHELL = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Afficheur client</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { height: 100% }
  body {
    background: #001233; color: #fff; overflow: hidden;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { height: 100%; display: flex; flex-direction: column }
  .head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 2vw;
    padding: 1.4vh 2vw; background: linear-gradient(90deg, #001f5c, #003087);
    border-bottom: 2px solid #FFB800;
  }
  .head b { font-size: clamp(14px, 2.8vh, 30px); font-weight: 800; letter-spacing: .01em }
  .head span { font-size: clamp(11px, 2vh, 20px); color: #9fb8e8; font-weight: 600 }
  .main { flex: 1; display: flex; min-height: 0 }
  .items {
    flex: 1.2; min-width: 0; padding: 1.6vh 1.8vw; overflow: hidden;
    display: flex; flex-direction: column; gap: .9vh;
  }
  .row {
    display: flex; align-items: baseline; gap: 1.2vw;
    font-size: clamp(13px, 2.6vh, 27px); line-height: 1.15;
  }
  .row .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600 }
  .row .q { color: #9fb8e8; font-size: .78em; font-variant-numeric: tabular-nums; white-space: nowrap }
  .row .t { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap }
  .row.last { color: #FFB800 }
  .row.last .q { color: #d9a53c }
  .more { color: #7f9cd4; font-size: clamp(11px, 1.9vh, 19px); font-weight: 700 }
  .empty {
    margin: auto; text-align: center; color: #7f9cd4;
    font-size: clamp(15px, 3.4vh, 36px); font-weight: 800; letter-spacing: .04em;
  }
  .side {
    flex: 1; min-width: 0; background: #000d24; border-left: 1px solid rgba(255,255,255,.08);
    padding: 1.8vh 2vw; display: flex; flex-direction: column; justify-content: center; gap: 1vh;
  }
  .lbl {
    font-size: clamp(10px, 1.8vh, 19px); text-transform: uppercase;
    letter-spacing: .14em; color: #7f9cd4; font-weight: 800;
  }
  .total {
    font-size: clamp(32px, 12.5vh, 148px); line-height: .95; font-weight: 900;
    color: #FFB800; font-variant-numeric: tabular-nums; letter-spacing: -.025em;
    overflow-wrap: anywhere;
  }
  .sub {
    display: flex; justify-content: space-between; gap: 1vw;
    font-size: clamp(11px, 2.1vh, 22px); color: #c9d9f5; font-variant-numeric: tabular-nums;
  }
  .sub.disc { color: #ffcf5c; font-weight: 700 }
  .thanks {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2.2vh; width: 100%; text-align: center;
  }
  .thanks .big {
    font-size: clamp(26px, 9vh, 108px); font-weight: 900; color: #22c55e; letter-spacing: .04em;
  }
  .cells { display: flex; gap: 3vw; flex-wrap: wrap; justify-content: center }
  .cell b {
    display: block; margin-top: .4vh; font-size: clamp(17px, 5vh, 56px);
    font-weight: 900; font-variant-numeric: tabular-nums;
  }
  .cell.change b { color: #FFB800 }
  .foot {
    display: flex; align-items: center; justify-content: space-between; gap: 2vw;
    padding: 1vh 2vw; background: #000a1c; color: #5f7cb4;
    font-size: clamp(10px, 1.7vh, 17px); font-weight: 600;
  }
  #fs {
    background: transparent; border: 1px solid rgba(255,255,255,.2); color: #7f9cd4;
    border-radius: 8px; padding: .35em .9em; font: inherit; cursor: pointer;
  }
  #fs:hover { color: #fff; border-color: #FFB800 }
</style></head>
<body><div class="wrap">
  <div class="head" id="head"></div>
  <div class="main" id="root"></div>
  <div class="foot">
    <span>Merci de votre visite</span>
    <button id="fs" type="button">Plein écran</button>
  </div>
</div></body></html>`;

/** Le bandeau du haut — le nom de la station et l'activité qui encaisse. */
function renderHead(d: CustomerDisplayState): string {
  return `<b>${esc(d.title)}</b><span>${esc(d.subtitle)}</span>`;
}

/** Le corps : le panier en cours, ou le ticket qui vient d'être encaissé. */
function renderBody(d: CustomerDisplayState): string {
  if (d.receipt) {
    const { total, paid, change } = d.receipt;
    return `<div class="thanks">
      <div class="big">MERCI</div>
      <div class="cells">
        <div class="cell"><span class="lbl">Total</span><b>${esc(money(total))}</b></div>
        <div class="cell"><span class="lbl">Payé</span><b>${esc(money(paid))}</b></div>
        ${change > 0 ? `<div class="cell change"><span class="lbl">Monnaie rendue</span><b>${esc(money(change))}</b></div>` : ''}
      </div>
    </div>`;
  }

  // Les dernières lignes ajoutées, la plus récente en bas et mise en avant :
  // c'est celle que le client vient d'entendre annoncer.
  const MAX = 7;
  const hidden = Math.max(0, d.lines.length - MAX);
  const shown = d.lines.slice(-MAX);
  const units = d.lines.reduce((s, l) => s + l.qty, 0);

  const items = d.lines.length === 0
    ? '<div class="empty">Bienvenue</div>'
    : (hidden > 0 ? `<div class="more">+ ${hidden} article(s) plus haut</div>` : '')
      + shown.map((l, i) => `<div class="row${i === shown.length - 1 ? ' last' : ''}">
          <span class="n">${esc(l.name)}</span>
          <span class="q">${esc(qtyLabel(l.qty))}${l.unit ? ` ${esc(l.unit)}` : ''} × ${esc(money(l.unitPrice))}</span>
          <span class="t">${esc(money(l.total))}</span>
        </div>`).join('');

  return `<div class="items">${items}</div>
    <div class="side">
      <span class="lbl">Total à payer</span>
      <div class="total">${esc(money(d.total))}</div>
      <div class="sub"><span>${esc(d.lines.length)} article(s) · ${esc(qtyLabel(units))} unité(s)</span></div>
      ${d.discount > 0
        ? `<div class="sub"><span>Sous-total</span><span>${esc(money(d.subtotal))}</span></div>
           <div class="sub disc"><span>Remise</span><span>− ${esc(money(d.discount))}</span></div>`
        : ''}
    </div>`;
}

/**
 * Ouvre l'afficheur tant que `open` vaut `true`, et le repeint à chaque
 * changement du panier. `onClosed` est rappelé quand la fenêtre disparaît sans
 * passer par la caisse — fermée à la main, ou refusée par le bloqueur de
 * fenêtres — pour que le bouton de la caisse revienne à l'état « éteint » au
 * lieu de prétendre qu'un afficheur est allumé.
 */
export function useCustomerDisplay(
  open: boolean,
  data: CustomerDisplayState,
  onClosed: (reason: 'blocked' | 'closed') => void,
): void {
  const winRef = useRef<Window | null>(null);
  // Le rappel est lu à travers une ref : la fenêtre ne doit surtout pas être
  // refermée et rouverte parce que le composant a re-rendu.
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (!open) return undefined;

    const w = window.open('', WINDOW_NAME, WINDOW_FEATURES);
    if (!w) { closedRef.current('blocked'); return undefined; }
    winRef.current = w;

    w.document.open();
    w.document.write(SHELL);
    w.document.close();

    const fs = w.document.getElementById('fs');
    if (fs) {
      fs.onclick = () => {
        const doc: any = w.document;
        if (doc.fullscreenElement) doc.exitFullscreen?.();
        else (doc.documentElement as any).requestFullscreen?.();
      };
    }
    // Premier rendu tout de suite : l'effet de peinture ci-dessous ne se
    // redéclenchera qu'au prochain changement de panier.
    paint(w, dataRef.current);
    try { w.focus(); } catch { /* le navigateur peut refuser de donner le focus */ }

    const timer = window.setInterval(() => {
      if (!w.closed) return;
      window.clearInterval(timer);
      winRef.current = null;
      closedRef.current('closed');
    }, 700);

    return () => {
      window.clearInterval(timer);
      winRef.current = null;
      if (!w.closed) w.close();
    };
  }, [open]);

  useEffect(() => {
    const w = winRef.current;
    if (!open || !w || w.closed) return;
    paint(w, data);
  }, [open, data]);
}

function paint(w: Window, d: CustomerDisplayState): void {
  const head = w.document.getElementById('head');
  const root = w.document.getElementById('root');
  if (head) head.innerHTML = renderHead(d);
  if (root) root.innerHTML = renderBody(d);
}
