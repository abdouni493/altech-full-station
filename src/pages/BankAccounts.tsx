/**
 * ─── Comptes Bancaires (Finance) ────────────────────────────────────────────────
 * Bank accounts of the station. Each card shows the live solde (opening balance
 * plus every ledger movement) and offers: modifier, supprimer, transférer and
 * historique. A transfer moves money to another bank account or to the general
 * cash box; both sides are represented by a SINGLE ledger line so the two
 * balances can never disagree.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Landmark, Plus, Edit2, Trash2, ArrowLeftRight, History, Wallet,
  ArrowDownCircle, ArrowUpCircle, PiggyBank, Building2, TrendingUp, RefreshCw,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  BankAccount, TreasuryTransaction, CAISSE_ID, CAISSE_PART_ID, CASH_ACCOUNT_LABEL,
  accountLabelOf, bankBalanceOf, caisseBalanceOf, partOfCashAccount,
} from '../store/AppContext';
import { repairBrigadeBankLines } from '../lib/brigadeBankLines';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Confirm,
  EmptyState, CardGrid, GlassCard, RowActions, ActionBtn, Table, ViewToggle,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '../components/biz/Kit';

const todayISO = () => new Date().toISOString().split('T')[0];

export default function BankAccounts() {
  const {
    bankAccounts, treasuryTransactions, currentUserName,
    brigades = [], brigadeAccountings = [], pompistes = [],
  } = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Comptes Bancaires');

  // Tableau par défaut : des comptes se comparent en colonnes — solde, entrées,
  // sorties. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [transferring, setTransferring] = useState<BankAccount | null>(null);
  const [viewingHistory, setViewingHistory] = useState<BankAccount | null>(null);
  const [toDelete, setToDelete] = useState<BankAccount | null>(null);

  // Always derive the solde from the ledger — never trust a stored number.
  const accounts = useMemo(
    () => bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, treasuryTransactions) })),
    [bankAccounts, treasuryTransactions],
  );
  const totalBank = accounts.reduce((s, a) => s + a.balance, 0);
  const caisse = caisseBalanceOf(treasuryTransactions);

  const del = () => {
    if (!toDelete) return;
    dispatch({ type: 'DELETE_BANK_ACCOUNT', payload: toDelete.id });
    toast.success('Compte bancaire supprimé');
    setToDelete(null);
  };

  // ── Ce qui manque encore au grand livre ─────────────────────────────────────
  // Les brigades enregistrées AVANT que les justifications TPE / TAG n'écrivent
  // leur ligne bancaire ont bien leurs pièces, mais aucune trace en banque :
  // c'est exactement l'argent qu'on cherchait dans l'historique sans l'y
  // trouver. On mesure l'écart en continu, et le bouton ne le comble QUE là où
  // il manque — relancer la vérification une seconde fois n'ajoute rien.
  const repair = useMemo(() => repairBrigadeBankLines(
    brigadeAccountings
      .filter(a => (a.justifications || []).length > 0)
      .map(a => {
        const b = brigades.find(x => x.id === a.brigadeId);
        return {
          brigadeId: a.brigadeId,
          date: b?.endDatetime || b?.date || new Date().toISOString(),
          label: b?.date,
          justifications: (a.justifications || []) as any[],
          createdBy: a.createdBy || currentUserName,
        };
      })
      // Une brigade supprimée n'a plus à porter d'argent en banque.
      .filter(s => brigades.some(b => b.id === s.brigadeId)),
    treasuryTransactions,
    {
      pompisteName: pid => pompistes.find(p => p.id === pid)?.name,
      // Les comptes servent à RELIRE celui qu'une justification a perdu : son
      // libellé le nomme encore (« TPE Naftal card »), même quand la colonne a
      // été remise à NULL par une modification de brigade.
      accounts: bankAccounts,
    },
  ), [brigadeAccountings, brigades, treasuryTransactions, pompistes, bankAccounts, currentUserName]);

  const runRepair = () => {
    if (repair.add.length === 0) {
      toast.success(repair.unbanked > 0
        ? `Rien à rattraper — ${repair.unbanked} justification(s) TPE/TAG n'ont aucun compte désigné`
        : 'Les comptes bancaires portent déjà toutes les brigades');
      return;
    }

    // ── 1. Le compte retrouvé est réécrit sur la PIÈCE ────────────────────
    // Sans cela, la prochaine modification de la brigade repartirait d'une
    // justification toujours sans compte, et referait disparaître la ligne
    // qu'on vient de créer.
    let pieces = 0;
    repair.recovered.forEach((byJustif, brigadeId) => {
      const acc = brigadeAccountings.find(a => a.brigadeId === brigadeId);
      if (!acc) return;
      dispatch({
        type: 'UPDATE_BRIGADE_ACCOUNTING',
        payload: {
          ...acc,
          justifications: (acc.justifications || []).map(j =>
            byJustif.has(j.id) ? { ...j, bankAccountId: byJustif.get(j.id) } : j),
        },
      });
      pieces += byJustif.size;
    });

    // ── 2. Les lignes manquantes entrent au grand livre ───────────────────
    repair.add.forEach(tx => dispatch({ type: 'ADD_TREASURY_TX', payload: tx }));
    toast.success(
      `${repair.add.length} encaissement(s) TPE/TAG rattachés — ${money(repair.amount)} sur ${repair.brigades} brigade(s)`
      + (pieces ? ` · ${pieces} compte(s) retrouvé(s) dans le libellé` : ''),
      { duration: 7000 });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Landmark} title="Comptes Bancaires" subtitle="Finance — soldes, virements & historique"
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouveau compte</button>
          : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Building2} label="Comptes" value={accounts.length} tone="blue" />
        <StatCard icon={Landmark} label="Total en banque" value={money(totalBank)} tone="green" />
        <StatCard icon={PiggyBank} label="Caisse générale" value={money(caisse)} tone="amber" />
      </div>

      {accounts.length > 0 && (
        <div className="flex justify-end"><ViewToggle view={view} onChange={setView} /></div>
      )}

      {/* ── Encaissements de brigade absents du grand livre ────────────────────
          Les brigades justifiées au TPE / TAG créditent désormais leur compte à
          l'enregistrement. Celles saisies avant ne l'avaient jamais fait : leur
          argent manquait à l'historique du compte, et le solde était d'autant
          plus bas. Le bandeau ne s'affiche que s'il reste quelque chose à
          rattraper, et disparaît une fois le rattrapage passé. */}
      {(repair.add.length > 0 || repair.unbanked > 0) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-amber-900">
              {repair.add.length > 0
                ? `${repair.add.length} encaissement(s) TPE / TAG de brigade absents des comptes`
                : `${repair.unbanked} justification(s) TPE / TAG sans compte bancaire`}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {repair.add.length > 0
                ? `${money(repair.amount)} justifiés sur ${repair.brigades} brigade(s) — ajoutez-les à l'historique de leur compte.`
                : "Rouvrez ces brigades et choisissez le compte crédité : sans lui, l'argent n'entre nulle part."}
            </p>
          </div>
          {repair.add.length > 0 && perm.creer && (
            <button className="btn-primary shrink-0" onClick={runRepair}>
              <RefreshCw className="w-4 h-4" /> Rattacher aux comptes
            </button>
          )}
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="Aucun compte bancaire"
          message="Créez un compte avec son nom de banque et son solde actuel."
          action={perm.creer ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouveau compte</button> : undefined} />
      ) : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Compte</th><th className="table-head">Numéro</th>
          <th className="table-head text-right">Entrées</th><th className="table-head text-right">Sorties</th>
          <th className="table-head text-right">Mouvements</th><th className="table-head text-right">Solde</th>
          <th className="table-head">État</th><th className="table-head text-right">Actions</th>
        </>}>
          {accounts.map(a => {
            const moves = treasuryTransactions.filter(t => t.accountFrom === a.id || t.accountTo === a.id);
            const credit = moves.filter(t => t.accountTo === a.id).reduce((s, t) => s + t.amount, 0);
            const debit = moves.filter(t => t.accountFrom === a.id).reduce((s, t) => s + t.amount, 0);
            return (
              <tr key={a.id}>
                <td className="table-cell font-bold text-slate-700">
                  <span className="inline-flex items-center gap-1.5"><Landmark className="w-4 h-4 text-[#003087]" />{a.name}</span>
                </td>
                <td className="table-cell font-mono text-slate-500">{a.accountNumber || '—'}</td>
                <td className="table-cell tabular-nums text-right text-emerald-600">+{money(credit)}</td>
                <td className="table-cell tabular-nums text-right text-red-600">−{money(debit)}</td>
                <td className="table-cell tabular-nums text-right text-slate-500">{moves.length}</td>
                <td className={`table-cell tabular-nums text-right font-black ${a.balance >= 0 ? 'text-[#002d87]' : 'text-red-600'}`}>{money(a.balance)}</td>
                <td className="table-cell"><Badge tone={a.balance >= 0 ? 'success' : 'danger'}>{a.balance >= 0 ? 'Actif' : 'Découvert'}</Badge></td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={History} tone="blue" title="Historique" onClick={() => setViewingHistory(a)} />
                    <ActionBtn icon={ArrowLeftRight} tone="green" title="Transférer" onClick={() => setTransferring(a)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(a)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(a)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {accounts.map(a => {
            const moves = treasuryTransactions.filter(t => t.accountFrom === a.id || t.accountTo === a.id);
            const credit = moves.filter(t => t.accountTo === a.id).reduce((s, t) => s + t.amount, 0);
            const debit = moves.filter(t => t.accountFrom === a.id).reduce((s, t) => s + t.amount, 0);
            return (
              <GlassCard key={a.id} className="!p-0 overflow-hidden">
                <div className="p-5 text-white" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Landmark className="w-4 h-4 text-[#FFB800]" />
                        <h3 className="font-black truncate">{a.name}</h3>
                      </div>
                      {a.accountNumber && <p className="text-[11px] text-blue-200 font-mono mt-0.5">{a.accountNumber}</p>}
                    </div>
                    <Badge tone={a.balance >= 0 ? 'success' : 'danger'}>{a.balance >= 0 ? 'Actif' : 'Découvert'}</Badge>
                  </div>
                  <p className="text-[10px] uppercase font-bold text-blue-200 mt-4">Solde actuel</p>
                  <p className="text-3xl font-black tabular-nums text-[#FFB800] leading-tight">{money(a.balance)}</p>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-emerald-50 p-2.5">
                      <p className="text-[10px] uppercase font-bold text-slate-400">Entrées</p>
                      <p className="font-black text-emerald-600 tabular-nums text-sm">+{money(credit)}</p>
                    </div>
                    <div className="rounded-xl bg-red-50 p-2.5">
                      <p className="text-[10px] uppercase font-bold text-slate-400">Sorties</p>
                      <p className="font-black text-red-600 tabular-nums text-sm">−{money(debit)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400">{moves.length} mouvement(s)</span>
                    <RowActions>
                      <ActionBtn icon={History} tone="blue" title="Historique" onClick={() => setViewingHistory(a)} />
                      <ActionBtn icon={ArrowLeftRight} tone="green" title="Transférer" onClick={() => setTransferring(a)} />
                      {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(a)} />}
                      {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(a)} />}
                    </RowActions>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      {(creating || editing) && (
        <AccountForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={(acc, openingTx) => {
            if (editing) dispatch({ type: 'UPDATE_BANK_ACCOUNT', payload: acc });
            else {
              dispatch({ type: 'ADD_BANK_ACCOUNT', payload: acc });
              if (openingTx) dispatch({ type: 'ADD_TREASURY_TX', payload: openingTx });
            }
            toast.success(editing ? 'Compte modifié' : 'Compte bancaire créé');
            setCreating(false); setEditing(null);
          }}
        />
      )}

      {transferring && (
        <TransferModal
          from={transferring}
          accounts={accounts}
          caisseBalance={caisse}
          createdBy={currentUserName}
          onClose={() => setTransferring(null)}
          onTransfer={tx => {
            dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
            toast.success('Virement enregistré');
            setTransferring(null);
          }}
        />
      )}

      {viewingHistory && (
        <AccountHistory
          account={{ ...viewingHistory, balance: bankBalanceOf(viewingHistory, treasuryTransactions) }}
          txs={treasuryTransactions}
          accounts={accounts}
          onClose={() => setViewingHistory(null)}
        />
      )}

      <Confirm open={!!toDelete} title="Supprimer le compte"
        message={`Supprimer « ${toDelete?.name} » ? Tous ses mouvements seront également supprimés.`}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Create / edit ─────────────────────────────────────────────────────────────
function AccountForm({
  initial, onClose, onSave,
}: {
  initial: BankAccount | null;
  onClose: () => void;
  onSave: (a: BankAccount, openingTx: TreasuryTransaction | null) => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber || '');
  const [balance, setBalance] = useState(String(initial?.initialBalance ?? ''));
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!name.trim()) { toast.error('Le nom de la banque est requis'); return; }
    const opening = Number(balance) || 0;
    const account: BankAccount = {
      id: initial?.id || newId(),
      name: name.trim(),
      accountNumber: accountNumber.trim() || undefined,
      initialBalance: opening,
      balance: opening,
      notes: notes.trim() || undefined,
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    onSave(account, null);
  };

  return (
    <Modal open onClose={onClose} icon={Landmark} size="md"
      title={isEdit ? 'Modifier le compte' : 'Nouveau compte bancaire'}
      subtitle="Nom de la banque et solde actuel"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="Nom de la banque" required>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: BNA — Agence Mostaganem" />
        </Field>
        <Field label="Numéro de compte / RIB">
          <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Optionnel" />
        </Field>
        <Field label="Solde actuel (DA)"
          hint={isEdit
            ? "Le solde affiché reste « solde d'ouverture + mouvements »."
            : 'Solde du compte au moment de sa création.'}>
          <Input type="number" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ─── Transfer ──────────────────────────────────────────────────────────────────
function TransferModal({
  from, accounts, caisseBalance, createdBy, onClose, onTransfer,
}: {
  from: BankAccount & { balance: number };
  accounts: (BankAccount & { balance: number })[];
  caisseBalance: number;
  createdBy?: string;
  onClose: () => void;
  onTransfer: (tx: TreasuryTransaction) => void;
}) {
  const others = accounts.filter(a => a.id !== from.id);
  // The money can also go straight to the caisse of one activity.
  const cashTargets = [CAISSE_ID, ...Object.values(CAISSE_PART_ID)];
  const [target, setTarget] = useState<string>(CAISSE_ID);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const value = Number(amount) || 0;
  const targetLabel = accountLabelOf(target, others, '—');
  const targetBalance = target === CAISSE_ID
    ? caisseBalance
    : (others.find(a => a.id === target)?.balance ?? 0);

  const submit = () => {
    if (value <= 0) { toast.error('Montant requis'); return; }
    if (!target) { toast.error('Choisissez la destination'); return; }
    onTransfer({
      id: newId(),
      date: new Date(date).toISOString(),
      kind: 'TRANSFER',
      amount: value,
      description: description.trim() || `Virement ${from.name} → ${targetLabel}`,
      accountFrom: from.id,
      accountTo: target,
      // Un virement vers le coffre d'une activité APPARTIENT à cette activité :
      // le classer « Finance » le faisait disparaître de son journal, alors que
      // l'argent, lui, arrivait bien chez elle.
      part: partOfCashAccount(target) || 'systeme',
      createdBy,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal open onClose={onClose} icon={ArrowLeftRight} size="md"
      title="Transférer de l'argent" subtitle={`Depuis ${from.name}`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={submit} disabled={value <= 0}>Valider le virement</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Solde source</p>
            <p className="font-black text-slate-700 tabular-nums">{money(from.balance)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Après virement</p>
            <p className="font-black text-slate-700 tabular-nums">{money(from.balance - value)}</p>
          </div>
        </div>

        <Field label="Destination" required hint="Une caisse de la station, ou un autre compte bancaire.">
          <Select value={target} onChange={e => setTarget(e.target.value)}>
            <optgroup label="Caisses de la station">
              {cashTargets.map(id => (
                <option key={id} value={id}>
                  {CASH_ACCOUNT_LABEL[id]}{id === CAISSE_ID ? ` — ${money(caisseBalance)}` : ''}
                </option>
              ))}
            </optgroup>
            {others.length > 0 && (
              <optgroup label="Comptes bancaires">
                {others.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)" required><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Motif du virement" /></Field>

        <div className="rounded-xl bg-[#001f5c] text-white p-4 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-blue-200 min-w-0">
            {Object.values(CAISSE_PART_ID).includes(target as any)
              ? `Crédité sur ${targetLabel}`
              : `Nouveau solde ${targetLabel}`}
          </span>
          <span className="text-lg font-black tabular-nums text-[#FFB800] shrink-0">
            {Object.values(CAISSE_PART_ID).includes(target as any)
              ? `+${money(value)}`
              : money(targetBalance + value)}
          </span>
        </div>
      </div>
    </Modal>
  );
}

// ─── History of one account ────────────────────────────────────────────────────
function AccountHistory({
  account, txs, accounts, onClose,
}: {
  account: BankAccount & { balance: number };
  txs: TreasuryTransaction[];
  accounts: BankAccount[];
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  // A movement can come from / go to a bank account, any caisse of the station
  // (générale, Carburant, Cafétéria, Lavage) or the outside world.
  const label = (id?: string) => accountLabelOf(id, accounts, id ? '—' : 'Externe');

  const rows = useMemo(() => txs
    .filter(t => (t.accountFrom === account.id || t.accountTo === account.id) && inPeriod(t.date, period, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [txs, account.id, period, from, to]);

  const credit = rows.filter(t => t.accountTo === account.id).reduce((s, t) => s + t.amount, 0);
  const debit = rows.filter(t => t.accountFrom === account.id).reduce((s, t) => s + t.amount, 0);

  return (
    <Modal open onClose={onClose} icon={History} size="2xl"
      title={`Historique — ${account.name}`} subtitle={`Solde actuel : ${money(account.balance)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Entrées</p>
            <p className="font-black text-emerald-600 tabular-nums">+{money(credit)}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-3 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Sorties</p>
            <p className="font-black text-red-600 tabular-nums">−{money(debit)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Net période</p>
            <p className="font-black text-slate-700 tabular-nums">{money(credit - debit)}</p>
          </div>
        </div>

        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />

        {rows.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Aucun mouvement sur la période</p>
        ) : (
          <Table head={<>
            <th className="table-head">Date</th><th className="table-head">Nature</th>
            <th className="table-head">Description</th><th className="table-head">Contrepartie</th>
            <th className="table-head text-right">Montant</th>
          </>}>
            {rows.map(t => {
              const isIn = t.accountTo === account.id;
              return (
                <tr key={t.id}>
                  <td className="table-cell">{formatDate(t.date)}</td>
                  <td className="table-cell"><Badge tone={isIn ? 'success' : 'danger'}>{TX_LABEL[t.kind] || t.kind}</Badge></td>
                  <td className="table-cell">
                    {t.description || '—'}
                    {(t.chequeNumber || t.bordereauNumber) && (
                      <div className="text-[11px] text-slate-400">
                        {t.chequeNumber ? `Chèque ${t.chequeNumber}` : ''}
                        {t.chequeNumber && t.bordereauNumber ? ' • ' : ''}
                        {t.bordereauNumber ? `Bordereau ${t.bordereauNumber}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="table-cell">{label(isIn ? t.accountFrom : t.accountTo)}</td>
                  <td className={`table-cell text-right tabular-nums font-bold ${isIn ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isIn ? '+' : '−'}{money(t.amount)}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>
    </Modal>
  );
}

export const TX_LABEL: Record<string, string> = {
  DEPOSIT: 'Dépôt', WITHDRAW: 'Retrait', TRANSFER: 'Virement',
  PURCHASE: 'Achat', SALE: 'Vente', EXPENSE: 'Dépense',
  BRIGADE: 'Brigade', TPE: 'TPE', SALARY: 'Salaire', ADJUST: 'Ajustement',
};
