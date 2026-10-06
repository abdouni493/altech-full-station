/**
 * ─── Transferts : produits des MAGASINS vers les ARMOIRES ──────────────────────
 * Historique de tous les transferts, depuis le premier ou le second magasin,
 * avec création multi-produits, modification et suppression (le stock déplacé
 * est alors rendu au magasin et retiré de l'armoire).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Eye, Edit2, Trash2, Archive, Calendar, Store, Package } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppState, useModulePermission, StockTransfer } from '../store/AppContext';
import {
  PageHeader, StatCard, Modal, Badge, Confirm, EmptyState, Table, RowActions, ActionBtn,
  SearchInput, Select, formatDateTime,
} from '@/src/components/biz/Kit';
import StockTransferBuilder, { useStockTransferActions } from '@/src/components/armoires/StockTransferBuilder';
import { magasinLabel } from '@/src/lib/armoires';
import { activeMagasinKeys, roundQty } from '@/src/lib/bizConfig';

const fmt = (n: number) => roundQty(n).toLocaleString('fr-FR');

function TransferDetail({ transfer, armoireName, onClose }: { transfer: StockTransfer; armoireName: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="md" icon={Eye} title="Détails du transfert" subtitle={formatDateTime(transfer.date)}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Depuis</p>
            <p className="text-sm font-black text-[#002d87] flex items-center gap-1.5"><Store className="w-4 h-4" /> {magasinLabel(transfer.moduleKey)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vers l'armoire</p>
            <p className="text-sm font-black text-[#002d87] flex items-center gap-1.5"><Archive className="w-4 h-4" /> {armoireName}</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Produits transférés</p>
          <div className="space-y-2">
            {transfer.items.map(it => (
              <div key={it.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">
                    {it.productName}
                    {it.consigneState && (
                      <span className={`ml-2 badge ${it.consigneState === 'VIDE' ? 'badge-warning' : 'badge-success'}`}>
                        {it.consigneState === 'VIDE' ? 'Vides' : 'Pleines'}
                      </span>
                    )}
                  </p>
                  {it.barcode && <p className="text-[11px] text-slate-400 font-bold">Code : {it.barcode}</p>}
                </div>
                <span className="text-lg font-black text-emerald-600 shrink-0">+{fmt(it.quantity)}</span>
              </div>
            ))}
          </div>
        </div>
        {transfer.notes && (
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Notes</p>
            <p className="text-sm text-amber-800">{transfer.notes}</p>
          </div>
        )}
        <div className="rounded-2xl bg-[#001f5c] p-4 flex items-center justify-between">
          <span className="text-[11px] font-black text-[#FFB800]/70 uppercase tracking-widest">Quantité totale</span>
          <span className="text-2xl font-black text-[#FFB800]">{fmt(transfer.totalQty)}</span>
        </div>
      </div>
    </Modal>
  );
}

export default function Transfers() {
  const { stockTransfers = [], armoires = [] } = useAppState();
  const perm = useModulePermission('Transferts');
  const actions = useStockTransferActions();

  const [builder, setBuilder] = useState<{ transfer: StockTransfer | null } | null>(null);
  const [detail, setDetail] = useState<StockTransfer | null>(null);
  const [toDelete, setToDelete] = useState<StockTransfer | null>(null);
  const [search, setSearch] = useState('');
  const [armoireFilter, setArmoireFilter] = useState('');
  const [magasinFilter, setMagasinFilter] = useState('');

  const armoireName = (id: string) => armoires.find(a => a.id === id)?.name ?? 'Armoire supprimée';

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...stockTransfers]
      .filter(t => !armoireFilter || t.armoireId === armoireFilter)
      .filter(t => !magasinFilter || t.moduleKey === magasinFilter)
      .filter(t => !q || t.items.some(i => i.productName.toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q))
        || armoireName(t.armoireId).toLowerCase().includes(q))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockTransfers, search, armoireFilter, magasinFilter, armoires]);

  const totalQty = rows.reduce((s, t) => s + (t.totalQty || 0), 0);
  const magasins = activeMagasinKeys();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={ArrowLeftRight}
        title="Transferts"
        subtitle="Transferts de produits des magasins vers les armoires de la piste."
        actions={perm.creer && (
          <button onClick={() => setBuilder({ transfer: null })} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau transfert
          </button>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={ArrowLeftRight} label="Transferts" value={rows.length} />
        <StatCard icon={Package} label="Quantité transférée" value={fmt(totalQty)} tone="green" />
        <StatCard icon={Archive} label="Armoires" value={armoires.length} tone="amber" />
      </div>

      <div className="card-glass p-4 flex flex-wrap gap-3 items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Produit, code-barres ou armoire…" />
        <Select value={armoireFilter} onChange={e => setArmoireFilter(e.target.value)} className="max-w-[14rem]">
          <option value="">Toutes les armoires</option>
          {armoires.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        {magasins.length > 1 && (
          <Select value={magasinFilter} onChange={e => setMagasinFilter(e.target.value)} className="max-w-[14rem]">
            <option value="">Tous les magasins</option>
            {magasins.map(k => <option key={k} value={k}>{magasinLabel(k as any)}</option>)}
          </Select>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="Aucun transfert"
          message="Créez un transfert ici ou utilisez le bouton « Transférer » d'un produit dans la Gestion de stock d'un magasin." />
      ) : (
        <Table head={<>
          <th className="table-head">Date</th>
          <th className="table-head">Depuis</th>
          <th className="table-head">Armoire</th>
          <th className="table-head">Produits</th>
          <th className="table-head text-right">Qté totale</th>
          <th className="table-head">Origine</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {rows.map(t => (
            <tr key={t.id} className="hover:bg-slate-50/60">
              <td className="table-cell whitespace-nowrap"><span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-300" /> {formatDateTime(t.date)}</span></td>
              <td className="table-cell"><Badge tone="info">{magasinLabel(t.moduleKey)}</Badge></td>
              <td className="table-cell font-bold text-[#002d87]">{armoireName(t.armoireId)}</td>
              <td className="table-cell text-slate-500">
                {t.items.slice(0, 2).map(i => i.productName).join(', ')}
                {t.items.length > 2 ? ` +${t.items.length - 2}` : ''}
              </td>
              <td className="table-cell text-right tabular-nums font-black text-emerald-600">+{fmt(t.totalQty)}</td>
              <td className="table-cell"><Badge tone={t.source === 'produits' ? 'primary' : 'success'}>{t.source === 'produits' ? 'Fiche produit' : 'Transferts'}</Badge></td>
              <td className="table-cell">
                <div className="flex justify-end">
                  <RowActions>
                    <ActionBtn icon={Eye} title="Voir" onClick={() => setDetail(t)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="blue" title="Modifier" onClick={() => setBuilder({ transfer: t })} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(t)} />}
                  </RowActions>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {builder && (
        <StockTransferBuilder open transfer={builder.transfer} onClose={() => setBuilder(null)} />
      )}
      {detail && <TransferDetail transfer={detail} armoireName={armoireName(detail.armoireId)} onClose={() => setDetail(null)} />}
      <Confirm
        open={!!toDelete}
        title="Supprimer le transfert"
        message={"Supprimer ce transfert ?\nLes quantités seront rendues au stock du magasin et retirées de l'armoire."}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const tr = toDelete; setToDelete(null);
          if (tr && await actions.remove(tr)) toast.success('Transfert supprimé');
        }}
      />
    </div>
  );
}
