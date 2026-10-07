import { z } from 'zod';
import { phoneNumberInputSchema } from '../../common/utils/phone';
import { BillStatus, DiscountType } from '../../common/constants/billStatus';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { BillItemKind } from '../../common/constants/billItemKind';
import { ticketCodeSchema } from '../play-sessions/playSession.validation';

const objectIdSchema = z.string().length(24, 'Invalid id');

/** A group of more than this is almost certainly a typo (an amount typed into headcount). */
export const MAX_GROUP_HEADCOUNT = 500;
/** A group visit is one day at most. */
export const MAX_GROUP_VISIT_MINUTES = 24 * 60;
export const MAX_PRODUCT_QUANTITY = 100;

const playItemSchema = z.object({
  kind: z.literal(BillItemKind.PLAY),
  childName: z.string().trim().min(1).max(100),
  playPackageId: objectIdSchema,
  quantity: z.number().int().positive().default(1),
});

const groupItemSchema = z.object({
  kind: z.literal(BillItemKind.GROUP),
  groupName: z.string().trim().min(1, 'A group name is required').max(100),
  headcount: z
    .number()
    .int()
    .min(1, 'Headcount must be at least 1')
    .max(MAX_GROUP_HEADCOUNT, `Headcount cannot exceed ${MAX_GROUP_HEADCOUNT}`),
  ratePerChildPerHour: z.number().int().min(1, 'The rate must be more than zero'),
  visitMinutes: z
    .number()
    .int()
    .min(1, 'The visit must be at least a minute long')
    .max(MAX_GROUP_VISIT_MINUTES, 'A group visit cannot be longer than a day'),
  visitAt: z.string().datetime({ offset: true }).optional(),
});

const productItemSchema = z.object({
  kind: z.literal(BillItemKind.PRODUCT),
  productId: objectIdSchema,
  quantity: z.number().int().min(1).max(MAX_PRODUCT_QUANTITY),
});

/**
 * A line on `POST /bills`. Clients written before kinds existed send no `kind`, and every
 * one of those lines is a child on a package - so a missing kind is filled in as PLAY
 * before the union is applied, rather than making every old client fail validation.
 */
export const createBillItemSchema = z.preprocess(
  (value) =>
    value && typeof value === 'object' && !('kind' in value)
      ? { ...(value as object), kind: BillItemKind.PLAY }
      : value,
  z.discriminatedUnion('kind', [playItemSchema, groupItemSchema, productItemSchema]),
);

export const createBillDiscountSchema = z.object({
  type: z.nativeEnum(DiscountType),
  value: z.number().min(0),
});

export const createBillSchema = z.object({
  customer: z
    .object({
      customerId: objectIdSchema.optional(),
      parentName: z.string().trim().max(100).optional(),
      phoneNumber: phoneNumberInputSchema.optional(),
    })
    .optional(),
  items: z.array(createBillItemSchema).min(1, 'At least one bill item is required'),
  discount: createBillDiscountSchema.optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const createBillFromSessionsSchema = z.object({
  ticketCodes: z
    .array(ticketCodeSchema)
    .min(1, 'At least one ticket is required to check out')
    .max(20, 'Too many tickets in a single checkout'),
  checkOutAt: z.string().datetime({ offset: true }).optional(),
  discount: createBillDiscountSchema.optional(),
  customer: z
    .object({
      customerId: objectIdSchema.optional(),
      parentName: z.string().trim().max(100).optional(),
      phoneNumber: phoneNumberInputSchema.optional(),
    })
    .optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const updateBillSchema = z
  .object({
    customer: z
      .object({
        customerId: objectIdSchema.optional(),
        parentName: z.string().trim().max(100).optional(),
        phoneNumber: phoneNumberInputSchema.optional(),
      })
      .optional(),
    items: z.array(createBillItemSchema).min(1).optional(),
    discount: createBillDiscountSchema.optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const completeBillSchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  paidAmount: z.number().int().min(0).optional(),
  backdateToCheckout: z.boolean().optional(),
});

export const cancelBillSchema = z.object({
  reason: z.string().trim().min(1, 'A cancellation reason is required').max(300),
});

export const refundBillSchema = z.object({
  reason: z.string().trim().min(1, 'A refund reason is required').max(300),
});

export const setTestBillSchema = z.object({
  isTestBill: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  billNumber: z.string().trim().optional(),
  parentName: z.string().trim().optional(),
  phoneNumber: z.string().trim().optional(),
  cashierId: objectIdSchema.optional(),
  status: z.nativeEnum(BillStatus).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minTotal: z.coerce.number().int().min(0).optional(),
  maxTotal: z.coerce.number().int().min(0).optional(),
  isTimed: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  kind: z.nativeEnum(BillItemKind).optional(),
  isTestBill: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sort: z.enum(['newest', 'oldest', 'total_desc', 'total_asc']).optional(),
});

export const billIdParamSchema = z.object({
  id: objectIdSchema,
});

export const billNumberParamSchema = z.object({
  billNumber: z.string().trim().min(1),
});

export const recentBillsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});
