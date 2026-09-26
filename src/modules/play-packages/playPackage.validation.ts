import { z } from 'zod';
import { SessionPricingMode } from '../../common/constants/pricingModes';
import { ValidationError } from '../../common/errors';

const GRACE_TOO_LONG =
  'Grace minutes must be shorter than the block length, otherwise the grace can never be exceeded and extra time is never charged';

/**
 * The one rule that spans two fields, checked against the **merged** package rather than
 * the request body.
 *
 * A Zod refine cannot do this on the update path: `updatePlayPackageSchema` is a partial,
 * so a request lowering `durationMinutes` to 10 on a package already carrying
 * `graceMinutes: 30` looks perfectly valid on its own. The service applies the patch first
 * and calls this with the result.
 */
export function assertPricingConsistent(pkg: {
  pricingMode: SessionPricingMode;
  durationMinutes: number;
  graceMinutes: number;
}): void {
  if (pkg.pricingMode !== SessionPricingMode.BLOCK_WITH_GRACE) return;
  if (pkg.graceMinutes >= pkg.durationMinutes) {
    throw new ValidationError(GRACE_TOO_LONG);
  }
}

export const createPlayPackageSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    durationMinutes: z.number().int().positive(),
    price: z.number().int().min(0),
    pricingMode: z.nativeEnum(SessionPricingMode).optional(),
    graceMinutes: z.number().int().min(0).max(24 * 60).optional(),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (data) =>
      data.pricingMode !== SessionPricingMode.BLOCK_WITH_GRACE ||
      (data.graceMinutes ?? 0) < data.durationMinutes,
    { message: GRACE_TOO_LONG, path: ['graceMinutes'] },
  );

export const updatePlayPackageSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    durationMinutes: z.number().int().positive().optional(),
    price: z.number().int().min(0).optional(),
    pricingMode: z.nativeEnum(SessionPricingMode).optional(),
    graceMinutes: z.number().int().min(0).max(24 * 60).optional(),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const updatePlayPackageStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listPlayPackagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
});

export const playPackageIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid play package id'),
});
