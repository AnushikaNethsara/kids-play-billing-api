import { z } from 'zod';
import { ValidationError } from '../../common/errors';
import { MAX_CHILDREN_PER_TICKET } from '../play-sessions/playSession.validation';

const GRACE_TOO_LONG =
  'Grace minutes must be shorter than the visit length, otherwise the grace can never be exceeded and a long stay never uses another credit';

/** A month of visits for one family. More than this is almost certainly a typo. */
export const MAX_VISIT_CREDITS = 500;

/**
 * Checked against the merged plan rather than the request body, for the same reason as
 * `assertPricingConsistent` on packages: a partial update lowering `visitMinutes` alone can
 * invalidate a grace that was fine when it was saved.
 */
export function assertPlanConsistent(plan: { visitMinutes: number; graceMinutes: number }): void {
  if (plan.graceMinutes >= plan.visitMinutes) {
    throw new ValidationError(GRACE_TOO_LONG);
  }
}

const planFields = {
  name: z.string().trim().min(1).max(100),
  price: z.number().int().min(0),
  visitCredits: z.number().int().min(1).max(MAX_VISIT_CREDITS),
  visitMinutes: z.number().int().min(1).max(24 * 60),
  graceMinutes: z.number().int().min(0).max(24 * 60),
  extraBlockPrice: z.number().int().min(0),
  maxChildren: z.number().int().min(1).max(MAX_CHILDREN_PER_TICKET).nullable(),
  description: z.string().trim().max(500),
  sortOrder: z.number().int(),
};

export const createSubscriptionPlanSchema = z
  .object({
    name: planFields.name,
    price: planFields.price,
    visitCredits: planFields.visitCredits,
    visitMinutes: planFields.visitMinutes,
    graceMinutes: planFields.graceMinutes.optional(),
    extraBlockPrice: planFields.extraBlockPrice,
    maxChildren: planFields.maxChildren.optional(),
    description: planFields.description.optional(),
    sortOrder: planFields.sortOrder.optional(),
  })
  .refine((data) => (data.graceMinutes ?? 0) < data.visitMinutes, {
    message: GRACE_TOO_LONG,
    path: ['graceMinutes'],
  });

export const updateSubscriptionPlanSchema = z
  .object({
    name: planFields.name.optional(),
    price: planFields.price.optional(),
    visitCredits: planFields.visitCredits.optional(),
    visitMinutes: planFields.visitMinutes.optional(),
    graceMinutes: planFields.graceMinutes.optional(),
    extraBlockPrice: planFields.extraBlockPrice.optional(),
    maxChildren: planFields.maxChildren.optional(),
    description: planFields.description.optional(),
    sortOrder: planFields.sortOrder.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const updateSubscriptionPlanStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listSubscriptionPlansQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
});

export const subscriptionPlanIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid subscription plan id'),
});
