import { Schema } from 'mongoose';
import {
  OvertimeMode,
  RoundingMode,
  ROUNDING_STEPS_MINOR,
  TIER_COUNT,
  TIER_MINUTES,
  type TieredPricing,
} from '../../common/constants/pricingModes';

/**
 * The TIERED_HOURLY configuration, as one sub-document shared by the package (the live
 * config), the session (snapshot at check-in) and the bill item (snapshot at checkout).
 * Using one schema in all three places means the snapshot can never be missing a field
 * the pricing needs.
 */
export const tieredPricingSchema = new Schema<TieredPricing>(
  {
    hourlyRates: {
      type: [Number],
      required: true,
      validate: {
        validator: (rates: number[]) =>
          rates.length === TIER_COUNT && rates.every((rate) => Number.isInteger(rate) && rate >= 0),
        message: `Tiered pricing needs exactly ${TIER_COUNT} non-negative hourly rates`,
      },
    },
    overtimeMode: { type: String, enum: Object.values(OvertimeMode), required: true },
    overtimeBlockMinutes: { type: Number, min: 1, max: TIER_MINUTES, default: 15 },
    roundingStep: { type: Number, enum: [...ROUNDING_STEPS_MINOR], default: 0 },
    roundingMode: { type: String, enum: Object.values(RoundingMode), default: RoundingMode.NEAREST },
  },
  { _id: false },
);

/**
 * The tiered config, read defensively and as a plain object. Null when the document has
 * none, which is every package, session and bill item that is not TIERED_HOURLY.
 *
 * Copying the fields out also strips the Mongoose wrapper, so the result is safe to put
 * into a response, an audit entry or a new snapshot.
 */
export function resolveTieredPricing(
  doc: { tieredPricing?: TieredPricing | null } | null | undefined,
): TieredPricing | null {
  const config = doc?.tieredPricing;
  if (!config || !Array.isArray(config.hourlyRates)) return null;

  return {
    hourlyRates: [...config.hourlyRates],
    overtimeMode: config.overtimeMode === OvertimeMode.BLOCK ? OvertimeMode.BLOCK : OvertimeMode.PER_MINUTE,
    overtimeBlockMinutes: config.overtimeBlockMinutes ?? 15,
    roundingStep: config.roundingStep ?? 0,
    roundingMode: config.roundingMode ?? RoundingMode.NEAREST,
  };
}
