import { z } from 'zod';
import { BillStatus, DiscountType } from '../../common/constants/billStatus';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { ticketCodeSchema } from '../play-sessions/playSession.validation';

const objectIdSchema = z.string().length(24, 'Invalid id');

export const createBillItemSchema = z.object({
  childName: z.string().trim().min(1).max(100),
  playPackageId: objectIdSchema,
  quantity: z.number().int().positive().default(1),
});

export const createBillDiscountSchema = z.object({
  type: z.nativeEnum(DiscountType),
  value: z.number().min(0),
});

export const createBillSchema = z.object({
  customer: z
    .object({
      customerId: objectIdSchema.optional(),
      parentName: z.string().trim().max(100).optional(),
      phoneNumber: z.string().trim().max(20).optional(),
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
      phoneNumber: z.string().trim().max(20).optional(),
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
        phoneNumber: z.string().trim().max(20).optional(),
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
});

export const cancelBillSchema = z.object({
  reason: z.string().trim().min(1, 'A cancellation reason is required').max(300),
});

export const refundBillSchema = z.object({
  reason: z.string().trim().min(1, 'A refund reason is required').max(300),
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
