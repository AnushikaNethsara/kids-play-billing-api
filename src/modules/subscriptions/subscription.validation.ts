import { z } from 'zod';
import { SubscriptionDisplayStatus } from './subscriptionRules';
import { MAX_CHILDREN_PER_TICKET } from '../play-sessions/playSession.validation';
import { NAMED_PERIODS } from '../../common/utils/dateRange';

const childNameSchema = z.string().trim().min(1, 'A child name cannot be empty').max(100);

/** The names a cashier types when selling a subscription, or edits later. */
export const subscriptionChildrenSchema = z
  .array(childNameSchema)
  .min(1, 'At least one child must be named on a subscription')
  .max(MAX_CHILDREN_PER_TICKET, `A subscription can name at most ${MAX_CHILDREN_PER_TICKET} children`);

export const listSubscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  phoneNumber: z.string().trim().max(30).optional(),
  customerId: z.string().length(24, 'Invalid customer id').optional(),
  code: z.string().trim().max(20).optional(),
  status: z.nativeEnum(SubscriptionDisplayStatus).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const subscriptionSummaryQuerySchema = z.object({
  period: z.enum(NAMED_PERIODS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const updateSubscriptionChildrenSchema = z.object({
  children: subscriptionChildrenSchema,
});

export const adjustSubscriptionCreditsSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-500)
    .max(500)
    .refine((delta) => delta !== 0, 'The adjustment cannot be zero'),
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required').max(300),
});

export const extendSubscriptionSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required').max(300),
});

export const subscriptionIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid subscription id'),
});

export const subscriptionCodeParamSchema = z.object({
  code: z.string().trim().min(4).max(20),
});
