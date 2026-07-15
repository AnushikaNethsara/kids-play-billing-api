import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'this_year']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const revenueQuerySchema = dashboardQuerySchema.extend({
  groupBy: z.enum(['day', 'month', 'year']).optional(),
});

export const recentBillsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});
