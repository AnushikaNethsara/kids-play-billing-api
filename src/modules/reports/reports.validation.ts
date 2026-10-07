import { z } from 'zod';
import { NAMED_PERIODS } from '../../common/utils/dateRange';
import { BillStatus } from '../../common/constants/billStatus';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import { ExceptionType } from './reports.types';

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const rangeShape = {
  period: z.enum(NAMED_PERIODS).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
};

const exportShape = {
  format: z.enum(['json', 'csv']).default('json'),
  includeContact: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
};

const pageShape = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
};

export const dailyCloseQuerySchema = z.object({
  date: businessDate,
});

export const billRegisterQuerySchema = z.object({
  ...rangeShape,
  ...exportShape,
  ...pageShape,
  status: z.enum([BillStatus.PAID, BillStatus.REFUNDED, BillStatus.CANCELLED]).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  cashierId: z.string().length(24, 'Invalid id').optional(),
  level: z.enum(['bill', 'line']).default('bill'),
});

export const exceptionsQuerySchema = z.object({
  ...rangeShape,
  ...exportShape,
  type: z.nativeEnum(ExceptionType).optional(),
});

export const sessionReportQuerySchema = z.object({
  ...rangeShape,
  ...exportShape,
  ...pageShape,
  status: z.nativeEnum(PlaySessionStatus).optional(),
});

export const customerReportQuerySchema = z.object({
  ...rangeShape,
  format: exportShape.format,
  groupBy: z.enum(['day', 'week', 'month']).optional(),
});

export const periodSummaryQuerySchema = z.object({
  ...rangeShape,
  format: exportShape.format,
  groupBy: z.enum(['day', 'week', 'month']).optional(),
  breakdown: z.enum(['period', 'cashier', 'package', 'product', 'paymentMethod']).default('period'),
});
