import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { useAppState } from "../store/AppContext";
import WhatsAppOutboxRunner from "./WhatsAppOutboxRunner";

/** localStorage key holding the desktop "sidebar hidden" preference. */
const SIDEBAR_HIDDEN_KEY = "sidebarHidden";

const Layout = ({ children, onRouteChange, onLogout }: { children: React.ReactNode; onRouteChange?: (route: string) => void; onLogout?: () => void }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);          // mobile drawer
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUserRole, currentUserId, currentUserPermissions, currentModuleWorker } = useAppState();

  // On desktop the sidebar is part of the layout, so hiding it means collapsing
  // its column to 0 (the <aside> itself slides out). The choice is remembered
  // across reloads — a user who works full-width expects it to stay that way.
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? "1" : "0"); } catch { /* private mode */ }
  }, [sidebarHidden]);

  // Which sidebar the navbar button drives depends on the breakpoint (lg = 1024px).
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleSidebar = () => {
    if (isDesktop) setSidebarHidden(h => !h);
    else setSidebarOpen(o => !o);
  };

  // Save the current route whenever it changes
  useEffect(() => {
    if (onRouteChange) {
      onRouteChange(location.pathname);
    }
  }, [location.pathname, onRouteChange]);

  const sidebarProps = {
    activePath: location.pathname,
    onNavigate: (path: string) => navigate(path),
    onLogout: onLogout,
    userRole: currentUserRole,
    userId: currentUserId,
    userPermissions: currentUserPermissions,
    moduleWorker: currentModuleWorker,
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-surface)" }}>
      {/* Sidebar — visible on lg+ unless hidden from the navbar toggle */}
      <div
        className="hidden lg:block transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarHidden ? 0 : "var(--sidebar-width)", flexShrink: 0 }}
      >
        <Sidebar
          isOpen={!sidebarHidden}
          onClose={() => {}}
          {...sidebarProps}
        />
      </div>

      {/* Mobile Sidebar */}
      <div className="lg:hidden">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          {...sidebarProps}
        />
      </div>

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-w-0">
        <Navbar
          onMenuToggle={toggleSidebar}
          sidebarOpen={isDesktop ? !sidebarHidden : sidebarOpen}
          activePath={location.pathname}
        />
        <main className="flex-1 p-4 lg:p-6 overflow-auto custom-scrollbar">
          {children}
        </main>
      </div>

      {/* ── Le rattrapage des messages WhatsApp en attente ────────────────
          Monté dans la coquille de l'application, donc actif quel que soit
          l'écran ouvert. Il ne rend rien tant que la file est vide. Voir
          `WhatsAppOutboxRunner` : en serverless, rien ne tourne entre deux
          requêtes — c'est le navigateur ouvert qui déclenche le vidage. */}
      <WhatsAppOutboxRunner />
    </div>
  );
};

export default Layout;
