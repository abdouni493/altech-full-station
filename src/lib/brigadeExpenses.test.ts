/**
 * Non-régression des dépenses nées d'une brigade.
 *   npx tsx src/lib/brigadeExpenses.test.ts
 */
import assert from 'node:assert/strict';
import { planBrigadeExpenses, BRIGADE_EXPENSE_CATEGORY } from './brigadeExpenses';

const ctx = {
  brigadeId: 'B1',
  date: '2026-08-28',
  shift: 'Matin',
  createdBy: 'Admin',
  pompisteName: (id?: string) => (id === 'P1' ? 'Ali' : undefined),
};

const justif = (over: any = {}) => ({
  id: 'J1', accountingId: 'A1', clientId: '', amount: 500,
  justificationType: 'EXPENSE' as const, clientName: 'Achat eau',
  pompisteId: 'P1', ...over,
});

// 1. Une justification « dépense » devient une dépense du Carburant.
{
  const plan = planBrigadeExpenses([justif()], [], ctx);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.update.length, 0);
  assert.equal(plan.remove.length, 0);
  const e = plan.add[0];
  assert.equal(e.id, 'J1', "la dépense porte l'id de sa justification");
  assert.equal(e.amount, 500);
  assert.equal(e.part, 'carburant');
  assert.equal(e.accountId, 'CAISSE_CARBURANT');
  assert.equal(e.description, 'Achat eau');
  assert.equal(e.category, BRIGADE_EXPENSE_CATEGORY, 'sans catégorie choisie');
  assert.equal(e.brigadeId, 'B1');
  assert.equal(e.brigadeJustificationId, 'J1');
  assert.equal(e.pompisteId, 'P1');
  assert.match(e.recipient || '', /Ali/);
}

// 2. La catégorie choisie et la précision libre sont reprises.
{
  const plan = planBrigadeExpenses(
    [justif({ expenseCategory: 'Entretien', notes: 'pour la piste 2' })], [], ctx);
  assert.equal(plan.add[0].category, 'Entretien');
  assert.equal(plan.add[0].description, 'Achat eau — pour la piste 2');
}

// 3. Rouvrir la brigade MET À JOUR la dépense, il n'en naît pas une seconde.
{
  const already = planBrigadeExpenses([justif()], [], ctx).add;
  const plan = planBrigadeExpenses([justif({ amount: 800 })], already, ctx);
  assert.equal(plan.add.length, 0);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].amount, 800);
  assert.equal(plan.remove.length, 0);
}

// 4. Retirer la justification supprime SA dépense — et elle seule.
{
  const already = planBrigadeExpenses([justif(), justif({ id: 'J2' })], [], ctx).add;
  const manuelle: any = { id: 'X1', date: '2026-08-28', category: 'Divers', amount: 100, description: 'saisie à la main' };
  const plan = planBrigadeExpenses([justif()], [...already, manuelle], ctx);
  assert.deepEqual(plan.remove, ['J2']);
  assert.equal(plan.update.length, 1);
}

// 5. Une justification d'un AUTRE type ne produit aucune dépense, et une
//    dépense à zéro dinar non plus.
{
  const bon: any = { id: 'J3', accountingId: 'A1', clientId: 'C1', amount: 900, justificationType: 'CLIENT' };
  const vide = justif({ id: 'J4', amount: 0 });
  const plan = planBrigadeExpenses([bon, vide], [], ctx);
  assert.equal(plan.add.length, 0);
}

// 6. Les dépenses d'une AUTRE brigade ne sont jamais touchées.
{
  const autre: any = { id: 'Z1', date: '2026-08-27', category: 'Divers', amount: 300, description: 'autre brigade', brigadeId: 'B2', brigadeJustificationId: 'Z1' };
  const plan = planBrigadeExpenses([], [autre], ctx);
  assert.deepEqual(plan.remove, []);
}

console.log('✓ brigadeExpenses — 6 cas');
