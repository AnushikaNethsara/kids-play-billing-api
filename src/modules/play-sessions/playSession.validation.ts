import { z } from 'zod';
import { phoneNumberInputSchema } from '../../common/utils/phone';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';

/**
 * Generated on the device, so the server only constrains it to something safe to put in
 * a URL path and a QR payload rather than dictating a format.
 */
export const ticketCodeSchema = z
  .string()
  .trim()
  .min(8, 'Ticket code is too short')
  .max(64, 'Ticket code is too long')
  .regex(/^[A-Za-z0-9:_-]+$/, 'Ticket code contains unsupported characters');

/** Same alphabet as a ticket code: both are device-generated idempotency keys. */
export const extraLocalIdSchema = z
  .string()
  .trim()
  .min(8, 'Extra id is too short')
  .max(64, 'Extra id is too long')
  .regex(/^[A-Za-z0-9:_-]+$/, 'Extra id contains unsupported characters');

export const MAX_EXTRAS_PER_SESSION = 20;

/** The most children one family ticket may cover - a guard against a mistyped headcount. */
export const MAX_CHILDREN_PER_TICKET = 10;

export const sessionExtraInputSchema = z.object({
  localId: extraLocalIdSchema,
  productId: z.string().length(24, 'Invalid product id'),
  quantity: z.number().int().min(1).max(100),
});

export const addSessionExtrasSchema = z.object({
  extras: z.array(sessionExtraInputSchema).min(1).max(MAX_EXTRAS_PER_SESSION),
});

export const sessionExtraParamSchema = z.object({
  ticketCode: ticketCodeSchema,
  localId: extraLocalIdSchema,
});

// Optional as a whole: a DELETE usually carries no body at all.
export const removeSessionExtraSchema = z
  .object({
    reason: z.string().trim().max(300).optional(),
  })
  .optional();

// A single child sends `childName`, as every build before family tickets did; a family
// sends `childNames`. Exactly one, so a request can never mean two different headcounts.
export const checkInSchema = z
  .object({
    ticketCode: ticketCodeSchema,
    childName: z.string().trim().min(1).max(100).optional(),
    childNames: z
      .array(z.string().trim().min(1, 'A child name cannot be empty').max(100))
      .min(1, 'At least one child is required')
      .max(MAX_CHILDREN_PER_TICKET, `A ticket can cover at most ${MAX_CHILDREN_PER_TICKET} children`)
      .optional(),
    playPackageId: z.string().length(24, 'Invalid play package id'),
    checkInAt: z.string().datetime({ offset: true }).optional(),
    customer: z
      .object({
        customerId: z.string().length(24, 'Invalid customer id').optional(),
        parentName: z.string().trim().max(100).optional(),
        phoneNumber: phoneNumberInputSchema.optional(),
      })
      .optional(),
    extras: z.array(sessionExtraInputSchema).max(MAX_EXTRAS_PER_SESSION).optional(),
  })
  .refine((body) => (body.childName === undefined) !== (body.childNames === undefined), {
    message: 'Send exactly one of childName or childNames',
    path: ['childNames'],
  });

export const voidSessionSchema = z.object({
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required').max(300),
});

export const listPlaySessionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(PlaySessionStatus).optional(),
  phoneNumber: z.string().trim().max(30).optional(),
  childName: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

export const playSessionIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid play session id'),
});

export const ticketCodeParamSchema = z.object({
  ticketCode: ticketCodeSchema,
});
