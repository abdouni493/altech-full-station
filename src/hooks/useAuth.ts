import { useState, useEffect, useRef } from 'react';
import { supabase, signOut, readPersistedSession } from '../lib/supabase';

// Minimal local auth types (previously from @supabase/supabase-js).
// Only the fields the app actually reads off a session are kept.
export interface User { id: string; email?: string; user_metadata?: Record<string, any> }
export interface Session { access_token: string; refresh_token?: string; user: User }

export type UserRole =
  | 'admin' | 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'
  /** Employee of a business part: Restaurant / Cafétéria / Lavage / Magasin. */
  | 'module_worker';

export interface AuthState {
  session:         Session | null;
  user:            User | null;
  userRole:        UserRole;
  userId:          string | undefined;
  isLoading:       boolean;
  isAuthenticated: boolean;
}

/**
 * getSession() renews the token first, so it needs room on a slow link.
 *
 * Ces budgets ont été RACCOURCIS : à 12 s + 10 s, une station sur un lien lent
 * restait 25 s sur le splash. Personne n'attend 25 s — l'utilisateur recharge au
 * bout de dix secondes, ce qui REMET LES DEUX COMPTEURS À ZÉRO, et l'application
 * paraît bloquée pour toujours alors qu'elle n'a jamais eu le droit de finir.
 * Le total tient maintenant sous quinze secondes, et l'écran de chargement dit
 * ce qu'il attend au lieu de tourner en silence.
 */
const SESSION_FETCH_TIMEOUT_MS = 8_000;
/**
 * A role lookup that never answers must not hold the whole app on the splash
 * screen. `fetchRole` walks up to six sequential PostgREST calls, and each one
 * first awaits supabase-js's token refresh — on a rate-limited or half-open
 * connection that chain stays pending for minutes. Bound it, release the UI
 * with the least-privileged role, and let the lookup upgrade the role when it
 * finally lands.
 */
const ROLE_LOOKUP_TIMEOUT_MS = 6_000;
/** Last-resort backstop, sitting behind both bounded steps above. */
const SAFETY_TIMEOUT_MS = SESSION_FETCH_TIMEOUT_MS + ROLE_LOOKUP_TIMEOUT_MS + 3_000;

/** Ce que l'application attend — affiché sur l'écran de chargement. */
export type AuthPhase = 'session' | 'role' | null;

// ─── Cache du rôle résolu ───────────────────────────────────────────────────────
/**
 * Le rôle est mémorisé PAR UTILISATEUR après chaque résolution réussie. Au
 * démarrage suivant, l'application s'ouvre immédiatement avec ce rôle — zéro
 * requête sur le chemin critique — pendant que la vérification serveur tourne
 * en arrière-plan et corrige le rôle si besoin.
 *
 * C'est ce qui a manqué pendant l'incident du 2026-08-10 : la base saturée ne
 * répondait pas, la recherche du rôle expirait, et des utilisateurs pourtant
 * déjà connus de ce poste étaient rétrogradés « pompiste » à chaque
 * rechargement. Le cache n'est qu'un confort d'affichage : les données restent
 * protégées par RLS côté serveur quel que soit le rôle affiché.
 */
const ROLE_CACHE_KEY = 'stationpro.role';

const VALID_ROLES: UserRole[] = ['admin', 'pompiste', 'chef_brigade', 'gerant', 'magasin', 'module_worker'];

function readCachedRole(uid: string): UserRole | null {
  try {
    const raw = globalThis.localStorage?.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.uid !== uid) return null;
    return VALID_ROLES.includes(parsed?.role) ? (parsed.role as UserRole) : null;
  } catch {
    return null;
  }
}

function writeCachedRole(uid: string, role: UserRole) {
  try {
    globalThis.localStorage?.setItem(ROLE_CACHE_KEY, JSON.stringify({ uid, role, at: new Date().toISOString() }));
  } catch { /* stockage plein ou indisponible — le cache est un confort */ }
}

function clearCachedRole() {
  try { globalThis.localStorage?.removeItem(ROLE_CACHE_KEY); } catch { /* idem */ }
}

/** Rejects with `<label> timeout` if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Optimized auth hook for fast page refreshes.
 * - Uses localStorage cache for instant load
 * - Fetches profile in background without blocking UI
 * - Skips unnecessary delays on page refresh
 *
 * Optimizations (2025-05-24):
 *  1. Check localStorage for cached session first (instant)
 *  2. Load UI immediately, fetch profile in background
 *  3. Parallel profile fetching instead of sequential waits
 *  4. Aggressive timeout (3s) to avoid stuck loading screens
 *  5. Graceful profile fetch failure (uses default role)
 */
export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({
    session:         null,
    user:            null,
    userRole:        'admin',
    userId:          undefined,
    isLoading:       true,
    isAuthenticated: false,
  });

  /** Étape en cours, pour que le splash puisse dire ce qu'il attend. */
  const [phase, setPhase] = useState<AuthPhase>('session');

  // Prevent state updates after the component unmounts
  const mountedRef = useRef(true);
  const profileFetchRef = useRef<Promise<void> | null>(null);
  // True once fetchRole() has answered — the safety backstop below must not
  // release the UI with the default 'admin' role while it is still pending.
  const roleResolved = useRef(false);
  // Always-current snapshot of `auth`, so the onAuthStateChange listener
  // (registered once, see the empty dependency array below) can read the
  // latest auth state without re-subscribing on every change.
  const authRef = useRef<AuthState>(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  // Override auth state (called from Login page after manual login flow)
  const setManualAuth = (role: UserRole, userId?: string) => {
    setPhase(null);
    roleResolved.current = true;
    if (userId) writeCachedRole(userId, role);
    setAuth(prev => ({
      ...prev,
      userRole:        role,
      userId,
      isAuthenticated: true,
      isLoading:       false,
    }));
  };

  /**
   * Sortie de secours de l'écran de chargement, déclenchée par l'utilisateur.
   *
   * Aucun scénario ne doit enfermer quelqu'un devant un rouet : si la recherche
   * du rôle traîne, on entre avec le rôle le MOINS privilégié — jamais « admin »,
   * la vérification continue en arrière-plan et corrigera le rôle en arrivant.
   * Sans session connue, on va à l'écran de connexion.
   */
  const releaseNow = () => {
    setPhase(null);
    setAuth(prev => (prev.isLoading ? {
      ...prev,
      userRole: prev.isAuthenticated && !roleResolved.current ? 'pompiste' : prev.userRole,
      isLoading: false,
    } : prev));
  };

  const logout = async () => {
    await signOut();
    clearCachedRole();
    localStorage.removeItem('supabase.auth.token');
    setAuth({
      session:         null,
      user:            null,
      userRole:        'admin',
      userId:          undefined,
      isLoading:       false,
      isAuthenticated: false,
    });
  };

  // Resolve role via RPC — works for both admin_profiles AND all worker tables.
  // Falls back to 'admin' on error so the app never gets stuck in an unauthenticated state
  // when the RPC doesn't exist yet (pre-migration environments).
  const fetchRole = async (_userId: string): Promise<UserRole> => {
    try {
      const { data, error } = await supabase.rpc('get_my_role');
      if (error) {
        console.warn('[useAuth] get_my_role error:', error.message);
        // Fallback: check admin_profiles directly
        const { data: profile } = await supabase
          .from('admin_profiles')
          .select('role')
          .eq('id', _userId)
          .maybeSingle();
        if (profile?.role) return profile.role as UserRole;

        // If not an admin profile, try worker tables by auth_user_id
        try {
          const pimp = await supabase.from('pompistes').select('id').eq('auth_user_id', _userId).maybeSingle();
          if (pimp.data) return 'pompiste';
        } catch (e) {}
        try {
          const chef = await supabase.from('brigade_chefs').select('id').eq('auth_user_id', _userId).maybeSingle();
          if (chef.data) return 'chef_brigade';
        } catch (e) {}
        try {
          const ger = await supabase.from('gerants').select('id').eq('auth_user_id', _userId).maybeSingle();
          if (ger.data) return 'gerant';
        } catch (e) {}
        try {
          const mag = await supabase.from('magasin_workers').select('id').eq('auth_user_id', _userId).maybeSingle();
          if (mag.data) return 'magasin';
        } catch (e) {}
        try {
          const mod = await supabase.from('module_workers').select('id').eq('auth_user_id', _userId).maybeSingle();
          if (mod.data) return 'module_worker';
        } catch (e) {}

        // As a last resort, do NOT default to admin — treat as no-access worker
        return 'pompiste';
      }
      // RPC succeeded — verify 'admin' claims; fall through on null or unverified admin
      let resolved = data as UserRole | null;

      if (resolved === 'admin') {
        // Confirm the user is really in admin_profiles before trusting the claim
        const { data: ap } = await supabase
          .from('admin_profiles').select('id').eq('id', _userId).maybeSingle();
        if (ap) return 'admin'; // confirmed
        resolved = null; // not actually an admin — fall through to worker lookup
      } else if (resolved) {
        return resolved; // pompiste / chef_brigade / gerant / magasin — trust it
      }

      // RPC returned null or unverified 'admin' — query tables directly
      const { data: profile } = await supabase
        .from('admin_profiles').select('role').eq('id', _userId).maybeSingle();
      if (profile?.role) return profile.role as UserRole;

      const pimp = await supabase.from('pompistes').select('id').eq('auth_user_id', _userId).maybeSingle();
      if (pimp.data) return 'pompiste';
      const chef = await supabase.from('brigade_chefs').select('id').eq('auth_user_id', _userId).maybeSingle();
      if (chef.data) return 'chef_brigade';
      const ger = await supabase.from('gerants').select('id').eq('auth_user_id', _userId).maybeSingle();
      if (ger.data) return 'gerant';
      const mag = await supabase.from('magasin_workers').select('id').eq('auth_user_id', _userId).maybeSingle();
      if (mag.data) return 'magasin';
      const mod = await supabase.from('module_workers').select('id').eq('auth_user_id', _userId).maybeSingle();
      if (mod.data) return 'module_worker';

      return 'pompiste'; // unknown — deny admin access
    } catch (err) {
      console.error('[useAuth] fetchRole failed:', err);
      // If RPC fails entirely, try to infer role from worker tables
      try {
        const pimp = await supabase.from('pompistes').select('id').eq('auth_user_id', _userId).maybeSingle();
        if (pimp.data) return 'pompiste';
        const chef = await supabase.from('brigade_chefs').select('id').eq('auth_user_id', _userId).maybeSingle();
        if (chef.data) return 'chef_brigade';
        const ger = await supabase.from('gerants').select('id').eq('auth_user_id', _userId).maybeSingle();
        if (ger.data) return 'gerant';
        const mag = await supabase.from('magasin_workers').select('id').eq('auth_user_id', _userId).maybeSingle();
        if (mag.data) return 'magasin';
        const mod = await supabase.from('module_workers').select('id').eq('auth_user_id', _userId).maybeSingle();
        if (mod.data) return 'module_worker';
      } catch (e) {
        console.error('[useAuth] fallback worker lookup failed:', e);
      }
      return 'pompiste';
    }
  };

  /**
   * Resolve the signed-in user's role, then release the splash screen.
   *
   * The release is guaranteed. If the lookup has not answered within
   * ROLE_LOOKUP_TIMEOUT_MS the UI is unblocked with the least privileged role —
   * never 'admin' — and the same in-flight lookup keeps running, upgrading the
   * role as soon as it lands. Previously `isLoading` was only ever cleared from
   * the lookup's own .then/.catch, so a request that never settled left the app
   * on <AppLoader /> for ever.
   */
  const resolveRole = (uid: string) => {
    const lookup = fetchRole(uid);
    if (mountedRef.current) setPhase('role');

    lookup.then(role => {
      roleResolved.current = true;
      writeCachedRole(uid, role);
      if (mountedRef.current) { setPhase(null); setAuth(prev => ({ ...prev, userRole: role, isLoading: false })); }
    }).catch(() => {
      roleResolved.current = true;
      if (mountedRef.current) { setPhase(null); setAuth(prev => ({ ...prev, isLoading: false })); }
    });

    profileFetchRef.current = withTimeout(lookup, ROLE_LOOKUP_TIMEOUT_MS, 'role lookup')
      .then(() => undefined)
      .catch((err: Error) => {
        if (roleResolved.current) return; // the lookup answered in time
        console.warn('[useAuth]', err.message, '— releasing the UI with least privilege');
        if (mountedRef.current) {
          setPhase(null);
          setAuth(prev => (prev.isLoading ? { ...prev, userRole: 'pompiste', isLoading: false } : prev));
        }
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    let safetyTimeout: NodeJS.Timeout | null = null;

    async function initAuth() {
      try {
        // Step 1: Try to get session from Supabase. The timeout is generous
        // (12 s) because on a slow link getSession() first renews the token;
        // cutting it short is what used to send signed-in users to the login page.
        const getSessionPromise = supabase.auth.getSession();
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Session fetch timeout')), SESSION_FETCH_TIMEOUT_MS);
        });

        let session: Session | null = null;
        try {
          const { data: { session: sess }, error: sessionError } = await Promise.race([
            getSessionPromise,
            timeoutPromise,
          ]);

          if (sessionError) {
            console.error('[useAuth] getSession error:', sessionError.message);
          }
          session = sess ?? readPersistedSession();
        } catch (err) {
          // Timed out or the network is down: trust the stored session rather
          // than logging the user out. supabase-js keeps renewing it in the
          // background and emits SIGNED_OUT if it is genuinely dead.
          session = readPersistedSession();
          console.warn(
            '[useAuth] Session fetch timed out or failed:', err,
            session ? '— using the stored session' : '— no stored session',
          );
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }

        if (!mountedRef.current) return;

        // Step 2: If we have a session, immediately show authenticated state
        // and fetch profile in background
        if (session?.user) {
          // Rôle déjà connu de ce poste : l'application s'ouvre TOUT DE SUITE
          // avec lui — aucune requête sur le chemin critique. La vérification
          // en arrière-plan (resolveRole) corrigera le rôle s'il a changé.
          // Sans cache (premier passage), le chargeur reste affiché jusqu'à la
          // réponse — jamais de barre latérale admin montrée à un employé.
          const cached = readCachedRole(session.user.id);
          setAuth({
            session,
            user:            session.user,
            userRole:        cached ?? 'admin',
            userId:          session.user.id,
            isLoading:       !cached,
            isAuthenticated: true,
          });
          if (cached) setPhase(null);

          // Step 3: Fetch role in background, then release loader
          resolveRole(session.user.id);
        } else {
          // No session — go to login immediately
          setPhase(null);
          setAuth({
            session:         null,
            user:            null,
            userRole:        'admin',
            userId:          undefined,
            isLoading:       false,
            isAuthenticated: false,
          });
        }
      } catch (err) {
        console.error('[useAuth] Unexpected auth error:', err);
        if (mountedRef.current) {
          setPhase(null);
          setAuth(prev => ({ ...prev, isLoading: false }));
        }
      }
    }

    // Safety backstop: never leave the user stuck on the spinner for ever.
    //
    // It fires AFTER initAuth's session budget and the role lookup's, so by then
    // the session state has already been decided (live session, stored session,
    // or none) and clearing the spinner cannot dump a signed-in user on the
    // login page any more. If only the role lookup is still pending we release
    // the UI with the least privileged role — never 'admin' — and let fetchRole
    // correct it.
    //
    // It is deliberately NOT cancelled when initAuth returns: initAuth returns
    // as soon as the role lookup has been *started*, and cancelling there is
    // what used to leave a lookup that never settles holding the splash screen
    // with nothing left alive to release it.
    safetyTimeout = setTimeout(() => {
      if (!mountedRef.current || !authRef.current.isLoading) return;
      console.warn('[useAuth] Safety timeout — forcing loading state clear');
      setPhase(null);
      setAuth(prev => (prev.isLoading ? {
        ...prev,
        userRole:  prev.isAuthenticated && !roleResolved.current ? 'pompiste' : prev.userRole,
        isLoading: false,
      } : prev));
    }, SAFETY_TIMEOUT_MS);

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mountedRef.current) return;

        if (event === 'SIGNED_IN' && session?.user) {
          // IMPORTANT: Supabase's client (@supabase/auth-js) re-emits a
          // 'SIGNED_IN' event every time the browser tab/app regains
          // visibility/focus (switching apps, unlocking the phone,
          // switching browser tabs, etc.) — even though the user never
          // logged out and nothing actually changed. This is documented
          // internal behaviour of the client's tab-visibility recovery
          // logic and cannot be turned off via configuration.
          //
          // Previously we treated every 'SIGNED_IN' event the same as a
          // brand-new login: isLoading was flipped to true (which swaps
          // the entire app for <AppLoader />, see App.tsx) and the user's
          // role was re-fetched from the database. That is exactly what
          // produced the "app auto-refreshes every time I leave and come
          // back" bug.
          //
          // Fix: if we're already authenticated as this same user, this is
          // just Supabase confirming the existing session is still valid —
          // quietly update the session/user reference and do nothing else
          // (no loading screen, no re-fetch). Only run the full "new login"
          // flow when the user actually changes (or we weren't
          // authenticated yet).
          const alreadySignedInAsThisUser =
            authRef.current.isAuthenticated && authRef.current.userId === session.user.id;

          if (alreadySignedInAsThisUser) {
            // Same token → return the previous state object unchanged so React
            // bails out of the update and nothing re-renders at all.
            setAuth(prev =>
              prev.session?.access_token === session.access_token
                ? prev
                : { ...prev, session, user: session.user }
            );
            return;
          }

          // Rôle en cache (utilisateur déjà vu sur ce poste) : ouverture
          // immédiate ; sinon le chargeur reste jusqu'à la réponse du serveur.
          const cached = readCachedRole(session.user.id);
          setAuth({
            session,
            user:            session.user,
            userRole:        cached ?? 'admin',
            userId:          session.user.id,
            isLoading:       !cached,
            isAuthenticated: true,
          });
          if (cached) setPhase(null);

          resolveRole(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          if (mountedRef.current) {
            setPhase(null);
            setAuth({
              session:         null,
              user:            null,
              userRole:        'admin',
              userId:          undefined,
              isLoading:       false,
              isAuthenticated: false,
            });
          }
        } else if (event === 'TOKEN_REFRESHED') {
          // Do nothing on token refresh. This event is emitted whenever
          // Supabase silently rotates or revalidates the JWT, including on
          // tab/app focus, and it does not mean the user signed in again.
          return;
        }
      }
    );

    return () => {
      mountedRef.current = false;
      if (safetyTimeout) clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  return { ...auth, phase, setManualAuth, logout, releaseNow };
}
