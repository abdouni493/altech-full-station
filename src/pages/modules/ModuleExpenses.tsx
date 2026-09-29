import React, { useMemo, useState } from 'react';
import { CreditCard, Plus, TrendingDown, Calendar, Banknote, Landmark, Wallet } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizExpense, bizExpensePaidInCash } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import {
  useBizPermission, useAppState, useAppDispatch,
  bankBalanceOf, cashAccountOfPart, CASH_ACCOUNT_LABEL, TreasuryPart,
} from '@/src/store/AppContext';
import { moduleCaisseBalance } from '@/src/lib/bizReporting';
import { syncBizExpenseLedger, removeBizExpenseLedger } from '@/src/lib/bizExpenseLedger';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, Field, Input, Textarea, Select,
  money, formatDate, PeriodFilter, Period, inPeriod, ViewToggle, Table,
} from '@/src/components/biz/Kit';

export default function ModuleExpenses({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'expenses');
  const app = useAppState();
  const dispatch = useAppDispatch();
  const { expenses } = biz.state;
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<BizExpense | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizExpense | null>(null);
  // Les dépenses s'affichent en tableau par défaut : une liste dense, lisible
  // d'un coup d'œil ; les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');

  const cats = useMemo(() => Array.from(new Set(expenses.map(e => e.category).filter(Boolean))) as string[], [expenses]);
  const filtered = useMemo(() => [...expenses]
    .filter(e => matchesSearch(search, e.name, e.category) && inPeriod(e.date, period, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [expenses, search, period, from, to]);
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  /** Ce qui est réellement sorti du tiroir de la partie sur la période. */
  const totalCash = filtered.filter(bizExpensePaidInCash).reduce((s, e) => s + e.amount, 0);
  /** Le solde de la caisse de la partie — le même calcul que la Caisse Générale. */
  const caisse = useMemo(
    () => moduleCaisseBalance(biz.state, moduleKey, app.treasuryTransactions, app.expenses),
    [biz.state, moduleKey, app.treasuryTransactions, app.expenses]);

  // Une dépense supprimée emporte la ligne de trésorerie qu'elle avait écrite
  // (paiement par banque), sinon le solde du compte resterait amputé.
  const del = () => {
    if (!toDelete) return;
    removeBizExpenseLedger(dispatch, app.treasuryTransactions, toDelete.id);
    biz.remove('expenses', toDelete.id);
    toast.success('Dépense supprimée');
    setToDelete(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={CreditCard} title="Dépenses" subtitle={`${cfg.label} — charges & dépenses`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle dépense</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={TrendingDown} label="Dépenses" value={filtered.length} tone="blue" />
        <StatCard icon={CreditCard} label="Total période" value={money(total)} tone="red" />
        <StatCard icon={Banknote} label="Payé en espèces" value={money(totalCash)} tone="amber"
          sub={`Banque ${money(total - totalCash)}`} />
        <StatCard icon={Wallet} label={`Caisse ${cfg.label}`} value={money(caisse)} tone={caisse >= 0 ? 'green' : 'red'}
          sub="après ces dépenses" />
      </div>

      <div className="rounded-2xl bg-blue-50/60 border border-blue-100 px-4 py-3 text-[12px] text-[#002d87]">
        Une dépense réglée <strong>en espèces</strong> sort de la <strong>caisse {cfg.label}</strong> — jamais de la caisse
        générale. Réglée par un <strong>compte bancaire</strong>, elle ne touche pas le tiroir : elle est débitée du compte
        choisi et apparaît dans son historique.
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Nom de la dépense…" />
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? <EmptyState icon={CreditCard} title="Aucune dépense" action={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle dépense</button> : undefined} /> : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Date</th><th className="table-head">Dépense</th>
          <th className="table-head">Catégorie</th><th className="table-head">Payée depuis</th>
          <th className="table-head text-right">Montant</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(e => (
            <tr key={e.id}>
              <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(e.date)}</td>
              <td className="table-cell">
                <div className="font-bold text-slate-700">{e.name}</div>
                {e.description && <div className="text-[11px] text-slate-400 truncate max-w-[280px]" title={e.description}>{e.description}</div>}
              </td>
              <td className="table-cell">{e.category ? <Badge tone="primary">{e.category}</Badge> : <span className="text-slate-400">—</span>}</td>
              <td className="table-cell">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                  {bizExpensePaidInCash(e)
                    ? <><Banknote className="w-3.5 h-3.5" /> Espèces — Caisse {cfg.label}</>
                    : <><Landmark className="w-3.5 h-3.5" /> {app.bankAccounts.find(a => a.id === e.accountId)?.name || 'Compte bancaire'}{e.chequeNumber ? ` · n° ${e.chequeNumber}` : ''}</>}
                </span>
              </td>
              <td className="table-cell text-right font-black text-red-600 tabular-nums">{money(e.amount)}</td>
              <td className="table-cell text-right">
                <RowActions>
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(e)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(e)} />}
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(e => (
            <GlassCard key={e.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{e.name}</h3>{e.category && <Badge tone="primary">{e.category}</Badge>}</div>
                <span className="font-black text-red-600 tabular-nums">{money(e.amount)}</span>
              </div>
              {e.description && <p className="text-xs text-slate-400 mt-2 line-clamp-2">{e.description}</p>}
              {/* D'où l'argent est sorti : le tiroir de la partie, ou un compte. */}
              <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5">
                {bizExpensePaidInCash(e)
                  ? <><Banknote className="w-3.5 h-3.5" /> Espèces — Caisse {cfg.label}</>
                  : <><Landmark className="w-3.5 h-3.5" /> {app.bankAccounts.find(a => a.id === e.accountId)?.name || 'Compte bancaire'}
                    {e.chequeNumber ? ` · n° ${e.chequeNumber}` : ''}</>}
              </p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(e.date)}</span>
                <RowActions>
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(e)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(e)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {form && <ExpenseForm moduleKey={moduleKey} initial={form === 'new' ? null : form} cats={cats} onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la dépense" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

/**
 * Saisie d'une dépense de la partie. Le choix qui compte est celui du COMPTE
 * DÉBITÉ : en espèces, l'argent sort de la caisse de la partie ; par la banque,
 * il sort du compte choisi et une ligne du grand livre le porte, sans toucher
 * au tiroir. Auparavant ce choix n'existait pas : toute dépense vidait la caisse
 * de la partie, même celle réglée par virement.
 */
function ExpenseForm({ moduleKey, initial, cats, onClose }: { moduleKey: ModuleKey; initial: BizExpense | null; cats: string[]; onClose: () => void }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const app = useAppState();
  const dispatch = useAppDispatch();
  const isEdit = !!initial;
  /** Le coffre de cette partie — la destination « espèces » du formulaire. */
  const coffer = cashAccountOfPart(moduleKey as TreasuryPart);
  const accounts = useMemo(
    () => app.bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, app.treasuryTransactions) })),
    [app.bankAccounts, app.treasuryTransactions]);
  const caisse = useMemo(
    () => moduleCaisseBalance(biz.state, moduleKey, app.treasuryTransactions, app.expenses),
    [biz.state, moduleKey, app.treasuryTransactions, app.expenses]);

  const [f, setF] = useState<Partial<BizExpense>>(initial
    ? { ...initial, accountId: initial.accountId || coffer }
    : { name: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0], category: '', accountId: coffer, paymentMode: 'Espèces' });
  const set = (k: keyof BizExpense, v: any) => setF(p => ({ ...p, [k]: v }));
  const paidCash = !f.accountId || f.accountId === coffer || f.accountId.startsWith('CAISSE');
  const amount = Number(f.amount) || 0;
  const before = paidCash ? caisse : (accounts.find(a => a.id === f.accountId)?.balance || 0);
  // Une modification rend d'abord l'ancien montant au compte qu'elle avait vidé.
  const givenBack = initial && (initial.accountId || coffer) === (f.accountId || coffer) ? (initial.amount || 0) : 0;
  const after = before - amount + givenBack;

  const save = () => {
    if (!f.name?.trim()) { toast.error('Nom requis'); return; }
    const exp: BizExpense = {
      id: initial?.id || newId(),
      name: f.name!.trim(),
      description: f.description,
      amount,
      date: f.date || new Date().toISOString().split('T')[0],
      category: f.category,
      accountId: paidCash ? coffer : f.accountId,
      paymentMode: paidCash ? 'Espèces' : (f.paymentMode && f.paymentMode !== 'Espèces' ? f.paymentMode : 'Virement'),
      chequeNumber: paidCash ? undefined : (f.chequeNumber || undefined),
    };
    if (isEdit) biz.update('expenses', exp); else biz.add('expenses', exp);
    // Le grand livre suit : une dépense payée par la banque débite son compte,
    // une dépense repassée en espèces reprend sa ligne.
    syncBizExpenseLedger(dispatch, app.treasuryTransactions, moduleKey, exp, app.currentUserName);
    toast.success(isEdit
      ? 'Dépense modifiée'
      : `Dépense créée — payée depuis ${paidCash ? `la caisse ${cfg.label}` : (accounts.find(a => a.id === exp.accountId)?.name || 'la banque')}`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} icon={CreditCard} size="md" title={isEdit ? 'Modifier la dépense' : 'Nouvelle dépense'}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer'}</button></>}>
      <div className="space-y-4">
        <Field label="Nom" required><Input value={f.name || ''} onChange={e => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)"><Input type="number" value={f.amount ?? 0} onChange={e => set('amount', e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={f.date || ''} onChange={e => set('date', e.target.value)} /></Field>
        </div>
        <Field label="Catégorie"><Input list="exp-cats" value={f.category || ''} onChange={e => set('category', e.target.value)} placeholder="Ex: Charges, Loyer…" />
          <datalist id="exp-cats">{cats.map(c => <option key={c} value={c} />)}</datalist></Field>

        {/* Le compte débité : la caisse de la partie, ou un compte bancaire. */}
        <Field label="Payée depuis" required
          hint={paidCash
            ? `L'argent sort de la caisse ${cfg.label} — la caisse générale n'est pas touchée.`
            : 'Le compte bancaire est débité ; la caisse de la partie ne bouge pas.'}>
          <Select value={f.accountId || coffer} onChange={e => {
            const accountId = e.target.value;
            setF(p => ({
              ...p,
              accountId,
              paymentMode: accountId === coffer ? 'Espèces'
                : (p.paymentMode && p.paymentMode !== 'Espèces' ? p.paymentMode : 'Virement'),
            }));
          }}>
            <option value={coffer}>
              Espèces — {CASH_ACCOUNT_LABEL[coffer] || `Caisse ${cfg.label}`} ({money(caisse)})
            </option>
            {accounts.length > 0 && (
              <optgroup label="Comptes bancaires">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>

        {!paidCash && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type d'opération">
              <Select value={f.paymentMode || 'Virement'} onChange={e => set('paymentMode', e.target.value)}>
                {['Virement', 'Chèque', 'TPE', 'Prélèvement'].map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="N° de chèque / bordereau">
              <Input value={f.chequeNumber || ''} onChange={e => set('chequeNumber', e.target.value)} placeholder="Optionnel" />
            </Field>
          </div>
        )}

        <div className="rounded-xl bg-slate-50 border border-slate-150 p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-bold text-slate-400">Compte débité</p>
            <p className="text-sm font-black text-[#002d87] truncate">
              {paidCash ? (CASH_ACCOUNT_LABEL[coffer] || `Caisse ${cfg.label}`) : (accounts.find(a => a.id === f.accountId)?.name || '—')}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase font-bold text-slate-400">Solde après</p>
            <p className={`text-sm font-black tabular-nums ${after < 0 ? 'text-red-600' : 'text-[#002d87]'}`}>{money(after)}</p>
          </div>
        </div>

        <Field label="Description"><Textarea value={f.description || ''} onChange={e => set('description', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
