import type { Request, Response } from 'express';
import { expenseService } from './expense.service';
import { expenseCategoryService } from './expenseCategory.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
} from './expense.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const expenseController = {
  async create(req: Request, res: Response): Promise<void> {
    const expense = await expenseService.create(req.body as CreateExpenseInput, requireActor(req));
    sendSuccess(res, expense, { statusCode: 201, message: 'Expense recorded' });
  },

  async list(req: Request, res: Response): Promise<void> {
    const { expenses, meta } = await expenseService.list(req.query as unknown as ListExpensesQuery);
    sendSuccess(res, expenses, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await expenseService.getById(req.params.id));
  },

  async update(req: Request, res: Response): Promise<void> {
    const expense = await expenseService.update(req.params.id, req.body as UpdateExpenseInput, requireActor(req));
    sendSuccess(res, expense, { message: 'Expense updated' });
  },

  async void(req: Request, res: Response): Promise<void> {
    const { reason } = req.body as { reason: string };
    const expense = await expenseService.void(req.params.id, reason, requireActor(req));
    sendSuccess(res, expense, { message: 'Expense voided' });
  },
};

export const expenseCategoryController = {
  async create(req: Request, res: Response): Promise<void> {
    const category = await expenseCategoryService.create(req.body as CreateExpenseCategoryInput, requireActor(req));
    sendSuccess(res, category, { statusCode: 201, message: 'Expense category created' });
  },

  async list(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await expenseCategoryService.list(req.query as { isActive?: boolean }));
  },

  async update(req: Request, res: Response): Promise<void> {
    const category = await expenseCategoryService.update(
      req.params.id,
      req.body as UpdateExpenseCategoryInput,
      requireActor(req),
    );
    sendSuccess(res, category, { message: 'Expense category updated' });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const result = await expenseCategoryService.delete(req.params.id, requireActor(req));
    sendSuccess(res, result, {
      message: result.softDeleted
        ? 'Category has expenses and was deactivated instead of deleted'
        : 'Expense category deleted',
    });
  },
};
