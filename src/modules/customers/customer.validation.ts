import { z } from 'zod';
import { phoneNumberInputSchema } from '../../common/utils/phone';
import { CUSTOMER_SEGMENTS, CUSTOMER_SORT_FIELDS } from './customerSegments';

export const createCustomerSchema = z.object({
  parentName: z.string().trim().max(100).optional(),
  phoneNumber: phoneNumberInputSchema.optional(),
  email: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional(),
});

export const updateCustomerSchema = z
  .object({
    parentName: z.string().trim().max(100).optional(),
    phoneNumber: phoneNumberInputSchema.optional(),
    email: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const count = z.coerce.number().int().min(0);
const queryBoolean = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

/** Each pair must not run backwards. Dates compare correctly as YYYY-MM-DD strings. */
const RANGE_PAIRS = [
  ['minVisits', 'maxVisits'],
  ['minSpent', 'maxSpent'],
  ['lastVisitFrom', 'lastVisitTo'],
  ['firstVisitFrom', 'firstVisitTo'],
  ['joinedFrom', 'joinedTo'],
  ['visitedFrom', 'visitedTo'],
] as const;

export const listCustomersQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().min(1).optional(),
    segment: z.enum(CUSTOMER_SEGMENTS).optional(),
    minVisits: count.optional(),
    maxVisits: count.optional(),
    // Integer minor units (LKR cents), like every other amount on the wire.
    minSpent: count.optional(),
    maxSpent: count.optional(),
    lastVisitFrom: businessDate.optional(),
    lastVisitTo: businessDate.optional(),
    firstVisitFrom: businessDate.optional(),
    firstVisitTo: businessDate.optional(),
    joinedFrom: businessDate.optional(),
    joinedTo: businessDate.optional(),
    visitedFrom: businessDate.optional(),
    visitedTo: businessDate.optional(),
    hasPhone: queryBoolean,
    hasEmail: queryBoolean,
    sort: z.enum(CUSTOMER_SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine((query, ctx) => {
    for (const [low, high] of RANGE_PAIRS) {
      const from = query[low];
      const to = query[high];
      if (from !== undefined && to !== undefined && from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [high],
          message: `"${high}" must not be before "${low}"`,
        });
      }
    }
  });

export const customerIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid customer id'),
});

export const searchCustomerQuerySchema = z.object({
  phoneNumber: z.string().trim().min(1, 'phoneNumber query parameter is required'),
});

export const childrenQuerySchema = z.object({
  phoneNumber: phoneNumberInputSchema.refine(Boolean, 'phoneNumber query parameter is required'),
});

export const lookupCustomerQuerySchema = z.object({
  phoneNumber: phoneNumberInputSchema.refine(Boolean, 'phoneNumber query parameter is required'),
});

export const listCustomerVisitsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
