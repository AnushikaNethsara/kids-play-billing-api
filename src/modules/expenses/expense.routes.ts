import { Router } from 'express';
import { expenseCategoryController, expenseController } from './expense.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  createExpenseCategorySchema,
  createExpenseSchema,
  expenseCategoryIdParamSchema,
  expenseIdParamSchema,
  listExpenseCategoriesQuerySchema,
  listExpensesQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
  voidExpenseSchema,
} from './expense.validation';

// Expenses are admin-only end to end: a cashier never sees what the business spends.
const expenses = Router();
expenses.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /expenses:
 *   post:
 *     summary: Record an expense (admin-only)
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [spentOn, amount, categoryId, paymentMethod]
 *             properties:
 *               spentOn: { type: string, example: "2026-11-07", description: Business day the expense belongs to }
 *               amount: { type: integer, example: 1500000, description: Integer minor units (LKR cents) }
 *               categoryId: { type: string }
 *               description: { type: string }
 *               vendor: { type: string }
 *               reference: { type: string, description: Invoice or receipt number }
 *               paymentMethod: { type: string, enum: [CASH, CARD, BANK_TRANSFER, OTHER] }
 *     responses:
 *       201: { description: Expense recorded }
 *   get:
 *     summary: List expenses, newest day first, with the filtered total in meta.totals (admin-only)
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: period, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: paymentMethod, schema: { type: string, enum: [CASH, CARD, BANK_TRANSFER, OTHER] } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, VOIDED, ALL], default: ACTIVE } }
 *     responses:
 *       200: { description: List of expenses }
 */
expenses.post('/', validate({ body: createExpenseSchema }), asyncHandler(expenseController.create));
expenses.get('/', validate({ query: listExpensesQuerySchema }), asyncHandler(expenseController.list));

/**
 * @openapi
 * /expenses/{id}:
 *   get:
 *     summary: Get an expense (admin-only)
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Expense details }
 *   patch:
 *     summary: Edit an active expense (admin-only). Audited with before and after.
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Expense updated }
 */
expenses.get('/:id', validate({ params: expenseIdParamSchema }), asyncHandler(expenseController.getById));
expenses.patch(
  '/:id',
  validate({ params: expenseIdParamSchema, body: updateExpenseSchema }),
  asyncHandler(expenseController.update),
);

/**
 * @openapi
 * /expenses/{id}/void:
 *   post:
 *     summary: Void an expense with a reason (admin-only). Expenses are never deleted.
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Expense voided }
 */
expenses.post(
  '/:id/void',
  validate({ params: expenseIdParamSchema, body: voidExpenseSchema }),
  asyncHandler(expenseController.void),
);

const categories = Router();
categories.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /expense-categories:
 *   post:
 *     summary: Create an expense category (admin-only)
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Rent" }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Category created }
 *   get:
 *     summary: List expense categories (admin-only)
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: string, enum: ["true", "false"] } }
 *     responses:
 *       200: { description: List of categories }
 */
categories.post('/', validate({ body: createExpenseCategorySchema }), asyncHandler(expenseCategoryController.create));
categories.get('/', validate({ query: listExpenseCategoriesQuerySchema }), asyncHandler(expenseCategoryController.list));

/**
 * @openapi
 * /expense-categories/{id}:
 *   patch:
 *     summary: Rename, reorder or (de)activate a category (admin-only). Old expenses keep their name.
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Category updated }
 *   delete:
 *     summary: Delete a category, or deactivate it if any expense uses it (admin-only)
 *     tags: [Expenses]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Category deleted or deactivated }
 */
categories.patch(
  '/:id',
  validate({ params: expenseCategoryIdParamSchema, body: updateExpenseCategorySchema }),
  asyncHandler(expenseCategoryController.update),
);
categories.delete(
  '/:id',
  validate({ params: expenseCategoryIdParamSchema }),
  asyncHandler(expenseCategoryController.remove),
);

export const expenseRoutes = expenses;
export const expenseCategoryRoutes = categories;
