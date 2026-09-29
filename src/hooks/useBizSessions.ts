/**
 * ─── useBizSessions — la session de travail de L'EMPLOYÉ CONNECTÉ ──────────────
 *
 * Une session appartient à un seul employé. Ce hook est le seul endroit qui
 * décide « quelle session est la mienne » :
 *
 *   • l'employé d'une partie (module_worker) ne voit QUE sa session ; celle d'un
 *     collègue restée ouverte ne le concerne pas et ne le bloque pas,
 *   • il ouvre sa session à SON nom (aucun choix d'employé) et la clôture
 *     lui-même,
 *   • l'administrateur garde la supervision : il voit toutes les sessions
 *     ouvertes et peut clôturer celle qu'un employé a oubliée.
 *
 * L'écriture passe par la table `biz_sessions` (une ligne par session) : deux
 * caissiers travaillent en parallèle sans jamais s'écraser, et les règles RLS
 * refusent côté serveur toute écriture sur la session d'autrui.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useMemo } from 'react';
import { newId } from '@/src/lib/utils';
import { BizSession, ModuleKey } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import {
  SessionIdentity, canCloseSession, findMyOpenSession, isMySession,
  otherOpenSessions, saveBizSession,
} from '@/src/lib/bizSessions';

export interface OpenSessionInput {
  /** Employé propriétaire : l'employé connecté, ou celui choisi par l'admin. */
  workerId?: string;
  workerName: string;
  openingCash: number;
  notes?: string;
}

export interface CloseSessionInput {
  closingCash: number;
  theoretical: number;
  credit: number;
  decalage: number;
  notes?: string;
}

/** Next `S-0000` reference — computed from the highest one already used. */
function nextRef(sessions: BizSession[]): string {
  const max = sessions.reduce((m, s) => {
    const n = Number(String(s.ref || '').replace(/^S-/, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `S-${String(max + 1).padStart(4, '0')}`;
}

export function useBizSessions(moduleKey: ModuleKey) {
  const biz = useBiz(moduleKey);
  const { currentUserRole, currentUserId, currentUserName, currentModuleWorker } = useAppState();
  const sessions = biz.state.sessions;

  const isAdmin = currentUserRole === 'admin';

  /** Identity of the connected user, as a session owner. */
  const me = useMemo<SessionIdentity>(() => ({
    id: currentModuleWorker?.id || currentUserId,
    name: currentModuleWorker?.name || currentUserName,
    isAdmin,
  }), [currentModuleWorker, currentUserId, currentUserName, isAdmin]);

  /** My open session — never a colleague's. */
  const mySession = useMemo(() => findMyOpenSession(sessions, me), [sessions, me]);

  /** Colleagues currently holding an open drawer (supervision / information). */
  const otherOpen = useMemo(() => otherOpenSessions(sessions, me), [sessions, me]);

  /**
   * Sessions the connected user is allowed to READ in the history: everything
   * for the admin, only their own for an employee.
   */
  const visibleSessions = useMemo(
    () => (isAdmin ? sessions : sessions.filter(s => isMySession(s, me))),
    [sessions, me, isAdmin]);

  const open = useCallback(async (input: OpenSessionInput): Promise<{ ok: boolean; error?: string }> => {
    const workerName = input.workerName.trim();
    if (!workerName) return { ok: false, error: "Indiquez le nom de l'employé" };
    if (!me.id) return { ok: false, error: 'Profil en cours de chargement — réessayez dans un instant.' };

    // Un employé ne peut ouvrir qu'UNE session à la fois — la sienne.
    const already = sessions.find(s =>
      s.status === 'open' &&
      ((input.workerId && s.workerId === input.workerId) || isMySession(s, me)));
    if (already) {
      return {
        ok: false,
        error: `Une session est déjà ouverte pour ${already.workerName} — clôturez-la avant d'en ouvrir une autre.`,
      };
    }

    const session: BizSession = {
      id: newId(),
      ref: nextRef(sessions),
      workerId: input.workerId || (isAdmin ? undefined : me.id),
      workerName,
      openingCash: input.openingCash || 0,
      openedAt: new Date().toISOString(),
      status: 'open',
      notes: input.notes?.trim() || undefined,
      openedById: me.id,
      openedByName: me.name,
    };

    biz.add('sessions', session);
    const res = await saveBizSession(moduleKey, session);
    if (!res.ok) {
      biz.remove('sessions', session.id);   // le serveur a refusé — rien de local
      return res;
    }
    return { ok: true };
  }, [biz, moduleKey, sessions, me, isAdmin]);

  const close = useCallback(async (
    session: BizSession, input: CloseSessionInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!canCloseSession(session, me)) {
      return { ok: false, error: `Cette session appartient à ${session.workerName} — seul cet employé peut la clôturer.` };
    }

    const closed: BizSession = {
      ...session,
      status: 'closed',
      closedAt: new Date().toISOString(),
      closingCash: input.closingCash,
      theoretical: input.theoretical,
      credit: input.credit,
      decalage: input.decalage,
      notes: input.notes?.trim() || undefined,
      closedById: me.id,
      closedByName: me.name,
    };

    biz.update('sessions', closed);
    const res = await saveBizSession(moduleKey, closed);
    if (!res.ok) {
      biz.update('sessions', session);      // refus serveur — on remet l'état d'avant
      return res;
    }
    return { ok: true };
  }, [biz, moduleKey, me]);

  const canClose = useCallback((s: BizSession) => canCloseSession(s, me), [me]);
  const owns = useCallback((s: BizSession) => isMySession(s, me), [me]);

  return { sessions, visibleSessions, mySession, otherOpen, me, isAdmin, open, close, canClose, owns };
}
