import { Types, type FilterQuery } from 'mongoose';
import { ExpenseModel, ExpenseStatus, type ExpenseDocument, type ExpenseHydrated } from './expense.model';
import { expenseCategoryService } from './expenseCategory.service';
import type { CreateExpenseInput, ExpensePublic, ListExpensesQuery, UpdateExpenseInput } from './expense.types';
import { InvalidStateError, NotFoundError, ValidationError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { buildPaginationMeta, getSkip } from '../../common/utils/pagination';
import { businessToday, resolveDayRange } from '../../common/utils/dateRange';
import { settingsService } from '../settings/settings.service';
import type { AuthenticatedUser } from '../../common/types/express';

export function toPublicExpense(expense: ExpenseHydrated): ExpensePublic {
  return {
    id: expense.id,
    spentOn: expense.spentOn,
    amount: expense.amount,
    categoryId: expense.categoryId.toString(),
    categoryName: expense.categoryName,
    description: expense.description,
    vendor: expense.vendor,
    reference: expense.reference,
    paymentMethod: expense.paymentMethod,
    status: expense.status,
    voidedAt: expense.voidedAt,
    voidedBy: expense.voidedBy?.toString() ?? null,
    voidReason: expense.voidReason,
    createdBy: expense.createdBy?.toString() ?? null,
    updatedBy: expense.updatedBy?.toString() ?? null,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

/** An expense dated in the future would show up as profit lost on a day that has not happened. */
async function assertNotFuture(spentOn: string): Promise<void> {
  const settings = await settingsService.getRaw();
  if (spentOn > businessToday(settings.timezone)) {
    throw new ValidationError('An expense cannot be dated in the future');
  }
}

async function findOrThrow(id: string): Promise<ExpenseHydrated> {
  const expense = await ExpenseModel.findById(id).exec();
  if (!expense) throw new NotFoundError('Expense not found');
  return expense;
}

async function buildListFilter(query: Omit<ListExpensesQuery, 'page' | 'limit'>): Promise<FilterQuery<ExpenseDocument>> {
  const filter: FilterQuery<ExpenseDocument> = {};
  if (query.status !== 'ALL') filter.status = query.status;
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;

  // No range at all lists everything; a range uses the same presets as every report.
  if (query.period || query.from || query.to) {
    const settings = await settingsService.getRaw();
    const { fromDay, toDay } = resolveDayRange(settings.timezone, query);
    filter.spentOn = { $gte: fromDay, $lte: toDay };
  }
  return filter;
}

export const expenseService = {
  async create(input: CreateExpenseInput, actor: AuthenticatedUser): Promise<ExpensePublic> {
    await assertNotFuture(input.spentOn);
    const category = await expenseCategoryService.findOrThrow(input.categoryId);
    if (!category.isActive) throw new InvalidStateError('That expense category is inactive');

    const expense = await ExpenseModel.create({
      spentOn: input.spentOn,
      amount: input.amount,
      categoryId: category._id,
      categoryName: category.name,
      description: input.description ?? '',
      vendor: input.vendor ?? '',
      reference: input.reference ?? '',
      paymentMethod: input.paymentMethod,
      createdBy: actor.id,
      updatedBy: actor.id,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.EXPENSE_CREATED,
      entityType: AuditEntityType.EXPENSE,
      entityId: expense.id,
      after: toPublicExpense(expense),
    });

    return toPublicExpense(expense);
  },

  async list(query: ListExpensesQuery) {
    const filter = await buildListFilter(query);
    const pagination = { page: query.page, limit: query.limit };

    const [expenses, total, [sums]] = await Promise.all([
      ExpenseModel.find(filter)
        .sort({ spentOn: -1, createdAt: -1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      ExpenseModel.countDocuments(filter),
      ExpenseModel.aggregate<{ amount: number }>([
        { $match: filter },
        { $group: { _id: null, amount: { $sum: '$amount' } } },
      ]),
    ]);

    return {
      expenses: expenses.map(toPublicExpense),
      meta: { ...buildPaginationMeta(pagination, total), totals: { amount: sums?.amount ?? 0, count: total } },
    };
  },

  async getById(id: string): Promise<ExpensePublic> {
    return toPublicExpense(await findOrThrow(id));
  },

  /**
   * Edits are allowed - an expense prints nothing a customer holds - but each one is
   * audited with before and after, and surfaces on the exceptions report.
   */
  async update(id: string, input: UpdateExpenseInput, actor: AuthenticatedUser): Promise<ExpensePublic> {
    const expense = await findOrThrow(id);
    if (expense.status !== ExpenseStatus.ACTIVE) {
      throw new InvalidStateError('A voided expense cannot be edited');
    }
    if (input.spentOn !== undefined) await assertNotFuture(input.spentOn);

    const before = toPublicExpense(expense);

    if (input.categoryId !== undefined && input.categoryId !== expense.categoryId.toString()) {
      const category = await expenseCategoryService.findOrThrow(input.categoryId);
      if (!category.isActive) throw new InvalidStateError('That expense category is inactive');
      expense.categoryId = category._id;
      expense.categoryName = category.name;
    }
    if (input.spentOn !== undefined) expense.spentOn = input.spentOn;
    if (input.amount !== undefined) expense.amount = input.amount;
    if (input.description !== undefined) expense.description = input.description;
    if (input.vendor !== undefined) expense.vendor = input.vendor;
    if (input.reference !== undefined) expense.reference = input.reference;
    if (input.paymentMethod !== undefined) expense.paymentMethod = input.paymentMethod;
    expense.updatedBy = new Types.ObjectId(actor.id);
    await expense.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.EXPENSE_UPDATED,
      entityType: AuditEntityType.EXPENSE,
      entityId: expense.id,
      before,
      after: toPublicExpense(expense),
    });

    return toPublicExpense(expense);
  },

  /** Compare-and-set out of ACTIVE, so two admins voiding at once record one void. */
  async void(id: string, reason: string, actor: AuthenticatedUser): Promise<ExpensePublic> {
    const before = await findOrThrow(id);
    const voided = await ExpenseModel.findOneAndUpdate(
      { _id: before._id, status: ExpenseStatus.ACTIVE },
      {
        $set: {
          status: ExpenseStatus.VOIDED,
          voidedAt: new Date(),
          voidedBy: new Types.ObjectId(actor.id),
          voidReason: reason,
          updatedBy: new Types.ObjectId(actor.id),
        },
      },
      { new: true },
    ).exec();
    if (!voided) throw new InvalidStateError('Expense is already voided');

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.EXPENSE_VOIDED,
      entityType: AuditEntityType.EXPENSE,
      entityId: voided.id,
      before: toPublicExpense(before),
      after: toPublicExpense(voided),
      metadata: { reason },
    });

    return toPublicExpense(voided);
  },
};
