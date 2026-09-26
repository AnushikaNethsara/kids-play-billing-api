import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import {
  DEFAULT_SESSION_PRICING_MODE,
  SessionPricingMode,
} from '../../common/constants/pricingModes';

export interface PlayPackageDocument {
  name: string;
  /**
   * Under PRORATA this is the rate denominator: `price` buys this many minutes. Under
   * BLOCK_WITH_GRACE it is the block length: each started block costs `price` in full.
   */
  durationMinutes: number;
  price: number;
  /**
   * How time is turned into money for this package. Snapshotted onto every session at
   * check-in, so editing it never reprices a child already in the play area.
   */
  pricingMode: SessionPricingMode;
  /**
   * Minutes of overrun forgiven after each completed block before the next charge starts.
   * BLOCK_WITH_GRACE only; kept on the package while the mode is PRORATA so flipping the
   * mode back does not lose the value.
   */
  graceMinutes: number;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PlayPackageHydrated = HydratedDocument<PlayPackageDocument>;

const playPackageSchema = new Schema<PlayPackageDocument>(
  {
    name: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    // Stored as integer minor units (LKR cents), never floating point.
    price: { type: Number, required: true, min: 0 },
    pricingMode: {
      type: String,
      enum: Object.values(SessionPricingMode),
      default: DEFAULT_SESSION_PRICING_MODE,
    },
    graceMinutes: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Cashiers list only active packages, sorted for display.
playPackageSchema.index({ isActive: 1, sortOrder: 1 });

/**
 * Read the pricing fields defensively, the same way settings.model.ts resolves its own.
 * A package saved before pricing modes existed has neither key, and while Mongoose applies
 * the schema default on hydration, the money path does not rely on that: an aggregation or
 * a `.lean()` read sees the raw BSON, where the field is simply absent.
 */
export function resolvePricingMode(
  pkg: Partial<Pick<PlayPackageDocument, 'pricingMode'>>,
): SessionPricingMode {
  return pkg.pricingMode === SessionPricingMode.BLOCK_WITH_GRACE
    ? SessionPricingMode.BLOCK_WITH_GRACE
    : DEFAULT_SESSION_PRICING_MODE;
}

export function resolveGraceMinutes(
  pkg: Partial<Pick<PlayPackageDocument, 'graceMinutes'>>,
): number {
  const value = pkg.graceMinutes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export const PlayPackageModel = model<PlayPackageDocument>('PlayPackage', playPackageSchema);
