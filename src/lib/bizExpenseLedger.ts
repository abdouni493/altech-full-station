/**
 * ─── La dépense d'une partie, dans le grand livre de la station ────────────────
 *
 * Une dépense de la Cafétéria ou du Lavage vit dans le blob de sa partie. Tant
 * qu'elle est réglée EN ESPÈCES, elle n'a rien à faire de plus : la caisse de la
 * partie la compte depuis son propre document (`bizReporting.moduleCaisseMovements`).
 *
 * Réglée par la BANQUE, en revanche, elle sort d'un compte de la station : sans
 * ligne au grand livre, l'argent quittait le compte sans que le solde bouge, et
 * la dépense n'apparaissait dans l'historique d'aucun compte. C'est ce lien-là
 * que ce module tient — dans les deux sens, pour qu'une modification ou une
 * suppression ne laisse jamais une ligne orpheline derrière elle.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { newId } from './utils';
import { BizExpense, ModuleKey, MODULES, bizExpensePaidInCash } from './bizConfig';
import { TreasuryTransaction, TreasuryPart } from '../store/AppContext';

/** `refType` des lignes nées d'une dépense de partie. */
export const BIZ_EXPENSE_REF = 'biz_expense';

/** Les lignes du grand livre écrites par une dépense de partie. */
export const bizExpenseTxsOf = (txs: TreasuryTransaction[], expenseId: string): TreasuryTransaction[] =>
  (txs || []).filter(t => t.refType === BIZ_EXPENSE_REF && t.refId === expenseId);

/**
 * Aligne le grand livre sur une dépense de partie : l'ancienne ligne est
 * réécrite (jamais complétée), pour que le solde du compte reste exact après
 * une modification du montant, de la date ou du compte débité.
 */
export function syncBizExpenseLedger(
  dispatch: (a: any) => void,
  txs: TreasuryTransaction[],
  moduleKey: ModuleKey,
  expense: BizExpense,
  createdBy?: string,
): void {
  bizExpenseTxsOf(txs, expense.id)
    .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));

  // Payée en espèces : la caisse de la partie la porte déjà, une ligne de plus
  // ferait sortir le même argent deux fois.
  if (bizExpensePaidInCash(expense) || !(expense.amount > 0)) return;

  const tx: TreasuryTransaction = {
    id: newId(),
    date: new Date(expense.date).toISOString(),
    kind: 'EXPENSE',
    amount: expense.amount,
    description: `Dépense ${MODULES[moduleKey].label} — ${expense.name}`
      + (expense.category ? ` (${expense.category})` : ''),
    accountFrom: expense.accountId,
    part: moduleKey as TreasuryPart,
    refType: BIZ_EXPENSE_REF,
    refId: expense.id,
    chequeNumber: expense.chequeNumber || undefined,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
}

/** Une dépense supprimée emporte sa ligne : sinon le compte reste amputé. */
export function removeBizExpenseLedger(
  dispatch: (a: any) => void,
  txs: TreasuryTransaction[],
  expenseId: string,
): void {
  bizExpenseTxsOf(txs, expenseId)
    .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
}
