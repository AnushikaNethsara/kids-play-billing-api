import { z } from 'zod';
import { NAMED_PERIODS } from '../../common/utils/dateRange';

export const dashboardQuerySchema = z.object({
  period: z.enum(NAMED_PERIODS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const revenueQuerySchema = dashboardQuerySchema.extend({
  groupBy: z.enum(['day', 'month', 'year']).optional(),
});

export const recentBillsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});
