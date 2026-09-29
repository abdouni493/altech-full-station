/**
 * ─── Lire un code-barres avec la caméra du poste ───────────────────────────────
 *
 * Un seul écran, réutilisé partout où un code-barres se saisit : la création
 * d'un produit (Gestion de stock) et la recherche du point de vente. Il rend le
 * code lu et ne décide de rien d'autre — c'est l'écran appelant qui sait s'il
 * doit remplir un champ ou ajouter l'article au panier.
 *
 * ── Pourquoi aucune bibliothèque ──────────────────────────────────────────────
 * Le décodage est fait par `BarcodeDetector`, l'API du navigateur : rien à
 * installer, rien à charger depuis Internet — ce qui compte pour un poste de
 * station dont la connexion tombe. Elle est présente sur Chrome / Edge (Android
 * et bureau), c'est-à-dire sur les postes et les téléphones utilisés ici.
 *
 * Quand elle manque, on ne laisse pas l'utilisateur devant une fenêtre morte :
 * la caméra reste affichée (il peut lire le chiffre à l'œil) et le champ de
 * saisie manuelle, TOUJOURS présent, accepte aussi bien la frappe au clavier que
 * la douchette USB — qui, elle, se comporte comme un clavier et fonctionne
 * partout.
 *
 * ── Ce que la caméra exige ────────────────────────────────────────────────────
 * `getUserMedia` n'existe QUE sur une origine sûre : https, ou localhost. Sur
 * une adresse http en réseau local, le navigateur ne le dit pas — il fait comme
 * si l'API n'existait pas. Le message le dit à la place.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScanLine, Camera, CameraOff, Keyboard, RefreshCw, Zap, ZapOff, Check,
} from 'lucide-react';
import { Modal, Field, Input } from './biz/Kit';

/** Les symbologies qu'on demande au navigateur — celles des rayons. */
const FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93',
  'itf', 'codabar', 'qr_code', 'data_matrix',
];

type Phase = 'starting' | 'scanning' | 'error' | 'unsupported';

/** L'API du navigateur, quand elle est là. */
const detectorCtor = (): any =>
  (typeof window !== 'undefined' ? (window as any).BarcodeDetector : undefined);

/** La caméra n'est accessible qu'en https ou sur localhost. */
const cameraAvailable = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Un bip court à chaque lecture : le caissier n'a pas à regarder l'écran. */
function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1760;
    gain.gain.value = 0.06;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    setTimeout(() => ctx.close?.(), 250);
  } catch { /* le son n'est qu'un confort : son échec n'arrête rien */ }
}

export interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  /** Le code lu (ou tapé). Rendre `false` refuse la lecture et laisse scanner. */
  onDetect: (code: string) => void | boolean;
  title?: string;
  subtitle?: string;
  /**
   * Le point de vente enchaîne les articles : la fenêtre reste ouverte après
   * chaque lecture. La fiche produit, elle, n'a qu'un code à remplir et se
   * ferme aussitôt.
   */
  continuous?: boolean;
  /** Ce que l'écran appelant a fait de la dernière lecture, affiché en bas. */
  lastResult?: string;
}

export default function BarcodeScannerModal({
  open, onClose, onDetect, title = 'Scanner un code-barres',
  subtitle = 'Présentez le code devant la caméra', continuous = false, lastResult,
}: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  /** Dernier code lu + instant : sans ce verrou, un code posé devant l'objectif
   *  se déclencherait à chaque image, soit des dizaines de fois par seconde. */
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  /**
   * La caméra CHOISIE par l'utilisateur — vide tant qu'il n'a rien choisi, et le
   * navigateur prend celle de dos. Y écrire l'objectif effectivement ouvert
   * relancerait l'effet et couperait le flux une fraction de seconde après
   * l'avoir ouvert, à chaque ouverture de la fenêtre.
   */
  const [cameraId, setCameraId] = useState('');
  const [activeCameraId, setActiveCameraId] = useState('');
  /** Incrémenté par « Réessayer » : c'est lui qui relance vraiment la caméra. */
  const [retry, setRetry] = useState(0);
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [flash, setFlash] = useState('');

  // ── Une lecture ────────────────────────────────────────────────────────────
  const emit = useCallback((raw: string) => {
    const code = String(raw || '').trim();
    if (!code) return;
    const now = Date.now();
    // Le même code deux fois de suite : accepté seulement après 1,2 s, le temps
    // de retirer l'article et d'en présenter un autre.
    if (lastRef.current.code === code && now - lastRef.current.at < 1200) return;
    lastRef.current = { code, at: now };
    beep();
    setFlash(code);
    const accepted = onDetect(code);
    if (accepted === false) return;
    if (!continuous) onClose();
  }, [onDetect, continuous, onClose]);

  // ── Caméra + boucle de détection ───────────────────────────────────────────
  const stop = useCallback(() => {
    if (loopRef.current !== null) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) { stop(); return; }

    let cancelled = false;

    const start = async () => {
      setError('');
      setPhase('starting');

      if (!cameraAvailable()) {
        setPhase('error');
        setError(window.isSecureContext === false
          ? "La caméra n'est accessible qu'en HTTPS (ou sur localhost). Saisissez le code à la main, ou utilisez une douchette USB."
          : "Aucune caméra n'est accessible depuis ce navigateur.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId
            ? { deviceId: { exact: cameraId } }
            : { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // `playsInline` évite le passage en plein écran sur iOS.
          await videoRef.current.play().catch(() => { /* geste utilisateur requis */ });
        }

        // La lampe, quand l'appareil en a une (téléphones).
        const track = stream.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.() || {};
        setHasTorch(!!caps.torch);

        // La liste des caméras n'est étiquetée qu'APRÈS l'autorisation.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          const vids = devices.filter(d => d.kind === 'videoinput');
          setCameras(vids.map((d, i) => ({ id: d.deviceId, label: d.label || `Caméra ${i + 1}` })));
          setActiveCameraId(cameraId || track?.getSettings?.().deviceId || '');
        }
      } catch (e: any) {
        if (cancelled) return;
        setPhase('error');
        setError(
          e?.name === 'NotAllowedError'
            ? "Accès à la caméra refusé. Autorisez-le dans la barre d'adresse du navigateur, puis rouvrez cette fenêtre."
            : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError'
              ? "Aucune caméra trouvée sur ce poste."
              : `Caméra indisponible — ${e?.message || 'erreur inconnue'}`);
        return;
      }

      // ── Décodage ─────────────────────────────────────────────────────────
      const Ctor = detectorCtor();
      if (!Ctor) {
        // La caméra tourne quand même : l'utilisateur lit le code à l'œil et le
        // tape, plutôt que de se retrouver devant un écran noir.
        setPhase('unsupported');
        return;
      }

      let detector: any;
      try {
        const supported: string[] = (await Ctor.getSupportedFormats?.()) || [];
        const formats = supported.length ? FORMATS.filter(f => supported.includes(f)) : FORMATS;
        detector = new Ctor(formats.length ? { formats } : undefined);
      } catch {
        detector = new Ctor();
      }
      if (cancelled) return;
      setPhase('scanning');

      // Une image sur trois suffit largement et laisse la main à l'interface.
      let tick = 0;
      const scan = async () => {
        loopRef.current = requestAnimationFrame(scan);
        if (cancelled) return;
        if (++tick % 3 !== 0) return;
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        try {
          const found = await detector.detect(video);
          if (found?.length) emit(found[0].rawValue);
        } catch { /* une image illisible n'arrête pas la boucle */ }
      };
      loopRef.current = requestAnimationFrame(scan);
    };

    start();
    return () => { cancelled = true; stop(); };
    // `emit` change avec `onDetect` : la boucle le lit par fermeture, et la
    // relancer à chaque frappe de l'appelant couperait la caméra en plein scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cameraId, retry, stop]);

  // Le code lu s'affiche puis s'efface : laissé en place, il ferait croire à une
  // lecture qui vient d'avoir lieu alors qu'elle date de plusieurs articles.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(''), 1800);
    return () => clearTimeout(id);
  }, [flash]);

  // Une fenêtre refermée repart propre : ni ancien message d'erreur, ni code
  // encore affiché, ni verrou anti-répétition sur le dernier article scanné.
  useEffect(() => {
    if (open) return;
    setFlash(''); setManual(''); setError('');
    lastRef.current = { code: '', at: 0 };
  }, [open]);

  // La lampe suit son interrupteur, sans redémarrer le flux.
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hasTorch) return;
    track.applyConstraints({ advanced: [{ torch } as any] }).catch(() => setHasTorch(false));
  }, [torch, hasTorch]);

  const live = phase === 'scanning' || phase === 'unsupported';

  return (
    <Modal open={open} onClose={onClose} icon={ScanLine} size="md" zClass="z-[90]"
      title={title} subtitle={subtitle}
      footer={<button className="btn-ghost" onClick={onClose}>Fermer</button>}>
      <div className="space-y-4">
        {/* ── Le viseur ──────────────────────────────────────────────────── */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3]">
          <video ref={videoRef} playsInline muted autoPlay
            className="w-full h-full object-cover" />

          {live && (
            /* Le cadre dit où présenter le code : sans repère, l'utilisateur
               cadre trop loin et la lecture n'aboutit jamais. */
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-[78%] h-[42%] rounded-xl border-2 border-[#FFB800] shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]">
                <div className="w-full h-0.5 bg-[#FFB800]/80 animate-pulse mt-[calc(50%-1px)]" />
              </div>
            </div>
          )}

          {phase === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
              <Camera className="w-8 h-8 animate-pulse" />
              <p className="text-xs font-bold">Ouverture de la caméra…</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2 px-6 text-center">
              <CameraOff className="w-8 h-8 text-red-300" />
              <p className="text-xs font-bold leading-relaxed">{error}</p>
            </div>
          )}

          {flash && (
            <div className="absolute left-0 right-0 bottom-0 bg-emerald-600/90 text-white px-4 py-2 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span className="font-mono font-black text-sm truncate">{flash}</span>
            </div>
          )}
        </div>

        {phase === 'unsupported' && (
          <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Ce navigateur ne sait pas décoder un code-barres. La caméra reste
            affichée : lisez le code et tapez-le ci-dessous, ou utilisez une
            douchette USB. Chrome ou Edge décodent automatiquement.
          </p>
        )}

        {/* ── Caméra utilisée & lampe ────────────────────────────────────── */}
        {(cameras.length > 1 || hasTorch || phase === 'error') && (
          <div className="flex flex-wrap items-center gap-2">
            {cameras.length > 1 && (
              <select value={activeCameraId} onChange={e => setCameraId(e.target.value)}
                className="input-field h-10 text-xs font-bold flex-1 min-w-[10rem]">
                {cameras.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
            {hasTorch && (
              <button type="button" onClick={() => setTorch(t => !t)}
                className={torch ? 'btn-primary !px-3' : 'btn-outline !px-3'}
                title={torch ? 'Éteindre la lampe' : 'Allumer la lampe'}>
                {torch ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
              </button>
            )}
            {phase === 'error' && (
              <button type="button" className="btn-outline" onClick={() => setRetry(n => n + 1)}>
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            )}
          </div>
        )}

        {/* ── Saisie manuelle / douchette USB ────────────────────────────────
            Toujours là, quel que soit l'état de la caméra : une douchette se
            comporte comme un clavier et termine par « Entrée ». */}
        <Field label="Ou saisissez le code" hint="Une douchette USB écrit ici toute seule.">
          <form onSubmit={e => { e.preventDefault(); if (manual.trim()) { emit(manual); setManual(''); } }}
            className="flex gap-2">
            <Input value={manual} autoFocus={!live}
              onChange={e => setManual(e.target.value)}
              placeholder="Code-barres" />
            <button type="submit" className="btn-primary !px-3 shrink-0" disabled={!manual.trim()}>
              <Keyboard className="w-4 h-4" />
            </button>
          </form>
        </Field>

        {lastResult && (
          <p className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            {lastResult}
          </p>
        )}
      </div>
    </Modal>
  );
}
