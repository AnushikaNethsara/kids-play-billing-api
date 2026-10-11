import type { SessionPricingMode, TieredPricing } from '../../common/constants/pricingModes';

/** Tiered config as a client sends it: the overtime block and rounding have defaults. */
export interface TieredPricingInput {
  hourlyRates: number[];
  overtimeMode: TieredPricing['overtimeMode'];
  overtimeBlockMinutes?: number;
  roundingStep?: number;
  roundingMode?: TieredPricing['roundingMode'];
}

export interface PlayPackagePublic {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  pricingMode: SessionPricingMode;
  graceMinutes: number;
  /** Set on a TIERED_HOURLY package; null on every other package. */
  tieredPricing: TieredPricing | null;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlayPackageInput {
  name: string;
  /** Required except under TIERED_HOURLY, where it is always 60. */
  durationMinutes?: number;
  /** Required except under TIERED_HOURLY, where it mirrors the 1st hour's rate. */
  price?: number;
  pricingMode?: SessionPricingMode;
  graceMinutes?: number;
  tieredPricing?: TieredPricingInput;
  description?: string;
  sortOrder?: number;
}

export interface UpdatePlayPackageInput {
  name?: string;
  durationMinutes?: number;
  price?: number;
  pricingMode?: SessionPricingMode;
  graceMinutes?: number;
  tieredPricing?: TieredPricingInput;
  description?: string;
  sortOrder?: number;
}

export interface ListPlayPackagesQuery {
  page: number;
  limit: number;
  isActive?: boolean;
}
