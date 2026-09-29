/**
 * ─── RÉGLAGES → QR CODE ───────────────────────────────────────────────────────
 *
 *  POURQUOI CET ÉCRAN EXISTE
 *  La station donne des adresses à ses clients : le suivi de compte, un numéro,
 *  un formulaire. Recopiées à la main depuis une affiche, elles se tapent faux
 *  une fois sur deux. Ici, l'adresse entre, le carré sort, et il se télécharge —
 *  en PNG pour une affiche ou un message, en SVG pour l'imprimeur, qui ne
 *  pixellise à aucune taille.
 *
 *  CE QU'IL MONTRE, ET POURQUOI
 *  Toujours l'adresse RÉELLEMENT encodée, sous le symbole. Un « rclmc.dz » saisi
 *  sans protocole devient `https://rclmc.dz` : le téléphone qui scanne ouvre un
 *  site, pas une recherche. Cette réécriture doit se voir avant l'impression —
 *  une fois l'affiche collée sur la pompe, il est tard.
 *
 *  CE QU'IL NE FAIT PAS
 *  Aucun appel réseau : le symbole est calculé sur le poste (`lib/qrcode.ts`).
 *  Un générateur en ligne enverrait l'adresse de la station à un tiers et ne
 *  répondrait plus le jour où la connexion tombe — or c'est justement au
 *  comptoir, hors ligne, qu'on réimprime une affiche.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { QrCode, Link2, Download, FileImage, FileCode2, RefreshCcw, AlertTriangle, Wand2 } from 'lucide-react';
import { encodeQr, qrPath, qrSvg, EC_LEVELS, type EcLevel, type QrCode as QrSymbol } from '../lib/qrcode';
import { cn } from '@/src/lib/utils';

/** Marge claire autour du symbole, en modules. La norme en demande quatre : en dessous, les lecteurs décrochent. */
const MARGIN = 4;

/** Tailles de PNG proposées — de la vignette d'un message à l'affiche A3. */
const PNG_SIZES = [256, 512, 1024, 2048];

/** Le réglage se retient par poste : celui qui réimprime l'affiche du mois ne resaisit pas l'adresse. */
const PREFS_KEY = 'qr_generator_prefs_v1';

interface Prefs { url: string; ecLevel: EcLevel; pngSize: number }

function loadPrefs(): Prefs {
  const fallback: Prefs = { url: '', ecLevel: 'M', pngSize: 1024 };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      url: typeof p.url === 'string' ? p.url : fallback.url,
      ecLevel: EC_LEVELS.some(l => l.value === p.ecLevel) ? (p.ecLevel as EcLevel) : fallback.ecLevel,
      pngSize: PNG_SIZES.includes(p.pngSize as number) ? (p.pngSize as number) : fallback.pngSize,
    };
  } catch { return fallback; }
}

function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* poste en navigation privée : tant pis */ }
}

/**
 * Ce qui sera VRAIMENT encodé.
 *
 * Une adresse saisie sans protocole (`rclmc.dz/client`) n'ouvre rien quand on la
 * scanne : le téléphone la traite comme du texte. On préfixe donc `https://`,
 * mais seulement si le texte ressemble à une adresse — un `tel:`, un `mailto:`
 * ou une phrase quelconque sont laissés tels quels, ils ont leur usage.
 */
export function normalizeUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return text;      // déjà un protocole (http, tel, mailto, upi…)
  if (/^[^\s./]+\.[^\s./]{2,}(?:[/:?#]|$)/.test(text)) return `https://${text}`; // un nom de domaine
  return text;
}

/** Un nom de fichier lisible, tiré de l'adresse : `qr-rclmc-dz-client.png`. */
export function fileBaseName(value: string): string {
  const slug = value
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return `qr-${slug || 'code'}`;
}

/** Déclenche un téléchargement depuis un blob déjà en mémoire. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function QrCodePanel() {
  const initial = useMemo(loadPrefs, []);
  const [url, setUrl] = useState(initial.url);
  const [ecLevel, setEcLevel] = useState<EcLevel>(initial.ecLevel);
  const [pngSize, setPngSize] = useState(initial.pngSize);
  /** Le symbole affiché : celui de la DERNIÈRE conversion, pas celui de la frappe en cours. */
  const [result, setResult] = useState<{ qr: QrSymbol; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggestion = typeof window !== 'undefined' ? `${window.location.origin}/client` : '';
  /** L'adresse a changé depuis la conversion : le symbole affiché n'est plus celui du champ. */
  const stale = result !== null && normalizeUrl(url) !== result.value;

  const convert = () => {
    const value = normalizeUrl(url);
    if (!value) { setError("Saisissez une adresse à convertir."); setResult(null); return; }
    try {
      const qr = encodeQr(value, { ecLevel });
      setResult({ qr, value });
      setError(null);
      savePrefs({ url, ecLevel, pngSize });
    } catch (e: any) {
      setResult(null);
      setError(e?.message ?? "Cette adresse ne tient pas dans un QR code.");
    }
  };

  const downloadPng = () => {
    if (!result) return;
    const side = result.qr.size + MARGIN * 2;
    // Un module doit tomber sur un nombre ENTIER de pixels, sinon les bords bavent
    // et la douchette du téléphone hésite. La taille demandée est donc arrondie.
    const scale = Math.max(1, Math.round(pngSize / side));
    const px = scale * side;

    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError("Le navigateur n'a pas fourni de canvas : téléchargez le SVG."); return; }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (let y = 0; y < result.qr.size; y++) {
      for (let x = 0; x < result.qr.size; x++) {
        if (result.qr.modules[y][x]) ctx.fillRect((x + MARGIN) * scale, (y + MARGIN) * scale, scale, scale);
      }
    }
    const name = `${fileBaseName(result.value)}-${px}.png`;
    if (canvas.toBlob) canvas.toBlob(blob => { if (blob) downloadBlob(blob, name); }, 'image/png');
    else {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = name;
      a.click();
    }
  };

  const downloadSvg = () => {
    if (!result) return;
    const svg = qrSvg(result.qr, { scale: 8, margin: MARGIN });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${fileBaseName(result.value)}.svg`);
  };

  const previewSide = result ? result.qr.size + MARGIN * 2 : 0;
  const pngPreviewPx = result ? Math.max(1, Math.round(pngSize / previewSide)) * previewSide : 0;

  return (
    <div className="space-y-8">
      {/* ── Saisie ── */}
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-4 w-1 bg-gradient-to-b from-blue-900 to-yellow-400 rounded-full" />
          <h4 className="text-[11px] font-black text-blue-900 uppercase tracking-widest">Adresse à convertir</h4>
        </div>

        <form
          className="flex flex-col sm:flex-row gap-3"
          onSubmit={e => { e.preventDefault(); convert(); }}
        >
          <div className="relative flex-1">
            <Link2 className="w-4 h-4 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="input-field font-bold pl-11"
              placeholder="https://exemple.dz/page"
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null); }}
            />
          </div>
          <button type="submit" className="btn-primary h-12 px-8 flex items-center gap-2 shrink-0" disabled={!url.trim()}>
            <QrCode className="w-4 h-4" />
            Convertir
          </button>
        </form>

        {suggestion && (
          <button
            type="button"
            onClick={() => { setUrl(suggestion); setError(null); }}
            className="inline-flex items-center gap-2 text-[11px] font-bold text-blue-900/70 hover:text-blue-900 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Utiliser l'espace client de la station&nbsp;: <span className="font-mono">{suggestion}</span>
          </button>
        )}

        {/* Niveau de correction */}
        <div className="space-y-2">
          <label className="label-field">Robustesse du symbole</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {EC_LEVELS.map(level => (
              <button
                key={level.value}
                type="button"
                onClick={() => setEcLevel(level.value)}
                title={level.hint}
                className={cn(
                  'p-3 rounded-xl border-2 text-left transition-all',
                  ecLevel === level.value
                    ? 'border-blue-900 bg-gradient-to-r from-blue-900/10 to-yellow-400/10 shadow-md -translate-y-0.5'
                    : 'border-slate-100 hover:border-blue-200 bg-white',
                )}
              >
                <p className={cn('text-[11px] font-black uppercase tracking-wide', ecLevel === level.value ? 'text-blue-900' : 'text-slate-400')}>
                  {level.label}
                </p>
                <p className="text-[9px] text-slate-400 font-semibold leading-snug mt-1">{level.hint}</p>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 font-semibold italic">
            Plus la correction est haute, plus le symbole reste lisible sali, plié ou partiellement caché — mais plus il est dense.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border-2 border-red-100 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[12px] font-bold text-red-700 leading-relaxed">{error}</p>
        </div>
      )}

      {/* ── Résultat ── */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Le symbole */}
          <div className="rounded-2xl p-8 flex flex-col items-center gap-5 shadow-xl" style={{ background: 'linear-gradient(135deg, #001233 0%, #001f5c 50%, #003087 100%)' }}>
            <div className="bg-white p-4 rounded-2xl shadow-2xl">
              <svg
                viewBox={`0 0 ${previewSide} ${previewSide}`}
                width={288}
                height={288}
                shapeRendering="crispEdges"
                role="img"
                aria-label={`QR code de ${result.value}`}
                className="block"
              >
                <rect width={previewSide} height={previewSide} fill="#FFFFFF" />
                <path d={qrPath(result.qr, MARGIN)} fill="#000000" />
              </svg>
            </div>
            <p className="text-[11px] font-mono text-white/90 break-all text-center leading-relaxed max-w-full">
              {result.value}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <span className="badge badge-yellow">Version {result.qr.version}</span>
              <span className="badge badge-info">{result.qr.size} × {result.qr.size} modules</span>
              <span className="badge badge-neutral">Correction {result.qr.ecLevel}</span>
            </div>
            {stale && (
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-yellow-300">
                <RefreshCcw className="w-3.5 h-3.5" />
                L'adresse a changé — reconvertissez
              </div>
            )}
          </div>

          {/* Le téléchargement */}
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-4 w-1 bg-gradient-to-b from-blue-900 to-yellow-400 rounded-full" />
              <h4 className="text-[11px] font-black text-blue-900 uppercase tracking-widest">Téléchargement</h4>
            </div>

            <div className="space-y-2">
              <label className="label-field">Taille du PNG</label>
              <div className="grid grid-cols-4 gap-2">
                {PNG_SIZES.map(size => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => { setPngSize(size); savePrefs({ url, ecLevel, pngSize: size }); }}
                    className={cn(
                      'py-2.5 rounded-xl border-2 text-[11px] font-black transition-all',
                      pngSize === size ? 'border-blue-900 bg-blue-900/5 text-blue-900' : 'border-slate-100 text-slate-400 hover:border-blue-200',
                    )}
                  >
                    {size} px
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 font-semibold italic">
                Fichier produit&nbsp;: {pngPreviewPx} × {pngPreviewPx} px — la taille est ajustée pour qu'un module tombe sur un nombre entier de pixels.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={downloadPng} className="btn-primary h-12 px-6 flex-1 flex items-center justify-center gap-2">
                <FileImage className="w-4 h-4" />
                Télécharger PNG
              </button>
              <button type="button" onClick={downloadSvg} className="btn-outline h-12 px-6 flex-1 flex items-center justify-center gap-2">
                <FileCode2 className="w-4 h-4" />
                Télécharger SVG
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <p className="text-[11px] font-black text-blue-900 uppercase tracking-widest flex items-center gap-2">
                <Download className="w-3.5 h-3.5" />
                Lequel choisir
              </p>
              <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                Le <strong>PNG</strong> se colle dans un message, une affiche ou un document. Le <strong>SVG</strong> ne
                pixellise à aucune taille&nbsp;: c'est celui qu'on donne à l'imprimeur pour une bâche ou un autocollant.
              </p>
              <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                Avant d'imprimer en série, scannez la vignette ci-contre avec un téléphone&nbsp;: c'est la seule
                vérification qui compte.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
