/**
 * ─── Page publique « Votre avis » (/client) ────────────────────────────────────
 *
 * La seule page de l'application qui s'ouvre SANS compte. Un client de la
 * station y dépose son retour : la partie concernée (carburant, cafétéria ou
 * lavage) et ce qu'il a à dire. Il peut y ajouter son nom, son téléphone et son
 * e-mail s'il veut être rappelé — les trois sont FACULTATIFS, un avis anonyme
 * vaut mieux qu'un avis jamais déposé. L'avis part dans `client_feedbacks` et
 * s'allume aussitôt en pastille rouge dans le menu de la partie visée.
 *
 * Elle vit VOLONTAIREMENT hors de `AppProvider` / `BizProvider` : rien de la
 * station n'est chargé ici, donc rien ne peut fuir vers un visiteur. Le nom et
 * le logo viennent d'une fonction serveur dédiée qui n'expose que ça.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Fuel, MessageSquare, User, Phone, Mail, Send, CheckCircle2, AlertCircle,
  ArrowLeft, Loader2, ShieldCheck, Clock, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FEEDBACK_PARTS, FeedbackPart, submitClientFeedback } from '../lib/feedbacks';

/** Nom + logo de la station, lisibles sans compte (RPC `public_station_identity`). */
function useStationIdentity() {
  const [identity, setIdentity] = useState<{ name?: string; logoUrl?: string }>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('public_station_identity');
        if (!alive || error || !data) return;
        const row = data as { name?: string; logo_url?: string };
        setIdentity({ name: row.name || undefined, logoUrl: row.logo_url || undefined });
      } catch { /* la page se passe très bien de l'identité */ }
    })();
    return () => { alive = false; };
  }, []);
  return identity;
}

const BG = 'linear-gradient(160deg, #001233 0%, #001f5c 40%, #003087 100%)';
const GOLD = 'linear-gradient(135deg, #FFB800, #e6a000)';

export default function ClientFeedback() {
  const station = useStationIdentity();

  const [part, setPart] = useState<FeedbackPart | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /** Le strict nécessaire : une partie et un message. Le reste est offert. */
  const canSend = !!part && message.trim().length >= 3;
  /** Le remerciement ne promet un rappel que si le client a laissé de quoi le joindre. */
  const [leftContact, setLeftContact] = useState(false);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend || sending || !part) return;
    setError(null);
    setSending(true);
    const res = await submitClientFeedback({ part, fullName, phone, email, message });
    setSending(false);
    if (!res.ok) { setError(res.error || "Envoi impossible — réessayez."); return; }
    setLeftContact(!!phone.trim() || !!email.trim());
    setSent(true);
  };

  /** Reprendre à zéro pour déposer un second avis. */
  const reset = () => {
    setPart(null); setFullName(''); setPhone(''); setEmail(''); setMessage('');
    setError(null); setSent(false); setLeftContact(false);
  };

  return (
    <div className="min-h-screen w-full px-4 py-8 sm:py-12 flex flex-col items-center" style={{ background: BG }}>
      {/* Halos décoratifs — même signature visuelle que l'écran de connexion. */}
      <div className="fixed top-0 right-0 w-[420px] h-[420px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,184,0,0.12) 0%, transparent 70%)', transform: 'translate(35%,-35%)' }} />
      <div className="fixed bottom-0 left-0 w-[380px] h-[380px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,68,187,0.35) 0%, transparent 70%)', transform: 'translate(-30%,30%)' }} />

      <div className="relative w-full max-w-2xl">
        {/* En-tête */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden mb-4"
            style={{ background: GOLD, boxShadow: '0 8px 28px rgba(255,184,0,0.4)' }}>
            {station.logoUrl
              ? <img src={station.logoUrl} alt="" className="w-full h-full object-cover" />
              : <Fuel className="w-7 h-7 text-[#001f5c]" />}
          </div>
          <h1 className="text-white font-black text-2xl sm:text-3xl tracking-tight">
            {station.name || 'Station de service'}
          </h1>
          <p className="text-[11px] font-black uppercase tracking-[0.25em] mt-1" style={{ color: 'rgba(255,184,0,0.75)' }}>
            Votre avis compte
          </p>
        </div>

        <AnimatePresence mode="wait">
          {sent ? (
            <ThankYou key="thanks" onAgain={reset} contactLeft={leftContact} />
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              onSubmit={send}
              className="rounded-3xl p-5 sm:p-7 space-y-6"
              style={{ background: 'rgba(255,255,255,0.97)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
            >
              {/* 1. La partie concernée */}
              <section>
                <p className="text-[11px] font-black uppercase tracking-wider text-[#002d87] mb-1">
                  1. Votre retour concerne
                </p>
                <p className="text-xs text-slate-400 mb-3">Choisissez la partie de la station dont vous voulez parler.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {FEEDBACK_PARTS.map(p => {
                    const active = part === p.id;
                    return (
                      <button
                        key={p.id} type="button" onClick={() => setPart(p.id)}
                        className="text-left rounded-2xl p-3.5 border-2 transition-all active:scale-[0.98]"
                        style={active
                          ? { borderColor: '#003087', background: '#eef3fc', boxShadow: '0 6px 18px rgba(0,48,135,0.15)' }
                          : { borderColor: '#e2e8f0', background: '#fff' }}
                        aria-pressed={active}
                      >
                        <span className="text-2xl leading-none">{p.emoji}</span>
                        <span className={`block font-black text-sm mt-2 ${active ? 'text-[#002d87]' : 'text-slate-700'}`}>
                          {p.label}
                        </span>
                        <span className="block text-[11px] text-slate-400 mt-0.5 leading-snug">{p.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 2. Le message — la seule chose vraiment demandée. */}
              <section>
                <p className="text-[11px] font-black uppercase tracking-wider text-[#002d87] mb-1">
                  2. Votre message <span className="text-red-500">*</span>
                </p>
                <p className="text-xs text-slate-400 mb-2">
                  Dites-nous ce qui s'est bien passé, ou ce qui devrait être amélioré.
                </p>
                <textarea
                  value={message} onChange={e => setMessage(e.target.value)} rows={5} maxLength={4000}
                  className="input-field" placeholder="Décrivez votre expérience…" />
                <p className="text-[11px] text-slate-400 mt-1 text-right tabular-nums">{message.length} / 4000</p>
              </section>

              {/* 3. Qui êtes-vous — entièrement facultatif : on peut rester anonyme. */}
              <section className="space-y-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wider text-[#002d87]">
                    3. Vos coordonnées
                    <span className="ml-1.5 text-slate-400 font-bold normal-case tracking-normal">— facultatif</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Elles servent uniquement à vous répondre. Laissez-les vides pour envoyer votre avis anonymement.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PublicField icon={User} label="Nom complet" hint="Facultatif">
                    <input value={fullName} onChange={e => setFullName(e.target.value)}
                      className="input-field" placeholder="Votre nom et prénom" maxLength={120} autoComplete="name" />
                  </PublicField>
                  <PublicField icon={Phone} label="Téléphone" hint="Facultatif">
                    <input value={phone} onChange={e => setPhone(e.target.value)} type="tel"
                      className="input-field" placeholder="0X XX XX XX XX" maxLength={40} autoComplete="tel" />
                  </PublicField>
                </div>
                <PublicField icon={Mail} label="Adresse e-mail" hint="Facultatif">
                  <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                    className="input-field" placeholder="vous@exemple.com" maxLength={160} autoComplete="email" />
                </PublicField>
                <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                  Sans téléphone ni e-mail, votre message sera bien lu — mais nous ne pourrons pas vous répondre.
                </p>
              </section>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600 font-semibold">{error}</p>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="submit" disabled={!canSend || sending}
                  className="w-full py-3.5 rounded-2xl font-black text-sm uppercase tracking-wider text-[#001f5c] flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: GOLD, boxShadow: '0 8px 24px rgba(255,184,0,0.35)' }}
                >
                  {sending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Envoi en cours…</>
                    : <><Send className="w-4 h-4" /> Envoyer mon avis</>}
                </button>
                {!canSend && !sending && (
                  <p className="text-[11px] text-slate-400 text-center">
                    {!part
                      ? 'Choisissez d\'abord la partie de la station concernée.'
                      : 'Écrivez votre message — vos coordonnées, elles, restent facultatives.'}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Vos coordonnées restent à la station et ne sont jamais publiées.
                </p>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        <p className="text-center text-[11px] text-white/35 mt-8">
          {station.name || 'Station de service'} — altech station
        </p>
      </div>
    </div>
  );
}

// ─── Champ de la page publique ────────────────────────────────────────────────
function PublicField({
  icon: Icon, label, required, hint, children,
}: {
  icon: React.ElementType; label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label-field flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="text-slate-300 font-semibold normal-case tracking-normal">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Écran de remerciement ────────────────────────────────────────────────────
/**
 * Ce que le client doit comprendre en sortant : son message est ARRIVÉ. C'est la
 * seule confirmation qu'il aura — il n'a pas de compte pour venir vérifier plus
 * tard. On ne lui promet un rappel QUE s'il a laissé de quoi le joindre :
 * promettre une réponse à un client anonyme, c'est promettre dans le vide.
 */
function ThankYou({ onAgain, contactLeft }: { onAgain: () => void; contactLeft: boolean; key?: React.Key }) {
  return (
    <motion.div
      key="thanks"
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-3xl p-8 sm:p-12 text-center"
      style={{ background: 'rgba(255,255,255,0.97)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
    >
      <motion.div
        initial={{ scale: 0.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.08, type: 'spring', stiffness: 180, damping: 14 }}
        className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center mb-6"
        style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 10px 30px rgba(16,185,129,0.35)' }}
      >
        <CheckCircle2 className="w-10 h-10 text-white" />
      </motion.div>

      <h2 className="text-2xl font-black text-[#002d87]">Merci pour votre retour !</h2>
      <p className="text-slate-500 mt-3 max-w-md mx-auto leading-relaxed">
        {contactLeft
          ? <>Votre message a bien été transmis à l'équipe concernée. Nous vous
              contacterons très prochainement grâce aux coordonnées que vous nous avez laissées.</>
          : <>Votre message a bien été transmis à l'équipe concernée. Vous l'avez
              envoyé anonymement : il sera lu, mais nous ne pourrons pas vous répondre.</>}
      </p>

      <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-4 flex items-center justify-center gap-2.5">
        <Clock className="w-4 h-4 text-[#003087] shrink-0" />
        <p className="text-sm font-semibold text-slate-600">
          {contactLeft
            ? 'Un responsable vous répondra sous peu.'
            : 'Un responsable en prendra connaissance sous peu.'}
        </p>
      </div>

      <button
        onClick={onAgain}
        className="mt-6 inline-flex items-center gap-2 text-sm font-black text-[#003087] hover:text-[#001f5c] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Déposer un autre avis
      </button>

      <p className="text-[11px] text-slate-400 mt-6 flex items-center justify-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" />
        Vous pouvez fermer cette page en toute tranquillité.
      </p>
    </motion.div>
  );
}
