import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, Users, Fuel, ShoppingCart, Store, Truck,
  Package, ClipboardList, UsersRound, Settings, UserCircle,
  LogOut, Map, Wrench, TrendingUp, FileText, CreditCard,
  Target, ChevronDown, Gauge, Receipt,
  BarChart2, Archive, UserCog, DollarSign, Building2, ChevronRight, X,
  Wallet, CalendarCheck, Shield, UserCheck, Calendar,
  FlaskConical, Beaker, ShoppingBag, Car, Utensils, Coffee, Droplets, FileBarChart,
  BellRing, Landmark, PiggyBank, MessageSquare, MessageCircle, Star
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useAppState, UserPermissions, ModuleWorkerSession, AppUserRole } from "../store/AppContext";
import { useBizAll } from "../store/BizContext";
import { useFeedbacks } from "../store/FeedbackContext";
import { MODULES, ModuleKey } from "../lib/bizConfig";
import { buildRappels, countDue } from "../lib/rappels";

// --- Types ---

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  moduleId?: string; // used for permission filtering for gerant
}

interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activePath: string;
  onNavigate: (path: string) => void;
  onLogout?: () => void;
  userRole: AppUserRole;
  userId?: string;
  userPermissions?: UserPermissions;
  moduleWorker?: ModuleWorkerSession;
}

// --- Role badge styles ---

const roleBadge: Record<string, { label: string; bg: string; text: string }> = {
  admin:        { label: "Administrateur", bg: "rgba(255,184,0,0.18)",  text: "#FFB800" },
  pompiste:     { label: "Pompiste",        bg: "rgba(34,197,94,0.18)", text: "#22c55e" },
  chef_brigade: { label: "Chef Brigade",    bg: "rgba(168,85,247,0.18)",text: "#a855f7" },
  gerant:       { label: "Gérant",          bg: "rgba(59,130,246,0.18)",text: "#3b82f6" },
  magasin:      { label: "Employé Magasin", bg: "rgba(236,72,153,0.18)",text: "#ec4899" },
  module_worker:{ label: "Employé",         bg: "rgba(20,184,166,0.18)",text: "#2dd4bf" },
};

// --- Admin nav groups ---
//
// The sidebar is organised by "part" (activity): a reorganised Carburant part
// (the original fuel-station app), then four new commerce/production parts
// (Restaurant, Cafétéria, Magasin, Magasin) whose pages live on the
// BizContext store — itself fed by the `biz_store` row in Supabase.

// Builds a nav group for one business module from its capabilities (config).
function buildModuleNavGroup(key: ModuleKey): NavGroup {
  const cfg = MODULES[key];
  const b = cfg.base;
  const items: NavItem[] = [];
  if (cfg.isService) {
    items.push({ label: "Point de vente",       icon: ShoppingBag, path: `${b}/pos` });
    items.push({ label: "Ventes",               icon: Receipt,     path: `${b}/sales` });
    items.push({ label: "Gestion de stock",     icon: Package,     path: `${b}/stock` });
    items.push({ label: "Inventaire",           icon: ClipboardList, path: `${b}/inventaire` });
    items.push({ label: "Achats",               icon: ShoppingCart,path: `${b}/purchases` });
    items.push({ label: "Clients",              icon: Users,       path: `${b}/clients` });
    items.push({ label: "Fournisseurs",         icon: Truck,       path: `${b}/suppliers` });
    items.push({ label: "Employés",             icon: UsersRound,  path: `${b}/workers` });
    items.push({ label: "Dépenses",             icon: CreditCard,  path: `${b}/expenses` });
    items.push({ label: "Caisse",               icon: Wallet,      path: `${b}/caisse` });
    items.push({ label: "Rapports",             icon: BarChart2,   path: `${b}/reports` });
    items.push({ label: "Retours clients",      icon: MessageSquare, path: `${b}/feedbacks` });
  } else {
    items.push({ label: "Gestion de stock",     icon: Package,     path: `${b}/stock` });
    items.push({ label: "Inventaire",           icon: ClipboardList, path: `${b}/inventaire` });
    items.push({ label: "Achats",               icon: ShoppingCart,path: `${b}/purchases` });
    if (cfg.hasProduction) {
      items.push({ label: "Production",         icon: FlaskConical,path: `${b}/production` });
      items.push({ label: "Comptoir",           icon: Beaker,      path: `${b}/comptoir` });
    }
    items.push({ label: "Point de vente",       icon: ShoppingBag, path: `${b}/pos` });
    items.push({ label: "Ventes",               icon: Receipt,     path: `${b}/sales` });
    items.push({ label: "Clients",              icon: Users,       path: `${b}/clients` });
    items.push({ label: "Fournisseurs",         icon: Truck,       path: `${b}/suppliers` });
    items.push({ label: "Employés",             icon: UsersRound,  path: `${b}/workers` });
    items.push({ label: "Dépenses",             icon: CreditCard,  path: `${b}/expenses` });
    items.push({ label: "Caisse",               icon: Wallet,      path: `${b}/caisse` });
    items.push({ label: "Rapports",             icon: BarChart2,   path: `${b}/reports` });
    items.push({ label: "Retours clients",      icon: MessageSquare, path: `${b}/feedbacks` });
  }
  return { id: key, label: cfg.label, items };
}

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboard",
    items: [{ label: "Tableau de Bord", icon: LayoutDashboard, path: "/dashboard", moduleId: "Tableau de bord" }]
  },
  {
    // Finance = cross-activity treasury + the consolidated report. It sits
    // directly under the dashboard because every part feeds into it. Every
    // other former "(Station)" screen lives inside its own part.
    id: "finance", label: "Finance",
    items: [
      { label: "Caisse Générale",      icon: PiggyBank,    path: "/caisse-generale",  moduleId: "Caisse Générale" },
      { label: "Comptes Bancaires",    icon: Landmark,     path: "/bank-accounts",    moduleId: "Comptes Bancaires" },
      { label: "Rapports Généraux",    icon: FileBarChart, path: "/general-reports" },
    ]
  },
  {
    id: "carburant", label: "Carburant",
    items: [
      { label: "Brigades",           icon: Target,       path: "/brigades",        moduleId: "Brigades" },
      { label: "Cuves / Tanks",      icon: Gauge,        path: "/tanks",           moduleId: "Cuves" },
      { label: "Pompes",             icon: Wrench,       path: "/pumps",           moduleId: "Pompes" },
      { label: "Achats Carburant",   icon: ShoppingCart, path: "/fuel-purchases",  moduleId: "Achats Carburant" },
      { label: "Pompistes",          icon: UsersRound,   path: "/pompistes",       moduleId: "Pompistes" },
      { label: "Gérants",            icon: Building2,    path: "/gerants",         moduleId: "Gérants" },
      { label: "Clients",            icon: Users,        path: "/clients",         moduleId: "Clients" },
      { label: "Fournisseurs",       icon: Truck,        path: "/suppliers",       moduleId: "Fournisseurs" },
      { label: "Dépenses",           icon: CreditCard,   path: "/expenses",        moduleId: "Dépenses" },
      { label: "Fiche Journalière",  icon: FileText,     path: "/daily-report",    moduleId: "Rapports" },
      { label: "Statistiques",       icon: TrendingUp,   path: "/statistics",      moduleId: "Statistiques" },
      { label: "Rapports Carburant", icon: Receipt,      path: "/reports",         moduleId: "Rapports" },
      { label: "Retours Clients",    icon: MessageSquare, path: "/feedbacks",      moduleId: "Retours Clients" },
    ]
  },
  buildModuleNavGroup("restaurant"),
  buildModuleNavGroup("cafeteria"),
  buildModuleNavGroup("lavage"),
];

// --- Worker nav (permission-driven) ---
//
// Worker sidebars are NOT hardcoded per role. They are built by filtering this
// master module map against the worker's saved permissions, so ANY module the
// admin grants (via the Permissions modal) shows up in that worker's sidebar.
//
// `group` controls which section the item lands in; `path` points to the
// worker-facing page for that module.

interface ModuleNavDef { label: string; icon: React.ElementType; path: string; group: string }

const WORKER_MODULE_NAV: Record<string, ModuleNavDef> = {
  // Opérations
  "Ma Brigade":        { label: "Ma Brigade",        icon: Target,       path: "/my-brigade",      group: "ops" },
  "Brigades":          { label: "Brigades",          icon: Target,       path: "/brigades",        group: "ops" },
  // Carburant
  "Cuves":             { label: "Cuves / Tanks",     icon: Gauge,        path: "/tanks",           group: "fuel" },
  "Pompes":            { label: "Pompes",            icon: Wrench,       path: "/pumps",           group: "fuel" },
  "Achats Carburant":  { label: "Achats Carburant",  icon: ShoppingCart, path: "/fuel-purchases",  group: "fuel" },
  "Inventaires":       { label: "Inventaire",        icon: Archive,      path: "/inventory",       group: "fuel" },
  // Contacts
  "Clients":           { label: "Clients",           icon: Users,        path: "/clients",         group: "contacts" },
  "Fournisseurs":      { label: "Fournisseurs",      icon: Truck,        path: "/suppliers",       group: "contacts" },
  // Personnel (RH)
  "Pompistes":         { label: "Pompistes",         icon: UsersRound,   path: "/pompistes",       group: "hr" },
  "Gérants":           { label: "Gérants",           icon: Building2,    path: "/gerants",         group: "hr" },
  "Employés Magasin":  { label: "Employés Magasin",  icon: Store,        path: "/magasin-workers", group: "hr" },
  // Finances
  "Dépenses":          { label: "Dépenses",          icon: CreditCard,   path: "/expenses",        group: "finance" },
  "Fiche Journalière": { label: "Fiche Journalière", icon: FileText,     path: "/daily-report",    group: "finance" },
  "Caisse Générale":   { label: "Caisse Générale",   icon: PiggyBank,    path: "/caisse-generale", group: "finance" },
  "Comptes Bancaires": { label: "Comptes Bancaires", icon: Landmark,     path: "/bank-accounts",   group: "finance" },
  // Analytique
  "Statistiques":      { label: "Statistiques",      icon: BarChart2,    path: "/statistics",      group: "stats" },
  "Rapports":          { label: "Rapports",          icon: Receipt,      path: "/reports",         group: "stats" },
  "Retours Clients":   { label: "Retours Clients",   icon: MessageSquare, path: "/feedbacks",      group: "stats" },
  // Mon compte
  "Mes Paiements":     { label: "Mes Paiements",     icon: Wallet,       path: "/my-payments",     group: "personal" },
};

// Section order + labels for worker sidebars
const WORKER_GROUP_ORDER: { id: string; label?: string }[] = [
  { id: "ops",      label: "Mon Travail" },
  { id: "fuel",     label: "Carburant" },
  { id: "contacts", label: "Contacts" },
  { id: "hr",       label: "Personnel" },
  { id: "finance",  label: "Finances" },
  { id: "stats",    label: "Analytique" },
  { id: "personal", label: "Mon Compte" },
];

// Per-role label/path overrides for modules that resolve to a role-specific page.
const WORKER_NAV_OVERRIDES: Record<string, Record<string, { label?: string; path?: string }>> = {};

const DASHBOARD_ITEM: NavItem = { label: "Tableau de Bord", icon: LayoutDashboard, path: "/dashboard", moduleId: "Tableau de bord" };

// --- Sidebar alerts ---
//
// Some screens hold work that is WAITING for someone: a demande d'encaissement
// the caisse has not collected yet, a lavage/vidange left "en attente". The
// sidebar shows that count on the button itself (and on the collapsed section
// header), so nobody has to open the page to notice there is something to do.

/** Number of pending items per route path, e.g. `{ "/lavage/reparations": 3 }`. */
function useNavAlerts(): Record<string, number> {
  const biz = useBizAll();
  // Avis clients jamais ouverts — même traitement que les demandes en attente :
  // une pastille rouge tant que personne n'a marqué l'avis comme lu.
  const { unreadByPart } = useFeedbacks();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(MODULES) as ModuleKey[]) {
      const mod = biz[key];
      const base = MODULES[key].base;
      if (!mod) continue;
      const demandes = (mod.payRequests || []).filter(r => r.status === "pending").length;
      const interventions = (mod.reparations || []).filter(r => r.status === "pending").length;
      if (demandes > 0) out[`${base}/encaissements`] = demandes;
      if (interventions > 0) out[`${base}/reparations`] = interventions;
      if (unreadByPart[key] > 0) out[`${base}/feedbacks`] = unreadByPart[key];
      // Rappels de passage ÉCHUS. Ils se déduisent des interventions et des
      // délais réglés — rien n'est stocké — donc la pastille reste juste même
      // si les délais changent, et disparaît dès que l'alerte est classée.
      if (MODULES[key].isService) {
        const due = countDue(buildRappels({
          reparations: mod.reparations || [],
          clients: mod.clients || [],
          handled: mod.rappels || [],
          config: mod.rappelConfig,
          lookaheadDays: 0,
        }));
        if (due > 0) out[`${base}/messages`] = due;
      }
    }
    // Partie Carburant : son écran de retours vit à la racine.
    if (unreadByPart.fuel > 0) out["/feedbacks"] = unreadByPart.fuel;
    return out;
  }, [biz, unreadByPart]);
}

/** Red pill carrying the number of pending items. */
const AlertBadge = ({ count, small }: { count: number; small?: boolean }) => (
  <span
    className={cn(
      "relative flex items-center justify-center rounded-full font-black text-white tabular-nums flex-shrink-0",
      small ? "min-w-[16px] h-4 px-1 text-[9px]" : "min-w-[20px] h-5 px-1.5 text-[10px]"
    )}
    style={{ background: "linear-gradient(135deg, #ef4444, #b91c1c)", boxShadow: "0 0 0 2px rgba(239,68,68,0.25)" }}
    title={`${count} en attente`}
  >
    <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-40" />
    <span className="relative">{count > 99 ? "99+" : count}</span>
  </span>
);

/**
 * Build a worker's sidebar purely from their permissions. Every module with
 * `voir: true` produces a nav item; everything else is hidden. The dashboard is
 * always present (its route is unprotected and serves as the safe landing page).
 */
function buildWorkerNav(role: string, permissions?: UserPermissions): NavGroup[] {
  const groups: NavGroup[] = [{ id: "dashboard", items: [DASHBOARD_ITEM] }];

  const isEmpty = !permissions || Object.keys(permissions).length === 0;
  if (isEmpty) return groups;

  const overrides = WORKER_NAV_OVERRIDES[role] || {};
  // NOTE: a plain object is used (not `new Map()`) because `Map` is imported
  // from lucide-react as an icon in this file and shadows the global Map.
  const byGroup: Record<string, NavItem[]> = {};

  for (const [moduleId, def] of Object.entries(WORKER_MODULE_NAV)) {
    if (!permissions[moduleId]?.voir) continue;
    const ov = overrides[moduleId];
    const item: NavItem = {
      label: ov?.label ?? def.label,
      icon: def.icon,
      path: ov?.path ?? def.path,
      moduleId,
    };
    if (!byGroup[def.group]) byGroup[def.group] = [];
    byGroup[def.group].push(item);
  }

  for (const g of WORKER_GROUP_ORDER) {
    const items = byGroup[g.id];
    if (items && items.length > 0) groups.push({ id: g.id, label: g.label, items });
  }

  return groups;
}

// --- Business-part employee nav (Restaurant / Cafétéria / Magasin) ---
//
// A part employee only ever sees interfaces of THEIR part, and only those the
// admin ticked "voir" on in the employee's Permissions modal. The item list is
// the same one the admin's part group is built from, filtered by grants.

/** Sidebar entry for one interface id of a part (same ids as MODULE_INTERFACES). */
const PART_IFACE_NAV: Record<string, { label: string; icon: React.ElementType }> = {
  stock:       { label: "Gestion de stock",     icon: Package },
  purchases:   { label: "Achats",               icon: ShoppingCart },
  production:  { label: "Production",           icon: FlaskConical },
  comptoir:    { label: "Comptoir",             icon: Beaker },
  pos:         { label: "Point de vente",       icon: ShoppingBag },
  sales:       { label: "Ventes",               icon: Receipt },
  clients:     { label: "Clients",              icon: Users },
  suppliers:   { label: "Fournisseurs",         icon: Truck },
  workers:     { label: "Employés",             icon: UsersRound },
  expenses:    { label: "Dépenses",             icon: CreditCard },
  caisse:      { label: "Caisse",               icon: Wallet },
  reports:     { label: "Rapports",             icon: BarChart2 },
  feedbacks:   { label: "Retours clients",      icon: MessageSquare },
};

function buildModuleWorkerNav(worker?: ModuleWorkerSession): NavGroup[] {
  const groups: NavGroup[] = [{ id: "dashboard", items: [DASHBOARD_ITEM] }];
  if (!worker) return groups;

  const cfg = MODULES[worker.moduleKey];
  if (!cfg) return groups;

  // Only the interfaces that exist for this part, in the admin's order.
  const available = buildModuleNavGroup(worker.moduleKey).items;
  const items: NavItem[] = [];
  for (const nav of available) {
    const iface = nav.path.slice(cfg.base.length + 1);   // "/restaurant/stock" → "stock"
    if (!worker.permissions?.[`${iface}.voir`]) continue;
    const def = PART_IFACE_NAV[iface];
    items.push({ label: def?.label ?? nav.label, icon: def?.icon ?? nav.icon, path: nav.path });
  }

  if (items.length > 0) groups.push({ id: worker.moduleKey, label: cfg.label, items });
  return groups;
}

// --- Nav builder function ---

function getNavGroups(
  role: string,
  permissions?: UserPermissions,
  moduleWorker?: ModuleWorkerSession
): NavGroup[] {
  switch (role) {
    case 'pompiste':
    case 'chef_brigade':
    case 'magasin':
    case 'gerant':
      return buildWorkerNav(role, permissions);

    case 'module_worker':
      return buildModuleWorkerNav(moduleWorker);

    case 'admin':
    default:
      return ADMIN_NAV_GROUPS;
  }
}

// --- i18n label maps (French label → translation key) ---
// The nav data keeps its original French labels; these maps resolve them to
// translation keys at render time so the sidebar flips fully to Arabic.
const LABEL_KEYS: Record<string, string> = {
  "Tableau de Bord": "nav.dashboard",
  "Brigades": "nav.brigades",
  "Ma Brigade": "nav.my_brigade",
  "Cuves / Tanks": "nav.tanks",
  "Pompes": "nav.pumps",
  "Achats Carburant": "nav.fuel_purchases",
  "Inventaire": "nav.inventory",
  "Clients": "nav.clients",
  "Fournisseurs": "nav.suppliers",
  "Pompistes": "nav.pompistes",
  "Gérants": "nav.gerants",
  "Employés Magasin": "nav.magasin_workers",
  "Modèles Permissions": "nav.permission_templates",
  "Dépenses": "nav.expenses",
  "Fiche Journalière": "nav.daily_report",
  "Statistiques": "nav.statistics",
  "Rapports": "nav.reports",
  "Mes Paiements": "nav.my_payments",
};
const GROUP_KEYS: Record<string, string> = {
  "Opérations": "sections.operations",
  "Finance": "sections.finances",
  "Carburant": "sections.fuel",
  "Magasin": "sections.magasin",
  "Contacts": "sections.contacts",
  "Personnel": "sections.personnel",
  "Finances": "sections.finances",
  "Analytique": "sections.analytics",
  "Mon Travail": "sections.my_work",
  "Mon Compte": "sections.my_account",
};

// --- Settings path per role ---

const SETTINGS_PATH: Record<string, string> = {
  admin:        "/settings",
  pompiste:     "/my-settings",
  chef_brigade: "/my-settings",
  gerant:       "/my-settings",
  magasin:      "/my-settings",
  module_worker:"/my-settings",
};

// --- Favoris de partie ---
//
// Une partie ouvre douze à quatorze interfaces. Celle qu'on utilise vingt fois
// par jour — le point de vente d'une cafétéria, les vidanges d'un lavage, les
// brigades du carburant — se retrouvait au milieu d'une liste qu'il fallait
// parcourir des yeux à chaque fois, souvent en la déroulant d'abord.
//
// Chaque partie a maintenant SES favoris : une étoile sur n'importe quelle
// entrée l'épingle en tête de sa section, au-dessus de la liste complète.
//
// Le choix est PERSONNEL et propre au poste : c'est une préférence d'affichage,
// pas une donnée de gestion. Elle vit donc dans le navigateur, sous une clé qui
// porte l'utilisateur — deux personnes qui partagent un poste ne s'imposent pas
// leurs raccourcis.

/** Les sections qui acceptent des favoris : les quatre activités. */
const FAVORITE_GROUPS = new Set(["carburant", "restaurant", "cafeteria", "lavage"]);

const favKey = (who: string) => `altech.sidebar.favorites.${who || "anon"}`;

type Favorites = Record<string, string[]>;

function readFavorites(who: string): Favorites {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(favKey(who));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // On ne garde que ce qui a la forme attendue : une préférence corrompue ne
    // doit pas empêcher la barre de s'afficher.
    const out: Favorites = {};
    for (const [group, paths] of Object.entries(parsed)) {
      if (Array.isArray(paths)) out[group] = paths.filter(x => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

function writeFavorites(who: string, favorites: Favorites): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(favKey(who), JSON.stringify(favorites));
  } catch {
    // Stockage plein ou refusé (navigation privée) : le favori vaut pour la
    // session en cours, ce n'est pas une raison de faire échouer un clic.
  }
}

// --- Component ---

const Sidebar = ({ isOpen, onClose, activePath, onNavigate, onLogout, userRole, userId, userPermissions, moduleWorker }: SidebarProps) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const trLabel = (label: string) => (LABEL_KEYS[label] ? t(LABEL_KEYS[label]) : label);
  const trGroup = (label?: string) => (label && GROUP_KEYS[label] ? t(GROUP_KEYS[label]) : label);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(["dashboard", "finance", "carburant"]);

  const { pompistes, brigadeChefs, gerants, magasinWorkers, users, settings } = useAppState();

  // Resolve connected worker name and initial
  const connectedUser = useMemo(() => {
    if (!userId) return null;
    if (userRole === 'pompiste')     return (pompistes || []).find(p => p.id === userId) ?? null;
    if (userRole === 'chef_brigade') return (brigadeChefs || []).find(c => c.id === userId) ?? null;
    if (userRole === 'gerant')       return (gerants || []).find(g => g.id === userId) ?? null;
    if (userRole === 'magasin')      return (magasinWorkers || []).find(m => m.id === userId) ?? null;
    if (userRole === 'module_worker')return moduleWorker ? { name: moduleWorker.name } : null;
    if (userRole === 'admin')        return users.find(u => u.id === userId) ?? null;
    return null;
  }, [userId, userRole, pompistes, brigadeChefs, gerants, magasinWorkers, users, moduleWorker]);

  const navGroups = useMemo(
    () => getNavGroups(userRole, userPermissions, moduleWorker),
    [userRole, userPermissions, moduleWorker]
  );

  // Pending demandes d'encaissement / interventions, shown on the buttons.
  const alerts = useNavAlerts();
  const groupAlerts = (group: NavGroup) =>
    group.items.reduce((sum, item) => sum + (alerts[item.path] || 0), 0);

  // A part employee has a single section — open it as soon as it resolves,
  // otherwise their whole menu would look empty behind a collapsed header.
  useEffect(() => {
    if (!moduleWorker) return;
    setExpandedGroups(prev => prev.includes(moduleWorker.moduleKey) ? prev : [...prev, moduleWorker.moduleKey]);
  }, [moduleWorker]);

  /**
   * Une entrée de la barre. Elle est rendue à DEUX endroits — dans les favoris
   * épinglés et dans la liste complète — et doit rester la même des deux côtés :
   * même icône, même pastille d'alerte, même état actif.
   *
   * L'étoile est un bouton À CÔTÉ du lien, jamais dedans : un bouton imbriqué
   * dans un bouton n'est pas du HTML valide, et le clic sur l'étoile finirait
   * par déclencher la navigation.
   */
  const renderNavItem = (group: NavGroup, item: NavItem, pinned: boolean) => {
    const isActive = activePath === item.path;
    const Icon = item.icon;
    const alert = alerts[item.path] || 0;
    const canFavorite = FAVORITE_GROUPS.has(group.id);
    const isFavorite = (favorites[group.id] || []).includes(item.path);

    return (
      <div key={`${pinned ? "fav" : "all"}-${item.path}`} className="relative group/nav">
        <motion.button
          onClick={() => handleNavigate(item.path)}
          whileTap={{ scale: 0.98 }}
          className={cn("sidebar-link", isActive ? "sidebar-link-active" : "sidebar-link-inactive", canFavorite && "!pr-9")}
        >
          <div className={cn(
            "relative w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
            isActive ? "bg-[#001f5c]/20" : "bg-white/6"
          )}>
            <Icon className={cn("w-3.5 h-3.5", isActive ? "text-[#001f5c]" : "text-blue-200")} />
            {alert > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#001f5c]" />
            )}
          </div>
          <span className="text-sm leading-none flex-1 truncate">{trLabel(item.label)}</span>
          {alert > 0 && <AlertBadge count={alert} />}
          {isActive && alert === 0 && !canFavorite && (
            <ChevronRight className="w-3 h-3 text-[#001f5c]/50 flex-shrink-0" />
          )}
        </motion.button>

        {canFavorite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFavorite(group.id, item.path); }}
            title={isFavorite ? "Retirer des favoris" : "Épingler en haut de cette partie"}
            aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all",
              // Une étoile allumée reste visible ; les autres n'apparaissent
              // qu'au survol, pour ne pas transformer le menu en sapin de Noël.
              isFavorite ? "opacity-100" : "opacity-0 group-hover/nav:opacity-100 focus:opacity-100",
              isActive ? "hover:bg-[#001f5c]/10" : "hover:bg-white/10"
            )}
          >
            <Star
              className="w-3.5 h-3.5"
              style={isFavorite
                ? { color: "#FFB800", fill: "#FFB800" }
                : { color: isActive ? "rgba(0,31,92,0.45)" : "rgba(147,197,253,0.6)" }}
            />
          </button>
        )}
      </div>
    );
  };

  const settingsPath = SETTINGS_PATH[userRole] ?? "/settings";
  const badge = roleBadge[userRole] ?? roleBadge.admin;

  const displayName  = connectedUser?.name ?? (userRole === 'admin' ? t('roles.admin') : t('roles.user'));
  const displayInitial = displayName.charAt(0).toUpperCase();

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const handleNavigate = (path: string) => {
    onNavigate(path);
    if (window.innerWidth < 1280) onClose();
  };

  // ── Les favoris de chaque partie ──────────────────────────────────────────
  const favOwner = userId || userRole;
  const [favorites, setFavorites] = useState<Favorites>(() => readFavorites(favOwner));
  // Changer d'utilisateur sur le même poste doit changer de raccourcis : les
  // favoris se rechargent quand le propriétaire change.
  useEffect(() => { setFavorites(readFavorites(favOwner)); }, [favOwner]);

  const toggleFavorite = (groupId: string, path: string) => {
    setFavorites(prev => {
      const current = prev[groupId] || [];
      const next = current.includes(path) ? current.filter(x => x !== path) : [...current, path];
      const out = { ...prev, [groupId]: next };
      writeFavorites(favOwner, out);
      return out;
    });
  };

  /**
   * Les entrées épinglées d'une section, dans l'ordre où elles ont été
   * choisies. On repart TOUJOURS de la liste réelle du menu : un favori qui
   * pointe vers une interface retirée depuis (droits révoqués, module désactivé)
   * n'a plus de bouton à afficher — il est simplement ignoré, jamais rendu à
   * vide.
   */
  const favoritesOf = (group: NavGroup): NavItem[] => {
    if (!FAVORITE_GROUPS.has(group.id)) return [];
    const pinned = favorites[group.id] || [];
    return pinned
      .map(path => group.items.find(i => i.path === path))
      .filter((i): i is NavItem => !!i);
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed top-0 bottom-0 z-50 flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out overflow-hidden",
          isRtl ? "right-0" : "left-0",
          isOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full"
        )}
        style={{ width: "var(--sidebar-width)" }}
      >
        {/* Background */}
        <div className="absolute inset-0" style={{
          background: "linear-gradient(170deg, #001233 0%, #001f5c 35%, #003087 70%, #002470 100%)"
        }} />

        {/* Decorative orbs */}
        <div className="absolute top-0 right-0 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,184,0,0.12) 0%, transparent 70%)", transform: "translate(35%,-35%)" }}
        />
        <div className="absolute bottom-1/3 left-0 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(0,68,187,0.3) 0%, transparent 70%)", transform: "translate(-50%,0)" }}
        />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,184,0,0.06) 0%, transparent 70%)", transform: "translate(30%,30%)" }}
        />

        <div className="flex flex-col h-full relative z-10">
          {/* Logo Header */}
          <div className="px-5 py-5 flex items-center gap-3 shrink-0">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #FFB800 0%, #e6a000 100%)", boxShadow: "0 4px 14px rgba(255,184,0,0.45)" }}
            >
              {(settings?.logoUrl || settings?.logo)
                ? <img src={settings.logoUrl || settings.logo} alt="logo" className="w-full h-full object-cover" />
                : <Fuel className="w-5 h-5 text-[#001f5c]" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-white font-black text-lg tracking-tight leading-none">
                {settings?.stationName || settings?.name || "altech station"}
              </h1>
              <p className="text-[10px] font-semibold uppercase tracking-widest mt-0.5"
                style={{ color: "rgba(255,184,0,0.65)" }}>Naftal System</p>
            </div>
            <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Yellow divider */}
          <div className="mx-5 mb-3 rounded-full"
            style={{ height: "1.5px", background: "linear-gradient(90deg, rgba(255,184,0,0.7) 0%, rgba(255,184,0,0.15) 70%, transparent 100%)" }}
          />

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto px-3 pb-4 custom-scrollbar">
            {navGroups.map((group) => (
              <div key={group.id} className={group.id === "dashboard" ? "mb-2" : "mb-0.5"}>
                {group.label && (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 mt-3 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "rgba(147,197,253,0.5)" }}
                  >
                    <span className="text-[9px] font-black uppercase tracking-[0.22em] truncate">{trGroup(group.label)}</span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      {/* Collapsed sections must still shout when work is waiting. */}
                      {!expandedGroups.includes(group.id) && groupAlerts(group) > 0 && (
                        <AlertBadge count={groupAlerts(group)} small />
                      )}
                      <ChevronDown
                        className={cn("w-3 h-3 transition-transform duration-200", expandedGroups.includes(group.id) ? "rotate-0" : "-rotate-90")}
                      />
                    </span>
                  </button>
                )}

                <AnimatePresence initial={false}>
                  {(!group.label || expandedGroups.includes(group.id)) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-0.5 pt-0.5">
                        {/* ── Les favoris, épinglés en tête de la partie ────
                            L'interface qu'on ouvre vingt fois par jour ne se
                            cherche plus au milieu de quatorze autres. */}
                        {favoritesOf(group).length > 0 && (
                          <div className="mb-1.5 pb-1.5" style={{ borderBottom: "1px dashed rgba(255,184,0,0.22)" }}>
                            <div className="flex items-center gap-1.5 px-3 pb-1">
                              <Star className="w-2.5 h-2.5" style={{ color: "#FFB800", fill: "#FFB800" }} />
                              <span className="text-[8px] font-black uppercase tracking-[0.22em]" style={{ color: "rgba(255,184,0,0.75)" }}>
                                {t("sections.favorites", { defaultValue: "Favoris" })}
                              </span>
                            </div>
                            <div className="space-y-0.5">
                              {favoritesOf(group).map(item => renderNavItem(group, item, true))}
                            </div>
                          </div>
                        )}
                        {group.items.map((item) => renderNavItem(group, item, false))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}

            <div className="my-3 mx-2" style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />

            {(!userPermissions || !userPermissions["Paramètres"] || userPermissions["Paramètres"].voir) && (
              <button
                onClick={() => handleNavigate(settingsPath)}
                className={cn("sidebar-link", activePath === settingsPath ? "sidebar-link-active" : "sidebar-link-inactive")}
              >
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", activePath === settingsPath ? "bg-[#001f5c]/20" : "bg-white/6")}>
                  <Settings className={cn("w-3.5 h-3.5", activePath === settingsPath ? "text-[#001f5c]" : "text-blue-200")} />
                </div>
                <span className="text-sm">{t('nav.settings')}</span>
                {activePath === settingsPath && <ChevronRight className="w-3 h-3 text-[#001f5c]/50 ml-auto" />}
              </button>
            )}
          </div>

          {/* User Profile Footer */}
          <div className="p-4 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 text-[#001f5c]"
                style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)" }}
              >
                {displayInitial}
              </div>

              {/* Name + Badge */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate leading-none">{displayName}</p>
                <span
                  className="inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
                  style={{ background: badge.bg, color: badge.text }}
                >
                  {t(`roles.${userRole}`, { defaultValue: badge.label })}
                </span>
              </div>

              {/* Logout */}
              <button
                className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors group"
                style={{ color: "rgba(147,197,253,0.5)" }}
                title={t('nav.logout')}
                onClick={() => {
                  if (onLogout) {
                    onLogout();
                  }
                }}
              >
                <LogOut className="w-4 h-4 group-hover:text-red-400 transition-colors" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
