import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp, Fuel, ShoppingCart, DollarSign, Activity,
  Clock, Package, Droplets, ArrowUpRight, ArrowDownRight,
  Zap, Users, Calendar, Bell,
  SlidersHorizontal, Save, X, ToggleLeft, ToggleRight, Star
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip
} from "recharts";
import ChartBox from "../components/ChartBox";
import { useAppState, useAppDispatch } from "../store/AppContext";
import { derivedFuelSales } from "../lib/carburantSales";
import { MODULES } from "../lib/bizConfig";
import { useNavigate } from "react-router-dom";
import AlertsWidget, { AlertItem, useDismissedAlerts, useCurrentUserAlerts } from "../components/AlertsWidget";

/* ─── Animated counter ─── */
const AnimatedCounter = ({ value, suffix = "" }: { value: number; suffix?: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = Math.round(value);
    if (end === 0) { setCount(0); return; }
    const inc = end / 50;
    const t = setInterval(() => {
      start += inc;
      if (start >= end) { setCount(end); clearInterval(t); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(t);
  }, [value]);
  return <span>{count.toLocaleString("fr-DZ")}{suffix}</span>;
};

/* ─── Tank progress bar ─── */
/** Le niveau seul : les alertes de cuve vivent dans la cloche de la barre de
 *  navigation, cette barre ne fait que colorer ce qui est bas. */
const TankBar = ({ tank }: any) => {
  const pct = Math.min(100, (tank.current / tank.capacity) * 100);
  const isLow = tank.current < tank.alertThreshold;
  const color = isLow ? "#ef4444" : pct < 50 ? "#FFB800" : "#22c55e";
  const typeColors: Record<string, string> = {
    ESSENCE: "#3b82f6", GASOIL: "#22c55e", GPL: "#f97316", DIESEL: "#22c55e", SUPER: "#8b5cf6"
  };
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase"
              style={{ background: (typeColors[tank.type] || "#64748b") + "20", color: typeColors[tank.type] || "#64748b" }}>
              {tank.type}
            </span>
            <span className="text-xs font-bold text-slate-700 truncate">{tank.name}</span>
          </div>
          <span className="text-xs font-black tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1.3, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${color}bb, ${color})` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-400">{tank.current.toLocaleString("fr-DZ")} L</span>
          <span className="text-[10px] text-slate-400">{tank.capacity.toLocaleString("fr-DZ")} L</span>
        </div>
      </div>
    </div>
  );
};

/* ─── KPI card ─── */
const KpiCard = ({ label, value, suffix, icon: Icon, color, trend, trendPos, delay, progress }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 18 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, ease: "easeOut" }}
    className="stat-card cursor-default overflow-hidden relative"
  >
    <div className="absolute top-0 right-0 w-28 h-28 rounded-full pointer-events-none"
      style={{ background: color + "12", transform: "translate(35%,-35%)" }} />
    <div className="flex items-start justify-between mb-4">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${color}22, ${color}11)` }}>
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      {trend && (
        <div className={cn(
          "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black",
          trendPos ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        )}>
          {trendPos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {trend}
        </div>
      )}
    </div>
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "#94a3b8" }}>{label}</p>
      <p className="text-2xl font-black leading-none mb-3" style={{ color: "var(--naftal-blue-700)" }}>
        <AnimatedCounter value={value} suffix={suffix} />
      </p>
      {progress !== undefined && (
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-3">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, delay: delay + 0.2 }}
            className="h-full rounded-full"
            style={{ backgroundColor: color }}
          />
        </div>
      )}
    </div>
  </motion.div>
);

/* ─── Cuve level cards (one card per cuve) ─── */
/**
 * Live niveau of every cuve, as cards. A cuve below its `alertThreshold` turns
 * red, one below 1.5× the threshold turns amber — c'est un ÉTAT, pas une
 * alerte : les alertes de cuve ne s'affichent plus que dans la cloche de la
 * barre de navigation. GPL cuves show a percentage, the others their degrees.
 */
const TankLevelCards = ({ tanks, delay = 0.15 }: { tanks: any[]; delay?: number }) => {
  if (!tanks || tanks.length === 0) return null;

  const favorites = tanks.filter(t => !!t.isFavorite).length;
  // Les cuves épinglées passent devant : ce sont celles que le gérant regarde
  // en premier, elles ne doivent pas se perdre au milieu des autres.
  const ordered = tanks.slice().sort((a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite));

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,184,0,0.15)" }}>
            <Fuel className="w-4 h-4" style={{ color: "#FFB800" }} />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--naftal-blue-600)" }}>
              Niveaux des Cuves
            </h3>
            <p className="text-[10px] text-slate-400">
              {tanks.length} cuve(s) • mise à jour en direct
              {favorites > 0 ? ` • ${favorites} en favori affichée(s) en premier` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ordered.map((t, i) => {
          const capacity = Number(t.capacity) || 0;
          const current = Number(t.current) || 0;
          const threshold = Number(t.alertThreshold) || 0;
          const pct = capacity > 0 ? Math.min(100, (current / capacity) * 100) : 0;
          const critical = current < threshold;
          const low = !critical && threshold > 0 && current < threshold * 1.5;
          const color = critical ? "#ef4444" : low ? "#f59e0b" : "#22c55e";
          const available = Math.max(0, capacity - current);

          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: delay + i * 0.04 }}
              className="card-glass relative overflow-hidden p-5"
              style={critical
                ? { boxShadow: "0 0 0 2px rgba(239,68,68,0.25)" }
                : t.isFavorite ? { boxShadow: "0 0 0 2px rgba(255,184,0,0.35)" } : undefined}
            >
              <div className="h-1 absolute top-0 left-0 right-0" style={{ background: color }} />

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-black text-slate-800 truncate flex items-center gap-1.5">
                    {t.isFavorite && <Star className="w-3.5 h-3.5 text-amber-500 fill-current shrink-0" />}
                    <span className="truncate">{t.name}</span>
                  </h4>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t.type}</p>
                </div>
                <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase whitespace-nowrap"
                  style={{ background: color + "1a", color }}>
                  {critical ? "Critique" : low ? "Bas" : "OK"}
                </span>
              </div>

              <p className="text-2xl font-black tabular-nums mt-3 leading-none" style={{ color: "var(--naftal-blue-700)" }}>
                {current.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}
                <span className="text-sm font-bold text-slate-400"> L</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                sur {capacity.toLocaleString("fr-FR")} L • {pct.toFixed(1)}%
              </p>

              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden mt-3">
                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: delay + 0.15 }}
                  className="h-full rounded-full" style={{ backgroundColor: color }} />
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Disponible</p>
                  <p className="text-xs font-black text-slate-700 tabular-nums">{available.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} L</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Seuil</p>
                  <p className="text-xs font-black text-slate-700 tabular-nums">{threshold.toLocaleString("fr-FR")} L</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[9px] uppercase font-bold text-slate-400">{t.type === "GPL" ? "Jauge" : "Degrés"}</p>
                  <p className="text-xs font-black text-slate-700 tabular-nums">
                    {Number(t.degrees || 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}{t.type === "GPL" ? " %" : " °"}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

/* ─── Tanks panel (shared across worker roles) ─── */
const TanksPanel = ({ tanks, delay = 0.2 }: { tanks: any[]; delay?: number }) => (
  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
    className="card-glass p-6">
    <div className="flex items-center gap-2.5 mb-5">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,184,0,0.15)" }}>
        <Fuel className="w-4 h-4" style={{ color: "#FFB800" }} />
      </div>
      <div>
        <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--naftal-blue-600)" }}>État des Cuves</h3>
        <p className="text-[10px] text-slate-400">{tanks.length} cuve(s) configurée(s)</p>
      </div>
    </div>
    <div className="space-y-4">
      {tanks.length === 0
        ? <p className="text-slate-400 text-sm text-center py-8">Aucune cuve configurée</p>
        : tanks.map(t => <TankBar key={t.id} tank={t} />)}
    </div>
  </motion.div>
);

/* ─── Tableau de bord d'un employé — ses alertes, et rien d'autre ─── */
/**
 * Un employé n'a pas à voir l'argent de la station sur son écran d'accueil : ni
 * les ventes du jour, ni ce qu'il a encaissé, ni la valeur d'un stock. Son
 * tableau de bord ne montre donc QUE les alertes de sa partie — cuves et pompes
 * pour la piste, stock pour le magasin, la Cafétéria ou le Lavage pour leurs
 * employés — c'est-à-dire exactement ce qu'il a à traiter.
 *
 * La liste est la même que celle de la cloche de la barre de navigation
 * (`useCurrentUserAlerts`) : les deux ne peuvent pas se contredire.
 */
const WorkerAlertsBoard = ({ alerts, onDismiss, partLabel }: {
  alerts: AlertItem[]; onDismiss: (id: string) => void; partLabel: string;
}) => {
  const counts = useMemo(() => ({
    critical: alerts.filter(a => a.type === 'critical').length,
    warning: alerts.filter(a => a.type === 'warning').length,
    info: alerts.filter(a => a.type === 'info').length,
  }), [alerts]);

  const tiles = [
    { label: "Critiques", value: counts.critical, color: "#ef4444" },
    { label: "Avertissements", value: counts.warning, color: "#f59e0b" },
    { label: "Informations", value: counts.info, color: "#3b82f6" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
      className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(0,48,135,0.08)" }}>
          <Bell className="w-5 h-5" style={{ color: "var(--naftal-blue-600)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--naftal-blue-600)" }}>
            Mes alertes
          </h3>
          <p className="text-[11px] text-slate-400">{partLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="p-4 rounded-2xl border bg-white shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t.label}</p>
            <p className="text-2xl font-black leading-none mt-1 tabular-nums" style={{ color: t.value > 0 ? t.color : "#cbd5e1" }}>
              {t.value}
            </p>
          </div>
        ))}
      </div>

      <AlertsWidget alerts={alerts} onDismiss={onDismiss} groupByPart title="À traiter" />
    </motion.div>
  );
};

/* ─── Dashboard header (outside Dashboard so React.memo prevents remount every tick) ─── */
interface DashboardHeaderProps {
  stationName: string;
  activeBrigade?: { chefId?: string; startTimestamp?: string } | null;
  brigadeChefs: { id: string; name: string }[];
  showBrigadeBadge: boolean;
}

const DashboardHeader = React.memo(({ stationName, activeBrigade, brigadeChefs, showBrigadeBadge }: DashboardHeaderProps) => {
  const [timeStr, setTimeStr] = useState(() =>
    new Date().toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })
  );
  useEffect(() => {
    const t = setInterval(() =>
      setTimeStr(new Date().toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })),
    30000);
    return () => clearInterval(t);
  }, []);

  const dateStr = new Date().toLocaleDateString('fr-DZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl"
      style={{ background: "linear-gradient(135deg,#001233 0%,#002470 55%,#003087 100%)", boxShadow: "0 8px 40px rgba(0,48,135,0.28)" }}
    >
      {/* Decorative glows */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(ellipse at 15% 60%,rgba(255,184,0,0.16) 0%,transparent 55%),radial-gradient(ellipse at 85% 10%,rgba(0,68,187,0.22) 0%,transparent 55%)"
      }} />
      {/* Gold accent line */}
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{
        background: "linear-gradient(90deg,transparent 0%,#FFB800 30%,#FFD55A 50%,#FFB800 70%,transparent 100%)"
      }} />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6 px-8 py-6">
        {/* Station identity */}
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.25)" }}>
            <Fuel className="w-7 h-7" style={{ color: "#FFB800" }} />
          </div>
          <div>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.3em] mb-0.5">Station Service Naftal</p>
            <h1 className="text-3xl font-black text-white leading-none">{stationName}</h1>
            <div className="flex items-center gap-2.5 mt-1.5">
              <p className="text-white/45 text-sm capitalize">{dateStr}</p>
              <span className="w-1 h-1 rounded-full bg-white/25" />
              <p className="text-white/45 text-sm font-mono">{timeStr}</p>
            </div>
          </div>
        </div>

        {/* Brigade active badge */}
        {showBrigadeBadge && activeBrigade && (
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl border border-white/15"
            style={{ background: "rgba(255,255,255,0.07)", backdropFilter: "blur(12px)" }}>
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-green-400" />
            </span>
            <div>
              <p className="text-green-400 text-[10px] font-black uppercase tracking-wider leading-none mb-0.5">Brigade Active</p>
              <p className="text-white font-black text-sm leading-none">
                {brigadeChefs.find(c => c.id === activeBrigade.chefId)?.name || '—'}
              </p>
              {activeBrigade.startTimestamp && (
                <p className="text-white/40 text-[10px] mt-0.5">
                  Depuis {new Date(activeBrigade.startTimestamp).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
});
DashboardHeader.displayName = 'DashboardHeader';

/* ─── Main Dashboard ─── */
const Dashboard = () => {
  const navigate = useNavigate();
  const app = useAppState();
  const {
    tanks, products, brigades, clients, shopSales,
    pompistes, pumps, expenses, brigadeChefs, suppliers,
    currentUserRole, currentModuleWorker, settings,
  } = app;
  const dispatch = useAppDispatch();

  // Les ventes de carburant viennent des BRIGADES : la table `fuel_sales` que
  // cet écran lisait n'est plus alimentée, et la recette du jour comme la courbe
  // des sept derniers jours affichaient donc zéro dinar de carburant.
  const fuelSales = useMemo(() => derivedFuelSales(app), [app]);

  // ── Décalage acceptance settings (per case) ───────────────────────────────
  const [showDecalageSettings, setShowDecalageSettings] = useState(false);
  const [decForm, setDecForm] = useState({
    venteDirecteActif: settings?.decalagePositifActif !== false,
    retourCuveActif: settings?.decalageNegatifActif !== false,
    venteDirecteSeuil: settings?.decalagePositifSeuil ?? 0,
    retourCuveSeuil: settings?.decalageNegatifSeuil ?? 0,
  });
  const openDecalageSettings = () => {
    setDecForm({
      venteDirecteActif: settings?.decalagePositifActif !== false,
      retourCuveActif: settings?.decalageNegatifActif !== false,
      venteDirecteSeuil: settings?.decalagePositifSeuil ?? 0,
      retourCuveSeuil: settings?.decalageNegatifSeuil ?? 0,
    });
    setShowDecalageSettings(true);
  };
  const saveDecalageSettings = () => {
    dispatch({
      type: 'SET_SETTINGS',
      payload: {
        ...settings,
        decalagePositifActif: decForm.venteDirecteActif,
        decalageNegatifActif: decForm.retourCuveActif,
        decalagePositifSeuil: decForm.venteDirecteSeuil,
        decalageNegatifSeuil: decForm.retourCuveSeuil,
      },
    });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: 'Paramètres de décalage enregistrés' } });
    setShowDecalageSettings(false);
  };
  const isAdmin   = currentUserRole === 'admin';
  const isGerant  = currentUserRole === 'gerant';
  // Administrateur et gérant voient la station entière (chiffres compris) ;
  // tout le reste est un employé et n'a droit qu'aux alertes de sa partie.
  const showFull  = isAdmin || isGerant;

  const { dismissedIds, dismiss } = useDismissedAlerts();
  // Exactement la liste de la cloche de la barre de navigation — calculée
  // uniquement pour un employé, l'écran de l'administrateur n'en affiche pas.
  const myAlerts = useCurrentUserAlerts(dismissedIds, !showFull);

  // La partie dont l'employé répond — c'est le sous-titre de ses alertes.
  const myPartLabel = useMemo(() => {
    switch (currentUserRole) {
      case 'module_worker':
        return currentModuleWorker
          ? `Partie ${MODULES[currentModuleWorker.moduleKey]?.label ?? ''}`.trim()
          : 'Ma partie';
      case 'chef_brigade': return 'Ma brigade — cuves, pompes et décalages';
      case 'pompiste':     return 'Piste — cuves et pompes';
      case 'magasin':      return 'Magasin — stock des produits';
      default:             return 'Ma partie';
    }
  }, [currentUserRole, currentModuleWorker]);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const todayStr = now.toISOString().split("T")[0];
  const todayFuelSales  = useMemo(() => fuelSales.filter(s => s.date.startsWith(todayStr)),  [fuelSales,  todayStr]);
  const todayShopSales  = useMemo(() => shopSales.filter(s => s.date.startsWith(todayStr)),  [shopSales,  todayStr]);
  const todayExpenses   = useMemo(() => expenses.filter(e => e.date.startsWith(todayStr)),   [expenses,   todayStr]);

  const fuelRevenue  = useMemo(() => todayFuelSales.reduce((s, x) => s + x.total,  0), [todayFuelSales]);
  const shopRevenue  = useMemo(() => todayShopSales.reduce((s, x) => s + x.total,  0), [todayShopSales]);
  const todayLiters  = useMemo(() => todayFuelSales.reduce((s, x) => s + x.liters, 0), [todayFuelSales]);
  const totalExpense = useMemo(() => todayExpenses.reduce((s, x)  => s + x.amount, 0), [todayExpenses]);
  const netRevenue   = fuelRevenue + shopRevenue - totalExpense;

  /* global active brigade (admin/gerant header badge) */
  const activeBrigade = useMemo(() => brigades.find(b => b.status === "Ouverte"), [brigades]);

  /* upcoming payments (admin/gerant only) */
  const upcomingPayments = useMemo(() => {
    if (!showFull) return [];
    return [
      ...suppliers.flatMap(s => (s.appointments||[]).filter(a => !a.isPaid).map(a => ({...a, name: s.name, type: 'Fournisseur'}))),
      ...clients.flatMap(c  => (c.appointments ||[]).filter(a => !a.isPaid).map(a => ({...a, name: c.name, type: 'Client'}))),
    ].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 5);
  }, [suppliers, clients, showFull]);

  /* chart data (admin/gerant only) */
  const chartData = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (6 - i));
    const ds = d.toISOString().split("T")[0];
    return {
      name: d.toLocaleDateString("fr-FR", { weekday: "short" }),
      Carburant: fuelSales.filter(s => s.date.startsWith(ds)).reduce((a, s) => a + s.total, 0),
      Magasin:   shopSales.filter(s => s.date.startsWith(ds)).reduce((a, s) => a + s.total, 0),
    };
  }), [fuelSales, shopSales, now]);

  /* elapsed timer */
  const elapsed = (ts?: string) => {
    if (!ts) return "00:00:00";
    const diff = now.getTime() - new Date(ts).getTime();
    if (diff < 0) return "00:00:00";
    const h = Math.floor(diff / 3600000).toString().padStart(2, "0");
    const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };


  /* ════════════════════════════════════════════════════════════ */
  /* ADMIN / GÉRANT — full dashboard                             */
  /* ════════════════════════════════════════════════════════════ */
  if (showFull) return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-10">
      <DashboardHeader
        stationName={settings?.name || "Station Naftal"}
        activeBrigade={activeBrigade}
        brigadeChefs={brigadeChefs}
        showBrigadeBadge
      />

      {/* Niveaux des cuves — les alertes, elles, sont dans la cloche de la
          barre de navigation : le tableau de bord n'en affiche plus aucune. */}
      <TankLevelCards tanks={tanks} delay={0.12} />

      {/* Toolbar — décalage acceptance settings */}
      {isAdmin && (
        <div className="flex justify-end -mt-2">
          <button
            onClick={openDecalageSettings}
            className="h-11 px-5 rounded-2xl flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-lg hover:scale-[1.03] transition-all"
            style={{ background: "linear-gradient(135deg,#001f5c,#003087)" }}
          >
            <SlidersHorizontal className="w-4 h-4" style={{ color: "#FFB800" }} />
            Paramètres de Décalage
          </button>
        </div>
      )}

      {/* Décalage settings modal */}
      <AnimatePresence>
        {showDecalageSettings && (
          <div className="modal-shell z-[80]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDecalageSettings(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-2xl rounded-[2rem] relative z-10 overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[var(--modal-max-h)]">
              {/* Header */}
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" style={{ color: '#FFB800' }} /> Paramètres de Décalage</h3>
                  <p className="text-[10px] text-yellow-300 font-bold mt-1">Définissez les écarts acceptables utilisés à l'étape de comparaison lors de la création des brigades</p>
                </div>
                <button onClick={() => setShowDecalageSettings(false)} className="hover:bg-white/20 p-2 rounded-lg transition-all"><X className="w-5 h-5" /></button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5 overflow-y-auto">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-600">
                  Pour chaque cas : si le cas est <b>désactivé</b>, aucune alerte n'est créée. Sinon, un écart <b>inférieur au seuil</b> est considéré acceptable (aucune alerte) ; au-delà du seuil, l'alerte est affichée sur le tableau de bord.
                </div>

                {/* Case 1: Vente directe (cuve a baissé plus que les pistolets) */}
                {(() => {
                  const cases = [
                    {
                      key: 'venteDirecte', title: 'Vente Directe', emoji: '🔴',
                      desc: "La cuve a diminué plus que les pistolets n'ont débité (carburant vendu directement depuis la cuve).",
                      actif: decForm.venteDirecteActif, seuil: decForm.venteDirecteSeuil,
                      setActif: (v: boolean) => setDecForm(f => ({ ...f, venteDirecteActif: v })),
                      setSeuil: (v: number) => setDecForm(f => ({ ...f, venteDirecteSeuil: v })),
                      accent: 'red',
                    },
                    {
                      key: 'retourCuve', title: 'Retour Cuve', emoji: '🟠',
                      desc: "Les pistolets ont débité plus que ce qu'indique la cuve (possible retour cuve non enregistré).",
                      actif: decForm.retourCuveActif, seuil: decForm.retourCuveSeuil,
                      setActif: (v: boolean) => setDecForm(f => ({ ...f, retourCuveActif: v })),
                      setSeuil: (v: number) => setDecForm(f => ({ ...f, retourCuveSeuil: v })),
                      accent: 'orange',
                    },
                  ];
                  return cases.map(c => (
                    <div key={c.key} className={cn("rounded-2xl border-2 overflow-hidden", c.actif ? (c.accent === 'red' ? "border-red-200" : "border-orange-200") : "border-slate-200 opacity-80")}>
                      <div className={cn("px-5 py-3 flex items-center justify-between", c.accent === 'red' ? "bg-red-50" : "bg-orange-50")}>
                        <div>
                          <h4 className={cn("text-[12px] font-black uppercase tracking-widest", c.accent === 'red' ? "text-red-800" : "text-orange-800")}>{c.emoji} {c.title}</h4>
                          <p className="text-[10px] font-bold text-slate-500 mt-0.5 max-w-md">{c.desc}</p>
                        </div>
                        <button onClick={() => c.setActif(!c.actif)} className="flex-shrink-0">
                          {c.actif
                            ? <ToggleRight className={cn("w-10 h-10", c.accent === 'red' ? "text-red-500" : "text-orange-500")} />
                            : <ToggleLeft className="w-10 h-10 text-slate-300" />}
                        </button>
                      </div>
                      <div className="px-5 py-4 bg-white">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Seuil d'écart acceptable (litres)</label>
                        <input type="number" step="0.1" min={0} disabled={!c.actif}
                          value={c.seuil}
                          onChange={e => c.setSeuil(parseFloat(e.target.value) || 0)}
                          className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 font-black text-blue-900 outline-none focus:border-yellow-400 disabled:bg-slate-50 disabled:text-slate-400" />
                        <p className="text-[10px] text-slate-400 font-bold mt-1">État : {c.actif ? <span className={c.accent === 'red' ? "text-red-600" : "text-orange-600"}>✓ Activé — alerte au-delà de {c.seuil} L</span> : <span>✗ Désactivé — jamais d'alerte</span>}</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {/* Footer */}
              <div className="p-5 bg-slate-50 border-t border-slate-200 flex gap-3 shrink-0">
                <button onClick={() => setShowDecalageSettings(false)} className="flex-1 py-3 rounded-xl bg-white border-2 border-slate-200 text-slate-600 font-black text-[11px] uppercase hover:bg-slate-100 transition-all">Annuler</button>
                <button onClick={saveDecalageSettings} className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-blue-900 to-blue-800 text-white font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 hover:shadow-lg transition-all">
                  <Save className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Résumé du Jour */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h3 className="text-sm font-black uppercase tracking-wider mb-3 text-slate-700">Résumé du Jour</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Carburant", value: fuelRevenue,  color: "blue-700",  Icon: Droplets,    bg: "blue-600" },
            { label: "Magasin",   value: shopRevenue,  color: "purple-700", Icon: ShoppingCart, bg: "purple-600" },
            { label: "Dépenses",  value: totalExpense, color: "red-700",   Icon: TrendingUp,  bg: "red-600" },
          ].map(({ label, value, color, Icon, bg }) => (
            <div key={label} className="p-5 rounded-2xl border bg-white shadow-sm flex flex-col justify-center relative overflow-hidden">
              <div className={`absolute -right-6 -bottom-6 opacity-[0.03] text-${bg}`}><Icon className="w-32 h-32" /></div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-1 tracking-wider">{label}</p>
              <p className={`text-2xl font-black text-${color} relative z-10`}>{value.toLocaleString('fr-DZ')} <span className="text-sm">DA</span></p>
            </div>
          ))}
          <div className="p-5 rounded-2xl border bg-white shadow-sm flex flex-col justify-center relative overflow-hidden">
            <div className="absolute -right-6 -bottom-6 opacity-[0.03] text-green-600"><DollarSign className="w-32 h-32" /></div>
            <p className="text-xs font-bold text-slate-500 uppercase mb-1 tracking-wider">NET</p>
            <p className={cn("text-2xl font-black relative z-10", netRevenue >= 0 ? "text-green-700" : "text-red-700")}>
              {netRevenue >= 0 ? "+" : ""}{netRevenue.toLocaleString('fr-DZ')} <span className="text-sm">DA</span>
            </p>
          </div>
        </div>
      </motion.div>


      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
        <KpiCard label="Ventes Totales (Jour)" value={fuelRevenue + shopRevenue} suffix=" DA" icon={DollarSign} color="#003087" trend="+12%" trendPos delay={0}    progress={75} />
        <KpiCard label="Litres Vendus (Jour)"  value={todayLiters}              suffix=" L"  icon={Fuel}       color="#FFB800" trend="+3%"  trendPos delay={0.05} progress={40} />
        <KpiCard label="Dépenses (Jour)"       value={totalExpense}             suffix=" DA" icon={TrendingUp}  color="#ef4444" trend="-5%"  trendPos={false} delay={0.1} progress={20} />
        <KpiCard label="Clients Actifs"        value={clients.length}           suffix=""    icon={Users}      color="#22c55e" delay={0.15} progress={90} />
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">

          {/* Sales Chart */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card-glass p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--naftal-blue-600)" }}>Évolution des Ventes</h3>
                <p className="text-xs text-slate-400 mt-0.5">7 derniers jours</p>
              </div>
              <div className="flex gap-4">
                {[["#003087","Carburant"],["#FFB800","Magasin"]].map(([c,l]) => (
                  <span key={l} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}
                  </span>
                ))}
              </div>
            </div>
            <ChartBox height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="gFuel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#003087" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#003087" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gShop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#FFB800" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#FFB800" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: "#94a3b8" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: "#94a3b8" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 32px rgba(0,48,135,0.12)", fontSize: 12, fontWeight: 700 }}
                  cursor={{ stroke: "#003087", strokeWidth: 1.5, strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="Carburant" stroke="#003087" strokeWidth={2.5} fill="url(#gFuel)" dot={false} activeDot={{ r: 5, fill: "#003087" }} />
                <Area type="monotone" dataKey="Magasin"   stroke="#FFB800" strokeWidth={2.5} fill="url(#gShop)" dot={false} activeDot={{ r: 5, fill: "#FFB800" }} />
              </AreaChart>
            </ChartBox>
          </motion.div>

          <TanksPanel tanks={tanks} delay={0.25} />
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Brigade Active */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="card-naftal p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4" style={{ color: "var(--naftal-blue-600)" }} />
              <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--naftal-blue-600)" }}>Brigade Active</h3>
              {activeBrigade && (
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-green-600">En service</span>
                </div>
              )}
            </div>
            {activeBrigade ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-black text-white flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#003087,#0044bb)" }}>
                    {(brigadeChefs.find(c => c.id === activeBrigade.chefId)?.name || "C")[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-black text-sm" style={{ color: "var(--naftal-blue-700)" }}>
                      {brigadeChefs.find(c => c.id === activeBrigade.chefId)?.name || "Chef"}
                    </p>
                    <p className="text-xs text-slate-400">{activeBrigade.shift} · {activeBrigade.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl p-3 mb-4"
                  style={{ background: "rgba(0,48,135,0.06)", border: "1px solid rgba(0,48,135,0.08)" }}>
                  <Clock className="w-4 h-4" style={{ color: "var(--naftal-blue-600)" }} />
                  <span className="font-black text-lg tracking-tighter font-mono" style={{ color: "var(--naftal-blue-700)" }}>
                    {elapsed(activeBrigade.startTimestamp)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeBrigade.pompisteIds?.map(pid => (
                    <span key={pid} className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold">
                      {pompistes.find(p => p.id === pid)?.name || pid}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(0,48,135,0.06)" }}>
                  <Activity className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-sm text-slate-400 mb-4">Aucune brigade en service</p>
                <button onClick={() => navigate("/brigades")} className="btn-primary text-xs px-4 py-2">Démarrer une Brigade</button>
              </div>
            )}
          </motion.div>

          {/* Prochains RDV */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }} className="card-glass p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--naftal-blue-600)" }}>Prochains RDV</h3>
              <Calendar className="w-4 h-4 text-slate-400" />
            </div>
            <div className="space-y-3">
              {upcomingPayments.length === 0
                ? <p className="text-slate-400 text-xs text-center py-4">Aucun RDV à venir</p>
                : upcomingPayments.map((app, i) => {
                  const diff = Math.ceil((new Date(app.date).getTime() - now.getTime()) / 86400000);
                  const isLate = diff < 0;
                  return (
                    <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-white/50">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold",
                        isLate ? "bg-red-500" : diff <= 3 ? "bg-orange-500" : "bg-blue-500")}>
                        {new Date(app.date).getDate()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 truncate">{app.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-black uppercase",
                            app.type === 'Client' ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700")}>
                            {app.type}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {isLate ? <span className="text-red-600 font-bold">En retard ({Math.abs(diff)}j)</span> : `Dans ${diff} jour(s)`}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-black tabular-nums whitespace-nowrap">{app.amount.toLocaleString("fr-DZ")} DA</span>
                    </div>
                  );
                })}
            </div>
          </motion.div>

          {/* Quick Stats */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="card-glass p-5">
            <h3 className="text-xs font-black uppercase tracking-wider mb-4" style={{ color: "var(--naftal-blue-600)" }}>Statistiques Rapides</h3>
            <div className="space-y-2">
              {[
                { label: "Pompes actives",    value: pumps.filter(p => p.status === "Actif").length, icon: Zap,     color: "#22c55e" },
                { label: "Total clients",     value: clients.length,                                  icon: Users,   color: "#FFB800" },
                { label: "Produits en stock", value: products.length,                                 icon: Package, color: "#8b5cf6" },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 cursor-default">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.color + "18" }}>
                    <s.icon className="w-4 h-4" style={{ color: s.color }} />
                  </div>
                  <span className="text-sm text-slate-600 flex-1">{s.label}</span>
                  <span className="text-sm font-black" style={{ color: "var(--naftal-blue-700)" }}>{s.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );

  /* ════════════════════════════════════════════════════════════ */
  /* EMPLOYÉS — chef de brigade, pompiste, magasin, employé d'une */
  /* partie (Cafétéria / Lavage) : UNIQUEMENT leurs alertes.      */
  /*                                                              */
  /* Plus aucun chiffre d'argent ici : ni ventes du jour, ni       */
  /* montant collecté, ni valeur de stock. L'employé voit ce qu'il */
  /* a à traiter dans sa partie, et rien d'autre.                  */
  /* ════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-10">
      <DashboardHeader
        stationName={settings?.name || "Station Naftal"}
        activeBrigade={activeBrigade}
        brigadeChefs={brigadeChefs}
        showBrigadeBadge={false}
      />
      <WorkerAlertsBoard alerts={myAlerts} onDismiss={dismiss} partLabel={myPartLabel} />
    </div>
  );
};

export default Dashboard;
