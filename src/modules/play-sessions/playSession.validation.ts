import { z } from 'zod';
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

export const checkInSchema = z.object({
  ticketCode: ticketCodeSchema,
  childName: z.string().trim().min(1).max(100),
  playPackageId: z.string().length(24, 'Invalid play package id'),
  checkInAt: z.string().datetime({ offset: true }).optional(),
  customer: z
    .object({
      customerId: z.string().length(24, 'Invalid customer id').optional(),
      parentName: z.string().trim().max(100).optional(),
      phoneNumber: z.string().trim().max(30).optional(),
    })
    .optional(),
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
