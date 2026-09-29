/**
 * ─── LE RATTRAPAGE DE LA FILE D'ATTENTE ────────────────────────────────────────
 *
 *  QUI DÉCLENCHE LE VIDAGE, ET POURQUOI C'EST LE NAVIGATEUR
 *  L'application est hébergée en serverless : rien ne tourne entre deux
 *  requêtes. Aucune tâche de fond ne peut donc reprendre les messages restés en
 *  attente. C'est l'application OUVERTE DANS LE NAVIGATEUR qui s'en charge.
 *
 *  Ce n'est pas un pis-aller : le poste de la station a l'application ouverte
 *  toute la journée, et c'est LE MÊME POSTE qui héberge la passerelle. Quand il
 *  est allumé — le seul moment où un envoi peut aboutir — le rattrapage part.
 *
 *  LES CINQ RÈGLES QUI ÉVITENT QU'IL DEVIENNE NUISIBLE
 *    1. il SONDE une route qui COMPTE des lignes et n'appelle jamais la
 *       passerelle : un écran ouvert des heures ne doit pas la réveiller en
 *       boucle ;
 *    2. il n'appelle le vidage QUE s'il reste quelque chose ;
 *    3. un verrou empêche deux vidages de se chevaucher — un vidage est lent, le
 *       sondage suivant peut tomber pendant ;
 *    4. il s'ARRÊTE DÉFINITIVEMENT sur 401/403 plutôt que de boucler sur un
 *       refus ;
 *    5. son premier passage est DIFFÉRÉ de quelques secondes : ce composant est
 *       remonté à chaque navigation, et un premier appel immédiat ferait un
 *       appel par changement de page.
 *
 *  Il ne rend RIEN tant que la file est vide : un encart permanent finit par ne
 *  plus être lu.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useRef, useState } from 'react';
import { Inbox, Loader2, Send } from 'lucide-react';
import { flushOutbox, outboxState } from '../lib/whatsapp';

/** Intervalle entre deux comptages. Un comptage est bon marché ; pas gratuit. */
const POLL_MS = 90_000;
/** Retard du tout premier passage après le montage du composant. */
const FIRST_DELAY_MS = 8_000;

export default function WhatsAppOutboxRunner() {
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const stopped = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: any = null;

    const tick = async () => {
      if (stopped.current || busy.current || !alive.current) return;
      // Onglet en arrière-plan : rien ne presse, et le poste peut être en train
      // de faire autre chose.
      if (typeof document !== 'undefined' && document.hidden) return;
      busy.current = true;
      try {
        const state = await outboxState();
        if (!alive.current) return;
        setPending(state.pending);
        if (state.pending > 0 && state.storageConfigured) {
          setSending(true);
          const res = await flushOutbox();
          if (alive.current) setPending(res.pending);
        }
      } catch (err: any) {
        const msg = String(err?.message || err);
        // Un refus ne se répare pas en réessayant : on cesse pour cette session.
        if (/\b401\b|\b403\b|non autoris|Unauthoriz|Forbidden/i.test(msg)) stopped.current = true;
        // Les routes non déployées : inutile de boucler dessus non plus.
        if (/n'est pas servie/i.test(msg)) stopped.current = true;
      } finally {
        busy.current = false;
        if (alive.current) setSending(false);
      }
    };

    const first = setTimeout(() => { tick(); timer = setInterval(tick, POLL_MS); }, FIRST_DELAY_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, []);

  if (pending <= 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
      <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-50 border border-amber-200 shadow-lg">
        {sending
          ? <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin" />
          : <Inbox className="w-3.5 h-3.5 text-amber-600" />}
        <span className="text-[11px] font-black uppercase tracking-wider text-amber-800">
          {sending
            ? `Envoi des messages en attente…`
            : `${pending} message${pending > 1 ? 's' : ''} WhatsApp en attente`}
        </span>
        {!sending && <Send className="w-3 h-3 text-amber-500" />}
      </div>
    </div>
  );
}
