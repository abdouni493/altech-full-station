/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  LES DÉPENSES NÉES D'UNE BRIGADE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Une brigade justifie son reste « par dépense » : le pompiste a payé quelque
 * chose (un bidon d'eau, une réparation, un pourboire) avec les espèces de la
 * brigade, et remet d'autant moins. La justification équilibrait la brigade —
 * et s'arrêtait là. La charge n'apparaissait NULLE PART : ni dans l'écran
 * Dépenses, ni dans le résultat du Carburant.
 *
 * Chaque justification `EXPENSE` devient donc une vraie dépense de l'écran
 * Dépenses, imputée au Carburant, avec la brigade qui l'a produite inscrite
 * dessus (`brigadeId`, `brigadeJustificationId`, `pompisteId`).
 *
 * DEUX RÈGLES tiennent tout le reste :
 *
 *  1. **Un identifiant partagé.** La dépense porte l'`id` de sa justification.
 *     Rouvrir la brigade et corriger le montant met donc la MÊME dépense à
 *     jour au lieu d'en créer une seconde ; retirer la justification supprime
 *     la dépense.
 *
 *  2. **Aucune sortie de caisse.** L'argent n'est jamais entré dans le tiroir
 *     — la brigade a remis son montant en moins. Ces dépenses n'écrivent donc
 *     AUCUNE ligne de grand livre et sont écartées de toute lecture de
 *     trésorerie (`isBrigadeExpense`, voir `lib/carburantSales.ts`,
 *     `lib/treasuryReporting.ts`, `pages/CaisseGenerale.tsx`). Elles restent en
 *     revanche des charges à part entière dans les rapports de résultat.
 */
import { BrigadeAccountingJustification, Expense, cashAccountOfPart } from '../store/AppContext';

/** La catégorie d'office d'une dépense de brigade laissée sans catégorie. */
export const BRIGADE_EXPENSE_CATEGORY = 'Dépense brigade';

/** Ce qu'il faut savoir de la brigade pour habiller ses dépenses. */
export interface BrigadeExpenseContext {
  brigadeId: string;
  /** La date de la brigade (`yyyy-mm-dd`) : celle que portera la dépense. */
  date: string;
  /** Le poste (« Matin », « Soir »…) — inscrit sur le bénéficiaire. */
  shift?: string;
  /** Qui enregistre — repris tel quel sur la dépense. */
  createdBy?: string;
  /** Le nom d'un pompiste, pour dire QUI a payé. */
  pompisteName?: (id?: string) => string | undefined;
}

/** Les écritures à passer sur l'écran Dépenses pour une brigade enregistrée. */
export interface BrigadeExpensePlan {
  /** Les dépenses à créer. */
  add: Expense[];
  /** Les dépenses déjà présentes, à mettre à jour. */
  update: Expense[];
  /** Les `id` des dépenses de cette brigade qui n'ont plus de justification. */
  remove: string[];
}

/** Une justification qui doit donner une dépense. */
const isExpenseJustification = (j: BrigadeAccountingJustification): boolean =>
  j.justificationType === 'EXPENSE' && (j.amount || 0) > 0;

/** La dépense que porte une justification, telle qu'elle s'écrira. */
export function brigadeExpenseOf(
  j: BrigadeAccountingJustification,
  ctx: BrigadeExpenseContext,
): Expense {
  const pompiste = ctx.pompisteName?.(j.pompisteId);
  const name = (j.clientName || '').trim() || BRIGADE_EXPENSE_CATEGORY;
  const detail = (j.notes || '').trim();
  return {
    id: j.id,
    date: ctx.date,
    category: (j.expenseCategory || '').trim() || BRIGADE_EXPENSE_CATEGORY,
    amount: j.amount || 0,
    // Le nom de la dépense fait le libellé ; la précision facultative saisie
    // sur la justification le complète, sans quoi elle serait perdue ici.
    description: detail ? `${name} — ${detail}` : name,
    // Payée sur les espèces de la brigade : le mode est toujours l'espèce, et
    // le coffre nommé est celui du Carburant — même si aucune ligne de grand
    // livre n'en sort (voir l'en-tête).
    paymentMode: 'Espèces',
    accountId: cashAccountOfPart('carburant'),
    part: 'carburant',
    paidBy: 'Brigade',
    recipient: [pompiste, ctx.shift ? `Brigade ${ctx.shift}` : 'Brigade']
      .filter(Boolean).join(' — '),
    status: 'Validé',
    brigadeId: ctx.brigadeId,
    brigadeJustificationId: j.id,
    pompisteId: j.pompisteId,
    createdBy: ctx.createdBy,
  };
}

/**
 * Ce qu'il faut ajouter, mettre à jour et supprimer dans l'écran Dépenses pour
 * que ses lignes reflètent EXACTEMENT les justifications « dépense » de la
 * brigade — à la création comme à la moindre correction.
 */
export function planBrigadeExpenses(
  justifications: BrigadeAccountingJustification[] | undefined,
  existingExpenses: Expense[] | undefined,
  ctx: BrigadeExpenseContext,
): BrigadeExpensePlan {
  const kept = (justifications || []).filter(isExpenseJustification);
  const keptIds = new Set(kept.map(j => j.id));
  const byId = new Map((existingExpenses || []).map(e => [e.id, e]));

  const add: Expense[] = [];
  const update: Expense[] = [];
  kept.forEach(j => {
    const row = brigadeExpenseOf(j, ctx);
    // La dépense porte l'id de sa justification : elle est donc REPRISE, jamais
    // dupliquée, quand la brigade est rouverte et corrigée.
    if (byId.has(j.id)) update.push(row); else add.push(row);
  });

  const remove = (existingExpenses || [])
    .filter(e => e.brigadeId === ctx.brigadeId
      && !keptIds.has(e.brigadeJustificationId || e.id))
    .map(e => e.id);

  return { add, update, remove };
}
