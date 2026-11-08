import { z } from 'zod';
import { NAMED_PERIODS } from '../../common/utils/dateRange';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { ExpenseStatus } from './expense.model';

const objectId = (label: string) => z.string().length(24, `Invalid ${label} id`);
const businessDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');

export const createExpenseSchema = z.object({
  spentOn: businessDay,
  // Integer minor units. An expense of zero records nothing, so it is refused.
  amount: z.number().int().positive(),
  categoryId: objectId('category'),
  description: z.string().trim().max(500).optional(),
  vendor: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(100).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
});

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const voidExpenseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  period: z.enum(NAMED_PERIODS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  categoryId: objectId('category').optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  status: z.enum([ExpenseStatus.ACTIVE, ExpenseStatus.VOIDED, 'ALL']).default(ExpenseStatus.ACTIVE),
});

export const expenseIdParamSchema = z.object({ id: objectId('expense') });

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().optional(),
});

export const updateExpenseCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listExpenseCategoriesQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
});

export const expenseCategoryIdParamSchema = z.object({ id: objectId('category') });
