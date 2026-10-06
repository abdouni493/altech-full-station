/**
 * ─── Store des retours clients ─────────────────────────────────────────────────
 *
 * Les avis déposés sur la page publique `/client` vivent dans leur propre table
 * (`client_feedbacks`), pas dans le blob des parties commerciales : un visiteur
 * sans compte doit pouvoir écrire, et personne d'autre que le personnel connecté
 * ne doit pouvoir lire.
 *
 * Ce contexte est le SEUL endroit qui parle à cette table côté application. Il
 * sert deux publics à la fois :
 *   • les écrans « Retours clients » de chaque partie (liste, détail, suppression) ;
 *   • la barre latérale, qui compte les avis NON LUS pour allumer sa pastille
 *     rouge — d'où un unique chargement partagé plutôt qu'un par écran.
 *
 * Le temps réel fait apparaître un avis sans rechargement ; le retour sur
 * l'onglet sert de filet quand le websocket est bloqué par le réseau.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeTable } from '../lib/supabase';
import {
  ClientFeedback, FeedbackPart, deleteClientFeedback, loadClientFeedbacks,
  markPartFeedbacksRead, setFeedbackStatus,
} from '../lib/feedbacks';

export interface FeedbackContextValue {
  feedbacks: ClientFeedback[];
  /** Nombre d'avis non lus, par partie — ce qui allume la pastille du menu. */
  unreadByPart: Record<FeedbackPart, number>;
  loading: boolean;
  /** La migration n'a pas encore été passée sur cette base. */
  tableMissing: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string, by?: string) => Promise<{ ok: boolean; error?: string }>;
  markUnread: (id: string) => Promise<{ ok: boolean; error?: string }>;
  markAllRead: (part: FeedbackPart, by?: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

const EMPTY_COUNTS: Record<FeedbackPart, number> = { fuel: 0, restaurant: 0, cafeteria: 0, lavage: 0, magasin2: 0 };

const Ctx = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [feedbacks, setFeedbacks] = useState<ClientFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  /** Un chargement à la fois : le temps réel peut en déclencher plusieurs d'affilée. */
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      const rows = await loadClientFeedbacks();
      if (rows === null) {
        // Table absente ou lecture refusée : on garde ce qu'on avait plutôt que
        // de vider l'écran sur un incident réseau passager.
        setTableMissing(true);
      } else {
        setTableMissing(false);
        setFeedbacks(rows);
      }
      setLoading(false);
    })();
    inFlight.current = run;
    try { await run; } finally { inFlight.current = null; }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const unsub = subscribeTable('client_feedbacks', () => { void refresh(); });
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const unreadByPart = useMemo(() => {
    const out = { ...EMPTY_COUNTS };
    for (const f of feedbacks) if (f.status === 'unread') out[f.part] = (out[f.part] || 0) + 1;
    return out;
  }, [feedbacks]);

  // ── Écritures : optimistes, puis remises d'aplomb si le serveur refuse ──────
  const markRead = useCallback(async (id: string, by?: string) => {
    const at = new Date().toISOString();
    setFeedbacks(list => list.map(f => (f.id === id ? { ...f, status: 'read', readAt: at, readBy: by } : f)));
    const res = await setFeedbackStatus(id, 'read', by);
    if (!res.ok) await refresh();
    return res;
  }, [refresh]);

  const markUnread = useCallback(async (id: string) => {
    setFeedbacks(list => list.map(f => (f.id === id
      ? { ...f, status: 'unread', readAt: undefined, readBy: undefined } : f)));
    const res = await setFeedbackStatus(id, 'unread');
    if (!res.ok) await refresh();
    return res;
  }, [refresh]);

  const markAllRead = useCallback(async (part: FeedbackPart, by?: string) => {
    const at = new Date().toISOString();
    setFeedbacks(list => list.map(f => (f.part === part && f.status === 'unread'
      ? { ...f, status: 'read', readAt: at, readBy: by } : f)));
    const res = await markPartFeedbacksRead(part, by);
    if (!res.ok) await refresh();
    return res;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const previous = feedbacks;
    setFeedbacks(list => list.filter(f => f.id !== id));
    const res = await deleteClientFeedback(id);
    if (!res.ok) setFeedbacks(previous);   // le serveur a refusé — rien n'est perdu
    return res;
  }, [feedbacks]);

  const value = useMemo<FeedbackContextValue>(() => ({
    feedbacks, unreadByPart, loading, tableMissing,
    refresh, markRead, markUnread, markAllRead, remove,
  }), [feedbacks, unreadByPart, loading, tableMissing, refresh, markRead, markUnread, markAllRead, remove]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Accès aux retours clients. Rendu inerte hors du provider (la page publique
 * `/client` et l'écran de connexion vivent en dehors) plutôt que de lever : la
 * barre latérale s'en sert et ne doit jamais faire tomber l'application.
 */
const INERT: FeedbackContextValue = {
  feedbacks: [], unreadByPart: EMPTY_COUNTS, loading: false, tableMissing: false,
  refresh: async () => {},
  markRead: async () => ({ ok: false, error: 'Indisponible' }),
  markUnread: async () => ({ ok: false, error: 'Indisponible' }),
  markAllRead: async () => ({ ok: false, error: 'Indisponible' }),
  remove: async () => ({ ok: false, error: 'Indisponible' }),
};

export function useFeedbacks(): FeedbackContextValue {
  return useContext(Ctx) ?? INERT;
}

/** Les avis d'UNE partie, du plus récent au plus ancien. */
export function usePartFeedbacks(part: FeedbackPart): ClientFeedback[] {
  const { feedbacks } = useFeedbacks();
  return useMemo(() => feedbacks.filter(f => f.part === part), [feedbacks, part]);
}
