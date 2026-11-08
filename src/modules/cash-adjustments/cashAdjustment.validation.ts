import { z } from 'zod';
import { NAMED_PERIODS } from '../../common/utils/dateRange';
import { CashAdjustmentStatus } from './cashAdjustment.model';

const businessDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');

/** A cash difference this large is almost certainly a typo, not a miscount. LKR 1,000,000.00. */
export const MAX_CASH_ADJUSTMENT = 100_000_000;

export const createCashAdjustmentSchema = z.object({
  businessDate: businessDay,
  // Signed integer minor units: + surplus, - shortage. Zero records nothing.
  amount: z
    .number()
    .int('Amount must be in minor units')
    .refine((value) => value !== 0, 'Amount cannot be zero')
    .refine((value) => Math.abs(value) <= MAX_CASH_ADJUSTMENT, 'Amount is too large'),
  reason: z.string().trim().min(1, 'A reason is required').max(300),
  notes: z.string().trim().max(500).optional(),
  countedCash: z.number().int().min(0).nullable().optional(),
  expectedCash: z.number().int().nullable().optional(),
});

export const updateCashAdjustmentSchema = createCashAdjustmentSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const voidCashAdjustmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const listCashAdjustmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  period: z.enum(NAMED_PERIODS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z
    .enum([CashAdjustmentStatus.ACTIVE, CashAdjustmentStatus.VOIDED, 'ALL'])
    .default(CashAdjustmentStatus.ACTIVE),
  kind: z.enum(['SURPLUS', 'SHORTAGE']).optional(),
});

export const cashAdjustmentIdParamSchema = z.object({ id: z.string().length(24, 'Invalid cash adjustment id') });
