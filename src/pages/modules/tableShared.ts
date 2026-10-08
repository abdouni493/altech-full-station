/**
 * ─── Gestion des tables — ce que le point de vente et l'écran « Tables » partagent ─
 *
 * Une commande de table vit en trois états :
 *   • `pending`   — la table est servie, la note est ouverte : on peut ajouter,
 *                   retirer, modifier les articles, imprimer le bon de table,
 *                   changer de table. RIEN ne sort encore du stock ;
 *   • `completed` — le client a payé : la commande est devenue une VENTE (même
 *                   écriture que le comptoir, même déduction de stock) ;
 *   • `cancelled` — la note a été annulée : aucune vente, aucun mouvement.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizTableOrder, BizTableOrderEvent, BizTableOrderLine, TABLE_ORDER_STATUS_LABEL,
} from '@/src/lib/bizConfig';
import { printInvoice, stationFromSettings } from './_shared';

/** Prochaine référence de commande de table (« T-0007 »). */
export function nextTableOrderRef(orders: BizTableOrder[]): string {
  const max = orders.reduce((m, o) => {
    const n = parseInt(String(o.ref || '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `T-${String(max + 1).padStart(4, '0')}`;
}

export const tableEvent = (
  action: BizTableOrderEvent['action'], by: string, detail?: string,
): BizTableOrderEvent => ({ at: new Date().toISOString(), by: by || 'Admin', action, detail });

/** Depuis combien de temps la table est ouverte — « 1 h 05 », « 12 min ». */
export function elapsedLabel(fromIso: string, toIso?: string): string {
  const ms = Math.max(0, new Date(toIso || Date.now()).getTime() - new Date(fromIso).getTime());
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

const lineQtyLabel = (l: BizTableOrderLine) =>
  l.detailUnit ? `${l.qty} ${l.detailUnit}` : l.qty;

/**
 * Imprime le BON DE TABLE (note provisoire, avant paiement) ou le ticket d'une
 * commande déjà encaissée / annulée.
 */
export function printTableOrder(order: BizTableOrder, settings: any) {
  const isPending = order.status === 'pending';
  printInvoice({
    title: isPending ? 'Bon de table' : order.status === 'completed' ? 'Ticket de table' : 'Commande annulée',
    ref: order.ref,
    date: order.createdAt,
    station: stationFromSettings(settings),
    party: { label: 'Table', name: `${order.tableName}${order.clientName ? ` — ${order.clientName}` : ''}` },
    info: [
      { label: 'Statut', value: TABLE_ORDER_STATUS_LABEL[order.status] },
      { label: 'Couverts', value: order.covers ? String(order.covers) : '' },
      { label: 'Serveur', value: order.serverName || '' },
      { label: 'Vente', value: order.saleRef || '' },
    ],
    items: order.lines.map(l => ({
      name: l.note ? `${l.name} (${l.note})` : l.name,
      qty: lineQtyLabel(l),
      unitPrice: l.unitPrice,
      total: l.qty * l.unitPrice,
    })),
    subtotal: order.subtotal,
    reduction: order.reduction || 0,
    total: order.total,
    paid: isPending ? 0 : (order.paid ?? order.total),
    rest: isPending ? order.total : Math.max(0, order.total - (order.paid ?? order.total)),
    payments: [],
    footerNote: isPending
      ? 'Bon de table — document provisoire, à régler en caisse.'
      : order.status === 'cancelled' ? `Annulée${order.cancelReason ? ` : ${order.cancelReason}` : ''}` : order.notes,
  } as any);
}
