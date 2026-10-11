import { z } from 'zod';
import {
  OvertimeMode,
  RoundingMode,
  ROUNDING_STEPS_MINOR,
  SessionPricingMode,
  TIER_COUNT,
  TIER_MINUTES,
  type TieredPricing,
} from '../../common/constants/pricingModes';
import { ValidationError } from '../../common/errors';

const GRACE_TOO_LONG =
  'Grace minutes must be shorter than the block length, otherwise the grace can never be exceeded and extra time is never charged';

const TIERED_PRICING_REQUIRED =
  'A tiered hourly package needs its hourly rates, overtime mode and rounding';
const TIERED_GRACE_TOO_LONG = `Grace minutes must be shorter than an hour (${TIER_MINUTES} minutes)`;
const TIERED_DURATION = `A tiered hourly package always bills in ${TIER_MINUTES}-minute hours`;

export const tieredPricingInputSchema = z.object({
  hourlyRates: z
    .array(z.number().int().min(0))
    .length(TIER_COUNT, `Exactly ${TIER_COUNT} hourly rates are required`),
  overtimeMode: z.nativeEnum(OvertimeMode),
  overtimeBlockMinutes: z.number().int().min(1).max(TIER_MINUTES).optional(),
  roundingStep: z
    .number()
    .int()
    .refine((step) => (ROUNDING_STEPS_MINOR as readonly number[]).includes(step), {
      message: `Rounding step must be one of ${ROUNDING_STEPS_MINOR.join(', ')} (minor units)`,
    })
    .optional(),
  roundingMode: z.nativeEnum(RoundingMode).optional(),
});

/**
 * The rules that span several fields, checked against the **merged** package rather than
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
  tieredPricing?: TieredPricing | null;
}): void {
  if (pkg.pricingMode === SessionPricingMode.BLOCK_WITH_GRACE) {
    if (pkg.graceMinutes >= pkg.durationMinutes) {
      throw new ValidationError(GRACE_TOO_LONG);
    }
    return;
  }

  if (pkg.pricingMode === SessionPricingMode.TIERED_HOURLY) {
    const config = pkg.tieredPricing;
    if (!config || config.hourlyRates.length !== TIER_COUNT) {
      throw new ValidationError(TIERED_PRICING_REQUIRED);
    }
    if (pkg.durationMinutes !== TIER_MINUTES) {
      throw new ValidationError(TIERED_DURATION);
    }
    if (pkg.graceMinutes >= TIER_MINUTES) {
      throw new ValidationError(TIERED_GRACE_TOO_LONG);
    }
    if (
      config.overtimeMode === OvertimeMode.BLOCK &&
      !(config.overtimeBlockMinutes >= 1 && config.overtimeBlockMinutes <= TIER_MINUTES)
    ) {
      throw new ValidationError(`Overtime blocks must be 1 to ${TIER_MINUTES} minutes long`);
    }
  }
}

export const createPlayPackageSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    // Optional only for a tiered package, where the service fills them in from the tiers.
    durationMinutes: z.number().int().positive().optional(),
    price: z.number().int().min(0).optional(),
    pricingMode: z.nativeEnum(SessionPricingMode).optional(),
    graceMinutes: z.number().int().min(0).max(24 * 60).optional(),
    tieredPricing: tieredPricingInputSchema.optional(),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (data) =>
      data.pricingMode === SessionPricingMode.TIERED_HOURLY ||
      (data.durationMinutes !== undefined && data.price !== undefined),
    { message: 'Duration and price are required', path: ['price'] },
  )
  .refine(
    (data) => data.pricingMode !== SessionPricingMode.TIERED_HOURLY || data.tieredPricing !== undefined,
    { message: TIERED_PRICING_REQUIRED, path: ['tieredPricing'] },
  )
  .refine(
    (data) =>
      data.pricingMode !== SessionPricingMode.BLOCK_WITH_GRACE ||
      data.durationMinutes === undefined ||
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
    tieredPricing: tieredPricingInputSchema.optional(),
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
