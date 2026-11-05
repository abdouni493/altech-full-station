/**
 * ─── Demandes d'encaissement (Lavage & Vidange) ──────────────────────────────
 * Un laveur qui n'encaisse pas lui-même envoie ici, à l'administrateur ou à
 * l'employé de caisse, le montant qu'un client doit payer, avec le nom du client
 * et les informations de son véhicule. La caisse voit la liste des demandes en
 * attente et les marque « encaissée » une fois l'argent reçu.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  BellRing, Plus, Car, User, Check, CheckCheck, X, Clock, Wallet, Trash2, CircleDollarSign,
  Sparkles, Wrench, Send, Users, UserCheck,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizPayRequest, BizCar, BizReparation } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, Select,
  money, formatDateTime, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { ContactModal, seedPayments } from './_shared';
import { ClientCarPicker, PASSAGE_LABEL } from './ClientCarPicker';

const KIND_META = {
  lavage: { label: 'Lavage', icon: Sparkles, grad: 'linear-gradient(135deg,#0369a1,#0ea5e9)', ring: 'ring-sky-300' },
  reparation: { label: 'Vidange', icon: Wrench, grad: 'linear-gradient(135deg,#c2410c,#f97316)', ring: 'ring-orange-300' },
} as const;

const STATUS_META: Record<BizPayRequest['status'], { label: string; tone: any }> = {
  pending: { label: 'En attente', tone: 'warning' },
  collected: { label: 'Encaissée', tone: 'success' },
  canceled: { label: 'Annulée', tone: 'danger' },
};

export default function ModuleEncaissements({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'encaissements');
  const { currentUserName, currentUserRole, currentModuleWorker } = useAppState();
  const isAdmin = currentUserRole === 'admin';
  const { payRequests, workers } = biz.state;

  const [search, setSearch] = useState('');
  // Tableau par défaut : la caisse balaie une file de demandes, elle a besoin
  // de la liste dense. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [status, setStatus] = useState<'all' | BizPayRequest['status']>('pending');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<BizPayRequest | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const filtered = useMemo(() => [...payRequests].filter(r => {
    const matchQ = matchesSearch(search, r.clientName, r.car?.immatriculation, r.workerName, r.ref, r.createdBy);
    return matchQ && (status === 'all' || r.status === status) && inPeriod(r.createdAt, period, from, to);
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [payRequests, search, status, period, from, to]);

  const stats = useMemo(() => {
    const pend = payRequests.filter(r => r.status === 'pending');
    const coll = payRequests.filter(r => r.status === 'collected');
    return {
      pending: pend.length,
      pendingAmount: pend.reduce((s, r) => s + r.amount, 0),
      collected: coll.length,
      collectedAmount: coll.reduce((s, r) => s + r.amount, 0),
    };
  }, [payRequests]);

  /**
   * Valider une demande = l'argent est reçu par la caisse. Elle passe en
   * « encaissée », quitte la liste des demandes en attente et l'alerte rouge de
   * la barre latérale se décrémente aussitôt.
   */
  /**
   * ─── LA VALIDATION DE L'ADMIN CRÉE L'INTERVENTION ─────────────────────────
   * Quand c'est l'administrateur qui valide, la demande devient une vraie
   * intervention finalisée et payée dans Lavage & Vidange — exactement comme
   * si elle avait été saisie à la main : elle compte dans le chiffre, la caisse
   * de la partie et la paie au pourcentage de l'employé. Pas de produits : le
   * stock ne bouge pas. Une demande déjà liée ne crée jamais un doublon.
   */
  const toReparation = (r: BizPayRequest, at: string, index: number): BizReparation => {
    const kind = r.kind || 'lavage';
    const by = currentUserName || 'Admin';
    return {
      id: newId(),
      ref: `${kind === 'lavage' ? 'LAV' : 'REP'}-${String(biz.state.reparations.length + 1 + index).padStart(4, '0')}`,
      kind,
      clientId: r.clientId,
      clientName: r.clientName || PASSAGE_LABEL,
      car: r.car || {},
      serviceTotal: r.amount,
      prestations: [{
        id: newId(), kind,
        label: r.description || KIND_META[kind].label,
        amount: r.amount,
        workerIds: r.workerId ? [r.workerId] : [],
      }],
      usedProducts: [],
      problem: r.description ? `${r.description} (demande ${r.ref})` : `Demande ${r.ref}`,
      subtotal: r.amount,
      discountAmount: 0,
      total: r.amount, paid: r.amount, rest: 0,
      status: 'finalized',
      date: r.createdAt,
      finalizedAt: at,
      outDate: at,
      payments: seedPayments(undefined, r.amount, at, by),
      workers: r.workerId ? [r.workerId] : [],
      createdBy: r.createdBy || r.workerName || by,
    };
  };

  const validate = (r: BizPayRequest, at: string, index = 0) => {
    let reparationId = r.reparationId;
    if (isAdmin && !reparationId) {
      const rep = toReparation(r, at, index);
      biz.add('reparations', rep);
      reparationId = rep.id;
    }
    biz.update('payRequests', {
      ...r, status: 'collected', collectedAt: at,
      collectedBy: currentUserName || 'Caisse', reparationId,
    });
  };

  const collect = (r: BizPayRequest) => {
    validate(r, new Date().toISOString());
    toast.success(isAdmin
      ? `Demande ${r.ref} validée — ${KIND_META[r.kind || 'lavage'].label} créé dans Lavage & Vidange`
      : `Demande ${r.ref} validée — ${money(r.amount)} encaissés`);
  };

  /** Valide d'un coup toutes les demandes en attente (l'alerte retombe à zéro). */
  const collectAll = () => {
    const pending = payRequests.filter(r => r.status === 'pending');
    if (pending.length === 0) return;
    const at = new Date().toISOString();
    pending.forEach((r, i) => validate(r, at, i));
    toast.success(`${pending.length} demande(s) validée(s) — ${money(pending.reduce((s, r) => s + r.amount, 0))}`);
    setConfirmAll(false);
  };
  const cancel = (r: BizPayRequest) => {
    biz.update('payRequests', { ...r, status: 'canceled' });
    toast.success('Demande annulée');
  };
  const del = () => { if (toDelete) { biz.remove('payRequests', toDelete.id); toast.success('Demande supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={BellRing} title="Demandes d'encaissement" subtitle={`${cfg.label} — du laveur vers la caisse`}
        actions={(perm.creer || perm.modifier) ? <div className="flex flex-wrap gap-2">
          {perm.modifier && stats.pending > 0 && (
            <button onClick={() => setConfirmAll(true)}
              className="h-11 px-4 rounded-xl font-black text-sm text-white flex items-center gap-2 transition-transform active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}
              title="Valider toutes les demandes en attente">
              <CheckCheck className="w-4 h-4" /> Tout valider ({stats.pending})
            </button>
          )}
          {perm.creer && (
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouvelle demande</button>
          )}
        </div> : undefined} />

      {/* Alerte — des demandes attendent d'être encaissées. */}
      {stats.pending > 0 && (
        <div className="rounded-2xl p-4 flex flex-wrap items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #b45309, #f59e0b)', boxShadow: '0 8px 24px rgba(245,158,11,0.28)' }}>
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <BellRing className="w-5 h-5 text-white animate-pulse" />
          </span>
          <div className="min-w-0">
            <p className="font-black text-white">
              {stats.pending} demande{stats.pending > 1 ? 's' : ''} en attente d'encaissement
            </p>
            <p className="text-[12px] text-amber-50">
              {money(stats.pendingAmount)} à encaisser — une pastille rouge reste affichée dans le menu tant qu'il en reste.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 shrink-0">
            <button onClick={() => setStatus('pending')}
              className="text-xs font-black text-white bg-white/20 hover:bg-white/30 rounded-lg px-3 py-2 transition-colors">
              Voir les demandes
            </button>
            {perm.modifier && (
              <button onClick={() => setConfirmAll(true)}
                className="text-xs font-black text-amber-700 bg-white hover:bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-1.5 transition-colors">
                <CheckCheck className="w-4 h-4" /> Tout valider
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="En attente" value={stats.pending} tone="amber" />
        <StatCard icon={CircleDollarSign} label="Montant en attente" value={money(stats.pendingAmount)} tone="red" />
        <StatCard icon={Check} label="Encaissées" value={stats.collected} tone="green" />
        <StatCard icon={Wallet} label="Montant encaissé" value={money(stats.collectedAmount)} tone="blue" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, immatriculation, employé…" />
          <div className="flex flex-wrap gap-1.5">
            {(['pending', 'collected', 'canceled', 'all'] as const).map(s => {
              const n = s === 'all' ? payRequests.length : payRequests.filter(r => r.status === s).length;
              return (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {s === 'all' ? 'Toutes' : STATUS_META[s].label}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
                    status === s ? 'bg-white/20' : (s === 'pending' && n > 0 ? 'bg-amber-500 text-white' : 'bg-white text-slate-400')}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BellRing} title="Aucune demande"
          message="Le laveur crée une demande avec le montant à encaisser, le nom du client et son véhicule." />
      ) : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Réf</th><th className="table-head">Type</th><th className="table-head">Client</th><th className="table-head">Véhicule</th>
          <th className="table-head">Demandée par</th><th className="table-head">Date</th>
          <th className="table-head text-right">À encaisser</th><th className="table-head">État</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(r => {
            const carLabel = [r.car?.marque, r.car?.name, r.car?.color, r.car?.immatriculation].filter(Boolean).join(' • ');
            return (
              <tr key={r.id} className={r.status === 'pending' ? 'bg-amber-50/60' : undefined}>
                <td className="table-cell font-bold">{r.ref}</td>
                <td className="table-cell">{r.kind ? <Badge tone={r.kind === 'lavage' ? 'info' : 'warning'}>{KIND_META[r.kind].label}</Badge> : '—'}</td>
                <td className="table-cell">
                  <div>{r.clientName}</div>
                  {r.description && <div className="text-[11px] text-slate-400 truncate max-w-[220px]" title={r.description}>{r.description}</div>}
                </td>
                <td className="table-cell text-slate-500 max-w-[200px] truncate" title={carLabel || undefined}>{carLabel || '—'}</td>
                <td className="table-cell text-slate-500">
                  <div>{r.workerName}</div>
                  {r.createdBy && r.createdBy !== r.workerName && <div className="text-[11px] text-slate-400">Créée par {r.createdBy}</div>}
                </td>
                <td className="table-cell whitespace-nowrap text-slate-500">
                  {formatDateTime(r.createdAt)}
                  {r.collectedAt && <div className="text-[11px] text-emerald-600">Encaissé par {r.collectedBy} • {formatDateTime(r.collectedAt)}</div>}
                </td>
                <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(r.amount)}</td>
                <td className="table-cell"><Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge></td>
                <td className="table-cell text-right">
                  <RowActions>
                    {/* Les deux décisions de la caisse, à portée de ligne. */}
                    {r.status === 'pending' && perm.modifier && (
                      <ActionBtn icon={Check} tone="green" title={`Valider — ${money(r.amount)} reçus`} onClick={() => collect(r)} />
                    )}
                    {r.status === 'pending' && perm.modifier && (
                      <ActionBtn icon={X} tone="amber" title="Annuler la demande" onClick={() => cancel(r)} />
                    )}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(r => (
            <GlassCard key={r.id}
              className={r.status === 'pending' ? '!border-amber-300 ring-1 ring-amber-200' : undefined}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-800">{r.ref}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{r.clientName}</p>
                </div>
                <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
              </div>
              {(r.car?.marque || r.car?.name || r.car?.immatriculation) && (
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <Car className="w-3 h-3" />{[r.car.marque, r.car.name, r.car.color, r.car.immatriculation].filter(Boolean).join(' • ')}
                </p>
              )}
              {r.description && <p className="text-xs text-slate-500 mt-2">{r.description}</p>}
              <div className="rounded-xl bg-[#001f5c] text-white p-3 mt-3 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-blue-200">À encaisser</span>
                <span className="font-black tabular-nums text-[#FFB800]">{money(r.amount)}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                {r.kind && <>{KIND_META[r.kind].label} • </>}Par {r.workerName}{r.createdBy && r.createdBy !== r.workerName ? ` (créée par ${r.createdBy})` : ''} • {formatDateTime(r.createdAt)}
                {r.collectedAt && <> • encaissé par {r.collectedBy} le {formatDateTime(r.collectedAt)}</>}
              </p>
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                {/* Une demande en attente met ses deux décisions en avant,
                    pleine largeur : encaisser (l'argent est reçu) ou annuler. */}
                {r.status === 'pending' && perm.modifier && (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      className="col-span-2 h-10 rounded-xl font-black text-sm text-white flex items-center justify-center gap-1.5 transition-transform active:scale-[0.98]"
                      style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 12px rgba(16,185,129,0.35)' }}
                      onClick={() => collect(r)}
                      title="Valider : l'argent est reçu — la demande sort de l'alerte du menu">
                      <Check className="w-4 h-4" /> Valider {money(r.amount)}
                    </button>
                    <button
                      className="h-10 rounded-xl font-bold text-sm text-red-600 bg-red-50 hover:bg-red-100 flex items-center justify-center gap-1.5 transition-colors"
                      onClick={() => cancel(r)}>
                      <X className="w-4 h-4" /> Annuler
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-400">
                    {r.status === 'pending' ? 'En attente de la caisse' : STATUS_META[r.status].label}
                  </span>
                  <RowActions>
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </div>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {creating && (
        <RequestForm
          moduleKey={moduleKey}
          defaultWorkerId={currentModuleWorker?.moduleKey === moduleKey
            ? workers.find(w => w.name === currentModuleWorker?.name)?.id
            : undefined}
          defaultWorkerName={currentModuleWorker?.name || currentUserName}
          creatorName={currentModuleWorker?.name || currentUserName || 'Admin'}
          onClose={() => setCreating(false)}
        />
      )}
      <Confirm open={!!toDelete} title="Supprimer la demande"
        message={`Supprimer la demande ${toDelete?.ref} ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
      <Confirm open={confirmAll} danger={false} confirmLabel="Tout valider"
        title="Valider toutes les demandes"
        message={`Marquer ${stats.pending} demande(s) comme encaissée(s), pour un total de ${money(stats.pendingAmount)} ?${isAdmin ? ' Chacune sera créée comme intervention finalisée dans Lavage & Vidange.' : ''} L'alerte du menu disparaîtra.`}
        onConfirm={collectAll} onCancel={() => setConfirmAll(false)} />
    </div>
  );
}

/**
 * ─── LA DEMANDE, EN TROIS GESTES ──────────────────────────────────────────────
 * Lavage ou vidange, le montant, puis le client — cherché dans la liste qui
 * s'ouvre au premier clic, ou créé sur place avec la même fiche que dans
 * Lavage & Vidange. Le créateur est l'utilisateur connecté, quel qu'il soit.
 */
function RequestForm({
  moduleKey, defaultWorkerId, defaultWorkerName, creatorName, onClose,
}: {
  moduleKey: ModuleKey; defaultWorkerId?: string; defaultWorkerName?: string;
  creatorName: string; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const { workers, payRequests, clients } = biz.state;

  const [kind, setKind] = useState<'lavage' | 'reparation'>('lavage');
  const [clientId, setClientId] = useState('');
  const [showClient, setShowClient] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [workerId, setWorkerId] = useState(defaultWorkerId || '');
  const [car, setCar] = useState<BizCar>({});

  const value = Number(amount) || 0;
  const meta = KIND_META[kind];

  const save = () => {
    if (value <= 0) { toast.error('Montant requis'); return; }
    const worker = workers.find(w => w.id === workerId);
    const client = clients.find(c => c.id === clientId);
    const req: BizPayRequest = {
      id: newId(),
      ref: `ENC-${String(payRequests.length + 1).padStart(4, '0')}`,
      kind,
      clientId: client?.id,
      clientName: client?.name || PASSAGE_LABEL,
      car, amount: value,
      description: description.trim() || undefined,
      workerId: workerId || undefined,
      workerName: worker?.name || defaultWorkerName || creatorName,
      createdBy: creatorName,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    biz.add('payRequests', req);
    toast.success('Demande envoyée à la caisse');
    onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} icon={BellRing} size="lg"
        title="Nouvelle demande d'encaissement"
        subtitle={`Créée par ${creatorName} — envoyée à la caisse`}
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button onClick={save} disabled={value <= 0}
            className="h-11 px-5 rounded-xl font-black text-sm text-white flex items-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-50"
            style={{ background: meta.grad, boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }}>
            <Send className="w-4 h-4" /> Envoyer à la caisse
          </button>
        </>}>
        <div className="space-y-4">
          {/* ── 1 · Lavage ou vidange ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            {(['lavage', 'reparation'] as const).map(k => {
              const m = KIND_META[k]; const Icon = m.icon; const on = kind === k;
              return (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`h-16 rounded-2xl flex items-center justify-center gap-2.5 font-black text-base transition-all active:scale-[0.98]
                    ${on ? `text-white ring-4 ${m.ring}` : 'bg-white text-slate-500 border-2 border-slate-200 hover:border-slate-300'}`}
                  style={on ? { background: m.grad } : undefined}>
                  <Icon className="w-5 h-5" /> {m.label}
                  {on && <Check className="w-4 h-4" />}
                </button>
              );
            })}
          </div>

          {/* ── 2 · Montant et employé ────────────────────────────────────── */}
          <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#001435,#003087 60%,#0044bb)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-blue-200 flex items-center gap-1.5 mb-1.5">
                  <CircleDollarSign className="w-3.5 h-3.5 text-[#FFB800]" /> Montant à encaisser (DA) *
                </label>
                <input type="number" min={0} inputMode="decimal" value={amount} autoFocus
                  onChange={e => setAmount(e.target.value)} placeholder="0"
                  className="w-full h-14 rounded-xl bg-white/10 border-2 border-white/20 focus:border-[#FFB800] outline-none px-4 text-2xl font-black tabular-nums text-[#FFB800] placeholder:text-white/30" />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-blue-200 flex items-center gap-1.5 mb-1.5">
                  <UserCheck className="w-3.5 h-3.5" /> Employé ({meta.label.toLowerCase()})
                </label>
                <select value={workerId} onChange={e => setWorkerId(e.target.value)}
                  className="w-full h-14 rounded-xl bg-white/10 border-2 border-white/20 focus:border-[#FFB800] outline-none px-3 font-bold text-white [&>option]:text-slate-800">
                  <option value="">{defaultWorkerName || '— Sélectionner —'}</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── 3 · Client et véhicule ────────────────────────────────────── */}
          <div className="rounded-2xl border-2 border-indigo-200 overflow-hidden">
            <div className="px-4 py-2.5 text-white flex items-center gap-2" style={{ background: 'linear-gradient(135deg,#3730a3,#6366f1)' }}>
              <Users className="w-4 h-4" />
              <span className="text-xs font-black uppercase tracking-wider">Client & véhicule</span>
              <button type="button" onClick={() => setShowClient(true)}
                className="ml-auto text-[11px] font-black bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Nouveau client
              </button>
            </div>
            <div className="p-4 bg-white">
              <ClientCarPicker
                clients={clients}
                clientId={clientId}
                onClientId={setClientId}
                car={car}
                onCar={setCar}
                onCreateClient={() => setShowClient(true)}
                passageLabel={PASSAGE_LABEL} />
            </div>
          </div>

          <Field label="Détail de la prestation">
            <Textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder={kind === 'lavage' ? 'Ex: lavage complet + aspiration' : 'Ex: vidange 5W40 + filtre à huile'} />
          </Field>
        </div>
      </Modal>

      {/* La même fiche client que dans Lavage & Vidange. */}
      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)}
        onSaved={c => { setClientId(c.id); if ((c.cars || []).length === 1) setCar({ ...c.cars![0] }); }} />
    </>
  );
}
