import { Types } from 'mongoose';
import { ExpenseCategoryModel, type ExpenseCategoryHydrated } from './expenseCategory.model';
import { ExpenseModel } from './expense.model';
import type {
  CreateExpenseCategoryInput,
  ExpenseCategoryPublic,
  UpdateExpenseCategoryInput,
} from './expense.types';
import { DuplicateResourceError, NotFoundError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import type { AuthenticatedUser } from '../../common/types/express';

/** The categories `npm run seed` creates. An admin can rename, add or deactivate them. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Salaries',
  'Utilities',
  'Maintenance & repairs',
  'Cleaning & supplies',
  'Stock purchases',
  'Marketing',
  'Equipment',
  'Bank & card fees',
  'Other',
];

const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

export function toPublicExpenseCategory(category: ExpenseCategoryHydrated): ExpenseCategoryPublic {
  return {
    id: category.id,
    name: category.name,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await ExpenseCategoryModel.findOne({ name }).collation(CASE_INSENSITIVE).exec();
  if (clash && clash.id !== exceptId) {
    throw new DuplicateResourceError(`An expense category named "${clash.name}" already exists`);
  }
}

async function findOrThrow(id: string): Promise<ExpenseCategoryHydrated> {
  const category = await ExpenseCategoryModel.findById(id).exec();
  if (!category) throw new NotFoundError('Expense category not found');
  return category;
}

export const expenseCategoryService = {
  async create(input: CreateExpenseCategoryInput, actor: AuthenticatedUser): Promise<ExpenseCategoryPublic> {
    await assertNameFree(input.name);
    const category = await ExpenseCategoryModel.create({
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      createdBy: actor.id,
      updatedBy: actor.id,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.EXPENSE_CATEGORY_CREATED,
      entityType: AuditEntityType.EXPENSE_CATEGORY,
      entityId: category.id,
      after: toPublicExpenseCategory(category),
    });

    return toPublicExpenseCategory(category);
  },

  async list(filter: { isActive?: boolean }): Promise<ExpenseCategoryPublic[]> {
    const query: Record<string, unknown> = {};
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    const categories = await ExpenseCategoryModel.find(query).sort({ sortOrder: 1, name: 1 }).exec();
    return categories.map(toPublicExpenseCategory);
  },

  findOrThrow,

  /**
   * Renaming does not touch expenses already entered: each keeps the name it was filed
   * under. Reports group by id, so the totals still land on one row.
   */
  async update(id: string, input: UpdateExpenseCategoryInput, actor: AuthenticatedUser): Promise<ExpenseCategoryPublic> {
    const category = await findOrThrow(id);
    if (input.name !== undefined) await assertNameFree(input.name, id);

    const before = toPublicExpenseCategory(category);
    if (input.name !== undefined) category.name = input.name;
    if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) category.isActive = input.isActive;
    category.updatedBy = new Types.ObjectId(actor.id);
    await category.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.EXPENSE_CATEGORY_UPDATED,
      entityType: AuditEntityType.EXPENSE_CATEGORY,
      entityId: category.id,
      before,
      after: toPublicExpenseCategory(category),
    });

    return toPublicExpenseCategory(category);
  },

  /** Deactivates instead of deleting once any expense, voided or not, uses the category. */
  async delete(id: string, actor: AuthenticatedUser): Promise<{ softDeleted: boolean }> {
    const category = await findOrThrow(id);

    if (await ExpenseModel.exists({ categoryId: category._id })) {
      if (category.isActive) {
        const before = toPublicExpenseCategory(category);
        category.isActive = false;
        category.updatedBy = new Types.ObjectId(actor.id);
        await category.save();

        await auditLogService.record({
          userId: actor.id,
          userName: actor.name,
          action: AuditAction.EXPENSE_CATEGORY_UPDATED,
          entityType: AuditEntityType.EXPENSE_CATEGORY,
          entityId: category.id,
          before,
          after: toPublicExpenseCategory(category),
          metadata: { reason: 'Deactivated instead of deleted - category has expenses' },
        });
      }
      return { softDeleted: true };
    }

    await category.deleteOne();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.EXPENSE_CATEGORY_DELETED,
      entityType: AuditEntityType.EXPENSE_CATEGORY,
      entityId: id,
      before: toPublicExpenseCategory(category),
    });

    return { softDeleted: false };
  },
};
