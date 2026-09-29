import React, { useMemo, useState, useEffect } from 'react';
import {
  AlertCircle, AlertTriangle, ChevronRight, X, Package, Droplets, Calendar, Wallet, Bell,
  Trash2, CheckCircle2, Gauge, ClipboardList, ShoppingCart, Timer,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { BrigadeDecalageAlert, FuelInvoice, Purchase, useAppState } from '../store/AppContext';
import { useBizAll } from '../store/BizContext';
import { MODULES, ModuleKey, ModuleState } from '../lib/bizConfig';
import { pendingAppointments } from '../lib/paymentAppointments';

export interface AlertItem {
  id: string;
  type: 'critical' | 'warning' | 'info';
  icon: string;
  message: string;
  link: string;
  date: Date;
  /**
   * Partie d'où vient l'alerte — « Cuves », « Magasin », « Cafétéria »…
   * C'est ce qui permet à l'employé de ne voir QUE sa partie, et au tableau de
   * bord de regrouper les alertes partie par partie.
   */
  part?: string;
}

interface AlertsWidgetProps {
  alerts: AlertItem[];
  onDismiss: (id: string) => void;
  /** Regroupe les alertes par partie au lieu d'une liste unique tronquée. */
  groupByPart?: boolean;
  title?: string;
}

const colorMap = {
  critical: {
    bg: 'bg-red-50/50',
    border: 'border-red-100',
    text: 'text-red-700',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
    label: 'Critique',
  },
  warning: {
    bg: 'bg-orange-50/50',
    border: 'border-orange-100',
    text: 'text-orange-700',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
    badge: 'bg-orange-100 text-orange-700',
    label: 'Avertissement',
  },
  info: {
    bg: 'bg-blue-50/50',
    border: 'border-blue-100',
    text: 'text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Information',
  },
};

const getIcon = (iconName: string) => {
  const icons: Record<string, React.ReactNode> = {
    Package: <Package className="w-4 h-4" />,
    AlertTriangle: <AlertTriangle className="w-4 h-4" />,
    Droplets: <Droplets className="w-4 h-4" />,
    Calendar: <Calendar className="w-4 h-4" />,
    Wallet: <Wallet className="w-4 h-4" />,
    Gauge: <Gauge className="w-4 h-4" />,
    ClipboardList: <ClipboardList className="w-4 h-4" />,
    ShoppingCart: <ShoppingCart className="w-4 h-4" />,
    Timer: <Timer className="w-4 h-4" />,
  };
  return icons[iconName] || <AlertCircle className="w-4 h-4" />;
};

/* ─── Une ligne d'alerte ─── */
const AlertRow: React.FC<{ alert: AlertItem; onDismiss: (id: string) => void; index?: number }> = ({
  alert, onDismiss, index = 0,
}) => {
  const colors = colorMap[alert.type];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, height: 0 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
      className={cn(
        'p-3 rounded-2xl border flex items-center gap-4 shadow-sm backdrop-blur-sm transition-all hover:shadow-md',
        colors.bg,
        colors.border
      )}
    >
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colors.iconBg)}>
        <div className={cn(colors.iconColor)}>{getIcon(alert.icon)}</div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-black uppercase', colors.badge)}>
            {colors.label}
          </span>
          {alert.part && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-100 text-slate-500">
              {alert.part}
            </span>
          )}
          <p className={cn('font-bold text-sm truncate', colors.text)}>{alert.message}</p>
        </div>
        <p className={cn('text-xs opacity-60 mt-0.5', colors.text)}>
          {alert.date.toLocaleDateString('fr-DZ', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onDismiss(alert.id)}
          className={cn('p-1.5 rounded-lg transition-colors hover:bg-white/50', colors.text)}
          title="Ignorer cette alerte"
        >
          <X className="w-4 h-4 opacity-50 hover:opacity-100" />
        </button>
      </div>
    </motion.div>
  );
};

const AlertsWidget: React.FC<AlertsWidgetProps> = ({ alerts, onDismiss, groupByPart = false, title = 'Alertes' }) => {
  const [expanded, setExpanded] = useState(false);

  // Ordre : critique d'abord, puis avertissement, puis information.
  const sortedAlerts = useMemo(() => sortAlerts(alerts), [alerts]);

  // Une entrée par partie, dans l'ordre d'apparition des alertes les plus graves.
  const groups = useMemo(() => {
    const map = new Map<string, AlertItem[]>();
    sortedAlerts.forEach(a => {
      const key = a.part || 'Général';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return Array.from(map.entries());
  }, [sortedAlerts]);

  const displayedAlerts = expanded ? sortedAlerts : sortedAlerts.slice(0, 5);
  const hiddenCount = sortedAlerts.length - 5;

  if (alerts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 bg-green-50/50 rounded-2xl border border-green-100 flex items-center gap-4"
      >
        <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center shadow-inner">
          <CheckCircle2 className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h3 className="font-black text-green-700">Tout est en ordre ✓</h3>
          <p className="text-sm text-green-600">Aucune alerte pour le moment</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">{title}</h3>
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold">
          {alerts.length}
        </span>
      </div>

      {groupByPart ? (
        <div className="space-y-5">
          {groups.map(([part, list]) => (
            <div key={part} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{part}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black">
                  {list.length}
                </span>
                <span className="flex-1 h-px bg-slate-100" />
              </div>
              <div className="space-y-3">
                <AnimatePresence>
                  {list.map((alert, idx) => (
                    <AlertRow key={alert.id} alert={alert} onDismiss={onDismiss} index={idx} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <AnimatePresence>
              {displayedAlerts.map((alert, idx) => (
                <AlertRow key={alert.id} alert={alert} onDismiss={onDismiss} index={idx} />
              ))}
            </AnimatePresence>
          </div>

          {hiddenCount > 0 && (
            <motion.button
              onClick={() => setExpanded(!expanded)}
              className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center gap-1"
            >
              {expanded ? "Voir moins" : `Voir toutes les alertes (${hiddenCount})`}
            </motion.button>
          )}
        </>
      )}
    </motion.div>
  );
};

export default AlertsWidget;

/**
 * Hook pour gérer les alertes ignorées via localStorage
 */
export function useDismissedAlerts() {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('stationpro_dismissed_alerts');
    if (stored) {
      try {
        setDismissedIds(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse dismissed alerts', e);
      }
    }
  }, []);

  const dismiss = (id: string) => {
    setDismissedIds(prev => {
      const updated = [...prev, id];
      localStorage.setItem('stationpro_dismissed_alerts', JSON.stringify(updated));
      return updated;
    });
  };

  const restore = (id: string) => {
    setDismissedIds(prev => {
      const updated = prev.filter(d => d !== id);
      localStorage.setItem('stationpro_dismissed_alerts', JSON.stringify(updated));
      return updated;
    });
  };

  const clearAll = () => {
    setDismissedIds([]);
    localStorage.removeItem('stationpro_dismissed_alerts');
  };

  return { dismissedIds, dismiss, restore, clearAll };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTRUCTION DES ALERTES

   Toutes les alertes de l'application sont fabriquées ici, partie par partie,
   et s'affichent à UN SEUL endroit : la cloche de la barre de navigation (plus
   le tableau de bord d'un employé, qui ne montre QUE les alertes de sa partie).
   Le tableau de bord de l'administrateur, lui, n'en affiche plus aucune.
   ═══════════════════════════════════════════════════════════════════════════ */

const PART_TANKS = 'Cuves';
const PART_PUMPS = 'Pompes';
const PART_SHOP = 'Magasin';
const PART_BRIGADES = 'Brigades';
const PART_MONEY = 'Paiements';

/** N'ajoute l'alerte que si l'utilisateur ne l'a pas écartée. */
function push(list: AlertItem[], dismissed: string[] | undefined, alert: AlertItem) {
  if (!dismissed?.includes(alert.id)) list.push(alert);
}

/** Critique d'abord, puis avertissement, puis information. */
function sortAlerts(alerts: AlertItem[]): AlertItem[] {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return [...alerts].sort((a, b) => rank[a.type] - rank[b.type]);
}

/**
 * CUVES — une cuve sous son seuil est critique, une cuve qui s'en approche
 * (moins d'une fois et demie le seuil) est un avertissement. C'est le contenu
 * de l'ancien bandeau « Alertes des cuves » du tableau de bord.
 */
function tankAlerts(tanks?: any[], dismissed?: string[]): AlertItem[] {
  const out: AlertItem[] = [];
  (tanks || []).forEach(t => {
    const current = Number(t.current) || 0;
    const threshold = Number(t.alertThreshold) || 0;
    if (threshold <= 0) return;

    if (current <= threshold) {
      push(out, dismissed, {
        id: `tank-critical-${t.id}`,
        type: 'critical',
        icon: 'Droplets',
        message: `Cuve critique : ${t.name} — ${current.toLocaleString('fr-DZ')} L restant(s), réapprovisionnement requis`,
        link: '/tanks',
        date: new Date(),
        part: PART_TANKS,
      });
    } else if (current < threshold * 1.5) {
      push(out, dismissed, {
        id: `tank-low-${t.id}`,
        type: 'warning',
        icon: 'Gauge',
        message: `Niveau bas : ${t.name} — ${current.toLocaleString('fr-DZ')} L (seuil ${threshold.toLocaleString('fr-DZ')} L)`,
        link: '/tanks',
        date: new Date(),
        part: PART_TANKS,
      });
    }
  });
  return out;
}

/** POMPES — une pompe hors service arrête une piste, une en maintenance prévient. */
function pumpAlerts(pumps?: any[], dismissed?: string[]): AlertItem[] {
  const out: AlertItem[] = [];
  (pumps || []).forEach(p => {
    if (p.status === 'Hors service') {
      push(out, dismissed, {
        id: `pump-down-${p.id}`,
        type: 'critical',
        icon: 'AlertTriangle',
        message: `Pompe hors service : ${p.name || p.number}`,
        link: '/pumps',
        date: new Date(),
        part: PART_PUMPS,
      });
    } else if (p.status === 'Maintenance') {
      push(out, dismissed, {
        id: `pump-maint-${p.id}`,
        type: 'warning',
        icon: 'AlertTriangle',
        message: `Pompe en maintenance : ${p.name || p.number}`,
        link: '/pumps',
        date: new Date(),
        part: PART_PUMPS,
      });
    }
  });
  return out;
}

/** MAGASIN — rupture et stock bas du catalogue de la station. */
function shopProductAlerts(products?: any[], dismissed?: string[]): AlertItem[] {
  const out: AlertItem[] = [];
  (products || []).forEach(p => {
    if (p.stock === 0) {
      push(out, dismissed, {
        id: `out-of-stock-${p.id}`,
        type: 'critical',
        icon: 'AlertTriangle',
        message: `RUPTURE : ${p.name} — stock à zéro`,
        link: '/products',
        date: new Date(),
        part: PART_SHOP,
      });
    } else if (p.stock <= p.minStock) {
      push(out, dismissed, {
        id: `low-stock-${p.id}`,
        type: 'warning',
        icon: 'Package',
        message: `Stock bas : ${p.name} (${p.stock} ${p.unit} restant)`,
        link: '/products',
        date: new Date(),
        part: PART_SHOP,
      });
    }
  });
  return out;
}

/**
 * BRIGADES — les décalages constatés entre les cuves et les pistolets.
 * `chefId` restreint la liste au chef concerné : chacun ne voit que ses
 * propres brigades.
 */
function decalageAlerts(
  list?: BrigadeDecalageAlert[],
  dismissed?: string[],
  chefId?: string,
): AlertItem[] {
  const out: AlertItem[] = [];
  (list || [])
    .filter(a => !a.isDismissed && a.alertType !== 'CORRECT')
    .filter(a => !chefId || a.chefId === chefId)
    .forEach(a => {
      const isRetour = a.alertType === 'RETOUR_CUVE';
      push(out, dismissed, {
        id: `decalage-${a.id}`,
        type: 'warning',
        icon: 'AlertTriangle',
        message: isRetour
          ? `Décalage ${a.tankName ? `sur ${a.tankName} ` : ''}: les pistolets ont débité plus que la cuve (${a.decalageLiters.toLocaleString('fr-DZ', { maximumFractionDigits: 1 })} L)`
          : `Décalage ${a.tankName ? `sur ${a.tankName} ` : ''}: la cuve a diminué plus que les pistolets (${a.decalageLiters.toLocaleString('fr-DZ', { maximumFractionDigits: 1 })} L)`,
        link: '/brigades',
        date: new Date(a.createdAt || Date.now()),
        part: PART_BRIGADES,
      });
    });
  return out;
}

/**
 * UNE PARTIE COMMERCIALE (Cafétéria / Lavage) — ce qui doit être traité dans la
 * partie où l'employé travaille. Aucune de ces alertes ne contient de montant :
 * un employé voit ce qu'il doit faire, pas l'argent de la station.
 */
function bizPartAlerts(state: ModuleState | undefined, key: ModuleKey, dismissed?: string[]): AlertItem[] {
  if (!state) return [];
  const cfg = MODULES[key];
  const part = cfg.label;
  const out: AlertItem[] = [];
  const todayStr = new Date().toISOString().split('T')[0];
  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);
  const in7DaysStr = in7Days.toISOString().split('T')[0];

  // 1. Stock — rupture puis stock bas (les matières premières comptent aussi :
  //    sans elles, la production s'arrête).
  (state.products || []).forEach(p => {
    const qty = Number(p.currentQty) || 0;
    const min = Number(p.minQty) || 0;
    if (qty <= 0) {
      push(out, dismissed, {
        id: `${key}-out-of-stock-${p.id}`,
        type: 'critical',
        icon: 'AlertTriangle',
        message: `RUPTURE : ${p.name} — plus rien en stock`,
        link: `${cfg.base}/stock`,
        date: new Date(),
        part,
      });
    } else if (min > 0 && qty <= min) {
      push(out, dismissed, {
        id: `${key}-low-stock-${p.id}`,
        type: 'warning',
        icon: 'Package',
        message: `Stock bas : ${p.name} (${qty}${p.unit ? ` ${p.unit}` : ''} restant, seuil ${min})`,
        link: `${cfg.base}/stock`,
        date: new Date(),
        part,
      });
    }

    // 2. Péremption — périmé aujourd'hui, ou dans les 7 jours.
    if (p.hasExpiration && p.expirationDate && qty > 0) {
      if (p.expirationDate < todayStr) {
        push(out, dismissed, {
          id: `${key}-expired-${p.id}`,
          type: 'critical',
          icon: 'Timer',
          message: `Produit périmé : ${p.name} (depuis le ${p.expirationDate}) — à retirer du rayon`,
          link: `${cfg.base}/stock`,
          date: new Date(p.expirationDate),
          part,
        });
      } else if (p.expirationDate <= in7DaysStr) {
        push(out, dismissed, {
          id: `${key}-expiring-${p.id}`,
          type: 'warning',
          icon: 'Timer',
          message: `Péremption proche : ${p.name} (le ${p.expirationDate})`,
          link: `${cfg.base}/stock`,
          date: new Date(p.expirationDate),
          part,
        });
      }
    }
  });

  // 3. Inventaires — un comptage laissé en route, ou des écarts calculés dont
  //    le stock n'a pas encore été corrigé.
  (state.inventaires || []).forEach(inv => {
    if (inv.status === 'draft') {
      push(out, dismissed, {
        id: `${key}-inv-draft-${inv.id}`,
        type: 'info',
        icon: 'ClipboardList',
        message: `Inventaire ${inv.ref} en brouillon — comptage à terminer`,
        link: `${cfg.base}/inventaire`,
        date: new Date(inv.createdAt || Date.now()),
        part,
      });
    } else if (inv.status === 'completed') {
      push(out, dismissed, {
        id: `${key}-inv-completed-${inv.id}`,
        type: 'info',
        icon: 'ClipboardList',
        message: `Inventaire ${inv.ref} terminé — comparaison à lancer`,
        link: `${cfg.base}/inventaire`,
        date: new Date(inv.completedAt || inv.createdAt || Date.now()),
        part,
      });
    } else if (inv.status === 'compared') {
      const manquants = inv.comparison?.lossQty || 0;
      push(out, dismissed, {
        id: `${key}-inv-compared-${inv.id}`,
        type: 'warning',
        icon: 'ClipboardList',
        message: `Inventaire ${inv.ref} : ${inv.comparison?.productsWithEcart || 0} écart(s)${manquants > 0 ? `, ${manquants} unité(s) manquante(s)` : ''} — stock pas encore corrigé`,
        link: `${cfg.base}/inventaire`,
        date: new Date(inv.comparison?.at || inv.createdAt || Date.now()),
        part,
      });
    }
  });

  // 4. Sessions de caisse restées ouvertes.
  (state.sessions || []).filter(s => s.status === 'open').forEach(s => {
    push(out, dismissed, {
      id: `${key}-session-open-${s.id}`,
      type: 'info',
      icon: 'ShoppingCart',
      message: `Session de caisse ouverte : ${s.workerName || '—'} (depuis le ${new Date(s.openedAt).toLocaleDateString('fr-DZ')})`,
      link: `${cfg.base}/pos`,
      date: new Date(s.openedAt || Date.now()),
      part,
    });
  });

  // 5. Demandes d'encaissement en attente (partie service uniquement).
  if (cfg.isService) {
    const pending = (state.payRequests || []).filter(r => r.status === 'pending');
    if (pending.length > 0) {
      push(out, dismissed, {
        id: `${key}-payrequests-pending`,
        type: 'warning',
        icon: 'Wallet',
        message: `${pending.length} demande(s) d'encaissement en attente`,
        link: `${cfg.base}/encaissements`,
        date: new Date(),
        part,
      });
    }

    // 6. Interventions non terminées.
    const openJobs = (state.reparations || []).filter(r => r.status === 'pending');
    if (openJobs.length > 0) {
      push(out, dismissed, {
        id: `${key}-reparations-pending`,
        type: 'info',
        icon: 'ClipboardList',
        message: `${openJobs.length} intervention(s) en cours à finaliser`,
        link: `${cfg.base}/reparations`,
        date: new Date(),
        part,
      });
    }
  }

  return out;
}

/**
 * STATION — les alertes réservées à l'administrateur et au gérant : elles
 * parlent d'argent (rendez-vous fournisseurs, factures, acomptes) et n'ont donc
 * rien à faire sur l'écran d'un employé.
 */
function stationMoneyAlerts(
  suppliers?: any[],
  workers?: any[],
  fuelInvoices?: FuelInvoice[],
  purchases?: Purchase[],
  dismissed?: string[],
): AlertItem[] {
  const out: AlertItem[] = [];
  const todayStr = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);
  const in7DaysStr = in7Days.toISOString().split('T')[0];

  // RDV fournisseurs en retard
  suppliers?.forEach(s => {
    (s.appointments || []).filter((a: any) => !a.isPaid && a.date < todayStr).forEach((a: any) => {
      push(out, dismissed, {
        id: `supplier-late-${a.id}`,
        type: 'critical',
        icon: 'Calendar',
        message: `RDV en retard : ${s.name} — ${a.amount.toLocaleString()} DA (dû le ${a.date})`,
        link: '/suppliers',
        date: new Date(a.date),
        part: PART_MONEY,
      });
    });
  });

  // Acomptes non payés depuis plus de 30 jours
  (workers || []).forEach(w => {
    const oldAcomptes = (w.acomptes || []).filter((a: any) => !a.isPaid && new Date(a.date) < thirtyDaysAgo);
    if (oldAcomptes.length > 0) {
      const total = oldAcomptes.reduce((sum: number, a: any) => sum + a.amount, 0);
      push(out, dismissed, {
        id: `old-acompte-${w.id}`,
        type: 'info',
        icon: 'Wallet',
        message: `${w.name} — ${oldAcomptes.length} acompte(s) en attente (${total.toLocaleString()} DA)`,
        link: '/pompistes',
        date: new Date(),
        part: PART_MONEY,
      });
    }
  });

  // Factures carburant — rendez-vous de paiement dans les 7 jours
  fuelInvoices?.filter(f =>
    f.status !== 'Payé' &&
    f.appointmentDate &&
    f.appointmentDate >= todayStr &&
    f.appointmentDate <= in7DaysStr
  ).forEach(f => {
    push(out, dismissed, {
      id: `fuel-invoice-appt-${f.id}`,
      type: 'warning',
      icon: 'Calendar',
      message: `Facture carburant N°${f.invoiceNumber} — Rendez-vous paiement le ${f.appointmentDate} (${f.total.toLocaleString('fr-DZ')} DA)`,
      link: '/fuel-purchases',
      date: new Date(f.appointmentDate!),
      part: PART_MONEY,
    });
  });

  // Rendez-vous de paiement programmés sur un achat carburant. Même source que
  // le bandeau du tableau de bord, pour qu'ils ne puissent pas se contredire.
  pendingAppointments(purchases || []).forEach(a => {
    const who = suppliers?.find(s => s.id === a.supplierId)?.name || 'Fournisseur';
    const ref = a.invoiceNumber ? `Facture ${a.invoiceNumber}` : a.blNumber ? `BL ${a.blNumber}` : 'Achat carburant';
    push(out, dismissed, {
      id: `purchase-appt-${a.purchaseId}`,
      type: a.urgency === 'overdue' ? 'critical' : 'warning',
      icon: 'Calendar',
      message: a.daysLeft < 0
        ? `${who} — ${ref} : paiement en retard de ${Math.abs(a.daysLeft)} jour(s) (${a.amount.toLocaleString('fr-DZ')} DA)`
        : `${who} — ${ref} : rendez-vous de paiement le ${a.date} (${a.amount.toLocaleString('fr-DZ')} DA)`,
      link: '/fuel-purchases',
      date: new Date(a.date),
      part: PART_MONEY,
    });
  });

  // Factures carburant non payées depuis plus de 30 jours
  fuelInvoices?.filter(f =>
    f.status === 'Non Payé' &&
    f.creationDate < thirtyDaysAgoStr
  ).forEach(f => {
    push(out, dismissed, {
      id: `fuel-invoice-overdue-${f.id}`,
      type: 'critical',
      icon: 'AlertTriangle',
      message: `Facture carburant N°${f.invoiceNumber} non payée depuis plus de 30 jours — ${f.total.toLocaleString('fr-DZ')} DA`,
      link: '/fuel-purchases',
      date: new Date(f.creationDate),
      part: PART_MONEY,
    });
  });

  return out;
}

/**
 * LES ALERTES DE L'UTILISATEUR CONNECTÉ — chacun ne voit que SA partie.
 *
 *   • admin / gérant   → toute la station + les deux parties commerciales ;
 *   • chef de brigade  → cuves, pompes et les décalages de SES brigades ;
 *   • pompiste         → cuves et pompes ;
 *   • magasin          → le stock du magasin ;
 *   • employé d'une partie (Cafétéria / Lavage) → uniquement sa partie.
 *
 * La même liste alimente la cloche de la barre de navigation et le tableau de
 * bord d'un employé : les deux ne peuvent donc pas se contredire.
 *
 * `enabled` à `false` rend une liste vide sans rien calculer — le tableau de
 * bord de l'administrateur n'affiche aucune alerte et n'a pas à refaire le
 * travail que la cloche vient de faire.
 */
export function useCurrentUserAlerts(dismissedIds?: string[], enabled = true): AlertItem[] {
  const {
    currentUserRole, currentUserId, currentModuleWorker,
    tanks, pumps, products, suppliers,
    pompistes, brigadeChefs, gerants, magasinWorkers,
    fuelInvoices, purchases, brigadeDecalageAlerts,
  } = useAppState();
  const biz = useBizAll();

  return useMemo(() => {
    if (!enabled) return [];

    switch (currentUserRole) {
      case 'module_worker': {
        const key = currentModuleWorker?.moduleKey;
        return sortAlerts(key ? bizPartAlerts(biz?.[key], key, dismissedIds) : []);
      }

      case 'chef_brigade':
        return sortAlerts([
          ...tankAlerts(tanks, dismissedIds),
          ...pumpAlerts(pumps, dismissedIds),
          ...decalageAlerts(brigadeDecalageAlerts, dismissedIds, currentUserId),
        ]);

      case 'pompiste':
        return sortAlerts([
          ...tankAlerts(tanks, dismissedIds),
          ...pumpAlerts(pumps, dismissedIds),
        ]);

      case 'magasin':
        return sortAlerts(shopProductAlerts(products, dismissedIds));

      // Administrateur et gérant : la station entière.
      default:
        return sortAlerts([
          ...tankAlerts(tanks, dismissedIds),
          ...pumpAlerts(pumps, dismissedIds),
          ...shopProductAlerts(products, dismissedIds),
          ...decalageAlerts(brigadeDecalageAlerts, dismissedIds),
          ...stationMoneyAlerts(
            suppliers,
            [...(pompistes || []), ...(brigadeChefs || []), ...(gerants || []), ...(magasinWorkers || [])],
            fuelInvoices, purchases, dismissedIds,
          ),
          ...(Object.keys(MODULES) as ModuleKey[]).flatMap(k => bizPartAlerts(biz?.[k], k, dismissedIds)),
        ]);
    }
  }, [
    enabled, currentUserRole, currentUserId, currentModuleWorker, biz,
    tanks, pumps, products, suppliers,
    pompistes, brigadeChefs, gerants, magasinWorkers,
    fuelInvoices, purchases, brigadeDecalageAlerts, dismissedIds,
  ]);
}

/**
 * Composant pour le dropdown des alertes dans la Navbar
 */
export interface NavbarAlertsDropdownProps {
  alerts: AlertItem[];
  isOpen: boolean;
  onClose: () => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
}

export const NavbarAlertsDropdown: React.FC<NavbarAlertsDropdownProps> = ({
  alerts,
  isOpen,
  onClose,
  onDismiss,
  onNavigate,
}) => {
  const toneMap = {
    critical: 'text-red-600 bg-red-50',
    warning: 'text-orange-600 bg-orange-50',
    info: 'text-blue-600 bg-blue-50',
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        className="absolute top-full right-0 mt-2 w-96 max-h-[80vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-100 z-50"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-black text-slate-700">Alertes</h3>
            {alerts.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[60vh]">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm font-bold text-slate-600">Tout est en ordre</p>
              <p className="text-xs text-slate-400 mt-1">Aucune alerte active</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {alerts.map(alert => (
                <div
                  key={alert.id}
                  className={cn(
                    'p-3 flex items-start gap-3 hover:bg-slate-50 transition-colors cursor-pointer group',
                    toneMap[alert.type]
                  )}
                  onClick={() => {
                    onNavigate(alert.link);
                    onClose();
                  }}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    alert.type === 'critical' ? 'bg-red-100' : alert.type === 'warning' ? 'bg-orange-100' : 'bg-blue-100'
                  )}>
                    <span className={cn(
                      alert.type === 'critical' ? 'text-red-600' : alert.type === 'warning' ? 'text-orange-600' : 'text-blue-600'
                    )}>
                      {getIcon(alert.icon)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {alert.part && (
                      <span className="inline-block px-1.5 py-0.5 mb-1 rounded bg-slate-100 text-slate-500 text-[9px] font-black uppercase">
                        {alert.part}
                      </span>
                    )}
                    <p className="text-sm font-medium text-slate-700 line-clamp-2">{alert.message}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {alert.date.toLocaleDateString('fr-DZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(alert.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white rounded-lg text-slate-400 hover:text-red-500 transition-all"
                    title="Ignorer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {alerts.length > 0 && (
          <div className="p-3 border-t border-slate-100">
            <button
              onClick={() => onNavigate('/dashboard')}
              className="w-full py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-center gap-1"
            >
              Voir le tableau de bord <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
};
