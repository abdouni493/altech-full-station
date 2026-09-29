/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Layout from "./components/Layout";
import { AppProvider, useAppState, useAppDispatch, UserPermissions } from "./store/AppContext";
import { ToastContainer } from "./components/Toast";
import { useAuth, type AuthPhase } from "./hooks/useAuth";
import { db, supabase, BUCKETS, getPublicUrl, getMyModuleWorker } from "./lib/supabase";
import { installAutoTranslate, sweep } from "./lib/autoTranslate";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tanks from "./pages/Tanks";
import Pumps from "./pages/Pumps";
import Pompistes from "./pages/Pompistes";
import Brigades from "./pages/Brigades";
import Suppliers from "./pages/Suppliers";
import FuelPurchases from "./pages/FuelPurchases";
import Clients from "./pages/Clients";
import DailyReport from "./pages/DailyReport";
import Expenses from "./pages/Expenses";
import Permissions from "./pages/Permissions";
import Inventory from "./pages/Inventory";
import Statistics from "./pages/Statistics";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Gerants from "./pages/Gerants";
import MagasinWorkers from "./pages/MagasinWorkers";
import MyBrigade from "./pages/MyBrigade";
import MyPayments from "./pages/MyPayments";
import MySettings from "./pages/MySettings";
import CaisseGenerale from "./pages/CaisseGenerale";
import BankAccounts from "./pages/BankAccounts";
import Feedbacks from "./pages/Feedbacks";
import ClientFeedback from "./pages/ClientFeedback";
import { FeedbackProvider } from "./store/FeedbackContext";

// ─── Business modules (Cafétéria / Lavage & Vidange) ───────────────────────
import { BizProvider } from "./store/BizContext";
import { MODULES, ModuleKey } from "./lib/bizConfig";
import ModuleStock from "./pages/modules/ModuleStock";
import ModuleInventaire from "./pages/modules/ModuleInventaire";
import ModulePurchases from "./pages/modules/ModulePurchases";
import ModuleProduction from "./pages/modules/ModuleProduction";
import ModuleComptoir from "./pages/modules/ModuleComptoir";
import ModulePOS from "./pages/modules/ModulePOS";
import ModuleSales from "./pages/modules/ModuleSales";
import ModuleClients from "./pages/modules/ModuleClients";
import ModuleMessages from "./pages/modules/ModuleMessages";
import ModuleSuppliers from "./pages/modules/ModuleSuppliers";
import ModuleWorkers from "./pages/modules/ModuleWorkers";
import ModuleExpenses from "./pages/modules/ModuleExpenses";
import ModuleCaisse from "./pages/modules/ModuleCaisse";
import ModuleReports from "./pages/modules/ModuleReports";
import ModuleReparations from "./pages/modules/ModuleReparations";
import ModuleEncaissements from "./pages/modules/ModuleEncaissements";
import ModuleFeedbacks from "./pages/modules/ModuleFeedbacks";
import GeneralReports from "./pages/GeneralReports";

// Builds the route list for one business module based on its capabilities.
// `iface` is the permission interface id (see MODULE_INTERFACES) used to gate
// the route for employees of that part.
interface ModuleRoute { path: string; iface: string; moduleKey: ModuleKey; element: React.ReactElement }

function buildModuleRoutes(key: ModuleKey): ModuleRoute[] {
  const cfg = MODULES[key];
  const b = cfg.base;
  const routes: ModuleRoute[] = [];
  const add = (sub: string, element: React.ReactElement) =>
    routes.push({ path: `${b}/${sub}`, iface: sub, moduleKey: key, element });

  if (cfg.isService) {
    add('reparations', <ModuleReparations moduleKey={key} />);
    add('encaissements', <ModuleEncaissements moduleKey={key} />);
    // Point de vente + Ventes moved here when the Magasin part was removed.
    add('pos', <ModulePOS moduleKey={key} />);
    add('sales', <ModuleSales moduleKey={key} />);
    add('stock', <ModuleStock moduleKey={key} />);
    add('inventaire', <ModuleInventaire moduleKey={key} />);
    add('purchases', <ModulePurchases moduleKey={key} />);
    add('clients', <ModuleClients moduleKey={key} />);
    // Les rappels de passage et les envois WhatsApp n'ont de sens que pour une
    // partie de service : une cafétéria ne rappelle personne pour un lavage.
    add('messages', <ModuleMessages moduleKey={key} />);
    add('suppliers', <ModuleSuppliers moduleKey={key} />);
    add('workers', <ModuleWorkers moduleKey={key} />);
    add('expenses', <ModuleExpenses moduleKey={key} />);
    add('caisse', <ModuleCaisse moduleKey={key} />);
    add('reports', <ModuleReports moduleKey={key} />);
    add('feedbacks', <ModuleFeedbacks moduleKey={key} />);
  } else {
    add('stock', <ModuleStock moduleKey={key} />);
    add('inventaire', <ModuleInventaire moduleKey={key} />);
    add('purchases', <ModulePurchases moduleKey={key} />);
    if (cfg.hasProduction) {
      add('production', <ModuleProduction moduleKey={key} />);
      add('comptoir', <ModuleComptoir moduleKey={key} />);
    }
    add('pos', <ModulePOS moduleKey={key} />);
    add('sales', <ModuleSales moduleKey={key} />);
    add('clients', <ModuleClients moduleKey={key} />);
    add('suppliers', <ModuleSuppliers moduleKey={key} />);
    add('workers', <ModuleWorkers moduleKey={key} />);
    add('expenses', <ModuleExpenses moduleKey={key} />);
    add('caisse', <ModuleCaisse moduleKey={key} />);
    add('reports', <ModuleReports moduleKey={key} />);
    add('feedbacks', <ModuleFeedbacks moduleKey={key} />);
  }
  return routes;
}

const MODULE_ROUTES = (Object.keys(MODULES) as ModuleKey[]).flatMap(buildModuleRoutes);

// ─── Route to Module Mapping ───────────────────────────────────────────────────
/**
 * Maps route paths to permission module IDs for route-level access control.
 * Checked before rendering the component to ensure user has "voir" (view) permission.
 */
const ROUTE_TO_MODULE: Record<string, string> = {
  "/brigades":         "Brigades",
  "/tanks":            "Cuves",
  "/pumps":            "Pompes",
  "/fuel-purchases":   "Achats Carburant",
  "/inventory":        "Inventaires",
  "/clients":          "Clients",
  "/suppliers":        "Fournisseurs",
  "/pompistes":        "Pompistes",
  "/gerants":          "Gérants",
  "/magasin-workers":  "Employés Magasin",
  "/roles-permissions": "Paramètres",
  "/expenses":         "Dépenses",
  "/daily-report":     "Fiche Journalière",
  "/statistics":       "Statistiques",
  "/reports":          "Rapports",
  "/caisse-generale":  "Caisse Générale",
  "/bank-accounts":    "Comptes Bancaires",
  "/feedbacks":        "Retours Clients",
};

// ─── ProtectedRoute Component ─────────────────────────────────────────────────
/**
 * Wraps a route component to check if the current user has permission to view it.
 * For admin users, all routes are allowed. For workers, checks the permission
 * module mapped to this route and requires the "voir" (view) flag.
 * 
 * If permission is denied, redirects to /dashboard with a toast notification.
 */
interface ProtectedRouteProps {
  element: React.ReactElement;
  moduleId?: string; // Optional override; otherwise auto-maps from current path
}

function ProtectedRoute({ element, moduleId }: ProtectedRouteProps): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useAppState();
  const dispatch = useAppDispatch();

  const resolvedModuleId = moduleId || ROUTE_TO_MODULE[location.pathname];

  // Admin always has access
  if (state.currentUserRole === 'admin') {
    return element;
  }

  // Still hydrating — don't redirect yet
  if (state.isLoading) {
    return <></>;
  }

  if (resolvedModuleId) {
    const perms = state.currentUserPermissions;

    // Permissions not resolved yet — wait, do not leak access
    if (!perms) return <></>;

    if (perms[resolvedModuleId]?.voir) {
      return element;
    }

    // Permission denied — redirect
    dispatch({
      type: 'ADD_TOAST',
      payload: {
        type: 'error',
        title: 'Accès refusé',
        message: `Vous n'avez pas accès au module "${resolvedModuleId}".`,
        duration: 3,
      },
    });
    navigate('/dashboard', { replace: true });
    return <Navigate to="/dashboard" replace />;
  }

  return element;
}

// ─── Admin-only route ─────────────────────────────────────────────────────────
/** Cross-activity screens (e.g. Rapports Généraux) stay reserved to admins. */
function AdminOnlyRoute({ element }: { element: React.ReactElement }): React.ReactElement {
  const { currentUserRole } = useAppState();
  if (currentUserRole === 'module_worker') return <Navigate to="/dashboard" replace />;
  return element;
}

// ─── Business-part route guard ────────────────────────────────────────────────
/**
 * Gates a Restaurant / Cafétéria / Lavage / Magasin page. Employees of a part
 * only reach an interface they were granted "voir" on, and never a page of
 * another part. Everyone else (admin) passes through.
 */
function ModuleRouteGuard({
  moduleKey, iface, element,
}: { moduleKey: string; iface: string; element: React.ReactElement }): React.ReactElement {
  const navigate = useNavigate();
  const { currentUserRole, currentModuleWorker } = useAppState();
  const dispatch = useAppDispatch();

  const allowed =
    currentUserRole !== 'module_worker' ||
    (!!currentModuleWorker &&
      currentModuleWorker.moduleKey === moduleKey &&
      !!currentModuleWorker.permissions?.[`${iface}.voir`]);

  // Session not resolved yet — hold instead of leaking or bouncing.
  const pending = currentUserRole === 'module_worker' && !currentModuleWorker;

  useEffect(() => {
    if (pending || allowed) return;
    dispatch({
      type: 'ADD_TOAST',
      payload: { type: 'error', title: 'Accès refusé', message: "Vous n'avez pas accès à cette interface.", duration: 3 },
    });
    navigate('/dashboard', { replace: true });
  }, [pending, allowed, dispatch, navigate]);

  if (pending) return <></>;
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return element;
}

// ─── Loading screen ───────────────────────────────────────────────────────────
/**
 * Écran de chargement — il ne tourne plus jamais en silence.
 *
 * Un rouet muet est indiscernable d'une application morte : au bout de quelques
 * secondes l'utilisateur recharge, ce qui REMET À ZÉRO les délais de `useAuth` et
 * l'empêche justement d'aboutir. D'où ces trois choses : dire ce qu'on attend,
 * signaler que le lien est lent, et offrir une porte de sortie manuelle plutôt
 * que de laisser le rechargement être la seule action possible.
 */
const AppLoader = ({ phase, onSkip }: { phase?: AuthPhase; onSkip?: () => void }) => {
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWaited(w => w + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const step =
    phase === 'session' ? "Vérification de la session…" :
    phase === 'role'    ? "Vérification des autorisations…" :
    "Chargement de altech station...";

  return (
    <div className="flex items-center justify-center min-h-screen px-6"
      style={{ background: "linear-gradient(135deg, #001233 0%, #003087 100%)" }}>
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)", boxShadow: "0 8px 24px rgba(255,184,0,0.4)" }}>
          <span className="text-2xl">⛽</span>
        </div>
        <div className="w-10 h-10 border-4 border-white/20 border-t-[#FFB800] rounded-full animate-spin" />
        <p className="text-white/60 font-semibold text-sm">{step}</p>

        {waited >= 4 && (
          <p className="text-white/40 text-xs max-w-xs leading-relaxed">
            La connexion au serveur est lente ({waited}s). L'application entrera toute seule —
            <span className="text-yellow-400/70"> inutile de recharger</span>, un rechargement
            fait repartir l'attente de zéro.
          </p>
        )}

        {waited >= 6 && onSkip && (
          <button
            onClick={onSkip}
            className="mt-1 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] text-blue-900 transition-all hover:scale-[1.03]"
            style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)", boxShadow: "0 4px 20px rgba(255,184,0,0.35)" }}
          >
            Entrer maintenant
          </button>
        )}
      </div>
    </div>
  );
};

// ─── DB loading overlay (shown while Supabase hydrates) ──────────────────────
const DbLoader = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
    <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-3xl shadow-2xl">
      <div className="w-12 h-12 border-4 border-blue-100 border-t-[#003087] rounded-full animate-spin" />
      <p className="text-slate-600 font-semibold text-sm">Chargement des données...</p>
      <p className="text-slate-400 text-xs">Connexion à la base de données Supabase</p>
    </div>
  </div>
);

export default function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.dir  = i18n.dir();
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  // Runtime FR→AR translation for the hard-coded French page bodies.
  useEffect(() => { installAutoTranslate(); }, []);
  // Re-sweep after each auth/render phase so newly mounted screens translate too.
  useEffect(() => { if (i18n.language === 'ar') sweep(); });

  // Le routeur est monté AVANT toute vérification de session : `/client` est la
  // page publique où un client dépose son avis, elle doit s'ouvrir sans compte
  // et sans attendre la résolution de la session. Tout le reste de
  // l'application passe par `<AuthGate>`, qui n'a pas bougé.
  return (
    <Router>
      <Routes>
        <Route path="/client" element={<ClientFeedback />} />
        <Route path="*"       element={<AuthGate />} />
      </Routes>
    </Router>
  );
}

// ─── Everything behind the login ──────────────────────────────────────────────
function AuthGate() {
  const auth = useAuth();

  // While checking session
  if (auth.isLoading) return <AppLoader phase={auth.phase} onSkip={auth.releaseNow} />;

  // The `key` ties the store's lifetime to the signed-in user. Both branches
  // below render an <AppProvider> at the same position, so without it React
  // reuses the same instance across login/logout and the previous session's
  // data stays in memory for the next person to sign in on this machine.

  // Not authenticated — show login
  if (!auth.isAuthenticated) {
    return (
      <AppProvider key="anon">
        <Login
          onLogin={(role, userId) => auth.setManualAuth(role, userId)}
        />
      </AppProvider>
    );
  }

  // Authenticated — load app with Supabase-connected state
  return (
    <AppProvider key={auth.userId ?? 'session'}>
      <BizProvider>
        {/* Les retours clients sont chargés une seule fois pour toute
            l'application : la barre latérale en tire ses alertes, les trois
            écrans « Retours clients » y lisent leur liste. */}
        <FeedbackProvider>
          <AppContent
            userRole={auth.userRole}
            userId={auth.userId}
            onLogout={auth.logout}
          />
        </FeedbackProvider>
      </BizProvider>
    </AppProvider>
  );
}

// ─── Inner app (needs AppProvider) ───────────────────────────────────────────
function AppContent({
  userRole,
  userId,
  onLogout,
}: {
  userRole: string;
  userId?: string;
  onLogout: () => void;
}) {
  const { toasts, isLoading } = useAppState();
  const dispatch = useAppDispatch();

  // Set current user in global state and load profile (name + avatar)
  useEffect(() => {
    // For workers we avoid setting the app `currentUserId` to the auth UID
    // while the worker row is being resolved — otherwise the UI will try
    // to lookup a worker by the auth ID and incorrectly grant access.
    dispatch({
      type: 'SET_CURRENT_USER',
      payload: { role: userRole as any, id: userRole === 'admin' ? userId : undefined },
    });

    if (!userId) return;

    // Load profile asynchronously so the avatar shows immediately after login
    (async () => {
      try {
        if (userRole === 'admin') {
          const profile = await db.getAdminProfile(userId);
          if (profile) {
            const avatarUrl = profile.avatar_url
              ? (profile.avatar_url.startsWith('http')
                  ? profile.avatar_url
                  : getPublicUrl(BUCKETS.STATION_LOGOS, profile.avatar_url))
              : undefined;
            dispatch({
              type: 'SET_CURRENT_USER',
              payload: { role: userRole as any, id: userId, name: profile.name, avatarUrl },
            });
          }
        } else if (userRole === 'module_worker') {
          // Employee of a business part (Restaurant / Cafétéria / Lavage /
          // Magasin): their identity, part and grants live in module_workers.
          const mw = await getMyModuleWorker();
          if (mw) {
            dispatch({
              type: 'SET_CURRENT_USER',
              payload: {
                role: 'module_worker',
                id: mw.id,
                name: mw.name,
                permissions: {},
                moduleWorker: {
                  id: mw.id,
                  moduleKey: mw.module_key,
                  name: mw.name,
                  roleName: mw.role_name ?? undefined,
                  permissions: (mw.permissions || {}) as Record<string, boolean>,
                },
              },
            });
          }
        } else {
          // Worker: resolve via RPC
          const { data: workerRow } = await supabase.rpc('get_my_worker');
          if (workerRow) {
              const w = workerRow as Record<string, any>;
              const rawPhotoUrl = (w.photo_url ?? w.photo) as string | undefined;
              const avatarUrl = rawPhotoUrl
                ? (rawPhotoUrl.startsWith('http')
                    ? rawPhotoUrl
                    : getPublicUrl(BUCKETS.WORKER_PHOTOS, rawPhotoUrl))
                : undefined;
              // Use the worker's application ID (row.id), not the Supabase auth UID
              // so subsequent lookups (permissions, connectedUser) succeed.
              const savedPerms = w.permissions as UserPermissions | null | undefined;
              const hasRealPermissions = savedPerms && Object.keys(savedPerms).length > 0;
              // No automatic default: a worker whose permissions were never
              // programmed gets NOTHING (only the always-on dashboard). Access is
              // granted exclusively by what the admin saved.
              const resolvedPermissions: UserPermissions = hasRealPermissions ? savedPerms! : {};
              dispatch({
                type: 'SET_CURRENT_USER',
                payload: { role: userRole as any, id: w.id as string, name: w.name as string, avatarUrl, permissions: resolvedPermissions },
              });
            }
        }
      } catch {
        // Profile load is best-effort; silently ignore failures
      }
    })();
  }, [userRole, userId, dispatch]);

  return (
    <>
      {/* Show DB loading overlay while Supabase hydrates */}
      {isLoading && <DbLoader />}

      <ToastContainer
        toasts={toasts}
        onClose={(id) => dispatch({ type: 'REMOVE_TOAST', payload: id })}
      />

      {/* Le <Router> est monté par <App> (au-dessus de la page publique). */}
      <AppRoutes onLogout={onLogout} />
    </>
  );
}

// ─── Routes component (inside Router context so useNavigate works) ─────────────
function AppRoutes({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();

  // Handle logout with redirect to login page
  const handleLogout = async () => {
    await onLogout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout onLogout={handleLogout}>
      <Routes>
        <Route path="/dashboard"        element={<Dashboard />} />

        <Route path="/brigades"         element={<ProtectedRoute element={<Brigades />} moduleId="Brigades" />} />

        {/* Fuel */}
        <Route path="/tanks"            element={<ProtectedRoute element={<Tanks />} moduleId="Cuves" />} />
        <Route path="/pumps"            element={<ProtectedRoute element={<Pumps />} moduleId="Pompes" />} />
        <Route path="/fuel-purchases"   element={<ProtectedRoute element={<FuelPurchases />} moduleId="Achats Carburant" />} />
        <Route path="/inventory"        element={<ProtectedRoute element={<Inventory />} moduleId="Inventaires" />} />

        {/* Clients / Suppliers */}
        <Route path="/clients"          element={<ProtectedRoute element={<Clients />} moduleId="Clients" />} />
        <Route path="/suppliers"        element={<ProtectedRoute element={<Suppliers />} moduleId="Fournisseurs" />} />

        {/* Personnel */}
        <Route path="/pompistes"        element={<ProtectedRoute element={<Pompistes />} moduleId="Pompistes" />} />
        <Route path="/gerants"          element={<ProtectedRoute element={<Gerants />} moduleId="Gérants" />} />
        <Route path="/magasin-workers"  element={<ProtectedRoute element={<MagasinWorkers />} moduleId="Employés Magasin" />} />
        <Route path="/roles-permissions" element={<ProtectedRoute element={<Permissions />} moduleId="Paramètres" />} />

        {/* Finances */}
        <Route path="/expenses"         element={<ProtectedRoute element={<Expenses />} moduleId="Dépenses" />} />
        <Route path="/daily-report"     element={<ProtectedRoute element={<DailyReport />} moduleId="Fiche Journalière" />} />

        {/* Finance — trésorerie */}
        <Route path="/caisse-generale"  element={<ProtectedRoute element={<CaisseGenerale />} moduleId="Caisse Générale" />} />
        <Route path="/bank-accounts"    element={<ProtectedRoute element={<BankAccounts />} moduleId="Comptes Bancaires" />} />

        {/* Retours clients — partie Carburant (page publique : /client) */}
        <Route path="/feedbacks"        element={<ProtectedRoute element={<Feedbacks />} moduleId="Retours Clients" />} />

        {/* Analytics */}
        <Route path="/statistics"       element={<ProtectedRoute element={<Statistics />} moduleId="Statistiques" />} />
        <Route path="/reports"          element={<ProtectedRoute element={<Reports />} moduleId="Rapports" />} />

        {/* Business modules (Cafétéria / Lavage & Vidange) */}
        {MODULE_ROUTES.map(r => React.createElement(Route, {
          key: r.path,
          path: r.path,
          element: <ModuleRouteGuard moduleKey={r.moduleKey} iface={r.iface} element={r.element} />,
        }))}
        <Route path="/general-reports"  element={<AdminOnlyRoute element={<GeneralReports />} />} />

        {/* Settings & personal */}
        <Route path="/settings"         element={<AdminOnlyRoute element={<Settings />} />} />
        <Route path="/my-brigade"       element={<MyBrigade />} />
        <Route path="/my-payments"      element={<MyPayments />} />
        <Route path="/my-settings"      element={<MySettings />} />

        {/* Default */}
        <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
