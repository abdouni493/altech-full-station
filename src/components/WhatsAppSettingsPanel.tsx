/**
 * ─── RÉGLAGES → WHATSAPP ───────────────────────────────────────────────────────
 *
 *  POURQUOI CET ÉCRAN EXISTE
 *  C'est la pièce qui rend le montage utilisable par le personnel de la station
 *  plutôt que par un développeur. Sans lui, connecter le téléphone imposerait
 *  d'appeler l'API de la passerelle à la main, jeton compris. Tout se fait ici :
 *  aucun terminal, aucun copier-coller de secret.
 *
 *  CE QU'IL N'AFFICHE JAMAIS
 *  Ni la clé de la passerelle, ni le jeton du webhook, ni l'URL complète : hôte
 *  seul, et nom d'instance masqué. Cet écran est ouvert devant du personnel
 *  administratif, et il est visible dans l'onglet réseau du navigateur.
 *
 *  LES DEUX PIÈGES QUE SON DESSIN ÉVITE
 *    • « Réenregistrer le webhook » est disponible SESSION OUVERTE. C'est
 *      exactement le cas qui en a besoin — webhook périmé, session saine — et
 *      c'est celui où le bouton avait été oublié. Le seul contournement était de
 *      délier le téléphone : casser une session valide pour corriger une URL.
 *    • Le bandeau « la passerelle est prête » est conditionné à un webhook
 *      RÉELLEMENT vérifié. L'afficher sans cela serait un mensonge : les
 *      messages partiraient, les statuts resteraient bloqués sur « en attente »,
 *      et l'écran affirmerait que tout va bien.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageCircle, RefreshCcw, LogOut, QrCode, Link2, ShieldCheck, ShieldAlert,
  AlertTriangle, CheckCircle2, Loader2, Server, Smartphone, Send, Inbox,
} from 'lucide-react';
import {
  WhatsAppStatus, fetchStatus, flushOutbox, sessionAction, SessionAction,
} from '../lib/whatsapp';

/** Cadence de sondage tant qu'un QR est affiché — un QR expire en moins d'une minute. */
const QR_POLL_MS = 3_000;

const WEBHOOK_LABEL: Record<WhatsAppStatus['webhook'], { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  verified: { text: 'Jeton vérifié', tone: 'ok' },
  'token-mismatch': { text: 'Jeton divergent', tone: 'bad' },
  'wrong-url': { text: 'Adresse périmée', tone: 'bad' },
  missing: { text: 'Non configuré', tone: 'bad' },
  unknown: { text: 'Indéterminé', tone: 'warn' },
};

export default function WhatsAppSettingsPanel() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [busy, setBusy] = useState<SessionAction | 'refresh' | 'flush' | null>(null);
  const [error, setError] = useState<{ message: string; remedy?: string | null } | null>(null);
  const [qr, setQr] = useState<{ image: string | null; code: string | null }>({ image: null, code: null });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [flushNote, setFlushNote] = useState<string | null>(null);

  /** Garde de démontage : une action passerelle dure plusieurs secondes, et
   *  l'utilisateur peut changer de page entre-temps. */
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setBusy('refresh');
    try {
      const s = await fetchStatus();
      if (!alive.current) return;
      setStatus(s);
      setError(s.error ? { message: s.error, remedy: s.remedy } : null);
      // Un QR périmé laissé à l'écran invite à scanner dans le vide.
      if (s.connected) setQr({ image: null, code: null });
    } catch (err: any) {
      if (!alive.current) return;
      setError({ message: String(err?.message || err) });
    } finally {
      if (alive.current && !silent) setBusy(null);
    }
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  /**
   * Sondage UNIQUEMENT tant qu'un QR est affiché et que la session n'est pas
   * ouverte : le badge passe au vert tout seul dès que le scan est pris en
   * compte. Pas de sondage permanent — cet écran reste parfois ouvert des
   * heures, et chaque appel réveille une fonction serverless.
   */
  useEffect(() => {
    if (!qr.image || status?.connected) return;
    const id = setInterval(() => refresh(true), QR_POLL_MS);
    return () => clearInterval(id);
  }, [qr.image, status?.connected, refresh]);

  const run = async (action: SessionAction) => {
    setBusy(action);
    setError(null);
    try {
      const s = await sessionAction(action);
      if (!alive.current) return;
      setStatus(s);
      if (action === 'connect') setQr({ image: s.qrBase64, code: s.pairingCode });
      if (action === 'logout') { setQr({ image: null, code: null }); setConfirmLogout(false); }
      if (s.error) setError({ message: s.error, remedy: s.remedy });
    } catch (err: any) {
      if (alive.current) setError({ message: String(err?.message || err) });
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const doFlush = async () => {
    setBusy('flush');
    setFlushNote(null);
    try {
      const r = await flushOutbox();
      if (!alive.current) return;
      setFlushNote(
        r.sent === 0 && r.pending === 0
          ? 'La file est vide.'
          : `${r.sent} message(s) parti(s), ${r.pending} encore en attente${r.expired ? `, ${r.expired} périmé(s)` : ''}.`,
      );
      await refresh(true);
    } catch (err: any) {
      if (alive.current) setError({ message: String(err?.message || err) });
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const connected = !!status?.connected;
  const anyBusy = busy !== null;
  const webhookInfo = WEBHOOK_LABEL[status?.webhook || 'unknown'];

  return (
    <div className="space-y-6">
      {/* ── Badge d'état ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-xs uppercase tracking-wider border-2 ${
          connected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          <MessageCircle className="w-4 h-4" />
          {connected ? 'Session connectée' : 'Session fermée'}
        </div>
        <button className="btn-secondary" onClick={() => refresh()} disabled={anyBusy}>
          {busy === 'refresh' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          Actualiser
        </button>
        {(status?.pending || 0) > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-800 uppercase tracking-wider">
            <Inbox className="w-3.5 h-3.5" /> {status!.pending} en attente
          </span>
        )}
      </div>

      {/* ── Le téléphone lié — vérifier d'un coup d'œil que c'est le bon ──── */}
      {connected && (status?.linkedNumber || status?.profileName) && (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <Smartphone className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-700">
              {status?.linkedNumber ? `+${status.linkedNumber}` : 'Numéro non communiqué'}
            </p>
            {status?.profileName && <p className="text-[11px] font-semibold text-slate-400">{status.profileName}</p>}
          </div>
        </div>
      )}

      {/* ── Grille d'informations ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InfoRow icon={Link2} label="Instance" value={status?.instanceMasked || '—'} />
        <InfoRow icon={Server} label="Serveur" value={status?.baseUrlHost || 'non configuré'}
          tone={status?.baseUrlHost ? 'neutral' : 'bad'} />
        <InfoRow icon={webhookInfo.tone === 'ok' ? ShieldCheck : ShieldAlert} label="Webhook"
          value={webhookInfo.text} tone={webhookInfo.tone === 'ok' ? 'ok' : webhookInfo.tone === 'bad' ? 'bad' : 'warn'} />
        <InfoRow icon={MessageCircle} label="État brut" value={status?.state || '—'} />
      </div>

      {/* ── Une variable d'environnement écartée : la NOMMER ────────────────── */}
      {status?.ignoredEnv && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Variable ignorée — {status.ignoredEnv}
          </p>
          <p className="text-xs font-semibold text-amber-900/80 mt-1.5 leading-relaxed">{status.ignoredReason}</p>
        </div>
      )}

      {/* ── La persistance ─────────────────────────────────────────────────── */}
      {status?.configured && !status?.storageConfigured && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Ni journal, ni file d'attente
          </p>
          <p className="text-xs font-semibold text-amber-900/80 mt-1.5 leading-relaxed">
            <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> n'est pas renseignée chez
            l'hébergeur. Les messages peuvent partir, mais rien n'est journalisé et
            <strong> un envoi tenté passerelle éteinte serait PERDU</strong> au lieu d'être mis en
            attente. Ajoutez la variable, puis redéployez.
          </p>
        </div>
      )}

      {/* ── L'erreur, avec sa manœuvre ─────────────────────────────────────── */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Passerelle
          </p>
          <p className="text-xs font-semibold text-red-900/80 mt-1.5 leading-relaxed">{error.message}</p>
          {error.remedy && (
            <p className="text-xs font-semibold text-red-900/60 mt-2 leading-relaxed">→ {error.remedy}</p>
          )}
        </div>
      )}

      {/* ── Les actions ────────────────────────────────────────────────────── */}
      {connected ? (
        <div className="space-y-4">
          {status?.webhookConfigured ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-emerald-900/80 leading-relaxed">
                La passerelle est prête. Les messages partent du numéro de la station, et les
                accusés de remise reviennent bien jusqu'à l'application.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-amber-900/80 leading-relaxed">
                Les messages partiront, mais <strong>aucun accusé de remise ne reviendra</strong> :
                les statuts resteront bloqués sur « En attente ». Cliquez
                <strong> « Réenregistrer le webhook » </strong>ci-dessous — cela ne délie pas le
                téléphone et ne coupe pas la session.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => run('restart')} disabled={anyBusy}>
              {busy === 'restart' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              {busy === 'restart' ? 'Redémarrage…' : 'Redémarrer la session'}
            </button>
            <button className="btn-primary" onClick={() => run('setup')} disabled={anyBusy}>
              {busy === 'setup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {busy === 'setup' ? 'Enregistrement…' : 'Réenregistrer le webhook'}
            </button>
            {(status?.pending || 0) > 0 && (
              <button className="btn-secondary" onClick={doFlush} disabled={anyBusy}>
                {busy === 'flush' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {busy === 'flush' ? 'Envoi…' : 'Envoyer maintenant'}
              </button>
            )}
            {confirmLogout ? (
              <>
                <button className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-black text-xs uppercase tracking-wider"
                  onClick={() => run('logout')} disabled={anyBusy}>
                  {busy === 'logout' ? 'Déconnexion…' : 'Oui, déconnecter'}
                </button>
                <button className="btn-ghost" onClick={() => setConfirmLogout(false)} disabled={anyBusy}>Annuler</button>
              </>
            ) : (
              <button className="btn-ghost !text-red-600" onClick={() => setConfirmLogout(true)} disabled={anyBusy}>
                <LogOut className="w-4 h-4" /> Déconnecter
              </button>
            )}
          </div>
          {flushNote && <p className="text-xs font-bold text-slate-500">{flushNote}</p>}
          <p className="text-[11px] font-semibold text-slate-400 leading-relaxed">
            Déconnecter délie le téléphone : <strong>tous les envois s'arrêtent</strong> jusqu'à un
            nouveau scan du QR code. Redémarrer, au contraire, relance la session sans rien délier.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => run('connect')} disabled={anyBusy || !status?.configured}>
              {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {busy === 'connect' ? 'Connexion…' : qr.image ? 'Nouveau QR code' : 'Connecter WhatsApp'}
            </button>
            <button className="btn-secondary" onClick={() => run('setup')} disabled={anyBusy || !status?.configured}>
              {busy === 'setup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {busy === 'setup' ? 'Initialisation…' : "Initialiser l'instance"}
            </button>
          </div>
          <p className="text-[11px] font-semibold text-slate-400 leading-relaxed">
            « Initialiser » crée l'instance sur la passerelle et y enregistre l'adresse du webhook.
            À faire une fois — et de nouveau après un changement de domaine.
            <strong> Connectez toujours le téléphone depuis le site déployé</strong>, jamais depuis
            un poste de développement : le webhook pointerait sur cette machine.
          </p>

          {qr.image && (
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 flex flex-col items-center gap-3">
              <img src={qr.image} alt="QR code WhatsApp" className="w-56 h-56 object-contain" />
              <p className="text-xs font-bold text-slate-600 text-center leading-relaxed max-w-sm">
                Sur le téléphone de la station : <strong>WhatsApp → ⋮ → Appareils connectés →
                Connecter un appareil</strong>, puis scannez ce code.
              </p>
              <p className="text-[11px] font-semibold text-slate-400">
                Le code expire en moins d'une minute — l'écran bascule tout seul dès qu'il est scanné.
              </p>
            </div>
          )}
          {qr.code && (
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Code d'appairage
              </p>
              <p className="font-mono text-3xl font-black tracking-[0.3em] text-[#002d87]">{qr.code}</p>
              <p className="text-[11px] font-semibold text-slate-400 mt-2">
                À saisir sur le téléphone quand la caméra ne coopère pas.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── À savoir ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">À savoir</p>
        <ul className="text-[11px] font-semibold text-slate-500 leading-relaxed space-y-1.5 list-disc pl-4">
          <li>
            Les messages partent du <strong>numéro de la station</strong>, via une passerelle
            auto-hébergée : aucun modèle à faire approuver, les textes se modifient librement.
          </li>
          <li>
            <strong>Le poste qui héberge la passerelle doit rester allumé.</strong> Éteint, en
            veille ou sans Internet, aucun message ne part — les envois sont alors mis en attente
            et repartent seuls au retour.
          </li>
          <li>
            Le téléphone qui a scanné doit se reconnecter à Internet de temps en temps, sinon
            WhatsApp finit par délier l'appareil.
          </li>
          <li>
            Écrire trop, ou à des gens qui n'attendent rien, <strong>fait bannir le numéro</strong>,
            et un numéro banni l'est sans recours. Les envois groupés sont temporisés
            volontairement : ne cherchez pas à les accélérer.
          </li>
          <li>Les identifiants sont configurés côté serveur et ne sont jamais affichés ici.</li>
        </ul>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, tone = 'neutral' }: {
  icon: React.ElementType; label: string; value: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
}) {
  const toneCls = tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-700' : 'text-slate-700';
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <Icon className={`w-4 h-4 shrink-0 ${toneCls}`} />
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <p className={`text-xs font-black truncate ${toneCls}`}>{value}</p>
      </div>
    </div>
  );
}
